"""Snapshot real public weather responses with explicit grid provenance."""

import asyncio
import math
import time
from datetime import datetime, timezone

import httpx

CURRENT_URL = "https://api.open-meteo.com/v1/forecast"
HISTORY_URL = "https://archive-api.open-meteo.com/v1/archive"
HISTORY_DATE = "2024-06-12"


class WeatherEvidence:
    def __init__(self, store):
        self.store = store
        self.cache = {}
        self.lock = asyncio.Lock()

    async def get(self, mode):
        async with self.lock:
            item = self.cache.get(mode)
            if item and time.monotonic() < item[0]:
                return item[1]
            params = {"latitude": 34.75, "longitude": 113.61, "timezone": "Asia/Shanghai"}
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
            if mode == "history":
                hourly = raw["hourly"]
                valid = [i for i, t in enumerate(hourly["temperature_2m"]) if isinstance(t, (int, float)) and isinstance(hourly["relative_humidity_2m"][i], (int, float))]
                if not valid:
                    raise ValueError("no historical observations")
                index = max(valid, key=lambda i: hourly["temperature_2m"][i])
                current = {k: v[index] for k, v in hourly.items()}
                units = raw["hourly_units"]
            else:
                current = raw["current"]
                units = raw["current_units"]
            if units.get("temperature_2m") != "°C" or units.get("relative_humidity_2m") != "%":
                raise ValueError("unexpected units")
            t, rh = current["temperature_2m"], current["relative_humidity_2m"]
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (t, rh)) or not -60 <= t <= 60 or not 0 <= rh <= 100:
                raise ValueError("invalid temperature or humidity")
            record = {
                "source_type": "historical_weather" if mode == "history" else "open_meteo_grid",
                "source_name": "Open-Meteo 历史再分析网格" if mode == "history" else "Open-Meteo 当前网格估计",
                "source_url": str(response.url), "provider": "Open-Meteo",
                "original_record_id": "open-meteo:" + current["time"],
                "requested_location": {"latitude": 34.75, "longitude": 113.61},
                "location": {"latitude": raw["latitude"], "longitude": raw["longitude"]},
                "location_label": "中原区附近网格", "observed_at": current["time"] + "+08:00",
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "temperature_c": t, "relative_humidity_pct": rh,
                "units": {"temperature": "°C", "humidity": "%"}, "quality_status": "validated",
                "quality_note": "已检查字段、范围、单位与时区；非现场校准或校园实测。",
                "selection": "当日有效小时中气温最高的一小时；并非自动筛选热浪事件" if mode == "history" else "上游当前时刻",
                "disclaimer": "区域网格估计，不代表具体测点。历史资料不用于当前天气判断。" if mode == "history" else "区域网格模型估计，非校园站点实测。",
                "extras": {k: v for k, v in current.items() if k not in {"time", "temperature_2m", "relative_humidity_2m"}},
                "attribution": "Weather data by Open-Meteo.com (CC BY 4.0); see source URL for dataset provenance.",
            }
            record = self.store.put(record, raw)
            self.cache[mode] = (time.monotonic() + (86400 if mode == "history" else 120), record)
            return record
