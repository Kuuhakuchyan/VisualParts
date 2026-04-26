# 微境智护 — 完整上下文提示词 (For Next Agent)

> 生成时间: 2026-04-26
> 当前系统版本: 0.1.0-DEMO
> 状态: **P0 — 修复监控窗口拖动地图后白屏 Bug（Plan 阶段）**

---

## 一、项目概述

### 项目名称
微境智护 — 城市微气候决策支持系统

### 核心功能
- **3D 城市场景**：基于 CesiumJS 的三维地图，渲染全球城市建筑群
- **热力图可视化**：基于区域分类的热岛强度实时展示
- **What-If 推演**：用户可添加/删除建筑，实时计算对微气候（温度、热岛强度）的影响
- **气象数据监测**：10 个实时仪表盘 + 6 项健康风险指标 + 24h 时序图
- **目标追踪**：无人机/小车实时位置显示与轨迹绘制（**当前主要工作区**）

### 技术栈
| 层级 | 技术 |
|------|------|
| 前端 | 原生 JS + CesiumJS 1.120, 无框架, ES Module |
| 后端 | FastAPI (Python), Pydantic, SQLAlchemy |
| 数据 | Mock 数据（模拟物理方程计算）|
| 部署 | 前端静态资源 + 后端 API (端口 3000) |

### 郑州大学主校区坐标
- 经度: `113.531°E`
- 纬度: `34.815°N`

---

## 二、目录结构

```
g:\VIsual parts\
├── index.html                          # 主 HTML 入口
├── dist/                              # 打包后的静态资源
├── frontend/
│   ├── dashboard/
│   │   ├── dashboard.js               # 主逻辑类：初始化、事件绑定、轮询管理
│   │   ├── dashboard.css              # 全局深蓝科技风样式
│   │   ├── health_panel.js            # 健康风险指标面板（6项指标卡片）
│   │   ├── weather_panels.js          # 10个仪表盘（SVG圆弧 + 罗盘）
│   │   ├── reasoning_panel.js         # 推理状态面板（步骤展示 + 结论）
│   │   ├── echarts_timeseries.js      # 24h时序图（ECharts，已实现）
│   │   ├── tracking_layer.js          # 无人机/小车 Cesium 实体管理（主地图3D）
│   │   ├── tracking_panel.js          # 追踪面板 UI（右侧面板）
│   │   ├── tracking_map_window.js     # 2D 追踪监控窗口（Canvas + 高德瓦片）
│   │   └── components/
│   │       ├── gauge.js               # SVG 圆弧仪表盘组件
│   │       └── wind_compass.js        # 风向罗盘组件
│   └── shared/
│       └── api.js                     # 统一 API 客户端
├── src/
│   └── cesium_core/
│       ├── core/
│       │   ├── ViewerManager.ts        # Cesium Viewer 单例管理器
│       │   └── constants.ts           # 全局配置常量
│       └── layers/
│           ├── CampusTilesetLayer.ts   # 3D Tileset 图层（含拾取支持）
│           ├── RegionalHeatmapLayer.ts # 热力图图层
│           ├── BuildingBuilderLayer.ts # 建筑放置/拾取图层
│           └── ImageryLayerManager.ts  # 影像底图管理
├── backend/
│   ├── main.py                        # FastAPI 应用（含追踪 API + AGI 推理）
│   ├── database.py                    # SQLAlchemy 模型
│   ├── requirements.txt               # Python 依赖
│   ├── .env                           # 环境变量
│   └── agi/
│       ├── __init__.py               # 导出 AGIReasoner
│       └── reasoner.py               # AGI 推理引擎（DeepSeek 封装）
└── docs/
    └── PROMPT_FOR_NEW_AGENT.md        # 本文件（设计文档）
```

---

## 三、当前 P0 Bug — 监控窗口拖动地图后白屏

### Bug: 拖动地图后画布变为灰色空白

**严重程度: P0（必须修复）**

**现象**: 打开目标监控窗口后，初始地图显示正常；一旦鼠标拖动地图，画布立即变灰（无任何瓦片），无论拖到哪里都是灰屏。

**复现步骤**:
1. 启动前端 (`npx vite --port 5173`)
2. 点击顶部「目标追踪」按钮打开监控窗口
3. 地图初始加载正常（可见高德瓦片）
4. 在 canvas 上按下鼠标并拖动
5. 画布变为灰色空白，拖到哪里都是灰色

**根因分析**:

`MapCanvas` 的渲染架构存在以下问题：

1. **闭包陷阱（主要）**：`img.onload` 中通过闭包捕获 `dx`/`dy` 参数，但这些坐标在 `render()` 调用时基于当前 `center`。拖动后 `render()` 被频繁调用（mousemove 每帧），`clearRect` 立即清空画布。旧瓦片 `onload` 因版本号校验（`_renderCount`）被废弃，画布在瓦片加载完成前始终为空灰色。

2. **每次 mousemove 都 render()**：`mousemove` 事件处理器直接调用 `this.render()`，每次清空画布 + 发起新瓦片请求。如果拖动快于瓦片加载，画布永远处于"请求中但未到达"的状态。

3. **高德瓦片 URL 可能不可用**：如果高德瓦片返回 403/404，`onerror` 触发后绘制灰色方块。用户拖动时不断 clearRect → 灰色背景 → 瓦片加载失败 → 灰色方块。

**当前 tracking_map_window.js 中的问题代码**:

```javascript:273:343:frontend/dashboard/tracking_map_window.js
  render() {
    this._renderTiles();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this._offscreen, 0, 0);
  }

  _renderTiles() {
    const { _offCtx: ctx, _offscreen: canvas, zoom } = this;
    const W = canvas.width, H = canvas.height;
    const tileSize = 256;
    const { x: cx, y: cy } = lonLatToPixel(this.centerLon, this.centerLat, zoom);
    const startTX = Math.floor((cx - W / 2) / tileSize);
    const startTY = Math.floor((cy - H / 2) / tileSize);
    const endTX = Math.ceil((cx + W / 2) / tileSize);
    const endTY = Math.ceil((cy + H / 2) / tileSize);

    this._renderCount++;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#e8eef4";
    ctx.fillRect(0, 0, W, H);

    const loaded = [];
    for (let ty = startTY; ty <= endTY; ty++) {
      for (let tx = startTX; tx <= endTX; tx++) {
        const px = tx * tileSize - cx + W / 2;
        const py = ty * tileSize - cy + H / 2;
        this._loadTile(zoom, tx, ty, px, py, tileSize, loaded);
      }
    }
  }

  _loadTile(z, tx, ty, dx, dy, size, loaded) {
    const key = `${z}/${tx}/${ty}`;
    if (this.tileCache.has(key)) {
      const img = this.tileCache.get(key);
      if (img.complete && img.naturalWidth > 0) {
        this._offCtx.drawImage(img, dx, dy, size, size);
      }
      return;
    }
    if (loaded.includes(key)) return;
    loaded.push(key);

    const url = _getTileUrl(z, tx, ty);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img._tileKey = key;
    img._dx = dx; img._dy = dy; img._size = size;
    const rc = this._renderCount; // 捕获当前版本
    img.onload = () => {
      if (rc !== this._renderCount) return;
      this.tileCache.set(key, img);
      this._offCtx.drawImage(img, dx, dy, size, size);
      this.ctx.drawImage(this._offscreen, 0, 0);
    };
    img.onerror = () => {
      if (rc !== this._renderCount) return;
      this._offCtx.fillStyle = "#d0d8e0";
      this._offCtx.fillRect(dx, dy, size, size);
      this.ctx.drawImage(this._offscreen, 0, 0);
    };
    img.src = url;
  }
```

```javascript:225:251:frontend/dashboard/tracking_map_window.js
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
      this.render(); // ← 每次 mousemove 都 render()（会 clearRect + 发起新瓦片请求）
    });
    this.canvas.addEventListener("mouseup", () => { this._dragging = false; });
    this.canvas.addEventListener("mouseleave", () => { this._dragging = false; });
    this.canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const zoomDelta = e.deltaY < 0 ? 1 : -1;
      this.setZoom(this.zoom + zoomDelta);
    }, { passive: false });
    window.addEventListener("resize", () => this.resize());
  }
```

**计划修复方案**:

1. **拖动期间不发起瓦片请求**：mousemove 时只更新 center 并用 `_blit()` 同步重绘已有瓦片，不调用 `render()`（不 clearRect，不发请求）。mouseup/mouseleave 时才调用 `render()` 补全新瓦片。
2. **用 `_pendingTiles` Set 替代 `loaded` 数组**：防止并发请求同一瓦片。
3. **drawImage 加 try-catch**：捕获可能的异常。
4. **窗口拖动用 `getBoundingClientRect()`**：`offsetLeft` 在 `position: fixed` 时不准确，且 header 的 `mousedown` 应 `stopPropagation()` 防止冒泡到 canvas。
5. **排查高德瓦片 URL**：在浏览器控制台验证 `webst0{1-4}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}` 是否返回正常图片；若返回 403，改为 `style=8`（矢量图）或改用天地图 WMTS。

**修复文件**：`frontend/dashboard/tracking_map_window.js`

---

## 四、当前瓦片配置（高德地图）

```javascript
// ─── 高德地图 Web 瓦片（GCJ-02 坐标系）───────────────────────────────
const AMAP_SUBDOMAINS = ["1", "2", "3", "4"];

function _getTileUrl(z, x, y) {
  const s = AMAP_SUBDOMAINS[(x + y) % AMAP_SUBDOMAINS.length];
  return `https://webst0${s}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`;
}

// style=6: 卫星图（含注记）
// style=8: 矢量电子地图
// style=0: 矢量路网（底色白）

// ─── WGS-84 → GCJ-02 坐标转换（高德地图使用 GCJ-02）────────────────
function toGCJ(lon, lat) { ... }  // WGS-84 转 GCJ-02（WGS-84 是 GPS 原始坐标，瓦片用 GCJ-02）

// ─── GCJ-02 经纬度 → Web Mercator 投影像素坐标 ──────────────────────
function lonLatToPixel(lon, lat, zoom) {
  const gcj = toGCJ(lon, lat);
  const x = ((gcj.lon + 180) / 360) * (1 << zoom) * 256;
  const sinLat = Math.sin((gcj.lat * PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * PI)) * (1 << zoom) * 256;
  return { x, y };
}
```

**备选瓦片源（天地图 WMTS）**：
- URL: `https://t0.tianditu.gov.cn/img_c/wmts`
- 参数: `SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=c&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=tiles&tk=1b37405bc436d1078f80e15278c0d402`
- 注意: 天地图使用 CGCS2000 经纬度投影（Plate Carrée），与 Web Mercator 不同，需要用 Plate Carrée 投影函数替换 `lonLatToPixel`

---

## 五、API 清单

### 后端 API (FastAPI, 端口 3000)

#### 气象数据
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/weather/current` | 获取当前气象数据（Mock，含微幅波动）|
| GET | `/api/simulation/health` | 健康检查 |

#### What-If 推演
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/simulation/buildings` | 创建建筑记录 |
| POST | `/api/simulation/what-if` | What-If 推演（ADD/REMOVE，支持 AGI 推理）|
| GET | `/api/simulation/scenarios` | 场景列表 |
| GET | `/api/simulation/scenarios/{id}` | 场景详情 |
| GET | `/api/simulation/scenarios/{id}/undo` | 撤销场景 |
| GET | `/api/simulation/stats` | 全局统计 |
| GET | `/api/simulation/export` | 导出报告（Markdown）|

#### 目标追踪
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/tracking/positions` | 获取所有追踪实体实时位置（每请求推进模拟一步）|
| GET | `/api/tracking/positions/{entity_id}` | 获取指定实体位置 |

**TrackingEntity 数据结构:**
```json
{
  "id": "drone_001",
  "name": "巡检无人机-01",
  "type": "drone",
  "lon": 113.533,
  "lat": 34.816,
  "altitude": 80.0,
  "heading": 45.0,
  "speed": 8.5,
  "status": "active",
  "timestamp": "2026-04-26T03:54:00",
  "trajectory": [{"lon": 113.533, "lat": 34.816, "ts": "..."}]
}
```

---

## 六、已实现的追踪功能架构

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│                  index.html                          │
│  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  Cesium 3D 主地图  │  │   右侧面板（TrackingPanel）│  │
│  │  TrackingLayer    │  │   目标列表 + 详情         │  │
│  │  （所有实体 + 轨迹）│  └────────────────────────┘  │
│  └──────────────────┘                               │
│  ┌──────────────────────────────────────────────┐   │
│  │  独立悬浮窗（TrackingMapWindow）               │   │
│  │  ┌────────┬─────────────────────────────┐   │   │
│  │  │实体列表 │        Canvas 2D Map        │   │   │
│  │  │(可切换) │   (高德瓦片 + 实体标注)      │   │   │
│  │  └────────┴─────────────────────────────┘   │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
         ↑ 轮询 /api/tracking/positions (3s)
         │
┌─────────────────────────────────────────────────────┐
│  backend/main.py                                    │
│  GET /api/tracking/positions                        │
│  → _CRUISE_PATHS (3 无人机 + 2 小车预设航点)        │
│  → _step_entity() (沿路径线性插值循环巡航)           │
└─────────────────────────────────────────────────────┘
```

### TrackingMapWindow 内部结构

```javascript
// 两个核心类
MapCanvas        // 纯 Canvas 地图渲染，无 Cesium 依赖
  - canvas / ctx (2D context)
  - _offscreen / _offCtx (双缓冲)
  - tileCache (Map: "z/tx/ty" → Image)
  - _pendingTiles (Set: 防止瓦片并发请求)  ← 当前缺失，需添加
  - _renderCount (number: 使旧瓦片 onload 失效)
  - centerLon / centerLat / zoom (视图状态)
  - _dragging / _dragStart (拖拽状态)
  - _bindEvents() → mousedown/mousemove/mouseup/mouseleave/wheel
  - _renderTiles() → 遍历可见瓦片网格 → _loadTile()
  - _loadTile() → 检查缓存 → 创建 Image → img.onload/onerror
  - drawEntities() → 在 canvas 上绘制实体 + 轨迹 + 标签
  - render() → _renderTiles() + blit offscreen to main
  - _blit() → clearRect + drawImage(offscreen)  ← 当前缺失，需添加
  - flyTo(lon, lat) → 设置中心经纬度并重新渲染

TrackingMapWindow  // 主窗口类
  - _container / _map (MapCanvas 实例)
  - _entities / _selectedId
  - _pollTimer / _initialized
  - init() → _injectWindow() + _initMap() + _startPolling()
  - _injectWindow() → 注入 DOM（fixed 悬浮窗）
  - _bindWindowDrag() → 标题栏拖动移动窗口（当前用 offsetLeft，需改用 getBoundingClientRect）
  - _bindWindowResize() → 右下角把手拉伸窗口
  - _initMap() → new MapCanvas(canvas)
  - _startPolling() → setInterval fetchTrackingData, 3000ms
  - _onTrackingUpdate() → update map + entity list
  - _selectEntity(id) → 切换监控目标，map.flyTo()
  - _renderEntityList() → 渲染左侧实体列表
  - destroy() → 清理轮询、DOM
```

---

## 七、已实现的完整功能清单

### 功能 #1: 自建 3D 城市模型支持 [已完成]

**修改文件：**
- `src/cesium_core/core/constants.ts` — 新增 `DEFAULT_TILESET_URL` 和 `DEFAULT_TILESET_ION_ASSET_ID` 配置
- `src/cesium_core/layers/CampusTilesetLayer.ts` — 新增 `ionAssetId` 选项

**使用方式：**
```typescript
// 方式一：本地 3D Tiles
await campusLayer.load("/data/city_tileset/tileset.json");
// 方式二：Cesium Ion 资产
await campusLayer.load(undefined, { ionAssetId: 16421 });
// 方式三：远程 URL
await campusLayer.load("https://your-cdn.com/tileset.json");
```

### 功能 #2: CampusTilesetLayer 建筑拾取 [已完成]

- `onFeatureClicked` — 点击回调
- `_startPickHandler()` / `_stopPickHandler()` — 拾取处理器
- `setPickEnabled(enabled: boolean)` — 全局开关

### 功能 #3: 地形高程 [已完成]

```typescript
import { ArcGisWorldElevationTerrainProvider } from "cesium";
export const DEFAULT_TERRAIN_PROVIDER: any = new ArcGisWorldElevationTerrainProvider();
```

### 功能 #4: 无人机/小车追踪 [已完成]

**架构说明：**
- 主地图 3D（Cesium SceneMode.SCENE3D）：TrackingLayer 显示所有实体 + 轨迹
- 独立监控窗口 2D（纯 Canvas + 高德地图瓦片，无 Cesium 依赖）：TrackingMapWindow
- 两者共享同一份 `/api/tracking/positions` 数据，轮询间隔 3 秒
- 窗口为 fixed 悬浮窗（初始隐藏），顶部按钮 toggle 显示/隐藏
- 2D 地图使用纯 Canvas + 高德 Web 瓦片（GCJ-02 坐标系，WGS-84 坐标自动转换）
- 监控窗口支持拖拽移动（标题栏拖动）和拉伸（右下角把手），位置和大小自动保存到 localStorage
- 后端不可用时前端自动回退到本地 `_simulateFromCruisePaths()` 模拟

### 功能 #5: AGI 推理引擎 [已完成]

**文件**：`backend/agi/reasoner.py`

```python
from backend.agi import AGIReasoner
_agi = AGIReasoner()  # 初始化
agi_result = await _agi.reason(buildingInfo, action, context)
# 返回: { tempDelta, confidence, reasoningSteps, model }
```

**接入方式**：环境变量 `USE_MOCK_AGI=0` 时使用真实 AGI，`USE_MOCK_AGI=1` 时回退到 Mock。

### 功能 #6: 24h 时序图 [已完成]

**文件**：`frontend/dashboard/echarts_timeseries.js`

- `EChartsTimeseries` 类
- 动态加载 ECharts CDN（如未加载）
- 支持 resize 自动适应
- 已在 `dashboard.js` 中集成：`this._timeseries = new EChartsTimeseries()`

### 功能 #7: 推理状态面板 [已完成]

**文件**：`frontend/dashboard/reasoning_panel.js`

- `ReasoningPanel` 类
- 展示推理步骤（Loading → 步骤列表 → 结论）

---

## 八、已知 Bug 及修复记录

### Bug #1: REMOVE 按钮失效（已修复）
**问题**：点击地图上已放置的建筑时，建筑被直接删除，What-If REMOVE 推理链路从未触发。

**修复 1** — `frontend/dashboard/dashboard.js`:
```javascript
this._builderLayer.onBuildingClicked = async (record) => {
  this._selectedBuildingRecord = record;
  this._openDetailModal(record);
  return false;  // ← 添加此行，阻止默认删除
};
```

**修复 2** — `frontend/dashboard/dashboard.js`:
```javascript
async _deleteFromModal() {
  if (!this._selectedBuildingRecord) return;
  await this._whatIfRemove(this._selectedBuildingRecord);  // 改为调用推演
  this._closeDetailModal();
}
```

### Bug #2: 监控窗口拖动地图后白屏（P0 — 待修复）
**问题**：拖动 canvas 地图后画布变为灰色空白，无法继续显示瓦片。
**根因**：异步瓦片加载闭包 + 每次 mousemove 调用 render() 清空画布 + 高德瓦片 URL 可能返回 403。
**修复方案**：见本文档第三章"当前 P0 Bug — 监控窗口拖动地图后白屏"。

---

## 九、完整待办事项

| 优先级 | 状态 | 内容 | 备注 |
|--------|------|------|------|
| P0 | 🔲 待修复 | 修复监控窗口拖动地图后白屏 Bug | 见第三章 |
| P0 | ✅ 完成 | 修复 REMOVE 按钮 Bug | |
| P0 | ✅ 完成 | 自建 3D 模型集成 | |
| P0 | ✅ 完成 | 启用地形高程 | |
| P0 | ✅ 完成 | CampusTilesetLayer 建筑拾取支持 | |
| P1 | ✅ 完成 | 后端追踪 API | |
| P1 | ✅ 完成 | 前端 TrackingLayer（Cesium 实体 + 轨迹）| |
| P1 | ✅ 完成 | 前端 TrackingPanel（右侧面板 UI）| |
| P1 | ✅ 完成 | 前端 TrackingMapWindow（2D 独立监控窗口）| |
| P1 | ✅ 完成 | 集成到 dashboard.js | |
| P1 | ✅ 完成 | AGI 推理引擎接入 | backend/agi/reasoner.py |
| P1 | ✅ 完成 | 24h ECharts 时序图 | |
| P1 | ✅ 完成 | 推理状态面板 | |
| P2 | 🔲 待办 | 场景列表（右侧面板"暂无已保存的场景"）| index.html 第 246-248 行硬编码 |
| P2 | 🔲 待办 | OSM 建筑的"拔楼"推演集成 | onFeatureClicked → What-If REMOVE |
| P2 | 🔲 待办 | 生物多样性监测面板 | index.html 第 237-244 行显示占位 |

---

## 十、下一步开发路线图

Bug 修复完成后，建议按以下顺序推进：

### Phase 1: 监控追踪完善（当前阶段）

1. **修复 P0 Bug**（本轮）：监控窗口拖动白屏
2. **场景列表完善**：右侧面板"暂无已保存的场景"改为真实列表（调用 `/api/simulation/scenarios`）
3. **切换瓦片源**：若高德瓦片 403，切换到天地图 WMTS 或 OSM

### Phase 2: 核心功能收尾

4. **OSM 拔楼推演**：`CampusTilesetLayer.onFeatureClicked` → 弹出详情弹窗 → What-If REMOVE 推理
5. **生物多样性监测面板**：调用 `/api/biodiversity` 或接真实图片上传接口

### Phase 3: 真实数据接入

6. **真实气象站数据**：将 Mock 数据替换为真实传感器 API
7. **PostgreSQL + 真实建筑数据**：持久化存储建筑和场景
8. **RAG + 幻觉检测**：完善 `backend/agi/reasoner.py` 中的知识检索

### Phase 4: 汇报美化

9. **演示文档**：截图、视频录制、操作手册
10. **论文撰写**：整理系统架构和实验数据

---

## 十一、代码规范与约定

### 1. Cesium 图层类命名
- 图层管理器文件：`XxxLayer.ts`
- 类名：`XxxLayer`
- 初始化方法：`init()` 或 `load()`
- 销毁方法：`destroy()`

### 2. 仪表盘面板类命名
- 面板 JS 文件：`xxx_panel.js`
- 类名：`XxxPanel`
- 更新方法：`update(data)`

### 3. API 响应格式
```json
{ "success": true, "data": { ... }, "message": "..." }
```

### 4. Cesium 组件模式
```javascript
const viewer = viewerManager.getViewer();
this._someLayer = new SomeLayer(viewer);
await this._someLayer.init();
```

### 5. 轮询管理
- 气象数据：60 秒轮询
- 追踪数据：3 秒轮询
- 在 `destroy()` 中清理所有 `setInterval`

### 6. 样式规范
- CSS 变量定义在 `dashboard.css` 的 `:root`
- 面板组件样式类前缀：`.panel-title`, `.tracking-*`, `.track-*`
- 颜色：`--color-primary: #00b4ff`, `--color-success: #00ff88`, `--color-warning: #ffcc00`

---

## 十二、快速开发指南

### 启动后端
```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 3000 --reload
```

### 启动前端（开发）
```bash
npx vite --port 5173
```

**Vite 代理配置**（`vite.config.ts`）：
- `/api/simulation` → `localhost:3000`
- `/api/weather` → `localhost:3000`
- `/api/tracking` → `localhost:3000`

### 启动前端（生产）
直接打开 `index.html` 即可（API 请求走相对路径 `/api/...`）

---

## 十三、关键文件摘要

### `frontend/dashboard/tracking_map_window.js` — 2D 追踪监控窗口
**类: MapCanvas**（纯 Canvas 地图渲染，无 Cesium 依赖）
- `lonLatToPixel(lon, lat, zoom)` — WGS-84 → GCJ-02 → Web Mercator 像素坐标
- `toGCJ(lon, lat)` — WGS-84 转 GCJ-02（WGS-84 是 GPS 原始坐标，瓦片用 GCJ-02）
- `_getTileUrl(z, x, y)` — 高德瓦片 URL（当前使用 `style=6` 卫星图）
- `render()` — 主渲染：_renderTiles() + blit offscreen → main canvas
- `_renderTiles()` — 遍历可见瓦片网格，调用 `_loadTile()`
- `_loadTile()` — 检查缓存，创建 Image，绑定 onload/onerror
- `drawEntities(entities, selectedId)` — 绘制实体圆点 + 轨迹线 + 名称标签
- `flyTo(lon, lat)` — 设置中心经纬度并重新渲染
- `resize()` — 调整画布尺寸
- `_blit()` — 当前缺失，需添加：clearRect + drawImage(offscreen)

**类: TrackingMapWindow**（主窗口）
- `init()` — `_injectWindow()` + `_initMap()` + `_startPolling()`
- `_injectWindow()` — 注入 fixed 悬浮窗 DOM（标题栏 + 实体列表 + canvas + 底部信息）
- `_bindWindowDrag()` — 标题栏拖动移动窗口（当前用 offsetLeft，需改用 getBoundingClientRect）
- `_bindWindowResize()` — 右下角把手拉伸窗口
- `_startPolling()` — setInterval 轮询 `/api/tracking/positions`
- `_onTrackingUpdate(data)` — 更新 MapCanvas + 实体列表
- `_selectEntity(id)` — 切换监控目标
- `destroy()` — 清理轮询、DOM

**Mock 数据**: `CRUISE_PATHS` 对象定义 5 个实体的预设航点（3 无人机 drone_001~drone_003 + 2 小车 car_001~car_002，郑州大学附近）

### `frontend/dashboard/dashboard.js` — 主逻辑
- `init()` — 入口，初始化 Cesium + UI 组件
- `_initCesium()` — 创建 Viewer、CampusTilesetLayer、RegionalHeatmapLayer、BuildingBuilderLayer、TrackingLayer
- `_initUIComponents()` — 创建 HealthPanel、ReasoningPanel、WeatherPanels、TrackingPanel、EChartsTimeseries
- `_bindBuilderEvents()` — 建筑放置/点击事件
- `_bindControlBar()` — ADD/REMOVE/重置控制栏
- `_whatIfAdd()` / `_whatIfRemove()` — What-If 推演链路
- `_deleteFromModal()` — 从详情弹窗删除（已修复为调用推演）
- `_startWeatherPolling()` / `_startTrackingPolling()` — 数据轮询

### `backend/main.py` — FastAPI 后端
- `_CRUISE_PATHS` — 5 个追踪实体的预设航点（郑州大学附近）
- `_tracking_entities` — 内存中的实体状态（lon/lat/heading/segProg/pathIndex）
- `_step_entity()` — 沿航点路径线性插值，推进实体位置
- `/api/tracking/positions` — 返回所有实体当前位置，每调用一步推进
- `get_mock_weather()` — Mock 气象数据（带微幅波动）
- `compute_temp_delta()` — 热岛强度计算
- `AGIReasoner` — 从 `backend.agi` 导入，支持 DeepSeek 推理

### `backend/agi/reasoner.py` — AGI 推理引擎
- `AGIReasoner` 类
- `reason(buildingInfo, action, context)` — 异步推理方法
- 返回：`{ tempDelta, confidence, reasoningSteps, model }`
- 支持 Mock 降级（无 API Key 时返回合理估算值）

### `frontend/dashboard/reasoning_panel.js` — 推理状态面板
- `ReasoningPanel` 类
- `update(result)` — 展示推理结果（步骤列表 + 结论）
- `showLoading()` / `hideLoading()` — 加载状态

### `frontend/dashboard/echarts_timeseries.js` — 24h 时序图
- `EChartsTimeseries` 类
- `_buildChart()` — 构建 ECharts 配置（温度/湿度/降水三线）
- `updateData(data)` — 更新时序数据
- `destroy()` — 清理 resize handler

### `index.html` 关键节点
| 行号 | 内容 |
|------|------|
| 88-92 | 推演数统计卡片（`stat-scenarios`） |
| 237-244 | 生物多样性监测面板（占位状态） |
| 246-248 | 场景列表（硬编码"暂无已保存的场景"） |
| 314-316 | 详情弹窗中的场景 ID 显示 |

---

## 十四、参考文档

- 快速交付计划：`c:\Users\123\.cursor\plans\微境智护_demo_快速交付计划_b0bebd94.plan.md`
- 系统架构设计：`c:\Users\123\.cursor\plans\微境智护系统架构设计_559a795d.plan.md`
