"""Read-only field-device adapters and replayable LCZ collection missions."""
import asyncio
import json
import math
import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import linemerge, substring, transform, unary_union
from shapely.strtree import STRtree

from backend.aic.regional import RegionalRequest
from backend.aic.risk import assess_environment, assess_forecast
from backend.aic.store import digest
from backend.lcz import build_scenario
from backend.sandbox import ROOT, TO_LL, TO_M, Scene, boundary_weather, scene_geometry, validate_forecast_hour
from backend.spatial import analysis_region

router = APIRouter(prefix="/api/weather/sandbox/collection", tags=["collection"])
VERSION = "WJTJ-collection-simulation/1.2"
DEVICES = {"ATOM_LITE_01": "ATOM Weather", "M5Stick_Plus2": "M5Stick Weather"}
_slots = asyncio.Semaphore(2)


def stamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result if result.tzinfo else None
    except (TypeError, ValueError):
        return None


def number(value, low, high):
    return value if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) and low <= value <= high else None


def normalize_device(key, info, latest, now=None, reachable=True):
    now = now or datetime.now(timezone.utc)
    sampled = stamp(latest.get("ts"))
    temp = number(latest.get("temp_c"), -40, 85)
    humid = number(latest.get("humidity"), 0, 100)
    recent = sampled is not None and -30 <= (now-sampled).total_seconds() <= 300
    seen = stamp(info.get("last_seen"))
    online = reachable and seen is not None and -30 <= (now-seen).total_seconds() <= 300
    usable = online and recent and temp is not None and humid is not None
    return {"device_id": key, "label": DEVICES[key], "source_type": "field_collection", "simulated": False,
            "status": "unavailable" if not reachable else "online" if usable else "awaiting_sample" if online else "offline",
            "last_seen": info.get("last_seen"), "observed_at": latest.get("ts") if sampled else None,
            "temperature_c": temp if usable else None, "humidity_pct": humid if usable else None,
            "last_sample": {"ts": latest.get("ts"), "temp_c": temp, "humidity_pct": humid} if sampled else None,
            "units": {"temperature_c": "degC", "humidity_pct": "%RH"}, "crs": "EPSG:4326", "location": None,
            "quality_flag": None, "med_eligible": False,
            "note": "只读原设备接口；位置坐标系与校准未确认前不落点、不进入医学证据。"}


async def read_devices():
    if os.getenv("COLLECTION_IOT_DISABLED") == "1":
        return [{**normalize_device(key, {}, {}, reachable=False), "status": "isolated",
                 "label": "固定传感器 " + str(index + 1),
                 "note": "竞赛独立环境未接入现场遥测；移动采集另以模拟任务展示。"}
                for index, key in enumerate(DEVICES)]
    # Fixed same-platform upstream, never a client-controlled URL or an ingestion endpoint.
    origin = os.getenv("COLLECTION_IOT_ORIGIN", "https://weather.nogamenolife.cn").rstrip("/")
    async with httpx.AsyncClient(timeout=7, trust_env=False) as client:
        try:
            response = await client.get(origin + "/api/devices")
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise ValueError("device list")
        except (httpx.HTTPError, ValueError):
            return [normalize_device(key, {}, {}, reachable=False) for key in DEVICES]
        info = {row.get("device_id"): row for row in rows if isinstance(row, dict)}

        async def latest(key):
            try:
                response = await client.get(origin + "/api/latest/" + key)
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict):
                    raise ValueError("sample")
                return normalize_device(key, info.get(key, {}), data)
            except (httpx.HTTPError, ValueError):
                return normalize_device(key, info.get(key, {}), {}, reachable=False)
        return await asyncio.gather(*(latest(key) for key in DEVICES))


@router.get("/devices")
async def devices(response: Response):
    response.headers["Cache-Control"] = "no-store"
    rows = await read_devices()
    if os.getenv("MOBILE_TELEMETRY_PUBLIC_VIEW") == "1" and os.getenv("COLLECTION_IOT_DISABLED") != "1":
        from backend.telemetry_view import field_devices
        rows += await run_in_threadpool(field_devices)
    return {"schema_version": VERSION, "devices": rows, "refresh_seconds": 30,
            "read_only": True, "checked_at": datetime.now(timezone.utc).isoformat()}


class CollectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    regional: RegionalRequest
    scene: Scene = Field(default_factory=Scene)
    expected_snapshot_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    ugv_budget_wh: float = Field(default=40, ge=1, le=500, allow_inf_nan=False)
    uav_budget_wh: float = Field(default=70, ge=1, le=500, allow_inf_nan=False)
    reserve_fraction: float = Field(default=0.25, ge=0.15, le=0.6, allow_inf_nan=False)
    start_mode: Literal["reference_station", "central_staging"] = "reference_station"
    valid_time: AwareDatetime | None = None

    @model_validator(mode="after")
    def simulation_only(self):
        if self.regional.area_kind != "campus" or self.regional.data_mode != "lcz_simulation":
            raise ValueError("采集仿真需要校园LCZ模拟网格；不会自动把公开天气标记为现场实测。")
        if self.scene.area_kind != self.regional.area_kind:
            raise ValueError("采集任务与建筑情景必须属于同一区域。")
        validate_forecast_hour(self.regional, self.valid_time)
        return self


def lines(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    return [line for part in getattr(geometry, "geoms", []) for line in lines(part)]


@lru_cache(maxsize=1)
def roads():
    data = json.loads((ROOT / "public/data/campus-streets.geojson").read_text(encoding="utf-8"))
    return unary_union([transform(TO_M, shape(f["geometry"])) for f in data["features"]])


def make_mission(body, scenario):
    from backend.routing import graph_from_lines, aerial_graph, informative_tour
    _, proposed = scene_geometry(body.scene)
    region = transform(TO_M, analysis_region(body.regional))
    obstacle = unary_union([f["metric"].buffer(1) for f in proposed])
    road_parts = lines(roads().intersection(region).difference(obstacle))
    geometries = [transform(TO_M, shape(f["geometry"])) for f in scenario["cells"]["features"]]
    tree = STRtree(geometries)
    def cell_at(point):
        return next((scenario["cells"]["features"][int(i)]["properties"].get("grid_id") for i in tree.query(point)
                     if geometries[int(i)].covers(point) and scenario["cells"]["features"][int(i)]["properties"].get("temp_c") is not None), None)
    ranks = {"below_range": 1, "caution": 1.5, "extreme_caution": 2, "danger": 3, "extreme_danger": 4}
    priorities = {f["properties"]["grid_id"]: ranks.get(f["properties"].get("risk"), 1) for f in scenario["cells"]["features"]}
    cell_classes = {f["properties"]["grid_id"]: f["properties"].get("lcz_hint")
                    for f in scenario["cells"]["features"] if f["properties"].get("temp_c") is not None}
    start_point = None
    if body.start_mode == "reference_station":
        from backend.lcz import reference_station
        location = reference_station()["location"]
        start_point = TO_M(location["longitude"], location["latitude"])
        if not region.covers(Point(start_point)):
            raise ValueError("基准站不在当前选区，请扩大选区，或明确选择选区模拟起点；不会自动跨区或任意换起点。")
    ground, ground_plan = informative_tour(graph_from_lines(unary_union(road_parts)), cell_at, priorities,
        body.ugv_budget_wh, 100, 1.0, body.reserve_fraction, start_point=start_point, turn_wh=0.001, cell_classes=cell_classes)
    aerial_obstacles = unary_union([f["metric"].buffer(5) for f in proposed if f["height"]+10 >= 60])
    aerial, aerial_plan = informative_tour(aerial_graph(region, aerial_obstacles), cell_at, priorities,
        body.uav_budget_wh, 240, 8.0, body.reserve_fraction, start_point=start_point, setup_wh=3, turn_wh=0.015, cell_classes=cell_classes)
    mission_key = digest({"snapshot": scenario["snapshot_sha256"], "input": body.model_dump(mode="json"), "version": VERSION})
    tracks = []
    start = stamp(scenario["baseline"]["observed_at"])
    for device, label, route, speed, altitude, step in [("UGV_SIM_01", "无人车", ground, 1.0, 0, 12), ("UAV_SIM_01", "无人机", aerial, 8.0, 60, 25)]:
        if route is None or route.length < 10:
            tracks.append({"device_id": device, "label": label, "status": "no_route", "samples": [], "route": None,
                           "planning": ground_plan if altitude == 0 else aerial_plan})
            continue
        count = min(1600, max(2, math.ceil(route.length/step)+1))
        samples = []
        for seq in range(count):
            distance = route.length*seq/(count-1)
            point = route.interpolate(distance)
            ll = transform(TO_LL, point)
            cell = next((scenario["cells"]["features"][int(i)] for i in tree.query(point) if geometries[int(i)].covers(point)), None)
            p = cell["properties"] if cell else {}
            samples.append({"seq": seq, "elapsed_s": round(distance/speed, 3),
                            "ts": (start+timedelta(seconds=distance/speed)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "longitude": round(ll.x, 7), "latitude": round(ll.y, 7), "crs": "EPSG:4326",
                            "temp_c": p.get("temp_c"), "humidity_pct": p.get("humidity_pct"), "grid_id": p.get("grid_id"),
                            "lcz_hint": p.get("lcz_hint"), "source_type": "simulated_collection", "simulated": True,
                            "quality_flag": None, "med_eligible": False, "altitude_agl_m": altitude,
                            "field_height_m": 2, "value_semantics": "ground_grid_projection" if altitude else "ground_grid_sample",
                            "baseline_observation_id": scenario["baseline"]["id"], "snapshot_sha256": scenario["snapshot_sha256"]})
        tracks.append({"device_id": device, "label": label, "status": "ready", "speed_mps": speed,
                       "altitude_agl_m": altitude, "distance_m": round(route.length, 1), "duration_s": samples[-1]["elapsed_s"],
                       "route": mapping(transform(TO_LL, route)), "samples": samples,
                       "planning": ground_plan if altitude == 0 else aerial_plan})
    return {"schema_version": VERSION, "mission_id": "sim_"+mission_key, "simulated": True,
            "valid_time": scenario["baseline"]["observed_at"], "is_forecast": body.valid_time is not None,
            "source_type": "simulated_collection", "snapshot_sha256": scenario["snapshot_sha256"],
            "scene_sha256": digest(body.scene.model_dump()), "boundary": scenario["baseline"], "tracks": tracks,
            "classification_summary": scenario.get("classification_summary"),
            "classification_sha256": scenario["simulation"]["classification_sha256"],
            "planning_input": {"ugv_budget_wh": body.ugv_budget_wh, "uav_budget_wh": body.uav_budget_wh, "reserve_fraction": body.reserve_fraction,"start_mode":body.start_mode},
            "time_semantics": "simulation_clock_not_field_sampling_time", "med_eligible": False,
            "note": "模拟数据。路网拓扑上按新增有效网格的信息收益/Wh贪心选择闭合路线，预留返航电量；非全局最优。无人车避让建筑，无人机避让超过航高安全余量的建筑。功率、电池与转向能耗为未标定场景参数，不是实测续航。温湿度取地面2m模拟网格，无人机不是航高气象预测。未建模交通、通信、禁飞空域或完整动力学。",
            "lcz_planning": {"method": "first_visit_dominant_class_bonus", "diversity_weight": 2.0,
                             "calibrated": False, "coverage_basis": "reachable_route_graph_nodes_not_field_validation"},
            "contract": {"coordinates": "EPSG:4326", "time": "UTC", "temperature": "degC", "humidity": "%RH",
                         "ugv_max_speed_mps": 1.5, "mqtt_published": False, "physical_device_control": False,
                         "simulation_schema": VERSION, "field_schema": "IF-02 remains unchanged; simulation quality_flag=null"}}


@router.post("/simulate")
async def simulate_collection(body: CollectionInput, response: Response):
    response.headers["Cache-Control"] = "no-store"
    async with _slots:
        try:
            baseline = await boundary_weather(body)
            assessment = assess_forecast if body.valid_time is not None else assess_environment
            if assessment(baseline, body.regional.exposure)["risk"] == "unavailable":
                raise ValueError("气象边界不可用，未生成仿真读数。")
            scenario = await run_in_threadpool(build_scenario, body.regional, baseline)
            if scenario["snapshot_sha256"] != body.expected_snapshot_sha256:
                raise HTTPException(409, "气象或网格快照已更新，请先刷新热图再生成任务。")
            return await run_in_threadpool(make_mission, body, scenario)
        except httpx.HTTPError:
            raise HTTPException(503, "天气上游不可用，未使用替代数据。")
        except (ValueError, KeyError, TypeError) as error:
            raise HTTPException(422, str(error) if isinstance(error, ValueError) else "仿真资料不完整。")
