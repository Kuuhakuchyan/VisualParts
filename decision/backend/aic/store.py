"""Persist only source observations, never anonymous symptom answers."""

import hashlib
import json
import os
import sqlite3
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


class ObservationStore:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("AIC_STATE_DB", str(Path(tempfile.gettempdir()) / "aic_evidence.sqlite3")))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, raw TEXT NOT NULL, created TEXT NOT NULL)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, observation, raw):
        observation = dict(observation)
        observation["raw_sha256"] = digest(raw)
        observation["id"] = "obs_" + digest(observation)
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO observations VALUES (?,?,?,?)", (observation["id"], json.dumps(observation, ensure_ascii=False), json.dumps(raw, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))
        return observation

    def get(self, record_id):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM observations WHERE id=?", (record_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def raw(self, record_id):
        with self.connect() as db:
            row = db.execute("SELECT raw FROM observations WHERE id=?", (record_id,)).fetchone()
        return json.loads(row[0]) if row else None
