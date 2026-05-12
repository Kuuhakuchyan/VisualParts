"""
LCZ D — 辐射强迫区 (操场/草坪) → 辐射误差修正模型

物理背景:
  无遮挡大草坪上, 百叶盒直接吸收太阳短波辐射。
  传感器读数 = 真实空气温度 + 辐射加热误差。

  能量守恒: α·I·(1+ρsinθ) = h·(T_sensor - T_air)
  导出:    ΔT = C · I · (1+ρsinθ) / vⁿ

  其中 v 为风速 (需要外接风速计或外部数据),
  C 为经验常数 (取决于百叶箱设计)。

接口:
  process(df, **kwargs) → df (新增 'temp_cleaned' 列)

参考文献:
  Nakamura & Mahrt (2005). Air temperature measurement errors in naturally
    ventilated radiation shields. J. Atmos. Ocean. Technol., 22(7), 1046-1058.
  Hubbart (2011). An inexpensive alternative radiation shield for monitoring
    surface air temperature. Meteorol. Appl., 18(3), 340-346.
"""

import numpy as np
import pandas as pd

from ..config import RADIATION


def _radiation_correction(t_raw: np.ndarray,
                           solar_elevation_deg: float = 45.0,
                           irradiance: float = 800.0,
                           wind_speed: float = 2.0,
                           C: float = 0.02,
                           albedo: float = 0.22,
                           n: float = 0.5) -> np.ndarray:
    """
    辐射加热误差修正

    Args:
        t_raw:           原始温度数组 (°C)
        solar_elevation_deg: 太阳高度角 (度)
        irradiance:      太阳辐射通量 I (W/m²)
        wind_speed:      风速 v (m/s)
        C:               经验修正常数
        albedo:          地表反照率 ρ (草地 ~0.22)
        n:               风速幂指数 (层流≈0.5, 湍流≈0.33)

    Returns:
        修正后的温度数组

    Formula:
        ΔT = C × I × (1 + ρ × sinθ) / vⁿ
        T_corrected = T_raw - ΔT
    """
    theta = np.radians(solar_elevation_deg)
    delta_T = C * irradiance * (1.0 + albedo * np.sin(theta)) / (wind_speed ** n)
    return t_raw - delta_T


def process(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """
    辐射误差修正处理

    Args:
        df: 必须包含 'temp_c' 列
            可选 'irradiance' (辐射 W/m²), 'wind_speed' (风速 m/s) 列
            若没有则使用 config 默认值
        **kwargs: 覆盖 RADIATION 配置
           - solar_elevation_deg: 太阳高度角
           - irradiance: 太阳辐射通量
           - wind_speed: 风速

    Returns:
        df 新增 'temp_cleaned' 列 + 'radiation_delta' 列 (修正量)
    """
    params = {**RADIATION, **kwargs}

    t_raw = df['temp_c'].values.astype(float)

    # 太阳辐射 — 从 df 列读取, 或使用默认值
    irrad = df['irradiance'].values if 'irradiance' in df.columns else np.full(len(df), params.get('irradiance', params.get('I_ref', 800)))
    ws = df['wind_speed'].values if 'wind_speed' in df.columns else np.full(len(df), params.get('wind_speed', params.get('v_ref', 2.0)))
    elev = params.get('solar_elevation_deg', 45.0)

    correction = np.zeros(len(t_raw))
    for i in range(len(t_raw)):
        if np.isnan(t_raw[i]):
            correction[i] = 0
            continue
        i_val = irrad[i] if isinstance(irrad, np.ndarray) else irrad
        v_val = ws[i] if isinstance(ws, np.ndarray) else ws
        delta = _radiation_correction(
            np.array([t_raw[i]]),
            solar_elevation_deg=elev,
            irradiance=float(i_val),
            wind_speed=max(float(v_val), 0.1),
            C=params['C'],
            albedo=params['albedo'],
            n=params['n'],
        )[0] - t_raw[i]  # 提取 delta
        correction[i] = delta

    cleaned = t_raw - correction

    df = df.copy()
    df['temp_cleaned'] = cleaned
    df['radiation_delta'] = correction  # 正数表示传感器偏高
    return df
