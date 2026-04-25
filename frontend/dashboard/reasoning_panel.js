/**
 * 微境智护 — 推理状态面板
 * 显示 What-If 推演的推理步骤、ΔT、置信度
 */

export class ReasoningPanel {
  constructor() {
    this._stepsEl  = null;
    this._resultEl = null;
    this._statusDot = null;
    this._statusLabel = null;
    this._currentScenarioId = null;

    this._init();
  }

  _init() {
    this._stepsEl    = document.getElementById("reasoning-steps");
    this._resultEl  = document.getElementById("reasoning-result");
    this._statusDot   = document.getElementById("reasoning-dot");
    this._statusLabel = document.getElementById("reasoning-label");
  }

  setStatus(state, label) {
    if (this._statusDot) {
      this._statusDot.className = `dot ${state}`;
    }
    if (this._statusLabel) {
      this._statusLabel.textContent = label;
    }
  }

  setLoading(reasoningSteps) {
    this._renderSteps(reasoningSteps, -1);
    if (this._resultEl) {
      this._resultEl.innerHTML = `
        <div class="reasoning-result-loading">
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
            <div style="width:14px;height:14px;border:2px solid rgba(0,180,255,0.2);border-top-color:#00b4ff;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
            <span style="font-size:12px;color:#b3e0ff;">AGI 推理中...</span>
          </div>
        </div>
      `;
    }
  }

  setResult(delta, confidence, reasoningSteps) {
    this._renderSteps(reasoningSteps, reasoningSteps.length);

    if (this._resultEl) {
      const isPositive = delta >= 0;
      const color = isPositive ? "#ff6644" : "#00b4ff";
      const sign  = isPositive ? "+" : "";
      const action = isPositive ? "升温" : "降温";

      this._resultEl.innerHTML = `
        <div class="result-delta">
          <span class="num ${isPositive ? "" : "neg"}" style="color:${color}">${sign}${delta.toFixed(2)}</span>
          <span class="unit">°C</span>
        </div>
        <div style="font-size:11px;color:#5a8aaa;margin-top:4px;">${action} | 置信度 <span style="color:#00ff88">${(confidence * 100).toFixed(0)}%</span></div>
      `;
    }

    this.setStatus("green", "推理完成");
  }

  clear() {
    this._renderSteps([], -1);
    if (this._resultEl) {
      this._resultEl.innerHTML = `
        <div style="font-size:12px;color:#5a8aaa;text-align:center;padding:8px 0;">
          暂无推理记录
        </div>
      `;
    }
    this.setStatus("gray", "待机中");
  }

  _renderSteps(steps, completedIndex) {
    if (!this._stepsEl) return;

    if (!steps || steps.length === 0) {
      this._stepsEl.innerHTML = `
        <div class="reasoning-step" style="padding:12px 0;">
          <span style="font-size:12px;color:#5a8aaa;">点击「ADD」或「REMOVE」开始推演</span>
        </div>
      `;
      return;
    }

    this._stepsEl.innerHTML = steps.map((text, i) => {
      const isActive = i < completedIndex;
      const isRunning = i === completedIndex;
      const cls = isActive ? "active" : isRunning ? "active running" : "";
      return `
        <div class="reasoning-step">
          <span class="step-num ${cls}">${i + 1}</span>
          <span class="step-text">${text}</span>
        </div>
      `;
    }).join("");
  }
}
