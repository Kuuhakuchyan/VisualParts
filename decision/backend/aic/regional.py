"""Area and cohort risk evidence; never infer clinical diagnoses or sub-grid heat."""

import asyncio
import math
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .risk import assess_environment, build_context

REGIONAL_VERSION = "area-cohort-1.0.0"
GROUPS = {
    "students": ("一般学生 / 步行人群", "人群标签不代表已取得年龄、体质或热适应资料。"),
    "athletes": ("户外运动人群", "运动会增加体内产热；需另行核实运动强度与热适应情况。"),
    "workers": ("户外作业人员", "职业暴露与劳动强度需要单独核实，不能由区域气温代替。"),
    "older_adults": ("老年人群", "年龄属于热易感性因素；当前未收集任何个人病史。"),
    "children": ("儿童人群", "儿童需要单独关注；该标签不能量化个体患病概率。"),
    "sensitive": ("其他需重点关注人群", "健康状况可能影响热易感性；本平台不收集或推断个人疾病。"),
}
RANK = {"below_range": 0, "caution": 1, "extreme_caution": 2, "danger": 3, "extreme_danger": 4}


class Bounds(BaseModel):
    model_config = ConfigDict(extra="forbid")
    west: float = Field(ge=113.4, le=113.9, allow_inf_nan=False)
    east: float = Field(ge=113.4, le=113.9, allow_inf_nan=False)
    south: float = Field(ge=34.6, le=34.95, allow_inf_nan=False)
    north: float = Field(ge=34.6, le=34.95, allow_inf_nan=False)

    @model_validator(mode="after")
    def ordered(self):
        if not 0 < self.east - self.west <= 0.1 or not 0 < self.north - self.south <= 0.1:
            raise ValueError("选区须有面积且经纬跨度均不超过0.1度")
        return self


class CohortScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    activity: Literal["rest", "walk", "run", "work"]
    exposure_minutes: int = Field(ge=1, le=480)


class RegionalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bounds: Bounds
    area_kind: Literal["campus", "neighborhood"] = "campus"
    mode: Literal["current", "history"] = "current"
    groups: list[Literal["students", "athletes", "workers", "older_adults", "children", "sensitive"]] = Field(default_factory=lambda: ["students", "athletes", "workers"], min_length=1, max_length=6)
    activity: Literal["rest", "walk", "run", "work"] = "walk"
    exposure_minutes: int = Field(default=30, ge=1, le=480)
    exposure: Literal["shade", "sun", "unknown"] = "unknown"
    use_ai: bool = True
    cohort_scenarios: dict[Literal["students", "athletes", "workers", "older_adults", "children", "sensitive"], CohortScenario] = Field(default_factory=dict, max_length=6)


async def sample_region(weather, body):
    b = body.bounds
    points = [((b.west+b.east)/2, (b.south+b.north)/2), (b.west, b.south), (b.east, b.south), (b.east, b.north), (b.west, b.north)]

    async def fetch(index, point):
        lon, lat = point
        try:
            observation = await weather.get(body.mode, location={"latitude": lat, "longitude": lon, "label": "某校园区域网格" if body.area_kind == "campus" else "某街区区域网格"}, history_hour=14 if body.mode == "history" else None)
            return {"id": f"sample-{index+1}", "requested": {"longitude": lon, "latitude": lat},
                    "observation": observation, "environment": assess_environment(observation, body.exposure), "error": None}
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
            return {"id": f"sample-{index+1}", "requested": {"longitude": lon, "latitude": lat},
                    "observation": None, "environment": assess_environment(None), "error": "天气资料不可用；未使用模拟值"}

    samples = await asyncio.gather(*(fetch(i, p) for i, p in enumerate(points)))
    usable = [s for s in samples if s["environment"]["risk"] in RANK]
    stamps = {s["observation"]["observed_at"] for s in usable}
    # Do not build a spatial comparison from different observation hours.
    if len(stamps) > 1:
        usable = []
    unique = {(s["observation"]["location"]["longitude"], s["observation"]["location"]["latitude"]) for s in usable}
    worst = max(usable, key=lambda s: (RANK[s["environment"]["risk"]], s["environment"]["heat_index_c"] or -1000)) if usable else None
    complete = len(usable) == len(samples)
    env = worst["environment"] if worst else assess_environment(None)
    area_km2 = (b.east-b.west) * (b.north-b.south) * 111.32**2 * math.cos(math.radians((b.north+b.south)/2))
    return {"samples": samples, "environment": env, "representative_sample_id": worst["id"] if worst else None,
            "coverage": {"requested_samples": 5, "usable_samples": len(usable), "unique_model_grids": len(unique),
                         "complete": complete, "spatial_comparison_supported": len(unique) > 1 and complete,
                         "status": "complete" if complete else "time_mismatch" if len(stamps) > 1 else "partial" if usable else "unavailable",
                         "note": "中心与四角是请求位置，不是实测点；重复网格不构成独立空间证据。区域结论取有效样本最高等级，不是连续热场或全区安全证明。"},
            "area": {"label": "某校园" if body.area_kind == "campus" else "某街区", "bounds": b.model_dump(),
                     "area_km2_approx": round(area_km2, 3), "geometry": {"type": "Polygon", "coordinates": [[[b.west,b.south],[b.east,b.south],[b.east,b.north],[b.west,b.north],[b.west,b.south]]]}},
            "case_type": "historical_reanalysis" if body.mode == "history" else "current_grid_estimate"}


def cohort_context(body, group, environment):
    scenario = body.cohort_scenarios.get(group)
    activity = scenario.activity if scenario else body.activity
    minutes = scenario.exposure_minutes if scenario else body.exposure_minutes
    context = build_context(environment["risk"], environment["risk_label"], activity, minutes, [], body.exposure)
    context.update(group=group, population=GROUPS[group][0])
    context["exposure"] = body.exposure
    if body.exposure == "unknown":
        context["query"] = context["query"].replace("阴凉", "现场环境未核实")
    context["scenario_source"] = "user_group_scenario" if scenario else "user_shared_scenario"
    context["query"] += " " + GROUPS[group][0]
    return context


def cohort_assessment(context, environment, coverage):
    factors = []
    if context["activity"] in {"run", "work"}:
        factors.append({"code": "exertion", "text": "该活动情景涉及运动或劳动产热，环境热指数不能单独代表身体热负荷。", "source_ids": ["WHO-HEAT"]})
    if context["group"] in {"older_adults", "children", "sensitive"}:
        factors.append({"code": "susceptibility", "text": "人群具有需核实的易感性因素；仅作群体提醒，不推断任何成员的病史。", "source_ids": ["WHO-HEAT"]})
    if context["minutes"] >= 60:
        factors.append({"code": "duration_check", "text": "已输入至少60分钟连续暴露，列入持续时间核查项；60分钟不是疾病阈值，也不改变环境等级。", "source_ids": ["USER-SCENARIO"]})
    if environment["applicability"] == "conditional":
        factors.append({"code": "radiation_unknown", "text": "阴凉轻风条件未核实，太阳辐射和现场通风未计入。", "source_ids": ["NWS-METHOD"]})
    if not coverage["complete"]:
        label = "证据不完整 · 不作全区安全判断"
    elif environment["risk"] == "below_range":
        label = "环境指标未达高温分级 · 人群因素仍需核查"
    elif factors:
        label = "存在环境热风险与附加关注因素"
    else:
        label = "存在环境热风险 · 需结合现场条件复核"
    return {"label": label, "factors": factors, "method": "qualitative_factor_checklist",
            "note": "关注因素不是相加评分、患病概率或经过验证的人群健康分级模型。"}


def regional_facts(result, body):
    env, coverage = result["environment"], result["coverage"]
    facts = [{"id": "ENVIRONMENT", "text": f"有效样本最高环境等级：{env['risk_label']}；并非人群疾病诊断。", "source_ids": ["NWS-METHOD", "NWS-LEVELS"],
              "evidence_ids": [s["observation"]["id"] for s in result["samples"] if s["observation"]]},
             {"id": "COVERAGE", "text": f"5个请求位置，{coverage['usable_samples']}个可用样本，{coverage['unique_model_grids']}个不同模型网格；不可识别网格内部冷热差异。", "source_ids": ["DATA-CONTRACT"]},
             {"id": "EXPOSURE", "text": f"场景输入：{body.exposure_minutes}分钟，活动{body.activity}，环境{body.exposure}；为用户情景假设，不是跟踪测量。", "source_ids": ["USER-SCENARIO"]},
             {"id": "VULNERABILITY", "text": "年龄、健康状况、职业与活动影响热易感性；当前仅作群体定性分析，不计算患病概率或因人数虚构风险分数。", "source_ids": ["WHO-HEAT"]}]
    actions = [{"id": "VERIFY", "text": "核实选区内遮阴、通风、现场温湿度与模型网格覆盖，再用于具体场地安排。", "source_ids": ["DATA-CONTRACT"]},
               {"id": "GROUP-PLAN", "text": "按目标人群分别登记活动、暴露与保障条件，勿把同一环境等级当作所有人的相同健康风险。", "source_ids": ["WHO-HEAT"]}]
    if env["risk"] not in {"below_range", "unavailable"}:
        actions.append({"id": "HEAT-PLAN", "text": "启动场地热风险复核，结合当地官方预警与现场条件审查活动安排；医学防护措施仅引用已审核条款。", "source_ids": ["NWS-LEVELS", "WHO-HEAT"]})
    if not coverage["complete"]:
        actions.insert(0, {"id": "DATA-GAP", "text": "采样存在缺测或时刻不一致，不能给出全区低风险或安全结论，先补齐证据。", "source_ids": ["DATA-CONTRACT"]})
    if body.mode == "history":
        actions.insert(0, {"id": "HISTORY", "text": "该结果仅为注明日期的历史再分析案例，不可用于当前活动指挥。", "source_ids": ["DATA-CONTRACT"]})
    return facts, actions
