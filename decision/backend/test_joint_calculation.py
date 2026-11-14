"""AI parameters must causally enter the physical calculation, with bounded inputs."""
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import hybrid, sandbox
from backend.aic.decision import fallback_analysis
from backend.aic.store import digest
from backend.test_hybrid import call, reply
from backend.test_sandbox import body, boundary


def proposals():
    return [{'height_factor':factor,'rationale':'根据当前遮阴和辐射基线比较高度。',
             'evidence_ids':['LAYOUT-NEIGHBOURHOOD','SOLAR']} for factor in [.6,1.4]]


def request_body():
    return body(scene={'additions':[{'id':'new-joint','longitude':113.528143,'latitude':34.813813,
        'width_m':20,'depth_m':20,'height_m':60}]},resolution_m=100)


class ParameterGuardTests(unittest.TestCase):
    def test_rejects_unbounded_unsubstantiated_and_duplicate_proposals(self):
        original=proposals()[0]
        invalid=[[],proposals()*2,[{**original,'height_factor':True}],
            [{**original,'height_factor':float('nan')}],[{**original,'height_factor':1.6}],
            [{**original,'height_factor':.4}],[{**original,'height_factor':1}],
            [original,original],[{**original,'temperature_c':20}],
            [{**original,'evidence_ids':['invented-source']}],[{**original,'rationale':''}],
            [{**original,'rationale':'预计降温2℃'}],[{**original,'rationale':'已验证有效'}]]
        for candidates in invalid:
            with self.subTest(candidates=candidates),self.assertRaises(ValueError):
                hybrid.validate_candidates(candidates)


class JointPlanningTests(unittest.IsolatedAsyncioTestCase):
    async def test_sequential_model_tool_calls_receive_results_and_execute_once(self):
        request=request_body().model_dump(mode='json');result=sandbox.simulate(request_body(),boundary())
        calculate=AsyncMock(return_value=result);compare=AsyncMock(return_value={'alternatives':[]});captured=[]
        sha=digest(request)

        async def remote(_url,**kwargs):
            payload=kwargs['json'];captured.append(payload)
            if len(captured)==1:
                return reply({'tool_calls':[call('recompute_current_scene',sha)]})
            self.assertEqual(payload['tool_choice']['function']['name'],'compare_layout_alternatives')
            physical=json.loads(payload['messages'][-1]['content'])
            self.assertEqual(physical['numerical_sha256'],hybrid.numerical_digest(result))
            return reply({'tool_calls':[call('compare_layout_alternatives',sha,'next',{'snapshot_sha256':sha,'candidates':proposals()})]})

        with patch.dict('os.environ',{'AIC_DEEPSEEK_API_KEY':'test-only'}),patch.object(httpx.AsyncClient,'post',side_effect=remote):
            _,trace,messages=await hybrid.run_tools(request,calculate,compare=compare)
        self.assertEqual(trace['planner']['status'],'accepted');self.assertEqual(trace['planner']['rounds'],2)
        calculate.assert_awaited_once();compare.assert_awaited_once_with(proposals())
        self.assertEqual(len([m for m in messages if m['role']=='tool']),2)

    async def test_replayed_tool_does_not_recalculate_or_create_unbounded_loop(self):
        request=request_body().model_dump(mode='json');result=sandbox.simulate(request_body(),boundary())
        calculate=AsyncMock(return_value=result);compare=AsyncMock(return_value={'alternatives':[]})
        response=reply({'tool_calls':[call('recompute_current_scene',digest(request))]})
        with patch.dict('os.environ',{'AIC_DEEPSEEK_API_KEY':'test-only'}),patch.object(httpx.AsyncClient,'post',return_value=response) as post:
            _,trace,messages=await hybrid.run_tools(request,calculate,compare=compare)
        self.assertEqual(trace['planner']['validation_code'],'repeated_tool_execution')
        self.assertEqual(post.call_count,2);calculate.assert_awaited_once();compare.assert_awaited_once()
        self.assertEqual(trace['layout_comparison']['proposal_origin'],'deterministic_fallback')
        self.assertEqual(messages,[])

    async def test_model_receives_physics_before_proposing_and_parameters_reach_tool(self):
        request=request_body().model_dump(mode='json')
        result=sandbox.simulate(request_body(),boundary())
        calculate=AsyncMock(return_value=result);compare=AsyncMock(return_value={'alternatives':[]})

        async def remote(_url,**kwargs):
            calculate.assert_awaited_once()
            context=json.loads(kwargs['json']['messages'][-1]['content'])
            self.assertEqual(context['physics_evidence']['LAYOUT-RESULT'],result['summary'])
            self.assertEqual(context['physics_evidence']['SOLAR'],result['solar'])
            self.assertEqual(context['new_building_dimensions'][0]['height_m'],60)
            sha=context['snapshot_sha256']
            return reply({'tool_calls':[call('recompute_current_scene',sha),
                call('compare_layout_alternatives',sha,'proposal',{'snapshot_sha256':sha,'candidates':proposals()})]})

        with patch.dict('os.environ',{'AIC_DEEPSEEK_API_KEY':'test-only'}),patch.object(httpx.AsyncClient,'post',side_effect=remote):
            _,trace,_=await hybrid.run_tools(request,calculate,compare=compare)
        calculate.assert_awaited_once();compare.assert_awaited_once_with(proposals())
        self.assertEqual(trace['layout_comparison']['proposal_origin'],'deepseek')
        self.assertEqual(trace['stages'],['physics_baseline','deepseek_parameter_proposals','physics_candidate_recalculation'])
        self.assertEqual(trace['baseline_numerical_sha256'],hybrid.numerical_digest(result))


class JointAPITests(unittest.TestCase):
    def test_height_clamp_does_not_create_duplicate_unchanged_candidate(self):
        request=request_body().model_dump(mode='json');request['scene']['additions'][0]['height_m']=120
        app=FastAPI();app.include_router(sandbox.router)
        with TestClient(app) as client,patch.dict('os.environ',{'AIC_DEEPSEEK_API_KEY':''}),patch.object(sandbox,'boundary_weather',AsyncMock(return_value=boundary())):
            response=client.post('/api/weather/sandbox/collaborate',json=request)
        self.assertEqual(response.status_code,200,response.text)
        result=response.json();comparison=result['orchestration']['layout_comparison']
        self.assertEqual(comparison['proposed_count'],2)
        self.assertEqual(len(comparison['alternatives']),1)
        self.assertEqual(comparison['alternatives'][0]['height_changes'][0]['height_m'],90)
        self.assertNotEqual(comparison['alternatives'][0]['scene_sha256'],result['scene_sha256'])

    def test_night_does_not_select_a_thermal_improvement_and_marks_rule_fallback(self):
        request=request_body().model_dump(mode='json')
        observation=boundary(observed_at='2024-06-12T23:00:00+08:00')
        app=FastAPI();app.include_router(sandbox.router)
        with TestClient(app) as client,patch.dict('os.environ',{'AIC_DEEPSEEK_API_KEY':''}),patch.object(sandbox,'boundary_weather',AsyncMock(return_value=observation)):
            result=client.post('/api/weather/sandbox/collaborate',json=request).json()
        comparison=result['orchestration']['layout_comparison']
        self.assertEqual(comparison['proposal_origin'],'deterministic_fallback')
        self.assertEqual(comparison['recommendation']['status'],'not_evaluable')
        self.assertIsNone(comparison['recommendation']['selected_candidate_id'])

    def test_ai_selected_parameters_recalculate_and_report_uses_actual_evidence(self):
        from backend.aic import router
        router._ai_budget.clear()
        request=request_body().model_dump(mode='json');request['regional']['use_ai']=True
        app=FastAPI();app.include_router(sandbox.router)

        async def remote(_url,**kwargs):
            payload=kwargs['json']
            if 'tools' in payload:
                sha=json.loads(payload['messages'][-1]['content'])['snapshot_sha256']
                return reply({'tool_calls':[call('recompute_current_scene',sha),
                    call('compare_layout_alternatives',sha,'compare',{'snapshot_sha256':sha,'candidates':proposals()})]})
            evidence=json.loads(payload['messages'][-1]['content'])
            return reply({'content':json.dumps({'fact_ids':[evidence['facts'][0]['id']],
                'action_ids':[evidence['management_checks'][0]['id']],
                'group_order':[c['group'] for c in evidence['cohort_contexts']],
                'decision_analysis':fallback_analysis(evidence['decision_context'],evidence['facts'],evidence['management_checks'])})})

        with TestClient(app) as client,patch.dict('os.environ',{'AIC_DEEPSEEK_API_KEY':'test-only'}),patch.object(sandbox,'boundary_weather',AsyncMock(return_value=boundary())) as weather,patch.object(httpx.AsyncClient,'post',side_effect=remote):
            response=client.post('/api/weather/sandbox/collaborate',json=request)
        self.assertEqual(response.status_code,200,response.text)
        result=response.json();comparison=result['orchestration']['layout_comparison']
        weather.assert_awaited_once()
        self.assertEqual(comparison['proposal_origin'],'deepseek')
        self.assertEqual([v['height_changes'][0]['height_m'] for v in comparison['alternatives']],[36,84])
        self.assertEqual([v['proposal'] for v in comparison['alternatives']],proposals())
        self.assertNotEqual(comparison['alternatives'][0]['numerical_sha256'],comparison['alternatives'][1]['numerical_sha256'])
        self.assertEqual(result['scene']['additions'][0]['height_m'],60)
        self.assertEqual(comparison,result['regional_report']['orchestration']['layout_comparison'])
        if comparison['recommendation']['selected_candidate_id']:
            selected=next(v for v in comparison['alternatives'] if v['id']==comparison['recommendation']['selected_candidate_id'])
            self.assertTrue(selected['same_valid_grid_support'])
            self.assertLess(selected['summary']['proposed_utci_c'],result['summary']['proposed_utci_c'])
        self.assertEqual(result['report_sha256'],digest({k:v for k,v in result.items() if k!='report_sha256'}))


if __name__=='__main__':
    unittest.main()
