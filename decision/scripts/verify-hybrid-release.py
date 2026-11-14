"""Verify actual cloud tool calls and matching local numerical results."""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from shapely.geometry import box, shape

from backend.aic.store import digest
from backend.hybrid import numerical_digest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://weather.nogamenolife.cn")
    parser.add_argument("--local-key-stdin", action="store_true")
    args = parser.parse_args()
    if args.local_key_stdin:
        os.environ["AIC_DEEPSEEK_API_KEY"] = sys.stdin.readline().strip()
        assert os.environ["AIC_DEEPSEEK_API_KEY"], "missing local key"
        from fastapi.testclient import TestClient
        from backend.main import app
        from backend.aic import generation
        original_validator = generation.validate_analysis

        def audit_validator(value, *validator_args):
            try:
                return original_validator(value, *validator_args)
            except ValueError as error:
                Path("output/playwright/decision-rejected-local.json").write_text(
                    json.dumps({"validation_error": str(error), "output": value}, ensure_ascii=False, indent=2), encoding="utf-8")
                print("Decision validator: " + str(error), file=sys.stderr)
                raise

        generation.validate_analysis = audit_validator
        client = TestClient(app, base_url="http://localhost")
    else:
        client = httpx.Client(base_url=args.base, timeout=115)
    checks = []

    def check(value, name):
        assert value, name
        checks.append(name)

    def save_response(name, value):
        scope = "local" if args.local_key_stdin else "public"
        Path(f"output/playwright/decision-response-{scope}-{name}.json").write_text(
            json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

    regional = {"area_kind": "campus", "mode": "history", "data_mode": "lcz_simulation", "grid_resolution_m": 30,
                "groups": ["students", "workers"], "activity": "walk", "exposure_minutes": 30, "use_ai": True,
                "bounds": {"west": 113.528, "east": 113.532, "south": 34.816, "north": 34.820}}
    payload = {"scene": {"name": "collaboration-acceptance", "additions": [], "removed_ids": []},
               "regional": regional, "resolution_m": 50}
    with client:
        result = client.post("/api/weather/sandbox/collaborate", json=payload).raise_for_status().json()
        save_response("baseline", result)
        trace = result["orchestration"]
        check(trace["planner"]["status"] == "accepted", "actual DeepSeek planner accepted")
        check(trace["mode"] == "deepseek_tools_local_models", "tool call and evidence roundtrip completed")
        check(trace["tools"][0]["trigger"] == "deepseek", "local calculation dispatched by cloud tool call")
        check(trace["numerical_sha256"] == numerical_digest(result), "tool numerical digest matches returned map")
        check(trace == result["regional_report"]["orchestration"], "report contains identical workflow")
        check(trace["station_status"] == "no_eligible_window", "missing station history is not fabricated")
        check(result["summary"]["air_temperature_delta_c"] is None, "unsupported spatial air delta stays absent")
        check(result["report_sha256"] == digest({k: v for k, v in result.items() if k != "report_sha256"}), "outer report digest valid")
        nested = result["regional_report"]
        check(nested["report_sha256"] == digest({k: v for k, v in nested.items() if k != "report_sha256"}), "nested report digest valid")
        analysis = nested["decision_analysis"]
        check(analysis["mode"] == "ai_grounded_decision", "DeepSeek generated substantive decision analysis")
        check(len(analysis["overview"]["text"]) >= 8, "generated overview explains regional evidence")
        check({c["group"] for c in analysis["cohorts"]} == set(regional["groups"]), "AI produces separate cohort judgements")
        check(all(c["reasoning"]["fact_ids"] for c in analysis["cohorts"]), "all generated cohort reasons cite facts")
        check(analysis["building"]["verdict"] == "no_change", "AI does not invent a building intervention")
        check(analysis["clinical_diagnosis"] is False, "area judgement is not a clinical disease diagnosis")
        check(all(not c["medical_advice_ids"] for c in analysis["cohorts"]), "simulation cannot release medical treatment advice")
        check(all(k["source_sha256"] for k in analysis["knowledge"]), "professional background keeps source snapshots")
        # Clearly marked synthetic input tests routing into the trained model, not station provenance or accuracy.
        start = datetime(2026, 7, 1, 12, tzinfo=timezone(timedelta(hours=8)))
        window = {"station_id": "qa-synthetic-not-telemetry", "observations": [
            {"time": (start+timedelta(minutes=5*i)).isoformat(), "temperature_c": 30+i*.1,
             "humidity_pct": 60-i*.2, "pressure_hpa": 1002, "wind_mps": 2} for i in range(7)]}
        second = client.post("/api/weather/sandbox/collaborate", json={**payload, "station_window": window}).raise_for_status().json()
        save_response("forecast", second)
        w = second["orchestration"]
        check(w["mode"] == "deepseek_tools_local_models", "cloud and local forecast chain completed")
        check({t["name"] for t in w["tools"] if t["trigger"] == "deepseek" and t["status"] == "completed"}
              == {"recompute_current_scene", "predict_station_forecast"}, "both local tools selected and executed")
        check(w["station_status"] == "predicted", "trained station inference executed")
        check(w["station_forecast"]["med_eligible"] is False, "test forecast cannot become medical evidence")
        check(second["weather_boundary"] == result["weather_boundary"], "station forecast cannot rewrite scenario boundary")
        check(second["summary"] == result["summary"], "cloud cannot invent changes to fixed scene")
        features = client.get("/api/weather/sandbox/buildings").raise_for_status().json()["features"]
        b = regional["bounds"]
        region = box(b["west"], b["south"], b["east"], b["north"])
        building = next(f for f in features if region.covers(shape(f["geometry"])))
        changed = client.post("/api/weather/sandbox/collaborate", json={**payload,
            "scene": {"name":"decision-demolition-test", "additions":[], "removed_ids":[building["id"]]}}).raise_for_status().json()
        save_response("demolition", changed)
        plan = changed["regional_report"]["decision_analysis"]
        from backend.aic.decision import prepare_context
        allowed = prepare_context(changed["regional_report"], changed["regional_report"]["cohorts"],
                                  {"summary":changed["summary"]})["layout"]["allowed_verdicts"]
        check(plan["mode"] == "ai_grounded_decision", "DeepSeek generates actual edited-building judgement")
        check(plan["building"]["verdict"] in allowed, "AI building verdict agrees with numerical comparison")
        check("LAYOUT-RESULT" in plan["building"]["reasoning"]["fact_ids"], "building recommendation cites actual scenario computation")
        check(changed["scene_sha256"] != result["scene_sha256"], "edited-building decision uses changed immutable scene")
    print(json.dumps({"checks": checks, "planner": trace["planner"], "mode": trace["mode"],
                      "decision_analysis": analysis,
                      "numerical_sha256": trace["numerical_sha256"], "station_tools": w["tools"],
                      "station_prediction_method": w["station_forecast"]["predicted"],
                      "building_scenario": {"summary":changed["summary"], "judgement":plan["building"]},
                      "station_test_input": "synthetic_protocol_fixture_not_observed_weather"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
