"""Shared analysis geometry; campus outline is distinct from a data coverage box."""
import json
from functools import lru_cache
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import box, mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
TO_METRIC = Transformer.from_crs(4326, 32649, always_xy=True).transform


@lru_cache(maxsize=1)
def campus_boundary():
    data = json.loads((ROOT / "public/data/campus-boundary.geojson").read_text(encoding="utf-8"))
    geometry = shape(data["geometry"])
    if geometry.is_empty or not geometry.is_valid or geometry.geom_type != "Polygon":
        raise ValueError("校园边界不可用，未回退到错误矩形")
    return data


def analysis_region(body):
    b = body.bounds
    geometry = box(b.west, b.south, b.east, b.north)
    if body.area_kind == "campus":
        geometry = geometry.intersection(shape(campus_boundary()["geometry"]))
    if geometry.is_empty or geometry.area <= 0:
        raise ValueError("选区与校园边界没有有效面积交集，请调整范围或切换街区场景。")
    return geometry


def region_samples(body):
    region = analysis_region(body)
    w, s, e, n = region.bounds
    x, y = (w+e)/2, (s+n)/2
    quarters = [region.intersection(box(*bounds)) for bounds in
                [(w,s,x,y),(x,s,e,y),(x,y,e,n),(w,y,x,n)]]
    center = region.centroid
    if not region.covers(center):
        center = region.representative_point()
    # Even a narrow selection samples inside its actual polygon, never a bbox corner outside it.
    points = [center, *[(g if g.area > 0 else region).representative_point() for g in quarters]]
    return region, points, quarters


def region_description(body, region):
    return {"label": "某校园" if body.area_kind == "campus" else "某街区", "bounds": body.bounds.model_dump(),
            "area_km2_approx": round(transform(TO_METRIC, region).area/1e6, 3),
            "geometry": mapping(region), "geometry_source": "user_supplied_digitized_boundary" if body.area_kind == "campus" else "user_selection",
            "boundary_verified_survey": False}
