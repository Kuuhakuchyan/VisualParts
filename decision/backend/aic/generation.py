"""Constrained DeepSeek selection. Only reviewed source text reaches the client."""

import asyncio
import json
import os

import httpx

_MODEL_SLOTS = asyncio.Semaphore(2)


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
