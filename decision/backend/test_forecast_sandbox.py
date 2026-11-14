"""Forecast frame time, geometry response and source consistency regression tests."""
import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import box, mapping, shape
from shapely.ops import transform

from backend import sandbox
from backend.aic.risk import assess_environment, assess_forecast
from backend.aic.store import digest
from backend.test_sandbox import body, boundary


def future_hour(hours=2):
    return (datetime.now(timezone.utc)+timedelta(hours=hours)).replace(minute=0,second=0,microsecond=0)


class ForecastTests(unittest.TestCase):
    def test_forecast_requires_aware_hour_and_bounded_horizon(self):
        for stamp in ["2026-10-26T14:00:00", future_hour(40).isoformat(), future_hour(-4).isoformat(),
                      (future_hour()+timedelta(minutes=1)).isoformat()]:
            with self.subTest(stamp=stamp), self.assertRaises(ValidationError):
                body(valid_time=stamp)
        valid=body(valid_time=future_hour().isoformat())
        self.assertEqual(valid.valid_time,future_hour())
        json.dumps(valid.model_dump(mode='json'))
        with self.assertRaises(ValidationError):
            body(valid_time=future_hour(),regional={**valid.regional.model_dump(),'mode':'history'})

    def test_future_records_never_become_current_measurements(self):
        obs=boundary(source_type='open_meteo_forecast',observed_at=future_hour().isoformat(),
                     retrieved_at=datetime.now(timezone.utc).isoformat())
        self.assertEqual(assess_environment(obs)['risk'],'unavailable')
        self.assertNotEqual(assess_forecast(obs)['risk'],'unavailable')
        self.assertTrue(assess_forecast(obs)['forecast_only'])
        self.assertEqual(assess_forecast({**obs,'retrieved_at':(datetime.now(timezone.utc)-timedelta(hours=3)).isoformat()})['risk'],'unavailable')

    def test_forecast_report_time_scene_cells_and_hash_agree(self):
        obs=boundary(source_type='open_meteo_forecast',observed_at=future_hour().isoformat(),
                     retrieved_at=datetime.now(timezone.utc).isoformat())
        value=body(valid_time=future_hour())
        app=FastAPI();app.include_router(sandbox.router)
        with TestClient(app) as client, patch.object(sandbox,'boundary_weather',return_value=obs):
            response=client.post('/api/weather/sandbox/simulate',json=value.model_dump(mode='json'))
        self.assertEqual(response.status_code,200,response.text)
        r=response.json();linked=r['regional_report']
        self.assertTrue(r['is_forecast'])
        self.assertEqual(r['valid_time'],obs['observed_at'])
        self.assertEqual(r['solar']['time'],r['valid_time'])
        self.assertEqual(linked['layout_exposure']['valid_time'],r['valid_time'])
        self.assertEqual(linked['case_type'],'forecast_scenario')
        self.assertTrue(all(not c['medical_advice'] for c in linked['cohorts']))
        self.assertGreater(len(linked['cells']['features']),1)
        for cell in linked['cells']['features']:
            self.assertEqual(cell['properties']['time'],r['valid_time'])
            self.assertEqual(cell['properties']['temperature_c'],obs['temperature_c'])
            self.assertEqual(cell['properties']['observation_id'],obs['id'])
        self.assertEqual(r['report_sha256'],digest({k:v for k,v in r.items() if k!='report_sha256'}))
        self.assertEqual(linked['report_sha256'],digest({k:v for k,v in linked.items() if k!='report_sha256'}))

    def test_distinct_hours_change_solar_geometry_and_thermal_values(self):
        request=body()
        a=sandbox.simulate(request,boundary(observed_at='2024-06-12T10:00:00+08:00'))
        b=sandbox.simulate(request,boundary(observed_at='2024-06-12T16:00:00+08:00',temperature_c=36,relative_humidity_pct=60))
        self.assertNotEqual(a['solar'],b['solar'])
        self.assertNotEqual(a['cells'],b['cells'])
        self.assertNotEqual(a['summary']['proposed_utci_c'],b['summary']['proposed_utci_c'])
        self.assertEqual(a['scene_sha256'],b['scene_sha256'])

    def test_weather_is_area_weighted_instead_of_picking_one_lcz_centre(self):
        request=body(resolution_m=100)
        initial=sandbox.simulate(request,boundary())
        cell=transform(sandbox.TO_M,shape(initial['cells']['features'][0]['geometry']))
        x,y,X,Y=cell.bounds;mid=(x+X)/2
        left,right=cell.intersection(box(x-1,y-1,mid,Y+1)),cell.intersection(box(mid,y-1,X+1,Y+1))
        scenario={'snapshot_sha256':'test','cells':{'features':[
            {'geometry':mapping(transform(sandbox.TO_LL,geo)),'properties':{'temperature_c':temp,'humidity_pct':50,'grid_id':str(temp)}}
            for geo,temp in [(left,10),(right,30)]]}}
        result=sandbox.simulate(request,boundary(),scenario)
        expected=(left.area*10+right.area*30)/(left.area+right.area)
        p=result['cells']['features'][0]['properties']
        self.assertAlmostEqual(p['air_temperature_c'],expected,places=4)
        self.assertGreater(p['weather_support_fraction'],.999)
        self.assertTrue(any(c['properties']['air_temperature_c'] is None for c in result['cells']['features'][1:]))


class ForecastBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        sandbox._weather_cache.clear();sandbox._weather_series_cache.clear()
        sandbox._weather_locks=[asyncio.Lock() for _ in range(32)]

    async def asyncTearDown(self):
        sandbox._weather_cache.clear();sandbox._weather_series_cache.clear()

    async def test_hours_share_upstream_series_but_never_share_selected_values(self):
        from backend.aic import router as aic
        stamps=[future_hour(2),future_hour(3)]
        fields=['temperature_2m','relative_humidity_2m','wind_speed_10m','direct_normal_irradiance_instant','diffuse_radiation_instant']
        calls=[]
        async def handle(request):
            calls.append(request)
            return httpx.Response(200,json={'latitude':34.816,'longitude':113.532,'utc_offset_seconds':28800,
                'hourly_units':dict(zip(fields,['°C','%','m/s','W/m²','W/m²'])),
                'hourly':{'time':[t.astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%dT%H:%M') for t in stamps],
                          **{k:v for k,v in zip(fields,[[30,35],[50,60],[2,3],[500,700],[80,120]])}}})
        client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with patch.object(sandbox.httpx,'AsyncClient',return_value=client),patch.object(aic.store,'put',side_effect=lambda r,raw:{**r,'id':digest(r)}):
            a=await sandbox.boundary_weather(body(valid_time=stamps[0]))
            b=await sandbox.boundary_weather(body(valid_time=stamps[1]))
            repeat=await sandbox.boundary_weather(body(valid_time=stamps[0]))
        self.assertEqual(len(calls),1)
        self.assertEqual(a['temperature_c'],30);self.assertEqual(b['temperature_c'],35)
        self.assertNotEqual(a['id'],b['id']);self.assertIs(a,repeat)
        self.assertEqual(datetime.fromisoformat(a['observed_at']),stamps[0])

    async def test_missing_forecast_hour_does_not_fall_back_to_current(self):
        from backend.aic import router as aic
        # A verified current-hour series cannot supply an absent forecast hour.
        await self.test_hours_share_upstream_series_but_never_share_selected_values()
        with self.assertRaisesRegex(ValueError,'同刻'):
            await sandbox.boundary_weather(body(valid_time=future_hour(5)))
