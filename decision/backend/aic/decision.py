"""Grounded AI judgement, separate from numeric heat indices and clinical diagnosis."""

import json
import re
from pathlib import Path

VERSION = "grounded-area-layout-decision/1.1"
PRIORITIES = {"routine_review": "常规安排", "heightened_review": "加强防护", "priority_review": "优先调整", "insufficient_evidence": "待补天气"}
STEPS = {"compare_height": "比较建筑高度方案", "compare_orientation": "比较体块朝向方案",
         "compare_position": "比较建筑位置方案", "check_hotspots": "检查局部热斑与新释放空间",
         "measure_wind_radiation": "补测通风与辐射条件", "field_validation": "开展现场对照验证", "recompute": "调整后重新推演"}
VERDICTS = {"no_change": "尚无布局改动", "compare_required": "需要更多对比",
            "candidate_for_validation": "可列为现场验证候选", "revise_and_resimulate": "建议修改后重新推演",
            "mixed_tradeoff": "存在指标权衡", "insufficient_evidence": "证据不足，暂不推荐"}
CONCERNS = {"heat_related_illness": "热相关健康风险关注（非疾病确诊）",
            "susceptibility": "重点人群热易感性关注", "exertion": "运动或劳动产热关注"}
BACKGROUND = [
    {"id": "BG-HEAT", "source_id": "WHO-HEAT", "section": "How does heat impact health?",
     "text": "高温可增加热衰竭、热射病等热相关健康风险，并增加心脏与肾脏负担；关联背景不证明区域内任何人已经患病。"},
    {"id": "BG-SUSCEPTIBILITY", "source_id": "WHO-HEAT", "section": "Who is affected?",
     "text": "年龄、健康状况和暴露条件影响热易感性；需要重点关注儿童、老年人及其他易感人群，不能从群体标签推断个体疾病。"},
    {"id": "BG-EXERTION", "source_id": "WHO-HEAT", "section": "How does heat impact health?",
     "text": "活动产热与环境散热条件共同影响热负荷；持续活动及暴露应单独核查，不将活动时长换算为未经验证的气温增量。"},
    {"id": "BG-RED-FLAG", "source_id": "NWS-ILLNESS", "section": "Heat Stroke / Symptoms",
     "text": "意识混乱、言语不清等症状属于需紧急关注的热相关危险信号；区域天气不能代替症状评估，紧急升级由独立规则处理。"},
]


def background_records():
    """A source snapshot is background provenance, never a physician approval."""
    try:
        manifest = json.loads(Path(__file__).with_name("decision_sources.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    records = []
    for record in BACKGROUND:
        snapshot = manifest.get("sources", {}).get(record["source_id"], {})
        if snapshot.get("sha256") and snapshot.get("quotes_verified") is True:
            records.append({**record, "source_sha256": snapshot["sha256"], "fetched_at": snapshot["fetched_at"],
                            "review_status": "public_source_background_not_clinical_approval"})
    return records


def prepare_context(result, cohorts, layout=None):
    records = background_records()
    env = result["environment"]
    layout_summary = layout["summary"] if layout else None
    utci_value = layout_summary["proposed_utci_c"] if layout else None
    heat_present = env["risk"] not in {"below_range", "unavailable"} or utci_value is not None and utci_value >= 26
    data_usable = result["coverage"]["usable_samples"] > 0
    coverage_complete = result["coverage"]["complete"]
    available = {r["id"] for r in records}
    groups = []
    for cohort in cohorts:
        c = cohort["context"]
        vulnerable = c["group"] in {"older_adults", "children", "sensitive"}
        exertion = c["activity"] in {"run", "work"}
        priority = ("insufficient_evidence" if not data_usable else "priority_review"
                    if env["risk"] in {"danger", "extreme_danger"} or utci_value is not None and utci_value >= 38
                    else "heightened_review" if not coverage_complete or heat_present else "routine_review")
        allowed_priorities = [priority] if priority in {"insufficient_evidence", "priority_review"} else (
            ["heightened_review", "priority_review"] if priority == "heightened_review" else ["routine_review"])
        concerns = []
        if heat_present and "BG-HEAT" in available: concerns.append("heat_related_illness")
        if vulnerable and "BG-SUSCEPTIBILITY" in available: concerns.append("susceptibility")
        if exertion and "BG-EXERTION" in available: concerns.append("exertion")
        knowledge_ids = [key for key, applies in [("BG-HEAT", True), ("BG-SUSCEPTIBILITY", vulnerable), ("BG-EXERTION", exertion)] if applies and key in available]
        groups.append({"group": cohort["id"], "context": c, "attention_factors": cohort["attention_factors"],
                       "activity_plan": cohort.get("activity_plan"),
                       "allowed_priorities": allowed_priorities, "allowed_concern_ids": concerns,
                       "allowed_knowledge_ids": knowledge_ids,
                       "medical_advice": cohort["medical_advice"], "retrieval_status": cohort["retrieval_status"]})
    verdicts = None
    if layout:
        s = layout_summary
        if not s["comparable_cells"]:
            verdicts = ["insufficient_evidence"]
        elif not s["added_buildings"] and not s["removed_buildings"]:
            verdicts = ["no_change"]
        elif layout.get("effect_status") in {"night_no_shortwave", "no_resolved_change"}:
            verdicts = ["compare_required"]
        elif s["delta_utci_c"] < 0 and s["strong_heat_area_change_pp"] <= 0:
            verdicts = ["candidate_for_validation", "compare_required"]
        elif s["delta_utci_c"] > 0 and s["strong_heat_area_change_pp"] >= 0:
            verdicts = ["revise_and_resimulate", "compare_required"]
        elif s["delta_utci_c"] == 0 and s["strong_heat_area_change_pp"] == 0:
            verdicts = ["compare_required"]
        else:
            verdicts = ["mixed_tradeoff", "compare_required"]
    return {"schema_version": VERSION, "data_case": "simulation" if result.get("data_mode") == "lcz_simulation"
            else result["case_type"], "coverage_complete": coverage_complete, "has_usable_observations": data_usable,
            "risk_intensity": {"environment_code": env["risk"], "environment_label": env["risk_label"],
                               "heat_index_c": env["heat_index_c"], "utci_c": utci_value,
                               "utci_label": layout_summary["proposed_stress"] if layout else None,
                               "assessment_basis": layout.get("thermal_assessment") if layout else None,
                               "meaning": "环境热强度与群体关注优先级分开；不是患病概率或临床严重度。"},
            "cohorts": groups, "background": records,
            "classification_summary": result.get("classification_summary"),
            "layout": {**layout, "allowed_verdicts": verdicts, "allowed_next_steps": list(STEPS)} if layout else None,
            "medical_gate": "Only supplied reviewed medical_advice IDs; no diagnosis, prescriptions, treatment or invented symptoms."}


def _ids(value, allowed, minimum=0):
    if (not isinstance(value, list) or not all(isinstance(x, str) for x in value)
            or not minimum <= len(value) <= len(allowed) or len(set(value)) != len(value) or not set(value) <= set(allowed)):
        raise ValueError("unsupported decision references")


def _reason(value, facts, background):
    if not isinstance(value, dict) or set(value) != {"text", "fact_ids", "knowledge_ids"}:
        raise ValueError("unexpected reasoning fields")
    text = value["text"]
    if (not isinstance(text, str) or not 8 <= len(text) <= 450 or re.search(r"[0-9%％<>]", text)
            or re.search(r"确诊|诊断为|患有|处方|服用|用药|剂量|毫克|毫升|治愈|治疗|输液|注射|药物|口服|患病概率|百分之|置信度|无需就医|绝对安全|保证安全|批准拆除|直接施工|临床有效|已验证|已证实|实测温降", text)):
        raise ValueError("unsafe or ungrounded generated text")
    _ids(value["fact_ids"], facts, 1)
    _ids(value["knowledge_ids"], background)


def validate_analysis(value, context, facts, actions):
    if not isinstance(value, dict) or set(value) != {"overview", "cohorts", "building"}:
        raise ValueError("unexpected decision analysis")
    fact_ids, action_ids = {x["id"] for x in facts}, {x["id"] for x in actions}
    background = {x["id"] for x in context["background"]}
    _reason(value["overview"], fact_ids, background)
    cohorts = value["cohorts"]
    if not isinstance(cohorts, list) or len(cohorts) != len(context["cohorts"]):
        raise ValueError("missing cohort decisions")
    expected = {c["group"]: c for c in context["cohorts"]}
    seen = set()
    for item in cohorts:
        if not isinstance(item, dict) or set(item) != {"group", "priority", "reasoning", "health_concern_ids", "management_action_ids", "medical_advice_ids"}:
            raise ValueError("unexpected cohort decision")
        c = expected.get(item["group"])
        if c is None or item["group"] in seen or item["priority"] not in c["allowed_priorities"]:
            raise ValueError("unsupported cohort priority")
        seen.add(item["group"])
        _reason(item["reasoning"], fact_ids, c["allowed_knowledge_ids"])
        _ids(item["health_concern_ids"], c["allowed_concern_ids"])
        applicable_actions = {a["id"] for a in actions if not a.get("group") or a["group"] == item["group"]}
        _ids(item["management_action_ids"], applicable_actions, 1)
        plan = c.get("activity_plan")
        if plan and not set(item["management_action_ids"]).intersection(a["id"] for a in plan["actions"]):
            raise ValueError("missing actionable plan")
        _ids(item["medical_advice_ids"], {a["id"] for a in c["medical_advice"]})
        required = {"heat_related_illness": "BG-HEAT", "susceptibility": "BG-SUSCEPTIBILITY", "exertion": "BG-EXERTION"}
        if any(required[code] not in item["reasoning"]["knowledge_ids"] for code in item["health_concern_ids"]):
            raise ValueError("health concern needs professional source")
    building = value["building"]
    if context["layout"] is None:
        if building is not None: raise ValueError("layout not supplied")
    else:
        if not isinstance(building, dict) or set(building) != {"verdict", "reasoning", "next_steps"}:
            raise ValueError("unexpected building judgement")
        if building["verdict"] not in context["layout"]["allowed_verdicts"]:
            raise ValueError("building verdict contradicts computed comparison")
        _reason(building["reasoning"], fact_ids, background)
        if "LAYOUT-RESULT" not in building["reasoning"]["fact_ids"]:
            raise ValueError("building decision missing numerical evidence")
        _ids(building["next_steps"], STEPS, 1)
    return value


def fallback_analysis(context, facts, actions):
    first_fact = facts[0]["id"]
    reasoning = lambda text, ids=None: {"text": text, "fact_ids": ids or [first_fact], "knowledge_ids": []}
    heat = context["risk_intensity"]["environment_code"] not in {"below_range", "unavailable"} or (context["risk_intensity"]["utci_c"] or 0) >= 26
    overview = "选区存在环境热胁迫，优先调整户外活动时段与暴露位置，分别落实运动、作业和易感人群的防护安排。" if heat else "当前资料未提示明显高温热胁迫，可按各人群的活动计划安排，并在天气或暴露条件改变时更新研判。"
    if not context["has_usable_observations"]:
        overview = "先补齐当前气象资料，再确定活动安排；已设置的人群与活动情景予以保留。"
    result = {"overview": reasoning(overview),
              "cohorts": [{"group": c["group"], "priority": c["allowed_priorities"][0],
                  "reasoning": reasoning((c.get("activity_plan") or {}).get("summary", overview)),
                  "health_concern_ids": [], "management_action_ids": [a["id"] for a in (c.get("activity_plan") or {}).get("actions", actions)],
                  "medical_advice_ids": [a["id"] for a in c["medical_advice"]]} for c in context["cohorts"]], "building": None}
    if context["layout"]:
        weather_only = context["layout"].get("thermal_assessment", {}).get("shortwave_included") is False
        result["building"] = {"verdict": context["layout"]["allowed_verdicts"][0],
            "reasoning": reasoning("夜间环境风险按温湿度和风速估测，不计太阳短波增量；拆建导致的蓄热与通风变化尚未求解，不能据零差值判定方案优劣。" if weather_only else "仅依据同位置辐射热暴露计算作探索性比较，需补充局部热斑与现场对照。", ["LAYOUT-RESULT", "LAYOUT-LIMIT"]),
            "next_steps": ["check_hotspots", "field_validation"]}
    return result


def public_analysis(value, context, mode, reason=None):
    return {**value, "schema_version": VERSION, "mode": mode, "reason": reason,
            "risk_intensity": context["risk_intensity"], "data_case": context["data_case"],
            "knowledge": context["background"], "classification_summary": context.get("classification_summary"),
            "priority_labels": PRIORITIES, "concern_labels": CONCERNS,
            "building_verdict_labels": VERDICTS, "next_step_labels": STEPS,
            "clinical_diagnosis": False, "medical_advice_gate": "reviewed_applicable_clauses_only",
            "text_review_status": "ai_or_rules_text_not_clinically_reviewed",
            "disclaimer": "AI生成区域辅助研判与规划建议；关注优先级不是临床风险评分。模拟或历史案例不作为当前医学或施工决策依据。"}


OUTPUT_INSTRUCTION = """你同时承担区域热健康风险辅助分析与建筑方案辅助决策。输出面向使用者的行动结论，不写审查报告。
每个人群先说本次活动如何安排，再解释环境、活动与时长为什么支持该安排；每段两句话以内，建议不超过一百二十字。activity_plan提供系统生成的活动计划，management_action_ids必须至少选一个该组PLAN开头的具体行动，不要只选核实、复核或补测。低热环境明确说明可按计划活动；高热环境明确说应调整什么。历史或模拟的性质由页面统一标记，不在每段反复解释。专业审核状态、模型缺口统一放在报告依据区，正文不要用免责声明代替分析。
classification_summary及LCZ-COMPOSITION提供当前选区分类面积构成；LCZ-PARAMETERS提供情景系数与代理限制。仅据这些事实解释地表构成与模拟差异，不把面积占比当人员暴露或患病比例，不把主导类别当纯地物，不从分类推断未计算的拆建气温或风场变化。
layout.neighbourhood给出逐格邻域特征、冷暖变化格点和遮阴/天空遮挡机制。建筑解释优先引用LAYOUT-NEIGHBOURHOOD，说明变化发生在什么邻域以及对应的计算机制；layout.layout_comparison存在时比较LAYOUT-ALTERNATIVES中的实际备选，不能假称未执行的方案已经更优。空间学习模型是UTCI公式的物理蒸馏，并由传统计算逐格校验；其公式仿真误差不等于实际微气候预测精度，不声称已经学习了风场、蓄热或建筑导致的空气温度变化。
layout.layout_comparison.proposal_origin为deepseek时，proposal是你根据物理基线提出并已回代方程的参数假设。根据各备选的实际summary、neighbourhood和recommendation形成联合结论；明确哪些建议得到计算支持。recommendation仅按相同有效格点的辐射UTCI筛选，不等于建筑综合最优；not_evaluable时不得声称夜间降温、缺测区域安全或最佳方案已验证。候选仅在用户采用后改变当前建筑。
在原有fact_ids、action_ids、group_order之外返回decision_analysis，包含overview、cohorts、building。
最终JSON最外层必须且只能有四个字段，完整结构为：
{"fact_ids":["已有事实ID"],"action_ids":["已有管理核查项ID"],"group_order":["已提供的人群ID"],"decision_analysis":{"overview":{"text":"区域综合解释","fact_ids":["已有事实ID"],"knowledge_ids":[]},"cohorts":[{"group":"已提供的人群ID","priority":"该组允许的优先级","reasoning":{"text":"该组解释","fact_ids":["已有事实ID"],"knowledge_ids":[]},"health_concern_ids":[],"management_action_ids":["已有管理核查项ID"],"medical_advice_ids":[]}],"building":null}}
模板中的说明性占位符必须替换为输入中的真实ID；cohorts与group_order都必须完整覆盖输入人群。fact_ids和action_ids各选非空子集；不可将overview、cohorts、building或risk_intensity直接放在最外层。存在layout时将building替换为下述建筑对象。
overview及每个reasoning都为{text,fact_ids,knowledge_ids}；text用中文解释行动与原因，不写任何阿拉伯数字、百分号或新增数值，指标与活动分钟数由系统单独展示。fact_ids非空且必须存在，knowledge_ids引用提供的BG记录。
cohorts恰好覆盖所有group，每项为{group,priority,reasoning,health_concern_ids,management_action_ids,medical_advice_ids}。priority只能取对应allowed_priorities。每组knowledge_ids只能取该组allowed_knowledge_ids，活动与时长以context为准。允许的健康关注项只能取allowed_concern_ids，且分别引用BG-HEAT、BG-SUSCEPTIBILITY、BG-EXERTION。管理建议仅用通用action或该组PLAN ID，不用其他组的ID。公开防护条款可用于活动安排，不等于个体医疗处置；medical_advice_ids仅选择对应已审核ID，空列表保持空。
building在没有layout时为null；否则为{verdict,reasoning,next_steps}。verdict只能取allowed_verdicts，reasoning必须引用LAYOUT-RESULT，next_steps只能取allowed_next_steps。综合平均热暴露、强热面积与局部热斑局限，解释为何建议保留、调整或进一步验证，不许从遮阴模型推导未计算的气温变化或通风改善。
layout.thermal_assessment给出本次估测依据：夜间或低太阳高度时仍按温湿度与风速估测环境热风险，只排除太阳短波增量，不得写成夜间风险未评估或夜间必然安全。拆建热增量未求解与环境风险已估测是不同结论，不以夜间零差值评价建筑优劣，不擅自给夜间施加风险折扣。
不得推断具体人员已经患病，不写确诊、用药、处方、治疗、概率、施工批准或保证安全。热衰竭、热射病只能作为专业背景中的潜在健康关注，不能作为诊断结论。历史和模拟只讨论情景。每段解释以中文简明表达，优先解释因果，避免将免责声明反复作为主体。部分缺测不代表已知高热强度消失，也不将未标定错误表述为记录全部缺失。热指数未包含日晒辐射修正，不能据此声称同一报告的几何UTCI模型也未计入辐射；区分未求解的空气降温与已计算的遮阴、辐射热暴露变化，不要将前者局限概括为所有建筑效果均不可比较。"""
