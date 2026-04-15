/**
 * ============================================================================
 * 测试入口 — 串联 ViewerManager / CampusTilesetLayer / RegionalHeatmapLayer
 * ============================================================================
 */

import * as Cesium from "cesium";
import { viewerManager, ZZU_CAMERA_CONFIG } from "../src/cesium_core";
import { CampusTilesetLayer } from "../src/cesium_core/layers/CampusTilesetLayer";
import { RegionalHeatmapLayer } from "../src/cesium_core/layers/RegionalHeatmapLayer";
import { BuildingBuilderLayer } from "../src/cesium_core/layers/BuildingBuilderLayer";
import { ImageryLayerManager } from "../src/cesium_core/layers/ImageryLayerManager";

// ============================================================================
// 阶段二：初始化 Viewer
// ============================================================================

async function initViewer() {
  console.log("[Test] 阶段一：初始化 ViewerManager...");

  const containerId = "cesiumContainer";

  try {
    const viewer = await viewerManager.init(containerId, {
      enableFXAA: true,
      autoFlyTo: false, // 已由 ViewerManager.init() 内部自动飞行至 ZZU_CAMERA_CONFIG
      flightDuration: 2.0,
    });

    console.log("[Test] ✅ Viewer 初始化成功！");
    console.log(
      `[Test] 当前状态：${viewerManager.getState()}，视角：${ZZU_CAMERA_CONFIG.lng}°E ${ZZU_CAMERA_CONFIG.lat}°N 高度${ZZU_CAMERA_CONFIG.height}m`
    );

    return viewer;
  } catch (e) {
    console.error("[Test] ❌ Viewer 初始化失败：", e);
    throw e;
  }
}

// ============================================================================
// 阶段三：加载建筑底座（OSM 白模兜底）
// ============================================================================

async function loadCampusLayer(viewer: Cesium.Viewer) {
  console.log("[Test] 阶段三：加载 CampusTilesetLayer（OSM 白模兜底）...");

  const campusLayer = new CampusTilesetLayer(viewer);

  try {
    // 不传入 URL → 自动使用 Cesium.createOsmBuildingsAsync() 降级兜底
    await campusLayer.load(undefined, {
      autoFlyTo: false,
      onLoaded: (tileset) => {
        console.log(
          `[Test] ✅ tileset 加载完成，已添加至 scene.primitives`
        );
      },
    });

    console.log(
      `[Test] CampusTilesetLayer.isLoaded = ${campusLayer.isLoaded}，隐藏数 = ${campusLayer.hiddenCount}`
    );

    return campusLayer;
  } catch (e) {
    console.error("[Test] ❌ 建筑底座加载失败：", e);
    throw e;
  }
}

// ============================================================================
// 阶段四：初始化热力图层
// ============================================================================

async function loadHeatmapLayer(viewer: Cesium.Viewer) {
  console.log("[Test] 阶段四：初始化 RegionalHeatmapLayer...");

  const heatmapLayer = new RegionalHeatmapLayer(viewer);

  // 郑州大学主校区边界（经纬度矩形）
  // 与当前可见 OSM 建筑群区域对齐
  const bounds = {
    west: 113.524,
    east: 113.542,
    south: 34.806,
    north: 34.822,
  };

  // 初始热力数据（归一化坐标 0.0~1.0，value 0.0~1.0）
  const initialData = [
    { x: 0.50, y: 0.45, value: 0.95 }, // 图书馆/主教学楼（高温）
    { x: 0.52, y: 0.48, value: 0.90 },
    { x: 0.48, y: 0.42, value: 0.88 },
    { x: 0.35, y: 0.30, value: 0.78 }, // 理科组团（中高温）
    { x: 0.30, y: 0.35, value: 0.72 },
    { x: 0.65, y: 0.60, value: 0.20 }, // 泊月湖（冷岛）
    { x: 0.62, y: 0.65, value: 0.15 },
    { x: 0.68, y: 0.58, value: 0.25 },
    { x: 0.20, y: 0.70, value: 0.68 }, // 食堂/生活区（中高）
    { x: 0.18, y: 0.72, value: 0.65 },
    { x: 0.80, y: 0.25, value: 0.60 }, // 体育场
    { x: 0.10, y: 0.10, value: 0.50 }, // 校园边缘（常温）
    { x: 0.90, y: 0.90, value: 0.48 },
  ];

  try {
    await heatmapLayer.init(bounds, initialData, {
      canvasSize: 512,
      opacity: 0.5, // 50% 透明度，兼顾热力可见性与建筑拾取交互
      coverBuildings: false,
      heightOffset: 0,
    });

    console.log(
      `[Test] RegionalHeatmapLayer.isInitialized = ${heatmapLayer.isInitialized}，数据点数 = ${heatmapLayer.pointCount}`
    );

    return heatmapLayer;
  } catch (e) {
    console.error("[Test] ❌ 热力图层初始化失败：", e);
    throw e;
  }
}

// ============================================================================
// 阶段五：交互测试 — 拔楼 + AGIDB What-If 推演
// ============================================================================

/**
 * 从 Cesium3DTileFeature 中提取唯一标识
 * 优先尝试 batchId（OSM 建筑批次 ID），其次用 tile 坐标哈希
 */
function extractBuildingId(feature: Cesium.Cesium3DTileFeature): string {
  // OSM Buildings 建筑有 batchId 属性
  const batchId = (feature as any).batchId;
  if (batchId !== undefined && batchId !== null) {
    return `osm_building_${batchId}`;
  }
  // 兜底：基于 feature 所在 tile 坐标生成伪 UUID
  const content = (feature as any).content;
  const tile = content?._tile;
  if (tile) {
    const x = tile._x ?? 0;
    const y = tile._y ?? 0;
    const level = tile._level ?? 0;
    // 构造符合 UUID v4 格式的伪 ID（供 AGIDB 识别来源）
    const hash = Math.abs((x * 73856093 ^ y * 19349663 ^ level * 83492791));
    const pseudo = hash.toString(16).padStart(12, '0');
    return `osm_${pseudo}-${pseudo.substring(0, 4)}-4${pseudo.substring(0, 3)}-a${pseudo.substring(0, 3)}-${pseudo}${pseudo.substring(0, 12)}`;
  }
  return `osm_unknown_${Date.now()}`;
}

/**
 * 调用 AGIDB What-If 推演 API
 * @param buildingId 建筑标识
 * @param lon 建筑中心经度
 * @param lat 建筑中心纬度
 * @param action 操作类型
 * @param radiusMeters 影响半径（米）
 * @param buildingInfo 新建建筑的信息（仅 ADD 操作且建筑不在数据库时需要）
 */
async function callWhatIfApi(
  buildingId: string,
  lon: number,
  lat: number,
  action: string = "REMOVE",
  radiusMeters: number = 100,
  buildingInfo?: {
    name?: string;
    height?: number;
    albedo?: number;
    baseTemp?: number;
    lon?: number;
    lat?: number;
  }
): Promise<{ success: boolean; data?: any; message?: string }> {
  try {
    const res = await fetch("/api/simulation/what-if", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetBuildingId: buildingId, action, radiusMeters, buildingInfo }),
    });
    return await res.json();
  } catch (err) {
    console.error("[Test] What-If API 调用失败:", err);
    return { success: false, message: String(err) };
  }
}

/**
 * 绘制影响半径圈
 */
function drawInfluenceCircle(viewer: Cesium.Viewer, lon: number, lat: number, radiusMeters: number) {
  // 先清除旧的
  const old = viewer.entities.getById("influence-radius-circle");
  if (old) viewer.entities.remove(old);

  viewer.entities.add({
    id: "influence-radius-circle",
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    ellipse: {
      semiMajorAxis: radiusMeters,
      semiMinorAxis: radiusMeters,
      material: Cesium.Color.CYAN.withAlpha(0.12),
      outline: true,
      outlineColor: Cesium.Color.CYAN.withAlpha(0.5),
      outlineWidth: 1.5,
      height: 0.5,
    },
  });
  console.log(`[Test] 已绘制影响半径圈: 中心(${lon.toFixed(4)}°, ${lat.toFixed(4)}°), 半径 ${radiusMeters}m`);
}

async function testInteractions(
  viewer: Cesium.Viewer,
  campusLayer: CampusTilesetLayer,
  heatmapLayer: RegionalHeatmapLayer
) {
  console.log("[Test] 阶段五：交互测试（点击屏幕拾取建筑 / 拔楼 + AGIDB What-If 推演）");

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let clickCount = 0;

  handler.setInputAction(async (movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    clickCount++;
    const screenPos = movement.position;
    console.log(`[Test] 第 ${clickCount} 次点击，坐标：`, screenPos);

    try {
      let feature: Cesium.Cesium3DTileFeature | null = null;

      function is3DTileFeature(obj: any): obj is Cesium.Cesium3DTileFeature {
        return obj && typeof obj.show === 'boolean' && typeof obj.getProperty === 'function';
      }

      // 策略 1：直接拾取
      const picked = viewer.scene.pick(screenPos);
      console.log(`[Test] picked=${picked}, defined=${Cesium.defined(picked)}`);
      if (Cesium.defined(picked)) {
        const pickedKeys = Object.keys(picked as object).join(', ');
        console.log(`[Test] 拾取 keys：${pickedKeys}`);
        if (is3DTileFeature(picked)) {
          feature = picked;
          console.log(`[Test] 策略1命中 feature`);
        } else {
          const pickedObj = picked.id ?? picked.primitive;
          const pickedName = pickedObj?.constructor?.name ?? typeof pickedObj;
          console.log(`[Test] 策略1非feature：${pickedName}，尝试策略2`);
        }
      } else {
        console.log(`[Test] picked 为 undefined/null，尝试策略2`);
      }

      // 策略 2：射线检测兜底
      if (!feature && campusLayer.tileset) {
        console.log(`[Test] 进入策略2射线检测`);
        try {
          const pickRay = viewer.scene.camera.getPickRay(screenPos);
          if (pickRay) {
            const pickResult = (campusLayer.tileset as any).pick(pickRay, viewer.scene);
            console.log(`[Test] 策略2 pickResult=${pickResult}`);
            if (Cesium.defined(pickResult) && is3DTileFeature(pickResult)) {
              feature = pickResult;
              console.log(`[Test] 策略2命中建筑`);
            }
          }
        } catch (e) {
          console.error("[Test] 策略2异常：", e);
        }
      } else if (!campusLayer.tileset) {
        console.log(`[Test] campusLayer.tileset 为 null，无法执行策略2`);
      }

      // 最终判定
      if (feature) {
        const wasHidden = campusLayer.isBuildingHidden(feature);
        let toggled = false;

        if (wasHidden) {
          toggled = campusLayer.showBuilding(feature);
          console.log(
            `[Test] ${toggled ? "✅" : "❌"} 建筑已${toggled ? "恢复可见" : "恢复失败"}，当前隐藏数：${campusLayer.hiddenCount}`
          );
          // 恢复时清除影响圈
          if (toggled) {
            const old = viewer.entities.getById("influence-radius-circle");
            if (old) viewer.entities.remove(old);
            // 恢复热力场（用原始数据）
            heatmapLayer.updateHeatmap(initialData);
            console.log("[Test] 热力场已恢复至初始状态");
          }
        } else {
          toggled = campusLayer.hideBuilding(feature);
          console.log(
            `[Test] ${toggled ? "✅" : "⏭"} 建筑已${toggled ? "隐藏（拔楼）" : "被跳过"}，当前隐藏数：${campusLayer.hiddenCount}`
          );

          // 隐藏成功后：调用 AGIDB What-If API
          if (toggled) {
            const buildingId = extractBuildingId(feature);
            // 从 feature 的 cartographic 坐标获取经纬度
            let lon = ZZU_CAMERA_CONFIG.lng;
            let lat = ZZU_CAMERA_CONFIG.lat;
            try {
              const cartographic = await new Promise<Cesium.Cartographic>((resolve) => {
                feature!.readyPromise.then(() => {
                  const pos = (feature as any).content?._boundingSphere?.center;
                  if (pos) {
                    const c = Cesium.Cartographic.fromCartesian(pos);
                    resolve(c);
                  } else {
                    resolve(new Cesium.Cartographic(ZZU_CAMERA_CONFIG.lng * Cesium.Math.RadiansPerDegree, ZZU_CAMERA_CONFIG.lat * Cesium.Math.RadiansPerDegree, 0));
                  }
                });
              });
              lon = Cesium.Math.toDegrees(cartographic.longitude);
              lat = Cesium.Math.toDegrees(cartographic.latitude);
            } catch (e) {
              console.warn("[Test] 无法获取 feature 坐标，使用默认值:", e);
            }

            console.log(`[Test] 调起 AGIDB What-If 推演: buildingId=${buildingId}, 坐标=(${lon.toFixed(4)}, ${lat.toFixed(4)})`);

            // OSM 建筑不在数据库中，提供默认的建筑信息进行模拟推演
            // 实际项目中应从 OSM 数据获取真实建筑高度等信息
            const osmBuildingInfo = {
              name: `OSM建筑_${buildingId}`,
              height: 30, // 默认 30 米
              albedo: 0.3,
              baseTemp: 30,
              lon,
              lat,
            };

            const apiResult = await callWhatIfApi(buildingId, lon, lat, "REMOVE", 100, osmBuildingInfo);

            if (apiResult.success && apiResult.data) {
              const { scenarioId, averageTempDelta, updatedGrids, totalTimeMs } = apiResult.data;
              console.log(`[Test] ✅ What-If 推演成功! scenarioId: ${scenarioId}`);
              console.log(`[Test]    平均温度变化: ${averageTempDelta > 0 ? '+' : ''}${averageTempDelta.toFixed(2)}°C`);
              console.log(`[Test]    受影响格点数: ${updatedGrids.length}`);
              console.log(`[Test]    推理耗时: ${totalTimeMs}ms`);

              // 绘制影响半径圈
              drawInfluenceCircle(viewer, lon, lat, 100);

              // 将温度变化映射到热力值变化
              // averageTempDelta 为正表示降温，负表示升温；映射到 value 变化
              const tempFactor = averageTempDelta / 20; // ±1.5~3°C 映射到 ±0.075~0.15 热力值
              const newData = initialData.map((pt) => ({
                ...pt,
                value: Math.min(1, Math.max(0, pt.value - tempFactor)),
              }));
              heatmapLayer.updateHeatmap(newData);
              console.log(`[Test] 热力场已更新（基于真实物理推演，温度变化 ${averageTempDelta > 0 ? '+' : ''}${averageTempDelta.toFixed(2)}°C）`);
            } else {
              console.warn(`[Test] ⚠️ What-If 推演失败: ${apiResult.message}，热力场不更新`);
            }
          }
        }
      } else if (Cesium.defined(picked)) {
        const pickedObj = picked.id ?? picked.primitive;
        if (pickedObj?.id === "heatmapRect") {
          console.log("[Test] 点击了热力图层自身，忽略");
        } else {
          const pickedName = pickedObj?.constructor?.name ?? typeof pickedObj;
          console.log(`[Test] 点击了非建筑对象：${pickedName}`);
        }
      } else {
        console.log("[Test] 未拾取到任何对象");
      }
    } catch (e) {
      console.error("[Test] 拾取处理出错：", e);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // 右键点击恢复所有建筑
  handler.setInputAction(() => {
    const count = campusLayer.showAllBuildings();
    console.log(`[Test] 右键点击，已恢复 ${count} 栋建筑的可见性`);
    const old = viewer.entities.getById("influence-radius-circle");
    if (old) viewer.entities.remove(old);
    heatmapLayer.updateHeatmap(initialData);
    console.log("[Test] 热力场已恢复至初始状态");
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  (window as any).__testHandler = handler;
  console.log("[Test] ✅ 交互测试就绪：左键拾取建筑拔楼（调用 AGIDB What-If），右键恢复全部");
}

// ============================================================================
// 全局初始数据引用（用于热力场更新）
// ============================================================================

let initialData: { x: number; y: number; value: number }[] = [];

async function runAllTests() {
  console.log("=".repeat(60));
  console.log("[Test] 城市微环境决策支持系统 — 模块功能测试");
  console.log("=".repeat(60));

  try {
    // 阶段一：API 连接测试（优先，确保前后端通信正常）
    console.log("[Test] 阶段一：测试与后端 API 的连接...");
    try {
      const healthRes = await fetch("/api/simulation/health");
      const healthData = await healthRes.json();
      console.log("[Test] ✅ 后端健康检查通过:", healthData);

      console.log("[Test] 测试 what-if 推演接口...");
      const whatIfRes = await fetch("/api/simulation/what-if", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBuildingId: "a1111111-1111-1111-1111-111111111111",
          action: "REMOVE",
          radiusMeters: 100,
        }),
      });
      const whatIfData = await whatIfRes.json();
      if (whatIfData.success) {
        console.log("[Test] ✅ what-if 推演成功! scenarioId:", whatIfData.data.scenarioId);
        console.log("[Test]    平均降温:", whatIfData.data.averageTempDelta, "°C");
        console.log("[Test]    受影响格点数:", whatIfData.data.updatedGrids.length);
        console.log("[Test]    总耗时:", whatIfData.data.totalTimeMs, "ms");
      } else {
        console.warn("[Test] ⚠️ what-if 推演失败:", whatIfData.message);
      }
    } catch (e) {
      console.error("[Test] ❌ API 调用出错:", e);
    }

    // 阶段二：Viewer
    const viewer = await initViewer();

    // 阶段三：建筑底座
    const campusLayer = await loadCampusLayer(viewer);

    // 阶段四：热力图层
    initialData = [
      { x: 0.50, y: 0.45, value: 0.95 },
      { x: 0.52, y: 0.48, value: 0.90 },
      { x: 0.48, y: 0.42, value: 0.88 },
      { x: 0.35, y: 0.30, value: 0.78 },
      { x: 0.30, y: 0.35, value: 0.72 },
      { x: 0.65, y: 0.60, value: 0.20 },
      { x: 0.62, y: 0.65, value: 0.15 },
      { x: 0.68, y: 0.58, value: 0.25 },
      { x: 0.20, y: 0.70, value: 0.68 },
      { x: 0.18, y: 0.72, value: 0.65 },
      { x: 0.80, y: 0.25, value: 0.60 },
      { x: 0.10, y: 0.10, value: 0.50 },
      { x: 0.90, y: 0.90, value: 0.48 },
    ];
    const heatmapLayer = await loadHeatmapLayer(viewer);

    // 阶段五：交互
    await testInteractions(viewer, campusLayer, heatmapLayer);

    // 阶段六：影像底图管理器
    const imageryManager = new ImageryLayerManager(viewer);
    console.log("[Test] ImageryLayerManager 已创建，可手动调用：");
    console.log("  - window.__imageryManager.switchToStreet()");
    console.log("  - window.__imageryManager.switchToSatellite()");
    console.log("  - window.__imageryManager.toggle()");

    // 阶段七：建筑建造
    const builderLayer = new BuildingBuilderLayer(viewer);
    console.log("[Test] BuildingBuilderLayer 已创建，可手动调用：");
    console.log("  - window.__builderLayer.startPlacement({ type: 'commercial', shape: 'box', height: 60 })");
    console.log("  - window.__builderLayer.placeBuilding(113.53, 34.82, { type: 'office', height: 80 })");
    console.log("  - window.__builderLayer.removeBuilding('building_1')");
    console.log("  - window.__builderLayer.clearAllBuildings()");

    // 监听建筑建造完成事件，自动触发 what-if 推演
    builderLayer.onBuildingPlaced = async (id, lon, lat, height, type) => {
      console.log(`[Test] 建筑建造完成: ${id}，触发 What-If 推演...`);

      try {
        // 先将建筑写入数据库，获取真实 UUID
        const dbId = await builderLayer.createBuildingInDb(id, {
          name: `${type}_${id}`,
          height,
          lon,
          lat,
        });

        // 调用 what-if API 进行推演（使用建筑类型对应的默认参数）
        const apiResult = await callWhatIfApi(
          id, // 使用前端 ID，Service 会用 buildingInfo 构造虚拟建筑
          lon,
          lat,
          "ADD",
          100,
          {
            name: `${type}_${id}`,
            height,
            albedo: 0.3,
            baseTemp: 30,
            lon,
            lat,
          }
        );

        if (apiResult.success && apiResult.data) {
          const { scenarioId, averageTempDelta, updatedGrids, totalTimeMs } = apiResult.data;
          console.log(`[Test] ✅ What-If 推演成功! scenarioId: ${scenarioId}`);
          console.log(`[Test]    平均温度变化: ${averageTempDelta > 0 ? '+' : ''}${averageTempDelta.toFixed(2)}°C`);
          console.log(`[Test]    受影响格点数: ${updatedGrids.length}`);

          // 绘制影响半径圈
          drawInfluenceCircle(viewer, lon, lat, 100);

          // 更新热力场（基于真实推演结果）
          // ADD 操作使温度升高，热力值增加
          const tempFactor = Math.abs(averageTempDelta) / 20;
          const newData = initialData.map((pt) => ({
            ...pt,
            value: Math.min(1, Math.max(0, pt.value + tempFactor)),
          }));
          heatmapLayer.updateHeatmap(newData);
          console.log(`[Test] 热力场已更新（新建建筑导致升温 ${Math.abs(averageTempDelta).toFixed(2)}°C）`);
        } else {
          console.warn(`[Test] ⚠️ What-If 推演失败: ${apiResult.message}`);
        }
      } catch (err) {
        console.error(`[Test] ❌ 建筑建造后推演出错:`, err);
      }
    };

    // 保存引用至全局，便于手动调试
    (window as any).__viewer = viewer;
    (window as any).__campusLayer = campusLayer;
    (window as any).__heatmapLayer = heatmapLayer;
    (window as any).__initialData = initialData;
    (window as any).__imageryManager = imageryManager;
    (window as any).__builderLayer = builderLayer;

    console.log("=".repeat(60));
    console.log("[Test] ✅ 全部测试模块加载完成！");
    console.log("[Test] 可在控制台手动测试：");
    console.log("  - window.__campusLayer.hideCount");
    console.log("  - window.__heatmapLayer.updateHeatmap([...])");
    console.log("  - window.__viewer.camera.flyHome()");
    console.log("  - viewerManager.getState()");
    console.log("=".repeat(60));

    // 通知 index.html 的内联脚本：初始化完成
    window.dispatchEvent(new CustomEvent("__cesiumReady__"));

    // 备用：3 秒后再次派发（防止中途异常导致事件丢失）
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("__cesiumReady__"));
    }, 3000);
  } catch (e) {
    console.error("[Test] ❌ 测试流程中断：", e);
  }
}

// ============================================================================
// 页面加载完成后自动运行
// ============================================================================

// 等待 DOM 加载完毕
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runAllTests);
} else {
  runAllTests();
}

// 页面卸载时销毁
window.addEventListener("beforeunload", async () => {
  console.log("[Test] 页面卸载，执行清理...");
  try {
    (window as any).__testHandler?.destroy();
    await (window as any).__imageryManager?.destroy();
    await (window as any).__heatmapLayer?.destroy();
    await (window as any).__campusLayer?.destroy();
    await (window as any).__builderLayer?.destroy();
    await viewerManager.destroy();
    console.log("[Test] ✅ 全部资源已释放");
  } catch (e) {
    console.error("[Test] 清理出错：", e);
  }
});
