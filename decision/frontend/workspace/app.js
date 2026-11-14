import "./style.css";
import { $ as byId, icons, icon, help, escape as e, numeric as n, date, badge, toast, download, request, empty } from "./ui.js";
import { mountContextHelp } from "./context-help.js";
import { DecisionScreen } from "./screen.js";
import { configureEdition } from "./edition.js";
import { mountRegional } from "./regional.js";
import { isCurrentObservationTime } from "./regional-state.js";
import "./design.css";
import "./interface.css";
import { organizePlanLayout, planComparisonSummary, updatePlanPreview } from './plan-layout.js';

const API = "/api/weather/aic";
const PLAN_API = "/api/weather/workspace/plans";
let panelRoot = null;
const $ = (id) => id === "view-root" && panelRoot ? panelRoot : byId(id);
const competition = configureEdition();
const closeHelp = mountContextHelp();
const views = {
  screen: ["可视化大屏", "MICROCLIMATE COMMAND", "微境探界 · 环境决策大屏", "空间、气象与研判一体化"],
  overview: ["态势总览", "ENVIRONMENTAL INTELLIGENCE", "区域环境态势", "切换区域查看天气；小时明细可展开或导出。"],
  spatial: ["空间研判", "SPATIAL WORKSPACE", "空间研判", "选择地图操作后再点击场景。拆建后重新推演，可比较现状、方案和差值。"],
  risk: ["区域人群研判", "AREA & COHORT ASSESSMENT", "区域人群研判", "选择区域和目标人群，分别设置活动与暴露时长，再开始研判。个人自查在辅助页签。"],
  plans: ["干预档案", "INTERVENTION PLANNING", "干预档案", "遮阴、绿化与冷屋面等参数档案；建筑拆建及热暴露推演请进入空间研判中的布局沙盘。"],
  evidence: ["数据与依据", "EVIDENCE & PROVENANCE", "数据与依据", "查看天气快照、质量状态、方法版本与医学知识审核记录。"],
};
const interventions = { shade: "遮阴设施", greening: "绿化干预", cool_roof: "冷屋面", building: "建筑体块" };
let savedSite;
const sitePreferenceKey = competition ? "microclimate-competition-site" : "microclimate-site";
try { savedSite = localStorage.getItem(sitePreferenceKey); } catch { /* Optional preference. */ }
const state = { site: ["zhongyuan", "campus"].includes(savedSite) ? savedSite : "campus", view: "overview", observation: null, timeline: null, status: null, summary: null, plans: [], selected: new Set(), errors: {}, loading: true, period: "forecast", draft: null };
let cleanup = () => {};
let screenInstance;
let panelCleanup = () => {};
let activePanel = null;
let generation = 0;
let refreshController;
let refreshTask;
let planToken;
let pendingDelete;
let planSaveBusy = false;
let planRevision = 0;
const planDeletes = new Set();
try {
  const tokenKey = competition ? "microclimate-competition-token" : "microclimate-workspace-token";
  planToken = localStorage.getItem(tokenKey);
  if (!/^[a-f0-9]{64}$/.test(planToken || "")) {
    planToken = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(tokenKey, planToken);
  }
} catch { planToken = null; }
const planHeaders = () => ({ "X-Workspace-Token": planToken || "", "Content-Type": "application/json" });
const fresh = () => {
  const value = state.observation;
  if (!value) return false;
  return isCurrentObservationTime(value.observed_at) && value.quality_status === "validated";
};
const isCurrentView = (value) => generation === value;
const plansActive = () => state.view === "plans" || (state.view === "screen" && activePanel === "plans");
const sourceRow = (label, value) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
function nav(open) { document.body.classList.toggle("nav-open", open); $("nav-toggle").setAttribute("aria-expanded", String(open)); $("nav-scrim").hidden = !open; }

function refresh({ initial = false } = {}) {
  if (refreshTask?.site === state.site && !refreshTask.controller.signal.aborted) return refreshTask.promise;
  refreshController?.abort();
  const controller = refreshController = new AbortController();
  const task = refreshTask = { site: state.site, controller };
  task.promise = refreshCurrent({ initial, controller }).finally(() => {
    if (refreshTask !== task) return;
    refreshTask = null;
    $("refresh-all").disabled = false;
    $("refresh-all").classList.remove("refreshing");
  });
  return task.promise;
}
async function refreshCurrent({ initial, controller }) {
  const site = state.site;
  const revision = planRevision;
  $("refresh-all").disabled = true;
  $("refresh-all").classList.add("refreshing");
  $("connection-status").textContent = "更新中";
  const results = await Promise.allSettled([
    request(`${API}/observations/current?site=${site}`, { signal: controller.signal }),
    request(`${API}/timeline?site=${site}`, { signal: controller.signal, timeoutMs: 22000 }),
    request(`${API}/status`, { signal: controller.signal, timeoutMs: 10000 }),
    planToken ? request(PLAN_API, { headers: planHeaders(), signal: controller.signal, timeoutMs: 10000 }) : Promise.reject(new Error("浏览器本地存储未启用，方案保存不可用。")),
  ]);
  if (controller.signal.aborted || site !== state.site) return;
  ["weather", "timeline", "status", "plans"].forEach((key, i) => {
    const result = results[i];
    state.errors[key] = result.status === "rejected" ? result.reason.message : null;
  });
  state.observation = results[0].status === "fulfilled" ? results[0].value.observation : null;
  state.timeline = results[1].status === "fulfilled" ? results[1].value : null;
  state.status = results[2].status === "fulfilled" ? results[2].value : null;
  if (results[3].status === "fulfilled" && !planSaveBusy && revision === planRevision) {
    state.plans = results[3].value.plans;
    state.selected = new Set([...state.selected].filter((id) => state.plans.some((plan) => plan.id === id)));
  }
  state.loading = false;
  state.summary = null;
  state.errors.summary = null;
  if (state.observation) {
    try {
      const summary = await request(`${API}/assess`, { json: { observation_id: state.observation.id, exposure: "unknown" }, signal: controller.signal, timeoutMs: 10000 });
      if (!controller.signal.aborted && site === state.site) state.summary = summary;
    } catch { if (!controller.signal.aborted && site === state.site) state.errors.summary = "风险参考暂不可用，可进入热风险评估重试。"; }
  }
  if (controller.signal.aborted) return;
  updateStatus();
  if (state.view === "screen" && screenInstance) screenInstance.update();
  else if (["overview", "evidence"].includes(state.view)) render();
  else if (state.view === "spatial") window.dispatchEvent(new CustomEvent("workspace:weather", { detail: { observation: state.observation, plans: state.plans } }));
  if (plansActive() && !planSaveBusy) { renderPlanList(); renderComparison(); $("plan-count").textContent = state.plans.length; }
  if (state.view === "screen" && activePanel === "evidence") {
    const root = $("screen-panel-content"), scroll = root.scrollTop, query = $("source-search")?.value || "";
    mountScreenPanel("evidence");
    $("source-search").value = query; $("source-search").dispatchEvent(new Event("input")); root.scrollTop = scroll;
  }
  if (!initial && (state.view === "risk" || state.view === "screen" && activePanel === "risk")) $("risk-frame")?.contentWindow?.postMessage({ type: "workspace-refresh", site: state.site }, location.origin);
}

function updateStatus() {
  const ok = fresh();
  $("connection-status").textContent = ok ? "数据已更新" : "数据待核查";
  $("connection-status").classList.toggle("ok", ok);
  const problems = [state.errors.weather, state.errors.timeline, state.errors.status].filter(Boolean);
  if (state.observation && !ok) problems.unshift("当前天气记录已失效或时间异常，不能作为当前环境风险依据。");
  $("data-alert").hidden = !problems.length;
  $("data-alert").textContent = problems.length ? problems.join(" ") : "";
}

function render() {
  closeHelp();
  if ($("delete-dialog").open) $("delete-dialog").close("cancel");
  pendingDelete = null;
  panelCleanup(); panelCleanup = () => {}; activePanel = null;
  cleanup(); cleanup = () => {};
  screenInstance = null;
  const version = ++generation;
  const meta = views[state.view];
  $("breadcrumb-title").textContent = meta[0]; $("page-eyebrow").textContent = meta[1]; $("page-title").textContent = meta[2]; $("page-help").innerHTML = help(meta[3], meta[0] + "帮助");
  document.title = `${meta[0]} · 微境探界`;
  document.body.classList.toggle("screen-mode", state.view === "screen");
  document.body.dataset.workspaceView=state.view;
  document.querySelectorAll("[data-view]").forEach((a) => { const active = a.dataset.view === state.view; a.classList.toggle("active", active); if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("page-actions").innerHTML = state.view === "risk" ? '' : `<button class="button" id="export-workspace">${icon("download")}导出${state.view === "plans" ? "对比" : "记录"}</button>${state.view === "plans" ? `<button class="button primary" id="new-plan">${icon("plus")}新建方案</button>` : ''}`;
  $("view-root").setAttribute("aria-busy", String(state.loading));
  if (state.view === "screen") {
    const screen = screenInstance = new DecisionScreen({ state, competition, refresh, fresh, onSite: (site) => { $("site-select").value = site; $("site-select").dispatchEvent(new Event("change")); }, onPanel: mountScreenPanel, onDraft: (point) => { state.draft = { ...state.draft, ...point }; } });
    screen.mount();
    cleanup = () => screen.destroy();
  }
  if (state.view === "overview") renderOverview(version);
  if (state.view === "spatial") renderSpatial(version);
  if (state.view === "risk") renderRisk();
  if (state.view === "plans") renderPlans();
  if (state.view === "evidence") renderEvidence();
  $("new-plan")?.addEventListener("click",()=>{const editor=$("plan-form")?.closest('details');if(editor){editor.open=true;editor.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});$("plan-form").elements.name.focus({preventScroll:true});}});
  $("export-workspace")?.addEventListener("click", () => {
    if (state.view === "plans") {
      const records = state.plans.filter((p) => state.selected.has(p.id));
      if (!records.length) { toast("请先勾选需要对比与导出的方案。"); return; }
      download({ purpose: "几何方案对比，不是温降或医学效果预测", exported_at: new Date().toISOString(), plans: records }, "microclimate-plan-comparison.json");
    } else download({ exported_at: new Date().toISOString(), observation: state.observation, timeline: state.timeline, environment_reference: state.summary?.environment || null, methods: state.status, errors: state.errors }, "microclimate-workspace-evidence.json");
  });
  icons();
}

function mountScreenPanel(kind) {
  panelCleanup(); panelCleanup = () => {};
  activePanel = kind;
  if (!kind) return;
  const root = $("screen-panel-content");
  const savedCleanup = cleanup;
  try {
    panelRoot = root;
    if (kind === "plans") renderPlans();
    if (kind === "risk") renderRisk();
    if (kind === "evidence") renderEvidence();
    if (cleanup !== savedCleanup) panelCleanup = cleanup;
  } finally { panelRoot = null; cleanup = savedCleanup; }
}

function metric(name, value, unit, foot, symbol, className = "", contextual = false) { return `<article class="metric ${className}"><div class="metric-label">${icon(symbol)}${e(name)}${contextual ? help(foot, name + "说明") : ""}</div><div class="metric-value">${e(value)}<span>${e(unit)}</span></div>${contextual ? "" : `<p>${e(foot)}</p>`}</article>`; }
function renderOverview(version) {
  const o = state.observation, x = o?.extras || {};
  const valid = fresh();
  const points = state.timeline?.points.filter((p) => p.period === "forecast" && p.temperature_2m != null) || [];
  const temperatures = points.map((p) => p.temperature_2m);
  const max = temperatures.length ? Math.max(...temperatures) : null;
  const peak = points.find((p) => p.temperature_2m === max);
  $("view-root").innerHTML = `<div class="context-line"><span>${icon("map-pin")}${e(o?.location_label || (state.site === "campus" ? "校园周边网格" : "中原区附近网格"))}</span><span>${icon("clock-3")}${o ? `${date(o.observed_at)} 北京时间` : "等待有效天气记录"}</span>${badge(o ? (valid ? "网格估计 · 非现场实测" : "记录时间待核查") : "天气暂缺", valid ? "green" : "amber")}</div>
    <div class="metrics-grid">${metric("当前气温", n(o?.temperature_c), "°C", "2米高度模型估计", "thermometer", "temperature", true)}${metric("相对湿度", n(o?.relative_humidity_pct, 0), "%", "与气温采用同一网格和时刻", "droplets", "", true)}${metric("近地风速", n(x.wind_speed_10m), "m/s", `10米风 · ${x.wind_direction_10m == null ? "风向暂缺" : n(x.wind_direction_10m, 0) + "°"}`, "wind")}${metric("当前降水", n(x.precipitation), "mm", "上游当前时间区间降水量", "cloud-rain", "", true)}</div>
    <div class="overview-grid"><section class="trend-section"><div class="section-header"><div><p class="eyebrow">HOURLY OUTLOOK</p><h2>天气变化</h2></div><div class="segments" role="group" aria-label="时间范围"><button data-period="past_model" aria-pressed="${state.period === "past_model"}">过去24小时</button><button data-period="forecast" aria-pressed="${state.period === "forecast"}">未来24小时</button></div></div><div class="chart-legend"><span class="legend-temp">气温 °C</span><span class="legend-humidity">相对湿度 %</span><small id="chart-kind">${state.period === "forecast" ? "模型预报" : "过去小时模型资料 · 非仪器观测"}</small></div><div id="weather-chart" class="weather-chart" role="img" aria-label="小时气温与相对湿度趋势"></div><div class="trend-summary"><span>${peak ? `未来24小时最高气温 ${n(max)}°C，预计 ${date(peak.time, true)}` : "暂无可用预报"}</span><button class="text-button" id="toggle-series">查看小时明细 ${icon("chevron-right")}</button></div><div id="series-table" hidden></div></section>
    <section class="assessment-summary"><div class="section-header"><div><p class="eyebrow">RISK REFERENCE</p><h2>环境风险参考</h2></div>${icon("shield-check")}</div><div class="reference-value">${state.summary?.environment.heat_index_c == null ? "—" : n(state.summary.environment.heat_index_c)}<span>°C 热指数</span></div><h3>${e(state.summary?.environment.risk_label || (state.loading ? "等待天气记录" : "暂无有效评估"))}</h3><p>${e(state.summary?.environment.limitations[0] || "风险参考需要有效天气记录。天气缺失时，危险症状仍可独立触发升级。")}</p><a href="#risk" class="button primary">${icon("shield-check")}进入区域人群研判 ${icon("arrow-right")}</a><div class="reference-note">医学条款${state.status?.approved_clauses ? "部分已审核" : "待专业审核"}</div></section></div>
    <div class="workflow-grid"><a class="spatial-preview" href="#spatial"><img src="${import.meta.env.BASE_URL}${competition ? "aic/assets/campus-preview.png" : "campus-imagery-20260111.webp"}" alt="${competition ? "某校园建筑轮廓匿名预览，OSM资料衍生示意，非卫星影像" : "校园空间底图预览"}" loading="lazy"><div><p class="eyebrow">SPATIAL ANALYSIS</p><h2>空间研判</h2><span>进入空间研判 ${icon("arrow-up-right")}</span></div></a><section class="work-queue"><div class="section-header"><h2>工作链路</h2><span class="eyebrow">DATA → DECISION</span></div><a href="#evidence"><span class="step-number">01</span><div><strong>确认数据来源</strong><small>${o ? `当前记录 ${o.id.slice(0, 16)}…` : "等待上游天气"}</small></div>${badge(o ? "可核查" : "待接入", o ? "green" : "amber")}</a><a href="#risk"><span class="step-number">02</span><div><strong>区域与人群研判</strong></div>${icon("chevron-right")}</a><a href="#plans"><span class="step-number">03</span><div><strong>建立与对比方案</strong><small>${state.plans.length} 个当前浏览器方案 · 几何层面比较</small></div>${icon("chevron-right")}</a></section></div>`;
  document.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", () => { if(state.period===b.dataset.period)return;state.period = b.dataset.period; render(); }));
  $("toggle-series").addEventListener("click", () => { $("series-table").hidden = !$("series-table").hidden; });
  renderSeriesTable();
  mountChart(version);
}

function renderSeriesTable() {
  const points = state.timeline?.points.filter((p) => p.period === state.period) || [];
  $("series-table").innerHTML = points.length ? `<div class="table-scroll"><table><caption class="sr-only">小时天气明细（北京时间），${state.period === "forecast" ? "预报" : "模型资料"}</caption><thead><tr><th>北京时间</th><th>气温 °C</th><th>湿度 %</th><th>风速 m/s</th><th>降水 mm</th></tr></thead><tbody>${points.map((p) => `<tr><td>${date(p.time, true)}</td><td>${n(p.temperature_2m)}</td><td>${n(p.relative_humidity_2m, 0)}</td><td>${n(p.wind_speed_10m)}</td><td>${n(p.precipitation)}</td></tr>`).join("")}</tbody></table></div>` : empty("暂无小时资料", "上游资料恢复后可刷新重试。");
}

async function mountChart(version) {
  const target = $("weather-chart");
  const points = state.timeline?.points.filter((p) => p.period === state.period) || [];
  if (!points.length) { target.innerHTML = empty(state.loading ? "正在获取小时天气" : "趋势资料暂不可用", "请刷新后重试。", "activity"); icons(); return; }
  const { init } = await import("echarts/core");
  const { use } = await import("echarts/core");
  const { LineChart } = await import("echarts/charts");
  const { GridComponent, TooltipComponent } = await import("echarts/components");
  const { CanvasRenderer } = await import("echarts/renderers");
  if (!isCurrentView(version)) return;
  use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
  const chart = init(target);
  chart.setOption({ animation: !matchMedia("(prefers-reduced-motion: reduce)").matches, animationDuration: 350, grid: { left: 40, right: 42, top: 20, bottom: 35 }, tooltip: { trigger: "axis", confine: true, valueFormatter: (v) => v == null ? "缺测" : v },
    xAxis: { type: "category", boundaryGap: false, data: points.map((p) => date(p.time, true)), axisLabel: { color: "#79827d", fontSize: 10, formatter: (v) => v.split(" ").pop() }, axisLine: { lineStyle: { color: "#dce1dd" } }, axisTick: { show: false } },
    yAxis: [{ type: "value", scale: true, axisLabel: { color: "#79827d", fontSize: 11 }, splitLine: { lineStyle: { color: "#edf0ed", type: "dashed" } } }, { type: "value", min: 0, max: 100, axisLabel: { color: "#79827d", fontSize: 11 }, splitLine: { show: false } }],
    series: [{ name: "气温 °C", type: "line", data: points.map((p) => p.temperature_2m), showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2.5, color: "#087e96" }, itemStyle: { color: "#087e96" }, areaStyle: { color: "rgba(8,126,150,0.06)" } }, { name: "相对湿度 %", type: "line", yAxisIndex: 1, showSymbol: false, connectNulls: false, lineStyle: { type: "dashed", width: 1.8, color: "#7396ad" }, itemStyle: { color: "#7396ad" }, data: points.map((p) => p.relative_humidity_2m) }],
  });
  let resizeFrame;
  const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(isCurrentView(version))chart.resize();}); }); observer.observe(target);
  cleanup = () => { observer.disconnect();cancelAnimationFrame(resizeFrame);chart.dispose(); };
}

function renderRisk() {
  cleanup = mountRegional($("view-root"), { state, onResult: () => screenInstance?.updateRegional(), onSelect: state.view === "screen" ? () => screenInstance.selectRegion() : null });
}

async function renderSpatial(version) {
  $("view-root").innerHTML = `<div class="spatial-workspace"><div class="map-stage"><div id="workspace-map" aria-label="校园空间研判地图"></div><div class="map-state" id="map-state" role="status">正在加载校园底图…</div><div class="map-toolbar"><button class="icon-button" id="map-home" title="回到校园" aria-label="回到校园">${icon("focus")}</button><button class="icon-button" id="map-grid" title="定位当前天气网格" aria-label="定位当前天气网格">${icon("crosshair")}</button><button class="icon-button" id="map-pitch" title="切换平面与倾斜视角" aria-label="切换平面与倾斜视角" aria-pressed="true">${icon("box")}</button></div><div class="map-coordinate" id="map-coordinate">113.529°E / 34.819°N</div></div><aside class="map-inspector"><div class="section-header"><h2>图层与选点</h2>${help("勾选图层控制显示；在标记地点模式下点击地图可登记位置。", "图层与选点帮助")}</div><div class="layer-options"><label><input type="checkbox" id="layer-buildings" checked><span>校园建筑白模<small>高度含模拟值</small></span></label><label><input type="checkbox" id="layer-grid" checked><span>区域天气网格<small>公开模型资料</small></span></label><label><input type="checkbox" id="layer-plans" checked><span>已保存干预方案<small>当前浏览器工作区</small></span></label></div><div class="inspector-section"><p class="eyebrow">SELECTED LOCATION</p><h3>研判位置</h3><p id="picked-location">尚未选点</p><p class="muted" id="picked-description">选择地图位置后可登记干预方案。</p><button class="button primary" id="use-location" disabled>${icon("plus")}以此位置建立方案</button></div><div class="inspector-section"><h3>区域天气</h3><div id="map-weather"></div></div><div class="inspector-section map-method"><div class="heading-with-help"><h3>空间资料</h3>${help("缺失建筑高度按18米场景参数补足。LCZ热图为气象边界驱动的模拟，未经现场标定，不是实测空间温差。", "空间资料说明")}</div><p>LCZ模拟 · 未标定</p><a href="#evidence" class="text-button">核查数据与方法 ${icon("arrow-up-right")}</a></div></aside></div>`;
  document.querySelector(".map-toolbar").insertAdjacentHTML("beforeend", `<button class="icon-button" id="map-imagery" title="卫星影像底图" aria-label="卫星影像底图" aria-pressed="true">${icon("image")}</button><button class="icon-button" id="map-streets" title="街道底图" aria-label="街道底图" aria-pressed="false">${icon("map")}</button><button class="icon-button" id="map-orbit" title="开启或暂停环绕" aria-label="开启或暂停环绕" aria-pressed="false">${icon("play")}</button>`);
  icons();
  try {
    const { SpatialWorkspace } = await import("./map.js");
    if (!isCurrentView(version)) return;
    const map = new SpatialWorkspace({ observation: state.observation, plans: state.plans, sandboxState: state, onChoose: (point) => { state.draft = { ...state.draft, ...point }; location.hash = "plans"; } });
    cleanup = () => map.destroy();
    await map.init();
    if (isCurrentView(version)) { map.observation = state.observation; map.plans = state.plans; map.updateWeather(); }
  } catch (error) { if (isCurrentView(version)) { $("map-state").textContent = "地图未就绪，请检查网络后刷新。"; toast(error.message); } }
}

function renderPlans() {
  const draft = state.draft;
  $("view-root").innerHTML = `<div class="plan-layout"><section class="plan-editor"><div class="section-header"><h2>新建干预方案</h2>${help("方案按当前浏览器凭证保存到服务端；清除浏览器存储会丢失访问凭证，请及时导出。不保存症状或身份信息。", "方案保存说明")}</div><form id="plan-form"><label class="field">方案名称<input name="name" maxlength="50" placeholder="如：步行通道遮阴试点" required></label><label class="field">干预类型<select name="intervention"><option value="shade">遮阴设施</option><option value="greening">绿化干预</option><option value="cool_roof">冷屋面</option><option value="building">建筑体块</option></select></label><div class="field-row"><label class="field">经度 °E<input name="longitude" type="number" step="0.000001" min="113.4" max="113.9" value="${draft?.longitude ?? (state.site === "campus" ? 113.531 : 113.61)}" required></label><label class="field">纬度 °N<input name="latitude" type="number" step="0.000001" min="34.6" max="34.95" value="${draft?.latitude ?? (state.site === "campus" ? 34.814 : 34.75)}" required></label></div><a class="text-button" href="#spatial">${icon("map-pin")}在地图上选择位置</a><label class="field">干预面积 m²<input name="area_m2" type="number" min="1" max="10000" step="0.1" value="100" required></label><div id="geometry-fields"><div class="field-row"><label class="field">高度 m<input name="height_m" type="number" min="1" max="100" step="0.1" value="3" required></label><div class="field"><div class="label-with-help"><label for="plan-solar-angle">太阳高度角（假设）°</label>${help("太阳高度角由此处输入，不是自动计算的现场太阳位置。", "太阳角度说明")}</div><input id="plan-solar-angle" name="solar_altitude_deg" type="number" min="5" max="85" step="0.1" value="45" required></div></div></div><div id="albedo-fields" hidden><div class="field-row"><label class="field">原反照率<input name="baseline_albedo" type="number" min="0" max="1" step="0.01" value="0.2"></label><label class="field">拟用反照率<input name="proposed_albedo" type="number" min="0" max="1" step="0.01" value="0.6"></label></div></div><p class="inline-error" id="plan-error" role="alert" hidden></p><button class="button primary full" type="submit" id="save-plan" ${!planToken ? "disabled" : ""}>${icon("plus")}保存并加入对比</button></form></section><div class="plan-content"><div class="section-header"><div><div class="heading-with-help"><h2>方案档案 <span id="plan-count">${state.plans.length}</span></h2>${help("勾选最多3个方案进行并列比较。", "方案比较帮助")}</div></div><label class="search-field">${icon("search")}<input id="plan-search" type="search" placeholder="搜索方案" aria-label="搜索方案"></label></div><div id="plan-list"></div><section class="comparison-section"><div class="section-header"><h2>并列比较</h2><button class="button" id="print-comparison">${icon("printer")}打印</button></div><div id="comparison"></div></section></div></div><div class="method-band">${icon("triangle-alert")}<div><strong>几何比较 · 实际温降未验证</strong>${help("不对不同类型干预作综合排名；实际温降、通风和人体热暴露效果需要现场基准、标定模型及独立验证。", "比较适用范围")}</div></div>`;
  organizePlanLayout($("view-root"),{base:import.meta.env.BASE_URL,open:!!draft});
  if (draft) for (const [key, value] of Object.entries(draft)) { const field = $("plan-form").elements.namedItem(key); if (field) field.value = value; }
  const captureDraft = () => { state.draft = { ...state.draft, ...Object.fromEntries(new FormData($("plan-form"))) }; };
  $("plan-form").addEventListener("input", captureDraft);
  const updateFields = () => {
    const type = $("plan-form").elements.intervention.value;
    $("geometry-fields").hidden = !["shade", "building"].includes(type);
    $("albedo-fields").hidden = type !== "cool_roof";
    for (const id of ["geometry-fields", "albedo-fields"]) $(id).querySelectorAll("input").forEach((input) => { input.disabled = $(id).hidden; });
  };
  updateFields();
  $("save-plan").disabled = !planToken || planSaveBusy;
  renderPlanList(); renderComparison();
  $("plan-search").addEventListener("input", renderPlanList);
  $("plan-form").elements.intervention.addEventListener("change", () => { updateFields(); captureDraft(); });
  $("print-comparison").addEventListener("click", () => { if (!state.selected.size) { toast("请先选择需要比较的方案。"); return; } document.body.classList.add("printing-plans"); window.print(); document.body.classList.remove("printing-plans"); });
  $("plan-form").addEventListener("submit", async (event) => {
    event.preventDefault(); if (planSaveBusy) return;
    const form = event.currentTarget;
    const errorNode = $("plan-error");
    const saveButton = $("save-plan");
    const input = Object.fromEntries(new FormData(form));
    captureDraft();
    for (const key of Object.keys(input)) if (!["name", "intervention"].includes(key)) input[key] = Number(input[key]);
    $("plan-error").hidden = true; $("save-plan").disabled = true; planSaveBusy = true;
    try {
      const record = await request(PLAN_API, { headers: planHeaders(), json: input });
      planRevision++;
      state.plans.unshift(record); if (state.selected.size < 3) state.selected.add(record.id);
      if (plansActive()) { renderPlanList(); renderComparison(); $("plan-count").textContent = state.plans.length; screenInstance?.update(); }
      toast("方案已保存，可对比参数与几何指标。");
    } catch (error) { if (errorNode.isConnected) { errorNode.textContent = error.message; errorNode.hidden = false; } else toast(error.message); }
    finally { planSaveBusy = false; if (saveButton.isConnected) saveButton.disabled = !planToken; if ($("save-plan")) $("save-plan").disabled = !planToken; }
  });
}

function renderPlanList() {
  const search = $("plan-search")?.value.trim().toLowerCase() || "";
  const records = state.plans.filter((p) => `${p.input.name} ${interventions[p.input.intervention]}`.toLowerCase().includes(search));
  $("plan-list").innerHTML = records.length ? records.map((p) => `<article class="plan-row"><label class="plan-check"><input type="checkbox" data-select-plan="${p.id}" ${state.selected.has(p.id) ? "checked" : ""} aria-label="对比 ${e(p.input.name)}"><span><strong>${e(p.input.name)}</strong><small>${e(interventions[p.input.intervention])} · ${n(p.input.area_m2)} m² · ${date(p.created_at, true)}</small></span></label><div class="plan-row-actions"><button class="icon-button" data-export-plan="${p.id}" title="导出方案" aria-label="导出 ${e(p.input.name)}">${icon("download")}</button><button class="icon-button" data-delete-plan="${p.id}" title="删除方案" aria-label="删除 ${e(p.input.name)}">${icon("trash-2")}</button></div></article>`).join("") : empty(state.errors.plans ? "方案服务暂不可用" : (search ? "未找到匹配方案" : "尚无保存方案"), state.errors.plans || "先确定一个干预位置，再填写参数建立方案。", "git-compare-arrows");
  $("plan-list").querySelectorAll("[data-select-plan]").forEach((el) => el.addEventListener("change", () => { if (el.checked && state.selected.size >= 3) { el.checked = false; toast("每次最多比较3个方案。"); return; } if (el.checked) state.selected.add(el.dataset.selectPlan); else state.selected.delete(el.dataset.selectPlan); renderComparison(); }));
  $("plan-list").querySelectorAll("[data-export-plan]").forEach((el) => el.addEventListener("click", () => download(state.plans.find((p) => p.id === el.dataset.exportPlan), `plan-${el.dataset.exportPlan}.json`)));
  $("plan-list").querySelectorAll("[data-delete-plan]").forEach((el) => { el.disabled=planDeletes.has(el.dataset.deletePlan); el.addEventListener("click", () => { const dialog=$("delete-dialog");if(dialog.open||planDeletes.has(el.dataset.deletePlan))return;pendingDelete=el.dataset.deletePlan;dialog.returnValue="cancel";dialog.showModal(); }); }); icons();
}

function renderComparison() {
  const records = state.plans.filter((p) => state.selected.has(p.id));
  updatePlanPreview($("view-root"),records);
  if (!records.length) { $("comparison").innerHTML = empty("等待选择方案", "从档案中勾选方案，即可核对位置、假设与几何结果。", "git-compare-arrows"); return; }
  const rows = [["干预类型", (p) => interventions[p.input.intervention]], ["位置 °E / °N", (p) => `${n(p.input.longitude, 5)} / ${n(p.input.latitude, 5)}`], ["干预面积 m²", (p) => n(p.result.metrics.intervention_area_m2)], ["高度假设 m", (p) => ["shade", "building"].includes(p.input.intervention) ? n(p.input.height_m) : "不适用"], ["太阳高度角假设 °", (p) => ["shade", "building"].includes(p.input.intervention) ? n(p.input.solar_altitude_deg) : "不适用"], ["理想影长 m", (p) => n(p.result.metrics.ideal_shadow_length_m, 2)], ["新增体积 m³", (p) => n(p.result.metrics.added_volume_m3)], ["反照率变化 百分点", (p) => n(p.result.metrics.reflectance_change_pp)], ["实际温降 °C", () => "未验证"], ["模型版本", (p) => p.result.method_version]];
  $("comparison").innerHTML = `<div class="table-scroll"><table class="comparison-table"><caption class="sr-only">方案几何指标对比</caption><thead><tr><th>指标 / 假设</th>${records.map((p) => `<th>${e(p.input.name)}</th>`).join("")}</tr></thead><tbody>${rows.map(([name, value]) => `<tr><th scope="row">${e(name)}</th>${records.map((p) => `<td>${e(value(p))}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="context-help-row">几何指标说明${help("“—”表示该干预类型不计算此指标。理想影长不等于实际遮阴面积；比较不构成效果排名。", "几何指标说明")}</div><details class="audit-details"><summary>计算依据与记录摘要</summary>${records.map((p) => `<div class="audit-plan"><h3>${e(p.input.name)}</h3><p>输入摘要 ${e(p.result.input_sha256)}</p><p>记录摘要 ${e(p.record_sha256)}</p><ul>${p.result.assumptions.map((a) => `<li>${e(a)}</li>`).join("")}</ul></div>`).join("")}</details>`;
  $("comparison").insertAdjacentHTML('afterbegin',planComparisonSummary(records));
}

function renderEvidence() {
  const o = state.observation, status = state.status;
  const valid = fresh();
  $("view-root").innerHTML = `<div class="evidence-summary">${metric("气象来源", o ? "已存档" : "待连接", "", o?.source_name || "暂无有效观测", "database")}${metric("来源快照", status ? `${status.sources.filter((s) => s.snapshot?.quotes_verified).length} / ${status.sources.length}` : "—", "", "公开资料原文节选核验", "file-check-2")}${metric("医学条款", status ? `${status.approved_clauses} / ${status.draft_clauses}` : "—", "", "已审核 / 草案条数", "shield-check")}${metric("模型配置", status ? (status.model_configured ? "已配置" : "未配置") : "未知", "", "医学调用仍受审核门禁控制", "cpu")}</div><div class="evidence-grid"><section><div class="section-header"><h2>当前数据台账</h2>${badge(o ? (valid ? "字段已校验" : "时间待核查") : "无可用记录", valid ? "green" : "amber")}</div>${o ? `<dl class="data-dl">${sourceRow("来源类型", o.source_name)}${sourceRow("原始记录编号", o.original_record_id)}${sourceRow("北京时间", date(o.observed_at))}${sourceRow("请求位置", `${o.requested_location.latitude}°N / ${o.requested_location.longitude}°E`)}${sourceRow("实际网格", `${o.location.latitude}°N / ${o.location.longitude}°E`)}${sourceRow("温湿度 / 单位", `${o.temperature_c}°C / ${o.relative_humidity_pct}%`)}${sourceRow("质量说明", o.quality_note)}${sourceRow("观测编号", o.id)}${sourceRow("原始响应 SHA-256", o.raw_sha256)}</dl><div class="inline-actions"><button class="button" id="download-raw">${icon("download")}下载原始快照</button><a class="button" href="${e(o.source_url)}" target="_blank" rel="noopener">${icon("external-link")}查看上游</a></div>` : empty("暂无有效天气", "请刷新或稍后重试。上游故障不会用模拟值替换。")}</section><section class="readiness"><div class="section-header"><h2>能力与审核状态</h2>${icon("activity")}</div>${readiness("区域网格天气", valid ? "有效记录已接入" : "等待有效记录", valid)}${readiness("小时趋势与预报", state.timeline ? "真实模型序列已存档" : "资料暂不可用", !!state.timeline)}${readiness("现场采集", "尚未提供本轮有效采集台账", false)}${readiness("医学条款与规则", status?.protocol_reviewed && status.approved_clauses ? "规则与部分条款已审核" : "待执业医师审核", !!(status?.protocol_reviewed && status.approved_clauses))}${readiness("历史微气候残差", "未验证 · 不用于空间温度预测", false)}<div class="method-note"><h3>方法版本</h3><p>环境指标：${e(status?.rules_version || "未知")}<br>知识库：${e(status?.knowledge_version || "未知")}<br>检索：结构过滤与关键词排序<br>方案：geometry-screening-1.0</p><p>不将模型连通性、软件测试或专业审阅表述为临床有效性验证。</p></div></section></div><section class="source-library"><div class="section-header"><div><p class="eyebrow">SOURCE LIBRARY</p><h2>方法与公开依据</h2></div><label class="search-field">${icon("search")}<input id="source-search" type="search" placeholder="筛选来源" aria-label="筛选来源"></label></div><div id="source-list"></div></section>`;
  $("download-raw")?.addEventListener("click", async event => { const button=event.currentTarget;if(button.disabled)return;button.disabled=true;try { download(await request(`${API}/observations/${o.id}`), `${o.id}.json`); } catch (error) { if(button.isConnected)toast(error.message); }finally{if(button.isConnected)button.disabled=false;} });
  const filter = () => { const query = $("source-search").value.toLowerCase(); const sources = status?.sources.filter((s) => `${s.title} ${s.publisher} ${s.id}`.toLowerCase().includes(query)) || []; $("source-list").innerHTML = sources.length ? sources.map((s) => `<article class="source-row"><span class="source-code">${e(s.id)}</span><div><h3><a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.title)} ${icon("arrow-up-right")}</a></h3><p>${e(s.publisher)} · ${e(s.version_date || "按抓取快照固定版本")}</p><small>抓取：${date(s.snapshot?.fetched_at)} · ${s.snapshot?.quotes_verified ? "原文节选已核验" : "原文待核验"}</small></div>${badge(s.kind === "medical" ? "医学来源 · 条款另审" : "环境方法", s.kind === "medical" ? "amber" : "neutral")}</article>`).join("") : empty("暂无匹配来源", "调整关键词或刷新知识库状态。"); icons(); }; $("source-search").addEventListener("input", filter); filter();
}
function readiness(title, content, ready) { return `<div class="readiness-row"><span class="readiness-icon ${ready ? "ready" : ""}">${icon(ready ? "check" : "clock-3")}</span><div><strong>${e(title)}</strong><p>${e(content)}</p></div></div>`; }

async function deletePlan(id) {
  if (!id || planDeletes.has(id)) return;
  planDeletes.add(id); planRevision++;
  if (plansActive()) renderPlanList();
  try { await request(`${PLAN_API}/${id}`, { method: "DELETE", headers: planHeaders() }); planRevision++; state.plans = state.plans.filter((p) => p.id !== id); state.selected.delete(id); if (plansActive()) { renderPlanList(); renderComparison(); $("plan-count").textContent = state.plans.length; } screenInstance?.update(); toast("方案已删除。"); }
  catch (error) { toast(error.message); }
  finally { planDeletes.delete(id); if (plansActive()) renderPlanList(); }
}
$("delete-dialog").querySelector("form").addEventListener("submit", event => {
  event.preventDefault();
  const id=pendingDelete;pendingDelete=null;
  const confirmed=event.submitter?.value==="confirm";
  $("delete-dialog").close(confirmed?"confirm":"cancel");
  if(confirmed)void deletePlan(id);
});
$("delete-dialog").addEventListener("close", () => { if(!$("delete-dialog").open)pendingDelete=null; });
function route() { const next = location.hash.slice(1), view = Object.hasOwn(views, next) ? next : "screen"; if(view===state.view&&generation)return;state.view=view;nav(false);render(); }
$("nav-toggle").addEventListener("click", () => nav(!document.body.classList.contains("nav-open")));
$("nav-scrim").addEventListener("click", () => nav(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") nav(false); });
$("site-select").value = state.site;
$("site-select").addEventListener("change", () => {
  const site=$("site-select").value;if(state.site===site)return;
  state.siteDrafts??={};
  const keys=['regionalDraft','regionalReport','sandboxScene','sandboxResult'];
  state.siteDrafts[state.site]=Object.fromEntries(keys.map(key=>[key,state[key]||null]));
  state.site=site;for(const key of keys)state[key]=state.siteDrafts[site]?.[key]||null;
  try { localStorage.setItem(sitePreferenceKey, state.site); } catch { /* Optional preference. */ }
  state.observation=null;state.timeline=null;state.summary=null;state.errors={};state.loading=true;
  updateStatus();render();refresh();
});
$("refresh-all").addEventListener("click", () => refresh());
window.addEventListener("hashchange", route);
const timer = setInterval(() => { if (!document.hidden && !$("refresh-all").disabled) refresh(); }, 300000);
window.addEventListener("pagehide", () => { panelCleanup(); cleanup(); refreshController?.abort(); clearInterval(timer); });
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
document.querySelector('[data-view=risk] span').textContent="区域人群研判";
route(); refresh({ initial: true });
