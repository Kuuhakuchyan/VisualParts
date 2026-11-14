"""Grounding and release gates for generated area and building judgements."""
import copy
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from backend.aic.decision import prepare_context, fallback_analysis, validate_analysis, public_analysis, background_records
from backend.aic.generation import select_regional
from backend.aic.test_regional import observation
from backend.aic.regional import RegionalRequest, sample_region, cohort_context, cohort_assessment, regional_facts


class DecisionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.body = RegionalRequest(bounds={"west":113.530,"east":113.533,"south":34.815,"north":34.818},
                                    mode="history", groups=["students", "workers", "older_adults"], use_ai=False)
        self.weather = AsyncMock(); self.weather.get.return_value = observation(temperature_c=35,relative_humidity_pct=65)
        self.sampled = await sample_region(self.weather, self.body)
        self.cohorts = []
        for group in self.body.groups:
            context = cohort_context(self.body, group, self.sampled["environment"])
            self.cohorts.append({"id":group,"context":context,"attention_factors":cohort_assessment(context,self.sampled["environment"],self.sampled["coverage"])["factors"],
                                 "medical_advice":[],"retrieval_status":"protocol_review_pending"})
        self.facts, self.actions = regional_facts(self.sampled,self.body)
        self.context = prepare_context(self.sampled,self.cohorts)
        self.value = fallback_analysis(self.context,self.facts,self.actions)

    async def test_baseline_has_distinct_intensity_and_contextual_priority(self):
        validate_analysis(self.value,self.context,self.facts,self.actions)
        result = public_analysis(self.value,self.context,"rules_fallback")
        self.assertFalse(result["clinical_diagnosis"])
        self.assertEqual(result["risk_intensity"]["environment_code"], self.sampled["environment"]["risk"])
        self.assertNotIn("risk_score",result)

    async def test_no_reviewed_medical_advice_cannot_be_invented(self):
        self.value["cohorts"][0]["medical_advice_ids"] = ["invented-treatment"]
        with self.assertRaises(ValueError): validate_analysis(self.value,self.context,self.facts,self.actions)

    async def test_model_cannot_lower_high_environment_priority(self):
        self.value["cohorts"][0]["priority"] = "routine_review"
        with self.assertRaises(ValueError): validate_analysis(self.value,self.context,self.facts,self.actions)

    async def test_missing_observations_are_not_low_risk(self):
        self.sampled["coverage"]["complete"] = False
        context = prepare_context(self.sampled,self.cohorts)
        self.assertTrue(all(c["allowed_priorities"] == ["priority_review"] for c in context["cohorts"]))
        self.sampled["coverage"]["usable_samples"] = 0
        context = prepare_context(self.sampled,self.cohorts)
        self.assertTrue(all(c["allowed_priorities"] == ["insufficient_evidence"] for c in context["cohorts"]))

    async def test_invented_numbers_clinical_claims_or_treatment_are_rejected(self):
        for text in ["区域风险强度为九十分且患病概率百分之八十。", "当前区域气温下降了5度，可放心开展活动。", "该人群已经诊断为热射病，需接受治疗。", "建议所有人立即口服药物并进行注射。"]:
            value=copy.deepcopy(self.value);value["overview"]["text"]=text
            with self.subTest(text=text),self.assertRaises(ValueError):validate_analysis(value,self.context,self.facts,self.actions)

    async def test_health_concerns_need_applicable_professional_background(self):
        self.value["cohorts"][0]["health_concern_ids"] = ["heat_related_illness"]
        with self.assertRaises(ValueError): validate_analysis(self.value,self.context,self.facts,self.actions)
        self.value["cohorts"][0]["reasoning"]["knowledge_ids"] = ["BG-HEAT"]
        validate_analysis(self.value,self.context,self.facts,self.actions)

    async def test_professional_background_is_not_marked_as_doctor_approval(self):
        records = background_records()
        self.assertGreaterEqual(len(records),4)
        self.assertTrue(all(r["source_sha256"] and r["review_status"] == "public_source_background_not_clinical_approval" for r in records))

    async def test_unknown_references_and_duplicate_groups_are_rejected(self):
        self.value["overview"]["fact_ids"] = ["missing"]
        with self.assertRaises(ValueError):validate_analysis(self.value,self.context,self.facts,self.actions)
        self.value=fallback_analysis(self.context,self.facts,self.actions)
        self.value["cohorts"][1]=copy.deepcopy(self.value["cohorts"][0])
        with self.assertRaises(ValueError):validate_analysis(self.value,self.context,self.facts,self.actions)

    async def test_low_temperature_with_high_radiation_is_not_low_priority(self):
        self.sampled["environment"]["risk"]="below_range"
        s={"proposed_utci_c":43,"proposed_stress":"很强热应激","comparable_cells":5,"added_buildings":1,"removed_buildings":0,"delta_utci_c":1,"strong_heat_area_change_pp":3}
        context=prepare_context(self.sampled,self.cohorts,{"summary":s})
        self.assertTrue(all(c["allowed_priorities"]==["priority_review"] for c in context["cohorts"]))

    async def test_worsening_layout_cannot_be_recommended_as_improvement(self):
        s={"proposed_utci_c":43,"proposed_stress":"很强热应激","comparable_cells":5,"added_buildings":1,"removed_buildings":0,"delta_utci_c":1,"strong_heat_area_change_pp":3}
        self.facts += [{"id":"LAYOUT-RESULT"},{"id":"LAYOUT-LIMIT"}]
        context=prepare_context(self.sampled,self.cohorts,{"summary":s})
        value=fallback_analysis(context,self.facts,self.actions)
        validate_analysis(value,context,self.facts,self.actions)
        value["building"]["verdict"]="candidate_for_validation"
        with self.assertRaises(ValueError):validate_analysis(value,context,self.facts,self.actions)

    async def test_no_layout_no_building_conclusion(self):
        self.value["building"]={"verdict":"no_change"}
        with self.assertRaises(ValueError):validate_analysis(self.value,self.context,self.facts,self.actions)

    async def test_no_clinical_gate_bypass_via_extra_fields(self):
        self.value["diagnosis"]="invented"
        with self.assertRaises(ValueError):validate_analysis(self.value,self.context,self.facts,self.actions)

    async def test_schema_failure_diagnostics_do_not_expose_generated_text(self):
        output = {"fact_ids": [self.facts[0]["id"]], "private-generated-content": "not-public"}
        response = httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(output)}}]},
                                  request=httpx.Request("POST", "https://api.deepseek.com/chat/completions"))
        with patch.dict(os.environ, {"AIC_DEEPSEEK_API_KEY": "test-only"}), patch(
                "backend.aic.generation.httpx.AsyncClient.post", new_callable=AsyncMock, return_value=response):
            _, meta = await select_regional(self.facts, self.actions,
                                           [c["context"] for c in self.cohorts], [], decision_context=self.context)
        self.assertEqual(meta["failure_type"], "output_validation")
        self.assertEqual(meta["schema_diagnostics"]["extra_field_count"], 1)
        self.assertIn("decision_analysis", meta["schema_diagnostics"]["missing_fields"])
        self.assertNotIn("private-generated-content", json.dumps(meta))
        self.assertNotIn("not-public", json.dumps(meta))


if __name__ == "__main__": unittest.main()
