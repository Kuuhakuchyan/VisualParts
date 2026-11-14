import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { request, ApiError } from '../frontend/workspace/request.js';
import { defaultRegional, isCurrentObservationTime, regionalValidity, regionalWeatherKey } from '../frontend/workspace/regional-state.js';
import { thermalPresentation, thermalResultView, differenceColors, differenceTicks, anomalyColors, temperatureColors, shouldPresentThermalResult, weatherOnlyEstimate } from '../frontend/workspace/thermal-presentation.js';
import { layoutImpact, impactAt } from '../frontend/workspace/layout-impact.js';

let server, origin, slowCalls = 0;
test('local layout impacts preserve the LCZ field and use only matching snapshot evidence', () => {
  const cell = (id, value) => ({type:'Feature',id,geometry:{type:'Polygon',coordinates:[[[id,0],[id+1,0],[id+1,1],[id,1],[id,0]]]},properties:{grid_id:String(id),delta_utci_c:value,comparable_area_m2:100}});
  const heat={data_mode:'lcz_simulation',snapshot_sha256:'original',cells:{features:[cell(0,0)]}};
  const result={data_mode:'lcz_simulation',lcz_snapshot_sha256:'original',effect_status:'changed',valid_time:'2026-10-29T14:00:00+08:00',report_sha256:'report',cells:{features:[cell(0,-1.2),cell(1,0),cell(2,null),cell(3,.5)]}};
  const original=JSON.stringify({heat,result});
  const impact=layoutImpact(result,heat,'anomaly','edit');
  assert.equal(impact.features.length,2);
  assert.deepEqual(impact.features.map(f=>f.properties.value),[-1.2,.5]);
  assert.equal(JSON.stringify({heat,result}),original);
  assert.equal(impactAt(impact.features,{longitude:.5,latitude:.5}).delta_utci_c,-1.2);
  assert.equal(impactAt(impact.features,{longitude:1.5,latitude:.5}),null);
  assert.equal(impactAt(impact.features,{longitude:3.5,latitude:.5}).delta_utci_c,.5);
  for(const layer of ['lcz','utci','mrt','shade','off'])assert.equal(layoutImpact(result,heat,layer,'edit').features.length,0);
  for(const mode of ['baseline','delta'])assert.equal(layoutImpact(result,heat,'anomaly',mode).features.length,0);
  for(const effect_status of ['no_edits','night_no_shortwave','no_comparable_cells'])assert.equal(layoutImpact({...result,effect_status},heat,'anomaly','edit').features.length,0);
  assert.equal(layoutImpact(result,{...heat,snapshot_sha256:'other-hour'},'anomaly','edit').features.length,0);
  assert.equal(layoutImpact(result,{...heat,data_mode:'live'},'anomaly','edit').features.length,0);
});
test('layout overlay refuses different-hour public weather and missing comparable support', () => {
  const result={data_mode:'live',effect_status:'changed',valid_time:'2026-10-29T14:00:00+08:00',cells:{features:[{properties:{delta_utci_c:-1,comparable_area_m2:0}},{properties:{delta_utci_c:.5,comparable_area_m2:20}}]}};
  const heat={data_mode:'live',samples:[{observation:{observed_at:'2026-10-29T06:00:00Z'}}]};
  assert.equal(layoutImpact(result,heat,'weather','proposed').features.length,1);
  assert.equal(layoutImpact(result,{...heat,samples:[{observation:{observed_at:'2026-10-29T07:00:00Z'}}]},'weather','proposed').features.length,0);
});
test('edits and forecast playback never silently change the selected metric or comparison mode', () => {
  for (const layer of ['weather','risk','heatindex','anomaly']) {
    for (const effect_status of ['changed','no_resolved_change']) {
      assert.deepEqual(thermalResultView(layer,'edit',{effect_status}),{layer,mode:'edit'});
    }
    assert.deepEqual(thermalResultView(layer,'edit',{effect_status:'no_edits'}),{layer,mode:'edit'});
    assert.deepEqual(thermalResultView(layer,'edit',{effect_status:'no_edits'},{forecast:true}),{layer,mode:'edit'});
    for(const mode of ['baseline','proposed','delta'])assert.deepEqual(thermalResultView(layer,mode,{effect_status:'changed'},{forecast:true}),{layer,mode});
  }
  for(const layer of ['off','lcz','mrt','shade','utci']) {
    assert.deepEqual(thermalResultView(layer,'baseline',{effect_status:'changed'},{forecast:true}),{layer,mode:'baseline'});
  }
});
test('temperature and difference colors use fixed physical values instead of scene extrema', () => {
  const stops=expression=>expression.filter(value=>typeof value==='number');
  assert.deepEqual(stops(differenceColors),[-5,-2,-0.1,0.1,2,5]);
  assert.deepEqual(differenceTicks.map(([value])=>value),[-5,-2,0,2,5]);
  assert.deepEqual(stops(temperatureColors),[-15,10,25,30,35,40,50]);
  assert.deepEqual(stops(anomalyColors),[-2,-0.5,0,0.5,2]);
});
test('night weather estimates remain available independently of building-effect status', () => {
  const result={solar:{altitude_deg:-5},summary:{proposed_utci_c:39,comparable_cells:20},effect_status:'night_no_shortwave'};
  assert.equal(weatherOnlyEstimate(result),true);
  assert.equal(weatherOnlyEstimate({...result,effect_status:'no_edits'}),true);
  assert.equal(weatherOnlyEstimate({...result,solar:{altitude_deg:1}}),true);
  assert.equal(weatherOnlyEstimate({...result,solar:{altitude_deg:2}}),false);
  assert.equal(weatherOnlyEstimate({...result,solar:{}}),false);
  assert.equal(weatherOnlyEstimate({...result,summary:{proposed_utci_c:null,comparable_cells:20}}),false);
  assert.equal(weatherOnlyEstimate({...result,summary:{proposed_utci_c:39,comparable_cells:0}}),false);
});
test('unavailable scenario grids preserve the selected weather field without reusing old results', () => {
  for (const mode of ['edit', 'baseline', 'proposed', 'delta']) {
    for (const metric of ['utci', 'mrt', 'shade']) {
      assert.deepEqual(thermalPresentation(metric, mode, null, 'risk'), { layer: 'risk', fallback: 'pending' });
    }
  }
  assert.deepEqual(thermalPresentation('utci', 'proposed', null, 'off'), { layer: 'weather', fallback: 'pending' });
});
test('night and missing comparisons do not paint a zero-change heat field', () => {
  for (const status of ['night_no_shortwave', 'no_edits', 'no_comparable_cells']) {
    const result = { effect_status: status };
    assert.deepEqual(thermalPresentation('utci', 'delta', result), { layer: 'weather', fallback: status });
    assert.equal(shouldPresentThermalResult(result), false);
  }
  for (const status of ['changed', 'no_resolved_change']) {
    assert.deepEqual(thermalPresentation('utci', 'delta', { effect_status: status }), { layer: 'utci', fallback: null });
    assert.equal(shouldPresentThermalResult({ effect_status: status }), true);
  }
});
test('explicit weather, hidden and valid absolute scenario layers retain their meaning', () => {
  for (const layer of ['off', 'weather', 'heatindex', 'risk']) {
    assert.deepEqual(thermalPresentation(layer, 'delta', null), { layer, fallback: null });
  }
  for (const layer of ['utci', 'mrt', 'shade']) {
    assert.deepEqual(thermalPresentation(layer, 'proposed', { effect_status: 'night_no_shortwave' }), { layer, fallback: null });
  }
});
before(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/pending') { slowCalls++; return; }
    if (req.url === '/streaming') { res.write('{"pending":'); return; }
    if (req.url === '/slow') { setTimeout(() => res.end('{"ready":true}'), 75); return; }
    if (req.url === '/validation') {
      res.statusCode = 422;
      res.end(JSON.stringify({ detail: [{ loc: ['body', 'scene', 'height_m'], msg: 'Input should be greater than 0', input: 'PRIVATE_INPUT' }] }));
      return;
    }
    if (req.url === '/limited') { res.statusCode = 429; res.end('{"message":"Request budget exhausted"}'); return; }
    if (req.url === '/detail') { res.statusCode = 409; res.end('{"detail":"Snapshot changed"}'); return; }
    if (req.url === '/gateway') { res.statusCode = 502; res.end('<html>proxy error</html>'); return; }
    if (req.url === '/invalid') { res.end('not json'); return; }
    if (req.url === '/null') { res.end('null'); return; }
    if (req.url === '/zero') { res.end('0'); return; }
    if (req.url === '/empty') { res.statusCode = 204; res.end(); return; }
    let text = '';
    for await (const chunk of req) text += chunk;
    res.end(JSON.stringify({ method: req.method, headers: req.headers, body: text }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('JSON requests preserve authentication and explicit HTTP methods', async () => {
  const input = { scene: { additions: [], removed_ids: [] }, exposure_minutes: 37 };
  const data = await request(origin + '/echo', { json: input, headers: new Headers({ 'X-Workspace-Token': 'private-test-token' }), method: 'PUT' });
  assert.equal(data.method, 'PUT');
  assert.equal(data.headers['x-workspace-token'], 'private-test-token');
  assert.equal(data.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(data.body), input);
});
test('JSON requests default to POST and raw-body callers remain supported', async () => {
  assert.equal((await request(origin + '/echo', { json: {} })).method, 'POST');
  const data = await request(origin + '/echo', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'raw' });
  assert.equal(data.body, 'raw');
  assert.equal(data.headers['content-type'], 'text/plain');
});
test('providing a caller signal still enforces the request timeout', async () => {
  const controller = new AbortController();
  const beforeCalls = slowCalls;
  await assert.rejects(request(origin + '/pending', { signal: controller.signal, timeoutMs: 80 }), { name: 'TimeoutError' });
  assert.equal(controller.signal.aborted, false);
  assert.equal(slowCalls - beforeCalls, 1, 'mutations are never retried automatically');
});
test('caller cancellation preserves its reason and leaves no late result', async () => {
  const controller = new AbortController(), reason = new DOMException('Panel closed', 'AbortError');
  const pending = request(origin + '/pending', { signal: controller.signal, timeoutMs: 500 });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(pending, error => error === reason);
});
test('already cancelled calls never reach the server', async () => {
  const controller = new AbortController(); controller.abort();
  const beforeCalls = slowCalls;
  await assert.rejects(request(origin + '/pending', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(slowCalls, beforeCalls);
});
test('timeout covers body streaming as well as response headers', async () => {
  await assert.rejects(request(origin + '/streaming', { timeoutMs: 50 }), { name: 'TimeoutError' });
});
test('explicit long computation budget is respected', async () => {
  await assert.rejects(request(origin + '/slow', { timeoutMs: 20 }), { name: 'TimeoutError' });
  assert.deepEqual(await request(origin + '/slow', { timeoutMs: 1000 }), { ready: true });
});
test('validation errors include field paths without echoing private inputs', async () => {
  await assert.rejects(request(origin + '/validation'), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 422);
    assert.match(error.message, /scene.height_m/);
    assert.ok(!error.message.includes('PRIVATE_INPUT'));
    return true;
  });
});
test('conflict and budget errors keep the server message', async () => {
  await assert.rejects(request(origin + '/detail'), { message: 'Snapshot changed', status: 409 });
  await assert.rejects(request(origin + '/limited'), { message: 'Request budget exhausted', status: 429 });
});
test('proxy HTML errors retain HTTP status and successful malformed bodies are rejected', async () => {
  await assert.rejects(request(origin + '/gateway'), error => error.status === 502 && error.message.includes('502'));
  for (const path of ['/invalid', '/null']) await assert.rejects(request(origin + path), /服务返回格式异常/);
});
test('valid zero JSON and empty successful deletions are supported', async () => {
  assert.equal(await request(origin + '/zero'), 0);
  assert.equal(await request(origin + '/empty', { method: 'DELETE' }), null);
});
test('ambiguous payloads and invalid timeout budgets fail before fetch', async () => {
  await assert.rejects(request(origin, { json: {}, body: '{}' }), TypeError);
  for (const timeoutMs of [0, -1, Infinity, NaN]) await assert.rejects(request(origin, { timeoutMs }), TypeError);
});

const now = Date.parse('2026-10-24T06:00:00Z');
test('current observations share inclusive age limits and reject future or invalid timestamps', () => {
  for (const offset of [-7200000, 0, 900000]) assert.equal(isCurrentObservationTime(new Date(now + offset).toISOString(), now), true);
  for (const offset of [-7200001, 900001]) assert.equal(isCurrentObservationTime(new Date(now + offset).toISOString(), now), false);
  for (const value of [undefined, null, '', 'bad date']) assert.equal(isCurrentObservationTime(value, now), false);
});
test('defaults do not share mutable campus bounds or cohorts across panels', () => {
  const first = defaultRegional('campus');
  first.bounds.west = 0; first.groups.push('children');
  const next = defaultRegional('campus');
  assert.notEqual(next.bounds.west, 0);
  assert.equal(next.groups.includes('children'), false);
  assert.equal(next.data_mode, 'lcz_simulation');
  assert.equal(defaultRegional('zhongyuan').data_mode, 'live');
  assert.equal(defaultRegional('zhongyuan').area_kind, 'neighborhood');
});
test('saved historical and per-cohort scenarios survive default merging', () => {
  const draft = { mode: 'history', use_ai: false, groups: ['workers'], cohort_scenarios: { workers: { activity: 'work', exposure_minutes: 45 } } };
  const merged = defaultRegional('campus', draft);
  assert.equal(merged.mode, 'history'); assert.equal(merged.use_ai, false);
  assert.deepEqual(merged.groups, ['workers']);
  assert.deepEqual(merged.cohort_scenarios, draft.cohort_scenarios);
});
test('weather identity ignores cohorts but changes with time, bounds and grid methods', () => {
  const regional = defaultRegional('campus'), original = regionalWeatherKey(regional);
  assert.equal(regionalWeatherKey({ ...regional, activity: 'run', groups: ['workers'], exposure_minutes: 42, use_ai: false }), original);
  for (const override of [{ mode: 'history' }, { bounds: { ...regional.bounds, west: 113.524 } }, { data_mode: 'live' }, { grid_resolution_m: 100 }, { area_kind: 'neighborhood' }]) {
    assert.notEqual(regionalWeatherKey({ ...regional, ...override }), original);
  }
});
test('report validity excludes historical, simulated, outdated-version, missing and stale evidence', () => {
  const report = { regional_version: 'area-cohort-1.1.0', data_mode: 'live', coverage: { usable_samples: 1 }, samples: [{ observation: { observed_at: new Date(now).toISOString() } }] };
  assert.equal(regionalValidity(report, now).valid, true);
  for (const overrides of [
    { data_mode: 'lcz_simulation' }, { case_type: 'historical_reanalysis' }, { regional_version: 'old' },
    { samples: [] }, { samples: undefined }, { coverage: { usable_samples: 0 } },
    { samples: [{ observation: { observed_at: 'bad date' } }] },
    { samples: [...report.samples, { observation: { observed_at: new Date(now - 7200001).toISOString() } }] },
  ]) assert.equal(regionalValidity({ ...report, ...overrides }, now).valid, false);
});
