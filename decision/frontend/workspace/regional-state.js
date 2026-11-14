export const defaultBounds = site => site === "campus"
  ? { west: 113.52291506898564, east: 113.53578555373713, south: 34.80890977340306, north: 34.82813663131253 }
  : { west: 113.60, east: 113.62, south: 34.74, north: 34.76 };
export const defaultDataMode = site => site === "campus" ? "lcz_simulation" : "live";

export function defaultRegional(site, draft) {
  const result = {
    bounds: defaultBounds(site), groups: ["students", "athletes", "workers"],
    mode: "current", data_mode: defaultDataMode(site), grid_resolution_m: 30,
    activity: "walk", exposure_minutes: 30, exposure: "unknown",
    cohort_scenarios: {
      students: { activity: 'walk', exposure_minutes: 30 },
      athletes: { activity: 'run', exposure_minutes: 60 },
      workers: { activity: 'work', exposure_minutes: 120 },
    },
    area_kind: site === "campus" ? "campus" : "neighborhood", use_ai: true,
    ...draft,
  };
  result.cohort_scenarios=Object.fromEntries(Object.entries(result.cohort_scenarios||{}).filter(([group])=>result.groups.includes(group)));
  return result;
}

export function isCurrentObservationTime(timestamp, now = Date.now()) {
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -900000 && age <= 7200000;
}

export function regionalWeatherKey(regional) {
  const { bounds, area_kind, mode, data_mode, grid_resolution_m } = regional;
  return JSON.stringify({ bounds, area_kind, mode, data_mode, grid_resolution_m });
}

export function gridCoverageText(report) {
  const c = report.coverage;
  return report.data_mode === "lcz_simulation"
    ? `${c.simulated_grid_cells} 个模拟计算网格 / ${report.resolution_m} m · ${c.unique_model_grids} 个气象边界源网格`
    : `${c.unique_model_grids} 个公开气象源网格（非微气候计算网格）`;
}

export function regionalValidity(report, now = Date.now()) {
  if(report.is_forecast)return {label:'预报情景 · '+report.valid_time,valid:false};
  if (report.data_mode === "lcz_simulation") return { label: "LCZ模拟演示 · 未标定，不用于真实医学或应急决策", valid: false };
  if (report.regional_version !== "area-cohort-1.1.0") return { label: "边界方法已更新 · 请重新研判", valid: false };
  if (report.case_type === "historical_reanalysis") return { label: "历史再分析 · 非当前指挥依据", valid: false };
  const observations = (report.samples || []).filter(s => s.observation).map(s => s.observation);
  const valid = report.coverage?.usable_samples > 0 && observations.length > 0
    && observations.every(o => isCurrentObservationTime(o.observed_at, now));
  return { label: valid ? "当前模型资料 · 非现场实测" : "记录过期或不可用 · 请重新研判", valid };
}

export const activityLabels = { rest: "静坐 / 休息", walk: "户外步行", run: "跑步 / 运动", work: "户外劳动" };
export const generationReasons = { model_not_configured: "AI 服务未配置", model_budget_limit: "AI 请求频率受限", environment_unavailable: "区域环境证据不可用", ai_disabled: "已选择规则基线", model_unavailable_or_output_rejected: "AI 超时或输出未通过校验" };
