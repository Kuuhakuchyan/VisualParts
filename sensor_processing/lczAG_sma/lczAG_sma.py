"""
LCZ A & G — 背景冷源与基准区 (密林/湖泊) → 滑动平均低通滤波

物理背景:
  厚山林冠和湖泊有巨大热容量, 温度变化率极低。
  秒级大幅跳动必定是半导体白噪声, 滑动平均即可消除。

  环形队列实现: sum = sum + new - old, O(1) 时间复杂度。

接口:
  process(df, **kwargs) → df (新增 'temp_cleaned' 列)

参考文献:
  Smith (1997). The scientist and engineer's guide to digital signal processing.
    Ch.15 — 移动平均滤波器是时域降噪的最优选择.
"""

import pandas as pd

from ..config import SMA


def _sma_filter(series: pd.Series, window: int, min_periods: int = 5) -> pd.Series:
    """
    滑动平均滤波器 (利用 pandas rolling)

    Args:
        series: 温度序列
        window: 窗口大小 (点数)
        min_periods: 最少有效点数
    """
    return series.rolling(window=window, min_periods=min_periods, center=True).mean()


def process(df: pd.DataFrame, **kwargs) -> pd.DataFrame:
    """
    滑动平均处理

    Args:
        df: 必须包含 'temp_c' 和 'humidity_pct' 列
        **kwargs: 覆盖 SMA 配置 (tree_window / water_window)

    Returns:
        df 新增 'temp_cleaned' 列
    """
    params = {**SMA, **kwargs}

    # 按默认窗口处理 (调用方可根据 LCZ_A 或 LCZ_G 传入不同 window)
    window = kwargs.get('window', params.get('tree_window', 30))

    series = df['temp_c'].astype(float)

    # 先填充极端 NaN
    series_filled = series.ffill().bfill()

    cleaned = _sma_filter(series_filled, window=window,
                          min_periods=params.get('min_periods', 5))

    # 恢复原始数据的 NaN (不伪造数据)
    cleaned[series.isna()] = float('nan')

    df = df.copy()
    df['temp_cleaned'] = cleaned
    return df
