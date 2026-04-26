/**
 * 微境智护 — 生物多样性监测面板（鸟类检测）
 * 通过 Vite 代理调用鸟检 DETR API，每 5 分钟自动刷新
 */

export class BirdPanel {
  constructor() {
    this._el = null;
    this._refreshTimer = null;
    this._init();
  }

  _init() {
    this._el = document.getElementById("bird-indicators");
    if (!this._el) return;
    this._renderLoading();
    this._fetch();
    this._startPolling();
  }

  async _fetch() {
    try {
      const res = await fetch("/api/detect", { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        this._render(data);
      } else {
        this._renderEmpty();
      }
    } catch {
      this._renderEmpty();
    }
  }

  _renderLoading() {
    if (!this._el) return;
    this._el.innerHTML = `
      <div class="health-card">
        <div style="display:flex;align-items:center;justify-content:center;height:80px;color:#5a8aaa;font-size:12px;">
          正在加载鸟类检测数据...
        </div>
      </div>`;
  }

  _renderEmpty() {
    if (!this._el) return;
    this._el.innerHTML = `
      <div class="health-card">
        <div style="display:flex;align-items:center;justify-content:center;height:80px;color:#5a8aaa;font-size:12px;">
          暂无检测数据，请上传图片
        </div>
      </div>`;
  }

  _render(data) {
    if (!this._el) return;

    const detections = data?.result?.detections ?? [];
    const species = {};
    for (const d of detections) {
      const name = d.class ?? d.label ?? "未知物种";
      species[name] = (species[name] ?? 0) + 1;
    }

    const speciesList = Object.entries(species).slice(0, 5);
    const totalBirds = detections.length;

    if (speciesList.length === 0) {
      this._renderEmpty();
      return;
    }

    this._el.innerHTML = `
      <div class="health-card">
        <div class="health-card-header">
          <span class="health-card-name hi-name">检测到鸟类</span>
          <span class="health-card-value hi-value">${totalBirds}</span>
          <span class="health-card-name hi-unit">只</span>
        </div>
        <div class="health-card-bar">
          <div class="health-card-fill" style="width:${Math.min(100, totalBirds * 5)}%;background:#00ff88;"></div>
        </div>
      </div>
      <div style="padding:6px 8px;">
        <div style="font-size:11px;color:#5a8aaa;margin-bottom:4px;">物种分布</div>
        ${speciesList.map(([name, count]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px;">
            <span style="color:#b3e0ff;">${name}</span>
            <span style="color:#00ff88;font-family:monospace;">${count}只</span>
          </div>`).join("")}
      </div>`;
  }

  _startPolling() {
    this._refreshTimer = setInterval(() => this._fetch(), 5 * 60 * 1000);
  }

  destroy() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }
}
