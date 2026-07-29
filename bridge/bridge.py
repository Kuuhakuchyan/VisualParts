"""
MQTT -> PostgreSQL 桥接服务

改进点:
- 动态字段存储: 通用字段写列, 传感器特有字段进 JSONB extra
- JSONL 格式: 替代固定表头 CSV, 每行一个 JSON, 天然支持异构传感器
- 每天每个设备每种类型一个 .jsonl 文件
- 自动清理过期 JSONL (默认保留 30 天)
"""

import json
import asyncio
import asyncpg
import paho.mqtt.client as mqtt
import os
import glob
import time
from datetime import datetime, timedelta, timezone

# 环境变量
PG = {
    "host": os.getenv("PG_HOST", "postgres"),
    "port": int(os.getenv("PG_PORT", "5432")),
    "database": os.getenv("PG_DB", "iot_platform"),
    "user": os.getenv("PG_USER", "iot_user"),
    "password": os.getenv("PG_PASS", ""),
}
MQTT_HOST = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "")
MQTT_PASS = os.getenv("MQTT_PASS", "")
DATA_DIR = os.getenv("DATA_DIR", "./data")
JSONL_RETENTION_DAYS = int(os.getenv("JSONL_RETENTION_DAYS", "30"))

pool = None
loop = None

# ====================================================================
# JSONL 写入 (替代固定表头 CSV, 每行一个 JSON, 字段可随传感器不同)
# ====================================================================

def jsonl_path(device_id: str, dtype: str) -> str:
    """data/ATOM_LITE_01/telemetry_20260517.jsonl"""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    d = os.path.join(DATA_DIR, device_id)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{dtype}_{today}.jsonl")


def write_jsonl(device_id: str, dtype: str, data: dict):
    """追加一行 JSON 到当天的 JSONL 文件"""
    path = jsonl_path(device_id, dtype)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")


def cleanup_jsonl():
    """删除超过 JSONL_RETENTION_DAYS 天的旧文件"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=JSONL_RETENTION_DAYS)
    deleted = 0
    for f in glob.glob(os.path.join(DATA_DIR, "*", "*.jsonl")):
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(f), tz=timezone.utc)
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
        print(f"[JSONL] 清理 {deleted} 个过期文件 (>{JSONL_RETENTION_DAYS}天)")


# ====================================================================
# PostgreSQL 写入
# ====================================================================

async def insert_telemetry(device_id: str, data: dict):
    """动态存储: 通用字段写列, 其余全部进 JSONB extra"""
    ts_str = data.pop("ts", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))

    # 提取通用字段 (pop 出来, 剩下的进 extra)
    bat = data.pop("bat", None)
    uptime = data.pop("uptime_s", None)
    temp = data.pop("temp", None)
    humid = data.pop("humid", None)

    extra = json.dumps(data) if data else None

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO sensor_data (ts, device_id, bat_v, uptime_s, temp_c, humidity, extra)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            """,
            ts, device_id, bat, uptime, temp, humid, extra,
        )


async def insert_gps(device_id: str, data: dict):
    ts_str = data.pop("ts", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO device_location
                (ts, device_id, geom, alt_m, satellites, pos_src, accuracy_m)
            VALUES ($1, $2,
                ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8)
            """,
            ts, device_id,
            data.get("lon"), data.get("lat"),
            data.get("alt"), data.get("satellites"),
            data.get("pos_src"), data.get("accuracy_m"),
        )


async def upsert_device(device_id: str, device_type: str = None):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO device_info (device_id, device_type, last_seen)
            VALUES ($1, $2, now())
            ON CONFLICT (device_id) DO UPDATE SET last_seen = now()
            """,
            device_id, device_type,
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
            write_jsonl(device_id, "telemetry", data)
            # 动态打印: 显示设备上报的所有字段
            fields = ", ".join(f"{k}={v}" for k, v in data.items() if k not in ("device", "ts"))
            print(f"[DATA] {device_id}: {fields}")

        elif topic.endswith("/gps"):
            await insert_gps(device_id, data)
            write_jsonl(device_id, "gps", data)
            print(f"[GPS]  {device_id}: {data.get('lat')}, {data.get('lon')}")

        elif topic.endswith("/status"):
            print(f"[STATUS] {device_id}: {data}")

    except Exception as e:
        print(f"[DB ERROR] {e}")


# ====================================================================
# 主入口
# ====================================================================

async def main():
    global pool, loop
    loop = asyncio.get_running_loop()

    # PostgreSQL 连接重试 (等 postgres 就绪)
    retry = 0
    while True:
        try:
            pool = await asyncpg.create_pool(**PG, min_size=2, max_size=10)
            print("[PG] 数据库连接池已建立")
            break
        except Exception as e:
            retry += 1
            wait = min(retry * 2, 30)
            print(f"[PG] 连接失败 (重试 {retry}, {wait}s后重试): {e}")
            await asyncio.sleep(wait)

    os.makedirs(DATA_DIR, exist_ok=True)
    cleanup_jsonl()

    mqtt_client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="bridge_service",
    )
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.will_set("bridge/status", payload="offline", qos=1, retain=True)
    if MQTT_USER:
        mqtt_client.username_pw_set(MQTT_USER, MQTT_PASS)
    mqtt_client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
    mqtt_client.loop_start()
    print(f"[MQTT] 已连接 {MQTT_HOST}:{MQTT_PORT}")

    while True:
        await asyncio.sleep(3600)
        cleanup_jsonl()


if __name__ == "__main__":
    asyncio.run(main())









