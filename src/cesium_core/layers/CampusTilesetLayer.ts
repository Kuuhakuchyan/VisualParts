/**
 * ============================================================================
 * 校园建筑群 3D Tileset 图层管理器
 * ============================================================================
 *
 * 本模块负责"城市数字底座"的 3D Tileset 加载与单体建筑控制。
 *
 * 核心职责：
 * 1. **底座加载**：支持加载自定义 3D Tiles 数据（校园高精模型）；
 *    无数据传入时，自动降级为 OSM 建筑白模兜底。
 * 2. **生命周期管理**：Tileset 的添加、显隐控制与销毁释放。
 * 3. **单体建筑控制**：封装对单个建筑要素（Cesium3DTileFeature）的操作接口，
 *    为后续"拔楼"推演交互奠定对象级控制能力。
 *
 * 设计原则：
 * - **依赖注入（DI）**：通过构造函数接收 `Cesium.Viewer` 实例，
 *    不依赖全局状态，便于单元测试与多实例管理。
 * - **空值安全**：所有方法均对 `_tileset` 和 `_viewer` 进行防御性检查。
 * - **降级兜底**：未传入 tileset URL 时自动使用 `createOsmBuildingsAsync()` 作为演示环境备选。
 *
 * @module layers/CampusTilesetLayer
 */

import * as Cesium from "cesium";
import type { Viewer } from "cesium";

/**
 * 3D Tileset 加载选项接口
 *
 * 定义 `load()` 方法的可选配置参数，
 * 调用方可通过此类参数精细控制 tileset 的行为。
 */
export interface TilesetLoadOptions {
  /**
   * 是否自动将视角飞行至 tileset 边界范围
   *
   * - `true`：加载完成后自动调用 `viewer.zoomTo(tileset)` 将相机调整至最佳视野
   * - `false`：保持当前相机位置不动（默认）
   *
   * @default false
   */
  autoFlyTo?: boolean;

  /**
   * 飞行至 tileset 后的俯仰角（单位：弧度）
   *
   * 仅在 `autoFlyTo = true` 时生效。
   * - 默认 `Cesium.Math.PI_OVER_TWO`（45° 斜视角）
   *
   * @default Cesium.Math.PI_OVER_TWO
   */
  pitch?: number;

  /**
   * Tileset 可见距离缩放系数
   *
   - 默认 `1.0`（使用 tileset 原始 `maximumScreenSpaceError` 策略）。
   * - 值越小越激进加载（更远距离也显示模型），值越大越保守（近处才加载）。
   *
   * @default 1.0
   */
  distanceScale?: number;

  /**
   * 加载完成回调函数
   *
   * 在 tileset 首次完成加载后触发，可用于批量设置建筑样式等。
   *
   * @param tileset - 已加载的 Cesium3DTileset 实例
   */
  onLoaded?: (tileset: Cesium.Cesium3DTileset) => void;
}

/**
 * 建筑单体可见性状态
 *
 * 记录每个建筑 feature 的原始可见性状态，
 * 用于后续恢复可见性（undoHide）时回溯。
 */
interface FeatureVisibilityState {
  /** 建筑 feature 标识（内部使用 feature 引用本身作为 key） */
  feature: Cesium.Cesium3DTileFeature;
  /** 原始 show 值（用于恢复） */
  originalShow: boolean;
}

/**
 * CampusTilesetLayer — 校园建筑群 3D Tileset 图层管理器
 *
 * 本类不负责 Viewer 的创建与管理（由 ViewerManager 统一管理），
 * 仅通过依赖注入的方式持有 Viewer 引用，执行 tileset 层的操作。
 *
 * @designpattern Dependency Injection（依赖注入）
 *
 * @example
 * ```typescript
 * import { viewerManager } from '@/cesium_core';
 * import { CampusTilesetLayer } from '@/cesium_core/layers/CampusTilesetLayer';
 *
 * // 获取 Viewer 实例
 * const viewer = viewerManager.getViewer();
 *
 * // 创建图层管理器
 * const campusLayer = new CampusTilesetLayer(viewer);
 *
 * // 加载校园高精度模型（未提供 URL 则自动降级为 OSM 白模）
 * await campusLayer.load();
 *
 * // 隐藏指定建筑
 * const building = await campusLayer.getBuildingFeatureById('BLDG_001');
 * if (building) campusLayer.hideBuilding(building);
 *
 * // 销毁图层
 * await campusLayer.destroy();
 * ```
 */
export class CampusTilesetLayer {
  // =============================================================================
  // 私有属性
  // =============================================================================

  /**
   * Cesium Viewer 实例引用
   *
   * 通过构造函数注入，用于访问 `scene.primitives` 集合。
   * 使用 `private readonly` 声明，运行期不可重新赋值。
   */
  private readonly _viewer: Viewer;

  /**
   * 当前加载的 3D Tileset 实例
   *
   * 初始化为 `null`，在 `load()` 成功后方有值。
   * 每次调用 `load()` 时若已有 tileset，会先销毁旧实例再加载新的。
   */
  private _tileset: Cesium.Cesium3DTileset | null = null;

  /**
   * 已隐藏建筑的状态记录栈
   *
   * 用于记录每个被隐藏建筑的原始可见性状态，
   * 便于后续支持 `undoHide()` 恢复操作。
   *
   * 键为 feature 的字符串化引用，值为原始可见性状态。
   */
  private _hiddenFeatures: Map<
    Cesium.Cesium3DTileFeature,
    FeatureVisibilityState
  > = new Map();

  /**
   * 图层是否已加载标识
   */
  private _isLoaded: boolean = false;

  // =============================================================================
  // 构造函数
  // =============================================================================

  /**
   * 构造函数
   *
   * 通过依赖注入接收 Viewer 实例，建立本图层与渲染器的关联。
   * 不在内部创建 Viewer，确保职责单一（单一职责原则 SRP）。
   *
   * @param {Viewer} viewer - 已初始化的 Cesium.Viewer 实例
   * @throws {Error} 若传入的 viewer 为 null 或 undefined
   */
  constructor(viewer: Viewer) {
    if (!viewer) {
      throw new Error(
        "[CampusTilesetLayer] 构造函数接收的 viewer 参数不能为空，请先调用 viewerManager.init() 创建 Viewer。"
      );
    }
    this._viewer = viewer;
    this._tileset = null;
    this._hiddenFeatures = new Map();
    this._isLoaded = false;

    console.debug("[CampusTilesetLayer] 实例已创建，等待 load() 调用...");
  }

  // =============================================================================
  // 公开只读属性（getters）
  // =============================================================================

  /**
   * 获取当前 tileset 实例
   *
   * 若尚未加载则返回 `null`，调用方可通过此属性判断加载状态。
   *
   * @returns {Cesium.Cesium3DTileset | null} 当前 tileset 或 null
   */
  public get tileset(): Cesium.Cesium3DTileset | null {
    return this._tileset;
  }

  /**
   * 获取图层是否已成功加载
   *
   * @returns {boolean} true 表示已加载，false 表示未加载或已销毁
   */
  public get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * 获取已隐藏建筑的数量
   *
   * 可用于 UI 侧边栏显示当前"拔楼"数量等。
   *
   * @returns {number} 已隐藏的建筑数量
   */
  public get hiddenCount(): number {
    return this._hiddenFeatures.size;
  }

  // =============================================================================
  // 核心方法
  // =============================================================================

  /**
   * 加载 3D Tileset 底座
   *
   * 根据是否传入 `url` 参数，走两条不同的加载路径：
   *
   * **分支 1（自定义底座）**：当 `url` 有值时
   * - 使用 `Cesium.Cesium3DTileset.fromUrl(url)` 异步加载高精度城市/校园模型
   * - URL 通常指向 Cesium Ion 上的资产（如 `await Cesium.Cesium3DTileset.fromIonAssetId(12345)`）
   * - 或直接传入 `.json` 后缀的 3D Tileset manifest 地址
   *
   * **分支 2（兜底底座）**：当 `url` 为空时
   * - 调用 `Cesium.createOsmBuildingsAsync()` 加载全球 OSM 建筑白模
   * - 作为演示/开发环境的降级方案，无需准备任何外部数据
   * - OSMBuildings 数据托管于 Cesium Ion，无需本地部署
   *
   * 两种分支最终都执行：
   * 1. 将 tileset 添加至 `viewer.scene.primitives`
   * 2. 可选自动飞行至 tileset 范围
   * 3. 监听加载完成事件
   *
   * @param {string} [url] - 3D Tileset manifest 地址（可选）
   *
   * **常见 URL 格式示例：**
   * ```
   * // Cesium Ion 资产 ID（需配置 Ion Token）
   * await load(await Cesium.Cesium3DTileset.fromIonAssetId(16421))
   *
   * // 直接 HTTP 地址（需配置 CORS 头）
   * await load('https://assets.cesium.com/16421/tileset.json')
   *
   * // 本地相对路径（配合 Cesium viewer 的 assetRoot 使用）
   * await load('/data/campus_tileset/tileset.json')
   * ```
   *
   * @param {TilesetLoadOptions} [options] - 可选配置项
   * @returns {Promise<Cesium.Cesium3DTileset>} 加载完成的 tileset 实例
   *
   * @throws {Error} 若 tileset URL 无效、加载超时或 WebGL 上下文异常
   *
   * @example
   * ```typescript
   * // 方式一：加载 OSM 白模（无需准备数据）
   * const campusLayer = new CampusTilesetLayer(viewer);
   * await campusLayer.load();
   *
   * // 方式二：加载自定义校园模型
   * await campusLayer.load('https://example.com/campus_tileset.json', {
   *   autoFlyTo: true,
   *   distanceScale: 0.8,
   *   onLoaded: (tileset) => {
   *     console.log('Tileset 已加载，总要素数：', tileset.statistics.numberOfFeatures);
   *   }
   * });
   * ```
   */
  public async load(
    url?: string,
    options: TilesetLoadOptions = {}
  ): Promise<Cesium.Cesium3DTileset> {
    // —— 前置检查：若已有 tileset，先销毁 ——
    if (this._tileset) {
      console.warn(
        "[CampusTilesetLayer] 检测到已有 tileset，将先销毁旧实例再加载新的..."
      );
      await this.destroy();
    }

    console.debug(
      `[CampusTilesetLayer] 开始加载 tileset，URL: ${url ?? '（未提供，降级为 OSM 白模）'}`
    );

    try {
      let tileset: Cesium.Cesium3DTileset;

      // —— 分支判断：自定义底座 vs 兜底底座 ——
      if (url && url.trim() !== "") {
        // 【分支 1】自定义底座
        // 使用 Cesium 异步工厂方法加载，支持远程 URL 和 Ion 资产
        tileset = await Cesium.Cesium3DTileset.fromUrl(url);
      } else {
        // 【分支 2】兜底底座 — OSM 建筑白模
        // createOsmBuildingsAsync() 封装了对 Cesium Ion OSM Buildings 资产的加载逻辑
        // 无需手动配置 Ion Token，Cesium 已内置公共 Token
        tileset = await Cesium.createOsmBuildingsAsync();
      }

      // —— 保存引用 ——
      this._tileset = tileset;

      // —— 应用可选配置 ——
      if (options.distanceScale !== undefined && options.distanceScale !== 1.0) {
        // 调整可见距离：降低 threshold 使远处建筑也能显示
        // 注意：maximumScreenSpaceError 越小模型越精细，越大则越粗略
        tileset.maximumScreenSpaceError =
          (tileset.maximumScreenSpaceError ?? 16) * options.distanceScale;
      }

      // —— 添加至场景渲染管线 ——
      this._viewer.scene.primitives.add(tileset);
      console.debug("[CampusTilesetLayer] tileset 已添加至 scene.primitives");

      // —— 监听加载完成事件 ——
      // initialTilesLoaded 事件在 tileset 所有根瓦片加载完成后触发一次
      // 而非每次视口变化时的增量加载
      const initLoadedHandler = () => {
        this._isLoaded = true;
        console.info(
          `[CampusTilesetLayer] ✅ tileset 初始加载完成！加载统计：${
            // Cesium 1.109+ 提供 statistics 对象，以下为兼容写法
            (tileset as any).statistics
              ? `建筑数=${(tileset as any).statistics.numberOfFeatures ?? 'N/A'}，`
              : ''
          }瓦片数=${(tileset as any).numberOfLoadedTilesTotal ?? 'N/A'}`
        );

        // 触发用户回调
        options.onLoaded?.(tileset);
      };

      // 仅首次加载完成后触发（避免多次调用）
      if ((tileset as any).initialTilesLoaded) {
        initLoadedHandler();
      } else {
        // 兜底：监听 initialTilesLoaded 事件（Cesium 内部在加载完成后触发）
        (tileset as any).initialTilesLoadedPromise?.then(initLoadedHandler);
      }

      // —— 可选：飞行至 tileset 范围 ——
      if (options.autoFlyTo) {
        await this._flyToTileset(options.pitch);
      }

      return tileset;
    } catch (error) {
      console.error("[CampusTilesetLayer] ❌ tileset 加载失败：", error);
      throw error;
    }
  }

  /**
   * 隐藏指定单体建筑
   *
   * 本方法是"拔楼"模拟交互的核心接口。
   * 通过将 `Cesium3DTileFeature` 的 `show` 属性设置为 `false`，
   * 实现建筑从渲染场景中消失，同时记录原始状态以支持后续恢复。
   *
   * **类型说明**：
   * - 入参类型声明为 `any` 是出于 Cesium 版本兼容性考虑
   * - 不同版本 Cesium 对 `Cesium3DTileFeature` 的类型定义存在差异
   * - 实际入参应为 `Cesium.Cesium3DTileFeature`（3D Tiles 瓦片中的单个建筑要素）
   *
   * **Cesium3DTileFeature 背景知识**：
   * - `Cesium3DTileFeature` 代表 3D Tileset 中一个瓦片（tile）内的要素（feature）
   * - 在建筑场景中，每个 feature 通常对应一栋建筑
   * - `feature.show` 属性控制该建筑是否在场景中可见
   * - 继承自 `Cesium.PropertyBag`，可通过 `feature.getProperty('building_id')` 等方法读取建筑属性
   *
   * @param {any} feature - Cesium3DTileFeature 实例（代表某栋建筑）
   * @returns {boolean} true 表示隐藏成功，false 表示失败（无效 feature 或已被隐藏）
   *
   * @example
   * ```typescript
   * // 方式一：通过拾取交互获取 feature
   * const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
   * handler.setInputAction((movement) => {
   *   const picked = await viewer.scene.pick(movement.endPosition);
   *   if (Cesium.defined(picked) && picked.primitive instanceof Cesium.Cesium3DTileset) {
   *     const feature = picked;
   *     campusLayer.hideBuilding(feature);
   *   }
   * }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
   *
   * // 方式二：通过属性查询批量获取
   * const bldgIds = ['BLDG_001', 'BLDG_002'];
   * const features = await campusLayer.getFeaturesByProperty('building_id', bldgIds);
   * features.forEach(f => campusLayer.hideBuilding(f));
   * ```
   */
  public hideBuilding(feature: any): boolean {
    if (!feature) {
      console.warn("[CampusTilesetLayer] hideBuilding 接收到无效 feature 参数");
      return false;
    }

    const tileFeature = feature as Cesium.Cesium3DTileFeature;

    // 直接用 feature 引用作为 Map key（JS Map 支持对象键）
    if (this._hiddenFeatures.has(tileFeature)) {
      console.debug(`[CampusTilesetLayer] 建筑已处于隐藏状态，跳过`);
      return false;
    }

    const originalShow = tileFeature.show !== false;
    this._hiddenFeatures.set(tileFeature, {
      feature: tileFeature,
      originalShow,
    });

    tileFeature.show = false;

    console.debug(
      `[CampusTilesetLayer] 建筑已隐藏（当前隐藏总数：${this._hiddenFeatures.size}）`
    );
    return true;
  }

  /**
   * 显示指定单体建筑（取消隐藏）
   *
   * 将指定建筑的 `show` 属性恢复为原始值（默认 `true`）。
   * 若该建筑此前未被隐藏，则操作无效果并返回 `false`。
   *
   * @param {any} feature - Cesium3DTileFeature 实例
   * @returns {boolean} true 表示恢复成功，false 表示该建筑未被隐藏
   */
  public showBuilding(feature: any): boolean {
    if (!feature) {
      console.warn("[CampusTilesetLayer] showBuilding 接收到无效 feature 参数");
      return false;
    }

    const tileFeature = feature as Cesium.Cesium3DTileFeature;
    const state = this._hiddenFeatures.get(tileFeature);
    if (!state) {
      console.debug(`[CampusTilesetLayer] 该建筑未被隐藏，无需恢复`);
      return false;
    }

    tileFeature.show = state.originalShow;
    this._hiddenFeatures.delete(tileFeature);

    console.debug(
      `[CampusTilesetLayer] 建筑已恢复可见（剩余隐藏数：${this._hiddenFeatures.size}）`
    );
    return true;
  }

  /**
   * 显示所有已隐藏的建筑（批量恢复）
   *
   * 将所有通过 `hideBuilding()` 隐藏的建筑恢复为可见状态。
   * 通常在"撤销全部拔楼"或"重置场景"场景中使用。
   *
   * @returns {number} 本次恢复的建筑数量
   */
  public showAllBuildings(): number {
    if (this._hiddenFeatures.size === 0) {
      console.debug("[CampusTilesetLayer] 当前无已隐藏建筑，无需恢复");
      return 0;
    }

    let count = 0;
    this._hiddenFeatures.forEach((state) => {
      state.feature.show = state.originalShow;
      count++;
    });
    this._hiddenFeatures.clear();

    console.info(
      `[CampusTilesetLayer] ✅ 已批量恢复所有 ${count} 栋建筑的可见性`
    );
    return count;
  }

  /**
   * 根据属性值批量获取建筑要素
   *
   * 遍历 tileset 所有已加载的瓦片，查找指定属性等于给定值的 feature。
   * 可用于"按楼栋 ID 查询"、"按高度筛选"等场景。
   *
   * ⚠️ **性能注意**：该方法会遍历所有已加载瓦片中的 feature，
   *    瓦片数量过多时可能造成卡顿，建议配合 `tileset.readyPromise` 使用。
   *
   * @param {string} propertyName - 属性名称（如 `'building_id'`, `'height'`, `'name'`）
   * @param {string | number} propertyValue - 期望的属性值
   * @returns {Promise<Cesium.Cesium3DTileFeature[]>} 匹配的 feature 数组
   */
  public async getFeaturesByProperty(
    propertyName: string,
    propertyValue: string | number
  ): Promise<Cesium.Cesium3DTileFeature[]> {
    if (!this._tileset) {
      console.warn("[CampusTilesetLayer] tileset 未加载，无法查询属性");
      return [];
    }

    return new Promise((resolve) => {
      const results: Cesium.Cesium3DTileFeature[] = [];
      const tileset = this._tileset as any;

      // 确保 tileset 已就绪（Cesium3DTileset 实例具有 ready / readyPromise）
      if (!tileset.ready) {
        tileset.readyPromise.then(() => {
          resolve(this._collectFeatures(this._tileset!, propertyName, propertyValue));
        });
      } else {
        resolve(
          this._collectFeatures(
            this._tileset!,
            propertyName,
            propertyValue
          )
        );
      }
    });
  }

  /**
   * 查询指定建筑是否已被隐藏
   *
   * @param {any} feature - Cesium3DTileFeature 实例
   * @returns {boolean} true 表示已隐藏，false 表示可见或无效 feature
   */
  public isBuildingHidden(feature: any): boolean {
    if (!feature) return false;
    return this._hiddenFeatures.has(feature as Cesium.Cesium3DTileFeature);
  }

  /**
   * 获取所有已隐藏建筑的 feature 列表
   *
   * @returns {Cesium.Cesium3DTileFeature[]} 已隐藏建筑的 feature 数组
   */
  public getHiddenBuildings(): Cesium.Cesium3DTileFeature[] {
    return Array.from(this._hiddenFeatures.values()).map(
      (state) => state.feature
    );
  }

  // =============================================================================
  // 生命周期方法
  // =============================================================================

  /**
   * 销毁图层并释放资源
   *
   * 本方法执行以下清理操作：
   * 1. 清空隐藏记录栈
   * 2. 将 tileset 从 `scene.primitives` 集合中移除
   * 3. 调用 `tileset.destroy()` 释放 WebGL 显存（显存、GPU 缓冲区）
   * 4. 将内部引用置空
   * 5. 重置加载状态标识
   *
   * ⚠️ **重要**：调用此方法后 CampusTilesetLayer 实例仍可复用（再次调用 `load()`），
   *    但之前的隐藏记录将被清空。
   *
   * @returns {Promise<void>} 销毁完成后 resolve
   *
   * @example
   * ```typescript
   * // 页面组件卸载时
   * onBeforeUnmount(async () => {
   *   await campusLayer.destroy();
   * });
   * ```
   */
  public async destroy(): Promise<void> {
    console.debug("[CampusTilesetLayer] 开始销毁图层...");

    // —— 清空隐藏记录栈 ——
    this._hiddenFeatures.clear();

    // —— 从场景中移除并销毁 tileset ——
    if (this._tileset) {
      try {
        // 从渲染管线移除
        this._viewer.scene.primitives.remove(this._tileset);

        // 销毁 tileset（内部会释放所有相关 WebGL 资源）
        this._tileset.destroy();
        console.debug("[CampusTilesetLayer] tileset 已从 scene.primitives 移除并销毁");
      } catch (error) {
        console.error("[CampusTilesetLayer] 销毁 tileset 时发生错误：", error);
      } finally {
        this._tileset = null;
      }
    } else {
      console.debug("[CampusTilesetLayer] tileset 引用为 null，无需销毁");
    }

    // —— 重置状态标识 ——
    this._isLoaded = false;

    console.info("[CampusTilesetLayer] ✅ 图层销毁完成，所有资源已释放");
  }

  // =============================================================================
  // 私有辅助方法
  // =============================================================================

  /**
   * 递归遍历所有已加载瓦片的 feature 收集器
   *
   * @param {Cesium.Cesium3DTileset} tileset - 目标 tileset
   * @param {string} propertyName - 属性名
   * @param {string | number} propertyValue - 属性值
   * @returns {Cesium.Cesium3DTileFeature[]} 匹配结果
   * @private
   */
  private _collectFeatures(
    tileset: Cesium.Cesium3DTileset,
    propertyName: string,
    propertyValue: string | number
  ): Cesium.Cesium3DTileFeature[] {
    const results: Cesium.Cesium3DTileFeature[] = [];

    try {
      // Cesium 1.109+ 提供 root.content 来遍历
      const root = (tileset as any)._root;
      if (!root) return results;

      const traverse = (content: any) => {
        if (!content || !content.featuresLength) return;

        const featuresLength = content.featuresLength;
        for (let i = 0; i < featuresLength; i++) {
          try {
            const feature = content.getFeature(i) as Cesium.Cesium3DTileFeature;
            if (!feature) continue;

            const value = feature.getProperty(propertyName);
            if (value === propertyValue) {
              results.push(feature);
            }
          } catch (_) {
            // 单个 feature 解析失败不影响整体
          }
        }
      };

      // 遍历所有已加载的内容块（content）
      const contents = (root as any).contents ?? [];
      if (Array.isArray(contents)) {
        contents.forEach((c: any) => traverse(c));
      } else if (root.content) {
        traverse(root.content);
      }
    } catch (error) {
      console.warn("[CampusTilesetLayer] 遍历 tileset feature 时出错：", error);
    }

    return results;
  }

  /**
   * 飞行至 tileset 边界范围
   *
   * @param {number} [pitch] - 目标俯仰角（弧度），默认 45°
   * @private
   */
  private async _flyToTileset(pitch?: number): Promise<void> {
    if (!this._tileset || !this._viewer) return;

    try {
      await this._viewer.zoomTo(
        this._tileset,
        new Cesium.HeadingPitchRange(
          0,
          pitch ?? Cesium.Math.PI_OVER_FOUR,
          0
        )
      );
      console.debug("[CampusTilesetLayer] 相机已飞行至 tileset 范围");
    } catch (error) {
      console.warn("[CampusTilesetLayer] 飞行至 tileset 失败：", error);
    }
  }
}

// =============================================================================
// 导出类型（供外部模块使用）
// TilesetLoadOptions 在 class 定义上方已通过 export interface 导出，此处无需重复
// =============================================================================
