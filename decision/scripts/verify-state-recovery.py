"""Restore all real SQLite schemas and synthetic media, then read them through APIs."""
import argparse
import asyncio
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/state-recovery")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    from copyright_fixture import configure, install_weather, seed, OWNER
    from backend.state_backup import backup, restore, verify, sha256, database_facts
    checks = []
    def check(value, label):
        if not value:
            raise AssertionError(label)
        checks.append(label)
    def rejects(action, label):
        try:
            action()
        except (ValueError, OSError, sqlite3.DatabaseError):
            checks.append(label)
        else:
            raise AssertionError(label)
    with tempfile.TemporaryDirectory(prefix="wjtj-restore-fixture-") as tmp:
        root = Path(tmp)
        state = configure(root / "original")
        from backend import main as api, planning, telemetry
        from backend.aic import router as aic
        from fastapi.testclient import TestClient
        install_weather()
        fixture = seed(api.app)
        observation = asyncio.run(aic.weather.get("current"))
        databases = {name: state / "databases" / (name + ".sqlite3") for name in ("decision", "workspace", "evidence", "telemetry")}
        def logical(path):
            with closing(sqlite3.connect(path)) as db:
                return "\n".join(db.iterdump())
        original = {name: logical(path) for name, path in databases.items()}
        rejects(lambda: backup(databases, state / "media", root / "blocked"), "cross-store backup requires writers stopped")
        manifest = backup(databases, state / "media", root / "backup", writers_stopped=True)
        check(len(manifest["files"]) == 5, "four databases and one synthetic image in verified snapshot")
        check(verify(root / "backup") == manifest, "backup checksums and database integrity verified")
        restore(root / "backup", root / "restored")
        restored = root / "restored"
        facts = {}
        for name in databases:
            path = restored / "databases" / (name + ".sqlite3")
            check(logical(path) == original[name], name + " schema and all row values restored exactly")
            facts[name] = database_facts(path)
        check(sha256(restored / "media" / fixture["image_sha256"]) == fixture["image_sha256"], "image bytes retain original digest")
        api.STATE_DB_PATH = restored / "databases/decision.sqlite3"
        planning.store.path = restored / "databases/workspace.sqlite3"
        aic.store.path = restored / "databases/evidence.sqlite3"
        telemetry.store.path = restored / "databases/telemetry.sqlite3"
        os.environ["TELEMETRY_MEDIA_DIR"] = str(restored / "media")
        with TestClient(api.app) as client:
            auth = {"X-Workspace-Token": OWNER}
            check(client.get("/api/weather/workspace/plans", headers=auth).json()["plans"][0] == fixture["plan"], "restored workspace report and digest read back through API")
            check(len(client.get("/api/weather/sandbox/scenes", headers=auth).json()["scenes"]) == 1, "saved scene visible after restore")
            check(client.get("/api/weather/aic/observations/" + observation["id"]).json()["observation"] == observation, "observation and provenance read back after restore")
            for kind in ("UGV", "UAV"):
                data = client.get("/api/weather/mobile-observations/devices/" + kind + "-UI-QA").json()
                check(data["stats"]["total"] == 3 and data["device"]["measurements"]["temperature_c"] == 29.3, kind + " latest values and history restored")
            check(client.get("/api/weather/mobile-observations/images/" + fixture["image_sha256"]).status_code == 200, "restored media and telemetry references remain linked")
            check(client.get("/api/weather/telemetry/devices").status_code == 401, "restoration does not bypass private API authentication")
        rejects(lambda: restore(root / "backup", restored), "restore refuses to overwrite existing directory")
        shutil.copytree(root / "backup", root / "tampered")
        (root / "tampered/media" / fixture["image_sha256"]).write_bytes(b"corrupt")
        rejects(lambda: restore(root / "tampered", root / "bad-target"), "corrupt media blocks restoration")
        check(not (root / "bad-target").exists(), "failed verification leaves no restored target")
        shutil.copytree(root / "backup", root / "traversal")
        invalid = json.loads((root / "traversal/manifest.json").read_text())
        invalid["files"][0]["path"] = "../outside.sqlite3"
        (root / "traversal/manifest.json").write_text(json.dumps(invalid))
        rejects(lambda: restore(root / "traversal", root / "escape"), "path traversal manifest rejected")
        check(all(logical(path) == original[name] for name, path in databases.items()), "original databases unchanged by backup, restore, and negative tests")
        result = {"status": "PASS", "test_fixture": True, "production_mutated": False, "passed": len(checks),
                  "checks": checks, "restored_tables": facts, "snapshot_files": manifest["files"]}
    (args.output / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"State recovery: PASS ({len(checks)} checks)")


if __name__ == "__main__":
    main()
