"""Synthetic software tests, not health-model or clinical validation."""

import asyncio
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from .generation import select_regional, validate_regional_selection
from .regional import RegionalRequest, sample_region, cohort_context, cohort_assessment, regional_facts
from .store import digest
from .test_aic import fixture

BOUNDS = {"west":113.524, "east":113.536, "south":34.807, "north":34.822}
STAMP=datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def observation(**changes):
    return fixture(**{"id":"obs_"+"0"*64, "location":{"longitude":113.53, "latitude":34.81}, "observed_at":STAMP, **changes})


class RegionalTests(unittest.TestCase):
    def setUp(self):
        self.body = RegionalRequest(bounds=BOUNDS, use_ai=False)
        self.weather = type("Weather", (), {})()
        self.weather.get = AsyncMock(return_value=observation())

    def sample(self):
        return asyncio.run(sample_region(self.weather, self.body))

    def test_bounds_order_and_range(self):
        for bounds in [{**BOUNDS, "east":113.50}, {**BOUNDS, "north":34.7},
                       {**BOUNDS, "east":113.9}, {**BOUNDS, "west":float("nan")},
                       {**BOUNDS, "north":float("inf")}, {**BOUNDS, "south":0}]:
            with self.assertRaises(ValidationError):
                RegionalRequest(bounds=bounds)

    def test_identity_unknown_group_and_empty_group_rejected(self):
        for extra in [{"name":"someone"}, {"groups":[]}, {"groups":["unknown"]},
                      {"symptoms":["headache"]}, {"exposure_minutes":0}]:
            with self.assertRaises(ValidationError):
                RegionalRequest(bounds=BOUNDS, **extra)

    def test_samples_are_five_requests_not_five_independent_grids(self):
        result = self.sample()
        self.assertEqual(result["coverage"]["usable_samples"],5)
        self.assertEqual(result["coverage"]["unique_model_grids"],1)
        self.assertFalse(result["coverage"]["spatial_comparison_supported"])
        self.assertEqual(self.weather.get.call_count,5)
        self.assertNotEqual(result["samples"][0]["requested"], result["samples"][1]["requested"])

    def test_missing_sample_is_partial_and_requires_gap_check(self):
        self.weather.get.side_effect = [observation(),httpx.ConnectError("synthetic"),observation(),observation(),observation()]
        result = self.sample()
        self.assertEqual(result["coverage"]["status"],"partial")
        _,actions=regional_facts(result,self.body)
        self.assertIn("DATA-GAP",[a["id"] for a in actions])

    def test_all_missing_has_no_fallback_temperature(self):
        self.weather.get.side_effect=httpx.ConnectError("synthetic")
        result=self.sample()
        self.assertEqual(result["environment"]["risk"],"unavailable")
        self.assertEqual(result["coverage"]["usable_samples"],0)
        self.assertIsNone(result["representative_sample_id"])

    def test_mismatched_timestamps_block_spatial_summary(self):
        later=observation(observed_at=(datetime.now(timezone.utc)-timedelta(minutes=60)).isoformat())
        self.weather.get.side_effect=[observation(),later,observation(),observation(),observation()]
        result=self.sample()
        self.assertEqual(result["coverage"]["status"],"time_mismatch")
        self.assertEqual(result["environment"]["risk"],"unavailable")

    def test_stale_and_simulated_excluded(self):
        for bad in [observation(source_type="simulated_test"),observation(observed_at="2020-01-01T00:00:00+08:00")]:
            self.weather.get.return_value=bad
            self.assertEqual(self.sample()["coverage"]["usable_samples"],0)

    def test_environment_uses_highest_valid_level_not_average(self):
        stamp=datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        self.weather.get.side_effect=[observation(temperature_c=t,observed_at=stamp) for t in [28,30,32.2,29,28]]
        result=self.sample()
        self.assertEqual(result["representative_sample_id"],"sample-3")
        self.assertEqual(result["environment"]["risk"],"danger")

    def test_history_label_and_not_current_action(self):
        self.body.mode="history"
        self.weather.get.return_value=observation(source_type="historical_weather",observed_at="2024-06-12T14:00:00+08:00")
        result=self.sample()
        self.assertEqual(result["case_type"],"historical_reanalysis")
        self.assertTrue(result["coverage"]["complete"])
        self.assertIn("HISTORY",[a["id"] for a in regional_facts(result,self.body)[1]])

    def test_cohort_override_not_automatic_stereotype(self):
        self.body.cohort_scenarios=RegionalRequest(bounds=BOUNDS,cohort_scenarios={"athletes":{"activity":"run","exposure_minutes":90}}).cohort_scenarios
        env=self.sample()["environment"]
        student=cohort_context(self.body,"students",env)
        athlete=cohort_context(self.body,"athletes",env)
        self.assertEqual(student["activity"],"walk")
        self.assertEqual(athlete["activity"],"run")
        self.assertEqual(athlete["minutes"],90)
        self.assertEqual(athlete["exposure"], "unknown")
        self.assertNotIn("阴凉", athlete["query"])
        factors=cohort_assessment(athlete,env,{"complete":True})["factors"]
        self.assertIn("exertion",[f["code"] for f in factors])
        self.assertNotIn("probability",cohort_assessment(athlete,env,{"complete":True}))

    def test_cool_environment_is_not_personal_safety(self):
        self.weather.get.return_value=observation(temperature_c=20)
        result=self.sample()
        c=cohort_assessment(cohort_context(self.body,"older_adults",result["environment"]),result["environment"],result["coverage"])
        self.assertIn("仍需核查",c["label"])
        self.assertIn("susceptibility",[f["code"] for f in c["factors"]])


class RegionalModelTests(unittest.TestCase):
    facts=[{"id":"ENVIRONMENT"},{"id":"COVERAGE"}]
    actions=[{"id":"VERIFY"},{"id":"DATA-GAP"},{"id":"HISTORY"}]
    contexts=[{"group":"students"}]

    def test_rejects_extra_fields_and_unknown_ids(self):
        valid={"fact_ids":["ENVIRONMENT"],"action_ids":["VERIFY"],"group_order":["students"]}
        for value in [{**valid,"diagnosis":"invented"},{**valid,"fact_ids":["unknown"]},
                      {**valid,"group_order":[]},{**valid,"group_order":["students","students"]}]:
            with self.assertRaises(ValueError):
                validate_regional_selection(json.dumps(value),self.facts,self.actions,["students"])

    def test_missing_key_is_explicit_fallback(self):
        with patch.dict(os.environ,{"AIC_DEEPSEEK_API_KEY":""}):
            _,meta=asyncio.run(select_regional(self.facts,self.actions,self.contexts,[]))
        self.assertEqual(meta["reason"],"model_not_configured")

    def test_model_timeout_does_not_expose_error(self):
        with patch.dict(os.environ,{"AIC_DEEPSEEK_API_KEY":"synthetic-only"}), patch("backend.aic.generation.httpx.AsyncClient.post",side_effect=httpx.ReadTimeout("not-public")):
            value,meta=asyncio.run(select_regional(self.facts,self.actions,self.contexts,[]))
        self.assertEqual(meta["mode"],"rules_fallback")
        self.assertNotIn("not-public",json.dumps(meta))
        self.assertIn("DATA-GAP",value["action_ids"])

    def test_valid_model_retains_mandatory_safety_checks(self):
        response=httpx.Response(200,json={"choices":[{"message":{"content":json.dumps({"fact_ids":["ENVIRONMENT"],"action_ids":["VERIFY"],"group_order":["students"]})}}]},request=httpx.Request("POST","https://api.deepseek.com/chat/completions"))
        with patch.dict(os.environ,{"AIC_DEEPSEEK_API_KEY":"synthetic-only"}), patch("backend.aic.generation.httpx.AsyncClient.post",new_callable=AsyncMock,return_value=response):
            value,meta=asyncio.run(select_regional(self.facts,self.actions,self.contexts,[]))
        self.assertEqual(meta["mode"],"ai_regional_evidence_selection")
        self.assertIn("COVERAGE",value["fact_ids"])
        self.assertIn("DATA-GAP",value["action_ids"])
        self.assertIn("HISTORY",value["action_ids"])


class RegionalApiTests(unittest.TestCase):
    def setUp(self):
        from . import router as module
        self.module=module
        module._ai_budget.clear()
        app=FastAPI();app.include_router(module.router)
        self.client=TestClient(app)
        self.addCleanup(self.client.close)
        self.body={"bounds":BOUNDS,"use_ai":False}

    def test_api_report_hash_cohorts_no_unreviewed_advice(self):
        with patch.object(self.module.weather,"get",new_callable=AsyncMock,return_value=observation()),patch.object(self.module.kb,"protocol_reviewed",return_value=False):
            response=self.client.post("/api/weather/aic/regional-assess",json=self.body)
        self.assertEqual(response.status_code,200)
        result=response.json();checksum=result.pop("report_sha256")
        self.assertEqual(checksum,digest(result))
        self.assertEqual(len(result["cohorts"]),3)
        self.assertTrue(all(not c["medical_advice"] for c in result["cohorts"]))
        self.assertEqual(result["project"],"微境探界")

    def test_api_bad_bounds_and_identity_do_not_sample(self):
        with patch.object(self.module.weather,"get",new_callable=AsyncMock) as get:
            for body in [{**self.body,"school":"private"},{**self.body,"bounds":{**BOUNDS,"east":113.4}}]:
                self.assertEqual(self.client.post("/api/weather/aic/regional-assess",json=body).status_code,422)
        get.assert_not_called()

    def test_api_upstream_failure_has_traceable_unavailable_report(self):
        with patch.object(self.module.weather,"get",side_effect=httpx.ConnectError("synthetic")):
            result=self.client.post("/api/weather/aic/regional-assess",json={**self.body,"use_ai":True}).json()
        self.assertEqual(result["generation"]["reason"],"environment_unavailable")
        self.assertEqual(result["coverage"]["usable_samples"],0)
        self.assertTrue(all(s["observation"] is None for s in result["samples"]))
