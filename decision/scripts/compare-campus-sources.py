"""Render local and OSM alignment evidence, and quantify footprint agreement."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/campus-data"
project = Transformer.from_crs(4326, 32649, always_xy=True).transform
layers = json.loads((OUT / "local-layers.geojson.json").read_text(encoding="utf-8"))
inventory = json.loads((OUT / "inventory.json").read_text(encoding="utf-8"))
osm = json.loads((ROOT / "public/data/campus-buildings.geojson").read_text(encoding="utf-8"))
local = [f for layer in layers if layer["name"] in {"住宿区", "教学区", "体育馆", "校医院", "行政区及图书馆", "餐厅及商铺"} for f in layer["features"]]
fig, ax = plt.subplots(figsize=(10, 14))
w, s, e, n = inventory["rasters"][0]["bounds_wgs84"]
ax.imshow(Image.open(OUT / "local-imagery-preview.png"), extent=(w,e,s,n))
for features, color in [(osm["features"], "cyan"), (local, "red")]:
    for f in features:
        geometry = shape(f["geometry"])
        for polygon in ([geometry] if geometry.geom_type == "Polygon" else geometry.geoms):
            x, y = polygon.exterior.xy
            ax.plot(x,y,color=color,linewidth=.65)
ax.set_xlim(w,e)
ax.set_ylim(s,n)
ax.set_aspect(1 / .821)
ax.set_title("Local raster / red: local footprints / cyan: OSM WGS84")
fig.savefig(OUT / "coordinate-alignment.png", dpi=150, bbox_inches="tight")
plt.close(fig)
metrics = [transform(project, shape(f["geometry"])) for f in osm["features"]]
overlaps = []
for f in local:
    geometry = transform(project, shape(f["geometry"]))
    best = max((geometry.intersection(g).area / geometry.union(g).area for g in metrics), default=0)
    overlaps.append(best)
result = {"local_footprints": len(local), "local_features_iou_gt_0_5": sum(x>.5 for x in overlaps),
          "median_best_iou": sorted(overlaps)[len(overlaps)//2],
          "note": "Coordinate label alone does not verify datum; inspect the alignment graphic."}
(OUT / "alignment.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
