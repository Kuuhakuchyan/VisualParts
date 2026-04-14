import os
import geopandas as gpd
import rasterio
from rasterio.mask import mask
from rasterio.crs import CRS

def clip_raster_by_shp(raster_folder, shp_path, output_folder):
    # 读取shp文件
    gdf = gpd.read_file(shp_path)

    # 获取栅格文件夹的名称
    folder_name = os.path.basename(raster_folder)

    # 创建新的输出文件夹
    new_output_folder = os.path.join(output_folder, folder_name)
    if not os.path.exists(new_output_folder):
        os.makedirs(new_output_folder)

    # 获取栅格文件夹中的所有tif文件
    raster_files = [f for f in os.listdir(raster_folder) if f.endswith('.tif')]

    # 遍历栅格文件夹中的每个tif文件
    for raster_file in raster_files:
        raster_path = os.path.join(raster_folder, raster_file)

        # 读取栅格数据
        with rasterio.open(raster_path) as src:
            # 获取栅格数据的元数据
            src_meta = src.meta

            if src.crs:
                gdf_crs = CRS.from_user_input(gdf.crs) if gdf.crs else None
                src_crs = CRS.from_user_input(src.crs) if src.crs else None

                if gdf_crs != src_crs:
                    gdf_projected = gdf.to_crs(src.crs)
                else:
                    gdf_projected = gdf
            else:
                gdf_projected = gdf

            # 遍历shp文件中的每个区域
            for index, row in gdf_projected.iterrows():
                # 获取当前区域的几何形状
                geometry_projected = row['geometry']

                # 使用区域的几何形状裁剪栅格数据
                out_image, out_transform = mask(src, [geometry_projected], crop=True)

                # 更新元数据
                out_meta = src_meta.copy()
                out_meta.update({
                    "driver": "GTiff",
                    "height": out_image.shape[1],
                    "width": out_image.shape[2],
                    "transform": out_transform
                })

                # 保存裁剪后的栅格数据，保留原始名称并添加裁剪区域的索引
                base_filename = os.path.splitext(raster_file)[0]
                out_filename = os.path.join(new_output_folder, f"{base_filename}_clip_{index}.tif")
                with rasterio.open(out_filename, "w", **out_meta) as dest:
                    dest.write(out_image)

raster_folder = r"C:\GIS DATA\Weather\wc2.1_cruts4.09_2.5m_tmin_2020-2024"# 设置需要裁剪的tif文件夹路径

shp_path = r"C:\Users\123\Desktop\新建文件夹(1)\新建文件夹\TW_boundary.shp"  # 设置shp路径

output_folder = r"C:\GIS DATA\Weather\cliped"# 设置结果保存路径

# 调用函数实现裁剪
clip_raster_by_shp(raster_folder, shp_path, output_folder)
