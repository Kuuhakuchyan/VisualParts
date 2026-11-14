async page => {
  const local = ['127.0.0.1','localhost'].includes(new URL(page.url()).hostname);
  const origin = new URL(page.url()).origin;
  const urls = local ? [origin+'/home.html',origin+'/aic/home.html'] : ['https://weather.nogamenolife.cn/','https://aic.nogamenolife.cn/aic/home.html'];
  const checks=[], errors=[], samples=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  for(const [index,url] of urls.entries()){
    const context=await page.context().browser().newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
    const q=await context.newPage();q.on('pageerror',err=>errors.push(err.message));
    const label=index?'competition':'project';
    try{
      await q.goto(url,{waitUntil:'domcontentloaded'});
      await q.waitForFunction(()=>!!document.documentElement.dataset.motion);
      check(await q.locator('#motionEnabled').isEnabled(),label+' reduced-motion does not lock manual toggle');
      check(await q.evaluate(()=>document.documentElement.dataset.motion==='off'),label+' system reduced-motion remains respected by default');
      await q.locator('#motionEnabled').check();
      check(await q.evaluate(()=>document.documentElement.dataset.motion==='on'&&document.documentElement.dataset.motionSource==='user'),label+' manual choice overrides system');
      check(await q.evaluate(()=>getComputedStyle(document.getElementById('intro')).display!=='none'&&!document.getElementById('intro').classList.contains('done')),label+' intro can replay while system is reduced');
      check(await q.evaluate(()=>document.getElementById('intro').getAnimations({subtree:true}).some(a=>a.playState==='running')),label+' intro CSS animation is running');
      await q.waitForFunction(()=>document.documentElement.classList.contains('intro-complete'),null,{timeout:6000});
      await q.waitForFunction(()=>document.querySelector('.hero-scene')?.dataset.rendered==='true',null,{timeout:65000});
      await q.waitForTimeout(400);
      const scene=await q.locator('.hero-scene').boundingBox();
      const before=await q.locator('.hero-scene canvas').screenshot();
      await q.mouse.move(scene.x+scene.width*.85,scene.y+scene.height*.45);await q.waitForTimeout(350);
      const after=await q.locator('.hero-scene canvas').screenshot();
      check(!before.equals(after),label+' actual WebGL scene moves under manual preference');
      check(await q.evaluate(()=>document.documentElement.dataset.pageMode==='chapters'),label+' chapter paging enabled under manual preference');
      await q.mouse.move(500,450);await q.mouse.wheel(0,850);await q.waitForTimeout(1000);
      check(await q.evaluate(()=>scrollY>100),label+' physical wheel advances page');
      await q.keyboard.press('PageUp');await q.waitForTimeout(1000);
      await q.locator('#motionEnabled').uncheck();
      check(await q.evaluate(()=>document.documentElement.dataset.pageMode==='natural'&&document.documentElement.dataset.motion==='off'),label+' explicit off disables paging');
      await q.reload({waitUntil:'domcontentloaded'});
      check(!await q.locator('#motionEnabled').isChecked(),label+' off persists on reload');
      await q.emulateMedia({reducedMotion:'no-preference'});
      check(await q.evaluate(()=>document.documentElement.dataset.motion==='off'),label+' OS change preserves explicit off');
      await q.locator('#motionEnabled').check();
      await q.reload({waitUntil:'domcontentloaded'});
      await q.waitForFunction(()=>document.documentElement.classList.contains('intro-complete'),null,{timeout:6000});
      check(await q.locator('#motionEnabled').isChecked(),label+' explicit on persists on reload');
      await q.setViewportSize({width:390,height:844});await q.waitForTimeout(400);
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.dataset.pageMode==='natural'),label+' mobile retains natural scrolling without overflow');
      await q.screenshot({path:`output/playwright/edge-motion-${local?'local':'public'}-${label}.png`});
      samples.push({label,url,userAgent:await q.evaluate(()=>navigator.userAgent)});
    }finally{await context.close();}
  }
  check(errors.length===0,'no page JavaScript errors');
  return {checks,samples,errors};
}
