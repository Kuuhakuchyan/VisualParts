/**
 * 微境智护 — SVG 圆形仪表盘组件
 * 270 度弧形仪表盘，颜色插值，告警阈值
 */

export class GaugeChart {
  /**
   * @param {string|HTMLElement} container - 容器 DOM 引用或 ID
   * @param {object} options
   *   - size:        仪表盘直径（px）
   *   - label:       标签文字
   *   - unit:        单位
   *   - min:         最小值
   *   - max:         最大值
   *   - value:       当前值
   *   - thresholds:   [{ value, color }] 告警阈值
   *   - warnValue:   警告阈值
   *   - criticalValue: 危险阈值
   */
  constructor(container, options = {}) {
    this.container = typeof container === "string" ? document.getElementById(container) : container;
    this._opts = {
      size: 120,
      label: "",
      unit: "",
      min: 0,
      max: 100,
      value: 0,
      thresholds: [
        { value: 60, color: "#ffcc00" },
        { value: 80, color: "#ff6644" },
      ],
      warnValue: null,
      criticalValue: null,
      ...options,
    };

    this._valueEl = null;
    this._arcPath = null;
    this._animFrame = null;
    this._currentDisplay = this._opts.min;

    this._build();
    this.setValue(this._opts.value, false);
  }

  _build() {
    const size = this._opts.size;
    const r = size / 2 - 10;
    const cx = size / 2;
    const cy = size / 2;

    // 270 度弧：起点 -135°（左下），终点 +135°（右下）
    const startAngle = -225; // degrees
    const endAngle   =  45;  // degrees
    const totalAngle = endAngle - startAngle; // 270

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.style.overflow = "visible";

    // 背景弧
    const bgArc = this._describeArc(cx, cy, r, startAngle, endAngle);
    const bgPath = document.createElementNS(svgNS, "path");
    bgPath.setAttribute("d", bgArc);
    bgPath.setAttribute("fill", "none");
    bgPath.setAttribute("stroke", "rgba(0, 180, 255, 0.12)");
    bgPath.setAttribute("stroke-width", "6");
    bgPath.setAttribute("stroke-linecap", "round");
    svg.appendChild(bgPath);

    // 刻度线
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const angleRad = (startAngle + (totalAngle * i / tickCount)) * Math.PI / 180;
      const inner = r - 8;
      const outer = r - 2;
      const x1 = cx + inner * Math.cos(angleRad);
      const y1 = cy + inner * Math.sin(angleRad);
      const x2 = cx + outer * Math.cos(angleRad);
      const y2 = cy + outer * Math.sin(angleRad);
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", "rgba(0, 180, 255, 0.3)");
      line.setAttribute("stroke-width", "1.5");
      svg.appendChild(line);
    }

    // 进度弧
    const arcPath = document.createElementNS(svgNS, "path");
    arcPath.setAttribute("fill", "none");
    arcPath.setAttribute("stroke-width", "6");
    arcPath.setAttribute("stroke-linecap", "round");
    this._arcPath = arcPath;
    svg.appendChild(arcPath);

    // 中心数值
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", cx);
    text.setAttribute("y", cy + 4);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("font-family", "Cascadia Code, Consolas, monospace");
    text.setAttribute("font-size", Math.round(size * 0.16));
    text.setAttribute("font-weight", "700");
    text.setAttribute("fill", "#e0f4ff");
    const tspan = document.createElementNS(svgNS, "tspan");
    tspan.setAttribute("class", "gauge-val");
    this._valueText = tspan;
    text.appendChild(tspan);
    svg.appendChild(text);

    // 单位
    const unitText = document.createElementNS(svgNS, "text");
    unitText.setAttribute("x", cx);
    unitText.setAttribute("y", cy + Math.round(size * 0.2));
    unitText.setAttribute("text-anchor", "middle");
    unitText.setAttribute("font-size", Math.round(size * 0.1));
    unitText.setAttribute("fill", "rgba(179, 224, 255, 0.5)");
    unitText.textContent = this._opts.unit;
    svg.appendChild(unitText);

    // 标签
    const labelText = document.createElementNS(svgNS, "text");
    labelText.setAttribute("x", cx);
    labelText.setAttribute("y", size - 6);
    labelText.setAttribute("text-anchor", "middle");
    labelText.setAttribute("font-size", Math.round(size * 0.1));
    labelText.setAttribute("fill", "rgba(90, 138, 170, 0.9)");
    labelText.textContent = this._opts.label;
    svg.appendChild(labelText);

    this._svg = svg;
    this.container.appendChild(svg);
  }

  _polarToCartesian(cx, cy, r, angleDeg) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  _describeArc(cx, cy, r, startAngle, endAngle) {
    const start = this._polarToCartesian(cx, cy, r, endAngle);
    const end   = this._polarToCartesian(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  }

  _computeColor(ratio) {
    const t = this._opts.thresholds;
    let color = "#00b4ff"; // default
    for (const th of t) {
      if (ratio >= th.value / (this._opts.max - this._opts.min)) {
        color = th.color;
      }
    }
    return color;
  }

  setValue(newValue, animate = true) {
    const { min, max } = this._opts;
    const clamped = Math.max(min, Math.min(max, newValue));
    const ratio = (clamped - min) / (max - min);

    // 颜色
    const color = this._computeColor(ratio);
    this._arcPath.setAttribute("stroke", color);
    this._valueText.setAttribute("fill", color);

    // 弧长
    const startAngle = -225;
    const totalAngle = 270;
    const currentAngle = startAngle + totalAngle * ratio;
    const path = this._describeArc(this._opts.size / 2, this._opts.size / 2, this._opts.size / 2 - 10, currentAngle, startAngle);
    this._arcPath.setAttribute("d", path);

    if (animate) {
      this._animateTo(clamped);
    } else {
      this._currentDisplay = clamped;
      this._valueText.textContent = this._formatValue(clamped);
    }
  }

  _formatValue(v) {
    if (Number.isInteger(v)) return v;
    return v.toFixed(1);
  }

  _animateTo(target) {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    const start = this._currentDisplay;
    const end = target;
    const duration = 600;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);
      const current = start + (end - start) * ease;
      this._currentDisplay = current;
      this._valueText.textContent = this._formatValue(current);
      if (t < 1) {
        this._animFrame = requestAnimationFrame(step);
      } else {
        this._currentDisplay = end;
        this._valueText.textContent = this._formatValue(end);
      }
    };

    this._animFrame = requestAnimationFrame(step);
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this._svg?.parentNode) {
      this._svg.parentNode.removeChild(this._svg);
    }
  }
}
