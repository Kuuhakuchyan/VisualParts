"""Physical invariants and numerical integration, independent of map appearance."""
import math
import unittest

from pythermalcomfort.models import utci
from shapely.geometry import Point, box, shape
from shapely.ops import transform
from shapely.strtree import STRtree

from backend import sandbox
from backend.test_sandbox import body, boundary


class ThermalAccuracyTests(unittest.TestCase):
    def test_sky_integration_is_area_weighted_on_fixed_subcells(self):
        building=box(105,0,125,100)
        objects=[{"metric":building,"height":60}]
        tree=STRtree([building])
        ground=box(0,0,100,100)
        value=sandbox.outdoor_sky_view(ground,tree,objects)
        quadrants=[box(x,y,x+50,y+50) for x in [0,50] for y in [0,50]]
        expected=sum(sandbox.sky_view(p.representative_point(),tree,objects)*p.area for p in quadrants)/ground.area
        self.assertAlmostEqual(value,expected,places=12)
        self.assertGreater(value,0)
        self.assertLess(value,1)
        self.assertEqual(sandbox.outdoor_sky_view(ground,STRtree([]),[]),1)
        self.assertGreater(sandbox.outdoor_sky_view(ground,tree,[{"metric":building,"height":5}]),value)
        self.assertEqual(sandbox.outdoor_sky_view(ground,tree,objects),value)

    def test_mixed_cell_averages_sun_shade_utci_instead_of_utci_of_mean_mrt(self):
        result=sandbox.simulate(body(resolution_m=100),boundary())
        mixed=[c['properties'] for c in result['cells']['features']
               if c['properties']['baseline_utci_c'] is not None and 0<c['properties']['baseline_shade_fraction']<1]
        self.assertTrue(mixed)
        differences=[]
        for p in mixed:
            fraction=p['baseline_shade_fraction']
            values=utci(tdb=p['air_temperature_c'],tr=[p['baseline_sun_mrt_c'],p['baseline_shade_mrt_c']],
                        v=2,rh=p['humidity_pct'],round_output=False).utci
            expected=round(float(values[0]*(1-fraction)+values[1]*fraction),4)
            self.assertEqual(p['baseline_utci_c'],expected)
            old=float(utci(tdb=p['air_temperature_c'],tr=p['baseline_mrt_c'],v=2,rh=p['humidity_pct'],round_output=False).utci)
            differences.append(abs(expected-old))
        self.assertGreater(max(differences),0.0001)

    def test_one_building_cannot_heat_every_cell_or_change_distant_weather(self):
        outline=shape(sandbox.campus_boundary()['geometry'])
        west,south,east,north=outline.bounds
        request=body(regional={'bounds':dict(west=west,south=south,east=east,north=north),'use_ai':False},resolution_m=100)
        reference=sandbox.simulate(request,boundary())
        request.scene=sandbox.Scene(additions=[sandbox.Addition(id='new-local',longitude=113.528143,
            latitude=34.813813,width_m=20,depth_m=20,height_m=60)])
        changed=sandbox.simulate(request,boundary())
        origin=Point(*sandbox.TO_M(113.528143,34.813813))
        affected=distant=0
        for a,b in zip(reference['cells']['features'],changed['cells']['features']):
            p,q=a['properties'],b['properties']
            self.assertEqual(p['air_temperature_c'],q['air_temperature_c'])
            self.assertEqual(p['humidity_pct'],q['humidity_pct'])
            if q['delta_utci_c'] is not None:
                self.assertLessEqual(q['delta_utci_c'],0.0001)
                affected+=abs(q['delta_utci_c'])>=0.001
            if transform(sandbox.TO_M,shape(a['geometry'])).distance(origin)>450:
                distant+=1
                self.assertEqual(p['proposed_utci_c'],q['proposed_utci_c'])
        self.assertGreater(affected,0)
        self.assertLess(affected,len(changed['cells']['features'])//2)
        self.assertGreater(distant,10)
        self.assertEqual(changed['weather_boundary'],reference['weather_boundary'])
        self.assertEqual(changed['schema_version'],'solar-layout-screening-1.5')

    def test_unsupported_exposure_is_not_replaced_with_only_the_supported_fraction(self):
        result=sandbox.simulate(body(resolution_m=100),boundary(temperature_c=49))
        for cell in result['cells']['features']:
            p=cell['properties']
            if p['baseline_shade_fraction'] is not None and p['baseline_shade_fraction']<1:
                sun=utci(tdb=49,tr=p['baseline_sun_mrt_c'],v=2,rh=50,round_output=False).utci
                if not math.isfinite(float(sun)):
                    self.assertIsNone(p['baseline_utci_c'])


if __name__=='__main__':
    unittest.main()
