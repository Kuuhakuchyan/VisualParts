"""Serve frozen UI and real calculation APIs against isolated synthetic state."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18501)
    parser.add_argument("--reuse", action="store_true")
    args = parser.parse_args()
    from copyright_fixture import configure, install_weather, seed
    state = configure(args.state_dir)
    from backend.main import app
    install_weather()
    from fastapi import Request
    from fastapi.responses import FileResponse, Response
    from fastapi.staticfiles import StaticFiles
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
    @app.middleware("http")
    async def provenance(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Test-Fixture"] = "synthetic-only"
        response.headers["X-Source-Revision"] = revision
        return response
    @app.get("/api/sensors/detail")
    async def fixed_sensors():
        return []
    @app.get("/api/devices")
    async def fixed_devices():
        return []
    @app.get("/api/logs")
    async def logs():
        return []
    @app.get("/home.html")
    async def home():
        return FileResponse(ROOT.parent / "api/templates/home.html")
    for name in ("sensors", "monitor", "logs"):
        async def template(name=name):
            return FileResponse(ROOT.parent / "api/templates" / (name + ".html"))
        app.add_api_route("/" + name, template, include_in_schema=False)
    @app.get("/console.css")
    async def css():
        return FileResponse(ROOT.parent / "api/static/console.css")
    @app.get("/logo.png")
    async def logo():
        return FileResponse(ROOT / "dist/logo.png")
    @app.get("/api/latest/{device_id}")
    async def fixed_latest(device_id: str):
        return {"device_id": device_id, "test_fixture": True}
    @app.get("/api/synthetic-provenance")
    async def metadata():
        return {"source_revision": revision, "test_fixture": True, "computation": "real local modules; weather and device inputs synthetic"}
    @app.get("/tiles/{path:path}")
    async def tiles(path: str):
        import httpx
        from fastapi import HTTPException
        if not path or ".." in path or not all(c.isalnum() or c in "-._/" for c in path):
            raise HTTPException(400)
        async with httpx.AsyncClient(timeout=15) as client:
            result = await client.get("https://weather.nogamenolife.cn/tiles/" + path)
        return Response(result.content, status_code=result.status_code, media_type=result.headers.get("content-type"))
    app.mount("/home-assets", StaticFiles(directory=ROOT.parent / "api/static/home"))
    app.mount("/aic", StaticFiles(directory=ROOT / "dist/aic", html=True))
    app.mount("/decision/cesium", StaticFiles(directory=ROOT / "dist/decision/cesium"))
    app.mount("/decision", StaticFiles(directory=ROOT / "dist", html=True))
    if not args.reuse:
        if (state / "fixture.json").exists():
            raise ValueError("Use a new state directory or --reuse")
        (state / "fixture.json").write_text(json.dumps(seed(app), ensure_ascii=False, indent=2), encoding="utf-8")
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
