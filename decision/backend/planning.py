"""Owner-scoped planning records and reproducible geometric comparisons."""

import hashlib
import json
import math
import os
import re
import sqlite3
import tempfile
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.aic.store import digest

router = APIRouter(prefix="/api/weather/workspace", tags=["planning-workspace"])
METHOD_VERSION = "geometry-screening-1.0"


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    name: str = Field(min_length=1, max_length=50)
    intervention: Literal["shade", "greening", "cool_roof", "building"] = "shade"
    longitude: float = Field(default=113.531, ge=113.4, le=113.9)
    latitude: float = Field(default=34.814, ge=34.6, le=34.95)
    area_m2: float = Field(default=100, ge=1, le=10000)
    height_m: float = Field(default=3, ge=1, le=100)
    solar_altitude_deg: float = Field(default=45, ge=5, le=85)
    baseline_albedo: float = Field(default=0.2, ge=0, le=1)
    proposed_albedo: float = Field(default=0.6, ge=0, le=1)


def evaluate_plan(value: PlanInput):
    """Screen geometry only; no thermal model, medical result or confidence."""
    footprint = value.area_m2
    metrics = {"intervention_area_m2": footprint, "added_volume_m3": None,
               "ideal_shadow_length_m": None, "reflectance_change_pp": None}
    if value.intervention in {"shade", "building"}:
        metrics["ideal_shadow_length_m"] = round(value.height_m / math.tan(math.radians(value.solar_altitude_deg)), 2)
    if value.intervention == "building":
        metrics["added_volume_m3"] = round(footprint * value.height_m, 2)
    if value.intervention == "cool_roof":
        metrics["reflectance_change_pp"] = round((value.proposed_albedo - value.baseline_albedo) * 100, 2)
    return {"method_version": METHOD_VERSION, "metrics": metrics, "temperature_delta_c": None,
            "confidence": None, "validation": "geometric_screening_only",
            "assumptions": ["面积、高度、反照率与太阳高度角均由用户输入，未自动调查或标定。",
                "理想影长 L=H/tan(太阳高度角)，假设竖直体块、水平地面与无遮挡；不是实际遮阴覆盖面积。",
                "体积=占地面积×高度；反照率差以百分点表示。绿化仅登记干预面积，不估算蒸散或温降。",
                "未计算流场、辐射、热惯性或人体暴露，不输出温降、医学建议或未经验证的置信度。"],
            "input_sha256": digest(value.model_dump())}


class PlanStore:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("WORKSPACE_STATE_DB", str(Path(tempfile.gettempdir()) / "microclimate_plans.sqlite3")))

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS workspace_plans (id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)")
                db.execute("CREATE INDEX IF NOT EXISTS plans_owner ON workspace_plans(owner, created_at)")
                yield db
        finally:
            db.close()

    def list(self, owner):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM workspace_plans WHERE owner=? ORDER BY created_at DESC", (owner,)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def save(self, owner, value):
        record = {"id": uuid.uuid4().hex, "created_at": datetime.now(timezone.utc).isoformat(),
                  "input": value.model_dump(), "result": evaluate_plan(value)}
        record["record_sha256"] = digest(record)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT COUNT(*) FROM workspace_plans WHERE owner=?", (owner,)).fetchone()[0] >= 100:
                raise HTTPException(409, "当前浏览器已保存100个方案，请先整理或导出。")
            db.execute("INSERT INTO workspace_plans VALUES (?,?,?,?)", (record["id"], owner, json.dumps(record, ensure_ascii=False), record["created_at"]))
        return record

    def delete(self, owner, record_id):
        with self.connect() as db:
            return db.execute("DELETE FROM workspace_plans WHERE owner=? AND id=?", (owner, record_id)).rowcount > 0


store = PlanStore()


def owner_hash(token):
    if not token or not re.fullmatch(r"[a-f0-9]{64}", token):
        raise HTTPException(401, "方案工作区凭证缺失，请允许浏览器本地存储后重试。")
    return hashlib.sha256(token.encode()).hexdigest()


@router.get("/plans")
async def plans(response: Response, x_workspace_token: Annotated[str | None, Header()] = None):
    response.headers["Cache-Control"] = "no-store"
    return {"plans": store.list(owner_hash(x_workspace_token)), "method_version": METHOD_VERSION}


@router.post("/plans", status_code=201)
async def save_plan(value: PlanInput, response: Response, x_workspace_token: Annotated[str | None, Header()] = None):
    response.headers["Cache-Control"] = "no-store"
    return store.save(owner_hash(x_workspace_token), value)


@router.delete("/plans/{record_id}")
async def delete_plan(record_id: str, response: Response, x_workspace_token: Annotated[str | None, Header()] = None):
    response.headers["Cache-Control"] = "no-store"
    if not store.delete(owner_hash(x_workspace_token), record_id):
        raise HTTPException(404, "方案不存在或不属于当前工作区。")
    return {"deleted": True}
