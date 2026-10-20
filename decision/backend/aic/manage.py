"""Offline evidence collection, review handoff and transparent evaluation tools."""

import argparse
import asyncio
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import httpx

from .generation import select_advice
from .retrieval import KnowledgeBase, clause_hash
from .risk import RULE_VERSION, SYMPTOMS, assess_environment, build_context, triage
from .store import ObservationStore, digest


class SourceText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip = 0
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.skip = max(0, self.skip - 1)

    def handle_data(self, value):
        if not self.skip:
            self.text.append(value)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


async def harvest(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    kb = KnowledgeBase()
    manifest = {"fetched_at": datetime.now(timezone.utc).isoformat(), "sources": {}}
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for source in kb.sources.values():
            response = await client.get(source["url"])
            response.raise_for_status()
            parser = SourceText()
            parser.feed(response.text)
            plain = re.sub(r"\s+", " ", " ".join(parser.text)).strip()
            quotes = [c["quote"] for c in kb.data["clauses"] if c["source_id"] == source["id"]]
            verified = all(re.sub(r"\s+", " ", quote) in plain for quote in quotes)
            (directory / (source["id"] + ".html")).write_bytes(response.content)
            (directory / (source["id"] + ".txt")).write_text(plain, encoding="utf-8")
            manifest["sources"][source["id"]] = {"url": str(response.url), "sha256": hashlib.sha256(response.content).hexdigest(),
                "fetched_at": datetime.now(timezone.utc).isoformat(), "quotes_verified": verified,
                "quote_count": len(quotes), "etag": response.headers.get("etag"), "last_modified": response.headers.get("last-modified")}
    write_json(directory / "sources.json", manifest)
    print(json.dumps({"sources": len(manifest["sources"]), "quotes_verified": all(s["quotes_verified"] for s in manifest["sources"].values())}))


def review_bundle(output):
    kb = KnowledgeBase()
    snapshots = kb.manifest().get("sources", {})
    bundle = {"knowledge_version": kb.data["version"], "rules_version": RULE_VERSION,
        "instructions": "请由实际参与的执业医师核查原文、中文适用性及症状规则；禁止将模板值当成审核结论。审核人身份仅留服务端私密文件。",
        "protocol": {"status": "pending", "symptoms": SYMPTOMS, "notes": "审核risk.py完整规则、热指数适用性、抽搐/晕厥保守升级及120本地化。",
            "content_sha256": hashlib.sha256(Path(__file__).with_name("risk.py").read_bytes()).hexdigest(),
            "source_sha256": snapshots.get("NWS-ILLNESS", {}).get("sha256"),
            "reviewer": "", "credential_checked": False, "reviewed_at": ""},
        "clauses": {}}
    for clause in kb.data["clauses"]:
        source = kb.sources[clause["source_id"]]
        bundle["clauses"][clause["id"]] = {"clause": clause, "source": source, "content_sha256": clause_hash(clause, source),
            "source_sha256": snapshots.get(source["id"], {}).get("sha256"), "status": "pending", "reviewer": "",
            "credential_checked": False, "reviewed_at": "", "comments": ""}
    write_json(output, bundle)
    print("Review bundle exported; no approvals granted.")


def import_reviews(input_path, output):
    bundle = json.loads(Path(input_path).read_text(encoding="utf-8"))
    kb = KnowledgeBase(review_path=input_path)
    if bundle.get("protocol", {}).get("status") == "approved" and not kb.protocol_reviewed():
        raise ValueError("Protocol approval is incomplete or rules/source changed")
    for clause in kb.data["clauses"]:
        entry = bundle.get("clauses", {}).get(clause["id"], {})
        if entry.get("status") == "approved" and not kb.eligible(clause):
            raise ValueError("Approval has missing reviewer, credential, source snapshot or changed content: " + clause["id"])
    write_json(output, bundle)
    if os.name != "nt":
        os.chmod(output, 0o600)
    print("Review file checked and stored; confirm the reviewer identity and signed evidence separately.")


def evaluation_template(output):
    specifications = [
        (25, 60, "walk", 30, []), (30, 50, "walk", 30, []), (32, 70, "run", 60, []),
        (35, 65, "work", 120, []), (38, 70, "rest", 10, []), (22, 50, "walk", 30, ["confusion"]),
        (20, 50, "rest", 15, ["unconscious"]), (24, 60, "walk", 30, ["slurred_speech"]),
        (25, 60, "run", 60, ["seizure"]), (23, 60, "work", 20, ["fainting"]),
        (31, 70, "walk", 45, ["dizziness"]), (32, 65, "work", 90, ["nausea"]),
        (33, 70, "run", 45, ["vomiting"]), (30, 65, "walk", 30, ["headache"]),
        (34, 65, "work", 120, ["cramps"]), (32, 80, "walk", 60, ["weakness"]),
        (28, 85, "rest", 120, []), (29, 40, "run", 30, []), (36, 60, "work", 240, []),
        (33, 75, "walk", 180, ["nausea", "dizziness"]), (18, 55, "rest", 5, []),
        (40, 30, "work", 60, []), (31, 90, "run", 90, []), (28, 50, "walk", 30, ["vomiting"]),
    ]
    cases = [{"id": f"SC-{i+1:02}", "sample_type": "simulated_test_only", "temperature_c": t,
        "humidity_pct": rh, "activity": activity, "minutes": minutes, "symptoms": symptoms,
        "exposure": "unknown", "clinician_label": {"expected_ids": None, "urgent": None, "reviewer": "", "reviewed_at": "", "support_pass": None,
        "fixed_baseline_scores": None, "rag_scores": None}} for i, (t, rh, activity, minutes, symptoms) in enumerate(specifications)]
    write_json(output, {"status": "awaiting_clinician_labels", "cases": cases})
    print(f"{len(cases)} synthetic scenarios exported; no clinical labels invented.")


def evaluate(input_path, output):
    kb = KnowledgeBase()
    cases = json.loads(Path(input_path).read_text(encoding="utf-8"))["cases"]
    rows = []
    for case in cases:
        label = case["clinician_label"]
        if not (label.get("reviewer") and label.get("reviewed_at") and isinstance(label.get("expected_ids"), list) and isinstance(label.get("urgent"), bool)):
            continue
        observation = {"source_type": "open_meteo_grid", "quality_status": "validated", "observed_at": datetime.now(timezone.utc).isoformat(),
                       "temperature_c": case["temperature_c"], "relative_humidity_pct": case["humidity_pct"], "units": {"temperature": "°C", "humidity": "%"}}
        environment = assess_environment(observation, case["exposure"])
        context = build_context(environment["risk"], environment["risk_label"], case["activity"], case["minutes"], case["symptoms"], case["exposure"])
        candidates, status = kb.retrieve(context)
        ids = [c["id"] for c in candidates]
        expected = label["expected_ids"]
        rows.append({"id": case["id"], "top3": ids, "retrieval_status": status,
            "recall_at_3": len(set(ids).intersection(expected))/len(set(expected)) if expected else None,
            "urgent_correct": triage(case["symptoms"])["urgent"] == label["urgent"],
            "support_pass": label.get("support_pass"), "fixed_baseline_scores": label.get("fixed_baseline_scores"), "rag_scores": label.get("rag_scores")})
    recalls = [r["recall_at_3"] for r in rows if r["recall_at_3"] is not None]
    write_json(output, {"labeled_cases": len(rows), "required_cases": 20, "ready": len(rows) >= 20,
        "recall_at_3": sum(recalls)/len(recalls) if recalls else None,
        "urgent_accuracy": sum(r["urgent_correct"] for r in rows)/len(rows) if rows else None,
        "note": "未标注项不计分。支持性及基线比较只记录医师实际评分；此报告不等于临床验证。", "cases": rows})
    print(json.dumps({"labeled_cases": len(rows), "recall_at_3": sum(recalls)/len(recalls) if recalls else None}))


def import_field(input_path, output):
    payload = json.loads(Path(input_path).read_text(encoding="utf-8"))
    required = {"device_id", "point_id", "location", "observed_at", "temperature_c", "relative_humidity_pct",
                "shade_conditions", "comparison_instrument", "calibration_note", "original_record_id", "raw_file", "quality_reviewer"}
    if not required.issubset(payload) or any(payload[k] in (None, "") for k in required):
        raise ValueError("现场证据字段不完整")
    raw_file = Path(payload["raw_file"])
    raw_bytes = raw_file.read_bytes()
    raw_hash = hashlib.sha256(raw_bytes).hexdigest()
    observed = datetime.fromisoformat(payload["observed_at"])
    if observed.tzinfo is None:
        raise ValueError("现场时间必须带时区")
    record = {k: v for k, v in payload.items() if k not in {"raw_file", "quality_reviewer", "comparison_instrument", "calibration_note"}}
    record.update(source_type="field_collection", source_name="匿名现场测点观测", provider="field_device",
                  quality_status="validated", quality_note="人工核查采集台账；仅代表对应时空测点。",
                  units={"temperature": "°C", "humidity": "%"}, retrieved_at=datetime.now(timezone.utc).isoformat())
    check = assess_environment(record)
    if "invalid_observation" in check["triggers"]:
        raise ValueError("invalid measurements")
    if observed > datetime.now(timezone.utc):
        raise ValueError("现场记录不能来自未来")
    location = payload["location"]
    if not isinstance(location, dict) or not -90 <= location.get("latitude", 999) <= 90 or not -180 <= location.get("longitude", 999) <= 180:
        raise ValueError("现场坐标不完整")
    evidence_store = ObservationStore()
    archive = evidence_store.path.parent / "field-originals"
    archive.mkdir(parents=True, exist_ok=True)
    original = archive / raw_hash
    if not original.exists():
        fd = os.open(original, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw_bytes)
    audit = {k: payload[k] for k in ("quality_reviewer", "comparison_instrument", "calibration_note", "shade_conditions")}
    write_json(archive / (raw_hash + ".audit.json"), audit)
    if os.name != "nt":
        os.chmod(archive / (raw_hash + ".audit.json"), 0o600)
    stored = evidence_store.put(record, {"raw_file_sha256": raw_hash, "original_record_id": payload["original_record_id"],
                                       "archive_note": "原始文件和审核台账保存在服务端私密档案，公众仅获取哈希与匿名来源。"})
    result = {"observation_id": stored["id"], "raw_file_sha256": raw_hash}
    write_json(output, result)
    print(json.dumps(result))


async def model_smoke(output):
    # Non-medical connectivity check; never published as a medical suggestion or evaluation.
    candidates = [{"id": "CONNECTIVITY-CHECK", "text_zh": "这是接口连通性测试记录。", "quote": "Connectivity test record."}]
    ids, generation = await select_advice(candidates, {"test_only": True})
    write_json(output, {"test_type": "non_medical_model_connectivity", "selected": ids, "generation": generation,
                        "timestamp": datetime.now(timezone.utc).isoformat(), "clinical_validation": False})
    print(json.dumps(generation))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["harvest", "review-export", "review-import", "scenarios", "evaluate", "field-import", "model-smoke"])
    parser.add_argument("--input")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "harvest":
        asyncio.run(harvest(args.output))
    elif args.command == "review-export":
        review_bundle(args.output)
    elif args.command == "review-import":
        import_reviews(args.input, args.output)
    elif args.command == "scenarios":
        evaluation_template(args.output)
    elif args.command == "evaluate":
        evaluate(args.input, args.output)
    elif args.command == "field-import":
        import_field(args.input, args.output)
    else:
        asyncio.run(model_smoke(args.output))


if __name__ == "__main__":
    main()
