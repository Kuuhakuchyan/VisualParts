"""
LCZ分类系统 — 配置文件
基于 Stewart & Oke (2012) Local Climate Zones 标准
参考: Pan et al. (2025) Atmosphere; Sütçüoğlu & Kalaycı (2025) Scientific Reports
"""

from pathlib import Path

# ========================
# 路径配置
# ========================
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "output"
LCZ_CLASSIFIED_DIR = OUTPUT_DIR / "lcz_classified"
LCZ_PARAMS_DIR = OUTPUT_DIR / "lcz_params"
LCZ_VIS_DIR = OUTPUT_DIR / "lcz_visualization"

for d in [OUTPUT_DIR, LCZ_CLASSIFIED_DIR, LCZ_PARAMS_DIR, LCZ_VIS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ========================
# LCZ分类标准 (Stewart & Oke, 2012)
# ========================
LCZ_NAMES = {
    # Built Types (1-10)
    1: "密集高层建筑 (Compact High-rise)",
    2: "密集中低建筑 (Compact Mid-rise)",
    3: "密集中低层建筑 (Compact Low-rise)",
    4: "开阔高层建筑 (Open High-rise)",
    5: "开阔中低层建筑 (Open Mid-rise)",
    6: "开阔低层建筑 (Open Low-rise)",
    7: "低矮密集建筑 (Lightweight Low-rise)",
    8: "大型低层建筑 (Large Low-rise)",
    9: "稀疏建筑 (Sparsely Built)",
    10: "重工业建筑 (Heavy Industry)",
    # Natural Types (A-G)
    "A": "密林 (Dense Trees)",
    "B": "稀疏树木 (Scattered Trees)",
    "C": "矮树/灌木 (Bush/Scrub)",
    "D": "低矮植被 (Low Plants)",
    "E": "裸土/硬化地面 (Bare Rock or Paved)",
    "F": "裸土/沙砾 (Bare Soil or Sand)",
    "G": "水体 (Water)",
}

# LCZ 颜色 (用于Cesium地图渲染)
LCZ_COLORS = {
    1: "#8B0000",   # 深红 - 密集高层
    2: "#CD5C5C",   # 印度红 - 密集中低
    3: "#E9967A",   # 暗肉色 - 密集中低层
    4: "#FFA500",   # 橙色 - 开阔高层
    5: "#FFD700",   # 金色 - 开阔中低层
    6: "#ADFF2F",   # 黄绿色 - 开阔低层
    7: "#808080",   # 灰色 - 低矮密集
    8: "#A9A9A9",   # 深灰 - 大型低层
    9: "#D3D3D3",   # 浅灰 - 稀疏建筑
    10: "#4B0082",   # 靛蓝 - 重工业
    "A": "#006400",  # 深绿 - 密林
    "B": "#228B22",  # 森林绿 - 稀疏树木
    "C": "#32CD32",  # 酸橙绿 - 矮树/灌木
    "D": "#90EE90",  # 浅绿 - 低矮植被
    "E": "#D2691E",  # 巧克力色 - 裸土/硬化
    "F": "#DEB887",  # 浅棕 - 裸土/沙砾
    "G": "#1E90FF",  # 道奇蓝 - 水体
}

# Built Types 分类阈值 (Stewart & Oke, 2012)
# 用于从建筑参数推导LCZ类别
LCZ_BUILT_THRESHOLDS = {
    # (建筑高度上限, 建筑密度下限, 不透水率下限)
    # key: (H_max, building_frac_min, impervious_frac_min)
    # 对应关系:
    "height_thresholds": {
        1: (999, 0.40, 0.90),   # LCZ 1: 密集高层
        2: (25, 0.40, 0.90),    # LCZ 2: 密集中低
        3: (10, 0.40, 0.90),    # LCZ 3: 密集中低层
        4: (999, 0.20, 0.40),   # LCZ 4: 开阔高层
        5: (25, 0.20, 0.40),    # LCZ 5: 开阔中低层
        6: (10, 0.20, 0.40),    # LCZ 6: 开阔低层
        7: (10, 0.20, 0.90),    # LCZ 7: 低矮密集
        8: (10, 0.20, 0.90),    # LCZ 8: 大型低层
        9: (10, 0.10, 0.40),    # LCZ 9: 稀疏建筑
        10: (999, 0.20, 0.90),   # LCZ 10: 重工业
    },
    # SVF 阈值 (天空可视度)
    "svf_thresholds": {
        1: (0, 0.35),    # 峡谷型 SVF 低
        2: (0, 0.45),
        3: (0, 0.55),
        4: (0.50, 1.0),  # 开阔型 SVF 高
        5: (0.50, 1.0),
        6: (0.50, 1.0),
        7: (0, 1.0),
        8: (0, 1.0),
        9: (0.50, 1.0),
        10: (0, 1.0),
    }
}

# Natural Types 分类阈值
LCZ_NATURAL_THRESHOLDS = {
    "A": {"ndvi_min": 0.6, "tree_frac_min": 0.5},
    "B": {"ndvi_min": 0.3, "tree_frac_min": 0.15},
    "C": {"ndvi_min": 0.2, "tree_frac_min": 0.05},
    "D": {"ndvi_min": 0.1, "tree_frac_min": 0.0},   # 草地
    "E": {"ndvi_min": 0.0, "impervious_frac_min": 0.9},
    "F": {"ndvi_min": 0.0, "impervious_frac_min": 0.0},  # 裸土
    "G": {"ndvi_min": 0.0, "water_frac_min": 0.9},
}

# ========================
# SMW算法参数 (统计单窗算法)
# QIN Zhihao et al. (2001) IEEE TGRS
# ========================
# Landsat Band 10 热红外通道的典型参数
# 实际使用时需从卫星元数据文件(MTL.txt)读取
SWM_PARAMS_L8_BAND10 = {
    # 郑州地区(34°N) 夏季典型大气透过率区间 [0.6, 0.85]
    "a": -67.355351,   # 系数 A
    "b": 0.458606,     # 系数 B
    # 热通道增益/偏移
    "gain": 0.0003342,  # 辐射亮度增益 (W/(m2·sr·μm))
    "offset": 0.1,      # 辐射亮度偏移
    # 地表比辐射率默认值 (可根据下垫面调整)
    "default_emissivity": 0.95,
    # 大气透过率默认值 (晴空)
    "default_transmissivity": 0.75,
}

# ========================
# 随机森林分类器参数
# ========================
RF_PARAMS = {
    "n_estimators": 100,
    "max_depth": 15,
    "min_samples_split": 5,
    "min_samples_leaf": 2,
    "class_weight": "balanced",
    "random_state": 42,
    "test_size": 0.3,    # 7:3 训练/测试划分
    "cv_folds": 5,
}

# ========================
# 网格参数
# ========================
GRID_SIZE_METERS = 100     # 100m x 100m 网格 (1 ha)
CRS = "EPSG:4326"          # WGS84 经纬度坐标系

# ========================
# 训练样本数量 (每类最低)
# ========================
MIN_SAMPLES_PER_CLASS = 20

# ========================
# 研究区边界 (郑州大学主校区示例)
# 实际使用时从GeoJSON文件读取
# ========================
CAMPUS_BOUNDS = {
    "min_lon": 113.5250,
    "max_lon": 113.5450,
    "min_lat": 34.8100,
    "max_lat": 34.8250,
}
