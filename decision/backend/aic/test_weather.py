"""Weather contract tests with synthetic upstream fixtures, not field validation."""

import copy
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from .store import ObservationStore
from .weather import SITES, WeatherEvidence


def series():
    now = datetime.now(timezone(timedelta(hours=8))).replace(minute=0, second=0, microsecond=0)
    return {"utc_offset_seconds": 28800, "latitude": 34.8, "longitude": 113.5,
            "hourly_units": {"temperature_2m": "°C", "relative_humidity_2m": "%", "precipitation": "mm", "wind_speed_10m": "m/s"},
            "hourly": {"time": [(now + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(-30, 31)],
                       "temperature_2m": [30] * 61, "relative_humidity_2m": [65] * 61,
                       "precipitation": [0] * 61, "wind_speed_10m": [2] * 61}}


class WeatherTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = ObservationStore(Path(self.tmp.name) / "weather.sqlite3")
        self.weather = WeatherEvidence(self.store)
        self.raw = series()
        response = httpx.Response(200, json=self.raw, request=httpx.Request("GET", "https://api.open-meteo.com/v1/forecast"))
        self.response = response
        self.client = AsyncMock()
        self.client.get.return_value = response
        self.client.__aenter__.return_value = self.client
        self.patch = patch("backend.aic.weather.httpx.AsyncClient", return_value=self.client)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def replace_raw(self, value):
        self.client.get.return_value = httpx.Response(200, json=value, request=self.response.request)

    async def test_window_provenance_snapshot_and_cache(self):
        value = await self.weather.timeline("campus")
        self.assertEqual(len(value["points"]), 48)
        self.assertEqual({p["period"] for p in value["points"]}, {"past_model", "forecast"})
        self.assertEqual(value["snapshot"]["requested_location"]["latitude"], SITES["campus"]["latitude"])
        self.assertEqual(self.store.raw(value["snapshot"]["id"]), self.raw)
        self.assertEqual(await self.weather.timeline("campus"), value)
        self.assertEqual(self.client.get.call_count, 1)
        await self.weather.timeline("zhongyuan")
        self.assertEqual(self.client.get.call_count, 2)

    async def test_bad_measurements_retained_as_missing(self):
        raw = copy.deepcopy(self.raw)
        raw["hourly"]["temperature_2m"][30] = None
        raw["hourly"]["relative_humidity_2m"][30] = 101
        raw["hourly"]["wind_speed_10m"][30] = True
        raw["hourly"]["precipitation"][30] = -1
        self.replace_raw(raw)
        value = await self.weather.timeline()
        at = next(p for p in value["points"] if p["time"].startswith(raw["hourly"]["time"][30]))
        self.assertTrue(all(at[key] is None for key in ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"]))

    async def test_units_timezone_lengths_and_empty_rejected(self):
        cases = []
        raw = series(); raw["hourly_units"]["temperature_2m"] = "F"; cases.append(raw)
        raw = series(); raw["utc_offset_seconds"] = 0; cases.append(raw)
        raw = series(); raw["hourly"]["wind_speed_10m"].pop(); cases.append(raw)
        raw = series(); raw["hourly"]["temperature_2m"] = [None] * 61; cases.append(raw)
        for raw in cases:
            self.replace_raw(raw)
            with self.assertRaises(ValueError):
                await self.weather.timeline()

    async def test_current_sites_and_cache_are_independent(self):
        raw = {"utc_offset_seconds": 28800, "latitude": 34.8, "longitude": 113.5,
               "current_units": {"temperature_2m": "°C", "relative_humidity_2m": "%"},
               "current": {"time": "2026-10-20T10:00", "temperature_2m": 25, "relative_humidity_2m": 60}}
        self.replace_raw(raw)
        a = await self.weather.get("current", "campus")
        b = await self.weather.get("current", "zhongyuan")
        self.assertNotEqual(a["requested_location"], b["requested_location"])
        self.assertEqual((await self.weather.get("current", "campus"))["id"], a["id"])
        self.assertEqual(self.client.get.call_count, 2)

    async def test_wrong_grid_and_offset_timestamps_rejected(self):
        for changes in [{"latitude": True}, {"longitude": 0}]:
            self.replace_raw({**series(), **changes})
            with self.assertRaises(ValueError):
                await self.weather.timeline()
        raw = series(); raw["hourly"]["time"][30] += "+00:00"
        self.replace_raw(raw)
        with self.assertRaises(ValueError):
            await self.weather.timeline()

    async def test_uniform_historical_hour_not_each_point_peak(self):
        raw = {"utc_offset_seconds": 28800, "latitude": 34.8, "longitude": 113.5,
               "hourly_units": {"temperature_2m": "°C", "relative_humidity_2m": "%"},
               "hourly": {"time": ["2024-06-12T14:00", "2024-06-12T15:00"],
                          "temperature_2m": [32, 34], "relative_humidity_2m": [50, 45]}}
        self.replace_raw(raw)
        chosen = await self.weather.get("history", history_hour=14)
        peak = await self.weather.get("history")
        self.assertEqual(chosen["temperature_c"], 32)
        self.assertEqual(peak["temperature_c"], 34)
        self.assertIn("统一历史参考时刻", chosen["selection"])
        with self.assertRaises(ValueError):
            await self.weather.get("history", history_hour=13)

    async def test_cache_and_locks_stay_bounded(self):
        for i in range(600):
            self.weather.lock_for(("synthetic", i))
            self.weather.cache_record(("synthetic", i), 100, i)
        self.assertLessEqual(len(self.weather.cache), 256)
        self.assertLessEqual(len(self.weather.locks), 64)
        self.assertIs(self.weather.lock_for("same-key"), self.weather.lock_for("same-key"))


class TimelineAPITests(unittest.TestCase):
    def test_upstream_failure_and_site_validation(self):
        from . import router as module
        app = FastAPI(); app.include_router(module.router)
        with TestClient(app) as client, patch.object(module.weather, "timeline", side_effect=httpx.ConnectError("synthetic")):
            response = client.get("/api/weather/aic/timeline")
            self.assertEqual(response.status_code, 503)
            self.assertIn("未生成替代", response.json()["detail"])
            self.assertEqual(client.get("/api/weather/aic/timeline?site=invalid").status_code, 422)
            self.assertEqual(client.get("/api/weather/aic/observations/current?site=invalid").status_code, 422)


if __name__ == "__main__":
    unittest.main()
