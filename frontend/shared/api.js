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
  const res = await fetch(`${API_BASE}/api/simulation/export`);
  return res.json();
}

export async function apiGetTracking() {
  const res = await fetch(`${API_BASE}/api/tracking/positions`);
  return res.json();
}
