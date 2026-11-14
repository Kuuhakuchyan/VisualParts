"""Synthetic boundary and device seed for isolated copyright workflow acceptance."""
from datetime import datetime, timedelta, timezone
import hashlib
import io
import math
import os
from pathlib import Path
from uuid import uuid4

TOKEN = "copyright-synthetic-local-only"
OWNER = "c" * 64
TZ = timezone(timedelta(hours=8))


def configure(directory):
    directory = Path(directory).resolve()
    for key in list(os.environ):
        if key.startswith(("AIC_", "TELEMETRY_", "DEEPSEEK_", "OPENAI_")):
            del os.environ[key]
    databases = directory / "databases"
    databases.mkdir(parents=True, exist_ok=True)
    (directory / "media").mkdir(exist_ok=True)
    os.environ.update(DECISION_STATE_DB=str(databases / "decision.sqlite3"),
                      WORKSPACE_STATE_DB=str(databases / "workspace.sqlite3"),
                      AIC_STATE_DB=str(databases / "evidence.sqlite3"),
                      TELEMETRY_STATE_DB=str(databases / "telemetry.sqlite3"), TELEMETRY_MEDIA_DIR=str(directory / "media"),
                      TELEMETRY_INGEST_TOKEN=TOKEN, MOBILE_TELEMETRY_ENABLED="1", MOBILE_TELEMETRY_PUBLIC_VIEW="1",
                      COLLECTION_IOT_DISABLED="0", ALLOWED_HOSTS="localhost,127.0.0.1,testserver",
                      DECISION_ENABLE_LEGACY_MOCK="0", DECISION_RATE_LIMIT_PER_MINUTE="1200",
                      DECISION_WRITE_RATE_LIMIT_PER_MINUTE="300")
    return directory


def install_weather():
    from backend import sandbox, main
    from backend.aic import router as aic
    from backend.aic.weather import HISTORY_DATE

    def observation(mode="current", location=None, target=None):
        at = target or (datetime.fromisoformat(HISTORY_DATE + "T14:00:00+08:00") if mode == "history"
                        else datetime.now(TZ).replace(minute=0, second=0, microsecond=0))
        temperature = round(30 + 5 * math.sin((at.hour - 8) * math.pi / 12), 2)
        payload = {"source_type": "open_meteo_forecast" if target else "historical_weather" if mode == "history" else "open_meteo_grid",
                   "source_name": "模拟气象样例 / 非真实观测", "source_url": "urn:wjtj:synthetic-weather-fixture",
                   "observed_at": at.isoformat(), "retrieved_at": datetime.now(timezone.utc).isoformat(),
                   "valid_time": at.isoformat(), "is_forecast": target is not None, "temperature_c": temperature,
                   "relative_humidity_pct": 55, "quality_status": "validated", "test_fixture": True,
                   "location": location or {"longitude": 113.531, "latitude": 34.814},
                   "units": {"temperature": "°C", "humidity": "%"},
                   "extras": {"wind_speed_10m": 2.2, "direct_normal_irradiance_wm2": 700 if 7 <= at.hour <= 18 else 0,
                              "diffuse_radiation_wm2": 120 if 7 <= at.hour <= 18 else 0}}
        return aic.store.put(payload, {"test_fixture": True, "at": at.isoformat()})

    async def boundary(body):
        return observation(body.regional.mode, target=getattr(body, "valid_time", None))

    async def get(mode, site="campus", location=None, history_hour=None):
        return observation(mode, location)

    async def timeline(site="campus"):
        now = datetime.now(TZ).replace(minute=0, second=0, microsecond=0)
        points = [{"time": (now + timedelta(hours=i)).isoformat(), "period": "forecast" if i > 0 else "past_model",
                   "temperature_2m": round(30 + 5 * math.sin(((now.hour + i) % 24 - 8) * math.pi / 12), 2),
                   "relative_humidity_2m": 55, "wind_speed_10m": 2.2, "precipitation": 0} for i in range(-12, 25)]
        return {"snapshot": observation(), "points": points, "test_fixture": True}

    sandbox.boundary_weather = boundary
    aic.weather.get = get
    aic.weather.timeline = timeline
    os.environ["COLLECTION_IOT_ORIGIN"] = "http://127.0.0.1:18501"
    main._cache_set("weather.current", main.WeatherResponse(success=True, data={"temperature": 32, "humidity": 55, "windSpeed": 2.2},
                    source="synthetic_fixture", observedAt=datetime.now(TZ).isoformat(), message="模拟数据"), 86400)
    return observation


def seed(app):
    from fastapi.testclient import TestClient
    from PIL import Image, ImageDraw
    from backend import main

    with TestClient(app) as client:
        image = Image.new("RGB", (640, 360), "#b7d1d8")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 210, 640, 360), fill="#7e9a78")
        draw.rectangle((230, 70, 380, 220), fill="#d4c9b5")
        draw.text((20, 20), "SYNTHETIC CAMERA FIXTURE", fill="#203140")
        stream = io.BytesIO()
        image.save(stream, "PNG")
        data = stream.getvalue()
        checksum = hashlib.sha256(data).hexdigest()
        auth = {"X-Telemetry-Token": TOKEN}
        assert client.put("/api/weather/telemetry/media/" + checksum, content=data,
                          headers={**auth, "Content-Type": "image/png"}).status_code == 200
        for kind in ("UGV", "UAV"):
            for seq in range(1, 4):
                stamp = (datetime.now(timezone.utc) - timedelta(seconds=80 - seq * 20)).isoformat(timespec="milliseconds")
                body = {"uuid": str(uuid4()), "device_type": kind, "device_id": kind + "-UI-QA", "device_name": kind,
                        "task_id": "synthetic-ui-acceptance", "seq": seq, "sampled_at_ms": stamp,
                        "status": {"state": "dwell", "is_synced": True}, "quality_flag": 0,
                        "location": {"longitude": 113.532 + seq * .0001, "latitude": 34.813, "altitude_m": 30,
                                     "altitude_reference": "agl", "speed_mps": 0},
                        "measurements": {"temperature_c": 29 + seq / 10, "humidity_pct": 60 + seq},
                        "attributes": {"test_fixture": True},
                        "visual_frames": [{"frame_id": "synthetic-camera-" + str(seq), "captured_at": stamp,
                                           "storage_uri": "/api/weather/telemetry/media/" + checksum,
                                           "sha256": checksum, "mime_type": "image/png", "size_bytes": len(data)}]}
                assert client.post("/api/weather/telemetry/" + kind.lower(), json=body, headers=auth).status_code == 200
        headers = {"X-Workspace-Token": OWNER}
        plan = client.post("/api/weather/workspace/plans", json={"name": "模拟遮阴方案"}, headers=headers)
        assert plan.status_code == 201
        assert client.post("/api/weather/sandbox/scenes", json={"name": "模拟初始场景"}, headers=headers).status_code == 201
        main._state_save("buildings", "synthetic-building", {"id": "synthetic-building", "test_fixture": True})
        main._state_save("scenarios", "synthetic-scenario", {"id": "synthetic-scenario", "test_fixture": True})
    return {"image_sha256": checksum, "plan": plan.json(), "test_fixture": True}
