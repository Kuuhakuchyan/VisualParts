"use strict";
const API = "/api/weather/aic";
let workspaceSite = new URLSearchParams(location.search).get("site") === "campus" ? "campus" : "zhongyuan";
const $ = (id) => document.getElementById(id);
const redFlags = new Set(["confusion", "unconscious", "slurred_speech", "seizure", "fainting"]);
let observation = null;
let report = null;
let weatherController = null;
let assessmentController = null;
let currentMode = "current";
const timeLabel = (iso) => iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
function text(id, value) { $(id).textContent = value; }
function element(tag, value, className) { const node = document.createElement(tag); if (value != null) node.textContent = value; if (className) node.className = className; return node; }
function link(label, url) { const node = element("a", label); node.href = url; node.target = "_blank"; node.rel = "noopener noreferrer"; return node; }
function symptoms() { return [...document.querySelectorAll('[name="symptom"]:checked')].map((el) => el.value); }
function invalidate() {
  assessmentController?.abort(); report = null;
  $("report").hidden = true; $("result-empty").hidden = false;
  $("json-download").disabled = true; $("print-report").disabled = true;
  $("assess-button").disabled = false; text("assess-button", "评估环境风险");
}
async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "请求未通过校验，请检查输入后重试。");
  return result;
}
function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function loadWeather() {
  weatherController?.abort(); weatherController = new AbortController();
  const controller = weatherController; observation = null; invalidate();
  text("temperature", "—"); text("humidity", "—"); text("observed-at", "—"); text("provider", "—");
  text("location", workspaceSite === "campus" ? "校园周边网格" : "中原区附近网格"); text("quality-note", "区域网格估计，非校园站点实测。");
  text("weather-state", currentMode === "history" ? "正在获取2024年历史资料…" : "正在获取区域当前天气…");
  $("raw-download").disabled = true; $("refresh").disabled = true;
  try {
    const result = await request(`${API}/observations/current?mode=${currentMode}&site=${workspaceSite}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]) });
    if (controller !== weatherController) return;
    observation = result.observation;
    text("temperature", observation.temperature_c.toFixed(1)); text("humidity", Math.round(observation.relative_humidity_pct));
    text("observed-at", timeLabel(observation.observed_at)); text("provider", observation.source_name);
    text("location", `${observation.location_label} · ${observation.location.latitude.toFixed(3)}°N, ${observation.location.longitude.toFixed(3)}°E`);
    text("weather-state", currentMode === "history" ? `历史案例 · ${observation.selection}` : "当前网格已更新");
    text("quality-note", observation.disclaimer); $("raw-download").disabled = false;
  } catch (error) { if (!controller.signal.aborted) text("weather-state", error.name === "TimeoutError" ? "天气请求超时，可稍后刷新。" : error.message); }
  finally { if (controller === weatherController) $("refresh").disabled = false; }
}
async function loadStatus() {
  try {
    const status = await request(`${API}/status`, { signal: AbortSignal.timeout(10000) });
    text("release-status", status.approved_clauses ? "部分条款已审核 · 原型" : "医学条款待医师审核");
    const available = status.approved_clauses > 0 && status.protocol_reviewed && status.model_configured;
    if (status.approved_clauses > 0 && status.protocol_reviewed) text("professional-status", "展示内容通过条款与规则审核。专业审核不等于临床有效性验证；本页不作疾病确诊或处方。");
    $("use-ai").disabled = !available;
    text("ai-state", available ? "开启后将匿名场景与审核条款发送至 DeepSeek；不发送身份信息。" : "医学条款尚未审核或AI服务未就绪；当前只评估环境风险与症状分流。");
    $("sources").replaceChildren();
    for (const source of status.sources) {
      const row = element("div", null, "source-link");
      row.append(link(`[${source.id}] ${source.title}`, source.url));
      row.append(element("small", `${source.publisher} · ${source.snapshot?.quotes_verified ? "来源快照已核验" : "来源快照待核验"}`));
      $("sources").append(row);
    }
  } catch { text("release-status", "审核状态暂不可用"); text("ai-state", "无法确认医学知识库状态，AI建议保持关闭。"); }
}
function showReport(value) {
  report = value; $("result-empty").hidden = true; $("report").hidden = false;
  text("case-label", value.observation?.source_type === "historical_weather" ? `历史天气案例 · ${timeLabel(value.observation.observed_at)}` : "当前环境参考");
  text("risk-label", value.environment.risk_label); text("heat-index", value.environment.heat_index_c == null ? "—" : value.environment.heat_index_c.toFixed(1));
  const explanations = { below_range: "当前温度未达到本方法的高温计算范围，不代表个体风险为零。", out_of_range: "温湿度组合超出本原型保守计算范围，未输出分级；不能据此视为低风险。", unavailable: "观测缺失、质量未通过或时间已失效，无法计算环境风险。症状分流独立生效。" };
  text("applicability", explanations[value.environment.applicability] || value.environment.limitations[0]); text("triage-message", value.symptom_triage.message);
  text("medical-message", value.medical_message);
  text("generation-mode", value.generation.mode === "ai_evidence_selection" ? "AI编排 · 审核原文" : "规则结果");
  $("advice-list").replaceChildren(); $("citations").replaceChildren();
  for (const item of value.advice) $("advice-list").append(element("li", `${item.text} [${item.citation_id}]`));
  for (const cite of value.citations) {
    const row = element("div", null, "citation");
    row.append(element("strong", `[${cite.id}] ${cite.publisher}`)); row.append(link(cite.title, cite.url));
    row.append(element("p", `原文位置：${cite.location} · 审核通过`)); row.append(element("blockquote", cite.quote)); $("citations").append(row);
  }
  $("no-citations").hidden = value.citations.length > 0;
  const meta = [
    ["数据来源", value.observation?.source_name || "缺少有效观测"], ["观测时间", timeLabel(value.observation?.observed_at)],
    ["气象输入", value.observation ? `${value.observation.temperature_c}°C / ${value.observation.relative_humidity_pct}%` : "无"],
    ["活动与暴露", `${({rest:'静坐/休息',walk:'户外步行',run:'跑步/运动',work:'户外劳动'})[value.input.activity]} / ${value.input.exposure_minutes}分钟 / ${({shade:'阴凉轻风',sun:'阳光直射',unknown:'环境未核实'})[value.input.exposure]}`],
    ["匿名症状", value.input.symptoms.length ? value.input.symptoms.join(', ') : "未报告"],
    ["观测编号", value.observation?.id || "无"], ["原始摘要", value.observation?.raw_sha256 || "无"],
    ["风险方法", value.environment.method], ["规则版本", value.rules_version], ["知识库", value.knowledge_version],
    ["方法引用", (value.environment.source_ids || ['NWS-METHOD','NWS-LEVELS']).join(', ')],
    ["触发规则", value.environment.triggers.join(", ")], ["生成状态", `${value.generation.mode} / ${value.generation.reason || value.generation.model}`],
    ["报告时间", timeLabel(value.created_at)], ["报告摘要", value.report_sha256],
  ];
  $("audit-meta").replaceChildren();
  for (const [label, content] of meta) { const row = element("div"); row.append(element("dt", label), element("dd", content)); $("audit-meta").append(row); }
  $("limitations").replaceChildren(...[...value.environment.limitations, value.activity_context.note, value.privacy, "报告摘要用于内容一致性核对，不是临床证明或数字签名。"].map((item) => element("li", item)));
  $("json-download").disabled = false; $("print-report").disabled = false;
  if (innerWidth <= 700) $("report").scrollIntoView({ behavior: "auto", block: "start" });
}
$("assessment-form").addEventListener("change", () => { invalidate(); $("emergency-banner").hidden = !symptoms().some((s) => redFlags.has(s)); });
$("duration").addEventListener("input", invalidate);
document.querySelectorAll('[name="mode"]').forEach((radio) => radio.addEventListener("change", () => { currentMode = radio.value; loadWeather(); }));
$("refresh").addEventListener("click", loadWeather);
$("assessment-form").addEventListener("submit", async (event) => {
  event.preventDefault(); $("form-error").hidden = true;
  const selected = symptoms();
  if (!observation && selected.length === 0) { text("form-error", "缺少有效气象记录，请刷新数据；危险症状无需等待气象数据。"); $("form-error").hidden = false; return; }
  assessmentController?.abort(); assessmentController = new AbortController();
  const controller = assessmentController; $("assess-button").disabled = true; text("assess-button", "正在评估…");
  try {
    const value = await request(`${API}/assess`, { method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(24000)]),
      body: JSON.stringify({ observation_id: observation?.id || null, activity: $("activity").value, exposure_minutes: Number($("duration").value), exposure: $("exposure").value, symptoms: selected, use_ai: $("use-ai").checked && !$("use-ai").disabled }) });
    if (!controller.signal.aborted) showReport(value);
  } catch (error) { if (!controller.signal.aborted) { text("form-error", error.name === "TimeoutError" ? "评估超时，请重试；危险症状请直接联系急救。" : error.message); $("form-error").hidden = false; } }
  finally { if (controller === assessmentController) { $("assess-button").disabled = false; text("assess-button", "评估环境风险"); } }
});
$("raw-download").addEventListener("click", async () => {
  if (!observation) return;
  try { download(await request(`${API}/observations/${observation.id}`), `${observation.id}.json`); }
  catch { text("weather-state", "原始记录下载失败，请重试。"); }
});
$("json-download").addEventListener("click", () => { if (report) download(report, `microclimate-${report.report_sha256.slice(0, 12)}.json`); });
$("print-report").addEventListener("click", () => { if (report) { document.querySelectorAll(".audit-details").forEach((d) => { d.open = true; }); window.print(); } });
if (new URLSearchParams(location.search).get("embed") === "1") {
  document.documentElement.classList.add("embedded");
  const observer = new ResizeObserver(() => parent.postMessage({ type: "aic-height", height: document.body.scrollHeight + 12 }, location.origin));
  observer.observe(document.body);
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "workspace-refresh") return;
    workspaceSite = event.data.site === "campus" ? "campus" : "zhongyuan";
    loadStatus(); loadWeather();
  });
}
loadStatus(); loadWeather();
