"""Reproducible LCZ background/geometry invariants, not field-accuracy validation."""
import copy
import unittest

from shapely.geometry import Point, shape
from shapely.ops import transform

from backend import lcz, sandbox
from backend.test_sandbox import body, boundary


class LCZLayoutLineageTests(unittest.TestCase):
    def request(self):
        return body(regional={'bounds':{'west':113.526,'east':113.534,'south':34.811,'north':34.819},
            'data_mode':'lcz_simulation','grid_resolution_m':30,'mode':'history','use_ai':False}, resolution_m=30)

    def test_new_building_preserves_initial_background_and_only_changes_local_thermal_exposure(self):
        request = self.request()
        obs = boundary()
        scenario = lcz.build_scenario(request.regional, obs)
        initial = copy.deepcopy(scenario)
        baseline = sandbox.simulate(request, obs, scenario)
        request.scene = sandbox.Scene(additions=[sandbox.Addition(id='new-local',longitude=113.528143,
            latitude=34.813813,width_m=20,depth_m=20,height_m=60)])
        built = sandbox.simulate(request, obs, scenario)
        self.assertEqual(scenario, initial)
        self.assertEqual(built['lcz_snapshot_sha256'], baseline['lcz_snapshot_sha256'])
        self.assertEqual(built['weather_boundary'], baseline['weather_boundary'])
        origin = Point(*sandbox.TO_M(113.528143,34.813813))
        far = changed = 0
        for before, after in zip(baseline['cells']['features'],built['cells']['features']):
            p,q=before['properties'],after['properties']
            self.assertEqual(before['geometry'], after['geometry'])
            self.assertEqual(p['grid_id'],q['grid_id'])
            self.assertEqual(p['air_temperature_c'],q['air_temperature_c'])
            self.assertEqual(p['humidity_pct'],q['humidity_pct'])
            changed += q['delta_utci_c'] is not None and abs(q['delta_utci_c']) >= .001
            if transform(sandbox.TO_M,shape(after['geometry'])).distance(origin)>450:
                far += 1
                self.assertEqual(p['proposed_utci_c'],q['proposed_utci_c'])
        self.assertGreater(changed,0)
        self.assertLess(changed,len(built['cells']['features'])//2)
        self.assertGreater(far,10)
        self.assertEqual(sandbox.simulate(self.request(),obs,scenario)['cells'],baseline['cells'])

    def test_hour_changes_reuse_classification_and_edits_never_accumulate_into_next_hour_background(self):
        request = self.request()
        signatures=[]
        for stamp,temp in [('2024-06-12T10:00:00+08:00',29),('2024-06-12T14:00:00+08:00',34),('2024-06-12T20:00:00+08:00',30)]:
            obs=boundary(id='obs_'+stamp,observed_at=stamp,temperature_c=temp)
            first=lcz.build_scenario(request.regional,obs)
            keys=[(c['id'],c['geometry'],c['properties']['lcz_fractions']) for c in first['cells']['features']]
            signatures.append(keys)
            repeated=lcz.build_scenario(request.regional,obs)
            self.assertEqual(first['snapshot_sha256'],repeated['snapshot_sha256'])
            self.assertEqual(first['cells'],repeated['cells'])
        self.assertEqual(signatures[0],signatures[1])
        self.assertEqual(signatures[1],signatures[2])

    def test_demolition_rebuild_and_original_baseline_never_remove_original_geometry(self):
        request=self.request()
        base,_=sandbox.scene_geometry(request.scene)
        request.scene=sandbox.Scene(removed_ids=[base[0]['id']])
        original,removed=sandbox.scene_geometry(request.scene)
        self.assertEqual([f['id'] for f in base],[f['id'] for f in original])
        self.assertEqual(len(removed),len(base)-1)
        restored,_=sandbox.scene_geometry(sandbox.Scene())
        self.assertEqual([f['id'] for f in base],[f['id'] for f in restored])

    def test_hourly_construction_and_demolition_reuse_each_hours_original_field_without_accumulation(self):
        request=body(regional={'bounds':{'west':113.527,'east':113.531,'south':34.812,'north':34.816},
            'data_mode':'lcz_simulation','grid_resolution_m':30,'mode':'history','use_ai':False},resolution_m=30)
        base,_=sandbox.scene_geometry(request.scene)
        scene=sandbox.Scene(removed_ids=[base[0]['id']],additions=[sandbox.Addition(id='new-hourly',
            longitude=113.528143,latitude=34.813813,width_m=20,depth_m=20,height_m=60)])
        signatures=[]
        for hour,temp in [(10,29),(14,34),(10,29)]:
            stamp=f'2024-06-12T{hour:02d}:00:00+08:00'
            obs=boundary(id='obs_'+stamp,observed_at=stamp,temperature_c=temp)
            initial=lcz.build_scenario(request.regional,obs)
            untouched=copy.deepcopy(initial)
            request.scene=sandbox.Scene()
            baseline=sandbox.simulate(request,obs,initial)
            request.scene=scene
            proposed=sandbox.simulate(request,obs,initial)
            self.assertEqual(initial,untouched)
            self.assertEqual(proposed['lcz_snapshot_sha256'],baseline['lcz_snapshot_sha256'])
            self.assertEqual(proposed['weather_boundary'],baseline['weather_boundary'])
            self.assertEqual(proposed['scene']['removed_ids'],scene.removed_ids)
            self.assertEqual(proposed['scene']['additions'][0]['id'],'new-hourly')
            for before,after in zip(baseline['cells']['features'],proposed['cells']['features']):
                p,q=before['properties'],after['properties']
                self.assertEqual(before['geometry'],after['geometry'])
                self.assertEqual(p['air_temperature_c'],q['air_temperature_c'])
                self.assertEqual(p['humidity_pct'],q['humidity_pct'])
                # Building footprints change the common outdoor comparison area.
                if abs(p['comparable_area_m2']-q['comparable_area_m2'])<.01:
                    self.assertEqual(p['baseline_utci_c'],q['baseline_utci_c'])
            signatures.append(proposed['cells'])
        self.assertEqual(signatures[0],signatures[2])
        self.assertNotEqual(signatures[0],signatures[1])


if __name__=='__main__':
    unittest.main()
