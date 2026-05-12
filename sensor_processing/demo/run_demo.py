"""
传感器数据处理 — 一键 Demo

为 5 种算法分别生成合成测试数据 → 运行算法 → 生成 before/after 对比图
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from config import LCZ_ALGO_MAP, WAVELET, MAD, SMA, CEEMDAN, RADIATION
from pipeline import process_dataframe


def generate_sample_data(minutes: int = 120, freq: str = '1s') -> dict:
    """
    为每种 LCZ 类型生成合成测试数据

    Returns:
        {lcz_type: DataFrame}
    """
    np.random.seed(42)
    n = minutes * 60  # 1Hz
    t = pd.date_range('2026-05-12 10:00:00', periods=n, freq=freq, tz='Asia/Shanghai')

    base_temp = 28.0 + 3 * np.sin(np.linspace(0, np.pi, n))  # 模拟日间升温

    datasets = {}

    # LCZ 2 (峡谷): 加高频人流扰动 (0.5Hz 伪随机跳变)
    temp = base_temp + np.random.normal(0, 0.2, n)
    for i in range(n):
        if np.random.random() < 0.02:  # 2% 概率瞬态扰动
            temp[i] += np.random.uniform(1, 3)
    datasets[2] = pd.DataFrame({'temp_c': temp, 'humidity_pct': 50 + np.random.normal(0, 2, n)}, index=t)

    # LCZ 5 & 8 (排风): 加极端离群值 (模拟空调热风)
    temp = base_temp + np.random.normal(0, 0.3, n)
    for i in range(n // 300):  # 每 5 分钟一次极端事件
        idx = np.random.randint(0, n)
        temp[idx] += np.random.uniform(8, 15)
    datasets[5] = pd.DataFrame({'temp_c': temp, 'humidity_pct': 50 + np.random.normal(0, 2, n)}, index=t)

    # LCZ A & G (森林/湖泊): 加白噪声 (平滑信号 + 小噪声)
    temp = base_temp - 2 + np.random.normal(0, 0.05, n)
    datasets[11] = pd.DataFrame({'temp_c': temp, 'humidity_pct': 70 + np.random.normal(0, 1, n)}, index=t)

    # LCZ B & C (过渡带): 两种过程叠加 (日照升温 + 阵风降温)
    temp = base_temp + 1 + np.random.normal(0, 0.3, n)
    for i in range(n // 180):  # 每 3 分钟一阵风
        idx = np.random.randint(0, n)
        dur = min(30, n - idx)
        temp[idx:idx+dur] -= np.linspace(0, 2, dur) * np.random.uniform(0.5, 1.5)
    datasets[12] = pd.DataFrame({'temp_c': temp, 'humidity_pct': 55 + np.random.normal(0, 2, n)}, index=t)

    # LCZ D (操场): 加辐射加热偏移 (常量偏移模拟日晒)
    temp = base_temp + 3 + np.random.normal(0, 0.15, n)
    datasets[14] = pd.DataFrame({'temp_c': temp, 'humidity_pct': 40 + np.random.normal(0, 1, n)}, index=t)

    return datasets


def plot_before_after(lcz: int, df: pd.DataFrame, algo_name: str, ax):
    """绘制 before/after 对比"""
    # 只取温度列
    raw = df['temp_c'].values
    clean = df['temp_cleaned'].values

    # 降采样 (太多点看不清)
    step = max(1, len(raw) // 500)
    x = np.arange(len(raw))[::step]

    ax.plot(x, raw[::step], alpha=0.4, linewidth=0.5, color='gray', label='Raw')
    line = ax.plot(x, clean[::step], alpha=0.9, linewidth=1.2, color='#2196F3', label='Cleaned')
    ax.set_title(f'LCZ {lcz} — {algo_name}', fontsize=11)
    ax.legend(fontsize=8)
    ax.set_ylabel('Temp (°C)')
    ax.set_xlabel('Sample #')


def main():
    print("=" * 60)
    print("Sensor Processing — Algorithm Demo")
    print("=" * 60)

    datasets = generate_sample_data(minutes=30, freq='1s')  # 30 分钟更快

    # 创建输出目录
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'output', 'before_after')
    os.makedirs(out_dir, exist_ok=True)

    fig, axes = plt.subplots(3, 2, figsize=(16, 12))
    axes = axes.flatten()

    for idx, (lcz, df_raw) in enumerate(datasets.items()):
        print(f"\n--- LCZ {lcz} ({len(df_raw)} rows) ---")
        try:
            df_clean = process_dataframe(df_raw, lcz)
            algo = df_clean['algo'].iloc[0]
            print(f"  Algo: {algo}")
            print(f"  Raw  mean: {df_raw['temp_c'].mean():.2f}  std: {df_raw['temp_c'].std():.2f}")
            print(f"  Clean mean: {df_clean['temp_cleaned'].mean():.2f}  std: {df_clean['temp_cleaned'].std():.2f}")

            plot_before_after(lcz, df_clean, algo, axes[idx])
        except Exception as e:
            print(f"  FAIL: {e}")
            axes[idx].text(0.5, 0.5, f'LCZ {lcz}\nFAIL: {e}',
                           ha='center', va='center', fontsize=10, transform=axes[idx].transAxes)

    # 最后一个 subplot 空着
    axes[-1].axis('off')

    plt.tight_layout()
    out_path = os.path.join(out_dir, 'all_algorithms_comparison.png')
    plt.savefig(out_path, dpi=120, bbox_inches='tight')
    print(f"\nSaved: {out_path}")
    plt.close()

    # 也存一份 CSV
    for lcz, df in datasets.items():
        csv_path = os.path.join(out_dir, f'demo_lcz{lcz}.csv')
        df.to_csv(csv_path)
        print(f"Saved: {csv_path}")


if __name__ == '__main__':
    main()
