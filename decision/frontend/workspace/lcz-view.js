import { escape as e, numeric as n } from './ui.js';

export const lczColors={2:'#be7469',5:'#cf9475',8:'#d7aa75',9:'#d6b897',11:'#327769',12:'#6d9a75',13:'#93ad80',14:'#bdc997',15:'#a7adb0',17:'#5c9eaf'};
export const lczColorExpression=['match',['get','value'],...Object.entries(lczColors).flatMap(([code,color])=>[Number(code),color]),'#9ca8ab'];
const names={2:'紧凑中层建筑',5:'开放中层建筑',8:'大型低层建筑',9:'稀疏建筑',11:'密集林木',12:'稀疏林木',13:'灌木',14:'低矮植被',15:'硬化地表',17:'水体'};

export function lczCompositionText(value){
  let fractions=value;
  if(typeof fractions==='string'){try{fractions=JSON.parse(fractions);}catch{return '';}}
  return Object.entries(fractions||{}).filter(([,fraction])=>Number.isFinite(fraction)&&fraction>=.001)
    .sort((a,b)=>b[1]-a[1]).map(([code,fraction])=>(names[code]||'未分类')+' '+n(fraction*100,1)+'%').join(' / ');
}

export function renderLczSummary(summary){
  if(!summary?.classes?.length)return '<p class="field-help">当前选区暂无分类统计</p>';
  const rows=summary.classes.map(row=>'<tr><th scope="row"><span class="lcz-key" style="background:'+ (lczColors[row.lcz_code]||'#9ca8ab')+'"></span>'+e(row.name)+'</th><td>'+n(row.area_m2/10000,2)+'</td><td title="'+e(row.proxy_profile_code!=null?'情景系数复用 LCZ '+row.proxy_profile_code+'，未独立标定':'既有项目情景系数，未实测标定')+'">'+n(row.area_fraction*100,1)+'%</td></tr>').join('');
  const unknown=summary.area_m2?summary.unknown_area_m2/summary.area_m2*100:0;
  return '<div class="lcz-summary" data-classification-sha256="'+e(summary.classification_sha256)+'"><table><caption>选区地表构成</caption><thead><tr><th scope="col">分类</th><th scope="col">公顷</th><th scope="col">占选区</th></tr></thead><tbody>'+rows+'<tr><th scope="row">未分类</th><td>'+n(summary.unknown_area_m2/10000,2)+'</td><td>'+n(unknown,1)+'%</td></tr></tbody></table><small title="细尺度地表拼接；建筑分型使用假定高度及邻域密度，尚未完成标准LCZ精度验证。面积比例不代表人群风险比例。">模拟分类 · '+e(summary.classification_sha256.slice(0,12))+'</small></div>';
}
