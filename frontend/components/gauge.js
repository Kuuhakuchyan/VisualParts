/**
 * 微境智护 — SVG 圆形仪表盘组件
 * 270 度弧形仪表盘，颜色插值，告警阈值
 *
 * 设计规范：
 * - 半圆弧在上（开口朝下），从 -135° 到 +135°
 * - 圆心偏下 (cy = size * 0.60)，给弧线和文字留空间
 * - 数值文字紧贴弧线上方，无视觉割裂
 * - 阈值使用归一化比例值 (0.0 ~ 1.0)，与 min/max 解耦
 */

export class GaugeChart {
  /**
   * @param {string|HTMLElement} container - 容器 DOM 引用或 ID
   * @param {object} options
   *   - size:        仪表盘直径（px），默认 120
   *   - label:       标签文字
   *   - unit:        单位
   *   - min:         最小值
   *   - max:         最大值
   *   - value:       当前值
   *   - thresholds:   [{ ratio, color }] 告警阈值（归一化比例 0~1）
   *                   示例: [{ ratio: 0.7, color: "#ffcc00" }]
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
      thresholds: [],
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
    const cx = size / 2;
    // 圆心偏下，为弧线和文字留出上方空间
    const cy = size * 0.60;
    // 弧半径
    const r = size * 0.42;

    // 270 度弧：起点 -135°（左上方），终点 +135°（右上方），弧在圆心上方的开口朝下半圆
    const startAngle = -135;
    const endAngle   =  135;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.style.overflow = "visible";
    svg.style.display = "block";
    svg.style.margin = "0 auto";

    // 背景弧（完整 270°）
    const bgArc = this._describeArc(cx, cy, r, startAngle, endAngle);
    const bgPath = document.createElementNS(svgNS, "path");
    bgPath.setAttribute("d", bgArc);
    bgPath.setAttribute("fill", "none");
    bgPath.setAttribute("stroke", "rgba(0, 180, 255, 0.12)");
    bgPath.setAttribute("stroke-width", "6");
    bgPath.setAttribute("stroke-linecap", "round");
    svg.appendChild(bgPath);

    // 刻度线（5 主刻度 + 4 副刻度）
    const tickCount = 5;
    for (let i = 0; i <= tickCount; i++) {
      const angleDeg = startAngle + ((endAngle - startAngle) * i / tickCount);
      const angleRad = angleDeg * Math.PI / 180;
      const inner = r - 9;
      const outer = r - 1;
      const x1 = cx + inner * Math.cos(angleRad);
      const y1 = cy + inner * Math.sin(angleRad);
      const x2 = cx + outer * Math.cos(angleRad);
      const y2 = cy + outer * Math.sin(angleRad);
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", x1.toFixed(2));
      line.setAttribute("y1", y1.toFixed(2));
      line.setAttribute("x2", x2.toFixed(2));
      line.setAttribute("y2", y2.toFixed(2));
      line.setAttribute("stroke", "rgba(0, 180, 255, 0.25)");
      line.setAttribute("stroke-width", i === 0 || i === tickCount ? "1.5" : "0.8");
      svg.appendChild(line);
    }

    // 进度弧（初始从起点到起点，动画时更新终点）
    const arcPath = document.createElementNS(svgNS, "path");
    arcPath.setAttribute("fill", "none");
    arcPath.setAttribute("stroke-width", "6");
    arcPath.setAttribute("stroke-linecap", "round");
    arcPath.setAttribute("stroke", "#00b4ff");
    this._arcPath = arcPath;
    svg.appendChild(arcPath);

    // 数值文字：紧贴在圆心正上方（弧线正中间的上方）
    const textY = cy - size * 0.10;
    const valueText = document.createElementNS(svgNS, "text");
    valueText.setAttribute("x", cx);
    valueText.setAttribute("y", textY.toFixed(2));
    valueText.setAttribute("text-anchor", "middle");
    valueText.setAttribute("dominant-baseline", "middle");
    valueText.setAttribute("font-family", "Cascadia Code, Consolas, monospace");
    valueText.setAttribute("font-size", Math.round(size * 0.14).toString());
    valueText.setAttribute("font-weight", "700");
    valueText.setAttribute("fill", "#e0f4ff");
    const tspan = document.createElementNS(svgNS, "tspan");
    tspan.setAttribute("class", "gauge-val");
    this._valueText = tspan;
    valueText.appendChild(tspan);
    // 单位合并到 tspan 后面（dx 右偏移，紧贴数字）
    if (this._opts.unit) {
      const unitTspan = document.createElementNS(svgNS, "tspan");
      unitTspan.setAttribute("dx", "1");
      unitTspan.setAttribute("class", "gauge-unit");
      unitTspan.setAttribute("font-size", Math.round(size * 0.10).toString());
      unitTspan.setAttribute("fill", "rgba(179, 224, 255, 0.5)");
      unitTspan.textContent = this._opts.unit;
      valueText.appendChild(unitTspan);
    }
    svg.appendChild(valueText);

    // 标签文字：圆心正下方
    const labelY = cy + size * 0.22;
    const labelText = document.createElementNS(svgNS, "text");
    labelText.setAttribute("x", cx);
    labelText.setAttribute("y", labelY.toFixed(2));
    labelText.setAttribute("text-anchor", "middle");
    labelText.setAttribute("font-size", Math.round(size * 0.09).toString());
    labelText.setAttribute("fill", "rgba(90, 138, 170, 0.9)");
    labelText.textContent = this._opts.label;
    svg.appendChild(labelText);

    // 中心装饰圆环
    const centerRing = document.createElementNS(svgNS, "circle");
    centerRing.setAttribute("cx", cx);
    centerRing.setAttribute("cy", cy);
    centerRing.setAttribute("r", (r * 0.15).toFixed(2));
    centerRing.setAttribute("fill", "none");
    centerRing.setAttribute("stroke", "rgba(0, 180, 255, 0.25)");
    centerRing.setAttribute("stroke-width", "1");
    svg.appendChild(centerRing);

    this._svg = svg;
    this.container.appendChild(svg);
  }

  // 极坐标转笛卡尔（0° = 正右，顺时针）
  _polarToCartesian(cx, cy, r, angleDeg) {
    const rad = angleDeg * Math.PI / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  _describeArc(cx, cy, r, startAngle, endAngle) {
    const start = this._polarToCartesian(cx, cy, r, startAngle);
    const end   = this._polarToCartesian(cx, cy, r, endAngle);
    const diff = endAngle - startAngle;
    const largeArcFlag = diff <= 180 ? 0 : 1;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  _computeColor(ratio) {
    const { thresholds } = this._opts;
    let color = "#00b4ff";
    for (const th of thresholds) {
      if (ratio >= th.ratio) {
        color = th.color;
      }
    }
    return color;
  }

  setValue(newValue, animate = true) {
    const { min, max } = this._opts;
    const clamped = Math.max(min, Math.min(max, newValue));
    const ratio = (clamped - min) / (max - min);

    const color = this._computeColor(ratio);
    this._arcPath.setAttribute("stroke", color);
    this._valueText.setAttribute("fill", color);

    // 进度弧从 -135° 画到 (-135° + 270° * ratio)
    const startAngle = -135;
    const totalAngle = 270;
    const currentAngle = startAngle + totalAngle * ratio;
    const path = this._describeArc(
      this._opts.size / 2,
      this._opts.size * 0.60,
      this._opts.size * 0.42,
      startAngle,
      currentAngle
    );
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
