/**
 * 微境探界 — 轻量 GIS 主入口
 *
 * 默认使用 MapLibre 承载校园白模、热风险、气象站点与移动巡测图层。
 * Cesium 高级三维模式保留在 dashboard_cesium.js，通过 ?mode=3d 按需加载。
 */

import "maplibre-gl/dist/maplibre-gl.css";

import {
  apiCreateBuilding,
  apiExportReport,
  apiGetStats,
  apiGetTracking,
  apiGetWeather,
  apiListScenarios,
  apiWhatIf,
} from "../shared/api.js";
import { WeatherPanels } from "./weather_panels.js";
import { HealthPanel } from "./health_panel.js";
import { ReasoningPanel } from "./reasoning_panel.js";
import { EChartsTimeseries } from "./echarts_timeseries.js";
import { TrackingPanel } from "./tracking_panel.js";

export class MicroClimateDashboard {
  constructor() {
    this._cesiumDelegate = null;
    this._maplibre = null;
    this._map = null;
    this._weatherPanels = null;
    this._healthPanel = null;
    this._reasoningPanel = null;
    this._timeseries = null;
    this._trackingPanel = null;
    this._pollTimer = null;
    this._trackingTimer = null;
    this._clockTimer = null;

    this._baseBuildingCount = 0;
    this._scenarioBuildings = this._emptyFeatureCollection();
    this._selectedBuildingRecord = null;
    this._placementMode = null;
    this._lastScenarioId = null;
    this._sensorData = this._getSensorTreeData();
    this._initialHeatData = this._getInitialHeatData();
    this._currentHeatData = this._initialHeatData;

    this._bound = {
      west: 113.524,
      east: 113.542,
      south: 34.806,
      north: 34.822,
    };

    this._mapStyleUrl = import.meta.env.VITE_MAP_STYLE_URL || "";
    this._buildingDataUrl = `${import.meta.env.BASE_URL}data/zzu_osm_buildings.geojson`;
  }

  async init() {
    if (this._isCesiumMode()) {
      document.documentElement.classList.add("mode-3d");
      this._setLoadingText("微境探界 · 高级三维模式初始化中...");
      const { MicroClimateDashboard: CesiumDashboard } = await import("./dashboard_cesium.js");
      this._cesiumDelegate = new CesiumDashboard();
      await this._cesiumDelegate.init();
      return;
    }

    document.documentElement.classList.add("mode-gis");
    this._setLoadingText("微境探界 · 微气象空间决策底座初始化中...");
    this._prepareLightUi();
    this._bindHeaderTime();
    this._initUIComponents();
    this._bindControlBar();

    try {
      await this._initMap();
      this._setModelStatus("校园建筑白模", this._baseBuildingCount, "ok");
    } catch (error) {
      console.error("[GIS] 地图初始化失败:", error);
      this._setModelStatus("气象底图未就绪", 0, "warn", "检查网络");
      this._showToast("气象底图初始化失败，请检查底图网络或切换高级三维模式");
    } finally {
      this._hideLoading();
    }

    await this._fetchWeatherData();
    this._startWeatherPolling();
    this._startTrackingPolling();
    this._refreshScenarioList();
    this._notifyReady();
  }

  _isCesiumMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "3d" || window.location.hash === "#3d";
  }

  _prepareLightUi() {
    const app = document.getElementById("app");
    app?.setAttribute("data-mode", "gis");

    const brandSub = document.querySelector("#header .brand span");
    if (brandSub) brandSub.textContent = "校园热胁迫监测 / 空间推演";

    const sourceEl = document.querySelector(".header-center .header-stat:nth-child(3) .val");
    if (sourceEl) sourceEl.textContent = "IoT/API";

    const btnStreet = document.getElementById("ctrl-street");
    const btnSat = document.getElementById("ctrl-satellite");
    if (btnStreet) btnStreet.textContent = "平面气象底图";
    if (btnSat) btnSat.textContent = "2.5D 白模";

    this._injectModePanel();
    this._injectLayerPanel();
    this._injectSensorTree();

    const legend = document.getElementById("heatmap-legend");
    if (legend) legend.style.display = "block";
  }

  _injectModePanel() {
    const center = document.getElementById("center");
    if (!center || document.getElementById("gis-mode-panel")) return;

    center.insertAdjacentHTML("beforeend", `
      <div id="gis-mode-panel" class="gis-mode-panel">
        <div>
          <div class="gis-mode-title">气象空间推演模式</div>
          <div class="gis-mode-meta">热风险 / 白模 / 站点 / 巡测</div>
        </div>
        <button id="ctrl-advanced-3d" class="ctrl-btn primary" type="button">高级 3D</button>
      </div>
    `);

    document.getElementById("ctrl-advanced-3d")?.addEventListener("click", () => {
      const base = import.meta.env.BASE_URL || "/";
      window.location.assign(`${window.location.origin}${base}?mode=3d`);
    });
  }

  _injectLayerPanel() {
    const center = document.getElementById("center");
    if (!center || document.getElementById("gis-layer-panel")) return;

    center.insertAdjacentHTML("beforeend", `
      <div id="gis-layer-panel" class="gis-layer-panel">
        <label><input type="checkbox" data-layer-toggle="buildings" checked /> 建筑白模</label>
        <label><input type="checkbox" data-layer-toggle="heat" checked /> 热风险</label>
        <label><input type="checkbox" data-layer-toggle="sensors" checked /> 气象站点</label>
        <label><input type="checkbox" data-layer-toggle="tracking" checked /> 移动巡测</label>
      </div>
    `);
  }

  _injectSensorTree() {
    const leftPanel = document.getElementById("left-panel");
    if (!leftPanel || document.getElementById("sensor-tree-panel")) return;

    leftPanel.insertAdjacentHTML("beforeend", `
      <div id="sensor-tree-panel">
        <div class="panel-title" style="margin-top:8px;">气象站点树</div>
        <div id="sensor-tree" class="sensor-tree"></div>
      </div>
    `);
    this._renderSensorTree();
  }

  _initUIComponents() {
    this._weatherPanels = new WeatherPanels();
    this._healthPanel = new HealthPanel();
    this._reasoningPanel = new ReasoningPanel();
    this._timeseries = new EChartsTimeseries();
    this._trackingPanel = new TrackingPanel();

    const modal = document.getElementById("building-detail-modal");
    const overlay = document.getElementById("modal-overlay");
    if (modal && overlay) {
      modal.querySelector("#modal-close")?.addEventListener("click", () => this._closeDetailModal());
      overlay.addEventListener("click", () => this._closeDetailModal());
      modal.querySelector("#modal-undo")?.addEventListener("click", () => this._removeScenarioBuilding());
      modal.querySelector("#modal-delete")?.addEventListener("click", () => this._removeScenarioBuilding());
    }
  }

  async _initMap() {
    await this._waitForMapContainer();
    const maplibregl = await this._loadMaplibre();

    this._map = new maplibregl.Map({
      container: "cesiumContainer",
      style: this._mapStyleUrl || this._defaultRasterStyle(),
      center: [113.531, 34.814],
      zoom: 15.2,
      pitch: 55,
      bearing: -24,
      antialias: true,
      attributionControl: false,
      maxPitch: 70,
    });

    this._map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    this._map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    await this._waitForEditableStyle();

    await this._loadCampusBuildings();
    this._initHeatmapLayer();
    this._initScenarioBuildingLayer();
    this._initSensorLayer();
    this._initTrackingLayer();
    this._bindMapInteractions();
    this._bindLayerToggles();
    this._map.resize();
  }

  async _loadCampusBuildings() {
    const res = await fetch(this._buildingDataUrl, { cache: "force-cache" });
    if (!res.ok) throw new Error(`建筑白模数据加载失败: HTTP ${res.status}`);

    const geojson = await res.json();
    this._baseBuildingCount = Array.isArray(geojson.features) ? geojson.features.length : 0;

    this._map.addSource("campus-buildings", {
      type: "geojson",
      data: geojson,
      generateId: true,
    });

    const firstSymbol = this._firstSymbolLayerId();
    this._map.addLayer({
      id: "campus-buildings-extrusion",
      type: "fill-extrusion",
      source: "campus-buildings",
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["to-number", ["get", "height_m"]], 18],
          0, "#d8f4ee",
          22, "#86cfc6",
          50, "#4fa9ab",
          90, "#267785",
        ],
        "fill-extrusion-height": ["coalesce", ["to-number", ["get", "height_m"]], 18],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.9,
        "fill-extrusion-vertical-gradient": true,
      },
    }, firstSymbol);

    this._map.addLayer({
      id: "campus-buildings-outline",
      type: "line",
      source: "campus-buildings",
      paint: {
        "line-color": "rgba(8, 62, 70, 0.86)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 17, 1.5],
        "line-opacity": 0.82,
      },
    });

    if (geojson.bbox?.length === 4) {
      this._map.fitBounds(
        [[geojson.bbox[0], geojson.bbox[1]], [geojson.bbox[2], geojson.bbox[3]]],
        { padding: { top: 88, right: 350, bottom: 170, left: 350 }, duration: 0 },
      );
      this._map.easeTo({ pitch: 55, bearing: -24, duration: 0 });
    }

    this._setModelAttribution(geojson.attribution || "OpenStreetMap contributors (ODbL 1.0)");
  }

  _initHeatmapLayer() {
    this._map.addSource("thermal-field", {
      type: "geojson",
      data: this._heatFeatureCollection(this._currentHeatData),
    });

    this._map.addLayer({
      id: "thermal-field-heat",
      type: "heatmap",
      source: "thermal-field",
      maxzoom: 18,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "value"], 0, 0, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 17, 1.25],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 13, 18, 17, 46],
        "heatmap-opacity": 0.68,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(20, 40, 110, 0)",
          0.2, "rgba(22, 150, 175, 0.55)",
          0.45, "rgba(100, 210, 130, 0.60)",
          0.68, "rgba(242, 184, 75, 0.66)",
          1, "rgba(230, 95, 92, 0.76)",
        ],
      },
    }, "campus-buildings-extrusion");
  }

  _initScenarioBuildingLayer() {
    this._map.addSource("scenario-buildings", {
      type: "geojson",
      data: this._scenarioBuildings,
    });

    this._map.addLayer({
      id: "scenario-buildings-extrusion",
      type: "fill-extrusion",
      source: "scenario-buildings",
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "buildingType"],
          "residential", "#7ad66d",
          "commercial", "#f2b84b",
          "office", "#6aa9ff",
          "industrial", "#b08cff",
          "public", "#36c6b4",
          "#f2b84b",
        ],
        "fill-extrusion-height": ["coalesce", ["to-number", ["get", "height"]], 40],
        "fill-extrusion-opacity": 0.86,
        "fill-extrusion-base": 0,
      },
    });

    this._map.addLayer({
      id: "scenario-buildings-outline",
      type: "line",
      source: "scenario-buildings",
      paint: {
        "line-color": "#ffffff",
        "line-width": 1.3,
        "line-opacity": 0.86,
      },
    });

    this._map.addSource("influence-circle", {
      type: "geojson",
      data: this._emptyFeatureCollection(),
    });
    this._map.addLayer({
      id: "influence-circle-fill",
      type: "fill",
      source: "influence-circle",
      paint: {
        "fill-color": "rgba(54, 198, 180, 0.14)",
        "fill-outline-color": "rgba(54, 198, 180, 0.68)",
      },
    });
    this._map.addLayer({
      id: "influence-circle-line",
      type: "line",
      source: "influence-circle",
      paint: {
        "line-color": "rgba(54, 198, 180, 0.86)",
        "line-width": 1.4,
        "line-dasharray": [1.6, 1.4],
      },
    });
  }

  _initSensorLayer() {
    this._map.addSource("campus-sensors", {
      type: "geojson",
      data: this._sensorFeatureCollection(),
    });

    this._map.addLayer({
      id: "sensor-points",
      type: "circle",
      source: "campus-sensors",
      paint: {
        "circle-radius": ["match", ["get", "nodeType"], "gateway", 7, 5],
        "circle-color": [
          "match",
          ["get", "status"],
          "online", "#7ad66d",
          "warning", "#f2b84b",
          "offline", "#e65f5c",
          "#36c6b4",
        ],
        "circle-stroke-color": "rgba(5, 14, 20, 0.96)",
        "circle-stroke-width": 2,
        "circle-opacity": 0.92,
      },
    });

    this._map.addLayer({
      id: "sensor-labels",
      type: "symbol",
      source: "campus-sensors",
      minzoom: 15,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#e8fbf8",
        "text-halo-color": "rgba(5, 10, 16, 0.9)",
        "text-halo-width": 1.2,
      },
    });
  }

  _initTrackingLayer() {
    this._map.addSource("tracking-entities", {
      type: "geojson",
      data: this._emptyFeatureCollection(),
    });
    this._map.addSource("tracking-trajectories", {
      type: "geojson",
      data: this._emptyFeatureCollection(),
    });

    this._map.addLayer({
      id: "tracking-lines",
      type: "line",
      source: "tracking-trajectories",
      paint: {
        "line-color": ["match", ["get", "type"], "drone", "#7ad66d", "car", "#f2b84b", "#36c6b4"],
        "line-width": 2,
        "line-opacity": 0.72,
      },
    });

    this._map.addLayer({
      id: "tracking-points",
      type: "circle",
      source: "tracking-entities",
      paint: {
        "circle-radius": ["match", ["get", "type"], "drone", 7, "car", 6, 5],
        "circle-color": ["match", ["get", "type"], "drone", "#7ad66d", "car", "#f2b84b", "#36c6b4"],
        "circle-stroke-color": "#061014",
        "circle-stroke-width": 2,
      },
    });
  }

  _bindMapInteractions() {
    this._map.on("click", (event) => {
      if (this._placementMode === "add") {
        const typeSelect = document.getElementById("ctrl-type");
        const selectedType = typeSelect ? typeSelect.value : "commercial";
        const typeHeightMap = { residential: 30, commercial: 60, office: 80, industrial: 40, public: 50 };
        this._whatIfAdd(event.lngLat.lng, event.lngLat.lat, typeHeightMap[selectedType] ?? 60, selectedType);
        return;
      }

      const features = this._map.queryRenderedFeatures(event.point, {
        layers: ["scenario-buildings-extrusion", "campus-buildings-extrusion", "sensor-points", "tracking-points"],
      });
      const feature = features[0];
      if (!feature) {
        this._selectedBuildingRecord = null;
        return;
      }

      if (feature.layer.id === "scenario-buildings-extrusion") {
        this._selectedBuildingRecord = this._scenarioBuildings.features.find((item) => item.properties.id === feature.properties.id) || null;
        if (this._selectedBuildingRecord) this._openDetailModal(this._selectedBuildingRecord);
        return;
      }

      if (feature.layer.id === "sensor-points" || feature.layer.id === "tracking-points") {
        this._openPointPopup(feature, event.lngLat);
        return;
      }

      this._openBuildingPopup(feature, event.lngLat);
    });

    this._map.on("mousemove", (event) => {
      const features = this._map.queryRenderedFeatures(event.point, {
        layers: ["scenario-buildings-extrusion", "campus-buildings-extrusion", "sensor-points", "tracking-points"],
      });
      this._map.getCanvas().style.cursor = this._placementMode === "add" ? "crosshair" : features.length ? "pointer" : "";
    });
  }

  _bindLayerToggles() {
    const layerGroups = {
      buildings: ["campus-buildings-extrusion", "campus-buildings-outline", "scenario-buildings-extrusion", "scenario-buildings-outline"],
      heat: ["thermal-field-heat", "influence-circle-fill", "influence-circle-line"],
      sensors: ["sensor-points", "sensor-labels"],
      tracking: ["tracking-lines", "tracking-points"],
    };

    document.querySelectorAll("[data-layer-toggle]").forEach((input) => {
      input.addEventListener("change", (event) => {
        const group = event.target.dataset.layerToggle;
        const visible = event.target.checked ? "visible" : "none";
        for (const layerId of layerGroups[group] || []) {
          if (this._map?.getLayer(layerId)) this._map.setLayoutProperty(layerId, "visibility", visible);
        }
      });
    });

    document.querySelectorAll("[data-sensor-id]").forEach((node) => {
      node.addEventListener("click", () => {
        const sensor = this._findSensor(node.dataset.sensorId);
        if (!sensor || !this._map) return;
        this._map.easeTo({ center: [sensor.lon, sensor.lat], zoom: 17.2, pitch: 58, duration: 650 });
      });
    });
  }

  _bindControlBar() {
    const btnAdd = document.getElementById("ctrl-add");
    const btnRemove = document.getElementById("ctrl-remove");
    const btnReset = document.getElementById("ctrl-reset");
    const btnStreet = document.getElementById("ctrl-street");
    const btnSat = document.getElementById("ctrl-satellite");
    const slider = document.getElementById("ctrl-radius");
    const radiusVal = document.getElementById("ctrl-radius-val");

    btnAdd?.addEventListener("click", () => {
      this._placementMode = this._placementMode === "add" ? null : "add";
      btnAdd.classList.toggle("active", this._placementMode === "add");
      btnRemove?.classList.remove("active");
      this._showToast(this._placementMode === "add" ? "点击地图放置推演建筑" : "已退出放置模式");
    });

    btnRemove?.addEventListener("click", () => {
      btnAdd?.classList.remove("active");
      this._placementMode = null;
      this._removeScenarioBuilding();
    });

    btnReset?.addEventListener("click", () => {
      this._scenarioBuildings = this._emptyFeatureCollection();
      this._selectedBuildingRecord = null;
      this._setSourceData("scenario-buildings", this._scenarioBuildings);
      this._updateHeatmap(this._initialHeatData);
      this._setSourceData("influence-circle", this._emptyFeatureCollection());
      this._reasoningPanel?.clear();
      this._refreshScenarioList();
      this._updateStats();
      this._showToast("场景已重置");
    });

    btnStreet?.addEventListener("click", () => {
      this._map?.easeTo({ pitch: 0, bearing: 0, duration: 500 });
      this._showToast("已切换平面视图");
    });

    btnSat?.addEventListener("click", () => {
      this._map?.easeTo({ pitch: 58, bearing: -24, duration: 500 });
      this._showToast("已切换 2.5D 白模视图");
    });

    slider?.addEventListener("input", (event) => {
      if (radiusVal) radiusVal.textContent = `${event.target.value}m`;
      if (this._selectedBuildingRecord) {
        const { lon, lat } = this._selectedBuildingRecord.properties;
        this._showInfluenceCircle(lon, lat);
      }
    });

    document.getElementById("ctrl-export")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        button.disabled = true;
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
          this._showToast(`导出失败：${res.message || "未知错误"}`);
        }
      } catch (error) {
        this._showToast(`导出请求失败：${error.message}`);
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("ctrl-tracking")?.addEventListener("click", () => {
      const toggle = document.querySelector('[data-layer-toggle="tracking"]');
      if (toggle) {
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event("change"));
      }
    });
  }

  async _fetchWeatherData() {
    try {
      const res = await apiGetWeather();
      if (res?.success && res.data) {
        this._weatherPanels?.update(res.data);
        this._healthPanel?.update(res.data);
        this._updateHeaderStats(res.data);
        this._setBackendStatus(true);
      } else {
        this._setBackendStatus(false);
        this._applyFallbackHealth();
      }
    } catch (error) {
      console.warn("[GIS] 气象数据获取失败:", error);
      this._setBackendStatus(false);
      this._applyFallbackHealth();
    }
    await this._updateStats();
  }

  _startWeatherPolling() {
    this._pollTimer = window.setInterval(() => {
      this._fetchWeatherData();
    }, 60000);
  }

  _startTrackingPolling() {
    let failures = 0;
    const fetchTracking = async () => {
      try {
        const res = await apiGetTracking();
        if (res?.success && Array.isArray(res.entities)) {
          failures = 0;
          this._trackingPanel?.update(res.entities);
          this._updateTrackingMap(res.entities);
        } else {
          failures += 1;
        }
      } catch (error) {
        failures += 1;
        console.warn("[GIS] 追踪数据获取失败:", error);
      } finally {
        const nextDelay = failures > 0 ? 15000 : 3000;
        this._trackingTimer = window.setTimeout(fetchTracking, nextDelay);
      }
    };
    fetchTracking();
  }

  async _whatIfAdd(lon, lat, height, type) {
    const buildingId = `gis_${Date.now().toString(36)}`;
    const record = this._addScenarioBuilding(buildingId, lon, lat, height, type);
    this._selectedBuildingRecord = record;
    this._placementMode = null;
    document.getElementById("ctrl-add")?.classList.remove("active");

    try {
      this._reasoningPanel?.setLoading([
        "检测到 ADD 建筑操作",
        "写入数据库...",
        "物理方程计算中...",
        "热力场更新...",
      ]);

      await apiCreateBuilding({
        name: `${type}_${buildingId}`,
        height,
        albedo: 0.3,
        baseTemp: 30,
        lon,
        lat,
        building_type: type,
      });

      const apiResult = await apiWhatIf({
        targetBuildingId: buildingId,
        action: "ADD",
        radiusMeters: this._getRadiusMeters(),
        buildingInfo: { name: `${type}_${buildingId}`, height, albedo: 0.3, baseTemp: 30, lon, lat },
      });

      if (apiResult.success && apiResult.data) {
        const { scenarioId, averageTempDelta, confidence, reasoningSteps } = apiResult.data;
        record.properties.scenarioId = scenarioId;
        this._lastScenarioId = scenarioId;
        this._setSourceData("scenario-buildings", this._scenarioBuildings);
        this._updateHeatmapForDelta(averageTempDelta);
        this._showInfluenceCircle(lon, lat);
        this._reasoningPanel?.setResult(averageTempDelta, confidence, reasoningSteps ?? []);
        this._showToast(`ADD 推演完成：${averageTempDelta >= 0 ? "+" : ""}${averageTempDelta.toFixed(2)}°C`);
      } else {
        this._reasoningPanel?.clear();
        this._showToast(`推演失败：${apiResult.message || "后端未返回结果"}`);
      }
    } catch (error) {
      console.error("[GIS] What-If ADD 失败:", error);
      this._reasoningPanel?.clear();
      this._showToast("推演请求失败，已保留本地场景建筑");
    } finally {
      this._refreshScenarioList();
      this._updateStats();
    }
  }

  async _removeScenarioBuilding() {
    const record = this._selectedBuildingRecord || this._scenarioBuildings.features.at(-1);
    if (!record) {
      this._showToast("暂无可删除的推演建筑");
      return;
    }

    this._selectedBuildingRecord = null;
    this._scenarioBuildings.features = this._scenarioBuildings.features.filter((item) => item.properties.id !== record.properties.id);
    this._setSourceData("scenario-buildings", this._scenarioBuildings);
    this._setSourceData("influence-circle", this._emptyFeatureCollection());
    this._closeDetailModal();

    try {
      this._reasoningPanel?.setLoading(["检测到 REMOVE 建筑操作", "调用撤销推理...", "热力场还原中..."]);
      const apiResult = await apiWhatIf({
        targetBuildingId: record.properties.id,
        action: "REMOVE",
        radiusMeters: this._getRadiusMeters(),
        buildingInfo: {
          name: record.properties.name,
          height: record.properties.height,
          albedo: 0.3,
          baseTemp: 30,
          lon: record.properties.lon,
          lat: record.properties.lat,
        },
        sourceScenarioId: record.properties.scenarioId,
      });

      if (apiResult.success && apiResult.data) {
        const { averageTempDelta, confidence, reasoningSteps } = apiResult.data;
        this._updateHeatmap(this._initialHeatData);
        this._reasoningPanel?.setResult(averageTempDelta, confidence, reasoningSteps ?? []);
        this._showToast(`REMOVE 推演完成：${averageTempDelta >= 0 ? "+" : ""}${averageTempDelta.toFixed(2)}°C`);
      } else {
        this._updateHeatmap(this._initialHeatData);
        this._reasoningPanel?.clear();
        this._showToast("推演建筑已从本地场景删除");
      }
    } catch (error) {
      console.warn("[GIS] What-If REMOVE 失败:", error);
      this._updateHeatmap(this._initialHeatData);
      this._reasoningPanel?.clear();
    } finally {
      this._refreshScenarioList();
      this._updateStats();
    }
  }

  _addScenarioBuilding(id, lon, lat, height, type) {
    const size = Math.max(24, Math.min(54, height * 0.72));
    const geometry = this._squarePolygon(lon, lat, size);
    const feature = {
      type: "Feature",
      properties: {
        id,
        name: `${type}_${id.slice(-6)}`,
        buildingType: type,
        height,
        lon,
        lat,
        createdAt: new Date().toISOString(),
        scenarioId: "",
      },
      geometry,
    };

    this._scenarioBuildings.features.push(feature);
    this._setSourceData("scenario-buildings", this._scenarioBuildings);
    return feature;
  }

  _refreshScenarioList() {
    const container = document.getElementById("scenario-list");
    if (!container) return;

    apiListScenarios().then((res) => {
      const remoteScenarios = res?.success ? (res.data || []) : [];
      const localScenarios = this._scenarioBuildings.features.map((feature) => ({
        action: "ADD",
        tempDelta: 0,
        createdAt: feature.properties.createdAt,
        buildingInfo: { name: feature.properties.name },
        targetBuildingId: feature.properties.id,
        localOnly: true,
      }));
      const scenarios = remoteScenarios.length ? remoteScenarios : localScenarios;

      if (!scenarios.length) {
        container.innerHTML = '<div style="font-size:12px;color:#5a8aaa;text-align:center;padding:12px 0;">暂无已保存的场景</div>';
        return;
      }

      container.innerHTML = scenarios.slice(0, 12).map((item) => {
        const actionColor = item.action === "ADD" ? "#e65f5c" : "#36c6b4";
        const actionText = item.action === "ADD" ? "+建筑" : "-建筑";
        const delta = Number(item.tempDelta ?? 0);
        const sign = delta >= 0 ? "+" : "";
        const time = item.createdAt
          ? new Date(item.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : "--";
        const name = this._escapeHtml(item.buildingInfo?.name ?? `建筑-${String(item.targetBuildingId || "").slice(0, 6)}`);
        return `<div style="padding:6px 4px;border-bottom:1px solid rgba(0,180,255,0.06);font-size:11px;line-height:1.5;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <span style="background:${actionColor};color:#fff;border-radius:3px;padding:1px 5px;font-size:10px;">${actionText}</span>
            <span style="color:#a8c8e0;font-size:11px;">${name}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:#5a8aaa;">
            <span>${item.localOnly ? "本地待同步" : `${sign}${delta.toFixed(4)}°C`}</span>
            <span>${time}</span>
          </div>
        </div>`;
      }).join("");
    }).catch(() => {
      container.innerHTML = '<div style="font-size:12px;color:#5a8aaa;text-align:center;padding:12px 0;">暂无已保存的场景</div>';
    });
  }

  async _updateStats() {
    const buildingsEl = document.getElementById("stat-buildings");
    const addedBuildingsEl = document.getElementById("stat-added-buildings");
    const scenariosEl = document.getElementById("stat-scenarios");

    if (buildingsEl) buildingsEl.textContent = this._baseBuildingCount || "--";
    if (addedBuildingsEl) addedBuildingsEl.textContent = this._scenarioBuildings.features.length;

    try {
      const res = await apiGetStats();
      if (res?.success && scenariosEl) {
        scenariosEl.textContent = res.data.scenariosCount ?? this._scenarioBuildings.features.length;
      } else if (scenariosEl) {
        scenariosEl.textContent = this._scenarioBuildings.features.length;
      }
    } catch {
      if (scenariosEl) scenariosEl.textContent = this._scenarioBuildings.features.length;
    }
  }

  _updateTrackingMap(entities) {
    const pointFeatures = entities.map((entity) => ({
      type: "Feature",
      properties: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        status: entity.status,
        speed: entity.speed ?? 0,
        heading: entity.heading ?? 0,
      },
      geometry: { type: "Point", coordinates: [entity.lon, entity.lat] },
    }));

    const lineFeatures = entities
      .filter((entity) => Array.isArray(entity.trajectory) && entity.trajectory.length > 1)
      .map((entity) => ({
        type: "Feature",
        properties: { id: entity.id, type: entity.type },
        geometry: {
          type: "LineString",
          coordinates: entity.trajectory.map((point) => [point.lon, point.lat]),
        },
      }));

    this._setSourceData("tracking-entities", { type: "FeatureCollection", features: pointFeatures });
    this._setSourceData("tracking-trajectories", { type: "FeatureCollection", features: lineFeatures });
  }

  _updateHeatmapForDelta(delta) {
    const factor = delta / 20;
    this._updateHeatmap(this._initialHeatData.map((point) => ({
      ...point,
      value: Math.min(1, Math.max(0, point.value + factor)),
    })));
  }

  _updateHeatmap(data) {
    this._currentHeatData = data;
    this._setSourceData("thermal-field", this._heatFeatureCollection(data));
  }

  _showInfluenceCircle(lon, lat) {
    this._setSourceData("influence-circle", {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: this._circlePolygon(lon, lat, this._getRadiusMeters()),
      }],
    });
  }

  _openBuildingPopup(feature, lngLat) {
    const maplibregl = this._maplibre;
    if (!maplibregl) return;
    const props = feature.properties || {};
    const name = props.name || "OSM 建筑";
    const height = props.height_m || props.height || "--";
    const area = props.area_m2 ? `${Number(props.area_m2).toFixed(0)} m²` : "--";
    new maplibregl.Popup({ closeButton: false, maxWidth: "260px" })
      .setLngLat(lngLat)
      .setHTML(`
        <div class="map-popup">
          <strong>${this._escapeHtml(name)}</strong>
          <span>高度 ${this._escapeHtml(height)} m</span>
          <span>面积 ${this._escapeHtml(area)}</span>
          <small>OpenStreetMap / ODbL</small>
        </div>
      `)
      .addTo(this._map);
  }

  _openPointPopup(feature, lngLat) {
    const maplibregl = this._maplibre;
    if (!maplibregl) return;
    const props = feature.properties || {};
    new maplibregl.Popup({ closeButton: false, maxWidth: "260px" })
      .setLngLat(lngLat)
      .setHTML(`
        <div class="map-popup">
          <strong>${this._escapeHtml(props.name || props.id || "节点")}</strong>
          <span>类型 ${this._escapeHtml(props.nodeType || props.type || "--")}</span>
          <span>状态 ${this._escapeHtml(props.status || "--")}</span>
        </div>
      `)
      .addTo(this._map);
  }

  _openDetailModal(record) {
    const modal = document.getElementById("building-detail-modal");
    const overlay = document.getElementById("modal-overlay");
    if (!modal || !overlay) return;

    const props = record.properties || {};
    this._setText("modal-name", props.name || "--");
    this._setText("modal-height", props.height ? `${props.height}m` : "--");
    this._setText("modal-type", props.buildingType || "--");
    this._setText("modal-time", props.createdAt ? new Date(props.createdAt).toLocaleString("zh-CN") : "--");
    this._setText("modal-scenario", props.scenarioId || "本地场景，等待后端返回场景ID");

    modal.style.display = "block";
    overlay.style.display = "block";
    this._showInfluenceCircle(props.lon, props.lat);
  }

  _closeDetailModal() {
    const modal = document.getElementById("building-detail-modal");
    const overlay = document.getElementById("modal-overlay");
    if (modal) modal.style.display = "none";
    if (overlay) overlay.style.display = "none";
  }

  _renderSensorTree() {
    const container = document.getElementById("sensor-tree");
    if (!container) return;

    container.innerHTML = this._sensorData.map((group) => `
      <details open>
        <summary>
          <span>${this._escapeHtml(group.name)}</span>
          <b>${group.children.length}</b>
        </summary>
        ${group.children.map((gateway) => `
          <details open class="sensor-gateway">
            <summary data-sensor-id="${this._escapeHtml(gateway.id)}">
              <span class="sensor-status ${gateway.status}"></span>
              <span>${this._escapeHtml(gateway.name)}</span>
              <b>${gateway.children.length}</b>
            </summary>
            ${gateway.children.map((node) => `
              <button type="button" class="sensor-node" data-sensor-id="${this._escapeHtml(node.id)}">
                <span class="sensor-status ${node.status}"></span>
                <span>${this._escapeHtml(node.name)}</span>
                <em>${this._escapeHtml(node.type)}</em>
              </button>
            `).join("")}
          </details>
        `).join("")}
      </details>
    `).join("");
  }

  _sensorFeatureCollection() {
    const features = [];
    for (const group of this._sensorData) {
      for (const gateway of group.children) {
        features.push(this._sensorFeature(gateway, "gateway"));
        for (const node of gateway.children) features.push(this._sensorFeature(node, "sensor"));
      }
    }
    return { type: "FeatureCollection", features };
  }

  _sensorFeature(node, nodeType) {
    return {
      type: "Feature",
      properties: {
        id: node.id,
        name: node.name,
        type: node.type,
        nodeType,
        status: node.status,
      },
      geometry: { type: "Point", coordinates: [node.lon, node.lat] },
    };
  }

  _findSensor(id) {
    for (const group of this._sensorData) {
      for (const gateway of group.children) {
        if (gateway.id === id) return gateway;
        const found = gateway.children.find((node) => node.id === id);
        if (found) return found;
      }
    }
    return null;
  }

  _getSensorTreeData() {
    return [{
      name: "郑州大学主校区监测网",
      children: [
        {
          id: "gw-core-01",
          name: "核心区网关",
          type: "LoRa/MQTT",
          status: "online",
          lon: 113.5311,
          lat: 34.8151,
          children: [
            { id: "zzu-t-001", name: "钟楼广场热环境", type: "温湿度/辐射", status: "online", lon: 113.5302, lat: 34.8155 },
            { id: "zzu-t-002", name: "厚山步道微气候", type: "风速/地表温", status: "online", lon: 113.5286, lat: 34.8168 },
            { id: "zzu-t-003", name: "主教学区热胁迫", type: "黑球温度", status: "warning", lon: 113.5328, lat: 34.8143 },
          ],
        },
        {
          id: "gw-south-02",
          name: "南区网关",
          type: "Wi-Fi/MQTT",
          status: "online",
          lon: 113.5329,
          lat: 34.8096,
          children: [
            { id: "zzu-s-011", name: "南操场边界", type: "温湿度", status: "online", lon: 113.5334, lat: 34.8102 },
            { id: "zzu-s-012", name: "生活区通风廊道", type: "风速/风向", status: "online", lon: 113.5309, lat: 34.8088 },
          ],
        },
        {
          id: "gw-west-03",
          name: "西区网关",
          type: "NB-IoT",
          status: "warning",
          lon: 113.5265,
          lat: 34.8129,
          children: [
            { id: "zzu-w-021", name: "西门道路热暴露", type: "地表温", status: "warning", lon: 113.5258, lat: 34.8135 },
            { id: "zzu-w-022", name: "绿地冷岛节点", type: "温湿度", status: "online", lon: 113.5276, lat: 34.8118 },
          ],
        },
      ],
    }];
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

  _heatFeatureCollection(data) {
    return {
      type: "FeatureCollection",
      features: data.map((point) => ({
        type: "Feature",
        properties: { value: point.value },
        geometry: {
          type: "Point",
          coordinates: [
            this._bound.west + (this._bound.east - this._bound.west) * point.x,
            this._bound.south + (this._bound.north - this._bound.south) * point.y,
          ],
        },
      })),
    };
  }

  _squarePolygon(lon, lat, sizeMeters) {
    const half = sizeMeters / 2;
    const latOffset = half / 111320;
    const lonOffset = half / (111320 * Math.cos(lat * Math.PI / 180));
    return {
      type: "Polygon",
      coordinates: [[
        [lon - lonOffset, lat - latOffset],
        [lon + lonOffset, lat - latOffset],
        [lon + lonOffset, lat + latOffset],
        [lon - lonOffset, lat + latOffset],
        [lon - lonOffset, lat - latOffset],
      ]],
    };
  }

  _circlePolygon(lon, lat, radiusMeters) {
    const coordinates = [];
    for (let i = 0; i <= 72; i += 1) {
      const angle = (i / 72) * Math.PI * 2;
      const dx = Math.cos(angle) * radiusMeters;
      const dy = Math.sin(angle) * radiusMeters;
      coordinates.push([
        lon + dx / (111320 * Math.cos(lat * Math.PI / 180)),
        lat + dy / 111320,
      ]);
    }
    return { type: "Polygon", coordinates: [coordinates] };
  }

  _bindHeaderTime() {
    const timeEl = document.getElementById("header-time");
    if (!timeEl) return;

    const tick = () => {
      const now = new Date();
      timeEl.textContent = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    };
    tick();
    this._clockTimer = window.setInterval(tick, 1000);
  }

  _updateHeaderStats(data) {
    this._setText("header-temp", `${(data.temperature ?? 0).toFixed(1)}°C`);
    this._setText("header-uhi", `${(data.uhiIntensity ?? 0).toFixed(1)}°C`);
    this._setText("footer-updated", new Date().toLocaleTimeString("zh-CN", { hour12: false }));
  }

  _applyFallbackHealth() {
    this._healthPanel?.update({
      aqi: 62,
      heatHealthRisk: 70,
      visibility: 12,
      uvIndex: 6,
      aod: 0.35,
      precipitation: 0,
    });
  }

  _setBackendStatus(online) {
    const el = document.getElementById("backend-status");
    if (!el) return;
    el.className = `status-badge ${online ? "ok" : "warn"}`;
    el.innerHTML = `<span class="dot"></span>${online ? "后端连接正常" : "后端降级运行"}`;
  }

  _getRadiusMeters() {
    const slider = document.getElementById("ctrl-radius");
    return slider ? parseInt(slider.value, 10) : 100;
  }

  async _waitForMapContainer() {
    const container = document.getElementById("cesiumContainer");
    if (!container) return;

    for (let i = 0; i < 60; i += 1) {
      const rect = container.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  _firstSymbolLayerId() {
    return this._map?.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;
  }

  async _waitForEditableStyle() {
    if (this._map?.isStyleLoaded()) return;

    await new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      const timeout = window.setTimeout(() => {
        console.warn("[GIS] 自定义样式加载较慢，切换到默认同源代理底图");
        this._map?.setStyle(this._defaultRasterStyle());
        this._map?.once("style.load", finish);
        window.setTimeout(finish, 1200);
      }, 10000);

      this._map?.once("style.load", () => {
        window.clearTimeout(timeout);
        finish();
      });

      this._map?.once("error", (event) => {
        const message = event?.error?.message || "";
        if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
          console.warn("[GIS] 底图资源加载异常:", message);
        }
      });
    });
  }

  _defaultRasterStyle() {
    return {
      version: 8,
      sources: {
        imagery: {
          type: "raster",
          tiles: [this._tileUrl("imagery")],
          tileSize: 256,
          attribution: "Esri World Imagery",
        },
      },
      layers: [{
        id: "weather-fallback-background",
        type: "background",
        paint: {
          "background-color": "#071722",
        },
      }, {
        id: "imagery-raster",
        type: "raster",
        source: "imagery",
        paint: {
          "raster-opacity": 0.92,
          "raster-saturation": -0.08,
          "raster-contrast": 0.08,
          "raster-brightness-max": 0.9,
        },
      }],
    };
  }

  _tileUrl(type) {
    const local = this._isLocalPreviewHost();
    if (type === "topo") {
      return local
        ? "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        : "/tiles/world-topo/{z}/{y}/{x}";
    }
    return local
      ? "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "/tiles/world-imagery/{z}/{y}/{x}";
  }

  _isLocalPreviewHost() {
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "";
  }

  _setSourceData(sourceId, data) {
    const source = this._map?.getSource(sourceId);
    if (source?.setData) source.setData(data);
  }

  async _loadMaplibre() {
    if (!this._maplibre) {
      this._maplibre = await import("maplibre-gl");
    }
    return this._maplibre;
  }

  _setModelStatus(label, count, tone = "ok", countText = null) {
    const status = document.getElementById("model-status");
    if (status) status.className = `map-layer-status ${tone}`;
    this._setText("model-status-label", label);
    this._setText("model-status-count", countText ?? (count > 0 ? `${count}栋` : "已接入"));
    this._setText("stat-buildings", count > 0 ? String(count) : "--");
  }

  _setModelAttribution(text) {
    if (text) this._setText("model-attribution", text);
  }

  _setLoadingText(text) {
    const el = document.querySelector(".loader-text");
    if (el) el.textContent = text;
  }

  _hideLoading() {
    document.getElementById("loadingOverlay")?.classList.add("hidden");
  }

  _notifyReady() {
    window.dispatchEvent(new CustomEvent("__decisionReady__", { detail: { mode: "gis" } }));
    window.dispatchEvent(new CustomEvent("__cesiumReady__", { detail: { mode: "gis" } }));
  }

  _showToast(message) {
    let container = document.querySelector(".toast-container");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4000);
  }

  _emptyFeatureCollection() {
    return { type: "FeatureCollection", features: [] };
  }

  _setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  _escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async destroy() {
    if (this._cesiumDelegate) {
      await this._cesiumDelegate.destroy();
      return;
    }
    if (this._pollTimer) window.clearInterval(this._pollTimer);
    if (this._trackingTimer) window.clearInterval(this._trackingTimer);
    if (this._clockTimer) window.clearInterval(this._clockTimer);

    this._weatherPanels?.destroy();
    this._healthPanel?.destroy();
    this._timeseries?.destroy();
    this._trackingPanel?.destroy();
    this._map?.remove();
    this._map = null;
  }
}
