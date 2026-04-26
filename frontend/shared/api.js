/**
 * 微境智护 — 统一 API 客户端
 * 所有前端模块通过此文件调用后端接口
 */

const API_BASE = "";

export async function apiHealth() {
  const res = await fetch(`${API_BASE}/api/simulation/health`);
  return res.json();
}

export async function apiGetWeather() {
  const res = await fetch(`${API_BASE}/api/weather/current`);
  return res.json();
}

export async function apiCreateBuilding(info) {
  const res = await fetch(`${API_BASE}/api/simulation/buildings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(info),
  });
  return res.json();
}

export async function apiWhatIf(payload) {
  const res = await fetch(`${API_BASE}/api/simulation/what-if`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function apiGetScenario(scenarioId) {
  const res = await fetch(`${API_BASE}/api/simulation/scenarios/${scenarioId}`);
  return res.json();
}

export async function apiUndoScenario(scenarioId) {
  const res = await fetch(`${API_BASE}/api/simulation/scenarios/${scenarioId}/undo`);
  return res.json();
}

export async function apiGetStats() {
  const res = await fetch(`${API_BASE}/api/simulation/stats`);
  return res.json();
}

export async function apiListScenarios() {
  const res = await fetch(`${API_BASE}/api/simulation/scenarios`);
  return res.json();
}

export async function apiExportReport() {
  try {
    const res = await fetch(`${API_BASE}/api/simulation/export`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      if (res.status === 0 || text.includes("<!DOCTYPE") || text.includes("<html")) {
        msg = "后端服务未启动（端口 3000）";
      }
      console.error("[API] /api/simulation/export failed:", msg, text.slice(0, 200));
      return { success: false, message: msg };
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      if (text.startsWith("{") || text.startsWith("[")) {
        return JSON.parse(text);
      }
      console.error("[API] /api/simulation/export unexpected content-type:", contentType, text.slice(0, 200));
      return { success: false, message: `非 JSON 响应 (${contentType})` };
    }
    return await res.json();
  } catch (e) {
    const isNetworkError = e.name === "TypeError" && e.message.includes("fetch");
    const msg = isNetworkError ? "后端服务未启动（端口 3000）" : e.message;
    console.error("[API] /api/simulation/export exception:", e);
    return { success: false, message: msg };
  }
}

export async function apiGetTracking() {
  const res = await fetch(`${API_BASE}/api/tracking/positions`);
  return res.json();
}
