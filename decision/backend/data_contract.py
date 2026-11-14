"""Platform boundary contract aligned with UGV IF-02 and MED IF-01, not an ingest service."""
from datetime import datetime, timezone
import os
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = "WJTJ-platform-data-1.0"


class UGVExtension(BaseModel):
    model_config = ConfigDict(extra="allow", allow_inf_nan=False)
    uuid: str
    device_id: str = Field(min_length=1)
    device_type: Literal["UGV"]
    task_id: str = Field(min_length=1, max_length=64)
    task_group_id: str | None = Field(default=None, max_length=64)
    platform_type: Literal["ugv", "uav", "fixed"] | None = None
    seq: int = Field(ge=0, strict=True)
    sampled_at_ms: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
    temp_c: float = Field(ge=-40, le=85)
    humidity_pct: float = Field(ge=0, le=100)
    temp_raw_c: float = Field(ge=-40, le=85)
    temp_c_b: float | None = Field(default=None, ge=-40, le=85)
    gps_lat: float = Field(ge=-90, le=90)
    gps_lon: float = Field(ge=-180, le=180)
    gps_alt_m: float | None = None
    heading_deg: float | None = Field(default=None, ge=0, le=360)
    wind_mps: float | None = Field(default=None, ge=0)
    rssi_dbm: int | None = Field(default=None, strict=True)
    fix_type: Literal["none", "single", "dgnss", "rtk_float", "rtk_fix"]
    sat_num: int = Field(ge=0, le=40, strict=True)
    hdop: float = Field(ge=0)
    speed_mps: float = Field(ge=0, le=1.5)
    mode: Literal["idle", "teleop", "cruise", "dwell", "fault"]
    fan_rpm: int = Field(ge=0, strict=True)
    body_temp_c: float
    vbat_v: float
    soc_pct: int = Field(ge=0, le=100, strict=True)
    sensor_id: str = Field(min_length=1, max_length=32)
    firmware_version: str = Field(min_length=1, max_length=64)
    iface_version: str = Field(pattern=r"^IF-02/\d+\.\d+$", max_length=16)
    is_synced: bool = Field(strict=True)
    quality_flag: int = Field(ge=0, le=4294967295, strict=True)
    lcz_hint: str | None = Field(default=None, pattern=r"^LCZ_(?:[1-9]|10|[A-G])$")

    @model_validator(mode="after")
    def identifier(self):
        if UUID(self.uuid).version != 4:
            raise ValueError("uuid must be UUID v4")
        return self


class UGVTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    device: str
    ts: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
    temp: float
    humid: float
    bat: float
    ugv: UGVExtension

    @model_validator(mode="after")
    def compatibility(self):
        if (self.device, self.temp, self.humid, self.bat) != (self.ugv.device_id, self.ugv.temp_c, self.ugv.humidity_pct, self.ugv.vbat_v):
            raise ValueError("IF-02 compatibility fields disagree with ugv extension")
        seconds = datetime.fromisoformat(self.ts)
        millis = datetime.fromisoformat(self.ugv.sampled_at_ms)
        if seconds != millis.replace(microsecond=0):
            raise ValueError("ts and sampled_at_ms must refer to the same second")
        return self


def contract():
    result = {"schema_version": CONTRACT_VERSION, "requirements": {"UGV": "WJTJ-REQ-UGV-001/V1.3",
            "UAV": "WJTJ-REQ-UAV-002/V1.1", "MED": "WJTJ-REQ-MED-003/V1.2"},
            "time": {"wire": "UTC YYYY-MM-DDTHH:MM:SSZ", "display": "Asia/Shanghai", "meaning": "sampling_time_not_transmission_time"},
            "coordinates": {"wire": "EPSG:4326", "metric_calculation": "EPSG:32649", "order": "longitude,latitude"},
            "units": {"temp_c": "degC", "humidity_pct": "%RH", "delta_t_grid_c": "degC", "wind_mps": "m/s"},
            "quality": {"quality_flag": "uint32", "med_policy": "only_zero_accepted; missing_or_unknown_bits_excluded",
                        "simulation": "quality_flag=null; source_type=simulated_lcz; never_field_collection"},
            "grid": {"schema_version": "WJTJ-LCZ-grid/1.0", "default_resolution_m": 30,
                     "id": "LCZ49-{resolution_m}-{UTM_easting_index}-{UTM_northing_index}",
                     "nullable_when_unavailable": ["temp_c", "humidity_pct", "delta_t_grid_c", "quality_flag"],
                     "unknown_risk": "unavailable", "level_codes": {"below_range": 0, "caution": 1, "extreme_caution": 2, "danger": 3, "extreme_danger": 4, "unavailable": 255}},
            "telemetry": {"topic": "sensor/{device_id}/telemetry", "qos": 0, "compatibility_fields": ["device", "ts", "temp", "humid", "bat"],
                          "position_topic": "sensor/{device_id}/gps", "schema": UGVTelemetry.model_json_schema()},
            "collection_simulation": {"schema_version": "WJTJ-collection-simulation/1.1", "source_type": "simulated_collection",
                                      "quality_flag": None, "med_eligible": False, "time": "simulation_clock_UTC_not_field_sampling",
                                      "units": "degC / %RH / m / m/s", "coordinates": "EPSG:4326",
                                      "uav_values": "2m_ground_grid_projection_not_flight_altitude_meteorology",
                                      "mqtt_published": False, "planner": "informative-return-tour/1.0",
                                      "energy": "Wh; constant assumed power; explicit battery budget and return reserve; not calibrated",
                                      "optimality": "heuristic_not_global_optimum"},
            "mobile_telemetry": {"schema_version": "WJTJ-mobile-telemetry-1.0",
                                 "ingest_endpoints": {"UGV": "/api/weather/telemetry/ugv", "UAV": "/api/weather/telemetry/uav",
                                                       "batch": "/api/weather/telemetry/{device_type}/batch",
                                                       "status": "/api/weather/telemetry/status", "gps": "/api/weather/telemetry/gps"},
                                 "required": ["uuid", "device_type", "device_name", "device_id", "task_id", "seq", "sampled_at_ms", "status", "location", "measurements", "quality_flag"],
                                 "measurements": ["temperature_c", "humidity_pct", "pressure_hpa", "wind_speed_mps", "wind_direction_deg", "solar_radiation_w_m2", "globe_temperature_c"],
                                 "visual_frames": "独立PUT媒体上传接口或外部HTTPS/S3引用、SHA-256、媒体类型、尺寸和采集位置；不在JSON内嵌图片字节",
                                 "media_endpoint": "/api/weather/telemetry/media/{sha256}",
                                 "schema_endpoint": "/api/weather/telemetry/schema",
                                 "auxiliary": "status 心跳和 gps 独立报文均保留 uuid、采样时间与当前快照",
                                 "idempotency": "uuid 与 (device_id, task_id, seq) 双重去重",
                                 "storage": "SQLite observation ledger and current-device snapshot; ingestion requires TELEMETRY_INGEST_TOKEN"},
            "implementation_boundary": "Project-only mobile telemetry ingestion, media storage, idempotency and query are implemented separately from the fixed-sensor adapter. This does not implement MQTT ingestion, backfill/v2, automatic field-to-heatmap assimilation, field calibration, 1-minute aggregation, or 1m GeoTIFF MED/UAV products."}
    if os.getenv("MOBILE_TELEMETRY_ENABLED", "1") != "1" or os.getenv("COLLECTION_IOT_DISABLED") == "1":
        result.pop("mobile_telemetry")
        result["implementation_boundary"] = "Read-only IoT adapter, validation contracts and separate collection simulation; does not implement or certify MQTT ingestion, backfill/v2, field calibration, 1-minute aggregation, or 1m GeoTIFF MED/UAV products."
    return result


def normalize_telemetry(body):
    u = body.ugv
    return {"schema_version": CONTRACT_VERSION, "contract_valid": True, "stored": False,
            "med_eligible": u.quality_flag == 0, "quality_flag": u.quality_flag,
            "unknown_quality_bits": [bit for bit in range(12, 32) if u.quality_flag & (1 << bit)],
            "normalized": {"device_id": body.device, "ts": body.ts, "sampled_at_ms": u.sampled_at_ms,
                           "temp_c": u.temp_c, "humidity_pct": u.humidity_pct, "quality_flag": u.quality_flag,
                           "longitude": u.gps_lon, "latitude": u.gps_lat, "crs": "EPSG:4326",
                           "source_type": "field_collection", "quality_status": "requires_calibration_and_ingestion_review",
                           "uuid": u.uuid, "task_id": u.task_id, "seq": u.seq}}
