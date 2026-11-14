import { icons, icon, help, escape as e, numeric as n, date, download, request, empty } from "./ui.js";
import { isCompetition, assessmentHref } from "./edition.js";
import "./regional.css";
import { renderDecisionAnalysis, renderCohortPlan } from './decision-view.js';
import { defaultBounds, defaultDataMode, defaultRegional, gridCoverageText, regionalValidity, activityLabels, generationReasons } from './regional-state.js';

const groups = { students: "一般学生 / 步行人群", athletes: "户外运动人群", workers: "户外作业人员", older_adults: "老年人群", children: "儿童人群", sensitive: "其他需重点关注人群" };
const labels = { complete: "采样记录齐全", partial: "部分采样缺失", unavailable: "暂无有效采样", time_mismatch: "样本时刻不一致" };
const reason = generationReasons;

export function mountRegional(root, { state, onResult = () => {}, onSelect = null }) {
  if (!state.regionalReport && state.sandboxResult?.regional_report) state.regionalReport = state.sandboxResult.regional_report;
  const $ = (id) => root.querySelector(`#${id}`);
  const input = defaultRegional(state.site, state.regionalDraft);
  let disposed = false, controller, draftKey, selectedCohort = state.selectedCohort;
  const lifetime = new AbortController();
  root.innerHTML = `<section class="regional-workspace"><div class="risk-mode-tabs"><button type="button" class="active" id="regional-tab" aria-pressed="true">${icon("map")}区域 × 人群研判</button><button type="button" id="self-check-tab" aria-pressed="false">${icon("activity")}个人自查（辅助）</button></div><div id="regional-view"><div class="regional-intro heading-with-help"><h2>区域与人群</h2>${help("选择区域、人群、活动与暴露时长后开始研判。AI依据气象、热暴露与专业资料生成分析；医学处置仅引用适用的已审核条款。", "区域人群研判帮助")}</div><div class="regional-layout"><form id="regional-form" class="regional-form"><h3 class="heading-with-help">研判范围${help("可输入四至坐标或使用地图两点选区。校园按数字化边界裁剪；重复气象源网格不构成独立空间证据。", "研判范围帮助")}</h3><div class="regional-presets"><button type="button" data-region-preset="campus">某校园</button><button type="button" data-region-preset="zhongyuan">某街区</button>${onSelect ? '<button type="button" id="regional-map-select">地图两点选区</button>' : ''}</div><label class="field">场景名称<select id="region-kind"><option value="campus">某校园</option><option value="neighborhood">某街区</option></select></label><div class="regional-bounds">${[["west","西界 °E",113.4,113.9],["east","东界 °E",113.4,113.9],["south","南界 °N",34.6,34.95],["north","北界 °N",34.6,34.95]].map(([key,label,min,max]) => `<label class="field">${label}<input id="bound-${key}" type="number" step="any" min="${min}" max="${max}" required></label>`).join("")}</div><label class="field">资料时段<select id="region-mode"><option value="current">当前区域网格</option><option value="history">2024-06-12 14:00 历史再分析案例</option></select></label><h3>目标人群</h3><fieldset class="regional-groups"><legend class="sr-only">可选择多类人员</legend>${Object.entries(groups).map(([id,label])=>`<label><input type="checkbox" name="regional-group" value="${id}">${label}</label>`).join("")}</fieldset><h3>活动情景</h3><label class="field">共同活动情景<select id="region-activity"><option value="rest">静坐 / 休息</option><option value="walk">户外步行</option><option value="run">跑步 / 运动</option><option value="work">户外劳动</option></select></label><div class="field-row"><label class="field">暴露时长（分钟）<input id="region-duration" type="number" min="1" max="480" step="1" required></label><label class="field">环境条件<select id="region-exposure"><option value="unknown">现场未核实</option><option value="shade">阴凉、轻风</option><option value="sun">阳光直射</option></select></label></div><div class="context-help-row"><label class="regional-ai"><input id="region-ai" type="checkbox">AI辅助研判</label>${help("关闭后使用固定规则基线。AI仅结合气象、人群情景与证据，不生成疾病确诊或处方；此页不收集病史和身份信息。", "AI辅助研判说明")}</div><p id="regional-error" class="inline-error" role="alert" hidden></p><button id="regional-submit" class="button primary full" type="submit">${icon("cpu")}开始区域人群研判</button></form><div class="regional-output"><div class="section-header"><div><p class="eyebrow">REGIONAL HEALTH INTELLIGENCE</p><h3>区域热健康风险研判</h3></div><div class="regional-report-actions"><button class="icon-button" id="regional-export" title="导出完整报告" aria-label="导出完整报告" disabled>${icon("download")}</button><button class="icon-button" id="regional-print" title="打印报告" aria-label="打印报告" disabled>${icon("printer")}</button></div></div><div id="regional-result"></div></div></div></div><div id="self-check-view" hidden></div></section>`;
  $("region-mode").closest('label').insertAdjacentHTML('beforebegin','<label class="field">数据模式<select id="region-data-mode"><option value="live">真实公开气象网格</option><option value="lcz_simulation">LCZ模拟网格 · 非实测、未标定</option></select></label><label class="field">LCZ模拟间距<select id="region-grid-resolution"><option value="30">30 m</option><option value="50">50 m</option><option value="100">100 m</option></select></label>');


  function read() { const selected=[...root.querySelectorAll('[name=regional-group]:checked')].map(x=>x.value);return { bounds: Object.fromEntries(["west","east","south","north"].map(k=>[k,Number($("bound-"+k).value)])), area_kind: $("region-kind").value, mode: $("region-mode").value, data_mode: $("region-data-mode").value, grid_resolution_m:Number($("region-grid-resolution").value), groups: selected, activity: $("region-activity").value, exposure_minutes: Number($("region-duration").value), exposure: $("region-exposure").value, use_ai: $("region-ai").checked, cohort_scenarios: Object.fromEntries([...root.querySelectorAll('[data-cohort-override]:checked')].filter(node=>selected.includes(node.dataset.cohortOverride)).map(node=>[node.dataset.cohortOverride,{activity:$("cohort-activity-"+node.dataset.cohortOverride).value,exposure_minutes:Number($("cohort-duration-"+node.dataset.cohortOverride).value)}])) }; }
  function fill(v) { for (const [key,value] of Object.entries(v.bounds)) $("bound-"+key).value=value; $("region-kind").value=v.area_kind; $("region-mode").value=v.mode; $("region-data-mode").value=v.area_kind==='campus'?(v.data_mode||defaultDataMode('campus')):'live'; $("region-grid-resolution").value=String(v.grid_resolution_m||30); syncDataControls(); $("region-activity").value=v.activity; $("region-duration").value=v.exposure_minutes; $("region-exposure").value=v.exposure; $("region-ai").checked=v.use_ai; root.querySelectorAll('[name=regional-group]').forEach(x=>x.checked=v.groups.includes(x.value)); }
  function syncDataControls(){const campus=$("region-kind").value==='campus';if(!campus)$("region-data-mode").value='live';$("region-data-mode").querySelector('[value="lcz_simulation"]').disabled=!campus;$("region-grid-resolution").disabled=$("region-data-mode").value!=='lcz_simulation';}
  $("region-kind").addEventListener('change',syncDataControls);$("region-data-mode").addEventListener('change',syncDataControls);
  const settings=document.createElement('aside');settings.className='regional-settings';
  settings.innerHTML=`<figure class="regional-scene"><img src="${import.meta.env.BASE_URL}assets/workspace-media/d-context.png" alt="模拟校园空间预览" loading="lazy"><figcaption>空间场景预览 · 非本次计算结果</figcaption></figure><details class="regional-parameters" open><summary>本次评估参数</summary></details><section id="regional-evidence-aside"></section>`;
  const parameters=settings.querySelector('.regional-parameters');parameters.append($("regional-form"));
  root.querySelector('.regional-layout').append(settings);
  const context=document.createElement('div');context.className='regional-context';context.setAttribute('aria-label','本次研判上下文');
  root.querySelector('.regional-layout').before(context);
  root.querySelector('.regional-intro').hidden=true;
  const renderBase = () => {
    const r=state.regionalReport?{...state.regionalReport,samples:state.regionalReport.samples.slice(0,80)}:null;
    $("regional-export").disabled=$("regional-print").disabled=!r;
    if (!r) { $("regional-result").innerHTML=empty("等待区域研判", "设置区域和人群后开始研判。", "map"); return; }
    const selectedFacts=r.interpretation.fact_ids.map(id=>r.facts.find(x=>x.id===id)).filter(Boolean), selectedActions=r.interpretation.action_ids.map(id=>r.management_checks.find(x=>x.id===id)).filter(Boolean);
    $("regional-result").innerHTML=`<div class="regional-result-banner"><div><p>${e(r.area.label)} / ${r.case_type==="historical_reanalysis"?"历史再分析案例（非当前）":"当前模型资料"}</p><h2>${e(r.environment.risk_label)}</h2><span>有效采样最高环境等级 · 非个体疾病诊断</span></div><div><strong>${n(r.environment.heat_index_c)}</strong><small>°C 热指数参考</small></div></div><p class="notice">${e(regionalValidity(r).label)} · 报告生成 ${date(r.created_at)} 北京时间</p><div class="regional-stat-strip"><span>选区约 <b>${n(r.area.area_km2_approx,2)}</b> km²</span><span>可用采样 <b>${r.coverage.usable_samples}/5</b></span><span>独立模型网格 <b>${r.coverage.unique_model_grids}</b></span></div><p class="notice">${e(labels[r.coverage.status])}。${e(r.coverage.note)}</p><section class="regional-section"><div class="section-header"><h3>AI 区域证据研判</h3><span class="badge ${r.generation.mode==="ai_regional_evidence_selection"?"green":"amber"}">${r.generation.mode==="ai_regional_evidence_selection"?"AI 实际调用 · 证据编排":"规则降级 / 基线"}</span></div>${r.generation.reason?`<p class="muted">${e(reason[r.generation.reason]||r.generation.reason)}</p>`:''}<ol class="regional-evidence">${selectedFacts.map(f=>`<li>${e(f.text)}<small>[${e(f.source_ids.join(", "))}]</small></li>`).join("")}</ol></section><section class="regional-section"><div class="heading-with-help"><h3>目标人群与医学防护</h3>${help("各人群按自己的活动、时长及关注因素分别研判；此处排列不代表患病风险排名。", "人群结果阅读说明")}</div><p class="field-help">环境等级 ≠ 人群健康风险等级</p><div class="regional-cohorts">${r.cohorts.map(c=>`<article><div><h4>${e(c.label)}</h4><span class="badge">${e(r.environment.risk_label)}</span></div><p>${e(c.consideration)}</p><p>${e(c.assessment)} [WHO-HEAT]</p>${c.medical_advice.length?`<ul>${c.medical_advice.map(a=>`<li>${e(a.text)} [${e(a.citation_id)}]</li>`).join("")}</ul>`:'<p class="regional-pending">暂无适用的已审核医学条款；不输出无依据的处置建议。</p>'}</article>`).join("")}</div></section><section class="regional-section"><h3>场地管理核查项</h3><ol class="regional-evidence">${selectedActions.map(a=>`<li>${e(a.text)}<small>[${e(a.source_ids.join(", "))}]</small></li>`).join("")}</ol></section><section class="regional-section"><div class="heading-with-help"><h3>采样与依据</h3>${help("导出报告可查看请求位置、实际网格、观测编号及原始响应摘要，并按编号回查。", "采样追溯说明")}</div><div class="table-scroll"><table><thead><tr><th>请求点</th><th>时间 / 北京时间</th><th>气温 / 湿度</th><th>环境等级</th></tr></thead><tbody>${r.samples.slice(0,80).map(s=>`<tr><td>${e(s.id)}</td><td>${date(s.observation?.observed_at,true)}</td><td>${s.observation?`${n(s.observation.temperature_c)}°C / ${n(s.observation.relative_humidity_pct,0)}%`:e(s.error)}</td><td>${e(s.environment.risk_label)}</td></tr>`).join("")}</tbody></table></div><p id="regional-sample-note" class="field-help" hidden></p><div class="regional-sources">${r.sources.map(s=>`<a href="${e(s.url)}" target="_blank" rel="noopener">[${e(s.id)}] ${e(s.title)} · ${e(s.publisher)}</a>`).join("")}</div>${r.citations.map(c=>`<details><summary>[${e(c.id)}] 已审核条款来源</summary><p>${e(c.location)}</p><blockquote>${e(c.quote)}</blockquote></details>`).join("")}<p class="notice">${e(r.medical_message)}</p><details class="regional-audit"><summary>方法、限制与报告摘要</summary><ul>${[...r.environment.limitations,...r.limitations,r.privacy].map(l=>`<li>${e(l)}</li>`).join("")}</ul><p>${e(r.regional_version)} / ${e(r.rules_version)} / ${e(r.knowledge_version)}</p><p>${e(r.report_sha256)}</p></details></section>`; decorateCohorts();
  };
  function invalidate(force=false) {
    const draft=read(),key=JSON.stringify(draft);
    if(force!==true&&key===draftKey)return;
    draftKey=key;controller?.abort();controller=null;state.regionalDraft=draft;state.regionalReport=null;
    $("regional-error").hidden=true;onResult(null);render();
    $("regional-submit").disabled=false;$("regional-submit").textContent="开始区域人群研判";
  }
  $("region-exposure").closest('.field-row').insertAdjacentHTML('afterend',`<details class="cohort-scenario-editor"><summary>分别设置人群活动与暴露${help("初始预设为步行三十分钟、运动六十分钟、作业一百二十分钟，均可修改。勾选的人员使用各自设置，未勾选时沿用共同情景。", "人群活动设置说明")}</summary>${Object.entries(groups).map(([id,label])=>`<div class="cohort-scenario-row"><label><input type="checkbox" data-cohort-override="${id}">${label}</label><div class="field-row"><label class="field">活动<select id="cohort-activity-${id}" disabled>${Object.entries(activityLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label class="field">分钟<input id="cohort-duration-${id}" type="number" min="1" max="480" step="1" value="30" disabled></label></div></div>`).join('')}</details>`);
  for(const node of root.querySelectorAll('[data-cohort-override]')){const id=node.dataset.cohortOverride,scenario=input.cohort_scenarios?.[id];node.checked=!!scenario;$("cohort-activity-"+id).value=scenario?.activity||input.activity;$("cohort-duration-"+id).value=scenario?.exposure_minutes||input.exposure_minutes;$("cohort-activity-"+id).disabled=$("cohort-duration-"+id).disabled=!node.checked;node.addEventListener('change',()=>{$("cohort-activity-"+id).disabled=$("cohort-duration-"+id).disabled=!node.checked;});}
  function decorateCohorts(){const r=state.regionalReport;if(!r)return;root.querySelectorAll('.regional-cohorts article').forEach((article,index)=>{article.innerHTML=renderCohortPlan(r.cohorts[index],r);});const note=root.querySelector('.regional-section:has(.regional-cohorts)>.field-help');if(note)note.remove();}
  function renderCohortOverview(report) {
    const articles=[...root.querySelectorAll('.regional-cohorts article')];
    if(!articles.length)return;
    if(!report.cohorts.some(c=>c.id===selectedCohort))selectedCohort=report.cohorts[0].id;
    const summary=document.createElement('div');summary.className='cohort-overview';summary.setAttribute('role','group');summary.setAttribute('aria-label','分别查看人群研判结果');
    summary.innerHTML=report.cohorts.map(c=>{
      const decision=report.decision_analysis?.cohorts?.find(d=>d.group===c.id),label=c.activity_plan?.label||(decision?report.decision_analysis.priority_labels[decision.priority]:'已生成情景研判');
      return `<button type="button" data-cohort="${e(c.id)}" aria-pressed="${c.id===selectedCohort}"><strong>${e(c.label)}</strong><b>${e(label)}</b><small>${e(activityLabels[c.context.activity])} · ${c.context.minutes} 分钟</small></button>`;
    }).join('');
    const select=id=>{selectedCohort=id;articles.forEach((article,i)=>article.hidden=report.cohorts[i].id!==id);summary.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cohort===id)));};
    summary.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>select(button.dataset.cohort)));
    const cohortList=root.querySelector('.regional-cohorts'),people=cohortList.closest('.regional-section');
    cohortList.before(summary);
    root.querySelector('.regional-result-banner').after(people);
    select(selectedCohort);
  }
  const render=()=>{
    renderBase();renderLayoutExposure();decorateDataMode();const r=state.regionalReport;
    parameters.open=!r;
    context.innerHTML=`<div>${icon('focus')}<span>评估区域<strong>${e(r?.area.label||($("region-kind").value==='campus'?'某校园':'某街区'))}</strong></span></div><div>${icon('clock-3')}<span>场景时段<strong>${r?e(r.baseline?.observed_at?date(r.baseline.observed_at,true):date(r.created_at,true)):$("region-mode").value==='history'?'历史高温案例':'当前气象边界'}</strong></span></div><div>${icon('thermometer')}<span>天气参考<strong>${r?n(r.environment.heat_index_c)+' °C 热指数':'等待研判'}</strong></span></div><span class="badge">${r?.data_mode==='lcz_simulation'?'模拟数据':$("region-data-mode").value==='lcz_simulation'?'LCZ模拟':'公开气象'}</span>`;
    const side=$("regional-evidence-aside");
    side.innerHTML=r?`<h3>检索依据</h3>${r.sources.map(s=>`<a href="${e(s.url)}" target="_blank" rel="noopener"><strong>${e(s.title)}</strong><small>${e(s.publisher)}</small></a>`).join('')}<a href="#evidence" class="text-button">核查原文与版本 ${icon('arrow-up-right')}</a>`:'<h3>数据与依据</h3><p class="field-help">生成研判后显示本次引用。</p><a href="#evidence" class="text-button">查看来源库 '+icon('arrow-up-right')+'</a>';
    if(r){
      const analysis=document.createElement('details');analysis.className='regional-ai-details';analysis.innerHTML='<summary>AI综合研判与建筑建议</summary>'+renderDecisionAnalysis(r);
      root.querySelector('.regional-result-banner')?.insertAdjacentElement('afterend',analysis);
      renderCohortOverview(r);
      const result=$('regional-result'),methods=document.createElement('details');
      methods.className='regional-method-details';methods.innerHTML='<summary>数据质量、方法与审核状态</summary>';
      for(const node of [...result.children]){
        if(node.matches('p.notice'))methods.append(node);
        if(node.matches('.regional-section')&&node.querySelector('h3')?.textContent!=='目标人群与医学防护'){
          const fold=document.createElement('details');fold.className='regional-support-details';
          const heading=node.querySelector('h3');fold.innerHTML='<summary>'+e(heading?.textContent||'报告依据')+'</summary>';
          node.before(fold);heading?.remove();fold.append(node);
        }
      }
      result.append(methods);
      const mainTitle=result.querySelector('.regional-section:has(.regional-cohorts) h3');if(mainTitle)mainTitle.textContent='人群活动与防护安排';
    }icons();
  };
  function decorateDataMode(){
    const r=state.regionalReport;if(!r)return;
    const count=root.querySelector('.regional-stat-strip span:nth-child(2) b');if(count)count.textContent=r.coverage.usable_samples+'/'+r.coverage.requested_samples;
    const grid=root.querySelector('.regional-stat-strip span:nth-child(3)');if(grid)grid.textContent=gridCoverageText(r);
    if(r.samples.length>80){const note=$('regional-sample-note');note.hidden=false;note.textContent='仅列前80格 / 共'+r.samples.length+'格；完整数据见导出报告。';}
    if(r.data_mode!=='lcz_simulation')return;
    const caption=root.querySelector('.regional-result-banner p');if(caption)caption.textContent=r.area.label+' / '+(r.baseline?.source_type==='historical_weather'?'历史边界（非当前）':'当前气象边界')+' · LCZ模拟 · 非实测、未标定';
    const stats=root.querySelector('.regional-stat-strip');if(stats)stats.insertAdjacentHTML('afterend','<p class="notice">LCZ模拟 '+r.coverage.simulated_grid_cells+' 格 / '+r.resolution_m+' m · 气象边界 '+date(r.baseline.observed_at)+' 北京时间 · 快照 '+e(r.snapshot_sha256.slice(0,12))+'</p>');

  }
  function renderLayoutExposure(){
    const s=state.regionalReport?.layout_exposure?.summary;
    const banner=root.querySelector('.regional-result-banner');
    if(!s||!banner)return;
    banner.insertAdjacentHTML('afterend','<section class="regional-section"><h3>布局沙盘 · 辐射热暴露</h3><p>现状 / 方案 UTCI：'+n(s.baseline_utci_c)+' / '+n(s.proposed_utci_c)+' °C；'+e(s.baseline_stress)+' → '+e(s.proposed_stress)+'</p><p>UTCI≥32°C可比室外面积：'+n(s.baseline_strong_heat_area_pct)+'% → '+n(s.proposed_strong_heat_area_pct)+'%。</p><p class="notice">热指数与UTCI适用条件不同，未达热指数高温分级不代表日晒下无热应激；布局模型尚未实测标定，不是患病概率或医疗分级。</p></section>');
  }
  fill(input); draftKey=JSON.stringify(read()); render();
  const validityTimer = setInterval(() => { if (state.regionalReport) render(); }, 60000);
  $("regional-form").addEventListener("input",invalidate); $("regional-form").addEventListener("change",invalidate);
  root.querySelectorAll('[data-region-preset]').forEach(button=>button.addEventListener("click",()=>{const v=read();v.bounds=defaultBounds(button.dataset.regionPreset);v.area_kind=button.dataset.regionPreset==="campus"?"campus":"neighborhood";v.data_mode=defaultDataMode(button.dataset.regionPreset);fill(v);invalidate();}));
  $("regional-map-select")?.addEventListener("click",()=>{state.regionalDraft=read();onSelect();});
  $("regional-form").addEventListener("submit",async event=>{event.preventDefault();if(disposed||controller)return;const body=read(), b=body.bounds;$("regional-error").hidden=true;if(!body.groups.length||b.east<=b.west||b.north<=b.south||b.east-b.west>0.1||b.north-b.south>0.1){$("regional-error").textContent="请选择至少一类人群，确认东西南北界顺序，且经纬跨度均不超过0.1度。";$("regional-error").hidden=false;return;}invalidate(true);controller=new AbortController();const active=controller;$("regional-submit").disabled=true;$("regional-submit").textContent="正在采样并研判…";try{const report=await request("/api/weather/aic/regional-assess",{json:body,signal:active.signal,timeoutMs:55000});if(disposed||active.signal.aborted||controller!==active)return;state.regionalReport=report;onResult(report);render();}catch(error){if(!disposed&&!active.signal.aborted&&controller===active){$("regional-error").textContent=error.name==="TimeoutError"?"区域研判超时，请稍后重试，未生成替代结论。":error.message;$("regional-error").hidden=false;}}finally{if(!disposed&&controller===active){controller=null;$("regional-submit").disabled=false;$("regional-submit").textContent="开始区域人群研判";}}});
  const tabs=(personal)=>{$("regional-view").hidden=personal;$("self-check-view").hidden=!personal;for(const [id,on]of[["regional-tab",!personal],["self-check-tab",personal]]){$(id).classList.toggle("active",on);$(id).setAttribute("aria-pressed",String(on));}if(personal&&!$("risk-frame"))$("self-check-view").innerHTML=`<p class="notice">辅助自查 · 危险症状独立升级，不等待AI</p><iframe id="risk-frame" src="${assessmentHref}?embed=1&site=${state.site}&edition=${isCompetition?"competition":"platform"}" title="个人热风险辅助自查" style="width:100%;border:0;height:1450px"></iframe>`;};
  $("regional-tab").addEventListener("click",()=>tabs(false));$("self-check-tab").addEventListener("click",()=>tabs(true));
  window.addEventListener("message",event=>{const frame=$("risk-frame");if(event.origin===location.origin&&event.source===frame?.contentWindow&&event.data?.type==="aic-height")frame.style.height=`${Math.min(15000,Math.max(800,Number(event.data.height)||1450))}px`;},{signal:lifetime.signal});
  $("regional-export").addEventListener("click",()=>state.regionalReport&&download(state.regionalReport,"microclimate-area-cohort-report.json"));
  $("regional-print").addEventListener("click",()=>{if(!state.regionalReport)return;document.body.classList.add("printing-regional");window.print();document.body.classList.remove("printing-regional");});
  window.addEventListener("beforeprint",()=>{if(state.regionalReport&&!$("regional-view").hidden)document.body.classList.add("printing-regional");},{signal:lifetime.signal});
  window.addEventListener("afterprint",()=>document.body.classList.remove("printing-regional"),{signal:lifetime.signal});
  icons();return()=>{disposed=true;clearInterval(validityTimer);controller?.abort();lifetime.abort();};
}
