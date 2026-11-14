"""Safe JSON-only inference for the station time-series surrogate."""
import json
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

router = APIRouter(prefix="/api/weather/sandbox/temporal", tags=["temporal-surrogate"])
ARTIFACT = Path(__file__).resolve().parents[1]/"models/weather-temporal-ridge.json"


@lru_cache(maxsize=1)
def artifact():
    return json.loads(ARTIFACT.read_text(encoding="utf-8"))


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    time: datetime
    temperature_c: float = Field(ge=-40, le=60)
    humidity_pct: float = Field(ge=0, le=100)
    pressure_hpa: float = Field(ge=800, le=1100)
    wind_mps: float = Field(ge=0, le=60)


class ForecastInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    station_id: str = Field(min_length=1, max_length=80)
    observations: list[Observation] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def cadence(self):
        stamps = [o.time for o in self.observations]
        if any(t.tzinfo is None for t in stamps) or any((b-a).total_seconds() != 300 for a, b in zip(stamps, stamps[1:])):
            raise ValueError("需要按时间升序提供7条、间隔5分钟且带时区的观测，不接受插值或小时时间序列冒充。")
        return self


def predict(body, model):
    obs = body.observations
    last = obs[-1]
    local = last.time.astimezone(timezone(timedelta(hours=8)))
    hour = local.hour+local.minute/60
    x = [last.temperature_c, last.humidity_pct, last.pressure_hpa, last.wind_mps,
         *[getattr(last, k)-getattr(obs[-o-1], k) for k in ("temperature_c", "humidity_pct") for o in (1, 3, 6)],
         math.sin(hour*math.pi/12), math.cos(hour*math.pi/12)]
    scaled = [(v-m)/s for v, m, s in zip(x, model["feature_mean"], model["feature_scale"])]
    output = {}
    for i, (key, low, high) in enumerate((("temperature_c", -40, 60), ("humidity_pct", 0, 100))):
        delta = sum(a*b for a, b in zip(model["coefficients"][i], scaled))+model["intercept"][i]
        proposed = getattr(last, key)+delta
        accepted = model["enabled_targets"][i] and low <= proposed <= high
        output[key] = round(proposed if accepted else getattr(last, key), 4)
        output[key+"_method"] = "trained_temporal_ridge" if accepted else "persistence_fallback"
    return {"schema_version": model["schema_version"], "station_id": body.station_id,
            "source_type": "temporal_model_prediction", "input_provenance": "caller_supplied_not_verified_by_server",
            "issued_from": last.time.isoformat(), "valid_at": (last.time+timedelta(minutes=15)).isoformat(),
            "historical_or_current": "defined_by_input_time_not_live_telemetry", "horizon_minutes": 15,
            "predicted": output, "evaluation": model["evaluation"], "source_sha256": model["source_sha256"],
            "med_eligible": False, "spatial_retreatment_eligible": False,
            "note": "单点短时预测，不是实测、不预测拆建造成的空间温差；站点来源及适用域仍需核验。"}


@router.get("/model")
async def describe(response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        model = artifact()
    except (OSError, ValueError):
        raise HTTPException(503, "训练产物暂不可用，未输出示例精度。")
    return {k: v for k, v in model.items() if k not in ("coefficients", "intercept", "feature_mean", "feature_scale")}


@router.post("/predict")
async def forecast(body: ForecastInput, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return predict(body, artifact())
    except (OSError, ValueError):
        raise HTTPException(503, "训练产物暂不可用，未输出替代预测。")
