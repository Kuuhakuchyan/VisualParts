"""Software/contract tests of uncalibrated scenarios; not clinical validation."""
import asyncio
import copy
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import shape
from shapely.ops import transform, unary_union

from backend import lcz, sandbox
from backend.aic.regional import RegionalRequest, sample_region
from backend.aic.risk import assess_environment
from backend.data_contract import UGVTelemetry, contract, normalize_telemetry
from backend.test_sandbox import boundary, body


class LCZTests(unittest.TestCase):
    def test_simulated_warm_and_cool_cells_keep_the_same_weather_boundary(self):
        for stamp in ('2024-06-12T14:00:00+08:00', '2024-06-12T02:00:00+08:00'):
            observation = boundary(observed_at=stamp)
            cool_t, cool_rh, cool_delta = lcz.values({'11': 1}, observation)
            warm_t, warm_rh, warm_delta = lcz.values({'15': 1}, observation)
            self.assertLess(cool_delta, 0)
            self.assertGreater(warm_delta, 0)
            self.assertLess(cool_t, observation['temperature_c'])
            self.assertGreater(warm_t, observation['temperature_c'])
            self.assertGreater(cool_rh, warm_rh)
            for parts in ({'11': .7, '15': .3}, {'11': .3, '15': .7}):
                t, rh, dt = lcz.values(parts, observation)
                self.assertGreaterEqual(t, cool_t)
                self.assertLessEqual(t, warm_t)
                self.assertAlmostEqual(t-observation['temperature_c'], dt, places=3)
                self.assertGreaterEqual(rh, 22)
                self.assertLessEqual(rh, 98)

    def setUp(self):
        self.body = RegionalRequest(bounds={"west":113.530,"east":113.533,"south":34.815,"north":34.818},
                                    data_mode="lcz_simulation", mode="history", use_ai=False)

    def test_assets_have_traceable_constraints_and_disclosed_proxies(self):
        data, _, _ = lcz.assets()
        codes = {f["properties"]["lcz"] for f in data["features"]}
        self.assertTrue({2,5,9,11,12,13,14,15,17}.issubset(codes))
        self.assertEqual(len(data["metadata"]["source_sha256"]),64)
        self.assertEqual(lcz.metadata()["classification_sha256"],data["metadata"]["classification_sha256"])
        self.assertNotEqual(lcz.metadata()["classification_sha256"],data["metadata"]["source_sha256"])
        self.assertEqual(data["metadata"]["method"]["analysis_crs"],"EPSG:32649")
        for code in (5,9):
            profile=data["metadata"]["profiles"][str(code)]
            self.assertEqual(profile["proxy_profile_code"],2)
            self.assertIn("uncalibrated",profile["parameter_status"])

    def test_no_building_water_road_conflicts_or_double_counted_area(self):
        data, geometries, tree=lcz.assets()
        constraints=json.loads((lcz.ROOT/"public/data/campus-lcz-constraints.geojson").read_text())
        for kind in ("building","water","road"):
            geometry=unary_union([transform(lcz.TO_M,shape(f["geometry"])) for f in constraints["features"] if f["properties"]["kind"]==kind])
            area=0
            for index in tree.query(geometry):
                code=data["features"][index]["properties"]["lcz"]
                if (kind=="building" and code>10) or (kind=="water" and code!=17) or (kind=="road" and code!=15):
                    area+=geometry.intersection(geometries[index]).area
            self.assertLess(area,.01,kind)
        self.assertLess(abs(sum(g.area for g in geometries)-unary_union(geometries).area),.01)

    def test_corrected_roof_uses_built_offset_and_changes_snapshot(self):
        data, geometries, _=lcz.assets()
        feature=next(f for f in data["features"] if f["properties"]["lcz"]==5)
        geometry=transform(lcz.TO_M,shape(feature["geometry"]))
        fractions, coverage=lcz.class_fractions(geometry)
        self.assertGreater(coverage,.999)
        self.assertGreater(fractions["5"],.999)
        self.assertGreater(lcz.values(fractions,boundary())[0],lcz.values({"11":1},boundary())[0])
        current=lcz.build_scenario(self.body,boundary())["snapshot_sha256"]
        model=lcz.metadata()
        with patch.object(lcz,"metadata",return_value={**model,"classification_sha256":"0"*64}):
            self.assertNotEqual(current,lcz.build_scenario(self.body,boundary())["snapshot_sha256"])

    def test_asset_revision_invalidates_geometry_cache(self):
        b=self.body.bounds
        old=lcz.grid_geometry(b.west,b.south,b.east,b.north,30)
        with patch.object(lcz,"asset_revision",return_value=(0,0)):
            new=lcz.grid_geometry(b.west,b.south,b.east,b.north,30)
        self.assertIsNot(old,new)
        self.assertEqual(old,new)

    def test_summary_preserves_area_and_unknowns_not_dominant_cell_counts(self):
        result=lcz.build_scenario(self.body,boundary())
        summary=result["classification_summary"]
        self.assertAlmostEqual(sum(c["area_m2"] for c in summary["classes"])+summary["unknown_area_m2"],summary["area_m2"],delta=.02)
        self.assertEqual(summary["classification_sha256"],result["simulation"]["classification_sha256"])
        for row in summary["classes"]:
            expected=sum(f["properties"]["area_m2"]*f["properties"]["classified_fraction"]*f["properties"]["lcz_fractions"].get(str(row["lcz_code"]),0) for f in result["cells"]["features"])
            self.assertAlmostEqual(row["area_m2"],expected,places=2)
        self.assertEqual(sum(c["dominant_grid_count"] for c in summary["classes"]),sum(bool(f["properties"]["lcz_fractions"]) for f in result["cells"]["features"]))

    def test_summary_and_parameter_facts_reach_report_and_decision_context(self):
        from backend.aic import router as aic
        from backend.aic.decision import prepare_context
        with patch.object(sandbox,"boundary_weather",AsyncMock(return_value=boundary())):
            result=asyncio.run(sandbox.run_simulation(body(regional=self.body.model_dump(),resolution_m=100),__import__('fastapi').Response()))
        report=result["regional_report"]
        self.assertEqual(report["decision_analysis"]["classification_summary"],report["classification_summary"])
        context=prepare_context(report,report["cohorts"])
        self.assertEqual(context["classification_summary"],report["classification_summary"])
        self.assertTrue({"LCZ-COMPOSITION","LCZ-PARAMETERS"}.issubset({f["id"] for f in report["facts"]}))
        from backend.aic.decision import OUTPUT_INSTRUCTION
        self.assertIn("classification_summary",OUTPUT_INSTRUCTION)
        self.assertTrue({"LCZ-COMPOSITION","LCZ-PARAMETERS"}.issubset({f["id"] for f in report["facts"]}))

    def test_summary_keeps_missing_area_distinct_from_known_classification(self):
        model=lcz.metadata()
        cells=[{"properties":{"area_m2":100,"classified_fraction":.5,"temperature_c":None,"lcz_fractions":{"11":1},"lcz_code":11}}]
        summary=lcz.classification_summary(cells,model)
        self.assertEqual(summary["unknown_area_m2"],50)
        self.assertEqual(summary["classes"][0]["area_m2"],50)
        self.assertEqual(summary["usable_temperature_area_m2"],0)

    def test_grid_clipped_to_campus_and_stable_global_ids(self):
        b = self.body.bounds
        a = lcz.grid_geometry(b.west,b.south,b.east,b.north,30)
        region = shape(sandbox.campus_boundary()["geometry"])
        self.assertGreater(len(a),50)
        self.assertEqual(len({f["id"] for f in a}),len(a))
        self.assertTrue(all(region.buffer(1e-9).covers(shape(f["geometry"])) for f in a))
        geometries=[shape(f["geometry"]) for f in a]
        self.assertAlmostEqual(sum(g.area for g in geometries),unary_union(geometries).area,places=12)

    def test_repeated_input_identical_no_random_risk_or_confidence(self):
        a,b=[lcz.build_scenario(self.body,boundary()) for _ in range(2)]
        self.assertEqual(a["snapshot_sha256"],b["snapshot_sha256"])
        self.assertEqual(a["cells"],b["cells"])
        self.assertEqual(a["simulation"]["validation"],"uncalibrated")
        self.assertFalse(a["coverage"]["spatial_comparison_supported"])
        self.assertEqual(a["coverage"]["unique_model_grids"],1)

    def test_full_campus_footprints_include_unavailable_cells_at_all_resolutions(self):
        region=shape(sandbox.campus_boundary()["geometry"])
        west,south,east,north=region.bounds
        for resolution in (30,50,100):
            with self.subTest(resolution=resolution):
                cells=lcz.grid_geometry(west,south,east,north,resolution)
                union=unary_union([shape(c["geometry"]) for c in cells])
                self.assertLess(region.symmetric_difference(union).area/region.area,1e-5)
                self.assertEqual(len({c["id"] for c in cells}),len(cells))
                self.assertTrue(any(c["properties"]["classified_fraction"]<0.95 for c in cells))

    def test_lcz_offsets_from_existing_ranges_and_humidity_bounded(self):
        tree=lcz.values({"11":1},boundary())
        building=lcz.values({"2":1},boundary())
        self.assertLess(tree[0],building[0])
        self.assertGreater(tree[1],building[1])
        for feature in lcz.build_scenario(self.body,boundary())["cells"]["features"]:
            p=feature["properties"]
            if p["temperature_c"] is not None:
                self.assertTrue(0<=p["humidity_pct"]<=100)
                self.assertEqual(p["temp_c"],p["temperature_c"])
                self.assertIsNone(p["quality_flag"])
                self.assertEqual(p["source_type"],"simulated_lcz")
                self.assertTrue(p["ts"].endswith("Z"))

    def test_simulated_records_blocked_from_real_assessment(self):
        result=lcz.build_scenario(self.body,boundary())
        obs=next(s["observation"] for s in result["samples"] if s["observation"])
        self.assertEqual(assess_environment(obs)["risk"],"unavailable")
        self.assertNotEqual(result["environment"]["risk"],"unavailable")

    def test_neighborhood_has_no_campus_classification_fallback(self):
        self.body.area_kind="neighborhood"
        with self.assertRaises(ValueError):lcz.build_scenario(self.body,boundary())

    def test_baseline_shift_changes_snapshot(self):
        a=lcz.build_scenario(self.body,boundary())
        b=lcz.build_scenario(self.body,boundary(id="obs_"+"b"*64,temperature_c=33))
        self.assertNotEqual(a["snapshot_sha256"],b["snapshot_sha256"])

    def test_heatmap_standalone_and_layout_share_hourly_boundary(self):
        with patch.object(sandbox,"boundary_weather",AsyncMock(return_value=boundary())):
            result=asyncio.run(sample_region(None,self.body))
        self.assertEqual(result["snapshot_sha256"],lcz.build_scenario(self.body,boundary())["snapshot_sha256"])

    def test_layout_preserves_lcz_snapshot_and_area_integral_without_edits(self):
        request=body(regional=self.body.model_dump(),resolution_m=100)
        scenario=lcz.build_scenario(self.body,boundary())
        result=sandbox.simulate(request,boundary(),scenario)
        self.assertEqual(result["lcz_snapshot_sha256"],scenario["snapshot_sha256"])
        fields=[(transform(lcz.TO_M,shape(f['geometry'])),f['properties']) for f in scenario['cells']['features']]
        for cell in result["cells"]["features"]:
            p=cell["properties"]
            geometry=transform(lcz.TO_M,shape(cell['geometry']))
            areas=[(geometry.intersection(g).area,values) for g,values in fields if values['temperature_c'] is not None]
            support=sum(area for area,_ in areas)
            if support >= geometry.area*.95:
                self.assertAlmostEqual(p['air_temperature_c']*support,sum(area*v['temperature_c'] for area,v in areas),places=3)
                self.assertAlmostEqual(p['humidity_pct']*support,sum(area*v['humidity_pct'] for area,v in areas),places=3)
            else:
                self.assertIsNone(p['air_temperature_c'])
                self.assertIsNone(p['humidity_pct'])
        self.assertEqual(result["summary"]["delta_utci_c"],0)

    def test_simulation_report_no_real_medical_advice_and_hash_linked(self):
        from backend.aic import router as aic
        with patch.object(sandbox,"boundary_weather",AsyncMock(return_value=boundary())):
            result=asyncio.run(sandbox.run_simulation(body(regional=self.body.model_dump(),resolution_m=100),__import__('fastapi').Response()))
        report=result["regional_report"]
        self.assertEqual(result["lcz_snapshot_sha256"],report["snapshot_sha256"])
        self.assertTrue(all(not c["medical_advice"] for c in report["cohorts"]))
        self.assertEqual(report["data_mode"],"lcz_simulation")
        self.assertIn("模拟",report["purpose"])
        self.assertEqual(report["report_sha256"],sandbox.digest({k:v for k,v in report.items() if k!="report_sha256"}))

    def test_station_user_pin_converted_but_no_fabricated_readings(self):
        station=lcz.reference_station()
        self.assertEqual(station["role"],"calibration_reference")
        self.assertEqual(station["telemetry_status"],"not_connected")
        self.assertEqual(station["source_location"],{"longitude":113.53853,"latitude":34.813483,"crs":"GCJ-02"})
        self.assertEqual(station["crs"],"EPSG:4326")
        self.assertEqual(station["location_status"],"user_map_pin")
        self.assertEqual(station["label"],"基准站")
        self.assertGreater(station["source_location"]["longitude"]-station["location"]["longitude"],0.005)
        self.assertTrue(shape(sandbox.campus_boundary()["geometry"]).covers(__import__('shapely').Point(station["location"]["longitude"],station["location"]["latitude"])))
        self.assertIsNone(station["observation"])


def telemetry():
    u={"uuid":"0b3f8e2a-4c15-4b7e-9d2a-1f6b0c8e7a35","device_id":"UGV_01","device_type":"UGV", "task_id":"test","seq":1,
       "sampled_at_ms":"2026-10-21T06:12:33.412Z","temp_c":33.42,"humidity_pct":41.7,"temp_raw_c":33.51,
       "gps_lat":34.8153,"gps_lon":113.532,"fix_type":"single","sat_num":14,"hdop":0.9,"speed_mps":0.98,
       "mode":"cruise","fan_rpm":4200,"body_temp_c":46.1,"vbat_v":24.7,"soc_pct":78,"sensor_id":"SHT30-U1",
       "firmware_version":"test","iface_version":"IF-02/1.1","is_synced":True,"quality_flag":0}
    return {"device":"UGV_01","ts":"2026-10-21T06:12:33Z","temp":33.42,"humid":41.7,"bat":24.7,"ugv":u}


class ContractTests(unittest.TestCase):
    def test_hardware_dual_layer_contract(self):
        result=normalize_telemetry(UGVTelemetry.model_validate(telemetry()))
        self.assertTrue(result["contract_valid"])
        self.assertFalse(result["stored"])

    def test_mismatches_rejected(self):
        for key,value in [("device","OTHER"),("ts","2026-10-21T06:12:34Z"),("temp",34),("humid",40),("bat",22)]:
            data=telemetry();data[key]=value
            with self.subTest(key=key),self.assertRaises(ValidationError):UGVTelemetry.model_validate(data)

    def test_optional_if02_fields_are_validated_not_unchecked_extras(self):
        for key,value in [("task_group_id","x"*65),("platform_type","rover"),("heading_deg",361),
                          ("wind_mps",-1),("gps_alt_m",float("inf")),("temp_c_b",86),("rssi_dbm",True)]:
            data=telemetry();data["ugv"][key]=value
            with self.subTest(key=key),self.assertRaises(ValidationError):UGVTelemetry.model_validate(data)

    def test_uint32_not_truncated_and_unknown_bits_excluded(self):
        for flag in [256,512,2048,1<<31,4294967295]:
            data=telemetry();data["ugv"]["quality_flag"]=flag
            result=normalize_telemetry(UGVTelemetry.model_validate(data))
            self.assertEqual(result["quality_flag"],flag)
            self.assertFalse(result["med_eligible"])
        for flag in [-1,4294967296,True,0.5]:
            data=telemetry();data["ugv"]["quality_flag"]=flag
            with self.assertRaises(ValidationError):UGVTelemetry.model_validate(data)

    def test_field_bad_flags_or_missing_never_accepted(self):
        for flag in [None,True,256,512,2048,1<<31]:
            self.assertEqual(assess_environment(boundary(source_type="field_collection",quality_flag=flag))["risk"],"unavailable")

    def test_no_1m_product_or_backfill_completion_claim(self):
        self.assertIn("does not implement",contract()["implementation_boundary"])
        self.assertEqual(contract()["grid"]["level_codes"]["unavailable"],255)

    def test_contract_routes_and_invalid_payload(self):
        app=FastAPI();app.include_router(sandbox.router)
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/weather/sandbox/data-contract').status_code,200)
            self.assertEqual(client.post('/api/weather/sandbox/validate-telemetry',json=telemetry()).status_code,200)
            data=telemetry();data["temp"]=99
            self.assertEqual(client.post('/api/weather/sandbox/validate-telemetry',json=data).status_code,422)
