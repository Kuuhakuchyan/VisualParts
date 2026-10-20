"""Synthetic software verification, not validation of real intervention effects."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend import planning
from backend.aic.store import digest


class GeometryTests(unittest.TestCase):
    def test_shadow_formula_and_no_thermal_claims(self):
        result = planning.evaluate_plan(planning.PlanInput(name="test", height_m=10, solar_altitude_deg=45))
        self.assertEqual(result["metrics"]["ideal_shadow_length_m"], 10)
        self.assertIsNone(result["temperature_delta_c"])
        self.assertIsNone(result["confidence"])

    def test_volume_and_albedo_units(self):
        result = planning.evaluate_plan(planning.PlanInput(name="test", intervention="building", area_m2=120, height_m=12))
        self.assertEqual(result["metrics"]["added_volume_m3"], 1440)
        result = planning.evaluate_plan(planning.PlanInput(name="test", intervention="cool_roof", baseline_albedo=.2, proposed_albedo=.65))
        self.assertEqual(result["metrics"]["reflectance_change_pp"], 45)
        self.assertIsNone(result["metrics"]["ideal_shadow_length_m"])

    def test_greening_not_inventing_temperature(self):
        result = planning.evaluate_plan(planning.PlanInput(name="test", intervention="greening"))
        self.assertEqual(result["metrics"]["intervention_area_m2"], 100)
        self.assertIsNone(result["metrics"]["ideal_shadow_length_m"])
        self.assertIsNone(result["metrics"]["added_volume_m3"])

    def test_inputs_and_unknown_fields_validated(self):
        for extra in [{"area_m2": -2}, {"solar_altitude_deg": 0}, {"longitude": 0}, {"name": "  "}, {"height_m": float("nan")}, {"intervention": "magic"}, {"confidence": 1}]:
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                planning.PlanInput.model_validate({"name": "test", **extra})

    def test_reproducible_input_digest(self):
        value = planning.PlanInput(name="test")
        self.assertEqual(planning.evaluate_plan(value), planning.evaluate_plan(value))
        self.assertEqual(planning.evaluate_plan(value)["input_sha256"], digest(value.model_dump()))


class PlanAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = planning.PlanStore(Path(self.tmp.name) / "plans.sqlite3")
        self.patch = patch.object(planning, "store", self.db)
        self.patch.start()
        app = FastAPI()
        app.include_router(planning.router)
        self.client = TestClient(app)
        self.a = {"X-Workspace-Token": "a" * 64}
        self.b = {"X-Workspace-Token": "b" * 64}

    def tearDown(self):
        self.client.close()
        self.patch.stop()
        self.tmp.cleanup()

    def test_requires_browser_credential(self):
        self.assertEqual(self.client.get("/api/weather/workspace/plans").status_code, 401)
        self.assertEqual(self.client.get("/api/weather/workspace/plans", headers={"X-Workspace-Token": "invalid"}).status_code, 401)

    def test_create_list_delete_scoped_and_checksum(self):
        path = "/api/weather/workspace/plans"
        response = self.client.post(path, headers=self.a, json={"name": "Synthetic scenario"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.headers["cache-control"], "no-store")
        record = response.json()
        checksum = record.pop("record_sha256")
        self.assertEqual(checksum, digest(record))
        self.assertEqual(len(self.client.get(path, headers=self.a).json()["plans"]), 1)
        self.assertEqual(self.client.get(path, headers=self.b).json()["plans"], [])
        self.assertEqual(self.client.delete(f"{path}/{record['id']}", headers=self.b).status_code, 404)
        self.assertEqual(self.client.delete(f"{path}/{record['id']}", headers=self.a).status_code, 200)
        self.assertEqual(self.client.get(path, headers=self.a).json()["plans"], [])

    def test_storage_reopens_without_token_in_payload(self):
        self.db.save(planning.owner_hash("a"*64), planning.PlanInput(name="test"))
        records = planning.PlanStore(self.db.path).list(planning.owner_hash("a"*64))
        self.assertEqual(len(records), 1)
        self.assertNotIn("a"*64, json.dumps(records))

    def test_extra_identity_field_rejected(self):
        response = self.client.post("/api/weather/workspace/plans", headers=self.a, json={"name": "test", "student_id": "test"})
        self.assertEqual(response.status_code, 422)

    def test_quota_is_per_workspace(self):
        owner = planning.owner_hash("a"*64)
        for _ in range(100):
            self.db.save(owner, planning.PlanInput(name="synthetic"))
        self.assertEqual(self.client.post("/api/weather/workspace/plans", headers=self.a, json={"name": "test"}).status_code, 409)
        self.assertEqual(self.client.post("/api/weather/workspace/plans", headers=self.b, json={"name": "test"}).status_code, 201)


class LegacyBoundaryTests(unittest.TestCase):
    def test_unvalidated_simulation_disabled_by_default(self):
        from backend.main import app
        with patch.dict("os.environ", {"DECISION_ENABLE_LEGACY_MOCK": "0"}), TestClient(app, base_url="http://localhost") as client:
            response = client.post("/api/simulation/what-if", json={"targetBuildingId": "test", "action": "ADD"})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(client.get("/api/simulation/export").status_code, 409)


if __name__ == "__main__":
    unittest.main()
