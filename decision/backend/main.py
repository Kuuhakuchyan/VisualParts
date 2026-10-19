"""微境探界 — 决策推演 API；天气取自 Open-Meteo，空间推演仍属演示。"""

import json
import logging
import os
import uuid
import random
import math
import sqlite3
import tempfile
import threading
import time
import httpx
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

try:
    from backend.agi import AGIReasoner
    HAS_AGI = True
except ImportError:
    HAS_AGI = False

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("decision-api")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("invalid integer env %s=%r, using %s", name, os.getenv(name), default)
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("invalid float env %s=%r, using %s", name, os.getenv(name), default)
        return default


APP_VERSION = os.getenv("APP_VERSION", "0.1.0-DEMO")
RATE_LIMIT_PER_MINUTE = _env_int("DECISION_RATE_LIMIT_PER_MINUTE", 240)
WRITE_RATE_LIMIT_PER_MINUTE = _env_int("DECISION_WRITE_RATE_LIMIT_PER_MINUTE", 60)
WEATHER_CACHE_SECONDS = _env_float("DECISION_WEATHER_CACHE_SECONDS", 120.0)
TRACKING_CACHE_SECONDS = _env_float("DECISION_TRACKING_CACHE_SECONDS", 0.8)

# =============================================================================
# FastAPI 应用初始化
# =============================================================================

app = FastAPI(
    title="微境探界 — 城市微气候决策支持系统",
    version=APP_VERSION,
    description="提供空间推演演示接口，以及标明来源的区域天气估计",
)

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "https://weather.nogamenolife.cn,http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv(
        "ALLOWED_HOSTS",
        "weather.nogamenolife.cn,localhost,127.0.0.1",
    ).split(",")
    if host.strip()
]
if ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

_rate_windows: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = threading.Lock()
_ttl_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limit_retry_after(request: Request) -> Optional[float]:
    path = request.url.path
    if path in {"/health", "/api/simulation/health"} or path.startswith(("/docs", "/redoc", "/openapi.json")):
        return None

    is_write = request.method.upper() not in {"GET", "HEAD", "OPTIONS"}
    limit = WRITE_RATE_LIMIT_PER_MINUTE if is_write else RATE_LIMIT_PER_MINUTE
    if limit <= 0:
        return None

    now = time.monotonic()
    window_start = now - 60.0
    bucket = "write" if is_write else "read"
    key = f"{_client_ip(request)}:{bucket}"

    with _rate_lock:
        q = _rate_windows[key]
        while q and q[0] < window_start:
            q.popleft()
        if len(q) >= limit:
            return max(0.0, 60.0 - (now - q[0]))
        q.append(now)
    return None


def _cache_get(key: str, ttl_seconds: float):
    if ttl_seconds <= 0:
        return None
    now = time.monotonic()
    with _cache_lock:
        item = _ttl_cache.get(key)
        if not item:
            return None
        expires_at, value = item
        if expires_at <= now:
            _ttl_cache.pop(key, None)
            return None
        return value


def _cache_set(key: str, value: object, ttl_seconds: float) -> None:
    if ttl_seconds <= 0:
        return
    with _cache_lock:
        _ttl_cache[key] = (time.monotonic() + ttl_seconds, value)


@app.middleware("http")
async def request_guard_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    start = time.perf_counter()

    retry_after = _rate_limit_retry_after(request)
    try:
        if retry_after is not None:
            response = JSONResponse(
                status_code=429,
                content={
                    "success": False,
                    "message": "请求过于频繁，请稍后再试",
                    "requestId": request_id,
                },
            )
            response.headers["Retry-After"] = str(max(1, math.ceil(retry_after)))
        else:
            response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "request_failed id=%s method=%s path=%s elapsed_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise

    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.1f}"
    response.headers["X-Decision-API-Version"] = APP_VERSION
    logger.info(
        "request id=%s method=%s path=%s status=%s elapsed_ms=%.1f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response

# =============================================================================
# Pydantic 请求/响应模型
# =============================================================================

class BuildingCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    height: float = Field(gt=0, le=300)
    albedo: float = Field(default=0.3, ge=0, le=1)
    baseTemp: float = Field(default=30.0, ge=-30, le=80)
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    building_type: Optional[str] = "commercial"


class BuildingResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


class WhatIfRequest(BaseModel):
    targetBuildingId: str = Field(min_length=1, max_length=120)
    action: str  # "ADD" | "REMOVE"
    radiusMeters: float = Field(default=100.0, ge=10, le=1000)
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
    message: Optional[str] = None
    observedAt: Optional[str] = None
    location: Optional[str] = None


# =============================================================================
# 轻量状态存储（Demo 阶段使用 SQLite，便于多 worker 共享）
# =============================================================================

STATE_DB_PATH = Path(
    os.getenv(
        "DECISION_STATE_DB",
        str(Path(tempfile.gettempdir()) / "microclimate_decision.sqlite3"),
    )
)
_state_lock = threading.Lock()
_state_tables = {"buildings", "scenarios"}


def _connect_state_db() -> sqlite3.Connection:
    STATE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(STATE_DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_state_store() -> None:
    with _state_lock:
        with _connect_state_db() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS buildings (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scenarios (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )


def _assert_state_table(table: str) -> str:
    if table not in _state_tables:
        raise ValueError(f"unsupported state table: {table}")
    return table


def _state_save(table: str, record_id: str, record: dict) -> None:
    table = _assert_state_table(table)
    payload = json.dumps(record, ensure_ascii=False)
    created_at = record.get("createdAt") or datetime.now().isoformat()
    with _state_lock:
        with _connect_state_db() as conn:
            conn.execute(
                f"""
                INSERT INTO {table} (id, payload, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    payload = excluded.payload,
                    created_at = excluded.created_at
                """,
                (record_id, payload, created_at),
            )


def _state_get(table: str, record_id: str) -> Optional[dict]:
    table = _assert_state_table(table)
    with _connect_state_db() as conn:
        row = conn.execute(f"SELECT payload FROM {table} WHERE id = ?", (record_id,)).fetchone()
    return json.loads(row["payload"]) if row else None


def _state_delete(table: str, record_id: str) -> Optional[dict]:
    table = _assert_state_table(table)
    with _state_lock:
        with _connect_state_db() as conn:
            row = conn.execute(f"SELECT payload FROM {table} WHERE id = ?", (record_id,)).fetchone()
            if not row:
                return None
            conn.execute(f"DELETE FROM {table} WHERE id = ?", (record_id,))
    return json.loads(row["payload"])


def _state_list(table: str) -> list[dict]:
    table = _assert_state_table(table)
    with _connect_state_db() as conn:
        rows = conn.execute(f"SELECT payload FROM {table} ORDER BY created_at DESC").fetchall()
    return [json.loads(row["payload"]) for row in rows]


def _state_count(table: str) -> int:
    table = _assert_state_table(table)
    with _connect_state_db() as conn:
        row = conn.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
    return int(row["count"]) if row else 0


_init_state_store()

# 郑大主校区中心坐标
CAMPUS_LNG = 113.531
CAMPUS_LAT = 34.815

# =============================================================================
# 追踪实体内存存储
# =============================================================================

_tracking_entities: dict[str, dict] = {}
_tracking_lock = threading.Lock()

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
        version=APP_VERSION,
        timestamp=datetime.now().isoformat(),
    )


@app.get("/health", tags=["ops"])
async def operational_health():
    """容器健康检查与运维探针"""
    return {
        "status": "ok",
        "version": APP_VERSION,
        "timestamp": datetime.now().isoformat(),
        "stateBackend": "sqlite",
        "buildingsCount": _state_count("buildings"),
        "scenariosCount": _state_count("scenarios"),
    }


@app.get("/api/weather/current", response_model=WeatherResponse, tags=["weather"])
async def get_current_weather(response: Response):
    """中原区附近的 Open-Meteo 模型估计；不是校园站点实测。"""
    cached = _cache_get("weather.current", WEATHER_CACHE_SECONDS)
    if cached:
        response.headers["Cache-Control"] = "no-store"
        return cached
    response.headers["Cache-Control"] = "no-store"
    params = {
        "latitude": 34.75,
        "longitude": 113.61,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,shortwave_radiation",
        "wind_speed_unit": "ms",
        "timezone": "Asia/Shanghai",
        "forecast_days": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            upstream = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            upstream.raise_for_status()
            upstream_data = upstream.json()
            current = upstream_data["current"]
        required = ("temperature_2m", "relative_humidity_2m", "time")
        if any(current.get(field) is None for field in required):
            raise ValueError("missing required current weather fields")
        fields = {
            "temperature": "temperature_2m",
            "humidity": "relative_humidity_2m",
            "apparentTemperature": "apparent_temperature",
            "pressure": "surface_pressure",
            "windSpeed": "wind_speed_10m",
            "windDirection": "wind_direction_10m",
            "precipitation": "precipitation",
            "solarRadiation": "shortwave_radiation",
        }
        data = {key: current[value] for key, value in fields.items() if current.get(value) is not None}
        grid_lat = upstream_data["latitude"]
        grid_lon = upstream_data["longitude"]
        payload = WeatherResponse(
            success=True, data=data, source="Open-Meteo model",
            location=f"郑州市中原区附近网格（{grid_lat:.3f}°N, {grid_lon:.3f}°E）",
            observedAt=f"{current['time']}+08:00",
            message="网格模型估计，非校园站点实测；热岛强度、AQI 等无可靠数据时不显示。",
        )
        _cache_set("weather.current", payload, WEATHER_CACHE_SECONDS)
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        logger.warning("Open-Meteo weather unavailable: %s", exc)
        payload = WeatherResponse(success=False, data={}, source="Open-Meteo model", message="天气服务暂不可用")
    return payload


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
    _state_save("buildings", building_id, record)
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
    _state_save("scenarios", scenario_id, scenario_record)

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
    record = _state_get("scenarios", scenario_id)
    if not record:
        return {"success": False, "message": f"场景 {scenario_id} 不存在"}
    return {"success": True, "data": record}


@app.get("/api/simulation/scenarios/{scenario_id}/undo", tags=["simulation"])
async def undo_scenario(scenario_id: str):
    """撤销场景（Mock：删除记录，返回原热力场）"""
    record = _state_delete("scenarios", scenario_id)
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
            "buildingsCount": _state_count("buildings"),
            "scenariosCount": _state_count("scenarios"),
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
            "id": rec.get("id"),
            "action": rec.get("action"),
            "targetBuildingId": rec.get("targetBuildingId"),
            "tempDelta": rec.get("tempDelta"),
            "radiusMeters": rec.get("radiusMeters"),
            "createdAt": rec.get("createdAt"),
        }
        for rec in _state_list("scenarios")
    ]
    return {"success": True, "data": records, "total": len(records)}


@app.get("/api/simulation/export", response_class=JSONResponse, tags=["simulation"])
async def export_report():
    """导出推演报告（Markdown 格式）"""
    import json as _json

    md_lines = [
        "# 微境探界 What-If 推演报告",
        "",
        f"**生成时间**: {datetime.now().isoformat()}",
        f"**数据源**: Mock API",
        "",
        "## 场景列表",
        "",
    ]

    scenarios = _state_list("scenarios")
    if scenarios:
        md_lines.append("| 场景ID | 操作 | 建筑 | 温度变化 | 半径 | 时间 |")
        md_lines.append("|--------|------|------|----------|------|------|")
        for rec in scenarios:
            sid = rec.get("id", "")
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
        "*由微境探界系统自动生成*",
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
async def get_tracking_positions(response: Response):
    """
    获取所有追踪实体的实时位置（无人机 + 小车）
    每次请求自动推进模拟步进
    """
    cached = _cache_get("tracking.positions", TRACKING_CACHE_SECONDS)
    if cached:
        response.headers["Cache-Control"] = f"public, max-age={max(1, int(math.ceil(TRACKING_CACHE_SECONDS)))}"
        return cached

    with _tracking_lock:
        entities = [_step_entity(id_) for id_ in _tracking_entities]
    payload = TrackingResponse(
        success=True,
        entities=entities,
        timestamp=datetime.now().isoformat(),
    )
    _cache_set("tracking.positions", payload, TRACKING_CACHE_SECONDS)
    response.headers["Cache-Control"] = f"public, max-age={max(1, int(math.ceil(TRACKING_CACHE_SECONDS)))}"
    return payload


@app.get("/api/tracking/positions/{entity_id}", tags=["tracking"])
async def get_single_tracking_position(entity_id: str):
    """获取指定实体的实时位置"""
    if entity_id not in _tracking_entities:
        return {"success": False, "message": f"实体 {entity_id} 不存在"}
    with _tracking_lock:
        data = _step_entity(entity_id)
    return {"success": True, "data": data}


# =============================================================================
# 启动入口
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000, reload=False)
    
    
    
    
    
    
