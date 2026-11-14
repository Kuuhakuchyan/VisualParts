"""Exercise real modules with synthetic inputs and private temporary storage only."""
import argparse
import asyncio
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import AsyncMock, patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/submission-workflows")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    checks, evidence = [], {}

    def check(condition, label):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    def save(name, value):
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="wjtj-submission-") as directory:
        state = Path(directory)
        configuration = {"DECISION_STATE_DB": str(state / "decision.sqlite3"),
                         "WORKSPACE_STATE_DB": str(state / "plans.sqlite3"), "AIC_STATE_DB": str(state / "aic.sqlite3"),
                         "TELEMETRY_STATE_DB": str(state / "telemetry.sqlite3"), "TELEMETRY_MEDIA_DIR": str(state / "media"),
                         "TELEMETRY_INGEST_TOKEN": "local-fixture-only", "COLLECTION_IOT_DISABLED": "0",
                         "MOBILE_TELEMETRY_ENABLED": "1", "MOBILE_TELEMETRY_PUBLIC_VIEW": "1",
                         "ALLOWED_HOSTS": "localhost,127.0.0.1", "DECISION_ENABLE_LEGACY_MOCK": "0",
                         "DEEPSEEK_API_KEY": "", "AIC_REVIEW_FILE": "", "AIC_SOURCE_MANIFEST": ""}
        with patch.dict(os.environ, configuration):
            from fastapi.testclient import TestClient
            from PIL import Image
            from backend import main as api, sandbox, lcz, collection
            from backend.aic import router as aic
            from backend.aic.regional import RegionalRequest
            from backend.aic.store import digest

            request = sandbox.SimulationInput.model_validate({
                "scene": {"name": "软著功能测试情景"}, "resolution_m": 50,
                "regional": {"bounds": {"west": 113.527, "east": 113.533, "south": 34.812, "north": 34.818},
                             "mode": "history", "data_mode": "lcz_simulation", "grid_resolution_m": 50,
                             "use_ai": False, "groups": ["students", "athletes", "workers", "older_adults"],
                             "cohort_scenarios": {"students": {"activity": "walk", "exposure_minutes": 20},
                                                  "athletes": {"activity": "run", "exposure_minutes": 40},
                                                  "workers": {"activity": "work", "exposure_minutes": 90},
                                                  "older_adults": {"activity": "rest", "exposure_minutes": 15}}}})
            fixture = {"id": "obs_" + "f" * 64, "source_type": "historical_weather",
                       "observed_at": "2024-06-12T14:00:00+08:00", "temperature_c": 32, "relative_humidity_pct": 50,
                       "source_name": "SYNTHETIC SOFTWARE FIXTURE - NOT A HISTORICAL OBSERVATION",
                       "quality_status": "validated", "units": {"temperature": "°C", "humidity": "%"},
                       "location": {"longitude": 113.531, "latitude": 34.814},
                       "extras": {"wind_speed_10m": 2, "direct_normal_irradiance_wm2": 700, "diffuse_radiation_wm2": 120}}
            save("01-input.json", {"test_fixture": True, "production_mutated": False,
                                   "note": "All weather and device samples in this directory are synthetic software fixtures.",
                                   "simulation_input": request.model_dump(mode="json"), "weather_fixture": fixture})
            initial = lcz.build_scenario(request.regional, fixture)
            untouched = copy.deepcopy(initial)
            baseline = sandbox.simulate(request, fixture, initial)
            request.scene = sandbox.Scene(name="模拟新增建筑", additions=[sandbox.Addition(
                id="new-copyright-fixture", longitude=113.528143, latitude=34.813813,
                width_m=20, depth_m=20, height_m=60)])
            built = sandbox.simulate(request, fixture, initial)
            check(initial == untouched, "building edits preserve the original LCZ background")
            check(built["lcz_snapshot_sha256"] == baseline["lcz_snapshot_sha256"], "before/after use the same weather and LCZ snapshot")
            changed = [cell for cell in built["cells"]["features"] if abs(cell["properties"].get("delta_utci_c") or 0) >= .001]
            check(0 < len(changed) < len(built["cells"]["features"]) / 2, "new building changes local cells without recoloring the whole area")
            save("02-before-after.json", {"test_fixture": True, "baseline": baseline, "proposed": built})
            evidence["building"] = {"cells": len(built["cells"]["features"]), "changed_cells": len(changed),
                                    "lcz_snapshot_sha256": built["lcz_snapshot_sha256"], "summary": built["summary"]}

            report = asyncio.run(aic.build_regional_report(request.regional, sampled_result=initial))
            check(report["lcz_snapshot_sha256"] == initial["snapshot_sha256"], "cohort report references the displayed LCZ snapshot")
            check(report["report_sha256"] == digest({k: v for k, v in report.items() if k != "report_sha256"}), "report content matches its hash")
            for cohort in report["cohorts"]:
                expected = request.regional.cohort_scenarios[cohort["id"]]
                check(cohort["context"]["activity"] == expected.activity and cohort["context"]["minutes"] == expected.exposure_minutes,
                      "cohort keeps its own activity and duration: " + cohort["id"])
            save("03-cohort-report.json", report)

            morning = copy.deepcopy(fixture)
            morning.update(id="obs_" + "e" * 64, observed_at="2024-06-12T10:00:00+08:00", temperature_c=28)
            previous = lcz.build_scenario(request.regional, morning)
            check(previous["snapshot_sha256"] != initial["snapshot_sha256"], "different weather hours get different result snapshots")
            check([c["id"] for c in previous["cells"]["features"]] == [c["id"] for c in initial["cells"]["features"]], "hour changes preserve grid identity")
            check(lcz.build_scenario(request.regional, fixture)["cells"] == initial["cells"], "returning to an earlier hour restores its original field")
            save("04-hourly-snapshots.json", {"test_fixture": True, "morning": previous, "afternoon": initial})

            with patch("httpx.AsyncClient", side_effect=AssertionError("network disabled in synthetic workflow")):
                with TestClient(api.app, base_url="http://localhost") as client:
                    headers = {"X-Workspace-Token": "a" * 64}
                    response = client.post("/api/weather/sandbox/scenes", json=request.scene.model_dump(), headers=headers)
                    check(response.status_code == 201, "scene save succeeds")
                    record = response.json()
                    check(client.get("/api/weather/sandbox/scenes", headers=headers).json()["scenes"][0] == record, "saved scene reads back exactly")
                    other = {"X-Workspace-Token": "b" * 64}
                    check(client.get("/api/weather/sandbox/scenes", headers=other).json()["scenes"] == [], "scene stays isolated from another workspace")
                    check(client.delete("/api/weather/sandbox/scenes/" + record["id"], headers=other).status_code == 404, "another workspace cannot delete the scene")
                    check(client.delete("/api/weather/sandbox/scenes/" + record["id"], headers=headers).status_code == 200, "owner can delete the scene")
                    check(client.delete("/api/weather/sandbox/scenes/" + record["id"], headers=headers).status_code == 404, "repeated delete is handled explicitly")
                    save("05-scene-record.json", {"test_fixture": True, "saved": record, "deleted_after_test": True})

                    stamp = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat(timespec="milliseconds")
                    image = io.BytesIO()
                    Image.new("RGB", (64, 48), (89, 130, 163)).save(image, "PNG")
                    content = image.getvalue()
                    checksum = hashlib.sha256(content).hexdigest()
                    auth = {"X-Telemetry-Token": "local-fixture-only"}
                    response = client.put("/api/weather/telemetry/media/" + checksum, content=content,
                                          headers={**auth, "Content-Type": "image/png"})
                    check(response.status_code == 200, "synthetic device image upload succeeds")
                    for kind in ("UGV", "UAV"):
                        payload = {"uuid": str(uuid4()), "device_type": kind, "device_name": kind, "device_id": kind + "-SYNTHETIC",
                                   "task_id": "copyright-fixture", "seq": 1, "sampled_at_ms": stamp,
                                   "status": {"state": "dwell", "is_synced": True},
                                   "location": {"longitude": 113.532, "latitude": 34.813, "altitude_m": 30,
                                                "altitude_reference": "agl", "speed_mps": 0},
                                   "measurements": {"temperature_c": 28.4, "humidity_pct": 61.2}, "quality_flag": 0,
                                   "attributes": {"test_fixture": True},
                                   "visual_frames": [{"frame_id": "fixture-image", "captured_at": stamp,
                                                      "storage_uri": "/api/weather/telemetry/media/" + checksum,
                                                      "sha256": checksum, "mime_type": "image/png", "size_bytes": len(content)}]}
                        endpoint = "/api/weather/telemetry/" + kind.lower()
                        check(client.post(endpoint, json=payload, headers=auth).json()["accepted"] == 1, kind + " upload is accepted")
                        check(client.post(endpoint, json=payload, headers=auth).json()["duplicated"] == 1, kind + " retry does not create duplicate observations")
                        detail = client.get("/api/weather/mobile-observations/devices/" + payload["device_id"]).json()
                        check(detail["device"]["measurements"]["temperature_c"] == 28.4 and detail["stats"]["total"] == 1,
                              kind + " measurements reach the public page projection")
                        save("06-" + kind.lower() + "-projection.json", {"test_fixture": True, "detail": detail})
                    check(client.get("/api/weather/mobile-observations/images/" + checksum).status_code == 200, "only attached image gets a page preview")
                    check(client.get("/api/weather/telemetry/devices").status_code == 401, "raw device API still requires authentication")

            region = sandbox.campus_boundary()["geometry"]["coordinates"][0]
            regional = RegionalRequest(bounds={"west": min(p[0] for p in region), "east": max(p[0] for p in region),
                                               "south": min(p[1] for p in region), "north": max(p[1] for p in region)},
                                       mode="history", data_mode="lcz_simulation", grid_resolution_m=100, use_ai=False)
            field = lcz.build_scenario(regional, fixture)
            mission = collection.make_mission(collection.CollectionInput(regional=regional, expected_snapshot_sha256=field["snapshot_sha256"]), field)
            for track in mission["tracks"]:
                check(track["status"] == "ready", track["device_id"] + " simulation creates a route")
                check(track["planning"]["estimated_energy_wh"] <= track["planning"]["usable_budget_wh"], track["device_id"] + " route retains return-energy reserve")
                check(all(sample["snapshot_sha256"] == field["snapshot_sha256"] and sample["simulated"] for sample in track["samples"]),
                      track["device_id"] + " collection values use the exact simulated field")
            save("07-collection-mission.json", {"test_fixture": True, "mission": mission})
    save("summary.json", {"status": "PASS", "checks": checks, "passed": len(checks), "production_mutated": False,
                          "paid_ai_called": False, "test_fixture": True, "evidence": evidence})
    print(f"Submission workflows: PASS ({len(checks)} checks; all observations synthetic)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
