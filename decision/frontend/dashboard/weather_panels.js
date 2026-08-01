/**
 * 微境智护 — 左侧气象仪表盘
 *
 * 布局（按规范）：
 * Row 1: 温度 | 湿度
 * Row 2: 地表温 | 气压
 * Row 3: 风速 | 降水
 * Row 4: 风向罗盘（独占两列）
 * Row 5: 辐射 | 热岛强度
 * Row 6: 空气质量 | 舒适指数
 *
 * 阈值使用归一化比例 ratio (0.0 ~ 1.0)，与 min/max 解耦。
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

    // 温度 (-10 ~ 50)
    this._addGauge("g-temp", "温度", "°C", -10, 50, 32, [
      { ratio: 0.583, color: "#ffcc00" },  // 35°C
      { ratio: 0.667, color: "#ff2200" },  // 40°C
    ]);

    // 湿度 (0 ~ 100)
    this._addGauge("g-humid", "湿度", "%", 0, 100, 68, [
      { ratio: 0.80, color: "#ffcc00" },  // 80%
      { ratio: 0.95, color: "#ff6644" },  // 95%
    ]);

    // 地表温 (0 ~ 70)
    this._addGauge("g-surftemp", "地表温", "°C", 0, 70, 40, [
      { ratio: 0.643, color: "#ff6644" },  // 45°C
      { ratio: 0.786, color: "#ff2200" },  // 55°C
    ]);

    // 气压 (980 ~ 1040)
    this._addGauge("g-pressure", "气压", "hPa", 980, 1040, 1005, [
      { ratio: 0.667, color: "#ffcc00" },  // 1020 hPa
      { ratio: 0.833, color: "#ff4444" }, // 1030 hPa
    ]);

    // 风速 (0 ~ 20)
    this._addGauge("g-windspeed", "风速", "m/s", 0, 20, 2.1, [
      { ratio: 0.50, color: "#ffcc00" },   // 10 m/s
      { ratio: 0.75, color: "#ff4444" },  // 15 m/s
    ]);

    // 降水 (0 ~ 20)
    this._addGauge("g-precip", "降水", "mm", 0, 20, 0, [
      { ratio: 0.25, color: "#ffcc00" },  // 5mm
      { ratio: 0.50, color: "#4488ff" },  // 10mm
    ]);

    // 辐射 (0 ~ 1200)
    this._addGauge("g-radiation", "辐射", "W/m²", 0, 1200, 680, [
      { ratio: 0.667, color: "#ffcc00" },  // 800
      { ratio: 0.833, color: "#ff6644" }, // 1000
    ]);

    // 热岛强度 (0 ~ 10)
    this._addGauge("g-uhi", "热岛强度", "°C", 0, 10, 3.2, [
      { ratio: 0.50, color: "#ffcc00" },  // 5°C
      { ratio: 0.70, color: "#ff4444" }, // 7°C
    ]);

    // 空气质量 (0 ~ 300)
    this._addGauge("g-aqi", "空气质量", "AQI", 0, 300, 62, [
      { ratio: 0.333, color: "#ffcc00" },  // 100
      { ratio: 0.50,  color: "#ff6644" },  // 150
      { ratio: 0.667, color: "#ff2200" },  // 200
    ]);

    // 舒适指数 (0 ~ 100，越高越舒适，但阈值表达：低于40危险，高于60良好)
    // 注意：舒适指数的特殊性：值越低越危险
    this._addGauge("g-comfort", "舒适指数", "", 0, 100, 88, [
      { ratio: 0.40, color: "#ff4444" },  // 40以下
      { ratio: 0.60, color: "#ffcc00" },  // 40-60
    ], true);

    // 风向罗盘（独占两列）
    this._addCompass("g-compass");
  }

  /**
   * @param {string} id - DOM element id
   * @param {string} label
   * @param {string} unit
   * @param {number} min
   * @param {number} max
   * @param {number} value
   * @param {Array<{ratio:number, color:string}>} thresholds
   * @param {boolean} [invert=false] - 是否反转颜色逻辑（值越高颜色越安全）
   */
  _addGauge(id, label, unit, min, max, value, thresholds, invert = false) {
    const wrap = document.getElementById(id);
    if (!wrap) return;

    // 固定 120px，不动态计算
    const gauge = new GaugeChart(wrap, {
      size: 120,
      label,
      unit,
      min,
      max,
      value,
      thresholds,
    });

    this._gauges.set(id, { gauge, label, unit, min, max, invert });
  }

  _addCompass(id) {
    const wrap = document.getElementById(id);
    if (!wrap) return;

    // 罗盘固定 180px
    const compass = new WindCompass(wrap, {
      size: 180,
      direction: 45,
      speed: 2.1,
    });

    this._compass = compass;
  }

  update(data) {
    if (!data) return;

    const gaugeSet = (id, value) => {
      const entry = this._gauges.get(id);
      if (!entry) return;
      entry.gauge.setValue(value);
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
