async (page) => {
  if(!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname))throw new Error('Fault injection is local-only');
  const checks=[],errors=[];
  const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  await page.bringToFront();await page.setViewportSize({width:1440,height:960});
  await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
  let count=0,release,started;
  const block=new Promise(r=>release=r),seen=new Promise(r=>started=r),weather='**/api/weather/aic/observations/current?site=*';
  await page.route(weather,async route=>{count++;started();await block;await route.fulfill({status:503,json:{detail:'QA weather unavailable'}}).catch(()=>{});});
  try{
    await page.locator('#screen-refresh').click();await seen;
    await page.evaluate(()=>{for(let i=0;i<3;i++)document.querySelector('#refresh-all').dispatchEvent(new Event('click'));});
    await page.waitForTimeout(150);
    await expect('screen and global refresh share one weather request',()=>count===1);
    release();await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
    await page.waitForFunction(()=>!document.querySelector('#screen-refresh').disabled,null,{timeout:60000});
    await expect('failed refresh unlocks both entrypoints',async()=>!await page.locator('#screen-refresh').isDisabled());
  }finally{release();await page.unroute(weather);}
  await page.locator('#screen-refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);

  const base=new URL(page.url()).origin;
  const context=await page.context().browser().newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const personal=await context.newPage();personal.on('pageerror',onError);
  try{
    await personal.goto(base+'/aic/assessment.html?embed=1&site=campus&edition=competition');
    await personal.locator('#raw-download:not([disabled])').waitFor();
    await personal.locator('[name="symptom"][value="confusion"]').check();
    await expect('dangerous symptom shows urgent banner immediately',()=>personal.locator('#emergency-banner').isVisible());
    await personal.locator('[name="symptom"][value="confusion"]').uncheck();
    await expect('clearing symptom updates banner on same action',async()=>!await personal.locator('#emergency-banner').isVisible());
    let calls=0,releaseAssessment,seenAssessment;
    const pending=new Promise(r=>releaseAssessment=r),began=new Promise(r=>seenAssessment=r),assess='**/api/weather/aic/assess';
    await personal.route(assess,async route=>{calls++;seenAssessment();await pending;await route.fulfill({status:503,json:{detail:'QA personal unavailable'}}).catch(()=>{});});
    try{
      await personal.locator('#assess-button').click();await began;
      await personal.evaluate(()=>{const f=document.querySelector('#assessment-form');f.requestSubmit();f.requestSubmit();document.querySelector('#duration').dispatchEvent(new Event('change',{bubbles:true}));});
      await expect('personal duplicate submission sends one request',()=>calls===1);
      await expect('personal unchanged blur retains pending state',()=>personal.locator('#assess-button').isDisabled());
      await personal.locator('#activity').selectOption('run');
      await expect('changing unnamed activity field invalidates pending result',async()=>!await personal.locator('#assess-button').isDisabled());
      releaseAssessment();await personal.waitForTimeout(150);
      await expect('old personal response cannot overwrite new input',async()=>!await personal.locator('#form-error').isVisible()&&!await personal.locator('#report').isVisible());
    }finally{releaseAssessment();await personal.unroute(assess);}
    await personal.locator('#duration').fill('42');
    await expect('mobile personal page has no horizontal overflow',()=>personal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }finally{await context.close();}
  await expect('no uncaught page errors',()=>errors.length===0);page.off('pageerror',onError);
  return {url:page.url(),checks,errors,note:'Local failure injection only; no fabricated diagnostic data persisted.'};
}
