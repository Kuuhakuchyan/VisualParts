"""Read/compute acceptance of concrete cohort plans with real public AI calls."""
import json
from pathlib import Path

import httpx

from backend.aic.store import digest

checks, records = [], []


def check(value, label):
    assert value, label
    checks.append(label)


payload = dict(area_kind="campus", mode="history", data_mode="lcz_simulation", grid_resolution_m=100,
               bounds=dict(west=113.530, east=113.533, south=34.815, north=34.818),
               groups=["students", "athletes", "workers", "older_adults"], activity="walk",
               exposure_minutes=30, exposure="sun", use_ai=True,
               cohort_scenarios={"athletes": dict(activity="run", exposure_minutes=60),
                                 "workers": dict(activity="work", exposure_minutes=120)})
with httpx.Client(timeout=100, trust_env=False) as client:
    for label, origin, mode, ai in [
        ("historical_ai", "https://aic.nogamenolife.cn", "history", True),
        ("current_ai", "https://weather.nogamenolife.cn", "current", True),
        ("historical_rules", "https://aic.nogamenolife.cn", "history", False),
    ]:
        report = client.post(origin + "/api/weather/aic/regional-assess",
                             json={**payload, "mode": mode, "use_ai": ai}).raise_for_status().json()
        records.append(dict(case=label, report=report))
        Path("output/playwright/actionable-" + label + ".json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        analysis = report["decision_analysis"]
        check(analysis["mode"] == ("ai_grounded_decision" if ai else "rules_fallback"), label + " actual generation mode: " + str(report["generation"]))
        check(report["report_sha256"] == digest({k: v for k, v in report.items() if k != "report_sha256"}), label + " report digest includes plans and AI")
        by_group = {c["id"]: c for c in report["cohorts"]}
        check(set(by_group) == set(payload["groups"]), label + " all groups covered")
        for group, cohort in by_group.items():
            plan, judgement = cohort["activity_plan"], cohort["ai_judgement"]
            expected = payload["cohort_scenarios"].get(group, dict(activity="walk", exposure_minutes=30))
            check(plan["activity"] == expected["activity"] and plan["minutes"] == expected["exposure_minutes"], label + " actual scenario " + group)
            check(bool(set(judgement["management_action_ids"]) & {a["id"] for a in plan["actions"]}), label + " concrete plan selected " + group)
            check(len(judgement["reasoning"]["text"]) <= 160, label + " concise explanation " + group)
            check(not cohort["medical_advice"] and not judgement["medical_advice_ids"], label + " no invented clinical approval " + group)
        if mode == "history":
            check(report["environment"]["risk"] in {"danger", "extreme_danger"}, label + " high heat case")
            check(by_group["athletes"]["activity_plan"]["status"] == "reschedule", label + " sport rescheduled")
            check("室内" in by_group["athletes"]["activity_plan"]["summary"], label + " indoor alternative")
            check("工序" in by_group["workers"]["activity_plan"]["summary"], label + " work-specific action")
            check(all(c["activity_plan"]["guidance"] for c in by_group.values()), label + " prevention sources attached")
        elif report["environment"]["risk"] == "below_range":
            check(all(c["activity_plan"]["status"] == "routine" for c in by_group.values()), label + " cool weather retains routine plan")
        print(json.dumps(dict(case=label, generation=report["generation"], environment=report["environment"],
                              overview=analysis["overview"]["text"], cohorts=[dict(group=c["id"], plan=c["activity_plan"]["summary"],
                              explanation=c["ai_judgement"]["reasoning"]["text"]) for c in report["cohorts"]]), ensure_ascii=False), flush=True)

Path("output/playwright/actionable-public-checks.json").write_text(json.dumps(dict(checks=checks), ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(dict(passed=len(checks), checks=checks), ensure_ascii=False))
