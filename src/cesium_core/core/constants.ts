/**
 * ============================================================================
 * 全局静态常量配置文件
 * ============================================================================
 * 本文件集中管理 Cesium 地球渲染所需的全部静态配置，包括：
 *   - 相机视角参数（郑州大学主校区）
 *   - 渲染器优化选项
 *   - 图层默认配置
 *   - UI 控件显隐策略
 *
 * @description 所有常量均以 `readonly` 声明，确保运行时不可被意外修改，
 *              便于后续维护者快速定位和调整全局参数。
 */

// =============================================================================
// 郑州大学主校区三维视图配置
// =============================================================================

/**
 * 郑州大学主校区相机视角配置
 *
 * 该配置定义系统启动后默认呈现的地理坐标与空间姿态，
 * 覆盖郑州市高新技术开发区内的主校区核心区域。
 *
 * - 经度(lng): 113.531°E
 * - 纬度(lat): 34.815°N
 * - 高度(height): 1000 m（相对于 WGS84 椭球面的高度）
 * - 朝向(heading): 0°（正北方向）
 * - 俯仰角(pitch): -45°（向下倾斜 45°，形成斜视角而非正射视角）
 * - 翻滚角(roll): 0°（保持水平无旋转）
 */
export const ZZU_CAMERA_CONFIG = {
  /** 目标点经度（单位：度） */
  lng: 113.531,
  /** 目标点纬度（单位：度） */
  lat: 34.815,
  /** 相机高度（单位：米，相对于椭球面） */
  height: 1000,
  /** 水平朝向角（单位：度，0 = 正北，顺时针为正） */
  heading: 0,
  /** 垂直俯仰角（单位：度，负值向下看，-90 = 直视地面） */
  pitch: -45,
  /** 翻滚角（单位：度，0 = 无旋转） */
  roll: 0,
} as const;

/**
 * Cesium Ion 默认访问令牌（预览用）
 *
 * ⚠️ 生产环境请通过环境变量动态注入，禁止将真实令牌硬编码至源码。
 * @see https://cesium.com/ion/tokens
 */
export const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkNzIyNDJjYS1hNzQ0LTRjYzctYmRkNS1lZDg5ZTk2ZDJmNjciLCJpZCI6NDE3ODczLCJpYXQiOjE3NzYxMzk5NzR9._xY1NOoM-IBrcNAfk4bmP0IVlTvgorsChkdqnuuMI44";

// =============================================================================
// Cesium Viewer 容器挂载点 ID
// =============================================================================

/**
 * 默认的 Cesium Viewer 容器 DOM 元素 ID
 * 与 `index.html` 中 `<div id="cesiumContainer">` 保持一致
 */
export const CESIUM_CONTAINER_ID = "cesiumContainer";

// =============================================================================
// 渲染器与场景优化配置
// =============================================================================

/**
 * 默认抗锯齿开关
 *
 * 启用后使用 FXAA（Fast Approximate Anti-Aliasing）算法，
 * 在几乎不影响帧率的前提下有效消除模型边缘锯齿。
 *
 * - `true`:  开启抗锯齿，视觉更平滑（推荐桌面端）
 * - `false`: 关闭抗锯齿，节省 GPU 开销（适用于低端设备或移动端）
 */
export const DEFAULT_ENABLE_FXAA = true;

/**
 * 默认启用对数深度缓冲区（Logarithmic Depth Buffer）
 *
 * 对数深度缓冲区是 Cesium 的性能优化技术：
 * - 允许相机更近距离接近地面而不会出现 Z-Fighting（深度冲突）
 * - 特别适合需要俯视观察微观地物的城市场景
 * - 对视觉效果无负面影响
 */
export const DEFAULT_USE_LOG_DEPTH_BUFFER = true;

/**
 * 场景光照优化配置
 *
 * 控制是否启用场景光源预计算，在静态场景下可减少逐帧光照计算开销。
 * 动态光源（如日照模拟）场景下请保持 `false`。
 */
export const DEFAULT_SCENE_LIGHTING_ENABLED = true;

/**
 * 帧率显示开关（调试用）
 *
 * 设置为 `true` 可在左下角显示实时 FPS 面板，
 * 上线前请确保关闭以避免干扰用户。
 */
export const DEFAULT_SHOW_FRAMERATE = false;

// =============================================================================
// 地形与影像配置
// =============================================================================



/**
 * 默认地形提供者
 *
 * Cesium 全球高程地形（推荐），包含真实起伏，OSM 建筑底部会自然落在地面上。
 *
 * - `undefined`: 不加载地形（最快速，适合纯二维视图）
 * - `EllipsoidTerrainProvider`: 球体地形（光滑椭球，无起伏，建筑悬浮）
 * - `CesiumTerrainProvider.fromIonAssetId(1)`: Cesium Ion 全球地形（需 Token）
 * - `ArcGisWorldElevationTerrainProvider`: ArcGIS 全球高程（无需 Token，推荐）
 *
 * @example
 * // 方式一：Cesium Ion 地形（需配置 CESIUM_ION_TOKEN）
 * const terrain = await CesiumTerrainProvider.fromIonAssetId(1);
 *
 * // 方式二：ArcGIS 高程（无需 Token，国内访问稳定）
 * const terrain = new ArcGisWorldElevationTerrainProvider();
 */
export const DEFAULT_TERRAIN_PROVIDER: any = undefined;

/**
 * 默认影像图层提供者
 *
 * 在 DEFAULT_AUTO_ADD_IMAGERY_LAYER = true 时，由 ViewerManager 自动添加到场景中。
 *
 * 可选方案：
 * - `undefined`: 使用 Cesium Ion 默认卫星影像（需 Token）
 * - `OpenStreetMapImageryProvider`: OSM 地图影像（无需 Token，推荐开发环境）
 * - `BingMapsImageryProvider`: Bing 影像（需 API Key）
 *
 * @example
 * // OSM 街道图（适合开发/调试）
 * new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
 */
export const DEFAULT_IMAGERY_PROVIDER: any = undefined;

/**
 * 影像图层自动加载开关
 *
 * 设为 `true` 时 Viewer 自动加载默认影像图层，
 * 设为 `false` 时需手动调用 `viewer.imageryLayers.addImageryProvider()` 添加底图。
 */
export const DEFAULT_AUTO_ADD_IMAGERY_LAYER = true;

// =============================================================================
// UI 控件显隐配置
// =============================================================================

/**
 * Cesium Viewer 默认隐藏的 UI 控件列表
 *
 * 企业级应用通常需要隐藏 Cesium 默认工具栏，
 * 由我们自主实现更加贴合业务风格的交互控件。
 *
 * 控制项说明：
 * - `animation`: 动画播放控制（时间轴快进）
 * - `timeline`: 底部时间轴
 * - `baseLayerPicker`: 底图切换器
 * - `navigationHelpButton`: 操作帮助提示按钮
 * - `geocoder`: 地点搜索框
 * - `homeButton`: 回到初始视角按钮
 * - `infoBox`: 实体信息弹窗
 * - `selectionIndicator`: 选中高亮指示器
 * - `fullscreenButton`: 全屏按钮
 * - `sceneModePicker`: 视角模式切换（2D/3D/Columbus View）
 * - `creditContainer`: 版权信息栏
 * - `shadows`: 阴影控制面板
 * - `shouldAnimate`: 自动播放动画
 */
export const DEFAULT_HIDDEN_WIDGETS = {
  /** 动画控件 - 时间播放相关 */
  animation: false,
  /** 底部时间轴 */
  timeline: false,
  /** 底图切换面板 */
  baseLayerPicker: false,
  /** 右上角操作提示按钮 */
  navigationHelpButton: false,
  /** 地点搜索框 */
  geocoder: false,
  /** 主页按钮 */
  homeButton: false,
  /** 实体信息弹框 */
  infoBox: false,
  /** 选中实体高亮指示器 */
  selectionIndicator: false,
  /** 全屏切换按钮 */
  fullscreenButton: false,
  /** 视角模式切换器（2D/3D/Columbus） */
  sceneModePicker: false,
  /** 版权信息容器（可选隐藏以保持界面简洁） */
  creditContainer: false,
  /** 阴影控制面板 */
  shadows: false,
  /** 自动播放动画 */
  shouldAnimate: false,
} as const;

/**
 * 场景模式枚举
 *
 * 定义 Cesium 支持的三种视图渲染模式，
 * 默认使用 3D 球模式以展现真实地球曲面效果。
 */
export enum SceneMode {
  /** 三维球模式（默认），展现真实地球曲面与立体模型 */
  SCENE3D = 3,
  /** 二维平面模式，适合宏观数据可视化或地图展示 */
  SCENE2D = 2,
  /** Columbus 模式（2.5D），结合二维布局与透视效果 */
  COLUMBUS_VIEW = 1,
}

/**
 * 默认场景模式
 * 采用三维球模式以匹配"城市微环境"的空间分析需求
 */
export const DEFAULT_SCENE_MODE = SceneMode.SCENE3D;

// =============================================================================
// 相机飞行参数配置
// =============================================================================

/**
 * 相机飞行动画时长（秒）
 *
 * 控制视角从初始位置飞行至 ZZU_CAMERA_CONFIG 目标点的过渡时间。
 * 值越大动画越平滑但等待感越强，建议范围 1.0 ~ 3.0 秒。
 */
export const CAMERA_FLIGHT_DURATION = 2.0;

/**
 * 相机最大海拔高度限制（米）
 *
 * 防止用户误操作将视角拉升至过高的太空高度，
 * 影响城市场景的视觉沉浸感。·
 */
export const CAMERA_MAX_HEIGHT = 50000;

/**
 * 相机最小海拔高度限制（米）
 *
 * 防止用户视角过低（接近地面），
 * 城市场景建议不低于 50m 以保持可操作性。
 */
export const CAMERA_MIN_HEIGHT = 50;

// =============================================================================
// 性能监控阈值
// =============================================================================

/**
 * 帧率告警阈值（FPS）
 *
 * 当连续 5 秒内平均帧率低于此值时，
 * 可触发降级策略（如降低地形细节 LOD、关闭抗锯齿等）。
 */
export const FPS_WARNING_THRESHOLD = 30;

/**
 * 内存告警阈值（MB）
 *
 * 当检测到 WebGL 上下文显存占用超过此值时，
 * 应触发数据清理或提示用户刷新页面。
 */
export const MEMORY_WARNING_THRESHOLD_MB = 2048;
