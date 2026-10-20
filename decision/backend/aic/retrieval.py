"""Structured filtering and Chinese keyword ranking, with content-bound review gates."""

import json
import hashlib
import os
from pathlib import Path

from .store import digest

KNOWLEDGE_PATH = Path(__file__).with_name("knowledge.json")


def clause_hash(clause, source):
    return digest({"clause": clause, "source": source})


class KnowledgeBase:
    def __init__(self, knowledge_path=None, review_path=None, source_manifest_path=None):
        self.data = json.loads(Path(knowledge_path or KNOWLEDGE_PATH).read_text(encoding="utf-8"))
        self.sources = {source["id"]: source for source in self.data["sources"]}
        self.review_path = review_path or os.getenv("AIC_REVIEW_FILE", "")
        self.manifest_path = source_manifest_path or os.getenv("AIC_SOURCE_MANIFEST", "")

    def manifest(self):
        try:
            return json.loads(Path(self.manifest_path).read_text(encoding="utf-8")) if self.manifest_path else {}
        except (OSError, ValueError):
            return {}

    def reviews(self):
        try:
            return json.loads(Path(self.review_path).read_text(encoding="utf-8")) if self.review_path else {}
        except (OSError, ValueError):
            return {}

    def eligible(self, clause):
        source = self.sources[clause["source_id"]]
        entry = self.reviews().get("clauses", {}).get(clause["id"], {})
        snapshot = self.manifest().get("sources", {}).get(source["id"], {})
        return (entry.get("status") == "approved" and bool(entry.get("reviewer"))
                and entry.get("credential_checked") is True and bool(entry.get("reviewed_at"))
                and entry.get("content_sha256") == clause_hash(clause, source)
                and entry.get("source_sha256") == snapshot.get("sha256")
                and bool(snapshot.get("sha256")) and snapshot.get("quotes_verified") is True)

    def approved(self):
        return [c for c in self.data["clauses"] if self.eligible(c)]

    def protocol_reviewed(self):
        entry = self.reviews().get("protocol", {})
        snapshot = self.manifest().get("sources", {}).get("NWS-ILLNESS", {})
        return (entry.get("status") == "approved" and bool(entry.get("reviewer"))
                and entry.get("credential_checked") is True and bool(entry.get("reviewed_at"))
                and entry.get("content_sha256") == hashlib.sha256(Path(__file__).with_name("risk.py").read_bytes()).hexdigest()
                and bool(snapshot.get("sha256")) and entry.get("source_sha256") == snapshot["sha256"])

    def retrieve(self, context, limit=3, fixed=False):
        if context["risk"] == "unavailable":
            return [], "environment_unavailable"
        candidates = []
        for clause in self.approved():
            if clause.get("groups") and context.get("group") not in clause["groups"]:
                continue
            if fixed and not clause.get("fallback"):
                continue
            if clause["risks"] and context["risk"] not in clause["risks"]:
                continue
            if clause["activities"] and context["activity"] not in clause["activities"]:
                continue
            if context["minutes"] < clause["min_minutes"]:
                continue
            if clause["symptoms"] and not set(clause["symptoms"]).intersection(context["symptoms"]):
                continue
            score = sum(2 for key in clause["keywords"] if key in context["query"])
            score += 4 * len(set(clause["symptoms"]).intersection(context["symptoms"]))
            score += bool(clause["risks"]) + bool(clause["activities"])
            candidates.append((score, clause["id"], clause))
        ids = {c[2]["id"] for c in candidates}
        if any(ids.intersection(c[2].get("conflicts_with", [])) for c in candidates):
            return [], "evidence_conflict"
        candidates.sort(key=(lambda item: item[1]) if fixed else (lambda item: (-item[0], item[1])))
        return [c[2] for c in candidates[:limit]], "matched" if candidates else "retrieval_empty"

    def public_sources(self):
        snapshots = self.manifest().get("sources", {})
        return [{**source, "snapshot": {k: snapshots.get(source["id"], {}).get(k) for k in ("sha256", "fetched_at", "quotes_verified")}} for source in self.sources.values()]

    def citation(self, clause):
        source = self.sources[clause["source_id"]]
        return {"id": clause["id"], "source_id": source["id"], "title": source["title"],
                "publisher": source["publisher"], "url": source["url"], "version_date": source["version_date"],
                "location": clause["location"], "quote": clause["quote"], "content_sha256": clause_hash(clause, source),
                "source_sha256": self.manifest()["sources"][source["id"]]["sha256"],
                "review_status": "approved", "review_record": "private:" + clause_hash(clause, source)[:12]}
