"""Smoke-test the Docker COPY layout in an isolated directory, without a server."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.release_check import check_release


SMOKE = r'''
import os
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import main, lcz, sandbox, collection, temporal, spatial_surrogate
from backend.release import SOFTWARE_VERSION
from backend.release_check import check_release

assert check_release()['status'] == 'PASS'
assert len(sandbox.buildings()['features']) > 0
assert len(sandbox.buildings('neighborhood')['features']) > 0
assert not collection.roads().is_empty
assert len(lcz.metadata()['available_class_codes']) > 1
assert temporal.artifact()['coefficients']
assert spatial_surrogate.manifest()['available']
with patch('httpx.AsyncClient', side_effect=AssertionError('unexpected network access')):
    with TestClient(main.app, base_url='http://localhost') as client:
        health = client.get('/health')
        assert health.status_code == 200, health.text
        assert health.json()['softwareVersion'] == SOFTWARE_VERSION
        assert health.headers['x-decision-api-version'] == os.getenv('APP_VERSION', SOFTWARE_VERSION)
        result = client.get('/api/weather/sandbox/lcz-metadata')
        assert result.status_code == 200, result.text
        device_paths = {route.path for route in main.app.routes}
        if os.environ['COLLECTION_IOT_DISABLED'] == '1':
            assert not any(path.startswith('/api/weather/telemetry') or path.startswith('/api/weather/mobile-observations') for path in device_paths)
            assert client.get('/api/weather/telemetry/schema').status_code == 404
            result = client.get('/api/weather/sandbox/collection/devices')
            assert result.status_code == 200, result.text
            assert all(device['status'] == 'isolated' for device in result.json()['devices'])
        else:
            assert '/api/weather/telemetry/schema' in device_paths
            result = client.get('/api/weather/mobile-observations/devices')
            assert result.status_code == 200, result.text
            assert result.json()['devices'] == []
print('Isolated package smoke passed:', 'competition' if os.environ['COLLECTION_IOT_DISABLED'] == '1' else 'project')
'''


def main():
    result = check_release(ROOT, frontend=True)
    if result["status"] != "PASS":
        print(json.dumps(result["errors"], ensure_ascii=False))
        return 1
    with tempfile.TemporaryDirectory(prefix="wjtj-runtime-") as directory:
        package = Path(directory)
        shutil.copytree(ROOT / "backend", package / "backend", ignore=shutil.ignore_patterns(
            "__pycache__", "*.pyc", "test_*.py", "*.sqlite3*", "*.db", ".env*", "review-private"))
        shutil.copy2(ROOT / "runtime-assets.json", package / "runtime-assets.json")
        for item in result["files"]:
            destination = package / item["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / item["path"], destination)
        for edition in ("project", "competition"):
            state = package / ("state-" + edition)
            state.mkdir()
            # No production URL, token, knowledge review or database is inherited.
            env = {name: value for name, value in os.environ.items() if name.upper() in {
                "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "LANG", "VIRTUAL_ENV"}}
            env.update(PYTHONPATH=str(package), PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1",
                       DECISION_STATE_DB=str(state / "decision.sqlite3"),
                       WORKSPACE_STATE_DB=str(state / "workspace.sqlite3"),
                       AIC_STATE_DB=str(state / "aic.sqlite3"),
                       TELEMETRY_STATE_DB=str(state / "telemetry.sqlite3"),
                       TELEMETRY_MEDIA_DIR=str(state / "media"),
                       MOBILE_TELEMETRY_ENABLED="1", MOBILE_TELEMETRY_PUBLIC_VIEW="1",
                       COLLECTION_IOT_DISABLED="1" if edition == "competition" else "0",
                       DECISION_ENABLE_LEGACY_MOCK="0", ALLOWED_HOSTS="localhost,127.0.0.1")
            subprocess.run([sys.executable, "-c", SMOKE], cwd=package, env=env, check=True, timeout=120)
    return 0


if __name__ == "__main__":
    sys.exit(main())
