"""
微境智护 — FastAPI 后端（Mock 数据版）
端口 3000
"""

import os
import uuid
import random
import math
import time
from datetime import datetime
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    from backend.agi import AGIReasoner
    HAS_AGI = True
except ImportError:
    HAS_AGI = False

# =============================================================================
# FastAPI 应用初始化
# =============================================================================

app = FastAPI(
    title="微境智护 — 城市微气候决策支持系统",
    version="0.1.0-DEMO",
    description="Mock 数据版后端，供 Demo 前端调用 What-If 推演接口",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# Pydantic 请求/响应模型
# =============================================================================

class BuildingCreate(BaseModel):
    name: Optional[str] = None
    height: float
    albedo: float = 0.3
    baseTemp: float = 30.0
    lon: float
    lat: float
    building_type: Optional[str] = "commercial"


class BuildingResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


class WhatIfRequest(BaseModel):
    targetBuildingId: str
    action: str  # "ADD" | "REMOVE"
    radiusMeters: float = 100.0
    buildingInfo: Optional[dict] = None
    sourceScenarioId: Optional[str] = None


class WhatIfResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    data: Optional[dict] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str


class WeatherPoint(BaseModel):
    timestamp: str
    temperature: float
    humidity: float
    surfaceTemp: float
    pressure: float
    windSpeed: float
    windDirection: float
    solarRadiation: float
    uhiIntensity: float
    aqi: float


class WeatherResponse(BaseModel):
    success: bool
    data: dict
    source: str


# =============================================================================
# 内存状态（Demo 阶段，不使用数据库）
# =============================================================================

buildings_store: dict[str, dict] = {}
scenarios_store: dict[str, dict] = {}

# 郑大主校区中心坐标
CAMPUS_LNG = 113.531
CAMPUS_LAT = 34.815

# =============================================================================
# 追踪实体内存存储
# =============================================================================

_tracking_entities: dict[str, dict] = {}

# ─── 预设巡航路径 ──────────────────────────────────────────────────────
# 每个实体沿预设航点循环移动，模拟真实任务路线
_CRUISE_PATHS = {
    "drone_001": {
        "name": "巡检无人机-01", "type": "drone",
        "altitude": 80.0, "speed": 8.5,
        "path": [
            (113.531, 34.815), (113.534, 34.816), (113.536, 34.814),
            (113.535, 34.812), (113.533, 34.811), (113.530, 34.813),
        ],
    },
    "drone_002": {
        "name": "巡检无人机-02", "type": "drone",
        "altitude": 120.0, "speed": 6.2,
        "path": [
            (113.529, 34.817), (113.531, 34.819),
            (113.533, 34.818), (113.532, 34.816),
        ],
    },
    "drone_003": {
        "name": "环境监测无人机", "type": "drone",
        "altitude": 60.0, "speed": 5.0,
        "path": [
            (113.527, 34.814), (113.529, 34.812), (113.531, 34.813),
            (113.532, 34.816), (113.530, 34.817), (113.528, 34.815),
        ],
    },
    "car_001": {
        "name": "巡逻小车-01", "type": "car",
        "altitude": 0.0, "speed": 3.2,
        "path": [
            (113.530, 34.814), (113.532, 34.815), (113.534, 34.813),
            (113.533, 34.811), (113.531, 34.812), (113.529, 34.813),
        ],
    },
    "car_002": {
        "name": "物资运输车", "type": "car",
        "altitude": 0.0, "speed": 2.8,
        "path": [
            (113.535, 34.816), (113.536, 34.814), (113.534, 34.812),
            (113.532, 34.813), (113.531, 34.815), (113.533, 34.817),
        ],
    },
}


def _init_tracking_entities():
    """初始化追踪实体状态"""
    global _tracking_entities
    _tracking_entities = {}
    for id_, cfg in _CRUISE_PATHS.items():
        _tracking_entities[id_] = {
            "id": id_,
            "name": cfg["name"],
            "type": cfg["type"],
            "altitude": cfg["altitude"],
            "speed": cfg["speed"],
            "status": "active",
            "path_index": 0,
            "segment_progress": 0.0,
            "trajectory": [],
            "lon": cfg["path"][0][0],
            "lat": cfg["path"][0][1],
            "heading": 0.0,
        }


def _step_entity(entity_id: str) -> dict:
    """
    沿预设巡航路径推进实体位置（线性插值 + 循环路径）
    后续真实接入时：替换此函数，直接从 GPS 设备 / MQTT / WebSocket 读取数据
    """
    cfg = _CRUISE_PATHS[entity_id]
    entity = _tracking_entities[entity_id]
    path = cfg["path"]

    from_pt = path[entity["path_index"]]
    to_pt = path[(entity["path_index"] + 1) % len(path)]

    # 推进进度（speed 越大移动越快）
    step_size = 0.03 + cfg["speed"] / 200
    entity["segment_progress"] += step_size
    if entity["segment_progress"] >= 1.0:
        entity["segment_progress"] = 0.0
        entity["path_index"] = (entity["path_index"] + 1) % len(path)
        from_pt = path[entity["path_index"]]
        to_pt = path[(entity["path_index"] + 1) % len(path)]

    t = entity["segment_progress"]
    entity["lon"] = round(from_pt[0] + (to_pt[0] - from_pt[0]) * t, 7)
    entity["lat"] = round(from_pt[1] + (to_pt[1] - from_pt[1]) * t, 7)

    # 计算航向角（度）
    dlon = to_pt[0] - from_pt[0]
    dlat = to_pt[1] - from_pt[1]
    import math
    entity["heading"] = round((math.atan2(dlon, dlat) * 180 / math.pi + 360) % 360, 1)

    ts = datetime.now().isoformat()
    entity["trajectory"].append({"lon": entity["lon"], "lat": entity["lat"], "ts": ts})
    if len(entity["trajectory"]) > 30:
        entity["trajectory"].pop(0)

    return {
        "id": entity_id,
        "name": entity["name"],
        "type": entity["type"],
        "lon": entity["lon"],
        "lat": entity["lat"],
        "altitude": entity["altitude"],
        "heading": entity["heading"],
        "speed": entity["speed"],
        "status": entity["status"],
        "timestamp": ts,
        "trajectory": list(entity["trajectory"]),
    }


_init_tracking_entities()


# What-If 物理方程参数
BETA = 0.4     # 遮蔽系数
ALPHA = 0.3    # 反照率
C_CAP = 20000   # 等效热容 J/m²K
R_M = 86400     # 日热松弛时间 s

# AGI 推理引擎（环境变量 USE_MOCK_AGI=1 时强制使用 Mock）
_agi: Optional[object] = None
if HAS_AGI and os.environ.get("USE_MOCK_AGI", "0") != "1":
    _agi = AGIReasoner()

# 郑州夏季基准气象数据
BASE_TEMP = 32.5      # 基准气温 °C
BASE_HUMIDITY = 68.0  # 基准相对湿度 %
BASE_PRESSURE = 1005   # 基准气压 hPa
BASE_WIND_SPEED = 2.1 # 基准风速 m/s
BASE_UHI = 3.2        # 基准热岛强度 °C


# =============================================================================
# 辅助函数
# =============================================================================

def compute_temp_delta(action: str, building_info: Optional[dict]) -> float:
    """
    Mock What-If 物理方程
    ΔT = β * h * (1 - α) / (C * r_m) * scale
    ADD   → ΔT 为正（升温）
    REMOVE → ΔT 为负（降温）
    """
    h = building_info.get("height", 30) if building_info else 30
    scale = h / 30.0  # 归一化到基准建筑高度

    raw = BETA * h * (1 - ALPHA) / (C_CAP * R_M) * 1e9

    if action == "ADD":
        return round(raw * scale, 4)
    else:  # REMOVE
        return round(-raw * scale, 4)


def generate_grid_points(lon: float, lat: float, radius_m: float, n: int = 12) -> list[dict]:
    """以 (lon, lat) 为中心，在 radius_m 范围内生成 n 个模拟格点"""
    results = []
    for i in range(n):
        angle = 2 * math.pi * i / n
        r_ratio = 0.3 + 0.7 * (i % 3) / 2  # 0.3~1.0 随机分布
        dlng = (radius_m * r_ratio * math.cos(angle)) / 111000
        dlat = (radius_m * r_ratio * math.sin(angle)) / 111000
        results.append({
            "lon": round(lon + dlng, 6),
            "lat": round(lat + dlat, 6),
        })
    return results


def get_mock_weather(base: dict) -> dict:
    """在基准数据上加小幅随机波动，模拟实时数据"""
    def jitter(v, r):
        return round(v + random.uniform(-r, r), 1)

    temp = jitter(base["temperature"], 0.5)
    humid = jitter(base["humidity"], 1.5)
    wind = max(0, jitter(base["windSpeed"], 0.3))
    heat_risk = min(100, max(0, int(0.7 * temp + 0.3 * humid + random.uniform(-3, 3))))

    return {
        "temperature":      temp,
        "humidity":        humid,
        "surfaceTemp":     jitter(base["surfaceTemp"], 1.0),
        "pressure":        jitter(base["pressure"], 0.3),
        "windSpeed":       wind,
        "windDirection":   round(random.uniform(0, 360), 1),
        "solarRadiation": max(0, jitter(base["solarRadiation"], 20)),
        "uhiIntensity":   jitter(base["uhiIntensity"], 0.2),
        "aod":            jitter(base["aod"], 0.01),
        "precipitation":  0.0 if random.random() > 0.1 else round(random.uniform(0.1, 2.0), 1),
        "visibility":     jitter(base["visibility"], 0.5),
        "aqi":            max(0, int(jitter(base["aqi"], 5))),
        "comfortIndex":   jitter(base["comfortIndex"], 1.0),
        "uvIndex":        max(0, int(jitter(base["uvIndex"], 0.5))),
        "heatHealthRisk": heat_risk,
    }


# =============================================================================
# 基准气象数据
# =============================================================================

BASE_WEATHER = {
    "temperature":     BASE_TEMP,
    "humidity":       BASE_HUMIDITY,
    "surfaceTemp":    BASE_TEMP + 8.0,
    "pressure":       BASE_PRESSURE,
    "windSpeed":      BASE_WIND_SPEED,
    "solarRadiation": 680.0,
    "uhiIntensity":   BASE_UHI,
    "aod":            0.35,
    "visibility":     12.0,
    "aqi":            62,
    "comfortIndex":   88.0,
    "uvIndex":        6,
    "heatHealthRisk": 70,
}


# =============================================================================
# API 路由
# =============================================================================

@app.get("/api/simulation/health", response_model=HealthResponse, tags=["simulation"])
async def health_check():
    """健康检查"""
    return HealthResponse(
        status="ok",
        version="0.1.0-DEMO",
        timestamp=datetime.now().isoformat(),
    )


@app.get("/api/weather/current", response_model=WeatherResponse, tags=["weather"])
async def get_current_weather():
    """当前气象数据（每分钟微小波动）"""
    data = get_mock_weather(BASE_WEATHER)
    return WeatherResponse(
        success=True,
        data=data,
        source="Mock-API",
    )


@app.post("/api/simulation/buildings", response_model=BuildingResponse, tags=["simulation"])
async def create_building(body: BuildingCreate):
    """将新建建筑写入数据库（Mock）"""
    building_id = str(uuid.uuid4())
    record = {
        "id": building_id,
        "name": body.name or f"Building_{building_id[:8]}",
        "height": body.height,
        "albedo": body.albedo,
        "baseTemp": body.baseTemp,
        "lon": body.lon,
        "lat": body.lat,
        "createdAt": datetime.now().isoformat(),
    }
    buildings_store[building_id] = record
    return BuildingResponse(
        success=True,
        message="建筑已创建（Mock）",
        data={"id": building_id, **record},
    )


@app.post("/api/simulation/what-if", response_model=WhatIfResponse, tags=["simulation"])
async def what_if_simulation(body: WhatIfRequest):
    """What-If 推演核心接口"""
    start = time.time()

    action = body.action.upper()
    if action not in ("ADD", "REMOVE"):
        return WhatIfResponse(
            success=False,
            message=f"未知操作类型: {action}，仅支持 ADD / REMOVE",
        )

    lon = CAMPUS_LNG
    lat = CAMPUS_LAT
    if body.buildingInfo:
        lon = body.buildingInfo.get("lon", CAMPUS_LNG)
        lat = body.buildingInfo.get("lat", CAMPUS_LAT)

    # 获取当前气象上下文
    current_weather = get_mock_weather(BASE_WEATHER)
    context = {
        "temperature": current_weather["temperature"],
        "humidity": current_weather["humidity"],
        "windSpeed": current_weather["windSpeed"],
        "solarRadiation": current_weather["solarRadiation"],
    }

    # 根据配置决定调用 Mock 还是 AGI 推理
    if _agi is not None and os.environ.get("USE_MOCK_AGI", "0") != "1":
        agi_result = await _agi.reason(body.buildingInfo or {}, action, context)
        temp_delta = agi_result["tempDelta"]
        confidence = agi_result["confidence"]
        reasoning_steps = agi_result.get("reasoningSteps", [])
        reasoning_model = agi_result.get("model", "unknown")
        print(f"[What-If] 使用 AGI 推理引擎: {reasoning_model}")
    else:
        temp_delta = compute_temp_delta(action, body.buildingInfo)
        confidence = round(random.uniform(0.82, 0.96), 3)
        reasoning_steps = [
            f"检测到 {action} 建筑操作，影响半径 {body.radiusMeters}m",
            "物理方程计算：ΔT = β×h×(1-α)/(C×r_m)",
            f"结果：平均温度变化 {temp_delta:+.2f}°C",
            "影响范围内 12 个格点已更新",
        ]

    # 生成受影响格点
    grids = generate_grid_points(lon, lat, body.radiusMeters, n=12)
    updated_grids = []
    for g in grids:
        dist_factor = 1.0 - (random.random() * 0.4)  # 0.6~1.0 距离衰减
        g_delta = round(temp_delta * dist_factor, 4)
        updated_grids.append({
            **g,
            "tempDelta": g_delta,
            "confidence": round(random.uniform(0.72, 0.96), 3),
        })

    avg_delta = round(sum(g["tempDelta"] for g in updated_grids) / len(updated_grids), 4)

    # 生成 scenario ID
    scenario_id = str(uuid.uuid4())

    # 存储场景记录
    scenario_record = {
        "id": scenario_id,
        "action": action,
        "targetBuildingId": body.targetBuildingId,
        "buildingInfo": body.buildingInfo,
        "radiusMeters": body.radiusMeters,
        "tempDelta": avg_delta,
        "totalGrids": len(updated_grids),
        "createdAt": datetime.now().isoformat(),
    }
    scenarios_store[scenario_id] = scenario_record

    elapsed = round((time.time() - start) * 1000, 1)

    return WhatIfResponse(
        success=True,
        data={
            "scenarioId": scenario_id,
            "action": action,
            "averageTempDelta": avg_delta,
            "maxTempDelta": round(max(g["tempDelta"] for g in updated_grids), 4),
            "minTempDelta": round(min(g["tempDelta"] for g in updated_grids), 4),
            "updatedGrids": updated_grids,
            "confidence": confidence,
            "totalTimeMs": elapsed,
            "reasoningSteps": reasoning_steps,
        },
    )


@app.get("/api/simulation/scenarios/{scenario_id}", tags=["simulation"])
async def get_scenario(scenario_id: str):
    """获取场景详情"""
    record = scenarios_store.get(scenario_id)
    if not record:
        return {"success": False, "message": f"场景 {scenario_id} 不存在"}
    return {"success": True, "data": record}


@app.get("/api/simulation/scenarios/{scenario_id}/undo", tags=["simulation"])
async def undo_scenario(scenario_id: str):
    """撤销场景（Mock：删除记录，返回原热力场）"""
    record = scenarios_store.pop(scenario_id, None)
    if not record:
        return {"success": False, "message": f"场景 {scenario_id} 不存在或已被撤销"}
    return {
        "success": True,
        "message": f"场景 {scenario_id} 已撤销",
        "data": {
            "restoredGrids": record.get("totalGrids", 0),
            "tempDeltaReversed": -record.get("tempDelta", 0),
        },
    }


@app.get("/api/simulation/stats", tags=["simulation"])
async def get_stats():
    """全局统计"""
    return {
        "success": True,
        "data": {
            "buildingsCount": len(buildings_store),
            "scenariosCount": len(scenarios_store),
            "mockMode": True,
        },
    }


# =============================================================================
# 多场景 & 导出
# =============================================================================

@app.get("/api/simulation/scenarios", tags=["simulation"])
async def list_scenarios():
    """获取所有场景列表"""
    records = [
        {
            "id": sid,
            "action": rec.get("action"),
            "targetBuildingId": rec.get("targetBuildingId"),
            "tempDelta": rec.get("tempDelta"),
            "radiusMeters": rec.get("radiusMeters"),
            "createdAt": rec.get("createdAt"),
        }
        for sid, rec in scenarios_store.items()
    ]
    return {"success": True, "data": records, "total": len(records)}


@app.get("/api/simulation/export", response_class=JSONResponse, tags=["simulation"])
async def export_report():
    """导出推演报告（Markdown 格式）"""
    import json as _json

    md_lines = [
        "# 微境智护 What-If 推演报告",
        "",
        f"**生成时间**: {datetime.now().isoformat()}",
        f"**数据源**: Mock API",
        "",
        "## 场景列表",
        "",
    ]

    if scenarios_store:
        md_lines.append("| 场景ID | 操作 | 建筑 | 温度变化 | 半径 | 时间 |")
        md_lines.append("|--------|------|------|----------|------|------|")
        for sid, rec in scenarios_store.items():
            short_id = sid[:8]
            action = rec.get("action", "-")
            bname = rec.get("buildingInfo", {}).get("name", "-")
            delta = rec.get("tempDelta", 0)
            radius = rec.get("radiusMeters", "-")
            created = rec.get("createdAt", "-")
            sign = "+" if delta >= 0 else ""
            md_lines.append(f"| `{short_id}` | {action} | {bname} | {sign}{delta:.4f}°C | {radius}m | {created} |")
    else:
        md_lines.append("* 暂无场景记录*")

    md_lines.extend([
        "",
        "## 气象数据摘要",
        "",
        f"- 基准气温: {BASE_TEMP}°C",
        f"- 基准湿度: {BASE_HUMIDITY}%",
        f"- 热岛强度: {BASE_UHI}°C",
        f"- 热健康风险: {BASE_WEATHER.get('heatHealthRisk', 70)}",
        "",
        "---",
        "*由微境智护系统自动生成*",
    ])

    report = "\n".join(md_lines)
    return {
        "success": True,
        "data": {
            "format": "markdown",
            "content": report,
            "filename": f"weijing_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md",
        },
    }


# =============================================================================
# 无人机/小车追踪 API
# =============================================================================

class TrackingEntity(BaseModel):
    id: str
    name: str
    type: str
    lon: float
    lat: float
    altitude: float = 0.0
    heading: float = 0.0
    speed: float = 0.0
    status: str = "active"
    timestamp: str = ""
    trajectory: list = []


class TrackingResponse(BaseModel):
    success: bool
    entities: list
    timestamp: str


@app.get("/api/tracking/positions", response_model=TrackingResponse, tags=["tracking"])
async def get_tracking_positions():
    """
    获取所有追踪实体的实时位置（无人机 + 小车）
    每次请求自动推进模拟步进
    """
    entities = [_step_entity(id_) for id_ in _tracking_entities]
    return TrackingResponse(
        success=True,
        entities=entities,
        timestamp=datetime.now().isoformat(),
    )


@app.get("/api/tracking/positions/{entity_id}", tags=["tracking"])
async def get_single_tracking_position(entity_id: str):
    """获取指定实体的实时位置"""
    if entity_id not in _tracking_entities:
        return {"success": False, "message": f"实体 {entity_id} 不存在"}
    data = _step_entity(entity_id)
    return {"success": True, "data": data}


# =============================================================================
# 启动入口
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000, reload=False)
