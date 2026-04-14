/**
 * ============================================================================
 * 区域连续热力图层管理器
 * ============================================================================
 *
 * 本模块实现"城市微环境决策支持系统"中的"空间连续热力场"可视化。
 *
 * 【设计哲学】
 * 热力图绝对不是离散赋给单体建筑的颜色——那违背了热力场"空间连续"的物理本质。
 * 本实现采用"Canvas 径向渐变 + Cesium Classification 分类多边形"技术路线，
 * 生成二维热力纹理后作为投影材质，贴合至真实物理表面：
 *   - 水平方向 → 贴合地面路网、绿地、水体
 *   - 垂直方向 → 贴合 3D 建筑立面
 * 从而实现"物理空间连续场"的视觉表达，完美对应城市微气候的空间扩散规律。
 *
 * 核心技术栈：
 * - Canvas 2D API（原生径向渐变，无需 heatmap.js 等第三方库）
 * - Cesium.Entity + polygon（几何体）
 * - Cesium.ImageMaterialProperty（Canvas 纹理材质）
 * - Cesium.ClassificationType.BOTH（分类多边形，同时贴合 Terrain/Imagery 和 3D Tiles）
 *
 * @module layers/RegionalHeatmapLayer
 */

import * as Cesium from "cesium";
import type { Viewer } from "cesium";

// =============================================================================
// 热力图数据与配置类型定义
// =============================================================================

/**
 * 单个热力数据点的数据结构
 *
 * x / y 为归一化坐标（0.0 ~ 1.0），
 * 其中 (0,0) 对应区域左下角，(1,1) 对应右上角，
 * 由 `bounds` 参数在 init() 时换算为经纬度。
 *
 * value 为热力强度值，归一化至 0.0 ~ 1.0。
 */
export interface HeatPoint {
  /**
   * 归一化 X 坐标（0.0 ~ 1.0，对应区域东西方向）
   */
  x: number;
  /**
   * 归一化 Y 坐标（0.0 ~ 1.0，对应区域南北方向）
   */
  y: number;
  /**
   * 热力强度值（0.0 ~ 1.0）
   * - 0.0 表示最低温（如绿地、水体）
   * - 1.0 表示最高温（如建筑密集区、裸土）
   */
  value: number;
}

/**
 * 热力图覆盖区域的地理边界
 *
 * 定义一个经纬度矩形范围，
 * 所有热力点的坐标均在该范围内进行插值渲染。
 * 边界需与郑州大学主校区地理范围对齐。
 */
export interface HeatmapBounds {
  /** 西边界经度（°） */
  west: number;
  /** 东边界经度（°） */
  east: number;
  /** 南边界纬度（°） */
  south: number;
  /** 北边界纬度（°） */
  north: number;
}

/**
 * 热力图层初始化选项
 */
export interface HeatmapLayerOptions {
  /**
   * Canvas 渲染分辨率
   *
   * 值越大热力图越精细，但内存占用和渲染开销也越大。
   * 推荐：低配设备 256 / 中配 512 / 高配 1024
   *
   * @default 512
   */
  canvasSize?: number;

  /**
   * 单个热力点的最大影响半径（占 canvas 宽/高的比例）
   *
   * @default 0.1（10%，即每个点的热力覆盖范围约占画布的 10%）
   */
  radius?: number;

  /**
   * 热力图层的垂直高度（米，相对于地面）
   *
   * 控制热力图在垂直方向的"漂浮"高度。
   * - 设为 0：完全贴在地面（默认，适合城市微气候模拟）
   * - 正值：悬浮在空中（如模拟污染物扩散的垂直分布）
   *
   * @default 0
   */
  heightOffset?: number;

  /**
   * 热力图层透明度（0.0 ~ 1.0）
   *
   * @default 0.7
   */
  opacity?: number;

  /**
   * 是否允许热力图贴合 3D 建筑立面
   *
   * - `true`：热力图同时覆盖地表和建筑表面（ClassificationType.BOTH）
   * - `false`：仅覆盖地表（ClassificationType.TERRAIN）
   *
   * @default true
   */
  coverBuildings?: boolean;
}

// =============================================================================
// 颜色配置
// =============================================================================

/**
 * 热力渐变色配置
 *
 * 定义热力值从 0.0（低温）到 1.0（高温）的颜色插值梯度。
 * 默认采用"蓝 → 青 → 绿 → 黄 → 红"五段渐变，
 * 对应城市热岛效应的温度分布直觉认知。
 *
 * 每段以 [r, g, b]（0-255）格式定义。
 */
const HEAT_COLORS: [number, number, number][] = [
  [0, 0, 139],     // 0.00 - 深蓝（低温区：绿地/水体）
  [0, 139, 139],   // 0.25 - 深青（中低温区）
  [0, 255, 0],     // 0.50 - 绿色（中等）
  [255, 255, 0],   // 0.75 - 黄色（中高）
  [255, 0, 0],     // 1.00 - 红色（高温区：建筑密集/裸土）
];

/**
 * 根据归一化热力值获取对应 RGB 颜色
 *
 * 在 HEAT_COLORS 色表中进行线性插值，
 * 根据热度值 0.0~1.0 返回精确的 [r, g, b] 颜色。
 *
 * @param {number} value - 归一化热度值（0.0 ~ 1.0）
 * @returns {[number, number, number]} RGB 颜色数组
 */
function interpolateColor(value: number): [number, number, number] {
  const clampedValue = Math.max(0, Math.min(1, value));
  const totalStops = HEAT_COLORS.length - 1;
  const scaledValue = clampedValue * totalStops;
  const lowerIndex = Math.floor(scaledValue);
  const upperIndex = Math.min(lowerIndex + 1, totalStops);
  const t = scaledValue - lowerIndex;

  const lower = HEAT_COLORS[lowerIndex];
  const upper = HEAT_COLORS[upperIndex];

  return [
    Math.round(lower[0] + (upper[0] - lower[0]) * t),
    Math.round(lower[1] + (upper[1] - lower[1]) * t),
    Math.round(lower[2] + (upper[2] - lower[2]) * t),
  ];
}

// =============================================================================
// RegionalHeatmapLayer 类定义
// =============================================================================

/**
 * RegionalHeatmapLayer — 区域连续热力图层管理器
 *
 * 本类通过以下技术链路实现"空间连续热力场"：
 *
 * ```
 * [HeatPoint[]]  ──归一化坐标──→  [Canvas 2D 径向渐变]
 *                                          │
 *                                    Canvas 转 ImageTexture
 *                                          │
 *                            [Cesium.ImageMaterialProperty]
 *                                          │
 *                            [Cesium.Entity.polygon.material]
 *                                          │
 *                 ┌────────────────────────┴────────────────────────┐
 *                 ↓                                                    ↓
 *         ClassificationType.TERRAIN                       ClassificationType.TILES
 *         （贴合地表路网/绿地）                         （贴合 3D 建筑立面）
 * ```
 *
 * **为什么必须用 ClassificationType.BOTH？**
 *
 * Cesium 的 Classification（分类渲染）机制是本实现的核心：
 *
 * 1. **分类多边形（Classification Polygon）** 是一种特殊的 2.5D 几何体。
 *    它本质上是一个"二维的"矩形/多边形（由经纬度定义），但可以"投影"到
 *    场景中任意 3D 表面上。
 *
 * 2. **ClassificationType 枚举** 决定投影目标：
 *    - `TERRAIN`：仅贴合地形和影像（地表级别）
 *    - `CESIUM_3D_TILE`：仅贴合 3D Tiles（建筑等模型）
 *    - `BOTH`：同时贴合以上两者（默认采用）
 *
 * 3. **渲染管线细节**：
 *    当 `classificationType: Cesium.ClassificationType.BOTH` 时，
 *    Cesium 会在 WebGL 渲染阶段对热力多边形执行两次光栅化：
 *    - 第一次：渲染到 Terrain/Imagery 表面（Z-Fight 防护，自动抬升至地表上方 1cm）
 *    - 第二次：渲染到 3D Tiles 表面（建筑立面与顶面）
 *    两次渲染共用同一材质（Canvas 生成的 ImageTexture），
 *    因此热力图在水平地表和垂直建筑表面呈现完全一致的图案，
 *    实现真正的"物理空间连续场"。
 *
 * 4. **为什么不用 Entity.polygon.height / extrudedHeight？**
 *    polygon.height 可以拉伸出有限高度，但那只是垂直"片"，
 *    不会贴合建筑立面的起伏几何。
 *    Classification 技术才是"随形贴合"的正确手段。
 *
 * @designpattern Dependency Injection（依赖注入）
 */
export class RegionalHeatmapLayer {
  // =============================================================================
  // 私有属性
  // =============================================================================

  /**
   * Cesium Viewer 实例引用（依赖注入）
   */
  private readonly _viewer: Viewer;

  /**
   * 热力图实体引用
   *
   * 管理 Cesium.Entity 的生命周期，
   * 包含 polygon 几何体和 ImageMaterialProperty 材质。
   */
  private _heatmapEntity: Cesium.Entity | null = null;

  /**
   * 离屏 Canvas 元素（隔离 DOM 管理）
   *
   * 不挂载至 document.body，避免干扰页面布局。
   * Canvas 的 context 设置为 `willReadFrequently: true`，
   * 暗示浏览器为频繁 read 操作优化（热力重绘场景有利）。
   */
  private _canvas: HTMLCanvasElement | null = null;

  /**
   * Canvas 2D 渲染上下文
   */
  private _ctx: CanvasRenderingContext2D | null = null;

  /**
   * 当前热力数据点（保留引用，供 updateHeatmap 使用）
   */
  private _currentData: HeatPoint[] = [];

  /**
   * 当前区域边界
   */
  private _bounds: HeatmapBounds | null = null;

  /**
   * Canvas 尺寸（默认 512x512）
   */
  private _canvasSize: number = 512;

  /**
   * 热力点影响半径
   */
  private _radius: number = 0.1;

  /**
   * 热力图层透明度
   */
  private _opacity: number = 0.7;

  /**
   * 垂直漂浮高度（米）
   */
  private _heightOffset: number = 0;

  /**
   * 是否贴合建筑（true = BOTH, false = TERRAIN）
   */
  private _coverBuildings: boolean = true;

  /**
   * 图层是否已初始化标识
   */
  private _isInitialized: boolean = false;

  /**
   * 数值标注 Entity 集合（每个热力点一个 Label）
   */
  private _labelEntities: Cesium.Entity[] = [];

  /**
   * 是否显示数值标注
   */
  private _showLabels: boolean = false;

  // =============================================================================
  // 构造函数
  // =============================================================================

  /**
   * 构造函数
   *
   * 通过依赖注入接收 Viewer 实例，建立热力图层与渲染器的关联。
   *
   * @param {Viewer} viewer - 已初始化的 Cesium.Viewer 实例
   * @throws {Error} 若 viewer 为 null 或 undefined
   */
  constructor(viewer: Viewer) {
    if (!viewer) {
      throw new Error(
        "[RegionalHeatmapLayer] 构造函数接收的 viewer 参数不能为空，请先调用 viewerManager.init() 创建 Viewer。"
      );
    }
    this._viewer = viewer;
    this._heatmapEntity = null;
    this._canvas = null;
    this._ctx = null;
    this._currentData = [];
    this._bounds = null;
    this._isInitialized = false;

    console.debug("[RegionalHeatmapLayer] 实例已创建，等待 init() 调用...");
  }

  // =============================================================================
  // 公开只读属性
  // =============================================================================

  /**
   * 当前是否已初始化
   */
  public get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * 当前热力数据点数
   */
  public get pointCount(): number {
    return this._currentData.length;
  }

  /**
   * 是否显示数值标注
   */
  public get showLabels(): boolean {
    return this._showLabels;
  }

  // =============================================================================
  // 核心方法：init — 初始化与挂载
  // =============================================================================

  /**
   * 初始化热力图层并挂载至场景
   *
   * 本方法是热力图层的一站式初始化入口，执行以下操作：
   *
   * 1. **配置合并**：合并用户选项与默认值
   * 2. **Canvas 初始化**：创建离屏 Canvas，设置 2D 渲染上下文
   * 3. **边界校验**：验证 bounds 参数是否合理（east > west, north > south）
   * 4. **Canvas 预绘制**：调用 _drawCanvas(initialData) 生成初始热力纹理
   * 5. **Entity 创建**：构造 Cesium.Entity，包含 polygon 几何体和材质
   * 6. **材质配置**：ImageMaterialProperty + transparent + classificationType
   * 7. **挂载**：添加至 viewer.entities
   *
   * @param {HeatmapBounds} bounds - 热力图覆盖的经纬度矩形范围
   * @param {HeatPoint[]} [initialData] - 初始热力数据点（可选，默认使用郑大主校区演示数据）
   * @param {HeatmapLayerOptions} [options] - 可选配置项
   * @returns {Promise<void>}
   *
   * @throws {Error} bounds 参数无效
   *
   * @example
   * ```typescript
   * import { viewerManager, RegionalHeatmapLayer } from '@/cesium_core';
   *
   * const viewer = viewerManager.getViewer();
   * const heatmapLayer = new RegionalHeatmapLayer(viewer);
   *
   * // 初始化，使用郑大主校区边界
   * await heatmapLayer.init(
   *   { west: 113.525, east: 113.540, south: 34.808, north: 34.820 },
   *   [
   *     { x: 0.2, y: 0.3, value: 0.9 },   // 图书馆区域高温
   *     { x: 0.5, y: 0.6, value: 0.4 },   // 绿地低温
   *   ],
   *   { canvasSize: 512, opacity: 0.75 }
   * );
   * ```
   */
  public async init(
    bounds: HeatmapBounds,
    initialData?: HeatPoint[],
    options: HeatmapLayerOptions = {}
  ): Promise<void> {
    // —— 防止重复初始化 ——
    if (this._isInitialized) {
      console.warn(
        "[RegionalHeatmapLayer] 热力图层已初始化，重复调用 init() 将先销毁旧实例"
      );
      await this.destroy();
    }

    console.debug("[RegionalHeatmapLayer] 开始初始化热力图层...");

    // —— 配置合并 ——
    this._canvasSize = options.canvasSize ?? 512;
    this._radius = options.radius ?? 0.1;
    this._opacity = options.opacity ?? 0.7;
    this._heightOffset = options.heightOffset ?? 0;
    this._coverBuildings = options.coverBuildings ?? true;

    // —— 边界校验 ——
    if (!this._validateBounds(bounds)) {
      throw new Error(
        `[RegionalHeatmapLayer] 无效的边界参数：west=${bounds.west}, east=${bounds.east}, south=${bounds.south}, north=${bounds.north}。要求 east > west 且 north > south。`
      );
    }
    this._bounds = bounds;

    // —— 创建离屏 Canvas ——
    this._createCanvas();

    // —— 绘制初始热力图 ——
    const demoData = initialData ?? this._generateZZUDemoData();
    this._currentData = demoData;
    this._drawCanvas(demoData);

    // —— 创建 Entity 并挂载 ——
    await this._createHeatmapEntity();

    this._isInitialized = true;
    console.info("[RegionalHeatmapLayer] ✅ 热力图层初始化完成");
  }

  // =============================================================================
  // 核心方法：updateHeatmap — 热力数据更新
  // =============================================================================

  /**
   * 更新热力图数据并重绘
   *
   * 在拔楼推演过程中，当微气候参数（热岛强度、绿地覆盖率等）发生变化后，
   * 调用本方法传入新的热力点阵数据，实现热力场的动态刷新。
   *
   * **材质同步机制（重要）：**
   *
   * Cesium 的 ImageMaterialProperty 在首次创建时会捕获 Canvas 的 ImageBitmap。
   * 当我们调用 Canvas 2D API 重绘后，ImageBitmap 并不会自动更新——
   * 如果直接赋值给 material.image，Cesium 会发现引用相同而不触发重绘。
   *
   * 因此本方法采用以下策略强制同步：
   *
   * 方案 A（推荐）：重新创建 ImageMaterialProperty 实例
   * ```
   * _heatmapEntity.polygon.material = new Cesium.ImageMaterialProperty({
   *   image: new Cesium.CallbackProperty(() => updatedCanvas, false)
   * });
   * ```
   *
   * 方案 B（更简单）：直接替换 material 的 image 引用，
   * 由于每次都创建新对象，Cesium 会识别为材质变更并触发重绘。
   *
   * 本实现采用方案 B，兼顾性能与正确性。
   *
   * @param {HeatPoint[]} newData - 新的热力数据点阵
   * @returns {void}
   *
   * @example
   * ```typescript
   * // 模拟拔楼后热力场扩散（高温区向周边扩散）
   * const newData = computeHeatmapAfterBuildingRemoval(
   *   currentBuildings,
   *   temperatureModel
   * );
   * heatmapLayer.updateHeatmap(newData);
   * ```
   */
  public updateHeatmap(newData: HeatPoint[]): void {
    if (!this._isInitialized || !this._heatmapEntity) {
      console.warn("[RegionalHeatmapLayer] 热力图层未初始化，请先调用 init()");
      return;
    }

    if (!this._ctx || !this._canvas) {
      console.error("[RegionalHeatmapLayer] Canvas 上下文未初始化");
      return;
    }

    // —— 更新数据引用 ——
    this._currentData = newData;

    // —— 重绘 Canvas ——
    // 清空画布（透明背景），重新绘制热力径向渐变
    this._drawCanvas(newData);

    // —— 强制材质同步 —
    // 重新创建 ImageMaterialProperty 实例，使 Cesium 识别为材质变更并触发重绘
    if (this._heatmapEntity && this._heatmapEntity.polygon) {
      (this._heatmapEntity.polygon as any).material = new Cesium.ImageMaterialProperty({
        image: this._canvas as HTMLCanvasElement,
        transparent: true,
      });
    }

    console.debug(
      `[RegionalHeatmapLayer] 热力图已更新，数据点数：${newData.length}`
    );

    // 同步更新数值标注
    if (this._showLabels && this._labelEntities.length > 0) {
      this._updateLabels();
    }
  }

  // =============================================================================
  // 核心方法：setOpacity — 透明度动态调整
  // =============================================================================

  /**
   * 动态调整热力图层透明度
   *
   * 可用于 UI 滑块控制，让用户在"详细热力"与"底图清晰"之间切换。
   *
   * @param {number} opacity - 透明度（0.0 ~ 1.0）
   */
  public setOpacity(opacity: number): void {
    this._opacity = Math.max(0, Math.min(1, opacity));

    if (!this._isInitialized || !this._heatmapEntity) return;

    // 更新材质透明度
    const polygon = this._heatmapEntity.polygon as any;
    const mat = polygon?.material as Cesium.ImageMaterialProperty | undefined;
    if (mat && (mat as any).color) {
      (mat as any).color = Cesium.Color.fromAlpha(
        Cesium.Color.WHITE,
        this._opacity
      );
    }

    console.debug(`[RegionalHeatmapLayer] 透明度已更新为：${this._opacity}`);
  }

  /**
   * 动态调整热力图层垂直高度
   *
   * 可用于"图层升降"动画，在不同分析阶段展示不同高度的热力场。
   *
   * @param {number} height - 相对地面高度（米）
   */
  public setHeightOffset(height: number): void {
    this._heightOffset = height;

    if (!this._isInitialized || !this._heatmapEntity) return;

    // 更新 polygon 的 height 属性
    (this._heatmapEntity.polygon as any).height = height;

    console.debug(
      `[RegionalHeatmapLayer] 高度偏移已更新为：${height} 米`
    );
  }

  // =============================================================================
  // 生命周期方法：destroy
  // =============================================================================

  /**
   * 销毁热力图层并释放资源
   *
   * 执行以下清理操作：
   * 1. 从 viewer.entities 移除热力 Entity
   * 2. 销毁 Canvas 并释放 2D context
   * 3. 清空内部引用与数据
   * 4. 重置初始化标识
   *
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * // 组件卸载时
   * onBeforeUnmount(async () => {
   *   await heatmapLayer.destroy();
   * });
   * ```
   */
  public async destroy(): Promise<void> {
    console.debug("[RegionalHeatmapLayer] 开始销毁热力图层...");

    // —— 移除数值标注 ——
    this._removeLabels();

    // —— 从场景移除 Entity ——
    if (this._heatmapEntity && this._viewer) {
      try {
        this._viewer.entities.remove(this._heatmapEntity);
        console.debug("[RegionalHeatmapLayer] Entity 已从 viewer.entities 移除");
      } catch (error) {
        console.warn("[RegionalHeatmapLayer] 移除 Entity 时发生错误：", error);
      }
      this._heatmapEntity = null;
    }

    // —— 销毁 Canvas ——
    if (this._canvas) {
      // 断开 Canvas 与 ImageMaterialProperty 的引用，防止内存泄漏
      this._canvas.width = 0;
      this._canvas.height = 0;
      this._canvas = null;
      this._ctx = null;
      console.debug("[RegionalHeatmapLayer] Canvas 实例已销毁");
    }

    // —— 清空数据 ——
    this._currentData = [];
    this._bounds = null;

    // —— 重置状态 ——
    this._isInitialized = false;

    console.info("[RegionalHeatmapLayer] ✅ 热力图层销毁完成，所有资源已释放");
  }

  // =============================================================================
  // 私有辅助方法
  // =============================================================================

  /**
   * 创建离屏 Canvas
   *
   * Canvas 独立于 document 存在，不影响页面布局。
   * 设置 `willReadFrequently: true` 以优化性能。
   *
   * @private
   */
  private _createCanvas(): void {
    this._canvas = document.createElement("canvas");
    this._canvas.width = this._canvasSize;
    this._canvas.height = this._canvasSize;

    // 禁用抗锯齿以获得清晰的像素级热力渲染
    this._canvas.style.imageRendering = "pixelated";

    this._ctx = this._canvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;

    if (!this._ctx) {
      throw new Error(
        "[RegionalHeatmapLayer] 无法获取 Canvas 2D 渲染上下文，请检查浏览器是否支持 Canvas API。"
      );
    }

    console.debug(
      `[RegionalHeatmapLayer] Canvas 创建完成，尺寸：${this._canvasSize}x${this._canvasSize}`
    );
  }

  /**
   * 绘制 Canvas 热力图
   *
   * 核心绘制逻辑：遍历所有热力点，使用 Canvas 2D 的 `createRadialGradient()`
   * 在每个热力点位置绘制径向渐变圆。多个热力点的渐变在叠加时通过 `globalCompositeOperation: 'lighter'`
   * 实现自然的热力扩散效果。
   *
   * **Canvas 坐标系说明：**
   * - Canvas 原点 (0,0) 在左上角
   * - x 向右递增，y 向下递增
   * - 热力点 x:0,y:0 对应区域左下角（西南方向）
   * - 热力点 x:1,y:1 对应区域右上角（东北方向）
   * → 因此绘制时需要将 y 坐标取反：canvasY = canvasSize * (1 - point.y)
   *
   * **globalCompositeOperation 说明：**
   * - 默认 `source-over`：新绘制的图形覆盖在已有图形之上
   * - 设为 `'lighter'`：颜色值叠加（类似光的热叠加），使多个热力点的颜色自然融合
   *   - R = R1 + R2 - (R1*R2/255)（简化表达）
   *   - 效果：两个高温点中心叠加时颜色更亮，模拟真实热扩散
   *
   * @param {HeatPoint[]} pointsData - 热力数据点阵
   * @private
   */
  private _drawCanvas(pointsData: HeatPoint[]): void {
    if (!this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const size = this._canvasSize;

    // —— 清空画布（透明背景） ——
    ctx.clearRect(0, 0, size, size);

    // —— 设置全局复合模式为 'lighter'，实现热力叠加 ——
    ctx.globalCompositeOperation = "lighter";

    // —— 遍历所有热力点 ——
    for (const point of pointsData) {
      // 坐标转换：归一化 → Canvas 像素
      // x: 直接映射（左→右）
      // y: 取反映射（归一化 y=1 在下，Canvas y=0 在上）
      const cx = point.x * size;
      const cy = (1 - point.y) * size;

      // 影响半径（像素），根据 _radius 比例计算
      const radiusPx = this._radius * size;

      // 颜色插值
      const [r, g, b] = interpolateColor(point.value);

      // 创建径向渐变
      // 从热力中心向外，颜色从 (r,g,b) 以 alpha=0.8 渐变至 (r,g,b,0)
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.85)`);
      gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.4)`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }

    // —— 恢复默认复合模式 ——
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * 创建 Cesium.Entity 并挂载至场景
   *
   * 这是热力图层渲染管线的最终环节。
   * 创建 polygon 几何体 + ImageMaterialProperty 材质，
   * 配置 classificationType 实现"随形贴合"。
   *
   * @private
   */
  private async _createHeatmapEntity(): Promise<void> {
    if (!this._bounds || !this._viewer || !this._canvas) {
      throw new Error("[RegionalHeatmapLayer] 初始化参数不完整，无法创建 Entity");
    }

    const { west, east, south, north } = this._bounds;

    // —— 确定 classificationType ——
    // BOTH：同时贴合 Terrain/Imagery 和 3D Tiles（建筑立面）
    // TERRAIN：仅贴合地表（若用户不需要贴合建筑）
    const classType = this._coverBuildings
      ? Cesium.ClassificationType.BOTH
      : Cesium.ClassificationType.TERRAIN;

    // —— 创建 ImageMaterialProperty ——
    // transparent: true → 启用 Alpha 混合，使热力图半透明
    // 即使热力值为 1.0（红色）也保持半透明，不完全遮挡底图
    const material = new Cesium.ImageMaterialProperty({
      image: this._canvas as HTMLCanvasElement,
      transparent: true,
    });

    // —— 创建 Entity ——
    const polygonOptions: any = {
      // 四个角点的经纬度数组，逆时针或顺时针闭合
      // Cesium 会自动将 (west,south) → (east,south) → (east,north) → (west,north)
      // 连接为矩形区域
      hierarchy: new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray([
          west, south,
          east, south,
          east, north,
          west, north,
        ])
      ),

      // 垂直高度（相对于 WGS84 椭球面）
      // 设为正值使热力图悬浮于地表上方，
      // 但 ClassificationType.BOTH 仍会将其贴合到建筑立面上
      height: this._heightOffset,

      // 材质
      material,

      // 【核心配置】分类类型：同时贴合地表和建筑立面
      // 注意：Cesium 1.140 中 Entity.polygon.classificationType 可能需要通过动态赋值设置
      classificationType: classType,

      // 抗锯齿：Cesium 会自动处理多边形边缘
      closeTop: true,
      closeBottom: true,

      // 指定该多边形不投射/接收阴影（热力图作为纯视觉叠加层）
      shadows: Cesium.ShadowMode.DISABLED,
    };

    this._heatmapEntity = this._viewer.entities.add({
      id: "heatmapRect",
      polygon: polygonOptions,
      show: true,
    } as any);

    console.debug(
      `[RegionalHeatmapLayer] Entity 已添加至 viewer.entities，` +
        `classificationType: ${classType === Cesium.ClassificationType.BOTH ? 'BOTH（地表+建筑立面）' : 'TERRAIN（仅地表）'}`
    );

    // 创建数值标注
    this._createLabels();
  }

  // =============================================================================
  // 公开方法：toggleLabels — 显示/隐藏热力数值标注
  // =============================================================================

  /**
   * 切换热力数值标注的显示状态
   *
   * 在每个热力点中心叠加 Cesium.Label，展示归一化热力值（0.0~1.0）。
   *
   * @returns {boolean} 切换后的显示状态
   */
  public toggleLabels(): boolean {
    this._showLabels = !this._showLabels;

    if (this._showLabels) {
      if (this._labelEntities.length === 0) {
        this._createLabels();
      } else {
        this._labelEntities.forEach(e => { e.show = true; });
      }
    } else {
      this._labelEntities.forEach(e => { e.show = false; });
    }

    console.debug(`[RegionalHeatmapLayer] 数值标注已${this._showLabels ? '显示' : '隐藏'}`);
    return this._showLabels;
  }

  // =============================================================================
  // 私有方法：_createLabels — 在每个热力点创建 Label
  // =============================================================================

  private _createLabels(): void {
    if (!this._bounds || !this._viewer || this._currentData.length === 0) return;

    const { west, east, south, north } = this._bounds;
    const lngRange = east - west;
    const latRange = north - south;

    this._removeLabels();

    for (const point of this._currentData) {
      const lng = west + point.x * lngRange;
      const lat = south + point.y * latRange;

      const [r, g, b] = interpolateColor(point.value);
      const color = new Cesium.Color(r / 255, g / 255, b / 255, 0.9);
      const fontSize = 10 + Math.round(point.value * 6);

      const label = this._viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 30),
        label: {
          text: point.value.toFixed(2),
          font: `${fontSize}px sans-serif`,
          fillColor: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: true,
        },
      } as any);

      this._labelEntities.push(label);
    }

    console.debug(`[RegionalHeatmapLayer] 已创建 ${this._labelEntities.length} 个数值标注`);
  }

  // =============================================================================
  // 私有方法：_updateLabels — 更新已有 Label 文字和颜色
  // =============================================================================

  private _updateLabels(): void {
    if (!this._bounds || this._labelEntities.length === 0) return;

    const { west, east, south, north } = this._bounds;
    const lngRange = east - west;
    const latRange = north - south;
    const count = Math.min(this._currentData.length, this._labelEntities.length);

    for (let i = 0; i < count; i++) {
      const point = this._currentData[i];
      const entity = this._labelEntities[i];

      const lng = west + point.x * lngRange;
      const lat = south + point.y * latRange;
      entity.position = Cesium.Cartesian3.fromDegrees(lng, lat, 30);

      const [r, g, b] = interpolateColor(point.value);
      const color = new Cesium.Color(r / 255, g / 255, b / 255, 0.9);
      const fontSize = 10 + Math.round(point.value * 6);

      const label = entity.label as any;
      label.text = point.value.toFixed(2);
      label.fillColor = color;
      label.font = `${fontSize}px sans-serif`;
    }
  }

  // =============================================================================
  // 私有方法：_removeLabels — 移除所有 Label
  // =============================================================================

  private _removeLabels(): void {
    if (!this._viewer) return;
    for (const entity of this._labelEntities) {
      try { this._viewer.entities.remove(entity); } catch (_) { /* ignore */ }
    }
    this._labelEntities = [];
  }

  // =============================================================================
  // 私有方法：_validateBounds — 边界参数校验
  // =============================================================================

  /**
   * 边界参数校验
   *
   * @param {HeatmapBounds} bounds - 待校验边界
   * @returns {boolean} true 表示合法
   * @private
   */
  private _validateBounds(bounds: HeatmapBounds): boolean {
    const { west, east, south, north } = bounds;
    return (
      typeof west === "number" &&
      typeof east === "number" &&
      typeof south === "number" &&
      typeof north === "number" &&
      west < east &&
      south < north &&
      west >= -180 && west <= 180 &&
      east >= -180 && east <= 180 &&
      south >= -90 && south <= 90 &&
      north >= -90 && north <= 90
    );
  }

  /**
   * 生成郑州大学主校区的演示热力数据
   *
   * 当用户未传入 initialData 时，使用预设数据模拟郑大校园热岛分布：
   * - 图书馆/教学楼区域：高温（建筑密集、硬质铺装多）
   * - 核心绿地（泊月湖）：低温（植被降温效应）
   * - 食堂/宿舍区：中高温度
   *
   * 坐标基于郑大主校区范围：lng 113.525°E ~ 113.540°E，lat 34.808°N ~ 34.820°N
   *
   * @private
   */
  private _generateZZUDemoData(): HeatPoint[] {
    return [
      // 图书馆/主教学楼区域（高温中心）
      { x: 0.50, y: 0.45, value: 0.95 },
      { x: 0.52, y: 0.48, value: 0.90 },
      { x: 0.48, y: 0.42, value: 0.88 },

      // 理科组团区域（中高温）
      { x: 0.35, y: 0.30, value: 0.78 },
      { x: 0.30, y: 0.35, value: 0.72 },

      // 泊月湖区域（低温冷岛）
      { x: 0.65, y: 0.60, value: 0.20 },
      { x: 0.62, y: 0.65, value: 0.15 },
      { x: 0.68, y: 0.58, value: 0.25 },

      // 食堂/生活区（中高）
      { x: 0.20, y: 0.70, value: 0.68 },
      { x: 0.18, y: 0.72, value: 0.65 },

      // 体育场区域（中等，硬质铺装+人群）
      { x: 0.80, y: 0.25, value: 0.60 },

      // 校园边缘（接近常温）
      { x: 0.10, y: 0.10, value: 0.50 },
      { x: 0.90, y: 0.90, value: 0.48 },
    ];
  }
}

// =============================================================================
// 导出类型
// 类型已在文件顶部通过 export interface 声明，此处无需重复导出
// =============================================================================
