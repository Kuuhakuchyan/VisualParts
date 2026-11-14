"""
IoT 平台对外 API + 可视化仪表盘
- RESTful 数据查询
- CSV 数据导出
- 趋势图、数据表格、高德地图
"""

import asyncio
import csv
import hmac
import io
import json
import logging
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse, RedirectResponse, JSONResponse
from starlette.requests import ClientDisconnect
import asyncpg
from pydantic import BaseModel, ConfigDict, Field, model_validator

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("weather-api")

app = FastAPI(title="微境探界 IoT Platform API", docs_url=None, redoc_url=None, openapi_url=None)
BASE_DIR = Path(__file__).resolve().parent

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("ALLOWED_HOSTS", "").split(",")
    if host.strip()
]
if ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, error: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": [
        {key: item[key] for key in ("loc", "msg", "type") if key in item}
        for item in error.errors()
    ]})


async def bounded_body(request: Request):
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return None
    limit = 262144
    length = request.headers.get("content-length")
    if length is not None and (not length.isdecimal() or len(length) > 10):
        return JSONResponse(status_code=400, content={"detail": "invalid request length"})
    if length is not None and int(length) > limit:
        return JSONResponse(status_code=413, content={"detail": "request body too large"})
    body = bytearray()
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                if len(body) + len(chunk) > limit:
                    return JSONResponse(status_code=413, content={"detail": "request body too large"})
                body.extend(chunk)
    except TimeoutError:
        return JSONResponse(status_code=408, content={"detail": "request upload timeout"})
    except ClientDisconnect:
        return JSONResponse(status_code=400, content={"detail": "request upload interrupted"})
    request._body = bytes(body)
    return None


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    supplied_id = request.headers.get("x-request-id", "")
    request_id = supplied_id if re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", supplied_id) else uuid.uuid4().hex[:16]
    start = time.perf_counter()
    try:
        response = await bounded_body(request)
        if response is None:
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
        response = JSONResponse(status_code=500, content={"detail": "service temporarily unavailable", "requestId": request_id})

    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    if response.status_code >= 400:
        response.headers["Cache-Control"] = "no-store"
    logger.info(
        "request id=%s method=%s path=%s status=%s elapsed_ms=%.1f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response

PG_CONFIG = {
    "host": os.getenv("PG_HOST", "postgres"),
    "port": int(os.getenv("PG_PORT", "5432")),
    "database": os.getenv("PG_DB", "iot_platform"),
    "user": os.getenv("PG_USER", "iot_user"),
    "password": os.getenv("PG_PASS", ""),
}

AMAP_KEY = os.getenv("AMAP_WEB_KEY", "")       # Web服务 (WiFi定位)
AMAP_JS_KEY = os.getenv("AMAP_JS_KEY", "")     # JS API (地图)
API_WRITE_TOKEN = os.getenv("API_WRITE_TOKEN", "")


async def require_write_token(x_api_key: str = Header(default="")):
    """A missing credential configuration must never open the write endpoint."""
    if not API_WRITE_TOKEN:
        raise HTTPException(status_code=503, detail="write access is not configured")
    if not hmac.compare_digest(x_api_key, API_WRITE_TOKEN):
        raise HTTPException(status_code=401, detail="invalid API key")


_pool_lock = asyncio.Lock()


async def get_pool():
    async with _pool_lock:
        if not hasattr(app.state, "pool"):
            app.state.pool = await asyncpg.create_pool(
                **PG_CONFIG,
                min_size=int(os.getenv("PG_POOL_MIN", "2")),
                max_size=int(os.getenv("PG_POOL_MAX", "10")),
            )
    return app.state.pool


@app.get("/logo.png")
async def logo():
    return FileResponse("logo.png")


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(BASE_DIR / "logo.png", media_type="image/png")


@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "pool"):
        await app.state.pool.close()


# ====================================================================
# API 端点
# ====================================================================

@app.get("/api/devices")
async def devices():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT device_id, device_type, last_seen,
                   last_seen > now() - interval '5 minutes' AS online
            FROM device_info
            WHERE device_id != 'unknown'
            ORDER BY last_seen DESC
        """)
        return [dict(r) for r in rows]


@app.get("/api/latest/{device_id}")
async def latest(device_id: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT s.ts, s.temp_c, s.humidity, s.bat_v, s.uptime_s, s.extra,
                   ST_Y(l.geom) AS lat, ST_X(l.geom) AS lon
            FROM sensor_data s
            LEFT JOIN LATERAL (
                SELECT geom FROM device_location
                WHERE device_id = s.device_id
                ORDER BY ts DESC LIMIT 1
            ) l ON true
            WHERE s.device_id = $1
            ORDER BY s.ts DESC LIMIT 1
        """, device_id)
        if row:
            result = dict(row)
            if result.get("extra"):
                extra = result["extra"]
                result["extra"] = json.loads(extra) if isinstance(extra, str) else extra
            return result
        return {"error": "not found"}


@app.get("/api/history/{device_id}")
async def history(
    device_id: str,
    hours: int = Query(default=24, ge=1, le=168),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, temp_c, humidity, bat_v, uptime_s, extra
            FROM sensor_data
            WHERE device_id = $1 AND ts > now() - $2::interval
            ORDER BY ts DESC
            LIMIT 5000
            """,
            device_id,
            timedelta(hours=hours),
        )
        result = [dict(r) for r in rows]
        for record in result:
            if isinstance(record.get("extra"), str):
                record["extra"] = json.loads(record["extra"])
        return result


@app.get("/api/track/{device_id}")
async def track(device_id: str, hours: int = Query(default=24, ge=1, le=168)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, ST_Y(geom) AS lat, ST_X(geom) AS lon, alt_m, pos_src
            FROM device_location
            WHERE device_id = $1 AND ts > now() - $2::interval
            ORDER BY ts ASC
            """,
            device_id,
            timedelta(hours=hours),
        )
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
                "properties": {"ts": r["ts"].isoformat(), "src": r["pos_src"]},
            }
            for r in rows
        ]
        return {"type": "FeatureCollection", "features": features}


@app.get("/api/fields/{device_type}")
async def sensor_fields(device_type: str):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT field_name, field_unit, display_name
            FROM sensor_fields
            WHERE device_type = $1
            ORDER BY field_name
            """,
            device_type,
        )
        return [dict(r) for r in rows]


class BackfillInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    device: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")
    data: list[tuple[float, float, float]] = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def valid_points(self):
        latest = time.time() + 300
        if any(not 946684800 <= ts <= latest or not -50 <= temp <= 80 or not 0 <= humidity <= 100
               for ts, temp, humidity in self.data):
            raise ValueError("invalid telemetry timestamp, temperature or humidity")
        return self


@app.post("/api/backfill")
async def backfill(data: BackfillInput, _: None = Depends(require_write_token)):
    """断网补传: 接收设备离线期间积压的数据"""
    device_id = data.device
    points = data.data

    pool = await get_pool()
    async with pool.acquire() as conn:
        # 批量插入
        await conn.executemany(
            """INSERT INTO sensor_data (ts, device_id, temp_c, humidity)
               VALUES (to_timestamp($1), $2, $3, $4)
               ON CONFLICT DO NOTHING""",
            [(p[0], device_id, p[1], p[2]) for p in points]
        )
    return {"ok": True, "count": len(points)}


@app.get("/api/map/devices")
async def map_devices():
    """所有设备最新位置 (地图标记用)"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT d.device_id, d.last_seen,
                   ST_Y(l.geom) AS lat, ST_X(l.geom) AS lon,
                   CASE WHEN d.last_seen > now() - interval '5 minutes' THEN true ELSE false END AS online
            FROM device_info d
            LEFT JOIN LATERAL (
                SELECT geom FROM device_location
                WHERE device_id = d.device_id
                ORDER BY ts DESC LIMIT 1
            ) l ON true
            WHERE d.device_id != 'unknown'
            ORDER BY d.last_seen DESC
        """)
        result = []
        for r in rows:
            d = dict(r)
            d["last_seen"] = d["last_seen"].isoformat() if d["last_seen"] else None
            result.append(d)
        return result


@app.get("/api/dates/{device_id}")
async def available_dates(device_id: str):
    """列出设备有数据的所有日期"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT to_char(ts AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date_str,
                   count(*) AS rows
            FROM sensor_data
            WHERE device_id = $1
            GROUP BY date_str
            ORDER BY date_str DESC
            LIMIT 90
            """,
            device_id,
        )
        return [dict(r) for r in rows]


@app.get("/health")
async def health():
    return {"status": "ok"}


# ====================================================================
# CSV 导出
# ====================================================================

@app.get("/api/export/{device_id}")
async def export_csv(device_id: str, date_str: str = Query(default="", alias="date")):
    """导出设备某一天的 CSV 数据 (date=YYYY-MM-DD, 默认今天)"""
    try:
        export_date = date.fromisoformat(date_str) if date_str else datetime.now(timezone(timedelta(hours=8))).date()
    except ValueError:
        raise HTTPException(status_code=422, detail="日期格式错误, 请使用 YYYY-MM-DD")

    tz = timezone(timedelta(hours=8))
    start = datetime(export_date.year, export_date.month, export_date.day, tzinfo=tz)
    end = start + timedelta(days=1)

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, temp_c, humidity, bat_v, uptime_s, extra
            FROM sensor_data
            WHERE device_id = $1 AND ts >= $2 AND ts < $3
            ORDER BY ts ASC
            """,
            device_id, start, end,
        )

    if not rows:
        return {"error": f"{device_id} 在 {export_date} 无数据"}

    output = io.StringIO()
    writer = csv.writer(output)

    extra_keys = set()
    row_data = []
    for r in rows:
        d = dict(r)
        extra = d.pop("extra", None)
        if extra:
            extra = json.loads(extra) if isinstance(extra, str) else extra
            safe_extra = {key: value for key, value in extra.items()
                          if key not in {"device", "ts", "temp_c", "humidity", "bat_v", "uptime_s"}}
            extra_keys.update(safe_extra)
            d.update(safe_extra)
        row_data.append(d)

    header = ["ts", "temp_c", "humidity", "bat_v", "uptime_s"]
    header += sorted(extra_keys - {"device"})
    def csv_cell(value):
        if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
            return "'" + value
        return value

    writer.writerow([csv_cell(key) for key in header])

    for d in row_data:
        writer.writerow([csv_cell(d.get(k, "")) for k in header])

    output.seek(0)
    filename = f"{device_id}_{export_date}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": "attachment; filename=observations.csv; filename*=UTF-8''" + quote(filename, safe="")},
    )


# ====================================================================
# 传感器管理页面
# ====================================================================

@app.get("/sensors", response_class=HTMLResponse)
async def sensor_admin():
    return FileResponse(BASE_DIR / "templates" / "sensors.html", media_type="text/html")


@app.get("/logs", response_class=HTMLResponse)
async def log_manager():
    return FileResponse(BASE_DIR / "templates" / "logs.html", media_type="text/html")


@app.get("/author", response_class=HTMLResponse)
async def author_homepage():
    return FileResponse(BASE_DIR / "templates" / "author.html", media_type="text/html")


@app.get("/home-assets/{asset_name}")
async def home_asset(asset_name: str):
    if asset_name in {"mobile-devices.js", "mobile-devices.css"}:
        return FileResponse(BASE_DIR / "static" / "home" / asset_name, headers={"Cache-Control": "no-cache, must-revalidate"})
    if asset_name not in {"author.css", "design.css", "scene.js", "scene.json", "hero-campus.jpg", "campus-map.png", "spatial-decision.png", "campus-scene.webp", "field-observation.webp", "data-platform.webp", "campus-lcz.webp", "d-context.webp", "d-intervention.webp"}:
        raise HTTPException(status_code=404, detail="asset not found")
    return FileResponse(BASE_DIR / "static" / "home" / asset_name, headers={"Cache-Control": "no-cache, must-revalidate"})


@app.get("/console.css")
async def console_styles():
    return FileResponse(BASE_DIR / "static" / "console.css", media_type="text/css")


@app.get("/monitor")
async def monitor_alias():
    return RedirectResponse("/?view=monitor", status_code=307)


@app.get("/portal")
async def portal_alias():
    return RedirectResponse("/", status_code=301)


# ====================================================================
# 可视化仪表盘
@app.get("/api/sensors/detail")
async def sensors_detail():
    """传感器管理: 全部设备详细信息"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT d.device_id, d.device_type, d.created_at, d.last_seen, d.firmware,
                   CASE WHEN d.last_seen > now() - interval '5 minutes' THEN true ELSE false END AS online,
                   ST_Y(l.geom) AS lat, ST_X(l.geom) AS lon,
                   s.temp_c, s.humidity, s.bat_v,
                   cnt.total_rows, cnt.first_ts, cnt.last_ts, cnt.avg_interval
            FROM device_info d
            LEFT JOIN LATERAL (
                SELECT geom FROM device_location
                WHERE device_id = d.device_id ORDER BY ts DESC LIMIT 1
            ) l ON true
            LEFT JOIN LATERAL (
                SELECT temp_c, humidity, bat_v FROM sensor_data
                WHERE device_id = d.device_id ORDER BY ts DESC LIMIT 1
            ) s ON true
            LEFT JOIN LATERAL (
                SELECT count(*) AS total_rows, min(ts) AS first_ts, max(ts) AS last_ts,
                       extract(epoch FROM (max(ts) - min(ts))) / greatest(count(*)-1, 1) AS avg_interval
                FROM sensor_data WHERE device_id = d.device_id
            ) cnt ON true
            WHERE d.device_id != 'unknown'
            ORDER BY d.last_seen DESC NULLS LAST
        """)
        result = []
        for r in rows:
            d = dict(r)
            for k in ['created_at', 'last_seen', 'first_ts', 'last_ts']:
                if d.get(k): d[k] = d[k].isoformat()
            # 获取传感器字段
            d["fields"] = []
            result.append(d)
        # 批量查询字段
        async with pool.acquire() as conn2:
            for i, dev in enumerate(result):
                frows = await conn2.fetch(
                    "SELECT field_name, field_unit, display_name FROM sensor_fields WHERE device_type = $1",
                    dev["device_type"] or dev["device_id"]
                )
                if not frows:
                    frows = await conn2.fetch(
                        "SELECT field_name, field_unit, display_name FROM sensor_fields WHERE device_type = $1",
                        "ATOM_LITE"
                    )
                result[i]["fields"] = [dict(f) for f in frows]
        return result


# ====================================================================

@app.head("/")
async def dashboard_head():
    return Response(status_code=200, media_type="text/html", headers={"Cache-Control": "no-cache, must-revalidate"})


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    if request.query_params.get("view") == "monitor":
        html = (BASE_DIR / "templates" / "monitor.html").read_text(encoding="utf-8")
        return HTMLResponse(html.replace("AMAP_KEY_PLACEHOLDER", AMAP_JS_KEY))
    return FileResponse(BASE_DIR / "templates" / "home.html", media_type="text/html", headers={"Cache-Control": "no-cache, must-revalidate"})
