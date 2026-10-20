import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { $, escape as e, numeric as n, date } from "./ui.js";

const empty = () => ({ type: "FeatureCollection", features: [] });
export class SpatialWorkspace {
  constructor({ observation, plans, onChoose }) {
    this.observation = observation;
    this.plans = plans;
    this.onChoose = onChoose;
    this.disposed = false;
    this.abort = new AbortController();
    this.handlers = [];
    this.tileFailed = false;
    this.buildings = 0;
    this.point = null;
    this.weatherListener = (event) => { this.observation = event.detail.observation; this.plans = event.detail.plans; this.updateWeather(); };
  }

  async init() {
    this.map = new maplibregl.Map({ container: "workspace-map", center: [113.531, 34.814], zoom: 15.3, pitch: 48, bearing: -16, maxPitch: 65, attributionControl: false,
      style: { version: 8, sources: { imagery: { type: "raster", tileSize: 256, tiles: [`${location.origin}/tiles/world-imagery/{z}/{y}/{x}`], attribution: "Esri World Imagery" } }, layers: [{ id: "background", type: "background", paint: { "background-color": "#e4e9df" } }, { id: "imagery", type: "raster", source: "imagery", paint: { "raster-opacity": 0.9, "raster-saturation": -0.25 } }] },
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    this.map.on("error", (event) => {
      if (event.sourceId === "imagery") { this.tileFailed = true; this.updateMapState(); }
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
    this.map.on("click", (event) => this.pick(event));
    this.map.on("mousemove", (event) => { if (!this.disposed) $("map-coordinate").textContent = `${n(event.lngLat.lng, 5)}°E / ${n(event.lngLat.lat, 5)}°N`; });
    this.resizeObserver = new ResizeObserver(() => { if (!this.disposed) this.map.resize(); });
    this.resizeObserver.observe($("workspace-map"));
    this.bind("map-home", "click", () => this.map.easeTo({ center: [113.531, 34.814], zoom: 15.3, pitch: 48, bearing: -16, duration: this.duration() }));
    this.bind("map-grid", "click", () => { if (this.observation) this.map.easeTo({ center: [this.observation.location.longitude, this.observation.location.latitude], zoom: 13.5, duration: this.duration() }); });
    this.bind("map-pitch", "click", () => { const next = this.map.getPitch() < 20; this.map.easeTo({ pitch: next ? 48 : 0, bearing: next ? -16 : 0, duration: this.duration() }); $("map-pitch").setAttribute("aria-pressed", String(next)); });
    this.bind("layer-buildings", "change", (event) => this.visible(["campus-building"], event.target.checked));
    this.bind("layer-grid", "change", (event) => this.visible(["weather-grid-point"], event.target.checked));
    this.bind("layer-plans", "change", (event) => this.visible(["plan-areas", "plan-outline"], event.target.checked));
    this.bind("use-location", "click", () => { if (this.point) this.onChoose(this.point); });
    window.addEventListener("workspace:weather", this.weatherListener);
    this.updateWeather();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/zzu_osm_buildings.geojson`, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]), cache: "force-cache" });
      if (!response.ok) throw new Error("building data");
      const data = await response.json();
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("invalid GeoJSON");
      if (this.disposed) return;
      this.buildings = data.features.length;
      this.map.addSource("campus-buildings", { type: "geojson", data, generateId: true, attribution: "© OpenStreetMap contributors · ODbL" });
      this.map.addLayer({ id: "campus-building", type: "fill-extrusion", source: "campus-buildings", paint: { "fill-extrusion-color": "#c7d9cf", "fill-extrusion-height": ["coalesce", ["to-number", ["get", "height_m"]], 18], "fill-extrusion-opacity": 0.85, "fill-extrusion-base": 0 } }, "weather-grid-point");
      this.visible(["campus-building"], $("layer-buildings").checked);
      this.updateMapState();
    } catch { if (!this.disposed) { this.buildingFailed = true; this.updateMapState(); } }
  }

  bind(id, event, callback) { const node = $(id); node?.addEventListener(event, callback); this.handlers.push(() => node?.removeEventListener(event, callback)); }
  duration() { return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450; }
  visible(layers, on) { for (const layer of layers) if (this.map.getLayer(layer)) this.map.setLayoutProperty(layer, "visibility", on ? "visible" : "none"); }
  updateMapState() {
    if (this.disposed) return;
    $("map-state").classList.toggle("warn", !!(this.tileFailed || this.buildingFailed));
    $("map-state").textContent = `${this.buildings ? `${this.buildings}栋建筑轮廓 · 高度含估计值` : (this.buildingFailed ? "建筑资料暂不可用" : "正在读取建筑资料")}${this.tileFailed ? " · 影像底图暂缺，保留空间矢量" : ""}`;
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
    if (lng < 113.4 || lng > 113.9 || lat < 34.6 || lat > 34.95) { $("picked-description").textContent = "当前方案登记范围为郑州城区，请返回区域后选点。"; return; }
    this.point = { longitude: Number(lng.toFixed(6)), latitude: Number(lat.toFixed(6)) };
    this.marker?.remove(); this.marker = new maplibregl.Marker({ color: "#147858" }).setLngLat([lng, lat]).addTo(this.map);
    $("picked-location").textContent = `${n(lng, 6)}°E / ${n(lat, 6)}°N`;
    const queryLayers = ["campus-building", "plan-areas", "weather-grid-point"].filter((id) => this.map.getLayer(id));
    const feature = this.map.queryRenderedFeatures(event.point, { layers: queryLayers })[0];
    let description = "已选择研判位置；坐标来自地图点击，未作现场测量。";
    if (feature?.layer.id === "campus-building") {
      const p = feature.properties;
      description = `建筑轮廓 · ${p.name || "未命名建筑"} · 高度${p.height_m == null ? "缺失，按18米示意" : n(Number(p.height_m)) + "米（底图属性，未现场核验）"}`;
    } else if (feature?.layer.id === "plan-areas") description = `已有方案：${feature.properties.name}，用户输入的理想化范围。`;
    else if (feature?.layer.id === "weather-grid-point") description = "模型返回的网格中心，不是校园现场传感器。";
    $("picked-description").textContent = description;
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
  destroy() { this.disposed = true; this.abort.abort(); this.readyDone?.(); clearTimeout(this.readyTimer); this.resizeObserver?.disconnect(); this.handlers.forEach((remove) => remove()); window.removeEventListener("workspace:weather", this.weatherListener); this.popup?.remove(); this.marker?.remove(); this.map?.remove(); }
}
