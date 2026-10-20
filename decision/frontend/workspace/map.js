import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { $, escape as e, numeric as n, date } from "./ui.js";
import { isCompetition, anonymousText } from "./edition.js";

const empty = () => ({ type: "FeatureCollection", features: [] });
export class SpatialWorkspace {
  constructor({ observation, plans, onChoose, onRegion, dark = false, onState = () => {} }) {
    this.observation = observation;
    this.plans = plans;
    this.onChoose = onChoose;
    this.onRegion = onRegion;
    this.dark = dark; this.onState = onState;
    this.disposed = false;
    this.abort = new AbortController();
    this.handlers = [];
    this.tileFailed = false;
    this.buildings = 0;
    this.point = null;
    this.weatherListener = (event) => { this.observation = event.detail.observation; this.plans = event.detail.plans; this.updateWeather(); };
  }

  async init() {
    this.map = new maplibregl.Map({ container: "workspace-map", center: [113.531, 34.814], zoom: this.dark ? 15.7 : 15.3, pitch: 54, bearing: -24, maxPitch: 70, attributionControl: false, canvasContextAttributes: { antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).get("capture") === "1" },
      style: { version: 8, light: { anchor: "map", color: "#fff0da", intensity: 0.6, position: [1.5, 210, 38] }, sources: isCompetition ? {} : { imagery: { type: "raster", tileSize: 256, tiles: [`${location.origin}/tiles/world-imagery/{z}/{y}/{x}`], attribution: "Esri World Imagery" }, streets: { type: "raster", tileSize: 256, tiles: [`${location.origin}/tiles/world-topo/{z}/{y}/{x}`], attribution: "Esri World Topographic Map" } }, layers: [{ id: "background", type: "background", paint: { "background-color": this.dark ? "#202c2b" : "#e4e9df" } }, ...(isCompetition ? [] : [{ id: "imagery", type: "raster", source: "imagery", paint: { "raster-opacity": 1, "raster-saturation": -0.15, "raster-brightness-max": this.dark ? 0.72 : 1 } }, { id: "streets", type: "raster", source: "streets", layout: { visibility: "none" } }])] },
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    this.map.on("error", (event) => {
      if (["imagery", "streets"].includes(event.sourceId)) { this.tileFailed = true; this.updateMapState(); }
    });
    await new Promise((resolve) => {
      const done = () => { clearTimeout(this.readyTimer); this.readyDone = null; resolve(); };
      this.readyDone = done;
      this.readyTimer = setTimeout(done, 6000);
      this.map.once("style.load", done);
      if (this.map.isStyleLoaded()) done();
    });
    if (this.disposed) return;
    this.map.addSource("weather-grid", { type: "geojson", data: empty() });
    this.map.addLayer({ id: "weather-grid-point", type: "circle", source: "weather-grid", paint: { "circle-radius": 10, "circle-color": "#f3ba50", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3, "circle-opacity": 0.95 } });
    this.map.addSource("plans", { type: "geojson", data: this.planFeatures() });
    this.map.addLayer({ id: "plan-areas", type: "fill", source: "plans", paint: { "fill-color": ["match", ["get", "intervention"], "greening", "#76be70", "cool_roof", "#9b92d0", "building", "#cb9572", "#e6bd58"], "fill-opacity": 0.7 } });
    this.map.addLayer({ id: "plan-outline", type: "line", source: "plans", paint: { "line-color": "#fff", "line-width": 2 } });
    this.map.addSource("regional-area", { type: "geojson", data: empty() });
    this.map.addLayer({ id: "regional-area-fill", type: "fill", source: "regional-area", paint: { "fill-color": "#5fbed0", "fill-opacity": 0.09 } });
    this.map.addLayer({ id: "regional-area-line", type: "line", source: "regional-area", paint: { "line-color": "#65d4dc", "line-width": 2, "line-dasharray": [3,2] } });
    this.map.addSource("regional-samples", { type: "geojson", data: empty() });
    this.map.addLayer({ id: "regional-sample-points", type: "circle", source: "regional-samples", paint: { "circle-radius": 7, "circle-color": ["match", ["get", "risk"], "danger", "#e47160", "extreme_danger", "#c14258", "extreme_caution", "#ecb761", "caution", "#d2cc7c", "below_range", "#8dc7b4", "#9ca8ab"], "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
    this.regionKeyHandler = (event) => { if (event.key === "Escape" && this.selectingRegion) { this.selectingRegion = false; this.regionFirst = null; this.map.getCanvas().style.cursor = ""; this.updateMapState(); } };
    document.addEventListener("keydown", this.regionKeyHandler);
    if (isCompetition) for (const id of ["map-imagery", "map-streets"]) { const button = $(id); if (button) { button.disabled = true; button.setAttribute("aria-pressed", "false"); button.title = "竞赛匿名模式不加载含地名、校名或校徽的影像与街道底图"; button.textContent = id === "map-imagery" ? "匿名底图" : "街道停用"; } }
    this.map.on("click", (event) => this.pick(event));
    this.map.on("moveend", () => { if (!this.disposed) $("map-pitch")?.setAttribute("aria-pressed", String(this.map.getPitch() >= 20)); });
    this.map.on("mousemove", (event) => { if (!this.disposed) $("map-coordinate").textContent = `${n(event.lngLat.lng, 5)}°E / ${n(event.lngLat.lat, 5)}°N`; });
    this.resizeObserver = new ResizeObserver(() => { if (!this.disposed) this.map.resize(); });
    this.resizeObserver.observe($("workspace-map"));
    this.bind("map-home", "click", () => { this.stopOrbit(); this.map.easeTo({ center: [113.531, 34.814], zoom: this.dark ? 15.7 : 15.3, pitch: 54, bearing: -24, duration: this.duration() }); });
    this.bind("map-grid", "click", () => { if (this.observation) this.map.easeTo({ center: [this.observation.location.longitude, this.observation.location.latitude], zoom: 13.5, duration: this.duration() }); });
    this.bind("map-pitch", "click", () => { const next = this.map.getPitch() < 20; this.map.easeTo({ pitch: next ? 48 : 0, bearing: next ? -16 : 0, duration: this.duration() }); $("map-pitch").setAttribute("aria-pressed", String(next)); });
    this.bind("layer-buildings", "change", (event) => this.setBuildings(event.target.checked));
    this.bind("layer-grid", "change", (event) => this.visible(["weather-grid-point"], event.target.checked));
    this.bind("layer-plans", "change", (event) => this.visible(["plan-areas", "plan-outline"], event.target.checked));
    this.bind("use-location", "click", () => { if (this.point) this.onChoose(this.point); });
    this.bind("map-imagery", "click", () => this.setBasemap("imagery"));
    this.bind("map-streets", "click", () => this.setBasemap("streets"));
    this.bind("map-orbit", "click", () => this.orbiting ? this.stopOrbit() : this.startOrbit());
    this.bind("map-light", "input", (event) => this.modelLayer?.setLighting(event.target.value));
    this.map.on("dragstart", () => this.stopOrbit());
    this.visibilityHandler = () => { if (document.hidden) this.stopOrbit(); };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    window.addEventListener("workspace:weather", this.weatherListener);
    this.updateWeather();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${isCompetition ? "aic/assets/campus-buildings.geojson" : "data/zzu_osm_buildings.geojson"}`, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]), cache: "force-cache" });
      if (!response.ok) throw new Error("building data");
      const data = await response.json();
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("invalid GeoJSON");
      if (this.disposed) return;
      this.buildings = data.features.length;
      this.map.addSource("campus-buildings", { type: "geojson", data, generateId: true, attribution: "© OpenStreetMap contributors · ODbL" });
      this.map.addLayer({ id: "campus-picking", type: "fill", source: "campus-buildings", paint: { "fill-color": "#a1d4b7", "fill-opacity": 0.01 } }, "weather-grid-point");
      this.map.addLayer({ id: "campus-building", type: "fill-extrusion", source: "campus-buildings", paint: { "fill-extrusion-color": "#c7d9cf", "fill-extrusion-height": ["case", [">", ["coalesce", ["to-number", ["get", "height_m"]], 0], 0], ["to-number", ["get", "height_m"]], 18], "fill-extrusion-opacity": 0.95, "fill-extrusion-base": 0 } }, "weather-grid-point");
      this.map.addLayer({ id: "campus-outline", type: "line", source: "campus-buildings", paint: { "line-color": this.dark ? "#8bd9bb" : "#355c4a", "line-width": 0.8, "line-opacity": 0.65 } }, "weather-grid-point");
      this.setBuildings($("layer-buildings").checked);
      this.updateMapState();
      try {
        const { createBuildingLayer } = await import("./buildings3d.js");
        if (this.disposed) return;
        this.modelLayer = createBuildingLayer(data, { dark: this.dark, onError: () => { this.modelFailed = true; this.map.setPaintProperty("campus-building", "fill-extrusion-opacity", 0.95); this.updateMapState(); } });
        this.map.addLayer(this.modelLayer, "weather-grid-point");
        if (!this.modelFailed) this.map.setPaintProperty("campus-building", "fill-extrusion-opacity", 0);
        this.setBuildings($("layer-buildings").checked);
        this.updateMapState();
      } catch { this.modelFailed = true; this.updateMapState(); }
    } catch { if (!this.disposed) { this.buildingFailed = true; this.updateMapState(); } }
  }

  bind(id, event, callback) { const node = $(id); node?.addEventListener(event, callback); this.handlers.push(() => node?.removeEventListener(event, callback)); }
  duration() { return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450; }
  setBuildings(on) {
    this.visible(["campus-building", "campus-outline", "campus-picking"], on);
    if (this.modelLayer) this.modelLayer.visible = on;
    this.map.triggerRepaint();
  }
  setBasemap(name) {
    if (isCompetition) return;
    this.tileFailed = false;
    this.visible(["imagery"], name === "imagery"); this.visible(["streets"], name === "streets");
    for (const key of ["imagery", "streets"]) $("map-" + key)?.setAttribute("aria-pressed", String(key === name));
    this.updateMapState();
  }
  startOrbit() {
    if (!this.duration()) return;
    this.orbiting = true; $("map-orbit")?.setAttribute("aria-pressed", "true");
    let previous = performance.now();
    const tick = (now) => {
      if (!this.orbiting || this.disposed || document.hidden) return;
      const delta = Math.min(now - previous, 100);
      if (delta >= 32) { this.map.setBearing(this.map.getBearing() + delta * 0.0025); previous = now; }
      this.orbitFrame = requestAnimationFrame(tick);
    };
    this.orbitFrame = requestAnimationFrame(tick);
  }
  stopOrbit() { this.orbiting = false; cancelAnimationFrame(this.orbitFrame); $("map-orbit")?.setAttribute("aria-pressed", "false"); }
  visible(layers, on) { for (const layer of layers) if (this.map.getLayer(layer)) this.map.setLayoutProperty(layer, "visibility", on ? "visible" : "none"); }
  updateMapState() {
    if (this.disposed) return;
    $("map-state").classList.toggle("warn", !!(this.tileFailed || this.buildingFailed || this.modelFailed));
    $("map-state").textContent = `${this.selectingRegion ? "选区中：依次点击两个对角点 / Esc取消 · " : ""}${isCompetition ? "匿名建筑底图 · " : ""}${this.buildings ? `${this.buildings}栋建筑轮廓 · 高度含估计值` : (this.buildingFailed ? "建筑资料暂不可用" : "正在读取建筑资料")}${this.tileFailed ? " · 当前底图部分瓦片不可用" : ""}${this.modelFailed ? " · 细节渲染不可用，已保留基础体块" : ""}`;
    $("workspace-map").dataset.model = this.modelLayer && !this.modelFailed ? "three" : "extrusion";
    $("workspace-map").dataset.buildings = String(this.buildings);
    this.onState({ buildings: this.buildings, model: this.modelLayer && !this.modelFailed ? "Three.js 建筑细节" : "建筑体块", unavailable: this.buildingFailed, tileFailed: this.tileFailed });
  }
  updateWeather() {
    if (this.disposed) return;
    const o = this.observation;
    this.map.getSource("plans")?.setData(this.planFeatures());
    this.map.getSource("weather-grid")?.setData(o ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [o.location.longitude, o.location.latitude] }, properties: { name: o.location_label } }] } : empty());
    $("map-grid").disabled = !o;
    $("map-weather").innerHTML = o ? `<div class="map-values"><span>${n(o.temperature_c)}°C</span><span>${n(o.relative_humidity_pct, 0)}%</span></div><p>${e(o.location_label)}</p><p><small>${date(o.observed_at, true)} 北京时间</small></p><p><small>网格中心 ${n(o.location.latitude, 4)}°N / ${n(o.location.longitude, 4)}°E</small></p>` : "<p>暂无有效天气，未用示意值替代。</p>";
  }
  pick(event) {
    if (this.disposed) return;
    const { lng, lat } = event.lngLat;
    if (this.selectingRegion) {
      if (lng < 113.4 || lng > 113.9 || lat < 34.6 || lat > 34.95) { toastRegion("选区超出当前资料支持范围，请返回区域后选择。"); return; }
      if (!this.regionFirst) { this.regionFirst = [lng, lat]; $("map-state").textContent = "已选择第一个角点，请点击对角点。Esc取消"; return; }
      const [lon0, lat0] = this.regionFirst;
      const bounds = { west: Number(Math.min(lng,lon0).toFixed(6)), east: Number(Math.max(lng,lon0).toFixed(6)), south: Number(Math.min(lat,lat0).toFixed(6)), north: Number(Math.max(lat,lat0).toFixed(6)) };
      if (bounds.east-bounds.west < 0.0001 || bounds.north-bounds.south < 0.0001 || bounds.east-bounds.west > 0.1 || bounds.north-bounds.south > 0.1) { $("map-state").textContent = "矩形范围需有面积且经纬跨度不超过0.1度；重新选择两个角点。"; this.regionFirst=null; return; }
      this.selectingRegion=false; this.regionFirst=null; this.map.getCanvas().style.cursor=""; this.setRegion(bounds); this.updateMapState(); this.onRegion?.(bounds); return;
    }
    if (lng < 113.4 || lng > 113.9 || lat < 34.6 || lat > 34.95) { $("picked-description").textContent = anonymousText("当前方案登记范围为郑州城区，请返回区域后选点。"); return; }
    this.point = { longitude: Number(lng.toFixed(6)), latitude: Number(lat.toFixed(6)) };
    this.marker?.remove(); this.marker = new maplibregl.Marker({ color: "#147858" }).setLngLat([lng, lat]).addTo(this.map);
    $("picked-location").textContent = `${n(lng, 6)}°E / ${n(lat, 6)}°N`;
    const queryLayers = ["campus-picking", "campus-building", "plan-areas", "weather-grid-point"].filter((id) => this.map.getLayer(id));
    const features = this.map.queryRenderedFeatures(event.point, { layers: queryLayers });
    const feature = features.find((item) => item.layer.id === "weather-grid-point") || features.find((item) => item.layer.id === "plan-areas") || features[0];
    const isBuilding = feature && ["campus-building", "campus-picking"].includes(feature.layer.id);
    let description = "已选择研判位置；坐标来自地图点击，未作现场测量。";
    if (isBuilding) {
      const p = feature.properties;
      description = `建筑轮廓 · ${isCompetition ? "某校园建筑" : (p.name || "未命名建筑")} · 高度${p.height_m == null ? "缺失，按18米示意" : n(Number(p.height_m)) + "米（底图属性，未现场核验）"}`;
    } else if (feature?.layer.id === "plan-areas") description = `已有方案：${feature.properties.name}，用户输入的理想化范围。`;
    else if (feature?.layer.id === "weather-grid-point") description = "模型返回的网格中心，不是校园现场传感器。";
    $("picked-description").textContent = anonymousText(description);
    this.modelLayer?.select(isBuilding ? feature.id : null);
    $("use-location").disabled = false;
    this.popup?.remove(); this.popup = new maplibregl.Popup({ offset: 28, closeOnClick: true }).setLngLat([lng, lat]).setHTML(`<h3>已选研判位置</h3><p>${e(description)}</p>`).addTo(this.map);
  }
  planFeatures() {
    return { type: "FeatureCollection", features: this.plans.map((plan) => {
      const p = plan.input, half = Math.sqrt(p.area_m2) / 2;
      const dx = half / (111320 * Math.cos(p.latitude * Math.PI / 180)), dy = half / 111320;
      return { type: "Feature", properties: { name: p.name, intervention: p.intervention }, geometry: { type: "Polygon", coordinates: [[[p.longitude-dx,p.latitude-dy],[p.longitude+dx,p.latitude-dy],[p.longitude+dx,p.latitude+dy],[p.longitude-dx,p.latitude+dy],[p.longitude-dx,p.latitude-dy]]] } };
    }) };
  }
  beginRegion() { this.stopOrbit(); this.selectingRegion=true; this.regionFirst=null; this.map.getCanvas().style.cursor="crosshair"; this.updateMapState(); }
  setRegion(bounds, report=null) {
    if (this.disposed || !this.map?.getSource("regional-area")) return;
    const {west:w,east:e,south:s,north:n}=bounds;
    this.map.getSource("regional-area").setData({type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}}]});
    const seen=new Set();
    const features=(report?.samples||[]).flatMap(sample=>{const o=sample.observation;if(!o)return [];const key=`${o.location.longitude}/${o.location.latitude}`;if(seen.has(key))return [];seen.add(key);return [{type:"Feature",geometry:{type:"Point",coordinates:[o.location.longitude,o.location.latitude]},properties:{risk:sample.environment.risk,sample:sample.id}}];});
    this.map.getSource("regional-samples").setData({type:"FeatureCollection",features});
  }
  destroy() { this.disposed = true; this.stopOrbit(); this.abort.abort(); this.readyDone?.(); clearTimeout(this.readyTimer); this.resizeObserver?.disconnect(); this.handlers.forEach((remove) => remove()); window.removeEventListener("workspace:weather", this.weatherListener); document.removeEventListener("visibilitychange", this.visibilityHandler); document.removeEventListener("keydown", this.regionKeyHandler); this.popup?.remove(); this.marker?.remove(); this.map?.remove(); }
}
function toastRegion(message) { $("map-state").textContent=message; }
