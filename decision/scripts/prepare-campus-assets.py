"""Prepare inspected geometry and a dated imagery preview; retain source limitations."""
import json
from pathlib import Path

from PIL import Image
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/campus-data"
PUBLIC = ROOT / "public"
project = Transformer.from_crs(4326, 32649, always_xy=True).transform


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


boundary = json.loads((OUT / "campus-boundary.geojson").read_text(encoding="utf-8"))
save(PUBLIC / "data/campus-boundary.geojson", boundary)
outline = shape(boundary["geometry"])
metric_outline = transform(project, outline)
data = json.loads((PUBLIC / "data/campus-buildings.geojson").read_text(encoding="utf-8"))
data["features"] = [f for f in data["features"] if f.get("properties", {}).get("source") != "user_supplied_digitized_footprint"]
occupied = unary_union([transform(project, shape(f["geometry"])) for f in data["features"]]).buffer(8)
layers = json.loads((OUT / "local-layers.geojson.json").read_text(encoding="utf-8"))
accepted = []
for layer in layers:
    if layer["name"] not in {"住宿区", "教学区", "体育馆", "校医院", "行政区及图书馆", "餐厅及商铺"}:
        continue
    for feature in layer["features"]:
        geom = transform(project, shape(feature["geometry"]))
        if not geom.is_valid or geom.area <= 0 or geom.intersection(metric_outline).area/geom.area < .98:
            continue
        if geom.intersection(occupied).area > 1:
            continue
        accepted.append({"type": "Feature", "id": f"local-footprint-{len(accepted)+1:03d}", "geometry": feature["geometry"],
                         "properties": {"source": "user_supplied_digitized_footprint", "height_m": None,
                                        "height_source": "missing", "capture_date": None,
                                        "survey_verified": False, "license": "user_supplied_rights_unverified"}})
        occupied = unary_union([occupied, geom.buffer(8)])
data["features"].extend(accepted)
previous_bbox = data["bbox"]
w, s, e, n = outline.bounds
data["bbox"] = [min(w, previous_bbox[0]), min(s, previous_bbox[1]), max(e, previous_bbox[2]), max(n, previous_bbox[3])]
data.setdefault("source_metadata", {})["local_supplement"] = {
    "count": len(accepted), "source_type": "user_supplied_digitized_footprint", "capture_date": None,
    "filter": "98% inside supplied outline; reject intersection >1m2 with existing footprints buffered by 8m",
    "survey_verified": False, "rights_verified": False,
    "note": "Conservative gap supplement, not a complete or current building survey; requires field verification."}
save(PUBLIC / "data/campus-buildings.geojson", data)

tiles = [(int(p.stem.split("-")[1]), int(p.stem.split("-")[2]), p) for p in (OUT / "verified").glob("tile-*.jpg")]
xs, ys = [x for x, _, _ in tiles], [y for _, y, _ in tiles]
canvas = Image.new("RGB", ((max(xs)-min(xs)+1)*256, (max(ys)-min(ys)+1)*256))
for x, y, path in tiles:
    with Image.open(path) as tile:
        canvas.paste(tile, ((x-min(xs))*256, (y-min(ys))*256))
canvas.save(PUBLIC / "campus-imagery-20260111.webp", quality=88)
print(json.dumps({"buildings": len(data["features"]), "local_supplement": len(accepted), "imagery_size": canvas.size}))
