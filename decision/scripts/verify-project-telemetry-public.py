"""Public HTTPS acceptance using temporary records, with exact-id cleanup.

Run on the server so credentials never appear in command arguments or reports.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from PIL import Image


ROOT = Path(__file__).resolve().parent
env = dict(line.split("=", 1) for line in Path("/etc/microclimate-project-telemetry.env").read_text().splitlines() if "=" in line)
TOKEN = env["TELEMETRY_INGEST_TOKEN"]
PREFIX = "/api/weather/telemetry"
RUN = uuid4().hex[:12]
TASK = "acceptance-" + RUN
DEVICES = ["QA_UGV_" + RUN, "QA_UAV_" + RUN]
records = []
checks = []
media_digest = None
cleanup_ok = False


def check(name, condition, status=None):
    checks.append({"name": name, "passed": bool(condition), "http": status})
    if not condition:
        raise AssertionError(name)


def payload(kind, device):
    return {"uuid": str(uuid4()), "device_type": kind, "device_name": "Temporary acceptance probe",
            "device_id": device, "task_id": TASK, "seq": 1,
            "sampled_at_ms": (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat(timespec="milliseconds"),
            "status": {"state": "dwell", "mode": "dwell", "is_synced": True},
            "location": {"latitude": 34.813, "longitude": 113.532, "altitude_m": 110, "speed_mps": 0},
            "measurements": {"temperature_c": 28.4, "humidity_pct": 61.2},
            "quality_flag": 1 << 31,
            "attributes": {"purpose": "temporary_software_acceptance_not_measurements"}}


try:
    with httpx.Client(base_url="https://weather.nogamenolife.cn", timeout=30, follow_redirects=True,
                      headers={"X-Telemetry-Token": TOKEN}, trust_env=False) as client:
        for path in ("/schema", "/capabilities", "/devices"):
            response = client.get(PREFIX + path, headers={"X-Telemetry-Token": "invalid-acceptance-token"})
            check("invalid_token_" + path, response.status_code == 401, response.status_code)
        schema = client.get(PREFIX + "/schema")
        check("authenticated_schema", schema.status_code == 200 and schema.json()["schema_version"] == "WJTJ-mobile-telemetry-1.0", schema.status_code)
        slash = client.get(PREFIX + "/schema/")
        check("schema_trailing_slash", slash.status_code == 200, slash.status_code)
        for suffix in ("/status", "/gps", "/ugv/batch", "/uav/batch"):
            response = client.post(PREFIX + suffix, json={})
            check("validation_route_" + suffix, response.status_code == 422, response.status_code)

        buffer = io.BytesIO()
        Image.frombytes("RGB", (384, 384), os.urandom(384 * 384 * 3)).save(buffer, format="PNG")
        content = buffer.getvalue()
        media_digest = hashlib.sha256(content).hexdigest()
        uploaded = client.put(PREFIX + "/media/" + media_digest, content=content, headers={"Content-Type": "image/png"})
        check("binary_upload_larger_than_json_limit", len(content) > 262144 and uploaded.status_code == 200, uploaded.status_code)
        image = client.get(PREFIX + "/media/" + media_digest)
        check("image_bytes_readback", image.status_code == 200 and image.content == content, image.status_code)
        for kind, device in zip(("UGV", "UAV"), DEVICES):
            body = payload(kind, device)
            body["visual_frames"] = [{k: v for k, v in uploaded.json().items() if k != "stored"} |
                                     {"frame_id": "frame-1", "captured_at": body["sampled_at_ms"]}]
            records.append(body["uuid"])
            accepted = client.post(PREFIX + "/" + kind.lower(), json=body)
            check(kind + "_accepted", accepted.status_code == 200 and accepted.json()["accepted"] == 1, accepted.status_code)
            duplicate = client.post(PREFIX + "/" + kind.lower(), json=body)
            check(kind + "_duplicate", duplicate.status_code == 200 and duplicate.json()["duplicated"] == 1, duplicate.status_code)
            read = client.get(PREFIX + "/observations/" + body["uuid"])
            check(kind + "_readback_matches", read.status_code == 200 and read.json()["measurements"]["temperature_c"] == 28.4 and read.json()["uuid"] == body["uuid"], read.status_code)
            batch = client.post(PREFIX + "/" + kind.lower() + "/batch", json={"records": [body, {"uuid": str(uuid4())}]})
            check(kind + "_batch_partial", batch.status_code == 200 and batch.json()["duplicated"] == 1 and len(batch.json()["rejected"]) == 1, batch.status_code)
            status = {k: body[k] for k in ("device_id", "device_type", "device_name", "sampled_at_ms", "status")}
            status["uuid"] = str(uuid4())
            records.append(status["uuid"])
            posted = client.post(PREFIX + "/status", json=status)
            check(kind + "_status_upload", posted.status_code == 200 and posted.json()["stored"], posted.status_code)
            gps = {k: body[k] for k in ("device_id", "device_type", "device_name", "sampled_at_ms", "location")}
            gps["uuid"] = str(uuid4())
            records.append(gps["uuid"])
            posted = client.post(PREFIX + "/gps", json=gps)
            check(kind + "_gps_upload", posted.status_code == 200 and posted.json()["stored"], posted.status_code)
            track = client.get(PREFIX + "/devices/" + device + "/track")
            check(kind + "_track", track.status_code == 200 and len(track.json()["features"]) >= 1, track.status_code)
        devices = client.get(PREFIX + "/devices")
        check("devices_include_both_platforms", devices.status_code == 200 and set(DEVICES).issubset({d["device_id"] for d in devices.json()["devices"]}), devices.status_code)
        check("project_existing_assessment", client.get("/api/weather/aic/status").status_code == 200)
    with httpx.Client(base_url="https://aic.nogamenolife.cn", timeout=20, trust_env=False) as client:
        for suffix in ("/schema", "/capabilities", "/devices"):
            response = client.get(PREFIX + suffix)
            check("competition_disabled_" + suffix, response.status_code == 404, response.status_code)
        check("competition_existing_assessment", client.get("/api/weather/aic/status").status_code == 200)
finally:
    database = Path(env["TELEMETRY_STATE_DB"])
    if database.exists():
        with sqlite3.connect(database, timeout=10) as db:
            for record in records:
                db.execute("DELETE FROM mobile_telemetry WHERE uuid=? AND device_id IN (?,?)", (record, *DEVICES))
                db.execute("DELETE FROM mobile_aux_records WHERE uuid=? AND device_id IN (?,?)", (record, *DEVICES))
            for device in DEVICES:
                db.execute("DELETE FROM mobile_device_current WHERE device_id=?", (device,))
                db.execute("DELETE FROM mobile_aux_current WHERE device_id=?", (device,))
            if media_digest:
                used = db.execute("SELECT COUNT(*) FROM mobile_telemetry WHERE payload LIKE ?", ("%" + media_digest + "%",)).fetchone()[0]
                if not used:
                    db.execute("DELETE FROM mobile_media WHERE sha256=?", (media_digest,))
                    (Path(env["TELEMETRY_MEDIA_DIR"]) / media_digest).unlink(missing_ok=True)
            cleanup_ok = db.execute("SELECT COUNT(*) FROM mobile_device_current WHERE device_id IN (?,?)", DEVICES).fetchone()[0] == 0
    report = {"public_origin": "https://weather.nogamenolife.cn", "run_id": RUN,
              "checks": checks, "passed": sum(item["passed"] for item in checks), "test_records_cleaned": cleanup_ok}
    (ROOT / "public-acceptance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))
