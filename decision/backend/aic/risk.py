"""NWS heat index, applicability checks and independent symptom escalation."""

import math
from datetime import datetime, timezone

RULE_VERSION = "aic-heat-1.0.0"
METHOD_URL = "https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml"
CATEGORY_URL = "https://www.weather.gov/ama/heatindex"
SYMPTOM_URL = "https://www.weather.gov/safety/heat-illness"
SYMPTOMS = {
    "confusion": "意识混乱", "unconscious": "昏迷或意识丧失", "slurred_speech": "言语不清",
    "seizure": "抽搐", "fainting": "晕厥", "dizziness": "头晕", "headache": "头痛",
    "nausea": "恶心", "vomiting": "呕吐", "cramps": "肌肉痉挛", "weakness": "乏力",
}
RED_FLAGS = {"confusion", "unconscious", "slurred_speech", "seizure", "fainting"}


def triage(symptoms):
    red = sorted(RED_FLAGS.intersection(symptoms))
    if red:
        return {"level": "emergency", "urgent": True, "triggers": red,
                "message": "出现危险症状，请立即拨打120或联系当地急救。不要等待本页评估完成。",
                "rule": "red-flag-immediate", "source_id": "NWS-ILLNESS", "source_url": SYMPTOM_URL,
                "review_status": "pending", "localization": "中国大陆急救号码120；抽搐为保守升级扩展，待医师审核"}
    if symptoms:
        return {"level": "symptomatic", "urgent": False, "triggers": sorted(symptoms),
                "message": "已记录不适症状；环境指标不能排除个体健康问题。医学建议待专业审核。",
                "rule": "symptom-independent", "review_status": "pending"}
    return {"level": "none_reported", "urgent": False, "triggers": [],
            "message": "未报告症状不代表不存在风险。", "rule": "no-symptom-reported", "review_status": "pending"}


def heat_index_f(t, rh):
    """Official two-stage NWS algorithm; inputs in Fahrenheit and percent."""
    simple = (0.5 * (t + 61.0 + (t - 68.0) * 1.2 + rh * 0.094) + t) / 2
    if simple < 80:
        return simple
    hi = (-42.379 + 2.04901523*t + 10.14333127*rh - 0.22475541*t*rh
          - 0.00683783*t*t - 0.05481717*rh*rh + 0.00122874*t*t*rh
          + 0.00085282*t*rh*rh - 0.00000199*t*t*rh*rh)
    if rh < 13 and 80 <= t <= 112:
        hi -= (13 - rh) / 4 * math.sqrt((17 - abs(t - 95)) / 17)
    elif rh > 85 and 80 <= t <= 87:
        hi += (rh - 85) / 10 * (87 - t) / 5
    return hi


def category(hi):
    for threshold, code, label in [(125, "extreme_danger", "极度危险"), (103, "danger", "危险"),
                                    (90, "extreme_caution", "高度警惕"), (80, "caution", "警惕")]:
        if hi >= threshold:
            return code, label
    return "below_range", "未达到热指数高温分级范围"


def assess_environment(observation, exposure="unknown", now=None):
    base = {"method": "NOAA/NWS Heat Index", "method_version": RULE_VERSION,
            "method_url": METHOD_URL, "category_url": CATEGORY_URL,
            "source_ids": ["NWS-METHOD", "NWS-LEVELS"],
            "heat_index_c": None, "heat_index_f": None, "risk": "unavailable",
            "risk_label": "无法评估", "applicability": "unavailable", "triggers": [],
            "limitations": ["适用于阴凉、轻风环境，日晒与辐射热未计入；不是实测WBGT。",
                            "活动和时长不参与气温换算；该等级不是疾病确诊或个人安全保证。"],
            "category_thresholds_f": [80, 90, 103, 125],
            "boundary_policy": "按连续阈值划分：[80,90)、[90,103)、[103,125)、[125,+∞)，先分级后四舍五入。"}
    if not observation:
        base["triggers"] = ["observation_missing"]
        return base
    if observation.get("source_type") == "simulated_test":
        base["triggers"] = ["simulated_observation_blocked"]
        return base
    if observation.get("source_type") not in {"open_meteo_grid", "historical_weather", "field_collection"}:
        base["triggers"] = ["unsupported_source_type"]
        return base
    if observation.get("quality_status") != "validated":
        base["triggers"] = ["observation_not_validated"]
        return base
    try:
        if observation.get("units") != {"temperature": "°C", "humidity": "%"}:
            raise ValueError("unexpected units")
        measured = datetime.fromisoformat(observation["observed_at"])
        if measured.tzinfo is None:
            raise ValueError("timezone required")
        age = ((now or datetime.now(timezone.utc)) - measured).total_seconds()
        if observation["source_type"] != "historical_weather" and (age > 7200 or age < -900):
            base["triggers"] = ["observation_stale_or_future"]
            return base
        t, rh = observation["temperature_c"], observation["relative_humidity_pct"]
        if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (t, rh)):
            raise ValueError("finite numbers required")
        if not -60 <= t <= 60 or not 0 <= rh <= 100:
            raise ValueError("invalid measurements")
    except (ValueError, KeyError, TypeError):
        base["triggers"] = ["invalid_observation"]
        return base
    base["applicability"] = "conditional" if exposure != "shade" else "reference_only"
    tf = t * 1.8 + 32
    if tf < 80:
        base.update(risk="below_range", risk_label="未达到热指数高温分级范围", applicability="below_range",
                    triggers=["temperature_below_80f"])
        return base
    # Conservative operational envelope, narrower than the full regression domain.
    if tf > 112:
        base.update(applicability="out_of_range", triggers=["temperature_outside_operational_envelope"])
        return base
    hi = heat_index_f(tf, rh)
    if hi > 137:
        base.update(applicability="out_of_range", triggers=["heat_index_outside_reference_chart"])
        base["limitations"].insert(0, "温湿度组合超出本原型采用的参考图表上限，不外推数值；这不表示低风险。")
        return base
    risk, label = category(hi)
    base.update(heat_index_c=round((hi - 32) / 1.8, 2), heat_index_f=round(hi, 2),
                risk=risk, risk_label=label, triggers=["nws_heat_index", "historical_case" if observation["source_type"] == "historical_weather" else "current_reference"])
    if exposure != "shade":
        base["limitations"].insert(0, "现场阴凉/轻风条件未核实，仅展示条件性参考值，不等于日晒下的实际热负荷。")
    return base


def build_context(risk, risk_label, activity, minutes, symptoms, exposure):
    activity_labels = {"rest": "休息", "walk": "户外 步行", "run": "户外 运动", "work": "户外 劳动"}
    return {"risk": risk, "activity": activity, "minutes": minutes, "symptoms": list(dict.fromkeys(symptoms)),
            "query": " ".join([risk_label, activity_labels[activity], "长时间 暴露" if minutes >= 60 else "",
                                "日晒" if exposure == "sun" else "阴凉", *[SYMPTOMS[s] for s in symptoms]])}
