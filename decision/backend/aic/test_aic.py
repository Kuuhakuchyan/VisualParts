"""Software verification only. Synthetic fixtures are not clinical validation."""

import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from .generation import select_advice, validate_selection
from .retrieval import KnowledgeBase, clause_hash
from .risk import RED_FLAGS, assess_environment, category, heat_index_f, triage
from .store import ObservationStore, digest


def fixture(**changes):
    return {"source_type": "open_meteo_grid", "quality_status": "validated",
            "observed_at": datetime.now(timezone.utc).isoformat(), "temperature_c": 32.2,
            "relative_humidity_pct": 70, "units": {"temperature": "°C", "humidity": "%"},
            "source_name": "SYNTHETIC UNIT TEST ONLY", **changes}


class RiskTests(unittest.TestCase):
    def test_reference_calculation(self):
        self.assertAlmostEqual(heat_index_f(90, 70), 105.9220206, places=5)

    def test_category_boundaries_without_rounding(self):
        for value, expected in [(79.99, "below_range"), (80, "caution"), (89.999, "caution"),
                                (90, "extreme_caution"), (102.99, "extreme_caution"), (103, "danger"), (124.999, "danger"), (125, "extreme_danger")]:
            with self.subTest(value=value):
                self.assertEqual(category(value)[0], expected)

    def test_cool_weather_not_a_safety_claim(self):
        result = assess_environment(fixture(temperature_c=20))
        self.assertEqual(result["risk"], "below_range")
        self.assertIsNone(result["heat_index_c"])

    def test_stale_and_future_blocked(self):
        for delta in [-3, 1]:
            result = assess_environment(fixture(observed_at=(datetime.now(timezone.utc) + timedelta(hours=delta)).isoformat()))
            self.assertEqual(result["triggers"], ["observation_stale_or_future"])

    def test_missing_and_naive_time(self):
        self.assertEqual(assess_environment(None)["risk"], "unavailable")
        self.assertEqual(assess_environment(fixture(observed_at="2026-01-01T12:00"))["triggers"], ["invalid_observation"])

    def test_invalid_measurements(self):
        for values in [{"relative_humidity_pct": 101}, {"relative_humidity_pct": -1}, {"temperature_c": float("nan")}, {"temperature_c": None}]:
            self.assertEqual(assess_environment(fixture(**values))["risk"], "unavailable")

    def test_wrong_units_and_unknown_source_blocked(self):
        self.assertEqual(assess_environment(fixture(units={"temperature": "F", "humidity": "%"}))["triggers"], ["invalid_observation"])
        self.assertEqual(assess_environment(fixture(source_type="unknown"))["triggers"], ["unsupported_source_type"])

    def test_mock_and_unvalidated_blocked(self):
        self.assertEqual(assess_environment(fixture(source_type="simulated_test"))["triggers"], ["simulated_observation_blocked"])
        self.assertEqual(assess_environment(fixture(quality_status="pending"))["risk"], "unavailable")

    def test_historical_separate_from_expiry(self):
        result = assess_environment(fixture(source_type="historical_weather", observed_at="2024-07-15T14:00:00+08:00"))
        self.assertIn("historical_case", result["triggers"])

    def test_sun_conditions_not_adjusted_into_fake_temperature(self):
        shade = assess_environment(fixture(), "shade")
        sun = assess_environment(fixture(), "sun")
        self.assertEqual(shade["heat_index_c"], sun["heat_index_c"])
        self.assertEqual(sun["applicability"], "conditional")

    def test_extreme_temperature_outside_operational_domain(self):
        self.assertEqual(assess_environment(fixture(temperature_c=50))["applicability"], "out_of_range")
        self.assertEqual(assess_environment(fixture(temperature_c=42, relative_humidity_pct=95))["triggers"], ["heat_index_outside_reference_chart"])

    def test_all_red_flags_upgrade_independently(self):
        for symptom in RED_FLAGS:
            self.assertTrue(triage([symptom])["urgent"])
        self.assertFalse(triage(["dizziness"])["urgent"])


class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.review = Path(self.tmp.name) / "review.json"
        self.manifest = Path(self.tmp.name) / "sources.json"
        self.kb = KnowledgeBase(review_path=self.review, source_manifest_path=self.manifest)
        self.context = {"risk": "danger", "activity": "run", "minutes": 60, "symptoms": [], "query": "户外 运动 日晒 长时间 暴露"}

    def approve_fixture(self):
        approvals, snapshots = {}, {}
        for c in self.kb.data["clauses"]:
            approvals[c["id"]] = {"status": "approved", "reviewer": "SYNTHETIC_TEST_REVIEWER_NOT_A_DOCTOR",
                "credential_checked": True, "reviewed_at": "test-only", "content_sha256": clause_hash(c, self.kb.sources[c["source_id"]]), "source_sha256": "test-snapshot"}
            snapshots[c["source_id"]] = {"sha256": "test-snapshot", "quotes_verified": True}
        self.review.write_text(json.dumps({"clauses": approvals}), encoding="utf-8")
        self.manifest.write_text(json.dumps({"sources": snapshots}), encoding="utf-8")

    def test_drafts_never_public(self):
        self.assertEqual(self.kb.retrieve(self.context)[0], [])

    def test_filter_and_rank(self):
        self.approve_fixture()
        matches, _ = self.kb.retrieve(self.context)
        self.assertEqual(len(matches), 3)
        self.assertIn("WHO-AVOID-PEAK", [m["id"] for m in matches])
        self.context["risk"] = "below_range"
        self.assertEqual(self.kb.retrieve(self.context)[0], [])

    def test_source_version_change_invalidates_approval(self):
        self.approve_fixture()
        self.kb.sources["WHO-HEAT"]["title"] += " changed"
        self.assertFalse(self.kb.eligible(self.kb.data["clauses"][0]))

    def test_content_edit_invalidates_approval(self):
        self.approve_fixture()
        self.kb.data["clauses"][0]["text_zh"] += "新增处置"
        self.assertFalse(self.kb.eligible(self.kb.data["clauses"][0]))

    def test_evidence_conflict_blocks_all(self):
        self.kb.data["clauses"][0]["conflicts_with"] = ["WHO-SHADE"]
        self.approve_fixture()
        self.assertEqual(self.kb.retrieve(self.context), ([], "evidence_conflict"))

    def test_absent_snapshot_invalidates_approval(self):
        self.approve_fixture()
        self.manifest.unlink()
        self.assertEqual(self.kb.approved(), [])

    def test_missing_environment_blocks_medical_selection(self):
        self.approve_fixture()
        self.context["risk"] = "unavailable"
        self.assertEqual(self.kb.retrieve(self.context), ([], "environment_unavailable"))


class ModelTests(unittest.TestCase):
    def test_unsupported_ids_or_free_text_rejected(self):
        candidates = [{"id": "KNOWN"}]
        for content in ['{"advice_ids":["UNKNOWN"]}', '{"advice_ids":["KNOWN"],"diagnosis":"stroke"}', '{"advice_ids":[]}', '{"advice_ids":["KNOWN","KNOWN"]}']:
            with self.assertRaises(ValueError):
                validate_selection(content, candidates)

    def test_unconfigured_model_uses_only_fixed_evidence(self):
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": ""}):
            ids, mode = asyncio.run(select_advice([{"id": "KNOWN"}], {}))
        self.assertEqual(ids, ["KNOWN"])
        self.assertEqual(mode["mode"], "rules_fallback")

    def test_timeout_falls_back_without_sensitive_error(self):
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "synthetic-test-key"}), patch("backend.aic.generation.httpx.AsyncClient.post", side_effect=httpx.ReadTimeout("test")):
            ids, mode = asyncio.run(select_advice([{"id": "KNOWN", "text_zh": "test", "quote": "test"}], {}))
        self.assertEqual(ids, ["KNOWN"])
        self.assertEqual(mode["reason"], "model_unavailable_or_output_rejected")


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        from . import router as module
        cls.module = module
        cls.original_store = module.store
        module.store = ObservationStore(Path(cls.tmp.name) / "observations.sqlite3")
        app = FastAPI()
        app.include_router(module.router)
        cls.client = TestClient(app)
        cls.samples = []

    @classmethod
    def tearDownClass(cls):
        output = Path("output/aic/api-cases.json")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({"scope": "synthetic software tests; no clinician labels", "cases": cls.samples}, ensure_ascii=False, indent=2), encoding="utf-8")
        cls.module.store = cls.original_store
        cls.client.close()
        cls.tmp.cleanup()

    def call(self, body):
        response = self.client.post("/api/weather/aic/assess", json=body)
        self.samples.append({"input": body, "status": response.status_code, "output": response.json()})
        return response

    def test_identity_fields_rejected(self):
        self.assertEqual(self.call({"name": "test"}).status_code, 422)

    def test_unknown_symptom_and_invalid_duration_rejected(self):
        self.assertEqual(self.call({"symptoms": ["free text"]}).status_code, 422)
        self.assertEqual(self.call({"exposure_minutes": 0}).status_code, 422)

    def test_emergency_no_observation_or_model_needed(self):
        with patch("backend.aic.router.select_advice", new_callable=AsyncMock) as model:
            response = self.call({"symptoms": ["confusion"], "use_ai": True})
        self.assertTrue(response.json()["symptom_triage"]["urgent"])
        model.assert_not_called()
        self.assertEqual(response.json()["advice"], [])

    def test_stale_observation_cannot_produce_environment_risk(self):
        obs = self.module.store.put(fixture(observed_at="2020-01-01T12:00:00+08:00"), {"test": True})
        result = self.call({"observation_id": obs["id"]}).json()
        self.assertEqual(result["environment"]["risk"], "unavailable")

    def test_simulation_rejected_in_formal_result(self):
        obs = self.module.store.put(fixture(source_type="simulated_test"), {"test": True})
        result = self.call({"observation_id": obs["id"]}).json()
        self.assertEqual(result["environment"]["risk"], "unavailable")

    def test_report_recomputable_and_no_fake_advice(self):
        obs = self.module.store.put(fixture(), {"test": True})
        result = self.call({"observation_id": obs["id"], "use_ai": True}).json()
        self.assertEqual(result["environment"], assess_environment(result["observation"]))
        checksum = result.pop("report_sha256")
        self.assertEqual(checksum, digest(result))
        self.assertEqual(result["advice"], [])

    def test_missing_observation_reference_returns_traceable_failure(self):
        result = self.call({"observation_id": "obs_" + "0"*64}).json()
        self.assertIsNone(result["observation"])
        self.assertEqual(result["environment"]["triggers"], ["observation_missing"])

    def test_weather_upstream_failure_is_explicit(self):
        with patch.object(self.module.weather, "get", side_effect=httpx.ConnectError("test")):
            response = self.client.get("/api/weather/aic/observations/current")
        self.assertEqual(response.status_code, 503)
        self.assertIn("未使用模拟", response.json()["detail"])

    def test_reviewed_ai_path_uses_only_exact_clause_text(self):
        obs = self.module.store.put(fixture(), {"synthetic": True})
        clause = {"id": "UNIT-TEST-ONLY", "text_zh": "合成条款，仅软件测试。"}
        with patch.object(self.module.kb, "protocol_reviewed", return_value=True), patch.object(self.module.kb, "approved", return_value=[clause]), \
             patch.object(self.module.kb, "retrieve", return_value=([clause], "matched")), \
             patch.object(self.module.kb, "citation", return_value={"id": clause["id"], "quote": "Synthetic unit test evidence."}), \
             patch("backend.aic.router.select_advice", new_callable=AsyncMock, return_value=([clause["id"]], {"mode": "ai_evidence_selection", "reason": None, "model": "test-only"})):
            result = self.call({"observation_id": obs["id"], "use_ai": True}).json()
        self.assertEqual(result["advice"][0]["text"], clause["text_zh"])
        self.assertEqual(result["advice"][0]["citation_id"], result["citations"][0]["id"])

    def test_protocol_gate_prevents_model_even_with_clause(self):
        clause = {"id": "UNIT-TEST-ONLY", "text_zh": "test"}
        with patch.object(self.module.kb, "protocol_reviewed", return_value=False), \
             patch.object(self.module.kb, "retrieve", return_value=([clause], "matched")), \
             patch("backend.aic.router.select_advice", new_callable=AsyncMock) as model:
            result = self.call({"use_ai": True}).json()
        model.assert_not_called()
        self.assertEqual(result["advice"], [])

    def test_raw_snapshot_roundtrip(self):
        raw = {"temperature": 32.2, "humidity": 70, "synthetic": True}
        obs = self.module.store.put(fixture(), raw)
        result = self.client.get("/api/weather/aic/observations/" + obs["id"]).json()
        self.assertEqual(result["raw_response"], raw)
        self.assertEqual(result["observation"]["raw_sha256"], digest(raw))


if __name__ == "__main__":
    unittest.main()
