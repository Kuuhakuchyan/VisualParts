"""Cloud orchestration contracts; mock APIs are software tests, not model accuracy."""

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

from backend import hybrid, sandbox
from backend.aic import router as aic
from backend.aic.store import digest
from backend.temporal import ForecastInput
from backend.test_sandbox import body, boundary


def station_window():
    start = datetime(2026, 7, 1, 12, tzinfo=timezone(timedelta(hours=8)))
    return ForecastInput(station_id="private-station-identifier", observations=[
        {"time": start+timedelta(minutes=5*i), "temperature_c": 30+i*.1,
         "humidity_pct": 60-i*.2, "pressure_hpa": 1002, "wind_mps": 2} for i in range(7)])


def call(name, snapshot, call_id="call-compute", arguments=None):
    return {"id": call_id, "type": "function", "function": {"name": name,
            "arguments": json.dumps(arguments if arguments is not None else {"snapshot_sha256": snapshot})}}


def reply(message):
    return httpx.Response(200, json={"choices": [{"message": message}]},
                          request=httpx.Request("POST", "https://api.deepseek.com/chat/completions"))


class ToolValidationTests(unittest.TestCase):
    def test_schema_has_no_arbitrary_code_or_scene_edits(self):
        tools = hybrid.tools_schema("a"*64, False)
        self.assertEqual([t["function"]["name"] for t in tools], ["recompute_current_scene"])
        self.assertFalse(tools[0]["function"]["parameters"]["additionalProperties"])

    def test_unknown_duplicate_missing_and_replayed_calls_rejected(self):
        sha = "a"*64
        samples = [[], [call("shell", sha)], [call("predict_station_forecast", sha)],
                   [call("recompute_current_scene", "b"*64)],
                   [call("recompute_current_scene", sha), call("recompute_current_scene", sha, "other")],
                   [call("recompute_current_scene", sha, arguments={"snapshot_sha256": sha, "temperature_c": 10})]]
        for calls in samples:
            with self.subTest(calls=calls), self.assertRaises(ValueError):
                hybrid.validate_calls({"tool_calls": calls}, sha, False)

    def test_station_window_requires_both_declared_tools(self):
        sha = "a"*64
        calls = [call("recompute_current_scene", sha), call("predict_station_forecast", sha, "forecast")]
        self.assertEqual(len(hybrid.validate_calls({"tool_calls": calls}, sha, True)), 2)
        with self.assertRaises(ValueError):
            hybrid.validate_calls({"tool_calls": calls[:1]}, sha, True)

    def test_invalid_station_cadence_rejected_before_cloud(self):
        window = station_window().model_dump()
        window["observations"][1]["time"] += timedelta(minutes=1)
        with self.assertRaises(ValidationError):
            sandbox.CollaborationInput.model_validate({**body().model_dump(), "station_window": window})


class HybridTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.input = body().model_dump()
        self.result = sandbox.simulate(body(), boundary())
        self.calculate = AsyncMock(return_value=self.result)

    async def test_missing_key_still_computes_once(self):
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": ""}):
            result, trace, messages = await hybrid.run_tools(self.input, self.calculate)
        self.calculate.assert_awaited_once()
        self.assertIs(result, self.result)
        self.assertEqual(trace["planner"]["reason"], "model_not_configured")
        self.assertEqual(trace["tools"][0]["trigger"], "deterministic_fallback")
        self.assertEqual(messages, [])

    async def test_timeout_fallback_hides_remote_error(self):
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "test-only"}), patch.object(httpx.AsyncClient, "post", side_effect=httpx.ReadTimeout("private-debug")):
            _, trace, _ = await hybrid.run_tools(self.input, self.calculate)
        self.calculate.assert_awaited_once()
        self.assertNotIn("private-debug", json.dumps(trace))
        self.assertEqual(trace["planner"]["status"], "rejected")

    async def test_cloud_tool_executes_exact_snapshot_and_returns_evidence(self):
        calls = [call("recompute_current_scene", digest(self.input))]
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "test-only"}), patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock, return_value=reply({"tool_calls": calls})) as post:
            _, trace, messages = await hybrid.run_tools(self.input, self.calculate)
        self.calculate.assert_awaited_once()
        self.assertEqual(trace["planner"]["status"], "accepted")
        self.assertEqual(trace["numerical_sha256"], hybrid.numerical_digest(self.result))
        output = json.loads(messages[-1]["content"])
        self.assertEqual(output["summary"], self.result["summary"])
        self.assertIsNone(output["summary"]["air_temperature_delta_c"])
        outbound = json.dumps(post.call_args.kwargs["json"])
        self.assertNotIn("longitude", outbound)
        self.assertNotIn("latitude", outbound)
        self.assertNotIn('"name": "test"', outbound)

    async def test_local_trained_model_runs_without_cloud_and_keeps_boundary(self):
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": ""}):
            _, trace, _ = await hybrid.run_tools(self.input, self.calculate, station_window())
        self.assertEqual(trace["station_status"], "predicted")
        self.assertEqual(trace["station_forecast"]["horizon_minutes"], 15)
        self.assertEqual(self.result["weather_boundary"]["temperature_c"], 32)

    async def test_station_identifier_and_raw_window_are_not_sent(self):
        sha = digest(self.input)
        calls = [call("recompute_current_scene", sha), call("predict_station_forecast", sha, "forecast")]
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "test-only"}), patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock, return_value=reply({"tool_calls": calls})) as post:
            _, trace, messages = await hybrid.run_tools(self.input, self.calculate, station_window())
        outbound = json.dumps(post.call_args.kwargs["json"])+json.dumps(messages)
        self.assertNotIn("private-station-identifier", outbound)
        self.assertNotIn('"pressure_hpa"', outbound)
        self.assertEqual(trace["station_status"], "predicted")

    async def test_rejected_tools_never_run_arbitrary_work(self):
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "test-only"}), patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock, return_value=reply({"tool_calls": [call("shell", digest(self.input))]})):
            _, trace, messages = await hybrid.run_tools(self.input, self.calculate)
        self.calculate.assert_awaited_once()
        self.assertEqual(trace["tools"][0]["name"], "recompute_current_scene")
        self.assertEqual(messages, [])


class HybridAPITests(unittest.TestCase):
    def setUp(self):
        app = FastAPI(); app.include_router(sandbox.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        aic._ai_budget.clear()

    def test_fallback_result_and_nested_report_have_valid_digests(self):
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": ""}), patch.object(sandbox, "boundary_weather", new_callable=AsyncMock, return_value=boundary()):
            response = self.client.post("/api/weather/sandbox/collaborate", json=body().model_dump())
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["orchestration"]["mode"], "local_models_with_fallback")
        self.assertEqual(result["orchestration"], result["regional_report"]["orchestration"])
        checksum = result.pop("report_sha256"); self.assertEqual(checksum, digest(result))
        nested = result["regional_report"]; checksum = nested.pop("report_sha256")
        self.assertEqual(checksum, digest(nested))

    def test_real_protocol_two_rounds_and_shared_ai_budget(self):
        request_body = body().model_dump(); request_body["regional"]["use_ai"] = True
        captured = []

        async def remote(_url, **kwargs):
            payload = kwargs["json"]; captured.append(payload)
            if "tools" in payload:
                sha = json.loads(payload["messages"][-1]["content"])["snapshot_sha256"]
                return reply({"tool_calls": [call("recompute_current_scene", sha)]})
            evidence = json.loads(payload["messages"][-1]["content"])
            from backend.aic.decision import fallback_analysis
            return reply({"content": json.dumps({"fact_ids": [evidence["facts"][0]["id"]],
                         "action_ids": [evidence["management_checks"][0]["id"]],
                         "group_order": [x["group"] for x in evidence["cohort_contexts"]],
                         "decision_analysis": fallback_analysis(evidence["decision_context"], evidence["facts"], evidence["management_checks"])})})

        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "test-only"}), patch.object(sandbox, "boundary_weather", new_callable=AsyncMock, return_value=boundary()), patch.object(httpx.AsyncClient, "post", side_effect=remote):
            response = self.client.post("/api/weather/sandbox/collaborate", json=request_body)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["orchestration"]["mode"], "deepseek_tools_local_models")
        self.assertEqual(len(captured), 2)
        self.assertTrue(any(m["role"] == "tool" for m in captured[1]["messages"]))
        self.assertEqual(len(aic._ai_budget), 1)
        self.assertEqual(result["orchestration"]["numerical_sha256"], hybrid.numerical_digest(result))

    def test_budget_exhaustion_does_not_call_cloud(self):
        request_body = body().model_dump(); request_body["regional"]["use_ai"] = True
        for _ in range(6): self.assertTrue(aic.take_ai_budget())
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "test-only"}), patch.object(sandbox, "boundary_weather", new_callable=AsyncMock, return_value=boundary()), patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as post:
            response = self.client.post("/api/weather/sandbox/collaborate", json=request_body)
        self.assertEqual(response.status_code, 200)
        post.assert_not_awaited()
        self.assertEqual(response.json()["regional_report"]["generation"]["reason"], "model_budget_limit")


if __name__ == "__main__":
    unittest.main()
