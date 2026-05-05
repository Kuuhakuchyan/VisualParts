# 微境智护 — 完整开发提示词

> 版本：v4.0 | 日期：2026-04-28 | 项目：https://github.com/Kuuhakuchyan/VisualParts
> 供新 Agent 使用，基于 v1.0 完整架构 + v2.0 快速交付计划 + v3.0 热力场模拟版 三份架构文档综合整理

---

## 一、项目概述

### 1.1 项目名称

**微境智护 (Micro-Climate Guardian)** — 城市微气候决策支持系统

### 1.2 核心目标

用稀疏传感器数据，通过空间插值和下垫面修正，实时生成任意位置的精细热力场，并评估热舒适程度。用户不可能在每个位置都装传感器，而是利用"小范围内温度差异不会特别大"的特性，通过有限数据推断全局。

### 1.3 目标区域

郑州大学（ZZU）校区附近，经纬度范围大致为 113.524°E~113.542°E, 34.806°N~34.822°N。

### 1.4 核心技术思路

水体、绿地等各种下垫面要素对局地温度有显著影响：
- 大型湖泊白天降温 -2~-5°C，夜间保温 +1~+2°C，影响半径 200~500m
- 河流宽度 >20m 降温 -1~-3°C，影响半径 50~100m
- 密林（NDVI 0.6~0.8）降温 -2~-3°C，影响半径 50~100m
- LCZ 高层密集区（LCZ 1~3）增热 +3~+5°C

这些修正因子通过实验/卫星遥感数据获取，不需要每个楼都装传感器。

### 1.5 GitHub 地址

https://github.com/Kuuhakuchyan/VisualParts

---

## 二、参考文档（必读）

按优先级顺序阅读以下文档：

1. **C:\Users\123\.cursor\plans\微境智护系统架构设计_v3.0_热力场模拟版.md**
   - 当前版本的架构设计基准，包含完整的 Phase 0~7 计划、目录结构、API 设计、数据库设计
   - 这是开发行动指南的核心参考

2. **C:\Users\123\.cursor\plans\微境智护系统架构设计_559a795d.plan.md**
   - v2.0 完整架构文档，包含四层架构、数据管道（多源接入→传统存储→向量化→LLM调用）、RAG 引擎设计、AGI 三路并行推理架构、完整数据库设计、后台管理系统设计
   - 这是系统长期演进的目标蓝图

3. **C:\Users\123\.cursor\plans\微境智护_demo_快速交付计划_b0bebd94.plan.md**
   - v2.0 快速交付计划，包含详细的 Mock API 代码示例、Step 1~5 实施步骤
   - 这是 Demo 交付的参考模板，但需要注意：当前项目已经实现了大部分 Demo 阶段的功能

4. **g:\VIsual parts\docs\PROMPT_FOR_NEW_AGENT.md**
   - 项目上下文文档，包含更详细的模块说明和数据流描述，作为架构文档的补充参考

---

## 三、当前项目实际完成度

### 3.1 已完成（可直接使用，勿破坏）

| 模块 | 路径 | 状态 | 说明 |
|------|------|------|------|
| Cesium 核心 | src/cesium_core/ | 可用 | ViewerManager（场景初始化、OSM 建筑加载）、常量配置 |
| Cesium 核心 | frontend/cesium/ | 可用 | 与 src/cesium_core/ 并存，部分重复 |
| 热力图渲染 | src/cesium_core/layers/RegionalHeatmapLayer.ts | 可用但需改造 | 当前用 13 个硬编码热力点，需改为动态网格数据 |
| 建筑叠加 | src/cesium_core/layers/BuildingBuilderLayer.ts | 可用 | ADD/REMOVE 建筑，多类型/多形状，事件触发 |
| What-If 推理 | backend/agi/reasoner.py | Mock 完成 | 接口已就绪（reason() 方法），内部可替换为真实计算 |
| 气象仪表盘 | frontend/dashboard/weather_panels.js | 可用 | 10 个 SVG 仪表盘（温度/湿度/气压/风速等） |
| 健康风险面板 | frontend/dashboard/health_panel.js | 可用 | 6 项指标卡片，颜色编码进度条 |
| 推理状态面板 | frontend/dashboard/reasoning_panel.js | 可用 | 推理步骤链 + 置信度展示 |
| 时序折线图 | frontend/dashboard/echarts_timeseries.js | 可用 | 24h 温度/地温/降水曲线 |
| 目标追踪 | frontend/dashboard/tracking_*.js + backend/main.py | 可用 | 模拟实体位置推送 |
| 鸟类检测 | identification/ (Flask + DETR) | 可用 | 独立服务，port 5000 |
| Vite 代理 | vite.config.ts | 可用 | /api/simulation → localhost:3000, /api/detect → localhost:5000 |
| API 客户端 | frontend/shared/api.js | 可用 | 统一封装，含兜底错误处理 |
| 主入口页面 | index.html + frontend/index.html | 可用 | 大屏主界面 |

### 3.2 需要改进（按优先级）

| 优先级 | 问题 | 现状 | 影响 |
|--------|------|------|------|
| 最高 | 热力场固定 | RegionalHeatmapLayer 用 13 个硬编码点，无动态计算 | 无法反映真实热力分布 |
| 最高 | 无插值计算 | 后端无 IDW/Kriging 等空间插值算法 | 热力场无法从传感器数据生成 |
| 最高 | 无下垫面修正 | 水体/绿地/建筑密度对温度的影响未建模 | 热力场精度不足 |
| 高 | 舒适度缺失 | 只有 AQI/UV 等简单指标，无 UTCI/PET | 无法满足专业评估需求 |
| 中 | 数据库 Mock | 定义了 ORM 但用内存字典，无真库 | 数据无法持久化 |
| 中 | 路由未拆分 | backend/main.py ~800 行挤在一起 | 难以维护 |
| 低 | 推理 Mock | DeepSeek 未真接 | 无法体验 LLM 推理能力 |
| 低 | 后台管理缺失 | Admin Panel 完全未建立 | 无法管理用户/模型/配置 |
| 低 | 目录混乱 | src/ 和 frontend/cesium/ 并存，visualheader/ 未整合 | 维护困难 |

### 3.3 Demo 快速交付计划对照（当前状态）

v2.0 demo 计划中的 Step 1~5 实际完成情况：

- Step 1 (后端骨架 + Mock API): ✅ 已完成。backend/main.py 已包含所有 Mock 接口
- Step 2 (Cesium 3D 场景): ✅ 已完成。建筑模型 + 热力场 + 交互已实现
- Step 3 (前后端联通): ✅ 已完成。API 对接 + 仪表盘 + What-If 控制已就绪
- Step 4 (DeepSeek V4 接入): ⚠️ 部分完成。接口已预留，未真接 API
- Step 5 (装饰完善): ⚠️ 部分完成。基础样式完成，演示文档待补充

结论：Demo 框架已搭建完毕，核心差距在于**热力场动态计算**和**真实数据接入**。

---

## 四、技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | 原生 JS + CesiumJS 1.140，Vite 8 构建，ECharts 6 |
| 后端 | FastAPI 0.115 + Python 3，Uvicorn |
| 鸟类检测 | Flask + HuggingFace DETR（port 5000） |
| 地图 | CesiumJS（OSM Buildings 3D 建筑 + 默认地形） |
| Cesium 类型 | TypeScript（src/cesium_core/） |
| Cesium JS 交互 | 原生 JS（frontend/dashboard/） |
| Cesium 入口引用 | dashboard.js 引用 "../../src/cesium_core/..." |
| 路径别名 | @/* → src/*（定义在 tsconfig.json） |
| ZZU 相机位置 | 113.531, 34.815（定义在 src/cesium_core/core/constants.ts） |

---

## 五、核心开发任务：热力场实时模拟（Phase 1）

**这是最高优先级的任务，是整个系统最核心的能力。**

### 5.1 计算管线

稀疏传感器数据（8~12个关键点）
        |
        ▼
+-----------------------------+
|  空间插值引擎               |
|  IDW（反距离加权）         |
|  输出：基础温度网格         |
|  分辨率：30m x 30m        |
+-----------------------------+
               |
               ▼
+-----------------------------+
|  下垫面修正层               |
|  水体降温 (河流/湖泊/湿地) |
|  绿地降温 (NDVI/植被覆盖)  |
|  建筑增热 (建筑密度/高度)  |
|  LCZ 分类修正              |
|  地形遮蔽修正              |
|  输出：修正后温度网格        |
+-----------------------------+
               |
               ▼
+-----------------------------+
|  物理约束校验               |
|  ΔT ∈ [-5, +5]°C         |
+-----------------------------+
               |
               ▼
+-----------------------------+
|  Cesium 热力图层渲染        |
|  实时刷新                  |
+-----------------------------+
               |
               ▼
+-----------------------------+
|  舒适度评估                 |
|  UTCI / PET / 热指数        |
|  户外热舒适分区地图         |
+-----------------------------+

### 5.2 下垫面修正参数（参考值，可实验校准）

#### 水体降温

| 水体类型 | 白天降温 | 夜间保温 | 影响半径 | 方向性 |
|----------|---------|---------|---------|--------|
| 大型湖泊 >1km² | -2 ~ -5°C | +1 ~ +2°C | 200~500m | 主导风下风向 |
| 河流宽度 >20m | -1 ~ -3°C | +0.5°C | 50~100m | 迎风侧更远 |
| 小型水体/池塘 | -0.5 ~ -2°C | 不显著 | 20~50m | 无方向性 |
| 湿地 | -1 ~ -3°C | 弱 | 100~300m | 主导风下风向 |

#### 绿地/植被

| NDVI 区间 | 降温效应 | 影响半径 |
|-----------|---------|---------|
| 0.6~0.8（密林）| -2 ~ -3°C | 50~100m |
| 0.3~0.6（草地/灌木）| -1 ~ -2°C | 20~50m |
| 0.1~0.3（稀疏植被）| -0.3 ~ -1°C | 10~20m |

#### LCZ 分类（简化版 6 类）

| LCZ 类型 | 热岛强度 ΔT | 典型地物 |
|----------|----------------------|---------|
| LCZ 1~3（高层密集）| +3 ~ +5°C | CBD 高层建筑群 |
| LCZ 4~6（中层/低层密集）| +2 ~ +4°C | 住宅小区 |
| LCZ 8~9（低密度建筑）| +1 ~ +2°C | 郊区住宅 |
| LCZ A/B（树木/灌木）| -1 ~ -3°C | 公园绿地 |
| LCZ C/D（水体）| -2 ~ -5°C | 湖泊河流 |
| LCZ E（裸地）| +1 ~ +3°C | 工地/荒地 |

#### 修正公式

T_actual(x, y) = T_background(x, y) + ΔT_water(x, y) + ΔT_green(x, y) + ΔT_urban(x, y) + ΔT_terrain(x, y)

每个修正项：ΔT_factor(x, y) = Σ [weight_i × effect_i] × decay(dist_to_factor_i)
decay 函数：指数衰减 exp(-dist/half_life) 或线性衰减 max(0, 1 - dist/radius)

### 5.3 新增文件清单

#### 后端新增

**backend/services/heatfield_engine.py** — 核心热力场计算引擎
  - generate(resolution, bounds, timestamp) — 主入口，生成完整热力场网格
  - _interpolate_idw(known_points, grid) — IDW 空间插值
  - _apply_water_effect(grid, water_bodies) — 水体降温修正
  - _apply_green_effect(grid, ndvi_data) — 绿地降温修正
  - _apply_urban_effect(grid, buildings) — 建筑增热修正
  - _validate_thermodynamic(grid) — 物理约束校验（ΔT ∈ [-5, +5]）
  - query_point(lon, lat) — 查询单点温度

**backend/routers/heatfield.py** — 热力场 API 路由
  - GET /api/heatfield/current — 获取当前热力场网格
  - GET /api/heatfield/point?lon=&lat= — 查询单点温度
  - POST /api/heatfield/whatif — What-If 热力场模拟

#### 前端新增/改造

**frontend/dashboard/api/heatfield.js** — 热力场 API 客户端
  - apiGetHeatfield(resolution, bounds) — 获取热力场网格
  - apiQueryPoint(lon, lat) — 查询单点
  - apiWhatIfHeatfield(action) — What-If 模拟

**frontend/dashboard/config/lcz_params.js** — LCZ 参数配置（修正因子表）

**frontend/dashboard/config/indicators.js** — 热力场指标配置（温度范围、颜色阈值）

**改造 src/cesium_core/layers/RegionalHeatmapLayer.ts**：
  - 保留现有 HeatPoint[] 接口（向后兼容）
  - 新增 updateFromGrid(data: HeatGridData) 方法，接收动态网格数据
  - 网格数据格式：{ cells: [{lon, lat, value}], bounds, resolution, timestamp, method }
  - 新增 setColorRamp(colors: string[]) 方法
  - 颜色映射：蓝(冷) → 绿 → 黄 → 橙 → 红(热)

**改造 frontend/dashboard/dashboard.js**：
  - init() 中初始化热力场轮询（每 1~5 分钟刷新）
  - 热力场数据更新时调用 RegionalHeatmapLayer.updateFromGrid()
  - 热力图图例 UI

---

## 六、舒适度评估（Phase 2）

推荐使用 UTCI（通用热气候指数），国际标准，输出 11 级分类：

| UTCI | 分类 | 颜色 |
|------|------|------|
| < -40°C | 强烈寒冷 | 深蓝 |
| -40~-28°C | 寒冷 | 蓝 |
| -28~-20°C | 很冷 | 浅蓝 |
| -20~-13°C | 冷 | 青 |
| -13~-6°C | 凉爽 | 绿 |
| -6~0°C | 微凉 | 浅绿 |
| 0~10°C | 舒适 | 亮绿 |
| 10~18°C | 微暖 | 浅黄 |
| 18~24°C | 暖 | 黄 |
| 24~30°C | 热 | 橙 |
| 30~36°C | 炎热 | 红 |
| > 36°C | 强烈炎热 | 深红 |

---

## 七、API 设计

### 热力场 API

GET /api/heatfield/current
  Query: resolution (默认 30m), bounds (bbox: minLon,minLat,maxLon,maxLat)
  Response: { success: true, data: { cells: [...], bounds, resolution, timestamp, method } }

GET /api/heatfield/point?lon=113.531&lat=34.815
  Response: { success: true, data: { temperature_c, uhi_intensity, surface_temp, humidity, comfort_level } }

POST /api/heatfield/whatif
  Body: { action: "add_building" | "remove_building", building: {...} }
  Response: { success: true, data: { delta_t_grid: [...], influence_radius, affected_area_km2 } }

### 传感器数据 API（后续）

GET /api/sensors
  Response: { items: [{ id, name, sensor_type, lon, lat, is_active, last_seen_at }] }

GET /api/sensors/{id}/latest
  Response: { sensor_id, temperature_c, humidity_pct, pressure_hpa, wind_speed, timestamp }

### 现有 API（勿破坏）

backend/main.py 中已实现的接口：
- GET /api/simulation/health
- GET /api/weather/current
- POST /api/simulation/buildings
- POST /api/simulation/what-if
- GET /api/simulation/scenarios
- GET /api/simulation/scenarios/{id}
- GET /api/simulation/scenarios/{id}/undo
- GET /api/simulation/stats
- GET /api/simulation/export
- GET /api/tracking/positions
- GET /api/tracking/positions/{id}

identification/ (port 5000):
- POST /api/detect
- GET /result/{filename}

---

## 八、完整架构蓝图（长期目标）

以下内容来自 v2.0 完整架构文档，代表系统的长期演进方向。当前阶段只需理解，不需要实现，但代码设计时要留好扩展接口。

### 8.1 四层架构

```
数据流入层（Data Ingestion）
  气象站网络（每分钟推送）| 遥感卫星（Landsat/Sentinel 定期）| UAV/UGV 实地勘察 | 人工上报

数据管道层（Data Pipeline）
  ETL Engine: Extract → Clean → Transform → Validate → Load

数据存储层（Dual Storage）
  PostgreSQL + PostGIS + pgvector（关系型/空间/向量）
  TimescaleDB（时序数据）
  Redis（缓存层）

向量化服务层（Vectorization）
  Embedding Pipeline: 原始数据 → 文本描述 → 向量化 → 质量检查 → 入库
  模型: BGE-M3 / GTE-ZH / ClimateBERT

RAG 检索增强层
  向量检索(top-30) + 全文检索 + 地理过滤(ST_DWithin) + 时空过滤
  RRF Fusion (k=60) → Cross-Encoder 重排 → 物理约束校验 → 置信度计算

AGI 推理层（DeepSeek V4）
  推理协调器 → 三路并行 Agent（气候推理 35%/建筑影响 50%/健康风险 15%）
  → 加权平均 → 物理方程校验 → 置信度计算 + 推理追溯日志
```

### 8.2 三路并行 Agent 设计

- Climate Reasoning Agent (35%): 大气环流、日变化规律
- Building Impact Agent (50%): 遮蔽效应、峡谷效应
- Health Risk Agent (15%): 热健康风险映射

置信度 = 0.4 × RAG + 0.3 × Physics + 0.2 × Temperature + 0.1 × Spatial

### 8.3 数据库完整设计

核心表：
- sensors: 传感器元数据（id, name, sensor_type, geom, is_active, last_seen_at, metadata）
- sensor_readings: TimescaleDB hypertable（temperature_c, humidity_pct, pressure_hpa, wind_speed_ms, wind_dir_deg）
- heatfield_snapshots: 热力场网格快照（grid_data BYTEA + metadata JSONB）
- buildings: 建筑表（扩展含 lcz_type, albedo, sky_view_factor, building_density）
- scenarios: What-If 场景表（含 parent_id 版本链）
- embeddings: 向量嵌入表（pgvector HNSW 索引）
- scene_snapshots: 场景快照
- health_risk_events: 健康风险事件

空间查询（PostGIS）：
- ST_DWithin（距离查询）
- ST_Intersects（相交查询）
- ST_ClusterKMeans（空间聚类）
- ST_Voronoi（泰森多边形）
- ST_Distance（距离计算）

### 8.4 后台管理系统（Admin Panel）

包含以下页面：
- 登录页（数据库账号登录）
- 系统概览仪表盘
- 模型管理（DeepSeek/GPT 等配置，API Key 加密存储）
- 数据库管理（连接、查询、备份）
- 向量库管理（重建索引、查看嵌入）
- 场景管理（查看/撤销 What-If 场景）
- 健康检查（各服务状态）
- 用户管理（角色、权限）
- 系统配置（告警阈值、物理方程参数）
- 日志查看（LLM 推理日志、操作日志）
- 告警记录管理
- 数据管道监控（ETL 任务状态）

### 8.5 实时数据流

- WebSocket / Server-Sent Events 推送实时气象数据
- 后端推送 → 前端更新：数值仪表盘刷新、热力图层动态更新、推理进度实时反馈、告警弹窗
- 消息队列：RabbitMQ / Redis Streams

---

## 九、实施顺序

### 第一步（立即开始）

1. 阅读完整架构文档（按第二章顺序）
2. 阅读 docs/PROMPT_FOR_NEW_AGENT.md
3. 理解 backend/main.py 的现有路由结构
4. 理解 src/cesium_core/layers/RegionalHeatmapLayer.ts 的现有实现
5. 理解 frontend/dashboard/dashboard.js 如何初始化和调用各模块

### 第二步（核心实现）

1. 创建 backend/services/heatfield_engine.py
   - 先实现 IDW 插值（用模拟传感器数据测试）
   - 加入水体和绿地的下垫面修正
   - 物理约束校验

2. 创建 backend/routers/heatfield.py
   - 实现 /api/heatfield/current 和 /api/heatfield/point

3. 改造 src/cesium_core/layers/RegionalHeatmapLayer.ts
   - 添加 updateFromGrid() 方法
   - 将网格数据转换为 Canvas 2D radial gradient 热力图

4. 创建 frontend/dashboard/api/heatfield.js
   - 调用后端热力场 API

5. 改造 frontend/dashboard/dashboard.js
   - 接入热力场数据轮询
   - 热力场更新时刷新 Cesium 热力图

### 第三步（UI 增强）

1. 热力图图例（显示温度→颜色映射）
2. 点击地图查询单点温度详情
3. What-If 热力场对比（基准 vs 修改后）

### 后续 Phase（按 v3.0 架构文档顺序）

- Phase 2: 舒适度评估体系（UTCI/PET/热指数）
- Phase 3: 数据库基础设施（PostgreSQL/PostGIS + 真库迁移）
- Phase 4: 真实数据接入（气象站 API + 卫星遥感）
- Phase 5: AGI 推理增强（DeepSeek V4 真接入）
- Phase 6: 后台管理系统
- Phase 7: 全链路联调

---

## 十、大屏布局（当前已实现）

```
+-----------------------------------------------------------------------------------+
|  HEADER: 系统标题 + 时间 + 实时气象概览 + 用户信息 + 全屏按钮                        |
+----------+---------------------------------------------------+--------------------+
|          |                                                   |                    |
|  LEFT    |              CENTER 3D MAP (Cesium)              |  RIGHT            |
|  PANEL   |                                                   |  PANEL            |
|          |  3D 建筑 + 热力场叠加 + 风场矢量                   |                    |
|  温度    |  监测点位 + What-If 影响圈                        |  湿度             |
|  降水    |  UAV/UGV 轨迹                                    |  风速             |
|  地表温度|                                                   |  太阳辐射         |
|  气压    |  +--------------------+                         |  能见度           |
|  风向    |  | ADD | REMOVE | 推演|                         |  AQI             |
|  今日降水|  +--------------------+                         |  热健康风险       |
|  植被覆盖|                                                   |  推理状态         |
+----------+---------------------------------------------------+--------------------+
|  FOOTER: 数据源标注 | 更新时间 | 系统状态 | 版本号                                |
+-----------------------------------------------------------------------------------+
```

---

## 十一、关键约束

1. **不破坏现有功能**：气象仪表盘、推理面板、追踪等功能必须继续正常工作
2. **向后兼容**：RegionalHeatmapLayer 的现有 HeatPoint[] 接口必须保留
3. **性能优先**：热力场计算在 5 秒内完成，Cesium 渲染流畅
4. **Mock 数据起步**：传感器数据先用内存模拟，等 Phase 3 数据库建立后替换为真库
5. **郑州区域**：所有硬编码的坐标/地名/水体边界围绕郑州大学校区
6. **不要改动 AGIReasoner 接口**：reason() 方法的签名不要改，后续会替换为真实 DeepSeek 调用

---

## 十二、调试与运行

### 启动后端
```powershell
cd g:\VIsual parts
cd backend
.\venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload --port 3000
```

### 启动前端
```powershell
cd g:\VIsual parts
npx vite
```

### 启动鸟类检测服务（独立）
```powershell
cd g:\VIsual parts
cd identification
python app.py
```

### 访问地址
- 大屏：http://localhost:5173/ (或 http://localhost:5173/index.html)
- 鸟类检测（独立）：http://localhost:5000/

---

## 十三、目录结构速查

```
g:\VIsual parts\
├── backend/
│   ├── main.py              ← FastAPI 入口，所有路由（~800行，待拆分）
│   ├── database.py           ← ORM 模型定义（待连接真库）
│   ├── requirements.txt
│   └── agi/
│       └── reasoner.py      ← AGIReasoner 类（reason() 方法接口勿改）
├── src/
│   └── cesium_core/
│       ├── core/
│       │   ├── ViewerManager.ts
│       │   └── constants.ts   ← ZZU_CAMERA_CONFIG: 113.531, 34.815
│       └── layers/
│           ├── RegionalHeatmapLayer.ts   ← 需改造：支持动态网格
│           ├── BuildingBuilderLayer.ts   ← 可用
│           ├── CampusTilesetLayer.ts    ← 可用
│           └── ImageryLayerManager.ts   ← 可用
├── frontend/
│   ├── dashboard/
│   │   ├── dashboard.js        ← 主逻辑，引用 ../../src/cesium_core/
│   │   ├── dashboard.css
│   │   ├── weather_panels.js    ← 可用
│   │   ├── health_panel.js     ← 可用
│   │   ├── reasoning_panel.js  ← 可用
│   │   ├── echarts_timeseries.js ← 可用
│   │   ├── tracking_layer.js   ← 可用
│   │   ├── tracking_panel.js   ← 可用
│   │   ├── tracking_map_window.js ← 有 bug 待修
│   │   └── shared/
│   │       └── api.js          ← 统一 API 客户端
│   ├── cesium/                 ← 与 src/cesium_core/ 并存，部分重复
│   └── index.html
├── identification/
│   ├── app.py                 ← Flask 服务，port 5000
│   └── model/
│       └── transformer.py      ← DETR 检测模型
├── visualheader/               ← 独立 Demo 页面，待归档
├── docs/
│   └── PROMPT_FOR_NEW_AGENT.md ← 项目上下文文档
├── vite.config.ts              ← Vite 构建配置（含代理规则）
├── package.json                ← cesium ^1.140.0, vite ^8.0.8
├── tsconfig.json               ← @/* → src/* 路径别名
└── index.html                  ← 大屏主入口
```

---

## 十四、其他注意事项

- backend/agi/reasoner.py 的 AGIReasoner 类接口（reason() 方法）不要改动，后续会替换为真实 DeepSeek 调用
- frontend/shared/api.js 是统一的 API 客户端，新 API 也通过这里封装
- vite.config.ts 中的代理规则已配置好，无需修改
- 郑州区域的水体边界数据可以从 OSM 的 natural=water 获取
- 如果需要卫星遥感数据（LCZ/NDVI），后续通过 Phase 4 接入
- v2.0 demo 计划中的详细 Mock API 代码示例（见微境智护_demo_快速交付计划）可作为参考，但当前 main.py 已经包含类似实现，无需重复
- visualheader/ 目录下的独立 Demo 页面（urban_heat_island_system.html, wetland.html 等）目前作为独立展示页面存在，未来逐步整合或归档

---

## 十五、术语表

| 术语 | 解释 |
|------|------|
| UHI | Urban Heat Island，城市热岛效应 |
| UTCI | Universal Thermal Climate Index，通用热气候指数 |
| PET | Physiological Equivalent Temperature，生理等效温度 |
| LCZ | Local Climate Zone，局地气候区分类 |
| NDVI | Normalized Difference Vegetation Index，归一化植被指数 |
| IDW | Inverse Distance Weighting，反距离加权插值 |
| Kriging | 克里金插值，基于空间自相关的地质统计方法 |
| SVF | Sky View Factor，天空视角因子 |
| HRI | Heat Risk Index，热健康风险指数 |
| RRF | Reciprocal Rank Fusion，排名融合算法 |
| HNSW | Hierarchical Navigable Small World，高维向量索引算法 |
