async (page) => {
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname);
  const base=local?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage();
  const checks=[],errors=[],results=[];
  const check=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  qa.on('pageerror',e=>errors.push(e.message));
  const visibleWeather=async label=>{
    check(await qa.locator('.sandbox-legend').getAttribute('data-layer')==='weather',label+' renders weather');
    check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>100,label+' retains multi-cell heatmap');
    check(await qa.locator('.sandbox-legend').getAttribute('data-total-cells')==='2610',label+' retains fine weather grid');
  };
  try{
    for(const edition of ['', 'aic/']){
      const label=edition?'competition':'project';
      await qa.goto(origin+base+edition+'#screen',{waitUntil:'domcontentloaded'});
      await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
      await qa.locator('#dock-tab-sandbox').click();
      await qa.locator('#sb-auto').uncheck();
      await qa.locator('[data-mode="delta"]').click();
      await visibleWeather(label+' empty delta');
      check(await qa.locator('.sandbox-legend').getAttribute('data-requested-layer')==='utci',label+' pending delta intent is retained');
      await qa.locator('#sb-show-weather').click();
      if(local){
        let release,started;const gate=new Promise(r=>release=r),seen=new Promise(r=>started=r);
        await qa.route('**/api/weather/sandbox/collaborate',async route=>{started();await gate;await route.fulfill({status:503,json:{detail:'QA controlled failure'}}).catch(()=>{});});
        try{
          await qa.locator('#sb-run').click();await seen;
          await qa.locator('[data-mode="delta"]').click();
          await visibleWeather(label+' calculation pending');
          check((await qa.locator('.sandbox-legend').textContent()).includes('重算中'),label+' pending state visible');
          release();await qa.locator('#sb-error').waitFor({state:'visible'});
          await visibleWeather(label+' calculation failed');
          check(await qa.locator('#sb-report').isDisabled(),label+' failed result cannot open stale report');
          check(!await qa.locator('#sb-run').isDisabled(),label+' retry unlocked');
        }finally{release();await qa.unroute('**/api/weather/sandbox/collaborate');}
      }
      await qa.locator('#sb-show-weather').click();
      await qa.locator('#map-home').click();await qa.waitForTimeout(800);
      if(await qa.locator('#map-pitch').getAttribute('aria-pressed')==='true')await qa.locator('#map-pitch').click();
      await qa.waitForTimeout(500);await qa.locator('[data-operation="add"]').click();
      await qa.locator('#sb-height').fill('60');
      let placed;
      for(const point of [[710,440],[680,400],[770,400],[660,480],[740,510],[810,460]]){
        await qa.mouse.click(...point);if(await qa.locator('#sb-confirm').isDisabled())continue;
        const pending=qa.waitForResponse(r=>r.url().endsWith('/sandbox/validate'));
        await qa.locator('#sb-confirm').click();const response=await pending;
        await qa.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
        if(response.ok()){placed=point;break;}
      }
      check(!!placed,label+' actual collision-checked construction');
      const calculated=qa.waitForResponse(r=>r.url().endsWith('/sandbox/simulate')&&r.request().method()==='POST',{timeout:120000});
      await qa.locator('#sb-auto').check();const response=await calculated;
      check(response.ok(),label+' actual automatic calculation returns success');
      const result=await response.json();
      await qa.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,result.report_sha256,{timeout:120000});
      check(result.scene.additions.length===1,label+' actual building reaches numerical model');
      check(result.regional_report.layout_exposure.scene_sha256===result.scene_sha256,label+' report uses matching geometry');
      if(result.solar.altitude_deg<2){
        check(result.effect_status==='night_no_shortwave',label+' night applicability explicit');
        check((await qa.locator('#sb-summary').innerText()).includes('夜间气象估测'),label+' night weather risk remains evaluated');
        check((await qa.locator('#sb-summary .sandbox-results > strong').textContent())===result.summary.proposed_utci_c.toFixed(1)+' °C',label+' actual night UTCI replaces misleading zero-effect headline');
        check(!(await qa.locator('#sb-summary').innerText()).includes('夜间未评估'),label+' night risk is not incorrectly labeled unevaluated');
        check((await qa.locator('#sb-summary').innerText()).includes('拆建热增量'),label+' building increment remains separate from weather estimate');
        await visibleWeather(label+' night completion');
        await qa.locator('[data-mode="delta"]').click();await visibleWeather(label+' night delta');
        check(!(await qa.locator('.sandbox-legend').innerText()).includes('ΔUTCI：'),label+' no fake night difference colorbar');
      }
      await qa.locator('#sb-auto').uncheck();await qa.locator('[data-mode="proposed"]').click();
      await qa.locator('#sb-layer').selectOption('utci');
      check(await qa.locator('.sandbox-legend').getAttribute('data-layer')==='utci',label+' explicit absolute layer reaches renderer');
      check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>0,label+' explicit absolute UTCI remains available');
      await qa.locator('[data-mode="edit"]').click();await qa.locator('#sb-undo').click();
      await visibleWeather(label+' invalidated result');
      check(await qa.locator('.sandbox-legend').getAttribute('data-fallback')==='pending',label+' invalidated scenario falls back without clearing metric selection');
      check(await qa.locator('#sb-report').isDisabled(),label+' invalidated report disabled');
      await qa.setViewportSize({width:390,height:844});
      check(await qa.locator('.sandbox-legend').isVisible(),label+' fallback legend visible on phone');
      check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' phone has no horizontal overflow');
      await qa.screenshot({path:'output/playwright/thermal-fallback-'+label+'-mobile.png'});
      await qa.setViewportSize({width:1440,height:960});
      results.push({edition:label,effect_status:result.effect_status,solar:result.solar,summary:result.summary,report_sha256:result.report_sha256});
    }
    check(errors.length===0,'no browser runtime errors');
    return {checks,errors,results};
  }catch(error){
    await qa.screenshot({path:'output/playwright/thermal-fallback-failure.png'}).catch(()=>{});
    throw new Error(error.message+'; '+JSON.stringify({checks,errors,status:await qa.locator('#sb-status').textContent().catch(()=>''),legend:await qa.locator('.sandbox-legend').textContent().catch(()=>''),error:await qa.locator('#sb-error').textContent().catch(()=>'' )}));
  }finally{await context.close();}
}
