/**
 * ============================================================================
 * 影像图层管理器
 * ============================================================================
 *
 * 负责底图的加载与切换，支持街道图和卫星图两种模式。
 * 基于 Cesium ImageryLayer API 实现图层叠加与覆盖。
 *
 * @module layers/ImageryLayerManager
 */

import * as Cesium from "cesium";
import type { Viewer } from "cesium";
import {
  DEFAULT_SATELLITE_IMAGERY_CONFIG,
  DEFAULT_STREET_IMAGERY_CONFIG,
} from "../core/constants";

// =============================================================================
// 类型定义
// =============================================================================

/** 底图类型枚举 */
export type ImageryType = "street" | "satellite";

/** 底图图层记录 */
interface ImageryRecord {
  type: ImageryType;
  layer: Cesium.ImageryLayer;
  provider: Cesium.ImageryProvider;
}

// =============================================================================
// 常量配置
// =============================================================================

/** 卫星影像配置（Esri World Imagery） */
const SATELLITE_CONFIG = DEFAULT_SATELLITE_IMAGERY_CONFIG;

/** 街道/地形底图配置（ArcGIS World Topographic Map） */
const STREET_CONFIG = DEFAULT_STREET_IMAGERY_CONFIG;

// =============================================================================
// ImageryLayerManager 主类
// =============================================================================

export class ImageryLayerManager {
  // =============================================================================
  // 私有属性
  // =============================================================================

  private readonly _viewer: Viewer;
  private _layers: Map<ImageryType, ImageryRecord> = new Map();
  private _activeType: ImageryType = "satellite";

  // =============================================================================
  // 构造函数
  // =============================================================================

  constructor(viewer: Viewer) {
    if (!viewer) {
      throw new Error("[ImageryLayerManager] viewer 不能为空");
    }
    this._viewer = viewer;
    this._initLayers();
  }

  // =============================================================================
  // 公开只读属性
  // =============================================================================

  /** 当前激活的底图类型 */
  public get activeType(): ImageryType {
    return this._activeType;
  }

  /** 是否为卫星模式 */
  public get isSatelliteMode(): boolean {
    return this._activeType === "satellite";
  }

  /** 是否为街道模式 */
  public get isStreetMode(): boolean {
    return this._activeType === "street";
  }

  // =============================================================================
  // 核心方法
  // =============================================================================

  /**
   * 切换底图类型
   *
   * 将目标底图层置顶，同时隐藏其他底图层。
   * 若目标图层尚未创建，则自动创建后再切换。
   *
   * @param type 目标底图类型 ('street' | 'satellite')
   * @example
   * ```typescript
   * const imagery = new ImageryLayerManager(viewer);
   * imagery.switchTo('satellite'); // 切换至卫星图
   * imagery.switchTo('street');   // 切换至街道图
   * ```
   */
  public switchTo(type: ImageryType): void {
    if (type === this._activeType) {
      console.debug(`[ImageryLayerManager] 当前已是 ${type} 模式，无需切换`);
      return;
    }

    // 隐藏当前图层
    const current = this._layers.get(this._activeType);
    if (current) {
      current.layer.show = false;
    }

    // 显示/创建目标图层
    let target = this._layers.get(type);
    if (!target) {
      target = this._createLayer(type);
      this._layers.set(type, target);
    }
    target.layer.show = true;

    // 同步 imageryLayers 层级（确保目标在最上层）
    try {
      const imageryLayers = this._viewer.imageryLayers;
      if (imageryLayers && target.layer !== imageryLayers.get(imageryLayers.length - 1)) {
        imageryLayers.raiseToTop(target.layer);
      }
    } catch {
      // 忽略层级调整失败
    }

    this._activeType = type;
    console.info(`[ImageryLayerManager] ✅ 已切换至 ${type === "satellite" ? "卫星图" : "地形图"}`);
  }

  /**
   * 切换至卫星图
   */
  public switchToSatellite(): void {
    this.switchTo("satellite");
  }

  /**
   * 切换至地形图
   */
  public switchToStreet(): void {
    this.switchTo("street");
  }

  /**
   * 切换至另一种底图（自动翻转）
   */
  public toggle(): void {
    this.switchTo(this._activeType === "street" ? "satellite" : "street");
  }

  /**
   * 获取图层透明度
   */
  public getOpacity(type?: ImageryType): number {
    const targetType = type ?? this._activeType;
    const record = this._layers.get(targetType);
    return record ? record.layer.alpha : 1.0;
  }

  /**
   * 设置图层透明度
   */
  public setOpacity(type: ImageryType, opacity: number): void {
    const record = this._layers.get(type);
    if (record) {
      record.layer.alpha = Math.max(0, Math.min(1, opacity));
    }
  }

  /**
   * 销毁管理器，释放所有图层资源
   */
  public async destroy(): Promise<void> {
    this._layers.forEach((record) => {
      try {
        this._viewer.imageryLayers.remove(record.layer, true);
      } catch (e) {
        // 忽略已销毁错误
      }
    });
    this._layers.clear();
    console.info("[ImageryLayerManager] ✅ 已销毁");
  }

  // =============================================================================
  // 私有方法
  // =============================================================================

  /** 初始化两个底图层（尝试复用已有图层，否则新建） */
  private _initLayers(): void {
    const imageryLayers = this._viewer.imageryLayers;

    // 检查是否已有底图图层（由 ViewerManager 自动创建的）
    let existingStreetLayer: Cesium.ImageryLayer | null = null;
    let existingSatelliteLayer: Cesium.ImageryLayer | null = null;
    for (let i = 0; i < imageryLayers.length; i++) {
      const existing = imageryLayers.get(i);
      const url = String((existing.imageryProvider as any)?.url ?? "");
      if (url.includes("world-topo") || url.includes("World_Topo_Map")) {
        existingStreetLayer = existing;
      }
      if (url.includes("world-imagery") || url.includes("World_Imagery")) {
        existingSatelliteLayer = existing;
      }
    }

    if (existingStreetLayer) {
      // 复用已有的地形图层
      this._layers.set("street", {
        type: "street",
        layer: existingStreetLayer,
        provider: existingStreetLayer.imageryProvider as any,
      });
      existingStreetLayer.show = false;
      console.info("[ImageryLayerManager] 复用已有的地形底图");
    } else {
      // 无已有图层，新建地形底图
      const streetRecord = this._createLayer("street");
      streetRecord.layer.show = false;
      this._layers.set("street", streetRecord);
      console.info("[ImageryLayerManager] 新建地形底图");
    }

    if (existingSatelliteLayer) {
      this._layers.set("satellite", {
        type: "satellite",
        layer: existingSatelliteLayer,
        provider: existingSatelliteLayer.imageryProvider as any,
      });
      existingSatelliteLayer.show = true;
      console.info("[ImageryLayerManager] 复用已有的卫星底图");
    } else {
      const satelliteRecord = this._createLayer("satellite");
      satelliteRecord.layer.show = true;
      this._layers.set("satellite", satelliteRecord);
      console.info("[ImageryLayerManager] 新建卫星底图");
    }

    console.info("[ImageryLayerManager] 底图图层初始化完成，默认：卫星图");
  }

  /** 创建指定类型的影像图层 */
  private _createLayer(type: ImageryType): ImageryRecord {
    const config = type === "satellite" ? SATELLITE_CONFIG : STREET_CONFIG;

    const provider = new Cesium.UrlTemplateImageryProvider({
      url: config.url,
      credit: config.credit,
      minimumLevel: config.minimumLevel,
      maximumLevel: config.maximumLevel,
    });

    // Cesium 使用 addImageryProvider 而非 add
    const imageryLayers = this._viewer.imageryLayers;
    if (!imageryLayers) {
      throw new Error("[ImageryLayerManager] viewer.imageryLayers 不可用，请确认 Viewer 已完整初始化");
    }
    const layer = imageryLayers.addImageryProvider(provider);

    return { type, layer, provider };
  }
}
