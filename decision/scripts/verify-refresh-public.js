async(page)=>{
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname),base=local?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage();
  const checks=[],errors=[],fixtures=[],transfers=[];qa.on('pageerror',e=>errors.push(e.message));
  const check=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  const calculated=async(action,endpoint)=>{
    const started=Date.now(),pending=qa.waitForResponse(r=>r.url().endsWith('/sandbox/'+endpoint)&&r.request().method()==='POST',{timeout:120000});
    await action();const response=await pending,data=await response.json();check(response.ok(),endpoint+' HTTP success');
    await qa.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,data.report_sha256,{timeout:30000});
    return {data,elapsed_ms:Date.now()-started};
  };
  try{
    for(const edition of ['', 'aic/']){
      await qa.goto(origin+base+edition+'#screen',{waitUntil:'domcontentloaded'});await qa.locator('#sb-auto').waitFor({timeout:60000});await qa.locator('#sb-auto').uncheck();
      await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
      check(await qa.locator('#workspace-map').getAttribute('data-vector-streets')==='true',edition+' vector street source ready');
      const initial=await calculated(()=>qa.locator('#sb-auto').check(),'simulate');await qa.locator('#sb-auto').uncheck();
      check(initial.data.cells.features.length>1&&initial.data.cells.features.length<=625,edition+' full-campus result has multiple cells');
      check(await qa.locator('#sb-error').isHidden(),edition+' no calculation error');
      for(const mode of ['baseline','proposed','delta','edit']){
        await qa.locator('[data-mode="'+mode+'"]').click();
        check(await qa.locator('#workspace-map').getAttribute('data-result-sha256')===initial.data.report_sha256,edition+' '+mode+' keeps exact result');
      }
      const refreshed=qa.waitForResponse(r=>r.url().endsWith('/sandbox/heatmap'));
      await qa.locator('#screen-refresh').click();const response=await refreshed;await response.finished();
      await qa.waitForFunction(()=>!document.querySelector('#screen-refresh').disabled,{timeout:60000});
      check(response.ok(),edition+' top refresh actually reloads heatmap');
      check(await qa.locator('#workspace-map').getAttribute('data-result-sha256')===initial.data.report_sha256,edition+' identical weather refresh does not erase calculation');
      const transfer=await qa.evaluate(()=>{const rows=performance.getEntriesByType('resource').filter(r=>r.name.includes('/sandbox/heatmap'));return rows.map(r=>({duration:r.duration,encoded_bytes:r.encodedBodySize,decoded_bytes:r.decodedBodySize}));});
      check(transfer.some(t=>t.decoded_bytes>6000000&&t.encoded_bytes<t.decoded_bytes/5),edition+' real browser receives compressed full-campus payload');transfers.push({edition,requests:transfer});
      await qa.locator('#map-imagery').click();await qa.locator('#map-streets').click();
      check(await qa.locator('#workspace-map').getAttribute('data-basemap')==='streets',edition+' basemap can switch back');
      const manual=await calculated(()=>qa.locator('#sb-run').click(),'collaborate');
      check(manual.data.regional_report.layout_exposure.summary.delta_utci_c===manual.data.summary.delta_utci_c,edition+' manual AI collaboration linked report matches');
      await qa.setViewportSize({width:390,height:844});await qa.locator('.sandbox-mobile-toggle').click();
      check(await qa.locator('#sb-run').isVisible(),edition+' mobile sandbox remains accessible');
      await qa.screenshot({path:'output/playwright/refresh-final-'+(edition?'competition':'project')+'-mobile.png'});
      check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' no mobile horizontal overflow');
      await qa.setViewportSize({width:1440,height:960});
      fixtures.push({edition,cells:manual.data.cells.features.length,report_sha256:manual.data.report_sha256,automatic_ms:initial.elapsed_ms,manual_ms:manual.elapsed_ms,workflow:manual.data.orchestration?.planner});
    }
    check(errors.length===0,'no runtime exceptions');return {checks,errors,fixtures,transfers};
  }finally{await context.close();}
}
