"""
微境智护 — FastAPI 后端（Mock 数据版）
端口 3000
"""

import uuid
import random
import math
import time
from datetime import datetime
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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

# What-If 物理方程参数
BETA = 0.4     # 遮蔽系数
ALPHA = 0.3    # 反照率
C_CAP = 20000   # 等效热容 J/m²K
R_M = 86400     # 日热松弛时间 s

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

    return {
        "temperature":      jitter(base["temperature"], 0.5),
        "humidity":        jitter(base["humidity"], 1.5),
        "surfaceTemp":     jitter(base["surfaceTemp"], 1.0),
        "pressure":        jitter(base["pressure"], 0.3),
        "windSpeed":      max(0, jitter(base["windSpeed"], 0.3)),
        "windDirection":   round(random.uniform(0, 360), 1),
        "solarRadiation": max(0, jitter(base["solarRadiation"], 20)),
        "uhiIntensity":   jitter(base["uhiIntensity"], 0.2),
        "aod":            jitter(base["aod"], 0.01),
        "precipitation":  0.0 if random.random() > 0.1 else round(random.uniform(0.1, 2.0), 1),
        "visibility":     jitter(base["visibility"], 0.5),
        "aqi":            max(0, int(jitter(base["aqi"], 5))),
        "comfortIndex":   jitter(base["comfortIndex"], 1.0),
        "uvIndex":        max(0, int(jitter(base["uvIndex"], 0.5))),
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

    # 物理方程计算温度变化
    temp_delta = compute_temp_delta(action, body.buildingInfo)

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
            "confidence": round(random.uniform(0.82, 0.96), 3),
            "totalTimeMs": elapsed,
            "reasoningSteps": [
                f"检测到 {action} 建筑操作，影响半径 {body.radiusMeters}m",
                f"物理方程计算：ΔT = β×h×(1-α)/(C×r_m)",
                f"结果：平均温度变化 {avg_delta:+.2f}°C",
                f"影响范围内 {len(updated_grids)} 个格点已更新",
            ],
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
# 启动入口
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000, reload=False)
