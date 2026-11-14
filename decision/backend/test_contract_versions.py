"""Public contracts identify the computation actually used by this release."""
import os
import unittest
from unittest.mock import patch

from backend import collection, routing, data_contract


class ContractVersionTests(unittest.TestCase):
    def test_contract_uses_actual_collection_and_planner_versions(self):
        value = data_contract.contract()["collection_simulation"]
        self.assertEqual(value["schema_version"], collection.VERSION)
        self.assertEqual(value["planner"], routing.VERSION)

    def test_competition_contract_keeps_versions_but_excludes_field_telemetry(self):
        with patch.dict(os.environ, {"COLLECTION_IOT_DISABLED": "1"}):
            value = data_contract.contract()
        self.assertNotIn("mobile_telemetry", value)
        self.assertEqual(value["collection_simulation"]["schema_version"], collection.VERSION)
        self.assertEqual(value["collection_simulation"]["planner"], routing.VERSION)

    def test_version_change_cannot_leave_stale_hardcoded_contract(self):
        with patch.object(collection, "VERSION", "test-collection-version"), patch.object(routing, "VERSION", "test-routing-version"):
            value = data_contract.contract()["collection_simulation"]
        self.assertEqual(value["schema_version"], "test-collection-version")
        self.assertEqual(value["planner"], "test-routing-version")
