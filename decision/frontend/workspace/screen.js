import "./screen.css";
import { $, icons, icon, escape as e, numeric as n, date, download, toast } from "./ui.js";
import { defaultBounds, regionalValidity } from "./regional.js";

export class DecisionScreen {
  constructor(options) { Object.assign(this, options); this.disposed = false; this.panel = null; }
  mount() {
    $("view-root").innerHTML = `<section class="decision-screen" id="decision-screen" aria-label="微境探界可视化决策大屏">
      <div class="screen-map" id="workspace-map" aria-label="校园三维空间地图"></div>
      <header class="screen-header"><a href="#screen" class="screen-brand"><img src="${import.meta.env.BASE_URL}logo.png" alt=""><div><h1>微境探界</h1><span>${this.competition ? "AIC · 智慧气象竞赛版" : "城市微环境 · 可视化决策平台"}</span></div></a><nav class="screen-nav" aria-label="大屏与子工作台"><a href="#screen" aria-current="page">${icon("monitor")}<span>决策大屏</span></a><a href="#overview">${icon("layout-dashboard")}<span>操作工作台</span></a><button data-screen-panel="risk">${icon("shield-check")}<span>热风险评估</span></button><button data-screen-panel="plans">${icon("git-compare-arrows")}<span>方案对比</span></button></nav><div class="screen-header-tools"><label class="screen-site"><span class="sr-only">天气区域</span>${icon("map-pin")}<select id="screen-site"><option value="zhongyuan">郑州 · 中原区</option><option value="campus">校园周边</option></select></label><button id="screen-refresh" class="screen-icon" title="刷新天气与方案" aria-label="刷新天气与方案">${icon("refresh-cw")}</button><button id="screen-fullscreen" class="screen-icon" title="全屏展示 / 退出全屏" aria-label="全屏展示 / 退出全屏" aria-pressed="false">${icon("maximize")}</button></div></header>
      <div class="screen-context"><span><b class="screen-live-dot"></b><span id="screen-status">正在连接气象服务</span></span><time id="screen-clock"></time><span class="screen-context-version">MICROCLIMATE / COMMAND</span></div>
      <aside class="screen-left" aria-label="气象态势"><section class="screen-section"><div class="screen-section-title"><h2>区域气象态势</h2><span>WEATHER</span></div><div id="screen-weather"></div></section><section class="screen-section screen-trend-section"><div class="screen-section-title"><h2>未来 24 小时</h2><span>FORECAST</span></div><div class="screen-chart-legend"><span>气温 °C</span><span>湿度 %</span></div><div id="screen-trend" aria-label="未来24小时模型预报气温与湿度" role="img"></div><p id="screen-peak" class="screen-muted"></p><a href="#overview" class="screen-text-link">小时明细 ${icon("arrow-up-right")}</a></section><section class="screen-section screen-pipeline"><div class="screen-section-title"><h2>数据链路</h2><span>EVIDENCE</span></div><div id="screen-pipeline"></div><button class="screen-text-link" data-screen-panel="evidence">核查来源与方法 ${icon("arrow-up-right")}</button></section></aside>
      <div class="screen-scene-caption"><p>SPATIAL INTELLIGENCE</p><h2>真实空间 · 多维研判</h2><span>校园空间底图 / 建筑形态 / 干预方案</span></div>
      <aside class="screen-right" aria-label="风险与空间操作"><section class="screen-section"><div class="screen-section-title"><h2>环境热风险</h2>${icon("shield-check")}</div><div id="screen-risk"></div><button class="screen-action primary" data-screen-panel="risk">${icon("shield-check")}评估活动与暴露 ${icon("arrow-right")}</button></section><section class="screen-section screen-location"><div class="screen-section-title"><h2>空间研判</h2><span>SELECT / PLAN</span></div><strong id="picked-location">尚未选点</strong><p id="picked-description" class="screen-muted">选择地图位置后可登记干预方案。</p><button id="use-location" class="screen-action" disabled>${icon("plus")}以此位置建立方案</button><div class="screen-plan-count"><span>当前工作区方案</span><strong id="screen-plan-count">0</strong><button class="screen-text-link" data-screen-panel="plans">管理与对比 ${icon("chevron-right")}</button></div></section><section class="screen-section screen-layers"><div class="screen-section-title"><h2>场景图层</h2>${icon("layers")}</div><label><input type="checkbox" id="layer-buildings" checked>建筑三维形态<span id="screen-buildings">连接中</span></label><label><input type="checkbox" id="layer-grid" checked>天气网格中心<span>非现场测点</span></label><label><input type="checkbox" id="layer-plans" checked>已保存方案<span>几何范围</span></label><div class="screen-light-control"><label for="map-light">展示光照角度</label><input type="range" id="map-light" min="0" max="360" value="210" step="5"><small>仅场景光照，不代表实况太阳或辐射模拟</small></div></section></aside>
      <div class="screen-map-tools" role="group" aria-label="地图控制"><button id="map-home" title="回到校园全景" aria-label="回到校园全景">${icon("focus")}</button><button id="map-grid" title="定位天气网格中心" aria-label="定位天气网格中心">${icon("crosshair")}</button><span></span><button id="map-imagery" aria-pressed="true">影像</button><button id="map-streets" aria-pressed="false">街道</button><span></span><button id="map-pitch" title="切换平面与3D倾斜" aria-label="切换平面与3D倾斜" aria-pressed="true">${icon("box")}</button><button id="map-orbit" title="开启 / 暂停环绕展示" aria-label="开启 / 暂停环绕展示" aria-pressed="false">${icon("play")}</button></div>
      <div class="screen-map-status"><span id="map-state" role="status">正在读取空间资料…</span><span id="map-coordinate">113.531°E / 34.814°N</span></div><div id="map-weather" hidden></div>
      <footer class="screen-footer"><span>网格天气 ≠ 现场实测 · 建筑高度含示意值</span><span>温降效果未验证 · 医学建议受审核门禁控制</span><button id="screen-export">${icon("download")}导出当前依据</button>${this.competition ? "" : '<a href="/">项目主页</a>'}</footer>
      <dialog id="screen-drawer" class="screen-drawer"><header><div><span>微境探界 / <span id="screen-panel-label"></span></span><h2 id="screen-panel-title"></h2></div><button id="screen-panel-close" class="icon-button" aria-label="关闭操作面板" title="关闭操作面板">${icon("x")}</button></header><div id="screen-panel-content"></div></dialog>
    </section>`;
    $("decision-screen").append($("delete-dialog"));
    $("decision-screen").append($("toast"));
    icons();
    $("screen-site").value = this.state.site;
    document.querySelectorAll('.screen-nav [data-screen-panel=risk] span').forEach(node=>node.textContent="区域人群研判");
    const riskAction=document.querySelector('.screen-right [data-screen-panel=risk]');
    riskAction.innerHTML=`${icon("cpu")}区域 × 人群研判 ${icon("arrow-right")}`;
    if (this.competition) { $("screen-site").options[0].textContent="某街区"; $("screen-site").options[1].textContent="某校园"; }
    const locationSection = document.querySelector(".screen-location");
    locationSection.insertAdjacentHTML("afterbegin", `<div class="screen-region-controls"><h2>区域 × 人群研判</h2><p id="screen-region-state" class="screen-muted">选择矩形范围，再选择目标人群。</p><div class="screen-region-actions"><button id="screen-select-region" class="screen-action">${icon("map")}地图选区</button><button id="screen-region-assess" class="screen-action primary">${icon("cpu")}人群研判</button></div><div id="screen-region-result"></div></div>`);
    $("screen-select-region").addEventListener("click",()=>this.selectRegion());
    $("screen-region-assess").addEventListener("click",()=>this.openPanel("risk"));
    $("screen-site").addEventListener("change", (event) => this.onSite(event.target.value));
    $("screen-refresh").addEventListener("click", async () => {
      const button = $("screen-refresh");
      button.disabled = true; button.classList.add("refreshing");
      try { await this.refresh(); } finally { button.disabled = false; button.classList.remove("refreshing"); }
    });
    $("screen-fullscreen").addEventListener("click", async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await $("decision-screen").requestFullscreen(); } catch { toast("浏览器暂不支持全屏，可使用系统全屏模式。"); }
    });
    this.fullscreenListener = () => $("screen-fullscreen")?.setAttribute("aria-pressed", String(!!document.fullscreenElement));
    document.addEventListener("fullscreenchange", this.fullscreenListener);
    document.querySelectorAll("[data-screen-panel]").forEach((button) => button.addEventListener("click", () => this.openPanel(button.dataset.screenPanel)));
    $("screen-panel-close").addEventListener("click", () => $("screen-drawer").close());
    $("screen-drawer").addEventListener("close", () => { if (this.disposed) return; $("decision-screen").append($("toast")); this.onPanel(null); this.panel = null; $("screen-panel-content").replaceChildren(); this.update(); if(this.map?.selectingRegion) $("screen-region-state").textContent="请依次点击矩形的两个对角点；Esc 可取消。"; });
    $("screen-export").addEventListener("click", () => download({ project: "微境探界", edition: this.competition ? "AIC" : "platform", exported_at: new Date().toISOString(), observation: this.state.observation, environment: this.state.summary?.environment || null, regional_report: this.state.regionalReport || null, errors: this.state.errors }, "microclimate-screen-evidence.json"));
    this.clock = () => { if (!this.disposed) { $("screen-clock").textContent = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + " 北京时间"; const minute=Math.floor(Date.now()/60000); if(this.validityMinute!==minute){this.validityMinute=minute;this.updateRegional();} } };
    this.clock(); this.clockTimer = setInterval(this.clock, 1000);
    this.update(); this.mountMap();
  }
  async mountMap() {
    try {
      const { SpatialWorkspace } = await import("./map.js");
      if (this.disposed) return;
      this.map = new SpatialWorkspace({ observation: this.state.observation, plans: this.state.plans, dark: true, onRegion: (bounds) => { this.setRegion(bounds); this.openPanel("risk"); }, onChoose: (point) => { this.onDraft(point); this.openPanel("plans"); }, onState: (value) => {
        if (this.disposed) return;
        $("screen-buildings").textContent = value.buildings ? `${value.buildings} 栋` : "暂缺";
        $("workspace-map").dataset.renderer = value.model;
      } });
      await this.map.init();
      if (!this.disposed) { this.map.observation = this.state.observation; this.map.plans = this.state.plans; this.map.updateWeather(); this.updateRegional(); this.map.map.fitBounds([[this.state.regionalDraft?.bounds?.west ?? defaultBounds(this.state.site).west,this.state.regionalDraft?.bounds?.south ?? defaultBounds(this.state.site).south],[this.state.regionalDraft?.bounds?.east ?? defaultBounds(this.state.site).east,this.state.regionalDraft?.bounds?.north ?? defaultBounds(this.state.site).north]],{padding:80,duration:0}); }
    } catch { if (!this.disposed) $("map-state").textContent = "地图暂不可用，天气与风险操作仍可使用。"; }
  }
  openPanel(kind) {
    this.map?.stopOrbit();
    const names = { plans: ["INTERVENTION PLANS", "干预方案与并列比较"], risk: ["REGIONAL HEALTH RISK", "区域 × 人群 · 热健康风险研判"], evidence: ["EVIDENCE", "数据来源与方法依据"] };
    this.panel = kind;
    $("screen-panel-label").textContent = names[kind][0];
    $("screen-panel-title").textContent = names[kind][1];
    this.onPanel(kind);
    $("screen-drawer").append($("toast"));
    icons();
    if (!$("screen-drawer").open) $("screen-drawer").showModal();
  }
  update() {
    this.updateRegional();
    if (this.disposed) return;
    const { observation: o, summary, status, loading, errors, plans } = this.state;
    const valid = this.fresh();
    $("view-root").setAttribute("aria-busy", String(loading));
    $("screen-status").textContent = loading ? "正在连接气象服务" : valid ? "网格天气已更新 · 非现场实测" : o ? "天气记录待核查" : "天气服务暂不可用";
    $("screen-status").parentElement.classList.toggle("is-warning", !valid);
    $("screen-weather").innerHTML = `<div class="screen-temperature">${n(o?.temperature_c)}<small>°C</small><span>2 m 气温 · 模型估计</span></div><div class="screen-weather-grid">${this.measure("相对湿度", n(o?.relative_humidity_pct, 0), "%", "droplets")}${this.measure("近地风速", n(o?.extras?.wind_speed_10m), "m/s", "wind")}${this.measure("当前降水", n(o?.extras?.precipitation), "mm", "cloud-rain")}${this.measure("风向", n(o?.extras?.wind_direction_10m, 0), "°", "compass")}</div><div class="screen-source-note"><strong>${e(o?.location_label || "等待天气记录")}</strong><span>${o ? date(o.observed_at, true) + " 北京时间" : e(errors.weather || "连接中")}</span><small>${o ? "Open-Meteo · 网格估计" : "不使用模拟数据替代缺测"}</small></div>`;
    $("screen-risk").innerHTML = `<div class="screen-risk-index"><strong>${n(summary?.environment?.heat_index_c)}</strong><span>°C<small>热指数参考</small></span></div><h3>${e(summary?.environment?.risk_label || "暂无有效评估")}</h3><p class="screen-muted">${e(summary?.environment?.limitations?.[0] || "从区域环境热风险出发，结合目标人群的活动、暴露和医学证据分别研判。")}</p><span class="screen-review">${status?.protocol_reviewed && status?.approved_clauses ? "部分医学条款已审核" : "医学条款待医师审核"}</span>`;
    $("screen-plan-count").textContent = plans.length;
    $("screen-pipeline").innerHTML = this.pipeline("区域网格", valid ? "有效记录" : "待核查", valid) + this.pipeline("现场设备", "本轮有效实测未接入", false) + this.pipeline("医学依据", status ? `${status.approved_clauses}/${status.draft_clauses} 条已审核` : "状态暂缺", !!status?.approved_clauses);
    const points = this.state.timeline?.points?.filter((p) => p.period === "forecast") || [];
    const temperatures = points.filter((p) => p.temperature_2m != null);
    const peak = temperatures.length ? temperatures.reduce((a, b) => a.temperature_2m > b.temperature_2m ? a : b) : null;
    $("screen-peak").textContent = peak ? `预计最高 ${n(peak.temperature_2m)}°C / ${date(peak.time, true)}` : "暂无可用预报，不生成替代曲线。";
    this.updateChart(points);
    if (this.map?.map?.isStyleLoaded()) { this.map.observation = o; this.map.plans = plans; this.map.updateWeather(); }
    icons();
  }
  measure(label, value, unit, symbol) { return `<div><span>${icon(symbol)}${label}</span><strong>${value}<small>${unit}</small></strong></div>`; }
  selectRegion() {
    if (!this.map?.map?.getSource("regional-area")) { toast("地图尚未就绪，可先在区域研判中填写边界。"); return; }
    $("screen-drawer").close(); this.map.beginRegion();
    $("screen-region-state").textContent="请依次点击矩形的两个对角点；Esc 可取消。";
  }
  setRegion(bounds) {
    this.state.regionalDraft={ area_kind:this.state.site==="campus"?"campus":"neighborhood", mode:"current", groups:["students","athletes","workers"], activity:"walk", exposure_minutes:30, exposure:"unknown", use_ai:true, ...this.state.regionalDraft, bounds };
    this.state.regionalReport=null; this.updateRegional();
  }
  updateRegional() {
    if (this.disposed || !$("screen-region-result")) return;
    const report=this.state.regionalReport, bounds=this.state.regionalDraft?.bounds||defaultBounds(this.state.site);
    $("screen-region-state").textContent=`选区 ${n(bounds.west,3)}–${n(bounds.east,3)}°E / ${n(bounds.south,3)}–${n(bounds.north,3)}°N`;
    $("screen-region-result").innerHTML=report?`<div class="screen-cohort-summary"><strong>${e(report.environment.risk_label)}</strong><p>${report.cohorts.length}类人群 / ${report.coverage.unique_model_grids}个模型网格</p><span>${report.generation.mode==="ai_regional_evidence_selection"?"AI 证据编排已完成":"规则结果 · 可核查降级原因"}</span><small>${e(regionalValidity(report).label)}</small><small>${report.medical_review==="pending"?"医学防护条款待审核":"仅展示已审核医学条款"}</small></div>`:'';
    this.map?.setRegion(bounds,report);
  }
  pipeline(label, value, ready) { return `<div class="screen-pipeline-row ${ready ? "ready" : ""}"><i></i><span>${label}</span><small>${e(value)}</small></div>`; }
  async updateChart(points) {
    const revision = this.chartRevision = (this.chartRevision || 0) + 1;
    if (!points.length) { this.chartObserver?.disconnect(); this.chart?.dispose(); this.chart = null; $("screen-trend").textContent = this.state.loading ? "正在获取小时天气…" : "预报暂缺"; return; }
    const [{ init, use }, { LineChart }, { GridComponent, TooltipComponent }, { CanvasRenderer }] = await Promise.all([import("echarts/core"), import("echarts/charts"), import("echarts/components"), import("echarts/renderers")]);
    if (this.disposed || revision !== this.chartRevision) return;
    use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
    if (!this.chart) {
      this.chartObserver?.disconnect();
      $("screen-trend").replaceChildren(); this.chart = init($("screen-trend"));
      this.chartObserver = new ResizeObserver(() => this.chart?.resize()); this.chartObserver.observe($("screen-trend"));
    }
    this.chart.setOption({ animation: !matchMedia("(prefers-reduced-motion: reduce)").matches, animationDuration: 350, grid: { left: 25, right: 25, top: 10, bottom: 22 }, tooltip: { trigger: "axis", confine: true }, xAxis: { type: "category", data: points.map((p) => date(p.time, true)), boundaryGap: false, axisLabel: { color: "#93aaa7", fontSize: 9, formatter: (v) => v.split(" ").pop() }, axisLine: { lineStyle: { color: "#3a4a46" } }, axisTick: { show: false } }, yAxis: [{ type: "value", scale: true, axisLabel: { color: "#93aaa7", fontSize: 9 }, splitLine: { lineStyle: { color: "#32413d", type: "dashed" } } }, { type: "value", min: 0, max: 100, axisLabel: { color: "#93aaa7", fontSize: 9 }, splitLine: { show: false } }], series: [{ name: "气温 °C", type: "line", data: points.map((p) => p.temperature_2m), connectNulls: false, showSymbol: false, lineStyle: { color: "#aee4bd", width: 2 }, itemStyle: { color: "#aee4bd" } }, { name: "湿度 %", type: "line", yAxisIndex: 1, data: points.map((p) => p.relative_humidity_2m), connectNulls: false, showSymbol: false, lineStyle: { color: "#82bfda", width: 1.5, type: "dashed" }, itemStyle: { color: "#82bfda" } }] });
  }
  destroy() { this.disposed = true; if ($("delete-dialog")) document.body.append($("delete-dialog")); if ($("toast")) document.body.append($("toast")); clearInterval(this.clockTimer); this.chartObserver?.disconnect(); this.chart?.dispose(); this.map?.destroy(); document.removeEventListener("fullscreenchange", this.fullscreenListener); }
}
