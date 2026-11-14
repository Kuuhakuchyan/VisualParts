"""Published prevention remains usable without inventing clinical approval."""
import copy
import unittest

from backend.aic.prevention import activity_plan, public_guidance
from backend.aic.decision import prepare_context, fallback_analysis, validate_analysis


class PreventionTests(unittest.TestCase):
    def context(self, group="students", activity="walk", minutes=30):
        return {"group": group, "activity": activity, "minutes": minutes, "exposure": "sun"}

    def plan(self, group="students", activity="walk", minutes=30, risk="danger", usable=4, complete=True, layout=None):
        return activity_plan(self.context(group, activity, minutes), {"risk": risk},
                             {"usable_samples": usable, "complete": complete}, layout)

    def test_guidelines_have_original_quotes_and_provenance_without_clinical_approval(self):
        records = public_guidance()
        self.assertEqual(len(records), 3)
        self.assertTrue(all(r["quote"] and r["url"].startswith("https://www.who.int/") and r["source_sha256"] for r in records))
        self.assertTrue(all(r["review_status"] == "published_public_prevention_not_clinical_approval" for r in records))

    def test_high_heat_produces_distinct_concrete_plans(self):
        plans = [self.plan(), self.plan("athletes", "run", 60), self.plan("workers", "work", 120)]
        self.assertEqual(len({p["summary"] for p in plans}), 3)
        self.assertTrue(all(p["status"] == "reschedule" and len(p["actions"]) >= 2 and p["guidance"] for p in plans))
        self.assertIn("室内", plans[1]["summary"])
        self.assertIn("工序", plans[2]["summary"])

    def test_cool_weather_does_not_recommend_heat_related_cancellation(self):
        plan = self.plan("athletes", "run", 60, risk="below_range")
        self.assertEqual(plan["status"], "routine")
        self.assertIn("按设定", plan["summary"])
        self.assertFalse(plan["guidance"])

    def test_radiant_heat_can_override_cool_air_plan(self):
        plan = self.plan(risk="below_range", layout={"summary": {"proposed_utci_c": 43}})
        self.assertEqual(plan["status"], "reschedule")

    def test_missing_weather_is_not_a_safe_or_action_free_result(self):
        plan = self.plan(risk="unavailable", usable=0, complete=False)
        self.assertEqual(plan["status"], "weather_required")
        self.assertTrue(plan["actions"])
        self.assertFalse(plan["guidance"])

    def test_partial_observations_do_not_hide_known_high_heat(self):
        plan = self.plan(complete=False)
        self.assertEqual(plan["status"], "reschedule")
        self.assertIn("部分区域缺测", plan["factors"])

    def test_activity_and_duration_come_from_input_not_group_label(self):
        plan = self.plan("athletes", "rest", 10)
        self.assertEqual(plan["activity"], "rest")
        self.assertNotIn("运动或劳动增加产热", plan["factors"])
        self.assertNotIn("WHO-CLOTHING", {g["id"] for g in plan["guidance"]})

    def test_fallback_is_actionable_and_model_cannot_cross_groups_or_omit_actions(self):
        groups = []
        actions = [{"id": "VERIFY", "text": "核实数据"}]
        for group, activity in [("students", "walk"), ("workers", "work")]:
            c = self.context(group, activity, 90)
            plan = self.plan(group, activity, 90)
            actions.extend(plan["actions"])
            groups.append({"id": group, "context": c, "activity_plan": plan, "attention_factors": [],
                           "medical_advice": [], "retrieval_status": "protocol_review_pending"})
        result = {"environment": {"risk": "danger", "risk_label": "危险", "heat_index_c": 42},
                  "coverage": {"usable_samples": 4, "complete": True}, "case_type": "historical_reanalysis"}
        context = prepare_context(result, groups)
        facts = [{"id": "ENVIRONMENT"}]
        value = fallback_analysis(context, facts, actions)
        validate_analysis(value, context, facts, actions)
        self.assertNotIn("尚不能", value["overview"]["text"])
        self.assertTrue(all(c["management_action_ids"] for c in value["cohorts"]))
        self.assertTrue(all(not c["medical_advice_ids"] for c in value["cohorts"]))
        bad = copy.deepcopy(value)
        bad["cohorts"][0]["management_action_ids"] = ["VERIFY"]
        with self.assertRaisesRegex(ValueError, "missing actionable plan"):
            validate_analysis(bad, context, facts, actions)
        bad["cohorts"][0]["management_action_ids"] = [groups[1]["activity_plan"]["actions"][0]["id"]]
        with self.assertRaises(ValueError):
            validate_analysis(bad, context, facts, actions)


if __name__ == "__main__":
    unittest.main()
