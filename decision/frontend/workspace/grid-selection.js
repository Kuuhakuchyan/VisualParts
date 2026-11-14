import { escape as e, numeric as n, date } from './ui.js';
import { impactAt } from './layout-impact.js';

const risks = { below_range: '未达高温分级', caution: '警惕', extreme_caution: '高度警惕', danger: '危险', extreme_danger: '极度危险' };

export function selectionData(cell, sandbox, point) {
  const p = cell?.properties || {}, layer = sandbox?.root.dataset.renderedHeatLayer || 'weather';
  const scenario = ['utci', 'mrt', 'shade'].includes(layer), delta = sandbox?.mode === 'delta' && layer === 'utci';
  const prefix = sandbox?.mode === 'baseline' ? 'baseline' : 'proposed';
  const missing = !cell || p.display_state === 'missing';
  let value = p.temperature_c ?? p.air_temperature_c, metric = '网格气温', unit = '°C';
  if (layer === 'heatindex') { value = p.heat_index_c; metric = '热指数'; }
  if (layer === 'anomaly') { value = p.delta_t_grid_c; metric = '冷暖差 · 相对气象基准'; }
  if (layer === 'utci') { value = delta ? p.delta_utci_c : p[prefix + '_utci_c']; metric = delta ? 'ΔUTCI' : 'UTCI'; }
  if (layer === 'mrt') { value = p[prefix + '_mrt_c']; metric = '平均辐射温度'; }
  if (layer === 'shade') { value = p[prefix + '_shade_fraction']; if (Number.isFinite(value)) value *= 100; metric = '遮阴比例'; unit = '%'; }
  if (layer === 'lcz') { value = p.lcz_code; metric = 'LCZ分类'; unit = ''; }
  const bounds = sandbox?.bounds;
  const area = bounds ? (bounds.east - bounds.west) * (bounds.north - bounds.south) * 111320 ** 2 * Math.cos((bounds.north + bounds.south) / 2 * Math.PI / 180) / 10000 : null;
  return {
    gridId: p.grid_id || (cell ? String(cell.id ?? '计算单元') : null),
    gridLabel: cell ? 'G-' + String(sandbox.displayCells.indexOf(cell) + 1).padStart(4, '0') : null,
    region: sandbox?.regional().area_kind === 'campus' ? '某校园' : '某街区',
    count: sandbox?.displayCells?.length || 0, area, metric, unit,
    value: missing ? null : value, delta: delta || layer === 'anomaly',
    airTemperature: p.temperature_c ?? p.air_temperature_c,
    risk: !scenario && layer !== 'anomaly' && !missing ? risks[p.risk] : null,
    source: scenario ? '情景推演' : p.source_type === 'simulated_lcz' ? '模拟数据' : cell ? '网格估计' : '位置标记',
    reason: missing ? p.display_reason || '此位置暂无有效网格指标' : '',
    time: p.time || (scenario ? sandbox?.result?.weather_boundary?.observed_at : sandbox?.heat?.baseline?.observed_at),
    humidity: p.humidity_pct, longitude: point.longitude, latitude: point.latitude,
    snapshot: scenario ? sandbox?.result?.report_sha256 : sandbox?.heat?.snapshot_sha256,
    neighbourhood:scenario?p.proposed_neighbourhood:null,effect:scenario?p.neighbourhood_effect:null,
    mlStatus:scenario?p.proposed_ml_status:null,mlUtci:scenario?p.proposed_ml_utci_c:null,
    layoutImpact:!scenario&&!missing?impactAt(sandbox?.impactCells||[],point):null,
  };
}

export function selectionMarkup(data, summary = false) {
  const precision = data.delta ? data.value !== 0 && Math.abs(data.value) < 0.001 ? 6 : 3 : 1;
  const value = Number.isFinite(data.value) ? (data.delta && data.value > 0 ? '+' : '') + n(data.value, precision) : '—';
  const context = `<span class="selection-caption">当前选区</span><strong>${e(data.region)}</strong><small>${n(data.count, 0)} 个网格 / ${n(data.area, 1)} ha</small>`;
  const reading = `<span class="selection-caption">${e(data.gridLabel ? '网格 ' + data.gridLabel : '选定地点')} · ${e(data.metric)}</span><strong class="selection-reading" data-sign="${data.delta ? data.value > 0 ? 'warm' : data.value < 0 ? 'cool' : 'neutral' : 'neutral'}">${e(value)}<small>${e(data.unit)}</small></strong><small>${e(data.source)}${data.risk ? ' · ' + e(data.risk) : ''}</small>`;
  const spatial=data.neighbourhood?Object.values(data.neighbourhood).map(row=>`<p>${n(row.radius_m,0)} m · 建筑 ${n(row.building_count,0)} 栋 / 密度 ${n(row.plan_area_fraction*100,1)}% / 高度 ${n(row.area_weighted_height_m,1)} m</p>`).join('')+`<p>遮阴变化 ${n(data.effect?.delta_shade_fraction*100,2)}% · 天空可视变化 ${n(data.effect?.delta_svf,3)}</p><p>${data.mlStatus==='physics_checked_ml'?'本地学习模型 · 已通过物理校验':'传统计算'} / 预测UTCI ${n(data.mlUtci,3)}°C</p>`:'';
  const impact=data.layoutImpact;
  const impactText=impact?`<p>拆建影响 ΔUTCI ${impact.delta_utci_c>0?'+':''}${n(impact.delta_utci_c,3)}°C · 现状 ${n(impact.baseline_utci_c,2)} → 方案 ${n(impact.proposed_utci_c,2)}°C</p>`:'';
  const details = `<details class="selection-details"><summary>数据详情</summary><p>${e(data.reason || (data.time ? date(data.time, true) + ' 北京时间' : '时间暂缺'))}</p><p>气温 ${n(data.airTemperature, 2)}°C · 湿度 ${n(data.humidity, 0)}% RH</p>${impactText}<p>${n(data.longitude, 5)}°E / ${n(data.latitude, 5)}°N</p>${data.gridId ? '<p>' + e(data.gridId) + '</p>' : ''}${spatial}</details>`;
  return `<div class="selection-cards${summary ? ' selection-summary' : ''}" data-grid-id="${e(data.gridId || '')}" data-snapshot="${e(data.snapshot || '')}"><div class="selection-region">${context}</div><div class="selection-cell">${reading}</div></div>${details}`;
}
