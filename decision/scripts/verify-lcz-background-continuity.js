async page => {
  const origin = new URL(page.url()).origin, local = ['localhost','127.0.0.1'].includes(new URL(origin).hostname);
  const checks = [], errors = [], evidence = [], releases = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  for (const edition of ['project','competition']) {
    const url = local ? origin + (edition === 'project' ? '/' : '/aic/') : edition === 'project' ? 'https://weather.nogamenolife.cn/decision/' : 'https://aic.nogamenolife.cn/aic/';
    const context = await page.context().browser().newContext({viewport:{width:1440,height:960}}), q = await context.newPage();
    let stage = 'load'; q.on('pageerror', e => errors.push(e.message));
    await q.addInitScript(() => performance.setResourceTimingBufferSize(10000));
    const endpoint = r => r.url().endsWith('/sandbox/simulate') && r.request().method() === 'POST';
    const settle = async body => {
      await q.waitForFunction(hash => {
        const s = window.__background;
        return document.getElementById('workspace-map').dataset.resultSha256 === hash && !s.busy &&
          ['sandbox-heat','sandbox-heat-coverage','sandbox-layout-impact'].every(id => s.map.isSourceLoaded(id));
      }, body.report_sha256, {timeout:120000});
    };
    const calculated = async action => {
      const pending = q.waitForResponse(endpoint, {timeout:120000}); await action();
      const r = await pending, body = await r.json(); check(r.ok(), edition+' real simulation succeeds');
      await settle(body); return body;
    };
    const field = () => q.evaluate(async () => {
      const s=window.__background;
      return {mode:s.mode,layer:s.$('sb-layer').value,values:(await s.map.getSource('sandbox-heat').getData()).features.map(f=>({id:f.id,value:f.properties.value,temperature:f.properties.temperature_c,humidity:f.properties.humidity_pct})),
        impact:(await s.map.getSource('sandbox-layout-impact').getData()).features.map(f=>({grid_id:f.properties.grid_id,value:f.properties.value})),
        scale:s.map.getPaintProperty('sandbox-heat-fill','fill-color'),snapshot:s.heat.snapshot_sha256,legend:s.legend.textContent};
    });
    try {
      if(!local){
        const releaseURL=edition==='project'?new URL('release.json',url).href:new URL('/release.json',url).href;
        const response=await q.request.get(releaseURL),release=await response.json();
        check(response.ok()&&release.releaseId.startsWith('lcz-continuity-'),edition+' serves the LCZ continuity release manifest');
        releases.push(release.releaseId);
      }
      await q.goto(url+'?qa=background#screen',{waitUntil:'domcontentloaded'});
      await q.locator('#sb-auto').waitFor({state:'attached',timeout:65000});
      await q.locator('.sandbox-legend[data-valid-cells]:not([data-valid-cells="0"])').waitFor({timeout:65000});
      await q.evaluate(async () => {
        const url=performance.getEntriesByType('resource').map(r=>r.name).find(u=>/\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));
        const {LayoutSandbox}=await import(url),paint=LayoutSandbox.prototype.paint;
        LayoutSandbox.prototype.paint=function(...args){window.__background=this;return paint.apply(this,args);};
      });
      await q.locator('#dock-tab-sandbox').click(); await q.locator('#sb-auto').uncheck();
      await q.locator('#sb-layer').selectOption('anomaly');
      stage='initial historical background';
      await q.evaluate(async () => {
        const s=window.__background,bounds={west:113.527,east:113.531,south:34.812,north:34.816};
        s.state.regionalDraft={...s.regional(),bounds,mode:'history',use_ai:false};s.setBounds(bounds);await s.refreshHeat();
        s.map.jumpTo({pitch:0,bearing:0});s.map.fitBounds([[bounds.west,bounds.south],[bounds.east,bounds.north]],{padding:80,duration:0});
      });
      await q.waitForFunction(()=>window.__background.heat?.baseline?.source_type==='historical_weather'&&window.__background.map.isSourceLoaded('sandbox-heat'));
      const initial=await field();
      check(initial.layer==='anomaly' && initial.values.length>50,edition+' starts with original multi-cell LCZ background');
      check(initial.values.some(f=>f.value<0) && initial.values.some(f=>f.value>0),edition+' initial warm and cool cells are preserved');
      const baseline=await calculated(()=>q.locator('#sb-auto').check());
      check((await field()).layer==='anomaly',edition+' no-edit computation does not replace the selected metric');
      stage='build';
      await q.locator('[data-mode="edit"]').click(); await q.locator('[data-operation="add"]').click();
      for(const id of ['width','depth'])await q.locator('#sb-'+id).fill('20'); await q.locator('#sb-height').fill('60');
      const point=await q.evaluate(()=>{const s=window.__background,r=document.getElementById('workspace-map').getBoundingClientRect(),p=s.map.project([113.528143,34.813813]);return {x:r.left+p.x,y:r.top+p.y};});
      await q.mouse.click(point.x,point.y);
      check(!await q.locator('#sb-confirm').isDisabled(),edition+' actual map click accepts the new building');
      const built=await calculated(()=>q.locator('#sb-confirm').click()), after=await field();
      check(after.layer==='anomaly' && after.mode==='edit',edition+' construction does not silently switch to an all-blue difference map');
      check(JSON.stringify(after.values)===JSON.stringify(initial.values),edition+' all original LCZ temperatures humidity and cold-warm values remain unchanged after one building');
      check(JSON.stringify(after.scale)===JSON.stringify(initial.scale),edition+' same physical metric retains the original fixed color scale');
      check(built.lcz_snapshot_sha256===baseline.lcz_snapshot_sha256 && built.weather_boundary.id===baseline.weather_boundary.id,edition+' building uses exactly the same LCZ and weather snapshot');
      const expected=built.cells.features.filter(f=>Number.isFinite(f.properties.delta_utci_c)&&Math.abs(f.properties.delta_utci_c)>=.001&&f.properties.comparable_area_m2>.01).map(f=>({grid_id:f.properties.grid_id,value:f.properties.delta_utci_c}));
      check(after.impact.length>0 && after.impact.length<built.cells.features.length,edition+' local physical effect is visible without recoloring every grid');
      check(JSON.stringify(after.impact)===JSON.stringify(expected),edition+' local annotations exactly match per-grid physical deltas');
      check(after.legend.includes('拆建影响') && !after.legend.includes('ΔUTCI：蓝=降低'),edition+' LCZ legend and local-effect legend stay distinct');
      await q.screenshot({path:`output/playwright/lcz-continuity-${local?'local':'public'}-${edition}-built.png`});
      stage='explicit views';
      await q.locator('[data-mode="baseline"]').click();
      check((await field()).impact.length===0,edition+' original view hides proposed changes');
      await q.locator('[data-mode="proposed"]').click();
      check(JSON.stringify((await field()).impact)===JSON.stringify(expected),edition+' proposed view restores only actual local changes');
      await q.locator('#sb-layer').selectOption('utci');
      const actual=await q.evaluate(async()=>(await window.__background.map.getSource('sandbox-heat').getData()).features);
      check(actual.every(f=>f.properties.value===built.cells.features[f.id].properties.proposed_utci_c),edition+' explicitly requested absolute UTCI matches API');
      await q.locator('[data-mode="delta"]').click();
      check((await field()).legend.includes('ΔUTCI'),edition+' signed difference is available only as an explicit view');
      await q.locator('[data-mode="edit"]').click(); await q.locator('#sb-layer').selectOption('anomaly');
      check(JSON.stringify((await field()).values)===JSON.stringify(initial.values),edition+' returning to LCZ restores the original field exactly');
      stage='delete proposed building';
      await q.locator('[data-operation="remove"]').click();await q.mouse.click(point.x,point.y);
      check(!await q.locator('#sb-confirm').isDisabled(),edition+' proposed building can be selected for deletion');
      const reset=await calculated(async()=>{await q.locator('#sb-confirm').click();await q.locator('#sb-confirm-dialog [value="confirm"]').click();});
      check(reset.scene.additions.length===0 && (await field()).impact.length===0,edition+' deleting the proposal removes obsolete thermal annotations');
      check(JSON.stringify((await field()).values)===JSON.stringify(initial.values),edition+' deletion restores initial background without accumulated cooling');
      stage='demolish existing building';
      await q.waitForFunction(()=>window.__background.map.isSourceLoaded('campus-buildings'));
      const existing=await q.evaluate(()=>{
        const s=window.__background,r=document.getElementById('workspace-map').getBoundingClientRect();
        const points=[];
        for(let y=180;y<r.height-190;y+=6)for(let x=100;x<r.width-100;x+=6){
          const hit=s.map.queryRenderedFeatures([x,y],{layers:['campus-picking']})[0];
          if(hit&&s.base.features.some(f=>f.id===hit.properties.id))points.push({x:r.x+x,y:r.y+y,id:hit.properties.id});
        }
        return points.sort((a,b)=>Math.hypot(a.x-740,a.y-450)-Math.hypot(b.x-740,b.y-450))[0];
      });
      check(!!existing,edition+' an existing individual building is available in the study area');
      await q.mouse.click(existing.x,existing.y);check(!await q.locator('#sb-confirm').isDisabled(),edition+' existing building is selectable for demolition');
      const demolished=await calculated(async()=>{await q.locator('#sb-confirm').click();await q.locator('#sb-confirm-dialog [value="confirm"]').click();});
      check(demolished.scene.removed_ids.length===1 && (await field()).layer==='anomaly',edition+' demolition keeps the original display metric');
      check(JSON.stringify((await field()).values)===JSON.stringify(initial.values),edition+' demolition never rewrites initial LCZ background');
      const undo=await calculated(()=>q.locator('#sb-undo').click());
      check(undo.scene.removed_ids.length===0 && (await field()).impact.length===0,edition+' undo restores original geometry and clears impacts');
      await calculated(()=>q.locator('#sb-redo').click());
      await q.locator('[data-operation="add"]').click();
      for(const id of ['width','depth'])await q.locator('#sb-'+id).fill('20');await q.locator('#sb-height').fill('60');
      await q.mouse.click(point.x,point.y);
      const combined=await calculated(()=>q.locator('#sb-confirm').click());
      check(combined.scene.additions.length===1&&combined.scene.removed_ids.length===1,edition+' construction and demolition form one editable scenario');
      const scene=JSON.stringify(combined.scene);
      stage='forecast hours';
      await q.locator('#sb-auto').uncheck();
      const forecast=await calculated(()=>q.locator('#screen-forecast-hour').fill('2'));
      await q.waitForFunction(()=>!!document.getElementById('workspace-map').dataset.frameRenderedAt);
      const firstHour=await field();
      check(firstHour.layer==='anomaly',edition+' hourly simulation keeps the LCZ metric');
      check(firstHour.snapshot===forecast.lcz_snapshot_sha256 && forecast.valid_time===forecast.solar.time,edition+' displayed forecast background and physical result use one hourly snapshot');
      check(JSON.stringify(forecast.scene)===scene,edition+' first forecast hour retains all construction and demolition edits');
      const second=await calculated(()=>q.locator('#screen-forecast-hour').fill('4'));
      const secondHour=await field();
      check(secondHour.layer==='anomaly' && secondHour.snapshot===second.lcz_snapshot_sha256,edition+' subsequent hour also keeps the same simulation chain');
      check(JSON.stringify(second.scene)===scene,edition+' following hour recalculates the same edited geometry rather than resetting it');
      const hourImpacts=second.cells.features.filter(f=>f.properties.comparable_area_m2>.01&&Number.isFinite(f.properties.delta_utci_c)&&Math.abs(f.properties.delta_utci_c)>=.001).map(f=>({grid_id:f.properties.grid_id,value:f.properties.delta_utci_c}));
      check(JSON.stringify(secondHour.impact)===JSON.stringify(hourImpacts),edition+' hourly local effects match the current result without reusing daylight shading');
      check(JSON.stringify(firstHour.values)!==JSON.stringify(secondHour.values),edition+' weather and LCZ diurnal parameters genuinely update the grid over time');
      await q.locator('#sb-report').click();check((await q.locator('#sb-report-content').innerText()).includes(second.report_sha256),edition+' report remains linked to the displayed final hour');await q.locator('#sb-report-close').click();
      await q.setViewportSize({width:390,height:844});
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' local-impact presentation fits mobile');
      await q.screenshot({path:`output/playwright/lcz-continuity-${local?'local':'public'}-${edition}-mobile.png`});
      evidence.push({edition,background:initial.snapshot,built:built.report_sha256,changedCells:after.impact.length,physicalCells:built.cells.features.length,demolished:demolished.report_sha256,forecast:second.report_sha256});
    }catch(error){
      await q.screenshot({path:`output/playwright/lcz-continuity-failure-${edition}.png`});
      throw Error(error.message+' '+JSON.stringify({stage,edition,checks,errors,state:await q.evaluate(()=>({status:document.getElementById('sb-status')?.textContent,error:document.getElementById('sb-error')?.textContent,interaction:document.getElementById('workspace-map')?.dataset.interaction}))}));
    }finally{await context.close();}
  }
  if(!local)check(releases.length===2&&releases[0]===releases[1],'independent public sites serve the same release');
  check(!errors.length,'no background continuity runtime errors');return {checks,errors,evidence,releases};
}
