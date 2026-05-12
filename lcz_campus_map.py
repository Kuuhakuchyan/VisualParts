"""
郑州大学主校区 LCZ 精细分类 (10m Sentinel-2)
输出: 高分辨率校园LCZ分类图 + GeoJSON (用于RAG系统)
"""

import ee, json, io, urllib.request
from pathlib import Path
from datetime import datetime

from gee_config import initialize_gee

# ========================
# 校园范围 (郑州大学主校区)
# ========================
CAMPUS_BOUNDS = {
    "min_lon": 113.52160, "max_lon": 113.53615,
    "min_lat": 34.80884, "max_lat": 34.82807,
}

OUTPUT_DIR = Path(__file__).parent / "gee_data" / "lcz_campus"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ========================
# LCZ颜色
# ========================
LCZ_HEX = {
    1: "#8B0000", 2: "#CD5C5C", 3: "#E9967A",
    4: "#FFA500", 5: "#FFD700", 6: "#ADFF2F",
    7: "#808080", 8: "#A9A9A9", 9: "#D3D3D3", 10: "#4B0082",
    11: "#006400", 12: "#228B22", 13: "#32CD32", 14: "#90EE90",
    15: "#D2691E", 16: "#DEB887", 17: "#1E90FF",
}
LCZ_NAMES = {
    1: "Compact High", 2: "Compact Mid", 3: "Compact Low",
    4: "Open High", 5: "Open Mid", 6: "Open Low",
    7: "Lightweight", 8: "Large Low", 9: "Sparsely Built", 10: "Heavy Industry",
    11: "Dense Trees (A)", 12: "Scattered Trees (B)", 13: "Shrub (C)",
    14: "Low Plants (D)", 15: "Paved/Bare (E)", 16: "Bare Soil (F)", 17: "Water (G)",
}
NAT_LABELS = {11: "A", 12: "B", 13: "C", 14: "D", 15: "E", 16: "F", 17: "G"}


def mask_s2_clouds(image):
    """Sentinel-2 QA60云掩膜"""
    qa = image.select("QA60")
    cloud = (1 << 10) | (1 << 11)  # bit 10=cirrus, 11=cloud
    mask = qa.bitwiseAnd(cloud).eq(0)
    return image.updateMask(mask)


def get_campus_data():
    """获取Sentinel-2校园影像并计算指数"""
    region = ee.Geometry.Rectangle([
        CAMPUS_BOUNDS["min_lon"], CAMPUS_BOUNDS["min_lat"],
        CAMPUS_BOUNDS["max_lon"], CAMPUS_BOUNDS["max_lat"],
    ])

    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
          .filterBounds(region).filterDate("2025-06-01", "2025-09-30")
          .filter(ee.Filter.lte("CLOUDY_PIXEL_PERCENTAGE", 20)))

    n = s2.size().getInfo()
    print(f"Sentinel-2: {n} scenes")
    if n == 0:
        return None

    comp = s2.map(mask_s2_clouds).median().clip(region)

    # Sentinel-2波段: B2(蓝),B3(绿),B4(红),B8(NIR),B11(SWIR)
    # 重采样B11到10m
    b11 = comp.select("B11").resample("bilinear").reproject(
        crs=comp.select("B2").projection(), scale=10
    )

    ndvi = comp.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndbi = comp.normalizedDifference(["B11", "B8"]).rename("NDBI")
    mndwi = comp.normalizedDifference(["B3", "B11"]).rename("MNDWI")

    # 简化反照率 (Sentinel-2宽带转换)
    albedo = (
        comp.select("B2").multiply(0.267)
        .add(comp.select("B4").multiply(0.145))
        .add(comp.select("B8").multiply(0.345))
        .add(comp.select("B11").multiply(0.112))
        .add(comp.select("B12").multiply(0.081))
        .subtract(0.002)
        .clamp(0, 1).rename("ALBEDO")
    )

    return {
        "region": region,
        "composite": comp,
        "ndvi": ndvi,
        "ndbi": ndbi,
        "mndwi": mndwi,
        "albedo": albedo,
    }


def classify_lcz_campus(data):
    """
    校园LCZ分类 (基于Sentinel-2实测采样)
    采样值: 建筑NDVI≈0.07-0.21 NDBI≈0.04-0.16
            硬化NDVI≈0.54-0.60 NDBI≈(-0.25)-(-0.22)
            密林NDVI≈0.80        NDBI≈-0.31
            草坪NDVI≈0.58        NDBI≈-0.24
    """
    ndvi = data["ndvi"]
    ndbi = data["ndbi"]
    mndwi = data["mndwi"]
    albedo = data["albedo"]

    # 水体的Sentinel-2特征: B3 > B8 (绿>近红外)
    composite = data["composite"]
    water_idx = composite.select("B3").subtract(composite.select("B8"))  # >0 = water

    lcz = ee.Image.constant(0)

    # G: 水体 (B3 > B8 AND NDVI低)
    lcz = lcz.where(water_idx.gt(0).And(ndvi.lt(0.2)), 17)

    # A: 密林 (NDVI > 0.65)
    lcz = lcz.where(ndvi.gt(0.65).And(lcz.eq(0)), 11)
    # B: 树木 (NDVI > 0.45)
    lcz = lcz.where(ndvi.gt(0.45).And(lcz.eq(0)), 12)
    # C: 灌木/绿化 (NDVI > 0.30)
    lcz = lcz.where(ndvi.gt(0.30).And(lcz.eq(0)), 13)
    # D: 草坪/低矮植被 (NDVI > 0.15)
    lcz = lcz.where(ndvi.gt(0.15).And(lcz.eq(0)), 14)

    rest = lcz.eq(0)

    # 2: 密集中层建筑 (教学楼) — NDBI > 0
    lcz = lcz.where(ndbi.gt(0).And(rest), 2)
    # 5: 开阔中层建筑 — NDBI > -0.10
    lcz = lcz.where(ndbi.gt(-0.10).And(lcz.eq(0)).And(rest), 5)
    # 8: 大型低层 (体育馆/食堂) — 较高反照率
    lcz = lcz.where(albedo.gt(0.18).And(lcz.eq(0)).And(rest), 8)

    # F: 裸土/施工区
    lcz = lcz.where(ndvi.lte(0.15).And(albedo.gt(0.22)).And(lcz.eq(0)), 16)

    # E: 硬化地面 (剩余未分类)
    lcz = lcz.where(lcz.eq(0), 15)

    return lcz.byte().rename("LCZ")


def compute_campus_stats(lcz, region, scale=10):
    """分类面积统计"""
    pa = ee.Image.pixelArea().divide(10000)
    classes = list(range(1, 18))
    stats = {}
    for code in classes:
        area_dict = pa.updateMask(lcz.eq(code)).reduceRegion(
            reducer=ee.Reducer.sum(), geometry=region,
            scale=scale, bestEffort=True, maxPixels=1e9,
        ).getInfo()
        ha = area_dict.get("area", 0)
        if ha and ha > 0.1:
            stats[code] = round(ha, 2)
    return stats


def generate_map(data, lcz):
    """生成校园LCZ分类图 (带建筑/道路标注)"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    import numpy as np

    region = data["region"]
    ndvi = data["ndvi"]
    ndbi_img = data["ndbi"]

    def thumb(image, vis, dims=1200):
        url = image.getThumbURL({
            "region": region, **vis, "dimensions": dims, "format": "png"
        })
        return plt.imread(io.BytesIO(urllib.request.urlopen(url).read()))

    print("  Downloading maps...")
    lcz_arr = thumb(lcz, {"min": 1, "max": 17, "palette": [LCZ_HEX[i] for i in range(1, 18)]}, dims=1500)
    ndvi_arr = thumb(ndvi, {"min": 0, "max": 0.6, "palette": ["white", "lightgreen", "green", "darkgreen"]})
    ndbi_arr = thumb(ndbi_img, {"min": -0.2, "max": 0.2, "palette": ["green", "white", "red"]})

    # True color
    rgb = data["composite"].select(["B4", "B3", "B2"])
    rgb_arr = thumb(rgb, {"min": 0, "max": 2000}, dims=1500)

    fig, axes = plt.subplots(2, 2, figsize=(20, 18))
    fig.suptitle("ZZU Campus LCZ Classification (10m Sentinel-2, Summer 2025)", fontsize=15, fontweight="bold", y=0.97)

    panes = [
        ("True Color (RGB)", rgb_arr),
        ("LCZ Classification", lcz_arr),
        ("NDVI", ndvi_arr),
        ("NDBI", ndbi_arr),
    ]

    for ax, (title, arr) in zip(axes.flat, panes):
        ax.imshow(arr, extent=[
            CAMPUS_BOUNDS["min_lon"], CAMPUS_BOUNDS["max_lon"],
            CAMPUS_BOUNDS["min_lat"], CAMPUS_BOUNDS["max_lat"],
        ])
        ax.set_title(title, fontsize=12, fontweight="bold")
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")

    # Legend
    handles = []
    for code in sorted(LCZ_NAMES):
        handles.append(mpatches.Patch(color=LCZ_HEX[code], label=f"LCZ {NAT_LABELS.get(code,code)} {LCZ_NAMES[code]}"))
    axes[0, 1].legend(handles=handles, loc="lower left", fontsize=6.5, ncol=2, framealpha=0.9)

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    path = OUTPUT_DIR / "lcz_campus_map.png"
    fig.savefig(path, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"\nSaved: {path}")
    return path


def export_geojson(lcz, region, scale=10):
    """导出GeoJSON (用于RAG系统)"""
    # reduceToVectors需要像素聚合
    # 用mean reducer + lcz作为唯一波段
    vectors = lcz.reduceToVectors(
        geometry=region, scale=scale * 2,
        geometryType="polygon", eightConnected=False,
        labelProperty="LCZ", bestEffort=True, maxPixels=1e8,
    )

    path = OUTPUT_DIR / "campus_lcz.geojson"
    try:
        geojson = vectors.getInfo()
        min_area = 500  # m², 过滤小碎片
        valid = []
        for f in geojson.get("features", []):
            geom = ee.Geometry(f["geometry"])
            area = geom.area(maxError=1).getInfo()
            if area >= min_area:
                code = int(f["properties"]["LCZ"])
                f["properties"] = {
                    "lcz_type": code,
                    "lcz_name": LCZ_NAMES.get(code, f"LCZ {code}"),
                    "area_m2": round(area, 1),
                }
                valid.append(f)

        geojson["features"] = valid
        with open(path, "w", encoding="utf-8") as fp:
            json.dump(geojson, fp, ensure_ascii=False, indent=2)
        print(f"GeoJSON: {path}  ({len(valid)} polygons)")
        return path
    except Exception as e:
        print(f"GeoJSON failed: {e}")
        return None


def main():
    print("=" * 55)
    print("  ZZU Campus LCZ Classification")
    print("=" * 55)

    if not initialize_gee():
        return

    data = get_campus_data()
    if data is None:
        return

    print("\nClassifying LCZ...")
    lcz = classify_lcz_campus(data)

    print("Computing statistics...")
    stats = compute_campus_stats(lcz, data["region"])
    total = sum(stats.values())
    print(f"Area: {total:.1f} ha = {total/100:.1f} km2")

    for code in sorted(stats):
        ha = stats[code]
        pct = ha / total * 100
        label = f"LCZ {NAT_LABELS.get(code, code)}"
        print(f"  {label:<8s} {LCZ_NAMES.get(code,''):<18s} {ha:>7.2f} ha ({pct:>4.1f}%)")

    with open(OUTPUT_DIR / "campus_stats.json", "w", encoding="utf-8") as fp:
        json.dump({
            "date": datetime.now().isoformat(),
            "bounds": CAMPUS_BOUNDS,
            "total_ha": total,
            "lcz_areas_ha": stats,
        }, fp, ensure_ascii=False, indent=2)

    print("\nGenerating map...")
    generate_map(data, lcz)

    print("\nExporting GeoJSON...")
    export_geojson(lcz, data["region"], scale=10)

    print(f"\nAll outputs: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
