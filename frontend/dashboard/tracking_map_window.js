/**
 * 微境智护 — 目标监控窗口（纯 Canvas 2D 地图）
 * 使用高德地图瓦片 + Canvas 渲染，无 Cesium 依赖
 *
 * 后续接入真实 GPS 设备：替换 fetchTrackingData() 函数即可
 */

const POLL_INTERVAL_MS = 3000;
const WINDOW_ID = "tracking-map-window";

// ─── 高德地图 Web 瓦片（GCJ-02 坐标系）───────────────────────────────
const AMAP_SUBDOMAINS = ["1", "2", "3", "4"];

function _getTileUrl(z, x, y) {
  const s = AMAP_SUBDOMAINS[(x + y) % AMAP_SUBDOMAINS.length];
  return `https://webst0${s}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`;
}

// style=8: 矢量电子地图
// style=6: 卫星图（含注记）
// style=0: 矢量路网（底色白）

// ─── WGS-84 → GCJ-02 坐标转换（高德地图使用 GCJ-02）────────────────
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function _transformWGS2GCJ(lon, lat) {
  let dLat = _transformLat(lon - 105.0, lat - 35.0);
  let dLon = _transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLon = (dLon * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return { lon: lon + dLon, lat: lat + dLat };
}

function _transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y;
  ret += 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function _transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

function toGCJ(lon, lat) {
  if (_outOfChina(lon, lat)) return { lon, lat };
  return _transformWGS2GCJ(lon, lat);
}

function _outOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

// ─── GCJ-02 经纬度 → Web Mercator 投影像素坐标 ──────────────────────
function lonLatToPixel(lon, lat, zoom) {
  const gcj = toGCJ(lon, lat);
  const x = ((gcj.lon + 180) / 360) * (1 << zoom) * 256;
  const sinLat = Math.sin((gcj.lat * PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * PI)) * (1 << zoom) * 256;
  return { x, y };
}

function pixelToLonLat(px, py, zoom) {
  const n = 1 << zoom;
  const lon = (px / 256 / n) * 360 - 180;
  const sinLat = Math.sin(Math.PI * (0.5 - (2 * py) / 256 / n));
  const lat = (Math.atan(Math.sinh(Math.PI * sinLat)) * 180) / Math.PI;
  const untransformed = { lon, lat };
  return untransformed;
}

// ─── 预设巡航路径 ─────────────────────────────────────────────────────
const CRUISE_PATHS = {
  drone_001: {
    name: "巡检无人机-01", type: "drone",
    altitude: 80, speed: 8.5,
    path: [
      { lon: 113.531, lat: 34.815 }, { lon: 113.534, lat: 34.816 },
      { lon: 113.536, lat: 34.814 }, { lon: 113.535, lat: 34.812 },
      { lon: 113.533, lat: 34.811 }, { lon: 113.530, lat: 34.813 },
    ],
  },
  drone_002: {
    name: "巡检无人机-02", type: "drone",
    altitude: 120, speed: 6.2,
    path: [
      { lon: 113.529, lat: 34.817 }, { lon: 113.531, lat: 34.819 },
      { lon: 113.533, lat: 34.818 }, { lon: 113.532, lat: 34.816 },
    ],
  },
  drone_003: {
    name: "环境监测无人机", type: "drone",
    altitude: 60, speed: 5.0,
    path: [
      { lon: 113.527, lat: 34.814 }, { lon: 113.529, lat: 34.812 },
      { lon: 113.531, lat: 34.813 }, { lon: 113.532, lat: 34.816 },
      { lon: 113.530, lat: 34.817 }, { lon: 113.528, lat: 34.815 },
    ],
  },
  car_001: {
    name: "巡逻小车-01", type: "car",
    altitude: 0, speed: 3.2,
    path: [
      { lon: 113.530, lat: 34.814 }, { lon: 113.532, lat: 34.815 },
      { lon: 113.534, lat: 34.813 }, { lon: 113.533, lat: 34.811 },
      { lon: 113.531, lat: 34.812 }, { lon: 113.529, lat: 34.813 },
    ],
  },
  car_002: {
    name: "物资运输车", type: "car",
    altitude: 0, speed: 2.8,
    path: [
      { lon: 113.535, lat: 34.816 }, { lon: 113.536, lat: 34.814 },
      { lon: 113.534, lat: 34.812 }, { lon: 113.532, lat: 34.813 },
      { lon: 113.531, lat: 34.815 }, { lon: 113.533, lat: 34.817 },
    ],
  },
};

// ─── GPS 数据源接口 ──────────────────────────────────────────────────
/**
 * 获取追踪数据。
 * 真实接入时替换此函数，直接返回实体数组：
 * [{ id, name, type, lon, lat, altitude, heading, speed, status, timestamp, trajectory }]
 */
async function fetchTrackingData() {
  try {
    const res = await fetch("/api/tracking/positions");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.success) return json.entities;
  } catch (e) {
    console.warn("[TrackingMap] API unavailable, using local simulation:", e);
  }
  return _simulateFromCruisePaths();
}

// ─── 本地巡航路径模拟 ────────────────────────────────────────────────
const _states = {};
for (const [id, cfg] of Object.entries(CRUISE_PATHS)) {
  _states[id] = {
    id, name: cfg.name, type: cfg.type,
    altitude: cfg.altitude, speed: cfg.speed, status: "active",
    pathIndex: 0, segProg: 0,
    trajectory: [],
    lon: cfg.path[0].lon, lat: cfg.path[0].lat, heading: 0,
  };
}

function _simulateFromCruisePaths() {
  const now = new Date().toISOString();
  const result = [];
  for (const [id, cfg] of Object.entries(CRUISE_PATHS)) {
    const st = _states[id];
    const path = cfg.path;
    const from = path[st.pathIndex];
    const to = path[(st.pathIndex + 1) % path.length];

    st.segProg += 0.03 + cfg.speed / 200;
    if (st.segProg >= 1) {
      st.segProg = 0;
      st.pathIndex = (st.pathIndex + 1) % path.length;
    }

    const t = st.segProg;
    st.lon = +(from.lon + (to.lon - from.lon) * t).toFixed(7);
    st.lat = +(from.lat + (to.lat - from.lat) * t).toFixed(7);
    const dlon = to.lon - from.lon, dlat = to.lat - from.lat;
    st.heading = +(((Math.atan2(dlon, dlat) * 180 / Math.PI) + 360) % 360).toFixed(1);

    st.trajectory.push({ lon: st.lon, lat: st.lat, ts: now });
    if (st.trajectory.length > 30) st.trajectory.shift();

    result.push({
      id, name: st.name, type: st.type,
      lon: st.lon, lat: st.lat,
      altitude: st.altitude, heading: st.heading, speed: st.speed,
      status: st.status, timestamp: now,
      trajectory: [...st.trajectory],
    });
  }
  return result;
}

// ─── Canvas 地图类 ────────────────────────────────────────────────────
class MapCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // 视图状态：中心经纬度 + 缩放级别
    this.centerLon = 113.531;
    this.centerLat = 34.815;
    this.zoom = 14; // 瓦片级别 0-18

    // 瓦片缓存：key = "z/tx/ty" → HTMLImageElement
    this.tileCache = new Map();

    // 待加载瓦片 Set：防止同一瓦片并发请求
    this._pendingTiles = new Set();

    // 拖拽状态
    this._dragging = false;
    this._dragStart = null;
    this._centerMoved = false; // 是否实际移动了中心（用于 mouseup/mouseleave 判断是否需要重新请求瓦片）

    // 画布双缓冲：背景层（持久化瓦片） + 前景层（标注/实体）
    this._offscreen = document.createElement("canvas");
    this._offCtx = this._offscreen.getContext("2d");
    // _renderCount 递增时使所有正在加载的瓦片失效
    this._renderCount = 0;

    this._bindEvents();
    this.resize();
  }

  _bindEvents() {
    this.canvas.addEventListener("mousedown", e => {
      this._dragging = true;
      this._dragStart = { x: e.offsetX, y: e.offsetY };
    });
    this.canvas.addEventListener("mousemove", e => {
      if (!this._dragging) return;
      const dx = e.offsetX - this._dragStart.x;
      const dy = e.offsetY - this._dragStart.y;
      this._dragStart = { x: e.offsetX, y: e.offsetY };
      const { x: cx, y: cy } = lonLatToPixel(this.centerLon, this.centerLat, this.zoom);
      const { lon, lat } = pixelToLonLat(cx - dx, cy - dy, this.zoom);
      this.centerLon = lon;
      this.centerLat = lat;
      this._centerMoved = true;
      this._blit();
    });
    this.canvas.addEventListener("mouseup", () => {
      if (!this._dragging) return;
      this._dragging = false;
      // Only re-render tiles if center actually moved (threshold: 2px)
      if (this._centerMoved) {
        this.render();
        this._centerMoved = false;
      }
    });
    this.canvas.addEventListener("mouseleave", () => {
      if (!this._dragging) return;
      this._dragging = false;
      if (this._centerMoved) {
        this.render();
        this._centerMoved = false;
      }
    });

    this.canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const zoomDelta = e.deltaY < 0 ? 1 : -1;
      this.setZoom(this.zoom + zoomDelta);
    }, { passive: false });

    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this._offscreen.width = rect.width;
    this._offscreen.height = rect.height;
    this.render();
  }

  setZoom(z) {
    this.zoom = Math.max(10, Math.min(18, z));
    this.render();
  }

  flyTo(lon, lat) {
    this.centerLon = lon;
    this.centerLat = lat;
    this.render();
  }

  /**
   * 将背景瓦片层同步复制到显示层（仅 blit，不发起新瓦片请求）
   */
  _blit() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    try {
      this.ctx.drawImage(this._offscreen, 0, 0);
    } catch (e) {
      // 某些情况下 drawImage 可能抛出异常（例如离屏 canvas 被修改）
      this.ctx.fillStyle = "#e8eef4";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * 完整渲染：重新计算可见瓦片网格、发起异步加载请求
   * drag 期间请使用 _blit() 而非本方法，避免频繁 clearRect
   */
  render() {
    this._renderTiles();
    this._blit();
  }

  _renderTiles() {
    const { _offCtx: ctx, _offscreen: canvas, zoom } = this;
    const W = canvas.width, H = canvas.height;

    // 瓦片网格
    const tileSize = 256;
    const { x: cx, y: cy } = lonLatToPixel(this.centerLon, this.centerLat, zoom);
    const startTX = Math.floor((cx - W / 2) / tileSize);
    const startTY = Math.floor((cy - H / 2) / tileSize);
    const endTX = Math.ceil((cx + W / 2) / tileSize);
    const endTY = Math.ceil((cy + H / 2) / tileSize);

    // 递增版本号，使旧瓦片 onload 失效
    this._renderCount++;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#e8eef4";
    ctx.fillRect(0, 0, W, H);

    for (let ty = startTY; ty <= endTY; ty++) {
      for (let tx = startTX; tx <= endTX; tx++) {
        const px = tx * tileSize - cx + W / 2;
        const py = ty * tileSize - cy + H / 2;
        this._loadTile(zoom, tx, ty, px, py, tileSize);
      }
    }
  }

  _loadTile(z, tx, ty, dx, dy, size) {
    const key = `${z}/${tx}/${ty}`;
    // 缓存命中：直接绘制
    if (this.tileCache.has(key)) {
      const img = this.tileCache.get(key);
      if (img.complete && img.naturalWidth > 0) {
        try {
          this._offCtx.drawImage(img, dx, dy, size, size);
        } catch (e) {
          // 忽略绘制异常
        }
      }
      return;
    }
    // 正在请求中：跳过
    if (this._pendingTiles.has(key)) return;
    this._pendingTiles.add(key);

    const url = _getTileUrl(z, tx, ty);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img._tileKey = key;
    const rc = this._renderCount;
    img.onload = () => {
      this._pendingTiles.delete(key);
      if (rc !== this._renderCount) return;
      this.tileCache.set(key, img);
      try {
        this._offCtx.drawImage(img, dx, dy, size, size);
        this._blit();
      } catch (e) {
        // 忽略绘制异常
      }
    };
    img.onerror = () => {
      this._pendingTiles.delete(key);
      if (rc !== this._renderCount) return;
      this._offCtx.fillStyle = "#d0d8e0";
      this._offCtx.fillRect(dx, dy, size, size);
      this._blit();
    };
    img.src = url;
  }

  /**
   * 在地图上绘制实体
   * @param {Array} entities - 实体数组
   * @param {string|null} selectedId - 当前选中 ID
   */
  drawEntities(entities, selectedId) {
    const { ctx, canvas, zoom, centerLon, centerLat } = this;
    const W = canvas.width, H = canvas.height;
    const { x: cx, y: cy } = lonLatToPixel(centerLon, centerLat, zoom);

    for (const e of entities) {
      const { x, y } = lonLatToPixel(e.lon, e.lat, zoom);
      const sx = x - cx + W / 2;
      const sy = y - cy + H / 2;

      // 跳过屏幕外的点
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;

      const isSelected = e.id === selectedId;
      const r = isSelected ? 9 : 6;
      const color = e.id === selectedId ? "#ff4444" : "#e74c3c";

      // 轨迹线
      if (e.trajectory && e.trajectory.length > 1) {
        ctx.beginPath();
        for (let i = 0; i < e.trajectory.length; i++) {
          const p = e.trajectory[i];
          const px = lonLatToPixel(p.lon, p.lat, zoom);
          const tpx = px.x - cx + W / 2;
          const tpy = px.y - cy + H / 2;
          ctx.globalAlpha = (i / e.trajectory.length) * 0.6;
          if (i === 0) ctx.moveTo(tpx, tpy);
          else ctx.lineTo(tpx, tpy);
        }
        ctx.strokeStyle = "#e74c3c";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 红色圆点
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.stroke();

      // 名称标签
      const label = e.name;
      ctx.font = `${isSelected ? "bold " : ""}11px "PingFang SC", "Microsoft YaHei", sans-serif`;
      const tw = ctx.measureText(label).width;
      const lx = sx + r + 4;
      const ly = sy + 3;

      // 标签背景
      ctx.fillStyle = "rgba(10, 30, 60, 0.85)";
      ctx.fillRect(lx - 2, ly - 10, tw + 6, 14);

      ctx.fillStyle = isSelected ? "#ffffff" : "#b3e0ff";
      ctx.fillText(label, lx + 2, ly);
    }
  }

  destroy() {
    this.tileCache.clear();
    this._pendingTiles.clear();
  }
}

// ─── 主窗口类 ────────────────────────────────────────────────────────
export class TrackingMapWindow {
  constructor() {
    this._container = null;
    this._map = null;
    this._entities = [];
    this._selectedId = null;
    this._pollTimer = null;
    this._initialized = false;
  }

  init() {
    console.info("[TrackingMap] init() called, attempting to inject window...");
    try {
      this._injectWindow();
      console.info("[TrackingMap] window injected, initializing map...");
      this._initMap();
      console.info("[TrackingMap] map init done, starting poll...");
      this._startPolling();
      this._initialized = true;
      console.info("[TrackingMap] fully initialized");
    } catch (e) {
      console.error("[TrackingMap] init failed:", e);
    }
  }

  // ─── DOM ────────────────────────────────────────────────────────────

  _injectWindow() {
    if (document.getElementById(WINDOW_ID)) {
      console.info("[TrackingMap] window already injected, skipping");
      return;
    }
    console.info("[TrackingMap] injecting window into DOM");

    const win = document.createElement("div");
    win.id = WINDOW_ID;
    win.className = "tracking-map-window hidden";
    win.innerHTML = `
      <div class="tmw-header" id="tmw-header">
        <div class="tmw-title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="#e74c3c" stroke-width="1.5"/>
            <circle cx="7" cy="7" r="2.5" fill="#e74c3c"/>
          </svg>
          目标监控
        </div>
        <div class="tmw-controls">
          <span class="tmw-count" id="tmw-count">0</span>
          <button class="tmw-btn" id="tmw-collapse-btn" title="收起">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 8l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="tmw-btn" id="tmw-close-btn" title="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="tmw-body">
        <div class="tmw-entity-list" id="tmw-entity-list"></div>
        <div class="tmw-map-container">
          <canvas id="tmw-canvas"></canvas>
          <div class="tmw-map-label">高德地图 2D · 拖拽移动</div>
        </div>
      </div>
      <div class="tmw-footer">
        <div class="tmw-selected-info" id="tmw-selected-info">点击左侧目标切换监控</div>
      </div>
      <div class="tmw-resize-handle" id="tmw-resize-handle"></div>
    `;

    const app = document.getElementById("app");
    if (app && app.parentNode) {
      app.parentNode.insertBefore(win, app.nextSibling);
    } else {
      document.body.appendChild(win);
    }

    this._container = document.getElementById(WINDOW_ID);
    this._bindWindowDrag();
    this._bindWindowResize();

    document.getElementById("tmw-collapse-btn")?.addEventListener("click", () => {
      this._container?.classList.toggle("collapsed");
    });

    document.getElementById("tmw-close-btn")?.addEventListener("click", () => {
      this._container?.classList.add("hidden");
    });
  }

  _bindWindowDrag() {
    const header = document.getElementById("tmw-header");
    const win = this._container;
    if (!header || !win) return;

    let dragging = false;
    let offsetX = 0, offsetY = 0;

    const onDown = (e) => {
      if (e.button !== 0) return;
      dragging = true;
      const rect = win.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      win.style.transition = "none";
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const nx = e.clientX - offsetX;
      const ny = e.clientY - offsetY;
      win.style.left = `${nx}px`;
      win.style.top = `${ny}px`;
      win.style.right = "auto";
      win.style.bottom = "auto";
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      win.style.transition = "";
      const rect = win.getBoundingClientRect();
      localStorage.setItem("tmw_x", rect.left);
      localStorage.setItem("tmw_y", rect.top);
    };

    header.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    // 恢复上次位置
    const savedX = localStorage.getItem("tmw_x");
    const savedY = localStorage.getItem("tmw_y");
    if (savedX !== null && savedY !== null) {
      win.style.left = `${savedX}px`;
      win.style.top = `${savedY}px`;
      win.style.right = "auto";
      win.style.bottom = "auto";
    }
  }

  _bindWindowResize() {
    const handle = document.getElementById("tmw-resize-handle");
    const win = this._container;
    if (!handle || !win) return;

    let resizing = false;
    let startW = 0, startH = 0, startX = 0, startY = 0;

    const onDown = (e) => {
      if (e.button !== 0) return;
      resizing = true;
      startW = win.offsetWidth;
      startH = win.offsetHeight;
      startX = e.clientX;
      startY = e.clientY;
      win.style.transition = "none";
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e) => {
      if (!resizing) return;
      const dw = e.clientX - startX;
      const dh = e.clientY - startY;
      win.style.width = `${Math.max(360, startW + dw)}px`;
      win.style.height = `${Math.max(240, startH + dh)}px`;
      this._map?.resize();
    };

    const onUp = () => {
      if (!resizing) return;
      resizing = false;
      win.style.transition = "";
      localStorage.setItem("tmw_w", win.offsetWidth);
      localStorage.setItem("tmw_h", win.offsetHeight);
      this._map?.resize();
    };

    handle.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    // 恢复上次大小
    const savedW = localStorage.getItem("tmw_w");
    const savedH = localStorage.getItem("tmw_h");
    if (savedW !== null && savedH !== null) {
      win.style.width = `${savedW}px`;
      win.style.height = `${savedH}px`;
    }
  }

  // ─── Canvas 地图 ────────────────────────────────────────────────────

  _initMap() {
    const canvas = document.getElementById("tmw-canvas");
    if (!canvas) {
      console.error("[TrackingMap] #tmw-canvas not found");
      return;
    }
    console.info("[TrackingMap] creating MapCanvas...");
    try {
      this._map = new MapCanvas(canvas);
      console.info("[TrackingMap] MapCanvas created, rendering...");
      this._map.render();
      console.info("[TrackingMap] first render done");
    } catch (e) {
      console.error("[TrackingMap] MapCanvas failed:", e);
      this._map = null;
    }
  }

  _render() {
    if (!this._map) return;
    this._map.render();
    // Entities must be drawn AFTER _blit() (which clears+draws the main canvas),
    // so they remain visible on top of the tile layer
    this._map.drawEntities(this._entities, this._selectedId);
  }

  // ─── 轮询 ───────────────────────────────────────────────────────────

  _startPolling() {
    this._pollTimer = setInterval(async () => {
      await this._fetchAndUpdate();
    }, POLL_INTERVAL_MS);
    this._fetchAndUpdate();
  }

  async _fetchAndUpdate() {
    const entities = await fetchTrackingData();
    if (!entities || !Array.isArray(entities)) return;
    this._entities = entities;
    this._renderEntityList(entities);
    const count = document.getElementById("tmw-count");
    if (count) count.textContent = entities.length;
    this._render();
  }

  // ─── 实体列表 ───────────────────────────────────────────────────────

  _renderEntityList(entities) {
    const list = document.getElementById("tmw-entity-list");
    if (!list) return;
    list.innerHTML = "";

    for (const e of entities) {
      const card = document.createElement("div");
      card.className = "tmw-entity-card" + (e.id === this._selectedId ? " active" : "");
      card.dataset.id = e.id;

      card.innerHTML = `
        <div class="tmw-ec-header">
          <div class="tmw-ec-dot-red"></div>
          <div class="tmw-ec-name">${e.name}</div>
          <div class="tmw-ec-status ${e.status === "active" ? "ok" : "warn"}"></div>
        </div>
        <div class="tmw-ec-stats">
          <span class="tmw-ec-stat">${e.lon.toFixed(4)}, ${e.lat.toFixed(4)}</span>
          <span class="tmw-ec-stat">${e.speed?.toFixed(1) ?? 0} m/s</span>
          ${e.type === "drone" ? `<span class="tmw-ec-stat">${e.altitude?.toFixed(0) ?? 0}m</span>` : ""}
        </div>
      `;

      card.addEventListener("click", () => this._selectEntity(e.id));
      list.appendChild(card);
    }
  }

  _selectEntity(id) {
    this._selectedId = id;

    document.querySelectorAll(".tmw-entity-card").forEach(el => {
      el.classList.toggle("active", el.dataset.id === id);
    });

    const entity = this._entities.find(e => e.id === id);
    if (entity) {
      this._map?.flyTo(entity.lon, entity.lat);
    }

    this._updateSelectedInfo(entity);
    this._render();
  }

  _updateSelectedInfo(entity) {
    const el = document.getElementById("tmw-selected-info");
    if (!el || !entity) return;
    const isDrone = entity.type === "drone";
    el.innerHTML = `
      <strong>${entity.name}</strong>
      &nbsp;·&nbsp;${isDrone ? "无人机" : "小车"}
      &nbsp;·&nbsp;${entity.speed?.toFixed(1) ?? 0} m/s
      ${isDrone ? `&nbsp;·&nbsp;${entity.altitude?.toFixed(0) ?? 0}m` : ""}
    `;
  }

  // ─── 生命周期 ───────────────────────────────────────────────────────

  destroy() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._map?.destroy();
    const win = document.getElementById(WINDOW_ID);
    win?.remove();
  }
}
