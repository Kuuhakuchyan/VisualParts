"""Constrain a spectral LCZ mosaic with existing geometry; never overwrite the research source."""
import argparse
import ast
import copy
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
TO_M = Transformer.from_crs(4326, 32649, always_xy=True).transform
TO_LL = Transformer.from_crs(32649, 4326, always_xy=True).transform
METHOD = {"version": "geometry-constrained-lcz-2", "analysis_crs": "EPSG:32649",
          "neighborhood_radius_m": 100, "compact_building_fraction_min": .4,
          "open_building_fraction_min": .2, "missing_height_assumption_m": 18,
          "road_half_width_m": 3, "priority": ["building", "water", "road", "original_classification"],
          "unit": "fine_surface_mosaic_with_provisional_neighborhood_built_classes"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def encoded(data):
    normalized = json.loads(json.dumps(data))
    return json.dumps(normalized, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        if geometry.area > .0001:
            yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygons(part)


def metric(feature):
    return make_valid(transform(TO_M, shape(feature["geometry"])))


def union(items):
    return unary_union(list(items))


def features_for(geometry, code, basis):
    return [{"type": "Feature", "geometry": mapping(transform(TO_LL, part)),
             "properties": {"lcz": code, "classification_basis": basis}}
            for part in polygons(geometry)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    source = args.workspace / "Data_prprocessing/gee_data/campus/campus_lcz_gee_classified.geojson"
    generator = args.workspace / "contest_2026_micro_explorer/03_processing/scripts/generate_simulated_iot_data.py"
    paths = {key: ROOT / "public/data" / name for key, name in {
        "boundary": "campus-boundary.geojson", "buildings": "campus-buildings.geojson",
        "roads": "campus-streets.geojson"}.items()}
    local_path = ROOT / "output/campus-data/local-layers.geojson.json"
    boundary = metric(read(paths["boundary"]))
    buildings_list = [metric(f).intersection(boundary) for f in read(paths["buildings"])["features"]]
    buildings = union(buildings_list)
    water = union(metric(f) for layer in read(local_path) if layer["name"] == "水" for f in layer["features"])
    water = water.intersection(boundary).difference(buildings)
    roads = union(metric(f).buffer(METHOD["road_half_width_m"]) for f in read(paths["roads"])["features"])
    roads = roads.intersection(boundary).difference(union([buildings, water]))
    originals = defaultdict(list)
    for f in read(source)["features"]:
        originals[int(f["properties"]["lcz"])].append(metric(f).intersection(boundary))
    original = {code: union(parts) for code, parts in originals.items()}
    before = [{"geometry": mapping(transform(TO_LL, g)), "properties": {"lcz": c}} for c, g in original.items()]
    features, constraints = [], []
    built_classes = defaultdict(list)
    for geometry in buildings_list:
        if geometry.is_empty:
            continue
        neighborhood = geometry.centroid.buffer(METHOD["neighborhood_radius_m"]).intersection(boundary)
        density = buildings.intersection(neighborhood).area / neighborhood.area
        code = 2 if density >= .4 else 5 if density >= .2 else 9
        built_classes[code].append(geometry)
        constraints.append({"type": "Feature", "geometry": mapping(transform(TO_LL, geometry)),
                            "properties": {"kind": "building", "lcz": code,
                                           "building_fraction_100m": round(density, 5),
                                           "height_status": "assumed_18m_not_surveyed"}})
    remaining = boundary
    # Priority and subtraction produce a partition; overlap must not double-count cooling.
    for code in sorted(built_classes):
        geometry = union(built_classes[code]).intersection(remaining)
        features.extend(features_for(geometry, code, "footprint_and_100m_density_height_assumed"))
        remaining = remaining.difference(geometry)
    for code, geometry, kind in [(17, water, "water"), (15, roads, "road")]:
        features.extend(features_for(geometry.intersection(remaining), code, "digitized_" + kind))
        constraints.extend({**f, "properties": {"kind": kind}} for f in features_for(geometry, code, kind))
        remaining = remaining.difference(geometry)
    # Genuine vegetation and unknown gaps remain, rather than painting whole neighborhoods built.
    for code in sorted(original):
        geometry = original[code].intersection(remaining)
        features.extend(features_for(geometry, code, "original_GEE_outside_constraints"))
        remaining = remaining.difference(geometry)
    for i, f in enumerate(features):
        f["id"] = f"lcz-refined-{i:05d}"
    tree = ast.parse(generator.read_text(encoding="utf-8"))
    profiles = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == "LCZ_PROFILES" for t in n.targets))
    # No calibrated coefficients for open/sparse building types exist in the project.
    # Keep a disclosed built proxy instead of inventing a temperature-density relationship.
    for code, name in [(5, "open_midrise"), (9, "sparsely_built")]:
        profiles[code] = copy.deepcopy(profiles[2])
        profiles[code].update(name=f"LCZ_{code}_{name}", proxy_profile_code=2,
                              parameter_status="uncalibrated_proxy_from_existing_LCZ_2")
    metadata = {"schema_version": "lcz-simulation-assets-2", "crs": "EPSG:4326",
                "source_sha256": sha(source), "source_parameters_sha256": sha(generator),
                "inputs_sha256": {**{k: sha(p) for k, p in paths.items()}, "local_gis": sha(local_path)},
                "classification": METHOD["version"], "method": METHOD, "survey_verified": False,
                "parameter_origin": "existing_project_simulated_iot_generator_with_explicit_built_proxies",
                "validation": "geometry_consistency_checked_not_classification_accuracy_validated",
                "profiles": profiles,
                "limitations": ["All building heights assumed; built LCZ subtypes provisional.",
                                "Road width is a 6m scenario assumption, not a measured width.",
                                "Fine surface mosaic is not a validated standard neighborhood LCZ map.",
                                "Original 2024 spectral classification retained outside constraints."]}
    metadata["classification_sha256"] = hashlib.sha256(encoded({"features": features, "method": METHOD,
        "inputs": metadata["inputs_sha256"], "source": metadata["source_sha256"]})).hexdigest()
    metadata["parameters_sha256"] = hashlib.sha256(encoded(profiles)).hexdigest()
    target = ROOT / "public/data/campus-lcz-simulation.geojson"
    target.write_bytes(encoded({"type": "FeatureCollection", "features": features, "metadata": metadata}))
    (target.parent / "campus-lcz-constraints.geojson").write_bytes(encoded({"type": "FeatureCollection",
        "features": constraints, "metadata": {"crs": "EPSG:4326", "method": METHOD,
        "classification_sha256": metadata["classification_sha256"]}}))
    refined = defaultdict(list)
    for f in features:
        refined[f["properties"]["lcz"]].append(metric(f))
    refined = {c: union(parts) for c, parts in refined.items()}
    cover = union(refined.values())
    audit = {"classification_sha256": metadata["classification_sha256"], "method": METHOD,
             "campus_area_m2": boundary.area, "building_area_m2": buildings.area,
             "before_class_area_m2": {c: g.area for c, g in original.items()},
             "after_class_area_m2": {c: g.area for c, g in refined.items()},
             "before_building_nonbuilt_overlap_m2": sum(g.intersection(buildings).area for c, g in original.items() if c > 10),
             "before_building_tree_overlap_m2": sum(g.intersection(buildings).area for c, g in original.items() if c in (11, 12)),
             "after_building_nonbuilt_overlap_m2": sum(g.intersection(buildings).area for c, g in refined.items() if c > 10),
             "after_water_nonwater_overlap_m2": sum(g.intersection(water).area for c, g in refined.items() if c != 17),
             "after_road_nonpaved_overlap_m2": sum(g.intersection(roads).area for c, g in refined.items() if c != 15),
             "overlap_area_m2": sum(g.area for g in refined.values()) - cover.area,
             "unknown_area_m2": boundary.difference(cover).area,
             "feature_count": len(features), "heldout_accuracy": None}
    output = ROOT / "output/campus-data"
    (output / "lcz-refinement-audit.json").write_bytes(encoded(audit))
    preview(before, features, buildings_list, boundary, output / "lcz-refinement-comparison.png")
    print(json.dumps(audit))


def preview(before, after, buildings, boundary, target):
    from PIL import Image, ImageDraw
    colors = {2: "#b96d63", 5: "#cf9475", 8: "#d7aa75", 9: "#d6b897", 11: "#327769",
              12: "#6d9a75", 13: "#93ad80", 14: "#bdc997", 15: "#a7adb0", 17: "#5c9eaf"}
    image = Image.new("RGB", (1600, 1180), "#f3f4f2")
    draw = ImageDraw.Draw(image)
    w, s, e, n = boundary.bounds
    scale = min(730 / (e - w), 1000 / (n - s))
    for offset, features, title in [(30, before, "BEFORE / original spectral LCZ"),
                                    (830, after, "AFTER / constrained surface mosaic")]:
        draw.text((offset, 20), title, fill="#202f2b")
        def coords(ring):
            return [(offset + (x - w) * scale, 65 + (n - y) * scale) for x, y in ring.coords]
        for f in features:
            for poly in polygons(metric(f)):
                mask = Image.new("L", image.size, 0)
                mask_draw = ImageDraw.Draw(mask)
                mask_draw.polygon(coords(poly.exterior), fill=255)
                for ring in poly.interiors:
                    mask_draw.polygon(coords(ring), fill=0)
                image.paste(colors.get(f["properties"]["lcz"], "#aaa"), mask=mask)
        for geometry in buildings:
            for poly in polygons(geometry):
                draw.line(coords(poly.exterior), fill="#262c29", width=1)
    draw.text((30, 1100), "Buildings: terracotta | Vegetation: green | Roads: gray | Water: blue | Roof outlines: black", fill="#202f2b")
    draw.text((30, 1130), "Geometric consistency audit; no held-out classification accuracy or temperature validation claimed.", fill="#202f2b")
    image.save(target)


if __name__ == "__main__":
    main()
