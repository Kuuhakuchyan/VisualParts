"""
LCZ B & C — 热力交互与平流区 (稀疏树木/矮树灌木) → CEEMDAN 模态分解

物理背景:
  过渡带既有"宏观日照升温"又有"冷风降温"。
  CEEMDAN 是数据驱动的自适应分解, 不需要预设基函数。
  通过加入白噪声辅助筛选, 将信号分离为多个 IMF → 丢弃高频噪声 → 重构。

接口:
  process(df, **kwargs) → df (新增 'temp_cleaned' 列)

参考文献:
  Huang et al. (1998). The empirical mode decomposition and the Hilbert spectrum
    for nonlinear and non-stationary time series analysis. Proc. R. Soc. A, 454, 903-995.
  Torres et al. (2011). A complete ensemble empirical mode decomposition with
    adaptive noise. ICASSP 2011.
"""

import numpy as np
import pandas as pd

from ..config import CEEMDAN


def _ceemdan_filter(signal: np.ndarray,
                    max_imf: int = 5,
                    ensemble: int = 50,
                    keep_imf: list = None,
                    parallel: bool = True) -> np.ndarray:
    """
    CEEMDAN 分解 + 选择性重构

    Args:
        signal: 输入信号 (1D array)
        max_imf: 最多提取 IMF 数量
        ensemble: 加噪次数
        keep_imf: 保留哪些 IMF (list of int). None=保留 IMF1 以后的所有低频
        parallel: 是否并行

    Returns:
        重构后的信号
    """
    try:
        from PyEMD import CEEMDAN
    except ImportError:
        raise ImportError("PyEMD not installed. Run: pip install EMD-signal")

    if len(signal) < 64:
        print(f"  CEEMDAN: signal too short ({len(signal)} pts), skipping")
        return signal

    ceemdan = CEEMDAN(trials=ensemble, max_imf=max_imf, parallel=parallel)
    imfs = ceemdan.ceemdan(signal)

    n_imfs = imfs.shape[0]
    if keep_imf is None:
        # 默认: 保留 IMF2 及以后 (丢弃最高频 IMF0, IMF1)
        keep_imf = list(range(2, n_imfs))

    # 重构
    reconstructed = np.zeros_like(signal)
    for idx in keep_imf:
        if idx < n_imfs:
            reconstructed += imfs[idx]

    return reconstructed


def process(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """
    CEEMDAN 模态分解处理

    Args:
        df: 必须包含 'temp_c' 列
        **kwargs: 覆盖 CEEMDAN 配置

    Returns:
        df 新增 'temp_cleaned' 列 + 'temp_lowfreq' (低频趋势) + 'temp_highfreq' (高频噪声)
    """
    params = {**CEEMDAN, **kwargs}
    signal = df['temp_c'].values.astype(float)

    # 处理 NaN
    nan_mask = np.isnan(signal)
    signal_filled = signal.copy()
    if nan_mask.any():
        signal_filled = pd.Series(signal_filled).ffill().bfill().values

    # CEEMDAN 分解
    reconstructed = _ceemdan_filter(
        signal_filled,
        max_imf=params['max_imf'],
        ensemble=params['ensemble'],
        keep_imf=params.get('keep_imf', None),
        parallel=params.get('parallel', True),
    )

    # 高频残差 (原始 - 重构)
    residual = signal_filled - reconstructed

    # 恢复 NaN
    reconstructed[nan_mask] = np.nan

    df = df.copy()
    df['temp_cleaned'] = reconstructed
    df['temp_lowfreq'] = reconstructed     # 低频趋势
    df['temp_highfreq'] = residual          # 高频扰动 (微风等)

    return df
