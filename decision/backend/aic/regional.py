"""Area and cohort risk evidence; never infer clinical diagnoses or sub-grid heat."""

import asyncio
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .risk import assess_environment, assess_forecast, build_context
from backend.spatial import region_samples, region_description

REGIONAL_VERSION = "area-cohort-1.1.0"
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
    data_mode: Literal["live", "lcz_simulation"] = "live"
    grid_resolution_m: Literal[30, 50, 100] = 30
    groups: list[Literal["students", "athletes", "workers", "older_adults", "children", "sensitive"]] = Field(default_factory=lambda: ["students", "athletes", "workers"], min_length=1, max_length=6)
    activity: Literal["rest", "walk", "run", "work"] = "walk"
    exposure_minutes: int = Field(default=30, ge=1, le=480)
    exposure: Literal["shade", "sun", "unknown"] = "unknown"
    use_ai: bool = True
    cohort_scenarios: dict[Literal["students", "athletes", "workers", "older_adults", "children", "sensitive"], CohortScenario] = Field(default_factory=dict, max_length=6)

    @model_validator(mode="after")
    def applicable_groups(self):
        if len(set(self.groups)) != len(self.groups):
            raise ValueError("目标人群不可重复")
        if not set(self.cohort_scenarios) <= set(self.groups):
            raise ValueError("活动情景只能配置给已选择的人群")
        return self


async def sample_region(weather, body):
    if body.data_mode == "lcz_simulation":
        from backend.lcz import sample_scenario
        return await sample_scenario(weather, body)
    region, locations, _ = region_samples(body)
    points = [(p.x, p.y) for p in locations]

    async def fetch(index, point):
        lon, lat = point
        try:
            observation = await weather.get(body.mode, location={"latitude": lat, "longitude": lon, "label": "某校园区域网格" if body.area_kind == "campus" else "某街区区域网格"}, history_hour=14 if body.mode == "history" else None)
            return {"id": f"sample-{index+1}", "requested": {"longitude": lon, "latitude": lat},
                    "observation": observation, "environment": (assess_forecast if observation.get("source_type")=="open_meteo_forecast" else assess_environment)(observation, body.exposure), "error": None}
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
    return {"samples": samples, "environment": env, "representative_sample_id": worst["id"] if worst else None,
            "coverage": {"requested_samples": 5, "usable_samples": len(usable), "unique_model_grids": len(unique),
                         "complete": complete, "spatial_comparison_supported": len(unique) > 1 and complete,
                         "status": "complete" if complete else "time_mismatch" if len(stamps) > 1 else "partial" if usable else "unavailable",
                         "note": "中心与分区内代表点是请求位置，不是实测点；重复网格不构成独立空间证据。校园选区按提供的数字化边界裁剪，非地籍测绘；结论取有效样本最高等级，不是连续热场或全区安全证明。"},
            "area": region_description(body, region),
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
    activity = {"rest":"静坐或休息","walk":"户外步行","run":"跑步或运动","work":"户外劳动"}[body.activity]
    exposure = {"shade":"阴凉轻风","sun":"阳光直射","unknown":"现场未核实"}[body.exposure]
    facts = [{"id": "ENVIRONMENT", "text": f"有效样本最高环境等级：{env['risk_label']}；并非人群疾病诊断。", "source_ids": ["NWS-METHOD", "NWS-LEVELS"],
              "evidence_ids": [s["observation"]["id"] for s in result["samples"] if s["observation"]]},
             {"id": "COVERAGE", "text": f"5个请求位置，{coverage['usable_samples']}个可用样本，{coverage['unique_model_grids']}个不同模型网格；不可识别网格内部冷热差异。", "source_ids": ["DATA-CONTRACT"]},
             {"id": "EXPOSURE", "text": f"共同场景输入：{body.exposure_minutes}分钟，活动为{activity}，环境为{exposure}；人群独立设置以各自情景为准。均为用户假设，不是跟踪测量。", "source_ids": ["USER-SCENARIO"]},
             {"id": "VULNERABILITY", "text": "年龄、健康状况、职业与活动影响热易感性；当前仅作群体定性分析，不计算患病概率或因人数虚构风险分数。", "source_ids": ["WHO-HEAT"]}]
    actions = [{"id": "VERIFY", "text": "核实选区内遮阴、通风、现场温湿度与模型网格覆盖，再用于具体场地安排。", "source_ids": ["DATA-CONTRACT"]},
               {"id": "GROUP-PLAN", "text": "按目标人群分别登记活动、暴露与保障条件，勿把同一环境等级当作所有人的相同健康风险。", "source_ids": ["WHO-HEAT"]}]
    if body.data_mode == "lcz_simulation":
        facts[1]["text"] = f"{coverage['requested_samples']}个LCZ模拟网格，{coverage['usable_samples']}个可计算；共同气象边界来自1个公开网格，不是实测残差或独立空间证据。"
        facts[0]["evidence_ids"] = [result["samples"][i]["observation"]["id"] for i in range(len(result["samples"])) if result["samples"][i]["id"] == result["representative_sample_id"]]
        facts.insert(0, {"id": "SIMULATION", "text": "本报告为LCZ模拟演示；温湿度偏移是既有项目参数的确定性情景，未实测标定，不用于真实疾病诊断或当前应急决策。", "source_ids": ["DATA-CONTRACT"]})
        summary = result.get("classification_summary")
        if summary:
            composition = "、".join(f"{row['name']}占{row['area_fraction']:.1%}" for row in summary["classes"])
            facts.append({"id": "LCZ-COMPOSITION", "text": "选区细尺度地表构成："+composition+"。面积不是人员暴露比例，混合网格按分类面积加权，不是只按主导类别赋值。",
                          "source_ids": ["DATA-CONTRACT"], "evidence_ids": [summary["classification_sha256"]]})
            proxies = [row["name"] for row in summary["classes"] if row["proxy_profile_code"] is not None]
            facts.append({"id": "LCZ-PARAMETERS", "text": ("建筑高度及道路宽度含情景假设；"+("、".join(proxies)+"温湿度系数复用既有建成区参数；" if proxies else "")+
                          "分类更新用于现状模拟边界，不等于已求解拆建后的气温、风场或热蓄积。"),
                          "source_ids": ["DATA-CONTRACT"], "evidence_ids": [summary["parameters_sha256"]]})
        actions.insert(0, {"id": "SIMULATION-ONLY", "text": "仅比较假设情景；切回真实气象模式并核实基准站与现场观测后，才可支持实际活动安排。", "source_ids": ["DATA-CONTRACT"]})
    if env["risk"] not in {"below_range", "unavailable"}:
        actions.append({"id": "HEAT-PLAN", "text": "启动场地热风险复核，结合当地官方预警与现场条件审查活动安排；医学防护措施仅引用已审核条款。", "source_ids": ["NWS-LEVELS", "WHO-HEAT"]})
    if not coverage["complete"]:
        actions.insert(0, {"id": "DATA-GAP", "text": "采样存在缺测或时刻不一致，不能给出全区低风险或安全结论，先补齐证据。", "source_ids": ["DATA-CONTRACT"]})
    if body.mode == "history":
        actions.insert(0, {"id": "HISTORY", "text": "该结果仅为注明日期的历史再分析案例，不可用于当前活动指挥。", "source_ids": ["DATA-CONTRACT"]})
    for group in body.groups:
        context = cohort_context(body, group, env)
        label = {"rest": "休息", "walk": "步行", "run": "运动", "work": "户外作业"}[context["activity"]]
        facts.append({"id": "SCENARIO-" + group, "text": f"{GROUPS[group][0]}：{label}，{context['minutes']}分钟，环境条件为{exposure}。",
                      "source_ids": ["USER-SCENARIO"]})
    return facts, actions
