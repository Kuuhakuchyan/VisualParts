import { icon, escape as e, numeric as n } from './ui.js';

export function organizePlanLayout(root,{base,open=false}) {
  const layout=root.querySelector('.plan-layout');
  const editor=layout.querySelector('.plan-editor');
  const content=layout.querySelector('.plan-content');
  const index=document.createElement('section');index.className='plan-index';index.setAttribute('aria-label','已保存方案');
  index.append(content.querySelector('.section-header'),content.querySelector('#plan-list'));
  const create=document.createElement('details');create.className='plan-create';create.open=open;
  create.innerHTML=`<summary>${icon('plus')}新建干预方案</summary>`;create.append(editor);
  const save=editor.querySelector('#save-plan'),help=editor.querySelector('.section-header .context-help');
  const saveRow=document.createElement('div');saveRow.className='plan-submit-row full';
  save.before(saveRow);saveRow.append(save,help);
  const figure=document.createElement('figure');figure.className='plan-context';
  figure.innerHTML=`<img src="${base}assets/workspace-media/d-intervention.png" alt="校园数字空间预览" loading="lazy"><figcaption title="空间概览图片，不是当前方案的重算结果">${icon('map-pin')}空间场景预览</figcaption><a href="#spatial" class="button">${icon('arrow-up-right')}进入布局沙盘</a>`;
  content.prepend(create,figure);layout.prepend(index);
  const heading=document.createElement('div');heading.className='plan-detail-heading';
  heading.innerHTML='<div><span>干预场景</span><h2>基线与方案比较</h2></div><span class="badge">参数档案</span>';
  figure.before(heading);
  const baseline=document.createElement('div');baseline.className='plan-baseline';
  baseline.innerHTML=icon('map')+'<div><strong>基线场景</strong><small>当前空间布局 · 尚未实施干预</small></div>';
  index.querySelector('#plan-list').before(baseline);
  const parameters=document.createElement('div');parameters.id='plan-preview-parameters';parameters.className='plan-preview-parameters';figure.after(parameters);
}

export function updatePlanPreview(root, records) {
  const heading=root.querySelector('.plan-detail-heading h2'),parameters=root.querySelector('#plan-preview-parameters');
  if(!heading||!parameters)return;
  const record=records[0];heading.textContent=record?.input.name||'基线与方案比较';
  const fields=record?[
    ['干预面积',n(record.input.area_m2,0),'m²'],
    ['高度参数',['shade','building'].includes(record.input.intervention)?n(record.input.height_m):'—','m'],
    ['选中方案',records.length,'个'],
    ['创建时刻',new Date(record.created_at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}),''],
  ]:[['干预面积','—','m²'],['高度参数','—','m'],['选中方案','0','个'],['场景状态','基线','']];
  parameters.innerHTML=fields.map(([label,value,unit])=>`<div><span>${e(label)}</span><strong>${e(value)} <small>${e(unit)}</small></strong></div>`).join('');
}

export function planComparisonSummary(records){
  const area=records.reduce((total,record)=>total+(record.result.metrics.intervention_area_m2||0),0);
  return `<div class="plan-comparison-summary"><div><span>选中方案</span><strong>${records.length}<small> 个</small></strong></div><div><span title="各方案参数相加，不代表不重叠的实际覆盖面积">面积参数合计</span><strong>${n(area,0)}<small> m²</small></strong></div><div><span>计算范围</span><strong style="font-size:17px">${e('参数与几何')}</strong></div></div>`;
}
