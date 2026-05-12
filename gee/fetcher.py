"""
GEE遥感数据获取模块
核心功能: Landsat影像检索 → 云掩膜 → 指数计算 → LST反演 → 数据导出

技术参考:
  - Pan et al. (2025) Atmosphere — LCZ分类方法
  - Qin et al. (2001) IEEE TGRS — SMW单窗算法LST反演
"""

import ee
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import date
from typing import Optional

from gee.config import (
    initialize_gee, get_gee_project_id, get_study_region, get_date_range,
    STUDY_AREA, LANDSAT_COLLECTIONS, BAND_MAP_L8, CLOUD_FILTER,
    GEE_DATA_DIR, LCZ_RF_PARAMS
)


class GEEFetcher:
    """
    GEE遥感数据获取器
    封装Landsat影像检索、云掩膜、指数计算、LST反演
    """

    def __init__(self, study_area: Optional[dict] = None):
        if study_area:
            self.study_area = study_area
        else:
            self.study_area = STUDY_AREA

        self.region = ee.Geometry.Rectangle([
            self.study_area["min_lon"], self.study_area["min_lat"],
            self.study_area["max_lon"], self.study_area["max_lat"]
        ])

    # -----------------------------------------------------------
    # 1. Landsat影像检索与预处理
    # -----------------------------------------------------------

    def search_landsat(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_cloud: int = CLOUD_FILTER["max_cloud_percent"],
        collection_id: str = "L8_SR",
    ) -> ee.ImageCollection:
        """
        检索研究区的Landsat影像，按云量过滤

        Args:
            start_date: 开始日期 YYYY-MM-DD
            end_date: 结束日期 YYYY-MM-DD
            max_cloud: 最大云量百分比
            collection_id: 集合ID ('L8_SR' 或 'L9_SR')

        Returns:
            过滤后的ImageCollection
        """
        if not start_date or not end_date:
            start_date, end_date = get_date_range()

        collection = (
            ee.ImageCollection(LANDSAT_COLLECTIONS[collection_id])
            .filterBounds(self.region)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.lte("CLOUD_COVER", max_cloud))
        )

        count = collection.size().getInfo()
        print(f"[GEE] Landsat检索结果: {count} 景影像 ({start_date} ~ {end_date})")

        if count == 0:
            print("[GEE] ⚠ 未找到符合条件影像，尝试扩大时间范围或增加云量阈值")
            return collection

        # 打印影像元数据
        info = collection.aggregate_histogram("CLOUD_COVER").getInfo()
        if info:
            avg_cloud = sum(float(k) * v for k, v in info.items()) / sum(info.values())
            print(f"[GEE] 平均云量: {avg_cloud:.1f}%")

        return collection

    def mask_clouds(self, image: ee.Image) -> ee.Image:
        """
        Landsat C02 L2 QA_PIXEL云掩膜

        QA_PIXEL Bit说明:
          Bit 0: Fill
          Bit 1: Dilated Cloud
          Bit 2: Cirrus
          Bit 3: Cloud
          Bit 4: Cloud Shadow
        """
        qa = image.select(BAND_MAP_L8["QA_PIXEL"])
        cloud_bit_mask = (1 << 3) | (1 << 4) | (1 << 1)
        mask = qa.bitwiseAnd(cloud_bit_mask).eq(0)
        return image.updateMask(mask)

    def get_best_composite(self, collection: ee.ImageCollection) -> ee.Image:
        """
        从影像集合中生成最佳合成影像（中值合成 + 云掩膜）

        Returns:
            云掩膜后的中值合成影像
        """
        collection = collection.map(self.mask_clouds)
        composite = collection.median().clip(self.region)
        return composite

    # -----------------------------------------------------------
    # 2. 遥感指数计算
    # -----------------------------------------------------------

    def calc_ndvi(self, image: ee.Image) -> ee.Image:
        """
        计算NDVI (归一化植被指数)
        NDVI = (NIR - RED) / (NIR + RED)
        """
        nir = image.select(BAND_MAP_L8["NIR"])
        red = image.select(BAND_MAP_L8["RED"])
        return nir.subtract(red).divide(nir.add(red)).rename("NDVI")

    def calc_ndbi(self, image: ee.Image) -> ee.Image:
        """
        计算NDBI (归一化建筑指数)
        NDBI = (SWIR1 - NIR) / (SWIR1 + NIR)
        """
        swir1 = image.select(BAND_MAP_L8["SWIR1"])
        nir = image.select(BAND_MAP_L8["NIR"])
        return swir1.subtract(nir).divide(swir1.add(nir)).rename("NDBI")

    def calc_mndwi(self, image: ee.Image) -> ee.Image:
        """
        计算MNDWI (改进归一化水体指数)
        MNDWI = (GREEN - SWIR1) / (GREEN + SWIR1)
        """
        green = image.select(BAND_MAP_L8["GREEN"])
        swir1 = image.select(BAND_MAP_L8["SWIR1"])
        return green.subtract(swir1).divide(green.add(swir1)).rename("MNDWI")

    def calc_albedo(self, image: ee.Image) -> ee.Image:
        """
        计算地表反照率 (Liang et al., 2001 窄-宽波段转换)
        albedo = 0.356*B2 + 0.130*B4 + 0.373*B5 + 0.085*B6 + 0.072*B7 - 0.0018
        (适用于Landsat 8/9 OLI)
        """
        b2 = image.select(BAND_MAP_L8["BLUE"])
        b4 = image.select(BAND_MAP_L8["RED"])
        b5 = image.select(BAND_MAP_L8["NIR"])
        b6 = image.select(BAND_MAP_L8["SWIR1"])
        b7 = image.select(BAND_MAP_L8["SWIR2"])

        albedo = (
            b2.multiply(0.356)
            .add(b4.multiply(0.130))
            .add(b5.multiply(0.373))
            .add(b6.multiply(0.085))
            .add(b7.multiply(0.072))
            .subtract(0.0018)
        ).rename("ALBEDO")

        return albedo.clamp(0, 1)

    def calc_all_indices(self, image: ee.Image) -> ee.Image:
        """一次性计算所有遥感指数"""
        ndvi = self.calc_ndvi(image)
        ndbi = self.calc_ndbi(image)
        mndwi = self.calc_mndwi(image)
        albedo = self.calc_albedo(image)
        return image.addBands([ndvi, ndbi, mndwi, albedo])

    # -----------------------------------------------------------
    # 3. LST反演 (Statistical Mono-Window, SMW算法)
    #    Qin et al. (2001) IEEE TGRS
    # -----------------------------------------------------------

    def calc_lst_smw(
        self,
        image: ee.Image,
        emissivity: float = 0.95,
        transmissivity: float = 0.75,
    ) -> ee.Image:
        """
        统计单窗算法(SMW)反演地表温度(LST)

        LST = [a * (1 - C - D) + (b * (1 - C - D) + C + D) * T_b - D * T_a] / C

        其中:
          C = τ * ε
          D = (1 - τ) * [1 + τ * (1 - ε)]
          a, b = 算法系数 (-67.355351, 0.458606)
          T_b = 大气顶层亮温 (K)
          T_a = 大气有效平均温度 (K)
          τ = 大气透过率
          ε = 地表比辐射率

        Args:
            image: Landsat SR影像(含ST_B10波段)
            emissivity: 地表比辐射率 (默认0.95)
            transmissivity: 大气透过率 (默认0.75, 晴空)

        Returns:
            LST影像 (°C)
        """
        tir_band = BAND_MAP_L8["TIR"]

        # Landsat C02 L2 ST_B10: 地表温度(缩放后)
        # 缩放: LST(K) = ST_B10 * 0.00341802 + 149.0
        lst_k = (
            image.select(tir_band)
            .multiply(0.00341802)
            .add(149.0)
        )

        # 转换为°C
        lst_c = lst_k.subtract(273.15).rename("LST_SMW")

        return lst_c

    def calc_lst_emissivity(
        self, ndvi: ee.Image, ndvi_soil: float = 0.2, ndvi_veg: float = 0.5
    ) -> ee.Image:
        """
        基于NDVI估算地表比辐射率 (Sobrino et al., 2004)

        ε = ε_v * P_v + ε_s * (1 - P_v) + dε

        其中:
          ε_v = 0.985, ε_s = 0.960 (热红外波段)
          P_v = ((NDVI - NDVI_s) / (NDVI_v - NDVI_s))²
          dε = 0.005
        """
        eps_v = 0.985  # 植被比辐射率
        eps_s = 0.960  # 裸土比辐射率
        de = 0.005  # 空腔效应修正

        pv = (
            ndvi.subtract(ndvi_soil)
            .divide(ndvi_veg - ndvi_soil)
            .pow(2)
            .clamp(0, 1)
        )

        emissivity = (
            pv.multiply(eps_v)
            .add(ee.Image.constant(1).subtract(pv).multiply(eps_s))
            .add(de)
        ).rename("EMISSIVITY")

        return emissivity

    # -----------------------------------------------------------
    # 4. LCZ训练样本生成与分类
    # -----------------------------------------------------------

    def create_lcz_training_data(
        self,
        sample_points: list,
        lcz_labels: list,
        feature_image: ee.Image,
    ) -> ee.FeatureCollection:
        """
        创建LCZ分类训练样本

        Args:
            sample_points: 样本点列表 [(lon, lat), ...]
            lcz_labels: 对应LCZ标签 [1, 2, ..., "A", ...]
            feature_image: 特征影像 (含NDVI, NDBI, LST等波段)

        Returns:
            带标签的训练样本FeatureCollection
        """
        features = []
        for (lon, lat), label in zip(sample_points, lcz_labels):
            point = ee.Feature(ee.Geometry.Point(lon, lat), {"lcz": label})
            features.append(point)

        points_fc = ee.FeatureCollection(features)
        return feature_image.sampleRegions(
            collection=points_fc,
            properties=["lcz"],
            scale=30,
        )

    def classify_lcz_rf(
        self,
        training_data: ee.FeatureCollection,
        feature_image: ee.Image,
    ) -> ee.Image:
        """
        随机森林LCZ分类

        Args:
            training_data: 训练样本
            feature_image: 特征影像

        Returns:
            LCZ分类结果影像
        """
        classifier = ee.Classifier.smileRandomForest(**LCZ_RF_PARAMS)
        trained = classifier.train(training_data, "lcz", feature_image.bandNames())
        return feature_image.classify(trained).rename("LCZ")

    # -----------------------------------------------------------
    # 5. 完整处理管线
    # -----------------------------------------------------------

    def full_pipeline(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> dict:
        """
        完整GEE处理管线:
          Landsat检索 → 云掩膜合成 → 指数计算 → LST反演 → 数据导出

        Returns:
            包含各结果影像的字典
        """
        print("=" * 60)
        print("GEE数据获取管线启动")
        print("=" * 60)

        # Step 1: 检索Landsat影像
        collection = self.search_landsat(start_date, end_date)
        count = collection.size().getInfo()
        if count == 0:
            return {"error": "无可用影像"}

        # Step 2: 最佳合成
        composite = self.get_best_composite(collection)

        # Step 3: 计算遥感指数
        ndvi = self.calc_ndvi(composite)
        ndbi = self.calc_ndbi(composite)
        mndwi = self.calc_mndwi(composite)
        albedo = self.calc_albedo(composite)

        # Step 4: 计算比辐射率
        emissivity = self.calc_lst_emissivity(ndvi)

        # Step 5: LST反演
        lst = self.calc_lst_smw(composite, emissivity=0.97)

        # Step 6: 合并
        result = composite.addBands([ndvi, ndbi, mndwi, albedo, emissivity, lst])

        return {
            "composite": composite,
            "ndvi": ndvi,
            "ndbi": ndbi,
            "mndwi": mndwi,
            "albedo": albedo,
            "emissivity": emissivity,
            "lst": lst,
            "full": result,
            "region": self.region,
            "date": date.today().isoformat(),
        }

    # -----------------------------------------------------------
    # 6. 数据导出 (导出到Google Drive)
    # -----------------------------------------------------------

    def export_to_drive(
        self,
        image: ee.Image,
        description: str,
        folder: str = "GEE_LCZ",
        scale: int = 30,
        crs: str = "EPSG:4326",
    ):
        """
        将影像导出到Google Drive

        Args:
            image: 要导出的影像
            description: 任务描述 (导出文件名)
            folder: Google Drive文件夹名
            scale: 分辨率 (m)
            crs: 坐标系
        """
        task = ee.batch.Export.image.toDrive(
            image=image.clip(self.region),
            description=description,
            folder=folder,
            fileNamePrefix=description,
            scale=scale,
            crs=crs,
            maxPixels=1e13,
        )
        task.start()
        print(f"[GEE] 导出任务已启动: {description}")
        print(f"      目标: Google Drive/{folder}/{description}")
        print(f"      分辨率: {scale}m | 坐标系: {crs}")
        print(f"      任务ID: {task.id}")
        return task

    def export_all_results(self, results: dict):
        """批量导出所有处理结果到Google Drive"""
        exports = []

        exports.append(self.export_to_drive(
            results["ndvi"], "lcz_ndvi", scale=30
        ))
        exports.append(self.export_to_drive(
            results["ndbi"], "lcz_ndbi", scale=30
        ))
        exports.append(self.export_to_drive(
            results["albedo"], "lcz_albedo", scale=30
        ))
        exports.append(self.export_to_drive(
            results["lst"], "lcz_lst_smw", scale=100
        ))
        exports.append(self.export_to_drive(
            results["emissivity"], "lcz_emissivity", scale=30
        ))

        print(f"[GEE] 共启动 {len(exports)} 个导出任务")
        return exports

    # -----------------------------------------------------------
    # 7. 区域统计
    # -----------------------------------------------------------

    def zonal_stats(self, image: ee.Image, reducer: str = "mean") -> dict:
        """
        计算研究区内的影像统计值

        Args:
            image: 输入影像 (单波段)
            reducer: 统计类型 ('mean', 'min', 'max', 'stdDev')

        Returns:
            统计值字典
        """
        reducer_map = {
            "mean": ee.Reducer.mean(),
            "min": ee.Reducer.min(),
            "max": ee.Reducer.max(),
            "stdDev": ee.Reducer.stdDev(),
        }

        stat = image.reduceRegion(
            reducer=reducer_map.get(reducer, ee.Reducer.mean()),
            geometry=self.region,
            scale=30,
            bestEffort=True,
        )

        info = stat.getInfo()
        band_name = image.bandNames().get(0).getInfo()
        value = info.get(band_name, "N/A")

        print(f"[GEE] 区域{reducer}: {band_name} = {value}")

        return {band_name: value}


def main():
    """
    主入口: 测试GEE连接并运行完整管线
    """
    if not initialize_gee():
        print("[错误] GEE初始化失败，请先完成认证")
        return

    fetcher = GEEFetcher()

    # 测试连接
    region = fetcher.region
    area_km2 = region.area().getInfo() / 1e6
    print(f"研究区面积: {area_km2:.2f} km²")

    # 搜索可用影像
    collection = fetcher.search_landsat()
    count = collection.size().getInfo()

    if count > 0:
        print(f"\n可用的Landsat影像: {count} 景")

        # 运行完整管线
        results = fetcher.full_pipeline()
        if "error" not in results:
            print("\n管线执行成功!")
            print(f"  影像日期: {results['date']}")
            print(f"  波段数: {results['full'].bandNames().size().getInfo()}")

            # 统计LST均值
            lst_stats = fetcher.zonal_stats(results["lst"], reducer="mean")
            print(f"  研究区平均LST: {lst_stats} °C")

            print("\n如需导出到Google Drive，请调用:")
            print("  fetcher.export_all_results(results)")
    else:
        print("\n当前无可用Landsat影像")
        print("提示: 可调整时间范围或云量阈值")


if __name__ == "__main__":
    main()
