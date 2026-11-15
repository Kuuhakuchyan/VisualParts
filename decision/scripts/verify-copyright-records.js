async page => {
  const origin=new URL(page.url()).origin;
  if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Isolated fixture only');
  const context=await page.context().browser().newContext({viewport:{width:1440,height:1000}});
  const q=await context.newPage(),checks=[],images=[],errors=[];
  const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  const capture=async(file,title)=>{await q.screenshot({path:'output/playwright/copyright-v1/'+file});images.push({file,title,url:q.url(),viewport:q.viewportSize(),role:'synthetic-record-acceptance'});};
  const pending=(suffix,method)=>q.waitForResponse(r=>r.url().includes(suffix)&&r.request().method()===method,{timeout:70000});
  q.on('pageerror',e=>errors.push(e.message));
  try{
    await q.goto(origin+'/decision/#plans');
    await q.locator('#new-plan').click();
    const name='模拟遮阴方案 <img src=x onerror=alert(1)>';
    await q.locator('#plan-form [name=name]').fill(name);
    const saved=pending('/plans','POST');await q.locator('#save-plan').click();
    const savedResponse=await saved,record=await savedResponse.json();
    check(savedResponse.ok(),'plan save succeeds');
    const row=()=>q.locator('.plan-row').filter({hasText:name});
    await row().waitFor();
    check(await row().locator('img').count()===0,'markup in plan name is rendered as literal text');
    await q.reload();await row().waitFor();
    check(await row().count()===1,'plan survives reload with same workspace credential');
    await row().locator('[data-select-plan]').check();
    check((await q.locator('#comparison').textContent()).includes(name),'saved plan participates in comparison');
    await capture('19-plan-readback.png','干预方案：保存、回读与比较');
    const downloaded=q.waitForEvent('download');await row().locator('[data-export-plan]').click();
    await(await downloaded).saveAs('output/playwright/copyright-plan-export.json');
    check(true,'saved plan exports through UI');
    await row().locator('[data-delete-plan]').click();
    await q.locator('#delete-dialog [value=cancel]').click();
    check(await row().count()===1,'cancel preserves saved plan');
    await row().locator('[data-delete-plan]').click();
    const removed=pending('/plans/'+record.id,'DELETE');await q.locator('#delete-dialog [value=confirm]').click();
    check((await removed).ok(),'confirmed plan delete succeeds');await row().waitFor({state:'detached'});
    await q.reload();check(await row().count()===0,'deleted plan does not return after reload');

    await q.goto(origin+'/decision/#screen');await q.locator('#dock-tab-sandbox').click();
    await q.locator('#sb-auto').uncheck();
    const sceneName='模拟归档情景';await q.locator('#sb-name').fill(sceneName);await q.locator('#sb-name').press('Tab');
    const scenePending=pending('/sandbox/scenes','POST');await q.locator('#sb-save').click();
    const sceneResponse=await scenePending,scene=await sceneResponse.json();
    check(sceneResponse.ok(),'scene save succeeds');
    await q.locator('.sandbox-library > summary').click();
    const sceneButton=()=>q.locator('[data-load-scene]').filter({hasText:sceneName});
    await sceneButton().waitFor();
    await q.reload();await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-auto').uncheck();
    await q.locator('.sandbox-library > summary').click();await sceneButton().click();
    await q.waitForFunction(name=>document.querySelector('#sb-name')?.value===name,sceneName);
    check(await q.locator('#sb-name').inputValue()===sceneName,'scene reload restores saved name');
    const deleteScene=()=>q.locator('[data-delete-scene="'+scene.id+'"]');
    await capture('20-scene-library.png','建筑情景：保存与回读');
    await deleteScene().click();await q.locator('#sb-confirm-dialog [value=cancel]').click();
    check(await deleteScene().count()===1,'cancel preserves scene');
    await deleteScene().click();const sceneDelete=pending('/sandbox/scenes/'+scene.id,'DELETE');
    await q.locator('#sb-confirm-dialog [value=confirm]').click();check((await sceneDelete).ok(),'confirmed scene delete succeeds');
    await deleteScene().waitFor({state:'detached'});
    check(await q.locator('#sb-name').inputValue()===sceneName,'deleting saved scene preserves current editing copy');

    await q.goto(origin+'/decision/#risk');await q.locator('#region-mode').selectOption('history');
    await q.locator('#region-grid-resolution').selectOption('100');await q.locator('#region-ai').uncheck();
    const groups=['students','athletes','workers','older_adults'];
    for(const checkbox of await q.locator('[name=regional-group]').all())await checkbox.uncheck();
    for(const id of groups)await q.locator('[name=regional-group][value='+id+']').check();
    await q.locator('.cohort-scenario-editor > summary').click();
    for(const [i,id] of groups.entries()){
      await q.locator('[data-cohort-override='+id+']').check();
      await q.locator('#cohort-activity-'+id).selectOption(['walk','run','work','rest'][i]);
      await q.locator('#cohort-duration-'+id).fill(String([30,60,120,20][i]));
    }
    const regionalPending=pending('/regional-assess','POST');await q.locator('#regional-submit').click();
    const response=await regionalPending,report=await response.json();check(response.ok(),'four-cohort historical regional assessment succeeds');
    await q.locator('.cohort-overview').waitFor();check(report.cohorts.length===4,'response contains exactly selected four cohorts');
    for(const [i,id] of groups.entries()){
      const cohort=report.cohorts.find(c=>c.id===id);
      check(cohort.context.activity===['walk','run','work','rest'][i]&&cohort.context.minutes===[30,60,120,20][i],'independent activity and duration retained: '+id);
      await q.locator('[data-cohort='+id+']').click();
      check(await q.locator('.regional-cohorts article:visible').count()===1,'one selected cohort is visible: '+id);
    }
    check((await q.locator('#regional-result').textContent()).includes(report.report_sha256),'regional UI matches returned report digest');
    await capture('21-regional-four-cohorts.png','区域研判：四类人群与独立活动情景');
    const exportReport=q.waitForEvent('download');await q.locator('#regional-export').click();
    await(await exportReport).saveAs('output/playwright/copyright-regional-export.json');
    await q.setViewportSize({width:390,height:844});
    check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'populated regional result fits phone');
    await capture('22-regional-mobile.png','手机端：区域人群研判结果');
    check(!errors.length,'record workflows have no page exceptions');
    return {passed:checks.length,checks,images,errors,browser:page.context().browser().version()};
  }catch(error){await capture('records-failure.png','业务验收失败现场');throw Error(JSON.stringify({message:error.message,checks,errors}));}
  finally{await context.close();}
}
