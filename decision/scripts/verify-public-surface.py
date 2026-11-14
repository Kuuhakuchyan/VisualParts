"""Low-volume public smoke/security probes. No writes to real records."""
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag in {"img", "script"} and data.get("src"):
            self.urls.add(data["src"])
        if tag == "link" and data.get("rel") == "stylesheet":
            self.urls.add(data.get("href", ""))


checks, pages, assets = [], [], set()


def check(condition, name):
    assert condition, name
    checks.append(name)


with httpx.Client(base_url="https://weather.nogamenolife.cn", timeout=30, follow_redirects=True) as client:
    for path in ["/", "/author/", "/author/posts/microjie-overview/", "/author/posts/platform-architecture/",
                 "/author/posts/roadmap-security/", "/monitor", "/sensors", "/logs", "/grafana/",
                 "/decision/aic/home.html", "/decision/aic/journal.html"]:
        response = client.get(path)
        check(response.status_code == 200, path + " is publicly reachable")
        parser = Assets()
        parser.feed(response.text)
        for relative in parser.urls:
            url = urljoin(str(response.url), relative)
            if urlparse(url).netloc == "weather.nogamenolife.cn":
                assets.add(url)
        pages.append({"path": path, "final_url": str(response.url), "bytes": len(response.content)})
    for url in sorted(assets):
        response = client.get(url)
        check(response.status_code == 200 and len(response.content) > 0, "local asset " + urlparse(url).path)
    for path, local in [("/decision/", "dist/index.html"), ("/decision/aic/", "dist/aic/index.html")]:
        response = client.get(path)
        check(hashlib.sha256(response.content).hexdigest() == hashlib.sha256(Path(local).read_bytes()).hexdigest(), path + " matches current built entry byte-for-byte")
    for path in ["/api/devices", "/api/map/devices", "/api/weather/aic/status", "/api/weather/sandbox/collection/devices"]:
        response = client.get(path)
        check(response.status_code == 200, path + " read API healthy")
        response.json()
    devices = client.get("/api/devices").json()
    for device in devices[:2]:
        response = client.get("/api/history/" + device["device_id"], params={"hours": 24})
        check(response.status_code == 200 and isinstance(response.json(), list), device["device_id"] + " history contract valid")
    response = client.post("/api/backfill", json={"device": "qa-no-write", "data": [[1700000000, 25, 50]]})
    check(response.status_code == 401, "anonymous telemetry write rejected without modifying data")
    response = client.post("/api/weather/sandbox/validate", content='{"additions":[{"id":"new-qa","longitude":NaN}]}', headers={"Content-Type": "application/json"})
    check(response.status_code == 422 and '"input"' not in response.text, "nonfinite geometry produces safe public 422")
    response = client.get("/api/history/qa-no-record", params={"hours": -1})
    check(response.status_code == 422, "negative history interval rejected")
    response = client.get("/api/export/qa-no-record", params={"date": "not-a-date"})
    check(response.status_code == 422, "invalid archive date rejected")
    response = client.post("/api/simulation/what-if", json={"action": "ADD", "targetBuildingId": "qa-nonexistent"})
    check(response.status_code == 409, "valid legacy random-model request is explicitly disabled without creating a scenario")
    response = client.get("/api/simulation/scenarios/qa-no-record/undo")
    check(response.status_code == 405, "GET can no longer delete legacy scenarios")
    status = client.get("/api/weather/sandbox/collection/devices").json()
    check(all(d.get("temperature_c") is None and d.get("humidity_pct") is None for d in status["devices"] if d["status"] == "offline"), "offline adapters do not fabricate readings")

result = {"checks": checks, "pages": pages, "asset_count": len(assets), "devices": devices,
          "note": "Only read-only GET and non-persisting invalid/unauthorized requests; no stress testing."}
Path("output/playwright/public-surface.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"passed": len(checks), "pages": len(pages), "assets": len(assets)}, ensure_ascii=False))
