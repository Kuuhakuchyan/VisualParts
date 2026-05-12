"""
Google Earth Engine 数据处理包
用于城市微气候决策支持系统的遥感数据获取与处理

主要模块:
  config   — GEE 配置、项目ID、研究区、波段映射
  fetcher  — 影像检索、云掩膜、NDVI/LST/反照率计算、LCZ分类
  auth     — GEE 认证助手
  demo     — 交互式使用示例 (Jupyter兼容)
  zhengzhou_map — 郑州市区 LCZ 分类制图
  campus_map    — 郑州大学校园 LCZ 精细分类
"""

from gee.config import (
    initialize_gee, get_gee_project_id, get_study_region,
    STUDY_AREA, GEE_DATA_DIR, LANDSAT_COLLECTIONS, BAND_MAP_L8,
)
from gee.fetcher import GEEFetcher
