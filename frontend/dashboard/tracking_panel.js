/**
 * 微境智护 — 目标追踪面板
 * 显示无人机和小车的实时位置、速度、航向等信息
 */

export class TrackingPanel {
  constructor() {
    this._entities = new Map();
    this._init();
  }

  _init() {
    const container = document.getElementById("tracking-entities");
    if (!container) return;

    // 创建空的追踪列表
    container.innerHTML = "";
    this._container = container;
  }

  /**
   * 更新追踪实体列表
   * @param {Array} entities - 后端返回的实体数组
   */
  update(entities) {
    if (!this._container) return;

    this._entities.clear();
    for (const e of entities) {
      this._entities.set(e.id, e);
    }

    // 清空并重新渲染
    this._container.innerHTML = "";

    if (entities.length === 0) {
      this._container.innerHTML = `
        <div class="tracking-empty">
          <span>暂未发现追踪目标</span>
        </div>
      `;
      return;
    }

    for (const entity of entities) {
      const card = this._createEntityCard(entity);
      this._container.appendChild(card);
    }
  }

  _createEntityCard(entity) {
    const isDrone = entity.type === "drone";
    const typeColor = isDrone ? "#00ff88" : "#ffcc00";
    const typeIcon = isDrone
      ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="${typeColor}" stroke-width="1.5"/><line x1="7" y1="2" x2="7" y2="12" stroke="${typeColor}" stroke-width="1.5"/><line x1="2" y1="7" x2="12" y2="7" stroke="${typeColor}" stroke-width="1.5"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><polygon points="7,1 13,12 7,9 1,12" fill="${typeColor}"/></svg>`;

    const statusClass = entity.status === "active" ? "ok" : entity.status === "idle" ? "warn" : "offline";
    const statusLabel = entity.status === "active" ? "在线" : entity.status === "idle" ? "待机" : "离线";

    const altitude = isDrone
      ? `<div class="track-stat"><span class="track-stat-label">高度</span><span class="track-stat-val">${entity.altitude?.toFixed(0) ?? 0}m</span></div>`
      : "";

    const card = document.createElement("div");
    card.className = "tracking-card";
    card.dataset.id = entity.id;

    card.innerHTML = `
      <div class="tracking-card-header">
        <div class="tracking-type-icon">${typeIcon}</div>
        <div class="tracking-name">${entity.name}</div>
        <div class="tracking-status ${statusClass}"><span class="dot ${statusClass}"></span>${statusLabel}</div>
      </div>
      <div class="tracking-card-body">
        <div class="track-stat"><span class="track-stat-label">坐标</span><span class="track-stat-val">${entity.lon.toFixed(4)}, ${entity.lat.toFixed(4)}</span></div>
        <div class="track-stat"><span class="track-stat-label">速度</span><span class="track-stat-val">${entity.speed?.toFixed(1) ?? 0} m/s</span></div>
        <div class="track-stat"><span class="track-stat-label">航向</span><span class="track-stat-val">${entity.heading?.toFixed(0) ?? 0}°</span></div>
        ${altitude}
      </div>
    `;

    return card;
  }

  destroy() {
    this._entities.clear();
    if (this._container) {
      this._container.innerHTML = "";
    }
  }
}
