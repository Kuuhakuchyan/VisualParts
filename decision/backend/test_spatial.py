"""Geometry regression tests, not a claim of boundary survey accuracy."""
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import Point, shape
from shapely.ops import transform, unary_union

from backend import sandbox
from backend.aic.regional import RegionalRequest
from backend.aic.test_regional import observation
from backend.spatial import TO_METRIC, analysis_region, campus_boundary, region_description, region_samples
from backend.test_sandbox import boundary

BOUNDS = dict(west=113.522915, east=113.535786, south=34.808909, north=34.828137)


class CampusGeometryTests(unittest.TestCase):
    def test_whole_campus_uses_polygon_metric_area_and_internal_samples(self):
        body = RegionalRequest(bounds=BOUNDS, use_ai=False)
        region, points, quarters = region_samples(body)
        self.assertTrue(all(region.covers(p) for p in points))
        self.assertLess(region.symmetric_difference(unary_union(quarters)).area, 1e-14)
        self.assertAlmostEqual(region_description(body, region)["area_km2_approx"], 2.257, places=3)
        self.assertFalse(campus_boundary()["properties"]["survey_verified"])

    def test_northern_gap_supplement_preserves_unknown_heights(self):
        local = [f for f in sandbox.buildings()["features"] if f["properties"]["source"] == "user_supplied_digitized_footprint"]
        self.assertTrue(any(shape(f["geometry"]).bounds[3] > 34.825 for f in local))
        self.assertTrue(all(f["properties"]["height_m"] is None for f in local))

    def test_heatmap_covers_exact_outline_and_rejects_disjoint_selection(self):
        from backend.aic.router import weather
        app = FastAPI(); app.include_router(sandbox.router)
        body = RegionalRequest(bounds=BOUNDS, use_ai=False)
        with TestClient(app) as client, patch.object(weather, "get", AsyncMock(return_value=observation())):
            response = client.post("/api/weather/sandbox/heatmap", json=body.model_dump())
            self.assertEqual(response.status_code, 200)
            cells = unary_union([shape(f["geometry"]) for f in response.json()["cells"]["features"]])
            self.assertLess(cells.symmetric_difference(analysis_region(body)).area, 1e-14)
            outside = {**body.model_dump(), "bounds": dict(west=113.60, east=113.61, south=34.74, north=34.75)}
            self.assertEqual(client.post("/api/weather/sandbox/heatmap", json=outside).status_code, 422)

    def test_building_center_inside_but_footprint_outside_rejected(self):
        outline = shape(campus_boundary()["geometry"])
        x, y = outline.exterior.coords[0]
        scene = sandbox.Scene(additions=[sandbox.Addition(id="new-edge", longitude=x, latitude=y, width_m=80, depth_m=80, height_m=18)])
        with self.assertRaisesRegex(ValueError, "校园边界"):
            sandbox.scene_geometry(scene)

    def test_whole_campus_default_resolution_fits_budget_and_clips_cells(self):
        body = sandbox.SimulationInput(scene=sandbox.Scene(), regional=RegionalRequest(bounds=BOUNDS, use_ai=False))
        result = sandbox.simulate(body, boundary())
        self.assertEqual(body.resolution_m, 30)
        self.assertGreater(result["summary"]["total_cells"], 2000)
        self.assertLessEqual(result["summary"]["total_cells"], 4096)
        region = analysis_region(body.regional)
        cells = unary_union([shape(f["geometry"]) for f in result["cells"]["features"]])
        # UTM straight edges inverse-project to chords; bound that round-trip error in m2.
        self.assertLess(transform(TO_METRIC, cells).symmetric_difference(transform(TO_METRIC, region)).area, 2)
        self.assertEqual(result["summary"]["delta_utci_c"], 0)


if __name__ == "__main__":
    unittest.main()
