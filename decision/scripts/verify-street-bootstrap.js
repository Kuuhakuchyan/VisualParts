async page => {
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname),checks=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  for(const edition of ['project','competition']){
    const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),q=await context.newPage(),errors=[];
    await context.route('https://tiles.openfreemap.org/**',route=>route.abort('failed'));
    q.on('pageerror',err=>errors.push(err.message));
    const url=local?origin+(edition==='competition'?'/aic/':'/'):edition==='competition'?'https://aic.nogamenolife.cn/aic/':'https://weather.nogamenolife.cn/decision/';
    try{
      await q.goto(url+'?capture=1#screen',{waitUntil:'domcontentloaded'});
      await q.locator('#workspace-map[data-buildings="225"][data-street-roads="120"]').waitFor({timeout:65000});
      await q.locator('#sb-run').waitFor({state:'attached',timeout:65000});
      check(true,edition+' local campus geometry loads with all external basemap requests failing');
      await q.locator('#screen-site').selectOption('zhongyuan');
      await q.locator('#workspace-map[data-buildings="751"][data-street-roads="139"][data-landcover="177"]').waitFor({timeout:65000});
      await q.locator('#sb-run').waitFor({state:'attached',timeout:65000});
      check(await q.locator('#workspace-map').getAttribute('data-model')==='three',edition+' district Three.js model loads without external metadata or sprites');
      await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-auto').uncheck();
      check(!await q.locator('#sb-run').isDisabled(),edition+' district editor remains usable during external basemap outage');
      await q.screenshot({path:`output/playwright/street-outage-${local?'local':'public'}-${edition}.png`});
      check(!errors.length,edition+' no JavaScript failure during basemap outage');
    }finally{await context.close();}
  }
  return {checks};
}
