async page => {
  const origin=new URL(page.url()).origin;
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage(),checks=[],errors=[];
  const check=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  qa.on('pageerror',error=>errors.push(error.message));
  try{
    for(const edition of ['', 'aic/']){
      const name=edition?'competition':'project';
      const pending=qa.waitForResponse(r=>r.url().includes('/sandbox/heatmap')&&r.request().method()==='POST',{timeout:120000});
      await qa.goto(origin+'/decision/'+edition+'#screen');
      const response=await pending;check(response.ok(),name+' initial heat succeeds');
      const heat=await response.json(),summary=heat.classification_summary;
      check(summary.classes.length>=8,name+' API provides refined surface composition');
      check(Math.abs(summary.classes.reduce((a,c)=>a+c.area_m2,0)+summary.unknown_area_m2-summary.area_m2)<.1,name+' classified and unknown areas balance');
      await qa.locator('#sb-auto').uncheck();
      await qa.locator('#sb-lcz-composition summary').click();
      const table=qa.locator('#sb-lcz-summary .lcz-summary');
      check(await table.getAttribute('data-classification-sha256')===summary.classification_sha256,name+' rendered composition matches API classification');
      check(await table.locator('tbody tr').count()===summary.classes.length+1,name+' all classes and unknown row appear');
      await qa.locator('#sb-layer').selectOption('lcz');
      await qa.waitForFunction(()=>document.querySelector('.sandbox-legend')?.dataset.layer==='lcz');
      check((await qa.locator('.sandbox-legend').textContent()).includes('LCZ 分类分布'),name+' classification layer has distinct legend');
      check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>2000,name+' classification layer retains fine grid');
      await qa.screenshot({path:'output/playwright/lcz-workflow-'+name+'-desktop.png'});
      await qa.locator('#sb-layer').selectOption('off');
      check(await qa.locator('.sandbox-legend').isHidden(),name+' hide layer works');
      await qa.locator('#sb-layer').selectOption('weather');
      check(await qa.locator('.sandbox-legend').getAttribute('data-layer')==='weather',name+' weather layer restored after classification and hide');
      check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>2000,name+' weather heat remains available');
      await qa.setViewportSize({width:390,height:844});
      await qa.locator('.sandbox-mobile-toggle').click();
      await qa.locator('#sb-layer').selectOption('lcz');
      check(await table.isVisible(),name+' phone composition table visible');
      check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' phone has no page overflow');
      check(await table.evaluate(n=>n.scrollWidth<=n.clientWidth),name+' phone table fits');
      if(edition)check(!/郑州大学|指导教师|指导老师|闫梓宇/.test(await qa.locator('body').innerText()),name+' identity remains anonymous');
      await qa.screenshot({path:'output/playwright/lcz-workflow-'+name+'-mobile.png'});
      await qa.setViewportSize({width:1440,height:960});
    }
    check(!errors.length,'no uncaught browser errors');
    return {checks,errors};
  }finally{await context.close();}
}
