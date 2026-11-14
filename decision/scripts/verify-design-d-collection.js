async page=>{
 const origin=new URL(page.url()).origin,local=['127.0.0.1','localhost'].includes(new URL(origin).hostname),base=local?'/':'/decision/';
 const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage(),checks=[],errors=[],missions=[];
 const check=(v,name)=>{if(!v)throw Error(name);checks.push(name);};
 qa.on('pageerror',e=>errors.push(e.message));
 try{
  for(const edition of ['', 'aic/']){
   const label=edition?'competition':'project';
   await qa.goto(origin+base+edition+'#screen');
   await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
   await qa.locator('#dock-tab-sandbox').click();
   await qa.locator('#sb-auto').uncheck();await qa.locator('#sb-collection').click();
   await qa.locator('[data-device="ATOM_LITE_01"]').waitFor();
   check(await qa.locator('#collection-dialog').evaluate(n=>n.open&&n.getBoundingClientRect().width>=700),label+' collection opens full dialog');
   const pending=qa.waitForResponse(r=>r.url().endsWith('/collection/simulate'),{timeout:60000});
   await qa.locator('#collection-generate').click();const response=await pending,data=await response.json();
   check(response.ok(),label+' simulation API succeeds');
   check(data.tracks.length===2&&data.tracks.every(t=>t.status==='ready'&&t.samples.length>20),label+' vehicle and drone have computed routes and samples');
   check(data.tracks.every(t=>t.samples.every((s,i)=>s.seq===i&&s.snapshot_sha256===data.snapshot_sha256)),label+' samples retain grid snapshot and order');
   await qa.waitForFunction(()=>!document.querySelector('#collection-play').disabled);
   await qa.locator('#collection-play').click();await qa.waitForFunction(()=>Number(document.querySelector('#workspace-map').dataset.collectionTime)>1);
   await qa.locator('#collection-play').click();const paused=await qa.locator('#collection-progress').inputValue();await qa.waitForTimeout(250);
   check(await qa.locator('#collection-play').getAttribute('aria-pressed')==='false'&&await qa.locator('#collection-progress').inputValue()===paused,label+' pause clears highlight and freezes time');
   await qa.locator('#collection-reset').click();check(Number(await qa.locator('#collection-progress').inputValue())===0,label+' replay reset returns to start');
   const download=qa.waitForEvent('download');await qa.locator('#collection-export').click();await(await download).saveAs('output/playwright/public-design-d-'+label+'-collection.json');
   check(true,label+' collection evidence exports');
   for(const width of [1440,390,320]){
    await qa.setViewportSize({width,height:844});
    check(await qa.locator('#collection-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth+1&&n.getBoundingClientRect().right<=innerWidth+1&&n.getBoundingClientRect().left>=0),label+' collection fits '+width);
    if(width<400)check(await qa.locator('#collection-close').evaluate(n=>n.getBoundingClientRect().width>=44&&n.getBoundingClientRect().height>=44),label+' touch close fits '+width);
    await qa.screenshot({path:'output/playwright/public-design-d-'+label+'-collection-'+width+'.png'});
   }
   await qa.locator('#collection-close').click();check(await qa.locator('.maplibregl-canvas').count()===1,label+' closing collection retains one map');
   missions.push({edition:label,snapshot_sha256:data.snapshot_sha256,tracks:data.tracks.map(t=>({device_id:t.device_id,samples:t.samples.length,distance_m:t.distance_m}))});
   await qa.setViewportSize({width:1440,height:960});
  }
  check(errors.length===0,'no collection runtime exceptions');return {checks,errors,missions};
 }finally{await context.close();}
}
