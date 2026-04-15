/**
 * ============================================================================
 * 动态建筑建造图层管理器
 * ============================================================================
 *
 * 本模块为"城市微环境决策支持系统"提供动态建造新建筑的能力。
 *
 * 核心职责：
 * 1. **建造交互**：点击地图放置建筑，实时预览建造位置
 * 2. **多类型支持**：住宅 / 商业 / 办公 / 工业 / 公共设施，颜色各异
 * 3. **多形状支持**：方形（Box）、圆形（Cylinder）、L形、T形（复合体）
 * 4. **生命周期管理**：建筑实体的添加、删除、清空、销毁
 *
 * @module layers/BuildingBuilderLayer
 */

import * as Cesium from "cesium";
import type { Viewer } from "cesium";

// =============================================================================
// 类型定义
// =============================================================================

/** 建筑类型枚举 */
export type BuildingType = "residential" | "commercial" | "office" | "industrial" | "public";

/** 建筑形状枚举 */
export type BuildingShape = "box" | "cylinder" | "l-shape" | "t-shape";

/** 建筑建造参数 */
export interface BuildingOptions {
  /** 建筑类型（决定颜色主题） */
  type?: BuildingType;
  /** 形状 */
  shape?: BuildingShape;
  /** 高度（米） */
  height?: number;
  /** 底面宽度（米） */
  width?: number;
  /** 底面深度（米，仅 box/l-shape/t-shape） */
  depth?: number;
  /** 底面半径（米，仅 cylinder） */
  radius?: number;
  /** 颜色透明度 0~1 */
  alpha?: number;
  /** 楼层层数（自动换算高度） */
  floors?: number;
  /** 每层标准高度（米） */
  floorHeight?: number;
}

/** 单栋建筑记录 */
export interface BuildingRecord {
  /** 唯一 ID（前端临时 ID，如 building_5） */
  id: string;
  /** 数据库 UUID（如果已写入数据库） */
  dbId?: string;
  /** Cesium Entity 实例 */
  entity: Cesium.Entity;
  /** 建筑类型 */
  type: BuildingType;
  /** 形状 */
  shape: BuildingShape;
  /** 中心经度 */
  longitude: number;
  /** 中心纬度 */
  latitude: number;
  /** 地面高度 */
  height: number;
  /** 建筑总高度 */
  buildingHeight: number;
  /** 创建时间戳 */
  createdAt: number;
}

// =============================================================================
// 常量配置
// =============================================================================

/** 各类型建筑的默认颜色 */
const BUILDING_COLORS: Record<BuildingType, Cesium.Color> = {
  residential: Cesium.Color.fromCssColorString("#F5D78E"),  // 浅黄色（住宅）
  commercial:  Cesium.Color.fromCssColorString("#89A8C9"), // 蓝灰色（商业）
  office:      Cesium.Color.fromCssColorString("#4A6FA5"), // 深蓝色（办公）
  industrial:  Cesium.Color.fromCssColorString("#8C8C8C"), // 灰色（工业）
  public:      Cesium.Color.fromCssColorString("#7EC8A4"), // 绿色（公共设施）
};

/** 所有建筑类型的统一兜底色 */
const FALLBACK_COLOR = Cesium.Color.fromCssColorString("#AAAAAA");

/** 各类型建筑的默认透明度 */
const BUILDING_ALPHA: Record<BuildingType, number> = {
  residential: 0.85,
  commercial:  0.80,
  office:      0.80,
  industrial:  0.75,
  public:      0.85,
};

/** 默认参数 */
const DEFAULTS = {
  type:        "residential" as BuildingType,
  shape:       "box" as BuildingShape,
  height:      30,           // 30米
  width:       20,           // 20米
  depth:       20,           // 20米
  radius:      12,           // 12米
  floorHeight: 3,            // 每层3米
};

// =============================================================================
// BuildingBuilderLayer 主类
// =============================================================================

export class BuildingBuilderLayer {
  // =============================================================================
  // 事件回调
  // =============================================================================

  /** 建筑建造完成回调 (buildingId, lon, lat, height, type) => void */
  public onBuildingPlaced: ((
    id: string,
    lon: number,
    lat: number,
    height: number,
    type: BuildingType
  ) => void) | null = null;

  // =============================================================================
  // 私有属性
  // =============================================================================

  private readonly _viewer: Viewer;
  private _buildings: Map<string, BuildingRecord> = new Map();
  private _placementMode: boolean = false;
  private _currentOptions: BuildingOptions = {};
  private _previewEntity: Cesium.Entity | null = null;
  private _previewPosition: Cesium.Cartesian3 | null = null;
  private _previewGroundHeight: number = 0;
  private _handler: Cesium.ScreenSpaceEventHandler | null = null;
  private _mouseMoveHandler: Cesium.ScreenSpaceEventHandler | null = null;
  private _escHandler: ((e: KeyboardEvent) => void) | null = null;
  private _buildingCounter: number = 0;
  private _activeBuilderLayer: Cesium.Entity | null = null;

  // 缓存 material，避免重复创建
  private _materialCache: Map<string, Cesium.ColorMaterialProperty> = new Map();

  // =============================================================================
  // 构造函数
  // =============================================================================

  constructor(viewer: Viewer) {
    if (!viewer) {
      throw new Error("[BuildingBuilderLayer] viewer 不能为空");
    }
    this._viewer = viewer;
    this._activeBuilderLayer = new Cesium.Entity({ id: "__builderLayer__" });
    this._viewer.entities.add(this._activeBuilderLayer);
  }

  // =============================================================================
  // 公开只读属性
  // =============================================================================

  /** 已建造建筑数量 */
  public get buildingCount(): number {
    return this._buildings.size;
  }

  /** 是否处于放置模式 */
  public get isPlacing(): boolean {
    return this._placementMode;
  }

  /** 获取所有建筑记录 */
  public get buildings(): BuildingRecord[] {
    return Array.from(this._buildings.values());
  }

  // =============================================================================
  // 核心方法
  // =============================================================================

  /**
   * 开始建造模式
   *
   * 调用此方法后，进入放置模式：
   * - 鼠标变为十字准心（cursor 样式）
   * - 鼠标移动时显示建筑预览（半透明幽灵）
   * - 点击地图放置建筑实体
   * - 按 ESC 退出放置模式
   *
   * @param options 建造参数（类型/形状/高度等），可后续在放置过程中调整
   */
  public startPlacement(options: BuildingOptions = {}): void {
    this._cancelPlacement();

    this._placementMode = true;
    this._currentOptions = { ...options };

    // 覆盖 canvas 样式
    const canvas = this._viewer.scene.canvas;
    canvas.style.cursor = "crosshair";

    // 创建预览实体（半透明幽灵）
    this._previewEntity = new Cesium.Entity({
      id: "__building_preview__",
      show: false,
    });
    this._viewer.entities.add(this._previewEntity);

    // 立即初始化预览到屏幕中心，避免"进入建造模式后预览消失"
    const canvasCenter = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const ray = this._viewer.camera.getPickRay(canvasCenter);
    if (Cesium.defined(ray)) {
      const centerPos = this._viewer.scene.globe.pick(ray, this._viewer.scene);
      if (Cesium.defined(centerPos) && !this._isInvalidPosition(centerPos)) {
        this._previewPosition = centerPos;
        const centerH = Cesium.Cartographic.fromCartesian(centerPos);
        this._previewGroundHeight = centerH.height ?? 0;
        this._updatePreviewAppearance();
        this._previewEntity!.show = true;
      }
    }

    // 鼠标移动 → 更新预览位置
    this._mouseMoveHandler = new Cesium.ScreenSpaceEventHandler(
      this._viewer.scene.canvas
    );
    this._mouseMoveHandler.setInputAction(
      this._onMouseMove.bind(this),
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    );

    // 点击 → 放置建筑
    this._handler = new Cesium.ScreenSpaceEventHandler(
      this._viewer.scene.canvas
    );
    this._handler.setInputAction(
      this._onLeftClick.bind(this),
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );

    // ESC → 退出放置模式
    this._escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.cancelPlacement();
      }
    };
    document.addEventListener("keydown", this._escHandler);

    console.debug("[BuildingBuilderLayer] 进入建造模式");
  }

  /**
   * 取消放置模式（不清除已建建筑）
   */
  public cancelPlacement(): void {
    if (!this._placementMode) return;
    this._cancelPlacement();
    console.debug("[BuildingBuilderLayer] 已退出建造模式");
  }

  /**
   * 更新当前建造参数（仅在放置模式下生效）
   */
  public updateOptions(options: Partial<BuildingOptions>): void {
    this._currentOptions = { ...this._currentOptions, ...options };

    if (this._previewEntity && this._previewPosition) {
      this._updatePreviewAppearance();
    }
  }

  /**
   * 直接在指定坐标放置一栋建筑（无需交互）
   *
   * @param longitude 经度
   * @param latitude 纬度
   * @param options 建筑参数
   * @param forcedGroundHeight 强制指定地面高度（米），不填则自动采样
   * @returns 建筑 ID，失败返回 null
   */
  public placeBuilding(
    longitude: number,
    latitude: number,
    options: BuildingOptions = {},
    forcedGroundHeight?: number
  ): string | null {
    const opts = this._mergeOptions(options);
    const id = `building_${++this._buildingCounter}`;
    const groundH = Math.max(0, forcedGroundHeight ?? this._getGroundHeight(longitude, latitude));

    console.debug(
      `[BuildingBuilderLayer.placeBuilding] id=${id} lon=${longitude} lat=${latitude} ` +
      `groundH=${groundH.toFixed(2)} buildingH=${opts.buildingHeight}`
    );

    try {
      const entity = this._buildEntityForShape(id, opts, longitude, latitude, groundH);
      console.debug(`[BuildingBuilderLayer.placeBuilding] entity 已创建，shape=${opts.shape}`);
      this._viewer.entities.add(entity);
      console.debug(`[BuildingBuilderLayer.placeBuilding] 已添加至 viewer.entities`);

      this._buildings.set(id, {
        id,
        entity,
        type: opts.type!,
        shape: opts.shape!,
        longitude,
        latitude,
        height: groundH,
        buildingHeight: opts.buildingHeight!,
        createdAt: Date.now(),
      });

      console.info(
        `[BuildingBuilderLayer] 建造完成：${id}（${opts.type}，${opts.shape}，高度${opts.buildingHeight}m）`
      );

      // 触发建造完成回调
      if (this.onBuildingPlaced) {
        this.onBuildingPlaced(id, longitude, latitude, opts.buildingHeight!, opts.type!);
      }

      return id;
    } catch (e) {
      console.error("[BuildingBuilderLayer] 建造失败：", e);
      return null;
    }
  }

  /**
   * 删除指定 ID 的建筑
   */
  public removeBuilding(id: string): boolean {
    const record = this._buildings.get(id);
    if (!record) {
      console.warn(`[BuildingBuilderLayer] 建筑不存在：${id}`);
      return false;
    }

    this._viewer.entities.remove(record.entity);
    this._buildings.delete(id);
    console.info(`[BuildingBuilderLayer] 已删除建筑：${id}`);
    return true;
  }

  /**
   * 将建筑写入后端数据库（持久化）
   *
   * 调用此方法将前端临时建筑写入 AGIDB，
   * 以便后续通过 ST_DWithin 查询影响范围。
   *
   * @param id - 前端建筑 ID（building_5 等）
   * @param buildingInfo - 建筑详细信息
   * @returns 数据库 UUID，失败返回 null
   */
  public async createBuildingInDb(
    id: string,
    buildingInfo: {
      name?: string;
      height: number;
      albedo?: number;
      baseTemp?: number;
      lon: number;
      lat: number;
    }
  ): Promise<string | null> {
    const record = this._buildings.get(id);
    if (!record) {
      console.warn(`[BuildingBuilderLayer] 建筑不存在，无法写入数据库：${id}`);
      return null;
    }

    try {
      const res = await fetch("/api/simulation/buildings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: buildingInfo.name ?? `${record.type}_${id}`,
          height: buildingInfo.height,
          albedo: buildingInfo.albedo ?? 0.3,
          baseTemp: buildingInfo.baseTemp ?? 30,
          lon: buildingInfo.lon,
          lat: buildingInfo.lat,
        }),
      });

      const data = await res.json();
      if (data.success && data.data?.id) {
        // 记录数据库 UUID
        record.dbId = data.data.id;
        this._buildings.set(id, record);
        console.info(`[BuildingBuilderLayer] 建筑已写入数据库: ${id} → ${data.data.id}`);
        return data.data.id;
      } else {
        console.error(`[BuildingBuilderLayer] 建筑写入数据库失败: ${data.message}`);
        return null;
      }
    } catch (err) {
      console.error(`[BuildingBuilderLayer] 调用后端 API 失败:`, err);
      return null;
    }
  }

  /**
   * 清空所有已建造的建筑
   */
  public clearAllBuildings(): number {
    const count = this._buildings.size;
    if (count === 0) return 0;

    this._buildings.forEach((record) => {
      this._viewer.entities.remove(record.entity);
    });
    this._buildings.clear();

    console.info(`[BuildingBuilderLayer] 已清空全部 ${count} 栋建筑`);
    return count;
  }

  /**
   * 根据建筑类型筛选获取
   */
  public getBuildingsByType(type: BuildingType): BuildingRecord[] {
    return this.buildings.filter((b) => b.type === type);
  }

  /**
   * 获取建造统计摘要
   */
  public getStats(): Record<BuildingType, number> & { total: number; avgHeight: number } {
    const stats: Record<BuildingType, number> & { total: number; avgHeight: number } = {
      residential: 0,
      commercial:  0,
      office:      0,
      industrial:  0,
      public:      0,
      total:       this._buildings.size,
      avgHeight:   0,
    };

    let totalHeight = 0;
    this._buildings.forEach((b) => {
      stats[b.type]++;
      totalHeight += b.buildingHeight;
    });

    if (stats.total > 0) {
      stats.avgHeight = parseFloat((totalHeight / stats.total).toFixed(1));
    }

    return stats;
  }

  /**
   * 销毁图层，释放所有资源
   */
  public async destroy(): Promise<void> {
    this._cancelPlacement();
    this.clearAllBuildings();

    if (this._activeBuilderLayer) {
      this._viewer.entities.remove(this._activeBuilderLayer);
      this._activeBuilderLayer = null;
    }

    this._materialCache.clear();
    console.info("[BuildingBuilderLayer] 图层已销毁");
  }

  // =============================================================================
  // 私有方法
  // =============================================================================

  /** 退出放置模式，清理交互句柄 */
  private _cancelPlacement(): void {
    this._placementMode = false;
    this._currentOptions = {};

    const canvas = this._viewer.scene.canvas;
    canvas.style.cursor = "default";

    if (this._previewEntity) {
      this._viewer.entities.remove(this._previewEntity);
      this._previewEntity = null;
    }
    this._previewPosition = null;
    this._previewGroundHeight = 0;

    if (this._handler) {
      this._handler.destroy();
      this._handler = null;
    }
    if (this._mouseMoveHandler) {
      this._mouseMoveHandler.destroy();
      this._mouseMoveHandler = null;
    }
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler);
      this._escHandler = null;
    }
  }

  /** 鼠标移动 → 更新预览位置和外观 */
  private _onMouseMove(movement: Cesium.ScreenSpaceEventHandler.MovementEvent): void {
    if (!this._placementMode) return;

    const ray = this._viewer.camera.getPickRay(movement.endPosition);
    if (!Cesium.defined(ray)) {
      if (this._previewEntity) this._previewEntity.show = false;
      return;
    }
    const cartesian = this._viewer.scene.globe.pick(ray, this._viewer.scene);
    if (!Cesium.defined(cartesian) || this._isInvalidPosition(cartesian)) {
      if (this._previewEntity) this._previewEntity.show = false;
      return;
    }

    this._previewPosition = cartesian;
    const cartH = Cesium.Cartographic.fromCartesian(cartesian);
    this._previewGroundHeight = cartH.height ?? 0;

    try {
      this._updatePreviewAppearance();
    } catch (e) {
      console.warn("[BuildingBuilderLayer] 预览更新失败：", e);
    }
    if (this._previewEntity) this._previewEntity.show = true;
  }

  /** 判断笛卡尔坐标是否无效（NaN 或靠近原点） */
  private _isInvalidPosition(cart: Cesium.Cartesian3): boolean {
    return (
      !Cesium.defined(cart) ||
      isNaN(cart.x) || isNaN(cart.y) || isNaN(cart.z) ||
      (Math.abs(cart.x) < 1e-10 && Math.abs(cart.y) < 1e-10 && Math.abs(cart.z) < 1e-10)
    );
  }

  /** 左键点击 → 放置建筑 */
  private _onLeftClick(movement: Cesium.ScreenSpaceEventHandler.PositionedEvent): void {
    if (!this._placementMode) return;
    if (!Cesium.defined(this._previewPosition) || this._isInvalidPosition(this._previewPosition)) {
      console.warn("[BuildingBuilderLayer] 预览位置无效，无法放置建筑");
      return;
    }

    const cart = Cesium.Cartographic.fromCartesian(this._previewPosition);
    if (!Cesium.defined(cart) || isNaN(cart.longitude) || isNaN(cart.latitude)) {
      console.warn("[BuildingBuilderLayer] 拾取位置无效，无法放置建筑");
      return;
    }

    const longitude = Cesium.Math.toDegrees(cart.longitude);
    const latitude  = Cesium.Math.toDegrees(cart.latitude);
    // Cartographic.height 才是正确的椭球面海拔（米），不是 Cartesian3.z（ECEF 分量）
    const groundH = cart.height ?? 0;

    try {
      const result = this.placeBuilding(longitude, latitude, this._currentOptions, groundH);
      if (!result) {
        console.warn("[BuildingBuilderLayer] 建造未成功");
      }
    } catch (e) {
      console.error("[BuildingBuilderLayer] 建造执行异常：", e);
    }
  }

  /** 将用户参数与默认值合并 */
  private _mergeOptions(raw: BuildingOptions): Required<BuildingOptions> & { buildingHeight: number } {
    const type       = raw.type ?? DEFAULTS.type;
    const shape      = raw.shape ?? DEFAULTS.shape;
    const height     = raw.height ?? DEFAULTS.height;
    const width      = raw.width ?? DEFAULTS.width;
    const depth      = raw.depth ?? DEFAULTS.depth;
    const radius     = raw.radius ?? DEFAULTS.radius;
    const alpha      = raw.alpha ?? BUILDING_ALPHA[type];
    const floorHeight = raw.floorHeight ?? DEFAULTS.floorHeight;

    const buildingHeight = raw.floors && raw.floors > 0
      ? raw.floors * floorHeight
      : height;

    return {
      type,
      shape,
      height,
      width,
      depth,
      radius,
      alpha,
      floors: raw.floors,
      floorHeight,
      buildingHeight,
    };
  }

  /**
   * 根据形状在指定经纬度创建一个 Cesium Entity
   *
   * 定位策略：Entity.position 放在地面海拔（groundH），box/cylinder
   * 的 height=0 / extrudedHeight=buildingHeight 确保几何体底部紧贴地面，顶部
   * 延伸至 groundH + buildingHeight。
   */
  private _buildEntityForShape(
    id: string,
    opts: ReturnType<typeof this._mergeOptions>,
    longitude: number,
    latitude: number,
    groundH: number
  ): Cesium.Entity {
    const material = this._getMaterial(opts);
    const entityOpts: Cesium.Entity.ConstructorOptions = {
      id,
      name: `${opts.type}_${id}`,
      // position 放在地面海拔，几何拉伸从 0 到 buildingHeight
      position: Cesium.Cartesian3.fromDegrees(longitude, latitude, groundH),
    };

    switch (opts.shape!) {
      case "box": {
        entityOpts.box = {
          dimensions: new Cesium.Cartesian3(
            opts.width!,
            opts.depth!,
            opts.buildingHeight
          ),
          height: 0,
          extrudedHeight: opts.buildingHeight,
          material,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#888888").withAlpha(0.5),
        };
        break;
      }

      case "cylinder": {
        entityOpts.cylinder = {
          length: opts.buildingHeight,
          topRadius: opts.radius!,
          bottomRadius: opts.radius!,
          material,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#888888").withAlpha(0.5),
        };
        break;
      }

      case "l-shape": {
        entityOpts.box = {
          dimensions: new Cesium.Cartesian3(
            opts.width! * 0.6,
            opts.depth!,
            opts.buildingHeight
          ),
          height: 0,
          extrudedHeight: opts.buildingHeight,
          material,
          outline: false,
        };
        break;
      }

      case "t-shape": {
        entityOpts.box = {
          dimensions: new Cesium.Cartesian3(
            opts.width!,
            opts.depth! * 0.6,
            opts.buildingHeight
          ),
          height: 0,
          extrudedHeight: opts.buildingHeight,
          material,
          outline: false,
        };
        break;
      }
    }

    return new Cesium.Entity(entityOpts);
  }

  /** 获取材质（带缓存） */
  private _getMaterial(opts: ReturnType<typeof this._mergeOptions>): Cesium.ColorMaterialProperty {
    const type = (opts.type && opts.type in BUILDING_COLORS ? opts.type : "residential") as BuildingType;
    const alpha = typeof opts.alpha === "number" ? opts.alpha : BUILDING_ALPHA[type];
    const key = `${type}_${alpha}`;
    if (this._materialCache.has(key)) {
      return this._materialCache.get(key)!;
    }

    const baseColor = BUILDING_COLORS[type] ?? FALLBACK_COLOR;
    const finalAlpha = typeof alpha === "number" && !isNaN(alpha) ? alpha : 0.85;
    const material = new Cesium.ColorMaterialProperty(baseColor.withAlpha(finalAlpha));
    this._materialCache.set(key, material);
    return material;
  }

  /** 根据经纬度获取地面高度（海拔） */
  private _getGroundHeight(longitude: number, latitude: number): number {
    try {
      const terrain = this._viewer.terrainProvider;
      if (terrain && (terrain as any).ready) {
        const cart = Cesium.Cartographic.fromDegrees(longitude, latitude);
        return this._viewer.scene.globe.getHeight(cart) ?? 0;
      }
    } catch {
      // 忽略采样失败
    }
    return 0;
  }

  /** 更新预览实体的外观 */
  private _updatePreviewAppearance(): void {
    if (!this._previewEntity || !this._previewPosition) return;

    const opts = this._mergeOptions(this._currentOptions);

    // 安全获取预览色
    const safeType  = (opts.type && opts.type in BUILDING_COLORS ? opts.type : "residential") as BuildingType;
    const safeAlpha = (typeof opts.alpha === "number" && !isNaN(opts.alpha)) ? opts.alpha : 0.45;
    const previewColor = (BUILDING_COLORS[safeType] ?? FALLBACK_COLOR).withAlpha(safeAlpha);

    // position 在地面海拔，几何从 0 拉伸到 buildingHeight
    const previewMat = new Cesium.ColorMaterialProperty(previewColor);

    // 清除旧几何
    (this._previewEntity as any).box = undefined;
    (this._previewEntity as any).cylinder = undefined;
    (this._previewEntity as any).rectangle = undefined;
    (this._previewEntity as any).ellipse = undefined;

    // 从 Cartesian3 反算经纬度（globe.pick 返回 ECEF 坐标）
    const cart = Cesium.Cartographic.fromCartesian(this._previewPosition);
    const lon = Cesium.Math.toDegrees(cart.longitude);
    const lat = Cesium.Math.toDegrees(cart.latitude);

    // 设置位置：经纬度 + 地面海拔
    this._previewEntity.position = Cesium.Cartesian3.fromDegrees(
      lon, lat, this._previewGroundHeight
    );

    // 应用新几何
    switch (opts.shape!) {
      case "box":
        this._previewEntity.box = new Cesium.BoxGraphics({
          dimensions: new Cesium.Cartesian3(opts.width!, opts.depth!, opts.buildingHeight),
          height: 0,
          extrudedHeight: opts.buildingHeight,
          material: previewMat,
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        });
        break;

      case "cylinder":
        this._previewEntity.cylinder = new Cesium.CylinderGraphics({
          length: opts.buildingHeight,
          topRadius: opts.radius!,
          bottomRadius: opts.radius!,
          material: previewMat,
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        });
        break;

      case "l-shape":
        this._previewEntity.box = new Cesium.BoxGraphics({
          dimensions: new Cesium.Cartesian3(opts.width! * 0.6, opts.depth!, opts.buildingHeight),
          height: 0,
          extrudedHeight: opts.buildingHeight,
          material: previewMat,
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        });
        break;

      case "t-shape":
        this._previewEntity.box = new Cesium.BoxGraphics({
          dimensions: new Cesium.Cartesian3(opts.width!, opts.depth! * 0.6, opts.buildingHeight),
          height: 0,
          extrudedHeight: opts.buildingHeight,
          material: previewMat,
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
        });
        break;
    }

    this._previewEntity.show = true;
  }
}
