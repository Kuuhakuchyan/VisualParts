"""Inspect user-supplied GIS data without treating file dates as capture dates."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import rasterio
import shapefile
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def inspect(source, output):
    output.mkdir(parents=True, exist_ok=True)
    project = Transformer.from_crs(4326, 32649, always_xy=True).transform
    manifest = {"inspected_at": datetime.now(timezone.utc).isoformat(), "layers": [], "rasters": []}
    boundary = None
    layers = []
    for path in sorted(source.rglob("*.shp")):
        crs = path.with_suffix(".prj").read_text(encoding="utf-8")
        if "WGS_1984" not in crs:
            raise ValueError(f"Explicit CRS conversion required: {path.name}")
        with shapefile.Reader(str(path), encoding="utf-8") as reader:
            features = []
            invalid = 0
            for index, record in enumerate(reader.iterShapeRecords()):
                geometry = shape(record.shape.__geo_interface__)
                if not geometry.is_valid:
                    invalid += 1
                features.append({"type": "Feature", "id": f"local-{path.stem}-{index}",
                                 "properties": record.record.as_dict(), "geometry": mapping(geometry)})
            item = {"name": path.stem, "type": reader.shapeTypeName, "count": len(reader),
                    "bounds_wgs84": reader.bbox, "invalid_geometries": invalid,
                    "fields": [f[0] for f in reader.fields[1:]], "crs": crs,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "capture_date": None, "license": "user_supplied_rights_unverified"}
            manifest["layers"].append(item)
            layers.append({"name": path.stem, "features": features})
            if path.stem == "边界线":
                if len(features) != 1:
                    raise ValueError("Expected a single boundary line")
                line = shape(features[0]["geometry"])
                if line.geom_type != "LineString":
                    raise ValueError("Boundary is not a single line")
                coords = list(line.coords)
                gap = transform(project, line).coords
                gap_m = ((gap[0][0]-gap[-1][0])**2+(gap[0][1]-gap[-1][1])**2)**0.5
                if gap_m > 10:
                    raise ValueError(f"Boundary closure gap {gap_m:.2f}m needs manual review")
                polygon = Polygon(coords)
                if not polygon.is_valid or polygon.is_empty:
                    raise ValueError("Boundary polygon requires manual repair")
                boundary = {"type": "Feature", "id": "campus-boundary",
                            "properties": {"label": "某校园", "source_type": "user_supplied_digitized_boundary",
                                           "source_sha256": item["sha256"], "crs": "EPSG:4326",
                                           "closure_gap_m": round(gap_m, 3), "survey_verified": False,
                                           "capture_date": None, "legal_boundary": False,
                                           "area_m2": round(transform(project, polygon).area, 2),
                                           "note": "User-supplied digitized outline; not a cadastral survey."},
                            "geometry": mapping(polygon)}
                manifest["boundary"] = {**boundary["properties"], "bounds_wgs84": list(polygon.bounds)}
    for path in source.rglob("*.tif"):
        with rasterio.open(path) as src:
            bounds = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
            item = {"name": path.name, "width": src.width, "height": src.height,
                    "bands": src.count, "crs": str(src.crs), "bounds_wgs84": bounds,
                    "resolution_native": src.res, "nodata": src.nodata, "tags": src.tags(),
                    "capture_date": None, "license": "user_supplied_rights_unverified",
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            manifest["rasters"].append(item)
            ratio = min(1, 1400/src.width, 1400/src.height)
            data = src.read(indexes=list(range(1, min(src.count, 3)+1)),
                            out_shape=(min(src.count, 3), max(1, int(src.height*ratio)), max(1, int(src.width*ratio))),
                            resampling=Resampling.bilinear)
            if str(data.dtype) == "uint8" and data.shape[0] == 3:
                Image.fromarray(data.transpose(1, 2, 0)).save(output / "local-imagery-preview.png")
    write_json(output / "inventory.json", manifest)
    write_json(output / "local-layers.geojson.json", layers)
    if boundary:
        write_json(output / "campus-boundary.geojson", boundary)
    print(json.dumps(manifest, ensure_ascii=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    inspect(args.source, args.output)
