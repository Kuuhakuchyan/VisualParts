async page=>{
  const origin=new URL(page.url()).origin,local=['127.0.0.1','localhost'].includes(new URL(origin).hostname);
  const checks=[],errors=[],evidence=[];
  const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  for(const edition of ['project','competition']){
    const base=local?origin+(edition==='competition'?'/aic/':'/'):edition==='competition'?'https://aic.nogamenolife.cn/aic/':'https://weather.nogamenolife.cn/decision/';
    const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),q=await context.newPage();
    q.on('pageerror',error=>errors.push(error.message));
    try{
      await q.goto(base+'#screen');
      await q.locator('#workspace-map[data-buildings="225"]').waitFor({timeout:60000});
      await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-auto').uncheck();
      if(await q.locator('#sb-grid-resolution').inputValue()!=='100'){
        const pending=q.waitForResponse(r=>r.url().endsWith('/sandbox/heatmap')&&r.request().postDataJSON().grid_resolution_m===100,{timeout:120000});
        await q.locator('#sb-grid-resolution').selectOption('100');check((await pending).ok(),edition+' coarse collection snapshot loads');
      }
      await q.locator('#screen-forecast-hour:not([disabled])').waitFor();
      const framePending=q.waitForResponse(r=>r.url().endsWith('/sandbox/simulate'),{timeout:120000});
      await q.locator('#screen-forecast-hour').fill('0');const frame=await(await framePending).json();
      await q.waitForFunction(hash=>document.querySelector('#workspace-map').dataset.resultSha256===hash,frame.report_sha256,{timeout:120000});
      check(frame.is_forecast,edition+' forecast frame completes');
      await q.locator('#sb-report').click();
      check((await q.locator('#sb-report-content > .notice').first().innerText()).includes('预报情景'),edition+' report identifies forecast instead of current observation');
      await q.locator('#sb-report-close').click();
      for(const mode of ['baseline','proposed','delta']){
        await q.locator('.sandbox-modes button[data-mode='+mode+']').click();
        check(await q.locator('[data-mode]').count()===4,edition+' '+mode+' mode metadata belongs only to four controls');
      }
      await q.locator('[data-mode=edit]').click();await q.locator('[data-operation=add]').click();
      await q.evaluate(()=>window.__qaHelp=document.querySelector('#sb-tool-help button'));
      await q.locator('#sb-height').fill('32');await q.locator('#sb-width').fill('24');
      check(await q.evaluate(()=>window.__qaHelp===document.querySelector('#sb-tool-help button')),edition+' editing dimensions preserves help node and focus');
      await q.locator('[data-operation=inspect]').click();
      await q.locator('#sb-collection').click();
      const missionPending=q.waitForResponse(r=>r.url().endsWith('/collection/simulate'),{timeout:120000});
      await q.locator('#collection-generate').click();const missionResponse=await missionPending,mission=await missionResponse.json();
      check(missionResponse.ok(),edition+' forecast collection generates '+JSON.stringify(mission.detail||''));
      check(mission.is_forecast&&mission.valid_time===frame.valid_time,edition+' collection keeps chosen forecast hour');
      check(mission.snapshot_sha256===frame.lcz_snapshot_sha256,edition+' collection uses exact heat snapshot');
      check(mission.scene_sha256===frame.scene_sha256,edition+' collection uses exact building scene');
      check(mission.tracks.length===2&&mission.tracks.every(t=>t.status==='ready'),edition+' both devices have planned routes');
      for(const track of mission.tracks){
        check(track.planning.estimated_energy_wh<=track.planning.usable_budget_wh,edition+' '+track.device_id+' keeps return energy reserve');
        check(track.samples.every(s=>s.simulated&&s.quality_flag===null&&!s.med_eligible),edition+' '+track.device_id+' provenance retained');
      }
      await q.locator('#collection-play:not([disabled])').waitFor();await q.locator('#collection-play').click();
      await q.waitForFunction(()=>Number(document.querySelector('#workspace-map').dataset.collectionTime)>1);
      await q.locator('#collection-play').click();const paused=await q.locator('#collection-progress').inputValue();await q.waitForTimeout(150);
      check(await q.locator('#collection-progress').inputValue()===paused&&await q.locator('#collection-play').getAttribute('aria-pressed')==='false',edition+' pause stops route and clears button');
      const exported=q.waitForEvent('download');await q.locator('#collection-export').click();
      await(await exported).saveAs('output/playwright/platform-roundtrip-'+edition+'-mission.json');
      await q.locator('#collection-ugv-budget').fill('0');await q.locator('#collection-ugv-budget').press('Tab');
      check(await q.locator('#collection-export').isDisabled(),edition+' changed budget invalidates old mission');
      let invalidRequests=0;const listener=r=>{if(r.url().endsWith('/collection/simulate'))invalidRequests++;};q.on('request',listener);
      await q.locator('#collection-generate').click();await q.waitForTimeout(150);
      check(invalidRequests===0,edition+' invalid battery is blocked before request');q.off('request',listener);
      await q.locator('#collection-close').click();
      const assessment=q.locator('.screen-nav [data-screen-panel=risk]');await assessment.click();
      if(!await q.locator('#region-mode').isVisible())await q.locator('.regional-parameters > summary').click();
      await q.locator('#region-mode').selectOption('history');
      check(await q.locator('#screen-forecast-play').getAttribute('aria-pressed')==='false',edition+' switching history stops forecast playback');
      await q.locator('#screen-panel-close').click();
      const historyPending=q.waitForResponse(r=>r.url().endsWith('/sandbox/simulate'),{timeout:120000});
      await q.locator('#sb-auto').check();const historyResponse=await historyPending,history=await historyResponse.json();
      check(historyResponse.ok()&&!history.is_forecast&&!history.input.valid_time,edition+' history clears future timestamp and recomputes');
      await q.waitForFunction(hash=>document.querySelector('#workspace-map').dataset.resultSha256===hash,history.report_sha256,{timeout:120000});
      check((await q.locator('#screen-forecast-value').innerText()).includes('历史情景'),edition+' timeline displays historical context');
      await q.locator('#sb-auto').uncheck();
      await q.setViewportSize({width:390,height:700});await q.locator('.screen-dock-expand').click();
      await q.locator('#sb-collection').click();
      check(await q.locator('#collection-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth&&n.getBoundingClientRect().right<=innerWidth),edition+' collection fits phone');
      await q.screenshot({path:'output/playwright/platform-roundtrip-'+edition+'-mobile.png'});
      evidence.push({edition,frame_sha256:frame.report_sha256,mission_id:mission.mission_id,history_sha256:history.report_sha256});
    }catch(error){await q.screenshot({path:'output/playwright/platform-roundtrip-'+edition+'-failure.png'});throw Error(JSON.stringify({message:error.message,checks,edition}));}
    finally{await context.close();}
  }
  check(!errors.length,'no roundtrip runtime exceptions');return {checks,errors,evidence};
}
