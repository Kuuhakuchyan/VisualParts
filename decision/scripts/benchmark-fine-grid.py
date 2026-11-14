"""Compare real full-campus thermal resolutions without network or AI calls."""
import json
import time

from backend import sandbox, lcz
from backend.spatial import campus_boundary
from backend.test_sandbox import body, boundary

ring = campus_boundary()["geometry"]["coordinates"][0]
bounds = dict(west=min(p[0] for p in ring), east=max(p[0] for p in ring),
              south=min(p[1] for p in ring), north=max(p[1] for p in ring))
observation = boundary()
for resolution in (100, 50, 30):
    request = body(resolution_m=resolution, regional=dict(bounds=bounds, data_mode="lcz_simulation", mode="history", use_ai=False))
    started = time.perf_counter()
    scenario = lcz.build_scenario(request.regional, observation)
    for stage in ("baseline", "build", "repeat"):
        if stage == "build":
            request.scene.additions = [sandbox.Addition.model_validate(dict(id="new-fine-grid", longitude=113.528143,
                latitude=34.813813, width_m=20, depth_m=20, height_m=60))]
        tick = time.perf_counter()
        result = sandbox.simulate(request, observation, scenario)
        print(json.dumps(dict(resolution_m=resolution, stage=stage, seconds=round(time.perf_counter()-tick,3),
            total_seconds=round(time.perf_counter()-started,3), summary=result["summary"])), flush=True)
