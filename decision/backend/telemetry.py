"""Authenticated UGV/UAV observation ingestion and query APIs.

Image bytes are uploaded separately from JSON observations. Device positions,
images and measurements require the same authenticated project-only access.
"""

import hashlib
import hmac
import io
import json
import os
import re
import sqlite3
import tempfile
import warnings
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import AwareDatetime, AliasChoices, BaseModel, ConfigDict, Field, UUID4, ValidationError, field_serializer, field_validator, model_validator

from backend.data_contract import UGVTelemetry


SCHEMA_VERSION = "WJTJ-mobile-telemetry-1.0"
DEVICE_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
MEDIA_MAX_BYTES = 8 * 1024 * 1024
MEDIA_PREFIX = "/api/weather/telemetry/media/"


def telemetry_enabled():
    return os.getenv("MOBILE_TELEMETRY_ENABLED", "1") == "1" and os.getenv("COLLECTION_IOT_DISABLED") != "1"


def require_ingest_token(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if not telemetry_enabled() or request.url.hostname == "aic.nogamenolife.cn":
        raise HTTPException(404, "接口不存在")
    expected = os.getenv("TELEMETRY_INGEST_TOKEN", "")
    if not expected:
        raise HTTPException(503, "遥测接入尚未配置 TELEMETRY_INGEST_TOKEN")
    supplied = request.headers.get("x-telemetry-token", "")
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(401, "遥测接入凭证无效")


router = APIRouter(prefix="/api/weather/telemetry", tags=["mobile-telemetry"],
                   dependencies=[Depends(require_ingest_token)])


def utc_stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds")


class DeviceLocation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float | None = Field(default=None, ge=-500, le=20000)
    altitude_reference: Literal["amsl", "ellipsoid", "agl", "unknown"] = "unknown"
    crs: Literal["EPSG:4326"] = "EPSG:4326"
    accuracy_m: float | None = Field(default=None, ge=0, le=10000)
    fix_type: Literal["none", "single", "dgnss", "rtk_float", "rtk_fix"] = "single"
    satellites: int | None = Field(default=None, ge=0, le=100)
    hdop: float | None = Field(default=None, ge=0, le=100)
    heading_deg: float | None = Field(default=None, ge=0, le=360)
    speed_mps: float | None = Field(default=None, ge=0, le=100)


class DeviceStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    state: Literal["online", "idle", "teleop", "cruise", "dwell", "returning", "charging", "fault", "offline"]
    mode: Literal["idle", "teleop", "cruise", "dwell", "returning", "charging", "fault"] = "idle"
    error_code: str | None = Field(default=None, max_length=80)
    selftest_pass: bool | None = Field(default=None, strict=True)
    is_synced: bool = Field(strict=True)
    unsynced_count: int = Field(default=0, ge=0, le=10_000_000)
    network_type: Literal["none", "wifi", "4g", "5g", "lora", "mesh", "ethernet"] | None = None
    rssi_dbm: int | None = Field(default=None, ge=-150, le=0)
    firmware_version: str | None = Field(default=None, max_length=64)
    config_version: str | None = Field(default=None, max_length=64)
    software_commit: str | None = Field(default=None, max_length=80)
    uptime_s: int | None = Field(default=None, ge=0, strict=True)
    interface_version: str | None = Field(default=None, pattern=r"^IF-0[23]/\d+\.\d+$", max_length=16)

    @model_validator(mode="after")
    def fault_has_reason(self):
        if self.state == "fault" and not self.error_code:
            raise ValueError("fault 状态必须提供 error_code")
        return self


class PowerState(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    voltage_v: float | None = Field(default=None, ge=0, le=1000)
    current_a: float | None = Field(default=None, ge=-500, le=500)
    power_w: float | None = Field(default=None, ge=-10000, le=10000)
    soc_pct: float | None = Field(default=None, ge=0, le=100)
    charging: bool | None = None


class EnvironmentalMeasurements(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    temperature_c: float | None = Field(ge=-40, le=85)
    humidity_pct: float | None = Field(ge=0, le=100)
    pressure_hpa: float | None = Field(default=None, ge=100, le=1100)
    wind_speed_mps: float | None = Field(default=None, ge=0, le=100)
    wind_direction_deg: float | None = Field(default=None, ge=0, le=360)
    solar_radiation_w_m2: float | None = Field(default=None, ge=0, le=2500)
    globe_temperature_c: float | None = Field(default=None, ge=-40, le=100)
    temperature_raw_c: float | None = Field(default=None, ge=-40, le=85)
    temperature_secondary_c: float | None = Field(default=None, ge=-40, le=85)
    humidity_raw_pct: float | None = Field(default=None, ge=0, le=100)
    sensor_height_agl_m: float | None = Field(default=None, ge=0, le=20000)


class GroundPlatform(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    fan_rpm: int | None = Field(default=None, ge=0, le=100000, strict=True)
    body_temperature_c: float | None = Field(default=None, ge=-40, le=150)
    odometer_m: float | None = Field(default=None, ge=0)
    emergency_stop: bool | None = Field(default=None, strict=True)


class FlightState(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    altitude_agl_m: float | None = Field(default=None, ge=0, le=20000)
    flight_mode: str | None = Field(default=None, max_length=64)
    armed: bool | None = Field(default=None, strict=True)
    roll_deg: float | None = Field(default=None, ge=-180, le=180)
    pitch_deg: float | None = Field(default=None, ge=-180, le=180)
    yaw_deg: float | None = Field(default=None, ge=0, le=360)
    vertical_speed_mps: float | None = Field(default=None, ge=-100, le=100)
    gimbal_pitch_deg: float | None = Field(default=None, ge=-180, le=180)
    distance_to_home_m: float | None = Field(default=None, ge=0)


class VisualFrame(BaseModel):
    """A reference to a captured image, never an inline base64 image."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    # The device must provide a stable id so a retried observation hashes identically.
    frame_id: str = Field(min_length=1, max_length=100)
    captured_at: AwareDatetime
    modality: Literal["rgb", "thermal", "multispectral", "depth", "panorama"] = "rgb"
    camera_id: str | None = Field(default=None, max_length=80)
    storage_uri: str = Field(min_length=1, max_length=512)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mime_type: Literal["image/jpeg", "image/png", "image/webp", "image/tiff"]
    size_bytes: int = Field(gt=0, le=50_000_000)
    width_px: int | None = Field(default=None, ge=1, le=100_000)
    height_px: int | None = Field(default=None, ge=1, le=100_000)
    gsd_cm: float | None = Field(default=None, gt=0, le=1000)
    capture_location: DeviceLocation | None = None
    metadata: dict[str, str | float | int | bool] = Field(default_factory=dict, max_length=30)

    @field_validator("captured_at")
    @classmethod
    def normalize_time(cls, value):
        return value.astimezone(timezone.utc)

    @field_serializer("captured_at")
    def serialize_time(self, value):
        return utc_stamp(value)

    @model_validator(mode="after")
    def safe_reference(self):
        parts = urlsplit(self.storage_uri)
        local = self.storage_uri.startswith(MEDIA_PREFIX) and SHA256.fullmatch(self.storage_uri[len(MEDIA_PREFIX):])
        remote = parts.scheme in {"https", "s3"} and parts.netloc and not parts.username and not parts.password
        if not local and not remote:
            raise ValueError("图片引用只能为遥测媒体接口路径、HTTPS或S3；禁止本地文件、内嵌图像或带凭证URL")
        if local and self.storage_uri[len(MEDIA_PREFIX):] != self.sha256:
            raise ValueError("媒体路径与 sha256 不一致")
        return self


class DeviceEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    schema_version: Literal[SCHEMA_VERSION] = SCHEMA_VERSION
    uuid: UUID4
    device_type: Literal["UGV", "UAV"]
    device_name: str = Field(min_length=1, max_length=120)
    device_id: str = Field(min_length=1, max_length=80)
    sampled_at_ms: AwareDatetime = Field(validation_alias=AliasChoices("sampled_at_ms", "sampled_at"))

    @field_validator("sampled_at_ms")
    @classmethod
    def normalize_time(cls, value):
        if value.microsecond % 1000:
            raise ValueError("采样时间精度最多为毫秒")
        return value.astimezone(timezone.utc)

    @field_serializer("sampled_at_ms")
    def serialize_time(self, value):
        return utc_stamp(value)

    @field_validator("device_id")
    @classmethod
    def valid_device_id(cls, value):
        if not DEVICE_ID.fullmatch(value):
            raise ValueError("device_id 只能包含字母、数字、下划线、点、冒号或短横线")
        return value


class MobileTelemetry(DeviceEnvelope):
    """Canonical common payload for both ground and aerial platforms."""

    task_id: str = Field(min_length=1, max_length=80)
    task_group_id: str | None = Field(default=None, max_length=80)
    seq: int = Field(ge=0, le=9_223_372_036_854_775_807, strict=True)
    source_type: Literal["field_collection"] = "field_collection"
    status: DeviceStatus
    location: DeviceLocation
    measurements: EnvironmentalMeasurements
    power: PowerState | None = None
    quality_flag: int = Field(ge=0, le=4_294_967_295, strict=True)
    sensor_id: str | None = Field(default=None, max_length=80)
    calibration_id: str | None = Field(default=None, max_length=120)
    lcz_hint: str | None = Field(default=None, pattern=r"^LCZ_(?:[1-9]|10|[A-G])$")
    visual_frames: list[VisualFrame] = Field(default_factory=list, max_length=12)
    ugv: GroundPlatform | None = None
    uav: FlightState | None = None
    attributes: dict[str, str | float | int | bool | None] = Field(default_factory=dict, max_length=50)

    @model_validator(mode="after")
    def validate_identity(self):
        if self.device_type == "UAV" and self.location.altitude_m is None:
            raise ValueError("UAV 数据必须提供 altitude_m")
        if (self.device_type == "UGV" and self.uav is not None) or (self.device_type == "UAV" and self.ugv is not None):
            raise ValueError("UGV/UAV 扩展字段与设备类型不匹配")
        if self.device_type == "UGV" and self.location.speed_mps is not None and self.location.speed_mps > 1.5:
            raise ValueError("UGV speed_mps 不得超过需求契约的1.5m/s")
        if (self.measurements.temperature_c is None or self.measurements.humidity_pct is None) and self.quality_flag == 0:
            raise ValueError("缺失读数必须显式设置非零质量标记，不能作为正常采样")
        if len({frame.frame_id for frame in self.visual_frames}) != len(self.visual_frames):
            raise ValueError("同一报文的 frame_id 不得重复")
        return self


class DeviceHeartbeat(DeviceEnvelope):
    status: DeviceStatus
    power: PowerState | None = None
    attributes: dict[str, str | float | int | bool | None] = Field(default_factory=dict, max_length=50)


class LocationReport(DeviceEnvelope):
    location: DeviceLocation

    @model_validator(mode="after")
    def validate_identity(self):
        if self.device_type == "UAV" and self.location.altitude_m is None:
            raise ValueError("UAV GPS 数据必须提供 altitude_m")
        return self


class BatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    records: list[dict] = Field(min_length=1, max_length=500)


def _payload_hash(value: dict) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def adapt_legacy(body: UGVTelemetry):
    u = body.ugv
    return MobileTelemetry.model_validate({
        "uuid": u.uuid, "device_type": "UGV", "device_name": u.device_id,
        "device_id": u.device_id, "sampled_at_ms": u.sampled_at_ms,
        "task_id": u.task_id, "task_group_id": u.task_group_id, "seq": u.seq,
        "status": {"state": u.mode, "mode": u.mode, "is_synced": u.is_synced,
                   "firmware_version": u.firmware_version, "interface_version": u.iface_version,
                   "network_type": None, "rssi_dbm": u.rssi_dbm,
                   "error_code": "device_reported_fault" if u.mode == "fault" else None},
        "location": {"latitude": u.gps_lat, "longitude": u.gps_lon,
                     "altitude_m": u.gps_alt_m, "heading_deg": u.heading_deg,
                     "speed_mps": u.speed_mps, "fix_type": u.fix_type, "satellites": u.sat_num, "hdop": u.hdop},
        "measurements": {"temperature_c": u.temp_c, "humidity_pct": u.humidity_pct,
                         "temperature_raw_c": u.temp_raw_c, "temperature_secondary_c": u.temp_c_b,
                         "wind_speed_mps": u.wind_mps},
        "power": {"voltage_v": u.vbat_v, "soc_pct": u.soc_pct}, "quality_flag": u.quality_flag,
        "sensor_id": u.sensor_id, "lcz_hint": u.lcz_hint,
        "ugv": {"fan_rpm": u.fan_rpm, "body_temperature_c": u.body_temp_c},
    })


class TelemetryStore:
    def __init__(self, path: str | None = None):
        default = Path(os.getenv("WORKSPACE_STATE_DB", str(Path(tempfile.gettempdir()) / "microclimate_plans.sqlite3"))).with_name("mobile-telemetry.sqlite3")
        self.path = Path(path or os.getenv("TELEMETRY_STATE_DB", str(default)))

    @property
    def media_root(self):
        return Path(os.getenv("TELEMETRY_MEDIA_DIR", str(self.path.parent / "telemetry-media")))

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                db.execute("""CREATE TABLE IF NOT EXISTS mobile_telemetry (
                    uuid TEXT PRIMARY KEY, device_id TEXT NOT NULL, device_type TEXT NOT NULL,
                    task_id TEXT NOT NULL, seq INTEGER NOT NULL, sampled_at TEXT NOT NULL,
                    payload_hash TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL,
                    UNIQUE(device_id, task_id, seq)
                )""")
                db.execute("CREATE INDEX IF NOT EXISTS mobile_telemetry_device_time ON mobile_telemetry(device_id, sampled_at)")
                db.execute("""CREATE TABLE IF NOT EXISTS mobile_device_current (
                    device_id TEXT PRIMARY KEY, device_type TEXT NOT NULL, device_name TEXT NOT NULL,
                    sampled_at TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL
                )""")
                db.execute("""CREATE TABLE IF NOT EXISTS mobile_aux_records (
                    uuid TEXT PRIMARY KEY, kind TEXT NOT NULL, device_id TEXT NOT NULL,
                    sampled_at TEXT NOT NULL, payload_hash TEXT NOT NULL, payload TEXT NOT NULL,
                    received_at TEXT NOT NULL, UNIQUE(kind, device_id, sampled_at)
                )""")
                db.execute("""CREATE TABLE IF NOT EXISTS mobile_aux_current (
                    kind TEXT NOT NULL, device_id TEXT NOT NULL, device_type TEXT NOT NULL,
                    device_name TEXT NOT NULL, sampled_at TEXT NOT NULL, payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL, PRIMARY KEY(kind, device_id)
                )""")
                db.execute("""CREATE TABLE IF NOT EXISTS mobile_media (
                    sha256 TEXT PRIMARY KEY, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
                    width_px INTEGER NOT NULL, height_px INTEGER NOT NULL, uploaded_at TEXT NOT NULL
                )""")
                yield db
        finally:
            db.close()

    def save(self, body: MobileTelemetry):
        payload = body.model_dump(mode="json")
        digest = _payload_hash(payload)
        received_at = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._validate_identity(db, body)
            existing = db.execute("SELECT payload_hash, received_at FROM mobile_telemetry WHERE uuid=?", (str(body.uuid),)).fetchone()
            if existing:
                if existing["payload_hash"] != digest:
                    raise HTTPException(409, "同一 uuid 对应了不同报文，已拒绝覆盖")
                return receipt(body, digest, existing["received_at"], duplicated=True)
            if db.execute("SELECT 1 FROM mobile_aux_records WHERE uuid=?", (str(body.uuid),)).fetchone():
                raise HTTPException(409, "uuid 已被其他类型报文使用")
            for frame in body.visual_frames:
                if frame.storage_uri.startswith(MEDIA_PREFIX):
                    media = db.execute("SELECT * FROM mobile_media WHERE sha256=?", (frame.sha256,)).fetchone()
                    if media is None or not (self.media_root / frame.sha256).is_file():
                        raise HTTPException(422, "请先上传所引用的视觉图像")
                    for key in ("mime_type", "size_bytes", "width_px", "height_px"):
                        if getattr(frame, key) is not None and getattr(frame, key) != media[key]:
                            raise HTTPException(422, "图片元数据与已上传文件不一致")
            try:
                db.execute("""INSERT INTO mobile_telemetry
                    (uuid, device_id, device_type, task_id, seq, sampled_at, payload_hash, payload, received_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (str(body.uuid), body.device_id, body.device_type, body.task_id, body.seq,
                     utc_stamp(body.sampled_at_ms), digest, json.dumps(payload, ensure_ascii=False), received_at))
            except sqlite3.IntegrityError as error:
                raise HTTPException(409, "同一设备、任务和序号的采样已经存在") from error
            db.execute("""INSERT INTO mobile_device_current
                (device_id, device_type, device_name, sampled_at, payload, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                  device_type=excluded.device_type, device_name=excluded.device_name,
                  sampled_at=excluded.sampled_at, payload=excluded.payload, updated_at=excluded.updated_at
                WHERE excluded.sampled_at >= mobile_device_current.sampled_at""",
                (body.device_id, body.device_type, body.device_name, utc_stamp(body.sampled_at_ms),
                 json.dumps(payload, ensure_ascii=False), received_at))
        return receipt(body, digest, received_at)

    def _validate_identity(self, db, body):
        row = db.execute("""SELECT device_type FROM mobile_device_current WHERE device_id=?
            UNION SELECT device_type FROM mobile_aux_current WHERE device_id=?""", (body.device_id, body.device_id)).fetchall()
        if any(item["device_type"] != body.device_type for item in row):
            raise HTTPException(409, "device_id 已绑定另一平台类型，不能在UGV与UAV间复用")
        if body.sampled_at_ms > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise HTTPException(422, "采样时间超过服务器时间5分钟，请检查设备时钟")

    def save_aux(self, kind: Literal["status", "gps"], body: DeviceHeartbeat | LocationReport):
        payload = body.model_dump(mode="json")
        digest = _payload_hash(payload)
        received_at = datetime.now(timezone.utc).isoformat()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._validate_identity(db, body)
            existing = db.execute("SELECT kind, payload_hash, received_at FROM mobile_aux_records WHERE uuid=?", (str(body.uuid),)).fetchone()
            if existing:
                if existing["kind"] != kind or existing["payload_hash"] != digest:
                    raise HTTPException(409, "同一 uuid 对应了不同辅助报文，已拒绝覆盖")
                return receipt(body, digest, existing["received_at"], duplicated=True)
            if db.execute("SELECT 1 FROM mobile_telemetry WHERE uuid=?", (str(body.uuid),)).fetchone():
                raise HTTPException(409, "uuid 已被观测报文使用")
            try:
                db.execute("""INSERT INTO mobile_aux_records
                    (uuid, kind, device_id, sampled_at, payload_hash, payload, received_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (str(body.uuid), kind, body.device_id, utc_stamp(body.sampled_at_ms), digest,
                     json.dumps(payload, ensure_ascii=False), received_at))
            except sqlite3.IntegrityError as error:
                raise HTTPException(409, "同一设备同一时刻的辅助报文已经存在") from error
            db.execute("""INSERT INTO mobile_aux_current
                (kind, device_id, device_type, device_name, sampled_at, payload, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(kind, device_id) DO UPDATE SET
                  device_type=excluded.device_type, device_name=excluded.device_name,
                  sampled_at=excluded.sampled_at, payload=excluded.payload, updated_at=excluded.updated_at
                WHERE excluded.sampled_at >= mobile_aux_current.sampled_at""",
                (kind, body.device_id, body.device_type, body.device_name, utc_stamp(body.sampled_at_ms),
                 json.dumps(payload, ensure_ascii=False), received_at))
        return receipt(body, digest, received_at)

    def devices(self):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM mobile_device_current ORDER BY device_type, device_id").fetchall()
            aux = db.execute("SELECT kind, device_id, payload FROM mobile_aux_current ORDER BY sampled_at").fetchall()
        devices = {}
        for row in rows:
            payload = json.loads(row["payload"])
            payload["component_times"] = {key: payload["sampled_at_ms"] for key in ("status", "location", "power", "measurements") if key in payload}
            devices[payload["device_id"]] = payload
        for row in aux:
            payload = json.loads(row["payload"])
            device = devices.setdefault(row["device_id"], {"device_id": row["device_id"], "device_type": payload["device_type"], "device_name": payload["device_name"], "component_times": {}})
            for key in (("status", "power") if row["kind"] == "status" else ("location",)):
                if payload.get(key) is not None and payload["sampled_at_ms"] > device["component_times"].get(key, ""):
                    device[key] = payload[key]
                    device["component_times"][key] = payload["sampled_at_ms"]
            if payload["sampled_at_ms"] > device.get("sampled_at_ms", ""):
                device.update(sampled_at_ms=payload["sampled_at_ms"], device_name=payload["device_name"])
        now = datetime.now(timezone.utc)
        for device in devices.values():
            status_at = device["component_times"].get("status")
            age = (now - datetime.fromisoformat(status_at)).total_seconds() if status_at else None
            device["online"] = age is not None and -30 <= age <= 120 and device.get("status", {}).get("state") != "offline"
            device["med_eligible"] = False
            device["thermal_assimilated"] = False
        return sorted(devices.values(), key=lambda item: (item.get("device_type", ""), item.get("device_id", "")))

    def latest(self, device_id: str):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM mobile_device_current WHERE device_id=?", (device_id,)).fetchone()
        return json.loads(row["payload"]) if row else None

    def observation(self, observation_id: str):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM mobile_telemetry WHERE uuid=?", (observation_id,)).fetchone()
        return json.loads(row["payload"]) if row else None

    def history(self, device_id: str, limit: int):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM mobile_telemetry WHERE device_id=? ORDER BY sampled_at DESC LIMIT ?", (device_id, limit)).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def aux_latest(self, kind: Literal["status", "gps"], device_id: str):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM mobile_aux_current WHERE kind=? AND device_id=?", (kind, device_id)).fetchone()
            observation = db.execute("SELECT payload FROM mobile_device_current WHERE device_id=?", (device_id,)).fetchone()
        candidates = [json.loads(item["payload"]) for item in (row, observation) if item]
        if not candidates:
            return None
        latest = max(candidates, key=lambda item: item["sampled_at_ms"])
        key = "status" if kind == "status" else "location"
        return {k: v for k, v in latest.items() if k in {"schema_version", "uuid", "device_id", "device_name", "device_type", "sampled_at_ms", key, "power" if kind == "status" else "location"}}

    def track(self, device_id, limit):
        with self.connect() as db:
            rows = db.execute("""SELECT payload FROM (
                SELECT payload, sampled_at FROM mobile_telemetry WHERE device_id=?
                UNION ALL SELECT payload, sampled_at FROM mobile_aux_records WHERE device_id=? AND kind='gps'
                ) ORDER BY sampled_at DESC LIMIT ?""", (device_id, device_id, limit)).fetchall()
        features = []
        for row in reversed(rows):
            payload = json.loads(row["payload"])
            location = payload["location"]
            if location["fix_type"] == "none":
                continue
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [location["longitude"], location["latitude"]]},
                             "properties": {"uuid": payload["uuid"], "device_id": device_id,
                                            "sampled_at_ms": payload["sampled_at_ms"], "source_type": "field_collection",
                                            "altitude_m": location.get("altitude_m"), "quality_flag": payload.get("quality_flag")}})
        return {"type": "FeatureCollection", "features": features, "crs_name": "EPSG:4326"}

    def media(self, digest):
        with self.connect() as db:
            row = db.execute("SELECT * FROM mobile_media WHERE sha256=?", (digest,)).fetchone()
        return dict(row) if row else None


store = TelemetryStore()


def receipt(body, digest, received_at, duplicated=False):
    return {"schema_version": SCHEMA_VERSION, "accepted": 0 if duplicated else 1,
            "duplicated": int(duplicated), "uuid": str(body.uuid), "stored": True,
            "payload_sha256": digest, "received_at": received_at,
            "source_type": "field_collection", "source_verified": False,
            "med_eligible": False, "thermal_assimilated": False}


def ingest(body: MobileTelemetry, expected_type: Literal["UGV", "UAV"]):
    if body.device_type != expected_type:
        raise HTTPException(422, f"该接口只接受 {expected_type} 数据")
    return store.save(body)


@router.get("/capabilities")
def capabilities():
    return {"schema_version": SCHEMA_VERSION, "device_types": ["UGV", "UAV"],
            "edition": "project", "ingest_auth_required": True, "read_auth_required": True,
            "image_policy": "separate_binary_upload_or_external_reference", "image_upload_max_bytes": MEDIA_MAX_BYTES,
            "image_reference_max_bytes": 50_000_000, "batch_max_records": 500,
            "json_request_max_bytes": "DECISION_MAX_REQUEST_BYTES (default 262144); split large batches",
            "endpoints": {"ugv": "/api/weather/telemetry/ugv", "uav": "/api/weather/telemetry/uav",
                          "batch": "/api/weather/telemetry/{device_type}/batch", "status": "/api/weather/telemetry/status",
                          "gps": "/api/weather/telemetry/gps", "devices": "/api/weather/telemetry/devices"},
            "thermal_policy": "field_collection is retained separately from simulated_lcz; no automatic medical eligibility"}


@router.get("/schema")
def schema():
    return {"schema_version": SCHEMA_VERSION, "telemetry": MobileTelemetry.model_json_schema(),
            "status": DeviceHeartbeat.model_json_schema(), "gps": LocationReport.model_json_schema(),
            "legacy_ugv": UGVTelemetry.model_json_schema()}


@router.post("/ugv")
def ingest_ugv(body: MobileTelemetry | UGVTelemetry):
    if isinstance(body, UGVTelemetry):
        try:
            body = adapt_legacy(body)
        except ValidationError as error:
            raise HTTPException(422, "兼容报文无法转换，请检查状态、定位、温湿度和设备标识") from error
    return ingest(body, "UGV")


@router.post("/uav")
def ingest_uav(body: MobileTelemetry):
    return ingest(body, "UAV")


@router.post("/status")
def ingest_status(body: DeviceHeartbeat):
    return store.save_aux("status", body)


@router.post("/gps")
def ingest_gps(body: LocationReport):
    return store.save_aux("gps", body)


@router.post("/{device_type}/batch")
def ingest_batch(device_type: Literal["ugv", "uav"], body: BatchInput):
    expected_type = device_type.upper()
    accepted = duplicated = 0
    rejected = []
    for index, raw in enumerate(body.records):
        try:
            parsed = adapt_legacy(UGVTelemetry.model_validate(raw)) if expected_type == "UGV" and "device" in raw else MobileTelemetry.model_validate(raw)
            if parsed.device_type != expected_type:
                raise ValueError(f"device_type 必须为 {expected_type}")
            result = store.save(parsed)
            accepted += result["accepted"]
            duplicated += result["duplicated"]
        except (HTTPException, ValidationError, ValueError, TypeError) as error:
            if isinstance(error, ValidationError):
                reason = [{"loc": item["loc"], "msg": item["msg"], "type": item["type"]} for item in error.errors()]
            else:
                reason = error.detail if isinstance(error, HTTPException) else str(error)
            record_id = raw.get("uuid")
            rejected.append({"index": index, "uuid": record_id if isinstance(record_id, str) and len(record_id) <= 36 else None,
                             "reason": reason})
    return {"schema_version": SCHEMA_VERSION, "accepted": accepted, "duplicated": duplicated,
            "rejected": rejected, "stored": accepted + duplicated > 0}


@router.get("/devices")
def list_devices(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"schema_version": SCHEMA_VERSION, "devices": store.devices()}


@router.get("/devices/{device_id}/latest")
def latest_device(device_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    payload = store.latest(device_id)
    if payload is None:
        raise HTTPException(404, "设备暂无已接收的观测")
    return payload


@router.get("/devices/{device_id}/status")
def latest_status(device_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    payload = store.aux_latest("status", device_id)
    if payload is None:
        raise HTTPException(404, "设备暂无状态心跳")
    return payload


@router.get("/devices/{device_id}/location")
def latest_location(device_id: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    payload = store.aux_latest("gps", device_id)
    if payload is None:
        raise HTTPException(404, "设备暂无独立定位记录")
    return payload


@router.get("/devices/{device_id}/observations")
def device_history(device_id: str, response: Response, limit: Annotated[int, Query(ge=1, le=1000)] = 100):
    response.headers["Cache-Control"] = "no-store"
    return {"schema_version": SCHEMA_VERSION, "device_id": device_id,
            "observations": store.history(device_id, limit)}


@router.get("/devices/{device_id}/track")
def device_track(device_id: str, response: Response, limit: Annotated[int, Query(ge=1, le=1000)] = 100):
    response.headers["Cache-Control"] = "no-store"
    return store.track(device_id, limit)


@router.get("/observations/{observation_id}")
def get_observation(observation_id: UUID4, response: Response):
    response.headers["Cache-Control"] = "no-store"
    payload = store.observation(str(observation_id))
    if payload is None:
        raise HTTPException(404, "观测记录不存在")
    return payload


def persist_media(content, digest, mime_type):
    if not SHA256.fullmatch(digest) or hashlib.sha256(content).hexdigest() != digest:
        raise HTTPException(422, "图片 SHA-256 不匹配")
    formats = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP", "image/tiff": "TIFF"}
    if mime_type not in formats:
        raise HTTPException(415, "仅接受 JPEG、PNG、WebP 或 TIFF 图像")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as picture:
                if picture.format != formats[mime_type] or picture.width * picture.height > 25_000_000:
                    raise HTTPException(422, "图像格式与Content-Type不符或超过2500万像素")
                width, height = picture.size
                picture.verify()
            with Image.open(io.BytesIO(content)) as picture:
                picture.load()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(422, "文件不是有效且可安全读取的图像") from error
    store.media_root.mkdir(parents=True, exist_ok=True)
    target = store.media_root / digest
    handle, staged = tempfile.mkstemp(prefix="upload-", dir=store.media_root)
    try:
        with os.fdopen(handle, "wb") as output:
            output.write(content)
        os.replace(staged, target)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)
    with store.connect() as db:
        db.execute("""INSERT INTO mobile_media (sha256, mime_type, size_bytes, width_px, height_px, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sha256) DO NOTHING""",
            (digest, mime_type, len(content), width, height, datetime.now(timezone.utc).isoformat()))
    return {"stored": True, "storage_uri": MEDIA_PREFIX + digest, "sha256": digest, "mime_type": mime_type,
            "size_bytes": len(content), "width_px": width, "height_px": height}


@router.put("/media/{digest}")
async def upload_media(digest: str, request: Request):
    from fastapi.concurrency import run_in_threadpool
    if not SHA256.fullmatch(digest):
        raise HTTPException(422, "媒体编号必须为64位SHA-256")
    content = await request.body()
    if not content or len(content) > MEDIA_MAX_BYTES:
        raise HTTPException(413, "图像不能为空且不得超过8MiB")
    mime_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    return await run_in_threadpool(persist_media, content, digest, mime_type)


@router.get("/media/{digest}")
def download_media(digest: str):
    if not SHA256.fullmatch(digest):
        raise HTTPException(422, "媒体编号必须为64位SHA-256")
    metadata = store.media(digest)
    target = store.media_root / digest
    if metadata is None or not target.is_file():
        raise HTTPException(404, "图像不存在")
    return FileResponse(target, media_type=metadata["mime_type"],
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
