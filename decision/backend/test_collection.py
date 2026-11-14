"""Contract, provenance and route checks; these are not field-validation results."""
import copy
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import Point, shape
from shapely.ops import transform, unary_union

from backend import collection, lcz, sandbox
from backend.aic.regional import RegionalRequest
from backend.test_sandbox import boundary


class DeviceTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.info = {"last_seen": self.now.isoformat()}
        self.sample = {"ts": self.now.isoformat(), "temp_c": 31.5, "humidity": 62}

    def read(self, info=None, sample=None, **kwargs):
        return collection.normalize_device("ATOM_LITE_01", self.info if info is None else info,
                                           self.sample if sample is None else sample, now=self.now, **kwargs)

    def test_current_device_sample_is_not_simulated(self):
        d = self.read()
        self.assertEqual(d["status"], "online")
        self.assertEqual(d["temperature_c"], 31.5)
        self.assertEqual(d["humidity_pct"], 62)
        self.assertFalse(d["simulated"])
        self.assertFalse(d["med_eligible"])
        self.assertIsNone(d["location"])

    def test_old_device_status_cannot_claim_online(self):
        d = self.read(info={"last_seen": (self.now-timedelta(days=1)).isoformat(), "online": True})
        self.assertEqual(d["status"], "offline")
        self.assertIsNone(d["temperature_c"])

    def test_old_or_future_samples_are_not_current_readings(self):
        for hours in (-24, 1):
            with self.subTest(hours=hours):
                d = self.read(sample={**self.sample, "ts": (self.now+timedelta(hours=hours)).isoformat()})
                self.assertEqual(d["status"], "awaiting_sample")
                self.assertIsNone(d["humidity_pct"])
                self.assertIsNotNone(d["last_sample"])

    def test_invalid_numbers_and_unzoned_timestamps_are_excluded(self):
        for sample in [{**self.sample, "temp_c": 99}, {**self.sample, "humidity": float("nan")},
                       {**self.sample, "temp_c": True}, {**self.sample, "ts": "2026-10-21T12:00:00"}, {}]:
            with self.subTest(sample=sample):
                self.assertNotEqual(self.read(sample=sample)["status"], "online")

    def test_upstream_failure_is_not_called_device_offline(self):
        self.assertEqual(self.read(reachable=False)["status"], "unavailable")


class ReadAdapterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {
            "COLLECTION_IOT_DISABLED": "0",
            "COLLECTION_IOT_ORIGIN": "https://telemetry.invalid",
        }))

    async def test_only_allowlisted_devices_and_fixed_get_paths(self):
        paths = []
        now = datetime.now(timezone.utc).isoformat()

        def handler(request):
            paths.append((request.method, request.url.path))
            if request.url.path == "/api/devices":
                return httpx.Response(200, json=[{"device_id": "ATOM_LITE_01", "last_seen": now},
                                                {"device_id": "private-unrelated-device", "last_seen": now}])
            return httpx.Response(200, json={"ts": now, "temp_c": 30, "humidity": 60})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch("backend.collection.httpx.AsyncClient", return_value=client):
            devices = await collection.read_devices()
        self.assertEqual({d["device_id"] for d in devices}, set(collection.DEVICES))
        self.assertTrue(all(method == "GET" for method, _ in paths))
        self.assertEqual(len(paths), 3)

    async def test_list_failure_returns_no_fake_values(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(503)))
        with patch("backend.collection.httpx.AsyncClient", return_value=client):
            devices = await collection.read_devices()
        self.assertTrue(all(d["status"] == "unavailable" and d["temperature_c"] is None for d in devices))


class MissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.region = shape(sandbox.campus_boundary()["geometry"])
        w, s, e, n = cls.region.bounds
        cls.regional = RegionalRequest(bounds=dict(west=w, south=s, east=e, north=n), mode="history", data_mode="lcz_simulation", use_ai=False)
        cls.scenario = lcz.build_scenario(cls.regional, boundary())
        cls.body = collection.CollectionInput(regional=cls.regional, expected_snapshot_sha256=cls.scenario["snapshot_sha256"])
        cls.mission = collection.make_mission(cls.body, cls.scenario)

    def test_full_campus_has_two_continuous_routes(self):
        self.assertEqual(len(self.mission["tracks"]), 2)
        for track in self.mission["tracks"]:
            self.assertEqual(track["status"], "ready")
            self.assertGreater(len(track["samples"]), 20)
            self.assertEqual(track["route"]["type"], "LineString")
            self.assertTrue(self.region.buffer(1e-9).covers(shape(track["route"])))

    def test_ground_route_avoids_current_scene_buildings(self):
        _, proposed = sandbox.scene_geometry(self.body.scene)
        obstacles = unary_union([f["metric"] for f in proposed])
        track = self.mission["tracks"][0]
        self.assertLessEqual(track["speed_mps"], 1.5)
        self.assertTrue(transform(sandbox.TO_M, shape(track["route"])).intersection(obstacles).is_empty)

    def test_all_samples_use_same_snapshot_and_never_medical_evidence(self):
        cells = {f["id"]: f["properties"] for f in self.scenario["cells"]["features"]}
        for track in self.mission["tracks"]:
            self.assertEqual([s["seq"] for s in track["samples"]], list(range(len(track["samples"]))))
            for sample in track["samples"]:
                self.assertEqual(sample["snapshot_sha256"], self.scenario["snapshot_sha256"])
                self.assertTrue(sample["simulated"])
                self.assertIsNone(sample["quality_flag"])
                self.assertFalse(sample["med_eligible"])
                self.assertEqual(sample["temp_c"], cells.get(sample["grid_id"], {}).get("temp_c"))
                self.assertEqual(sample["humidity_pct"], cells.get(sample["grid_id"], {}).get("humidity_pct"))

    def test_aerial_route_does_not_invent_temperature_at_flight_altitude(self):
        for sample in self.mission["tracks"][1]["samples"]:
            self.assertEqual(sample["altitude_agl_m"], 60)
            self.assertEqual(sample["field_height_m"], 2)
            self.assertEqual(sample["value_semantics"], "ground_grid_projection")

    def test_classification_aware_plan_retains_same_classification_provenance(self):
        self.assertEqual(self.mission["classification_summary"],self.scenario["classification_summary"])
        self.assertEqual(self.mission["classification_sha256"],self.scenario["simulation"]["classification_sha256"])
        for track in self.mission["tracks"]:
            plan=track["planning"]
            self.assertIn("LCZ_diversity",plan["objective"])
            self.assertTrue(set(plan["covered_lcz_classes"])<=set(plan["reachable_lcz_classes"]))
            self.assertEqual(set(plan["uncovered_lcz_classes"]),set(plan["reachable_lcz_classes"])-set(plan["covered_lcz_classes"]))
            self.assertLessEqual(plan["estimated_energy_wh"],plan["usable_budget_wh"])
        self.assertFalse(self.mission["lcz_planning"]["calibrated"])

    def test_repeated_inputs_have_identical_missions(self):
        self.assertEqual(collection.make_mission(self.body, self.scenario), self.mission)

    def test_classification_gaps_remain_missing(self):
        scenario = copy.deepcopy(self.scenario)
        for feature in scenario["cells"]["features"]:
            feature["properties"].update(temp_c=None, humidity_pct=None)
        mission = collection.make_mission(self.body, scenario)
        self.assertTrue(all(s["temp_c"] is None and s["humidity_pct"] is None for t in mission["tracks"] for s in t["samples"]))

    def test_live_and_neighborhood_requests_are_rejected(self):
        for change in [{"data_mode": "live"}, {"area_kind": "neighborhood"}]:
            with self.assertRaises(ValidationError):
                collection.CollectionInput(regional={**self.regional.model_dump(), **change}, expected_snapshot_sha256=self.scenario["snapshot_sha256"])

    def test_unknown_input_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            collection.CollectionInput(**self.body.model_dump(), upstream_url="http://private/")

    def test_forecast_time_uses_same_hour_contract_as_layout_simulation(self):
        hour=(datetime.now(timezone.utc)+timedelta(hours=2)).replace(minute=0,second=0,microsecond=0)
        regional={**self.regional.model_dump(),"mode":"current"}
        for stamp in [hour.replace(tzinfo=None),hour+timedelta(minutes=1),hour+timedelta(days=2)]:
            with self.subTest(stamp=stamp),self.assertRaises(ValidationError):
                collection.CollectionInput(regional=regional,valid_time=stamp,expected_snapshot_sha256="a"*64)
        with self.assertRaises(ValidationError):
            collection.CollectionInput(regional=self.regional,valid_time=hour,expected_snapshot_sha256="a"*64)

    def test_forecast_collection_uses_selected_boundary_without_current_fallback(self):
        hour=(datetime.now(timezone.utc)+timedelta(hours=2)).replace(minute=0,second=0,microsecond=0)
        baseline=boundary(source_type="open_meteo_forecast",observed_at=hour.isoformat(),retrieved_at=datetime.now(timezone.utc).isoformat())
        scenario={**self.scenario,"baseline":baseline}
        request=collection.CollectionInput(regional={**self.regional.model_dump(),"mode":"current"},
            valid_time=hour,expected_snapshot_sha256=scenario["snapshot_sha256"])
        app=FastAPI();app.include_router(collection.router)
        with TestClient(app) as client,patch("backend.collection.boundary_weather",AsyncMock(return_value=baseline)),patch("backend.collection.build_scenario",return_value=scenario),patch("backend.collection.make_mission",side_effect=lambda body,field:{"valid_time":body.valid_time.isoformat(),"snapshot_sha256":field["snapshot_sha256"]}) as mission:
            response=client.post("/api/weather/sandbox/collection/simulate",json=request.model_dump(mode="json"))
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()["valid_time"],hour.isoformat())
        self.assertEqual(response.json()["snapshot_sha256"],scenario["snapshot_sha256"])
        self.assertEqual(mission.call_count,1)

    def test_matching_snapshot_endpoint_and_wire_time(self):
        app = FastAPI(); app.include_router(collection.router)
        with TestClient(app) as client, patch("backend.collection.boundary_weather", AsyncMock(return_value=boundary())):
            response = client.post("/api/weather/sandbox/collection/simulate", json=self.body.model_dump())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["snapshot_sha256"], self.scenario["snapshot_sha256"])
        self.assertTrue(response.json()["tracks"][0]["samples"][0]["ts"].endswith("Z"))
        self.assertFalse(response.json()["contract"]["mqtt_published"])

    def test_stale_snapshot_is_409_not_silent_substitution(self):
        app = FastAPI(); app.include_router(collection.router)
        with TestClient(app) as client, patch("backend.collection.boundary_weather", AsyncMock(return_value=boundary())):
            response = client.post("/api/weather/sandbox/collection/simulate", json={**self.body.model_dump(), "expected_snapshot_sha256": "0"*64})
        self.assertEqual(response.status_code, 409)

    def test_weather_failure_does_not_generate_mission(self):
        app = FastAPI(); app.include_router(collection.router)
        with TestClient(app) as client, patch("backend.collection.boundary_weather", AsyncMock(side_effect=httpx.ConnectError("unavailable"))):
            response = client.post("/api/weather/sandbox/collection/simulate", json=self.body.model_dump())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("tracks", response.json())


if __name__ == "__main__":
    unittest.main()
