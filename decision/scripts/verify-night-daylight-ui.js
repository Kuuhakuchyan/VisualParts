async (page) => {
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname),base=local?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage();
  const checks=[],errors=[],results=[];qa.on('pageerror',e=>errors.push(e.message));
  const check=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  const calculated=async(action)=>{const pending=qa.waitForResponse(r=>r.url().endsWith('/sandbox/simulate')&&r.request().method()==='POST',{timeout:120000});await action();const response=await pending;check(response.ok(),'calculation succeeds');const data=await response.json();await qa.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,data.report_sha256,{timeout:120000});return data;};
  try{
    for(const edition of ['', 'aic/']){
      await qa.goto(origin+base+edition+'#screen');await qa.locator('#sb-auto').waitFor({timeout:60000});await qa.locator('#sb-auto').uncheck();
      await qa.locator('#map-home').click();await qa.waitForTimeout(1000);if(await qa.locator('#map-pitch').getAttribute('aria-pressed')==='true')await qa.locator('#map-pitch').click();await qa.waitForTimeout(600);
      await qa.locator('[data-operation="add"]').click();await qa.locator('#sb-height').fill('60');
      let building;
      for(const point of [[710,440],[680,400],[770,400],[660,480],[740,510],[810,460]]){
        await qa.mouse.click(...point);if(await qa.locator('#sb-confirm').isDisabled())continue;
        const pending=qa.waitForResponse(r=>r.url().endsWith('/sandbox/validate'));await qa.locator('#sb-confirm').click();const response=await pending;
        await qa.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
        if(response.ok()){building=response.request().postDataJSON().additions[0];break;}
      }
      check(!!building,edition+' construction through UI');
      await qa.locator('.screen-nav [data-screen-panel="risk"]').click();await qa.locator('#region-mode').selectOption('current');await qa.locator('#region-ai').uncheck();
      for(const [key,value]of Object.entries({west:building.longitude-.0025,east:building.longitude+.0025,south:building.latitude-.002,north:building.latitude+.002}))await qa.locator('#bound-'+key).fill(String(value));
      const assessment=qa.waitForResponse(r=>r.url().endsWith('/regional-assess'));await qa.locator('#regional-submit').click();check((await assessment).ok(),edition+' current regional setup');await qa.keyboard.press('Escape');
      const current=await calculated(()=>qa.locator('#sb-auto').check());
      check(await qa.locator('#sb-layer').inputValue()===(current.effect_status==='changed'||current.effect_status==='no_resolved_change'?'utci':'weather'),edition+' automatic calculation only presents supported scenario results');
      if(current.solar.altitude_deg<2){
        check(current.effect_status==='night_no_shortwave',edition+' night limitation explicit');
        check((await qa.locator('#sb-summary').innerText()).includes('夜间'),edition+' visible night explanation');
        check(!(await qa.locator('#sb-summary').innerText()).includes('-0.00'),edition+' no misleading negative zero');
        const day=await calculated(()=>qa.getByRole('button',{name:'历史高温日间对比',exact:true}).click());
        check(day.weather_boundary.source_type==='historical_weather'&&day.solar.altitude_deg>=2,edition+' explicit daylight case changes boundary');
        check(day.summary.changed_cells>0,edition+' daylight case has genuine UTCI changes');
        check((await qa.locator('#sb-data-notice').innerText()).includes('历史边界（非当前）'),edition+' data selector notice switches to history');
        check((await qa.locator('#sb-summary').innerText()).includes('非当前'),edition+' summary retains history warning');
        check(day.regional_report.layout_exposure.summary.delta_utci_c===day.summary.delta_utci_c,edition+' same calculation in linked report');
        await qa.locator('[data-mode="delta"]').click();
        check((await qa.locator('.sandbox-legend').innerText()).includes('色标按本次差值'),edition+' scaled difference legend');
        check((await qa.locator('#sb-summary').innerText()).includes('局部 ΔUTCI 范围'),edition+' local effect visible alongside average');
        results.push({edition,night:current.summary,day:day.summary,scene:day.scene_sha256,result:day.report_sha256});
        await qa.screenshot({path:'output/playwright/thermal-public-daylight-'+(edition?'competition':'project')+'.png'});
      }
      await qa.locator('[data-mode="proposed"]').click();
      check((await qa.locator('#sb-count').innerText()).includes('新增 1'),edition+' proposal retained outside editor');
    }
    check(errors.length===0,'no runtime exceptions');return {checks,errors,results};
  }catch(error){
    await qa.screenshot({path:'output/playwright/thermal-ui-failure.png'}).catch(()=>{});
    throw new Error(error.message+'; state='+JSON.stringify({url:qa.url(),errors,checks,controls:await qa.locator('#sb-auto').count(),body:(await qa.locator('body').innerText()).slice(-2000)}));
  }finally{await context.close();}
}
