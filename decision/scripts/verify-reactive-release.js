async (page) => {
  const checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  const ok=(condition,name)=>{if(!condition)throw new Error(name);checks.push(name);};
  await page.setViewportSize({width:1440,height:960});
  await page.waitForSelector('#sb-auto');
  ok(await page.locator('#sb-auto').isChecked(),'automatic recalculation is enabled');
  await page.locator('#map-rotate').click();
  ok(await page.locator('#workspace-map').getAttribute('data-interaction')==='camera','left-button camera mode owns interaction');
  const capture=async()=>page.locator('#workspace-map canvas').screenshot();
  const before=await capture();
  await page.mouse.move(700,430);await page.mouse.down();await page.mouse.move(820,475,{steps:12});await page.mouse.up();
  const after=await capture();ok(!before.equals(after),'left-button drag changes camera pixels');
  ok(await page.locator('#picked-location').textContent()==='尚未标记地点','rotation does not mark locations');
  await page.keyboard.press('Escape');ok(await page.locator('#map-rotate').getAttribute('aria-pressed')==='false','escape clears camera state');
  await page.locator('#map-home').click();await page.waitForTimeout(1300);
  const camera=()=>page.locator('#workspace-map').evaluate(n=>[n.dataset.viewBearing,n.dataset.viewPitch]);
  const initialUrl=page.url();const cameraBefore=await camera();
  await page.mouse.move(700,430);await page.mouse.down({button:'right'});await page.mouse.move(800,430,{steps:8});await page.mouse.up({button:'right'});
  await page.keyboard.press('Escape');ok(page.url()===initialUrl,'right drag does not navigate in test browser');
  const cameraAfter=await camera();ok(JSON.stringify(cameraBefore)===JSON.stringify(cameraAfter),'right drag no longer rotates map');
  const regional={area_kind:'campus',mode:'history',data_mode:'lcz_simulation',grid_resolution_m:30,
    groups:['students','workers'],activity:'walk',exposure_minutes:30,exposure:'unknown',use_ai:false,
    bounds:{west:113.528,south:34.816,east:113.532,north:34.820}};
  await page.locator('#sb-auto').uncheck();
  // Set the actual workbench through its persisted public draft form.
  await page.locator('[data-screen-panel="risk"]').first().click();
  await page.waitForSelector('#region-mode');
  await page.locator('#region-mode').selectOption('history');
  for(const [key,value] of Object.entries(regional.bounds))await page.locator('#bound-'+key).fill(String(value));
  await page.locator('#region-ai').uncheck();
  const apply=page.locator('#regional-submit');
  // The layout dialog's regional controls save the draft on submit.
  if(await apply.count()){const pending=page.waitForResponse(r=>r.url().endsWith('/aic/regional-assess'));await apply.click();await pending;}
  await page.keyboard.press('Escape');
  await page.locator('#sb-auto').check();
  await page.locator('[data-operation="add"]').click();
  for(const id of ['width','depth'])await page.locator('#sb-'+id).fill('8');
  let placed=false;
  for(const point of [[710,440],[680,400],[770,400],[660,480],[740,510],[810,460],[610,400],[820,530]]){
    await page.mouse.click(...point);
    if(await page.locator('#sb-confirm').isDisabled())continue;
    const validated=page.waitForResponse(r=>r.url().endsWith('/sandbox/validate'));
    await page.locator('#sb-confirm').click();const r=await validated;
    await page.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
    if(r.ok()){placed=true;break;}
  }
  ok(placed,'construction commits collision-checked geometry');
  const simulation=await page.waitForResponse(r=>r.url().endsWith('/sandbox/simulate'),{timeout:120000});
  const first=await simulation.json();ok(simulation.ok(),'construction triggers numerical inference without run click');
  await page.waitForFunction(()=>document.querySelector('#sb-status').textContent.includes('自动重算完成'),{timeout:120000});
  ok(first.input.regional.use_ai===false,'automatic preview does not fire hidden model calls');
  ok(first.cells.features.length>1,'inference returns multiple spatial cells');
  ok(first.regional_report.layout_exposure.scene_sha256===first.scene_sha256,'report and grid share scene digest');
  ok(await page.locator('#workspace-map').getAttribute('data-result-sha256')===first.report_sha256,'rendered map identifies exact API result');
  ok(await page.locator('#workspace-map').getAttribute('data-interaction')==='add','automatic result preserves build mode');
  const recalculated=page.waitForResponse(r=>r.url().endsWith('/sandbox/simulate'),{timeout:120000});
  await page.locator('#sb-undo').click();
  ok(await page.locator('#sb-report').isDisabled(),'undo immediately invalidates old report');
  const reverted=await (await recalculated).json();ok(reverted.scene_sha256!==first.scene_sha256,'undo recomputes distinct scene result');
  const missionResponse=await page.request.post(new URL('/api/weather/sandbox/heatmap',page.url()).href,{data:regional});
  ok(missionResponse.ok(),'historical grid endpoint available');const heat=await missionResponse.json();
  const mission=await page.request.post(new URL('/api/weather/sandbox/collection/simulate',page.url()).href,{data:{regional,scene:{name:'QA',additions:[],removed_ids:[]},expected_snapshot_sha256:heat.snapshot_sha256,start_mode:'central_staging'}});
  ok(mission.ok(),'road/air graph mission endpoint available');const data=await mission.json();
  for(const t of data.tracks.filter(t=>t.status==='ready')){
    ok(JSON.stringify(t.route.coordinates[0])===JSON.stringify(t.route.coordinates.at(-1)),t.device_id+' returns to depot');
    ok(t.planning.estimated_energy_wh<=t.planning.usable_budget_wh,t.device_id+' respects energy reserve');
    ok(t.planning.globally_optimal===false,t.device_id+' discloses heuristic');
  }
  await page.setViewportSize({width:390,height:844});
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile screen has no horizontal overflow');
  ok(errors.length===0,'no browser runtime errors');
  return {checks,errors,first_delta:first.summary.delta_utci_c,reverted_delta:reverted.summary.delta_utci_c};
}
