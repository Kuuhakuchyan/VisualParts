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

// =============================================================================
// 类型定义
// =============================================================================

/** 底图类型枚举 */
export type ImageryType = "street" | "satellite";

/** 底图图层记录 */
interface ImageryRecord {
  type: ImageryType;
  layer: Cesium.ImageryLayer;
  provider: Cesium.UrlTemplateImageryProvider | Cesium.OpenStreetMapImageryProvider;
}

// =============================================================================
// 常量配置
// =============================================================================

/** 卫星影像配置（Esri World Imagery） */
const SATELLITE_CONFIG = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  credit: "Esri World Imagery",
  minimumLevel: 0,
  maximumLevel: 19,
};

/** 街道底图配置（OSM） */
const STREET_CONFIG = {
  url: "https://tile.openstreetmap.org/",
  credit: "© OpenStreetMap contributors",
  minimumLevel: 1,
  maximumLevel: 19,
};

// =============================================================================
// ImageryLayerManager 主类
// =============================================================================

export class ImageryLayerManager {
  // =============================================================================
  // 私有属性
  // =============================================================================

  private readonly _viewer: Viewer;
  private _layers: Map<ImageryType, ImageryRecord> = new Map();
  private _activeType: ImageryType = "street";

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
    console.info(`[ImageryLayerManager] ✅ 已切换至 ${type === "satellite" ? "卫星图" : "街道图"}`);
  }

  /**
   * 切换至卫星图
   */
  public switchToSatellite(): void {
    this.switchTo("satellite");
  }

  /**
   * 切换至街道图
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

    // 检查是否已有 OSM 图层（由 ViewerManager 自动创建的）
    let existingOsmLayer: Cesium.ImageryLayer | null = null;
    for (let i = 0; i < imageryLayers.length; i++) {
      const existing = imageryLayers.get(i);
      const url = (existing.imageryProvider as any)?.url ?? "";
      if (url.includes("openstreetmap") || url.includes("tile.openstreetmap")) {
        existingOsmLayer = existing;
        break;
      }
    }

    if (existingOsmLayer) {
      // 复用已有的 OSM 图层
      this._layers.set("street", {
        type: "street",
        layer: existingOsmLayer,
        provider: existingOsmLayer.imageryProvider as any,
      });
      existingOsmLayer.show = true;
      console.info("[ImageryLayerManager] 复用已有的 OSM 底图");
    } else {
      // 无已有图层，新建 OSM
      const streetRecord = this._createLayer("street");
      streetRecord.layer.show = true;
      this._layers.set("street", streetRecord);
      console.info("[ImageryLayerManager] 新建 OSM 底图");
    }

    // 卫星图层（默认隐藏）
    const satelliteRecord = this._createLayer("satellite");
    satelliteRecord.layer.show = false;
    this._layers.set("satellite", satelliteRecord);

    console.info("[ImageryLayerManager] 底图图层初始化完成，默认：街道图");
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