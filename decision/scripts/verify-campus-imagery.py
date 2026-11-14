"""Verify pinned high-resolution imagery across the campus, retaining evidence."""
import concurrent.futures
import json
import math
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parents[1] / "output/campus-data/verified"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        service = "https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer"
        points = [(113.530,34.819),(113.525,34.811),(113.533,34.811),(113.526,34.826),(113.533,34.826)]
        evidence = []
        for lon, lat in points:
            response = client.get(service+"/10/query", params={"f":"json", "geometry":f"{lon},{lat}","geometryType":"esriGeometryPoint", "inSR":4326,"outFields":"*","returnGeometry":"false"})
            response.raise_for_status()
            evidence.append({"point":[lon,lat],"url":str(response.url),"data":response.json()})
        (OUT/"wayback-campus-metadata.json").write_text(json.dumps(evidence,indent=2),encoding="utf-8")
        z = 17
        def tile_number(lon,lat):
            return int((lon+180)/360*2**z),int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z)
        x0,y1 = tile_number(113.522,34.808)
        x1,y0 = tile_number(113.537,34.829)
        def tile(xy):
            x,y=xy
            url=f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?v=2026r09"
            response = client.get(url)
            response.raise_for_status()
            return x,y,response.content
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for x,y,data in pool.map(tile,[(x,y) for x in range(x0,x1+1) for y in range(y0,y1+1)]):
                (OUT/f"tile-{x}-{y}.jpg").write_bytes(data)
        def longitude(x): return x/2**z*360-180
        def latitude(y): return math.degrees(math.atan(math.sinh(math.pi*(1-2*y/2**z))))
        bounds=[longitude(x0),latitude(y1+1),longitude(x1+1),latitude(y0)]
        (OUT/"preview-bounds.json").write_text(json.dumps(bounds),encoding="utf-8")
        print(json.dumps({"metadata":[{"point":r["point"],"features":r["data"].get("features"),"error":r["data"].get("error")} for r in evidence],"bounds":bounds}))


if __name__ == "__main__":
    main()
