"""
Google Earth Engine (GEE) 配置模块
用于城市微气候决策支持系统的遥感数据获取与处理

提供: Landsat影像获取、LST反演、NDVI计算、LCZ参数提取
"""

import ee
import os
from pathlib import Path
from typing import Optional

# ========================
# 基础路径配置
# ========================
BASE_DIR = Path(__file__).parent.parent   # 指向 Data_prcessing/
GEE_DATA_DIR = BASE_DIR / "gee" / "data"
GEE_CACHE_DIR = GEE_DATA_DIR / "cache"

for d in [GEE_DATA_DIR, GEE_CACHE_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ========================
# 研究区范围 (郑州大学主校区)
# ========================
STUDY_AREA = {
    "min_lon": 113.5250,
    "max_lon": 113.5450,
    "min_lat": 34.8100,
    "max_lat": 34.8250,
}

# ========================
# Landsat集合ID
# ========================
LANDSAT_COLLECTIONS = {
    "L8_SR": "LANDSAT/LC08/C02/T1_L2",       # Landsat 8 SR (30m)
    "L9_SR": "LANDSAT/LC09/C02/T1_L2",       # Landsat 9 SR (30m)
    "L8_TOA": "LANDSAT/LC08/C02/T1_TOA",     # Landsat 8 TOA
    "L9_TOA": "LANDSAT/LC09/C02/T1_TOA",     # Landsat 9 TOA
}

# SRTM 数字高程模型
SRTM_COLLECTION = "USGS/SRTMGL1_003"

# ========================
# Landsat波段映射 (C02 L2)
# ========================
BAND_MAP_L8 = {
    "BLUE": "SR_B2",      # 0.45-0.51 μm, 30m
    "GREEN": "SR_B3",     # 0.53-0.59 μm, 30m
    "RED": "SR_B4",       # 0.64-0.67 μm, 30m
    "NIR": "SR_B5",       # 0.85-0.88 μm, 30m
    "SWIR1": "SR_B6",     # 1.57-1.65 μm, 30m
    "SWIR2": "SR_B7",     # 2.11-2.29 μm, 30m
    "TIR": "ST_B10",      # 10.6-11.19 μm, 100m (LST)
    "QA_PIXEL": "QA_PIXEL",
}

# ========================
# LCZ分类所需的遥感参数
# ========================
LCZ_PARAMETERS = {
    "ndvi": {"min": -1, "max": 1},       # 归一化植被指数
    "ndbi": {"min": -1, "max": 1},       # 归一化建筑指数
    "mndwi": {"min": -1, "max": 1},      # 归一化水体指数
    "albedo": {"min": 0, "max": 1},      # 地表反照率
    "lst": {"min": 20, "max": 50},       # 地表温度 (°C)
}

# ========================
# LCZ随机森林分类参数 (Pan et al., 2025)
# ========================
LCZ_RF_PARAMS = {
    "numberOfTrees": 100,
    "bagFraction": 0.5,
    "maxNodes": None,
    "minLeafPopulation": 1,
}

# ========================
# 云过滤参数
# ========================
CLOUD_FILTER = {
    "max_cloud_percent": 20,      # 最大云量百分比
    "date_range_months": 3,       # 影像检索时间窗口（月）
    "month_start": 6,             # 起始月份 (6月)
    "month_end": 9,               # 结束月份 (9月)
}


def load_env_file() -> dict:
    """从 .env 文件加载配置 (无需python-dotenv)"""
    env_path = BASE_DIR / ".env"
    env_vars = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                env_vars[key.strip()] = val.strip().strip("\"'")
    return env_vars


def get_gee_project_id() -> Optional[str]:
    """获取GEE项目ID (优先级: 参数 > 环境变量 > .env文件)"""
    env = load_env_file()
    return os.environ.get("GEE_PROJECT_ID") or env.get("GEE_PROJECT_ID")


def initialize_gee(project_id: Optional[str] = None) -> bool:
    """
    初始化 GEE API。
    首次使用需先运行 `earthengine authenticate` 完成认证。

    Args:
        project_id: GEE项目ID (可选, 默认从环境变量或.env文件读取)

    Returns:
        是否初始化成功
    """
    try:
        pid = project_id or get_gee_project_id()
        if pid:
            ee.Initialize(project=pid)
        else:
            ee.Initialize()
        print(f"[GEE] 初始化成功 | 研究区: {STUDY_AREA}")
        return True
    except ee.EEException as e:
        print(f"[GEE] 初始化失败: {e}")
        print()
        if "project" in str(e):
            print("需指定 Google Cloud 项目ID。操作步骤:")
            print("  1. 打开 https://code.earthengine.google.com")
            print("  2. 用 Google 账号登录/注册")
            print("  3. 创建项目或使用已有项目")
            print("  4. 项目ID格式类似: ee-xxxxxxxxxxxxxxxx")
            print()
            print("找到项目ID后:")
            print('  方式A: 在终端运行 (每次):')
            print('    export GEE_PROJECT_ID="你的项目ID"')
            print()
            print('  方式B: 创建 Data_prcessing/.env 文件 (永久):')
            print('    GEE_PROJECT_ID="你的项目ID"')
            print()
            print('  方式C: 修改代码调用 (临时):')
            print('    initialize_gee(project_id="你的项目ID")')
        else:
            print("[GEE] 请先运行以下命令完成认证:")
            print("    earthengine authenticate")
            print("    然后在 https://code.earthengine.google.com 注册账号")
        return False
    except Exception as e:
        print(f"[GEE] 未知错误: {e}")
        return False


def get_study_region() -> ee.Geometry:
    """获取研究区几何边界 (郑州大学主校区)"""
    return ee.Geometry.Rectangle(
        [STUDY_AREA["min_lon"], STUDY_AREA["min_lat"],
         STUDY_AREA["max_lon"], STUDY_AREA["max_lat"]]
    )


def get_date_range(months_back: int = CLOUD_FILTER["date_range_months"]) -> tuple:
    """获取影像时间范围 (默认: 最近3个月)"""
    import datetime
    end = datetime.date.today()
    start = end - datetime.timedelta(days=months_back * 30)
    return start.isoformat(), end.isoformat()


if __name__ == "__main__":
    # 测试GEE连接
    if initialize_gee():
        region = get_study_region()
        area_km2 = region.area().getInfo() / 1e6
        print(f"研究区面积: {area_km2:.2f} km²")
    else:
        print("GEE初始化失败，请先完成认证")
