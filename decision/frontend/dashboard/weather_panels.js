/**
 * 微境智护 — 左侧气象仪表盘
 *
 * 展示 Open-Meteo 网格天气估计，不包含校园实测指标。
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
    this._addGauge("g-temp", "气温", "°C", -10, 50, 0, [
      { ratio: 0.583, color: "#ffcc00" },  // 35°C
      { ratio: 0.667, color: "#ff2200" },  // 40°C
    ]);

    // 湿度 (0 ~ 100)
    this._addGauge("g-humid", "湿度", "%", 0, 100, 0, [
      { ratio: 0.80, color: "#ffcc00" },  // 80%
      { ratio: 0.95, color: "#ff6644" },  // 95%
    ]);

    // 体感温度来自气象模型，不是地表温度。
    this._addGauge("g-apparent", "体感温度", "°C", -10, 50, 0, [
      { ratio: 0.75, color: "#ff6644" },
      { ratio: 0.833, color: "#ff2200" },
    ]);

    // 气压 (980 ~ 1040)
    this._addGauge("g-pressure", "气压", "hPa", 980, 1040, 980, [
      { ratio: 0.667, color: "#ffcc00" },  // 1020 hPa
      { ratio: 0.833, color: "#ff4444" }, // 1030 hPa
    ]);

    // 风速 (0 ~ 20)
    this._addGauge("g-windspeed", "风速", "m/s", 0, 20, 0, [
      { ratio: 0.50, color: "#ffcc00" },   // 10 m/s
      { ratio: 0.75, color: "#ff4444" },  // 15 m/s
    ]);

    // 降水 (0 ~ 20)
    this._addGauge("g-precip", "降水", "mm", 0, 20, 0, [
      { ratio: 0.25, color: "#ffcc00" },  // 5mm
      { ratio: 0.50, color: "#4488ff" },  // 10mm
    ]);

    // 辐射 (0 ~ 1200)
    this._addGauge("g-radiation", "辐射", "W/m²", 0, 1200, 0, [
      { ratio: 0.667, color: "#ffcc00" },  // 800
      { ratio: 0.833, color: "#ff6644" }, // 1000
    ]);

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
      direction: 0,
      speed: 0,
    });

    this._compass = compass;
  }

  update(data) {
    if (!data) return;

    const gaugeSet = (id, value) => {
      const entry = this._gauges.get(id);
      if (!entry || !Number.isFinite(value)) return;
      entry.gauge.setValue(value);
    };

    gaugeSet("g-temp",      data.temperature);
    gaugeSet("g-humid",     data.humidity);
    gaugeSet("g-apparent",  data.apparentTemperature);
    gaugeSet("g-pressure",  data.pressure);
    gaugeSet("g-windspeed", data.windSpeed);
    gaugeSet("g-precip",    data.precipitation);
    gaugeSet("g-radiation", data.solarRadiation);

    if (this._compass && Number.isFinite(data.windDirection)) {
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
