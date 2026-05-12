"""
郑州市区 LCZ (Local Climate Zone) 分类制图
基于 Landsat 8/9 遥感影像 + 阈值规则分类
输出: PNG 结果图 + GeoJSON

参考文献:
  Stewart & Oke (2012) BAMS
  Pan et al. (2025) Atmosphere
"""

import ee
import json
import io
import urllib.request
from pathlib import Path
from datetime import datetime

from gee_config import initialize_gee, GEE_DATA_DIR
from gee_fetcher import GEEFetcher

# ========================
# 郑州市区范围
# ========================
ZHENGZHOU_BOUNDS = {
    "min_lon": 113.55, "max_lon": 113.78,
    "min_lat": 34.70, "max_lat": 34.85,
}

OUTPUT_DIR = GEE_DATA_DIR / "lcz_zhengzhou"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ========================
# LCZ 颜色方案 (WUDAPT标准)
# ========================
LCZ_HEX = {
    1: "#8B0000", 2: "#CD5C5C", 3: "#E9967A",
    4: "#FFA500", 5: "#FFD700", 6: "#ADFF2F",
    7: "#808080", 8: "#A9A9A9", 9: "#D3D3D3", 10: "#4B0082",
    11: "#006400", 12: "#228B22", 13: "#32CD32", 14: "#90EE90",
    15: "#D2691E", 16: "#DEB887", 17: "#1E90FF",
}
# 编码: 1-10 对应 LCZ 1-10 (建筑), 11-17 对应 A-G (自然)
LCZ_NAMES = {
    1: "密集高层", 2: "密集中层", 3: "密集低层",
    4: "开阔高层", 5: "开阔中层", 6: "开阔低层",
    7: "轻质低层", 8: "大型低层", 9: "稀疏建筑", 10: "重工业",
    11: "密林(A)", 12: "稀疏树木(B)", 13: "灌木(C)",
    14: "低矮植被(D)", 15: "硬化地面(E)", 16: "裸土(F)", 17: "水体(G)",
}
NAT_LABELS = {11: "A", 12: "B", 13: "C", 14: "D", 15: "E", 16: "F", 17: "G"}


def classify_lcz(ndvi, ndbi, mndwi, albedo, lst):
    """
    多级阈值 LCZ 分类 (输出 1-17 整数编码)
    自然类: A=11, B=12, C=13, D=14, E=15, F=16, G=17
    建筑类: 1-10
    """
    lcz = ee.Image.constant(0)

    # St1: 水体 (G=17)
    lcz = lcz.where(mndwi.gt(0.1), 17)

    # St2: 自然类 (NDVI主导)
    lcz = lcz.where(ndvi.gt(0.50).And(lcz.eq(0)), 11)  # A 密林
    lcz = lcz.where(ndvi.gt(0.35).And(lcz.eq(0)), 12)  # B 稀疏树木
    lcz = lcz.where(ndvi.gt(0.25).And(lcz.eq(0)), 13)  # C 灌木
    lcz = lcz.where(ndvi.gt(0.12).And(lcz.eq(0)), 14)  # D 低矮植被
    lcz = lcz.where(
        ndvi.lte(0.12).And(ndbi.lt(0)).And(albedo.gt(0.18)).And(lcz.eq(0)),
        15  # E 硬化/裸土
    )
    lcz = lcz.where(
        ndvi.lte(0.12).And(ndbi.lt(-0.05)).And(albedo.gt(0.25)).And(lcz.eq(0)),
        16  # F 沙砾
    )

    # St3: 建筑区
    built = lcz.eq(0)

    # 重工业 (10): 高NDBI
    lcz = lcz.where(ndbi.gt(0.12).And(albedo.gt(0.12)).And(built), 10)

    # 大型低层 (8)
    lcz = lcz.where(ndbi.gt(0.08).And(albedo.gt(0.10)).And(albedo.lt(0.25)).And(built).And(lcz.eq(0)), 8)

    # 密集 (1-3): 高NDBI, 按LST细分
    dense = ndbi.gt(0.05).And(lst.gt(30)).And(built).And(lcz.eq(0))
    lcz = lcz.where(dense.And(lst.gt(37)), 1)
    lcz = lcz.where(dense.And(lst.gt(33)).And(lst.lte(37)), 2)
    lcz = lcz.where(dense.And(lst.lte(33)), 3)

    # 开阔 (4-6): 中等NDBI
    open_b = ndbi.gt(-0.05).And(built).And(lcz.eq(0))
    lcz = lcz.where(open_b.And(lst.gt(35)), 4)
    lcz = lcz.where(open_b.And(lst.gt(30)).And(lst.lte(35)), 5)
    lcz = lcz.where(open_b.And(lst.lte(30)), 6)

    # 轻质低层 (7)
    lcz = lcz.where(ndbi.gt(-0.10).And(ndbi.lte(-0.05)).And(built).And(lcz.eq(0)), 7)

    # 稀疏建筑 (9)
    lcz = lcz.where(ndbi.gt(-0.15).And(ndbi.lte(-0.10)).And(built).And(lcz.eq(0)), 9)

    # 兜底: 未分类 -> E (15)
    lcz = lcz.where(lcz.eq(0), 15)

    return lcz.byte().rename("LCZ")


def fetch_gee_data():
    """获取GEE数据并执行LCZ分类"""
    fetcher = GEEFetcher(ZHENGZHOU_BOUNDS)
    region = ee.Geometry.Rectangle([
        ZHENGZHOU_BOUNDS["min_lon"], ZHENGZHOU_BOUNDS["min_lat"],
        ZHENGZHOU_BOUNDS["max_lon"], ZHENGZHOU_BOUNDS["max_lat"],
    ])

    collection = fetcher.search_landsat("2025-06-01", "2025-09-30", max_cloud=20)
    if collection.size().getInfo() == 0:
        print("无可用影像")
        return None

    composite = collection.map(fetcher.mask_clouds).median().clip(region)
    ndvi = fetcher.calc_ndvi(composite)
    ndbi = fetcher.calc_ndbi(composite)
    mndwi = fetcher.calc_mndwi(composite)
    albedo = fetcher.calc_albedo(composite)
    lst = (
        composite.select("ST_B10").multiply(0.00341802).add(149.0)
        .subtract(273.15).rename("LST")
    )

    lcz = classify_lcz(ndvi, ndbi, mndwi, albedo, lst)

    return {
        "region": region,
        "lcz": lcz, "ndvi": ndvi, "ndbi": ndbi,
        "lst": lst, "albedo": albedo, "mndwi": mndwi,
    }


def compute_stats(lcz, region):
    """分类型面积统计 (ha) - 使用逐类掩膜方法"""
    pa = ee.Image.pixelArea().divide(10000)

    classes = list(range(1, 18))
    stats = {}

    for code in classes:
        mask = lcz.eq(code)
        masked = pa.updateMask(mask)
        area_dict = masked.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=region,
            scale=100, bestEffort=True, maxPixels=1e9,
        ).getInfo()
        ha = area_dict.get("area", 0)
        if ha and ha > 1:
            stats[code] = ha

    return stats


def _setup_cjk_font():
    """尝试设置中文字体"""
    import matplotlib
    for font_name in ["SimHei", "Microsoft YaHei", "WenQuanYi Micro Hei", "Noto Sans CJK SC"]:
        try:
            matplotlib.font_manager.findfont(font_name, fallback_to_default=False)
            matplotlib.rcParams["font.sans-serif"] = [font_name, "DejaVu Sans"]
            matplotlib.rcParams["axes.unicode_minus"] = False
            return True
        except Exception:
            continue
    return False


def make_map_plot(results):
    """生成四面板图"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    import numpy as np

    _setup_cjk_font()

    region = results["region"]
    lcz = results["lcz"]
    ndvi = results["ndvi"]
    ndbi_img = results["ndbi"]
    lst = results["lst"]

    def get_thumb(image, vis, dims=900):
        url = image.getThumbURL({"region": region, **vis, "dimensions": dims, "format": "png"})
        data = urllib.request.urlopen(url).read()
        return plt.imread(io.BytesIO(data))

    print("  Downloading LCZ classification...")
    lcz_arr = get_thumb(lcz, {"min": 1, "max": 17, "palette": [LCZ_HEX[i] for i in range(1, 18)]})
    print("  Downloading NDVI...")
    ndvi_arr = get_thumb(ndvi, {"min": 0, "max": 0.6, "palette": ["white", "lightgreen", "green", "darkgreen"]})
    print("  Downloading LST...")
    lst_arr = get_thumb(lst, {"min": 25, "max": 45, "palette": ["blue", "cyan", "yellow", "orange", "red"]})
    print("  Downloading NDBI...")
    ndbi_arr = get_thumb(ndbi_img, {"min": -0.2, "max": 0.2, "palette": ["green", "white", "red"]})

    fig, axes = plt.subplots(2, 2, figsize=(18, 15))
    fig.suptitle("Zhengzhou LCZ Classification (Landsat 8/9, Summer 2025)",
                 fontsize=16, fontweight="bold", y=0.98)

    titles = [
        "LCZ Classification (1-17)",
        "NDVI",
        "LST (land surface temperature, C)",
        "NDBI",
    ]

    for ax, (title, arr) in zip(axes.flat, zip(titles, [lcz_arr, ndvi_arr, lst_arr, ndbi_arr])):
        ax.imshow(arr, extent=[
            ZHENGZHOU_BOUNDS["min_lon"], ZHENGZHOU_BOUNDS["max_lon"],
            ZHENGZHOU_BOUNDS["min_lat"], ZHENGZHOU_BOUNDS["max_lat"],
        ])
        ax.set_title(title, fontsize=12, fontweight="bold")
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")

    handles = []
    for code in sorted(LCZ_NAMES):
        label = f"LCZ {NAT_LABELS.get(code, code)} {LCZ_NAMES[code]}"
        handles.append(mpatches.Patch(color=LCZ_HEX[code], label=label))
    axes[0, 0].legend(handles=handles, loc="lower left", fontsize=5.5,
                      ncol=2, framealpha=0.85, facecolor="white")

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    path = OUTPUT_DIR / "lcz_zhengzhou_map.png"
    fig.savefig(path, dpi=250, bbox_inches="tight")
    plt.close(fig)
    print(f"\nResult: {path}")
    return path


def print_stats(stats):
    total_ha = sum(stats.values())
    print(f"\n面积统计 (共 {total_ha:.0f} ha = {total_ha/100:.1f} km²):")
    for code in sorted(stats):
        ha = stats[code]
        pct = ha / total_ha * 100
        name = LCZ_NAMES.get(code, f"未知({code})")
        label = f"LCZ {NAT_LABELS.get(code, str(code))}"
        print(f"  {label:<8s} {name:<12s} {ha:>8.0f} ha ({pct:>4.1f}%)")


def main():
    print("=" * 55)
    print("  郑州市区 LCZ 分类制图")
    print("=" * 55)

    if not initialize_gee():
        return

    data = fetch_gee_data()
    if data is None:
        return

    print("\n计算面积统计...")
    stats = compute_stats(data["lcz"], data["region"])
    print_stats(stats)

    with open(OUTPUT_DIR / "lcz_stats.json", "w", encoding="utf-8") as fp:
        json.dump({
            "date": datetime.now().isoformat(),
            "region_km2": 350,
            "lcz_areas_ha": stats,
        }, fp, ensure_ascii=False, indent=2)

    print("\n生成地图...")
    make_map_plot(data)

    print("\n===== 完成 =====")


if __name__ == "__main__":
    main()
