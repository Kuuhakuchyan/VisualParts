"""Bounded cloud tool planning over immutable, CPU-only scientific models."""

import json
import math
import os
import re

import httpx

from backend.aic.generation import _MODEL_SLOTS
from backend.aic.store import digest
from backend.temporal import artifact, predict

VERSION = "hybrid-tool-workflow/1.2"
TOOL_NAMES = {"recompute_current_scene", "predict_station_forecast", "compare_layout_alternatives"}
PROPOSAL_EVIDENCE = ['LAYOUT-RESULT', 'LAYOUT-NEIGHBOURHOOD', 'SOLAR']


def validate_candidates(candidates):
    if not isinstance(candidates,list) or not 1 <= len(candidates) <= 3:
        raise ValueError('invalid_candidate_count')
    seen=set()
    for candidate in candidates:
        if not isinstance(candidate,dict) or set(candidate)!={'height_factor','rationale','evidence_ids'}:
            raise ValueError('unsupported_candidate_parameters')
        factor=candidate['height_factor']
        if (isinstance(factor,bool) or not isinstance(factor,(int,float)) or not math.isfinite(factor)
                or not .5 <= factor <= 1.5 or abs(factor-1)<.01 or round(factor,3) in seen):
            raise ValueError('invalid_height_factor')
        seen.add(round(factor,3))
        if (not isinstance(candidate['rationale'],str) or not 1 <= len(candidate['rationale'].strip()) <= 240
                or re.search(r'\d|[%％℃]|已验证|已证实|实测温降',candidate['rationale'])):
            raise ValueError('invalid_candidate_rationale')
        ids=candidate['evidence_ids']
        if not isinstance(ids,list) or not 1 <= len(ids) <= 3 or any(x not in PROPOSAL_EVIDENCE for x in ids):
            raise ValueError('unsupported_candidate_evidence')
    return candidates


def model_manifest():
    from backend.spatial_surrogate import manifest
    try:
        model = artifact()
        temporal = {"available": True, "method": "trained_temporal_ridge",
                    "horizon_minutes": model["horizon_minutes"], "source_sha256": model["source_sha256"],
                    "sample_counts": model["sample_counts"], "evaluation": model["evaluation"],
                    "required_input": "7 consecutive timezone-aware observations at 5-minute cadence"}
    except (OSError, ValueError, KeyError):
        temporal = {"available": False, "reason": "artifact_unavailable"}
    return {"numerical": {"method": "geometry_solarcal_utci", "executor": "server_cpu",
                          "outputs": ["shade", "mrt", "utci", "area_exposure"],
                          "not_supported": ["validated_building_air_temperature_delta", "clinical_diagnosis"]},
            "temporal": temporal, "spatial_emulator":manifest(),
            "division": "Physics baseline -> DeepSeek proposes bounded parameters -> physics recalculates candidates -> grounded assessment."
                         " Station forecasts do not replace the geometry scenario weather boundary."}


def numerical_digest(result):
    return digest({k: result[k] for k in ("scene_sha256", "geometry_sha256", "weather_boundary", "summary", "cells")})


def tools_schema(snapshot_sha256, station_available, comparison_available=False):
    descriptions = {"recompute_current_scene": "Recompute the immutable current scene using local geometry, radiation and UTCI models. Always call this once.",
                    "predict_station_forecast": "Run the locally trained 15-minute station model on the supplied validated-cadence window. Does not predict building-induced temperature changes.",
                    "compare_layout_alternatives":"Propose 1-3 distinct height-factor alternatives based on computed heat mechanisms, weather, solar position and building dimensions. The local solver applies your factors to new buildings and recomputes every grid with the same weather and footprints. Cite supplied evidence IDs and a short Chinese hypothesis. Does not apply scene edits."}
    names = ["recompute_current_scene"] + (["predict_station_forecast"] if station_available else []) + (["compare_layout_alternatives"] if comparison_available else [])
    tools=[]
    for name in names:
        properties={'snapshot_sha256':{'type':'string','enum':[snapshot_sha256]}}
        if name=='compare_layout_alternatives':
            properties['candidates']={'type':'array','minItems':1,'maxItems':3,'items':{
                'type':'object','properties':{
                    'height_factor':{'type':'number','minimum':.5,'maximum':1.5,'description':'Distinct from 1.0; height is clamped to 2-120 m.'},
                    'rationale':{'type':'string','minLength':1,'maxLength':240,
                        'description':'Short qualitative Chinese hypothesis ONLY. No digits, percentages, units, grid IDs or numerical estimates. Numerical parameters belong in height_factor; effects come only from the solver.'},
                    'evidence_ids':{'type':'array','minItems':1,'maxItems':3,'items':{'type':'string','enum':PROPOSAL_EVIDENCE}}},
                'required':['height_factor','rationale','evidence_ids'],'additionalProperties':False}}
        tools.append({'type':'function','function':{'name':name,'description':descriptions[name],
            'parameters':{'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}}})
    return tools


def validate_calls(message, snapshot_sha256, station_available, comparison_available=False, require_all=True):
    calls = message.get("tool_calls")
    if not isinstance(calls, list) or not 1 <= len(calls) <= 3:
        raise ValueError("missing_or_excessive_tool_calls")
    accepted, names, ids = [], set(), set()
    for call in calls:
        name, call_id = call["function"]["name"], call["id"]
        arguments = json.loads(call["function"]["arguments"])
        if (call.get("type") != "function" or name not in TOOL_NAMES or name in names
                or not isinstance(call_id, str) or not 1 <= len(call_id) <= 128 or call_id in ids
                or not isinstance(arguments,dict) or arguments.get('snapshot_sha256')!=snapshot_sha256
                or name == "predict_station_forecast" and not station_available):
            raise ValueError("rejected_tool_call")
        if name=="compare_layout_alternatives" and not comparison_available:
            raise ValueError("comparison_unavailable")
        if name=='compare_layout_alternatives':
            if set(arguments)!={'snapshot_sha256','candidates'}:
                raise ValueError('unsupported_comparison_arguments')
            validate_candidates(arguments['candidates'])
        elif arguments!={'snapshot_sha256':snapshot_sha256}:
            raise ValueError('unsupported_tool_arguments')
        names.add(name); ids.add(call_id)
        accepted.append({"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}})
    if require_all and "recompute_current_scene" not in names:
        raise ValueError("required_computation_missing")
    if require_all and station_available and "predict_station_forecast" not in names:
        raise ValueError("station_computation_missing")
    if require_all and comparison_available and "compare_layout_alternatives" not in names:
        raise ValueError("comparison_missing")
    return accepted


async def run_tools(snapshot, calculate, station_window=None, enabled=True, denial_reason=None, compare=None):
    """Bounded sequential tool use: physics -> AI parameters -> physics feedback."""
    snapshot_sha256 = digest(snapshot)
    manifest = model_manifest()
    station_available = station_window is not None and manifest["temporal"]["available"]
    comparison_available = compare is not None and bool(snapshot['scene']['additions'])
    # Parameter proposals must be conditioned on a real computed baseline.
    result = await calculate()
    model, key = os.getenv("AIC_DEEPSEEK_MODEL", "deepseek-chat"), os.getenv("AIC_DEEPSEEK_API_KEY", "")
    reason = denial_reason or ("ai_disabled" if not enabled else "model_not_configured" if not key else None)
    trace = {"schema_version": VERSION, "snapshot_sha256": snapshot_sha256, "model_manifest": manifest,
             "planner": {"model": model if key else None, "status": "not_called", "reason": reason},
             "tools": [], "station_forecast": None, "layout_comparison":None,
             "baseline_numerical_sha256":numerical_digest(result), "stages":['physics_baseline'],
             "deepseek_weights_modified": False,
             "raw_training_data_sent": False, "boundary_policy": "unchanged_by_llm_or_station_forecast"}
    # No scene name, coordinates, raw source files, station ID or raw observation window leaves this server.
    context = {"snapshot_sha256": snapshot_sha256, "models": manifest,
               "scene": {"added_buildings": len(snapshot["scene"]["additions"]),
                         "removed_buildings": len(snapshot["scene"]["removed_ids"]),
                         "resolution_m": snapshot["resolution_m"], "data_mode": snapshot["regional"]["data_mode"],
                         "weather_mode": snapshot["regional"]["mode"]},
               "station_window_available": station_available,"layout_comparison_available":comparison_available,
               "physics_evidence":{'LAYOUT-RESULT':result['summary'],
                   'LAYOUT-NEIGHBOURHOOD':result.get('neighbourhood'),'SOLAR':result.get('solar')},
               "weather":{k:result['weather_boundary'].get(k) for k in ['temperature_c','relative_humidity_pct']},
               "new_building_dimensions":[{k:a[k] for k in ['width_m','depth_m','height_m','rotation_deg']} for a in snapshot['scene']['additions']]}
    messages = [{"role": "user", "content": json.dumps(context, ensure_ascii=False)}]
    outputs={}

    async def execute(call,trigger):
        name = call["function"]["name"]
        if name in outputs:
            return outputs[name]
        if name == "recompute_current_scene":
            output = {"numerical_sha256": numerical_digest(result), "scene_sha256": result["scene_sha256"],
                      "summary": result["summary"], "time": result["weather_boundary"]["observed_at"],
                      "validation": result["validation"], "limitations": result["limitations"],
                      "neighbourhood":result.get('neighbourhood'),"spatial_inference":result.get('spatial_inference')}
        elif name=="compare_layout_alternatives":
            try:
                candidates=json.loads(call['function']['arguments'])['candidates']
                trace['stages'].append('deepseek_parameter_proposals' if trigger=='deepseek' else 'rule_parameter_proposals')
                trace['layout_comparison']=await compare(candidates)
                trace['layout_comparison']['proposal_origin']=trigger
                trace['stages'].append('physics_candidate_recalculation')
                output=trace['layout_comparison']
            except (ValueError,KeyError,TypeError):
                output={'error':'comparison_unavailable','scene_changed':False}
        else:
            try:
                forecast = predict(station_window, artifact())
                trace["station_forecast"] = forecast
                output = {k: forecast[k] for k in ("source_type", "issued_from", "valid_at", "predicted", "evaluation", "note")}
            except (OSError, ValueError, KeyError, TypeError):
                output = {"error": "station_model_unavailable", "boundary_changed": False}
        trace["tools"].append({"name": name, "trigger":trigger,
                               'arguments':json.loads(call['function']['arguments']),
                               "executor": "server_cpu", "status": "failed" if "error" in output else "completed", "output_sha256": digest(output)})
        outputs[name]=output
        return output

    declared=tools_schema(snapshot_sha256,station_available,comparison_available)
    expected={t['function']['name'] for t in declared}
    instruction="You coordinate a scientific heat-risk sandbox. A physical baseline has already been computed. Call recompute_current_scene once to retrieve it, then use its actual returned evidence. Also call predict_station_forecast when available and compare_layout_alternatives when available. For comparison YOU must propose 1-3 distinct height_factor values (0.5-1.5, not 1.0) based on supplied weather, solar geometry, local heat mechanisms and building dimensions. Each rationale MUST be a short qualitative Chinese hypothesis with NO digits, percentages, temperature units, grid IDs or quantitative estimates. Put numerical parameters ONLY in height_factor and citations ONLY in evidence_ids. Example rationale: 降低体块高度，比较遮阴减少与天空遮挡减弱后的局部热暴露。 Effects must come from subsequent physics, not your numerical guesses. Your parameters feed back into physical equations for per-grid recalculation. Prefer useful smaller/larger-height comparisons if appropriate. Never alter weather, physical constants or safety rules. At night storage/ventilation is not resolved, so comparison cannot establish night-time thermal improvement. The learned emulator is distilled from physics, not calibrated field microclimate. Invoke only remaining tools; results will be returned for the final assessment."
    trace['planner']['rounds']=0
    if enabled and key and not reason:
        try:
            seen_ids=set()
            for _ in range(3):
                remaining=[t for t in declared if t['function']['name'] not in outputs]
                choice=({'type':'function','function':{'name':remaining[0]['function']['name']}}
                        if len(remaining)==1 else 'auto')
                async with _MODEL_SLOTS:
                    async with httpx.AsyncClient(timeout=15) as client:
                        trace['planner']['rounds']+=1
                        response=await client.post('https://api.deepseek.com/chat/completions',
                            headers={'Authorization':'Bearer '+key},json={'model':model,'temperature':0,'max_tokens':1400,
                            'messages':[{'role':'system','content':instruction},*messages],
                            'tools':remaining,'tool_choice':choice})
                        response.raise_for_status()
                        calls=validate_calls(response.json()['choices'][0]['message'],snapshot_sha256,
                                             station_available,comparison_available,require_all=False)
                if any(c['function']['name'] in outputs or c['id'] in seen_ids for c in calls):
                    raise ValueError('repeated_tool_execution')
                seen_ids.update(c['id'] for c in calls)
                messages.append({'role':'assistant','content':None,'tool_calls':calls})
                for call in sorted(calls,key=lambda c:c['function']['name']!='recompute_current_scene'):
                    output=await execute(call,'deepseek')
                    messages.append({'role':'tool','tool_call_id':call['id'],'content':json.dumps(output,ensure_ascii=False)})
                if expected.issubset(outputs):
                    trace['planner'].update(status='accepted',reason=None)
                    break
            else:
                raise ValueError('incomplete_tool_workflow')
        except (httpx.HTTPError,ValueError,KeyError,TypeError,IndexError,AttributeError) as error:
            codes={'repeated_tool_execution','incomplete_tool_workflow','missing_or_excessive_tool_calls',
                   'invalid_candidate_count','unsupported_candidate_parameters','invalid_height_factor',
                   'invalid_candidate_rationale','unsupported_candidate_evidence','unsupported_comparison_arguments',
                   'rejected_tool_call','comparison_unavailable','unsupported_tool_arguments'}
            trace['planner'].update(status='rejected',reason='model_unavailable_or_output_rejected',
                failure_type='timeout' if isinstance(error,httpx.TimeoutException) else 'upstream_http' if isinstance(error,httpx.HTTPError) else 'output_validation',
                validation_code=str(error) if str(error) in codes else None)
    if trace['planner']['status']!='accepted':
        for name in sorted(expected-outputs.keys(),key=lambda n:n!='recompute_current_scene'):
            arguments={'snapshot_sha256':snapshot_sha256}
            if name=='compare_layout_alternatives':
                arguments['candidates']=[{'height_factor':factor,'rationale':'规则备选，用于同边界高度敏感性计算。',
                    'evidence_ids':['LAYOUT-RESULT']} for factor in [.75,1.25]]
            await execute({'function':{'name':name,'arguments':json.dumps(arguments)}},'deterministic_fallback')
    trace["numerical_sha256"] = numerical_digest(result)
    trace["station_status"] = ("predicted" if trace["station_forecast"] else "tool_failed_or_not_selected" if station_available
                               else "artifact_unavailable" if station_window is not None else "no_eligible_window")
    return result, trace, messages if trace["planner"]["status"] == "accepted" else []
