"""Constrained DeepSeek selection. Only reviewed source text reaches the client."""

import asyncio
import json
import os

import httpx

_MODEL_SLOTS = asyncio.Semaphore(2)


def validate_regional_selection(content, facts, actions, groups):
    value = json.loads(content)
    if not isinstance(value, dict) or set(value) != {"fact_ids", "action_ids", "group_order"}:
        raise ValueError("unexpected regional output")
    for key, allowed, minimum in [("fact_ids", {x["id"] for x in facts}, 1),
                                  ("action_ids", {x["id"] for x in actions}, 1),
                                  ("group_order", set(groups), len(set(groups)))]:
        ids = value[key]
        if (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids)
                or not minimum <= len(ids) <= len(allowed) or len(ids) != len(set(ids)) or not set(ids) <= allowed):
            raise ValueError("unsupported regional evidence")
    return value


async def select_regional(facts, actions, contexts, evidence, enabled=True):
    fallback = {"fact_ids": [x["id"] for x in facts], "action_ids": [x["id"] for x in actions],
                "group_order": [x["group"] for x in contexts]}
    key = os.getenv("AIC_DEEPSEEK_API_KEY", "")
    meta = {"mode": "rules_fallback", "model": None, "reason": "ai_disabled" if not enabled else "model_not_configured"}
    if not enabled or not key:
        return fallback, meta
    model = os.getenv("AIC_DEEPSEEK_MODEL", "deepseek-chat")
    messages = [
        {"role": "system", "content": "你是区域热健康风险的证据编排助手。结合真实气象样本、环境热指数、人群与活动场景，从给定事实与管理核查项中选择并排序。只输出JSON，字段为fact_ids、action_ids、group_order。前两者为已有非空ID子集；group_order必须恰好包含所有提供的人群ID。顺序仅为阅读与核查顺序，不是健康风险排名。不生成新事实、自由文本、疾病诊断、处方、患病概率或温降，不推断未提供的个体病史。"},
        {"role": "user", "content": json.dumps({"weather_evidence": evidence, "cohort_contexts": contexts, "facts": facts, "management_checks": actions}, ensure_ascii=False)},
    ]
    try:
        async with _MODEL_SLOTS:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post("https://api.deepseek.com/chat/completions",
                    headers={"Authorization": "Bearer " + key},
                    json={"model": model, "messages": messages, "temperature": 0, "max_tokens": 400,
                          "response_format": {"type": "json_object"}})
                response.raise_for_status()
                value = validate_regional_selection(response.json()["choices"][0]["message"]["content"], facts, actions, fallback["group_order"])
        # Safety/data gaps cannot be suppressed by model selection.
        value["fact_ids"] = list(dict.fromkeys(["COVERAGE", *value["fact_ids"]]))
        value["action_ids"] = list(dict.fromkeys([*[x["id"] for x in actions if x["id"] in {"DATA-GAP", "HISTORY"}], *value["action_ids"]]))
        return value, {"mode": "ai_regional_evidence_selection", "model": model, "reason": None,
                       "description": "AI结合区域气象、环境等级与人群场景编排已有证据；不生成自由医学处置或风险概率。"}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        return fallback, {"mode": "rules_fallback", "model": model, "reason": "model_unavailable_or_output_rejected"}


def validate_selection(content, candidates):
    result = json.loads(content)
    if not isinstance(result, dict) or set(result) != {"advice_ids"}:
        raise ValueError("unexpected model fields")
    ids = result["advice_ids"]
    allowed = {c["id"] for c in candidates}
    if not isinstance(ids, list) or not 1 <= len(ids) <= 3 or any(not isinstance(i, str) for i in ids):
        raise ValueError("invalid advice identifiers")
    if len(set(ids)) != len(ids) or not set(ids).issubset(allowed):
        raise ValueError("unsupported advice identifiers")
    return ids


async def select_advice(candidates, context):
    fallback = [c["id"] for c in candidates]
    key = os.getenv("AIC_DEEPSEEK_API_KEY", "")
    if not candidates:
        return [], {"mode": "rules_fallback", "reason": "no_reviewed_evidence", "model": None}
    if not key:
        return fallback, {"mode": "rules_fallback", "reason": "model_not_configured", "model": None}
    model = os.getenv("AIC_DEEPSEEK_MODEL", "deepseek-chat")
    messages = [
        {"role": "system", "content": "你是证据编排器。只选择提供的已审核建议ID，按当前场景排序。不得生成诊断、处方、自由文本或新建议。输出JSON且仅包含advice_ids数组，1到3个已有ID。"},
        {"role": "user", "content": json.dumps({"context": context, "reviewed_evidence": [{"id": c["id"], "text": c["text_zh"], "quote": c["quote"]} for c in candidates]}, ensure_ascii=False)},
    ]
    try:
        async with _MODEL_SLOTS:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post("https://api.deepseek.com/chat/completions",
                    headers={"Authorization": "Bearer " + key},
                    json={"model": model, "messages": messages, "temperature": 0, "max_tokens": 180,
                          "response_format": {"type": "json_object"}})
                response.raise_for_status()
                ids = validate_selection(response.json()["choices"][0]["message"]["content"], candidates)
        return ids, {"mode": "ai_evidence_selection", "reason": None, "model": model,
                     "description": "AI选择与编排；最终建议为审核原文，不输出自由生成医学文本。"}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        # Never log response bodies or authentication headers.
        return fallback, {"mode": "rules_fallback", "reason": "model_unavailable_or_output_rejected", "model": model}
