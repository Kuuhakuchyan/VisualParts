"""Competition telemetry must never make a request to the project deployment."""
import os
import unittest
from unittest.mock import patch
from backend.collection import read_devices


class CompetitionIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_isolated_devices_never_open_http_client(self):
        with patch.dict(os.environ, {"COLLECTION_IOT_DISABLED": "1"}), patch("backend.collection.httpx.AsyncClient", side_effect=AssertionError("cross-deployment access")):
            devices = await read_devices()
        self.assertEqual(len(devices), 2)
        for item in devices:
            self.assertEqual(item["status"], "isolated")
            self.assertIsNone(item["temperature_c"])
            self.assertIsNone(item["humidity_pct"])
            self.assertFalse(item["med_eligible"])
