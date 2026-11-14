async page => {
  const origin=new URL(page.url()).origin,base=['localhost','127.0.0.1'].includes(new URL(origin).hostname)?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage();
  const checks=[],errors=[],results=[];
  const check=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  qa.on('pageerror',e=>errors.push(e.message));
  try{
    for(const edition of ['', 'aic/']){
      const label=edition?'competition':'project';
      await qa.goto(origin+base+edition+'#screen',{waitUntil:'domcontentloaded'});
      await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
      await qa.locator('#sb-auto').uncheck();
      const pending=qa.waitForResponse(r=>r.url().endsWith('/sandbox/collaborate')&&r.request().method()==='POST',{timeout:120000});
      await qa.locator('#sb-run').click();const response=await pending;
      check(response.ok(),label+' actual collaboration request succeeds');
      const result=await response.json();
      await qa.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,result.report_sha256,{timeout:120000});
      check(result.solar.altitude_deg<=0,label+' uses actual current night boundary');
      const assessment=result.thermal_assessment,report=result.regional_report;
      check(assessment.mode==='night_weather_estimate'&&assessment.status==='estimated',label+' current night risk estimated');
      check(assessment.shortwave_included===false&&assessment.building_delta_evaluated===false,label+' no solar gain or fabricated building increment');
      check(assessment.utci_c===result.summary.proposed_utci_c,label+' night estimate equals numerical output');
      check(JSON.stringify(report.layout_exposure.thermal_assessment)===JSON.stringify(assessment),label+' linked report retains identical estimate basis');
      check(JSON.stringify(report.decision_analysis.risk_intensity.assessment_basis)===JSON.stringify(assessment),label+' AI decision uses identical estimate basis');
      const headline=await qa.locator('#sb-summary .sandbox-results > strong').textContent();
      check(headline===assessment.utci_c.toFixed(1)+' °C',label+' nonzero night UTCI shown as primary result');
      check((await qa.locator('#sb-summary').innerText()).includes('夜间气象估测'),label+' summary identifies estimate');
      check(await qa.locator('.sandbox-legend').getAttribute('data-total-cells')==='2610',label+' fine weather grid retained');
      check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>100,label+' heatmap remains visible');
      await qa.locator('#sb-summary').scrollIntoViewIfNeeded();
      await qa.screenshot({path:'output/playwright/night-estimate-'+label+'-desktop.png'});
      await qa.locator('#sb-report').click();
      check((await qa.locator('#sb-report-content .ai-intensity').innerText()).includes('夜间气象估测'),label+' report labels AI risk basis as night weather');
      check((await qa.locator('#sb-report-content').innerText()).includes('不设置夜间固定降级系数'),label+' report explicitly excludes blanket night discount');
      check((await qa.locator('#sb-report-content').textContent()).includes(result.report_sha256),label+' report and map use same digest');
      await qa.locator('#sb-report-close').click();
      await qa.setViewportSize({width:390,height:844});
      await qa.locator('.sandbox-mobile-toggle').click();
      await qa.locator('#sb-summary').scrollIntoViewIfNeeded();
      check(await qa.locator('#sb-summary .sandbox-results > strong').isVisible(),label+' night estimate visible on phone');
      check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' phone no horizontal overflow');
      await qa.screenshot({path:'output/playwright/night-estimate-'+label+'-mobile.png'});
      await qa.setViewportSize({width:1440,height:960});
      results.push({edition:label,assessment,weather_time:result.weather_boundary.observed_at,
        generation:report.generation,decision_mode:report.decision_analysis.mode,result_sha256:result.report_sha256});
    }
    check(errors.length===0,'no runtime browser errors');
    return {checks,errors,results};
  }catch(error){
    await qa.screenshot({path:'output/playwright/night-estimate-failure.png'}).catch(()=>{});
    throw new Error(error.message+'; '+JSON.stringify({checks,errors,status:await qa.locator('#sb-status').textContent().catch(()=>''),error:await qa.locator('#sb-error').textContent().catch(()=>'' )}));
  }finally{await context.close();}
}
