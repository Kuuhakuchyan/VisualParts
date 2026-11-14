import { Marker } from 'maplibre-gl';
import proj4 from 'proj4';
import { icon, icons, help, escape as e, numeric as n, date, request, download } from './ui.js';

const fc=features=>({type:'FeatureCollection',features});
const projection='+proj=utm +zone=49 +datum=WGS84 +units=m +no_defs';
const statusLabels={online:'在线 · 实测读取',offline:'离线',awaiting_sample:'在线 · 等待读数',unavailable:'接口暂不可用',isolated:'未接入 · 独立环境'};

export class CollectionWorkspace {
  constructor(sandbox){this.sandbox=sandbox;this.workspace=sandbox.workspace;this.map=sandbox.map;this.lifetime=new AbortController();this.elapsed=0;this.rate=20;this.markers=[];}
  mount(){
    this.sandbox.$('sb-refresh').insertAdjacentHTML('afterend','<button class="text-button" id="sb-collection" type="button">'+icon('route')+'设备与采集仿真</button>');
    this.dialog=document.createElement('dialog');this.dialog.className='collection-dialog';this.dialog.id='collection-dialog';this.dialog.setAttribute('aria-labelledby','collection-title');
    this.dialog.innerHTML='<header><div><p class="eyebrow">COLLECTION / SIMULATION</p><h2 id="collection-title">设备与采集仿真</h2></div><button id="collection-close" class="icon-button" type="button" title="关闭" aria-label="关闭">'+icon('x')+'</button></header>'+
      '<section><div class="section-header"><div class="heading-with-help"><h3>现场传感器</h3>'+help('设备只读接入，每30秒刷新；离线设备不生成实测读数。','现场传感器说明')+'</div><button class="icon-button" id="collection-devices-refresh" title="刷新设备" aria-label="刷新设备">'+icon('refresh-cw')+'</button></div><div id="collection-devices" aria-live="polite">正在读取设备…</div></section>'+
      '<section><div class="section-header"><div class="heading-with-help"><h3>无人机 / 无人车任务</h3>'+help('使用当前选区、建筑方案和LCZ网格规划任务。修改场景后需重新生成；不向真实设备发送控制指令。','采集任务帮助')+'</div><span class="badge">模拟数据</span></div><p id="collection-status" role="status">未生成任务</p><div class="collection-controls"><button class="button primary" id="collection-generate">'+icon('route')+'生成任务</button><button class="icon-button" id="collection-play" title="播放采集仿真" aria-label="播放采集仿真" aria-pressed="false" disabled>'+icon('play')+'</button><button class="icon-button" id="collection-reset" title="回到任务起点" aria-label="回到任务起点" disabled>'+icon('rotate-ccw')+'</button><label class="field">回放速度<select id="collection-speed"><option value="1">1×</option><option value="20" selected>20×</option><option value="60">60×</option></select></label><button class="icon-button" id="collection-export" title="导出任务与采样" aria-label="导出任务与采样" disabled>'+icon('download')+'</button></div><label class="collection-progress" for="collection-progress">任务时间 <output id="collection-time">0 / 0 s</output><input id="collection-progress" type="range" min="0" max="1" value="0" step="0.1" disabled></label><div id="collection-tracks"></div><details class="collection-method"><summary>数据来源与仿真边界</summary><p id="collection-note">从当前LCZ温湿度模拟场抽样；不向真实设备发送控制指令。航线温湿度为地面网格投影，不是飞行高度的气象观测。</p><dl id="collection-provenance"></dl></details></section>';
    (document.getElementById('decision-screen')||document.body).append(this.dialog);this.$=id=>this.dialog.querySelector('#'+id);
    this.$('collection-status').insertAdjacentHTML('afterend','<div class="collection-budget"><label class="field">无人车电量 Wh<input id="collection-ugv-budget" type="number" min="1" max="500" value="40" step="1"></label><label class="field">无人机电量 Wh<input id="collection-uav-budget" type="number" min="1" max="500" value="70" step="1"></label><label class="field">安全余量<select id="collection-reserve"><option value="0.25">25%</option><option value="0.35">35%</option><option value="0.5">50%</option></select></label></div>');
    this.dialog.querySelector('.collection-budget').insertAdjacentHTML('beforeend','<label class="field">任务起点<select id="collection-start"><option value="reference_station">基准站附近路网节点</option><option value="central_staging">选区模拟集结点</option></select></label>');
    this.$('collection-start').addEventListener('change',()=>this.invalidate('起点已改变，请重新规划任务。'));
    for(const id of ['collection-ugv-budget','collection-uav-budget','collection-reserve'])this.$(id).addEventListener('change',()=>this.invalidate('电量预算已改变，请重新规划路线。'));
    this.sandbox.$('sb-collection').addEventListener('click',()=>this.open());
    this.$('collection-close').addEventListener('click',()=>this.dialog.close());
    this.$('collection-devices-refresh').addEventListener('click',()=>this.pollDevices());
    this.$('collection-generate').addEventListener('click',()=>this.generate());
    this.$('collection-play').addEventListener('click',()=>this.playing?this.pause():this.play());
    this.$('collection-reset').addEventListener('click',()=>{this.pause();this.elapsed=0;this.renderFrame();});
    this.$('collection-speed').addEventListener('change',()=>{this.rate=Number(this.$('collection-speed').value);});
    this.$('collection-progress').addEventListener('input',()=>{this.pause();this.elapsed=Number(this.$('collection-progress').value);this.renderFrame();});
    this.$('collection-export').addEventListener('click',()=>{if(this.mission)download(this.mission,'microclimate-collection-simulation.json');});
    for(const id of ['collection-routes','collection-trails'])this.map.addSource(id,{type:'geojson',data:fc([])});
    this.map.addLayer({id:'collection-route-lines',type:'line',source:'collection-routes',paint:{'line-color':['match',['get','device'],'UAV_SIM_01','#e4b967','#65d8be'],'line-width':2,'line-dasharray':[3,2],'line-opacity':0.8}});
    this.map.addLayer({id:'collection-trail-lines',type:'line',source:'collection-trails',paint:{'line-color':['match',['get','device'],'UAV_SIM_01','#ffda89','#88ffe0'],'line-width':4}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pause();else this.pollDevices();},{signal:this.lifetime.signal});
    this.deviceTimer=setInterval(()=>{if(!document.hidden)this.pollDevices();},30000);
    this.pollDevices();icons();
  }
  open(){if(this.disposed||this.dialog.open)return;this.workspace.setInteraction('inspect');this.sandbox.setMobileOpen(false);this.dialog.showModal();}
  async pollDevices(){
    if(this.disposed||this.deviceBusy)return;this.deviceBusy=true;this.$('collection-devices-refresh').disabled=true;
    try{
      const data=await request('/api/weather/sandbox/collection/devices',{signal:this.lifetime.signal});
      if(this.disposed)return;this.sandbox.state.fieldDevices=data;
      this.$('collection-devices').innerHTML=data.devices.map(d=>'<div class="collection-device" data-device="'+e(d.device_id)+'" data-status="'+e(d.status)+'"><div><strong>'+e(d.label)+'</strong><small>'+e(d.device_id)+'</small></div><span class="collection-device-status '+(d.status==='online'?'online':'')+'">'+e(statusLabels[d.status]||d.status)+'</span><div class="collection-device-reading"><strong>'+n(d.temperature_c)+' °C / '+n(d.humidity_pct)+' %</strong><small>'+(d.status==='online'?date(d.observed_at):d.last_seen?'最后联络 '+date(d.last_seen):'暂无有效采样')+'</small></div></div>').join('');
      window.dispatchEvent(new Event('workspace:devices'));
    }catch(error){if(!this.disposed){this.$('collection-devices').textContent='设备接口暂不可用，未用模拟读数代替。';this.sandbox.state.fieldDevices=null;window.dispatchEvent(new Event('workspace:devices'));}}
    finally{this.deviceBusy=false;if(!this.disposed)this.$('collection-devices-refresh').disabled=false;}
  }
  async generate(){
    if(!this.$('collection-ugv-budget').reportValidity()||!this.$('collection-uav-budget').reportValidity())return;
    if(this.disposed||this.busy)return;
    if(this.sandbox.regional().data_mode!=='lcz_simulation'||this.sandbox.regional().area_kind!=='campus'){this.$('collection-status').textContent='请在沙盘中选择校园LCZ模拟网格后生成任务。';return;}
    this.invalidate('正在读取当前网格快照…');this.busy=true;this.$('collection-generate').disabled=true;
    const revision=this.revision,controller=this.controller=new AbortController();
    try{
      await this.sandbox.refreshHeat();
      if(this.disposed||controller.signal.aborted||revision!==this.revision)return;
      const snapshot=this.sandbox.heat?.snapshot_sha256;if(!snapshot)throw new Error('当前网格不可用，请先刷新热图。');
      const data=await request('/api/weather/sandbox/collection/simulate',{json:{regional:{...this.sandbox.regional(),use_ai:false},scene:this.sandbox.scene,expected_snapshot_sha256:snapshot,ugv_budget_wh:Number(this.$('collection-ugv-budget').value),uav_budget_wh:Number(this.$('collection-uav-budget').value),reserve_fraction:Number(this.$('collection-reserve').value),start_mode:this.$('collection-start').value,...(this.sandbox.forecastTime?{valid_time:this.sandbox.forecastTime}:{})},signal:AbortSignal.any([this.lifetime.signal,controller.signal]),timeoutMs:60000});
      if(this.disposed||controller.signal.aborted||revision!==this.revision)return;
      if(data.snapshot_sha256!==this.sandbox.heat?.snapshot_sha256)throw new Error('网格快照已更新，请重新生成任务。');
      this.mission=data;this.sandbox.state.collectionMission=data;this.elapsed=0;
      this.duration=Math.max(0,...data.tracks.map(t=>t.duration_s||0));
      this.map.getSource('collection-routes').setData(fc(data.tracks.filter(t=>t.route).map(t=>({type:'Feature',geometry:t.route,properties:{device:t.device_id}}))));
      this.$('collection-tracks').innerHTML=data.tracks.map(t=>'<article class="collection-track" data-track="'+e(t.device_id)+'"><div class="section-header"><h4>'+icon(t.device_id.startsWith('UAV')?'plane':'truck')+e(t.label)+'</h4><span>'+(t.status==='ready'?n(t.distance_m,0)+' m · '+t.speed_mps+' m/s'+(t.altitude_agl_m?' · 航高 '+t.altitude_agl_m+' m':''):'选区无可用路线')+'</span></div><div class="collection-track-values"><strong data-temperature>—</strong><strong data-humidity>—</strong><span data-seq></span></div><small data-grid></small></article>').join('');
      for(const t of data.tracks){const p=t.planning;if(!p)continue;const row=this.dialog.querySelector('[data-track="'+t.device_id+'"]');row.insertAdjacentHTML('beforeend','<p class="field-help">'+(t.status==='ready'?'闭合返航 · 预计 '+n(p.estimated_energy_wh,2)+' / '+n(p.usable_budget_wh,1)+' Wh · 覆盖 '+p.covered_grid_count+' / '+p.reachable_grid_count+' 可达网格 · '+p.network_components+' 个连通分量':'规划状态：'+e(p.status))+'</p>');}
      for(const track of data.tracks){
        if(!track.route)continue;
        const element=document.createElement('div');element.className='collection-marker '+(track.device_id.startsWith('UAV')?'aerial':'ground');element.setAttribute('aria-hidden','true');element.innerHTML=icon(track.device_id.startsWith('UAV')?'plane':'truck');
        const marker=new Marker({element,anchor:'center'}).setLngLat(track.route.coordinates[0]).addTo(this.map);
        const metric=track.route.coordinates.map(p=>proj4('EPSG:4326',projection,p));const cumulative=[0];
        for(let i=1;i<metric.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(metric[i][0]-metric[i-1][0],metric[i][1]-metric[i-1][1]));
        this.markers.push({track,marker,metric,cumulative});
      }
      this.$('collection-progress').max=String(Math.max(1,this.duration));
      for(const track of data.tracks){
        const p=track.planning;if(track.status!=='ready'||!p?.reachable_lcz_classes)continue;
        this.dialog.querySelector('[data-track="'+track.device_id+'"]').insertAdjacentHTML('beforeend','<small class="collection-lcz-coverage" title="'+e('已覆盖主导类型：'+p.covered_lcz_classes.join(' / ')+'；未覆盖：'+(p.uncovered_lcz_classes.join(' / ')||'无')+'。按路网节点统计，非实测分类验证。')+'">LCZ 类型 '+p.covered_lcz_classes.length+' / '+p.reachable_lcz_classes.length+'</small>');
      }
      for(const id of ['collection-play','collection-reset','collection-progress','collection-export'])this.$(id).disabled=!this.duration;
      this.$('collection-note').textContent=data.note;
      if(data.lcz_planning)this.$('collection-note').textContent+=' 分类多样性用于路线收益排序，系未标定规划权重。';
      this.$('collection-provenance').innerHTML='<dt>天气边界</dt><dd>'+e(date(data.boundary.observed_at))+' 北京时间 · '+e(data.boundary.source_type)+'</dd><dt>网格快照</dt><dd>'+e(data.snapshot_sha256)+'</dd><dt>建筑方案</dt><dd>'+e(data.scene_sha256)+'</dd><dt>任务编号</dt><dd>'+e(data.mission_id)+'</dd><dt>接口</dt><dd>'+e(data.schema_version)+' / UTC / WGS84 / °C / %RH / quality_flag=null</dd>';
      if(data.classification_sha256)this.$('collection-provenance').insertAdjacentHTML('beforeend','<dt>LCZ 分类版本</dt><dd>'+e(data.classification_sha256)+'</dd>');
      this.$('collection-status').textContent=this.duration?(data.is_forecast?'预报情景 '+date(data.valid_time,true)+' · ':'')+'任务已生成 · 关闭面板后可在地图查看回放':'选区内没有可用的采集路线';this.renderFrame();icons();
    }catch(error){if(!this.disposed&&!controller.signal.aborted)this.$('collection-status').textContent=error.message;}
    finally{if(this.controller===controller){this.busy=false;this.controller=null;if(!this.disposed)this.$('collection-generate').disabled=false;}}
  }
  play(){
    if(this.disposed||!this.mission||!this.duration||this.playing)return;
    if(this.elapsed>=this.duration)this.elapsed=0;
    this.workspace.setInteraction('inspect');this.playing=true;this.lastTick=performance.now();this.updatePlayButton();
    const tick=now=>{if(!this.playing||this.disposed)return;const delta=Math.min(now-this.lastTick,100);this.lastTick=now;this.elapsed=Math.min(this.duration,this.elapsed+delta/1000*this.rate);if(!this.lastPaint||now-this.lastPaint>=50){this.lastPaint=now;this.renderFrame();}if(this.elapsed>=this.duration){this.renderFrame();this.pause();return;}this.frame=requestAnimationFrame(tick);};
    this.frame=requestAnimationFrame(tick);
  }
  pause(){this.playing=false;cancelAnimationFrame(this.frame);this.frame=null;if(!this.disposed)this.updatePlayButton();}
  updatePlayButton(){const b=this.$('collection-play');b.setAttribute('aria-pressed',String(!!this.playing));b.title=b.ariaLabel=this.playing?'暂停采集仿真':'播放采集仿真';b.innerHTML=icon(this.playing?'pause':'play');icons();}
  renderFrame(){
    if(!this.mission||this.disposed)return;const trails=[];
    for(const {track,marker,metric,cumulative} of this.markers){
      const elapsed=Math.min(this.elapsed,track.duration_s),distance=Math.min(cumulative.at(-1),elapsed*track.speed_mps);
      let end=cumulative.findIndex(d=>d>=distance);if(end<1)end=1;
      const ratio=(distance-cumulative[end-1])/(cumulative[end]-cumulative[end-1]||1);
      const point=metric[end-1].map((v,i)=>v+(metric[end][i]-v)*ratio),ll=proj4(projection,'EPSG:4326',point);
      marker.setLngLat(ll);trails.push({type:'Feature',properties:{device:track.device_id},geometry:{type:'LineString',coordinates:[...track.route.coordinates.slice(0,end),ll]}});
      const sample=track.samples.findLast(s=>s.elapsed_s<=elapsed)||track.samples[0];
      const row=this.dialog.querySelector('[data-track="'+track.device_id+'"]');
      row.querySelector('[data-temperature]').textContent=n(sample.temp_c)+' °C';row.querySelector('[data-humidity]').textContent=n(sample.humidity_pct)+' %RH';row.querySelector('[data-seq]').textContent='采样 '+(sample.seq+1)+' / '+track.samples.length;
      row.querySelector('[data-grid]').textContent=(track.altitude_agl_m?'地面场投影 · ':'')+(sample.grid_id||'无网格')+(sample.temp_c==null?' · 分类不足，保留缺测':'');
    }
    this.map.getSource('collection-trails').setData(fc(trails));this.$('collection-time').textContent=Math.round(this.elapsed)+' / '+Math.round(this.duration)+' s';this.$('collection-progress').value=String(this.elapsed);
    document.getElementById('workspace-map').dataset.collectionTime=String(this.elapsed);
    document.getElementById('workspace-map').dataset.collectionSnapshot=this.mission.snapshot_sha256;
  }
  invalidate(message='选区、天气或建筑方案已改变，请重新生成任务。'){
    this.pause();this.revision=(this.revision||0)+1;this.controller?.abort();this.controller=null;this.busy=false;this.mission=null;this.elapsed=0;this.duration=0;this.sandbox.state.collectionMission=null;
    this.markers.forEach(x=>x.marker.remove());this.markers=[];
    for(const id of ['collection-routes','collection-trails'])this.map.getSource(id)?.setData(fc([]));
    if(this.disposed)return;
    this.$('collection-generate').disabled=false;for(const id of ['collection-play','collection-reset','collection-progress','collection-export'])this.$(id).disabled=true;
    this.$('collection-tracks').replaceChildren();this.$('collection-provenance').replaceChildren();this.$('collection-status').textContent=message;this.$('collection-time').textContent='0 / 0 s';this.$('collection-progress').value='0';
    const map=document.getElementById('workspace-map');if(map){delete map.dataset.collectionTime;delete map.dataset.collectionSnapshot;}
  }
  acceptHeat(heat){if(this.mission&&this.mission.snapshot_sha256!==heat?.snapshot_sha256)this.invalidate('气象或网格快照已更新，旧采集任务已清除。');}
  destroy(){this.invalidate();this.disposed=true;clearInterval(this.deviceTimer);this.lifetime.abort();this.dialog?.remove();}
}
