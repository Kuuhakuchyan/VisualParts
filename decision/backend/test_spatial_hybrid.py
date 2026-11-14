"""Spatial evidence, physics-emulator gates and immutable candidate comparisons."""
import json
import unittest
from unittest.mock import AsyncMock, patch

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import box
from shapely.strtree import STRtree

from backend import hybrid, neighbourhood, sandbox, spatial_surrogate
from backend.aic.store import digest
from backend.test_hybrid import call
from backend.test_sandbox import body, boundary


class SpatialEmulatorTests(unittest.TestCase):
    def test_artifact_has_heldout_physics_evidence_and_no_field_accuracy_claim(self):
        model=spatial_surrogate.artifact()
        self.assertGreater(model['sample_counts']['test'],1000)
        self.assertFalse(model['field_calibrated'])
        self.assertLess(model['evaluation']['test']['max_abs_error_c'],.02)
        self.assertIn('not_field',model['training_origin'])

    def test_runtime_checks_values_applicability_and_rejects_tampering(self):
        from pythermalcomfort.models import utci
        t=np.array([20.,35.,40.,20.]);rh=np.array([50.,50.,50.,50.]);v=np.array([2.,2.,2.,.1]);mrt=t+np.array([0.,20.,30.,0.])
        physics=utci(tdb=t,tr=mrt,v=v,rh=rh,round_output=False).utci
        selected,prediction,accepted=spatial_surrogate.checked_predict(t,mrt,v,rh,physics)
        self.assertTrue(accepted[:3].all());self.assertFalse(accepted[3]);self.assertTrue(np.isnan(selected[3]))
        np.testing.assert_allclose(selected[:3],physics[:3],atol=1e-5)
        with patch.object(spatial_surrogate,'artifact',side_effect=ValueError('bad checksum')):
            selected,_,accepted=spatial_surrogate.checked_predict(t,mrt,v,rh,physics)
        self.assertFalse(accepted.any());np.testing.assert_allclose(selected,physics,equal_nan=True)

    def test_morphology_changes_only_with_local_geometry_and_height(self):
        cell=box(0,0,20,20);footprint=box(25,0,45,20)
        def calc(height):
            return neighbourhood.morphology(cell,STRtree([footprint]),[{'metric':footprint,'height':height}])
        low,high=calc(10),calc(40)
        self.assertEqual(low['50']['building_count'],1)
        self.assertEqual(low['50']['plan_area_fraction'],high['50']['plan_area_fraction'])
        self.assertGreater(high['50']['area_weighted_height_m'],low['50']['area_weighted_height_m'])
        self.assertEqual(calc(10),low)

    def test_grid_outputs_link_learning_features_mechanisms_and_same_weather(self):
        result=sandbox.simulate(body(resolution_m=100),boundary())
        self.assertTrue(result['spatial_inference']['available'])
        self.assertGreater(result['spatial_inference']['accepted_cell_scenarios'],0)
        self.assertEqual(result['neighbourhood']['computed_cells'],len(result['cells']['features']))
        for f in result['cells']['features']:
            p=f['properties']
            self.assertEqual(set(p['baseline_neighbourhood']),{'50','150','300'})
            self.assertEqual(p['baseline_neighbourhood'],p['proposed_neighbourhood'])
            self.assertEqual(p['baseline_utci_c'],p['proposed_utci_c'])
            self.assertEqual(p['neighbourhood_effect']['mechanisms'],[])
            self.assertEqual(p['delta_utci_c'] or 0,0)


class CandidateTests(unittest.TestCase):
    def test_cloud_comparison_tool_must_be_eligible_and_use_exact_snapshot(self):
        sha='a'*64
        calls=[call('recompute_current_scene',sha),call('compare_layout_alternatives',sha,'compare',{
            'snapshot_sha256':sha,'candidates':[{'height_factor':.8,'rationale':'比较高度与遮阴关系','evidence_ids':['SOLAR']}]} )]
        self.assertEqual(len(hybrid.validate_calls({'tool_calls':calls},sha,False,True)),2)
        with self.assertRaises(ValueError):hybrid.validate_calls({'tool_calls':calls},sha,False,False)
        with self.assertRaises(ValueError):hybrid.validate_calls({'tool_calls':calls[:1]},sha,False,True)
        calls[1]['function']['arguments']=json.dumps({'snapshot_sha256':sha,'height_m':1000})
        with self.assertRaises(ValueError):hybrid.validate_calls({'tool_calls':calls},sha,False,True)

    def test_comparison_reuses_weather_and_never_applies_alternative(self):
        request=body(scene={'additions':[{'id':'new-candidate','longitude':113.528143,'latitude':34.813813,
            'width_m':20,'depth_m':20,'height_m':60}]},resolution_m=100)
        app=FastAPI();app.include_router(sandbox.router)
        with TestClient(app) as client,patch.object(sandbox,'boundary_weather',AsyncMock(return_value=boundary())) as weather,patch.dict('os.environ',{'AIC_DEEPSEEK_API_KEY':''}):
            response=client.post('/api/weather/sandbox/collaborate',json=request.model_dump(mode='json'))
        self.assertEqual(response.status_code,200,response.text)
        result=response.json();comparison=result['orchestration']['layout_comparison']
        weather.assert_awaited_once()
        self.assertEqual(result['scene']['additions'][0]['height_m'],60)
        self.assertEqual(comparison['reference_scene_sha256'],result['scene_sha256'])
        self.assertEqual(comparison['weather_id'],result['weather_boundary']['id'])
        self.assertFalse(comparison['scene_applied'])
        self.assertEqual([v['height_changes'][0]['height_m'] for v in comparison['alternatives']],[45,75])
        for v in comparison['alternatives']:
            self.assertEqual(v['summary']['comparable_area_m2'],result['summary']['comparable_area_m2'])
        self.assertIn('LAYOUT-NEIGHBOURHOOD',{f['id'] for f in result['regional_report']['facts']})
        self.assertIn('LAYOUT-ALTERNATIVES',{f['id'] for f in result['regional_report']['facts']})
        self.assertEqual(result['report_sha256'],digest({k:v for k,v in result.items() if k!='report_sha256'}))


if __name__=='__main__':
    unittest.main()
