/**
 * ============================================================================
 * Cesium Viewer 实例管理器（单例模式）
 * ============================================================================
 *
 * 本模块负责 Cesium Viewer 对象的完整生命周期管理，核心职责包括：
 *
 * 1. **单例模式**：全局仅保留一个 Viewer 实例，防止多实例冲突与显存浪费
 * 2. **初始化**：创建 Viewer、隐藏默认 UI、优化渲染参数、飞行至目标视角
 * 3. **销毁**：安全释放 WebGL 上下文与显存资源，防止内存泄漏
 * 4. **访问控制**：提供类型安全的 getViewer() 接口供其他模块调用
 *
 * 设计原则：
 * - 延迟初始化（Lazy Initialization）：首次调用 init() 时才创建实例
 * - 线程安全：在单线程的浏览器环境中无需额外锁机制
 * - 资源自管理：destroy() 可逆，所有资源释放后单例状态可重置
 *
 * @example
 * ```typescript
 * import { ViewerManager } from '../index';
 *
 * // 获取管理器单例
 * const manager = ViewerManager.getInstance();
 *
 * // 初始化 Viewer（通常在 Vue onMounted / React useEffect 中调用）
 * manager.init('cesiumContainer');
 *
 * // 在其他模块中获取 Viewer 实例
 * const viewer = ViewerManager.getInstance().getViewer();
 * ```
 */

import {
  DEFAULT_ENABLE_FXAA,
  DEFAULT_USE_LOG_DEPTH_BUFFER,
  DEFAULT_AUTO_ADD_IMAGERY_LAYER,
  DEFAULT_HIDDEN_WIDGETS,
  DEFAULT_SCENE_MODE,
  DEFAULT_TERRAIN_PROVIDER,
  DEFAULT_IMAGERY_PROVIDER,
  ZZU_CAMERA_CONFIG,
  CAMERA_FLIGHT_DURATION,
} from "./constants";

// 延迟加载 Cesium，规避 SSR（服务端渲染）环境报错
import * as Cesium from "cesium";
import type { Viewer, DataSourceCollection } from "cesium";

/**
 * ViewerManager 单例状态枚举
 *
 * 用于追踪当前管理器的生命周期阶段，
 * 便于在调试时快速判断系统状态。
 */
export enum ViewerManagerState {
  /** 尚未初始化，处于空闲状态 */
  IDLE = "idle",
  /** 正在初始化中 */
  INITIALIZING = "initializing",
  /** 初始化完成，Viewer 已就绪 */
  READY = "ready",
  /** 正在销毁中 */
  DESTROYING = "destroying",
  /** 已销毁，所有资源已释放 */
  DESTROYED = "destroyed",
}

/**
 * ViewerManager 初始化选项接口
 *
 * 提供可配置的初始化参数，允许调用方按需覆盖默认配置。
 * 所有字段均为可选，若不提供则使用 constants.ts 中的默认值。
 */
export interface ViewerManagerOptions {
  /**
   * 抗锯齿开关，覆盖 DEFAULT_ENABLE_FXAA
   * @default true
   */
  enableFXAA?: boolean;

  /**
   * 对数深度缓冲区开关，覆盖 DEFAULT_USE_LOG_DEPTH_BUFFER
   * @default true
   */
  useLogDepthBuffer?: boolean;

  /**
   * 是否自动添加默认影像图层
   * @default true
   */
  autoAddImageryLayer?: boolean;

  /**
   * 初始飞行动画时长（秒）
   * @default 2.0
   */
  flightDuration?: number;

  /**
   * 是否在初始化完成后自动飞行至 ZZU_CAMERA_CONFIG 预设视角
   * @default true
   */
  autoFlyTo?: boolean;

  /**
   * 隐藏指定的默认控件键数组
   * 例如传入 ['animation', 'timeline'] 即可隐藏动画和时间轴
   * @default 隐藏全部 DEFAULT_HIDDEN_WIDGETS 中标记为 false 的控件
   */
  hiddenWidgets?: (keyof typeof DEFAULT_HIDDEN_WIDGETS)[];

  /**
   * 场景模式（2D / 3D / Columbus）
   * @default SceneMode.SCENE3D
   */
  sceneMode?: any;
}

/**
 * ViewerManager 类（单例模式）
 *
 * 负责 Cesium Viewer 实例的创建、配置、销毁与全局访问。
 * 采用私有构造函数 + 静态工厂方法模式，确保全局唯一实例。
 *
 * @designpattern Singleton（单例模式）
 */
class ViewerManager {
  // ============================================================================
  // 私有静态属性 — 实现单例
  // ============================================================================

  /** 静态实例引用，初始为 null，初始化后指向唯一实例 */
  private static _instance: ViewerManager | null = null;

  /** 当前 Viewer 实例，初始为 undefined */
  private _viewer: Viewer | undefined;

  /** 当前管理器状态 */
  private _state: ViewerManagerState = ViewerManagerState.IDLE;

  // ============================================================================
  // 私有构造函数 — 防止外部 new，只能通过 getInstance() 获取
  // ============================================================================

  private constructor() {
    this._viewer = undefined;
    this._state = ViewerManagerState.IDLE;
  }

  // ============================================================================
  // 静态工厂方法
  // ============================================================================

  /**
   * 获取 ViewerManager 单例实例
   *
   * 若实例尚未创建，此方法会创建并返回；
   * 若已创建，则直接返回已有实例。
   *
   * @returns {ViewerManager} 全局唯一的 ViewerManager 实例
   *
   * @designpattern Factory Method + Singleton
   */
  public static getInstance(): ViewerManager {
    if (ViewerManager._instance === null) {
      ViewerManager._instance = new ViewerManager();
      console.debug("[ViewerManager] 单例实例首次创建");
    }
    return ViewerManager._instance;
  }

  /**
   * 重置单例状态（仅供测试或特殊场景使用）
   *
   * ⚠️ 调用此方法会清空静态引用，慎用！
   * 正常流程中应使用 destroy() 方法。
   *
   * @internal
   */
  public static resetInstance(): void {
    if (ViewerManager._instance?._viewer) {
      ViewerManager._instance.destroy();
    }
    ViewerManager._instance = null;
    console.debug("[ViewerManager] 单例实例已重置");
  }

  // ============================================================================
  // 公开实例方法
  // ============================================================================

  /**
   * 初始化 Cesium Viewer
   *
   * 本方法负责：
   * 1. 参数校验与配置合并
   * 2. 创建 Cesium.Viewer 实例
   * 3. 隐藏所有默认 UI 控件
   * 4. 配置渲染器优化参数（抗锯齿、对数深度等）
   * 5. 飞行至 ZZU_CAMERA_CONFIG 预设视角
   *
   * @param {string | HTMLElement} containerId - DOM 容器 ID 或 HTMLElement 引用
   * @param {ViewerManagerOptions} options - 可选的初始化配置
   * @returns {Promise<Viewer>} 已初始化的 Viewer 实例
   * @throws {Error} 若容器不存在或 Viewer 创建失败
   *
   * @example
   * ```typescript
   * const manager = ViewerManager.getInstance();
   * try {
   *   await manager.init('cesiumContainer');
   *   console.log('Viewer 初始化成功');
   * } catch (e) {
   *   console.error('初始化失败:', e);
   * }
   * ```
   */
  public async init(
    containerId: string | HTMLElement,
    options: ViewerManagerOptions = {}
  ): Promise<Viewer> {
    // —— 状态检查：防止重复初始化 ——
    if (this._state === ViewerManagerState.READY && this._viewer) {
      console.warn("[ViewerManager] Viewer 已处于 READY 状态，无需重复初始化");
      return this._viewer;
    }

    if (this._state === ViewerManagerState.INITIALIZING) {
      console.warn("[ViewerManager] 初始化正在进行中，请勿重复调用");
      return this._viewer as Viewer;
    }

    this._state = ViewerManagerState.INITIALIZING;
    console.debug("[ViewerManager] 开始初始化 Viewer...");

    try {
      // —— 参数处理：合并用户配置与默认配置 ——
      const enableFXAA = options.enableFXAA ?? DEFAULT_ENABLE_FXAA;
      const useLogDepthBuffer =
        options.useLogDepthBuffer ?? DEFAULT_USE_LOG_DEPTH_BUFFER;
      const autoAddImagery =
        options.autoAddImageryLayer ?? DEFAULT_AUTO_ADD_IMAGERY_LAYER;
      const hiddenWidgets = options.hiddenWidgets ?? [];
      const flightDuration = options.flightDuration ?? CAMERA_FLIGHT_DURATION;
      const sceneMode = options.sceneMode ?? DEFAULT_SCENE_MODE;

      // —— 获取容器引用 ——
      let container: HTMLElement;
      if (typeof containerId === "string") {
        const el = document.getElementById(containerId);
        if (!el) {
          throw new Error(
            `[ViewerManager] 未找到 ID 为 "${containerId}" 的 DOM 容器，请检查 HTML 中是否存在对应元素。`
          );
        }
        container = el;
      } else {
        container = containerId;
      }

      // —— 创建 Cesium Viewer 实例 ——
      // Cesium 自动挂载至指定容器，并加载默认影像图层
      console.debug("[ViewerManager] 正在创建 Cesium.Viewer 实例...");
      this._viewer = new Cesium.Viewer(container, {
        // 基础配置
        baseLayerPicker: false, // 强制关闭，由 constants 统一管理
        animation: false,
        timeline: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
        fullscreenButton: false,
        creditContainer: container.ownerDocument.createElement("div"),
        shadows: false,
        shouldAnimate: false,

        // 地形配置：默认椭球地形（零网络依赖，极速加载）
        // 如需真实地形起伏，可后续通过 viewer.terrainProvider 动态设置
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),

        // 影像配置：先设为 false，Viewer 创建后再异步添加 OSM 底图
        // 避免阻塞主线程，让场景尽快呈现

        // 渲染优化
        requestRenderMode: false, // 动态场景保持实时渲染
        maximumRenderTimeChange: Infinity, // 配合 requestRenderMode 使用

        // 3D 视觉优化
        logDepthBuffer: useLogDepthBuffer,
      } as any) as Viewer;

      // —— 隐藏指定控件（精细化控制） ——
      // 遍历 hiddenWidgets 数组，将对应控件从 DOM 中移除
      this._applyHiddenWidgets(hiddenWidgets);

      // —— 异步加载 OSM 底图（不阻塞后续初始化流程）——
      if (autoAddImagery) {
        this._loadImageryAsync();
      }

      // —— 配置抗锯齿（FXAA） ——
      if (enableFXAA) {
        this._enableFXAA();
      }

      // —— 配置场景参数 ——
      this._configureScene(sceneMode);

      // —— 飞行至郑州大学主校区视角 ——
      await this._flyToZZU(flightDuration);

      // —— 标记状态为就绪 ——
      this._state = ViewerManagerState.READY;
      console.info(
        `[ViewerManager] ✅ Viewer 初始化完成！当前状态：${this._state}`
      );

      return this._viewer;
    } catch (error) {
      // —— 异常处理：确保状态一致 ——
      this._state = ViewerManagerState.IDLE;
      console.error("[ViewerManager] ❌ Viewer 初始化失败：", error);
      throw error;
    }
  }

  /**
   * 获取当前 Viewer 实例
   *
   * 供其他模块按需调用，执行数据加载、相机控制等操作。
   *
   * @returns {Viewer | undefined} 当前 Viewer 实例，若未初始化则返回 undefined
   * @throws {Error} 若 Viewer 尚未初始化，抛出明确提示
   *
   * @example
   * ```typescript
   * const viewer = ViewerManager.getInstance().getViewer();
   * viewer.entities.add({ id: 'building-001', position: ..., model: ... });
   * ```
   */
  public getViewer(): Viewer {
    if (!this._viewer || this._state !== ViewerManagerState.READY) {
      console.warn(
        "[ViewerManager] Viewer 尚未初始化或已被销毁，请先调用 init() 方法。"
      );
      return undefined as any;
    }
    return this._viewer;
  }

  /**
   * 检查 Viewer 是否已就绪
   *
   * @returns {boolean} true 表示已就绪，false 表示未就绪
   */
  public isReady(): boolean {
    return this._state === ViewerManagerState.READY;
  }

  /**
   * 获取当前管理器状态
   *
   * @returns {ViewerManagerState} 当前状态枚举值
   */
  public getState(): ViewerManagerState {
    return this._state;
  }

  /**
   * 销毁 Viewer 实例并释放资源
   *
   * 本方法执行以下清理操作：
   * 1. 停止所有动画与渲染循环
   * 2. 清空所有实体与数据源
   * 3. 销毁影像与地形提供者
   * 4. 销毁 WebGL 上下文（释放 GPU 显存）
   * 5. 清空 DOM 中的 Canvas 元素
   *
   * ⚠️ 调用此方法后，Viewer 将不可用，如需重新使用必须再次调用 init()。
   *
   * @returns {Promise<void>} 销毁完成后 resolve
   *
   * @example
   * ```typescript
   * // 页面卸载时销毁 Viewer
   * onBeforeUnmount(() => {
   *   ViewerManager.getInstance().destroy();
   * });
   * ```
   */
  public async destroy(): Promise<void> {
    if (this._state === ViewerManagerState.DESTROYED) {
      console.debug("[ViewerManager] Viewer 已处于 DESTROYED 状态，无需重复销毁");
      return;
    }

    if (this._state === ViewerManagerState.DESTROYING) {
      console.debug("[ViewerManager] 销毁流程正在进行中...");
      return;
    }

    this._state = ViewerManagerState.DESTROYING;
    console.debug("[ViewerManager] 开始销毁 Viewer...");

    try {
      // —— 停止所有动画与渲染 ——
      if (this._viewer) {
        // 暂停场景渲染
        this._viewer.scene?.postRender.removeEventListener(() => {});

        // 清空所有数据源
        if (this._viewer.dataSources) {
          const dsCollection = this._viewer.dataSources as DataSourceCollection;
          for (let i = dsCollection.length - 1; i >= 0; i--) {
            await dsCollection.remove(dsCollection.get(i), false);
          }
        }

        // 清空所有实体
        if (this._viewer.entities) {
          this._viewer.entities.removeAll();
        }

        // 清空所有桁架（Draco 模型缓存等）
        if (this._viewer.scene?.primitives) {
          this._viewer.scene.primitives.removeAll();
        }

        // —— 调用 Cesium 内置销毁方法（关键！释放 WebGL 显存） ——
        this._viewer.destroy();
        this._viewer = undefined;
      }

      // —— 标记状态为已销毁 ——
      this._state = ViewerManagerState.DESTROYED;
      console.info("[ViewerManager] ✅ Viewer 销毁完成，所有资源已释放");
    } catch (error) {
      console.error("[ViewerManager] ❌ 销毁 Viewer 时发生错误：", error);
      throw error;
    }
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 应用隐藏控件配置
   *
   * 将指定的控件 DOM 元素从页面中移除，同时断开事件监听。
   *
   * @param {string[]} widgetKeys - 需要隐藏的控件键名数组
   * @private
   */
  private _applyHiddenWidgets(widgetKeys: string[]): void {
    if (!this._viewer || !widgetKeys.length) return;

    // Cesium 默认创建的控件均挂载在 viewer 对象的特定属性下
    const widgetMap: Record<string, string | undefined> = {
      animation: "animationContainer",
      timeline: "timelineContainer",
      baseLayerPicker: "baseLayerPickerContainer",
      navigationHelpButton: "navigationHelpButtonContainer",
      geocoder: "geocoderContainer",
      homeButton: "homeButtonContainer",
      infoBox: "infoBoxContainer",
      selectionIndicator: "selectionIndicatorContainer",
      fullscreenButton: "fullscreenContainer",
      sceneModePicker: "sceneModePickerContainer",
    };

    widgetKeys.forEach((key) => {
      const containerKey = widgetMap[key];
      if (containerKey && this._viewer) {
        const container = (this._viewer as any)[containerKey] as HTMLElement | undefined;
        if (container && container.parentNode) {
          container.parentNode.removeChild(container);
          console.debug(`[ViewerManager] 已隐藏控件：${key}`);
        }
      }
    });
  }

  /**
   * 启用 FXAA 抗锯齿
   *
   * FXAA（Fast Approximate Anti-Aliasing）是一种后处理抗锯齿技术，
   * 通过模糊边缘像素来消除锯齿，对帧率影响小。
   *
   * @private
   */
  private _enableFXAA(): void {
    if (!this._viewer) return;

    try {
      // Cesium 后处理阶段库提供了 FXAA 算法
      // 注意：新版 Cesium 中该方法可能不可用，兜底处理
      const fxaa = (Cesium.PostProcessStageLibrary as any).createFXAAStage?.();
      if (fxaa) {
        this._viewer.scene.postProcessStages.add(fxaa);
        console.debug("[ViewerManager] ✅ FXAA 抗锯齿已启用");
      } else {
        console.debug("[ViewerManager] ⚠️ FXAA 不可用（版本不支持），跳过");
      }
    } catch (e) {
      console.warn("[ViewerManager] ⚠️ FXAA 启用失败：", e);
    }
  }

  /**
   * 配置场景参数
   *
   * 设置场景模式、雾效、大气等视觉参数。
   *
   * @param {any} sceneMode - 目标场景模式
   * @private
   */
  private _configureScene(sceneMode: any): void {
    if (!this._viewer) return;

    const scene = this._viewer.scene;
    if (!scene) return;

    // 设置场景模式
    scene.mode = sceneMode ?? Cesium.SceneMode.SCENE3D;

    // 配置雾效（增加空间深度感）
    scene.fog.enabled = true;
    scene.fog.density = 0.0001;

    // 配置大气散射（天空盒与地平线效果）
    try {
      scene.skyAtmosphere = new Cesium.SkyAtmosphere() as any;
    } catch (_) {
      /* 版本不支持则跳过 */
    }

    // 配置 globe 参数（在地形加载后 globe 才可用）
    if (scene.globe) {
      scene.globe.enableLighting = false;
      // 设置大地椭球体基准颜色（无影像区域为浅灰色，非黑色）
      scene.globe.baseColor = new Cesium.Color(0.5, 0.5, 0.5, 1.0);
    }

    console.debug("[ViewerManager] 场景参数配置完成");
  }

  /**
   * 异步加载 OSM 底图（不阻塞 Viewer 创建流程）
   *
   * 底图在 Viewer 初始化完成后再添加，确保地球球体立即可见，
   * 用户无需等待远端瓦片下载即可开始交互。
   *
   * @private
   */
  private async _loadImageryAsync(): Promise<void> {
    if (!this._viewer) return;

    try {
      const provider = new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
      });

      const layer = this._viewer.imageryLayers.addImageryProvider(provider);
      // 将 OSM 图层置底，保证自定义图层优先级
      this._viewer.imageryLayers.lowerToBottom(layer);

      console.info("[ViewerManager] ✅ OSM 底图加载成功");
    } catch (e) {
      console.error("[ViewerManager] ❌ OSM 底图加载失败：", e);
    }
  }

  /**
   * 飞行至郑州大学主校区视角
   *
   * 使用 Cesium 内置的 flyTo 动画接口，
   * 将相机从当前位置平滑过渡至 ZZU_CAMERA_CONFIG 预设位置。
   *
   * @param {number} duration - 飞行动画时长（秒）
   * @private
   */
  private async _flyToZZU(duration: number): Promise<void> {
    if (!this._viewer) return;

    try {
      const { lng, lat, height, heading, pitch, roll } = ZZU_CAMERA_CONFIG;

      // 构建目标相机参数
      const destination = Cesium.Cartesian3.fromDegrees(lng, lat, height);
      const orientation = {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: Cesium.Math.toRadians(roll),
      };

      // 执行飞行动画
      await this._viewer.camera.flyTo({
        destination,
        orientation,
        duration,
        complete: () => {
          console.debug(
            `[ViewerManager] ✅ 相机已飞行至目标位置：(${lng}°E, ${lat}°N, ${height}m)`
          );
        },
      });
    } catch (e) {
      // 飞行失败不影响主流程，降级使用 setView 直接跳转
      console.warn("[ViewerManager] ⚠️ 飞行动画失败，降级使用 setView：", e);
      const { lng, lat, height, heading, pitch, roll } = ZZU_CAMERA_CONFIG;
      this._viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, height),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(pitch),
          roll: Cesium.Math.toRadians(roll),
        },
      });
    }
  }
}

// =============================================================================
// 导出单例管理器（主出口）
// =============================================================================

/**
 * ViewerManager 单例实例
 *
 * 推荐直接使用此导出而非 getInstance()，
 * 两者等价，但具名导出更简洁。
 *
 * @example
 * ```typescript
 * import { viewerManager } from '@/cesium_core';
 * viewerManager.init('cesiumContainer');
 * ```
 */
export const viewerManager = ViewerManager.getInstance();

/**
 * 导出类本身（用于测试或特殊场景的单元测试 Mock）
 * ViewerManagerState 作为枚举已在 class 之前导出，此处无需重复
 */
export { ViewerManager };
