"""
GEE交互式使用示例 (Jupyter Notebook 兼容)
在VSCode中打开此文件，按 Cell 逐段运行
"""

# %% [markdown]
# # Google Earth Engine 数据处理示例
#
# 本Notebook展示如何在VSCode中使用GEE获取遥感数据，
# 用于LCZ分类和城市微气候分析。
#
# **数据源**: Landsat 8/9 SR (30m分辨率)
# **研究区**: 郑州大学主校区
# **分析方法**: NDVI, NDBI, LST, 反照率

# %% 1. 初始化GEE
import ee
from gee_config import initialize_gee, STUDY_AREA

# 首次使用需要先认证:
# 终端运行: earthengine authenticate
initialize_gee()

# %% 2. 定义研究区
region = ee.Geometry.Rectangle([
    STUDY_AREA["min_lon"], STUDY_AREA["min_lat"],
    STUDY_AREA["max_lon"], STUDY_AREA["max_lat"]
])

# 查看区域面积 (km²)
area_km2 = region.area().getInfo() / 1e6
print(f"研究区面积: {area_km2:.2f} km²")

# %% 3. 检索Landsat影像
from datetime import datetime, timedelta

# 搜索最近3个月的低云量影像
collection = (
    ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    .filterBounds(region)
    .filterDate("2025-06-01", "2025-09-30")
    .filter(ee.Filter.lte("CLOUD_COVER", 20))
)

count = collection.size().getInfo()
print(f"找到 {count} 景可用影像")

# 打印影像列表
if count > 0:
    dates = collection.aggregate_array("DATE_ACQUIRED").getInfo()
    clouds = collection.aggregate_array("CLOUD_COVER").getInfo()
    for d, c in zip(dates, clouds):
        print(f"  {d}  云量: {c}%")

# %% 4. 云掩膜与中值合成
def mask_clouds(image):
    """Landsat C02 QA_Pixel云掩膜"""
    qa = image.select("QA_PIXEL")
    mask = qa.bitwiseAnd((1 << 3) | (1 << 4)).eq(0)
    return image.updateMask(mask)

# 云掩膜 + 中值合成
composite = collection.map(mask_clouds).median().clip(region)
print("合成影像已生成")

# %% 5. 计算NDVI
ndvi = composite.normalizedDifference(["SR_B5", "SR_B4"]).rename("NDVI")

# 查看NDVI统计
ndvi_stats = ndvi.reduceRegion(
    reducer=ee.Reducer.mean(),
    geometry=region,
    scale=30,
    bestEffort=True,
).getInfo()

print(f"NDVI 均值: {ndvi_stats.get('NDVI', 'N/A')}")

# %% 6. 计算LST (地表温度)
# Landsat C02 L2 ST_B10: LST(K) = ST_B10 * 0.00341802 + 149.0
lst_c = (composite.select("ST_B10").multiply(0.00341802).add(149.0)
         .subtract(273.15).rename("LST_C"))

# LST统计
lst_stats = lst_c.reduceRegion(
    reducer=ee.Reducer.mean(),
    geometry=region,
    scale=100,
    bestEffort=True,
).getInfo()

print(f"LST 均值: {lst_stats.get('LST_C', 'N/A')} °C")

# %% 7. 计算NDBI (建筑指数)
ndbi = composite.normalizedDifference(["SR_B6", "SR_B5"]).rename("NDBI")

ndbi_stats = ndbi.reduceRegion(
    reducer=ee.Reducer.mean(),
    geometry=region,
    scale=30,
    bestEffort=True,
).getInfo()

print(f"NDBI 均值: {ndbi_stats.get('NDBI', 'N/A')}")

# %% 8. 可视化 (gee_map)
try:
    import geemap
    Map = geemap.Map()
    Map.centerObject(region, 15)
    Map.addLayer(composite, {"bands": ["SR_B4", "SR_B3", "SR_B2"], "min": 0, "max": 3000}, "真彩色")
    Map.addLayer(ndvi, {"min": 0, "max": 1, "palette": ["white", "green"]}, "NDVI")
    Map.addLayer(lst_c, {"min": 25, "max": 45, "palette": ["blue", "yellow", "red"]}, "LST (°C)")
    Map
except ImportError:
    print("geemap未安装, 请运行: pip install geemap")

# %% 9. 导出到Google Drive
# 取消下面注释以执行导出
# task = ee.batch.Export.image.toDrive(
#     image=lst_c.clip(region),
#     description="campus_lst_2025",
#     folder="GEE_LCZ",
#     scale=100,
#     crs="EPSG:4326",
#     maxPixels=1e13,
# )
# task.start()
# print(f"导出任务启动: {task.id}")
# print("查看任务状态: earthengine task list")

# %% [markdown]
# ## 下一步
#
# 1. 将导出的GeoTIFF放入 `Data_prcessing/gee_data/` 目录
# 2. 运行 `lcz_pipeline.py` 进行LCZ分类
# 3. 分类结果将作为RAG知识库的静态下垫面特征

print("GEE示例完成!")
