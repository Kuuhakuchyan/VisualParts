"""Activity planning using published prevention guidance, separate from clinical advice."""

import json
from pathlib import Path

VERSION = "activity-prevention/1.0"
ACTIVITIES = {"rest": "休息", "walk": "步行", "run": "运动", "work": "户外作业"}


def public_guidance():
    directory = Path(__file__).parent
    knowledge = json.loads((directory / "knowledge.json").read_text(encoding="utf-8"))
    sources = {source["id"]: source for source in knowledge["sources"]}
    manifest = json.loads((directory / "decision_sources.json").read_text(encoding="utf-8"))
    allowed = {"WHO-AVOID-PEAK", "WHO-SHADE", "WHO-CLOTHING"}
    records = []
    for clause in knowledge["clauses"]:
        snapshot = manifest.get("sources", {}).get(clause["source_id"], {})
        if clause["id"] in allowed and snapshot.get("quotes_verified") is True and snapshot.get("sha256"):
            records.append({"id": clause["id"], "text": clause["text_zh"], "quote": clause["quote"],
                            "location": clause["location"], "source_id": clause["source_id"],
                            "url": sources[clause["source_id"]]["url"], "publisher": sources[clause["source_id"]]["publisher"],
                            "source_sha256": snapshot["sha256"], "fetched_at": snapshot["fetched_at"],
                            "review_status": "published_public_prevention_not_clinical_approval"})
    return records


def activity_plan(context, environment, coverage, layout=None):
    activity, minutes, group = context["activity"], context["minutes"], context["group"]
    risk = environment["risk"]
    utci = (layout or {}).get("summary", {}).get("proposed_utci_c")
    severe = risk in {"danger", "extreme_danger"} or utci is not None and utci >= 38
    hot = risk not in {"below_range", "unavailable"} or utci is not None and utci >= 26
    strenuous = activity in {"run", "work"}
    usable = coverage["usable_samples"] > 0
    sources = {c["id"]: c for c in public_guidance()}
    actions = []

    def add(key, text, guidance_ids=()):
        if any(key not in sources for key in guidance_ids):
            return
        actions.append({"id": f"PLAN-{group}-{key}", "text": text, "group": group,
                        "source_ids": ["WHO-HEAT"] if guidance_ids else ["USER-SCENARIO"],
                        "guidance_ids": list(guidance_ids), "kind": "activity_planning"})

    if not usable:
        status, label = "weather_required", "先获取天气数据"
        summary = "暂缺有效天气，先读取当前资料；保留该人群的活动与时长设置。"
        add("WEATHER", "刷新气象资料后重新研判；先查看当地官方天气预警。")
    elif severe:
        status, label = "reschedule", "调整活动安排"
        summary = {"run": "将本次户外运动改到凉爽时段或室内，避免在当前高热条件下持续运动。",
                   "work": "优先调整高暴露工序的作业时段，将能移入室内或遮阴区的任务先行转移。",
                   "walk": "将非必要外出移到较凉爽时段；必须通行时，优先选择连续阴凉路线。",
                   "rest": "将休息地点安排在阴凉处，避开无遮阴的硬化场地。"}[activity]
        add("TIMING", summary, ("WHO-AVOID-PEAK",) if activity != "rest" else ("WHO-SHADE",))
        add("SHADE", {"run": "将运动场地转到有遮阴的位置，避开暴晒场地。", "work": "在作业区域设置可就近使用的遮阴休息点。"}.get(activity,
                     "优先使用树荫、连廊等阴凉空间，减少无遮阴路段停留。"), ("WHO-SHADE",))
    elif hot:
        status, label = "adapt", "减少日晒暴露"
        summary = "优先在阴凉处安排本次活动，避开一天中最热的时段。"
        if strenuous:
            summary = "把持续运动或高强度作业移到较凉爽时段，当前活动优先使用遮阴场地。"
        add("TIMING", summary, ("WHO-AVOID-PEAK",))
        add("SHADE", "通行、等待及休息优先使用阴凉空间。", ("WHO-SHADE",))
    else:
        status, label = "routine", "按计划安排"
        summary = "当前资料未提示明显高温热胁迫，可按设定的活动与时长安排。"
        add("ROUTINE", "按当前活动计划执行；天气明显升温或活动时长改变时重新研判。")
    if usable and hot and minutes >= 30:
        add("CLOTHING", "在活动和作业防护要求允许时，选择轻薄、宽松衣物。", ("WHO-CLOTHING",))
    factors = []
    if severe or hot:
        factors.append("环境热强度较高")
    if strenuous:
        factors.append("运动或劳动增加产热")
    if minutes >= 60:
        factors.append("连续暴露较长")
    if group in {"older_adults", "children", "sensitive"} and hot:
        factors.append("需优先照顾易感人群")
    if context.get("exposure") == "sun" and hot:
        factors.append("阳光直射")
    if usable and not coverage["complete"]:
        factors.append("部分区域缺测")
    return {"version": VERSION, "status": status, "label": label, "summary": summary,
            "activity": activity, "activity_label": ACTIVITIES[activity], "minutes": minutes,
            "factors": factors, "actions": actions,
            "guidance": [sources[key] for key in dict.fromkeys(key for a in actions for key in a["guidance_ids"])],
            "scope": "public_prevention_and_activity_planning", "clinical_review_status": "not_clinically_reviewed"}
