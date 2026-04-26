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
import { TrackingLayer } from "./tracking_layer.js";
import { TrackingPanel } from "./tracking_panel.js";
import { TrackingMapWindow } from "./tracking_map_window.js";
import { apiGetWeather, apiWhatIf, apiCreateBuilding, apiGetStats, apiExportReport, apiGetTracking } from "../shared/api.js";
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
    this._trackingLayer  = null;
    this._weatherPanels  = null;
    this._healthPanel    = null;
    this._reasoningPanel = null;
    this._trackingPanel  = null;
    this._trackingMapWindow = null;
    this._timeseries     = null;
    this._pollTimer      = null;
    this._trackingTimer  = null;
    this._lastScenarioId = null;

    this._initialHeatData = this._getInitialHeatData();
    this._influenceCircleId = "influence-circle";
    this._selectedBuildingRecord = null;

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

      this._trackingLayer = new TrackingLayer(viewer);
      this._trackingLayer.init();

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
    console.info("[Dashboard] _initUIComponents called");
    this._weatherPanels   = new WeatherPanels();
    this._healthPanel     = new HealthPanel();
    this._reasoningPanel  = new ReasoningPanel();
    this._timeseries     = new EChartsTimeseries();
    this._trackingPanel  = new TrackingPanel();
    this._trackingMapWindow = new TrackingMapWindow();
    this._trackingMapWindow.init();
    this._bindTrackingButton();
    this._startTrackingPolling();

    const legend = document.getElementById("heatmap-legend");
    if (legend) legend.style.display = "block";

    const modal = document.getElementById("building-detail-modal");
    const overlay = document.getElementById("modal-overlay");
    if (modal && overlay) {
      modal.querySelector("#modal-close")?.addEventListener("click", () => this._closeDetailModal());
      overlay.addEventListener("click", () => this._closeDetailModal());
      modal.querySelector("#modal-undo")?.addEventListener("click", () => this._undoFromModal());
      modal.querySelector("#modal-delete")?.addEventListener("click", () => this._deleteFromModal());
    }
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
    await this._updateStats();
  }

  async _updateStats() {
    try {
      const res = await apiGetStats();
      if (res.success) {
        const buildingsEl = document.getElementById("stat-buildings");
        const scenariosEl = document.getElementById("stat-scenarios");
        if (buildingsEl) buildingsEl.textContent = res.data.buildingsCount ?? 0;
        if (scenariosEl) scenariosEl.textContent = res.data.scenariosCount ?? 0;
      }
    } catch (e) {
      console.warn("[Dashboard] 统计更新失败:", e);
    }
  }

  _startWeatherPolling() {
    this._pollTimer = setInterval(() => {
      this._fetchWeatherData();
    }, 60000);
  }

  _startTrackingPolling() {
    this._trackingTimer = setInterval(async () => {
      try {
        const res = await apiGetTracking();
        if (res.success) {
          this._trackingLayer?.updatePositions(res.entities);
          this._trackingPanel?.update(res.entities);
        }
      } catch (e) {
        console.warn("[Dashboard] 追踪数据获取失败:", e);
      }
    }, 3000);
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
        building_type: type,
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
      this._selectedBuildingRecord = record;
      this._openDetailModal(record);
      return false;
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
          const typeSelect = document.getElementById("ctrl-type");
          const selectedType = typeSelect ? typeSelect.value : "commercial";
          const typeHeightMap = { residential: 30, commercial: 60, office: 80, industrial: 40, public: 50 };
          const height = typeHeightMap[selectedType] ?? 60;
          this._builderLayer.startPlacement({ type: selectedType, shape: "box", height });
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

    const btnExport = document.getElementById("ctrl-export");
    if (btnExport) {
      btnExport.addEventListener("click", async () => {
        try {
          btnExport.disabled = true;
          const res = await apiExportReport();
          if (res.success) {
            const blob = new Blob([res.data.content], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = res.data.filename;
            a.click();
            URL.revokeObjectURL(url);
            this._showToast("报告已导出");
          } else {
            this._showToast("导出失败");
          }
        } catch {
          this._showToast("导出请求失败");
        } finally {
          btnExport.disabled = false;
        }
      });
    }
  }

  _bindTrackingButton() {
    const btn = document.getElementById("ctrl-tracking");
    if (btn) {
      console.info("[Dashboard] tracking button found, binding click");
      btn.addEventListener("click", () => {
        console.info("[Dashboard] tracking button clicked");
        const win = document.getElementById("tracking-map-window");
        console.info("[Dashboard] window element:", win, "classes:", win?.className);
        if (win) {
          win.classList.toggle("hidden");
          console.info("[Dashboard] after toggle:", win.className);
        } else {
          console.warn("[Dashboard] #tracking-map-window not found in DOM!");
          // 备用：手动触发一次 init
          if (this._trackingMapWindow) {
            this._trackingMapWindow.init();
          }
        }
      });
    } else {
      console.warn("[Dashboard] #ctrl-tracking button not found!");
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

  _openDetailModal(record) {
    const modal = document.getElementById("building-detail-modal");
    const overlay = document.getElementById("modal-overlay");
    if (!modal || !overlay) return;

    const nameEl = document.getElementById("modal-name");
    const heightEl = document.getElementById("modal-height");
    const typeEl = document.getElementById("modal-type");
    const timeEl = document.getElementById("modal-time");
    const scenarioEl = document.getElementById("modal-scenario");

    if (nameEl) nameEl.textContent = record.entity?.name ?? record.type ?? "--";
    if (heightEl) heightEl.textContent = record.buildingHeight ? `${record.buildingHeight}m` : "--";
    if (typeEl) typeEl.textContent = record.type ?? "--";
    if (timeEl) timeEl.textContent = record.createdAt ? new Date(record.createdAt).toLocaleString("zh-CN") : "--";
    if (scenarioEl) scenarioEl.textContent = record.scenarioId ?? "--";

    modal.style.display = "block";
    overlay.style.display = "block";
  }

  _closeDetailModal() {
    const modal = document.getElementById("building-detail-modal");
    const overlay = document.getElementById("modal-overlay");
    if (modal) modal.style.display = "none";
    if (overlay) overlay.style.display = "none";
    this._selectedBuildingRecord = null;
  }

  async _undoFromModal() {
    if (!this._selectedBuildingRecord) return;
    await this._whatIfRemove(this._selectedBuildingRecord);
    this._closeDetailModal();
  }

  async _deleteFromModal() {
    if (!this._selectedBuildingRecord) return;
    await this._whatIfRemove(this._selectedBuildingRecord);
    this._closeDetailModal();
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
    if (this._trackingTimer) clearInterval(this._trackingTimer);
    this._trackingLayer?.destroy();
    this._trackingPanel?.destroy();
    this._timeseries?.destroy();
    this._weatherPanels?.destroy();
    this._healthPanel?.destroy();
    this._trackingLayer?.destroy();
    this._trackingPanel?.destroy();
    this._trackingMapWindow?.destroy();
    await this._builderLayer?.destroy();
    await this._heatmapLayer?.destroy();
    await this._campusLayer?.destroy();
    await this._imageryManager?.destroy();
    await viewerManager.destroy();
  }
}
