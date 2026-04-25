/**
 * 微境智护 — 健康风险面板
 * 显示 AQI、热健康风险、能见度等健康相关指标
 */

export class HealthPanel {
  constructor() {
    this._items = new Map();
    this._init();
  }

  _init() {
    const items = [
      { id: "hi-aqi",    name: "空气质量指数",    unit: "AQI",    max: 300, warn: 100, danger: 150, invert: false },
      { id: "hi-heat",   name: "热健康风险指数", unit: "",         max: 100, warn: 60,  danger: 80,  invert: false },
      { id: "hi-vis",    name: "能见度",          unit: "km",     max: 20,  warn: 5,   danger: 2,   invert: true  },
      { id: "hi-uv",     name: "紫外线指数",      unit: "",         max: 12,  warn: 6,   danger: 8,   invert: false },
      { id: "hi-aod",    name: "气溶胶光学厚度",  unit: "AOD",    max: 1,   warn: 0.5, danger: 0.8, invert: false },
      { id: "hi-precip", name: "降水量",          unit: "mm",      max: 20,  warn: 5,   danger: 10,  invert: false },
    ];

    const container = document.getElementById("health-indicators");
    if (!container) return;

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (!el) continue;

      // Match the actual HTML class names
      const valueEl = el.querySelector(".health-card-value");
      const barFill = el.querySelector(".health-card-fill");
      const unitEl  = el.querySelector(".health-card-name:last-child"); // last <span>
      const nameEl  = el.querySelector(".health-card-name:first-child"); // first <span>

      this._items.set(item.id, {
        el, valueEl, barFill, unitEl, nameEl,
        max: item.max, warn: item.warn, danger: item.danger,
        invert: item.invert ?? false,
      });
    }
  }

  update(data) {
    if (!data) return;

    const healthSet = (id, rawValue) => {
      const item = this._items.get(id);
      if (!item) return;

      const max = item.max;
      const val = Math.max(0, Math.min(max, rawValue));
      let pct = (val / max) * 100;

      // 反转：能见度越高越安全（百分比越低）
      if (item.invert) {
        pct = Math.max(0, 100 - pct);
      }

      // 颜色逻辑
      let color = "#ffcc00"; // default warn
      if (!item.invert) {
        if (val >= item.danger) color = "#ff4444";
        else if (val >= item.warn) color = "#ffcc00";
        else color = "#00ff88";
      } else {
        if (val <= item.danger) color = "#ff4444";
        else if (val <= item.warn) color = "#ffcc00";
        else color = "#00ff88";
      }

      // 显示值
      const isDecimal = item.max <= 1;
      const displayVal = isDecimal ? val.toFixed(2) : Math.round(val);

      if (item.valueEl) item.valueEl.textContent = displayVal;
      if (item.barFill) {
        item.barFill.style.width = `${pct}%`;
        item.barFill.style.background = color;
      }
    };

    healthSet("hi-aqi",    data.aqi             ?? 0);
    healthSet("hi-heat",   data.heatHealthRisk  ?? 70);
    healthSet("hi-vis",     data.visibility      ?? 12);
    healthSet("hi-uv",      data.uvIndex         ?? 3);
    healthSet("hi-aod",    data.aod             ?? 0.35);
    healthSet("hi-precip", data.precipitation   ?? 0);
  }

  destroy() {
    this._items.clear();
  }
}
