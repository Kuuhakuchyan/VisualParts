"""
IoT 平台对外 API + 可视化仪表盘
- RESTful 数据查询
- CSV 数据导出
- 趋势图、数据表格、高德地图
"""

import csv
import io
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
import asyncpg

app = FastAPI(title="IoT Platform API")
BASE_DIR = Path(__file__).resolve().parent

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("ALLOWED_HOSTS", "").split(",")
    if host.strip()
]
if ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

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
    """Protect write-only endpoints when API_WRITE_TOKEN is configured."""
    if API_WRITE_TOKEN and x_api_key != API_WRITE_TOKEN:
        raise HTTPException(status_code=401, detail="invalid API key")


async def get_pool():
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
    hours: int = Query(default=24, le=168),
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
        return [dict(r) for r in rows]


@app.get("/api/track/{device_id}")
async def track(device_id: str, hours: int = Query(default=24, le=168)):
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


@app.post("/api/backfill")
async def backfill(data: dict, _: None = Depends(require_write_token)):
    """断网补传: 接收设备离线期间积压的数据"""
    device_id = data.get("device")
    points = data.get("data", [])
    if not device_id or not points:
        return {"error": "invalid payload"}

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
            SELECT DISTINCT to_char(ts, 'YYYY-MM-DD') AS date_str,
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
        export_date = date.fromisoformat(date_str) if date_str else date.today()
    except ValueError:
        return {"error": "日期格式错误, 请使用 YYYY-MM-DD"}

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
        return {"error": f"{device_id} 在 {date_str or date.today()} 无数据"}

    output = io.StringIO()
    writer = csv.writer(output)

    extra_keys = set()
    row_data = []
    for r in rows:
        d = dict(r)
        extra = d.pop("extra", None)
        if extra:
            extra = json.loads(extra) if isinstance(extra, str) else extra
            extra_keys.update(extra.keys())
            d.update(extra)
        row_data.append(d)

    header = ["ts", "temp_c", "humidity", "bat_v", "uptime_s"]
    header += sorted(extra_keys - {"device"})
    writer.writerow(header)

    for d in row_data:
        writer.writerow([d.get(k, "") for k in header])

    output.seek(0)
    filename = f"{device_id}_{date_str or date.today()}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ====================================================================
# 传感器管理页面
# ====================================================================

@app.get("/sensors", response_class=HTMLResponse)
async def sensor_admin():
    return SENSOR_ADMIN_HTML


@app.get("/logs", response_class=HTMLResponse)
async def log_manager():
    return LOG_MANAGER_HTML


@app.get("/author", response_class=HTMLResponse)
async def author_homepage():
    return FileResponse(BASE_DIR / "templates" / "author.html", media_type="text/html")


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

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    return DASHBOARD_HTML


SENSOR_ADMIN_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>传感器管理</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#f0f2f5; color:#333; min-height:100vh; }
.header { background: linear-gradient(135deg,#1a1a2e 0%,#16213e 100%); color:#fff; padding:14px 24px; display:flex; align-items:center; justify-content:space-between; }
.header h1 { font-size:18px; }
.header a { color:#94a3b8; text-decoration:none; font-size:13px; }
.header a:hover { color:#fff; }
.container { max-width:1400px; margin:0 auto; padding:16px; }
.card { background:#fff; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,.08); padding:16px; margin-bottom:16px; }
.card h3 { font-size:15px; margin-bottom:10px; }
.grid-4 { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px; font-size:12px; }
@media (max-width:900px) { .grid-4 { grid-template-columns:1fr 1fr; } }
.grid-4 .item { background:#f8fafc; padding:8px 10px; border-radius:6px; }
.grid-4 .item .label { color:#888; font-size:11px; }
.grid-4 .item .value { font-weight:600; margin-top:2px; }
.badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; color:#fff; }
.badge-online { background:#10b981; }
.badge-offline { background:#ef4444; }
.refresh { font-size:12px; color:#999; margin-left:10px; }
.footer { text-align:center; padding:12px; font-size:12px; color:#999; }
.warn { color:#f59e0b; }
</style>
</head>
<body>
<div class="header">
  <h1><img src="/logo.png" style="height:28px;vertical-align:middle;margin-right:8px;">传感器管理</h1>
  <div><a href="/">← 返回仪表盘</a> <span class="refresh" id="refreshTime"></span></div>
</div>
<div class="container" id="content"><div style="text-align:center;padding:60px;color:#999;">加载中...</div></div>
<div class="footer">微气候决策系统 · 传感器管理</div>
<script>
async function load() {
  const res = await fetch('/api/sensors/detail');
  const devices = await res.json();
  if (!devices.length) {
    document.getElementById('content').innerHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无传感器</div>';
    return;
  }
  let html = '';
  devices.forEach(d => {
    const fields = (d.fields || []).map(f => `${f.display_name || f.field_name}(${f.field_unit || '-'})`);
    html += `<div class="card">
      <h3>${d.device_id} <span class="badge ${d.online ? 'badge-online' : 'badge-offline'}">${d.online ? '在线' : '离线'}</span></h3>
      <div class="grid-4">
        <div class="item"><div class="label">设备类型</div><div class="value">${d.device_type || '未知'}</div></div>
        <div class="item"><div class="label">固件版本</div><div class="value">${d.firmware || '未知'}</div></div>
        <div class="item"><div class="label">注册时间</div><div class="value">${d.created_at ? new Date(d.created_at).toLocaleString('zh-CN') : '-'}</div></div>
        <div class="item"><div class="label">最后上报</div><div class="value ${d.online ? '' : 'warn'}">${d.last_seen ? new Date(d.last_seen).toLocaleString('zh-CN') : '从未'}</div></div>
        <div class="item"><div class="label">最新坐标</div><div class="value">${d.lat ? Number(d.lat).toFixed(4)+', '+Number(d.lon).toFixed(4) : '无定位'}</div></div>
        <div class="item"><div class="label">最新温度</div><div class="value">${d.temp_c != null ? d.temp_c.toFixed(1)+'°C' : '-'}</div></div>
        <div class="item"><div class="label">最新湿度</div><div class="value">${d.humidity != null ? d.humidity.toFixed(1)+'%' : '-'}</div></div>
        <div class="item"><div class="label">电池电压</div><div class="value">${d.bat_v != null ? d.bat_v.toFixed(2)+'V' : '-'}</div></div>
        <div class="item"><div class="label">数据总量</div><div class="value">${d.total_rows || 0} 条</div></div>
        <div class="item"><div class="label">数据范围</div><div class="value">${d.first_ts ? new Date(d.first_ts).toLocaleDateString('zh-CN') : '-'} ~ ${d.last_ts ? new Date(d.last_ts).toLocaleDateString('zh-CN') : '-'}</div></div>
        <div class="item"><div class="label">上报间隔</div><div class="value">${d.avg_interval ? Math.round(d.avg_interval)+'s' : '-'}</div></div>
        <div class="item"><div class="label">传感器字段</div><div class="value">${fields.join(', ') || '无'}</div></div>
      </div>
    </div>`;
  });
  document.getElementById('content').innerHTML = html;
  document.getElementById('refreshTime').textContent = '更新于 '+new Date().toLocaleTimeString('zh-CN');
}
load();
setInterval(load, 30000);
</script>
</body>
</html>"""


LOG_MANAGER_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>数据日志</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#f0f2f5; color:#333; }
.header { background: linear-gradient(135deg,#1a1a2e,#16213e); color:#fff; padding:14px 24px; display:flex; align-items:center; justify-content:space-between; }
.header h1 { font-size:18px; }
.header a { color:#94a3b8; text-decoration:none; font-size:13px; }
.header a:hover { color:#fff; }
.container { max-width:1000px; margin:0 auto; padding:16px; }
.card { background:#fff; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,.08); padding:16px; margin-bottom:12px; }
.device-tabs { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
.device-tab { padding:8px 16px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:500; border:none; background:#e2e8f0; color:#555; }
.device-tab.active { background:#6366f1; color:#fff; }
.date-list { display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:8px; }
.date-item { background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; }
.date-item .info { font-size:13px; }
.date-item .info .date { font-weight:600; }
.date-item .info .count { font-size:11px; color:#888; }
.date-item a { background:#2563eb; color:#fff; padding:4px 12px; border-radius:6px; text-decoration:none; font-size:12px; }
.date-item a:hover { background:#1d4ed8; }
.footer { text-align:center; padding:12px; font-size:12px; color:#999; }
</style>
</head>
<body>
<div class="header">
  <h1><img src="/logo.png" style="height:28px;vertical-align:middle;margin-right:8px;">数据日志</h1>
  <div><a href="/">← 仪表盘</a> | <a href="/sensors">传感器管理</a></div>
</div>
<div class="container">
  <div class="device-tabs" id="deviceTabs"></div>
  <div id="dateContent"><div style="text-align:center;padding:40px;color:#999;">请选择设备</div></div>
</div>
<div class="footer">微气候决策系统 · 数据日志</div>
<script>
let currentDevice = null;
async function loadDevices() {
  const res = await fetch('/api/devices');
  const devices = await res.json();
  const tabs = document.getElementById('deviceTabs');
  tabs.innerHTML = devices.map(d =>
    `<button class="device-tab" onclick="selectDevice('${d.device_id}')">${d.device_id}</button>`
  ).join('');
  if (devices.length && !currentDevice) selectDevice(devices[0].device_id);
}
async function selectDevice(id) {
  currentDevice = id;
  document.querySelectorAll('.device-tab').forEach(b => b.classList.toggle('active', b.textContent === id));
  const res = await fetch(`/api/dates/${id}`);
  const dates = await res.json();
  const div = document.getElementById('dateContent');
  if (!dates.length) { div.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无数据</div>'; return; }
  div.innerHTML = `<div class="date-list">${dates.map(d =>
    `<div class="date-item">
      <div class="info"><div class="date">${d.date_str}</div><div class="count">${d.rows} 条数据</div></div>
      <a href="/api/export/${id}?date=${d.date_str}" download>下载 CSV</a>
    </div>`
  ).join('')}</div>`;
}
loadDevices();
</script>
</body>
</html>"""

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>微气候决策系统</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f0f2f5; color: #333; min-height: 100vh;
}
.header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff; padding: 16px 24px; display: flex; align-items: center;
  justify-content: space-between; flex-wrap: wrap; gap: 12px;
}
.header h1 { font-size: 20px; font-weight: 600; white-space: nowrap; }
.header-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.header select, .header button {
  padding: 8px 14px; border-radius: 6px; border: none; font-size: 14px; cursor: pointer;
}
.header select { background: #2d3561; color: #fff; min-width: 160px; }
.header button { background: #2563eb; color: #fff; font-weight: 500; }
.header button:hover { background: #1d4ed8; }
.header button.download { background: #059669; }
.header button.download:hover { background: #047857; }
.last-update { font-size: 12px; color: #94a3b8; }

.main { max-width: 1400px; margin: 0 auto; padding: 16px; display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto;
  gap: 16px;
}
.card {
  background: #fff; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08);
  padding: 16px;
}
.card h3 { font-size: 15px; color: #555; margin-bottom: 10px; }
/* 图例标签 */
.chart-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; min-height: 24px; }
.chart-legend .tag { display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 12px; font-size: 12px; color: #fff; cursor: default; }
.chart-legend .tag .close { cursor: pointer; font-weight: bold; margin-left: 2px; opacity: 0.7; }
.chart-legend .tag .close:hover { opacity: 1; }
.chart-wrap { position: relative; height: 280px; }
.chart-wrap canvas { width: 100% !important; }

/* Map spans full row */
.map-card { grid-column: 1 / -1; }
#amap { width: 100%; height: 380px; border-radius: 6px; }

/* Table section */
.table-section { grid-column: 1 / -1; }
.table-wrap { max-height: 400px; overflow: auto; border-radius: 6px; border: 1px solid #e5e7eb; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead { position: sticky; top: 0; z-index: 1; }
thead th {
  background: #f8fafc; padding: 10px 12px; text-align: left;
  border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #555; white-space: nowrap;
}
tbody td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; white-space: nowrap; }
tbody tr:hover { background: #f8fafc; }
.no-data { text-align: center; padding: 40px; color: #999; }

.footer {
  max-width: 1400px; margin: 0 auto 24px; padding: 0 16px;
  font-size: 13px; color: #64748b;
}
.footer-panel {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0,0,0,.08); padding: 12px;
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;
}
.footer-group {
  min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  background: #f8fafc; border: 1px solid #eef2f7; border-radius: 8px; padding: 10px 12px;
}
.footer-title { font-size: 12px; font-weight: 700; color: #475569; white-space: nowrap; }
.footer-link {
  display: inline-flex; align-items: center; min-height: 28px; padding: 5px 10px;
  border-radius: 999px; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe;
  text-decoration: none; font-weight: 600; white-space: nowrap;
}
.footer-link:hover { background: #dbeafe; }
.footer-link.device { color: #047857; background: #ecfdf5; border-color: #a7f3d0; }
.footer-link.device:hover { background: #d1fae5; }
.footer-link.ops { color: #6d28d9; background: #f5f3ff; border-color: #ddd6fe; }
.footer-link.ops:hover { background: #ede9fe; }
.footer-note { flex-basis: 100%; font-size: 12px; color: #94a3b8; line-height: 1.5; }

@media (max-width: 900px) {
  .main { grid-template-columns: 1fr; }
  .map-card { grid-column: 1; }
  .footer-panel { grid-template-columns: 1fr; }
}

/* Loading spinner */
.spinner { border: 3px solid #e5e7eb; border-top: 3px solid #2563eb;
  border-radius: 50%; width: 32px; height: 32px; animation: spin .8s linear infinite;
  margin: 40px auto;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>

<div class="header">
  <h1><img src="/logo.png" style="height:32px;vertical-align:middle;margin-right:8px;">微气候决策系统</h1>
  <div class="header-right">
    <select id="deviceSelect" onchange="onDeviceChange()"></select>
    <select id="dateSelect" onchange="onDateChange()"><option value="">今日</option></select>
    <button id="downloadBtn" class="download" onclick="downloadCSV()">下载 CSV</button>
    <button id="viewToggle" class="download" onclick="toggleView()" style="background:#6366f1;">分设备视图</button>
    <span class="last-update" id="lastUpdate"></span>
  </div>
</div>

<div style="max-width:1400px; margin:0 auto; padding:0 16px 8px;">
  <div class="card" style="margin-bottom:8px;">
    <h3>传感器状态 <span id="statusUpdated" style="font-size:12px;color:#999;font-weight:400;"></span></h3>
    <div id="statusPanel" style="display:flex;flex-wrap:wrap;gap:10px;"></div>
  </div>
</div>

<div class="main" id="mainGrid">
  <div class="card">
    <h3>温度趋势 (°C)</h3>
    <div class="chart-legend" id="tempLegend"></div>
    <div class="chart-wrap"><canvas id="tempChart"></canvas></div>
  </div>
  <div class="card">
    <h3>湿度趋势 (%)</h3>
    <div class="chart-legend" id="humidLegend"></div>
    <div class="chart-wrap"><canvas id="humidChart"></canvas></div>
  </div>
</div>

<div id="deviceRows" style="display:none; max-width:1400px; margin:0 auto; padding:0 16px 16px;"></div>

<div style="max-width:1400px; margin:0 auto; padding:0 16px 16px;">
  <div class="card map-card" style="margin-bottom:16px;">
    <h3>传感器定位 (高德地图)</h3>
    <div id="amap"></div>
  </div>
  <div class="card table-section" style="margin-bottom:16px;">
    <h3>数据明细 <span id="tableDeviceTags" style="font-size:13px;font-weight:400;"></span></h3>
    <div class="table-wrap" id="tableWrap">
      <div class="no-data">加载中...</div>
    </div>
  </div>
</div>

<div class="footer">
  <div class="footer-panel">
    <div class="footer-group">
      <span class="footer-title">平台操作</span>
      <a class="footer-link" href="/logs">数据日志</a>
      <a class="footer-link" href="/sensors">传感器管理</a>
      <a class="footer-link" href="/author/">作者主页</a>
    </div>
    <div class="footer-group">
      <span class="footer-title">设备直连</span>
      <a class="footer-link device" href="http://192.168.4.1" target="_blank">ATOM Weather</a>
      <a class="footer-link device" href="http://192.168.4.1" target="_blank">M5Stick Weather</a>
      <span class="footer-note">手机连接设备 WiFi 后访问，建议关闭移动数据。</span>
    </div>
    <div class="footer-group">
      <span class="footer-title">运维入口</span>
      <a class="footer-link ops" href="/grafana/">Grafana 看板</a>
    </div>
  </div>
</div>

<script>
// ==================== WGS-84 → GCJ-02 坐标转换 (高德地图需要) ====================
function wgs84ToGcj02(lon, lat) {
  const PI = Math.PI, a = 6378245.0, ee = 0.00669342162296594323;
  function transformLat(x, y) {
    let ret = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
    ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
    ret += (20.0*Math.sin(y*PI) + 40.0*Math.sin(y/3.0*PI)) * 2.0/3.0;
    ret += (160.0*Math.sin(y/12.0*PI) + 320.0*Math.sin(y*PI/30.0)) * 2.0/3.0;
    return ret;
  }
  function transformLon(x, y) {
    let ret = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
    ret += (20.0*Math.sin(6.0*x*PI) + 20.0*Math.sin(2.0*x*PI)) * 2.0/3.0;
    ret += (20.0*Math.sin(x*PI) + 40.0*Math.sin(x/3.0*PI)) * 2.0/3.0;
    ret += (150.0*Math.sin(x/12.0*PI) + 300.0*Math.sin(x/30.0*PI)) * 2.0/3.0;
    return ret;
  }
  const dLat = transformLat(lon-105.0, lat-35.0);
  const dLon = transformLon(lon-105.0, lat-35.0);
  const radLat = lat/180.0*PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee*magic*magic;
  const sqrtMagic = Math.sqrt(magic);
  return [lon + dLon*180.0/(a/sqrtMagic*Math.cos(radLat)*PI), lat + dLat*180.0/(a*(1-ee)/(magic*sqrtMagic)*PI)];
}

function toGcj02(lon, lat) {
  if (lon == null || lat == null) return [lon, lat];
  return wgs84ToGcj02(lon, lat);
}

// ==================== 全局状态 ====================
let currentDevice = null;
let tempChart = null, humidChart = null;
let map = null, trackLine = null;
let markers = {};  // device_id → AMap.Marker
let lastLat = null, lastLon = null;
let chartDevices = new Set();  // 当前显示在图表上的设备
const DEVICE_COLORS = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'];

function deviceColor(deviceId) {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) hash = deviceId.charCodeAt(i) + ((hash << 5) - hash);
  return DEVICE_COLORS[Math.abs(hash) % DEVICE_COLORS.length];
}

// ==================== Chart.js 初始化 ====================
function initCharts() {
  const common = {
    type: 'line',
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { font: { size: 11 } } }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  };
  tempChart = new Chart(document.getElementById('tempChart'), {
    ...common,
    data: { labels: [], datasets: [] }
  });
  tempChart.options.scales.y.title = { display: true, text: '°C' };
  humidChart = new Chart(document.getElementById('humidChart'), {
    ...common,
    data: { labels: [], datasets: [] }
  });
  humidChart.options.scales.y.title = { display: true, text: '%' };
}

function renderLegend() {
  document.getElementById('tempLegend').innerHTML = Array.from(chartDevices).map(id =>
    `<span class="tag" style="background:${deviceColor(id)}">${id}<span class="close" onclick="removeDevice('${id}')">✕</span></span>`
  ).join('');
  document.getElementById('humidLegend').innerHTML = document.getElementById('tempLegend').innerHTML;
}

function addDevice(deviceId) {
  if (chartDevices.has(deviceId)) return;
  chartDevices.add(deviceId);
  const c = deviceColor(deviceId);
  tempChart.data.datasets.push({ label: deviceId, data: [], borderColor: c, backgroundColor: c+'20', fill: false, tension: 0.3, pointRadius: 0 });
  humidChart.data.datasets.push({ label: deviceId, data: [], borderColor: c, backgroundColor: c+'20', fill: false, tension: 0.3, pointRadius: 0 });
  renderLegend();
  loadAll();
}

function removeDevice(deviceId) {
  if (!chartDevices.has(deviceId)) return;
  chartDevices.delete(deviceId);
  [tempChart, humidChart].forEach(chart => {
    const idx = chart.data.datasets.findIndex(ds => ds.label === deviceId);
    if (idx >= 0) chart.data.datasets.splice(idx, 1);
  });
  renderLegend();
  if (chartDevices.size === 0) { tempChart.data.labels = []; humidChart.data.labels = []; }
  tempChart.update(); humidChart.update();
}

// ==================== 高德地图初始化 ====================
function initMap(lat, lon) {
  if (!map) {
    const c = toGcj02(lon || 113.527070, lat || 34.821083);
    map = new AMap.Map('amap', {
      center: c,
      zoom: 15,
      mapStyle: 'amap://styles/light',
    });
  }
  // 不移动地图中心, 只刷新标记
}
window._amapInitCalled = false;
window._amapOnLoad = null;
function loadAMap(lat, lon) {
  if (!window._amapInitCalled) {
    window._amapInitCalled = true;
    window._amapOnLoad = function() { initMap(lastLat, lastLon); refreshAllMarkers(); drawPendingTrack(); };
    window._amapCallback = function() { if (window._amapOnLoad) window._amapOnLoad(); };
    const script = document.createElement('script');
    script.src = 'https://webapi.amap.com/maps?v=2.0&key=AMAP_KEY_PLACEHOLDER&callback=_amapCallback';
    document.head.appendChild(script);
  } else {
    refreshAllMarkers();
  }
}
function drawPendingTrack() {
  if (trackData.length) {
    drawTrack(trackData.map(f => ({lon: f.lon, lat: f.lat})));
  }
}

function updateMapPosition(lat, lon) {
  // 保留: 居中到当前选中设备
}

async function refreshAllMarkers() {
  if (!map) return;
  const res = await fetch('/api/map/devices');
  const devices = await res.json();
  const seen = {};
  devices.forEach(d => {
    seen[d.device_id] = true;
    const pos = toGcj02(d.lon || 113.527070, d.lat || 34.821083);
    const label = d.device_id + (d.online ? ' ●在线' : ' ○离线');
    if (markers[d.device_id]) {
      markers[d.device_id].setPosition(pos);
      markers[d.device_id].setTitle(label);
    } else {
      const isSelected = d.device_id === currentDevice;
      markers[d.device_id] = new AMap.Marker({
        position: pos,
        title: label,
        icon: isSelected ? 'https://webapi.amap.com/theme/v1.3/markers/n/mark_r.png'
                         : 'https://webapi.amap.com/theme/v1.3/markers/n/mark_b.png',
        offset: new AMap.Pixel(-12, -36),
      });
      map.add(markers[d.device_id]);
    }
  });
  // 清除已不在线的标记
  for (const id in markers) {
    if (!seen[id]) { map.remove(markers[id]); delete markers[id]; }
  }
}

function drawTrack(trackPoints) {
  if (!map || !trackPoints.length) return;
  if (trackLine) { map.remove(trackLine); trackLine = null; }
  if (trackPoints.length < 2) return;
  trackLine = new AMap.Polyline({
    path: trackPoints.map(p => toGcj02(p.lon, p.lat)),
    strokeColor: '#2563eb', strokeWeight: 4, strokeOpacity: 0.7,
    lineJoin: 'round',
  });
  map.add(trackLine);
}

// ==================== 数据加载 ====================
async function loadDevices() {
  const res = await fetch('/api/devices');
  const devices = await res.json();
  window._allDevices = devices;
  const sel = document.getElementById('deviceSelect');
  sel.innerHTML = devices.map(d =>
    `<option value="${d.device_id}">${d.device_id} ${d.online ? '●在线' : '○离线'}</option>`
  ).join('');
  if (devices.length && !currentDevice) {
    currentDevice = devices[0].device_id;
    sel.value = currentDevice;
  }
  renderTableTags();
}

async function refreshStatus() {
  const [devRes, mapRes] = await Promise.all([
    fetch('/api/devices'), fetch('/api/map/devices')
  ]);
  const devices = await devRes.json();
  const positions = await mapRes.json();
  const posMap = {};
  positions.forEach(p => { posMap[p.device_id] = p; });

  const panel = document.getElementById('statusPanel');
  panel.innerHTML = devices.map(d => {
    const p = posMap[d.device_id] || {};
    const coord = (p.lat && p.lon) ? `(${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)})` : '无定位';
    const lastSeen = d.last_seen ? new Date(d.last_seen).toLocaleTimeString('zh-CN') : '从未';
    const bg = d.online ? '#dcfce7' : '#fee2e2';
    const border = d.online ? '#10b981' : '#ef4444';
    const dot = d.online ? '🟢' : '🔴';
    return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:10px 14px;min-width:200px;flex:1;">
      <div style="font-weight:600;font-size:14px;">${dot} ${d.device_id}</div>
      <div style="font-size:11px;color:#666;margin-top:2px;">坐标: ${coord}</div>
      <div style="font-size:11px;color:#666;">最后上报: ${lastSeen}</div>
    </div>`;
  }).join('');
  document.getElementById('statusUpdated').textContent =
    `更新于 ${new Date().toLocaleTimeString('zh-CN')}`;
}

function renderTableTags() {
  const devices = window._allDevices || [];
  const tags = document.getElementById('tableDeviceTags');
  tags.innerHTML = devices.map(d => {
    const active = d.device_id === currentDevice;
    return `<span onclick="switchTableDevice('${d.device_id}')" style="cursor:pointer;display:inline-block;padding:2px 10px;margin-left:4px;border-radius:12px;font-size:12px;color:#fff;background:${active ? '#6366f1' : '#94a3b8'};${d.online ? '' : 'opacity:0.6;'}">${d.device_id}</span>`;
  }).join('');
}

function switchTableDevice(deviceId) {
  currentDevice = deviceId;
  document.getElementById('deviceSelect').value = deviceId;
  addDevice(deviceId);
  renderTableTags();
  // 只刷新表格
  fetch(`/api/history/${deviceId}?hours=24`).then(r => r.json()).then(data => updateTable(data));
}

async function loadAll() {
  if (!currentDevice) return;

  // 1. 加载所有图表设备的 history
  const allIds = new Set(chartDevices);
  allIds.add(currentDevice);  // 确保当前设备也在
  addDevice(currentDevice);   // 自动加入图表

  const histPromises = Array.from(allIds).map(id =>
    fetch(`/api/history/${id}?hours=24`).then(r => r.json()).then(data => ({id, data}))
  );
  const [trackRes, latestRes, ...histResults] = await Promise.all([
    fetch(`/api/track/${currentDevice}?hours=24`),
    fetch(`/api/latest/${currentDevice}`),
    ...histPromises
  ]);

  // 2. 更新图表 (多设备)
  updateChartsMulti(histResults);

  // 3. 更新表格 (当前设备)
  const curHist = histResults.find(h => h.id === currentDevice);
  updateTable(curHist ? curHist.data : []);

  // 4. 轨迹
  const trackJson = await trackRes.json();
  const latestData = await latestRes.json();
  const features = trackJson.features || [];
  trackData = features.map(f => ({
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    ts: f.properties.ts
  }));

  lastLat = latestData.lat || (trackData.length ? trackData[trackData.length-1].lat : null);
  lastLon = latestData.lon || (trackData.length ? trackData[trackData.length-1].lon : null);

  if (typeof AMap !== 'undefined') {
    refreshAllMarkers();
    drawTrack(trackData.map(f => ({lon: f.lon, lat: f.lat})));
  } else {
    loadAMap(lastLat, lastLon);
  }

  const now = new Date();
  document.getElementById('lastUpdate').textContent =
    `更新于 ${now.toLocaleTimeString('zh-CN')}`;
}

function alignToGrid(rows, intervalSec) {
  // 将原始数据对齐到 intervalSec 秒网格, 取每个桶的平均值
  if (rows.length === 0) return { labels:[], temps:[], humids:[] };
  const d = [...rows].reverse();
  const buckets = {};
  d.forEach(r => {
    const t = new Date(r.ts).getTime();
    const bucket = Math.round(t / (intervalSec * 1000)) * (intervalSec * 1000);
    if (!buckets[bucket]) buckets[bucket] = { ts: bucket, temps: [], humids: [] };
    if (r.temp_c != null) buckets[bucket].temps.push(r.temp_c);
    if (r.humidity != null) buckets[bucket].humids.push(r.humidity);
  });
  const keys = Object.keys(buckets).map(Number).sort((a,b) => a-b);
  const fmt = new Intl.DateTimeFormat('zh-CN', { hour:'2-digit', minute:'2-digit' });
  return {
    labels: keys.map(k => fmt.format(new Date(k))),
    temps: keys.map(k => buckets[k].temps.reduce((a,b)=>a+b,0) / buckets[k].temps.length),
    humids: keys.map(k => buckets[k].humids.reduce((a,b)=>a+b,0) / buckets[k].humids.length),
  };
}

function updateChartsMulti(histResults) {
  const ALIGN = 10;  // 对齐到 10 秒网格
  let allLabels = [];
  const deviceData = {};
  histResults.forEach(({id, data}) => {
    const aligned = alignToGrid(data, ALIGN);
    if (aligned.labels.length > allLabels.length) allLabels = aligned.labels;
    deviceData[id] = aligned;
  });

  if (allLabels.length === 0) { tempChart.update(); humidChart.update(); return; }

  tempChart.data.labels = allLabels;
  humidChart.data.labels = allLabels;

  const activeIds = new Set(Object.keys(deviceData));
  [tempChart, humidChart].forEach(chart => {
    chart.data.datasets = chart.data.datasets.filter(ds => activeIds.has(ds.label));
    Object.entries(deviceData).forEach(([id, dd]) => {
      let ds = chart.data.datasets.find(d => d.label === id);
      if (!ds) {
        const c = deviceColor(id);
        ds = { label: id, data: [], borderColor: c, backgroundColor: c+'20', fill: false, tension: 0.3, pointRadius: 0 };
        chart.data.datasets.push(ds);
      }
      const vals = chart === tempChart ? dd.temps : dd.humids;
      // 对齐到统一网格
      const aligned = allLabels.map((_, i) => {
        const idx = dd.labels.indexOf(allLabels[i]);
        return idx >= 0 ? vals[idx] : null;
      });
      ds.data = aligned;
    });
  });

  tempChart.update();
  humidChart.update();
}

function updateTable(data) {
  if (!data.length) {
    document.getElementById('tableWrap').innerHTML =
      '<div class="no-data">暂无数据</div>';
    return;
  }
  // 取最近 200 条
  const rows = data.slice(0, 200);

  // 收集所有 extra 的 key
  const extraKeys = new Set();
  rows.forEach(r => {
    if (r.extra && typeof r.extra === 'object') {
      Object.keys(r.extra).filter(k => k !== 'device').forEach(k => extraKeys.add(k));
    }
  });
  const baseCols = ['ts', 'temp_c', 'humidity', 'bat_v', 'uptime_s'];
  const allCols = [...baseCols, ...Array.from(extraKeys).sort()];

  const colLabels = {
    ts: '时间', temp_c: '温度(°C)', humidity: '湿度(%)',
    bat_v: '电池(V)', uptime_s: '运行(秒)'
  };

  let html = '<table><thead><tr>';
  allCols.forEach(c => {
    html += `<th>${colLabels[c] || c}</th>`;
  });
  html += '</tr></thead><tbody>';

  rows.forEach(r => {
    html += '<tr>';
    allCols.forEach(c => {
      let v = r[c] !== undefined ? r[c] : (r.extra && r.extra[c] !== undefined ? r.extra[c] : '');
      if (c === 'ts' && v) {
        v = new Date(v).toLocaleString('zh-CN');
      } else if (typeof v === 'number') {
        v = v.toFixed(2);
      } else if (typeof v === 'object') {
        v = '';
      }
      html += `<td>${v}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('tableWrap').innerHTML = html;
}

async function loadDates() {
  if (!currentDevice) return;
  const res = await fetch(`/api/dates/${currentDevice}`);
  const dates = await res.json();
  const sel = document.getElementById('dateSelect');
  sel.innerHTML = '<option value="">今日</option>';
  dates.forEach(d => {
    sel.innerHTML += `<option value="${d.date_str}">${d.date_str} (${d.rows}条)</option>`;
  });
}

function downloadCSV() {
  if (!currentDevice) return;
  const date = document.getElementById('dateSelect').value;
  const today = new Date().toISOString().slice(0, 10);
  const d = date || today;
  window.open(`/api/export/${currentDevice}?date=${d}`, '_blank');
}

function onDateChange() {
  // 后续可扩展: 切换日期刷新数据明细
}

function onDeviceChange() {
  currentDevice = document.getElementById('deviceSelect').value;
  loadDates();
  loadAll();
}

// ==================== 入口 ====================
let viewMode = 'combined';  // 'combined' | 'perDevice'
let deviceCharts = {};      // deviceId → { temp: Chart, humid: Chart }

function toggleView() {
  viewMode = viewMode === 'combined' ? 'perDevice' : 'combined';
  const btn = document.getElementById('viewToggle');
  const mainGrid = document.getElementById('mainGrid');
  const deviceRows = document.getElementById('deviceRows');

  if (viewMode === 'perDevice') {
    btn.textContent = '汇总视图';
    btn.style.background = '#059669';
    mainGrid.style.display = 'none';
    deviceRows.style.display = '';
    renderDeviceRows();
  } else {
    btn.textContent = '分设备视图';
    btn.style.background = '#6366f1';
    mainGrid.style.display = '';
    deviceRows.style.display = 'none';
    Object.values(deviceCharts).forEach(c => { c.temp.destroy(); c.humid.destroy(); });
    deviceCharts = {};
    loadAll();
  }
}

async function renderDeviceRows() {
  const deviceRows = document.getElementById('deviceRows');
  const [devRes, posRes] = await Promise.all([
    fetch('/api/devices'), fetch('/api/map/devices')
  ]);
  const devices = await devRes.json();
  const positions = await posRes.json();
  const posMap = {};
  positions.forEach(p => { posMap[p.device_id] = p; });

  // 并行加载所有设备 history
  const histResults = await Promise.all(devices.map(d =>
    fetch(`/api/history/${d.device_id}?hours=12`).then(r => r.json()).then(data => ({id: d.device_id, online: d.online, data}))
  ));

  let html = '';
  histResults.forEach(({id, online, data}) => {
    if (data.length === 0) return;
    const p = posMap[id] || {};
    const coord = (p.lat && p.lon) ? `(${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)})` : '';
    html += `<div class="card device-card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-weight:600;font-size:15px;">${id} <span style="font-size:11px;color:#666;font-weight:400;">${coord}</span> <span style="font-size:12px;color:${online?'#10b981':'#ef4444'};">${online?'●在线':'○离线'}</span></span>
        <span style="cursor:pointer;font-size:18px;color:#999;" onclick="removeDeviceRow('${id}')">✕</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div><canvas id="dev_temp_${id}" style="height:180px;"></canvas></div>
        <div><canvas id="dev_humi_${id}" style="height:180px;"></canvas></div>
      </div>
    </div>`;
  });

  if (!html.trim()) { deviceRows.innerHTML = '<div class="no-data" style="padding:40px;">暂无设备数据</div>'; return; }
  deviceRows.innerHTML = html;

  // 渲染图表
  Object.values(deviceCharts).forEach(c => { c.temp.destroy(); c.humid.destroy(); });
  deviceCharts = {};

  histResults.forEach(({id, data}) => {
    if (data.length === 0) return;
    const d = [...data].reverse();
    const labels = d.map(r => new Date(r.ts).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }));
    const temps = d.map(r => r.temp_c);
    const humids = d.map(r => r.humidity);

    const common = { type:'line', options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } },
      scales:{ x:{ ticks:{ maxTicksLimit:8, font:{ size:10 } }, grid:{ display:false } }, y:{ ticks:{ font:{ size:10 } } } },
      interaction:{ intersect:false, mode:'index' } } };

    const tc = new Chart(document.getElementById('dev_temp_'+id), { ...common,
      data:{ labels, datasets:[{ data:temps, borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,.1)', fill:true, tension:0.3, pointRadius:0 }] } });
    tc.options.scales.y.title = { display:true, text:'°C' };

    const hc = new Chart(document.getElementById('dev_humi_'+id), { ...common,
      data:{ labels, datasets:[{ data:humids, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,.1)', fill:true, tension:0.3, pointRadius:0 }] } });
    hc.options.scales.y.title = { display:true, text:'%' };

    deviceCharts[id] = { temp: tc, humid: hc };
  });
}

function removeDeviceRow(deviceId) {
  if (deviceCharts[deviceId]) { deviceCharts[deviceId].temp.destroy(); deviceCharts[deviceId].humid.destroy(); delete deviceCharts[deviceId]; }
  const card = document.getElementById('dev_temp_'+deviceId)?.closest('.device-card');
  if (card) card.remove();
}

async function init() {
  initCharts();
  refreshStatus();
  await loadDevices();
  if (currentDevice) {
    addDevice(currentDevice);
    loadDates();
    loadAll();
    setInterval(() => {
      refreshStatus();
      if (viewMode === 'perDevice') renderDeviceRows(); else loadAll();
    }, 10000);
  }
}

init();
</script>
</body>
</html>"""

DASHBOARD_HTML = DASHBOARD_HTML.replace("AMAP_KEY_PLACEHOLDER", AMAP_JS_KEY)
