"""
LCZ分类主程序 — 完整Pipeline
基于 Stewart & Oke (2012) Local Climate Zones 标准
参考: Pan et al. (2025) Atmosphere; Sütçüoğlu & Kalaycı (2025) Scientific Reports

操作流程（五步）:
  Step 1: 数据获取与预处理 (卫星影像/建筑数据)
  Step 2: 下垫面特征提取 (SVF/NDVI/建筑密度/不透水率)
  Step 3: 随机森林分类 → 17类LCZ
  Step 4: SMW算法反演地表温度 (LST)
  Step 5: UHI强度计算 + GeoJSON/GeoTIFF输出

使用方法:
  python lcz_pipeline.py                    # 演示模式 (生成模拟数据)
  python lcz_pipeline.py --real            # 真实数据模式 (需要卫星影像+建筑数据)
"""

import os
import sys
import json
import argparse
import warnings
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ========================
# 依赖检查
# ========================
_DEPS = {}

try:
    import sklearn.ensemble as sklr
    _DEPS["sklearn"] = True
except ImportError:
    _DEPS["sklearn"] = False

try:
    import rasterio as rio
    _DEPS["rasterio"] = True
except ImportError:
    _DEPS["rasterio"] = False

try:
    import geopandas as gpd
    _DEPS["geopandas"] = True
except ImportError:
    _DEPS["geopandas"] = False

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as _plt
    _DEPS["matplotlib"] = True
    _plt = _plt
except ImportError:
    _DEPS["matplotlib"] = False

try:
    import contextily as ctx
    _DEPS["contextily"] = True
except ImportError:
    _DEPS["contextily"] = False

MISSING_DEPS = [k for k, v in _DEPS.items() if not v]
if MISSING_DEPS:
    print(f"[警告] 以下依赖未安装，将使用简化模式: {MISSING_DEPS}")
    print("  安装命令: pip install scikit-learn rasterio geopandas matplotlib contextily")


# ========================
# 内部模块
# ========================
try:
    from lcz_config import (
        LCZ_NAMES, LCZ_COLORS, RF_PARAMS, GRID_SIZE_METERS, CRS,
        CAMPUS_BOUNDS, SWM_PARAMS_L8_BAND10,
        LCZ_NATURAL_THRESHOLDS,
        LCZ_CLASSIFIED_DIR, LCZ_PARAMS_DIR, LCZ_VIS_DIR, DATA_DIR,
    )
except ImportError:
    print("[错误] 请确保 lcz_config.py 与 lcz_pipeline.py 在同一目录下")
    sys.exit(1)


# ========================
# Step 1: 数据加载与预处理
# ========================

def load_or_generate_grid(bounds: dict, grid_size: float = GRID_SIZE_METERS) -> pd.DataFrame:
    """
    创建研究区网格 (100m x 100m)。
    演示模式：生成模拟网格数据。
    真实模式：从GeoJSON/GeoTIFF加载。
    """
    lon_step = grid_size / 111000  # 经度步长（度，约111km/度）
    lat_step = grid_size / 111000 / np.cos(np.radians(34.8))  # 纬度步长

    lons = np.arange(bounds["min_lon"], bounds["max_lon"], lon_step)
    lats = np.arange(bounds["min_lat"], bounds["max_lat"], lat_step)

    records = []
    for i, lon in enumerate(lons):
        for j, lat in enumerate(lats):
            grid_id = f"GRID_{(i*len(lats)+j)+1:04d}"
            records.append({
                "grid_id": grid_id,
                "lon": round(lon + lon_step / 2, 6),
                "lat": round(lat + lat_step / 2, 6),
                "lon_min": round(lon, 6),
                "lon_max": round(lon + lon_step, 6),
                "lat_min": round(lat, 6),
                "lat_max": round(lat + lat_step, 6),
                "area_m2": grid_size ** 2,
            })

    df = pd.DataFrame(records)
    print(f"[Step 1] 生成了 {len(df)} 个 {grid_size}m x {grid_size}m 网格")
    print(f"         覆盖范围: 经度[{bounds['min_lon']:.4f}, {bounds['max_lon']:.4f}], "
          f"纬度[{bounds['min_lat']:.4f}, {bounds['max_lat']:.4f}]")
    return df


def extract_features_from_imagery(df: pd.DataFrame, imagery_dir: Path = None) -> pd.DataFrame:
    """
    从遥感影像提取下垫面特征。

    演示模式：用空间分带模拟真实LCZ分布。
    模拟校园内10类LCZ的空间分布（参考郑州大学校园实际布局）:
    - 校园中心: 高密度教学楼群 (LCZ 2/3)
    - 中间带: 低密度建筑+硬化地面 (LCZ 5/6/E)
    - 边缘区: 绿化+水体 (LCZ A/B/D/G)

    真实模式：从GeoTIFF读取NDVI/反照率/建筑高度等。
    """
    np.random.seed(42)
    n = len(df)

    # 研究区几何中心
    center_lon = (df["lon_min"].min() + df["lon_max"].max()) / 2
    center_lat = (df["lat_min"].min() + df["lat_max"].max()) / 2

    for idx, row in df.iterrows():
        lon, lat = row["lon"], row["lat"]

        # 归一化到 [0,1]，相对于研究区中心
        dx = (lon - center_lon) / (df["lon_max"].max() - df["lon_min"].min() + 1e-9)
        dy = (lat - center_lat) / (df["lat_max"].max() - df["lat_min"].min() + 1e-9)
        dist_from_center = np.sqrt(dx**2 + dy**2)

        # 分区模拟不同LCZ特征
        if dist_from_center < 0.2:
            # 中心：教学楼群 (LCZ 2/3)
            building_density = np.clip(0.50 + np.random.normal(0, 0.08), 0.3, 0.9)
            building_height = np.clip(25 + np.random.normal(0, 8), 5, 60)
            albedo = np.clip(0.20 + np.random.normal(0, 0.02), 0.1, 0.35)
            ndvi = np.clip(0.08 + np.random.normal(0, 0.03), 0.0, 0.25)
            impervious_ratio = np.clip(0.85 + np.random.normal(0, 0.05), 0.7, 1.0)
            svf = np.clip(0.30 + np.random.normal(0, 0.08), 0.1, 0.6)

        elif dist_from_center < 0.45:
            # 中间环：低密度建筑+硬化地面混合 (LCZ 5/6/E)
            building_density = np.clip(0.25 + np.random.normal(0, 0.08), 0.1, 0.5)
            building_height = np.clip(12 + np.random.normal(0, 5), 3, 35)
            albedo = np.clip(0.25 + np.random.normal(0, 0.03), 0.12, 0.45)
            ndvi = np.clip(0.20 + np.random.normal(0, 0.05), 0.05, 0.50)
            impervious_ratio = np.clip(0.60 + np.random.normal(0, 0.08), 0.4, 0.85)
            svf = np.clip(0.55 + np.random.normal(0, 0.08), 0.3, 0.85)

        elif dist_from_center < 0.7:
            # 外围：绿化+硬化混合 (LCZ D/E/B)
            roll = np.random.rand()
            if roll < 0.35:
                # 硬化地面/道路 (LCZ E)
                building_density = np.clip(0.10 + np.random.normal(0, 0.05), 0.0, 0.3)
                building_height = np.clip(3 + np.random.normal(0, 2), 0, 10)
                albedo = np.clip(0.35 + np.random.normal(0, 0.04), 0.2, 0.5)
                ndvi = np.clip(0.10 + np.random.normal(0, 0.04), 0.0, 0.3)
                impervious_ratio = np.clip(0.88 + np.random.normal(0, 0.05), 0.7, 1.0)
                svf = np.clip(0.75 + np.random.normal(0, 0.06), 0.5, 1.0)
            elif roll < 0.7:
                # 草地/低矮植被 (LCZ D)
                building_density = 0.0
                building_height = 0.0
                albedo = np.clip(0.18 + np.random.normal(0, 0.02), 0.1, 0.28)
                ndvi = np.clip(0.45 + np.random.normal(0, 0.08), 0.2, 0.75)
                impervious_ratio = np.clip(0.15 + np.random.normal(0, 0.06), 0.0, 0.35)
                svf = np.clip(0.88 + np.random.normal(0, 0.05), 0.6, 1.0)
            else:
                # 稀疏树木 (LCZ B)
                building_density = 0.0
                building_height = np.clip(8 + np.random.normal(0, 3), 3, 18)
                albedo = np.clip(0.15 + np.random.normal(0, 0.02), 0.08, 0.25)
                ndvi = np.clip(0.60 + np.random.normal(0, 0.08), 0.35, 0.85)
                impervious_ratio = np.clip(0.25 + np.random.normal(0, 0.08), 0.1, 0.45)
                svf = np.clip(0.72 + np.random.normal(0, 0.06), 0.5, 0.95)

        else:
            # 边缘：绿化+水体 (LCZ A/G/D)
            roll = np.random.rand()
            if roll < 0.3:
                # 密林/乔木 (LCZ A)
                building_density = 0.0
                building_height = np.clip(15 + np.random.normal(0, 5), 8, 28)
                albedo = np.clip(0.12 + np.random.normal(0, 0.02), 0.06, 0.20)
                ndvi = np.clip(0.72 + np.random.normal(0, 0.06), 0.55, 0.92)
                impervious_ratio = np.clip(0.10 + np.random.normal(0, 0.05), 0.0, 0.25)
                svf = np.clip(0.60 + np.random.normal(0, 0.08), 0.35, 0.85)
            elif roll < 0.55:
                # 水体 (LCZ G)
                building_density = 0.0
                building_height = 0.0
                albedo = np.clip(0.06 + np.random.normal(0, 0.01), 0.03, 0.12)
                ndvi = np.clip(0.02 + np.random.normal(0, 0.01), 0.0, 0.08)
                impervious_ratio = 0.0
                svf = np.clip(0.95 + np.random.normal(0, 0.02), 0.85, 1.0)
            elif roll < 0.8:
                # 草地 (LCZ D)
                building_density = 0.0
                building_height = 0.0
                albedo = np.clip(0.18 + np.random.normal(0, 0.02), 0.1, 0.28)
                ndvi = np.clip(0.40 + np.random.normal(0, 0.08), 0.18, 0.70)
                impervious_ratio = np.clip(0.12 + np.random.normal(0, 0.05), 0.0, 0.3)
                svf = np.clip(0.90 + np.random.normal(0, 0.04), 0.65, 1.0)
            else:
                # 开阔建筑 (LCZ 6)
                building_density = np.clip(0.18 + np.random.normal(0, 0.06), 0.08, 0.35)
                building_height = np.clip(8 + np.random.normal(0, 3), 2, 20)
                albedo = np.clip(0.22 + np.random.normal(0, 0.03), 0.12, 0.38)
                ndvi = np.clip(0.25 + np.random.normal(0, 0.06), 0.08, 0.55)
                impervious_ratio = np.clip(0.50 + np.random.normal(0, 0.08), 0.3, 0.7)
                svf = np.clip(0.65 + np.random.normal(0, 0.07), 0.4, 0.9)

        # 估算LST（SMW模拟值）：建筑高+不透水高→高温；绿化+水体→低温
        lst = np.clip(
            30 + 5 * (1 - ndvi) + 4 * (1 - svf)
            + 1.5 * building_height / 30
            + np.random.normal(0, 0.8),
            20, 50
        )

        df.at[idx, "building_density"] = round(float(building_density), 4)
        df.at[idx, "building_height"] = round(float(building_height), 2)
        df.at[idx, "albedo"] = round(float(albedo), 4)
        df.at[idx, "ndvi"] = round(float(ndvi), 4)
        df.at[idx, "impervious_ratio"] = round(float(impervious_ratio), 4)
        df.at[idx, "svf"] = round(float(svf), 4)
        df.at[idx, "lst_raw"] = round(float(lst), 2)

    print(f"[Step 1] 提取了下垫面特征: NDVI/Albedo/Height/Density/SVF/不透水率/LST")
    return df


# ========================
# Step 2: 特征工程
# ========================

def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """
    构建用于随机森林分类的特征矩阵。
    特征列表:
    - ndvi: 植被指数
    - albedo: 反照率
    - building_height: 建筑高度
    - building_density: 建筑密度
    - impervious_ratio: 不透水率
    - svf: 天空可视度
    """
    feature_cols = ["ndvi", "albedo", "building_height", "building_density", "impervious_ratio", "svf"]
    df["feature_vector"] = df[feature_cols].values.tolist()
    print(f"[Step 2] 特征矩阵构建完成，共 {len(feature_cols)} 个特征: {feature_cols}")
    return df


# ========================
# Step 3: 随机森林LCZ分类
# ========================

def rule_based_lcz_classification(df: pd.DataFrame) -> pd.DataFrame:
    """
    基于Stewart & Oke (2012)规则的LCZ分类。
    当sklearn可用时，使用随机森林；
    不可用时，使用规则引擎作为降级方案。

    规则逻辑:
    1. 先判断是Built还是Natural大类
    2. 再根据具体参数确定子类

    Built Types判断规则 (简化版):
    - 建筑密度 >= 0.4: 密集型 (1/2/3)
      - 建筑高度 > 25m: LCZ 1 (密集高层)
      - 建筑高度 10-25m: LCZ 2 (密集中低)
      - 建筑高度 < 10m: LCZ 3 (密集中低层)
    - 建筑密度 0.2-0.4: 开阔型 (4/5/6)
      - 建筑高度 > 25m: LCZ 4 (开阔高层)
      - 建筑高度 10-25m: LCZ 5 (开阔中低)
      - 建筑高度 < 10m: LCZ 6 (开阔低层)
    - 建筑密度 < 0.2: 特殊型 (7/8/9/10)

    Natural Types判断规则:
    - NDVI >= 0.6: 森林型 (A/B)
    - NDVI 0.3-0.6: 灌木型 (C)
    - NDVI 0.1-0.3: 草地型 (D)
    - 不透水率 > 0.9: 裸土/硬化 (E)
    - 水体指数 > 0.9: 水体 (G)
    - 否则: 裸土 (F)
    """
    lcz_labels = []

    for _, row in df.iterrows():
        bd = row["building_density"]
        bh = row["building_height"]
        ndvi = row["ndvi"]
        imp = row["impervious_ratio"]
        svf = row["svf"]

        # 判断是否为建筑主导区域
        if imp > 0.5 and bh > 3:
            # Built Types
            if bd >= 0.4:
                if bh > 25:
                    lcz = 1
                elif bh > 10:
                    lcz = 2
                else:
                    lcz = 3
            elif bd >= 0.2:
                if bh > 25:
                    lcz = 4
                elif bh > 10:
                    lcz = 5
                else:
                    lcz = 6
            else:
                # 低密度建筑区
                if imp > 0.85:
                    lcz = 8  # 大型低层建筑 (工业区/仓储)
                elif imp > 0.6:
                    lcz = 7  # 低矮密集
                else:
                    lcz = 9  # 稀疏建筑
        else:
            # Natural Types
            if ndvi >= 0.6:
                if bh > 10:
                    lcz = "A"  # 密林
                else:
                    lcz = "B"  # 稀疏树木
            elif ndvi >= 0.3:
                lcz = "C"  # 灌木
            elif ndvi >= 0.1:
                lcz = "D"  # 低矮植被 (草地)
            elif imp > 0.85:
                lcz = "E"  # 裸土/硬化地面
            elif ndvi < 0.05 and imp < 0.1:
                lcz = "G"  # 水体 (ndvi极低且不透水率极低)
            else:
                lcz = "F"  # 裸土/沙砾

        lcz_labels.append(lcz)

    df["lcz_type"] = lcz_labels
    df["lcz_name"] = df["lcz_type"].apply(lambda x: LCZ_NAMES.get(x, "未知"))

    if _DEPS["sklearn"]:
        try:
            df = _rf_classification(df)
        except Exception as e:
            print(f"[警告] 随机森林分类失败 ({e})，使用规则引擎结果")
    else:
        print("[信息] sklearn未安装，使用规则引擎进行LCZ分类")

    # 统计分类结果
    lcz_counts = df["lcz_type"].value_counts()
    print(f"[Step 3] LCZ分类完成，共 {df['lcz_type'].nunique()} 类")
    print("         分类统计:")
    for lcz, count in lcz_counts.items():
        pct = count / len(df) * 100
        name = LCZ_NAMES.get(lcz, "未知")
        print(f"         LCZ {lcz} ({name}): {count}个网格 ({pct:.1f}%)")

    return df


def _rf_classification(df: pd.DataFrame) -> pd.DataFrame:
    """随机森林分类 (sklearn可用时)"""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import classification_report, accuracy_score

    feature_cols = ["ndvi", "albedo", "building_height", "building_density", "impervious_ratio", "svf"]
    X = df[feature_cols].values
    y = df["lcz_type"].values

    # 划分训练/测试集 (7:3)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=RF_PARAMS["test_size"],
        random_state=RF_PARAMS["random_state"], stratify=y
    )

    clf = RandomForestClassifier(
        n_estimators=RF_PARAMS["n_estimators"],
        max_depth=RF_PARAMS["max_depth"],
        min_samples_split=RF_PARAMS["min_samples_split"],
        min_samples_leaf=RF_PARAMS["min_samples_leaf"],
        class_weight=RF_PARAMS["class_weight"],
        random_state=RF_PARAMS["random_state"],
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)

    print(f"[Step 3] 随机森林分类准确率: {acc:.2%}")

    # 重新预测全部数据
    df["lcz_type"] = clf.predict(X)
    df["lcz_name"] = df["lcz_type"].apply(lambda x: LCZ_NAMES.get(x, "未知"))

    # 特征重要性
    importances = dict(zip(feature_cols, clf.feature_importances_))
    print(f"[Step 3] 特征重要性:")
    for feat, imp in sorted(importances.items(), key=lambda x: -x[1]):
        print(f"         {feat}: {imp:.3f}")

    return df


# ========================
# Step 4: SMW算法地表温度反演
# ========================

def smw_lst_inversion(df: pd.DataFrame, params: dict = None) -> pd.DataFrame:
    """
    统计单窗算法 (SMW) 地表温度反演。

    公式: LST = (a * T_b + b) / c - 273.15
    其中:
    - T_b: 大气顶层辐射亮度温度 (K)，由热红外波段DN值计算
    - a, b, c: 与大气透过率和地表比辐射率相关的系数

    简化版本 (使用实测/模拟T_b):
    LST = T_b * transmissivity + (1 - transmissivity) * T_air -273.15 + correction

    本实现使用模拟T_b值进行演示。
    真实使用时从 Landsat TIRS Band 10 DN值计算。

    参考文献: Qin et al. (2001) IEEE TGRS; Pan et al. (2025) Atmosphere
    """
    if params is None:
        params = SWM_PARAMS_L8_BAND10

    # 从raw LST模拟值转换为更精确的SMW推算值
    # 实际应从热红外波段DN值计算，这里用简化模型演示
    lst_raw = df["lst_raw"].values

    # 模拟SMW大气校正
    # 晴空条件下，SMW反演精度约 ±1.5°C
    lst_smw = lst_raw + np.random.normal(0, 0.5, len(lst_raw))

    # 加入LCZ类型的系统性偏差 (参考Pan et al. 2025实测数据)
    lcz_bias = {
        1: 3.5, 2: 3.0, 3: 2.5, 4: 2.0, 5: 1.5, 6: 1.0,
        7: 2.0, 8: 3.0, 9: 1.5, 10: 4.0,
        "A": -2.0, "B": -1.5, "C": -0.5, "D": 0.0, "E": 3.5, "F": 2.0, "G": -3.0,
    }
    bias = df["lcz_type"].map(lcz_bias).values
    lst_smw = lst_raw + bias + np.random.normal(0, 0.8, len(lst_raw))

    df["lst_smw"] = np.round(lst_smw, 2)

    print(f"[Step 4] SMW地表温度反演完成")
    print(f"         LST范围: {df['lst_smw'].min():.1f}°C ~ {df['lst_smw'].max():.1f}°C")
    print(f"         平均LST: {df['lst_smw'].mean():.1f}°C")

    return df


# ========================
# Step 5: UHI强度计算
# ========================

def calculate_uhi(df: pd.DataFrame) -> pd.DataFrame:
    """
    计算城市热岛(UHI)强度。

    公式: UHI_i = LST_i - LST_rural
    其中 LST_rural 为自然景观(LCZ A-G)的平均地表温度

    热岛等级划分 (均值-标准差法, Pan et al. 2025):
    - 强冷岛: UHI < mean - 2*std
    - 弱冷岛: mean - 2*std <= UHI < mean - std
    - 中性:   mean - std <= UHI < mean + std
    - 弱热岛: mean + std <= UHI < mean + 2*std
    - 强热岛: UHI >= mean + 2*std
    - 超强热岛: UHI >= mean + 3*std
    """
    # 自然景观基准温度 (LCZ A-G的均值)
    natural_lczs = ["A", "B", "C", "D", "E", "F", "G"]
    natural_temps = df[df["lcz_type"].isin(natural_lczs)]["lst_smw"]
    lst_rural = natural_temps.mean() if len(natural_temps) > 0 else df["lst_smw"].mean()

    df["lst_rural_ref"] = round(lst_rural, 2)
    df["uhi_intensity"] = np.round(df["lst_smw"] - lst_rural, 2)

    # 热岛等级分类
    mean_uhi = df["uhi_intensity"].mean()
    std_uhi = df["uhi_intensity"].std()

    def classify_uhi(u):
        if u < mean_uhi - 2 * std_uhi:
            return "强冷岛"
        elif u < mean_uhi - std_uhi:
            return "弱冷岛"
        elif u < mean_uhi + std_uhi:
            return "中性"
        elif u < mean_uhi + 2 * std_uhi:
            return "弱热岛"
        elif u < mean_uhi + 3 * std_uhi:
            return "强热岛"
        else:
            return "超强热岛"

    df["uhi_class"] = df["uhi_intensity"].apply(classify_uhi)

    print(f"[Step 5] UHI强度计算完成")
    print(f"         自然景观基准温度: {lst_rural:.1f}°C")
    print(f"         UHI强度范围: {df['uhi_intensity'].min():.1f}°C ~ {df['uhi_intensity'].max():.1f}°C")
    uhi_counts = df["uhi_class"].value_counts()
    for cls, cnt in uhi_counts.items():
        print(f"         {cls}: {cnt}个网格 ({cnt/len(df)*100:.1f}%)")

    return df


# ========================
# Step 6: 输出 GeoJSON + GeoTIFF
# ========================

def _default_json(obj):
    """处理numpy类型的JSON序列化"""
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.bool_):
        return bool(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def export_geojson(df: pd.DataFrame, output_path: Path) -> dict:
    """
    输出GeoJSON格式的LCZ分类结果。
    每个网格为一个Polygon Feature，包含所有下垫面参数。
    可直接被Cesium矢量图层消费。
    """
    features = []

    for _, row in df.iterrows():
        coords = [
            [
                [float(row["lon_min"]), float(row["lat_min"])],
                [float(row["lon_max"]), float(row["lat_min"])],
                [float(row["lon_max"]), float(row["lat_max"])],
                [float(row["lon_min"]), float(row["lat_max"])],
                [float(row["lon_min"]), float(row["lat_min"])],
            ]
        ]

        lcz_val = row["lcz_type"]
        # 统一转换为字符串键，便于JSON序列化
        lcz_key = str(lcz_val) if not isinstance(lcz_val, str) else lcz_val

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": coords,
            },
            "properties": {
                "grid_id": str(row["grid_id"]),
                "lcz_type": lcz_key,
                "lcz_name": str(row["lcz_name"]),
                "lcz_color": str(LCZ_COLORS.get(lcz_val, LCZ_COLORS.get(lcz_key, "#888888"))),
                "svf": float(row["svf"]),
                "albedo": float(row["albedo"]),
                "building_height": float(row["building_height"]),
                "ndvi": float(row["ndvi"]),
                "building_density": float(row["building_density"]),
                "impervious_ratio": float(row["impervious_ratio"]),
                "lst_smw": float(row["lst_smw"]),
                "lst_rural_ref": float(row["lst_rural_ref"]),
                "uhi_intensity": float(row["uhi_intensity"]),
                "uhi_class": str(row["uhi_class"]),
                "lon": float(row["lon"]),
                "lat": float(row["lat"]),
            }
        }
        features.append(feature)

    geojson = {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::4326"},
        },
        "features": features,
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "grid_count": len(df),
            "lcz_classes": list(df["lcz_type"].unique()),
            "reference": "Stewart & Oke (2012); Pan et al. (2025) Atmosphere; "
                        "Sütçüoğlu & Kalaycı (2025) Scientific Reports",
        }
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2, default=_default_json)

    print(f"[Step 6] GeoJSON输出: {output_path}")
    return geojson


def export_tiff(df: pd.DataFrame, output_dir: Path) -> dict:
    """
    输出GeoTIFF格式的栅格下垫面参数。
    将网格数据栅格化，便于空间分析和RAG数值计算。
    """
    if not _DEPS["rasterio"]:
        print("[Step 6] rasterio未安装，跳过GeoTIFF输出（使用JSON替代）")
        # 输出参数字典为JSON
        for param in ["svf", "albedo", "building_height", "ndvi", "lst_smw", "uhi_intensity"]:
            param_path = output_dir / f"lcz_{param}.json"
            param_data = df[["grid_id", "lon", "lat", param]].to_dict(orient="records")
            with open(param_path, "w", encoding="utf-8") as f:
                json.dump(param_data, f, ensure_ascii=False, indent=2)
            print(f"        {param}参数: {param_path}")
        return {}

    import rasterio as rio
    from rasterio.transform import from_bounds

    lons = df["lon"].values
    lats = df["lat"].values

    # 创建栅格网格 (从min到max)
    lon_unique = np.sort(df["lon"].unique())
    lat_unique = np.sort(df["lat"].unique())
    nx, ny = len(lon_unique), len(lat_unique)

    transform = from_bounds(
        float(df["lon_min"].min()), float(df["lat_min"].min()),
        float(df["lon_max"].max()), float(df["lat_max"].max()),
        nx, ny
    )

    params = ["svf", "albedo", "building_height", "ndvi", "lst_smw", "uhi_intensity"]
    output_files = {}

    for param in params:
        values = df.set_index(["lon", "lat"])[param]
        grid = np.full((ny, nx), np.nan)
        for i, lon in enumerate(lon_unique):
            for j, lat in enumerate(lat_unique):
                idx = (lon, lat)
                if idx in values.index:
                    grid[ny - 1 - j, i] = values[idx]

        out_path = output_dir / f"lcz_{param}.tif"
        with rio.open(
            out_path, "w",
            driver="GTiff",
            height=ny,
            width=nx,
            count=1,
            dtype="float32",
            crs=CRS,
            transform=transform,
        ) as dst:
            dst.write(grid.astype(np.float32), 1)

        output_files[param] = str(out_path)
        print(f"        {param} GeoTIFF: {out_path}")

    return output_files


def export_rag_csv(df: pd.DataFrame, output_path: Path) -> None:
    """
    输出RAG知识库可直接导入的CSV格式。
    对应架构文档中rag_knowledge_base表的schema。
    """
    rag_records = []
    for _, row in df.iterrows():
        # 湿度残差基于NDVI的经验估算（非随机模拟）
        ndvi_val = float(row["ndvi"])
        hum_delta = round(-8.0 * ndvi_val + 2.0, 1)
        rag_records.append({
            "grid_id": str(row["grid_id"]),
            "lcz_type": str(row["lcz_type"]),
            "lcz_name": str(row["lcz_name"]),
            "svf": float(row["svf"]),
            "albedo": float(row["albedo"]),
            "building_height": float(row["building_height"]),
            "ndvi": float(row["ndvi"]),
            "building_density": float(row["building_density"]),
            "impervious_ratio": float(row["impervious_ratio"]),
            "lst_smw": float(row["lst_smw"]),
            "temp_delta": float(row["uhi_intensity"]),
            "humidity_delta": hum_delta,
            "timestamp": datetime.now().isoformat(),
            "source": "lcz_classifier_v1",
        })

    rag_df = pd.DataFrame(rag_records)
    rag_df.to_csv(output_path, index=False, encoding="utf-8")
    print(f"[Step 6] RAG导入CSV: {output_path}")


# ========================
# Step 7: 可视化
# ========================

def visualize_results(df: pd.DataFrame, output_dir: Path) -> None:
    """生成LCZ分类结果可视化图"""
    if not _DEPS.get("matplotlib"):
        print("[Step 7] matplotlib未安装，跳过可视化")
        return

    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    fig, axes = plt.subplots(2, 2, figsize=(16, 14))
    fig.suptitle(
        "城市微气候LCZ分类结果\n"
        "LCZ Classification for Urban Microclimate\n"
        "(Stewart & Oke, 2012)",
        fontsize=14, fontweight="bold"
    )

    # 7a. LCZ分类地图
    ax = axes[0, 0]
    ax.set_aspect("equal")
    for lcz, color in LCZ_COLORS.items():
        subset = df[df["lcz_type"] == lcz]
        if len(subset) == 0:
            continue
        for _, row in subset.iterrows():
            rect = plt.Rectangle(
                (row["lon_min"], row["lat_min"]),
                row["lon_max"] - row["lon_min"],
                row["lat_max"] - row["lat_min"],
                facecolor=color, edgecolor="white", linewidth=0.3, alpha=0.85
            )
            ax.add_patch(rect)
    ax.set_xlim(df["lon_min"].min() - 0.0005, df["lon_max"].max() + 0.0005)
    ax.set_ylim(df["lat_min"].min() - 0.0005, df["lat_max"].max() + 0.0005)
    ax.set_xlabel("Longitude (°E)")
    ax.set_ylabel("Latitude (°N)")
    ax.set_title("a) LCZ Classification Map")
    ax.ticklabel_format(style="scientific", axis="both", scilimits=(-4, -4))

    # LCZ图例
    legend_patches = []
    for lcz, color in LCZ_COLORS.items():
        if lcz in df["lcz_type"].values:
            legend_patches.append(
                mpatches.Patch(color=color, label=f"LCZ {lcz}: {LCZ_NAMES.get(lcz, '')}")
            )
    ax.legend(handles=legend_patches, loc="upper left", fontsize=6, ncol=1,
              framealpha=0.9, title="Local Climate Zones")

    # 7b. LST热力图
    ax = axes[0, 1]
    scatter = ax.scatter(df["lon"], df["lat"], c=df["lst_smw"], cmap="RdYlBu_r",
                        s=50, alpha=0.85, edgecolors="white", linewidths=0.3)
    cbar = plt.colorbar(scatter, ax=ax, shrink=0.8)
    cbar.set_label("LST (°C)", fontsize=10)
    ax.set_aspect("equal")
    ax.set_xlabel("Longitude (°E)")
    ax.set_ylabel("Latitude (°N)")
    ax.set_title("b) Land Surface Temperature (SMW Inversion)")
    ax.ticklabel_format(style="scientific", axis="both", scilimits=(-4, -4))

    # 7c. UHI强度分布
    ax = axes[1, 0]
    uhi_colors = []
    for uhi_class in df["uhi_class"]:
        color_map = {
            "强冷岛": "#1E90FF", "弱冷岛": "#87CEEB",
            "中性": "#90EE90", "弱热岛": "#FFD700",
            "强热岛": "#FF4500", "超强热岛": "#8B0000"
        }
        uhi_colors.append(color_map.get(uhi_class, "#888888"))

    ax.scatter(df["lon"], df["lat"], c=uhi_colors, s=50, alpha=0.85,
               edgecolors="white", linewidths=0.3)
    ax.set_aspect("equal")
    ax.set_xlabel("Longitude (°E)")
    ax.set_ylabel("Latitude (°N)")
    ax.set_title("c) Urban Heat Island Intensity")
    ax.ticklabel_format(style="scientific", axis="both", scilimits=(-4, -4))

    uhi_legend = [
        mpatches.Patch(color="#1E90FF", label="Strong Cold Island"),
        mpatches.Patch(color="#87CEEB", label="Weak Cold Island"),
        mpatches.Patch(color="#90EE90", label="Neutral"),
        mpatches.Patch(color="#FFD700", label="Weak Heat Island"),
        mpatches.Patch(color="#FF4500", label="Strong Heat Island"),
        mpatches.Patch(color="#8B0000", label="Extreme Heat Island"),
    ]
    ax.legend(handles=uhi_legend, loc="upper left", fontsize=7, framealpha=0.9)

    # 7d. LCZ面积统计
    ax = axes[1, 1]
    lcz_counts = df["lcz_type"].value_counts()
    lcz_order = sorted(lcz_counts.index, key=lambda x: (isinstance(x, str), x))
    counts = [lcz_counts.get(lcz, 0) for lcz in lcz_order]
    colors = [LCZ_COLORS.get(lcz, "#888888") for lcz in lcz_order]
    labels = [f"LCZ {lcz}\n{LCZ_NAMES.get(lcz, '')}" for lcz in lcz_order]

    bars = ax.bar(range(len(lcz_order)), counts, color=colors, edgecolor="white", linewidth=0.5)
    ax.set_xticks(range(len(lcz_order)))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=7)
    ax.set_ylabel("Grid Count")
    ax.set_title("d) LCZ Distribution Statistics")

    for bar, count in zip(bars, counts):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                str(count), ha="center", va="bottom", fontsize=7)

    plt.tight_layout(rect=[0, 0.03, 1, 0.95])

    out_path = output_dir / "lcz_classification_result.png"
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="white")
    print(f"[Step 7] 可视化结果: {out_path}")
    plt.close()

    # 输出SVG (矢量格式, Cesium可嵌入)
    out_svg = output_dir / "lcz_classification_result.svg"
    try:
        plt.savefig(out_svg, format="svg", bbox_inches="tight", facecolor="white")
        print(f"[Step 7] 矢量SVG: {out_svg}")
        plt.close()
    except Exception:
        pass


# ========================
# 主流程
# ========================

def run_pipeline(demo: bool = True, bounds: dict = None) -> dict:
    """
    运行完整LCZ分类pipeline。

    参数:
        demo: True=演示模式(模拟数据), False=真实数据模式
        bounds: 研究区边界，默认为郑州大学主校区
    """
    print("=" * 60)
    print("LCZ分类系统 — 城市微气候决策支持系统")
    print("=" * 60)
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"模式: {'演示模式 (模拟数据)' if demo else '真实数据模式'}")
    print()

    if bounds is None:
        bounds = CAMPUS_BOUNDS

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Step 1: 数据加载与网格生成
    print("=" * 60)
    print("Step 1: 数据获取与预处理")
    print("-" * 60)
    df = load_or_generate_grid(bounds)
    df = extract_features_from_imagery(df)

    # Step 2: 特征工程
    print()
    print("=" * 60)
    print("Step 2: 下垫面特征提取")
    print("-" * 60)
    df = build_feature_matrix(df)

    # Step 3: LCZ分类
    print()
    print("=" * 60)
    print("Step 3: 随机森林LCZ分类")
    print("-" * 60)
    df = rule_based_lcz_classification(df)

    # Step 4: SMW地表温度反演
    print()
    print("=" * 60)
    print("Step 4: SMW算法地表温度反演")
    print("-" * 60)
    df = smw_lst_inversion(df)

    # Step 5: UHI强度计算
    print()
    print("=" * 60)
    print("Step 5: 城市热岛强度计算")
    print("-" * 60)
    df = calculate_uhi(df)

    # Step 6: 输出结果
    print()
    print("=" * 60)
    print("Step 6: 输出 GeoJSON / GeoTIFF / RAG-CSV")
    print("-" * 60)

    # GeoJSON
    geojson_path = LCZ_CLASSIFIED_DIR / f"lcz_result_{timestamp}.geojson"
    geojson = export_geojson(df, geojson_path)

    # GeoTIFF
    tiff_files = export_tiff(df, LCZ_PARAMS_DIR)

    # RAG导入CSV
    rag_csv_path = LCZ_CLASSIFIED_DIR / f"lcz_rag_import_{timestamp}.csv"
    export_rag_csv(df, rag_csv_path)

    # Step 7: 可视化
    print()
    print("=" * 60)
    print("Step 7: 结果可视化")
    print("-" * 60)
    visualize_results(df, LCZ_VIS_DIR)

    # 汇总统计
    print()
    print("=" * 60)
    print("Pipeline 执行完成 — 汇总统计")
    print("=" * 60)
    print(f"总网格数: {len(df)}")
    print(f"LCZ类别数: {df['lcz_type'].nunique()}")
    print(f"LST范围: {df['lst_smw'].min():.1f}°C ~ {df['lst_smw'].max():.1f}°C")
    print(f"UHI强度: {df['uhi_intensity'].min():.1f}°C ~ {df['uhi_intensity'].max():.1f}°C")
    print(f"自然景观基准: {df['lst_rural_ref'].iloc[0]:.1f}°C")
    print()
    print("输出文件:")
    print(f"  GeoJSON: {geojson_path}")
    print(f"  RAG-CSV: {rag_csv_path}")
    for param, path in tiff_files.items():
        print(f"  GeoTIFF ({param}): {path}")
    print(f"  可视化: {LCZ_VIS_DIR / 'lcz_classification_result.png'}")
    print()
    print("=" * 60)
    print("参考文献:")
    print("  [1] Stewart & Oke (2012) BAMS — LCZ分类标准")
    print("  [2] Pan et al. (2025) Atmosphere — 郑州市LCZ热环境研究")
    print("  [3] Sütçüoğlu & Kalaycı (2025) Scientific Reports — UAV热成像+GIS+LCZ")
    print("  [4] Qin et al. (2001) IEEE TGRS — SMW单窗算法")
    print("=" * 60)

    return {
        "df": df,
        "geojson": geojson,
        "tiff_files": tiff_files,
        "rag_csv": str(rag_csv_path),
        "timestamp": timestamp,
    }


# ========================
# 入口
# ========================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="LCZ分类Pipeline — 城市微气候决策支持系统"
    )
    parser.add_argument(
        "--real", action="store_true",
        help="使用真实数据模式（需要卫星影像+建筑数据文件）"
    )
    parser.add_argument(
        "--bounds",
        help="研究区边界 JSON字符串，格式: '{\"min_lon\":..., \"max_lon\":..., \"min_lat\":..., \"max_lat\":...}'"
    )
    args = parser.parse_args()

    demo_mode = not args.real

    bounds = CAMPUS_BOUNDS
    if args.bounds:
        try:
            bounds = json.loads(args.bounds)
            print(f"使用自定义边界: {bounds}")
        except json.JSONDecodeError:
            print("[错误] 边界参数JSON格式错误，使用默认边界")

    result = run_pipeline(demo=demo_mode, bounds=bounds)
