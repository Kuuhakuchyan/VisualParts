const API = '/api/weather/mobile-observations';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date = value => value ? new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false}) : '暂无';
const number = (value, unit='') => value == null ? '—' : `${Number(value).toFixed(1)}${unit}`;
const states = {online:'在线',idle:'待机',teleop:'遥控',cruise:'巡航',dwell:'驻留',returning:'返程',charging:'充电',fault:'故障',offline:'离线'};
const fixes = {none:'无定位',single:'单点定位',dgnss:'差分定位',rtk_float:'RTK 浮点',rtk_fix:'RTK 固定解'};
const heights = {amsl:'海拔',ellipsoid:'椭球高',agl:'离地高度',unknown:'高度基准未标注'};
const label = value => escapeHTML(value);

export async function readMobile(path, signal) {
  const response = await fetch(API + path, {cache:'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('移动观测读取失败，请重试');
  return response.json();
}

export function sensorAdapter(d) {
  return {device_id:`mobile:${d.device_id}`, mobile_id:d.device_id, device_name:d.device_type,
    device_type:d.device_type, online:d.online, fields:[
      {field_name:'temperature_c',display_name:'气温',field_unit:'°C'},
      {field_name:'humidity_pct',display_name:'相对湿度',field_unit:'%RH'},
      {field_name:'location',display_name:'WGS84 定位',field_unit:'°'},
      {field_name:'visual_frames',display_name:'视觉图像',field_unit:'帧'}]};
}

export function mobileChoices(devices) {
  return ['UGV','UAV'].flatMap(type => {
    const rows=devices.filter(d=>d.device_type===type);
    return rows.length?rows:[{device_id:'type:'+type,device_type:type,placeholder:true}];
  });
}

export function sensorRows(devices) {
  return mobileChoices(devices).map(d=>d.placeholder
    ? {...sensorAdapter(d),device_id:'mobile-type:'+d.device_type,mobile_id:null,mobile_type:d.device_type,placeholder:true}
    : sensorAdapter(d));
}

class MobileObservations extends HTMLElement {
  connectedCallback() {
    this.attachShadow({mode:'open'});
    this.controller = new AbortController(); this.tab='observations'; this.busy=false;
    const query=new URL(location.href).searchParams;
    this.filterType=this.getAttribute('device-type')||'';
    this.selected = this.getAttribute('device-id') || query.get('mobile') || 'type:'+(this.filterType||query.get('mobile_type')||'UGV');
    this.root = this.shadowRoot;
    this.root.innerHTML = `<link rel="stylesheet" href="/home-assets/mobile-devices.css?v=20261112"><section aria-label="移动观测"><header><h2>移动观测 <small>UGV / UAV</small></h2><button type="button" data-refresh title="刷新设备与观测" aria-label="刷新设备与观测">↻</button></header><div class="picker"></div><p class="feedback" role="status">正在读取移动设备…</p><div class="detail"></div></section>`;
    this.root.querySelector('[data-refresh]').addEventListener('click',()=>this.refresh());
    this.root.addEventListener('change',event=>{
      if(event.target.matches('select')) {
        this.selected=event.target.value;this.data=null;this.dataSignature=null;
        this.root.querySelector('.detail').replaceChildren();
        this.dispatchEvent(new CustomEvent('mobile-observation-selected',{bubbles:true,composed:true,detail:null}));
        this.root.querySelector('.feedback').textContent='正在读取所选设备…';
        this.refresh(true);
      }
    });
    this.root.addEventListener('click',event=>{
      const tab=event.target.closest('[data-tab]');
      if(tab){this.tab=tab.dataset.tab;this.render();this.root.querySelector(`[data-tab="${this.tab}"]`)?.focus();}
      if(event.target.closest('[data-export]')&&this.data){
        const url=URL.createObjectURL(new Blob([JSON.stringify(this.data,null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`${this.selected}-observations.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    });
    this.timer=setInterval(()=>{if(!document.hidden)this.refresh();},15000);
    this.refresh();
  }
  disconnectedCallback(){clearInterval(this.timer);this.controller.abort();this.request?.abort();}
  async refresh(force=false){
    if(this.busy&&!force)return;
    this.request?.abort();const request=this.request=new AbortController();
    const signal=AbortSignal.any([request.signal,this.controller.signal]);
    this.busy=true;this.root.querySelector('[data-refresh]').disabled=true;
    const feedback=this.root.querySelector('.feedback');feedback.classList.remove('error');
    try{
      if(!this.hasAttribute('device-id')){
        const {devices:allDevices}=await readMobile('/devices',signal);
        const devices=mobileChoices(allDevices).filter(d=>!this.filterType||d.device_type===this.filterType);
        if(signal.aborted)return;
        if(!devices.some(d=>d.device_id===this.selected)){
          const type=this.selected.startsWith('type:')?this.selected.slice(5):this.filterType;
          this.selected=(devices.find(d=>d.device_type===type)||devices[0])?.device_id||'';this.data=null;this.dataSignature=null;
          this.root.querySelector('.detail').replaceChildren();
        }
        const picker=this.root.querySelector('.picker');
        const signature=JSON.stringify(devices.map(d=>[d.device_id,d.device_name,d.online]));
        if(signature!==this.listSignature){
          picker.innerHTML=devices.length?`<label>观测设备<select aria-label="移动观测设备">${devices.map(d=>`<option value="${label(d.device_id)}" ${d.device_id===this.selected?'selected':''}>${d.placeholder?label(d.device_type):`${label(d.device_type)} · ${label(d.device_id)} · ${d.online?'在线':'离线'}`}</option>`).join('')}</select></label>`:'';
          this.listSignature=signature;
        }
        const selected=devices.find(d=>d.device_id===this.selected);
        if(!selected||selected.placeholder){
          this.data=null;this.emptyType=selected?.device_type||this.filterType||'UGV';this.renderEmpty();feedback.textContent='';
          this.dispatchEvent(new CustomEvent('mobile-observation-selected',{bubbles:true,composed:true,detail:null}));return;
        }
      }
      const data=await readMobile('/devices/'+encodeURIComponent(this.selected),signal);
      if(signal.aborted)return;
      const signature=JSON.stringify(data);
      this.data=data;
      if(signature!==this.dataSignature){this.dataSignature=signature;this.render();}
      feedback.textContent='更新于 '+date(new Date().toISOString());
      this.dispatchEvent(new CustomEvent('mobile-observation-selected',{bubbles:true,composed:true,detail:data}));
    }catch(error){
      if(signal.aborted)return;
      feedback.textContent=error.message+(this.data?'；保留上次记录':'');feedback.classList.add('error');
    }finally{if(this.request===request){this.busy=false;this.root.querySelector('[data-refresh]').disabled=false;}}
  }
  render(){
    if(!this.data){this.renderEmpty();return;}
    const {device:d,observations,stats,track}=this.data, m=d.measurements||{},p=d.power||{},loc=d.location;
    const observed=d.component_times?.measurements;
    const stale=!observed||Date.now()-new Date(observed).getTime()>300000;
    const images=observations.flatMap(row=>row.visual_frames||[]).filter((frame,index,all)=>all.findIndex(f=>f.frame_id===frame.frame_id&&f.captured_at===frame.captured_at)===index);
    const metrics=[['最近观测',date(observed)],['状态时间',date(d.component_times?.status)],['气温',number(m.temperature_c,' °C')],['相对湿度',number(m.humidity_pct,' %RH')],['电量 / 电压',number(p.soc_pct,' %')+' / '+number(p.voltage_v,' V')],['气压',number(m.pressure_hpa,' hPa')],['风速',number(m.wind_speed_mps,' m/s')],['质量标记',d.quality_flag==null?'暂无':d.quality_flag===0?'0 · 未标记异常':`${d.quality_flag} · 有标记`]];
    this.root.querySelector('.detail').innerHTML=`<div class="identity"><div><h3>${label(d.device_type)}</h3><p>${label(d.device_id)}</p></div><span class="badge ${d.online?'online':''}">${d.online?'在线':'离线'}${d.status?.state?' · '+label(states[d.status.state]||d.status.state):''}</span></div>
      ${stale&&observed?'<p class="notice">当前显示历史观测</p>':''}
      <dl class="metrics">${metrics.map(([k,v])=>`<div><dt>${label(k)}</dt><dd>${label(v)}</dd></div>`).join('')}</dl>
      <p class="position">${loc&&loc.fix_type!=='none'?`WGS84 ${Number(loc.longitude).toFixed(6)}°E, ${Number(loc.latitude).toFixed(6)}°N · ${label(heights[loc.altitude_reference]||'高度')} ${number(loc.altitude_m,' m')} · ${label(fixes[loc.fix_type]||loc.fix_type)}`:'暂无有效定位'}<br><small>定位时间 ${label(date(d.component_times?.location))}</small></p>
      <nav aria-label="移动观测详情">${[['observations','观测记录'],['track','定位轨迹'],['images','视觉图像']].map(([id,title])=>`<button type="button" data-tab="${id}" aria-pressed="${this.tab===id}">${title}</button>`).join('')}<button type="button" class="export" data-export title="导出当前观测与轨迹 JSON">导出</button></nav>
      <div class="body">${this.tab==='observations'?this.observations(observations,stats):this.tab==='track'?this.track(track):this.images(images)}</div>
      <footer><a href="/?view=monitor&mobile=${encodeURIComponent(d.device_id)}#mobile-observations">在观测工作台查看</a><span title="在线状态按最近120秒状态心跳判定。温湿度使用各自采样时间；当前仅展示采集记录，尚未自动校正热场。">数据说明 ⓘ</span></footer>`;
  }
  renderEmpty(){
    const type=this.emptyType||this.filterType||'UGV';
    this.root.querySelector('.detail').innerHTML=`<div class="identity"><h3>${label(type)}</h3></div>
      <dl class="metrics">${['设备 ID','状态','气温','相对湿度','电量','位置','最近观测','质量标记'].map(k=>`<div><dt>${k}</dt><dd>—</dd></div>`).join('')}</dl>
      <nav aria-label="移动观测详情">${[['observations','观测记录'],['track','定位轨迹'],['images','视觉图像']].map(([id,title])=>`<button type="button" data-tab="${id}" aria-pressed="${this.tab===id}">${title}</button>`).join('')}<button type="button" class="export" disabled>导出</button></nav>
      <div class="body"><p class="empty">—</p></div>
      <footer><a href="/?view=monitor&mobile_type=${encodeURIComponent(type)}#mobile-observations">在观测工作台查看</a></footer>`;
  }
  observations(rows,stats){
    if(!rows.length)return '<p class="empty">—</p>';
    return `<p class="count">共 ${stats.total} 条 · 最近 ${rows.length} 条</p><div class="table-wrap" tabindex="0" aria-label="观测记录表"><table><thead><tr><th>采样时间（北京）</th><th>气温 °C</th><th>湿度 %RH</th><th>质量标记</th><th>任务 / 序号</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${label(date(r.sampled_at_ms))}</td><td>${number(r.measurements?.temperature_c)}</td><td>${number(r.measurements?.humidity_pct)}</td><td>${label(r.quality_flag)}</td><td>${label(r.task_id)} / ${r.seq}</td></tr>`).join('')}</tbody></table></div>`;
  }
  track(track){
    const points=track?.features||[];
    if(!points.length)return '<p class="empty">—</p>';
    return `<p class="count">最近 ${points.length} 个定位点 · WGS84</p><div class="table-wrap" tabindex="0" aria-label="定位轨迹表"><table><thead><tr><th>定位时间（北京）</th><th>经度</th><th>纬度</th><th>高度 m</th></tr></thead><tbody>${[...points].reverse().map(p=>`<tr><td>${label(date(p.properties.sampled_at_ms))}</td><td>${p.geometry.coordinates[0].toFixed(6)}</td><td>${p.geometry.coordinates[1].toFixed(6)}</td><td>${number(p.properties.altitude_m)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  images(images){
    if(!images.length)return '<p class="empty">—</p>';
    return `<div class="images">${images.map(f=>`<figure>${f.preview_url?`<a href="${label(f.preview_url)}" target="_blank" rel="noopener"><img src="${label(f.preview_url)}" alt="${label(f.modality)} 采集图像" loading="lazy"></a>`:'<p class="empty">—</p>'}<figcaption>${label(f.modality)} · ${label(date(f.captured_at))}</figcaption></figure>`).join('')}</div>`;
  }
}
customElements.define('mobile-observations',MobileObservations);
