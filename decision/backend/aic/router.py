"""Anonymous API, separate from mock simulation endpoints."""

import asyncio
import os
import time
from collections import deque
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from .generation import select_advice, select_regional
from .regional import GROUPS, REGIONAL_VERSION, RegionalRequest, sample_region, cohort_context, cohort_assessment, regional_facts
from .retrieval import KnowledgeBase
from .risk import RULE_VERSION, SYMPTOMS, assess_environment, build_context, triage
from .store import ObservationStore, digest
from .weather import WeatherEvidence
from .decision import prepare_context, fallback_analysis, public_analysis
from .prevention import activity_plan

router = APIRouter(prefix="/api/weather/aic", tags=["anonymous-heat-risk"])
store = ObservationStore()
weather = WeatherEvidence(store)
kb = KnowledgeBase()


def knowledge_snapshot():
    return kb.snapshot()


_ai_budget = deque()
_regional_slots = asyncio.Semaphore(2)
REGIONAL_SOURCES = [
    {"id": "DATA-CONTRACT", "title": "平台数据与方法契约（内部规则，非外部医学证据）", "publisher": "微境探界", "url": "/api/weather/aic/method"},
    {"id": "USER-SCENARIO", "title": "本报告 input 字段（用户假设，非观测）", "publisher": "用户情景输入", "url": "/api/weather/aic/method"},
]


@router.get("/method")
async def method_contract():
    return {"regional_version": REGIONAL_VERSION, "rules_version": RULE_VERSION,
            "data_contract": "观测保留来源、时间、位置、单位、质量状态和原始记录编号；公开模型网格不得称为校园实测。",
            "scenario_contract": "活动、人群及暴露时间保存在报告 input 中，属于用户假设，不是跟踪测量或疾病诊断。",
            "medical_gate": "仅展示有原文证据且经专业审阅的适用条款；内部规则和用户假设不作为医学证据。"}


def take_ai_budget():
    now = time.monotonic()
    while _ai_budget and _ai_budget[0] < now - 60:
        _ai_budget.popleft()
    if len(_ai_budget) >= 6:
        return False
    _ai_budget.append(now)
    return True


class AssessmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observation_id: str | None = Field(default=None, pattern=r"^obs_[0-9a-f]{64}$")
    activity: Literal["rest", "walk", "run", "work"] = "walk"
    exposure_minutes: int = Field(default=30, ge=1, le=480)
    exposure: Literal["shade", "sun", "unknown"] = "unknown"
    symptoms: list[Literal["confusion", "unconscious", "slurred_speech", "seizure", "fainting", "dizziness", "headache", "nausea", "vomiting", "cramps", "weakness"]] = Field(default_factory=list, max_length=11)
    use_ai: bool = False


@router.get("/status")
async def status(response: Response):
    response.headers["Cache-Control"] = "no-store"
    kb = knowledge_snapshot()
    return {"rules_version": RULE_VERSION, "knowledge_version": kb.data["version"],
            "retrieval": "structured_filter_and_keyword_rank", "vector_rag": False, "knowledge_provenance": kb.provenance(), "knowledge_audit": kb.audit(),
            "approved_clauses": len(kb.approved()), "draft_clauses": len(kb.data["clauses"]),
            "medical_release": "review_pending" if not kb.approved() else "partially_reviewed",
            "protocol_reviewed": kb.protocol_reviewed(),
            "model_configured": bool(os.getenv("AIC_DEEPSEEK_API_KEY")),
            "symptoms": SYMPTOMS, "sources": kb.public_sources(),
            "historical_spatial_rag": "not_validated", "clinical_validation": False,
            "regional_method_version": REGIONAL_VERSION, "population_groups": {k: v[0] for k, v in GROUPS.items()}}


@router.post("/regional-assess")
async def regional_assess(body: RegionalRequest, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await build_regional_report(body)
    except ValueError as error:
        raise HTTPException(422, str(error))
    except httpx.HTTPError:
        raise HTTPException(503, "同刻气象边界暂不可用，未生成模拟替代值。")


async def build_regional_report(body, extra_facts=(), extra_actions=(), sampled_result=None,
                                tool_messages=(), ai_permission=None, ai_denial_reason=None, layout_context=None):
    async with _regional_slots:
        result = sampled_result if sampled_result is not None else await sample_region(weather, body)
        kb = knowledge_snapshot()
        contexts = [cohort_context(body, group, result["environment"]) for group in dict.fromkeys(body.groups)]
        facts, actions = regional_facts(result, body)
        facts.extend(extra_facts)
        actions.extend(extra_actions)
        evidence = [{"id": s["observation"]["id"], "temperature_c": s["observation"]["temperature_c"],
                     "humidity_pct": s["observation"]["relative_humidity_pct"], "observed_at": s["observation"]["observed_at"],
                     "source_type": s["observation"]["source_type"], "environment": s["environment"]} for s in result["samples"] if s["observation"]]
        if body.data_mode == "lcz_simulation":
            by_lcz = {}
            for sample in result["samples"]:
                obs = sample["observation"]
                if obs:
                    by_lcz.setdefault(obs["lcz_hint"], obs["id"])
            ids = {*by_lcz.values(), result["representative_sample_id"]}
            evidence = [entry for entry in evidence if entry["id"] in ids]
        usable = result["coverage"]["usable_samples"] > 0
        permitted = body.use_ai and usable and (take_ai_budget() if ai_permission is None else ai_permission)
        cohorts, citations = [], {}
        for context in contexts:
            candidates, retrieval_status = kb.retrieve(context)
            if body.data_mode == "lcz_simulation" or result.get("is_forecast"):
                candidates, retrieval_status = [], "simulation_no_medical_advice"
            elif not kb.protocol_reviewed():
                candidates, retrieval_status = [], "protocol_review_pending"
            for clause in candidates:
                citations[clause["id"]] = kb.citation(clause)
            group = context["group"]
            assessment = cohort_assessment(context, result["environment"], result["coverage"])
            cohorts.append({"id": group, "label": GROUPS[group][0], "consideration": GROUPS[group][1],
                            "environment_risk": result["environment"]["risk"],
                            "assessment": assessment["label"], "attention_factors": assessment["factors"],
                            "assessment_method": assessment["method"], "assessment_note": assessment["note"],
                            "source_ids": ["WHO-HEAT", "NWS-LEVELS"], "context": context,
                            "retrieval_status": retrieval_status,
                            "medical_advice": [{"id": c["id"], "text": c["text_zh"], "citation_id": c["id"], "review_status": "approved"} for c in candidates],
                            "activity_plan": activity_plan(context, result["environment"], result["coverage"], layout_context)})
        for cohort in cohorts:
            actions.extend(cohort["activity_plan"]["actions"])
        decision_context = prepare_context(result, cohorts, layout_context)
        selection, generation = await select_regional(facts, actions, contexts, evidence, enabled=permitted,
            tool_messages=tool_messages, decision_context=decision_context)
        if body.use_ai and not permitted:
            generation["reason"] = "environment_unavailable" if not usable else ai_denial_reason or "model_budget_limit"
        ai_analysis = selection.pop("decision_analysis", None)
        analysis = public_analysis(ai_analysis if ai_analysis is not None else fallback_analysis(decision_context, facts, actions),
                                  decision_context, "ai_grounded_decision" if ai_analysis is not None else "rules_fallback", generation["reason"])
        cohort_by_id = {c["id"]: c for c in cohorts}
        for judgement in analysis["cohorts"]:
            cohort_by_id[judgement["group"]]["ai_judgement"] = judgement
        report = {**result, "schema_version": "regional-cohort-report-1", "project": "微境探界",
                  "created_at": datetime.now(timezone.utc).isoformat(), "input": body.model_dump(),
                  "purpose": "区域与人群热健康风险辅助研判；不是疾病确诊、处方、患病概率或临床验证。",
                  "cohorts": [cohort_by_id[g] for g in selection["group_order"]], "facts": facts, "management_checks": actions,
                  "interpretation": selection, "generation": generation, "decision_analysis": analysis, "citations": list(citations.values()),
                  "sources": [*kb.public_sources(), *REGIONAL_SOURCES], "medical_review": "reviewed_clauses_only" if citations else "pending",
                  "medical_message": "医学建议仅展示通过专业审核且适用的原文；无已审核证据时不生成医学处置。AI区域证据编排不代表医学审核完成。",
                  "rules_version": RULE_VERSION, "regional_version": REGIONAL_VERSION, "knowledge_version": kb.data["version"], "knowledge_provenance": kb.provenance(),
                  "privacy": "不收集身份或个体病史，区域报告不在服务端持久化；AI接收天气数值、群体枚举与证据，不发送地点名称或坐标。",
                  "limitations": ["中心及四角仅为有限网格采样，不代表全区连续实测或热风险热力图。",
                                  "无可靠现场残差、辐射、标准WBGT及人员健康数据，不提供空间插值、患病概率、标准WBGT或疾病诊断。",
                                  "人群差异为定性情景解释，不是已验证的人群风险模型；不进行数值加权或等效升温。"]}
        if body.data_mode == "lcz_simulation":
            report["purpose"] = "LCZ模拟区域与人群情景演示，非实测、未标定，不作为真实医学或应急决策依据。"
            report["medical_message"] = "模拟模式不生成真实医学处置建议；仅演示环境指标、群体关注因素及证据编排。"
            report["limitations"][:2] = [result["coverage"]["note"], result["simulation"]["uncertainty"]]
            if result.get("classification_summary"):
                report["classification_summary"] = result["classification_summary"]
                report["lcz_snapshot_sha256"] = result["snapshot_sha256"]
        report["report_sha256"] = digest(report)
        return report


@router.get("/observations/current")
async def current(response: Response, mode: Literal["current", "history"] = "current", site: Literal["zhongyuan", "campus"] = "zhongyuan"):
    response.headers["Cache-Control"] = "no-store"
    try:
        return {"success": True, "observation": await weather.get(mode, site)}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(503, "天气上游暂不可用；未使用模拟数据替代。危险症状可直接触发急救提示。")


@router.get("/timeline")
async def timeline(response: Response, site: Literal["zhongyuan", "campus"] = "zhongyuan"):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await weather.timeline(site)
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(503, "小时天气资料暂不可用；未生成替代曲线。")


@router.get("/observations/{record_id}")
async def observation(record_id: str, response: Response):
    record = store.get(record_id)
    if not record:
        raise HTTPException(404, "观测记录不存在")
    response.headers["Cache-Control"] = "no-store"
    return {"observation": record, "raw_response": store.raw(record_id)}


def retrieval_context(body, environment):
    return build_context(environment["risk"], environment["risk_label"], body.activity, body.exposure_minutes, body.symptoms, body.exposure)


@router.post("/assess")
async def assess(body: AssessmentRequest, response: Response):
    response.headers["Cache-Control"] = "no-store"
    kb = knowledge_snapshot()
    symptoms = triage(body.symptoms)
    if kb.protocol_reviewed():
        symptoms["review_status"] = "approved"
    record = store.get(body.observation_id) if body.observation_id else None
    environment = assess_environment(record, body.exposure)
    context = retrieval_context(body, environment)
    candidates, retrieval_status = kb.retrieve(context)
    if not kb.protocol_reviewed():
        candidates, retrieval_status = [], "protocol_review_pending"
    generation = {"mode": "rules_fallback", "reason": retrieval_status, "model": None}
    if symptoms["urgent"]:
        candidates = []
        generation["reason"] = "emergency_bypass_model"
    elif body.use_ai and candidates:
        if not take_ai_budget():
            generation["reason"] = "model_budget_limit"
        else:
            selected, generation = await select_advice(candidates, context)
            by_id = {c["id"]: c for c in candidates}
            candidates = [by_id[c] for c in selected]
    elif not body.use_ai and candidates:
        candidates, _ = kb.retrieve(context, fixed=True)
        generation["reason"] = "fixed_reviewed_baseline"
    advice = [{"id": c["id"], "text": c["text_zh"], "citation_id": c["id"], "review_status": "approved"} for c in candidates]
    report = {
        "schema_version": "aic-report-1", "created_at": datetime.now(timezone.utc).isoformat(),
        "purpose": "环境热风险评估；不作疾病确诊、处方或临床疗效承诺。",
        "input": body.model_dump(), "observation": record, "environment": environment,
        "symptom_triage": symptoms, "advice": advice, "citations": [kb.citation(c) for c in candidates],
        "retrieval": {"status": retrieval_status, "top_k": 3, "algorithm": "structured_filter_and_keyword_rank"},
        "generation": generation, "rules_version": RULE_VERSION, "knowledge_version": kb.data["version"], "knowledge_provenance": kb.provenance(),
        "medical_review": "reviewed_prototype" if advice and kb.protocol_reviewed() else "pending",
        "medical_message": ("医学建议库及症状规则尚未完成专业审核，当前不生成医学处置建议。" if not kb.protocol_reviewed() or not kb.approved() else
                            "当前条件未检索到适用的已审核条款，未生成无依据建议。") if not advice else "仅展示通过内容与来源版本审核的条款；专业审核不代表临床有效性验证。",
        "activity_context": {"activity": body.activity, "minutes": body.exposure_minutes, "exposure": body.exposure,
                             "note": "活动与时长只用于条款适用性过滤，不改写环境指标。"},
        "privacy": "未收集身份或病史；匿名症状与报告不在服务器持久化。调用AI时发送枚举场景及候选条款，不发送IP或身份。",
    }
    report["report_sha256"] = digest(report)
    return report
