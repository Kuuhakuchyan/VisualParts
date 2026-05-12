"""
传感器数据处理 — 主调度器

按传感器 LCZ 类型路由到对应算法, 支持:
  - 单文件处理: process_sensor_file()
  - 批量处理:   process_sensors_batch()
  - DataFrame:  process_dataframe()
"""

import importlib
import pandas as pd
from typing import Union
from pathlib import Path

from .config import LCZ_ALGO_MAP, DEFAULT_ALGO, DATA, LCZ_NAMES
from .utils import read_sensor_csv, check_data_quality


def _get_algo(lcz_type: int):
    """根据 LCZ 类型加载对应算法模块"""
    algo_name = LCZ_ALGO_MAP.get(lcz_type, DEFAULT_ALGO)
    try:
        mod = importlib.import_module(f'sensor_processing.{algo_name}.{algo_name}')
        return mod.process, algo_name
    except ImportError as e:
        raise ImportError(
            f"Failed to load algorithm '{algo_name}' for LCZ {lcz_type}. "
            f"Make sure {algo_name}/__init__.py and {algo_name}/{algo_name}.py exist. "
            f"Error: {e}"
        )


def process_dataframe(df: pd.DataFrame, lcz_type: int, **kwargs) -> pd.DataFrame:
    """
    对 DataFrame 执行 LCZ 类型对应的算法

    Args:
        df: 必须包含 ['temp_c', 'humidity_pct'] 列
        lcz_type: LCZ 整数编码 (2,5,8,11-14,17)
        **kwargs: 覆盖 config.py 中的算法参数

    Returns:
        df, 新增 'temp_cleaned' 列 + 'algo' 列标记使用的算法
    """
    # 质量检查
    quality = check_data_quality(df, DATA['max_nan_gap'])
    if not quality['ok']:
        print(f"WARN: Data quality issue — {quality}")

    # 路由算法
    process_fn, algo_name = _get_algo(lcz_type)
    lcz_name = LCZ_NAMES.get(lcz_type, f'LCZ{lcz_type}')

    print(f"Processing LCZ {lcz_type} ({lcz_name}) → {algo_name}")
    result = process_fn(df, **kwargs)

    # 标记
    result['algo'] = algo_name
    result['lcz_type'] = lcz_type

    # 确保返回值有 temp_cleaned
    if DATA['output_col'] not in result.columns:
        # 算法未添加 cleaned 列 → 回退到原始值
        result[DATA['output_col']] = result['temp_c'].astype(float)

    return result


def process_sensor_file(csv_path: Union[str, Path], sensor_lcz: int, **kwargs) -> pd.DataFrame:
    """
    读取传感器 CSV 文件 → 按 LCZ 类型调用对应算法 → 返回清洗后 DataFrame

    Args:
        csv_path: CSV 文件路径
        sensor_lcz: 该传感器部署位置的 LCZ 类型
        **kwargs: 算法参数覆盖
    """
    df = read_sensor_csv(str(csv_path))
    return process_dataframe(df, sensor_lcz, **kwargs)


def process_sensors_batch(sensor_list: list, **kwargs) -> dict:
    """
    批量处理多个传感器

    Args:
        sensor_list: [{'path': 'sensor_01.csv', 'lcz': 2, 'id': 'm5stick_01'}, ...]
        **kwargs: 算法参数覆盖

    Returns:
        {sensor_id: DataFrame, ...}
    """
    results = {}
    for item in sensor_list:
        sid = item.get('id', item['path'])
        lcz = item['lcz']
        print(f"\n--- Sensor: {sid} (LCZ {lcz}) ---")
        try:
            df = process_sensor_file(item['path'], lcz, **kwargs)
            results[sid] = df
            print(f"  OK: {len(df)} rows, columns: {list(df.columns)}")
        except Exception as e:
            print(f"  FAIL: {e}")
    return results
