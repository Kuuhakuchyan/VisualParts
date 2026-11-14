"""Offline timing against a captured public result; makes no API or database writes."""
import argparse
import copy
import cProfile
import io
import json
import pstats
import time
from pathlib import Path

from backend import sandbox
from backend.aic.store import digest
from backend.lcz import build_scenario
from backend.spatial import campus_boundary

parser = argparse.ArgumentParser()
parser.add_argument("capture", type=Path)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
capture = json.loads(args.capture.read_text(encoding="utf-8"))["result"]
original = capture["input"]
baseline = capture["weather_boundary"]
full = campus_boundary()["geometry"]["coordinates"][0]
full_bounds = dict(west=min(p[0] for p in full), east=max(p[0] for p in full),
                   south=min(p[1] for p in full), north=max(p[1] for p in full))
records = []
profile = cProfile.Profile()
for scope in ["campus", "selection"]:
    body = copy.deepcopy(original)
    body["regional"].update(use_ai=False, mode="history", data_mode="lcz_simulation")
    body["valid_time"] = None
    if scope == "campus":
        body["regional"].update(bounds=full_bounds, grid_resolution_m=30)
        body["resolution_m"] = 100
    addition = dict(id="new-speed-test", longitude=113.528143, latitude=34.813813,
                    width_m=20, depth_m=20, height_m=60, rotation_deg=0)
    for stage in ["initial", "repeat", "weather", "build", "height", "undo"]:
        body["scene"] = dict(name="performance benchmark", additions=[], removed_ids=[])
        if stage in {"build", "height"}:
            body["scene"]["additions"] = [{**addition, "height_m":60 if stage == "build" else 80}]
        observation = copy.deepcopy(baseline)
        if stage == "weather":
            observation["temperature_c"] += 1
            observation["id"] = "obs_" + digest(observation)
        request = sandbox.SimulationInput.model_validate(body)
        started = time.perf_counter()
        scenario = build_scenario(request.regional, observation)
        scenario_ms = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        if scope == "campus" and stage == "initial":
            profile.enable()
        result = sandbox.simulate(request, observation, scenario)
        profile.disable()
        records.append(dict(scope=scope, stage=stage, scenario_ms=round(scenario_ms,2),
            simulate_ms=round((time.perf_counter()-started)*1000,2),
            cells_sha256=digest(result["cells"]), summary=result["summary"], solar=result["solar"]))
        print(json.dumps(records[-1]), flush=True)
stream = io.StringIO()
pstats.Stats(profile, stream=stream).sort_stats("cumtime").print_stats(25)
args.output.write_text(json.dumps(dict(records=records, profile=stream.getvalue()), indent=2), encoding="utf-8")
print(stream.getvalue())
