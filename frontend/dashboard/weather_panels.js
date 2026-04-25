/**
 * 微境智护 — 左侧 10 个气象仪表盘
 * 每个仪表盘对应一个气象指标
 */

import { GaugeChart } from "../components/gauge.js";
import { WindCompass } from "../components/wind_compass.js";

export class WeatherPanels {
  constructor() {
    this._gauges = new Map();
    this._compass = null;
    this._init();
  }

  _init() {
    const container = document.getElementById("weather-gauges");
    if (!container) return;

    // 温度
    this._addGauge("g-temp", "温度", "°C", -10, 50, 32, [
      { value: 35, color: "#ff4444" },
      { value: 40, color: "#ff2200" },
    ]);

    // 湿度
    this._addGauge("g-humid", "湿度", "%", 0, 100, 68, [
      { value: 80, color: "#ffcc00" },
      { value: 95, color: "#ff6644" },
    ]);

    // 地表温
    this._addGauge("g-surftemp", "地表温", "°C", 0, 70, 40, [
      { value: 45, color: "#ff6644" },
      { value: 55, color: "#ff2200" },
    ]);

    // 气压
    this._addGauge("g-pressure", "气压", "hPa", 980, 1040, 1005, [
      { value: 1020, color: "#ffcc00" },
      { value: 1030, color: "#ff4444" },
    ]);

    // 风速
    this._addGauge("g-windspeed", "风速", "m/s", 0, 20, 2.1, [
      { value: 10, color: "#ffcc00" },
      { value: 15, color: "#ff4444" },
    ]);

    // 降水
    this._addGauge("g-precip", "降水", "mm", 0, 20, 0, [
      { value: 5, color: "#ffcc00" },
      { value: 10, color: "#4488ff" },
    ]);

    // 辐射
    this._addGauge("g-radiation", "辐射", "W/m²", 0, 1200, 680, [
      { value: 800, color: "#ffcc00" },
      { value: 1000, color: "#ff6644" },
    ]);

    // UHI强度
    this._addGauge("g-uhi", "热岛强度", "°C", 0, 10, 3.2, [
      { value: 5, color: "#ffcc00" },
      { value: 7, color: "#ff4444" },
    ]);

    // AQI
    this._addGauge("g-aqi", "空气质量", "AQI", 0, 300, 62, [
      { value: 100, color: "#ffcc00" },
      { value: 150, color: "#ff6644" },
      { value: 200, color: "#ff2200" },
    ]);

    // 舒适度
    this._addGauge("g-comfort", "舒适指数", "", 0, 100, 88, [
      { value: 40, color: "#ff4444" },
      { value: 60, color: "#ffcc00" },
    ]);

    // 风向罗盘（占两列）
    this._addCompass("g-compass");
  }

  _addGauge(id, label, unit, min, max, value, thresholds) {
    const wrap = document.getElementById(id);
    if (!wrap) return;

    const size = Math.max(100, Math.min(120, wrap.clientWidth || 110));
    const gauge = new GaugeChart(wrap, {
      size,
      label,
      unit,
      min,
      max,
      value,
      thresholds,
    });

    this._gauges.set(id, { gauge, label, unit, min, max });
  }

  _addCompass(id) {
    const wrap = document.getElementById(id);
    if (!wrap) return;

    const size = Math.max(100, Math.min(120, wrap.clientWidth || 110));
    const compass = new WindCompass(wrap, {
      size,
      direction: 45,
      speed: 2.1,
    });

    this._compass = compass;
  }

  update(data) {
    if (!data) return;

    const gaugeSet = (id, value) => {
      const entry = this._gauges.get(id);
      if (entry) entry.gauge.setValue(value);
    };

    gaugeSet("g-temp",      data.temperature     ?? 0);
    gaugeSet("g-humid",     data.humidity        ?? 0);
    gaugeSet("g-surftemp",  data.surfaceTemp    ?? 0);
    gaugeSet("g-pressure",  data.pressure        ?? 0);
    gaugeSet("g-windspeed", data.windSpeed       ?? 0);
    gaugeSet("g-precip",   data.precipitation  ?? 0);
    gaugeSet("g-radiation", data.solarRadiation  ?? 0);
    gaugeSet("g-uhi",      data.uhiIntensity    ?? 0);
    gaugeSet("g-aqi",      data.aqi             ?? 0);
    gaugeSet("g-comfort",   data.comfortIndex   ?? 0);

    if (this._compass && data.windDirection !== undefined) {
      this._compass.setDirection(data.windDirection, data.windSpeed ?? 0);
    }
  }

  destroy() {
    for (const [, entry] of this._gauges) {
      entry.gauge.destroy();
    }
    this._gauges.clear();
    if (this._compass) this._compass.destroy();
  }
}
