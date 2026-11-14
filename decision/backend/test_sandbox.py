"""Reproducible software/geometry checks; not field validation of microclimate."""

import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import Polygon, box, shape

from backend import sandbox
from backend.aic.regional import RegionalRequest
from backend.aic.test_regional import observation


def body(**changes):
    value = {"scene": {"name": "test"}, "regional": {"bounds": {"west":113.530,"east":113.533,"south":34.815,"north":34.818},"use_ai":False},"resolution_m":50}
    value.update(changes)
    return sandbox.SimulationInput.model_validate(value)


def boundary(**changes):
    result = {"id":"obs_"+"a"*64,"source_type":"historical_weather","observed_at":"2024-06-12T14:00:00+08:00","temperature_c":32,"relative_humidity_pct":50,
              "units":{"temperature":"°C","humidity":"%"},"quality_status":"validated","location":{"longitude":113.531,"latitude":34.814},
              "extras":{"wind_speed_10m":2,"direct_normal_irradiance_wm2":700,"diffuse_radiation_wm2":120}}
    result.update(changes)
    return result


class BoundaryRetryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        sandbox._weather_cache.clear()
        sandbox._weather_series_cache.clear()
        sandbox._weather_locks=[asyncio.Lock() for _ in range(32)]

    async def asyncTearDown(self):
        sandbox._weather_cache.clear()
        sandbox._weather_series_cache.clear()

    async def test_transient_failure_retries_and_reuses_verified_snapshot(self):
        from backend.aic import router as aic
        calls=[]
        async def handle(request):
            calls.append(request)
            if len(calls)==1:
                raise httpx.ReadTimeout('synthetic',request=request)
            fields=['temperature_2m','relative_humidity_2m','wind_speed_10m','direct_normal_irradiance_instant','diffuse_radiation_instant']
            return httpx.Response(200,json={'latitude':34.816,'longitude':113.532,'utc_offset_seconds':28800,
                'hourly_units':dict(zip(fields,['°C','%','m/s','W/m²','W/m²'])),
                'hourly':{'time':['2024-06-12T14:00'],**{k:[v] for k,v in zip(fields,[32,50,2,700,120])}}})
        client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with patch.object(sandbox.httpx,'AsyncClient',return_value=client),patch.object(aic.store,'put',side_effect=lambda record,raw:{**record,'id':'obs_test'}):
            request=body(regional={**body().regional.model_dump(),'mode':'history'})
            first=await sandbox.boundary_weather(request)
            second=await sandbox.boundary_weather(request)
        self.assertEqual(len(calls),2)
        self.assertIs(first,second)
        self.assertEqual(first['observed_at'],'2024-06-12T14:00:00+08:00')

    async def test_permanent_upstream_error_is_not_retried_or_fabricated(self):
        calls=[]
        def handle(request):
            calls.append(request)
            return httpx.Response(400,json={'error':True})
        client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with patch.object(sandbox.httpx,'AsyncClient',return_value=client),self.assertRaises(httpx.HTTPStatusError):
            await sandbox.boundary_weather(body())
        self.assertEqual(len(calls),1)
        self.assertFalse(sandbox._weather_cache)


class SceneTests(unittest.TestCase):
    def test_real_footprints_and_no_unproven_heights(self):
        data=sandbox.buildings()
        self.assertGreaterEqual(len(data["features"]),160)
        self.assertFalse(data["coverage"]["complete_survey"])
        self.assertEqual(len({f["id"] for f in data["features"]}),len(data["features"]))
        self.assertTrue(all(shape(f["geometry"]).is_valid for f in data["features"]))
        self.assertTrue(all(f["properties"]["height_m"] is None or f["properties"]["height_source"] in {"osm_height","osm_levels"} for f in data["features"]))

    def test_removal_preserves_baseline(self):
        key=sandbox.buildings()["features"][0]["id"]
        base,proposed=sandbox.scene_geometry(sandbox.Scene(removed_ids=[key]))
        self.assertIn(key,[f["id"] for f in base])
        self.assertNotIn(key,[f["id"] for f in proposed])
        self.assertIn(key,[f["id"] for f in sandbox.buildings()["features"]])

    def test_unknown_ids_duplicates_and_nonfinite_rejected(self):
        key=sandbox.buildings()["features"][0]["id"]
        for value in [{"removed_ids":["unknown"]},{"removed_ids":[key,key]},
                      {"additions":[{"id":"new-a","longitude":float("nan"),"latitude":34.81,"width_m":20,"depth_m":20,"height_m":18}]}]:
            with self.assertRaises(ValidationError): sandbox.Scene.model_validate(value)

    def test_overlap_rejected(self):
        f=sandbox.buildings()["features"][0]
        p=shape(f["geometry"]).representative_point()
        value=sandbox.Scene(additions=[sandbox.Addition(id="new-a",longitude=p.x,latitude=p.y,width_m=10,depth_m=10,height_m=20)])
        with self.assertRaises(ValueError):sandbox.scene_geometry(value)

    def test_shadow_is_directional_not_radial_random(self):
        shadow=sandbox.sweep_shadow(box(0,0,10,10),11.1,45,180)
        self.assertAlmostEqual(shadow.bounds[3],20,places=5)
        self.assertAlmostEqual(shadow.bounds[1],0,places=5)
        self.assertTrue(sandbox.sweep_shadow(box(0,0,10,10),10,-5,180).is_empty)

    def test_no_edit_is_exactly_zero_delta(self):
        result=sandbox.simulate(body(),boundary())
        self.assertGreater(result["summary"]["comparable_cells"],0)
        self.assertEqual(result["summary"]["delta_utci_c"],0)
        self.assertIsNone(result["summary"]["air_temperature_delta_c"])
        self.assertIsNone(result["summary"]["confidence"])
        self.assertTrue(all(c["properties"]["delta_utci_c"] in (None,0) for c in result["cells"]["features"]))
        for distribution in result["spatial_exposure"]["distribution"].values():
            self.assertAlmostEqual(sum(bucket["area_pct"] for bucket in distribution),100,delta=.05)

    def test_daylight_addition_changes_exposure_reproducibly(self):
        value=body(scene={"name":"synthetic-layout","additions":[{"id":"new-daylight","longitude":113.528143,"latitude":34.813813,"width_m":60,"depth_m":60,"height_m":60}]},
                   regional={"bounds":{"west":113.526,"east":113.530,"south":34.812,"north":34.816},"mode":"history","use_ai":False},resolution_m=25)
        a=sandbox.simulate(value,boundary())
        b=sandbox.simulate(value,boundary())
        self.assertEqual(a["summary"],b["summary"])
        self.assertEqual(a["cells"],b["cells"])
        self.assertTrue(any(c["properties"]["delta_utci_c"] not in (None,0) for c in a["cells"]["features"]))
        self.assertIsNone(a["summary"]["air_temperature_delta_c"])

    def test_remove_changes_geometry_not_weather(self):
        key=sandbox.buildings()["features"][0]["id"]
        result=sandbox.simulate(body(scene={"name":"remove","removed_ids":[key]}),boundary())
        self.assertEqual(result["summary"]["removed_buildings"],1)
        self.assertEqual(result["weather_boundary"]["temperature_c"],32)
        self.assertEqual(result["validation"],"exploratory_unvalidated")
        self.assertTrue(any(c["properties"]["baseline_occupied"] and not c["properties"]["proposed_occupied"] for c in result["cells"]["features"]))

    def test_out_of_geometry_coverage_rejected(self):
        value=body(regional={"bounds":{"west":113.60,"east":113.61,"south":34.74,"north":34.75},"use_ai":False})
        with self.assertRaises(ValueError):sandbox.simulate(value,boundary())

    def test_utci_out_of_domain_is_missing_not_clamped(self):
        value=boundary();value["extras"]["wind_speed_10m"]=0.1
        result=sandbox.simulate(body(),value)
        self.assertEqual(result["summary"]["comparable_cells"],0)
        self.assertIsNone(result["summary"]["delta_utci_c"])

    def test_night_scenario_does_not_invent_storage_effect(self):
        result=sandbox.simulate(body(),boundary(observed_at="2024-06-12T02:00:00+08:00"))
        self.assertTrue(result["night"])
        self.assertTrue(all(c["properties"]["baseline_mrt_c"] in (None,32) for c in result["cells"]["features"]))

    def test_night_weather_estimate_retains_heat_and_humidity_without_solar_gain(self):
        cool=sandbox.simulate(body(),boundary(observed_at="2024-06-12T02:00:00+08:00",temperature_c=20,relative_humidity_pct=50))
        hot_boundary=boundary(observed_at="2024-06-12T02:00:00+08:00",temperature_c=34,relative_humidity_pct=80)
        hot=sandbox.simulate(body(),hot_boundary)
        humid=sandbox.simulate(body(),{**hot_boundary,"relative_humidity_pct":40})
        assessment=hot["thermal_assessment"]
        self.assertEqual(assessment["mode"],"night_weather_estimate")
        self.assertEqual(assessment["status"],"estimated")
        self.assertFalse(assessment["shortwave_included"])
        self.assertFalse(assessment["building_delta_evaluated"])
        self.assertEqual(assessment["utci_c"],hot["summary"]["proposed_utci_c"])
        self.assertGreaterEqual(assessment["utci_c"],32)
        self.assertGreater(assessment["utci_c"],cool["thermal_assessment"]["utci_c"])
        self.assertGreater(assessment["utci_c"],humid["thermal_assessment"]["utci_c"])
        no_solar=sandbox.simulate(body(),{**hot_boundary,"extras":{**hot_boundary["extras"],"direct_normal_irradiance_wm2":0,"diffuse_radiation_wm2":0}})
        self.assertEqual(hot["cells"],no_solar["cells"])
        day=sandbox.simulate(body(),{**hot_boundary,"observed_at":"2024-06-12T14:00:00+08:00"})
        self.assertTrue(day["thermal_assessment"]["shortwave_included"])
        self.assertGreater(day["summary"]["proposed_utci_c"],assessment["utci_c"])

    def test_small_building_affects_coarse_grid_without_centre_hit(self):
        value=body(scene={"additions":[{"id":"new-small","longitude":113.528143,"latitude":34.813813,
                    "width_m":10,"depth_m":10,"height_m":18}]},
                   regional={"bounds":{"west":113.526,"east":113.530,"south":34.812,"north":34.816},
                             "mode":"history","use_ai":False},resolution_m=100)
        result=sandbox.simulate(value,boundary())
        self.assertEqual(result["effect_status"],"changed")
        self.assertGreater(result["summary"]["changed_cells"],0)
        self.assertLess(result["summary"]["local_delta_min_c"],0)
        self.assertEqual(result["sampling_method"],"shared_outdoor_area_sun_shade_utci")
        self.assertTrue(any(0<p["proposed_shade_fraction"]<1
                            for p in (c["properties"] for c in result["cells"]["features"])
                            if p["proposed_shade_fraction"] is not None))

    def test_changed_area_matches_report_and_no_fake_night_effect(self):
        value=body(scene={"additions":[{"id":"new-small","longitude":113.528143,"latitude":34.813813,
                    "width_m":10,"depth_m":10,"height_m":18}]},
                   regional={"bounds":{"west":113.526,"east":113.530,"south":34.812,"north":34.816},
                             "mode":"history","use_ai":False},resolution_m=100)
        result=sandbox.simulate(value,boundary())
        changed=[c["properties"] for c in result["cells"]["features"]
                 if c["properties"]["delta_utci_c"] is not None and abs(c["properties"]["delta_utci_c"])>=.001]
        self.assertEqual(result["summary"]["changed_area_m2"],round(sum(p["comparable_area_m2"] for p in changed),2))
        night=sandbox.simulate(value,boundary(observed_at="2024-06-12T02:00:00+08:00"))
        self.assertEqual(night["effect_status"],"night_no_shortwave")
        self.assertEqual(night["summary"]["changed_cells"],0)
        self.assertEqual(night["summary"]["delta_utci_c"],0)


class APITests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.patch=patch.object(sandbox.plan_store,"path",Path(self.tmp.name)/"scenes.sqlite3")
        self.patch.start()
        app=FastAPI();app.include_router(sandbox.router)
        self.client=TestClient(app)
        self.headers={"X-Workspace-Token":"a"*64}

    def tearDown(self):
        self.client.close();self.patch.stop();self.tmp.cleanup()

    def test_owner_isolation_and_persistence(self):
        path="/api/weather/sandbox/scenes"
        self.assertEqual(self.client.get(path).status_code,401)
        record=self.client.post(path,headers=self.headers,json={"name":"test"})
        self.assertEqual(record.status_code,201)
        self.assertEqual(len(self.client.get(path,headers=self.headers).json()["scenes"]),1)
        other={"X-Workspace-Token":"b"*64}
        self.assertEqual(self.client.get(path,headers=other).json()["scenes"],[])
        key=record.json()["id"]
        self.assertEqual(self.client.delete(path+"/"+key,headers=other).status_code,404)
        self.assertEqual(self.client.delete(path+"/"+key,headers=self.headers).status_code,200)

    def test_heatmap_repeated_grids_have_identical_values(self):
        from backend.aic.router import weather
        with patch.object(weather,"get",AsyncMock(return_value=observation())):
            r=self.client.post("/api/weather/sandbox/heatmap",json=body().regional.model_dump())
        self.assertEqual(r.status_code,200)
        value=r.json()
        self.assertEqual(value["coverage"]["unique_model_grids"],1)
        self.assertEqual(len({f["properties"]["temperature_c"] for f in value["cells"]["features"]}),1)

    def test_weather_failure_does_not_return_random_result(self):
        with patch.object(sandbox,"boundary_weather",AsyncMock(side_effect=httpx.ConnectError("synthetic"))):
            r=self.client.post("/api/weather/sandbox/simulate",json=body().model_dump())
        self.assertEqual(r.status_code,503)

    def test_oversized_grid_rejected_before_weather_or_ai(self):
        payload=body(regional={"bounds":{"west":113.523,"east":113.535,"south":34.809,"north":34.828},"use_ai":True},resolution_m=20).model_dump()
        with patch.object(sandbox,"boundary_weather",AsyncMock()) as weather,patch('backend.hybrid.run_tools',AsyncMock()) as tools:
            for endpoint in ('simulate','collaborate'):
                response=self.client.post('/api/weather/sandbox/'+endpoint,json=payload)
                self.assertEqual(response.status_code,422,response.text)
                self.assertIn('4096',response.json()['detail'])
            weather.assert_not_called()
            tools.assert_not_called()

    def test_invalid_geometry_rejected_before_weather(self):
        point=shape(sandbox.buildings()['features'][0]['geometry']).representative_point()
        payload=body(scene={"name":"overlap","additions":[{"id":"new-overlap","longitude":point.x,"latitude":point.y,"width_m":10,"depth_m":10,"height_m":18}]}).model_dump()
        with patch.object(sandbox,"boundary_weather",AsyncMock()) as weather:
            response=self.client.post('/api/weather/sandbox/simulate',json=payload)
            self.assertEqual(response.status_code,422,response.text)
            weather.assert_not_called()

    def test_preflight_rejects_overlap_without_mutating_source(self):
        feature=sandbox.buildings()["features"][0]
        point=shape(feature["geometry"]).representative_point()
        path="/api/weather/sandbox/validate"
        self.assertEqual(self.client.post(path,json={"name":"empty"}).status_code,200)
        scene={"name":"overlap","additions":[{"id":"new-overlap","longitude":point.x,"latitude":point.y,"width_m":10,"depth_m":10,"height_m":18}]}
        self.assertEqual(self.client.post(path,json=scene).status_code,422)
        self.assertIn(feature["id"],{f["id"] for f in sandbox.buildings()["features"]})

    def test_complete_flow_contains_layout_and_cohort_evidence(self):
        from backend.aic.router import weather
        with patch.object(sandbox,"boundary_weather",AsyncMock(return_value=boundary())),patch.object(weather,"get",AsyncMock(return_value=observation())):
            r=self.client.post("/api/weather/sandbox/simulate",json=body().model_dump())
        self.assertEqual(r.status_code,200,r.text)
        report=r.json()
        self.assertIn("LAYOUT-RESULT",report["regional_report"]["interpretation"]["fact_ids"])
        self.assertIn("LAYOUT-LIMIT",report["regional_report"]["interpretation"]["fact_ids"])
        self.assertTrue(report["regional_report"]["cohorts"])
        self.assertEqual(report["regional_report"]["coverage"]["usable_samples"],5)
        self.assertNotEqual(report["regional_report"]["environment"]["risk"],"unavailable")
        self.assertTrue(all(s["observation"]["id"]==report["weather_boundary"]["id"] for s in report["regional_report"]["samples"]))
        self.assertEqual(report["regional_report"]["medical_review"],"pending")
        source_ids={s["id"] for s in report["regional_report"]["sources"]}
        self.assertTrue(all(set(f["source_ids"])<=source_ids for f in report["regional_report"]["facts"]))
        self.assertIn("LAYOUT-EXPOSURE",report["regional_report"]["interpretation"]["fact_ids"])
        self.assertIn("LAYOUT-INDICATORS",report["regional_report"]["interpretation"]["fact_ids"])
        self.assertTrue(all(any(f["code"]=="layout_radiation" for f in c["attention_factors"]) for c in report["regional_report"]["cohorts"]))
        self.assertEqual(report["regional_report"]["layout_exposure"]["summary"],report["summary"])
        self.assertTrue(all(c["layout_exposure"]["proposed_utci_c"]==report["summary"]["proposed_utci_c"] for c in report["regional_report"]["cohorts"]))
        self.assertTrue(all(not c["medical_advice"] for c in report["regional_report"]["cohorts"]))
        copy=report.copy();checksum=copy.pop("report_sha256")
        self.assertEqual(checksum,sandbox.digest(copy))

    def test_night_report_and_ai_context_keep_weather_risk_separate_from_building_delta(self):
        night=boundary(observed_at="2024-06-12T02:00:00+08:00",temperature_c=34,relative_humidity_pct=80)
        with patch.object(sandbox,"boundary_weather",AsyncMock(return_value=night)):
            response=self.client.post("/api/weather/sandbox/simulate",json=body().model_dump())
        self.assertEqual(response.status_code,200,response.text)
        result=response.json();report=result["regional_report"]
        self.assertNotIn(report["environment"]["risk"],{"below_range","unavailable"})
        assessment=result["thermal_assessment"]
        self.assertEqual(report["layout_exposure"]["thermal_assessment"],assessment)
        self.assertEqual(report["decision_analysis"]["risk_intensity"]["assessment_basis"],assessment)
        facts={fact["id"]:fact["text"] for fact in report["facts"]}
        self.assertIn("夜间气象估测",facts["LAYOUT-RESULT"])
        self.assertIn("不设置夜间固定降级系数",facts["LAYOUT-LOCAL-CHANGE"])
        self.assertIn("LAYOUT-LOCAL-CHANGE",report["interpretation"]["fact_ids"])
        copy=result.copy();checksum=copy.pop("report_sha256")
        self.assertEqual(checksum,sandbox.digest(copy))


if __name__=="__main__":unittest.main()
