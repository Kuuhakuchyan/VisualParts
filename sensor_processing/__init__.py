"""
传感器数据处理子模块

用法:
    from sensor_processing import process_sensor_file, process_dataframe

    # 处理单个 CSV 文件
    df = process_sensor_file("sensor_01.csv", sensor_lcz=2)

    # 批量处理
    results = process_sensors_batch([
        {'path': 'sensor_01.csv', 'lcz': 2},
        {'path': 'sensor_02.csv', 'lcz': 11},
    ])

    # 直接传 DataFrame
    df_clean = process_dataframe(df, lcz_type=5)
"""

from .pipeline import process_sensor_file, process_sensors_batch, process_dataframe

__all__ = ['process_sensor_file', 'process_sensors_batch', 'process_dataframe']
