/**
 * ============================================================================
 * Cesium Core 模块统一导出接口
 * ============================================================================
 *
 * 本文件作为 `cesium_core` 包的公共入口（Public API），
 * 负责集中导出所有对外暴露的类、函数、类型与常量。
 *
 * 设计原则：
 * - **单一出口**：外部模块只需从 `@/cesium_core` 导入，无需关心内部文件结构
 * - **按需导入**：鼓励调用方按需导入具体模块，以获得最佳 Tree-Shaking 效果
 * - **向后兼容**：新增导出应保持向后兼容，避免频繁变更导出签名
 *
 * 目录结构说明：
 *
 * ```
 * cesium_core/
 * ├── core/               ← 核心管理层
 * │   ├── ViewerManager   ← Viewer 生命周期单例
 * │   └── constants       ← 全局静态常量配置
 * ├── layers/            ← 图层管理（后续步骤实现）
 * │   └── ...
 * ├── interaction/       ← 交互管理（后续步骤实现）
 * │   └── ...
 * └── index.ts           ← 本文件，统一导出
 * ```
 *
 * @module cesium_core
 */

// =============================================================================
// 核心管理层导出
// =============================================================================

/**
 * ViewerManager — Cesium Viewer 生命周期管理器
 *
 * 提供单例模式的 Viewer 实例管理，包括初始化、销毁与访问。
 *
 * @example
 * ```typescript
 * import { viewerManager } from '@/cesium_core';
 *
 * // 初始化
 * await viewerManager.init('cesiumContainer');
 *
 * // 获取 Viewer 实例
 * const viewer = viewerManager.getViewer();
 *
 * // 销毁
 * await viewerManager.destroy();
 * ```
 *
 * @see ViewerManager.ts
 */
export {
  viewerManager,
  ViewerManager,
  ViewerManagerState,
} from "./core/ViewerManager";
export type { ViewerManagerOptions } from "./core/ViewerManager";

/**
 * constants — 全局静态常量配置
 *
 * 包含相机视角、渲染参数、UI 配置等全局常量。
 *
 * @example
 * ```typescript
 * import { ZZU_CAMERA_CONFIG, DEFAULT_ENABLE_FXAA } from '@/cesium_core';
 * console.log('目标位置：', ZZU_CAMERA_CONFIG);
 * ```
 *
 * @see constants.ts
 */
export {
  // —— 郑州大学主校区视图配置 ——
  ZZU_CAMERA_CONFIG,
  CESIUM_ION_TOKEN,
  CESIUM_CONTAINER_ID,

  // —— 渲染优化配置 ——
  DEFAULT_ENABLE_FXAA,
  DEFAULT_USE_LOG_DEPTH_BUFFER,
  DEFAULT_SCENE_LIGHTING_ENABLED,
  DEFAULT_SHOW_FRAMERATE,

  // —— 地形与影像配置 ——
  DEFAULT_TERRAIN_PROVIDER,
  DEFAULT_AUTO_ADD_IMAGERY_LAYER,

  // —— UI 控件配置 ——
  DEFAULT_HIDDEN_WIDGETS,

  // —— 场景模式 ——
  SceneMode,
  DEFAULT_SCENE_MODE,

  // —— 相机参数 ——
  CAMERA_FLIGHT_DURATION,
  CAMERA_MAX_HEIGHT,
  CAMERA_MIN_HEIGHT,

  // —— 性能阈值 ——
  FPS_WARNING_THRESHOLD,
  MEMORY_WARNING_THRESHOLD_MB,
} from "./core/constants";

// =============================================================================
// 图层管理导出
// =============================================================================

/**
 * CampusTilesetLayer — 校园建筑群 3D Tileset 图层管理器
 *
 * 负责城市数字底座（校园建筑群）的加载与单体建筑控制。
 * 支持加载自定义 3D Tiles 数据，未提供 URL 时自动降级为 OSM 建筑白模。
 * 提供 hideBuilding / showBuilding / showAllBuildings 等方法，为"拔楼"推演提供对象级控制。
 *
 * @example
 * ```typescript
 * import { viewerManager, CampusTilesetLayer } from '@/cesium_core';
 *
 * const viewer = viewerManager.getViewer();
 * const campusLayer = new CampusTilesetLayer(viewer);
 *
 * // 加载 OSM 白模兜底
 * await campusLayer.load();
 *
 * // 隐藏单体建筑（"拔楼"）
 * const buildings = await campusLayer.getFeaturesByProperty('building_id', 'BLDG_001');
 * buildings.forEach(b => campusLayer.hideBuilding(b));
 *
 * // 销毁
 * await campusLayer.destroy();
 * ```
 *
 * @see layers/CampusTilesetLayer.ts
 */
export { CampusTilesetLayer, type TilesetLoadOptions } from "./layers/CampusTilesetLayer";

/**
 * BuildingBuilderLayer — 动态建筑建造管理器
 *
 * 在 Cesium 场景中交互式建造新建筑实体，支持多种类型（住宅/商业/办公/工业/公共设施）、
 * 多种形状（方形/圆形/L形/T形），实时预览，灵活管理。
 *
 * @example
 * ```typescript
 * import { viewerManager, BuildingBuilderLayer } from '@/cesium_core';
 *
 * const viewer = viewerManager.getViewer();
 * const builder = new BuildingBuilderLayer(viewer);
 * builder.startPlacement({ type: 'commercial', shape: 'box', height: 80 });
 * // 点击地图放置建筑，ESC 退出
 * await builder.destroy();
 * ```
 */
export {
  BuildingBuilderLayer,
  type BuildingOptions,
  type BuildingRecord,
  type BuildingShape,
  type BuildingType,
} from "./layers/BuildingBuilderLayer";

/**
 * RegionalHeatmapLayer — 区域连续热力图层管理器
 *
 * 基于 Canvas 2D 径向渐变 + Cesium ClassificationType.BOTH 分类多边形，
 * 实现"空间连续热力场"的视觉表达——同时贴合地表路网和 3D 建筑立面。
 *
 * @example
 * ```typescript
 * import { viewerManager, RegionalHeatmapLayer } from '@/cesium_core';
 *
 * const viewer = viewerManager.getViewer();
 * const heatmapLayer = new RegionalHeatmapLayer(viewer);
 *
 * await heatmapLayer.init(
 *   { west: 113.525, east: 113.540, south: 34.808, north: 34.820 },
 *   [{ x: 0.5, y: 0.5, value: 0.9 }],
 *   { canvasSize: 512, opacity: 0.75 }
 * );
 *
 * // 推演更新
 * heatmapLayer.updateHeatmap(newData);
 * ```
 *
 * @see layers/RegionalHeatmapLayer.ts
 */
export {
  RegionalHeatmapLayer,
  type HeatPoint,
  type HeatmapBounds,
  type HeatmapLayerOptions,
} from "./layers/RegionalHeatmapLayer";

/**
 * ImageryLayerManager — 影像图层管理器
 *
 * 负责底图的加载与切换，支持街道图和卫星图两种模式。
 * 基于 Cesium ImageryLayer API 实现图层叠加与覆盖。
 *
 * @example
 * ```typescript
 * import { viewerManager, ImageryLayerManager } from '@/cesium_core';
 *
 * const viewer = viewerManager.getViewer();
 * const imagery = new ImageryLayerManager(viewer);
 *
 * // 切换底图
 * imagery.switchTo('satellite'); // 卫星图
 * imagery.switchTo('street');    // 街道图
 * imagery.toggle();               // 自动翻转
 * ```
 *
 * @see layers/ImageryLayerManager.ts
 */
export {
  ImageryLayerManager,
  type ImageryType,
} from "./layers/ImageryLayerManager";

/**
 * ImageryLayerManager — 影像图层管理（预留后续实现）
 * TerrainLayerManager — 地形图层管理（预留后续实现）
 */
export * from "./layers";

// =============================================================================
// 交互管理导出（预留，后续步骤实现）
// =============================================================================

/**
 * @todo 阶段三：交互管理模块导出
 *
 * 计划导出内容：
 * - InteractionManager — 统一交互管理器
 * - DrawTool — 矢量绘制工具
 * - MeasureTool — 空间量测工具
 * - QueryTool — 空间查询工具
 *
 * @example（预留示例）
 * ```typescript
 * import { InteractionManager } from '@/cesium_core/interaction';
 * ```
 */
export * from "./interaction";
export {} from "./interaction"; // 声明为模块（interaction 目录目前为空占位）

// =============================================================================
// 辅助工具导出（预留，后续步骤实现）
// =============================================================================

/**
 * @todo 辅助工具集导出
 *
 * 计划导出内容：
 * - CoordinateConverter — 坐标系转换工具
 * - GeoUtils — 地理计算工具库
 * - CesiumMath — Cesium 数学扩展
 */

// =============================================================================
// 重新导出声明文件类型（供外部模块在 TypeScript 中使用）
// =============================================================================

/**
 * Cesium 原生类型重新导出
 *
 * 将常用的 Cesium 类型重新导出，方便调用方统一从本模块导入，
 * 无需额外安装或配置 @types/cesium。
 *
 * @example
 * ```typescript
 * import type { Viewer, Entity, DataSource } from '@/cesium_core';
 * ```
 */
// 注意：实际 Cesium 类型通过 npm 安装的 @types/cesium 提供
// 此处仅作类型注解用途，不影响运行时
