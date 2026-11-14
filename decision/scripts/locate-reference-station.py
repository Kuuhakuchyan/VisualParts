"""Convert the user-supplied GCJ-02 map pin, not a surveyed/RTK position."""
import json
from pathlib import Path

import eviltransform
from shapely.geometry import Point, shape

root = Path(__file__).resolve().parents[1]
longitude, latitude = 113.53853, 34.813483
lat, lon = eviltransform.gcj2wgs_exact(latitude, longitude)
boundary = shape(json.loads((root / "public/data/campus-boundary.geojson").read_text(encoding="utf-8"))["geometry"])
if not boundary.covers(Point(lon, lat)):
    raise ValueError("Converted station pin falls outside the campus outline; check source CRS")
target = root / "public/data/reference-station.json"
record = json.loads(target.read_text(encoding="utf-8"))
record.update(location={"longitude": round(lon, 7), "latitude": round(lat, 7)},
              source_location={"longitude": longitude, "latitude": latitude, "crs": "GCJ-02"},
              location_status="user_map_pin", location_basis="user_supplied_map_pin_between_two_teaching_buildings_road_front",
              coordinate_conversion={"library": "eviltransform", "version": "0.1.1", "method": "gcj2wgs_exact",
                                     "source": "https://github.com/googollee/eviltransform", "survey_accuracy_m": None},
              note="用户提供地图定位，已由GCJ-02转为WGS84，非测绘或RTK坐标。指定为校园基准站，站点实测未接入；当前模拟气象边界仍为公开网格。")
target.write_text(json.dumps(record, ensure_ascii=True, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"source_gcj02": [longitude, latitude], "wgs84": [lon, lat], "inside_campus": True}))
