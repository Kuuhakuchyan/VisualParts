"""District geometry, context isolation and actual physical recomputation."""
import json
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import Point, box, shape
from shapely.ops import transform

from backend import sandbox
from backend.aic.store import digest
from backend.test_sandbox import boundary


class DistrictModelTests(unittest.TestCase):
    def test_independent_model_and_disclosed_simulation(self):
        data = sandbox.buildings('neighborhood')
        self.assertGreater(len(data['features']), 100)
        self.assertGreater(data['coverage']['public_footprints'], 0)
        self.assertEqual(data['coverage']['simulated_buildings'], 0)
        self.assertGreater(data['coverage']['public_footprints'], 700)
        self.assertEqual(data['coverage']['count'], data['coverage']['public_footprints']+data['coverage']['simulated_buildings'])
        self.assertTrue(all(shape(f['geometry']).is_valid for f in data['features']))
        campus_ids = {f['id'] for f in sandbox.buildings()['features']}
        self.assertFalse(campus_ids.intersection(f['id'] for f in data['features']))
        self.assertNotIn('郑州大学', json.dumps(data, ensure_ascii=False))
        self.assertTrue(all(f['properties']['height_m'] is None for f in data['features']))

    def test_merged_public_footprints_are_independently_removable(self):
        features = sandbox.buildings('neighborhood')['features']
        self.assertTrue(all(f['geometry']['type']=='Polygon' for f in features))
        self.assertEqual(len(features), len({f['id'] for f in features}))
        self.assertEqual(len(features), len({shape(f['geometry']).normalize().wkb for f in features}))
        scene = sandbox.Scene(area_kind='neighborhood', removed_ids=[features[0]['id']])
        baseline, proposed = sandbox.scene_geometry(scene)
        self.assertEqual(len(baseline)-1, len(proposed))

    def test_cross_context_removal_and_simulation_rejected(self):
        key = sandbox.buildings('neighborhood')['features'][0]['id']
        with self.assertRaises(ValidationError):
            sandbox.Scene(removed_ids=[key])
        scene = sandbox.Scene(area_kind='neighborhood', removed_ids=[key])
        base, proposed = sandbox.scene_geometry(scene)
        self.assertEqual(len(base)-1, len(proposed))
        self.assertNotIn(key, {f['id'] for f in proposed})
        with self.assertRaises(ValidationError):
            sandbox.SimulationInput(scene=scene, regional={'bounds':{'west':113.60,'east':113.62,'south':34.74,'north':34.76}})

    def test_api_context_defaults_and_invalid_query(self):
        app = FastAPI(); app.include_router(sandbox.router)
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/weather/sandbox/buildings').json()['area_kind'], 'campus')
            data = client.get('/api/weather/sandbox/buildings?area_kind=neighborhood').json()
            self.assertEqual(data['area_kind'], 'neighborhood')
            self.assertEqual(len(data['features']), sandbox.buildings('neighborhood')['coverage']['count'])
            self.assertEqual(client.get('/api/weather/sandbox/buildings?area_kind=invalid').status_code, 422)
            b = client.get('/api/weather/sandbox/boundary?area_kind=neighborhood').json()
            self.assertEqual(list(shape(b['geometry']).bounds), data['bbox'])

    def test_district_addition_removal_and_field_recalculation(self):
        data = sandbox.buildings('neighborhood')
        coverage = transform(sandbox.TO_M, box(*data['bbox']))
        interior = [f for f in data['features'] if coverage.covers(sandbox.metric_shape(f['geometry']).representative_point().buffer(150))]
        f = max(interior, key=lambda f:sandbox.metric_shape(f['geometry']).area)
        p = sandbox.metric_shape(f['geometry']).representative_point()
        # Replace one real footprint; both scenarios retain comparable outdoor cells.
        longitude, latitude = sandbox.TO_LL(p.x, p.y)
        addition = sandbox.Addition(id='new-district-test', longitude=longitude, latitude=latitude, width_m=6, depth_m=10, height_m=90)
        scene = sandbox.Scene(area_kind='neighborhood', additions=[addition], removed_ids=[f['id']])
        base, proposed = sandbox.scene_geometry(scene)
        self.assertIn(addition.id, {item['id'] for item in proposed})
        b = transform(sandbox.TO_LL, box(p.x-75,p.y-75,p.x+105,p.y+75)).bounds
        request = sandbox.SimulationInput(scene=scene, regional={'area_kind':'neighborhood','bounds':dict(zip(['west','south','east','north'],b)),'use_ai':False}, resolution_m=30)
        observation = boundary(location={'longitude':longitude,'latitude':latitude})
        result = sandbox.simulate(request, observation)
        self.assertEqual(result['geometry_sha256'], digest(data))
        self.assertEqual(result['area']['label'], '某街区')
        self.assertGreater(len(result['cells']['features']), 10)
        self.assertTrue(any(abs(f['properties']['delta_utci_c'] or 0)>0.001 for f in result['cells']['features']))
        self.assertEqual(result['scene']['area_kind'], 'neighborhood')
        self.assertEqual(result['geometry_coverage']['simulated_buildings'], 0)

    def test_outside_district_proposal_rejected(self):
        scene = sandbox.Scene(area_kind='neighborhood', additions=[sandbox.Addition(id='new-wrong',longitude=113.53,latitude=34.82,width_m=10,depth_m=10,height_m=20)])
        with self.assertRaises(ValueError):
            sandbox.scene_geometry(scene)


if __name__ == '__main__':
    unittest.main()
