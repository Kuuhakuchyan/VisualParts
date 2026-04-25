/**
 * 微境智护 — 大屏主逻辑类
 * 整合 Cesium 3D 场景 + 左右仪表盘 + What-If 推演
 */

import * as Cesium from "cesium";
import { viewerManager } from "../../src/cesium_core/core/ViewerManager.js";
import { CampusTilesetLayer } from "../../src/cesium_core/layers/CampusTilesetLayer.js";
import { RegionalHeatmapLayer } from "../../src/cesium_core/layers/RegionalHeatmapLayer.js";
import { BuildingBuilderLayer } from "../../src/cesium_core/layers/BuildingBuilderLayer.js";
import { ImageryLayerManager } from "../../src/cesium_core/layers/ImageryLayerManager.js";
import { apiGetWeather, apiWhatIf, apiCreateBuilding } from "../shared/api.js";
import { WeatherPanels } from "./weather_panels.js";
import { HealthPanel } from "./health_panel.js";
import { ReasoningPanel } from "./reasoning_panel.js";
import { EChartsTimeseries } from "./echarts_timeseries.js";

export class MicroClimateDashboard {
  constructor() {
    this._campusLayer    = null;
    this._heatmapLayer   = null;
    this._builderLayer   = null;
    this._imageryManager = null;
    this._weatherPanels  = null;
    this._healthPanel    = null;
    this._reasoningPanel = null;
    this._timeseries     = null;
    this._pollTimer      = null;
    this._lastScenarioId = null;

    this._initialHeatData = this._getInitialHeatData();
    this._influenceCircleId = "influence-circle";

    this._bound = {
      west: 113.524, east: 113.542,
      south: 34.806, north: 34.822,
    };
  }

  // =======================================================================
  // 公开入口
  // =======================================================================

  async init() {
    this._hideLoading();
    this._bindHeaderTime();
    this._bindControlBar();
    await this._initCesium();
    // UI 组件在 Cesium 就绪事件之后初始化，确保 DOM 布局已计算完成
    // 守卫标志防止重复初始化
    let readyFired = false;
    const fireReady = () => {
      if (readyFired) return;
      readyFired = true;
      setTimeout(() => {
        this._initUIComponents();
        this._fetchWeatherData();
        this._startWeatherPolling();
        this._notifyReady();
      }, 500);
    };
    window.addEventListener("__cesiumReady__", fireReady);
    // 备用：3 秒后强制触发（防止事件丢失）
    setTimeout(fireReady, 3000);
  }

  // =======================================================================
  // Cesium 初始化
  // =======================================================================

  async _initCesium() {
    try {
      const viewer = await viewerManager.init("cesiumContainer", {
        enableFXAA: true,
        autoFlyTo: false,
        flightDuration: 2.0,
      });

      this._imageryManager = new ImageryLayerManager(viewer);

      this._campusLayer = new CampusTilesetLayer(viewer);
      await this._campusLayer.load();

      this._heatmapLayer = new RegionalHeatmapLayer(viewer);
      await this._heatmapLayer.init(this._bound, this._initialHeatData, {
        canvasSize: 512,
        opacity: 0.55,
        coverBuildings: false,
        heightOffset: 0,
      });

      this._builderLayer = new BuildingBuilderLayer(viewer);
      this._bindBuilderEvents();

      console.info("[Dashboard] Cesium 场景初始化完成");
    } catch (e) {
      console.error("[Dashboard] Cesium 初始化失败:", e);
      this._showToast("Cesium 场景初始化失败，请检查网络连接");
    }
  }

  // =======================================================================
  // UI 组件初始化
  // =======================================================================

  _initUIComponents() {
    this._weatherPanels   = new WeatherPanels();
    this._healthPanel     = new HealthPanel();
    this._reasoningPanel  = new ReasoningPanel();
    this._timeseries     = new EChartsTimeseries();
  }

  // =======================================================================
  // 气象数据
  // =======================================================================

  async _fetchWeatherData() {
    try {
      const res = await apiGetWeather();
      if (res.success) {
        this._weatherPanels?.update(res.data);
        this._healthPanel?.update(res.data);
        this._updateHeaderStats(res.data);
      }
    } catch (e) {
      console.warn("[Dashboard] 气象数据获取失败:", e);
    }
  }

  _startWeatherPolling() {
    this._pollTimer = setInterval(() => {
      this._fetchWeatherData();
    }, 60000);
  }

  // =======================================================================
  // What-If ADD
  // =======================================================================

  async _whatIfAdd(buildingId, lon, lat, height, type) {
    try {
      this._reasoningPanel.setLoading([
        "检测到 ADD 建筑操作",
        "写入数据库...",
        "物理方程计算中...",
        "热力场更新...",
      ]);

      const dbResult = await apiCreateBuilding({
        name: `${type}_${buildingId}`,
        height,
        albedo: 0.3,
        baseTemp: 30,
        lon, lat,
      });

      const apiResult = await apiWhatIf({
        targetBuildingId: buildingId,
        action: "ADD",
        radiusMeters: this._getRadiusMeters(),
        buildingInfo: { name: `${type}_${buildingId}`, height, albedo: 0.3, baseTemp: 30, lon, lat },
      });

      if (apiResult.success && apiResult.data) {
        const { scenarioId, averageTempDelta, updatedGrids, totalTimeMs, confidence, reasoningSteps } = apiResult.data;

        this._builderLayer.setScenarioId(buildingId, scenarioId);
        this._lastScenarioId = scenarioId;

        // 热力场更新
        this._updateHeatmapForDelta(averageTempDelta);
        this._showInfluenceCircle(lon, lat);
        this._reasoningPanel.setResult(averageTempDelta, confidence, reasoningSteps ?? []);

        this._showToast(`ADD 推演完成：${averageTempDelta >= 0 ? "+" : ""}${averageTempDelta.toFixed(2)}°C`);
      } else {
        this._reasoningPanel.clear();
        this._showToast(`推演失败：${apiResult.message}`);
      }
    } catch (e) {
      console.error("[Dashboard] What-If ADD 失败:", e);
      this._reasoningPanel.clear();
      this._showToast("推演请求失败，请检查后端连接");
    }
  }

  // =======================================================================
  // What-If REMOVE
  // =======================================================================

  async _whatIfRemove(record) {
    const scenarioId = record.scenarioId;
    try {
      this._reasoningPanel.setLoading([
        "检测到 REMOVE 建筑操作",
        "调用撤销推理...",
        "热力场还原中...",
      ]);

      const apiResult = await apiWhatIf({
        targetBuildingId: record.dbId ?? record.id,
        action: "REMOVE",
        radiusMeters: this._getRadiusMeters(),
        buildingInfo: {
          name: record.entity.name ?? record.type,
          height: record.buildingHeight,
          albedo: 0.3,
          baseTemp: 30,
          lon: record.longitude,
          lat: record.latitude,
        },
        sourceScenarioId: scenarioId,
      });

      if (apiResult.success && apiResult.data) {
        const { averageTempDelta, confidence, reasoningSteps } = apiResult.data;

        // 恢复热力场
        this._heatmapLayer.updateHeatmap(this._initialHeatData);
        this._hideInfluenceCircle();
        this._reasoningPanel.setResult(averageTempDelta, confidence, reasoningSteps ?? []);

        this._showToast(`REMOVE 推演完成：${averageTempDelta >= 0 ? "+" : ""}${averageTempDelta.toFixed(2)}°C`);
      } else {
        this._reasoningPanel.clear();
        this._showToast("撤销推演失败");
      }
    } catch (e) {
      console.error("[Dashboard] What-If REMOVE 失败:", e);
      this._reasoningPanel.clear();
    }
  }

  // =======================================================================
  // 热力场 & 圆圈
  // =======================================================================

  _updateHeatmapForDelta(delta) {
    // 温度升高 → 热力值升高
    const factor = delta / 20;
    const newData = this._initialHeatData.map(pt => ({
      ...pt,
      value: Math.min(1, Math.max(0, pt.value + factor)),
    }));
    this._heatmapLayer.updateHeatmap(newData);
  }

  _showInfluenceCircle(lon, lat) {
    const viewer = viewerManager.getViewer();
    if (!viewer) return;

    const existing = viewer.entities.getById(this._influenceCircleId);
    if (existing) viewer.entities.remove(existing);

    viewer.entities.add({
      id: this._influenceCircleId,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
        ellipse: {
          semiMajorAxis: this._getRadiusMeters(),
          semiMinorAxis: this._getRadiusMeters(),
          material: Cesium.Color.CYAN.withAlpha(0.12),
          outline: true,
          outlineColor: Cesium.Color.CYAN.withAlpha(0.5),
          outlineWidth: 1.5,
          height: 0.5,
        },
    });
  }

  _hideInfluenceCircle() {
    const viewer = viewerManager.getViewer();
    if (!viewer) return;
    const existing = viewer.entities.getById(this._influenceCircleId);
    if (existing) viewer.entities.remove(existing);
  }

  // =======================================================================
  // 建筑事件绑定
  // =======================================================================

  _bindBuilderEvents() {
    this._builderLayer.onBuildingPlaced = (id, lon, lat, height, type) => {
      this._whatIfAdd(id, lon, lat, height, type);
    };

    this._builderLayer.onBuildingClicked = async (record) => {
      if (record.scenarioId) {
        await this._whatIfRemove(record);
      }
      // 返回 undefined，让默认删除逻辑执行
    };
  }

  // =======================================================================
  // 控制器绑定
  // =======================================================================

  _bindControlBar() {
    const btnAdd    = document.getElementById("ctrl-add");
    const btnRemove = document.getElementById("ctrl-remove");
    const btnReset  = document.getElementById("ctrl-reset");
    const btnStreet = document.getElementById("ctrl-street");
    const btnSat   = document.getElementById("ctrl-satellite");
    const slider   = document.getElementById("ctrl-radius");
    const radiusVal = document.getElementById("ctrl-radius-val");

    if (btnAdd) {
      btnAdd.addEventListener("click", () => {
        if (this._builderLayer) {
          this._builderLayer.startPlacement({ type: "commercial", shape: "box", height: 60 });
          btnAdd.classList.add("active");
          btnRemove.classList.remove("active");
        }
      });
    }

    if (btnRemove) {
      btnRemove.addEventListener("click", () => {
        if (this._builderLayer) {
          this._builderLayer.cancelPlacement();
          btnRemove.classList.add("active");
          btnAdd.classList.remove("active");
        }
      });
    }

    if (btnReset) {
      btnReset.addEventListener("click", () => {
        this._builderLayer?.clearAllBuildings();
        this._heatmapLayer?.updateHeatmap(this._initialHeatData);
        this._hideInfluenceCircle();
        this._reasoningPanel?.clear();
        this._showToast("场景已重置");
        btnAdd.classList.remove("active");
        btnRemove.classList.remove("active");
      });
    }

    if (btnStreet) {
      btnStreet.addEventListener("click", () => {
        this._imageryManager?.switchToStreet();
        this._showToast("底图：街道图");
      });
    }

    if (btnSat) {
      btnSat.addEventListener("click", () => {
        this._imageryManager?.switchToSatellite();
        this._showToast("底图：卫星图");
      });
    }

    if (slider && radiusVal) {
      slider.addEventListener("input", (e) => {
        const v = e.target.value;
        radiusVal.textContent = `${v}m`;
      });
    }
  }

  // =======================================================================
  // 头部
  // =======================================================================

  _bindHeaderTime() {
    const timeEl = document.getElementById("header-time");
    if (!timeEl) return;

    const tick = () => {
      const now = new Date();
      timeEl.textContent = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  _updateHeaderStats(data) {
    const tempEl = document.getElementById("header-temp");
    const uhiEl  = document.getElementById("header-uhi");
    if (tempEl) tempEl.textContent = `${(data.temperature ?? 0).toFixed(1)}°C`;
    if (uhiEl)  uhiEl.textContent  = `${(data.uhiIntensity ?? 0).toFixed(1)}°C`;
  }

  // =======================================================================
  // 工具
  // =======================================================================

  _getRadiusMeters() {
    const slider = document.getElementById("ctrl-radius");
    return slider ? parseInt(slider.value) : 100;
  }

  _getInitialHeatData() {
    return [
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
  }

  _hideLoading() {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.classList.add("hidden");
  }

  _notifyReady() {
    window.dispatchEvent(new CustomEvent("__cesiumReady__"));
  }

  _showToast(msg) {
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // =======================================================================
  // 销毁
  // =======================================================================

  async destroy() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._timeseries?.destroy();
    this._weatherPanels?.destroy();
    this._healthPanel?.destroy();
    await this._builderLayer?.destroy();
    await this._heatmapLayer?.destroy();
    await this._campusLayer?.destroy();
    await this._imageryManager?.destroy();
    await viewerManager.destroy();
  }
}
