"""Snapshot real public weather responses with explicit grid provenance."""

import asyncio
import math
import time
from datetime import datetime, timedelta, timezone

import httpx

CURRENT_URL = "https://api.open-meteo.com/v1/forecast"
HISTORY_URL = "https://archive-api.open-meteo.com/v1/archive"
HISTORY_DATE = "2024-06-12"
SITES = {
    "zhongyuan": {"latitude": 34.75, "longitude": 113.61, "label": "中原区附近网格"},
    "campus": {"latitude": 34.814, "longitude": 113.531, "label": "校园周边网格"},
}


def validate_grid(raw, location):
    lat, lon = raw["latitude"], raw["longitude"]
    if not all(type(v) in (int, float) and math.isfinite(v) for v in (lat, lon)):
        raise ValueError("invalid grid coordinates")
    if abs(lat - location["latitude"]) > 0.5 or abs(lon - location["longitude"]) > 0.5:
        raise ValueError("unexpected grid location")


class WeatherEvidence:
    def __init__(self, store):
        self.store = store
        self.cache = {}
        self.locks = {}

    def lock_for(self, key):
        # Fixed stripes cannot evict a lock that already has waiting requests.
        return self.locks.setdefault(hash(key) % 64, asyncio.Lock())

    def cache_record(self, key, ttl, record):
        now = time.monotonic()
        self.cache = {k: v for k, v in self.cache.items() if v[0] > now}
        while len(self.cache) >= 256:
            self.cache.pop(next(iter(self.cache)))
        self.cache[key] = (now + ttl, record)

    async def get(self, mode, site="zhongyuan", location=None, history_hour=None):
        if history_hour is not None and (type(history_hour) is not int or not 0 <= history_hour <= 23):
            raise ValueError("invalid history hour")
        if location:
            location = {**location, "latitude": round(location["latitude"], 5), "longitude": round(location["longitude"], 5)}
        key = (mode, site, tuple(sorted(location.items())) if location else None, history_hour)
        async with self.lock_for(key):
            location = location or SITES[site]
            item = self.cache.get(key)
            if item and time.monotonic() < item[0]:
                return item[1]
            params = {"latitude": location["latitude"], "longitude": location["longitude"], "timezone": "Asia/Shanghai"}
            if mode == "history":
                url = HISTORY_URL
                params.update(start_date=HISTORY_DATE, end_date=HISTORY_DATE, hourly="temperature_2m,relative_humidity_2m")
            else:
                url = CURRENT_URL
                params.update(current="temperature_2m,relative_humidity_2m,apparent_temperature,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation", wind_speed_unit="ms", forecast_days=1)
            async with httpx.AsyncClient(timeout=12) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                raw = response.json()
            if raw.get("utc_offset_seconds") != 28800:
                raise ValueError("unexpected upstream timezone")
            validate_grid(raw, location)
            if mode == "history":
                hourly = raw["hourly"]
                if not len(hourly["time"]) == len(hourly["temperature_2m"]) == len(hourly["relative_humidity_2m"]):
                    raise ValueError("inconsistent historical series")
                valid = [i for i, t in enumerate(hourly["temperature_2m"])
                         if type(t) in (int, float) and math.isfinite(t) and -60 <= t <= 60
                         and type(hourly["relative_humidity_2m"][i]) in (int, float)
                         and math.isfinite(hourly["relative_humidity_2m"][i]) and 0 <= hourly["relative_humidity_2m"][i] <= 100]
                if not valid:
                    raise ValueError("no historical observations")
                if history_hour is not None:
                    matches = [i for i in valid if hourly["time"][i] == f"{HISTORY_DATE}T{history_hour:02d}:00"]
                    if not matches:
                        raise ValueError("historical reference hour missing")
                    index = matches[0]
                else:
                    index = max(valid, key=lambda i: hourly["temperature_2m"][i])
                current = {k: v[index] for k, v in hourly.items()}
                units = raw["hourly_units"]
            else:
                current = raw["current"]
                units = raw["current_units"]
            if units.get("temperature_2m") != "°C" or units.get("relative_humidity_2m") != "%":
                raise ValueError("unexpected units")
            t, rh = current["temperature_2m"], current["relative_humidity_2m"]
            if not all(type(v) in (int, float) and math.isfinite(v) for v in (t, rh)) or not -60 <= t <= 60 or not 0 <= rh <= 100:
                raise ValueError("invalid temperature or humidity")
            stamp = datetime.fromisoformat(current["time"])
            if stamp.tzinfo is not None:
                raise ValueError("unexpected timestamp format")
            extra_units = {"wind_speed_10m": ("m/s", 0, 150), "wind_direction_10m": ("°", 0, 360),
                           "precipitation": ("mm", 0, 500), "surface_pressure": ("hPa", 500, 1100),
                           "apparent_temperature": ("°C", -100, 100)}
            extras = {}
            for field, (unit, low, high) in extra_units.items():
                value = current.get(field)
                extras[field] = value if units.get(field) == unit and type(value) in (int, float) and math.isfinite(value) and low <= value <= high else None
            record = {
                "source_type": "historical_weather" if mode == "history" else "open_meteo_grid",
                "source_name": "Open-Meteo 历史再分析网格" if mode == "history" else "Open-Meteo 当前网格估计",
                "source_url": str(response.url), "provider": "Open-Meteo",
                "original_record_id": "open-meteo:" + current["time"],
                "requested_location": {"latitude": location["latitude"], "longitude": location["longitude"]},
                "location": {"latitude": raw["latitude"], "longitude": raw["longitude"]},
                "location_label": location["label"], "observed_at": current["time"] + "+08:00",
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "temperature_c": t, "relative_humidity_pct": rh,
                "units": {"temperature": "°C", "humidity": "%"}, "quality_status": "validated",
                "quality_note": "已检查字段、范围、单位与时区；非现场校准或校园实测。",
                "selection": (f"统一历史参考时刻 {HISTORY_DATE} {history_hour:02d}:00 北京时间；不代表各点当日最高温" if history_hour is not None else "当日有效小时中气温最高的一小时；并非自动筛选热浪事件") if mode == "history" else "上游当前时刻",
                "disclaimer": "区域网格估计，不代表具体测点。历史资料不用于当前天气判断。" if mode == "history" else "区域网格模型估计，非校园站点实测。",
                "extras": extras,
                "attribution": "Weather data by Open-Meteo.com (CC BY 4.0); see source URL for dataset provenance.",
            }
            record = self.store.put(record, raw)
            self.cache_record(key, 86400 if mode == "history" else 120, record)
            return record

    async def timeline(self, site="zhongyuan"):
        key = ("timeline", site)
        async with self.lock_for(key):
            cached = self.cache.get(key)
            if cached and time.monotonic() < cached[0]:
                return cached[1]
            location = SITES[site]
            fields = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m"]
            params = {"latitude": location["latitude"], "longitude": location["longitude"],
                      "timezone": "Asia/Shanghai", "hourly": ",".join(fields),
                      "wind_speed_unit": "ms", "past_days": 1, "forecast_days": 2}
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(CURRENT_URL, params=params)
                response.raise_for_status()
                raw = response.json()
            units = raw["hourly_units"]
            validate_grid(raw, location)
            expected = {"temperature_2m": "°C", "relative_humidity_2m": "%", "precipitation": "mm", "wind_speed_10m": "m/s"}
            if raw.get("utc_offset_seconds") != 28800 or any(units.get(k) != v for k, v in expected.items()):
                raise ValueError("unexpected series units or timezone")
            hourly, now = raw["hourly"], datetime.now(timezone.utc)
            if any(len(hourly[field]) != len(hourly["time"]) for field in fields):
                raise ValueError("inconsistent series lengths")
            points = []
            bounds = {"temperature_2m": (-60, 60), "relative_humidity_2m": (0, 100),
                      "precipitation": (0, 500), "wind_speed_10m": (0, 150)}
            for i, stamp in enumerate(hourly["time"]):
                at = datetime.fromisoformat(stamp)
                if at.tzinfo is not None:
                    raise ValueError("unexpected timestamp format")
                at = at.replace(tzinfo=timezone(timedelta(hours=8)))
                if not now - timedelta(hours=24) <= at <= now + timedelta(hours=24):
                    continue
                point = {"time": at.isoformat(), "period": "forecast" if at > now else "past_model"}
                for field in fields:
                    value = hourly[field][i]
                    low, high = bounds[field]
                    point[field] = value if type(value) in (int, float) and math.isfinite(value) and low <= value <= high else None
                points.append(point)
            if not points or not any(p["temperature_2m"] is not None for p in points):
                raise ValueError("no usable series")
            snapshot = self.store.put({"source_type": "open_meteo_hourly", "source_url": str(response.url),
                "source_name": "Open-Meteo 小时模型与预报", "retrieved_at": now.isoformat(),
                "location": {"latitude": raw["latitude"], "longitude": raw["longitude"]},
                "requested_location": {"latitude": location["latitude"], "longitude": location["longitude"]},
                "location_label": location["label"], "units": expected,
                "disclaimer": "过去小时是模型资料，未来小时为预报；均非校园仪器实测，缺失值保留为空。"}, raw)
            result = {"snapshot": snapshot, "points": points}
            self.cache_record(key, 300, result)
            return result
