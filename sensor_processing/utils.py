"""
传感器数据处理 — 共享工具
"""

import pandas as pd
import numpy as np
from pathlib import Path


def read_sensor_csv(path: str) -> pd.DataFrame:
    """
    读取传感器 CSV 文件, 标准化列名和时间戳

    CSV 格式: datetime,temp_c,humidity_pct,gps_lat,gps_lon[,sensor_id]
    """
    df = pd.read_csv(path, parse_dates=['datetime'])

    # 统一列名
    col_map = {
        'temperature': 'temp_c',
        'humidity':    'humidity_pct',
        'humidity_%':  'humidity_pct',
        'temp':        'temp_c',
        'time':        'datetime',
        'timestamp':   'datetime',
    }
    df.rename(columns={k: v for k, v in col_map.items() if k in df.columns}, inplace=True)

    # 确保关键列存在
    for col in ['datetime', 'temp_c', 'humidity_pct']:
        if col not in df.columns:
            raise KeyError(f"Required column '{col}' not found in {path}. Got: {list(df.columns)}")

    df.set_index('datetime', inplace=True)
    df.sort_index(inplace=True)
    return df


def sliding_window_median(series: pd.Series, window: int) -> pd.Series:
    """滑动窗口中位数 (O(n log k) rolling median)"""
    return series.rolling(window=window, min_periods=3, center=True).median()


def ring_buffer_sma(series: pd.Series, window: int) -> pd.Series:
    """环形队列滑动平均 — 等效于 rolling.mean() 但更直观"""
    return series.rolling(window=window, min_periods=1, center=True).mean()


def fill_outliers(series: pd.Series, mask: pd.Series, method: str = 'prev') -> pd.Series:
    """填充异常值: 'prev'=前值填充, 'median'=中位数填充"""
    result = series.copy()
    if method == 'prev':
        result[mask] = np.nan
        result.ffill(inplace=True)
    elif method == 'median':
        result[mask] = series.median()
    return result


def check_data_quality(df: pd.DataFrame, max_nan_gap: int = 3) -> dict:
    """检查数据质量, 返回报告字典"""
    report = {
        'total_rows':  len(df),
        'nan_temp':    df['temp_c'].isna().sum(),
        'nan_humid':   df['humidity_pct'].isna().sum(),
        'max_nan_run': _max_consecutive_nan(df['temp_c']),
        'temp_min':    df['temp_c'].min(),
        'temp_max':    df['temp_c'].max(),
        'temp_mean':   df['temp_c'].mean(),
        'ok':          True,
    }
    if report['max_nan_run'] > max_nan_gap:
        report['ok'] = False
    if report['temp_max'] > 80 or report['temp_min'] < -30:
        report['ok'] = False
    return report


def _max_consecutive_nan(series: pd.Series) -> int:
    """最大连续 NaN 点数"""
    mask = series.isna().astype(int)
    return (mask.groupby(mask.diff().ne(0).cumsum()).cumsum() * mask).max()


def ensure_output_dir(path: str = None) -> Path:
    """确保输出目录存在"""
    base = Path(__file__).parent
    out = base / 'output'
    out.mkdir(exist_ok=True)
    if path:
        (out / path).mkdir(parents=True, exist_ok=True)
    return out
