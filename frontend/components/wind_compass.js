/**
 * 微境智护 — 风向矢量罗盘组件
 * SVG 矢量罗盘，根据风向角度旋转指针
 */

export class WindCompass {
  /**
   * @param {string|HTMLElement} container
   * @param {object} options
   *   - size: 直径（px）
   *   - direction: 风向角（0-360°，0=北）
   *   - speed: 风速
   */
  constructor(container, options = {}) {
    this.container = typeof container === "string" ? document.getElementById(container) : container;
    this._opts = {
      size: 120,
      direction: 0,
      speed: 0,
      ...options,
    };

    this._needle = null;
    this._speedText = null;
    this._dirText = null;

    this._build();
  }

  _build() {
    const size = this._opts.size;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 8;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.style.overflow = "visible";

    // 外圈
    const outerCircle = document.createElementNS(svgNS, "circle");
    outerCircle.setAttribute("cx", cx);
    outerCircle.setAttribute("cy", cy);
    outerCircle.setAttribute("r", r);
    outerCircle.setAttribute("fill", "none");
    outerCircle.setAttribute("stroke", "rgba(0, 180, 255, 0.2)");
    outerCircle.setAttribute("stroke-width", "1");
    svg.appendChild(outerCircle);

    // 方向标签
    const dirs = [
      { label: "N", angle: 0 },
      { label: "E", angle: 90 },
      { label: "S", angle: 180 },
      { label: "W", angle: 270 },
    ];
    const minorDirs = [
      { label: "NE", angle: 45 },
      { label: "SE", angle: 135 },
      { label: "SW", angle: 225 },
      { label: "NW", angle: 315 },
    ];

    for (const d of dirs) {
      const rad = (d.angle - 90) * Math.PI / 180;
      const labelR = r - 6;
      const x = cx + labelR * Math.cos(rad);
      const y = cy + labelR * Math.sin(rad);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", x);
      text.setAttribute("y", y + 4);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", Math.round(size * 0.1));
      text.setAttribute("font-weight", "700");
      text.setAttribute("fill", "rgba(0, 180, 255, 0.8)");
      text.textContent = d.label;
      svg.appendChild(text);
    }

    for (const d of minorDirs) {
      const rad = (d.angle - 90) * Math.PI / 180;
      const labelR = r - 2;
      const x = cx + labelR * Math.cos(rad);
      const y = cy + labelR * Math.sin(rad);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", x);
      text.setAttribute("y", y + 3);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", Math.round(size * 0.07));
      text.setAttribute("fill", "rgba(0, 180, 255, 0.35)");
      text.textContent = d.label;
      svg.appendChild(text);
    }

    // 刻度
    for (let i = 0; i < 36; i++) {
      const angle = i * 10;
      const rad = (angle - 90) * Math.PI / 180;
      const inner = r - (i % 9 === 0 ? 10 : 5);
      const x1 = cx + inner * Math.cos(rad);
      const y1 = cy + inner * Math.sin(rad);
      const x2 = cx + (r - 2) * Math.cos(rad);
      const y2 = cy + (r - 2) * Math.sin(rad);
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", i % 9 === 0 ? "rgba(0, 180, 255, 0.5)" : "rgba(0, 180, 255, 0.2)");
      line.setAttribute("stroke-width", i % 9 === 0 ? "1.5" : "0.8");
      svg.appendChild(line);
    }

    // 指针组（绕中心旋转）
    const group = document.createElementNS(svgNS, "g");
    group.setAttribute("transform-origin", `${cx} ${cy}`);
    group.style.transition = "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)";

    // 箭头（三角形）
    const arrowLen = r * 0.7;
    const arrowW = r * 0.15;
    const px = r * 0.15; // 尾翼
    const arrowPath = `M ${cx} ${cy - arrowLen} L ${cx - arrowW} ${cy} L ${cx} ${cy - px} L ${cx + arrowW} ${cy} Z`;
    const arrow = document.createElementNS(svgNS, "path");
    arrow.setAttribute("d", arrowPath);
    arrow.setAttribute("fill", "#00b4ff");
    arrow.setAttribute("opacity", "0.9");
    group.appendChild(arrow);

    // 尾翼
    const tailPath = `M ${cx - arrowW} ${cy} L ${cx} ${cy + arrowLen * 0.2} L ${cx + arrowW} ${cy} Z`;
    const tail = document.createElementNS(svgNS, "path");
    tail.setAttribute("d", tailPath);
    tail.setAttribute("fill", "rgba(0, 180, 255, 0.4)");
    group.appendChild(tail);

    // 中心圆
    const centerCircle = document.createElementNS(svgNS, "circle");
    centerCircle.setAttribute("cx", cx);
    centerCircle.setAttribute("cy", cy);
    centerCircle.setAttribute("r", 4);
    centerCircle.setAttribute("fill", "#00b4ff");
    centerCircle.setAttribute("opacity", "0.9");
    group.appendChild(centerCircle);

    svg.appendChild(group);
    this._needle = group;
    this._svg = svg;
    this.container.appendChild(svg);

    // 底部文字
    const speedText = document.createElement("div");
    speedText.style.cssText = `position:absolute;bottom:4px;left:0;right:0;text-align:center;font-family:monospace;font-size:${Math.round(size * 0.1)}px;color:#b3e0ff;`;
    speedText.className = "compass-speed";
    speedText.textContent = `${this._opts.speed.toFixed(1)} m/s`;
    this._speedTextEl = speedText;

    const dirText = document.createElement("div");
    dirText.style.cssText = `position:absolute;bottom:${Math.round(size * 0.14)}px;left:0;right:0;text-align:center;font-size:${Math.round(size * 0.08)}px;color:rgba(90,138,170,0.9);`;
    dirText.className = "compass-dir";
    dirText.textContent = this._getDirLabel(this._opts.direction);
    this._dirTextEl = dirText;

    this.container.style.position = "relative";
    this.container.appendChild(speedText);
    this.container.appendChild(dirText);

    this._applyRotation(this._opts.direction);
  }

  _applyRotation(degrees) {
    if (this._needle) {
      this._needle.style.transform = `rotate(${degrees}deg)`;
    }
  }

  _getDirLabel(degrees) {
    const dirs = [
      [0, "N"], [22.5, "NNE"], [45, "NE"], [67.5, "ENE"],
      [90, "E"], [112.5, "ESE"], [135, "SE"], [157.5, "SSE"],
      [180, "S"], [202.5, "SSW"], [225, "SW"], [247.5, "WSW"],
      [270, "W"], [292.5, "WNW"], [315, "NW"], [337.5, "NNW"],
    ];
    let prev = dirs[0];
    for (const d of dirs) {
      if (degrees < (d[0] + prev[0]) / 2) return prev[1];
      prev = d;
    }
    return "N";
  }

  setDirection(degrees, speed, animate = true) {
    this._opts.direction = degrees;
    this._opts.speed = speed;

    if (!animate) {
      this._needle.style.transition = "none";
    } else {
      this._needle.style.transition = "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)";
    }

    this._applyRotation(degrees);

    if (this._speedTextEl) {
      this._speedTextEl.textContent = `${speed.toFixed(1)} m/s`;
    }
    if (this._dirTextEl) {
      this._dirTextEl.textContent = this._getDirLabel(degrees);
    }

    if (!animate) {
      // force reflow then re-enable transition
      void this._needle.getBoundingClientRect();
      this._needle.style.transition = "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)";
    }
  }

  destroy() {
    if (this._svg?.parentNode) {
      this._svg.parentNode.removeChild(this._svg);
    }
  }
}
