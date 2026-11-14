async (page) => {
  const origin=new URL(page.url()).origin;
  if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Fault injection is local-only');
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage();
  const checks=[],errors=[];qa.on('pageerror',error=>errors.push(error.message));
  const check=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  const fixtures=[];
  try{
    for(const edition of ['', 'aic/']){
      let failBuildings=true,failStyle=true;
      await qa.route('**/api/weather/sandbox/buildings',route=>failBuildings?route.fulfill({status:503,json:{detail:'QA temporary building failure'}}):route.continue());
      await qa.route('https://tiles.openfreemap.org/styles/positron',route=>failStyle?route.fulfill({status:503,body:'QA temporary style failure'}):route.continue());
      await qa.goto(origin+'/'+edition+'#screen');
      await qa.waitForFunction(()=>document.querySelector('#map-state')?.textContent.includes('建筑暂不可用'),{timeout:40000});
      check(await qa.locator('#sb-run').count()===0,edition+' initial failure reproduced without fake buildings');
      failBuildings=false;failStyle=false;
      await qa.locator('#screen-refresh').click();
      await qa.locator('#sb-auto').waitFor({state:'attached',timeout:60000});await qa.locator('#dock-tab-sandbox').click();await qa.locator('#sb-auto').uncheck();
      await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
      check(await qa.locator('#workspace-map').getAttribute('data-buildings')==='225',edition+' refresh restores failed building load and sandbox');
      check(await qa.locator('#workspace-map').getAttribute('data-vector-streets')==='true',edition+' bundled vector street style survives external metadata failure');
      const unavailable=await qa.locator('#sb-resolution option:disabled').allTextContents();
      check(unavailable.includes('25 m')&&unavailable.includes('50 m'),edition+' full-campus unsupported fine grids disabled before request');
      check(await qa.locator('#sb-resolution').inputValue()==='100',edition+' full-campus calculation uses supported spacing');
      const pending=qa.waitForResponse(r=>r.url().endsWith('/sandbox/simulate'),{timeout:120000});
      await qa.locator('#sb-auto').check();const response=await pending,result=await response.json();
      check(response.ok(),edition+' full-campus numerical calculation succeeds');
      await qa.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,result.report_sha256,{timeout:30000});
      check(result.cells.features.length>1&&result.cells.features.length<=625,edition+' full-campus multi-cell result shown');
      await qa.locator('[data-mode="proposed"]').click();
      const hash=await qa.locator('#workspace-map').getAttribute('data-result-sha256');
      let heatFailure=true;await qa.route('**/api/weather/sandbox/heatmap',route=>heatFailure?route.fulfill({status:503,json:{detail:'QA temporary weather failure'}}):route.continue());
      await qa.locator('#sb-refresh').click();
      await qa.waitForFunction(()=>document.querySelector('.sandbox-legend')?.dataset.refreshState==='stale');
      check(await qa.locator('#workspace-map').getAttribute('data-result-sha256')===hash,edition+' failed refresh does not discard numerical result');
      heatFailure=false;await qa.locator('#sb-refresh').click();
      await qa.waitForFunction(()=>document.querySelector('.sandbox-legend')?.dataset.refreshState==='current',{timeout:60000});
      check(await qa.locator('#workspace-map').getAttribute('data-result-sha256')===hash,edition+' recovered identical boundary preserves result');
      check(await qa.locator('#sb-error').isHidden(),edition+' no stale calculation error');
      fixtures.push({edition,report_sha256:hash,cells:result.cells.features.length});
      await qa.unroute('**/api/weather/sandbox/heatmap');await qa.unroute('**/api/weather/sandbox/buildings');await qa.unroute('https://tiles.openfreemap.org/styles/positron');
    }
    check(errors.length===0,'no runtime exceptions');return {checks,errors,fixtures};
  }finally{await context.close();}
}
