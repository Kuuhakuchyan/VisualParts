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
// 阶段五：交互测试 — 模拟拔楼 + 热力场更新
// ============================================================================

async function testInteractions(
  viewer: Cesium.Viewer,
  campusLayer: CampusTilesetLayer,
  heatmapLayer: RegionalHeatmapLayer
) {
  console.log("[Test] 阶段五：交互测试（点击屏幕拾取建筑 / 模拟拔楼 + 热力更新）");

  // 安装鼠标左键拾取监听
  const handler = new Cesium.ScreenSpaceEventHandler(
    viewer.scene.canvas
  );

  let clickCount = 0;

  handler.setInputAction(async (movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    clickCount++;
    const screenPos = movement.position;
    console.log(`[Test] 第 ${clickCount} 次点击，坐标：`, screenPos);

    try {
      // —— 双保险拾取策略 ——
      // 策略 1：viewer.scene.pick（直接命中 feature）
      // 策略 2：tileset.pick 射线检测兜底
      let feature: Cesium.Cesium3DTileFeature | null = null;

      // 工具函数：用 duck typing 判断是否为 Cesium3DTileFeature
      // 原因：OSMBuildings 等 tileset 的 feature instanceof Cesium.Cesium3DTileFeature
      // 可能返回 false（原型链不一致），必须用属性特征检测
      function is3DTileFeature(obj: any): obj is Cesium.Cesium3DTileFeature {
        return obj && typeof obj.show === 'boolean' && typeof obj.getProperty === 'function';
      }

      // 策略 1：直接拾取
      const picked = viewer.scene.pick(screenPos);
      console.log(`[Test] picked=${picked}, defined=${Cesium.defined(picked)}`);
      if (Cesium.defined(picked)) {
        const pickedKeys = Object.keys(picked as object).join(', ');
        console.log(`[Test] 拾取 keys：${pickedKeys}`);
        const hasShow = 'show' in (picked as object);
        const hasGetProperty = 'getProperty' in (picked as object);
        console.log(`[Test] hasShow=${hasShow}, hasGetProperty=${hasGetProperty}`);
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
          console.log(`[Test] pickRay=${pickRay}`);
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
        // toggle 逻辑：已隐藏则恢复，未隐藏则隐藏
        const wasHidden = campusLayer.isBuildingHidden(feature);
        let toggled = false;
        if (wasHidden) {
          toggled = campusLayer.showBuilding(feature);
          console.log(
            `[Test] ${toggled ? "✅" : "❌"} 建筑已${toggled ? "恢复可见" : "恢复失败（已恢复或参数有误）"}，当前隐藏数：${campusLayer.hiddenCount}`
          );
        } else {
          toggled = campusLayer.hideBuilding(feature);
          console.log(
            `[Test] ${toggled ? "✅" : "⏭"} 建筑已${toggled ? "隐藏（拔楼）" : "被跳过"}，当前隐藏数：${campusLayer.hiddenCount}`
          );
        }

        // 仅在真正发生状态变化（隐藏操作）时更新热力场
        if (toggled && !wasHidden) {
          const newData = initialData.map((pt) => ({
            ...pt,
            value: Math.min(1, pt.value * 1.05 + 0.02),
          }));
          heatmapLayer.updateHeatmap(newData);
          console.log("[Test] 热力场已更新（高温扩散模拟）");
        }
      } else if (Cesium.defined(picked)) {
        const pickedObj = picked.id ?? picked.primitive;
        const pickedName = pickedObj?.constructor?.name ?? typeof pickedObj;
        if (pickedObj?.id === "heatmapRect") {
          console.log("[Test] 点击了热力图层自身，忽略");
        } else {
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
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  // 将 handler 保存至全局，便于后续销毁
  (window as any).__testHandler = handler;

  console.log("[Test] ✅ 交互测试就绪：左键拾取建筑拔楼，右键恢复全部");
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
