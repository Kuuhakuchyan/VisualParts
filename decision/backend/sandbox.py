"""Versioned scene edits and exploratory solar-exposure scenarios, not CFD."""

import asyncio
import json
import math
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

import httpx
import numpy as np
import pandas as pd
import shapely
from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from pyproj import Transformer
from pvlib.solarposition import get_solarposition
from pythermalcomfort.models import utci
from ladybug_comfort.solarcal import body_solar_flux_from_parts, erf_from_body_solar_flux, mrt_delta_from_erf
from shapely import affinity
from shapely import from_wkb
from shapely.geometry import Point, Polygon, LineString, box, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

from backend.aic.regional import RegionalRequest, sample_region
from backend.aic.store import digest
from backend.aic.weather import CURRENT_URL, HISTORY_URL, HISTORY_DATE, validate_grid
from backend.planning import owner_hash, store as plan_store
from backend.spatial import analysis_region, campus_boundary, region_samples, region_description
from backend.temporal import ForecastInput
from backend import neighbourhood, spatial_surrogate

router = APIRouter(prefix="/api/weather/sandbox", tags=["layout-sandbox"])
VERSION = "solar-layout-screening-1.5"
ROOT = Path(__file__).resolve().parents[1]
TO_M = Transformer.from_crs(4326, 32649, always_xy=True).transform
TO_LL = Transformer.from_crs(32649, 4326, always_xy=True).transform
_slots = asyncio.Semaphore(2)
_weather_cache = {}
_weather_series_cache = {}
_weather_locks = [asyncio.Lock() for _ in range(32)]
SOURCES = [
    {"id": "PVLIB", "title": "pvlib solar position", "url": "https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.solarposition.get_solarposition.html"},
    {"id": "SOLARCAL", "title": "Ladybug SolarCal shortwave radiant exchange", "url": "https://www.ladybug.tools/ladybug-comfort/docs/ladybug_comfort.solarcal.html"},
    {"id": "UTCI", "title": "pythermalcomfort UTCI", "url": "https://pythermalcomfort.readthedocs.io/en/latest/documentation/models.html"},
    {"id": "OPEN-METEO", "title": "Open-Meteo hourly weather and radiation", "url": "https://open-meteo.com/en/docs"},
    {"id": "OSM", "title": "OpenStreetMap contributors / ODbL", "url": "https://www.openstreetmap.org/copyright"},
]
LIMITS = [
    "探索性太阳辐射情景筛选，未作现场标定或独立精度验证，不是完整微气候预测或疾病诊断。",
    "空气温湿度及10米风采用同一公开天气边界，改造前后保持不变；不求解局地通风、热储存、蒸散及壁面温度。",
    "长波平均辐射温度以气温作假设；短波采用SolarCal，站姿、太阳相对人体水平夹角SHARP为135°、吸收率0.7、发射率0.95、地面反照率0.2。",
    "天空可视因子为36方位、300米半径、1.1米高度的离散几何筛选，按50米子单元的室外面积加权；不是完整半球辐射模型。仅模拟不透明竖直体块，未包含树冠与地形。",
    "网格按前后共有室外地面的遮阴面积比例，分别计算日照与遮阴UTCI后面积加权；天空可视因子为室外子单元近似，不等于逐米求解或完整人群暴露积分。",
    "缺失建筑高度采用资料中声明的模拟参数（默认18米），街区瓦片高度也作为场景参数；公开轮廓不等于完整测绘模型。输出分辨率是计算采样尺度，不是天气资料空间精度。",
    "UTCI只在其输入适用范围内输出；用于标准参考人的环境热应激，不是各类人群患病概率。医学建议仍受专业审核门禁控制。",
]


@lru_cache(maxsize=2)
def buildings(area_kind="campus"):
    if area_kind not in {"campus", "neighborhood"}:
        raise ValueError("未知建筑模型区域")
    path = ROOT / ("public/data/neighborhood-buildings.geojson" if area_kind == "neighborhood" else "public/data/campus-buildings.geojson")
    if not path.exists() and area_kind == "campus":
        path = ROOT / "public/data/zzu_osm_buildings.geojson"
    data = json.loads(path.read_text(encoding="utf-8"))
    features = []
    for i, f in enumerate(data["features"]):
        p = f.get("properties", {})
        key = str(f.get("id", f"building-{i}"))
        geom = shape(f["geometry"])
        if not geom.is_valid or geom.is_empty or geom.geom_type not in {"Polygon", "MultiPolygon"}:
            continue
        verified_source = p.get("height_source") in {"osm_height", "osm_levels"}
        h = p.get("height_m") if verified_source else None
        assumed_height = p.get("render_height_m")
        assumed_height = assumed_height if isinstance(assumed_height, (int, float)) and math.isfinite(assumed_height) and 2 <= assumed_height <= 200 else 18
        features.append({"type": "Feature", "id": key, "geometry": mapping(geom), "properties": {
            "id": key, "name": f"{'某街区' if area_kind == 'neighborhood' else '某校园'}建筑 {i+1:03d}", "height_m": h,
            "render_height_m": h or assumed_height, "height_source": p.get("height_source", "legacy_estimate_unverified"),
            "source": p.get("source", "OpenStreetMap"), "capture_date": p.get("capture_date"), "simulated": bool(p.get("simulated")),
            "survey_verified": False, "state": "existing"}})
    return {"type": "FeatureCollection", "area_kind": area_kind, "features": features, "bbox": data["bbox"],
            "attribution": "© OpenStreetMap contributors · ODbL 1.0" + (" / 用户提供数字化轮廓（日期、授权与测绘精度待核验）" if area_kind == "campus" else ""),
            "coverage": {"count": len(features), "height_sourced": sum(f["properties"]["height_m"] is not None for f in features),
                         "simulated_buildings": sum(f["properties"]["simulated"] for f in features),
                         "public_footprints": sum(not f["properties"]["simulated"] for f in features),
                         "complete_survey": False, "local_supplement": sum(f["properties"]["source"] == "user_supplied_digitized_footprint" for f in features),
                         "note": ("公开瓦片建筑轮廓按独立多边形拆分；原始瓦片高度与缺失高度默认值均作为场景参数，不作实测。公开轮廓可能存在遗漏或位置差异。" if area_kind == "neighborhood" else "OSM与用户提供轮廓保守补充，仍可能遗漏或存在位置差异；本地资料日期与授权未核实，不保证最新或完整。未测绘高度为情景假设。")},
            "source_metadata": data.get("source_metadata", {"retrieved_at": data.get("generated_at"), "status": "legacy_public_footprints"})}


def model_buildings(area_kind):
    return buildings() if area_kind == "campus" else buildings(area_kind)


def model_boundary(area_kind):
    if area_kind == "campus":
        return campus_boundary()
    return {"type": "Feature", "geometry": mapping(box(*model_buildings(area_kind)["bbox"])),
            "properties": {"area_kind": area_kind, "label": "街区模型覆盖范围"}}


class Addition(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(pattern=r"^new-[a-zA-Z0-9-]{1,60}$")
    longitude: float = Field(ge=113.4, le=113.9)
    latitude: float = Field(ge=34.6, le=34.95)
    width_m: float = Field(ge=2, le=150)
    depth_m: float = Field(ge=2, le=150)
    height_m: float = Field(ge=2, le=120)
    rotation_deg: float = Field(default=0, ge=0, le=360)


class Scene(BaseModel):
    model_config = ConfigDict(extra="forbid")
    area_kind: Literal["campus", "neighborhood"] = "campus"
    name: str = Field(default="布局方案", min_length=1, max_length=50)
    additions: list[Addition] = Field(default_factory=list, max_length=30)
    removed_ids: list[str] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def valid_edits(self):
        if not self.name.strip():
            raise ValueError("情景名称不能为空")
        if len(set(self.removed_ids)) != len(self.removed_ids):
            raise ValueError("duplicate removals")
        if len({a.id for a in self.additions}) != len(self.additions):
            raise ValueError("duplicate addition IDs")
        known = {f["id"] for f in model_buildings(self.area_kind)["features"]}
        if not set(self.removed_ids) <= known:
            raise ValueError("unknown building IDs")
        return self


def validate_forecast_hour(regional, valid_time):
    if valid_time is None:
        return
    if regional.mode == "history":
        raise ValueError("历史场景不能混用未来预报小时。")
    if valid_time.minute or valid_time.second or valid_time.microsecond:
        raise ValueError("预报推演须选择整点小时。")
    age = (valid_time - datetime.now(timezone.utc)).total_seconds()
    if not -7200 <= age <= 26*3600:
        raise ValueError("预报小时须在当前前两小时至未来26小时范围内。")


class SimulationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene: Scene
    regional: RegionalRequest
    resolution_m: int = Field(default=30, ge=20, le=150)
    valid_time: AwareDatetime | None = None

    @model_validator(mode="after")
    def forecast_hour(self):
        validate_forecast_hour(self.regional, self.valid_time)
        if self.scene.area_kind != self.regional.area_kind:
            raise ValueError("建筑情景与气象选区不属于同一区域，请切换或重新创建情景。")
        return self


class CollaborationInput(SimulationInput):
    station_window: ForecastInput | None = None


@lru_cache(maxsize=4096)
def _metric_shape(serialized):
    return transform(TO_M, shape(json.loads(serialized)))


def metric_shape(geometry):
    return _metric_shape(json.dumps(geometry, separators=(",", ":")))


def scene_geometry(scene):
    data = model_buildings(scene.area_kind)
    base = [{**f, "metric": metric_shape(f["geometry"]), "height": f["properties"]["render_height_m"]} for f in data["features"]]
    proposed = [f for f in base if f["id"] not in scene.removed_ids]
    for a in scene.additions:
        x, y = TO_M(a.longitude, a.latitude)
        geom = affinity.rotate(box(x-a.width_m/2, y-a.depth_m/2, x+a.width_m/2, y+a.depth_m/2), -a.rotation_deg, origin=(x,y))
        if not transform(TO_M,box(*data["bbox"])).covers(geom):
            raise ValueError("拟建建筑轮廓超出底图覆盖范围。")
        if not transform(TO_M, shape(model_boundary(scene.area_kind)["geometry"])).covers(geom):
            raise ValueError("拟建建筑轮廓越过" + ("校园边界" if scene.area_kind == "campus" else "街区模型边界") + "，请调整位置或尺寸。")
        if any(geom.intersection(f["metric"]).area > 0.5 for f in proposed):
            raise ValueError("新建筑与保留建筑重叠，请调整位置或先标记拟拆除建筑。")
        proposed.append({"id": a.id, "metric": geom, "height": a.height_m, "geometry": mapping(transform(TO_LL, geom)),
                         "properties": {"id": a.id, "height_m": a.height_m, "render_height_m": a.height_m, "state": "new", "name": "拟建建筑"}})
    return base, proposed


def sweep_shadow(geom, height, altitude, azimuth):
    return _sweep_shadow(geom.wkb, height, altitude, azimuth)


@lru_cache(maxsize=2048)
def _sweep_shadow(geometry, height, altitude, azimuth):
    if altitude <= 0 or height <= 1.1:
        return Polygon()
    geom = from_wkb(geometry)
    distance = (height-1.1) / math.tan(math.radians(max(altitude, 0.5)))
    dx, dy = -math.sin(math.radians(azimuth))*distance, -math.cos(math.radians(azimuth))*distance
    parts = [geom, affinity.translate(geom, dx, dy)]
    for polygon in ([geom] if geom.geom_type == "Polygon" else geom.geoms):
        for ring in [polygon.exterior, *polygon.interiors]:
            for a, b in zip(ring.coords, list(ring.coords)[1:]):
                quad = Polygon([a, b, (b[0]+dx,b[1]+dy), (a[0]+dx,a[1]+dy)])
                if quad.area > 0:
                    parts.append(quad)
    return unary_union(parts)


def sky_view(point, tree, objects):
    x, y = point.x, point.y
    # Only buildings within the original 300 m ray bounds can affect the value.
    # Key by geometry and height so local edits invalidate their own neighbours.
    neighbours = tuple((objects[i]["metric"].wkb, objects[i]["height"])
                       for i in sorted(tree.query(box(x-300, y-300, x+300, y+300))))
    return _sky_view(x, y, neighbours)


@lru_cache(maxsize=4096)
def _sky_view(x, y, neighbours):
    point = Point(x, y)
    objects = [{"metric": from_wkb(geometry), "height": height} for geometry, height in neighbours]
    tree = STRtree([f["metric"] for f in objects])
    return _point_sky_view(point, tree, objects)


def _point_sky_view(point, tree, objects):
    angles = np.radians(np.arange(0, 360, 10))
    endpoints = np.column_stack([point.x+300*np.sin(angles), point.y+300*np.cos(angles)])
    rays = shapely.linestrings(np.stack([np.tile([point.x, point.y], (36, 1)), endpoints], axis=1))
    horizons = np.zeros(36)
    # Exact intersections in GEOS batches avoid Python work on bounding-box misses.
    ray_ids, object_ids = tree.query(rays, predicate="intersects")
    if len(ray_ids):
        footprints = np.asarray([f["metric"] for f in objects], dtype=object)
        heights = np.asarray([f["height"] for f in objects])
        hits = shapely.intersection(footprints[object_ids], rays[ray_ids])
        distances = np.maximum(0.1, shapely.distance(point, hits))
        np.maximum.at(horizons, ray_ids, np.arctan2(np.maximum(0, heights[object_ids]-1.1), distances))
    return float(np.mean(np.cos(horizons)**2))


def outdoor_sky_view(ground, tree, objects):
    """Integrate coarse cells on a fixed metric lattice instead of one centre ray."""
    minx, miny, maxx, maxy = ground.bounds
    neighbours = tuple((objects[i]["metric"].wkb, objects[i]["height"])
                       for i in sorted(tree.query(box(minx-300,miny-300,maxx+300,maxy+300))))
    return _outdoor_sky_view(ground.wkb, neighbours)


@lru_cache(maxsize=4096)
def _outdoor_sky_view(ground_wkb, neighbours):
    ground = from_wkb(ground_wkb)
    objects = [{"metric":from_wkb(geometry), "height":height} for geometry,height in neighbours]
    tree = STRtree([f["metric"] for f in objects])
    minx, miny, maxx, maxy = ground.bounds
    total = 0.0
    for ix in range(math.floor(minx/50), math.ceil(maxx/50)):
        for iy in range(math.floor(miny/50), math.ceil(maxy/50)):
            part = ground.intersection(box(ix*50, iy*50, (ix+1)*50, (iy+1)*50))
            if part.area > 0:
                total += part.area * sky_view(part.representative_point(), tree, objects)
    return total/ground.area


def stress(value):
    if value is None:
        return "不可计算"
    for high, label in [(9,"冷应激范围"),(26,"无热应激"),(32,"中等热应激"),(38,"强热应激"),(46,"很强热应激")]:
        if value < high:
            return label
    return "极强热应激"


async def boundary_weather(body):
    _, points, _ = region_samples(body.regional)
    lon, lat = points[0].x, points[0].y
    if body.regional.data_mode == "lcz_simulation" and body.regional.area_kind == "campus":
        from backend.lcz import reference_station
        station = reference_station()
        if station["location"]:
            lon, lat = station["location"]["longitude"], station["location"]["latitude"]
    target = getattr(body, "valid_time", None)
    series_key = (round(lat,5),round(lon,5),body.regional.mode)
    key = (*series_key, target.isoformat() if target else None)
    async with _weather_locks[hash(series_key) % len(_weather_locks)]:
        now = datetime.now(timezone.utc)
        cached = _weather_cache.get(key)
        if cached and (now-cached[0]).total_seconds() < (86400 if body.regional.mode == "history" else 600) and (target is not None or body.regional.mode == "history" or 0 <= (now-datetime.fromisoformat(cached[1]["observed_at"])).total_seconds() <= 7200):
            return cached[1]
        fields = ["temperature_2m","relative_humidity_2m","wind_speed_10m","direct_normal_irradiance_instant","diffuse_radiation_instant"]
        params = {"latitude": lat, "longitude": lon, "timezone": "Asia/Shanghai", "wind_speed_unit": "ms", "hourly": ",".join(fields)}
        historical = body.regional.mode == "history"
        params.update({"start_date": HISTORY_DATE, "end_date": HISTORY_DATE} if historical else {"past_days": 1,"forecast_days": 3})
        series = _weather_series_cache.get(series_key)
        if series and (now-series[0]).total_seconds() < 600:
            raw, source_url = series[1:]
            fetched_at = series[0]
        else:
            async with httpx.AsyncClient(timeout=10) as client:
                for attempt in range(2):
                    try:
                        r = await client.get(HISTORY_URL if historical else CURRENT_URL, params=params)
                        r.raise_for_status()
                        break
                    except httpx.HTTPError as error:
                        retryable = not isinstance(error, httpx.HTTPStatusError) or error.response.status_code in {502, 503, 504}
                        if attempt or not retryable:
                            raise
                        await asyncio.sleep(0.3)
            raw, source_url = r.json(), str(r.url)
            fetched_at = now
        validate_grid(raw, {"latitude":lat,"longitude":lon})
        units = raw["hourly_units"]
        if raw.get("utc_offset_seconds") != 28800 or any(units.get(k) != v for k,v in zip(fields,["°C","%","m/s","W/m²","W/m²"])):
            raise ValueError("气象单位或时区异常")
        times = [datetime.fromisoformat(t+"+08:00") for t in raw["hourly"]["time"]]
        if any(len(raw["hourly"][f]) != len(times) for f in fields):
            raise ValueError("气象数组长度异常")
        candidates = [i for i,t in enumerate(times) if (t == target if target else t.hour==14 if historical else 0 <= (now-t).total_seconds() <= 7200)]
        if not candidates:
            raise ValueError("缺少有效同刻气象与辐射资料")
        i = candidates[-1]
        values = {f:raw["hourly"][f][i] for f in fields}
        if any(type(v) not in (int,float) or not math.isfinite(v) for v in values.values()):
            raise ValueError("同刻气象或辐射缺测，未使用默认值替代")
        t,rh,v,dni,dhi = [values[f] for f in fields]
        if not (-60<=t<=60 and 0<=rh<=100 and 0<=v<=100 and 0<=dni<=1500 and 0<=dhi<=1500):
            raise ValueError("气象字段超出合理范围")
        from backend.aic.router import store
        record = store.put({"source_type": "open_meteo_forecast" if target else "historical_weather" if historical else "open_meteo_grid",
            "source_name": "Open-Meteo 同刻小时气象与瞬时辐射", "source_url":source_url,
            "observed_at":times[i].isoformat(), "retrieved_at":fetched_at.isoformat(),
            "valid_time":times[i].isoformat(), "is_forecast": target is not None,
            "temperature_c":t,"relative_humidity_pct":rh,"quality_status":"validated",
            "location":{"longitude":raw["longitude"],"latitude":raw["latitude"]},
            "requested_location":{"longitude":lon,"latitude":lat},
            "extras":{"wind_speed_10m":v,"direct_normal_irradiance_wm2":dni,"diffuse_radiation_wm2":dhi},
            "units":{"temperature":"°C","humidity":"%"},
            "extra_units":dict(zip(fields,["°C","%","m/s","W/m²","W/m²"])),
            "attribution":"Open-Meteo · CC BY 4.0 · 非现场实测"},raw)
        if cached and all(cached[1].get(k) == record.get(k) for k in ("source_type", "source_url", "observed_at", "temperature_c", "relative_humidity_pct", "location", "extras")):
            record = cached[1]
        while len(_weather_cache)>=128:
            _weather_cache.pop(next(iter(_weather_cache)))
        _weather_cache[key] = (now,record)
        while len(_weather_series_cache) >= 32:
            _weather_series_cache.pop(next(iter(_weather_series_cache)))
        _weather_series_cache[series_key] = (fetched_at,raw,source_url)
        return record


def calculation_region(body):
    outline = analysis_region(body.regional)
    region = transform(TO_M, outline)
    coverage = transform(TO_M, box(*model_buildings(body.regional.area_kind)["bbox"]))
    if not coverage.covers(region):
        raise ValueError("选区超出建筑底图覆盖范围，不能将缺失建筑视为无建筑。请缩小选区。")
    minx,miny,maxx,maxy = region.bounds
    nx,ny = math.ceil((maxx-minx)/body.resolution_m),math.ceil((maxy-miny)/body.resolution_m)
    if nx*ny>4096:
        raise ValueError("计算单元超过4096，请缩小选区或调大采样间距。")
    return region, (minx,miny,maxx,maxy), nx, ny


@lru_cache(maxsize=16)
def _thermal_grid(region_wkb, resolution):
    region = from_wkb(region_wkb)
    minx, miny, maxx, maxy = region.bounds
    cells = []
    for row in range(math.ceil((maxy-miny)/resolution)):
        for col in range(math.ceil((maxx-minx)/resolution)):
            cell = box(minx+col*resolution, miny+row*resolution,
                       min(minx+(col+1)*resolution,maxx), min(miny+(row+1)*resolution,maxy)).intersection(region)
            if not cell.is_empty and cell.area > 0:
                cells.append((cell, mapping(transform(TO_LL,cell))))
    return cells


@lru_cache(maxsize=4096)
def _outdoor_ground(cell_wkb, footprints):
    return from_wkb(cell_wkb).difference(unary_union([from_wkb(geometry) for geometry in footprints]))


def simulate(body, observation, scenario=None):
    base, proposed = scene_geometry(body.scene)
    b = body.regional.bounds
    outline = analysis_region(body.regional)
    region, (minx,miny,maxx,maxy), nx, ny = calculation_region(body)
    solar = get_solarposition(pd.DatetimeIndex([observation["observed_at"]]),(b.south+b.north)/2,(b.west+b.east)/2, altitude=0, method="nrel_numpy").iloc[0]
    altitude,azimuth = float(solar["elevation"]),float(solar["azimuth"])
    t,rh = observation["temperature_c"],observation["relative_humidity_pct"]
    v,dni,dhi = [observation["extras"][k] for k in ["wind_speed_10m","direct_normal_irradiance_wm2","diffuse_radiation_wm2"]]
    trees = [STRtree([f["metric"] for f in objects]) for objects in [base,proposed]]
    unchanged = not body.scene.additions and not body.scene.removed_ids
    # Buildings outside the analysis rectangle still cast shadows into the area.
    base_shadow = unary_union([sweep_shadow(f["metric"],f["height"],altitude,azimuth) for f in base])
    shadows = [base_shadow,base_shadow if unchanged else unary_union([sweep_shadow(f["metric"],f["height"],altitude,azimuth) for f in proposed])]
    cells = []
    scenario_cells = [metric_shape(c["geometry"]) for c in scenario["cells"]["features"]] if scenario else []
    scenario_tree = STRtree(scenario_cells) if scenario else None
    edited_geometry=unary_union([f['metric'] for f in base if f['id'] in body.scene.removed_ids]+[f['metric'] for f in proposed if f['id'].startswith('new-')])
    for cell, geometry in _thermal_grid(region.wkb, body.resolution_m):
            # Integrate shadows over shared outdoor ground rather than testing
            # only the centre, which can miss small buildings in coarse cells.
            outdoor = [_outdoor_ground(cell.wkb, tuple(objects[index]["metric"].wkb for index in tree.query(cell)))
                       for objects, tree in zip([base, proposed], trees)]
            common = outdoor[0].intersection(outdoor[1])
            p = {"area_m2":cell.area, "comparable_area_m2":common.area,
                 "grid_id":"THERM49-"+str(body.resolution_m)+"-"+digest(dict(geometry))[:16],
                 "distance_to_edit_m":None if unchanged else round(cell.distance(edited_geometry),3),
                 "baseline_neighbourhood":neighbourhood.morphology(cell,trees[0],base)}
            p['proposed_neighbourhood']=p['baseline_neighbourhood'] if unchanged else neighbourhood.morphology(cell,trees[1],proposed)
            local_t, local_rh = t, rh
            if scenario:
                overlaps = [(index, scenario_cells[index].intersection(cell).area) for index in scenario_tree.query(cell)]
                fields = [(scenario["cells"]["features"][index]["properties"], area) for index, area in overlaps if area > 0]
                valid = [(field, area) for field, area in fields if field.get("temperature_c") is not None and field.get("humidity_pct") is not None]
                supported = sum(area for _, area in valid)
                local_t = sum(field["temperature_c"]*area for field, area in valid)/supported if supported >= cell.area*.95 else None
                local_rh = sum(field["humidity_pct"]*area for field, area in valid)/supported if local_t is not None else None
                field = max(fields,key=lambda item:item[1])[0] if fields else {}
                p.update(source_grid_id=field.get("grid_id"), source_type="simulated_lcz", lcz_hint=field.get("lcz_hint"),
                         weather_support_fraction=min(1.0,supported/cell.area))
                components={}
                total_overlap=sum(area for _,area in fields)
                for field,area in fields:
                    for code,fraction in field.get('lcz_fractions',{}).items():
                        components[code]=components.get(code,0)+area*fraction/total_overlap
                p['lcz_fractions']=components
                p['vegetation_fraction']=sum(fraction for code,fraction in components.items() if 11<=int(code)<=14)
                p['water_fraction']=components.get('17',0)
            p.update(air_temperature_c=local_t, humidity_pct=local_rh)
            for prefix, objects, tree, shadow, ground in zip(["baseline","proposed"],[base,proposed],trees,shadows,outdoor):
                if prefix=="proposed" and unchanged:
                    p.update({key.replace("baseline_","proposed_"):value for key,value in list(p.items()) if key.startswith("baseline_")})
                    continue
                occupied = ground.area <= 0.01
                support = common if common.area > 0.01 else ground
                shade_fraction = (1.0 if altitude <= 0 else min(1.0, max(0.0, support.intersection(shadow).area/support.area))) if not occupied else None
                shaded = shade_fraction is not None and shade_fraction >= 0.5
                svf = outdoor_sky_view(support,tree,objects) if not occupied else None
                mrt = sun_mrt = shade_mrt = None
                if not occupied and local_t is not None:
                    mrts = []
                    for exposed in [1, 0]:
                        flux = body_solar_flux_from_parts(dhi,dni,altitude,135,svf,exposed,0.2,"standing") if altitude>=2 else 0
                        mrts.append(local_t + mrt_delta_from_erf(erf_from_body_solar_flux(flux,0.7,0.95),0.725))
                    sun_mrt, shade_mrt = mrts
                    mrt = (1-shade_fraction)*sun_mrt + shade_fraction*shade_mrt
                p.update({prefix+"_occupied":occupied,prefix+"_outdoor_area_m2":round(ground.area,3),
                          prefix+"_shade":shaded,prefix+"_shade_fraction":shade_fraction,
                          prefix+"_svf":svf,prefix+"_mrt_c":mrt,
                          prefix+"_sun_mrt_c":sun_mrt,prefix+"_shade_mrt_c":shade_mrt})
            cells.append({"type":"Feature","geometry":dict(geometry),"properties":p})
    for prefix in ["baseline","proposed"]:
        if prefix == "proposed" and unchanged:
            for c in cells:
                c["properties"]["proposed_utci_c"] = c["properties"]["baseline_utci_c"]
                c["properties"]["proposed_ml_utci_c"] = c["properties"].get("baseline_ml_utci_c")
                c["properties"]["proposed_ml_status"] = c["properties"].get("baseline_ml_status")
            continue
        mrts = np.array([[c["properties"][prefix+"_"+exposure+"_mrt_c"] if c["properties"][prefix+"_"+exposure+"_mrt_c"] is not None else np.nan for c in cells] for exposure in ["sun", "shade"]])
        temperatures = np.array([c["properties"]["air_temperature_c"] if c["properties"]["air_temperature_c"] is not None else np.nan for c in cells])
        humidities = np.array([c["properties"]["humidity_pct"] if c["properties"]["humidity_pct"] is not None else np.nan for c in cells])
        values = np.asarray(utci(tdb=np.tile(temperatures,2),tr=mrts.reshape(-1),v=v,rh=np.tile(humidities,2),limit_inputs=True,round_output=False).utci).reshape(2,-1)
        selected,predicted,accepted=spatial_surrogate.checked_predict(np.tile(temperatures,2),mrts.reshape(-1),v,np.tile(humidities,2),values.reshape(-1))
        selected,predicted,accepted=selected.reshape(2,-1),predicted.reshape(2,-1),accepted.reshape(2,-1)
        for index,c in enumerate(cells):
            fraction = c["properties"][prefix+"_shade_fraction"]
            # Never silently renormalize away an unsupported sun/shade component.
            parts = [(values[0,index],1-fraction),(values[1,index],fraction)] if fraction is not None else []
            value = sum(value*weight for value,weight in parts if weight>0) if parts else np.nan
            ml_parts=[(predicted[0,index],1-fraction),(predicted[1,index],fraction)] if fraction is not None else []
            prediction=sum(value*weight for value,weight in ml_parts if weight>0) if ml_parts else np.nan
            supported=parts and all(accepted[j,index] for j,(_,weight) in enumerate(parts) if weight>0)
            if supported:
                value=sum(selected[j,index]*weight for j,(_,weight) in enumerate(parts) if weight>0)
            c["properties"][prefix+"_utci_c"] = float(round(value,4)) if math.isfinite(value) else None
            c['properties'][prefix+'_ml_utci_c']=float(round(prediction,6)) if math.isfinite(prediction) else None
            c['properties'][prefix+'_ml_status']='physics_checked_ml' if supported else 'physics_fallback'
    comparable = []
    for c in cells:
        p = c["properties"]
        a,z = p["baseline_utci_c"],p["proposed_utci_c"]
        p["delta_utci_c"] = round(z-a,4) if a is not None and z is not None and p["comparable_area_m2"] > 0.01 else None
        p['neighbourhood_effect']=neighbourhood.cell_effect(p)
        if p["delta_utci_c"] is not None:
            comparable.append(p)
    total = sum(p["comparable_area_m2"] for p in comparable)
    def mean(key):
        return round(sum(p[key]*p["comparable_area_m2"] for p in comparable)/total,6) if total else None
    summary = {"baseline_utci_c":mean("baseline_utci_c"),"proposed_utci_c":mean("proposed_utci_c"),"delta_utci_c":mean("delta_utci_c"),
               "baseline_shade_pct":round(sum(p["comparable_area_m2"]*p["baseline_shade_fraction"] for p in comparable)/total*100,2) if total else None,
               "proposed_shade_pct":round(sum(p["comparable_area_m2"]*p["proposed_shade_fraction"] for p in comparable)/total*100,2) if total else None,
               "comparable_cells":len(comparable),"total_cells":len(cells),"comparable_area_m2":round(total,2),
               "added_buildings":len(body.scene.additions),"removed_buildings":len(body.scene.removed_ids),
               "air_temperature_delta_c":None,"confidence":None,"baseline_stress":stress(mean("baseline_utci_c")),"proposed_stress":stress(mean("proposed_utci_c"))}
    changed = [p for p in comparable if abs(p["delta_utci_c"]) >= 0.001]
    summary.update(changed_cells=len(changed), changed_area_m2=round(sum(p["comparable_area_m2"] for p in changed),2),
                   local_delta_min_c=min((p["delta_utci_c"] for p in comparable),default=None),
                   local_delta_max_c=max((p["delta_utci_c"] for p in comparable),default=None))
    effect_status = ("no_edits" if unchanged else "no_comparable_cells" if not comparable else
                     "night_no_shortwave" if altitude < 2 else "changed" if changed else "no_resolved_change")
    distributions = {}
    for prefix in ["baseline", "proposed"]:
        buckets = []
        for lower, upper, label in [(-math.inf,9,"低于无热应激范围"),(9,26,"无热应激"),(26,32,"中等热应激"),(32,38,"强热应激"),(38,46,"很强热应激"),(46,math.inf,"极强热应激")]:
            area = sum(p["comparable_area_m2"] for p in comparable if lower <= p[prefix+"_utci_c"] < upper)
            buckets.append({"label":label,"area_m2":round(area,2),"area_pct":round(area/total*100,2) if total else None})
        distributions[prefix] = buckets
        summary[prefix+"_strong_heat_area_pct"] = round(sum(p["comparable_area_m2"] for p in comparable if p[prefix+"_utci_c"]>=32)/total*100,2) if total else None
    summary["strong_heat_area_change_pp"] = round(summary["proposed_strong_heat_area_pct"]-summary["baseline_strong_heat_area_pct"],2) if total else None
    low_sun = altitude < 2
    assessment = {"mode": "night_weather_estimate" if altitude <= 0 else "low_sun_weather_estimate" if low_sun else "solar_weather_estimate",
                  "status": "estimated" if comparable else "unavailable",
                  "label": "夜间气象估测" if altitude <= 0 else "低太阳高度气象估测" if low_sun else "日间辐射气象估测",
                  "utci_c": summary["proposed_utci_c"], "stress": summary["proposed_stress"],
                  "inputs": ["air_temperature_c", "humidity_pct", "wind_speed_10m"],
                  "shortwave_included": not low_sun, "building_delta_evaluated": not low_sun and bool(comparable),
                  "note": ("根据当前情景的温湿度与10米风估测环境热应激，不计太阳短波增量，平均辐射温度近似气温；仍计算夜间风险，不因夜间自动下调等级。拆建导致的蓄热与通风变化未求解。"
                           if low_sun else "根据温湿度、10米风及建筑遮阴后的太阳短波辐射估测环境热应激；未作现场标定。")}
    return {"schema_version":VERSION,"validation":"exploratory_unvalidated","summary":summary,"cells":{"type":"FeatureCollection","features":cells},
            "thermal_assessment": assessment,
            "neighbourhood":neighbourhood.summarize(cells),
            "spatial_inference":{**spatial_surrogate.manifest(),
                'accepted_cell_scenarios':sum(c['properties'].get(prefix+'_ml_status')=='physics_checked_ml' for c in cells for prefix in ['baseline','proposed']),
                'physics_fallback_cell_scenarios':sum(c['properties'].get(prefix+'_ml_status')=='physics_fallback' for c in cells for prefix in ['baseline','proposed']),
                'online_error_gate_c':.00001,'delta_policy':'same_boundary_same_outdoor_support_verified_by_physics'},
            "solar":{"altitude_deg":round(altitude,3),"azimuth_deg":round(azimuth,3),"time":observation["observed_at"]},
            "weather_boundary":observation,"scene":body.scene.model_dump(),"scene_sha256":digest(body.scene.model_dump()),
            "geometry_sha256":digest(model_buildings(body.scene.area_kind)),"input":body.model_dump(mode="json"),"limitations":list(LIMITS),
            "valid_time":observation["observed_at"], "is_forecast":body.valid_time is not None,
            "sources":SOURCES,"geometry_coverage":model_buildings(body.scene.area_kind)["coverage"],"resolution_m":body.resolution_m,
            "area": region_description(body.regional, outline), "data_mode": body.regional.data_mode,
            "lcz_snapshot_sha256": scenario["snapshot_sha256"] if scenario else None,
            "spatial_exposure":{"distribution":distributions,"support":"改造前后均为室外且UTCI有效的同位置采样单元，面积加权；不是人口分布或患病比例。","utci_reference":"UTCI标准参考人；人群与活动只改变定性关注项，不套用未经验证的等效升温。"},
            "sampling_method":"shared_outdoor_area_sun_shade_utci", "sky_sampling_method":"36_azimuths_50m_area_weighted_300m_radius", "weather_sampling_method":"metric_cell_overlap_weighted_95pct_support", "effect_status":effect_status,
            "created_at":datetime.now(timezone.utc).isoformat(),"night":altitude<=0,
            "note":"比较只针对改造前后均为室外且UTCI有效的相同采样位置；不把建筑内部或新释放面积加入平均值造成伪改善。"}


@router.get("/buildings")
async def get_buildings(response: Response, area_kind: Literal["campus", "neighborhood"] = "campus"):
    response.headers["Cache-Control"] = "public, max-age=300"
    return await run_in_threadpool(model_buildings, area_kind)


@router.get("/boundary")
async def get_boundary(area_kind: Literal["campus", "neighborhood"] = "campus"):
    return model_boundary(area_kind)


@router.get("/data-contract")
async def get_contract():
    from backend.data_contract import contract
    return contract()


@router.get("/lcz-metadata")
async def get_lcz_metadata():
    from backend.lcz import metadata
    return await run_in_threadpool(metadata)


from backend.data_contract import UGVTelemetry, normalize_telemetry


@router.post("/validate-telemetry")
async def validate_telemetry(body: UGVTelemetry):
    return normalize_telemetry(body)


@router.post("/validate")
async def validate_scene(body: Scene):
    try:
        base, proposed = scene_geometry(body)
    except ValueError as error:
        raise HTTPException(422, str(error))
    return {"valid": True, "baseline_buildings": len(base), "proposed_buildings": len(proposed), "scene_sha256": digest(body.model_dump())}


@router.post("/simulate")
async def simulation_response(body: SimulationInput, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return JSONResponse(await run_simulation(body, response), headers={"Cache-Control":"no-store"})


async def run_simulation(body: SimulationInput, response: Response):
    response.headers["Cache-Control"] = "no-store"
    result, observation, scenario = await calculate_snapshot(body)
    return await finalize_simulation(body, result, observation, scenario)


async def calculate_snapshot(body):
    try:
        calculation_region(body)
        scene_geometry(body.scene)
    except ValueError as error:
        raise HTTPException(422, str(error))
    async with _slots:
        try:
            observation = await boundary_weather(body)
            scenario = None
            if body.regional.data_mode == "lcz_simulation":
                from backend.lcz import build_scenario
                scenario = await run_in_threadpool(build_scenario, body.regional, observation)
            result = await run_in_threadpool(simulate,body,observation,scenario)
        except httpx.HTTPError:
            raise HTTPException(503,"同刻天气与辐射上游暂不可用；未生成模拟替代结果。")
        except (ValueError,KeyError,IndexError,TypeError) as error:
            raise HTTPException(422,str(error) if isinstance(error,ValueError) else "资料不完整，不能生成推演。")
    return result, observation, scenario


@router.post("/collaborate")
async def collaborate(body: CollaborationInput, response: Response):
    from backend.aic.router import take_ai_budget
    from backend.hybrid import run_tools
    response.headers["Cache-Control"] = "no-store"
    local_body = SimulationInput.model_validate(body.model_dump(mode="json",exclude={"station_window"}))
    try:
        calculation_region(local_body)
        scene_geometry(local_body.scene)
    except ValueError as error:
        raise HTTPException(422, str(error))
    enabled = body.regional.use_ai
    reason = ("ai_disabled" if not enabled else "model_not_configured" if not os.getenv("AIC_DEEPSEEK_API_KEY")
              else None if take_ai_budget() else "model_budget_limit")
    calculated = None

    async def calculate():
        nonlocal calculated
        # At most one numerical evaluation, always from the user's immutable scene.
        if calculated is None:
            calculated = await calculate_snapshot(local_body)
        return calculated[0]

    async def compare(candidates):
        from backend.hybrid import validate_candidates
        validate_candidates(candidates)
        await calculate()
        variants=[];seen={calculated[0]['scene_sha256']}
        def support_sha(result):
            return digest([f['properties']['grid_id'] for f in result['cells']['features']
                           if f['properties']['delta_utci_c'] is not None])
        reference_support=support_sha(calculated[0])
        for index,proposal in enumerate(candidates):
            factor=proposal['height_factor']
            candidate=local_body.model_copy(deep=True)
            for addition in candidate.scene.additions:
                addition.height_m=float(max(2,min(120,round(addition.height_m*factor,3))))
            candidate_sha=digest(candidate.scene.model_dump())
            if candidate_sha in seen:
                continue
            seen.add(candidate_sha)
            # Reuse exactly the boundary and LCZ snapshot of the current result.
            async with _slots:
                result=await run_in_threadpool(simulate,candidate,calculated[1],calculated[2])
            same_support=support_sha(result)==reference_support
            variants.append({'id':'candidate-'+str(index+1),'scene_sha256':result['scene_sha256'],
                'proposal':proposal,'same_valid_grid_support':same_support,
                'height_factor':factor,'summary':result['summary'],'neighbourhood':result['neighbourhood'],
                'spatial_inference':result['spatial_inference'],'numerical_sha256':digest(result['cells']),
                'height_changes':[{'building_id':a.id,'height_m':a.height_m} for a in candidate.scene.additions]})
        current=calculated[0]['summary']['proposed_utci_c']
        comparable=[v for v in variants if v['same_valid_grid_support'] and v['summary']['proposed_utci_c'] is not None
                    and abs(v['summary']['comparable_area_m2']-calculated[0]['summary']['comparable_area_m2'])<.01]
        eligible=not calculated[0]['night'] and calculated[0]['solar']['altitude_deg']>=2 and current is not None
        best=min(comparable,key=lambda v:v['summary']['proposed_utci_c']) if comparable and eligible else None
        improved=best is not None and best['summary']['proposed_utci_c']<current-.0001
        recommendation={'status':'improved' if improved else 'no_improvement' if eligible and comparable else 'not_evaluable',
            'criterion':'same_support_area_weighted_UTCI_radiation_only',
            'selected_candidate_id':best['id'] if improved else None,
            'current_utci_c':current,'selected_utci_c':best['summary']['proposed_utci_c'] if improved else current,
            'improvement_c':round(current-best['summary']['proposed_utci_c'],6) if improved else None,
            'scope':'仅比较辐射热暴露，不代表通风、蓄热或建筑综合最优。'}
        return {'schema_version':'ai-physics-candidates/1.0','reference_scene_sha256':calculated[0]['scene_sha256'],
                'weather_id':calculated[1]['id'],'valid_time':calculated[0]['valid_time'],
                'same_weather_and_footprint':True,'scene_applied':False,'alternatives':variants,
                'proposed_count':len(candidates),'recommendation':recommendation}

    result, workflow, messages = await run_tools(local_body.model_dump(mode="json"), calculate, body.station_window,
                                                enabled=enabled, denial_reason=reason, compare=compare)
    result["orchestration"] = workflow
    accepted = workflow["planner"]["status"] == "accepted"
    report = await finalize_simulation(local_body, result, calculated[1], calculated[2], tool_messages=messages,
                                       ai_permission=accepted, ai_denial_reason=workflow["planner"]["reason"])
    return JSONResponse(report, headers={"Cache-Control":"no-store"})


async def finalize_simulation(body, result, observation, scenario, tool_messages=(), ai_permission=None, ai_denial_reason=None):
    from backend.aic.router import build_regional_report
    s = result["summary"]
    delta_text = f"{s['delta_utci_c']}°C" if s["delta_utci_c"] is not None else "不可计算（无有效同位置室外UTCI单元）"
    exposure_text = (f"现状{s['baseline_strong_heat_area_pct']}%、方案{s['proposed_strong_heat_area_pct']}%，变化{s['strong_heat_area_change_pp']}个百分点。"
                     if s["comparable_cells"] else "无有效可比单元，不给出低风险或安全结论。")
    facts = [{"id":"LAYOUT-RESULT","text":f"探索性辐射情景：新增{s['added_buildings']}栋、拟拆除{s['removed_buildings']}栋；同位置可比单元{s['comparable_cells']}个；平均UTCI差{delta_text}（非气温差、非已验证效果）。","source_ids":["SOLARCAL","UTCI"],"evidence_ids":[result["scene_sha256"],observation["id"]]},
             {"id":"LAYOUT-LIMIT","text":LIMITS[0]+LIMITS[1],"source_ids":["DATA-CONTRACT"]},
             {"id":"LAYOUT-EXPOSURE","text":"同位置可比室外面积中，UTCI≥32°C占比："+exposure_text+"此为未验证的标准参考人环境暴露，不是某类人员患病比例；平均值可能掩盖局部热斑。","source_ids":["UTCI","DATA-CONTRACT"]},
             {"id":"LAYOUT-INDICATORS","text":f"现状/方案平均UTCI分级：{s['baseline_stress']}/{s['proposed_stress']}。UTCI考虑本模型的辐射假设；热指数不计该辐射，二者不得互相替代。热指数未达高温分级不代表日晒下无热应激。","source_ids":["UTCI","NWS-METHOD","DATA-CONTRACT"]}]
    facts.append({"id":"LAYOUT-LOCAL-CHANGE", "text":f"本次{result['effect_status']}；变化达到0.001°C的可比单元{s['changed_cells']}个，局部UTCI差值{s['local_delta_min_c']}至{s['local_delta_max_c']}°C。夜间模型不评估蓄热，零差值不能解释为拆建没有真实影响。",
                  "source_ids":["SOLARCAL","UTCI","DATA-CONTRACT"]})
    assessment = result["thermal_assessment"]
    if not assessment["shortwave_included"]:
        facts[0]["text"] = (f"{assessment['label']}：根据当前情景温湿度与风速估测，不计太阳短波增量；"
                            f"可比室外单元{s['comparable_cells']}个，方案平均UTCI为{assessment['utci_c']}°C，分级{assessment['stress']}。"
                            f"新增{s['added_buildings']}栋、拟拆除{s['removed_buildings']}栋的布局已保留；拆建热增量未估计，不能把零差值解释为无影响。")
        facts[-1]["text"] = ("当前仍进行环境热风险估测，夜间无太阳直射增量不等于无热风险；高温高湿时仍按实际温湿度分级，不设置夜间固定降级系数。"
                             "建筑蓄热、局地通风及壁面温差未求解，因此不以夜间零差值评价拆建优劣。")
    facts.append({'id':'LAYOUT-NEIGHBOURHOOD','text':f"逐格计算{result['neighbourhood']['computed_cells']}个单元；邻域半径50/150/300米，分别统计建筑密度和高度。遮阴变化单元{result['neighbourhood']['mechanism_counts']['direct_solar_shading']}，天空遮挡变化单元{result['neighbourhood']['mechanism_counts']['diffuse_sky_obstruction']}。局部变化由各格点辐射和遮阴输入重算，不用全域温度平移或随机风险。",
                  'source_ids':['SOLARCAL','UTCI'],'evidence_ids':[result['neighbourhood']['numeric_sha256']]})
    comparison=result.get('orchestration',{}).get('layout_comparison')
    if comparison:
        facts.append({'id':'LAYOUT-ALTERNATIVES','text':('DeepSeek依据物理基线提出参数，回代方程计算：' if comparison['proposal_origin']=='deepseek' else '规则降级参数回代计算：')+'；'.join(f"{v['id']} 高度系数 {v['height_factor']}，平均UTCI {v['summary']['proposed_utci_c']}°C、局部范围 {v['summary']['local_delta_min_c']} 至 {v['summary']['local_delta_max_c']}°C" for v in comparison['alternatives'])+'。计算筛选结论：'+comparison['recommendation']['status']+'，候选 '+str(comparison['recommendation']['selected_candidate_id'])+'。备选未应用到用户方案。',
                      'source_ids':['SOLARCAL','UTCI'],'evidence_ids':[v['numerical_sha256'] for v in comparison['alternatives']]})
    actions = [{"id":"LAYOUT-VERIFY","text":"将辐射情景筛选与现场高度、树冠、风及辐射观测对照，不据此批准拆建或给出疾病诊断。","source_ids":["DATA-CONTRACT"]}]
    class BoundaryEvidence:
        async def get(self, *_args, **_kwargs):
            return observation
    regional_evidence = scenario if scenario else await sample_region(BoundaryEvidence(), body.regional)
    if body.valid_time is not None:
        regional_evidence = {**regional_evidence, "case_type":"forecast_scenario", "is_forecast":True,
                             "valid_time":observation["observed_at"], "forecast_observation_id":observation["id"]}
        facts.append({"id":"FORECAST-TIME", "text":"本报告为预报小时"+observation["observed_at"]+"的布局情景；气象与辐射来自同一小时，不是当前观测。",
                      "source_ids":["OPEN-METEO"], "evidence_ids":[observation["id"]]})
    if not scenario:
        regional_evidence["coverage"]["note"] = "所有请求位置采用与沙盘相同的中心网格、同一小时气象边界；并非5份独立观测，不用于识别真实网格内部温湿度差异。"
        regional_evidence = weather_support_cells(regional_evidence, body.regional)
    else:
        result["limitations"][1] = "空气温湿度采用同一份LCZ模拟快照，改造前后保持每个位置的边界不变；仅计算体块改变的辐射影响，不声称预测拆建后的真实气温。"
    result["regional_report"] = await build_regional_report(body.regional,facts,actions,regional_evidence,
        tool_messages=tool_messages, ai_permission=ai_permission, ai_denial_reason=ai_denial_reason,
        layout_context={"summary":s, "scene_sha256":result["scene_sha256"], "night":result["night"],
                        "effect_status":result["effect_status"], "sampling_method":result["sampling_method"], "thermal_assessment":assessment,
                        "neighbourhood":result['neighbourhood'],"spatial_inference":result['spatial_inference'],"layout_comparison":comparison,
                        "valid_time":result["valid_time"], "is_forecast":result["is_forecast"]})
    result["regional_report"]["layout_exposure"] = {"summary":s,"spatial_exposure":result["spatial_exposure"],"scene_sha256":result["scene_sha256"],"validation":result["validation"],"thermal_assessment":assessment,"valid_time":result["valid_time"],"is_forecast":result["is_forecast"],"neighbourhood":result['neighbourhood'],"spatial_inference":result['spatial_inference']}
    for cohort in result["regional_report"]["cohorts"]:
        cohort["layout_exposure"] = {"baseline_utci_c":s["baseline_utci_c"],"proposed_utci_c":s["proposed_utci_c"],"proposed_strong_heat_area_pct":s["proposed_strong_heat_area_pct"],"note":"共享区域环境暴露；该人群活动与时长保留为定性情景，不计算患病概率。"}
        cohort["attention_factors"].append({"code":"layout_radiation","text":next(f["text"] for f in facts if f["id"]=="LAYOUT-INDICATORS"),"source_ids":["UTCI","NWS-METHOD","DATA-CONTRACT"]})
    result["regional_report"]["sources"] = list({s["id"]: s for s in [*result["regional_report"]["sources"], *SOURCES]}.values())
    result["regional_report"]["interpretation"]["fact_ids"] = list(dict.fromkeys(["LAYOUT-LIMIT","LAYOUT-RESULT","LAYOUT-EXPOSURE","LAYOUT-INDICATORS","LAYOUT-LOCAL-CHANGE",*result["regional_report"]["interpretation"]["fact_ids"]]))
    if "orchestration" in result:
        workflow = result["orchestration"]
        workflow["interpretation"] = result["regional_report"]["generation"]
        workflow["mode"] = ("deepseek_tools_local_models" if workflow["planner"]["status"] == "accepted"
                            and workflow["interpretation"]["mode"] == "ai_regional_evidence_selection"
                            else "local_models_with_fallback")
        result["regional_report"]["orchestration"] = workflow
    result["regional_report"].pop("report_sha256",None)
    result["regional_report"]["report_sha256"] = digest(result["regional_report"])
    result["report_sha256"] = digest(result)
    return result


@router.post("/heatmap")
async def heatmap(body: RegionalRequest, response: Response):
    from backend.aic.router import weather
    from backend.aic.regional import sample_region
    response.headers["Cache-Control"] = "no-store"
    try:
        async with _slots:
            result = await sample_region(weather,body)
    except ValueError as error:
        raise HTTPException(422, str(error))
    except httpx.HTTPError:
        raise HTTPException(503, "气象边界上游不可用，未生成模拟替代值。")
    if body.data_mode == "lcz_simulation":
        return JSONResponse(result, headers={"Cache-Control":"no-store"})
    return JSONResponse(weather_support_cells(result, body), headers={"Cache-Control":"no-store"})


def weather_support_cells(result, body):
    # Use the same selected-hour evidence for both the map and linked report.
    # Spatial support tiles are not the provider's native grid polygons.
    _, _, quarters = region_samples(body)
    cells = []
    for sample, cell in zip(result["samples"][1:], quarters):
        if cell.is_empty or cell.area <= 0:
            continue
        o = sample["observation"]
        valid = result["coverage"]["status"] != "time_mismatch" and sample["environment"]["risk"] != "unavailable" and o
        cells.append({"type":"Feature","geometry":mapping(cell),"properties":{"temperature_c":o["temperature_c"] if valid else None,
            "heat_index_c":sample["environment"]["heat_index_c"] if valid else None,
            "observation_id":o["id"] if o else None,"time":o["observed_at"] if o else None,"risk":sample["environment"]["risk"]}})
    return {**result,"cells":{"type":"FeatureCollection","features":cells},"refresh_seconds":120,
            "legend":("预报情景" if result.get("is_forecast") else "模型天气")+"采样支持区（非原生格网边界），无空间插值；重复网格保持相同数值，不制造建筑尺度冷热差异。",
            "created_at":datetime.now(timezone.utc).isoformat()}


@contextmanager
def scene_db():
    db = sqlite3.connect(plan_store.path,timeout=10)
    try:
        with db:
            db.execute("CREATE TABLE IF NOT EXISTS sandbox_scenes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)")
            yield db
    finally:
        db.close()


@router.get("/scenes")
async def list_scenes(response: Response, x_workspace_token: Annotated[str | None,Header()]=None):
    owner = owner_hash(x_workspace_token)
    response.headers["Cache-Control"] = "no-store"
    plan_store.path.parent.mkdir(parents=True,exist_ok=True)
    with scene_db() as db:
        rows = db.execute("SELECT payload FROM sandbox_scenes WHERE owner=? ORDER BY created_at DESC",(owner,)).fetchall()
    return {"scenes":[json.loads(row[0]) for row in rows]}


@router.post("/scenes",status_code=201)
async def save_scene(body: Scene, response: Response,x_workspace_token: Annotated[str | None,Header()]=None):
    owner = owner_hash(x_workspace_token)
    try:
        scene_geometry(body)
    except ValueError as e:
        raise HTTPException(422,str(e))
    response.headers["Cache-Control"] = "no-store"
    record = {"id":uuid.uuid4().hex,"scene":body.model_dump(),"created_at":datetime.now(timezone.utc).isoformat(),"geometry_sha256":digest(model_buildings(body.area_kind))}
    record["record_sha256"] = digest(record)
    plan_store.path.parent.mkdir(parents=True,exist_ok=True)
    with scene_db() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT COUNT(*) FROM sandbox_scenes WHERE owner=?",(owner,)).fetchone()[0]>=30:
            raise HTTPException(409,"当前工作区最多保存30份情景，请先导出并整理。")
        db.execute("INSERT INTO sandbox_scenes VALUES (?,?,?,?)",(record["id"],owner,json.dumps(record,ensure_ascii=False),record["created_at"]))
    return record


@router.delete("/scenes/{scene_id}")
async def delete_scene(scene_id:str,x_workspace_token:Annotated[str | None,Header()]=None):
    owner = owner_hash(x_workspace_token)
    plan_store.path.parent.mkdir(parents=True,exist_ok=True)
    with scene_db() as db:
        if db.execute("DELETE FROM sandbox_scenes WHERE id=? AND owner=?",(scene_id,owner)).rowcount!=1:
            raise HTTPException(404,"情景不存在或不属于当前工作区")
    return {"deleted":True}
