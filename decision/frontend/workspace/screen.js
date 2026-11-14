import "./screen-design.css";
import { $, icons, icon, help, escape as e, numeric as n, date, download, toast } from "./ui.js";
import { defaultBounds, defaultDataMode, defaultRegional, gridCoverageText, regionalValidity, activityLabels } from "./regional-state.js";
import { projectHomeHref } from "./edition.js";
import { selectionMarkup } from './grid-selection.js';
import { ForecastPlayback } from './forecast-frames.js';

export class DecisionScreen {
  constructor(options) { Object.assign(this, options); this.disposed = false; this.panel = null; }
  mount() {
    $("view-root").innerHTML = `<section class="decision-screen" id="decision-screen" aria-label="微境探界可视化决策大屏">
      <div class="screen-map" id="workspace-map" aria-label="校园三维空间地图"></div>
      <header class="screen-header"><a href="#screen" class="screen-brand"><img src="${import.meta.env.BASE_URL}logo.png" alt=""><div><h1>微境探界</h1><span>${this.competition ? "AIC 智慧气象" : "城市微环境 · 可视化决策平台"}</span></div></a><nav class="screen-nav" aria-label="大屏与子工作台">${this.competition ? `<a class="competition-home-nav" href="./home.html">${icon("external-link")}<span>项目主页</span></a>` : ""}<a href="#screen" aria-current="page">${icon("monitor")}<span>决策大屏</span></a><a href="#overview">${icon("layout-dashboard")}<span>操作工作台</span></a><button data-screen-panel="risk">${icon("shield-check")}<span>热风险评估</span></button><button data-screen-panel="plans">${icon("git-compare-arrows")}<span>方案对比</span></button></nav><div class="screen-header-tools"><label class="screen-site"><span class="sr-only">天气区域</span>${icon("map-pin")}<select id="screen-site"><option value="zhongyuan">郑州 · 中原区</option><option value="campus">校园周边</option></select></label><button id="screen-refresh" class="screen-icon" title="刷新天气与方案" aria-label="刷新天气与方案">${icon("refresh-cw")}</button><button id="screen-fullscreen" class="screen-icon" title="全屏展示 / 退出全屏" aria-label="全屏展示 / 退出全屏" aria-pressed="false">${icon("maximize")}</button></div></header>
      <div class="screen-context"><span><b class="screen-live-dot"></b><span id="screen-status">正在连接气象服务</span></span><time id="screen-clock"></time><span class="screen-context-version">气象态势与空间决策</span></div>
      <aside class="screen-left" aria-label="气象态势"><section class="screen-section"><div class="screen-section-title"><h2>区域气象态势</h2><span>WEATHER</span></div><div id="screen-weather"></div></section><section class="screen-section screen-trend-section"><div class="screen-section-title"><h2>未来 24 小时</h2><span>FORECAST</span></div><div class="screen-chart-legend"><span>气温 °C</span><span>湿度 %</span></div><div id="screen-trend" aria-label="未来24小时模型预报气温与湿度" role="img"></div><p id="screen-peak" class="screen-muted"></p><a href="#overview" class="screen-text-link">小时明细 ${icon("arrow-up-right")}</a></section><section class="screen-section screen-pipeline"><div class="screen-section-title"><h2>数据链路</h2><span>EVIDENCE</span></div><div id="screen-pipeline"></div><button class="screen-text-link" data-screen-panel="evidence">核查来源与方法 ${icon("arrow-up-right")}</button></section></aside>

      <aside class="screen-right" aria-label="风险与空间操作"><section class="screen-section"><div class="screen-section-title"><h2>环境热风险</h2>${icon("shield-check")}</div><div id="screen-risk"></div><button class="screen-action primary" data-screen-panel="risk">${icon("shield-check")}评估活动与暴露 ${icon("arrow-right")}</button></section><section class="screen-section screen-location"><div class="screen-section-title"><h2>空间研判</h2>${help("标记地点模式下点击地图可建立位置档案；拆建请使用布局沙盘。", "空间操作帮助")}</div><strong id="picked-location">尚未选点</strong><p id="picked-description" class="screen-muted">选择地图位置后可登记干预方案。</p><button id="use-location" class="screen-action" disabled>${icon("plus")}以此位置建立方案</button><div class="screen-plan-count"><span>当前工作区方案</span><strong id="screen-plan-count">0</strong><button class="screen-text-link" data-screen-panel="plans">管理与对比 ${icon("chevron-right")}</button></div></section><section class="screen-section screen-layers"><div class="screen-section-title"><h2>场景图层</h2>${icon("layers")}</div><label><input type="checkbox" id="layer-buildings" checked>建筑三维形态<span id="screen-buildings">连接中</span></label><label><input type="checkbox" id="layer-grid" checked>天气网格中心<span>非现场测点</span></label><label><input type="checkbox" id="layer-plans" checked>已保存方案<span>几何范围</span></label><div class="screen-light-control"><div class="context-help-row"><label for="map-light">展示光照角度</label>${help("仅改变展示光照，不代表实况太阳位置，也不参与辐射推演计算。", "展示光照说明")}</div><input type="range" id="map-light" min="0" max="360" value="210" step="5"></div></section></aside>
      <div class="screen-map-tools" role="group" aria-label="地图控制"><button id="map-home" title="回到校园全景" aria-label="回到校园全景">${icon("focus")}</button><button id="map-grid" title="定位天气网格中心" aria-label="定位天气网格中心">${icon("crosshair")}</button><span></span><button id="map-imagery" aria-pressed="true">影像</button><button id="map-streets" aria-pressed="false">街道</button><span></span><button id="map-pitch" title="切换平面与3D倾斜" aria-label="切换平面与3D倾斜" aria-pressed="true">${icon("box")}</button><button id="map-orbit" title="开启 / 暂停环绕展示" aria-label="开启 / 暂停环绕展示" aria-pressed="false">${icon("play")}</button></div>
      <div class="screen-map-status"><span id="map-state" role="status">正在读取空间资料…</span><span id="map-coordinate">113.531°E / 34.814°N</span></div><div id="map-weather" hidden></div>
      <footer class="screen-footer"><span id="screen-data-label">模拟数据</span><button class="screen-text-link" data-screen-panel="evidence">数据与方法</button><button id="screen-export">${icon("download")}导出当前依据</button>${this.competition ? "" : '<a href="/">项目主页</a>'}</footer>
      <dialog id="screen-drawer" class="screen-drawer"><header><div><span>微境探界 / <span id="screen-panel-label"></span></span><h2 id="screen-panel-title"></h2></div><button id="screen-panel-close" class="icon-button" aria-label="关闭操作面板" title="关闭操作面板">${icon("x")}</button></header><div id="screen-panel-content"></div></dialog>
    </section>`;
    $("decision-screen").append($("delete-dialog"));
    $("decision-screen").append($("toast"));
    this.mountDock();
    this.mountForecastBrowser();
    const tools=document.querySelector('.screen-map-tools');
    tools.insertAdjacentHTML('beforeend',`<button id="map-more" type="button" aria-expanded="false" aria-label="展开地图工具" title="更多地图工具">${icon('ellipsis')}</button>`);
    this.closeTools=()=>{tools.classList.remove('tools-expanded');$('map-more').setAttribute('aria-expanded','false');};
    $('map-more').addEventListener('click',()=>{const open=!tools.classList.contains('tools-expanded');tools.classList.toggle('tools-expanded',open);$('map-more').setAttribute('aria-expanded',String(open));});
    this.toolsOutside=event=>{if(!tools.contains(event.target))this.closeTools();};
    document.addEventListener('pointerdown',this.toolsOutside);
    const mobileNav=document.createElement('nav');mobileNav.className='screen-mobile-nav';mobileNav.setAttribute('aria-label','手机决策导航');
    mobileNav.innerHTML=[['#screen','map','地图'],['#overview','thermometer','天气'],['#risk','shield-check','人群'],['#plans','git-compare-arrows','方案'],['#evidence','database','依据']].map(([href,symbol,label])=>`<a href="${href}"${href==='#screen'?' aria-current="page"':''}>${icon(symbol)}<span>${label}</span></a>`).join('');
    $("decision-screen").append(mobileNav);
    const weatherDetails=document.createElement('a');weatherDetails.href='#overview';weatherDetails.className='screen-weather-details';weatherDetails.textContent='天气详情';$("screen-weather").after(weatherDetails);
    document.querySelector('.screen-risk-section .screen-section-title h2').textContent='区域人群研判';
    $("screen-risk").insertAdjacentHTML('afterend','<div id="screen-people" class="screen-person-list"></div>');
    $("screen-people").insertAdjacentHTML('beforebegin','<section id="screen-selection-summary" class="screen-selection-summary" aria-label="选定网格" hidden></section>');
    this.selectionListener=event=>{const host=$("screen-selection-summary");host.hidden=!event.detail;host.innerHTML=event.detail?`<button type="button" class="icon-button selection-dismiss" aria-label="关闭选定网格" title="关闭选定网格">${icon('x')}</button>`+selectionMarkup(event.detail,true):'';if(event.detail){host.querySelector('.selection-dismiss').addEventListener('click',()=>this.map?.popup?.remove());icons();}};
    window.addEventListener('workspace:selection',this.selectionListener);
    $("screen-weather").insertAdjacentHTML('afterend','<div id="screen-distribution" class="screen-risk-distribution"></div>');
    const environment=document.createElement('details');environment.className='screen-environment';environment.innerHTML='<summary>环境热指标</summary>';environment.append($("screen-risk"));
    $("screen-distribution").after(environment);
    $("screen-people").insertAdjacentHTML('afterend',`<section class="screen-interventions"><h3>干预方案</h3><p id="screen-intervention-name" class="screen-muted"></p><button class="screen-action" data-screen-panel="plans">${icon('git-compare-arrows')}比较干预方案</button></section>`);
    this.heatListener=()=>{this.updateDistribution();this.updateForecast();};
    window.addEventListener('workspace:heat',this.heatListener);
    icons();
    document.querySelector('.screen-brand').href=projectHomeHref;
    const home=document.querySelector('.competition-home-nav')||document.createElement('a');
    home.classList.add('screen-home-nav');home.href=projectHomeHref;
    home.innerHTML=`${icon("external-link")}<span>项目主页</span>`;
    document.querySelector('.screen-nav').prepend(home);
    document.querySelector('.screen-footer>a')?.remove();
    $("screen-site").value = this.state.site;
    document.querySelectorAll('.screen-nav [data-screen-panel=risk] span').forEach(node=>node.textContent="区域人群研判");
    document.querySelectorAll('.screen-nav [data-screen-panel=plans] span').forEach(node=>node.textContent="干预档案");
    const riskAction=document.querySelector('.screen-right [data-screen-panel=risk]');
    riskAction.innerHTML=`${icon("cpu")}区域 × 人群研判 ${icon("arrow-right")}`;
    if (this.competition) { $("screen-site").options[0].textContent="某街区"; $("screen-site").options[1].textContent="某校园"; }
    const locationSection = document.querySelector(".screen-location");
    locationSection.insertAdjacentHTML("afterbegin", `<div class="screen-region-controls"><div class="heading-with-help"><h2>研判范围</h2>${help("点击地图选区，再依次点击矩形的两个对角点；Esc取消。选好后点击人群研判设置目标人群。", "地图选区帮助")}</div><p id="screen-region-state" class="screen-muted">未选择区域</p><div class="screen-region-actions"><button id="screen-select-region" class="screen-action">${icon("map")}地图选区</button><button id="screen-region-assess" class="screen-action primary">${icon("cpu")}人群研判</button></div><div id="screen-region-result"></div></div>`);
    $("screen-select-region").addEventListener("click",()=>this.selectRegion());
    $("screen-region-assess").addEventListener("click",()=>this.openPanel("risk"));
    $("screen-site").addEventListener("change", (event) => this.onSite(event.target.value));
    $("screen-refresh").addEventListener("click", async () => {
      const button = $("screen-refresh");
      button.disabled = true; button.classList.add("refreshing");
      try { await Promise.allSettled([this.refresh(),this.map?.refresh()]); } finally { button.disabled = false; button.classList.remove("refreshing"); }
    });
    $("screen-fullscreen").addEventListener("click", async () => {
      if(this.fullscreenBusy)return;this.fullscreenBusy=true;
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await $("decision-screen").requestFullscreen(); } catch { if(!this.disposed)toast("浏览器暂不支持全屏，可使用系统全屏模式。"); }
      finally { this.fullscreenBusy=false; }
    });
    this.fullscreenListener = () => $("screen-fullscreen")?.setAttribute("aria-pressed", String(!!document.fullscreenElement));
    document.addEventListener("fullscreenchange", this.fullscreenListener);
    this.layoutReportListener=()=>{this.updateRegional();this.updateForecast();this.updateDistribution();};
    window.addEventListener("workspace:layout-report",this.layoutReportListener);
    this.devicesListener=()=>this.updateDevices();
    window.addEventListener("workspace:devices",this.devicesListener);
    $("decision-screen").querySelectorAll("[data-screen-panel]").forEach((button) => button.addEventListener("click", () => this.openPanel(button.dataset.screenPanel)));
    $("screen-panel-close").addEventListener("click", () => $("screen-drawer").close());
    $("screen-drawer").addEventListener("close", () => { if (this.disposed || $("screen-drawer").open || !this.panel) return; $("decision-screen").append($("toast")); this.onPanel(null); this.panel = null; $("screen-panel-content").replaceChildren(); this.update(); if(this.map?.selectingRegion) $("screen-region-state").textContent="请依次点击矩形的两个对角点；Esc 可取消。"; });
    $("screen-export").addEventListener("click", () => download({ project: "微境探界", edition: this.competition ? "AIC" : "platform", exported_at: new Date().toISOString(), observation: this.state.observation, environment: this.state.summary?.environment || null, regional_report: this.state.regionalReport || null, layout_scene: this.state.sandboxScene || null, layout_result: this.state.sandboxResult || null, field_devices:this.state.fieldDevices||null, collection_simulation:this.state.collectionMission||null, errors: this.state.errors }, "microclimate-screen-evidence.json"));
    this.clock = () => { if (!this.disposed) { $("screen-clock").textContent = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + " 北京时间"; const minute=Math.floor(Date.now()/60000); if(this.validityMinute!==minute){this.validityMinute=minute;this.updateRegional();} } };
    this.clock(); this.clockTimer = setInterval(this.clock, 1000);
    this.update(); this.mountMap();
  }
  mountDock() {
    const dock = document.querySelector('.screen-right');
    dock.dataset.dockView = 'risk';
    dock.querySelector('.screen-section').classList.add('screen-risk-section');
    dock.insertAdjacentHTML('afterbegin', `<div class="screen-dock-header"><div class="screen-dock-tabs" role="tablist" aria-label="空间决策任务">${[['risk','shield-check','人群研判'],['sandbox','box','干预推演'],['layers','layers','图层']].map(([key,symbol,label],i)=>`<button type="button" role="tab" id="dock-tab-${key}" data-dock="${key}" aria-selected="${i===0}" tabindex="${i===0?0:-1}">${icon(symbol)}${label}</button>`).join('')}</div><button class="icon-button screen-dock-close sandbox-mobile-close" type="button" title="收起操作面板" aria-label="收起操作面板">${icon('chevron-right')}</button></div>`);
    dock.querySelector('.screen-dock-close').addEventListener('click',()=>this.map?.sandbox?.setMobileOpen(false));
    const expand=document.createElement('button');expand.type='button';expand.className='icon-button screen-dock-expand';expand.title=expand.ariaLabel='展开或收起任务面板';expand.setAttribute('aria-expanded','false');expand.innerHTML=icon('chevron-right');
    dock.querySelector('.screen-dock-header').append(expand);
    expand.addEventListener('click',()=>{const screen=$("decision-screen"),open=screen.classList.toggle('sandbox-mobile-open');expand.setAttribute('aria-expanded',String(open));this.map?.sandbox?.mobileToggle?.setAttribute('aria-expanded',String(open));});
    const tabs = [...dock.querySelectorAll('[data-dock]')];
    for (const [key,panel] of [['risk',dock.querySelector('.screen-risk-section')],['layers',dock.querySelector('.screen-layers')]]) {
      panel.id = `dock-panel-${key}`; panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',`dock-tab-${key}`);
    }
    tabs.forEach(tab=>tab.setAttribute('aria-controls',`dock-panel-${tab.dataset.dock}`));
    const select = (button, focus = false) => {
      if(dock.dataset.dockView===button.dataset.dock){if(focus)button.focus();return;}
      const mobileOpen = document.getElementById('decision-screen').classList.contains('sandbox-mobile-open');
      if (this.map?.interaction !== 'inspect') this.map?.setInteraction('inspect');
      this.map?.sandbox?.setMobileOpen(mobileOpen);
      dock.dataset.dockView = button.dataset.dock;
      tabs.forEach(tab => { const active = tab === button; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
      dock.scrollTop = 0;
      if (focus) button.focus();
    };
    tabs.forEach((button,index) => {
      button.addEventListener('click', () => select(button));
      button.addEventListener('keydown', event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : event.key === 'ArrowRight' ? (index+1)%tabs.length : event.key === 'ArrowLeft' ? (index+tabs.length-1)%tabs.length : null;
        if (next !== null) { event.preventDefault(); select(tabs[next], true); }
      });
    });
  }
  async mountMap() {
    try {
      const { SpatialWorkspace } = await import("./map.js");
      if (this.disposed) return;
      this.map = new SpatialWorkspace({ observation: this.state.observation, plans: this.state.plans, sandboxState: this.state, dark: true, onRegion: (bounds) => { this.setRegion(bounds); }, onChoose: (point) => { this.onDraft(point); this.openPanel("plans"); }, onState: (value) => {
        if (this.disposed) return;
        $("screen-buildings").textContent = value.buildings ? `${value.buildings} 栋` : "暂缺";
        $("workspace-map").dataset.renderer = value.model;
      } });
      await this.map.init();
      if (!this.disposed) { this.map.observation = this.state.observation; this.map.plans = this.state.plans; this.map.updateWeather(); this.updateRegional(); this.map.focusBounds(this.state.regionalDraft?.bounds||defaultBounds(this.state.site),0); }
    } catch { if (!this.disposed) $("map-state").textContent = "地图暂不可用，天气与风险操作仍可使用。"; }
  }
  openPanel(kind) {
    if (this.disposed || (this.panel === kind && $("screen-drawer").open)) return;
    this.map?.setInteraction("inspect");
    const names = { plans: ["INTERVENTION PLANS", "干预档案 · 参数与几何比较"], risk: ["REGIONAL HEALTH RISK", "区域 × 人群 · 热健康风险研判"], evidence: ["EVIDENCE", "数据来源与方法依据"] };
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
    $("screen-risk").innerHTML = `<div class="screen-risk-index"><strong>${n(summary?.environment?.heat_index_c)}</strong><span>°C<small>热指数参考</small></span></div><h3>${e(summary?.environment?.risk_label || "暂无有效评估")}</h3><p class="screen-muted">${e(summary?.environment?.limitations?.[0] || "需要有效天气记录")}</p><span class="screen-review">${status?.protocol_reviewed && status?.approved_clauses ? "部分医学条款已审核" : "医学条款待医师审核"}</span>`;
    $("screen-plan-count").textContent = plans.length;
    $("screen-pipeline").innerHTML = this.pipeline("区域网格", valid ? "有效记录" : "待核查", valid) + this.pipeline("现场设备", "本轮有效实测未接入", false) + this.pipeline("医学依据", status ? `${status.approved_clauses}/${status.draft_clauses} 条已审核` : "状态暂缺", !!status?.approved_clauses);
    this.updateDevices();
    const points = this.state.timeline?.points?.filter((p) => p.period === "forecast") || [];
    const temperatures = points.filter((p) => p.temperature_2m != null);
    const peak = temperatures.length ? temperatures.reduce((a, b) => a.temperature_2m > b.temperature_2m ? a : b) : null;
    $("screen-peak").textContent = peak ? `预计最高 ${n(peak.temperature_2m)}°C / ${date(peak.time, true)}` : "暂无可用预报，不生成替代曲线。";
    this.updateChart(points);
    this.updateForecast();this.updateDistribution();
    if (this.map?.map?.isStyleLoaded()) { this.map.observation = o; this.map.plans = plans; this.map.updateWeather(); }
    icons();
  }
  measure(label, value, unit, symbol) { return `<div><span>${icon(symbol)}${label}</span><strong>${value}<small>${unit}</small></strong></div>`; }
  selectRegion() {
    if (!this.map?.map?.getSource("regional-area")) { toast("地图尚未就绪，可先在区域研判中填写边界。"); return; }
    $("screen-drawer").close(); this.map.beginRegion();
    if(this.map.selectingRegion) $("screen-region-state").textContent="请依次点击矩形的两个对角点；再次点击选区按钮或 Esc 取消。";
  }
  setRegion(bounds) {
    this.state.regionalDraft={ ...defaultRegional(this.state.site, this.state.regionalDraft), bounds };
    this.state.regionalReport=null; this.updateRegional();
  }
  updateRegional() {
    if (this.disposed || !$("screen-region-result")) return;
    $("screen-data-label").textContent=(this.state.regionalDraft?.data_mode||defaultDataMode(this.state.site))==='lcz_simulation'?'模拟数据 · LCZ情景':'公开气象数据 · 模型估计';
    const bounds=this.state.regionalDraft?.bounds||defaultBounds(this.state.site);
    this.map?.sandbox?.setBounds(bounds);
    const report=this.state.regionalReport||this.state.sandboxResult?.regional_report;
    if(!this.map?.selectingRegion) $("screen-region-state").textContent=`选区 ${n(bounds.west,3)}–${n(bounds.east,3)}°E / ${n(bounds.south,3)}–${n(bounds.north,3)}°N`;
    $("screen-region-result").innerHTML=report?`<div class="screen-cohort-summary"><strong>${e(report.environment.risk_label)}</strong><p>${report.cohorts.length}类人群 / ${e(gridCoverageText(report))}</p><span>${report.generation.mode==="ai_regional_evidence_selection"?"AI 证据编排已完成":"规则结果 · 可核查降级原因"}</span><small>${e(regionalValidity(report).label)}</small><small>${report.medical_review==="pending"?"医学防护条款待审核":"仅展示已审核医学条款"}</small></div>`:'';
    this.map?.setRegion(bounds,report);
    this.updatePeople(report);
  }
  updatePeople(report) {
    const host=$("screen-people");if(!host)return;
    const draft=defaultRegional(this.state.site,this.state.regionalDraft);
    const names={students:'步行通勤',athletes:'户外运动',workers:'户外作业',older_adults:'老年人群',children:'儿童人群',sensitive:'敏感人群'};
    const symbols={students:'person-standing',athletes:'activity',workers:'hard-hat',older_adults:'heart-pulse',children:'baby',sensitive:'heart-pulse'};
    const ids=report?.cohorts?.map(c=>c.id)||draft.groups;
    host.innerHTML=ids.map(id=>{
      const cohort=report?.cohorts?.find(c=>c.id===id),scenario=cohort?.context||draft.cohort_scenarios?.[id]||draft;
      const priority=report?.decision_analysis?.cohorts?.find(c=>c.group===id)?.priority;
      const label=priority?report.decision_analysis.priority_labels[priority]:'待研判';
      return `<button class="screen-person-row" type="button" data-person="${e(id)}">${icon(symbols[id]||'user')}<span>${e(names[id]||cohort?.label||id)}<small>${e(activityLabels[scenario.activity]||'未设置')} · ${e(scenario.minutes??scenario.exposure_minutes??draft.exposure_minutes)} 分钟</small></span><b data-priority="${e(priority||'pending')}">${e(label)}</b></button>`;
    }).join('');
    host.querySelectorAll('[data-person]').forEach(button=>button.addEventListener('click',()=>{this.state.selectedCohort=button.dataset.person;this.openPanel('risk');}));icons();
    const action=document.querySelector('.screen-risk-section > [data-screen-panel="risk"]');
    if(action){action.hidden=!report;action.innerHTML=icon('file-check-2')+'查看完整研判';}
    if($("screen-intervention-name"))$("screen-intervention-name").textContent=this.state.plans.length?`${this.state.plans.length} 个已保存方案 · ${this.state.plans[0].input.name}`:'尚未保存干预方案';
  }
  updateDistribution() {
    const host=$("screen-distribution");if(!host||this.disposed)return;
    const result=this.map?.sandbox?.result;
    if(result&&['utci','mrt','shade'].includes(this.map.sandbox.root.dataset.renderedHeatLayer)){
      const prefix=this.map.sandbox.mode==='baseline'?'baseline':'proposed',buckets=result.spatial_exposure.distribution[prefix];
      const palette=['#76a8c3','#a9bfbd','#dfbd90','#df995a','#c75450','#923d48'];
      host.innerHTML='<h3>UTCI 室外面积分布</h3><div class="distribution-bar" aria-hidden="true">'+buckets.map((b,i)=>`<i style="width:${b.area_pct||0}%;background:${palette[i]}"></i>`).join('')+'</div><div class="distribution-values">'+buckets.map(b=>b.area_pct?`<span>${e(b.label)}<strong>${n(b.area_pct,0)}%</strong></span>`:'').join('')+'</div><small class="screen-muted">'+e(date(result.valid_time,true))+' · '+(result.is_forecast?'预报情景':'情景推演')+'</small>';
      return;
    }
    const cells=this.map?.sandbox?.heat?.cells?.features||[];
    const levels=[['below_range','未达分级','#76a8c3'],['caution','警惕','#dfbd90'],['extreme_caution','高度警惕','#df995a'],['danger','危险','#c75450'],['extreme_danger','极度危险','#923d48']];
    const counts=levels.map(([id])=>cells.filter(f=>f.properties.risk===id).length),total=counts.reduce((a,b)=>a+b,0);
    if(!total){host.innerHTML='<h3>网格分级分布</h3><p class="screen-muted">等待有效网格</p>';return;}
    host.innerHTML='<h3>网格分级分布</h3><div class="distribution-bar" aria-hidden="true">'+levels.map((l,i)=>`<i style="width:${100*counts[i]/total}%;background:${l[2]}"></i>`).join('')+'</div><div class="distribution-values">'+levels.map((l,i)=>counts[i]?`<span>${e(l[1])}<strong>${n(100*counts[i]/total,0)}%</strong></span>`:'').join('')+'</div><small class="screen-muted">'+total+' 格有效分级 / '+cells.length+' 格模拟单元</small>';
  }
  mountForecastBrowser() {
    const footer=document.querySelector('.screen-footer');
    footer.insertAdjacentHTML('afterbegin',`<div class="screen-forecast-browser"><button id="screen-forecast-play" class="icon-button" type="button" aria-label="播放逐小时热场预报" title="播放逐小时热场预报" aria-pressed="false" disabled>${icon('play')}</button><div id="screen-forecast-value" class="screen-forecast-value" role="status">等待小时预报</div><label><span>小时预报</span><input id="screen-forecast-hour" type="range" min="0" max="0" step="1" value="0" aria-label="逐小时热场预报" disabled></label><select id="screen-forecast-dwell" aria-label="每帧展示时长" title="热场绘制完成后的展示时长，计算耗时不计入"><option value="5000">5 秒</option><option value="8000">8 秒</option><option value="12000">12 秒</option></select><button id="screen-forecast-current" class="text-button" type="button" title="返回当前天气与布局热场">当前</button>${help('按所选小时重新计算现状和方案UTCI。热场绘制完成后停留所选时长，再计算下一小时；计算时保留上一帧。已算时刻短时缓存，拆建或改变选区后失效。播放到末小时自动暂停。','预报热场说明')}</div>`);
    this.forecastIndex=0;
    this.forecastPlayback=new ForecastPlayback({render:()=>this.applyForecast(),advance:()=>{
      if(this.disposed||this.forecastIndex>=(this.forecastPoints?.length||0)-1)return false;
      this.forecastIndex++;return true;
    },changed:playing=>{
      this.forecastPlaying=playing;
      const button=$("screen-forecast-play");if(!button||this.disposed)return;
      button.setAttribute('aria-pressed',String(playing));button.innerHTML=icon(playing?'pause':'play');
      button.setAttribute('aria-label',playing?'暂停逐小时热场预报':'播放逐小时热场预报');button.title=button.getAttribute('aria-label');icons();
    }});
    const stop=()=>{clearTimeout(this.forecastDebounce);this.forecastPlayback.stop();};
    this.stopForecast=stop;
    this.forecastCleared=()=>{stop();this.forecastRevision=(this.forecastRevision||0)+1;this.forecastActive=false;this.forecastLoading=false;this.forecastError=false;this.updateForecast();};
    window.addEventListener('workspace:forecast-cleared',this.forecastCleared);
    this.forecastInvalidated=()=>{stop();this.forecastRevision=(this.forecastRevision||0)+1;this.forecastRequest=null;this.forecastLoading=false;this.forecastError=false;this.updateForecast();};
    window.addEventListener('workspace:scene-invalidated',this.forecastInvalidated);
    $("screen-forecast-hour").addEventListener('input',event=>{stop();this.forecastRevision=(this.forecastRevision||0)+1;this.forecastIndex=Number(event.target.value);this.forecastActive=true;this.updateForecast();this.forecastDebounce=setTimeout(()=>this.applyForecast(),300);});
    $("screen-forecast-play").addEventListener('click',()=>{
      if(this.forecastPlaying){stop();return;}
      clearTimeout(this.forecastDebounce);this.forecastActive=true;this.forecastPlayback.play();
    });
    $("screen-forecast-dwell").addEventListener('change',event=>this.forecastPlayback.setDwell(Number(event.target.value)));
    $("screen-forecast-current").addEventListener('click',async()=>{stop();this.forecastRevision=(this.forecastRevision||0)+1;this.forecastActive=false;this.forecastLoading=true;this.updateForecast();await this.map?.sandbox?.setForecastTime(null);if(!this.disposed){this.forecastLoading=false;this.updateForecast();}});
    this.forecastVisibility=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',this.forecastVisibility);
  }
  async applyForecast(){
    const time=this.forecastPoints?.[this.forecastIndex]?.time;
    const sandbox=this.map?.sandbox;
    if(!time||!sandbox||this.disposed)return null;
    let request=this.forecastRequest?.time===time&&this.forecastRequest.sandboxRevision===sandbox.revision?this.forecastRequest:null;
    const revision=this.forecastRevision=(this.forecastRevision||0)+1;
    this.forecastLoading=true;this.forecastError=false;this.updateForecast();
    if(!request){
      const task=sandbox.setForecastTime(time);
      request=this.forecastRequest={time,sandboxRevision:sandbox.revision,promise:task};
    }
    const result=await request.promise;
    if(this.forecastRequest===request)this.forecastRequest=null;
    if(this.disposed||revision!==this.forecastRevision)return null;
    this.forecastLoading=false;this.forecastError=!result;this.updateForecast();return result;
  }
  updateForecast() {
    if(!$("screen-forecast-hour"))return;
    const points=this.forecastPoints=this.state.timeline?.points?.filter(p=>p.period==='forecast')||[],range=$("screen-forecast-hour");
    const timelineVersion=JSON.stringify(points);
    if(this.forecastTimelineVersion&&this.forecastTimelineVersion!==timelineVersion){this.stopForecast();this.map?.sandbox?.forecastFrames.clear();}
    this.forecastTimelineVersion=timelineVersion;
    range.max=String(Math.max(0,points.length-1));range.disabled=$("screen-forecast-play").disabled=!points.length;
    if(!points.length)this.stopForecast();
    this.forecastIndex=Math.min(this.forecastIndex,Math.max(0,points.length-1));range.value=String(this.forecastIndex);
    const p=points[this.forecastIndex];
    const result=this.map?.sandbox?.result,ready=this.forecastActive&&result?.is_forecast&&Date.parse(result.valid_time)===Date.parse(p?.time);
    const loading=!!(this.forecastLoading||this.forecastActive&&this.map?.sandbox?.busy);
    const displayed=this.forecastActive&&result?.is_forecast;
    const weather=result?.weather_boundary||(!this.forecastActive?this.state.observation:null);
    const caption=this.forecastError?'计算失败，已暂停':loading?'正在计算 '+date(p?.time,true):ready?'热场已更新':'待重新计算';
    const historical=!this.forecastActive&&weather?.source_type==='historical_weather';
    const heading=displayed?date(result.valid_time,true):this.forecastActive?(loading?'等待热场':'待计算热场'):historical?'历史情景 '+date(weather.observed_at,true):'当前热场';
    $("screen-forecast-value").innerHTML=p?`${e(heading)}<small>${this.forecastActive&&(loading||!displayed)?e(caption):`${n(weather?.temperature_c)} °C / ${n(weather?.relative_humidity_pct,0)}% · ${this.forecastActive?caption:'可播放预报'}`}</small>`:'暂无小时预报<small>可刷新后重试</small>';
    document.querySelector('.screen-forecast-browser').setAttribute('aria-busy',String(loading));
    $('decision-screen').classList.toggle('forecast-active',!!this.forecastActive);
    range.setAttribute('aria-valuetext',p?`目标 ${date(p.time)}，${loading?'正在计算；':''}地图显示 ${heading}`:'暂无预报');
    if(p)this.chart?.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:this.forecastIndex});
    else this.chart?.dispatchAction({type:'hideTip'});
  }
  pipeline(label, value, ready) { return `<div class="screen-pipeline-row ${ready ? "ready" : ""}"><i></i><span>${label}</span><small>${e(value)}</small></div>`; }
  updateDevices(){
    if(this.disposed)return;
    const row=$("screen-pipeline")?.querySelectorAll('.screen-pipeline-row')[1],devices=this.state.fieldDevices?.devices;
    if(!row||!devices)return;
    const online=devices.filter(d=>d.status==='online').length;
    row.classList.toggle('ready',online>0);row.querySelector('small').textContent=online?online+'/'+devices.length+' 台有效读数':devices.every(d=>d.status==='offline')?devices.length+' 台已接入 · 离线':'设备已接入 · 等待有效读数';
  }
  async updateChart(points) {
    const revision = this.chartRevision = (this.chartRevision || 0) + 1;
    if (!points.length) { this.chartObserver?.disconnect(); this.chart?.dispose(); this.chart = null; $("screen-trend").textContent = this.state.loading ? "正在获取小时天气…" : "预报暂缺"; return; }
    const [{ init, use }, { LineChart }, { GridComponent, TooltipComponent }, { CanvasRenderer }] = await Promise.all([import("echarts/core"), import("echarts/charts"), import("echarts/components"), import("echarts/renderers")]);
    if (this.disposed || revision !== this.chartRevision) return;
    use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
    if (!this.chart) {
      this.chartObserver?.disconnect();
      $("screen-trend").replaceChildren(); this.chart = init($("screen-trend"));
      this.chartObserver = new ResizeObserver(() => { cancelAnimationFrame(this.chartResize); this.chartResize=requestAnimationFrame(()=>{if(!this.disposed)this.chart?.resize();}); }); this.chartObserver.observe($("screen-trend"));
    }
    this.chart.setOption({ animation: !matchMedia("(prefers-reduced-motion: reduce)").matches, animationDuration: 350, grid: { left: 25, right: 25, top: 10, bottom: 22 }, tooltip: { trigger: "axis", confine: true }, xAxis: { type: "category", data: points.map((p) => date(p.time, true)), boundaryGap: false, axisLabel: { color: "#607782", fontSize: 10, formatter: (v) => v.split(" ").pop() }, axisLine: { lineStyle: { color: "#4a5a66" } }, axisTick: { show: false } }, yAxis: [{ type: "value", scale: true, axisLabel: { color: "#607782", fontSize: 10 }, splitLine: { lineStyle: { color: "#d6dfe2", type: "dashed" } } }, { type: "value", min: 0, max: 100, axisLabel: { color: "#607782", fontSize: 10 }, splitLine: { show: false } }], series: [{ name: "气温 °C", type: "line", data: points.map((p) => p.temperature_2m), connectNulls: false, showSymbol: false, lineStyle: { color: "#bd514b", width: 2 }, itemStyle: { color: "#bd514b" } }, { name: "湿度 %", type: "line", yAxisIndex: 1, data: points.map((p) => p.relative_humidity_2m), connectNulls: false, showSymbol: false, lineStyle: { color: "#76a8c3", width: 1.5, type: "dashed" }, itemStyle: { color: "#76a8c3" } }] });
  }
  destroy() { this.disposed = true; this.forecastPlayback?.stop();document.removeEventListener('pointerdown',this.toolsOutside); window.removeEventListener('workspace:selection',this.selectionListener); if ($("delete-dialog")) document.body.append($("delete-dialog")); if ($("toast")) document.body.append($("toast")); clearInterval(this.clockTimer);clearTimeout(this.forecastDebounce);document.removeEventListener('visibilitychange',this.forecastVisibility);window.removeEventListener('workspace:forecast-cleared',this.forecastCleared);window.removeEventListener('workspace:scene-invalidated',this.forecastInvalidated);window.removeEventListener('workspace:heat',this.heatListener); cancelAnimationFrame(this.chartResize); this.chartObserver?.disconnect(); this.chart?.dispose(); this.map?.destroy(); document.removeEventListener("fullscreenchange", this.fullscreenListener); window.removeEventListener("workspace:layout-report",this.layoutReportListener); window.removeEventListener("workspace:devices",this.devicesListener); }
}
