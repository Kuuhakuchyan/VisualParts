"""Record provider metadata and acquisition dates for the campus imagery audit."""
import concurrent.futures
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parents[1] / "output/campus-data/providers"
POINT = "113.530,34.819"


def fetch(name, url, params=None, payload=None):
    try:
        with httpx.Client(timeout=35, follow_redirects=True) as client:
            response = client.post(url, json=payload) if payload else client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"name": name, "url": str(response.url), "data": data}
    except Exception as exc:
        return {"name": name, "error": str(exc)}


def main():
    base = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
    jobs = [(f"esri-z{z}", f"{base}/{layer}/query", {"f": "json", "geometry": POINT,
             "geometryType": "esriGeometryPoint", "inSR": 4326, "outFields": "*", "returnGeometry": "false"}, None)
            for z, layer in [(15, 13), (16, 12), (17, 11), (18, 10), (19, 9)]]
    jobs += [("clarity", "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/identify",
              {"f": "json", "geometry": POINT, "geometryType": "esriGeometryPoint", "sr": 4326,
               "mapExtent": "113.52,34.805,113.54,34.83", "imageDisplay": "1024,1024,96", "tolerance": 1, "returnGeometry": "false"}, None),
             ("wayback", "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json", None, None),
             ("sentinel-latest", "https://planetarycomputer.microsoft.com/api/stac/v1/search", None,
              {"collections": ["sentinel-2-l2a"], "bbox": [113.522,34.808,113.537,34.829],
               "datetime": "2025-01-01/2026-10-20T23:59:59Z", "limit": 8,
               "query": {"eo:cloud_cover": {"lt": 15}}, "sortby": [{"field": "properties.datetime", "direction": "desc"}]})]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda args: fetch(*args), jobs))
    summary = []
    for result in results:
        data = result.pop("data", None)
        if data:
            if result["name"] == "wayback":
                result["recent_releases"] = sorted(data.values(), key=lambda x:x.get("itemTitle", ""), reverse=True)[:3]
            elif result["name"] == "sentinel-latest":
                result["items"] = [{"id": f["id"], "properties": f["properties"], "visual": f.get("assets", {}).get("visual")} for f in data.get("features", [])]
            else:
                result["data"] = data
        summary.append(result)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "summary.json").write_text(json.dumps({"checked_at": datetime.now(timezone.utc).isoformat(), "providers": summary}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=True))


if __name__ == "__main__":
    main()
