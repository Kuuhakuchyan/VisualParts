async (page) => {
  if(!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname))throw new Error('Fault injection is local-only');
  const checks=[];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  await page.bringToFront();await page.setViewportSize({width:1440,height:960});
  await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
  let release,started,count=0;
  const blocked=new Promise(r=>release=r),seen=new Promise(r=>started=r),assess='**/api/weather/aic/assess';
  const oldSite=await page.locator('#screen-site').inputValue(),nextSite=oldSite==='campus'?'zhongyuan':'campus';
  await page.route(assess,async route=>{count++;if(count!==1)return route.continue();started();await blocked;await route.fulfill({status:503,json:{detail:'QA obsolete summary failure'}}).catch(()=>{});});
  try{
    await page.locator('#screen-refresh').click();await seen;
    await page.locator('#screen-site').selectOption(nextSite);
    release();await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
    await expect('site change replaces pending refresh instead of sharing old site',()=>count===2);
    await expect('new site controls reflect latest selection',async()=>await page.locator('#screen-site').inputValue()===nextSite);
    await page.evaluate(()=>{window.qaOriginalURL=URL.createObjectURL;URL.createObjectURL=function(blob){window.qaExport=blob.text();return window.qaOriginalURL.call(this,blob);};});
    const pending=page.waitForEvent('download');await page.locator('#screen-export').click();const download=await pending;
    const output=await page.evaluate(async()=>JSON.parse(await window.qaExport));
    const record=output.record||output;
    await expect('cancelled summary cannot contaminate latest exported errors',()=>record.errors.summary===null);
    await expect('new site weather and summary are available together',()=>!!record.observation&&!!record.environment);
    await download.delete();
    await page.evaluate(()=>{URL.createObjectURL=window.qaOriginalURL;delete window.qaOriginalURL;delete window.qaExport;});
  }finally{release();await page.unroute(assess);}
  await page.locator('#screen-site').selectOption('campus');await page.locator('#sb-run').waitFor({state:'attached'});
  await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
  return {url:page.url(),checks,note:'Local-only obsolete-response injection. Export checked in memory, not persisted.'};
}
