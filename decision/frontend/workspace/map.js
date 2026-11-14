import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { $, escape as e, numeric as n, date, icon, icons, request } from "./ui.js";
import { isCompetition, anonymousText } from "./edition.js";
import { defaultBounds } from "./regional-state.js";
import bundledStreetStyle from './street-style.json';
import bundledStreetTiles from './street-tiles.json';
import { selectionData, selectionMarkup } from './grid-selection.js';

// MapLibre 6 resolves its worker relative to the bundle unless Vite emits it explicitly.
maplibregl.setWorkerUrl(mapWorkerUrl);

const empty = () => ({ type: "FeatureCollection", features: [] });
const osmCredit = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
async function streetStyle(signal) {
  let style;
  try{
    style = await request("https://tiles.openfreemap.org/styles/positron", { signal, timeoutMs: 5000, cache: "default" });
    if (!style.sources?.openmaptiles || !Array.isArray(style.layers)) throw new Error("anonymous street style invalid");
  }catch(error){if(signal.aborted)throw error;style=structuredClone(bundledStreetStyle);}
  if (!style.sources?.openmaptiles || !Array.isArray(style.layers)) throw new Error("anonymous street style invalid");
  let tiles = bundledStreetTiles;
  try {
    const metadata = await request('https://tiles.openfreemap.org/planet', { signal, timeoutMs: 3000, cache: 'default' });
    if (metadata.tiles?.length && metadata.tiles.every(url => typeof url === 'string' && url.startsWith('https://tiles.openfreemap.org/'))) tiles = metadata;
  } catch (error) { if (signal.aborted) throw error; }
  Object.assign(style.sources.openmaptiles, { tiles: tiles.tiles, minzoom: tiles.minzoom ?? 0, maxzoom: tiles.maxzoom ?? 14 });
  delete style.sources.openmaptiles.url;
  style.sources.openmaptiles.attribution = osmCredit + ' · <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a>';
  if (style.sources.ne2_shaded) style.sources.ne2_shaded.attribution = "© Natural Earth";
  style.layers = style.layers.filter(layer => layer.type !== "symbol");
  // Anonymous streets use neither text nor sprites. External sprite/TileJSON
  // requests must not prevent locally hosted roads and buildings from mounting.
  for (const layer of style.layers) for (const key of Object.keys(layer.paint || {})) if (key.endsWith('-pattern')) delete layer.paint[key];
  delete style.sprite; delete style.glyphs;
  return style;
}
export class SpatialWorkspace {
  constructor({ observation, plans, onChoose, onRegion, sandboxState, dark = false, onState = () => {} }) {
    this.observation = observation;
    this.plans = plans;
    this.onChoose = onChoose;
    this.onRegion = onRegion;
    this.sandboxState = sandboxState;
    this.site = sandboxState?.site || 'campus';
    this.areaKind = this.site === 'campus' ? 'campus' : 'neighborhood';
    this.dark = dark; this.onState = onState;
    this.disposed = false;
    this.abort = new AbortController();
    this.handlers = [];
    this.tileFailed = false;
    this.tileErrors = new Set();
    this.basemap = 'streets';
    this.buildings = 0;
    this.point = null;
    this.interaction = "inspect";
    this.interactionRevision = 0;
    this.weatherListener = (event) => { this.observation = event.detail.observation; this.plans = event.detail.plans; this.updateWeather(); };
  }

  async init() {
    let style;
    try { style = await streetStyle(this.abort.signal); }
    catch (error) {
      if (this.abort.signal.aborted || this.disposed) return;
      console.warn("Street style unavailable:", error.message);
      style = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#e8eeeb" } }] };
      this.tileFailed = true;
    }
    if (this.disposed) return;
    this.streetRoadLayerIds = style.layers.filter(layer => layer.source === "openmaptiles" && ["transportation", "transportation_name"].includes(layer["source-layer"]) && layer.type !== "symbol").map(layer => layer.id);
    const initialBounds = defaultBounds(this.site);
    this.map = new maplibregl.Map({ container: "workspace-map", center: [(initialBounds.west+initialBounds.east)/2, (initialBounds.south+initialBounds.north)/2], zoom: this.dark ? 15 : 14.8, pitch: 54, bearing: -24, maxPitch: 70, attributionControl: false, canvasContextAttributes: { antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).get("capture") === "1" },
      style,
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    this.map.dragRotate.disable();this.map.boxZoom.disable();
    this.installCameraGesture();
    this.interactionNotice=document.createElement("div");this.interactionNotice.className="map-interaction";this.interactionNotice.hidden=true;
    this.interactionNotice.innerHTML='<span role="status" aria-live="polite"></span><button type="button" class="icon-button" data-interaction-editor aria-label="打开布局操作面板" title="打开布局操作面板" hidden>'+icon("sliders-horizontal")+'</button><button type="button" class="icon-button" data-interaction-cancel aria-label="取消当前地图操作" title="取消当前地图操作">'+icon("x")+'</button>';
    $("workspace-map").append(this.interactionNotice);icons();
    this.interactionNotice.addEventListener("click",event=>event.stopPropagation());
    this.interactionNotice.querySelector("[data-interaction-cancel]").addEventListener("click",()=>this.setInteraction("inspect"));
    this.interactionNotice.querySelector("[data-interaction-editor]").addEventListener("click",()=>this.sandbox?.setMobileOpen(true));
    this.map.on("error", (event) => {
      if (["openmaptiles", "ne2_shaded", "imagery", "verified-campus-imagery"].includes(event.sourceId)) { this.tileErrors.add(event.sourceId); this.syncBasemapFailure(); this.updateMapState(); }
    });
    this.map.on('sourcedata', event => {
      const baseSources = ["openmaptiles", "ne2_shaded", "imagery", "verified-campus-imagery"];
      if (baseSources.includes(event.sourceId) && event.sourceDataType==='content' && this.map.isSourceLoaded(event.sourceId) && this.tileErrors.has(event.sourceId)) {
        this.tileErrors.delete(event.sourceId); this.syncBasemapFailure(); this.updateMapState();
      }
    });
    await new Promise((resolve) => {
      const done = () => { clearTimeout(this.readyTimer); this.readyDone = null; resolve(); };
      this.readyDone = done;
      this.readyTimer = setTimeout(done, 6000);
      this.map.once("style.load", done);
      if (this.map.isStyleLoaded()) done();
    });
    if (this.disposed) return;
    if (!isCompetition) {
      this.map.addSource("imagery", { type: "raster", tileSize: 256, tiles: [`${location.origin}/tiles/world-imagery/{z}/{y}/{x}?v=2026r09`], maxzoom: 19, attribution: "Esri · Vantor / WV02 · 拍摄 2026-01-11 · 源分辨率 0.5m" });
      this.map.addLayer({ id: "imagery", type: "raster", source: "imagery", layout: { visibility: "none" }, paint: { "raster-opacity": 1, "raster-saturation": -0.15, "raster-brightness-max": this.dark ? 0.72 : 1 } });
      // Keep the verified campus imagery visible even when overview zooms select older mosaic levels.
      if (this.areaKind === 'campus') {
      this.map.addSource("verified-campus-imagery", { type: "image", url: `${import.meta.env.BASE_URL}campus-imagery-20260111.webp`, coordinates: [[113.521728515625,34.829586636768205],[113.5382080078125,34.829586636768205],[113.5382080078125,34.80703811152161],[113.521728515625,34.80703811152161]] });
      this.map.addLayer({ id: "verified-campus-imagery", type: "raster", source: "verified-campus-imagery", layout: { visibility: "none" }, paint: { "raster-opacity": 1, "raster-saturation": -0.15, "raster-brightness-max": this.dark ? 0.72 : 1, "raster-fade-duration": 0 } });
      }
    }
    this.map.addSource("campus-boundary", { type: "geojson", data: empty() });
    this.map.addLayer({ id: "campus-boundary-line", type: "line", source: "campus-boundary", paint: { "line-color": "#829ba6", "line-width": 1.5 } });
    this.loadStreets();
    this.loadLandcover();
    this.home();
    this.loadBoundary();
    this.map.addSource("weather-grid", { type: "geojson", data: empty() });
    this.map.addLayer({ id: "weather-grid-point", type: "circle", source: "weather-grid", paint: { "circle-radius": 10, "circle-color": "#f3ba50", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3, "circle-opacity": 0.95 } });
    this.map.addSource("plans", { type: "geojson", data: this.planFeatures() });
    this.map.addLayer({ id: "plan-areas", type: "fill", source: "plans", paint: { "fill-color": ["match", ["get", "intervention"], "greening", "#76be70", "cool_roof", "#9b92d0", "building", "#cb9572", "#e6bd58"], "fill-opacity": 0.7 } });
    this.map.addLayer({ id: "plan-outline", type: "line", source: "plans", paint: { "line-color": "#fff", "line-width": 2 } });
    this.map.addSource("regional-area", { type: "geojson", data: empty() });
    this.map.addLayer({ id: "regional-area-fill", type: "fill", source: "regional-area", paint: { "fill-color": "#5fbed0", "fill-opacity": 0.09 } });
    this.map.addLayer({ id: "regional-area-line", type: "line", source: "regional-area", paint: { "line-color": "#65d4dc", "line-width": 2, "line-dasharray": [3,2] } });
    this.map.addSource("regional-draft", { type: "geojson", data: empty() });
    this.map.addLayer({ id:"regional-draft-line", type:"line", source:"regional-draft", filter:["==",["geometry-type"],"Polygon"], paint:{"line-color":"#f9d169","line-width":2,"line-dasharray":[2,2]} });
    this.map.addLayer({ id:"regional-draft-point", type:"circle", source:"regional-draft", filter:["==",["geometry-type"],"Point"], paint:{"circle-radius":6,"circle-color":"#f9d169","circle-stroke-width":2,"circle-stroke-color":"#fff"} });
    this.map.addSource("regional-samples", { type: "geojson", data: empty() });
    this.map.addLayer({ id: "regional-sample-points", type: "circle", source: "regional-samples", paint: { "circle-radius": 7, "circle-color": ["match", ["get", "risk"], "danger", "#e47160", "extreme_danger", "#c14258", "extreme_caution", "#ecb761", "caution", "#d2cc7c", "below_range", "#8dc7b4", "#9ca8ab"], "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
    this.regionKeyHandler = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (this.interaction !== "inspect" || this.sandbox?.selected || this.sandbox?.point) this.setInteraction("inspect");
      this.sandbox?.setMobileOpen(false);
    };
    document.addEventListener("keydown", this.regionKeyHandler);
    for (const id of ["map-imagery", "map-streets"]) { const button = $(id); if (button) { button.setAttribute("aria-pressed", String(id === "map-streets")); button.title = button.ariaLabel = id === "map-imagery" ? (isCompetition ? "无地名建筑简图" : "校园实景影像") : "无地名矢量街道与地表"; button.innerHTML = icon(id === "map-imagery" ? "image" : "map"); } }icons();
    this.map.on("click", (event) => this.pick(event));
    this.map.on("moveend", () => { if (!this.disposed) {$("map-pitch")?.setAttribute("aria-pressed", String(this.map.getPitch() >= 20));$("workspace-map").dataset.viewBearing=String(this.map.getBearing());$("workspace-map").dataset.viewPitch=String(this.map.getPitch());} });
    this.map.on("mousemove", (event) => { if (!this.disposed) { $("map-coordinate").textContent = `${n(event.lngLat.lng, 5)}°E / ${n(event.lngLat.lat, 5)}°N`; this.previewRegion(event.lngLat); } });
    this.resizeObserver = new ResizeObserver(() => { if (!this.disposed) this.map.resize(); });
    this.resizeObserver.observe($("workspace-map"));
    this.bind("map-home", "click", () => { this.setInteraction("inspect"); this.home(); });
    if($("map-home"))$("map-home").title=$("map-home").ariaLabel=this.areaKind==='campus'?'回到校园全景':'回到街区全景';
    this.bind("map-grid", "click", () => { this.setInteraction("inspect"); if (this.observation) this.map.easeTo({ center: [this.observation.location.longitude, this.observation.location.latitude], zoom: 13.5, duration: this.duration() }); });
    this.bind("map-pitch", "click", () => { this.stopOrbit(); const next = this.map.getPitch() < 20; this.map.easeTo({ pitch: next ? 48 : 0, bearing: next ? -16 : 0, duration: this.duration() }); $("map-pitch").setAttribute("aria-pressed", String(next)); });
    this.bind("layer-buildings", "change", (event) => this.setBuildings(event.target.checked));
    this.bind("layer-grid", "change", (event) => this.visible(["weather-grid-point"], event.target.checked));
    this.bind("layer-plans", "change", (event) => this.visible(["plan-areas", "plan-outline"], event.target.checked));
    this.bind("use-location", "click", () => { if (this.point) this.onChoose(this.point); });
    this.bind("map-imagery", "click", () => this.setBasemap("imagery"));
    this.bind("map-streets", "click", () => this.setBasemap("streets"));
    this.bind("map-orbit", "click", () => this.orbiting ? this.stopOrbit() : this.startOrbit());
    this.bind("map-light", "input", (event) => this.modelLayer?.setLighting(event.target.value));
    this.map.on("dragstart", () => this.stopOrbit());
    this.map.on("zoomstart", () => this.stopOrbit());
    this.map.getCanvas().addEventListener("wheel",()=>this.stopOrbit(),{passive:true,signal:this.abort.signal});
    this.map.on("movestart", (event) => { if (event.originalEvent) this.stopOrbit(); });
    this.visibilityHandler = () => { if (document.hidden) this.stopOrbit(); };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    window.addEventListener("workspace:weather", this.weatherListener);
    this.syncInteraction(); this.updateWeather();
    await this.loadBuildings();
    this.ready=true;
  }

  loadBoundary() {
    if(this.disposed)return Promise.resolve();
    if(this.boundaryTask)return this.boundaryTask;
    this.boundaryTask=this.fetchBoundary().finally(()=>{this.boundaryTask=null;});
    return this.boundaryTask;
  }
  async fetchBoundary() {
    try {
      const data=await request('/api/weather/sandbox/boundary?area_kind='+this.areaKind+'&v=district-footprints-2',{signal:this.abort.signal});
      if(this.disposed)return;
      this.boundary=data;this.boundaryFailed=false;this.map.getSource('campus-boundary')?.setData(data);this.updateMapState();
    }catch{if(!this.disposed){this.boundaryFailed=true;this.updateMapState();}}
  }
  loadBuildings() {
    if(this.disposed||this.sandbox)return Promise.resolve();
    if(this.buildingTask)return this.buildingTask;
    this.buildingTask=this.fetchBuildings().finally(()=>{this.buildingTask=null;});
    return this.buildingTask;
  }
  async fetchBuildings() {
    try {
      const data = this.buildingData || await request('/api/weather/sandbox/buildings?area_kind='+this.areaKind+'&v=district-footprints-2',{signal:this.abort.signal,timeoutMs:25000});
      if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("invalid GeoJSON");
      if (this.disposed) return;
      this.buildings = data.features.length;
      this.buildingData = data;
      this.buildingFailed=false;
      if(!this.map.getSource('campus-buildings')){
      this.map.addSource("campus-buildings", { type: "geojson", data, ...(this.map.getSource("openmaptiles") ? {} : { attribution: osmCredit }) });
      this.map.addLayer({ id: "campus-picking", type: "fill", source: "campus-buildings", paint: { "fill-color": "#a1d4b7", "fill-opacity": 0.01 } }, "weather-grid-point");
      this.map.addLayer({ id: "campus-building", type: "fill-extrusion", source: "campus-buildings", paint: { "fill-extrusion-color": "#e2e7e8", "fill-extrusion-height": ["case", [">", ["coalesce", ["to-number", ["get", "height_m"]], 0], 0], ["to-number", ["get", "height_m"]], 18], "fill-extrusion-opacity": 0.95, "fill-extrusion-base": 0 } }, "weather-grid-point");
      this.map.addLayer({ id: "campus-outline", type: "line", source: "campus-buildings", paint: { "line-color": "#829ba6", "line-width": 0.6, "line-opacity": 0.55 } }, "weather-grid-point");
      this.map.setFilter("campus-building", ["!=", ["get", "state"], "new"]);
      }
      this.setBuildings($("layer-buildings").checked);
      this.updateMapState();
      try { if(!this.modelLayer){
        const { createBuildingLayer } = await import("./buildings3d.js");
        if (this.disposed) return;
        this.modelLayer = createBuildingLayer(data, { dark: this.dark, onError: () => { this.modelFailed = true; this.map.setPaintProperty("campus-building", "fill-extrusion-opacity", 0.95); this.updateMapState(); } });
        this.map.addLayer(this.modelLayer, "weather-grid-point");
        if (!this.modelFailed) this.map.setPaintProperty("campus-building", "fill-extrusion-opacity", 0);
        this.setBuildings($("layer-buildings").checked);
        this.updateMapState();
      }} catch { this.modelFailed = true; this.updateMapState(); }
      if (this.sandboxState && !this.disposed) {
        const { LayoutSandbox } = await import("./sandbox.js");
        if (!this.disposed) { this.sandbox = new LayoutSandbox(this, this.sandboxState); this.sandbox.mount(); }
      }
    } catch { if (!this.disposed) { this.buildingFailed = true; this.updateMapState(); } }
  }

  refresh() {
    if(this.disposed||!this.ready)return Promise.resolve();
    if(this.refreshTask)return this.refreshTask;
    this.refreshTask=this.refreshMap().finally(()=>{this.refreshTask=null;});
    return this.refreshTask;
  }
  async refreshMap() {
    if(!this.map.getSource('openmaptiles')){
      try{
        const style=await streetStyle(this.abort.signal);if(this.disposed)return;
        for(const [id,source]of Object.entries(style.sources))if(!this.map.getSource(id))this.map.addSource(id,source);
        for(const layer of style.layers)if(layer.type!=='background'&&!this.map.getLayer(layer.id))this.map.addLayer(layer,this.map.getLayer('imagery')?'imagery':'campus-boundary-line');
        this.streetRoadLayerIds=style.layers.filter(layer=>layer.source==='openmaptiles'&&['transportation','transportation_name'].includes(layer['source-layer'])).map(layer=>layer.id);
        for(const id of this.streetRoadLayerIds)this.map.setLayoutProperty(id,'visibility',this.basemap==='streets'?'visible':'none');
      }catch{if(!this.disposed)this.tileFailed=true;}
    }
    if(this.disposed)return;
    for(const id of ['openmaptiles','ne2_shaded','imagery']){
      const source=this.map.getSource(id);if(!source)continue;
      if(this.tileErrors.has(id)&&source.url&&source.setUrl)source.setUrl(source.url);
      else this.map.refreshTiles(id);
    }
    const tasks=[];
    if(!this.boundary||this.boundaryFailed)tasks.push(this.loadBoundary());
    if(!this.streetRoads)tasks.push(this.loadStreets());
    if(!this.landcoverCount)tasks.push(this.loadLandcover());
    if(!this.sandbox)tasks.push(this.loadBuildings());else tasks.push(this.sandbox.refreshHeat());
    await Promise.allSettled(tasks);
    if(!this.disposed){this.syncBasemapFailure();this.updateMapState();}
  }

  home() {
    const b=defaultBounds(this.site);
    if($("map-coordinate"))$("map-coordinate").textContent=`${n((b.west+b.east)/2,5)}°E / ${n((b.south+b.north)/2,5)}°N`;
    this.focusBounds(b);
  }
  focusBounds(bounds, duration=this.duration()) {
    const padding=this.cameraPadding(),bearing=-55,pitch=50;
    const camera=this.map.cameraForBounds([[bounds.west,bounds.south],[bounds.east,bounds.north]],{padding,bearing,maxZoom:17});
    if(!camera)return;
    // Fit the oblique ground plane rather than leaving a flat-map extent around it.
    this.map.easeTo({...camera,zoom:Math.min(17,camera.zoom+1.3),padding,pitch,bearing,duration});
  }
  cameraPadding() {
    const screen=document.getElementById('decision-screen');
    if(!screen)return {top:45,bottom:150,left:35,right:35};
    if(screen.clientWidth<=1100)return {top:35,bottom:165,left:28,right:28};
    const style=getComputedStyle(screen);
    return {top:20,bottom:70,left:parseFloat(style.getPropertyValue('--dock-left'))+16,right:parseFloat(style.getPropertyValue('--dock-right'))+16};
  }
  bind(id, event, callback) { const node = $(id); node?.addEventListener(event, callback); this.handlers.push(() => node?.removeEventListener(event, callback)); }
  duration() { return matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450; }
  setBuildings(on) {
    if (!on && ["select","add","move","remove"].includes(this.interaction)) this.setInteraction("inspect");
    if (!on) this.sandbox?.select(null);
    this.visible(["campus-building", "campus-outline", "campus-picking", "sandbox-proposed-fill", "sandbox-ghost-fill", "sandbox-preview-fill", "sandbox-selection-outline"], on);
    if (this.modelLayer) this.modelLayer.visible = on;
    this.map.triggerRepaint();
  }
  setBasemap(name) {
    if (!['imagery','streets'].includes(name)) return;
    this.basemap = name;
    this.syncBasemapFailure();
    for (const id of this.streetRoadLayerIds || []) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', name === 'streets' ? 'visible' : 'none');
    this.visible(["imagery", "verified-campus-imagery"], name === "imagery");
    this.visible(['campus-road-casing','campus-road-line'], name === 'streets');
    this.visible(['campus-landcover-fill'], name === 'streets');
    for (const key of ["imagery", "streets"]) $("map-" + key)?.setAttribute("aria-pressed", String(key === name));
    this.updateMapState();
  }
  syncBasemapFailure() {
    const vectorRequired = isCompetition || this.basemap === 'streets';
    const sources = vectorRequired ? ['openmaptiles','ne2_shaded'] : ['imagery','verified-campus-imagery'];
    this.tileFailed = (vectorRequired && !this.map.getSource('openmaptiles')) || sources.some(id => this.tileErrors.has(id));
  }
  loadStreets() {
    if(this.disposed||this.streetRoads)return Promise.resolve();
    if(this.streetTask)return this.streetTask;
    this.streetTask=this.fetchStreets().finally(()=>{this.streetTask=null;});
    return this.streetTask;
  }
  async fetchStreets() {
    try {
      const data=await request(`${import.meta.env.BASE_URL}data/${this.areaKind === 'campus' ? 'campus' : 'neighborhood'}-streets.geojson`,{signal:this.abort.signal,cache:'default'});
      if(data.type!=='FeatureCollection'||!data.features?.length)throw new Error('road geometry');
      if(this.disposed)return;
      // Display geometry only: raster labels cannot be reliably anonymized.
      const anonymous={type:'FeatureCollection',features:data.features.map(f=>({type:'Feature',geometry:f.geometry,properties:{}}))};
      this.map.addSource('campus-roads',{type:'geojson',data:anonymous});
      const width=['interpolate',['linear'],['zoom'],13,0.5,16,3,19,9];
      const layout={visibility:this.basemap==='streets'?'visible':'none','line-cap':'round','line-join':'round'};
      this.map.addLayer({id:'campus-road-casing',type:'line',source:'campus-roads',layout,paint:{'line-color':'#b7c3c8','line-width':width,'line-gap-width':1.5,'line-opacity':0.8}},'campus-boundary-line');
      this.map.addLayer({id:'campus-road-line',type:'line',source:'campus-roads',layout,paint:{'line-color':'#fafbfa','line-width':width}},'campus-boundary-line');
      this.streetRoads=data.features.length;this.streetsFailed=false;
      this.updateMapState();
    } catch (error) {
      if(!this.disposed){console.warn('Campus road layer unavailable:',error.message);this.streetsFailed=true;this.updateMapState();}
    }
  }
  loadLandcover() {
    if(this.disposed||this.landcoverCount)return Promise.resolve();
    if(this.landcoverTask)return this.landcoverTask;
    this.landcoverTask=this.fetchLandcover().finally(()=>{this.landcoverTask=null;});
    return this.landcoverTask;
  }
  async fetchLandcover() {
    try {
      const data=await request(`${import.meta.env.BASE_URL}data/${this.areaKind === 'campus' ? 'campus-lcz-simulation' : 'neighborhood-landcover'}.geojson`,{signal:this.abort.signal,cache:'no-cache'});
      if(data.type!=='FeatureCollection'||!data.features?.length)throw new Error('landcover geometry');
      if(this.disposed)return;
      const anonymous={type:'FeatureCollection',features:data.features.map(f=>({type:'Feature',geometry:f.geometry,properties:{lcz:f.properties.lcz,kind:f.properties.kind}}))};
      this.map.addSource('campus-landcover',{type:'geojson',data:anonymous});
      this.map.addLayer({id:'campus-landcover-fill',type:'fill',source:'campus-landcover',layout:{visibility:this.basemap==='streets'?'visible':'none'},paint:{'fill-color':this.areaKind === 'neighborhood' ? ['match',['get','kind'],'water','#b9d4e0','green','#c6d4c2','#e4e9e7'] : ['match',['get','lcz'],2,'#e5e8e8',5,'#e4e8e5',8,'#e0e5e6',9,'#e4e9de',11,'#b9cdbb',12,'#c6d4c2',13,'#d1dccb',14,'#dae2d1',15,'#e5e8e9',17,'#b9d4e0','#e4e9e7'],'fill-opacity':0.8}},this.map.getLayer('campus-road-casing')?'campus-road-casing':'campus-boundary-line');
      this.landcoverCount=anonymous.features.length;this.landcoverFailed=false;this.updateMapState();
    } catch(error) { if(!this.disposed&&!this.abort.signal.aborted){this.landcoverFailed=true;this.updateMapState();} }
  }
  startOrbit() {
    if (this.disposed || this.orbiting || document.hidden) return;
    if (!this.duration()) { this.syncInteraction(); return; }
    this.setInteraction("orbit");
    let previous = performance.now();
    const tick = (now) => {
      if (!this.orbiting || this.disposed || document.hidden) { this.stopOrbit(); return; }
      const delta = Math.min(now - previous, 100);
      if (delta >= 32) { this.map.setBearing(this.map.getBearing() + delta * 0.0025); previous = now; }
      this.orbitFrame = requestAnimationFrame(tick);
    };
    this.orbitFrame = requestAnimationFrame(tick);
  }
  get selectingRegion() { return this.interaction === "region"; }
  get orbiting() { return this.interaction === "orbit"; }
  stopOrbit() {
    cancelAnimationFrame(this.orbitFrame); this.orbitFrame = null;
    if (this.orbiting) this.setInteraction("inspect");
    else if (!this.disposed) this.syncInteraction();
  }
  setInteraction(mode) {
    if (this.disposed || !["inspect", "select", "region", "orbit", "camera", "add", "move", "remove"].includes(mode)) return;
    cancelAnimationFrame(this.orbitFrame); this.orbitFrame = null;
    this.interaction = mode; this.interactionRevision++; this.regionFirst = null; this.map.stop(); this.popup?.remove(); this.clearSelection();
    if(mode!=='inspect')this.sandbox?.collection?.pause();
    if(["select","region","add","move","remove"].includes(mode))this.map.doubleClickZoom.disable();else this.map.doubleClickZoom.enable();
    if(mode!=="inspect"){
      this.marker?.remove();this.marker=null;this.point=null;
      $("use-location").disabled=true;$("picked-location").textContent="尚未标记地点";
    }
    this.map.getSource("regional-draft")?.setData(empty());
    if (this.sandbox) {
      this.sandbox.geometryController?.abort();
      this.sandbox.select(null); this.sandbox.controls();
      this.sandbox.setMobileOpen(false);
    }
    this.cameraDrag=null;if(mode==='camera')this.map.dragPan.disable();else this.map.dragPan.enable();
    this.syncInteraction(); this.updateMapState();
  }
  installCameraGesture(){
    const canvas=this.map.getCanvas(),signal=this.abort.signal;
    const button=document.createElement('button');button.type='button';button.className='icon-button';button.id='map-rotate';button.title=button.ariaLabel='旋转视角';button.setAttribute('aria-pressed','false');button.innerHTML=icon('compass');
    document.getElementById('map-orbit')?.insertAdjacentElement('afterend',button);
    button.addEventListener('click',()=>this.setInteraction(this.interaction==='camera'?'inspect':'camera'),{signal});
    this.handlers.push(()=>button.remove());
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.interaction!=='camera')return;
      event.preventDefault();event.stopImmediatePropagation();canvas.setPointerCapture(event.pointerId);
      this.cameraDrag={id:event.pointerId,x:event.clientX,y:event.clientY,bearing:this.map.getBearing(),pitch:this.map.getPitch()};
    },{capture:true,signal});
    canvas.addEventListener('pointermove',event=>{
      const d=this.cameraDrag;if(!d||d.id!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();
      this.map.jumpTo({bearing:d.bearing+(event.clientX-d.x)*0.35,pitch:Math.max(0,Math.min(70,d.pitch-(event.clientY-d.y)*0.25))});
    },{capture:true,signal});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{
      if(this.cameraDrag?.id!==event.pointerId)return;this.cameraDrag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);event.stopImmediatePropagation();
    },{capture:true,signal});
    canvas.addEventListener('click',event=>{if(this.interaction==='camera'){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal});
    window.addEventListener('blur',()=>{this.cameraDrag=null;},{signal});
  }
  syncInteraction() {
    const orbit = $("map-orbit"), region = $("screen-select-region"), canvas = this.map.getCanvas();
    if (orbit) {
      const active = this.orbiting, changed = orbit.dataset.running !== String(active);
      orbit.setAttribute("aria-pressed", String(active)); orbit.dataset.running = String(active);
      orbit.title = orbit.ariaLabel = active ? "暂停自动旋转" : "开启自动旋转";
      if (changed) { orbit.innerHTML = icon(active ? "pause" : "play"); icons(); }
    }
    if (region) {
      region.setAttribute("aria-pressed", String(this.selectingRegion));
      region.title = region.ariaLabel = this.selectingRegion ? "取消地图选区" : "地图选区";
    }
    $("workspace-map").dataset.interaction = this.interaction;
    const rotate=$("map-rotate");if(rotate)rotate.setAttribute('aria-pressed',String(this.interaction==='camera'));
    canvas.style.cursor = this.interaction==='camera'?'grab':["region", "add", "move"].includes(this.interaction) ? "crosshair" : "";
    if(this.interactionNotice){
      const labels={select:this.sandbox?.selected?"选择建筑 · 已选中":"选择建筑 · 点击建筑查看或修改",region:this.regionFirst?"框选区域 · 已选第一角点":"框选区域 · 待选两个角点",add:this.sandbox?.point?"建造模式 · 位置已选，未提交":"建造模式 · 待选位置",move:this.sandbox?.point?"移动模式 · 目标已选，未提交":this.sandbox?.selected?"移动模式 · 待选目标位置":"移动模式 · 待选拟建建筑",remove:this.sandbox?.selected?"拟拆除模式 · 建筑已选，未提交":"拟拆除模式 · 待选建筑",orbit:"自动旋转中"};
      this.interactionNotice.hidden=this.interaction==="inspect";
      const label=this.interaction==='camera'?'视角旋转':labels[this.interaction]||"";
      if(this.interactionNotice.firstElementChild.textContent!==label)this.interactionNotice.firstElementChild.textContent=label;
      this.interactionNotice.querySelector("[data-interaction-editor]").hidden=!this.sandbox?.mobileToggle||!["select","add","move","remove"].includes(this.interaction);
    }
    if ($("screen-region-state") && !this.selectingRegion && this.sandbox?.bounds) {
      const b=this.sandbox.bounds;
      $("screen-region-state").textContent=`选区 ${n(b.west,3)}–${n(b.east,3)}°E / ${n(b.south,3)}–${n(b.north,3)}°N`;
    }
  }
  visible(layers, on) { for (const layer of layers) if (this.map.getLayer(layer)) this.map.setLayoutProperty(layer, "visibility", on ? "visible" : "none"); }
  updateMapState() {
    if (this.disposed) return;
    const streetNote=this.basemap==='streets'?`${isCompetition?'匿名矢量街道':'无地名矢量街道'} · ${this.streetRoads?`${this.streetRoads}条道路 · `:this.streetsFailed?'道路暂不可用 · ':'道路读取中 · '}`:'';
    $("map-state").classList.toggle("warn", !!(this.tileFailed || this.buildingFailed || this.modelFailed));
    $("map-state").textContent = `${this.selectingRegion ? "选区中 · " : ""}${streetNote || (isCompetition ? "匿名建筑简图 · " : this.areaKind === 'campus' ? "影像拍摄 2026-01-11 · " : "街区影像 · ")}${this.boundaryFailed ? "边界暂不可用 · " : this.areaKind === 'campus' ? "校园范围 · " : "街区模型范围 · "}${this.buildings ? `${this.buildings}栋建筑` : (this.buildingFailed ? "建筑暂不可用" : "正在读取建筑")}${this.tileFailed ? " · 部分瓦片不可用" : ""}${this.modelFailed ? " · 基础体块模式" : ""}`;
    if(this.areaKind==='neighborhood')$("map-state").textContent+=' · 模拟高度';
    $("workspace-map").dataset.areaKind=this.areaKind;
    $("workspace-map").dataset.basemap=this.basemap;
    $("workspace-map").dataset.streetRoads=String(this.streetRoads||0);
    $("workspace-map").dataset.landcover=String(this.landcoverCount||0);
    $("workspace-map").dataset.vectorStreets=String(!!this.map.getSource('openmaptiles'));
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
    if (this.orbiting) { this.stopOrbit(); return; }
    const { lng, lat } = event.lngLat;
    if (this.selectingRegion) {
      if (lng < 113.4 || lng > 113.9 || lat < 34.6 || lat > 34.95) { toastRegion("选区超出当前资料支持范围，请返回区域后选择。"); return; }
      if (!this.regionFirst) { this.regionFirst = [lng, lat]; this.previewRegion(event.lngLat); this.syncInteraction(); $("map-state").textContent = "已选择第一个角点，请点击对角点。Esc取消"; if($("screen-region-state")) $("screen-region-state").textContent="已选择第一个角点，请点击对角点；Esc 取消。"; return; }
      const [lon0, lat0] = this.regionFirst;
      const bounds = { west: Number(Math.min(lng,lon0).toFixed(6)), east: Number(Math.max(lng,lon0).toFixed(6)), south: Number(Math.min(lat,lat0).toFixed(6)), north: Number(Math.max(lat,lat0).toFixed(6)) };
      if (bounds.east-bounds.west < 0.0001 || bounds.north-bounds.south < 0.0001 || bounds.east-bounds.west > 0.1 || bounds.north-bounds.south > 0.1) { const message="矩形范围需有面积且经纬跨度不超过0.1度；重新选择两个角点。"; $("map-state").textContent=message; if($("screen-region-state")) $("screen-region-state").textContent=message; this.regionFirst=null; this.map.getSource("regional-draft").setData(empty()); this.syncInteraction(); return; }
      this.setInteraction("inspect"); if(this.onRegion)this.onRegion(bounds);else this.setRegion(bounds); return;
    }
    if (this.sandbox?.pick(event)) return;
    if (lng < 113.4 || lng > 113.9 || lat < 34.6 || lat > 34.95) { $("picked-description").textContent = anonymousText("当前方案登记范围为郑州城区，请返回区域后选点。"); return; }
    this.point = { longitude: Number(lng.toFixed(6)), latitude: Number(lat.toFixed(6)) };
    const marker = document.createElement('span'); marker.className = 'selection-map-marker';
    this.marker?.remove(); this.marker = new maplibregl.Marker({ element: marker }).setLngLat([lng, lat]).addTo(this.map);
    $("picked-location").textContent = `${n(lng, 6)}°E / ${n(lat, 6)}°N`;
    const queryLayers = ["plan-areas", "weather-grid-point"].filter((id) => this.map.getLayer(id));
    const features = this.map.queryRenderedFeatures(event.point, { layers: queryLayers });
    const feature = features.find((item) => item.layer.id === "weather-grid-point") || features.find((item) => item.layer.id === "plan-areas") || features[0];
    let description = "已选择研判位置；坐标来自地图点击，未作现场测量。";
    if (feature?.layer.id === "plan-areas") description = `已有方案：${feature.properties.name}，用户输入的理想化范围。`;
    else if (feature?.layer.id === "weather-grid-point") description = "模型返回的网格中心，不是校园现场传感器。";
    const cell=this.sandbox?.$('sb-cell');if(cell&&!cell.hidden)description+=' '+cell.textContent;
    $("picked-description").textContent = anonymousText(description);
    this.modelLayer?.select(null);
    $("use-location").disabled = false;
    this.popup?.remove();
    const hit = this.sandbox?.pickedCell;
    const picked = hit && this.sandbox.displayCells?.find(f => hit.properties.grid_id ? f.properties.grid_id === hit.properties.grid_id : String(f.id) === String(hit.id));
    this.selection = { point: this.point, cellId: picked?.id, geometry: picked ? JSON.stringify(picked.geometry) : null };
    this.popup = new maplibregl.Popup({ offset: 16, maxWidth: '330px', className: 'grid-selection-popup', closeOnClick: false, focusAfterOpen: false })
      .setLngLat([lng, lat]).setHTML('').addTo(this.map);
    this.popup.on('close', () => this.clearSelection());
    this.refreshSelection();
  }
  clearSelection() {
    this.selection = null;
    window.dispatchEvent(new CustomEvent('workspace:selection', { detail: null }));
  }
  refreshSelection() {
    if (!this.selection || !this.popup?.isOpen()) return;
    const cell = this.sandbox?.displayCells?.find(f => f.id === this.selection.cellId && JSON.stringify(f.geometry) === this.selection.geometry);
    const data = selectionData(cell, this.sandbox, this.selection.point);
    this.popup.setHTML(selectionMarkup(data));
    window.dispatchEvent(new CustomEvent('workspace:selection', { detail: data }));
  }
  planFeatures() {
    return { type: "FeatureCollection", features: this.plans.map((plan) => {
      const p = plan.input, half = Math.sqrt(p.area_m2) / 2;
      const dx = half / (111320 * Math.cos(p.latitude * Math.PI / 180)), dy = half / 111320;
      return { type: "Feature", properties: { name: p.name, intervention: p.intervention }, geometry: { type: "Polygon", coordinates: [[[p.longitude-dx,p.latitude-dy],[p.longitude+dx,p.latitude-dy],[p.longitude+dx,p.latitude+dy],[p.longitude-dx,p.latitude+dy],[p.longitude-dx,p.latitude-dy]]] } };
    }) };
  }
  beginRegion() {
    this.setInteraction(this.selectingRegion ? "inspect" : "region");
    if (this.selectingRegion && $("screen-region-state")) $("screen-region-state").textContent="请依次点击矩形的两个对角点；再次点击选区按钮或 Esc 取消。";
  }
  previewRegion(point) {
    if (!this.selectingRegion || !this.regionFirst) return;
    const [x,y]=this.regionFirst, {lng,lat}=point;
    this.map.getSource("regional-draft")?.setData({type:"FeatureCollection",features:[
      {type:"Feature",properties:{},geometry:{type:"Point",coordinates:[x,y]}},
      {type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[[[x,y],[lng,y],[lng,lat],[x,lat],[x,y]]]}},
    ]});
  }
  setRegion(bounds, report=null) {
    if (this.disposed || !this.map?.getSource("regional-area")) return;
    this.sandbox?.setBounds(bounds);
    const key=JSON.stringify([bounds,report?.area?.geometry,report?.snapshot_sha256||report?.samples]);
    if(key===this.regionDataKey)return;
    this.regionDataKey=key;
    const {west:w,east:e,south:s,north:n}=bounds;
    const geometry=report?.area?.geometry||{type:"Polygon",coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]};
    this.map.getSource("regional-area").setData({type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry}]});
    const seen=new Set();
    const features=(report?.data_mode==='lcz_simulation'?[]:report?.samples||[]).flatMap(sample=>{const o=sample.observation;if(!o)return [];const key=`${o.location.longitude}/${o.location.latitude}`;if(seen.has(key))return [];seen.add(key);return [{type:"Feature",geometry:{type:"Point",coordinates:[o.location.longitude,o.location.latitude]},properties:{risk:sample.environment.risk,sample:sample.id}}];});
    this.map.getSource("regional-samples").setData({type:"FeatureCollection",features});
  }
  destroy() { this.disposed = true; this.sandbox?.destroy(); this.stopOrbit(); this.abort.abort(); this.readyDone?.(); clearTimeout(this.readyTimer); this.resizeObserver?.disconnect(); this.handlers.forEach((remove) => remove()); window.removeEventListener("workspace:weather", this.weatherListener); document.removeEventListener("visibilitychange", this.visibilityHandler); document.removeEventListener("keydown", this.regionKeyHandler); this.interactionNotice?.remove(); this.popup?.remove(); this.marker?.remove(); this.map?.remove(); }
}
function toastRegion(message) { $("map-state").textContent=message; }
