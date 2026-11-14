"""Caches must preserve physical inputs, invalidation and JSON response contracts."""
import unittest
import math
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import Point, box, LineString, Polygon
from shapely.strtree import STRtree

from backend import sandbox
from backend.test_sandbox import body, boundary


class ThermalPerformanceTests(unittest.TestCase):
    def test_batched_sky_matches_original_ray_equations(self):
        objects = [dict(metric=box(8, -20, 25, 30), height=18),
                   dict(metric=box(-60, 5, -30, 70), height=75),
                   dict(metric=Polygon([(0, 90), (35, 130), (-30, 120)]), height=3),
                   dict(metric=box(600, 600, 650, 650), height=100)]
        tree = STRtree([f['metric'] for f in objects])
        for point in (Point(0, 0), Point(10, 10), Point(-50, 70), Point(1000, 1000)):
            total = 0
            for angle in range(0, 360, 10):
                r = math.radians(angle)
                ray = LineString([(point.x, point.y), (point.x+300*math.sin(r), point.y+300*math.cos(r))])
                horizon = 0
                for i in tree.query(ray):
                    f = objects[i]; hit = f['metric'].intersection(ray)
                    if not hit.is_empty:
                        horizon = max(horizon, math.atan2(max(0, f['height']-1.1), max(.1, point.distance(hit))))
                total += math.cos(horizon)**2
            self.assertAlmostEqual(sandbox._point_sky_view(point, tree, objects), total/36, places=12)
        self.assertEqual(sandbox._point_sky_view(Point(0, 0), STRtree([]), []), 1)

    def test_full_campus_supports_real_thirty_metre_computations(self):
        from backend.spatial import campus_boundary
        ring = campus_boundary()['geometry']['coordinates'][0]
        bounds = dict(west=min(p[0] for p in ring), east=max(p[0] for p in ring),
                      south=min(p[1] for p in ring), north=max(p[1] for p in ring))
        request = body(regional=dict(bounds=bounds, use_ai=False), resolution_m=30)
        region, _, nx, ny = sandbox.calculation_region(request)
        self.assertLessEqual(nx*ny, 4096)
        cells = sandbox._thermal_grid(region.wkb, 30)
        self.assertGreater(len(cells), 2000)
        for cell, _ in cells:
            self.assertLessEqual(cell.area, 900.001)
        self.assertAlmostEqual(sum(cell.area for cell, _ in cells), region.area, delta=.001)

    def test_local_sky_cache_tracks_height_and_removal(self):
        point = Point(0, 0)
        footprint = box(10, -5, 20, 5)
        def sky(height):
            objects = [{"metric": footprint, "height": height}]
            return sandbox.sky_view(point, STRtree([footprint]), objects)
        low = sky(5)
        high = sky(80)
        self.assertLess(high, low)
        self.assertEqual(sky(5), low)
        self.assertEqual(sandbox.sky_view(point, STRtree([]), []), 1)

    def test_outdoor_cache_changes_with_footprint_and_restores_on_undo(self):
        cell = box(0, 0, 100, 100)
        empty = sandbox._outdoor_ground(cell.wkb, ())
        built = sandbox._outdoor_ground(cell.wkb, (box(10, 10, 30, 30).wkb,))
        self.assertEqual(empty.area, 10000)
        self.assertEqual(built.area, 9600)
        self.assertTrue(sandbox._outdoor_ground(cell.wkb, ()).equals(empty))

    def test_geometry_reuse_does_not_reuse_changed_weather_values(self):
        request = body(resolution_m=100)
        cool = sandbox.simulate(request, boundary(temperature_c=28))
        hot = sandbox.simulate(request, boundary(temperature_c=36))
        self.assertEqual([f["geometry"] for f in cool["cells"]["features"]],
                         [f["geometry"] for f in hot["cells"]["features"]])
        self.assertGreater(hot["summary"]["proposed_utci_c"], cool["summary"]["proposed_utci_c"])
        self.assertEqual(hot["summary"]["delta_utci_c"], 0)

    def test_direct_json_keeps_success_headers_and_validation(self):
        app = FastAPI();app.include_router(sandbox.router)
        response = {"valid_time":"2024-06-12T14:00:00+08:00", "cells":{"features":[]}}
        with TestClient(app) as client, patch.object(sandbox,"run_simulation",AsyncMock(return_value=response)):
            result = client.post("/api/weather/sandbox/simulate",json=body().model_dump(mode="json"))
            self.assertEqual(result.status_code,200)
            self.assertEqual(result.json(),response)
            self.assertEqual(result.headers["cache-control"],"no-store")
            self.assertEqual(client.post("/api/weather/sandbox/simulate",json={"bad":True}).status_code,422)


if __name__ == "__main__":
    unittest.main()
