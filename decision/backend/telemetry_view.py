"""Project public read projection; ingestion and original media remain authenticated."""
import io
import os
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from PIL import Image, ImageOps

from backend import telemetry

PREFIX = "/api/weather/mobile-observations"


def view_enabled():
    return telemetry.telemetry_enabled() and os.getenv("MOBILE_TELEMETRY_PUBLIC_VIEW") == "1"


def require_view(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if not view_enabled() or request.url.hostname == "aic.nogamenolife.cn":
        raise HTTPException(404, "接口不存在")


router = APIRouter(prefix=PREFIX, tags=["mobile-observation-view"], dependencies=[Depends(require_view)])


def project_sample(row):
    # Explicitly omit attributes, arbitrary image metadata, remote URLs and firmware diagnostics.
    keys = ("uuid", "device_id", "device_name", "device_type", "task_id", "seq", "sampled_at_ms",
            "measurements", "power", "location", "quality_flag", "online", "component_times")
    result = {key: row[key] for key in keys if key in row}
    result["status"] = {key: row.get("status", {}).get(key) for key in ("state", "mode", "is_synced", "unsynced_count")}
    result["visual_frames"] = []
    for frame in row.get("visual_frames", []):
        local = frame["storage_uri"] == telemetry.MEDIA_PREFIX + frame["sha256"]
        result["visual_frames"].append({
            "frame_id": frame["frame_id"], "captured_at": frame["captured_at"], "modality": frame["modality"],
            "preview_url": PREFIX + "/images/" + frame["sha256"] if local else None,
        })
    result.update(source_type="field_collection", simulated=False, med_eligible=False, thermal_assimilated=False)
    return result


def public_devices():
    if not view_enabled():
        return []
    return [project_sample(row) for row in telemetry.store.devices()]


def field_devices():
    result = []
    now = datetime.now(timezone.utc)
    for row in public_devices():
        observed = row.get("component_times", {}).get("measurements")
        recent = observed and -30 <= (now - datetime.fromisoformat(observed)).total_seconds() <= 300
        measurements = row.get("measurements", {})
        usable = bool(row.get("online") and row.get("status", {}).get("state") != "fault" and recent and row.get("quality_flag") == 0
                      and all(measurements.get(key) is not None for key in ("temperature_c", "humidity_pct")))
        result.append({
            "device_id": row["device_id"], "device_type": row["device_type"], "label": row["device_type"],
            "status": "online" if usable else "awaiting_sample" if row.get("online") else "offline",
            "last_seen": row.get("component_times", {}).get("status"), "observed_at": observed,
            "temperature_c": measurements.get("temperature_c") if usable else None,
            "humidity_pct": measurements.get("humidity_pct") if usable else None,
            "location": row.get("location"), "quality_flag": row.get("quality_flag"),
            "source_type": "field_collection", "simulated": False, "med_eligible": False,
            "thermal_assimilated": False,
        })
    return result


@router.get("/devices")
def devices():
    return {"devices": public_devices(), "refresh_seconds": 15, "read_only": True}


@router.get("/devices/{device_id}")
def detail(device_id: str, limit: Annotated[int, Query(ge=1, le=200)] = 100):
    if not telemetry.DEVICE_ID.fullmatch(device_id):
        raise HTTPException(422, "设备编号格式不正确")
    current = next((row for row in public_devices() if row["device_id"] == device_id), None)
    if current is None:
        raise HTTPException(404, "设备尚未上报")
    with telemetry.store.connect() as db:
        stats = dict(db.execute("SELECT COUNT(*) AS total, MIN(sampled_at) AS first_at, MAX(sampled_at) AS last_at FROM mobile_telemetry WHERE device_id=?", (device_id,)).fetchone())
    return {"device": current, "stats": stats,
            "observations": [project_sample(row) for row in telemetry.store.history(device_id, limit)],
            "track": telemetry.store.track(device_id, 500), "read_only": True}


@router.get("/images/{digest}")
def image_preview(digest: str):
    if not telemetry.SHA256.fullmatch(digest):
        raise HTTPException(422, "图像编号格式不正确")
    # Unattached uploads are private. Only published observation references get a preview.
    with telemetry.store.connect() as db:
        linked = db.execute("""SELECT 1 FROM mobile_telemetry AS t,
            json_each(t.payload, '$.visual_frames') AS f
            WHERE json_extract(f.value, '$.sha256')=?
            AND json_extract(f.value, '$.storage_uri')=? LIMIT 1""", (digest, telemetry.MEDIA_PREFIX + digest)).fetchone()
    target = telemetry.store.media_root / digest
    if not linked or not target.is_file():
        raise HTTPException(404, "暂无图像预览")
    with Image.open(target) as original:
        preview = ImageOps.exif_transpose(original)
        preview.thumbnail((1280, 1280))
        preview = preview.convert("RGB")
        preview.info.clear()
        output = io.BytesIO()
        preview.save(output, "JPEG", quality=85)
    return Response(output.getvalue(), media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
