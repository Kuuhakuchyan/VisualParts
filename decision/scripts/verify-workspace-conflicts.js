async (page) => {
  if(!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname))throw new Error('Fault injection is local-only');
  const checks=[],errors=[];
  const onError=error=>errors.push(error.message);
  page.on('pageerror',onError);
  try {
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  const tick=()=>page.waitForTimeout(150);
  await page.bringToFront();
  await page.goto(page.url().split('#')[0]+'#screen',{waitUntil:'domcontentloaded'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.setViewportSize({width:1440,height:960});
  await page.locator('#screen-site').selectOption('campus');
  await page.locator('#dock-tab-sandbox').click();await page.locator('[data-operation="add"]').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
  await page.locator('#sb-auto').uncheck();
  const risk='.screen-nav [data-screen-panel="risk"]';
  await page.locator(risk).click();
  if(!await page.locator('#region-duration').isVisible())await page.locator('.regional-parameters > summary').click();
  await page.locator('#region-duration').fill('47');
  await page.evaluate(()=>{window.qaForm=document.querySelector('#regional-form');document.querySelector('.screen-nav [data-screen-panel="risk"]').click();});
  await expect('reopening active panel preserves form instance',()=>page.evaluate(()=>window.qaForm===document.querySelector('#regional-form')));
  await expect('reopening active panel preserves draft',async()=>await page.locator('#region-duration').inputValue()==='47');
  await page.evaluate(()=>{document.querySelector('#screen-panel-close').click();document.querySelector('.screen-nav [data-screen-panel="risk"]').click();});
  if(!await page.locator('#region-duration').isVisible())await page.locator('.regional-parameters > summary').click();
  await tick();
  await expect('queued close cannot erase reopened panel',async()=>await page.locator('#screen-drawer').getAttribute('open')!==null&&await page.locator('#regional-form').count()===1);
  await expect('close and reopen retains draft',async()=>await page.locator('#region-duration').inputValue()==='47');
  await page.evaluate(()=>{window.qaInvalidations=0;window.qaCount=()=>window.qaInvalidations++;window.addEventListener('workspace:layout-report',window.qaCount);});
  await page.locator('[name="regional-group"][value="athletes"]').uncheck();
  await expect('one checkbox action causes one layout invalidation',()=>page.evaluate(()=>window.qaInvalidations===1));
  await page.locator('.cohort-scenario-editor > summary').click();
  if(await page.locator('[data-cohort-override="workers"]').isChecked()){
    await page.locator('[data-cohort-override="workers"]').uncheck();
    await page.evaluate(()=>window.qaInvalidations=1);
  }
  await page.locator('[data-cohort-override="workers"]').check();
  await expect('input and change are semantically deduplicated',()=>page.evaluate(()=>window.qaInvalidations===2));
  await expect('cohort override still enables correct controls',async()=>!await page.locator('#cohort-duration-workers').isDisabled());
  await page.evaluate(()=>{window.removeEventListener('workspace:layout-report',window.qaCount);delete window.qaForm;});

  let release,started,count=0;
  const block=new Promise(r=>release=r),seen=new Promise(r=>started=r);
  const regional='**/api/weather/aic/regional-assess';
  await page.route(regional,async route=>{count++;started();await block;await route.fulfill({status:503,json:{detail:'QA regional unavailable'}}).catch(()=>{});});
  try{
    await page.locator('#regional-submit').click();await seen;
    await page.evaluate(()=>{document.querySelector('#bound-west').dispatchEvent(new Event('change',{bubbles:true}));const f=document.querySelector('#regional-form');f.requestSubmit();f.requestSubmit();});
    await tick();
    await expect('duplicate regional submit sends one request',()=>count===1);
    await expect('unchanged blur does not cancel assessment',()=>page.locator('#regional-submit').isDisabled());
    await page.locator('#region-duration').fill('48');
    await expect('actual input change cancels and unlocks old assessment',async()=>!await page.locator('#regional-submit').isDisabled());
    release();await tick();
    await expect('cancelled assessment cannot expose stale error',async()=>!await page.locator('#regional-error').isVisible());
  }finally{release();await page.unroute(regional);}
  await page.locator('#screen-panel-close').click();await page.locator('#screen-drawer').waitFor({state:'hidden'});

  await page.waitForFunction(()=>!document.querySelector('#sb-status').textContent.includes('正在读取'));
  count=0;
  const heat='**/api/weather/sandbox/heatmap',heatBlock=new Promise(r=>release=r),heatSeen=new Promise(r=>started=r);
  await page.route(heat,async route=>{count++;started();await heatBlock;await route.fulfill({status:503,json:{detail:'QA heat unavailable'}}).catch(()=>{});});
  try{
    await page.locator('#sb-refresh').click();await heatSeen;
    await page.evaluate(()=>{document.querySelector('#sb-refresh').click();document.querySelector('#sb-refresh').click();});await tick();
    await expect('concurrent heat refresh shares one request',()=>count===1);
  }finally{release();await tick();await page.unroute(heat);}

  count=0;
  const save='**/api/weather/sandbox/scenes',saveBlock=new Promise(r=>release=r),saveSeen=new Promise(r=>started=r);
  await page.route(save,async route=>{if(route.request().method()!=='POST')return route.continue();count++;started();await saveBlock;await route.fulfill({status:503,json:{detail:'QA save unavailable'}}).catch(()=>{});});
  try{
    await page.locator('#sb-save').click();await saveSeen;
    await page.evaluate(()=>{document.querySelector('#sb-save').click();document.querySelector('#sb-save').click();});await tick();
    await expect('rapid save sends one POST',()=>count===1);
    await expect('save button remains locked while pending',()=>page.locator('#sb-save').isDisabled());
    await page.evaluate(()=>location.hash='overview');await page.locator('.overview-grid, .metric-grid').first().waitFor().catch(()=>{});
    release();await tick();
    await expect('late save failure cannot leak into new view',async()=>!await page.locator('#toast').isVisible());
  }finally{release();await page.unroute(save);}
  await page.evaluate(()=>location.hash='screen');await page.locator('#dock-tab-sandbox').click();await page.locator('#sb-reset').waitFor();
  await page.evaluate(()=>{document.querySelector('#sb-reset').click();document.querySelector('#sb-reset').click();});
  await expect('duplicate destructive action opens one confirmation',async()=>await page.locator('#sb-confirm-dialog[open]').count()===1);
  await page.locator('#sb-confirm-dialog [value="cancel"]').click();await tick();
  await expect('cancelled reset changes no geometry',async()=>(await page.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'));
  await page.locator('#sb-reset').click();
  await page.locator('#sb-confirm-dialog [value="confirm"]').click();await tick();
  await expect('empty reset does not add redundant undo history',()=>page.locator('#sb-undo').isDisabled());

  await page.evaluate(()=>{window.qaMap=document.querySelector('#workspace-map');document.querySelector('#site-select').dispatchEvent(new Event('change'));window.dispatchEvent(new HashChangeEvent('hashchange'));});await tick();
  await expect('unchanged site and route do not rebuild map',()=>page.evaluate(()=>window.qaMap===document.querySelector('#workspace-map')));
  await page.evaluate(()=>{delete window.qaMap;});
  await page.locator('#sb-run').click();
  await page.waitForFunction(()=>document.querySelector('#sb-run').disabled);
  await page.locator('#sb-data-mode').selectOption('live');
  await expect('changing simulation input releases obsolete run lock',async()=>!await page.locator('#sb-run').isDisabled());
  await tick();
  await expect('cancelled simulation produces no stale error',async()=>!await page.locator('#sb-error').isVisible());
  await expect('no uncaught page errors',()=>errors.length===0);
  page.off('pageerror',onError);
  return {url:page.url(),checks,errors,note:'Local-only failure injection; injected results are never saved or used as production evidence.'};
  } catch(error) {
    const state=await page.evaluate(()=>({status:document.querySelector('#sb-status')?.textContent,error:document.querySelector('#sb-error')?.textContent,disabled:document.querySelector('#sb-run')?.disabled,scene:document.querySelector('#sb-count')?.textContent}));
    throw new Error(JSON.stringify({message:error.message,passed:checks,state}));
  } finally { page.off('pageerror',onError); }
}
