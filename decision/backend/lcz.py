"""Deterministic LCZ scenarios, kept separate from observed weather evidence."""
import math
import hashlib
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from pathlib import Path
import json

from pyproj import Transformer
from shapely.geometry import box, mapping, shape
from shapely.ops import transform
from shapely.strtree import STRtree

from backend.aic.risk import assess_scenario
from backend.aic.store import digest
from backend.spatial import analysis_region, region_description

VERSION = "lcz-constrained-midpoint-scenario-2.1"
ROOT = Path(__file__).resolve().parents[1]
TO_M = Transformer.from_crs(4326, 32649, always_xy=True).transform
TO_LL = Transformer.from_crs(32649, 4326, always_xy=True).transform
NAMES = {2: "紧凑中层建筑", 5: "开放中层建筑", 8: "大型低层建筑", 9: "稀疏建筑", 11: "密集林木", 12: "稀疏林木",
         13: "灌木", 14: "低矮植被", 15: "硬化地表", 17: "水体"}


def assets():
    return _assets(asset_revision())


def asset_revision():
    stat = (ROOT / "public/data/campus-lcz-simulation.geojson").stat()
    return stat.st_mtime_ns, stat.st_size


@lru_cache(maxsize=1)
def _assets(revision):
    data = json.loads((ROOT / "public/data/campus-lcz-simulation.geojson").read_text(encoding="utf-8"))
    meta = data["metadata"]
    if meta.get("schema_version") == "lcz-simulation-assets-2":
        def checksum(value):
            return hashlib.sha256(json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        classification = {"features": data["features"], "method": meta["method"],
                          "inputs": meta["inputs_sha256"], "source": meta["source_sha256"]}
        if checksum(classification) != meta["classification_sha256"] or checksum(meta["profiles"]) != meta["parameters_sha256"]:
            raise ValueError("LCZ分类或模拟参数校验失败，请重新生成完整数据版本。")
    geometries = [transform(TO_M, shape(f["geometry"])) for f in data["features"]]
    return data, geometries, STRtree(geometries)


def reference_station():
    return json.loads((ROOT / "public/data/reference-station.json").read_text(encoding="utf-8"))


def metadata():
    data, _, _ = assets()
    return {"model_version": VERSION, "source_type": "simulated_lcz", "validation": "uncalibrated",
            "parameter_origin": data["metadata"]["parameter_origin"],
            "available_class_codes": sorted({f["properties"]["lcz"] for f in data["features"]}),
            "baseline_policy": "public_hourly_grid_requested_at_reference_location_not_AWS_telemetry",
            "delta_t_grid_basis": "scenario_offset_from_public_grid_not_measured_station_residual",
            "classification_sha256": data["metadata"].get("classification_sha256", data["metadata"]["source_sha256"]),
            "classification_method": data["metadata"].get("method"),
            "classification_limitations": data["metadata"].get("limitations", []),
            "parameters_sha256": data["metadata"]["parameters_sha256"],
            "formula": "T=boundary_T+weighted_LCZ_midpoint_offset; RH=clip(boundary_RH+weighted_humidity_midpoint-1.4*delta_T,22,98)",
            "offset_method": "既有模拟参数范围中点；沿用昼夜与热滞后项，移除随机噪声和未经核实的遥感/形态附加项。不是文献标定系数。",
            "uncertainty": "未实测标定，无统计置信度；参数范围仅为情景假设，不是置信区间。",
            "profiles": [{"lcz_code": code, "lcz_hint": hint(code), "name": NAMES[code],
                          **{key: profile[key] for key in ("air_delta_day", "air_delta_night", "humidity_delta")},
                          "parameter_status": profile.get("parameter_status", "existing_uncalibrated_scenario"),
                          "proxy_profile_code": profile.get("proxy_profile_code")}
                         for raw, profile in data["metadata"]["profiles"].items() if (code := int(raw)) in NAMES],
            "reference_station": reference_station(), "random_noise": False}


def hint(code):
    return "LCZ_" + (str(code) if code <= 10 else chr(65 + code - 11))


def grid_geometry(west, south, east, north, resolution):
    return _grid_geometry(west, south, east, north, resolution, asset_revision())


@lru_cache(maxsize=24)
def _grid_points(west, south, east, north, resolution, revision):
    points = [shape(cell["geometry"]).representative_point()
              for cell in _grid_geometry(west, south, east, north, resolution, revision)]
    return [(point.x, point.y) for point in points]


@lru_cache(maxsize=24)
def _grid_geometry(west, south, east, north, resolution, revision):
    from types import SimpleNamespace
    body = SimpleNamespace(bounds=SimpleNamespace(west=west, south=south, east=east, north=north), area_kind="campus")
    region = transform(TO_M, analysis_region(body))
    minx, miny, maxx, maxy = region.bounds
    ix0, iy0 = math.floor(minx / resolution), math.floor(miny / resolution)
    ix1, iy1 = math.ceil(maxx / resolution), math.ceil(maxy / resolution)
    if (ix1-ix0)*(iy1-iy0) > 10000:
        raise ValueError("模拟网格超过10000个，请缩小选区或增大网格间距。")
    cells = []
    for iy in range(iy0, iy1):
        for ix in range(ix0, ix1):
            cell = box(ix*resolution, iy*resolution, (ix+1)*resolution, (iy+1)*resolution).intersection(region)
            if cell.is_empty or cell.area <= 0:
                continue
            components, fraction = class_fractions(cell)
            cells.append({"type": "Feature", "id": f"LCZ49-{resolution}-{ix}-{iy}",
                          "geometry": mapping(transform(TO_LL, cell)),
                          "properties": {"grid_id": f"LCZ49-{resolution}-{ix}-{iy}", "area_m2": round(cell.area, 3),
                                         "lcz_fractions": components, "classified_fraction": fraction}})
    return cells


def class_fractions(cell):
    data, geometries, tree = assets()
    areas = {}
    for index in tree.query(cell):
        area = cell.intersection(geometries[index]).area
        if area > 0:
            code = int(data["features"][index]["properties"]["lcz"])
            areas[code] = areas.get(code, 0) + area
    total = sum(areas.values())
    return {str(code): area / total for code, area in areas.items()} if total else {}, min(1.0, total / cell.area)


def offsets(components, stamp, profiles=None):
    hour = datetime.fromisoformat(stamp).astimezone(timezone(timedelta(hours=8)))
    hour = hour.hour + hour.minute/60
    solar = max(0.0, math.sin(math.pi*(hour-6)/12)) if 6 <= hour <= 18 else 0.0
    lag = math.exp(-((hour-20)/4)**2)
    if profiles is None:
        profiles = assets()[0]["metadata"]["profiles"]
    dt, drh = 0.0, 0.0
    for code, fraction in components.items():
        profile = profiles[str(code)]
        day, night, humidity = [sum(profile[key])/2 for key in ("air_delta_day", "air_delta_night", "humidity_delta")]
        delta = day*solar + night*(0.35+0.65*lag) if solar > 0.05 else night*(0.5+lag)
        dt += fraction*delta
        drh += fraction*humidity
    return dt, drh - 1.4*dt


def values(components, baseline, profiles=None):
    dt, drh = offsets(components, baseline["observed_at"], profiles)
    return round(baseline["temperature_c"]+dt, 3), round(max(22, min(98, baseline["relative_humidity_pct"]+drh)), 3), round(dt, 3)


def classification_summary(features, model):
    """Area fractions describe the selected surface mosaic, never population risk."""
    rows, total_area, classified_area, usable_area = {}, 0.0, 0.0, 0.0
    profiles = {p["lcz_code"]: p for p in model["profiles"]}
    for feature in features:
        p = feature["properties"]
        area = p["area_m2"]
        classified = area * p["classified_fraction"]
        total_area += area
        classified_area += classified
        if p["temperature_c"] is not None:
            usable_area += area
        for raw, fraction in p["lcz_fractions"].items():
            code = int(raw)
            row = rows.setdefault(code, {"lcz_code": code, "lcz_hint": hint(code), "name": NAMES[code],
                "area_m2": 0.0, "dominant_grid_count": 0,
                "parameter_status": profiles[code]["parameter_status"],
                "proxy_profile_code": profiles[code]["proxy_profile_code"]})
            row["area_m2"] += classified * fraction
            row["dominant_grid_count"] += int(code == p["lcz_code"])
    for row in rows.values():
        row["area_fraction"] = row["area_m2"] / total_area if total_area else 0
        row["area_m2"] = round(row["area_m2"], 3)
    return {"schema_version": "lcz-area-summary/1.0", "classification_sha256": model["classification_sha256"],
            "parameters_sha256": model["parameters_sha256"], "analysis_crs": "EPSG:32649",
            "area_m2": round(total_area, 3), "classified_area_m2": round(classified_area, 3),
            "unknown_area_m2": round(max(0, total_area-classified_area), 3),
            "usable_temperature_area_m2": round(usable_area, 3),
            "classes": sorted(rows.values(), key=lambda row: (-row["area_m2"], row["lcz_code"])),
            "method": "metric_intersection_area_weighted_surface_mosaic",
            "validation": "uncalibrated_scenario_not_verified_neighborhood_LCZ"}


def build_scenario(body, baseline):
    if body.area_kind != "campus":
        raise ValueError("现有LCZ成果仅覆盖校园，街区不能借用校园分类生成模拟温湿度。")
    b = body.bounds
    source = grid_geometry(b.west, b.south, b.east, b.north, body.grid_resolution_m)
    points = _grid_points(b.west, b.south, b.east, b.north, body.grid_resolution_m, asset_revision())
    profiles = assets()[0]["metadata"]["profiles"]
    model = metadata()
    snapshot = digest({"baseline": baseline["id"], "model": model, "bounds": b.model_dump(), "resolution_m": body.grid_resolution_m})
    samples, features = [], []
    for cell, (longitude, latitude) in zip(source, points):
        p = dict(cell["properties"])
        covered = p["classified_fraction"] >= 0.95
        temperature, humidity, delta = values(p["lcz_fractions"], baseline, profiles) if covered else (None, None, None)
        code = int(max(p["lcz_fractions"], key=p["lcz_fractions"].get)) if p["lcz_fractions"] else None
        observation = {"id": "sim_"+digest({"snapshot": snapshot, "grid_id": cell["id"], "geometry": cell["geometry"]}),
                       "source_type": "simulated_lcz", "quality_status": "simulation_unvalidated", "quality_flag": None,
                       "location": {"longitude": round(longitude, 7), "latitude": round(latitude, 7)},
                       "observed_at": baseline["observed_at"], "temperature_c": temperature, "relative_humidity_pct": humidity,
                       "units": baseline["units"], "baseline_observation_id": baseline["id"], "model_version": VERSION,
                       "grid_id": cell["id"], "lcz_hint": hint(code) if code else None, "delta_t_grid_c": delta,
                       "ts": datetime.fromisoformat(baseline["observed_at"]).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "temp_c": temperature, "humidity_pct": humidity, "crs": "EPSG:4326"} if covered else None
        environment = assess_scenario(observation, body.exposure)
        samples.append({"id": cell["id"], "requested": {"longitude": longitude, "latitude": latitude}, "observation": observation,
                        "environment": environment, "error": None if covered else "LCZ分类覆盖不足95%，未填补模拟值"})
        p.update(temperature_c=temperature, humidity_pct=humidity, heat_index_c=environment["heat_index_c"],
                 delta_t_grid_c=delta, lcz_code=code, lcz_hint=hint(code) if code else None, lcz_name=NAMES.get(code),
                 observation_id=observation["id"] if observation else None, time=baseline["observed_at"],
                 risk=environment["risk"], source_type="simulated_lcz", quality_flag=None,
                 quality_status="simulation_unvalidated", snapshot_sha256=snapshot)
        p.update(temp_c=temperature, ts=observation["ts"] if observation else None, crs="EPSG:4326", iface_version="WJTJ-LCZ-grid/1.0",
                 risk_code={"below_range":0, "caution":1, "extreme_caution":2, "danger":3, "extreme_danger":4}.get(environment["risk"], 255))
        features.append({**cell, "properties": p})
    from backend.aic.regional import RANK
    usable = [s for s in samples if s["environment"]["risk"] in RANK]
    worst = max(usable, key=lambda s: (RANK[s["environment"]["risk"]], s["environment"]["heat_index_c"] or -1000)) if usable else None
    return {"samples": samples, "cells": {"type": "FeatureCollection", "features": features},
            "environment": worst["environment"] if worst else assess_scenario(None),
            "representative_sample_id": worst["id"] if worst else None,
            "coverage": {"requested_samples": len(samples), "usable_samples": len(usable), "unique_model_grids": 1,
                         "simulated_grid_cells": len(features), "spatial_comparison_supported": False,
                         "scenario_comparison_supported": len(usable) > 1, "complete": len(usable) == len(samples),
                         "status": "complete" if len(usable) == len(samples) else "partial" if usable else "unavailable",
                         "note": "LCZ模拟网格，不是独立实测或更高精度天气预报。采用现有分类的面积加权情景参数；不足95%分类覆盖的格网留空。"},
            "area": region_description(body, analysis_region(body)), "case_type": "lcz_simulation",
            "data_mode": "lcz_simulation", "baseline": baseline, "simulation": model,
            "reference_station": reference_station(), "snapshot_sha256": snapshot,
            "classification_summary": classification_summary(features, model),
            "resolution_m": body.grid_resolution_m, "refresh_seconds": 120,
            "legend": "LCZ模拟温湿度与条件性热指数 · 非实测、未标定，不用于当前医疗或应急决策。",
            "created_at": datetime.now(timezone.utc).isoformat()}


async def sample_scenario(weather, body):
    from backend.aic.risk import assess_environment
    from backend.sandbox import boundary_weather
    from types import SimpleNamespace
    # Heatmap, standalone report and layout simulation share the hourly radiation boundary.
    baseline = await boundary_weather(SimpleNamespace(regional=body))
    if assess_environment(baseline, body.exposure)["risk"] == "unavailable":
        raise ValueError("气象边界缺失、过期或不适用，未生成模拟替代数据。")
    from fastapi.concurrency import run_in_threadpool
    return await run_in_threadpool(build_scenario, body, baseline)
