"""Isolated API safety tests; no production PostgreSQL connection or writes."""
import csv
import io
import json
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import app as api


class ConnectionContext:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_):
        return False


class Pool:
    def __init__(self):
        self.connection = AsyncMock()
        self.connection.fetch.return_value = []

    def acquire(self):
        return ConnectionContext(self.connection)


class IoTSafetyTests(unittest.TestCase):
    def setUp(self):
        self.pool = Pool()
        self.pool_patch = patch.object(api, "get_pool", AsyncMock(return_value=self.pool))
        self.pool_patch.start()
        self.token_patch = patch.object(api, "API_WRITE_TOKEN", "qa-isolated-token")
        self.token_patch.start()
        self.client = TestClient(api.app)
        self.headers = {"X-API-Key": "qa-isolated-token"}
        self.payload = {"device": "qa-atom", "data": [[time.time(), 25, 50]]}

    def tearDown(self):
        self.client.close()
        self.token_patch.stop()
        self.pool_patch.stop()

    def test_health_docs_and_template_pages(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        for path in ["/docs", "/openapi.json"]:
            self.assertEqual(self.client.get(path).status_code, 404)
        for path in ["/?view=monitor", "/sensors", "/logs"]:
            self.assertEqual(self.client.get(path).status_code, 200)

    def test_write_access_fails_closed(self):
        self.assertEqual(self.client.post("/api/backfill", json=self.payload).status_code, 401)
        with patch.object(api, "API_WRITE_TOKEN", ""):
            self.assertEqual(self.client.post("/api/backfill", json=self.payload, headers=self.headers).status_code, 503)
        self.pool.connection.executemany.assert_not_called()

    def test_valid_backfill_keeps_protocol_and_bound_parameters(self):
        response = self.client.post("/api/backfill", json=self.payload, headers=self.headers)
        self.assertEqual(response.json(), {"ok": True, "count": 1})
        args = self.pool.connection.executemany.call_args.args
        self.assertNotIn("qa-atom", args[0])
        self.assertEqual(args[1][0][1:], ("qa-atom", 25.0, 50.0))

    def test_hostile_backfill_and_physical_limits(self):
        cases = [dict(self.payload, device="../invalid"), dict(self.payload, data=[]),
                 dict(self.payload, data=[[time.time(), 25, 101]]),
                 dict(self.payload, data=[[time.time(), 81, 50]]),
                 dict(self.payload, data=[[time.time() + 3600, 25, 50]]),
                 dict(self.payload, data=self.payload["data"] * 2001),
                 dict(self.payload, injected="not-public-secret")]
        for payload in cases:
            response = self.client.post("/api/backfill", json=payload, headers=self.headers)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("not-public-secret", response.text)
        self.pool.connection.executemany.assert_not_called()

    def test_nonfinite_and_malformed_errors_are_serializable(self):
        for raw in ['{"device":', '{"device":"qa","data":[[1700000000,NaN,50]]}',
                    '{"device":"qa","data":[[1700000000,25,Infinity]]}']:
            response = self.client.post("/api/backfill", content=raw,
                                        headers={**self.headers, "Content-Type": "application/json"})
            self.assertEqual(response.status_code, 422)
            self.assertNotIn('"input"', response.text)

    def test_request_bodies_are_bounded_even_without_declared_length(self):
        for body in [b"x" * 262145, iter([b"x" * 140000, b"x" * 140000])]:
            response = self.client.post("/api/backfill", content=body, headers=self.headers)
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.headers["cache-control"], "no-store")

    def test_hours_and_dates_reject_invalid_values(self):
        for path in ["/api/history/qa", "/api/track/qa"]:
            for hours in [0, -1, 169, "NaN"]:
                self.assertEqual(self.client.get(path, params={"hours": hours}).status_code, 422)
        self.assertEqual(self.client.get("/api/export/qa?date=not-a-date").status_code, 422)
        self.pool.connection.fetch.assert_not_called()

    def test_sql_metacharacters_remain_bound_data(self):
        device = "qa'; DROP TABLE sensor_data;--"
        self.assertEqual(self.client.get("/api/history/" + device).status_code, 200)
        sql, *args = self.pool.connection.fetch.call_args.args
        self.assertNotIn(device, sql)
        self.assertEqual(args[0], device)

    def test_history_decodes_database_extension_fields(self):
        self.pool.connection.fetch.return_value = [{"ts": "2026-10-21T06:00:00Z", "extra": '{"surface_c":32.5}'}]
        response = self.client.get("/api/history/qa")
        self.assertEqual(response.json()[0]["extra"], {"surface_c": 32.5})

    def test_csv_escapes_formulas_preserves_numbers_and_observation_fields(self):
        self.pool.connection.fetch.return_value = [{
            "ts": datetime(2026, 10, 21, tzinfo=timezone.utc), "temp_c": -2.5,
            "humidity": 50, "bat_v": 4.1, "uptime_s": 10,
            "extra": {"=header": " =HYPERLINK(\"bad\")", "note": "@SUM(1)", "temp_c": 999},
        }]
        response = self.client.get("/api/export/qa", params={"date": "2026-10-21"})
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.text)))
        self.assertIn("'=header", rows[0])
        self.assertEqual(rows[1][rows[0].index("temp_c")], "-2.5")
        self.assertEqual(rows[1][rows[0].index("note")], "'@SUM(1)")
        self.assertTrue(rows[1][rows[0].index("'=header")].startswith("'"))
        self.assertEqual(rows[0].count("temp_c"), 1)
        self.assertIn("2026-10-21", response.headers["content-disposition"])

    def test_safe_request_ids_and_no_exception_details(self):
        response = self.client.get("/health", headers={"X-Request-ID": "x" * 200})
        self.assertRegex(response.headers["x-request-id"], r"^[a-z0-9]{16}$")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        with patch.object(api, "get_pool", AsyncMock(side_effect=RuntimeError("private diagnostic"))):
            response = self.client.get("/api/devices")
            self.assertEqual(response.status_code, 500)
            self.assertNotIn("private diagnostic", response.text)

    def test_asset_allowlist(self):
        self.assertEqual(self.client.get("/home-assets/private.env").status_code, 404)


if __name__ == "__main__":
    unittest.main()
