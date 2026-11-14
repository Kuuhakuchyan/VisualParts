"""A package must fail closed when required files or metadata are broken."""
import json
from pathlib import Path
import tempfile
import unittest

from backend.release_check import check_release


class ReleaseCheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.write("release-version.json", {"software_name": "test", "version": "1.0.0"})
        self.write("runtime-assets.json", {"schema_version": "WJTJ-runtime-assets-1.0", "files": [
            {"path": "release-version.json", "kind": "release"},
            {"path": "roads.geojson", "kind": "spatial"}]})
        self.write("roads.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature"}]})

    def write(self, name, data):
        (self.root / name).write_text(json.dumps(data), encoding="utf-8")

    def test_complete_package_has_content_hashes(self):
        result = check_release(self.root)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(len(result["files"]), 2)
        self.assertTrue(all(len(item["sha256"]) == 64 for item in result["files"]))

    def test_missing_file_fails_instead_of_silently_disabling_routes(self):
        (self.root / "roads.geojson").unlink()
        self.assertEqual(check_release(self.root)["status"], "FAIL")

    def test_empty_and_nonfinite_assets_fail(self):
        for payload in ('{}', '{"type":"FeatureCollection","features":[]}', '{"value":NaN}', '{'):
            with self.subTest(payload=payload):
                (self.root / "roads.geojson").write_text(payload, encoding="utf-8")
                self.assertEqual(check_release(self.root)["status"], "FAIL")

    def test_version_mismatch_fails(self):
        self.write("package.json", {"version": "2.0.0"})
        self.write("package-lock.json", {"version": "1.0.0", "packages": {"": {"version": "1.0.0"}}})
        self.assertIn("frontend/backend software versions differ", check_release(self.root, frontend=True)["errors"])

    def test_escape_absolute_duplicate_and_windows_paths_fail(self):
        for names in (["../outside.json"], ["/etc/passwd"], ["C:/secret.json"],
                      ["..\\secret.json"], ["release-version.json", "release-version.json"]):
            with self.subTest(names=names):
                self.write("runtime-assets.json", {"schema_version": "WJTJ-runtime-assets-1.0",
                                                   "files": [{"path": name} for name in names]})
                self.assertEqual(check_release(self.root)["status"], "FAIL")

    def test_malformed_manifest_fails_cleanly(self):
        for value in ([], {}, {"schema_version": "WJTJ-runtime-assets-1.0", "files": []}):
            self.write("runtime-assets.json", value)
            self.assertEqual(check_release(self.root)["status"], "FAIL")
