"""Install only project telemetry routes; run on the deployment host as root."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


def run(*args):
    subprocess.run(args, check=True)


def http_status(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


release = Path(__file__).resolve().parent
app = Path("/root/microclimate-decision")
python = app / ".venv/bin/python"
backup = release / "before"
backup.mkdir(mode=0o700)
os.chmod(release, 0o700)
main_path = app / "backend/main.py"
source = main_path.read_text(encoding="utf-8")
anchor = "from backend.temporal import router as temporal_router\napp.include_router(temporal_router)\n"
registration = '''
if os.getenv("MOBILE_TELEMETRY_ENABLED", "1") == "1" and os.getenv("COLLECTION_IOT_DISABLED") != "1":
    from backend.telemetry import router as telemetry_router
    app.include_router(telemetry_router)
'''
if "from backend.telemetry import router as telemetry_router" not in source:
    assert source.count(anchor) == 1, "Router anchor changed; refusing broad replacement"
    source = source.replace(anchor, anchor + registration, 1)
if 'limit = 8 * 1024 * 1024' not in source:
    start = source.index("async def bounded_request_body(request: Request):")
    stop = source.index('\n@app.middleware("http")', start)
    body = source[start:stop]
    target = '    length = request.headers.get("content-length")'
    assert body.count(target) == 1
    body = body.replace(target, '''    limit = MAX_REQUEST_BYTES
    if request.method == "PUT" and re.fullmatch(r"/api/weather/telemetry/media/[a-f0-9]{64}", request.url.path):
        limit = 8 * 1024 * 1024
''' + target, 1)
    assert body.count('> MAX_REQUEST_BYTES:') == 2
    body = body.replace('> MAX_REQUEST_BYTES:', '> limit:')
    source = source[:start] + body + source[stop:]
compile(source, str(main_path), "exec")

env_path = Path("/etc/microclimate-project-telemetry.env")
dropin = Path("/etc/systemd/system/microclimate-decision-api.service.d/telemetry.conf")
aic_conf = Path("/etc/nginx/sites-available/aic")
files = [main_path, app / "backend/telemetry.py", app / "backend/data_contract.py", env_path, dropin, aic_conf]
manifest = []
for i, path in enumerate(files):
    item = {"path": str(path), "existed": path.exists(), "backup": str(backup / str(i))}
    if item["existed"]:
        shutil.copy2(path, item["backup"])
    manifest.append(item)
(backup / "manifest.json").write_text(json.dumps(manifest, indent=2))

run(str(python), "-m", "pip", "install", "--disable-pip-version-check", "Pillow==12.0.0")
credentials = {}
if env_path.exists():
    for line in env_path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep:
            credentials[key] = value
credentials.update(MOBILE_TELEMETRY_ENABLED="1", COLLECTION_IOT_DISABLED="0",
                   TELEMETRY_STATE_DB=str(app / "state/mobile-telemetry.sqlite3"),
                   TELEMETRY_MEDIA_DIR=str(app / "state/telemetry-media"))
credentials.setdefault("TELEMETRY_INGEST_TOKEN", secrets.token_urlsafe(48))
assert credentials["TELEMETRY_INGEST_TOKEN"], "Empty token is forbidden"

try:
    (app / "state").mkdir(mode=0o700, exist_ok=True)
    (app / "state/telemetry-media").mkdir(mode=0o700, exist_ok=True)
    main_path.write_text(source, encoding="utf-8")
    shutil.copy2(release / "telemetry.py", app / "backend/telemetry.py")
    shutil.copy2(release / "data_contract.py", app / "backend/data_contract.py")
    env_path.write_text("".join(f"{k}={v}\n" for k, v in credentials.items()))
    env_path.chmod(0o600)
    dropin.parent.mkdir(exist_ok=True)
    dropin.write_text("[Service]\nEnvironmentFile=/etc/microclimate-project-telemetry.env\nUMask=0077\n")
    nginx = aic_conf.read_text()
    if "location ^~ /api/weather/telemetry/" not in nginx:
        anchor = '    # Competition has its own process, state and upstream access policy.'
        assert nginx.count(anchor) == 1, "Unexpected competition nginx config"
        nginx = nginx.replace(anchor, '''    location = /api/weather/telemetry { return 404; }
    location ^~ /api/weather/telemetry/ { return 404; }

''' + anchor, 1)
        aic_conf.write_text(nginx)
    run(str(python), "-m", "compileall", "-q", str(app / "backend/telemetry.py"), str(main_path))
    run("nginx", "-t")
    run("systemctl", "daemon-reload")
    run("systemctl", "restart", "microclimate-decision-api.service")
    ready = False
    for _ in range(25):
        try:
            if http_status("http://127.0.0.1:3100/api/weather/telemetry/schema") == 401:
                ready = True
                break
        except OSError:
            pass
        time.sleep(1)
    assert ready, "Project telemetry API did not become ready"
    req = urllib.request.Request("http://127.0.0.1:3100/api/weather/telemetry/schema",
                                 headers={"X-Telemetry-Token": credentials["TELEMETRY_INGEST_TOKEN"]})
    with urllib.request.urlopen(req, timeout=10) as response:
        assert json.load(response)["schema_version"] == "WJTJ-mobile-telemetry-1.0"
    assert http_status("http://127.0.0.1:3102/api/weather/telemetry/schema") == 404
    run("systemctl", "reload", "nginx")
except Exception:
    for item in reversed(manifest):
        path = Path(item["path"])
        if item["existed"]:
            shutil.copy2(item["backup"], path)
        else:
            path.unlink(missing_ok=True)
    run("systemctl", "daemon-reload")
    run("systemctl", "restart", "microclimate-decision-api.service")
    if subprocess.run(["nginx", "-t"]).returncode == 0:
        run("systemctl", "reload", "nginx")
    raise

client_config = release / "telemetry.env"
client_config.write_text("TELEMETRY_BASE_URL=https://weather.nogamenolife.cn\n"
                         + "TELEMETRY_INGEST_TOKEN=" + credentials["TELEMETRY_INGEST_TOKEN"] + "\n")
client_config.chmod(0o600)
report = {"project_telemetry": "deployed", "competition_telemetry": "disabled",
          "credential_file": str(client_config), "backup": str(backup),
          "module_sha256": hashlib.sha256((app / "backend/telemetry.py").read_bytes()).hexdigest()}
(release / "deployment.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
