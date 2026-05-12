"""
LCZ 5 & 8 — 局部极端热源 (食堂排风/空调外机) → MAD 绝对中位差离群值剔除

物理背景:
  食堂排风和空调外机是破坏性极端离群值 (非高斯噪声)。
  传统 3σ 法则被高峰值拉偏均值而导致"掩蔽效应"失效。
  MAD 基于中位数, 对极端值天然免疫。

算法:
  1. 滑动窗口取中位数 M = median(X_window)
  2. 计算 MAD = median(|Xi - M|)
  3. 若 |Xi - M| / MAD > threshold (K=5) → 判定为异常 → 前值填充

接口:
  process(df, **kwargs) → df (新增 'temp_cleaned' 列)

参考文献:
  Leys et al. (2013). Detecting outliers: Do not use standard deviation around the mean,
    use absolute deviation around the median. J Exp Soc Psychol, 49(4), 764-766.
  Hampel (1974). The influence curve and its role in robust estimation. JASA, 69(346), 383-393.
"""

import numpy as np
import pandas as pd

from ..config import MAD


def _mad_filter(series: pd.Series, window: int = 300, threshold: float = 5.0,
                fill: str = 'prev') -> pd.Series:
    """
    MAD 滑动窗口离群值剔除

    Args:
        series: 温度序列
        window: 滑动窗口大小 (点数)
        threshold: MAD 阈值 (K), 默认 5 (≈3σ × 1.4826 ≈ 4.45, 取 5 更保守)
        fill: 'prev'=前值填充, 'median'=中位数填充

    Returns:
        清洗后的序列
    """
    result = series.copy().astype(float)
    mask = np.zeros(len(series), dtype=bool)

    half = window // 2
    for i in range(len(series)):
        lo = max(0, i - half)
        hi = min(len(series), i + half)
        win = result.values[lo:hi] if hasattr(result, 'values') else result[lo:hi]
        win = win[~np.isnan(win)]

        if len(win) < 10:    # 窗口内有效数据太少, 跳过
            continue

        median = np.median(win)
        mad = np.median(np.abs(win - median))
        if mad < 1e-9:
            continue

        score = np.abs(result.iloc[i] - median) / mad if hasattr(result, 'iloc') else np.abs(result[i] - median) / mad
        if score > threshold:
            mask[i] = True

    # 填充异常点
    if fill == 'prev':
        result = result.where(~mask, other=np.nan)
        result.ffill(inplace=True)
    elif fill == 'median':
        result[mask] = result.median()

    result.bfill(inplace=True)  # 开头 NaN 用后值填充
    return result


def process(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """
    MAD 离群值剔除处理

    Args:
        df: 必须包含 'temp_c' 列
        **kwargs: 覆盖 MAD 配置

    Returns:
        df 新增 'temp_cleaned' 列 + 'outlier_flag' 列
    """
    params = {**MAD, **kwargs}
    series = df['temp_c'].copy()

    cleaned = _mad_filter(
        series,
        window=params['window'],
        threshold=params['threshold'],
        fill=params['fill'],
    )

    df = df.copy()
    df['temp_cleaned'] = cleaned
    df['outlier_flag'] = (df['temp_c'] != df['temp_cleaned'])
    return df
