# IoT 云平台架构方案

## 1. 总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        设备层                                   │
│  ATOM_LITE (SHT30+GPS) ─MQTT─▶ Mosquitto Broker                │
│  M5Stick Plus2           (后续加入)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       消息 & 桥接层                              │
│  Mosquitto (MQTT Broker) ←→ Python 桥接服务 (paho-mqtt)        │
│  端口: 1883 (MQTT)    9090 (WebSocket, Grafana 直连用)          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       数据层 (Docker)                            │
│  PostgreSQL 16 + PostGIS + TimescaleDB + pgvector               │
│  ├── sensor_data (TimescaleDB 超表，温湿度等时序数据)             │
│  ├── device_location (PostGIS 地理表，GPS 轨迹)                  │
│  ├── device_info (设备管理)                                      │
│  └── knowledge_embeddings (pgvector，RAG 文档向量)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       可视化 & RAG                               │
│  Grafana ←── PostgreSQL (实时仪表盘，地图+时序图)                │
│  Python(RAG) ←── pgvector + LLM (Agent 检索 + 数据分析)         │
│  网页 ←── FastAPI (对外 API 服务)                                │
└─────────────────────────────────────────────────────────────────┘
```

**所有数据在同一个 PostgreSQL 实例内**，时序表(VARCHAR sensor_id) JOIN 位置表(PostGIS geometry) JOIN 设备表 一句 SQL 完成，不需要跨库调用。

---

## 2. 设备端改动 (ATOM_LITE)

### 2.1 从 HTTP 改为 MQTT

| 对比 | 当前 HTTP | 改为 MQTT |
|------|----------|-----------|
| 协议 | HTTP POST JSON | MQTT Publish JSON |
| 库 | HTTPClient.h | PubSubClient.h (Arduino) |
| 断线 | 自行重试 | 协议自带 keepalive + 遗嘱 |
| 服务器压力 | 每次 TCP 握手 | 长连接，报文 < 100 bytes |
| 双向通信 | 不支持 | 支持（可下发指令到设备） |

### 2.2 MQTT 主题设计

```
上行 (设备→服务器):
sensor/{device_id}/telemetry    → 温湿度等 JSON (每 30s)
sensor/{device_id}/gps          → GPS 坐标 JSON (有变化时)
sensor/{device_id}/status       → 设备状态 (上线/离线，遗嘱消息)

下行 (服务器→设备):
cmd/{device_id}/config          → 修改采样间隔等参数
cmd/{device_id}/reboot          → 远程重启
```

### 2.3 上报 JSON 格式

```json
// sensor/{device_id}/telemetry
{
  "device": "ATOM_LITE_01",
  "ts": "2026-05-17T14:30:00Z",
  "temp": 25.3,
  "humid": 60.1,
  "bat": 3.85,
  "uptime_s": 3600
}

// sensor/{device_id}/gps
{
  "device": "ATOM_LITE_01",
  "ts": "2026-05-17T14:30:00Z",
  "lat": 34.821085,
  "lon": 113.527073,
  "alt": 125.5,
  "satellites": 8,
  "pos_src": "GPS",
  "accuracy_m": 5.0
}
```

### 2.4 改动的文件

- [src/config.h](c:\Users\123\Desktop\Working\大创\IoT\ATOM_LITE\src\config.h) — 添加 MQTT 配置
  ```cpp
  #define MQTT_BROKER    "你的服务器公网IP"
  #define MQTT_PORT      1883
  #define MQTT_DEVICE_ID "ATOM_LITE_01"
  ```
- [src/sta_client.cpp](c:\Users\123\Desktop\Working\大创\IoT\ATOM_LITE\src\sta_client.cpp) — `sta_send()` 改为 MQTT publish
- `platformio.ini` — 添加 PubSubClient 库依赖
  ```
  knolleary/PubSubClient@^2.8
  ```

---

## 3. 服务端部署 (Docker Compose)

### 3.1 文件: `docker-compose.yml`

```yaml
version: '3.8'

services:
  # ========== MQTT Broker ==========
  mosquitto:
    image: eclipse-mosquitto:2.0
    container_name: mosquitto
    ports:
      - "1883:1883"      # MQTT
      - "9001:9001"      # WebSocket (Grafana 直连)
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - ./mosquitto/data:/mosquitto/data
    restart: unless-stopped

  # ========== PostgreSQL 四合一 ==========
  postgres:
    image: pgvector/pgvector:pg16  # 内置 pgvector
    container_name: postgres_iot
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: iot_platform
      POSTGRES_USER: iot_user
      POSTGRES_PASSWORD: your_strong_password
    volumes:
      - ./pg_data:/var/lib/postgresql/data
      - ./pg_init:/docker-entrypoint-initdb.d  # 初始化脚本
    restart: unless-stopped

  # ========== Python 桥接 (MQTT → PG) ==========
  bridge:
    build: ./bridge
    container_name: mqtt_bridge
    depends_on:
      - mosquitto
      - postgres
    environment:
      MQTT_BROKER: mosquitto
      MQTT_PORT: 1883
      PG_HOST: postgres
      PG_PORT: 5432
      PG_DB: iot_platform
      PG_USER: iot_user
      PG_PASS: your_strong_password
    restart: unless-stopped

  # ========== 可视化 ==========
  grafana:
    image: grafana/grafana-oss:latest
    container_name: grafana
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: your_admin_password
    volumes:
      - ./grafana_data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./grafana/datasources:/etc/grafana/provisioning/datasources
    depends_on:
      - postgres
    restart: unless-stopped

  # ========== FastAPI 对外服务 (网页 + RAG 接口) ==========
  api:
    build: ./api
    container_name: iot_api
    ports:
      - "8080:8080"
    environment:
      PG_HOST: postgres
      PG_PORT: 5432
      PG_DB: iot_platform
      PG_USER: iot_user
      PG_PASS: your_strong_password
    depends_on:
      - postgres
    restart: unless-stopped
```

### 3.2 服务器目录结构

```
~/iot-platform/
├── docker-compose.yml
├── mosquitto/
│   └── config/
│       └── mosquitto.conf
├── pg_init/
│   └── 001_init.sql          # 数据库初始化
├── bridge/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── bridge.py              # MQTT → PG + CSV 桥接
├── data/                      # CSV 自动生成 (按设备/按天)
│   ├── ATOM_LITE_01/
│   │   ├── telemetry_20260517.csv
│   │   └── gps_20260517.csv
│   └── ...
├── api/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app.py                 # FastAPI 主程序
│   └── templates/
│       └── dashboard.html     # 网页仪表盘 (后续)
└── grafana/
    ├── dashboards/
    │   └── iot_dashboard.json # Grafana 仪表盘定义
    └── datasources/
        └── postgres.yaml      # 数据源配置
```

---

## 4. 数据库 Schema

### 4.1 初始化脚本: `pg_init/001_init.sql`

```sql
-- ========== 扩展 ==========
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;

-- ========== 设备表 ==========
CREATE TABLE device_info (
    device_id   VARCHAR(32) PRIMARY KEY,
    device_type VARCHAR(32),           -- 'ATOM_LITE' / 'M5Stick_Plus2'
    created_at  TIMESTAMPTZ DEFAULT now(),
    last_seen   TIMESTAMPTZ,
    firmware    VARCHAR(32)
);

-- ========== 时序数据 (TimescaleDB 超表) ==========
CREATE TABLE sensor_data (
    ts         TIMESTAMPTZ NOT NULL,
    device_id  VARCHAR(32) NOT NULL REFERENCES device_info(device_id),
    temp_c     REAL,
    humidity   REAL,
    bat_v      REAL,
    uptime_s   INTEGER
);

-- 转为超表，按天自动分区
SELECT create_hypertable('sensor_data', 'ts',
    chunk_time_interval => INTERVAL '1 day');

-- 7 天后自动压缩历史 chunk，节省空间
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'ts DESC'
);

-- 自动压缩策略: 3 天前的数据自动压缩
SELECT add_compression_policy('sensor_data', INTERVAL '3 days');

-- 自动删除策略: 90 天前的数据删除（按需调整）
SELECT add_retention_policy('sensor_data', INTERVAL '90 days');

-- 索引: 按设备查询
CREATE INDEX idx_sensor_device_ts ON sensor_data (device_id, ts DESC);

-- ========== GPS 位置 (PostGIS 空间表) ==========
CREATE TABLE device_location (
    ts         TIMESTAMPTZ NOT NULL,
    device_id  VARCHAR(32) NOT NULL REFERENCES device_info(device_id),
    geom       GEOMETRY(Point, 4326),   -- WGS84 经纬度 (EPSG:4326)
    alt_m      REAL,                    -- 海拔
    satellites SMALLINT,                -- 卫星数
    pos_src    VARCHAR(16),             -- 'GPS' / 'WiFi' / 'Fixed'
    accuracy_m REAL
);

-- 空间索引
CREATE INDEX idx_location_geom ON device_location USING GIST (geom);
CREATE INDEX idx_location_device_ts ON device_location (device_id, ts DESC);

-- 转为超表（可选，GPS 数据量不大时可以不用）
SELECT create_hypertable('device_location', 'ts',
    chunk_time_interval => INTERVAL '1 day');

-- ========== RAG 知识库 (pgvector，后续扩展) ==========
CREATE TABLE knowledge_embeddings (
    id          SERIAL PRIMARY KEY,
    source      VARCHAR(128),          -- 文档来源
    chunk_text  TEXT,                  -- 原始文本
    embedding   VECTOR(1536),          -- OpenAI text-embedding-ada-002 / 本地模型
    metadata    JSONB,                 -- 灵活元数据
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_knowledge_embedding ON knowledge_embeddings
    USING ivfflat (embedding vector_cosine_ops);
```

### 4.2 跨库查询示例

```sql
-- 查询某设备过去 1 小时的温湿度 + GPS 轨迹
SELECT
    s.ts,
    s.temp_c,
    s.humidity,
    ST_Y(l.geom) AS lat,
    ST_X(l.geom) AS lon
FROM sensor_data s
LEFT JOIN LATERAL (
    -- 找时间最近的 GPS 点 (空间 JOIN + 时间 JOIN)
    SELECT geom, ts
    FROM device_location
    WHERE device_id = s.device_id
      AND ts BETWEEN s.ts - INTERVAL '5 seconds'
                 AND s.ts + INTERVAL '5 seconds'
    ORDER BY abs(EXTRACT(EPOCH FROM ts - s.ts))
    LIMIT 1
) l ON true
WHERE s.device_id = 'ATOM_LITE_01'
  AND s.ts > now() - INTERVAL '1 hour'
ORDER BY s.ts DESC;

-- 空间查询: 找离某个坐标 5km 内的所有设备
SELECT device_id, ST_Distance(geom, ST_SetSRID(ST_MakePoint(113.527, 34.821), 4326)::geography) AS dist_m
FROM device_location
WHERE ST_DWithin(
    geom::geography,
    ST_SetSRID(ST_MakePoint(113.527, 34.821), 4326)::geography,
    5000
)
ORDER BY dist_m;

-- RAG: 检索与某个问题最相关的文档 (后续)
SELECT chunk_text, 1 - (embedding <=> query_embedding) AS similarity
FROM knowledge_embeddings
ORDER BY embedding <=> query_embedding
LIMIT 5;
```

---

## 5. Python 桥接服务

### 5.1 `bridge/requirements.txt`

```
paho-mqtt>=2.0
asyncpg>=0.29
```

### 5.2 `bridge/bridge.py`

```python
"""
MQTT -> PostgreSQL 桥接服务
- 订阅所有 sensor/+/telemetry 和 sensor/+/gps 主题
- 解析 JSON 写入 PostgreSQL
- 同时写 CSV 到 data/ 目录 (按天分文件)
- 自动清理过期 CSV (保留 30 天)
- 支持断线重连
"""

import json
import asyncio
import asyncpg
import paho.mqtt.client as mqtt
import os
import csv
import glob
import time
from datetime import datetime, timedelta

# 配置从环境变量读取
PG = {
    "host": os.getenv("PG_HOST", "postgres"),
    "port": int(os.getenv("PG_PORT", "5432")),
    "database": os.getenv("PG_DB", "iot_platform"),
    "user": os.getenv("PG_USER", "iot_user"),
    "password": os.getenv("PG_PASS", ""),
}
MQTT_HOST = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
DATA_DIR = os.getenv("DATA_DIR", "./data")
CSV_RETENTION_DAYS = int(os.getenv("CSV_RETENTION_DAYS", "30"))  # CSV 保留天数

pool = None  # asyncpg connection pool
_last_cleanup = 0

# ====================================================================
# CSV 写入 (按天分文件, 每天每个设备每种类型一个文件)
# ====================================================================
CSV_HEADERS = {
    "telemetry": ["ts", "device", "temp_c", "humidity", "bat_v", "uptime_s"],
    "gps":       ["ts", "device", "lat", "lon", "alt_m", "satellites", "pos_src", "accuracy_m"],
}

def csv_path(device_id: str, dtype: str) -> str:
    """生成当天 CSV 文件路径: data/ATOM_LITE_01/telemetry_20260517.csv"""
    today = datetime.utcnow().strftime("%Y%m%d")
    d = os.path.join(DATA_DIR, device_id)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{dtype}_{today}.csv")

def write_csv(device_id: str, dtype: str, row: dict):
    """追加一行到 CSV, 若文件不存在则先写表头"""
    path = csv_path(device_id, dtype)
    write_header = not os.path.exists(path)
    # 第 1 列统一用 timestamp
    ts = row.get("ts", datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))
    headers = CSV_HEADERS.get(dtype, list(row.keys()))
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        if write_header:
            w.writeheader()
        row["ts"] = ts
        w.writerow(row)

# ====================================================================
# CSV 过期清理
# ====================================================================
def cleanup_csv():
    """删除超过 CSV_RETENTION_DAYS 天的 CSV 文件"""
    cutoff = datetime.utcnow() - timedelta(days=CSV_RETENTION_DAYS)
    pattern = os.path.join(DATA_DIR, "*", "*.csv")
    deleted = 0
    for f in glob.glob(pattern):
        try:
            mtime = datetime.utcfromtimestamp(os.path.getmtime(f))
            if mtime < cutoff:
                os.remove(f)
                deleted += 1
        except OSError:
            pass
    # 清理空目录
    for root, dirs, files in os.walk(DATA_DIR, topdown=False):
        if root == DATA_DIR:
            continue
        if not files and not dirs:
            try:
                os.rmdir(root)
            except OSError:
                pass
    if deleted:
        print(f"[CSV] 清理 {deleted} 个过期文件 (>{CSV_RETENTION_DAYS}天)")

# ====================================================================
# PostgreSQL 写入
# ====================================================================
async def insert_telemetry(device_id: str, data: dict):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO sensor_data (ts, device_id, temp_c, humidity, bat_v, uptime_s)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            datetime.fromisoformat(data["ts"].replace("Z", "+00:00")),
            device_id,
            data.get("temp"),
            data.get("humid"),
            data.get("bat"),
            data.get("uptime_s"),
        )

async def insert_gps(device_id: str, data: dict):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO device_location
                (ts, device_id, geom, alt_m, satellites, pos_src, accuracy_m)
            VALUES ($1, $2,
                ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8)
            """,
            datetime.fromisoformat(data["ts"].replace("Z", "+00:00")),
            device_id,
            data.get("lon"),
            data.get("lat"),
            data.get("alt"),
            data.get("satellites"),
            data.get("pos_src"),
            data.get("accuracy_m"),
        )

async def upsert_device(device_id: str, device_type: str = None):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO device_info (device_id, device_type, last_seen)
            VALUES ($1, $2, now())
            ON CONFLICT (device_id) DO UPDATE SET last_seen = now()
            """,
            device_id,
            device_type,
        )

# ====================================================================
# MQTT 回调
# ====================================================================
def on_connect(client, userdata, flags, reason_code, properties):
    print(f"[MQTT] 已连接 (rc={reason_code})")
    client.subscribe("sensor/+/telemetry")
    client.subscribe("sensor/+/gps")
    client.subscribe("sensor/+/status")
    print("[MQTT] 已订阅 sensor/+/telemetry, sensor/+/gps, sensor/+/status")

def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload)
        device_id = payload.get("device", "unknown")
        topic = msg.topic
        asyncio.run_coroutine_threadsafe(
            handle_message(device_id, topic, payload), loop
        )
    except Exception as e:
        print(f"[ERROR] 消息解析失败: {e}")

async def handle_message(device_id: str, topic: str, data: dict):
    try:
        await upsert_device(device_id)
        if topic.endswith("/telemetry"):
            await insert_telemetry(device_id, data)
            write_csv(device_id, "telemetry", data)
            print(f"[DATA] {device_id} 温湿度: {data.get('temp')}C {data.get('humid')}%")
        elif topic.endswith("/gps"):
            await insert_gps(device_id, data)
            write_csv(device_id, "gps", data)
            print(f"[GPS]  {device_id}: {data.get('lat')}, {data.get('lon')}")
        elif topic.endswith("/status"):
            print(f"[STATUS] {device_id}: {data}")
    except Exception as e:
        print(f"[DB ERROR] {e}")

# ====================================================================
# 主入口
# ====================================================================
async def main():
    global pool, loop, _last_cleanup
    loop = asyncio.get_running_loop()

    pool = await asyncpg.create_pool(**PG, min_size=2, max_size=10)
    print("[PG] 数据库连接池已建立")

    # 确保 data 目录存在
    os.makedirs(DATA_DIR, exist_ok=True)
    cleanup_csv()

    mqtt_client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="bridge_service",
    )
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.will_set(
        "bridge/status", payload="offline", qos=1, retain=True
    )
    mqtt_client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
    mqtt_client.loop_start()
    print(f"[MQTT] 已连接 {MQTT_HOST}:{MQTT_PORT}")

    # 每小时清理一次过期 CSV
    while True:
        await asyncio.sleep(3600)
        cleanup_csv()

if __name__ == "__main__":
    asyncio.run(main())
```

### 5.3 `bridge/Dockerfile`

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY bridge.py .
CMD ["python", "bridge.py"]
```

---

## 6. FastAPI 对外服务

### 6.1 `api/requirements.txt`

```
fastapi>=0.110
uvicorn[standard]>=0.27
asyncpg>=0.29
psycopg2-binary>=2.9   # Grafana PostgreSQL 数据源也用它
```

### 6.2 `api/app.py`

```python
"""
IoT 平台对外 API
- 数据查询接口
- 后续: RAG 集成、网页仪表盘
"""

from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
import asyncpg
import os
from datetime import datetime, timedelta

app = FastAPI(title="IoT Platform API")

PG_CONFIG = {
    "host": os.getenv("PG_HOST", "postgres"),
    "port": int(os.getenv("PG_PORT", "5432")),
    "database": os.getenv("PG_DB", "iot_platform"),
    "user": os.getenv("PG_USER", "iot_user"),
    "password": os.getenv("PG_PASS", ""),
}


async def get_pool():
    if not hasattr(app.state, "pool"):
        app.state.pool = await asyncpg.create_pool(**PG_CONFIG, min_size=2, max_size=10)
    return app.state.pool


@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "pool"):
        await app.state.pool.close()


# ---------- 数据查询接口 ----------

@app.get("/api/latest/{device_id}")
async def latest(device_id: str):
    """设备最新数据"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT s.ts, s.temp_c, s.humidity, s.bat_v,
                   ST_Y(l.geom) AS lat, ST_X(l.geom) AS lon
            FROM sensor_data s
            LEFT JOIN LATERAL (
                SELECT geom FROM device_location
                WHERE device_id = s.device_id
                ORDER BY ts DESC LIMIT 1
            ) l ON true
            WHERE s.device_id = $1
            ORDER BY s.ts DESC LIMIT 1
            """,
            device_id,
        )
        if row:
            return dict(row)
        return {"error": "not found"}


@app.get("/api/history/{device_id}")
async def history(
    device_id: str,
    hours: int = Query(default=24, le=168),
):
    """设备历史数据"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ts, temp_c, humidity, bat_v
            FROM sensor_data
            WHERE device_id = $1 AND ts > now() - $2::interval
            ORDER BY ts DESC
            """,
            device_id,
            timedelta(hours=hours),
        )
        return [dict(r) for r in rows]


@app.get("/api/track/{device_id}")
async def track(device_id: str, hours: int = Query(default=24, le=168)):
    """设备 GPS 轨迹 (GeoJSON 格式，前端 Leaflet/Mapbox 直接用)"""
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


@app.get("/api/devices")
async def devices():
    """所有设备列表及在线状态"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT device_id, device_type, last_seen,
                   last_seen > now() - interval '5 minutes' AS online
            FROM device_info
            ORDER BY last_seen DESC
            """
        )
        return [dict(r) for r in rows]


# ---------- 健康检查 ----------

@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------- 网页仪表盘 (后续) ----------

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    return """<h1>IoT Platform</h1><p>Dashboard coming soon.</p>"""
```

### 6.3 `api/Dockerfile`

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

---

## 7. Mosquitto 配置

### `mosquitto/config/mosquitto.conf`

```
# 基础
listener 1883
protocol mqtt

# WebSocket (Grafana MQTT 数据源需要)
listener 9001
protocol websockets

# 持久化
persistence true
persistence_location /mosquitto/data

# 日志
log_dest stdout
log_type all

# 允许匿名连接 (后续可加用户名密码)
allow_anonymous true
```

---

## 8. Grafana 配置

### 8.1 `grafana/datasources/postgres.yaml`

```yaml
apiVersion: 1
datasources:
  - name: PostgreSQL
    type: postgres
    url: postgres:5432
    database: iot_platform
    user: iot_user
    secureJsonData:
      password: your_strong_password
    jsonData:
      sslmode: disable
      postgresVersion: 1600
      timescaledb: true
```

### 8.2 Grafana 仪表盘 (建议面板)

| 面板 | 查询 |
|------|------|
| **实时温度表 (Gauge)** | `SELECT temp_c FROM sensor_data WHERE device_id='ATOM_LITE_01' ORDER BY ts DESC LIMIT 1` |
| **温度趋势 (Time Series)** | `SELECT ts, temp_c FROM sensor_data WHERE device_id='ATOM_LITE_01' AND ts > now() - interval '6 hours'` |
| **GPS 轨迹 (Geomap)** | `SELECT ts, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM device_location WHERE device_id='ATOM_LITE_01' AND ts > now() - interval '24 hours'` |
| **设备在线状态** | `SELECT device_id, last_seen > now() - interval '5 minutes' AS online FROM device_info` |

---

## 9. 部署步骤

```bash
# 1. 上传整个 iot-platform/ 目录到云服务器
scp -r iot-platform/ user@your-server:~/

# 2. 登录服务器
ssh user@your-server
cd ~/iot-platform

# 3. 启动所有服务
docker compose up -d

# 4. 验证
curl http://localhost:8080/health          # API
curl http://localhost:1883                   # MQTT (无响应但端口开)
curl http://localhost:3000                   # Grafana
psql -h localhost -U iot_user -d iot_platform -c "\dx"  # 扩展检查

# 5. 开放云服务器安全组端口
# 1883 (MQTT)    — ATOM_LITE 连接用
# 3000 (Grafana) — 可选，看仪表盘
# 8080 (API)     — 网页访问
```

---

## 10. 数据分层与归档策略

```
┌──────────────────────────────────────────────────────────┐
│ 热数据 (近 3 天)                                         │
│ 不解压，直接查询，毫秒级响应                              │
│ → Grafana 实时仪表盘                                    │
├──────────────────────────────────────────────────────────┤
│ 温数据 (3-7 天)                                         │
│ TimescaleDB 自动压缩，查询速度略降但仍可用                │
│ → 历史趋势分析                                          │
├──────────────────────────────────────────────────────────┤
│ 冷数据 (7-90 天)                                        │
│ 压缩存储，按需解压                                       │
│ → 长期趋势、RAG 分析                                    │
├──────────────────────────────────────────────────────────┤
│ 过期 (90 天+)                                           │
│ TimescaleDB 自动删除 (retention_policy)                  │
│ 如需永久保存，可先导出到对象存储 (S3/OSS)                │
└──────────────────────────────────────────────────────────┘
```

---

## 11. RAG 集成路线 (后续)

```
┌──────────┐    ┌───────────────┐    ┌────────────────┐
│ 用户提问  │───▶│ pgvector 检索  │───▶│ LLM (GPT/Llama) │
│ "上周平均 │    │ 相似历史数据   │    │ 结合检索结果    │
│  温度？"  │    │ + 相关文档    │    │ 生成自然语言    │
└──────────┘    └───────────────┘    └────────────────┘
```

- 方案 1 (轻量): `llama-index` + PostgreSQL 直接查询，Text-to-SQL 让 LLM 翻译自然语言为 SQL
- 方案 2 (进阶): `langchain` + pgvector 文档检索 + PostgreSQL 数据查询并行执行

这部分的实现细节后续单独设计。

---

## 12. 关键文件清单

| 文件 | 位置 | 说明 |
|------|------|------|
| `config.h` | ATOM_LITE `src/config.h` | STA_SSID, SERVER_URL → MQTT_BROKER |
| `sta_client.cpp` | ATOM_LITE `src/sta_client.cpp` | HTTP POST → MQTT Publish |
| `platformio.ini` | ATOM_LITE | 加 PubSubClient 库 |
| `docker-compose.yml` | 服务器 `~/iot-platform/` | 所有服务编排 |
| `001_init.sql` | `pg_init/` | PostgreSQL 建表脚本 |
| `bridge.py` | `bridge/` | MQTT → PG 桥接 |
| `app.py` | `api/` | FastAPI 对外接口 |
| `mosquitto.conf` | `mosquitto/` | MQTT Broker 配置 |
| `postgres.yaml` | `grafana/datasources/` | Grafana 数据源 |
