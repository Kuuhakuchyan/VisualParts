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

router = APIRouter(prefix="/api/weather/aic", tags=["anonymous-heat-risk"])
store = ObservationStore()
weather = WeatherEvidence(store)
kb = KnowledgeBase()
_ai_budget = deque()
_regional_slots = asyncio.Semaphore(2)


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
    return {"rules_version": RULE_VERSION, "knowledge_version": kb.data["version"],
            "retrieval": "structured_filter_and_keyword_rank", "vector_rag": False,
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
    async with _regional_slots:
        result = await sample_region(weather, body)
        contexts = [cohort_context(body, group, result["environment"]) for group in dict.fromkeys(body.groups)]
        facts, actions = regional_facts(result, body)
        evidence = [{"id": s["observation"]["id"], "temperature_c": s["observation"]["temperature_c"],
                     "humidity_pct": s["observation"]["relative_humidity_pct"], "observed_at": s["observation"]["observed_at"],
                     "environment": s["environment"]} for s in result["samples"] if s["observation"]]
        usable = result["coverage"]["usable_samples"] > 0
        permitted = body.use_ai and usable and take_ai_budget()
        selection, generation = await select_regional(facts, actions, contexts, evidence, enabled=permitted)
        if body.use_ai and not permitted:
            generation["reason"] = "environment_unavailable" if not usable else "model_budget_limit"
        cohorts, citations = [], {}
        for context in contexts:
            candidates, retrieval_status = kb.retrieve(context)
            if not kb.protocol_reviewed():
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
                            "medical_advice": [{"id": c["id"], "text": c["text_zh"], "citation_id": c["id"], "review_status": "approved"} for c in candidates]})
        cohort_by_id = {c["id"]: c for c in cohorts}
        report = {**result, "schema_version": "regional-cohort-report-1", "project": "微境探界",
                  "created_at": datetime.now(timezone.utc).isoformat(), "input": body.model_dump(),
                  "purpose": "区域与人群热健康风险辅助研判；不是疾病确诊、处方、患病概率或临床验证。",
                  "cohorts": [cohort_by_id[g] for g in selection["group_order"]], "facts": facts, "management_checks": actions,
                  "interpretation": selection, "generation": generation, "citations": list(citations.values()),
                  "sources": kb.public_sources(), "medical_review": "reviewed_clauses_only" if citations else "pending",
                  "medical_message": "医学建议仅展示通过专业审核且适用的原文；无已审核证据时不生成医学处置。AI区域证据编排不代表医学审核完成。",
                  "rules_version": RULE_VERSION, "regional_version": REGIONAL_VERSION, "knowledge_version": kb.data["version"],
                  "privacy": "不收集身份或个体病史，区域报告不在服务端持久化；AI接收天气数值、群体枚举与证据，不发送地点名称或坐标。",
                  "limitations": ["中心及四角仅为有限网格采样，不代表全区连续实测或热风险热力图。",
                                  "无可靠现场残差、辐射、标准WBGT及人员健康数据，不提供空间插值、患病概率、标准WBGT或疾病诊断。",
                                  "人群差异为定性情景解释，不是已验证的人群风险模型；不进行数值加权或等效升温。"]}
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
        "generation": generation, "rules_version": RULE_VERSION, "knowledge_version": kb.data["version"],
        "medical_review": "reviewed_prototype" if advice and kb.protocol_reviewed() else "pending",
        "medical_message": ("医学建议库及症状规则尚未完成专业审核，当前不生成医学处置建议。" if not kb.protocol_reviewed() or not kb.approved() else
                            "当前条件未检索到适用的已审核条款，未生成无依据建议。") if not advice else "仅展示通过内容与来源版本审核的条款；专业审核不代表临床有效性验证。",
        "activity_context": {"activity": body.activity, "minutes": body.exposure_minutes, "exposure": body.exposure,
                             "note": "活动与时长只用于条款适用性过滤，不改写环境指标。"},
        "privacy": "未收集身份或病史；匿名症状与报告不在服务器持久化。调用AI时发送枚举场景及候选条款，不发送IP或身份。",
    }
    report["report_sha256"] = digest(report)
    return report
