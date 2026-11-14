import unittest
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from shapely.geometry import LineString, MultiLineString, Point, box

from backend.routing import graph_from_lines, informative_tour, aerial_graph
from backend.temporal import ForecastInput, artifact, predict, router


class RoutingTests(unittest.TestCase):
    def test_road_intersections_are_noded_without_teleporting(self):
        geometry = MultiLineString([[(0, 0), (100, 0)], [(50, -50), (50, 50)]])
        graph = graph_from_lines(geometry)
        self.assertIn((50.0, 0.0), graph)
        self.assertEqual(graph.degree((50.0, 0.0)), 4)
        for a, b in graph.edges:
            self.assertTrue(geometry.buffer(1e-6).covers(LineString([a, b])))

    def test_route_is_closed_with_energy_and_reserve(self):
        graph = graph_from_lines(MultiLineString([[(0, 0), (200, 0)], [(100, 0), (100, 100)]]))
        route, info = informative_tour(graph, lambda p: str(round(p.x/25))+":"+str(round(p.y/25)), {}, 4, 100, 1, .25)
        self.assertIsNotNone(route)
        self.assertEqual(route.coords[0], route.coords[-1])
        self.assertLessEqual(info["estimated_energy_wh"], 3)
        self.assertFalse(info["globally_optimal"])

    def test_disconnected_components_are_not_bridged(self):
        graph = graph_from_lines(MultiLineString([[(0, 0), (200, 0)], [(500, 0), (600, 0)]]))
        route, info = informative_tour(graph, lambda p: str(p.x), {}, 20, 100, 1, .25)
        self.assertEqual(info["network_components"], 2)
        self.assertLessEqual(route.bounds[2], 200)

    def test_aerial_graph_does_not_cross_obstacles(self):
        obstacle = box(80, 80, 150, 180)
        graph = aerial_graph(box(0, 0, 300, 300), obstacle)
        self.assertTrue(all(not LineString([a,b]).intersects(obstacle) for a,b in graph.edges))

    def test_no_fake_route_when_budget_too_small(self):
        graph = graph_from_lines(LineString([(0,0),(200,0)]))
        route, _ = informative_tour(graph, lambda p: str(p.x), {}, .001, 100, 1, .5)
        self.assertIsNone(route)

    def test_lcz_bonus_changes_choice_without_breaking_return_budget(self):
        graph=graph_from_lines(LineString([(-100,0),(0,0),(100,0)]))
        cell_at=lambda p:'left' if p.x<0 else 'right' if p.x>0 else 'depot'
        classes={'left':'LCZ_A','right':'LCZ_E','depot':'LCZ_A'}
        route,info=informative_tour(graph,cell_at,{},8,100,1,.25,start_point=(0,0),cell_classes=classes)
        self.assertIsNotNone(route)
        self.assertGreater(route.bounds[2],0)
        self.assertEqual(info["covered_lcz_classes"],["LCZ_A","LCZ_E"])
        self.assertEqual(info["uncovered_lcz_classes"],[])
        self.assertTrue(info["closed_tour"])
        self.assertLessEqual(info["estimated_energy_wh"],info["usable_budget_wh"])


class TemporalTests(unittest.TestCase):
    def body(self):
        start = datetime(2026, 7, 25, 9, tzinfo=timezone(timedelta(hours=8)))
        return dict(station_id="test-station", observations=[dict(time=(start+timedelta(minutes=i*5)).isoformat(),
            temperature_c=30+i*.1, humidity_pct=60-i*.2, pressure_hpa=995, wind_mps=1) for i in range(7)])

    def test_predicts_only_15min_and_discloses_scope(self):
        body = ForecastInput(**self.body())
        result = predict(body, artifact())
        self.assertEqual(result["valid_at"], (body.observations[-1].time+timedelta(minutes=15)).isoformat())
        self.assertFalse(result["spatial_retreatment_eligible"])
        self.assertFalse(result["med_eligible"])
        self.assertTrue(-40 <= result["predicted"]["temperature_c"] <= 60)

    def test_no_future_or_missing_lag_substitution(self):
        body = self.body();body["observations"][3]["time"] = body["observations"][2]["time"]
        with self.assertRaises(ValidationError):
            ForecastInput(**body)

    def test_unzoned_time_and_nonfinite_input_rejected(self):
        for patch in [dict(time="2026-07-25T09:00:00"), dict(temperature_c=float("nan"))]:
            body = self.body();body["observations"][0].update(patch)
            with self.assertRaises(ValidationError):
                ForecastInput(**body)

    def test_persistence_when_target_fails_gate(self):
        model = {**artifact(), "enabled_targets": [False,False]}
        body = ForecastInput(**self.body())
        result = predict(body,model)
        self.assertEqual(result["predicted"]["temperature_c"], body.observations[-1].temperature_c)

    def test_time_split_has_embargo(self):
        split = artifact()["split"]
        self.assertGreaterEqual((datetime.fromisoformat(split["test_start"])-datetime.fromisoformat(split["validation_end"])).total_seconds(), 45*60)

    def test_api_does_not_serve_weights_or_training_files(self):
        app = FastAPI();app.include_router(router)
        with TestClient(app) as client:
            response = client.get('/api/weather/sandbox/temporal/model')
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("coefficients", response.json())
            self.assertEqual(client.post('/api/weather/sandbox/temporal/predict',json=self.body()).status_code,200)
