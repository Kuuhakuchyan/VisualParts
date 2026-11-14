async page => {
  const origin=new URL(page.url()).origin;
  const base=['127.0.0.1','localhost'].includes(new URL(origin).hostname)?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const q=await context.newPage(),checks=[],errors=[];
  q.on('pageerror',error=>errors.push(error.message));
  const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  try{
    for(const edition of ['', 'aic/']){
      const label=edition?'competition':'project';
      await q.goto(origin+base+edition+'#risk');
      await q.locator('#region-mode').selectOption('history');
      await q.locator('#region-grid-resolution').selectOption('100');
      await q.locator('#region-ai').uncheck();
      for(const group of ['students','athletes','workers','older_adults'])await q.locator('[name=regional-group][value='+group+']').check();
      const pending=q.waitForResponse(r=>r.url().includes('/aic/regional-assess')&&r.request().method()==='POST',{timeout:70000});
      await q.locator('#regional-submit').click();
      const response=await pending,report=await response.json();
      check(response.ok(),label+' actual regional endpoint succeeds');
      await q.locator('.cohort-overview').waitFor();
      check(report.case_type==='historical_reanalysis'||report.baseline?.source_type==='historical_weather',label+' historical case retained');
      check(await q.locator('.cohort-overview button').count()===report.cohorts.length,label+' cohort overview matches response');
      check(await q.locator('.regional-result-banner').evaluate(n=>!!n.nextElementSibling?.querySelector('.cohort-overview')),label+' cohort comparison immediately follows environment summary');
      check(!await q.locator('.regional-parameters').getAttribute('open'),label+' result collapses settings');
      for(const cohort of report.cohorts){
        await q.locator('[data-cohort='+cohort.id+']').click();
        const visible=q.locator('.regional-cohorts article:visible');
        check(await visible.count()===1,label+' one cohort visible '+cohort.id);
        check((await visible.innerText()).includes(cohort.label),label+' correct result '+cohort.id);
      }
      check((await q.locator('#regional-result').textContent()).includes(report.report_sha256),label+' UI includes current report digest');
      check(await q.locator('#regional-evidence-aside a').count()>=report.sources.length,label+' sources available');
      const download=q.waitForEvent('download');await q.locator('#regional-export').click();
      await(await download).saveAs('output/playwright/d-regional-'+label+'-report.json');
      check(true,label+' result export available');
      await q.evaluate(()=>scrollTo(0,0));await q.screenshot({path:'output/playwright/d-regional-'+label+'-result-1440.png'});
      await q.setViewportSize({width:390,height:844});
      await q.waitForTimeout(400);await q.evaluate(()=>scrollTo(0,0));
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' populated result fits mobile');
      await q.screenshot({path:'output/playwright/d-regional-'+label+'-result-390.png'});
      await q.setViewportSize({width:1440,height:960});
      await q.locator('.regional-parameters > summary').click();await q.locator('#region-duration').fill('45');
      check(await q.locator('.cohort-overview').count()===0,label+' changed input invalidates previous report');
      check(await q.locator('#regional-export').isDisabled(),label+' stale report cannot export');
    }
    check(!errors.length,'no regional runtime exceptions');return {checks,errors};
  }finally{await context.close();}
}
