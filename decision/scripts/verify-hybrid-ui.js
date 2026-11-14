async (page) => {
  const checks=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const ok=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  await page.setViewportSize({width:1440,height:960});
  await page.waitForSelector('#sb-run');
  await page.locator('#sb-auto').uncheck();
  const response=page.waitForResponse(r=>r.url().endsWith('/sandbox/collaborate'),{timeout:115000});
  await page.locator('#sb-run').click();
  const r=await response;ok(r.ok(),'manual run uses collaborative endpoint');
  const result=await r.json();
  await page.evaluate(value=>{window.qaHybridResult=value;},result);
  await page.waitForFunction(()=>document.querySelector('#workspace-map')?.dataset.resultSha256,
    null,{timeout:115000});
  ok(await page.locator('#workspace-map').getAttribute('data-result-sha256')===result.report_sha256,'rendered grid matches collaborative report digest');
  ok(result.orchestration.mode==='deepseek_tools_local_models','actual cloud tool roundtrip is visible in result ('+JSON.stringify(result.orchestration.planner)+')');
  ok((await page.locator('#sb-status').textContent()).includes('DeepSeek工具调用'),'status identifies cloud and local computation');
  await page.locator('#sb-report').click();
  await page.waitForSelector('#sb-report-dialog[open]');
  ok((await page.locator('.sandbox-workflow').textContent()).includes('recompute_current_scene'),'report shows actual tool name');
  ok((await page.locator('.sandbox-workflow').textContent()).includes(result.orchestration.numerical_sha256),'report shows exact numerical digest');
  ok((await page.locator('.sandbox-workflow').textContent()).includes('未提供可用连续站点序列'),'missing station window is explicit');
  ok(await page.locator('.ai-decision-analysis').count()===1,'report renders substantive AI decision panel');
  ok(result.regional_report.decision_analysis.mode==='ai_grounded_decision','report analysis is actually model generated');
  ok(await page.locator('.ai-cohort-decisions>section').count()===result.regional_report.cohorts.length,'each target group has an AI judgement');
  ok((await page.locator('.ai-building-decision').textContent()).includes('AI 建筑方案建议'),'AI building verdict is displayed');
  ok((await page.locator('.ai-intensity').textContent()).includes('环境热强度'),'environmental intensity is separate from attention priority');
  const edition=page.url().includes('/aic/')?'aic':'standard';
  await page.screenshot({path:'output/playwright/decision-'+edition+'-desktop.png'});
  await page.locator('#sb-report-close').click();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px screen fits');
    if(!await page.locator('#sb-report').isVisible())await page.locator('.sandbox-mobile-toggle').click();
    await page.locator('#sb-report').click();
    await page.waitForSelector('#sb-report-dialog[open]');
    ok(await page.locator('#sb-report-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),width+'px report fits');
    const bounds=await page.locator('.ai-decision-analysis').boundingBox();
    ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,width+'px AI analysis stays within viewport');
    if(width===390)await page.screenshot({path:'output/playwright/decision-'+edition+'-report-mobile.png'});
    await page.locator('#sb-report-close').click();
  }
  await page.screenshot({path:'output/playwright/decision-'+edition+'-mobile.png'});
  ok(errors.length===0,'no page runtime errors');
  return{checks,errors,workflow:result.orchestration.mode,scene_sha256:result.scene_sha256,result_sha256:result.report_sha256};
}
