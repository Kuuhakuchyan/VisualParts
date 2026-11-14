"""Project-only ingestion tests against isolated storage, never real devices."""
import copy
import hashlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from backend import main, telemetry
from backend.data_contract import contract
from backend.test_lcz import telemetry as legacy_telemetry

PREFIX = "/api/weather/telemetry"


def payload(device_type="UGV"):
    now = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(seconds=10)
    return {
        "uuid": str(uuid4()), "device_type": device_type, "device_name": "Mobile observer",
        "device_id": device_type + "-QA-01", "task_id": "qa-route-01", "seq": 1,
        "sampled_at_ms": now.isoformat(),
        "status": {"state": "dwell", "mode": "dwell", "is_synced": True, "unsynced_count": 0},
        "location": {"latitude": 34.813, "longitude": 113.532, "altitude_m": 150, "altitude_reference": "amsl", "speed_mps": 0.5},
        "measurements": {"temperature_c": 28.4, "humidity_pct": 61.2},
        "power": {"voltage_v": 24.6, "soc_pct": 82}, "quality_flag": 0,
    }


class TelemetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {"MOBILE_TELEMETRY_ENABLED": "1", "COLLECTION_IOT_DISABLED": "0",
                                           "TELEMETRY_INGEST_TOKEN": "qa-token", "TELEMETRY_MEDIA_DIR": str(Path(self.tmp.name) / "media")})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.store_patch = patch.object(telemetry, "store", telemetry.TelemetryStore(str(Path(self.tmp.name) / "telemetry.sqlite3")))
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)
        main._rate_windows.clear()
        self.addCleanup(main._rate_windows.clear)
        self.client = TestClient(main.app, base_url="http://localhost", headers={"X-Telemetry-Token": "qa-token"})
        self.addCleanup(self.client.close)

    def post(self, body, suffix=None):
        return self.client.post(PREFIX + (suffix or "/" + body["device_type"].lower()), json=body)

    def test_ugv_uav_ingest_and_queries(self):
        for kind in ("UGV", "UAV"):
            body = payload(kind)
            result = self.post(body)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertTrue(result.json()["stored"])
            self.assertFalse(result.json()["med_eligible"])
            self.assertFalse(result.json()["thermal_assimilated"])
            latest = self.client.get(f'{PREFIX}/devices/{body["device_id"]}/latest').json()
            self.assertEqual(latest["measurements"], telemetry.MobileTelemetry.model_validate(body).measurements.model_dump())
            self.assertEqual(self.client.get(f'{PREFIX}/observations/{body["uuid"]}').json()["uuid"], body["uuid"])
            self.assertEqual(len(self.client.get(f'{PREFIX}/devices/{body["device_id"]}/observations').json()["observations"]), 1)
        self.assertEqual(len(self.client.get(PREFIX + "/devices").json()["devices"]), 2)

    def test_repeat_is_idempotent_but_conflicting_uuid_or_sequence_is_rejected(self):
        body = payload()
        self.assertEqual(self.post(body).json()["accepted"], 1)
        self.assertEqual(self.post(body).json()["duplicated"], 1)
        conflict = copy.deepcopy(body)
        conflict["measurements"]["temperature_c"] = 30
        self.assertEqual(self.post(conflict).status_code, 409)
        conflict["uuid"] = str(uuid4())
        self.assertEqual(self.post(conflict).status_code, 409)
        self.assertEqual(len(telemetry.store.history(body["device_id"], 10)), 1)

    def test_concurrent_retries_are_one_accept_and_one_duplicate(self):
        body = telemetry.MobileTelemetry.model_validate(payload())
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: telemetry.store.save(body), range(2)))
        self.assertEqual(sum(r["accepted"] for r in results), 1)
        self.assertEqual(sum(r["duplicated"] for r in results), 1)

    def test_history_upload_does_not_overwrite_newer_observation(self):
        recent = payload()
        old = copy.deepcopy(recent)
        old.update(uuid=str(uuid4()), seq=0, sampled_at_ms=(datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0).isoformat())
        old["measurements"]["temperature_c"] = 10
        self.assertEqual(self.post(recent).status_code, 200)
        self.assertEqual(self.post(old).status_code, 200)
        self.assertEqual(telemetry.store.latest(recent["device_id"])["measurements"]["temperature_c"], 28.4)

    def test_utc_offsets_and_millisecond_order(self):
        body = payload()
        stamp = datetime.fromisoformat(body["sampled_at_ms"])
        body["sampled_at_ms"] = stamp.astimezone(timezone(timedelta(hours=8))).isoformat()
        self.assertEqual(self.post(body).status_code, 200)
        body["sampled_at_ms"] = stamp.isoformat()
        self.assertEqual(self.post(body).json()["duplicated"], 1)
        newer = copy.deepcopy(body)
        newer.update(uuid=str(uuid4()), seq=2, sampled_at_ms=(stamp + timedelta(milliseconds=200)).isoformat())
        newer["measurements"]["temperature_c"] = 29
        self.assertEqual(self.post(newer).status_code, 200)
        self.assertEqual(telemetry.store.latest(body["device_id"])["measurements"]["temperature_c"], 29)

    def test_batch_partial_success_and_duplicate_only_response(self):
        valid = payload()
        invalid = copy.deepcopy(valid)
        invalid["measurements"]["humidity_pct"] = 140
        result = self.post({"records": [valid, valid, invalid]}, "/ugv/batch").json()
        self.assertEqual((result["accepted"], result["duplicated"], len(result["rejected"])), (1, 1, 1))
        repeat = self.post({"records": [valid]}, "/ugv/batch").json()
        self.assertTrue(repeat["stored"])
        self.assertEqual(repeat["duplicated"], 1)
        self.assertEqual(self.post({"records": []}, "/ugv/batch").status_code, 422)
        self.assertEqual(self.post({"records": [valid] * 501}, "/ugv/batch").status_code, 422)

    def test_auth_applies_to_reads_and_writes_and_never_echoes_token(self):
        for token in ("", "wrong-key"):
            headers = {"X-Telemetry-Token": token}
            for response in (self.client.get(PREFIX + "/devices", headers=headers), self.client.post(PREFIX + "/ugv", json=payload(), headers=headers)):
                self.assertEqual(response.status_code, 401)
                self.assertNotIn("wrong-key", response.text)
        with patch.dict(os.environ, {"TELEMETRY_INGEST_TOKEN": ""}):
            self.assertEqual(self.client.get(PREFIX + "/devices").status_code, 503)

    def test_invalid_fields_and_missing_quality_are_rejected(self):
        changes = [("quality_flag", True), ("quality_flag", 2**32), ("seq", 2**63), ("device_id", "../../etc/passwd"),
                   ("sampled_at_ms", "2026-11-01T12:00:00"), ("source_type", "simulated_collection")]
        for key, value in changes:
            body = payload()
            body[key] = value
            self.assertEqual(self.post(body).status_code, 422, key)
        body = payload()
        body.pop("quality_flag")
        self.assertEqual(self.post(body).status_code, 422)
        body = payload()
        body["status"].update(state="fault", error_code=None)
        self.assertEqual(self.post(body).status_code, 422)
        body = payload()
        body["sampled_at_ms"] = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0).isoformat()
        self.assertEqual(self.post(body).status_code, 422)

    def test_null_sensor_readings_require_explicit_bad_quality(self):
        body = payload()
        body["measurements"]["temperature_c"] = None
        self.assertEqual(self.post(body).status_code, 422)
        body["quality_flag"] = 1 << 31
        self.assertEqual(self.post(body).status_code, 200)
        self.assertFalse(self.post(body).json()["med_eligible"])

    def test_uav_altitude_and_type_constraints(self):
        body = payload("UAV")
        body["location"].pop("altitude_m")
        self.assertEqual(self.post(body).status_code, 422)
        self.assertEqual(self.post(payload("UAV"), "/ugv").status_code, 422)
        body = payload()
        body["location"]["speed_mps"] = 2
        self.assertEqual(self.post(body).status_code, 422)
        body = payload()
        body["uav"] = {"armed": True}
        self.assertEqual(self.post(body).status_code, 422)

    def test_device_type_binding(self):
        ground = payload()
        aerial = payload("UAV")
        aerial["device_id"] = ground["device_id"]
        self.assertEqual(self.post(ground).status_code, 200)
        self.assertEqual(self.post(aerial).status_code, 409)

    def auxiliary(self, body, key, minutes=0):
        value = {k: body[k] for k in ("device_id", "device_name", "device_type", "sampled_at_ms")}
        value.update(uuid=str(uuid4()))
        value["sampled_at_ms"] = (datetime.fromisoformat(body["sampled_at_ms"]) + timedelta(minutes=minutes)).isoformat()
        value[key] = copy.deepcopy(body[key])
        return value

    def test_status_gps_persistence_and_no_stale_component_overwrite(self):
        body = payload()
        self.assertEqual(self.post(body).status_code, 200)
        status = self.auxiliary(body, "status", minutes=-10)
        status["status"].update(state="fault", error_code="OLD-FAULT")
        gps = self.auxiliary(body, "location", minutes=-10)
        gps["location"]["longitude"] = 113.500
        self.assertEqual(self.post(status, "/status").status_code, 200)
        self.assertEqual(self.post(gps, "/gps").status_code, 200)
        current = self.client.get(PREFIX + "/devices").json()["devices"][0]
        self.assertEqual(current["status"]["state"], "dwell")
        self.assertEqual(current["location"]["longitude"], body["location"]["longitude"])
        self.assertTrue(current["online"])
        self.assertEqual(self.client.get(f'{PREFIX}/devices/{body["device_id"]}/status').json()["status"]["state"], "dwell")
        self.assertEqual(self.post(status, "/status").json()["duplicated"], 1)

    def test_status_only_device_and_old_status_is_not_online(self):
        body = payload()
        status = self.auxiliary(body, "status", minutes=-10)
        self.assertEqual(self.post(status, "/status").status_code, 200)
        devices = self.client.get(PREFIX + "/devices").json()["devices"]
        self.assertEqual(len(devices), 1)
        self.assertFalse(devices[0]["online"])
        self.assertNotIn("measurements", devices[0])

    def test_uuid_cannot_be_shared_across_status_and_observation(self):
        body = payload()
        self.assertEqual(self.post(body).status_code, 200)
        status = self.auxiliary(body, "status")
        status["uuid"] = body["uuid"]
        self.assertEqual(self.post(status, "/status").status_code, 409)

    def test_legacy_if02_can_be_ingested_and_retried(self):
        body = legacy_telemetry()
        self.assertEqual(self.post(body, "/ugv").json()["accepted"], 1)
        self.assertEqual(self.post(body, "/ugv").json()["duplicated"], 1)
        value = self.client.get(PREFIX + "/devices/UGV_01/latest").json()
        self.assertEqual(value["measurements"]["temperature_c"], body["temp"])
        self.assertEqual(value["ugv"]["fan_rpm"], body["ugv"]["fan_rpm"])

    def test_track_and_query_limits(self):
        body = payload()
        self.post(body)
        track = self.client.get(f'{PREFIX}/devices/{body["device_id"]}/track').json()
        self.assertEqual(track["features"][0]["geometry"]["coordinates"], [113.532, 34.813])
        self.assertEqual(self.client.get(f'{PREFIX}/devices/{body["device_id"]}/observations?limit=1001').status_code, 422)
        self.assertEqual(self.client.get(PREFIX + "/observations/not-a-uuid").status_code, 422)
        self.assertEqual(self.client.get(PREFIX + "/observations/" + str(uuid4())).status_code, 404)

    def png(self, large=False):
        buffer = io.BytesIO()
        image = Image.frombytes("RGB", (384, 384), os.urandom(384 * 384 * 3)) if large else Image.new("RGB", (24, 24), (180, 80, 50))
        image.save(buffer, format="PNG")
        content = buffer.getvalue()
        return content, hashlib.sha256(content).hexdigest()

    def test_actual_image_upload_link_and_authenticated_readback(self):
        content, digest = self.png(large=True)
        self.assertGreater(len(content), main.MAX_REQUEST_BYTES)
        media = self.client.put(PREFIX + "/media/" + digest, content=content, headers={"Content-Type": "image/png"})
        self.assertEqual(media.status_code, 200, media.text)
        body = payload()
        body["visual_frames"] = [{**{k: v for k, v in media.json().items() if k != "stored"}, "frame_id": "frame-1", "captured_at": body["sampled_at_ms"]}]
        self.assertEqual(self.post(body).status_code, 200)
        read = self.client.get(PREFIX + "/media/" + digest)
        self.assertEqual(read.content, content)
        self.assertEqual(read.headers["cache-control"], "no-store")
        self.assertEqual(self.client.get(PREFIX + "/media/" + digest, headers={"X-Telemetry-Token": ""}).status_code, 401)
        body.update(uuid=str(uuid4()), seq=2)
        body["visual_frames"][0]["width_px"] = 10
        self.assertEqual(self.post(body).status_code, 422)

    def test_invalid_media_hash_mime_or_content_rejected(self):
        content, digest = self.png()
        self.assertEqual(self.client.put(PREFIX + "/media/" + "0" * 64, content=content, headers={"Content-Type": "image/png"}).status_code, 422)
        self.assertEqual(self.client.put(PREFIX + "/media/" + digest, content=content, headers={"Content-Type": "image/jpeg"}).status_code, 422)
        bad = b"<svg><script>unsafe</script></svg>"
        bad_hash = hashlib.sha256(bad).hexdigest()
        self.assertEqual(self.client.put(PREFIX + "/media/" + bad_hash, content=bad, headers={"Content-Type": "image/png"}).status_code, 422)
        self.assertEqual(self.client.put(PREFIX + "/media/" + digest, content=content, headers={"Content-Type": "image/svg+xml"}).status_code, 415)

    def test_image_size_limit_and_json_limit_remain_separate(self):
        response = self.client.put(PREFIX + "/media/" + "a" * 64, content=b"a" * (telemetry.MEDIA_MAX_BYTES + 1), headers={"Content-Type": "image/png"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.client.post(PREFIX + "/ugv", content=b"a" * (main.MAX_REQUEST_BYTES + 1), headers={"Content-Type": "application/json"}).status_code, 413)

    def test_unsafe_media_references_rejected(self):
        body = payload()
        frame = {"frame_id": "frame-1", "captured_at": body["sampled_at_ms"], "sha256": "a" * 64, "mime_type": "image/png", "size_bytes": 100}
        for uri in ("data:image/png;base64,AAA", "file:///etc/passwd", "javascript:alert(1)", "https://user:password@example.com/image.png", "../private.png"):
            body["visual_frames"] = [{**frame, "storage_uri": uri}]
            self.assertEqual(self.post(body).status_code, 422, uri)
        body["visual_frames"] = [{**frame, "storage_uri": PREFIX + "/media/" + "a" * 64}]
        self.assertEqual(self.post(body).status_code, 422)

    def test_disabled_feature_and_competition_never_touch_database(self):
        for settings in ({"MOBILE_TELEMETRY_ENABLED": "0"}, {"COLLECTION_IOT_DISABLED": "1"}):
            with patch.dict(os.environ, settings):
                with patch.object(telemetry.store, "connect", side_effect=AssertionError("AIC must not access telemetry DB")):
                    self.assertEqual(self.client.get(PREFIX + "/devices").status_code, 404)
                    self.assertEqual(self.post(payload()).status_code, 404)
                    self.assertEqual(self.client.get(PREFIX + "/schema").status_code, 404)
                self.assertNotIn("mobile_telemetry", contract())

    def test_schema_and_capabilities_are_consistent(self):
        schema = self.client.get(PREFIX + "/schema").json()
        self.assertIn("quality_flag", schema["telemetry"]["required"])
        capabilities = self.client.get(PREFIX + "/capabilities").json()
        self.assertEqual(capabilities["edition"], "project")
        self.assertTrue(capabilities["read_auth_required"])

    def test_startup_does_not_register_routes_in_aic(self):
        environment = dict(os.environ, MOBILE_TELEMETRY_ENABLED="0", COLLECTION_IOT_DISABLED="1")
        environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
        code = "from backend.main import app; assert not any(r.path.startswith('/api/weather/telemetry') for r in app.routes)"
        result = subprocess.run([sys.executable, "-c", code], env=environment, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr[-1500:])
