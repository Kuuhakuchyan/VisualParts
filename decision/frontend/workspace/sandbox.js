import { icon, icons, help, escape as e, numeric as n, date, request, download, toast } from './ui.js';
import { isCompetition } from './edition.js';
import { defaultBounds, defaultDataMode, defaultRegional, isCurrentObservationTime, regionalWeatherKey, gridCoverageText, activityLabels, generationReasons } from './regional-state.js';
import './sandbox.css';
import proj4 from 'proj4';
import { CollectionWorkspace } from './collection.js';
import './collection.css';
import { renderDecisionAnalysis } from './decision-view.js';
import { thermalPresentation, thermalResultView, temperatureColors, differenceColors, differenceTicks, anomalyColors, weatherOnlyEstimate } from './thermal-presentation.js';
import { lczColorExpression, lczCompositionText, renderLczSummary } from './lcz-view.js';
import { ForecastFrames, waitForHeatRender } from './forecast-frames.js';
import { layoutImpact } from './layout-impact.js';

const clone = value => JSON.parse(JSON.stringify(value));
const blank = (area_kind = 'campus') => ({ area_kind, name: '布局方案', additions: [], removed_ids: [] });
const collection = features => ({ type: 'FeatureCollection', features });
const colors = ['interpolate', ['linear'], ['get', 'value'], -15, '#417da5', 9, '#76a8c3', 26, '#d8e4e7', 32, '#e5c095', 38, '#df995a', 46, '#c75450', 60, '#923d48'];
const mrtColors = ['interpolate', ['linear'], ['get', 'value'], 0, '#417da5', 20, '#76a8c3', 40, '#e5c095', 60, '#df995a', 80, '#c75450'];
const riskLevels = [
  ['below_range', '未达高温分级', '#76a8c3'], ['caution', '警惕', '#dfbd90'],
  ['extreme_caution', '高度警惕', '#df995a'], ['danger', '危险', '#c75450'],
  ['extreme_danger', '极度危险', '#923d48'],
];
const riskColors = ['match', ['get', 'risk'], ...riskLevels.flatMap(([code,,color]) => [code,color]), '#9ca8ab'];
const deltaText = value => !Number.isFinite(value)?'—':value===0?'0.00':(value>0?'+':'')+n(value,Math.abs(value)<0.0001?6:Math.abs(value)<0.01?4:2);
const effectLabels = {no_edits:'当前方案未拆建',no_comparable_cells:'没有有效的同位置室外对比',night_no_shortwave:'气象风险已估测 · 拆建热增量未估计',no_resolved_change:'当前范围及气象下未检出≥0.001°C的变化',changed:'已计算局部变化'};

export function additionFeature(a) {
  const projection='+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs';
  const [cx,cy]=proj4('EPSG:4326',projection,[a.longitude,a.latitude]);
  const angle = a.rotation_deg*Math.PI/180;
  const ring = [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([sx,sy]) => {
    const x=sx*a.width_m/2,y=sy*a.depth_m/2;
    return proj4(projection,'EPSG:4326',[cx+x*Math.cos(angle)+y*Math.sin(angle),cy-x*Math.sin(angle)+y*Math.cos(angle)]);
  });
  return {type:'Feature',id:a.id,properties:{id:a.id,name:'拟建建筑',height_m:a.height_m,render_height_m:a.height_m,state:'new'},geometry:{type:'Polygon',coordinates:[ring]}};
}

export class LayoutSandbox {
  constructor(workspace,state) {
    this.workspace=workspace;this.map=workspace.map;this.state=state;this.base=workspace.buildingData;
    this.areaKind=state.site==='campus'?'campus':'neighborhood';
    this.forecastFrames=new ForecastFrames();
    this.scene=clone((state.sandboxScene?.area_kind||'campus')===this.areaKind ? state.sandboxScene||blank(this.areaKind) : blank(this.areaKind));
    this.scene.area_kind=this.areaKind;this.undo=[];this.redo=[];this.mode='edit';this.presentationRevision=0;
    this.result=state.sandboxResult||null;this.revision=0;this.lifetime=new AbortController();this.contextKey=JSON.stringify(state.regionalDraft||{});
    this.bounds=state.regionalDraft?.bounds||defaultBounds(state.site);
    state.regionalDraft={...this.regional(),data_mode:state.regionalDraft?.data_mode||defaultDataMode(state.site),grid_resolution_m:state.regionalDraft?.grid_resolution_m||30};
    this.contextKey=JSON.stringify(state.regionalDraft);
    if(this.result?.schema_version!=="solar-layout-screening-1.5"||this.result?.is_forecast){this.result=null;state.sandboxResult=null;}
    if(this.result){const current=this.regional(),prior=this.result.input.regional;
      if(JSON.stringify(this.result.scene)!==JSON.stringify(this.scene)||Object.keys(current).some(key=>key!=='use_ai'&&JSON.stringify(current[key])!==JSON.stringify(prior[key]))){
        if(this.result.regional_report?.report_sha256===state.regionalReport?.report_sha256)state.regionalReport=null;
        this.result=null;state.sandboxResult=null;
      }
    }
  }
  mount() {
    const host=document.querySelector('.screen-right')||document.querySelector('.map-inspector');
    if(!host)return;
    this.root=document.createElement('section');this.root.className='layout-sandbox screen-section';
    const modes=[['baseline','现状'],['edit','编辑'],['proposed','方案'],['delta','差值']].map(([id,label])=>'<button type="button" data-mode="'+id+'" aria-pressed="'+(id==='edit')+'" aria-controls="'+(id==='edit'?'sb-editor':'sb-view-panel')+'">'+label+'</button>').join('');
    const tools=[['inspect','map-pin','标记地点'],['select','mouse-pointer-2','选择建筑'],['add','plus','建造建筑'],['move','move','移动拟建'],['remove','trash-2','拟拆除']].map(([id,i,label])=>'<button class="sandbox-tool" type="button" data-operation="'+id+'" title="'+label+'" aria-label="'+label+'" aria-pressed="'+(id==='inspect')+'">'+icon(i)+'<span>'+label+'</span></button>').join('');
    const dims=[['width','宽度 m',20,2,150],['depth','进深 m',20,2,150],['height','高度 m',18,2,120],['rotation','朝向 °',0,0,360]].map(([id,label,value,min,max])=>'<label class="field">'+label+'<input id="sb-'+id+'" type="number" value="'+value+'" min="'+min+'" max="'+max+'" step="1" required></label>').join('');
    this.root.innerHTML='<div class="section-header"><div class="heading-with-help"><h2>布局决策沙盘</h2>'+help('现状查看原建筑；编辑模式进行拆建；方案查看调整后的布局；差值比较同一气象边界下的前后结果。拆建后会重新计算，未完成时不显示旧结果。','沙盘模式帮助')+'</div><span class="badge">探索性模型</span></div>'+
      '<div class="sandbox-modes" role="group" aria-label="沙盘显示模式">'+modes+'</div>'+
      '<button type="button" class="text-button sandbox-return-heat" id="sb-show-weather" title="退出当前地图操作，返回气象热图；保留建筑方案与计算结果">'+icon('thermometer')+'返回气象热图</button>'+
      '<section id="sb-view-panel" class="sandbox-view-panel" hidden><div class="heading-with-help"><h3 id="sb-view-title"></h3><span id="sb-view-description"></span></div><p id="sb-view-state" role="status"></p><button type="button" class="text-button" id="sb-enter-edit">'+icon('pencil')+'编辑布局</button></section>'+
      '<div id="sb-editor"><div class="sandbox-tools" role="group" aria-label="编辑工具">'+tools+'</div>'+
      '<form id="sb-form"><h3 id="sb-tool-title">地点标记</h3><div class="context-help-row"><p class="sandbox-selection" id="sb-selection">地点标记模式</p><span id="sb-tool-help"></span></div><div class="sandbox-dimensions" hidden>'+dims+'</div><div class="sandbox-confirm"><button class="button" id="sb-confirm" type="submit" disabled>'+icon('check')+'确认操作</button><button class="button" id="sb-edit" type="button" disabled>'+icon('sliders-horizontal')+'更新建筑参数</button></div></form>'+
      '<div class="sandbox-history" role="group" aria-label="方案编辑历史"><button class="icon-button" id="sb-undo" title="撤销" aria-label="撤销">'+icon('undo-2')+'</button><button class="icon-button" id="sb-redo" title="重做" aria-label="重做">'+icon('redo-2')+'</button><button class="icon-button" id="sb-reset" title="清空情景" aria-label="清空情景">'+icon('rotate-ccw')+'</button></div></div>'+
      '<div class="sandbox-scene-meta"><label class="field">情景名称<input id="sb-name" maxlength="50" required></label><p id="sb-count" class="field-help"></p><div class="sandbox-actions"><button class="button" id="sb-save">'+icon('save')+'保存</button><button class="icon-button" id="sb-export" title="导出情景与结果" aria-label="导出情景与结果">'+icon('download')+'</button></div><details class="sandbox-library"><summary>已保存情景</summary><div id="sb-library"></div></details></div>'+
      '<div class="sandbox-analysis"><label class="field">热图<select id="sb-layer"><option value="risk">实时热风险分级</option><option value="weather">实时网格气温</option><option value="heatindex">实时网格热指数</option><option value="utci">情景 UTCI</option><option value="mrt">情景平均辐射温度</option><option value="shade">情景遮阴</option><option value="off">关闭热图</option></select></label><label class="field">采样间距<select id="sb-resolution"><option value="100">100 m</option><option value="50">50 m</option><option value="25">25 m</option></select></label><button class="screen-action primary" id="sb-run">'+icon('cpu')+'推演并研判选区</button><button class="text-button" id="sb-refresh">'+icon('refresh-cw')+'刷新实时热图</button><button class="text-button" id="sb-report" disabled>'+icon('file-check-2')+'区域人群与 AI 依据</button></div>'+
      '<p id="sb-coverage" class="notice" hidden></p><p id="sb-error" role="alert" class="inline-error" hidden></p><p id="sb-status" role="status" class="field-help">正在读取热图</p><div id="sb-summary"></div>'+
      '<details class="sandbox-method"><summary>模型参数与数据来源</summary><p>建筑与道路使用现有数字轮廓；源文件与数据状态在导出材料中保留。</p><p>'+this.base.coverage.count+' 栋建筑 / '+this.base.coverage.height_sourced+' 栋带来源高度属性；缺失高度按18米场景参数补足。朝向为从正北顺时针。</p><p>LCZ温湿度差异来自情景参数，尚未实测标定。建筑推演计算太阳辐射与遮阴，不求解局地风、蒸散、长波温差及树冠；不是拆建许可或医学确诊依据。</p></details>'+
      '<dialog id="sb-confirm-dialog"><form method="dialog"><h3 id="sb-dialog-title"></h3><p id="sb-dialog-text"></p><div><button value="cancel" class="button">取消</button><button value="confirm" class="button primary">确认</button></div></form></dialog>'+
      '<dialog id="sb-report-dialog"><header><h3>沙盘区域研判依据</h3><button class="icon-button" id="sb-report-close" title="关闭" aria-label="关闭">'+icon('x')+'</button></header><div id="sb-report-content"></div></dialog>';
    const dockTabs=host.querySelector('.screen-dock-header');
    if(dockTabs){this.root.id='dock-panel-sandbox';this.root.setAttribute('role','tabpanel');this.root.setAttribute('aria-labelledby','dock-tab-sandbox');}
    if(dockTabs)dockTabs.after(this.root);else host.prepend(this.root);
    this.$=id=>this.root.querySelector('#'+id);this.$('sb-name').value=this.scene.name;
    this.root.querySelector('.sandbox-analysis').insertAdjacentHTML('afterbegin','<div class="sandbox-data-controls"><label class="field">数据模式<select id="sb-data-mode"><option value="live">真实公开气象网格</option><option value="lcz_simulation">LCZ模拟网格 · 未标定</option></select></label><label class="field">LCZ网格间距<select id="sb-grid-resolution"><option value="30">30 m</option><option value="50">50 m</option><option value="100">100 m</option></select></label></div><p class="notice" id="sb-data-notice"></p><details class="sandbox-reference"><summary>基准气象站与数据契约</summary><p id="sb-reference">正在读取基准站登记</p><p id="sb-contract"></p></details>');
    if(this.areaKind==='neighborhood'){
      const method=this.root.querySelector('.sandbox-method');
      method.querySelectorAll('p')[1].textContent='公开瓦片高度与补充体块高度均作为模拟参数，计算和显示共用同一高度；朝向为从正北顺时针。';
      method.insertAdjacentHTML('afterbegin','<p>'+this.base.coverage.public_footprints+' 个独立公开建筑轮廓；三维楼高为模拟参数。</p>');
    }
    this.$('sb-data-mode').value=this.state.regionalDraft.data_mode;
    this.$('sb-layer').insertAdjacentHTML('beforeend','<option value="anomaly">模拟冷暖分布 · ΔT</option><option value="lcz">LCZ 分类分布</option>');
    this.$('sb-resolution').insertAdjacentHTML('afterbegin','<option value="30">30 m</option>');
    this.$('sb-resolution').value=String(this.result?.resolution_m||30);
    this.$('sb-data-notice').insertAdjacentHTML('afterend','<details id="sb-lcz-composition"><summary title="分类面积按米制交叠计算；各网格按混合比例估算温湿度。">LCZ 选区构成</summary><div id="sb-lcz-summary"></div></details>');
    this.$('sb-grid-resolution').value=String(this.state.regionalDraft?.grid_resolution_m||30);
    if(this.state.regionalDraft.data_mode==='lcz_simulation')this.$('sb-layer').value='anomaly';
    this.weatherLayer=this.$('sb-layer').value;this.comparisonLayer=this.weatherLayer;
    this.$('sb-data-notice').insertAdjacentHTML('afterend','<div class="sandbox-grid-actions"><button type="button" class="text-button" id="sb-use-lcz">'+icon('layers')+'进入校园多网格模拟</button><button type="button" class="text-button" id="sb-full-campus">'+icon('focus')+'全校园模拟网格</button></div>');
    this.$('sb-use-lcz').addEventListener('click',()=>{
      if(this.regional().area_kind==='campus'){this.$('sb-data-mode').value='lcz_simulation';this.changeDataMode();return;}
      const site=document.getElementById('site-select');site.value='campus';site.dispatchEvent(new Event('change'));
    });
    this.$('sb-full-campus').addEventListener('click',()=>{
      this.workspace.setInteraction('inspect');
      const bounds=defaultBounds('campus');
      this.state.regionalDraft={...this.regional(),bounds,data_mode:'lcz_simulation'};
      if(this.workspace.onRegion)this.workspace.onRegion(bounds);else this.setBounds(bounds);
      this.showWeather();this.workspace.home();
    });
    for(const id of ['sb-data-mode','sb-grid-resolution'])this.$(id).addEventListener('change',()=>this.changeDataMode());
    this.$('sb-selection').closest('.context-help-row').insertAdjacentHTML('afterend','<p id="sb-cell" class="notice" hidden></p>');
    this.updateDataNotice();this.loadReference();
    const method=this.root.querySelector('.sandbox-method');method.insertAdjacentHTML('beforeend','<p>协同推理：云端DeepSeek选择计算工具，服务器执行本地数值模型并回传结果，AI再结合证据研判。连续编辑先快速本地重算；点击推演时进入云端协同流程。</p><p id="sb-temporal-model">正在核查单站短时预测模型…</p>');
    request('/api/weather/sandbox/temporal/model',{signal:this.lifetime.signal}).then(m=>{if(this.disposed)return;const t=m.evaluation.temperature_c,h=m.evaluation.humidity_pct;this.$('sb-temporal-model').textContent='本地训练的单站15分钟时序模型：'+m.data_summary.retained_rows+'条记录，独立时间留出'+m.sample_counts.test+'个样本；气温MAE '+n(t.mae,3)+'°C（持续值 '+n(t.persistence_mae,3)+'），湿度MAE '+n(h.mae,2)+'%RH。协同接口收到7条连续5分钟记录时可调用；无合格序列时不启用，不将小时网格冒充站点序列。';}).catch(()=>{if(!this.disposed)this.$('sb-temporal-model').textContent='短时预测模型暂不可用，不替代气象边界。';});
    if(this.workspace.dark){
      this.mobileToggle=document.createElement('button');this.mobileToggle.className='sandbox-mobile-toggle';this.mobileToggle.type='button';this.mobileToggle.title='布局操作面板';this.mobileToggle.setAttribute('aria-label','布局操作面板');this.mobileToggle.setAttribute('aria-expanded','false');this.mobileToggle.innerHTML=icon('sliders-horizontal');
      document.querySelector('.screen-map-tools')?.append(this.mobileToggle);
      this.mobileToggle.addEventListener('click',()=>this.setMobileOpen(!document.getElementById('decision-screen').classList.contains('sandbox-mobile-open')));
      if(!dockTabs){const close=document.createElement('button');close.className='icon-button sandbox-mobile-close';close.type='button';close.title='收起布局面板';close.setAttribute('aria-label',close.title);close.innerHTML=icon('chevron-right');this.root.querySelector('.section-header').append(close);close.addEventListener('click',()=>this.setMobileOpen(false));}
    }
    this.map.addSource('sandbox-heat-coverage',{type:'geojson',data:collection([])});
    this.map.addLayer({id:'sandbox-heat-missing',type:'fill',source:'sandbox-heat-coverage',filter:['==',['get','display_state'],'missing'],paint:{'fill-color':'#88969c','fill-opacity':0.42}},'campus-picking');
    this.map.addSource('sandbox-heat',{type:'geojson',data:collection([])});
    this.map.addLayer({id:'sandbox-heat-fill',type:'fill',source:'sandbox-heat',paint:{'fill-color':colors,'fill-opacity':0.65}},'campus-picking');
    this.map.addLayer({id:'sandbox-heat-mesh',type:'line',source:'sandbox-heat-coverage',paint:{'line-color':['match',['get','display_state'],'missing','#dde3e5','#647c86'],'line-width':['interpolate',['linear'],['zoom'],13,0.15,17,0.45],'line-opacity':0.32}},'campus-picking');
    this.map.addSource('sandbox-layout-impact',{type:'geojson',data:collection([])});
    this.map.addLayer({id:'sandbox-layout-impact-fill',type:'fill',source:'sandbox-layout-impact',paint:{'fill-color':['case',['<',['get','value'],0],'#278dba','#c75450'],'fill-opacity':0.1}},'campus-picking');
    this.map.addLayer({id:'sandbox-layout-impact-line',type:'line',source:'sandbox-layout-impact',paint:{'line-color':['case',['<',['get','value'],0],'#278dba','#c75450'],'line-width':['interpolate',['linear'],['zoom'],13,0.5,17,1.2],'line-opacity':0.8}},'campus-picking');
    this.map.addSource('sandbox-ghost',{type:'geojson',data:collection([])});
    this.map.addSource('sandbox-proposed',{type:'geojson',data:collection([])});
    this.map.addLayer({id:'sandbox-proposed-fill',type:'fill-extrusion',source:'sandbox-proposed',layout:{visibility:document.getElementById('layer-buildings')?.checked===false?'none':'visible'},paint:{'fill-extrusion-color':'#e7ab75','fill-extrusion-height':['get','render_height_m'],'fill-extrusion-opacity':0.96}});
    this.map.addLayer({id:'sandbox-ghost-fill',type:'fill-extrusion',source:'sandbox-ghost',paint:{'fill-extrusion-color':'#e45c69','fill-extrusion-height':['get','render_height_m'],'fill-extrusion-opacity':0.35}});
    this.map.addSource('sandbox-preview',{type:'geojson',data:collection([])});
    this.map.addLayer({id:'sandbox-preview-fill',type:'fill-extrusion',source:'sandbox-preview',paint:{'fill-extrusion-color':'#e3bf58','fill-extrusion-height':['get','render_height_m'],'fill-extrusion-opacity':0.55}});
    this.map.addSource('sandbox-selection',{type:'geojson',data:collection([])});
    this.map.addLayer({id:'sandbox-selection-outline',type:'line',source:'sandbox-selection',paint:{'line-color':'#f9d169','line-width':3}});
    this.root.querySelectorAll('[data-mode]').forEach(node=>node.addEventListener('click',()=>this.setView(node.dataset.mode)));
    this.$('sb-enter-edit').addEventListener('click',()=>this.setView('edit'));
    this.$('sb-show-weather').addEventListener('click',()=>this.showWeather());
    this.root.querySelectorAll('[data-operation]').forEach(node=>node.addEventListener('click',()=>{
      const operation=node.dataset.operation, next=this.workspace.interaction===operation&&operation!=='inspect'?'inspect':operation;
      const keepOpen=document.getElementById('decision-screen')?.classList.contains('sandbox-mobile-open');
      this.presentationRevision++;this.leaveDelta('edit');
      if(next!=='inspect'){const buildings=document.getElementById('layer-buildings');if(buildings)buildings.checked=true;this.workspace.setBuildings(true);}
      this.workspace.setInteraction(next);this.setMobileOpen(keepOpen);this.updateScene();
    }));
    this.$('sb-form').addEventListener('submit',event=>{event.preventDefault();this.confirmEdit();});
    this.$('sb-edit').addEventListener('click',async()=>{const id=this.selected?.properties.id;if(!id?.startsWith('new-')||!this.$('sb-form').reportValidity())return;if(await this.applyGeometry(s=>Object.assign(s.additions.find(a=>a.id===id),this.dimensions())))this.select(null);});
    this.$('sb-name').addEventListener('change',()=>{const name=this.$('sb-name').value.trim()||'布局方案';this.$('sb-name').value=name;this.mutate(s=>s.name=name);});
    for(const id of ['width','depth','height','rotation'])this.$('sb-'+id).addEventListener('input',()=>{this.preview(this.point);this.updateActions();});
    this.$('sb-undo').addEventListener('click',()=>this.travel(false));this.$('sb-redo').addEventListener('click',()=>this.travel(true));
    this.$('sb-reset').addEventListener('click',async()=>{const scene=JSON.stringify(this.scene);if(await this.confirm('清空情景操作','恢复现状副本，不删除底图和已保存情景。')&&!this.disposed&&scene===JSON.stringify(this.scene)){this.workspace.setInteraction('inspect');this.select(null);this.mutate(s=>{s.additions=[];s.removed_ids=[];});}});
    this.$('sb-save').addEventListener('click',()=>this.save());
    this.$('sb-export').addEventListener('click',()=>download({scene:this.scene,result:this.result,building_coverage:this.base.coverage},'microclimate-layout-scenario.json'));
    this.root.querySelector('.sandbox-analysis').insertAdjacentHTML('beforeend','<label class="sandbox-auto"><input id="sb-auto" type="checkbox" checked> 拆建后自动重算区域网格</label>');
    this.$('sb-auto').addEventListener('change',()=>{clearTimeout(this.autoTimer);if(this.$('sb-auto').checked)this.queueSimulation();});
    this.$('sb-layer').addEventListener('change',()=>this.setLayer(this.$('sb-layer').value));this.$('sb-resolution').addEventListener('change',()=>this.invalidate());
    this.$('sb-run').addEventListener('click',()=>this.run());this.$('sb-refresh').addEventListener('click',()=>this.refreshHeat());
    this.$('sb-report').addEventListener('click',()=>this.report());this.$('sb-report-close').addEventListener('click',()=>this.$('sb-report-dialog').close());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){this.expire();this.refreshHeat();}},{signal:this.lifetime.signal});
    this.timer=setInterval(()=>{this.expire();if(!document.hidden)this.refreshHeat();},120000);
    const oldLayers=document.querySelector('.screen-layers');
    if(oldLayers && !document.querySelector('.screen-dock-tabs')){const details=document.createElement('details');details.className='sandbox-existing-layers';details.innerHTML='<summary>底图与展示设置</summary>';oldLayers.replaceWith(details);details.append(oldLayers);}
    const location=document.querySelector('.screen-location');
    if(location){const region=location.querySelector('.screen-region-controls');if(region)(document.querySelector('.screen-risk-section')||this.root).append(region);location.hidden=true;}
    if(dockTabs){
      const action=document.createElement('div');action.className='sandbox-primary-action';
      action.append(this.$('sb-run'),this.$('sb-auto').closest('label'));
      this.root.querySelector('.sandbox-modes').after(action);
    }

    const obsolete=document.querySelector('.map-method p');if(obsolete)obsolete.textContent='数字空间底图 / 气象网格 / 布局情景推演。详细参数与来源见沙盘设置。';
    this.collection=new CollectionWorkspace(this);this.collection.mount();
    this.$('sb-report').disabled=!this.result;this.expire();this.updateScene();this.loadScenes();this.refreshHeat();icons();
  }
  dimensions(){return {width_m:Number(this.$('sb-width').value),depth_m:Number(this.$('sb-depth').value),height_m:Number(this.$('sb-height').value),rotation_deg:Number(this.$('sb-rotation').value)};}
  setView(mode){
    if(this.disposed||this.validating||!['baseline','edit','proposed','delta'].includes(mode))return;
    if(mode===this.mode)return;
    const keepOpen=document.getElementById('decision-screen')?.classList.contains('sandbox-mobile-open');
    this.presentationRevision++;
    if(mode==='delta'){this.comparisonLayer=this.$('sb-layer').value;this.mode=mode;this.$('sb-layer').value='utci';}
    else this.leaveDelta(mode);
    this.workspace.setInteraction('inspect');this.setMobileOpen(keepOpen);
    this.updateScene();
  }
  leaveDelta(mode){
    if(this.mode==='delta'&&mode!=='delta')this.$('sb-layer').value=this.comparisonLayer||this.weatherLayer;
    this.mode=mode;
  }
  setLayer(layer){
    if(this.disposed||![...this.$('sb-layer').options].some(option=>option.value===layer))return;
    this.presentationRevision++;
    if(this.mode==='delta'&&!['utci','off'].includes(layer))this.mode=this.result?'proposed':'edit';
    this.$('sb-layer').value=layer;
    if(['risk','weather','heatindex','anomaly'].includes(layer))this.weatherLayer=layer;
    this.updateScene();
  }
  showWeather(){
    if(this.disposed)return;
    const keepOpen=document.getElementById('decision-screen')?.classList.contains('sandbox-mobile-open');
    this.presentationRevision++;this.mode='edit';
    this.$('sb-layer').value=this.weatherLayer||'weather';
    this.workspace.setInteraction('inspect');this.setMobileOpen(keepOpen);this.updateScene();
    if(!this.heat)this.refreshHeat();
  }
  get operation(){return ['select','add','move','remove'].includes(this.workspace.interaction)?this.workspace.interaction:'inspect';}
  setMobileOpen(open){
    if(open&&document.querySelector('.screen-right')?.dataset.dockView!=='sandbox')document.getElementById('dock-tab-sandbox')?.click();
    document.getElementById('decision-screen')?.classList.toggle('sandbox-mobile-open',open);
    document.querySelector('.screen-dock-expand')?.setAttribute('aria-expanded',String(open));
    this.mobileToggle?.setAttribute('aria-expanded',String(open));
    this.mobileToggle?.setAttribute('aria-pressed',String(open));
  }
  controls(){
    this.root.dataset.validating=String(!!this.validating);
    const boundsKey=JSON.stringify(this.bounds);
    if(this.resolutionBoundsKey!==boundsKey){
      const points=[[this.bounds.west,this.bounds.south],[this.bounds.west,this.bounds.north],[this.bounds.east,this.bounds.south],[this.bounds.east,this.bounds.north]].map(point=>proj4('EPSG:4326','+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs',point));
      const width=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])),height=Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]));
      for(const option of this.$('sb-resolution').options){option.disabled=Math.ceil(width/Number(option.value))*Math.ceil(height/Number(option.value))>4096;option.title=option.disabled?'当前范围超过4096个计算单元，请缩小选区后使用此间距':'';}
      this.resolutionBoundsKey=boundsKey;
    }
    if(this.$('sb-resolution').selectedOptions[0]?.disabled){const valid=[...this.$('sb-resolution').options].filter(option=>!option.disabled).sort((a,b)=>Number(a.value)-Number(b.value))[0];if(valid)this.$('sb-resolution').value=valid.value;}
    const oversized=[...this.$('sb-resolution').options].every(option=>option.disabled);
    this.root.querySelectorAll('[data-mode]').forEach(x=>{x.setAttribute('aria-pressed',String(x.dataset.mode===this.mode));x.disabled=!!this.validating;});
    this.root.querySelectorAll('[data-operation]').forEach(x=>{x.setAttribute('aria-pressed',String(this.mode==='edit'&&x.dataset.operation===this.workspace.interaction));x.disabled=!!this.validating;});
    this.$('sb-undo').disabled=this.validating||!this.undo.length;this.$('sb-redo').disabled=this.validating||!this.redo.length;
    this.$('sb-reset').disabled=!!this.validating;
    this.$('sb-save').disabled=!!(this.validating||this.saving);
    const editableDimensions=this.mode==='edit'&&(this.operation==='add'||this.operation==='select'&&this.selected?.properties.id?.startsWith('new-'));
    for(const id of ['width','depth','height','rotation'])this.$('sb-'+id).disabled=!!this.validating||!editableDimensions;
    this.$('sb-name').disabled=!!this.validating;
    this.root.querySelectorAll('[data-load-scene]').forEach(node=>node.disabled=!!this.validating);
    this.root.querySelectorAll('[data-delete-scene]').forEach(node=>node.disabled=!!this.deletingScenes?.has(node.dataset.deleteScene));
    this.$('sb-count').textContent='新增 '+this.scene.additions.length+' / 拟拆除 '+this.scene.removed_ids.length;
    const [w,s,east,north]=this.base.bbox,b=this.bounds,covered=b.west>=w&&b.east<=east&&b.south>=s&&b.north<=north;
    this.$('sb-coverage').hidden=covered;this.$('sb-coverage').textContent='当前选区超出建筑资料覆盖范围，仅显示天气热图；请选择模型覆盖区内的范围再推演。';
    this.$('sb-run').disabled=this.busy||this.validating||!covered||oversized;
    this.$('sb-run').title=oversized?'当前范围过大，请缩小选区后推演':'';
    this.workspace.syncInteraction();
    this.updateActions();
  }
  updateScene(){
    this.state.sandboxScene=clone(this.scene);
    const geometryKey=JSON.stringify([this.mode==='baseline',this.scene.additions,this.scene.removed_ids]);
    if(this.geometryKey!==geometryKey){
      const features=this.mode==='baseline'?this.base.features:[...this.base.features.filter(f=>!this.scene.removed_ids.includes(f.id)),...this.scene.additions.map(additionFeature)];
      this.map.getSource('campus-buildings').setData(collection(features));
      // Confirmed proposals survive the editor preview and optional 3D renderer.
      this.workspace.modelLayer?.setFeatures?.(collection(features.filter(f=>f.properties.state!=='new')));
      this.map.getSource('sandbox-proposed').setData(collection(features.filter(f=>f.properties.state==='new')));
      this.geometryKey=geometryKey;
    }
    const ghostKey=JSON.stringify([this.mode==='edit',this.scene.removed_ids]);
    if(this.ghostKey!==ghostKey){this.map.getSource('sandbox-ghost').setData(collection(this.mode==='edit'?this.base.features.filter(f=>this.scene.removed_ids.includes(f.id)):[]));this.ghostKey=ghostKey;}
    this.controls();this.paint();this.renderSummary();
  }
  select(feature,point=null){
    const changed=feature?.properties.id!==this.selected?.properties.id;
    this.selected=feature;this.point=point;this.map.getSource('sandbox-selection').setData(collection(feature?[feature]:[]));
    this.workspace.modelLayer?.select(feature?.id??null);
    if(this.workspace.interaction!=='inspect')this.$('sb-cell').hidden=true;
    this.$('sb-selection').textContent=feature?(feature.properties.state==='new'?'拟建':'既有')+'建筑 / '+n(Number(feature.properties.render_height_m))+' m'+(feature.properties.height_m==null?'（高度假设）':''):point?'建造位置 '+point.lng.toFixed(6)+', '+point.lat.toFixed(6):this.operation==='inspect'?'地点标记模式':this.operation==='select'?'建筑选择模式 · 未选择':'未选择建筑或建造位置';
    if(this.operation==='move')this.$('sb-selection').textContent=feature?.properties.id?.startsWith('new-')?(point?'移动目标 '+point.lng.toFixed(6)+', '+point.lat.toFixed(6):'已选拟建建筑，点击地图设置移动目标'):'请选择一栋拟建建筑';
    if(changed&&feature?.properties.id?.startsWith('new-')){const a=this.scene.additions.find(x=>x.id===feature.properties.id);if(a)for(const [id,k]of [['width','width_m'],['depth','depth_m'],['height','height_m'],['rotation','rotation_deg']])this.$('sb-'+id).value=a[k];}
    this.updateActions();
    this.preview(point);
    this.workspace.syncInteraction();
  }
  updateActions(){
    const proposed=this.selected?.properties.id?.startsWith('new-');
    const editing=this.mode==='edit',operation=this.operation;
    this.$('sb-editor').hidden=!editing;this.$('sb-view-panel').hidden=editing;
    this.root.dataset.displayMode=this.mode;this.root.dataset.activeOperation=operation;
    const views={baseline:['现状基线','显示原始建筑，不包含拟建和拟拆除调整。'],proposed:['方案预览','显示当前方案建筑；已拟拆除的建筑不再显示。'],delta:['前后差值','同一气象边界、同一可比位置的方案UTCI减现状UTCI；不是气温差。']};
    if(!editing){const [title,description]=views[this.mode];this.$('sb-view-title').textContent=title;if(this.viewHelpMode!==this.mode){this.$('sb-view-description').innerHTML=help(description, title+'说明');this.viewHelpMode=this.mode;icons();}this.$('sb-view-state').textContent=this.result?'已关联本次计算结果。':'尚未完成推演；建筑预览不代表已计算热风险。';}
    const titles={inspect:'地点标记',select:proposed?'拟建建筑参数':'建筑信息',add:'新建建筑',move:'移动拟建建筑',remove:'情景内拟拆除'};
    this.$('sb-tool-title').textContent=titles[operation];
    const instructions={inspect:'点击地图标记位置，不会选中或拆除建筑。',select:'点击建筑查看信息；选中拟建建筑后可修改参数。',add:'点击地图设置中心，填写尺寸和朝向，再确认建造。',move:'先选择拟建建筑，再点击目标位置确认移动。',remove:'点击建筑选择拟拆除对象，再确认；仅修改当前情景，可撤销。'};
    const toolKey=operation+':'+titles[operation];
    if(this.$('sb-tool-help').dataset.tool!==toolKey){this.$('sb-tool-help').innerHTML=help(instructions[operation],titles[operation]+'帮助');this.$('sb-tool-help').dataset.tool=toolKey;icons();}
    this.root.querySelector('.sandbox-dimensions').hidden=!(editing&&(operation==='add'||operation==='select'&&proposed));
    for(const id of ['width','depth','height','rotation'])this.$('sb-'+id).disabled=!!this.validating||this.root.querySelector('.sandbox-dimensions').hidden;
    const valid=['width','depth','height','rotation'].every(id=>this.$('sb-'+id).validity.valid);
    this.$('sb-confirm').hidden=!['add','move','remove'].includes(operation);
    this.$('sb-edit').hidden=!(operation==='select'&&proposed);
    const confirmLabel={add:'确认建造',move:'确认移动',remove:this.scene.removed_ids.includes(this.selected?.id)?'恢复该建筑':'确认拟拆除'}[operation]||'确认操作';
    if(this.$('sb-confirm').dataset.label!==confirmLabel){this.$('sb-confirm').dataset.label=confirmLabel;this.$('sb-confirm').innerHTML=icon('check')+confirmLabel;}
    if(operation!=='inspect'||!editing)this.$('sb-cell').hidden=true;
    this.root.dataset.heatLayer=this.$('sb-layer').value;
    this.$('sb-confirm').disabled=!!this.validating||this.mode!=='edit'||!(this.operation==='remove'&&this.selected||valid&&(this.operation==='add'&&this.point||this.operation==='move'&&this.point&&proposed));
    this.$('sb-edit').disabled=!!this.validating||!valid||this.mode!=='edit'||!proposed||!['select','move'].includes(this.workspace.interaction);
  }
  preview(point){
    const d=this.dimensions(),valid=['width','depth','height','rotation'].every(id=>this.$('sb-'+id).validity.valid);
    this.map.getSource('sandbox-preview')?.setData(collection(this.mode==='edit'&&['add','move'].includes(this.operation)&&point&&valid&&Object.values(d).every(Number.isFinite)?[additionFeature({id:'new-preview',longitude:point.lng,latitude:point.lat,...d})]:[]));
  }
  pick(event){
    if(this.workspace.selectingRegion)return false;
    if(this.validating)return true;
    if(this.workspace.interaction==='inspect'){
      if(this.mode==='edit')this.$('sb-selection').textContent='已标记 '+event.lngLat.lng.toFixed(6)+', '+event.lngLat.lat.toFixed(6);
      const hit=this.map.queryRenderedFeatures(event.point,{layers:['sandbox-heat-mesh']})[0]||this.map.queryRenderedFeatures(event.point,{layers:['sandbox-heat-fill','sandbox-heat-missing']})[0];
      const cell=(hit&&this.displayCells?.find(f=>hit.properties.grid_id?f.properties.grid_id===hit.properties.grid_id:String(f.id)===String(hit.id)))||hit;
      this.pickedCell=cell;
      this.$('sb-cell').hidden=!cell;
      this.$('sb-cell').title=cell?'分类面积混合：'+lczCompositionText(cell.properties.lcz_fractions):'';
      if(cell){const p=cell.properties;this.$('sb-cell').textContent=(p.source_type==='simulated_lcz'?'LCZ模拟 · 未标定 / '+(p.lcz_hint||'未分类')+' '+(p.lcz_name||''):'计算单元')+' / '+(p.display_state==='missing'?p.display_reason:n(p.temperature_c??p.air_temperature_c)+'°C / '+n(p.humidity_pct)+'%RH')+(p.delta_t_grid_c!=null?' / 边界偏移 '+n(p.delta_t_grid_c,2)+'°C':'')+(p.grid_id?' / '+p.grid_id:'');if('proposed_utci_c' in p)this.$('sb-cell').textContent+=' / 现状UTCI '+n(p.baseline_utci_c)+' → 方案 '+n(p.proposed_utci_c)+'°C / Δ '+n(p.delta_utci_c,2)+'°C / 方案'+(p.proposed_occupied?'建筑内部':p.proposed_shade?'遮阴':'日照');}
      if(cell?.properties.neighbourhood_effect){const p=cell.properties;this.$('sb-cell').textContent+=' / 遮阴变化 '+n(p.neighbourhood_effect.delta_shade_fraction*100,2)+'% / 天空可视变化 '+n(p.neighbourhood_effect.delta_svf,3)+' / 150m建筑密度 '+n(p.proposed_neighbourhood['150'].plan_area_fraction*100,1)+'% / '+(p.proposed_ml_status==='physics_checked_ml'?'学习模型已通过物理校验':'传统计算');}
      return false;
    }
    if(!['select','add','move','remove'].includes(this.workspace.interaction))return false;
    if(this.mode==='edit'&&this.operation==='add'){this.select(null,event.lngLat);return true;}
    const hit=this.map.queryRenderedFeatures(event.point,{layers:['campus-picking','campus-building','sandbox-ghost-fill']})[0];
    const id=this.workspace.modelLayer?.pick?.(event.point)||hit?.properties?.id,feature=[...this.base.features,...this.scene.additions.map(additionFeature)].find(f=>f.id===id);
    if(this.mode==='edit'&&this.operation==='move'){if(this.selected?.properties.id?.startsWith('new-'))this.select(this.selected,event.lngLat);else this.select(feature?.properties.id?.startsWith('new-')?feature:null);return true;}
    if(this.mode==='edit'&&this.operation==='remove'){this.select(feature||null);return true;}
    this.select(feature||null);return true;
  }
  confirm(title,text){
    if(this.disposed||this.cancelConfirmation)return Promise.resolve(false);
    this.$('sb-dialog-title').textContent=title;this.$('sb-dialog-text').textContent=text;
    const dialog=this.$('sb-confirm-dialog'),form=dialog.querySelector('form');dialog.returnValue='cancel';
    return new Promise(resolve=>{
      const finish=value=>{form.removeEventListener('submit',submit);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',close);this.cancelConfirmation=null;resolve(value);};
      const submit=event=>{event.preventDefault();const value=event.submitter?.value==='confirm';dialog.close(value?'confirm':'cancel');finish(value);};
      const cancel=event=>{event.preventDefault();dialog.close('cancel');finish(false);};
      const close=()=>{if(!dialog.open)finish(false);};
      this.cancelConfirmation=()=>{dialog.close('cancel');finish(false);};
      form.addEventListener('submit',submit);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',close);dialog.showModal();
    });
  }
  async confirmEdit(){
    if(this.mode!=='edit'||this.validating||!['add','move','remove'].includes(this.workspace.interaction))return;
    if(this.operation==='add'&&!this.$('sb-form').reportValidity())return;
    if(this.operation==='move'&&this.point&&this.selected?.properties.id?.startsWith('new-')){
      const id=this.selected.properties.id,point=this.point;if(await this.applyGeometry(s=>Object.assign(s.additions.find(a=>a.id===id),{longitude:point.lng,latitude:point.lat})))this.select(null);
    }else if(this.operation==='add'&&this.point){
      if(this.scene.additions.length>=30){toast('每个情景最多30栋拟建建筑。');return;}
      const [w,s,east,north]=this.base.bbox;if(this.point.lng<w||this.point.lng>east||this.point.lat<s||this.point.lat>north){toast('建造位置超出建筑底图覆盖范围。');return;}
      const a={id:'new-'+crypto.randomUUID(),longitude:this.point.lng,latitude:this.point.lat,...this.dimensions()};if(await this.applyGeometry(s=>s.additions.push(a)))this.select(null);
    }else if(this.operation==='remove'&&this.selected){
      const id=this.selected.id,scene=JSON.stringify(this.scene),intent=this.workspace.interactionRevision;if(!await this.confirm('确认情景内拟拆除','只修改当前方案副本。拆除后按开放地面假设，不改变原始校园底图。')||this.disposed||scene!==JSON.stringify(this.scene)||intent!==this.workspace.interactionRevision)return;
      this.mutate(s=>{if(id.startsWith('new-'))s.additions=s.additions.filter(a=>a.id!==id);else if(s.removed_ids.includes(id))s.removed_ids=s.removed_ids.filter(x=>x!==id);else s.removed_ids.push(id);});this.select(null);
    }
  }
  async applyGeometry(fn){
    if(this.disposed||this.validating)return false;this.validating=true;this.geometryController=new AbortController();const revision=this.revision,intent=this.workspace.interactionRevision,candidate=clone(this.scene);fn(candidate);this.error(null);
    this.$('sb-confirm').disabled=true;this.$('sb-edit').disabled=true;this.controls();
    try{await request('/api/weather/sandbox/validate',{json:candidate,signal:AbortSignal.any([this.lifetime.signal,this.geometryController.signal])});if(this.disposed||revision!==this.revision||intent!==this.workspace.interactionRevision)return false;this.mutate(s=>Object.assign(s,candidate));return true;}
    catch(error){if(!this.disposed&&intent===this.workspace.interactionRevision&&error.name!=='AbortError')this.error(error.message);return false;}
    finally{this.geometryController=null;this.validating=false;if(!this.disposed){this.select(this.selected,this.point);this.controls();}}
  }
  mutate(fn){if(this.disposed)return;const candidate=clone(this.scene);fn(candidate);if(JSON.stringify(candidate)===JSON.stringify(this.scene))return;this.undo.push(clone(this.scene));if(this.undo.length>50)this.undo.shift();this.redo=[];this.scene=candidate;this.invalidate();this.updateScene();}
  travel(forward){const from=forward?this.redo:this.undo,to=forward?this.undo:this.redo;if(!from.length||this.validating)return;this.presentationRevision++;this.leaveDelta('edit');this.workspace.setInteraction('inspect');to.push(clone(this.scene));this.scene=from.pop();this.$('sb-name').value=this.scene.name;this.invalidate();this.select(null);this.updateScene();}
  invalidate({queue=true,collectionChanged=true,keepForecastCache=false,retainFrame=false,forecastStep=false}={}){
    const running=this.busy;clearTimeout(this.autoTimer);if(collectionChanged)this.collection?.invalidate();
    if(!keepForecastCache)this.forecastFrames.clear();
    this.revision++;this.runController?.abort();this.runController=null;this.busy=false;
    if(!retainFrame){
      if(this.result?.regional_report?.report_sha256===this.state.regionalReport?.report_sha256)this.state.regionalReport=null;
      this.result=null;this.state.sandboxResult=null;
      const surface=document.getElementById('workspace-map');
      if(surface){delete surface.dataset.sceneSha256;delete surface.dataset.resultSha256;delete surface.dataset.validTime;delete surface.dataset.isForecast;delete surface.dataset.frameRenderedAt;delete surface.dataset.frameCache;}
      this.$('sb-summary').replaceChildren();
    }
    this.$('sb-report').disabled=true;this.$('sb-report-dialog').close();
    if(running)this.$('sb-status').textContent='输入已改变，旧推演已取消。';
    this.paint();this.controls();window.dispatchEvent(new Event('workspace:layout-report'));
    if(!forecastStep)window.dispatchEvent(new Event('workspace:scene-invalidated'));
    if(queue)this.queueSimulation();
  }
  queueSimulation(){
    clearTimeout(this.autoTimer);
    if(this.disposed||!this.$('sb-auto')?.checked)return;
    this.$('sb-status').textContent='方案已更新，等待自动重算；旧报告已失效。';
    this.autoTimer=setTimeout(()=>{if(this.validating){this.queueSimulation();return;}this.run({automatic:true});},900);
  }
  setBounds(bounds){const key=JSON.stringify(this.state.regionalDraft||{});if(JSON.stringify(bounds)===JSON.stringify(this.bounds)&&key===this.contextKey)return;this.contextKey=key;this.bounds=clone(bounds);if(this.regional().mode==='history')this.clearForecastTime();this.$('sb-data-mode').value=this.state.regionalDraft?.data_mode||defaultDataMode(this.state.site);this.$('sb-grid-resolution').value=String(this.state.regionalDraft?.grid_resolution_m||30);this.updateDataNotice();this.invalidate();this.controls();if(regionalWeatherKey(this.regional())!==this.heatKey)this.refreshHeat();}
  regional(){return {...defaultRegional(this.state.site, this.state.regionalDraft),bounds:this.bounds};}
  clearForecastTime(){
    if(!this.forecastTime)return;
    this.forecastTime=null;this.heatController?.abort();this.heatTask=null;this.heatKey=null;this.heat=null;
    window.dispatchEvent(new Event('workspace:forecast-cleared'));
  }
  async setForecastTime(time){
    if(this.disposed)return null;
    this.forecastTime=time||null;
    this.updateDataNotice();
    if(time&&this.regional().mode==='history'){
      this.state.regionalDraft={...this.regional(),mode:'current'};
      this.contextKey=JSON.stringify(this.state.regionalDraft);this.updateDataNotice();
    }
    const retainFrame=!!time&&this.result?.is_forecast&&this.forecastResultContext===this.forecastContext();
    this.heatController?.abort();this.heatTask=null;this.heatKey=null;if(!retainFrame)this.heat=null;
    this.invalidate({queue:false,keepForecastCache:true,retainFrame,forecastStep:true});
    if(!time)await this.refreshHeat();
    return this.run({automatic:true,forecast:!!time,retainFrame});
  }
  forecastContext(){
    return JSON.stringify({scene:this.scene,regional:{...this.regional(),use_ai:false},resolution_m:Number(this.$('sb-resolution').value)});
  }
  async compareDaylight(){
    if(this.busy||this.validating||this.disposed)return;
    this.state.regionalDraft={...this.regional(),mode:'history'};this.contextKey=JSON.stringify(this.state.regionalDraft);
    this.clearForecastTime();
    this.invalidate({queue:false});this.presentationRevision++;this.mode='proposed';this.$('sb-layer').value='utci';this.updateDataNotice();this.updateScene();
    await this.refreshHeat();if(!this.disposed)await this.run({automatic:true});
  }
  async run({automatic=false,forecast=!!this.forecastTime,retainFrame=false}={}){
    if(this.disposed||this.busy||this.validating||this.$('sb-run').disabled)return;if(!automatic)this.workspace.setInteraction('inspect');this.invalidate({queue:false,collectionChanged:false,keepForecastCache:true,retainFrame,forecastStep:automatic&&forecast});const revision=this.revision,presentationRevision=this.presentationRevision,controller=this.runController=new AbortController();this.busy=true;this.$('sb-run').disabled=true;this.error(null);
    this.$('sb-status').textContent='同刻气象与辐射 → 现状/方案计算 → 区域人群与AI证据研判…';this.paint();
    try{
      const endpoint=automatic?'/api/weather/sandbox/simulate':'/api/weather/sandbox/collaborate';
      const context=this.forecastContext(),key=JSON.stringify([context,this.forecastTime]);
      const signal=AbortSignal.any([this.lifetime.signal,controller.signal]);
      const cached=automatic&&forecast?this.forecastFrames.get(key):null;
      const result=cached||await request(endpoint,{json:{scene:clone(this.scene),regional:{...this.regional(),use_ai:automatic?false:this.regional().use_ai},resolution_m:Number(this.$('sb-resolution').value),...(this.forecastTime?{valid_time:this.forecastTime}:{})},signal,timeoutMs:115000});
      if(this.disposed||controller.signal.aborted||revision!==this.revision)return;this.result=result;this.state.sandboxResult=result;
      if(forecast){this.forecastResultContext=context;if(automatic&&!cached)this.forecastFrames.put(key,result);}
      // Background calculations must not override a newer view or layer choice.
      if(presentationRevision===this.presentationRevision){
        const view=thermalResultView(this.$('sb-layer').value,this.mode,result,{forecast});
        if(view.mode==='delta'&&this.mode!=='delta'){
          this.comparisonLayer=this.$('sb-layer').value;
          this.workspace.setInteraction('inspect');
        }
        this.mode=view.mode;this.$('sb-layer').value=view.layer;
      }
      this.$('sb-report').disabled=false;
      if(result.regional_report?.cells){this.collection?.acceptHeat(result.regional_report);this.heat=result.regional_report;}
      const surface=document.getElementById('workspace-map');delete surface.dataset.frameRenderedAt;delete surface.dataset.frameCache;surface.dataset.sceneSha256=result.scene_sha256;surface.dataset.resultSha256=result.report_sha256;surface.dataset.validTime=result.valid_time;surface.dataset.isForecast=String(result.is_forecast);
      this.$('sb-status').textContent=(automatic?'自动重算完成':'推演完成')+' / '+date(result.weather_boundary.observed_at,true)+' 北京时间 / '+(result.orchestration?.mode==='deepseek_tools_local_models'?'DeepSeek工具调用 → 本地模型计算 → AI研判':result.regional_report.generation.mode==='ai_regional_evidence_selection'?'AI实际调用':automatic?'数值推演与规则研判 · 可手动协同研判':'本地模型完成 · 云端协同降级')+' / 探索性结果';if(!automatic&&presentationRevision===this.presentationRevision)this.select(null);this.updateScene();window.dispatchEvent(new Event('workspace:layout-report'));
      if(forecast){
        this.busy=false;this.controls();this.paint();
        await waitForHeatRender(this.map,signal);
        if(this.disposed||revision!==this.revision||this.result!==result)return null;
        surface.dataset.frameRenderedAt=String(performance.now());surface.dataset.frameCache=cached?'hit':'miss';
      }
      return result;
    }catch(error){if(!this.disposed&&!controller.signal.aborted&&revision===this.revision){this.error(error.name==='TimeoutError'?'推演超时，未生成替代结果。':error.message);this.$('sb-status').textContent='推演未完成，请核查范围、建筑重叠与数据。';}return null;}
    finally{if(this.runController===controller){this.runController=null;this.busy=false;if(!this.disposed){this.controls();this.paint();}}}
  }
  error(message){this.$('sb-error').hidden=!message;this.$('sb-error').textContent=message||'';}
  changeDataMode(){
    if(this.disposed)return;this.workspace.setInteraction('inspect');
    this.state.regionalDraft={...this.regional(),data_mode:this.$('sb-data-mode').value,grid_resolution_m:Number(this.$('sb-grid-resolution').value)};
    this.$('sb-cell').hidden=true;
    this.contextKey=JSON.stringify(this.state.regionalDraft);this.state.regionalReport=null;this.invalidate();this.updateDataNotice();
    this.setLayer(this.$('sb-data-mode').value==='lcz_simulation'?'anomaly':this.weatherLayer==='anomaly'?'weather':this.weatherLayer);
    this.refreshHeat();
  }
  updateDataNotice(){
    const simulation=this.$('sb-data-mode').value==='lcz_simulation';
    const campus=this.regional().area_kind==='campus';
    this.$('sb-use-lcz').hidden=campus&&simulation;
    this.$('sb-full-campus').hidden=!campus;
    this.$('sb-data-mode').querySelector('[value="lcz_simulation"]').disabled=!campus;
    this.$('sb-grid-resolution').disabled=!simulation;
    this.$('sb-data-mode').querySelector('[value="lcz_simulation"]').textContent='模拟数据 · LCZ网格';
    const historical=this.regional().mode==='history';
    const boundary=this.forecastTime?'预报边界 '+date(this.forecastTime,true):historical?'历史边界（非当前）':'当前气象边界';
    this.$('sb-data-notice').textContent=simulation?'模拟数据 · '+boundary+' + LCZ空间分区':'公开气象数据 · '+boundary+' · 保持原始网格分辨率';
    if(!campus)this.$('sb-data-notice').textContent='街区公开轮廓 · 模拟高度 · '+boundary;
    for(const [value,label] of [['risk','环境热风险分级'],['weather','网格气温'],['heatindex','网格热指数']])this.$('sb-layer').querySelector('[value="'+value+'"]').textContent=(simulation?'模拟 · ':'气象 · ')+label;
    this.$('sb-layer').querySelector('[value="lcz"]').disabled=!simulation;
    this.$('sb-layer').querySelector('[value="anomaly"]').disabled=!simulation;
    if(!simulation&&['lcz','anomaly'].includes(this.$('sb-layer').value))this.$('sb-layer').value='weather';
    if(!simulation&&this.weatherLayer==='anomaly')this.weatherLayer='weather';
    this.$('sb-lcz-composition').hidden=!simulation;
  }
  async loadReference(){
    if(this.areaKind!=='campus'){this.$('sb-reference').closest('details').hidden=true;return;}
    try{const data=await request('/api/weather/sandbox/lcz-metadata',{signal:this.lifetime.signal});if(this.disposed)return;
      const station=data.reference_station;this.$('sb-reference').textContent=station.label+'：'+station.note;
      const position=station.location;
      if(position&&Number.isFinite(position.longitude)&&Number.isFinite(position.latitude)){
        const source={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[position.longitude,position.latitude]},properties:{label:'基准站'}}]};
        if(this.map.getSource('reference-station'))this.map.getSource('reference-station').setData(source);
        else{this.map.addSource('reference-station',{type:'geojson',data:source});this.map.addLayer({id:'reference-station-point',type:'circle',source:'reference-station',paint:{'circle-radius':7,'circle-color':'#8fc9eb','circle-stroke-color':'#fff','circle-stroke-width':2}});this.map.addLayer({id:'reference-station-label',type:'symbol',source:'reference-station',layout:{'text-field':['get','label'],'text-size':12,'text-offset':[0,1.5]},paint:{'text-color':'#e1f0f7','text-halo-color':'#17382f','text-halo-width':2}});}
      }
      this.$('sb-contract').textContent='UGV IF-02双层字段 / UTC采样时间 / WGS84坐标 / 温度°C、湿度%RH / uint32质量标记。模拟不冒充设备遥测；1m正式栅格产品尚未交付。';
    }catch(error){if(!this.disposed)this.$('sb-reference').textContent='基准站登记暂不可读，未使用默认位置。';}
  }
  refreshHeat(){
    if(this.disposed)return Promise.resolve();
    if(this.forecastTime)return Promise.resolve();
    const regional=this.regional(),key=regionalWeatherKey(regional);
    if(this.heatKey===key&&this.heatTask)return this.heatTask;
    if(this.heatKey!==key){this.heat=null;this.heatRefreshFailed=false;this.paint();}
    this.heatController?.abort();const controller=this.heatController=new AbortController();this.heatKey=key;
    this.heatTask=this.fetchHeat(regional,controller).finally(()=>{if(this.heatController===controller)this.heatTask=null;});
    return this.heatTask;
  }
  async fetchHeat(regional,controller){
    try{
      const heat=await request('/api/weather/sandbox/heatmap',{json:{...regional,use_ai:false},signal:AbortSignal.any([this.lifetime.signal,controller.signal]),timeoutMs:35000});
      if(this.disposed||controller.signal.aborted)return;
      if(this.result?.data_mode==='lcz_simulation'&&this.result.lcz_snapshot_sha256!==heat.snapshot_sha256){
        if(Date.parse(heat.baseline?.observed_at)<Date.parse(this.result.weather_boundary.observed_at))return;
        this.invalidate();this.$('sb-status').textContent='气象边界已更新，旧快照推演已失效，请重新推演。';
      }
      this.heatRefreshFailed=false;delete this.root.dataset.heatError;this.collection?.acceptHeat(heat);this.heat=heat;this.workspace.setRegion(this.bounds,heat);this.paint();if(!this.busy&&!this.result)this.$('sb-status').textContent=heat.coverage.usable_samples+'/'+heat.coverage.requested_samples+'可用采样 / '+gridCoverageText(heat)+' · 每120秒刷新';
    }catch(error){if(!this.disposed&&!controller.signal.aborted){this.heatRefreshFailed=true;this.root.dataset.heatError=error.message;this.paint();if(!this.busy)this.$('sb-status').textContent=(this.heat?.cells?.features?.length?'热图刷新失败，保留上次网格。':'实时热图数据暂缺。')+(error.name==='TimeoutError'?'下载超时，请点击刷新重试。':error.message);}}
  }
  expire(){if(this.result&&!this.result.is_forecast&&this.result.weather_boundary.source_type!=='historical_weather'&&!isCurrentObservationTime(this.result.weather_boundary.observed_at)){this.invalidate();this.$('sb-status').textContent='推演天气边界已过期或时间无效，请重新推演。';}this.paint();}
  paint(){
    if(!this.map.getSource('sandbox-heat'))return;
    const requestedLayer=this.$('sb-layer').value;
    const {layer,fallback}=thermalPresentation(requestedLayer,this.mode,this.result,this.weatherLayer);let features=[],label='';
    const paintState=[this.heat,this.result,this.mode,requestedLayer,layer,fallback,this.busy,this.heatRefreshFailed,this.forecastTime,this.map.getSource('sandbox-heat'),this.map.getSource('sandbox-heat-coverage')];
    const paintNow=Date.now();
    if(this.paintState?.every((value,index)=>value===paintState[index])&&paintNow>=this.paintAt&&paintNow<this.paintValidUntil)return;
    this.paintState=paintState;this.paintAt=paintNow;this.paintValidUntil=Infinity;
    const classification=layer==='lcz',live=['risk','weather','heatindex','anomaly','lcz'].includes(layer);
    const summaryHost=this.$('sb-lcz-summary');
    const summary=this.heat?.classification_summary;
    if(summaryHost&&summaryHost.dataset.snapshot!==this.heat?.snapshot_sha256){summaryHost.innerHTML=renderLczSummary(summary);summaryHost.dataset.snapshot=this.heat?.snapshot_sha256||'';}
    const history=this.heat?.case_type==='historical_reanalysis'||this.heat?.baseline?.source_type==='historical_weather';
    const footprint=(live?this.heat?.cells.features:this.result?.cells.features||this.heat?.cells.features)||[];
    const cells=footprint.map((f,index)=>({...f,id:f.id??index}));
    const now=paintNow,fresh=cells.filter(f=>{
      if(history||this.result?.is_forecast&&Date.parse(f.properties.time)===Date.parse(this.result.valid_time))return true;
      const stamp=Date.parse(f.properties.time);
      for(const transition of [stamp-900000,stamp+7200001])if(transition>now)this.paintValidUntil=Math.min(this.paintValidUntil,transition);
      return isCurrentObservationTime(f.properties.time,now);
    });
    if(live&&this.heat){
      const key=layer==='anomaly'?'delta_t_grid_c':layer==='weather'?'temperature_c':'heat_index_c';
      const classReady=classification&&this.heat?.data_mode==='lcz_simulation';
      features=(classReady?cells:fresh).filter(f=>classReady?Number.isInteger(f.properties.lcz_code):layer==='risk'?riskLevels.some(([code])=>code===f.properties.risk):Number.isFinite(f.properties[key])).map(f=>({...f,properties:{...f.properties,value:classReady?f.properties.lcz_code:layer==='risk'?0:f.properties[key]}}));
      label=this.heat.legend;
    }else if(this.result&&['utci','mrt','shade'].includes(layer)){
      const prefix=this.mode==='baseline'?'baseline':'proposed',key=layer==='utci'?prefix+'_utci_c':layer==='mrt'?prefix+'_mrt_c':prefix+'_shade';
      features=cells.flatMap(f=>{const p=f.properties;let value=this.mode==='delta'&&layer==='utci'?p.delta_utci_c:p[key];if(layer==='shade')value=p[prefix+'_occupied']?null:9+29*(1-(p[prefix+'_shade_fraction']??(value?1:0)));if(!Number.isFinite(value))return [];return [{...f,properties:{...p,value}}];});
      label=(this.mode==='delta'&&layer==='utci'?'ΔUTCI：蓝=降低 / 红=升高':(this.result.is_forecast?'预报情景 · ':'探索性 ')+(layer==='utci'?'UTCI':layer==='mrt'?'平均辐射温度':'遮阴：蓝绿=阴 / 橙=阳光'))+' · 非气温预测';
      if(weatherOnlyEstimate(this.result)&&this.mode!=='delta')label=(this.result.night?'夜间':'低太阳高度')+'气象估测 · '+(layer==='utci'?'UTCI':layer==='mrt'?'平均辐射温度≈气温':'无太阳直射 · 非建筑遮阴率');
    }
    const delta=this.mode==='delta'&&layer==='utci';
    if(this.mode==='delta'&&['mrt','shade'].includes(layer))label='方案值（此图层无差值模式） · '+label;
    const validIds=new Set(features.map(f=>f.id)),freshIds=new Set(fresh.map(f=>f.id));
    const coverage=layer==='off'?[]:cells.map(f=>{
      const p=f.properties,valid=validIds.has(f.id),prefix=this.mode==='baseline'?'baseline':'proposed';
      let reason='该指标暂无有效值，未用低风险值代替';
      if(live&&p.source_type==='simulated_lcz'&&p.classified_fraction<0.95)reason='LCZ分类覆盖 '+n(p.classified_fraction*100,1)+'%（低于95%），暂无模拟值';
      else if(live&&!freshIds.has(f.id))reason='资料缺失或过期，请刷新气象边界';
      else if(layer==='heatindex'&&p.risk==='below_range')reason='未达热指数高温适用范围';
      else if(!live&&!this.result)reason=this.busy?'正在重算，暂不显示旧结果':'当前方案尚无有效推演结果';
      else if(!live&&p[prefix+'_occupied'])reason='建筑内部，不计算室外热指标';
      else if(layer==='utci')reason='UTCI边界缺失或超出模型适用域';
      return {...f,properties:{...p,display_state:valid?'valid':'missing',display_reason:valid?'':reason}};
    });
    this.displayCells=coverage;
    this.impactCells=layoutImpact(this.result,this.heat,layer,this.mode).features;
    this.map.getSource('sandbox-layout-impact')?.setData(collection(this.impactCells));
    this.root.dataset.renderedHeatLayer=layer;
    this.workspace.refreshSelection();
    this.map.getSource('sandbox-heat-coverage').setData(collection(coverage));
    this.map.getSource('sandbox-heat').setData(collection(features));this.map.setPaintProperty('sandbox-heat-fill','fill-color',classification&&this.heat?.data_mode==='lcz_simulation'?lczColorExpression:layer==='risk'?riskColors:delta?differenceColors:layer==='anomaly'?anomalyColors:layer==='mrt'?mrtColors:layer==='weather'?temperatureColors:colors);
    if(classification&&this.heat?.data_mode==='lcz_simulation')this.map.setPaintProperty('sandbox-heat-fill','fill-color',lczColorExpression);
    if(!this.legend){
      this.legend=document.createElement('div');this.legend.className='sandbox-legend';this.legend.setAttribute('aria-label','热图图例');document.getElementById('workspace-map').append(this.legend);
      this.legend.addEventListener('click',event=>{if(event.target.closest('[data-return-weather]')){event.stopPropagation();this.showWeather();}});
      for(const type of ['mousedown','pointerdown','touchstart','dblclick'])this.legend.addEventListener(type,event=>{if(event.target.closest('[data-return-weather]'))event.stopPropagation();});
    }
    this.legend.hidden=layer==='off'||classification&&this.heat?.data_mode!=='lcz_simulation';
    const missing=coverage.length-features.length;
    this.legend.dataset.totalCells=String(coverage.length);this.legend.dataset.validCells=String(features.length);this.legend.dataset.missingCells=String(missing);
    this.legend.dataset.dataMode=live?this.heat?.data_mode||'':this.result?.data_mode||this.heat?.data_mode||'';
    this.legend.dataset.refreshState=this.heatRefreshFailed?'stale':'current';
    this.legend.dataset.impactCells=String(this.impactCells.length);
    this.legend.dataset.impactMetric='delta_utci_c';
    this.legend.dataset.layer=layer;this.legend.dataset.requestedLayer=requestedLayer;this.legend.dataset.fallback=fallback||'';this.legend.dataset.displayMode=this.mode;
    window.dispatchEvent(new Event('workspace:heat'));
    this.root.dataset.renderedHeatLayer=layer;
    const coverageNote=missing?'<small><i class="sandbox-missing-key"></i>灰色网格 '+missing+'/'+coverage.length+'：'+(!live&&!this.result?'等待有效推演结果':'分类不足、缺测或指标不适用')+'；不代表低风险。</small>':'';
    if(live){
      const freshObservations=new Set(fresh.map(f=>f.properties.observation_id));
      const samples=(this.heat?.samples||[]).filter(s=>s.observation&&freshObservations.has(s.observation.id));
      const range=key=>{const values=samples.map(s=>s.observation[key]).filter(Number.isFinite);return values.length?(Math.min(...values)===Math.max(...values)?n(values[0]):n(Math.min(...values))+'–'+n(Math.max(...values))):'—';};
      const codes=[...new Set(features.map(f=>f.properties.risk))];
      const status=layer==='anomaly'?'ΔT '+range('delta_t_grid_c')+' °C':layer==='risk'?(features.length?codes.map(code=>riskLevels.find(([id])=>id===code)?.[1]).join(' / '):'暂无有效风险分级'):layer==='weather'?'气温 '+range('temperature_c')+' °C':features.length?'条件性热指数参考':'当前无适用的热指数值';
      const simulation=this.heat?.data_mode==='lcz_simulation';
      const forecast=!!this.forecastTime;
      const source=this.heat?(simulation?'模拟数据 · ':'Open-Meteo · ')+gridCoverageText(this.heat)+(this.heatRefreshFailed?' · 刷新失败，保留上次数据':''):this.heatRefreshFailed?'刷新失败 · 暂无缓存':'正在获取天气数据';
      const observed=fresh.map(f=>f.properties.time).sort()[0];
      const swatches=layer==='risk'?'<div class="sandbox-risk-scale">'+riskLevels.map(([code,text,color])=>'<span'+(codes.includes(code)?' class="active"':'')+'><i style="background:'+color+'"></i>'+e(text)+'</span>').join('')+'</div>':'';
      const emptyReason=!features.length?(layer==='heatindex'&&fresh.length&&fresh.every(f=>f.properties.risk==='below_range')?'当前气温未达热指数高温适用范围；不填造数值。':this.heat?'观测缺失、过期或指标不适用；未用模拟数据填补。':'天气数据暂缺或加载中。'):'';
      this.legend.innerHTML='<div class="sandbox-legend-head"><strong>'+e((forecast?'预报情景 · ':simulation?'LCZ模拟 · ':history?'历史案例 · ':'当前气象 · ')+(layer==='anomaly'?'冷暖分布':layer==='risk'?'环境热风险':layer==='weather'?'网格气温':'网格热指数'))+'</strong><span>'+e(status)+'</span></div>'+swatches+
        (features.length?'<span>气温 '+e(range('temperature_c'))+' °C · 湿度 '+e(range('relative_humidity_pct'))+'%</span>':'<span>'+e(emptyReason)+'</span>')+
        '<small>'+e(source)+(observed?' · '+e(date(observed))+' 北京时间':'')+'</small>'+(layer==='risk'?'<small>NOAA/NWS · 阴凉轻风参考</small>':'');
      if(layer==='weather')this.legend.insertAdjacentHTML('beforeend','<div class="sandbox-temperature-scale"></div><small>气温固定色标 · 10 / 25 / 30 / 35 / 40°C</small>');
      if(layer==='anomaly')this.legend.insertAdjacentHTML('beforeend','<div class="sandbox-anomaly-scale" title="相对同刻气象边界的模拟气温差；冷暖颜色不代表热风险等级。固定色标，不随场景拉伸。"></div><div class="sandbox-anomaly-ticks"><span>≤−2°C</span><span>偏冷</span><span>0</span><span>偏暖</span><span>≥+2°C</span></div><small>相对气象基准 '+n(this.heat?.baseline?.temperature_c)+'°C · 模拟数据；红色表示偏暖，风险请切换分级图层。</small>');
      if(coverageNote)this.legend.insertAdjacentHTML('beforeend',coverageNote);
      if(classification&&this.heat?.data_mode==='lcz_simulation')this.legend.innerHTML='<div class="sandbox-legend-head"><strong>LCZ 分类分布</strong><span>'+features.length+' 个分类网格</span></div><small title="格网颜色表示主导地表类型；计算仍使用完整的面积混合比例。">主导类型 · 模拟分类</small>'+(summary?'<small>'+e(summary.classes.slice(0,3).map(row=>row.name+' '+n(row.area_fraction*100,1)+'%').join(' / '))+'</small>':'')+coverageNote;
      if(fallback){
        const message=fallback==='pending'?(this.busy?'重算中 · 保留气象热图':'情景结果未就绪 · 显示气象热图'):fallback==='night_no_shortwave'?'按温湿度估测 · 无日晒增量 · 拆建差值未估计':fallback==='no_edits'?'尚未拆建 · 显示气象热图':'无可比室外单元 · 显示气象热图';
        this.legend.insertAdjacentHTML('beforeend','<small role="status">'+e(message)+'</small><button type="button" class="sandbox-legend-return" data-return-weather>返回气象热图</button>');
      }
      if(this.impactCells.length){
        const values=this.impactCells.map(f=>f.properties.delta_utci_c);
        this.legend.insertAdjacentHTML('beforeend','<small role="status" class="sandbox-impact-note" title="底色保留同刻LCZ温湿度；蓝色边框为UTCI降低，红色边框为UTCI升高。UTCI变化不作为气温变化相加。">拆建影响 '+this.impactCells.length+' 格 · ΔUTCI '+n(Math.min(...values),3)+' 至 '+n(Math.max(...values),3)+'°C</small>');
      }
      this.compactLegend();return;
    }
    const ticks=delta?differenceTicks:layer==='mrt'?[[0,'0'],[20,'20'],[40,'40'],[60,'60'],[80,'80']]:layer==='shade'?[[0,'遮阴'],[1,'日照']]:[[-15,'−15'],[9,'9'],[26,'26'],[32,'32'],[38,'38'],[46,'46'],[60,'60']];
    const [low,high]=[ticks[0][0],ticks.at(-1)[0]];
    const time=this.result&&['utci','mrt','shade'].includes(layer)?(this.result.is_forecast?'逐小时预报 / ':this.result.weather_boundary.source_type==='historical_weather'?'历史再分析 / ':'模型边界 / ')+date(this.result.weather_boundary.observed_at):'';
    this.legend.innerHTML=features.length?'<div class="sandbox-colorbar '+(delta?'delta':layer==='mrt'?'mrt':layer==='shade'?'shade':'')+'"></div><div class="sandbox-ticks">'+ticks.map(([value,text])=>'<span style="left:'+((value-low)/(high-low)*100)+'%">'+text+'</span>').join('')+'</div><span>'+e(label)+(layer!=='shade'?' · °C':'')+'</span>'+(time?'<small>'+e(time)+' 北京时间</small>':''):'<strong>尚无情景计算结果</strong><small>该图层需要有效的布局推演结果。</small>';
    if(coverageNote)this.legend.insertAdjacentHTML('beforeend',coverageNote);
    this.legend.insertAdjacentHTML('beforeend','<button type="button" class="sandbox-legend-return" data-return-weather>返回气象热图</button>');
    if(delta)this.legend.insertAdjacentHTML('beforeend','<small>'+e(effectLabels[this.result?.effect_status]||'')+' · 固定色标 −5 至 +5°C'+help('蓝色为UTCI降低，橙红为升高；±0.1°C内使用中性色。颜色不自动拉伸，精确数值仍保留在网格和报告中。','差值色标')+'</small>');
    this.compactLegend();
  }
  compactLegend(){
    const notes=[...this.legend.querySelectorAll(':scope > small:not([role=status])')];
    if(!notes.length)return;
    const details=document.createElement('details');details.open=!!this.legendDetailsOpen;
    details.innerHTML='<summary>数据与色标说明</summary>';details.append(...notes);
    details.addEventListener('toggle',()=>{this.legendDetailsOpen=details.open;});
    this.legend.append(details);
  }
  renderSummary(){
    if(this.summaryResult===this.result)return;
    this.summaryResult=this.result;
    if(!this.result){this.$('sb-summary').replaceChildren();return;}const s=this.result.summary;
    this.$('sb-summary').innerHTML='<div class="sandbox-results"><p class="notice">'+(this.result.weather_boundary.source_type==='historical_weather'?'历史再分析案例 · 不用于当前指挥':'当前小时网格边界 · 非现场实测')+'</p><strong>'+n(s.delta_utci_c,2)+' °C</strong><span>同位置平均 ΔUTCI · 非气温差</span><dl><div><dt>现状 / 方案 UTCI</dt><dd>'+n(s.baseline_utci_c)+' / '+n(s.proposed_utci_c)+' °C</dd></div><div><dt>可比位置遮阴</dt><dd>'+n(s.baseline_shade_pct,1)+'% → '+n(s.proposed_shade_pct,1)+'%</dd></div><div><dt>强热应激面积（UTCI≥32°C）</dt><dd>'+n(s.baseline_strong_heat_area_pct,1)+'% → '+n(s.proposed_strong_heat_area_pct,1)+'%</dd></div><div><dt>有效可比单元</dt><dd>'+s.comparable_cells+' / '+s.total_cells+'</dd></div></dl><p>'+e(s.baseline_stress)+' → '+e(s.proposed_stress)+'</p><div class="context-help-row">面积非患病比例'+help('面积比例按标准参考人UTCI≥32°C计算，不是人员患病比例；平均变化不代表所有局部位置。','热暴露统计说明')+'</div><p>未现场标定 · 边界 '+date(this.result.weather_boundary.observed_at)+' 北京时间</p><details><summary>模型适用范围</summary>'+(this.result.night?'<p>夜间不评估建筑蓄热影响。</p>':'')+'<p>'+e(this.result.note)+'</p><p>未现场标定，不输出置信度。</p></details></div>';
    if(this.result.data_mode==='lcz_simulation')this.$('sb-summary').querySelector('.notice').textContent=(this.result.weather_boundary.source_type==='historical_weather'?'历史LCZ模拟 · 非当前':'LCZ模拟温湿度 + 建筑辐射情景')+' · 非实测、未标定 · 快照 '+this.result.lcz_snapshot_sha256.slice(0,12);
    if(this.result.is_forecast)this.$('sb-summary').querySelector('.notice').textContent='预报情景 · '+date(this.result.valid_time,true)+' 北京时间'+(this.result.data_mode==='lcz_simulation'?' · LCZ模拟':'');
    this.$('sb-summary').querySelector('.sandbox-results > strong').textContent=deltaText(s.delta_utci_c)+' °C';
    this.$('sb-summary').querySelector('dl').insertAdjacentHTML('beforeend','<div><dt>局部 ΔUTCI 范围</dt><dd>'+deltaText(s.local_delta_min_c)+' 至 '+deltaText(s.local_delta_max_c)+' °C</dd></div><div><dt>变化单元 / 可比单元</dt><dd>'+(s.changed_cells??0)+' / '+s.comparable_cells+'</dd></div>');
    const spatial=this.result.spatial_inference,near=this.result.neighbourhood;
    if(near)this.$('sb-summary').querySelector('dl').insertAdjacentHTML('beforeend','<div><dt>邻域重算</dt><dd>'+near.computed_cells+' 格 / 50·150·300 m</dd></div><div><dt>本地学习 / 物理校验</dt><dd>'+(spatial?.accepted_cell_scenarios||0)+' / '+(spatial?.accepted_cell_scenarios+spatial?.physics_fallback_cell_scenarios||0)+'</dd></div>');
    const weatherOnly=weatherOnlyEstimate(this.result),unavailable=this.result.effect_status==='no_comparable_cells';
    this.$('sb-summary').dataset.assessmentMode=weatherOnly?(this.result.night?'night_weather_estimate':'low_sun_weather_estimate'):'solar_weather_estimate';
    if(weatherOnly||unavailable||this.result.effect_status==='no_edits'){
      const headline=this.$('sb-summary').querySelector('.sandbox-results > strong');
      headline.textContent=weatherOnly?n(s.proposed_utci_c)+' °C':this.result.effect_status==='no_edits'?'尚未拆建':'无可比结果';
      if(!weatherOnly)headline.style.fontSize='22px';
      const basis=this.result.night?'夜间气象估测':'低太阳高度气象估测';
      headline.nextElementSibling.textContent=weatherOnly?basis+' · UTCI':'同位置 ΔUTCI 对比';
      if(weatherOnly||unavailable){
        const rows=this.$('sb-summary').querySelectorAll('dl > div');
        if(weatherOnly){
          rows[0].querySelector('dt').textContent='气象热应激';rows[0].querySelector('dd').textContent=s.proposed_stress;
          rows[1].querySelector('dt').textContent='太阳直射增量';
          rows[2].querySelector('dd').textContent=n(s.proposed_strong_heat_area_pct,1)+'%';
          this.$('sb-summary').querySelector('dl').nextElementSibling.textContent=s.proposed_stress;
          headline.nextElementSibling.insertAdjacentHTML('beforeend',help('按本次温湿度与10米风估测，平均辐射温度近似气温，不计太阳短波增量；高温高湿夜间仍可能有较高风险。建筑蓄热与局地通风变化尚未求解。','夜间估测依据'));
        }
        rows[1].querySelector('dd').textContent=weatherOnly?'不计入':'不适用';
        rows[4].querySelector('dt').textContent=weatherOnly?'拆建热增量':'局部 ΔUTCI 范围';
        rows[4].querySelector('dd').textContent=weatherOnly?'未估计':'未评估';
        rows[5].querySelector('dd').textContent='— / '+s.comparable_cells;
      }
    }
    const note=document.createElement('p');note.className='notice';note.textContent=effectLabels[this.result.effect_status]||'';this.$('sb-summary').querySelector('.sandbox-results').append(note);
    if(this.result.effect_status==='night_no_shortwave'||this.result.solar.altitude_deg<2){
      const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent='历史高温日间对比';button.addEventListener('click',()=>this.compareDaylight());note.after(button);
    }
    icons();
  }
  report(){
    const r=this.result?.regional_report;if(this.disposed||!r||this.$('sb-report-dialog').open)return;
    const facts=r.interpretation.fact_ids.map(id=>r.facts.find(f=>f.id===id)).filter(Boolean);
    const sources=[...new Map([...this.result.sources,...r.sources].map(s=>[s.id,s])).values()];
    this.$('sb-report-content').innerHTML='<p class="notice">'+e(r.purpose)+'</p><h4>'+e(r.environment.risk_label)+' / '+r.cohorts.length+' 类人群</h4><p>'+(r.generation.mode==='ai_regional_evidence_selection'?'AI实际调用：对计算事实和人群情景进行证据编排':'规则降级：'+e(generationReasons[r.generation.reason]||r.generation.reason))+'</p><ol>'+facts.map(f=>'<li>'+e(f.text)+' ['+e(f.source_ids.join(', '))+']</li>').join('')+'</ol>'+r.cohorts.map(c=>'<section><h4>'+e(c.label)+'</h4><p>'+e(c.assessment)+' / '+e(activityLabels[c.context.activity]||c.context.activity)+' / '+c.context.minutes+'分钟</p><ul>'+c.attention_factors.map(f=>'<li>'+e(f.text)+'</li>').join('')+'</ul>'+(c.medical_advice.length?c.medical_advice.map(a=>'<p>'+e(a.text)+' ['+e(a.citation_id)+']</p>').join(''):'<p>暂无适用的已审核医学条款，不输出疾病诊断或处置建议。</p>')+'</section>').join('')+'<h4>方法与限制</h4><ul>'+this.result.limitations.map(x=>'<li>'+e(x)+'</li>').join('')+'</ul><h4>来源</h4>'+sources.map(s=>'<p><a href="'+e(s.url)+'" target="_blank" rel="noopener">['+e(s.id)+'] '+e(s.title)+'</a></p>').join('')+'<p class="field-help">'+e(this.result.report_sha256)+'</p>';
    if(r.orchestration){const w=r.orchestration;this.$('sb-report-content').insertAdjacentHTML('afterbegin','<section class="sandbox-workflow"><h4>云端与本地模型协同</h4><p>'+(w.mode==='deepseek_tools_local_models'?'DeepSeek选择工具，服务器执行计算，计算结果回传AI完成证据研判。':'本地计算已完成，云端步骤未全部通过，保留可追溯降级结果。')+'</p><ul>'+w.tools.map(t=>'<li>'+e(t.name)+' / '+(t.trigger==='deepseek'?'AI调用':'规则调度')+' / '+(t.status==='completed'?'已完成':'未完成')+'</li>').join('')+'</ul><p>'+(w.station_status==='predicted'?'本地时序模型已返回15分钟预测；未改写当前情景气象边界。':'未提供可用连续站点序列，未启用时序预测。')+'</p><p class="field-help">数值结果 '+e(w.numerical_sha256)+'</p></section>');}
    this.$('sb-report-content').insertAdjacentHTML('afterbegin',renderDecisionAnalysis(r));
    if(r.classification_summary)this.$('sb-report-content').insertAdjacentHTML('beforeend','<section>'+renderLczSummary(r.classification_summary)+'</section>');
    if(this.result.neighbourhood){
      const near=this.result.neighbourhood,spatial=this.result.spatial_inference;
      const hotspots=[...near.cooling_hotspots,...near.warming_hotspots];
      this.$('sb-report-content').insertAdjacentHTML('beforeend','<section class="sandbox-neighbourhood"><h4>逐格邻域推理</h4><p>'+near.computed_cells+' 个单元 · 邻域 50 / 150 / 300 m</p><p>遮阴变化 '+near.mechanism_counts.direct_solar_shading+' 格 · 天空遮挡变化 '+near.mechanism_counts.diffuse_sky_obstruction+' 格</p><table><thead><tr><th>格点</th><th>距拆建</th><th>ΔUTCI</th><th>遮阴变化</th></tr></thead><tbody>'+hotspots.map(h=>'<tr><td>'+e(h.grid_id)+'</td><td>'+n(h.distance_to_edit_m,0)+' m</td><td>'+deltaText(h.delta_utci_c)+'°C</td><td>'+n(h.effect.delta_shade_fraction*100,2)+'%</td></tr>').join('')+'</tbody></table><details><summary>学习模型与校验依据</summary><p>本地模型已通过物理计算校验的单元场景 '+(spatial?.accepted_cell_scenarios||0)+'；其余使用传统计算。模型蒸馏自UTCI公式，未以现场空间温差标定。</p><p class="field-help">'+e(spatial?.artifact_sha256||'模型未加载')+'</p></details></section>');
      const comparison=r.orchestration?.layout_comparison;
      if(comparison){
        const selection=comparison.recommendation,labels={improved:'存在辐射热暴露更低的备选',no_improvement:'当前方案热暴露更低或持平',not_evaluable:'当前条件不足以筛选热改善方案'};
        this.$('sb-report-content').insertAdjacentHTML('beforeend','<section class="sandbox-alternatives"><h4>'+(comparison.proposal_origin==='deepseek'?'AI建议 × 物理回算':'规则备选 × 物理回算')+'</h4><p>'+e(labels[selection?.status]||'同边界高度对比')+'</p>'+comparison.alternatives.map((v,i)=>'<article><h5>备选 '+(i+1)+(selection?.selected_candidate_id===v.id?' · 辐射指标优选':'')+'</h5><p>'+e(v.proposal?.rationale||'高度敏感性计算')+'</p><p>高度 '+e(v.height_changes.map(h=>n(h.height_m,1)+' m').join(' / '))+' · UTCI '+n(v.summary.proposed_utci_c,3)+'°C</p><p>局部 ΔUTCI '+deltaText(v.summary.local_delta_min_c)+' 至 '+deltaText(v.summary.local_delta_max_c)+'°C</p><button type="button" class="button" data-adopt-candidate="'+e(v.id)+'">'+icon('check')+'采用参数并重算</button></article>').join('')+'<details><summary>计算依据</summary><p>'+e(selection?.scope||'仅比较辐射热暴露。')+'</p><p>物理基线 → 参数建议 → 方程逐格回算 → 同位置比较；尚未改变当前建筑。</p></details></section>');
        const reportSha=this.result.report_sha256;
        this.$('sb-report-content').querySelectorAll('[data-adopt-candidate]').forEach(button=>button.addEventListener('click',()=>this.adoptCandidate(button.dataset.adoptCandidate,reportSha)));
        icons();
      }
    }
    const caseNote=document.createElement('p');caseNote.className='notice';caseNote.textContent=(r.case_type==='historical_reanalysis'?'历史再分析案例，不用于当前活动指挥。':'当前小时模型资料，非现场实测。')+' '+date(this.result.weather_boundary.observed_at)+' 北京时间';this.$('sb-report-content').prepend(caseNote);
    if(r.data_mode==='lcz_simulation')caseNote.textContent=(r.baseline.source_type==='historical_weather'?'历史LCZ模拟 · 非当前。':'LCZ模拟演示。')+'非实测、未标定，不用于真实医疗决策。快照 '+r.snapshot_sha256.slice(0,12)+' · 气象边界 '+date(r.baseline.observed_at)+' 北京时间';
    if(r.is_forecast)caseNote.textContent='预报情景 · '+date(r.valid_time)+' 北京时间'+(r.data_mode==='lcz_simulation'?' · LCZ模拟':'');
    const checks=r.interpretation.action_ids.map(id=>r.management_checks.find(a=>a.id===id)).filter(Boolean);
    this.$('sb-report-content').insertAdjacentHTML('beforeend','<h4>管理核查项</h4><ol>'+checks.map(a=>'<li>'+e(a.text)+' ['+e(a.source_ids.join(', '))+']</li>').join('')+'</ol>');
    this.$('sb-report-dialog').showModal();
  }
  async adoptCandidate(id,reportSha){
    const result=this.result;
    if(this.disposed||this.busy||this.validating||result?.report_sha256!==reportSha||JSON.stringify(result.scene)!==JSON.stringify(this.scene))return;
    const candidate=result.orchestration?.layout_comparison?.alternatives.find(v=>v.id===id);
    if(!candidate)return;
    const heights=new Map(candidate.height_changes.map(h=>[h.building_id,h.height_m]));
    if(!await this.applyGeometry(scene=>scene.additions.forEach(a=>{if(heights.has(a.id))a.height_m=heights.get(a.id);})))return;
    this.presentationRevision++;this.workspace.setInteraction('inspect');this.mode='proposed';this.$('sb-layer').value='utci';this.select(null);this.updateScene();
    await this.run({automatic:true});
  }
  headers(){let token;try{token=localStorage.getItem(isCompetition?'microclimate-competition-token':'microclimate-workspace-token');}catch{}return {'X-Workspace-Token':token||'','Content-Type':'application/json'};}
  async save(){if(this.disposed||this.saving||this.validating)return;this.saving=true;this.controls();try{await request('/api/weather/sandbox/scenes',{headers:this.headers(),json:this.scene});if(this.disposed)return;toast('情景已保存，原始底图保持不变。');await this.loadScenes();}catch(error){if(!this.disposed)this.error(error.message);}finally{this.saving=false;if(!this.disposed)this.controls();}}
  async loadScenes(){
    if(this.disposed)return;this.libraryController?.abort();const controller=this.libraryController=new AbortController();
    try{const data=await request('/api/weather/sandbox/scenes',{headers:this.headers(),signal:AbortSignal.any([this.lifetime.signal,controller.signal])});if(this.disposed||controller.signal.aborted)return;
      data.scenes=data.scenes.filter(s=>(s.scene.area_kind||'campus')===this.areaKind);
      this.$('sb-library').innerHTML=data.scenes.length?data.scenes.map(s=>'<div><button class="text-button" data-load-scene="'+e(s.id)+'">'+e(s.scene.name)+' / +'+s.scene.additions.length+' −'+s.scene.removed_ids.length+'</button><button class="icon-button" data-delete-scene="'+e(s.id)+'" title="删除保存情景" aria-label="删除保存情景">'+icon('trash-2')+'</button></div>').join(''):'<p class="field-help">暂无保存的情景</p>';
      this.$('sb-library').querySelectorAll('[data-load-scene]').forEach(b=>b.addEventListener('click',async()=>{const r=data.scenes.find(s=>s.id===b.dataset.loadScene);if(!await this.applyGeometry(s=>Object.assign(s,clone(r.scene))))return;this.$('sb-name').value=this.scene.name;this.presentationRevision++;this.leaveDelta('edit');this.select(null);this.updateScene();}));
      this.$('sb-library').querySelectorAll('[data-delete-scene]').forEach(b=>b.addEventListener('click',()=>this.deleteScene(b.dataset.deleteScene)));this.controls();icons();
    }catch(error){if(!this.disposed&&!controller.signal.aborted)this.$('sb-library').textContent=error.message;}
  }
  async deleteScene(id){
    this.deletingScenes??=new Set();if(this.disposed||this.deletingScenes.has(id))return;
    if(!await this.confirm('删除保存的情景','原始建筑与当前编辑副本保持不变。')||this.disposed||this.deletingScenes.has(id))return;
    this.deletingScenes.add(id);this.controls();
    try{await request('/api/weather/sandbox/scenes/'+id,{method:'DELETE',headers:this.headers()});if(!this.disposed)await this.loadScenes();}
    catch(error){if(!this.disposed)this.error(error.message);}
    finally{this.deletingScenes.delete(id);if(!this.disposed)this.controls();}
  }
  destroy(){this.disposed=true;clearTimeout(this.autoTimer);this.collection?.destroy();this.cancelConfirmation?.();clearInterval(this.timer);this.geometryController?.abort();this.libraryController?.abort();this.heatController?.abort();this.runController?.abort();this.lifetime.abort();document.getElementById('decision-screen')?.classList.remove('sandbox-mobile-open');this.mobileToggle?.remove();this.root?.remove();this.legend?.remove();}
}
