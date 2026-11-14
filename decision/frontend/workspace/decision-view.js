import { escape as e, numeric as n, help } from './ui.js';
import './decision-view.css';

export function renderCohortPlan(cohort, report) {
  const plan=cohort.activity_plan, judgement=cohort.ai_judgement;
  const explanation=judgement?.reasoning?.text;
  const medical=cohort.medical_advice||[];
  const actions=(plan?.actions||[]).filter(action=>action.text!==plan.summary);
  return '<div><h4>'+e(cohort.label)+'</h4><span class="badge">'+e(plan?.label||report.environment.risk_label)+'</span></div>'+
    '<p class="cohort-scenario-note">'+e(plan?.activity_label||cohort.context.activity)+' · '+e(cohort.context.minutes)+' 分钟</p>'+
    (plan?'<p class="cohort-plan-conclusion" data-status="'+e(plan.status)+'">'+e(plan.summary)+'</p>':'')+
    (plan?.factors.length?'<p class="cohort-plan-factors">'+plan.factors.map(e).join(' · ')+'</p>':'')+
    (explanation&&explanation!==plan?.summary?'<p class="cohort-plan-reason">'+e(explanation)+'</p>':'')+
    (actions.length?'<h5>行动安排</h5><ul class="cohort-plan-actions">'+actions.map(a=>'<li>'+e(a.text)+'</li>').join('')+'</ul>':'')+
    (medical.length?'<h5>已审核医学防护条款</h5><ul>'+medical.map(a=>'<li>'+e(a.text)+' ['+e(a.citation_id)+']</li>').join('')+'</ul>':'')+
    '<details class="cohort-plan-sources"><summary>查看依据与适用范围</summary>'+
    (plan?.guidance||[]).map(g=>'<p><a href="'+e(g.url)+'" target="_blank" rel="noopener">['+e(g.id)+'] '+e(g.publisher)+'</a></p><blockquote>'+e(g.quote)+'</blockquote>').join('')+
    '<p>'+e(cohort.assessment_note)+'</p><p>活动安排参考公开防护资料；个体医学处置仅展示通过专业审核的条款。</p></details>';
}

export function renderDecisionAnalysis(report) {
  const a=report?.decision_analysis;
  if(!a)return '';
  const sourceText=value=>[...(value.fact_ids||[]),...(value.knowledge_ids||[])].join(', ');
  const reason=value=>'<p>'+e(value.text)+' <small>['+e(sourceText(value))+']</small></p>';
  const groups=Object.fromEntries(report.cohorts.map(c=>[c.id,c]));
  const actions=Object.fromEntries(report.management_checks.map(c=>[c.id,c]));
  const intensity=a.risk_intensity;
  const clinical=report.citations.length>0?'医学建议仅引用适用的已审核条款。':'医学处置条款尚未通过适用性与专业审核，不输出疾病诊断或治疗建议。';
  return '<section class="ai-decision-analysis"><div class="section-header"><h3>AI 区域风险与决策分析</h3><span class="badge '+(a.mode==='ai_grounded_decision'?'green':'amber')+'">'+(a.mode==='ai_grounded_decision'?'AI生成研判':'规则基线')+'</span></div>'+
    '<div class="ai-intensity"><div><small>环境热强度</small><strong>'+e(intensity.environment_label)+'</strong><span>热指数 '+n(intensity.heat_index_c)+' °C</span></div>'+
    (intensity.utci_c!==null?'<div><small>'+e(intensity.assessment_basis?.label||'方案辐射热暴露')+'</small><strong>'+e(intensity.utci_label)+'</strong><span>UTCI '+n(intensity.utci_c)+' °C</span></div>':'')+'</div>'+reason(a.overview)+
    '<div class="ai-cohort-decisions">'+a.cohorts.map(c=>{const cohort=groups[c.group];return '<section><h4>'+e(cohort?.label||c.group)+' <span class="badge">'+e(a.priority_labels[c.priority])+'</span></h4>'+reason(c.reasoning)+
      (c.health_concern_ids.length?'<p class="ai-health-concerns">'+c.health_concern_ids.map(id=>e(a.concern_labels[id])).join(' · ')+'</p>':'')+
      '<ul>'+c.management_action_ids.map(id=>'<li>'+e(actions[id]?.text||id)+'</li>').join('')+'</ul>'+
      (c.medical_advice_ids.length?'<ul>'+c.medical_advice_ids.map(id=>'<li>'+e(cohort.medical_advice.find(x=>x.id===id)?.text||id)+' ['+e(id)+']</li>').join('')+'</ul>':'')+'</section>';}).join('')+'</div>'+
    (a.building?'<section class="ai-building-decision"><div class="heading-with-help"><h4>AI 建筑方案建议 · '+e(a.building_verdict_labels[a.building.verdict])+'</h4>'+help('用于下一轮方案比较；修改几何后需重新推演，不构成施工审批结论。','建筑建议适用范围')+'</div>'+reason(a.building.reasoning)+'<ul>'+a.building.next_steps.map(id=>'<li>'+e(a.next_step_labels[id])+'</li>').join('')+'</ul><p class="field-help">辅助比较 · 非施工审批结论</p></section>':'')+
    '<p class="field-help">'+e(intensity.meaning)+' '+e(clinical)+'</p><details><summary>专业背景与判断来源</summary>'+a.knowledge.map(k=>'<p>['+e(k.id)+'] '+e(k.text)+' ['+e(k.source_id)+']</p>').join('')+'<p class="field-help">专业背景为权威公开资料摘要，来源快照与哈希保留在报告；不等于医师审核通过。</p></details><p class="field-help">'+e(a.disclaimer)+'</p></section>';
}
