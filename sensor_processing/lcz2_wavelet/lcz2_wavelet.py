"""
LCZ 2 — 建筑峡谷 (教学楼群) → 小波阈值去噪

物理背景:
  下课人群涌动、局地微涡旋带来的热扰动是高频非平稳信号。
  db4 小波 5 层分解 → 细节系数软阈值收缩 → 重构得到纯净峡谷背景温度。

接口:
  process(df, **kwargs) → df (新增 'temp_cleaned' 列)

参考文献:
  Torrence & Compo (1998). A practical guide to wavelet analysis. BAMS, 79(1), 61-78.
"""

import numpy as np
import pandas as pd

from ..config import WAVELET


def _wavelet_denoise(signal: np.ndarray,
                     wavelet: str = 'db4',
                     level: int = 4,
                     mode: str = 'soft',
                     keep_cA: bool = True,
                     keep_cD: list = None) -> np.ndarray:
    """
    小波阈值去噪核心

    1. 多级离散小波分解 wavedec
    2. 对细节系数 cD 做软阈值收缩 (或硬置零)
    3. 逆小波重构 waverec
    """
    try:
        import pywt
    except ImportError:
        raise ImportError("pywt not installed. Run: pip install PyWavelets")

    coeffs = pywt.wavedec(signal, wavelet, level=level)

    # 近似系数 (低频背景) — 始终保留
    cA = coeffs[0] if keep_cA else np.zeros_like(coeffs[0])

    # 细节系数 — 软阈值收缩
    cD_list = []
    for i, cD in enumerate(coeffs[1:]):
        dl = i + 1
        if keep_cD is not None and dl not in keep_cD:
            # 该层细节系数置零
            cD_list.append(np.zeros_like(cD))
        else:
            if mode == 'soft':
                sigma = np.median(np.abs(cD)) / 0.6745  # 鲁棒噪声估计
                threshold = sigma * np.sqrt(2 * np.log(len(cD)))
                cD_thresh = pywt.threshold(cD, threshold, mode='soft')
                cD_list.append(cD_thresh)
            elif mode == 'hard':
                cD_list.append([])  # 全部置零, 等效于硬去除
            else:
                cD_list.append(cD)

    # 重构
    denoised = pywt.waverec([cA] + cD_list, wavelet)

    # 对齐长度 (waverec 可能比输入多几个点)
    if len(denoised) > len(signal):
        denoised = denoised[:len(signal)]
    elif len(denoised) < len(signal):
        denoised = np.pad(denoised, (0, len(signal) - len(denoised)), 'edge')

    return denoised


def process(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """
    小波去噪处理

    Args:
        df: 必须包含 'temp_c' 列
        **kwargs: 覆盖 WAVELET 配置

    Returns:
        df 新增 'temp_cleaned' 列
    """
    params = {**WAVELET, **kwargs}
    signal = df['temp_c'].values.astype(float)

    # 处理 NaN
    nan_mask = np.isnan(signal)
    signal_filled = signal.copy()
    if nan_mask.any():
        # 前值填充 NaN
        signal_filled = pd.Series(signal_filled).ffill().bfill().values

    # 确保信号长度是 2 的幂 (or 足够长)
    if len(signal_filled) < 32:
        print(f"  Wavelet: signal too short ({len(signal_filled)} pts), skipping denoise")
        df['temp_cleaned'] = signal_filled
        return df

    cleaned = _wavelet_denoise(
        signal_filled,
        wavelet=params['wavelet'],
        level=min(params['level'], int(np.log2(len(signal_filled))) - 1),
        mode=params['mode'],
        keep_cA=params['keep_cA'],
        keep_cD=params.get('keep_cD', None) if params.get('keep_cD') else [],
    )

    # 恢复原始 NaN 位置
    cleaned[nan_mask] = np.nan

    df = df.copy()
    df['temp_cleaned'] = cleaned
    return df
