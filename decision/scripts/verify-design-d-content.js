async page=>{
 const origin=new URL(page.url()).origin,local=['127.0.0.1','localhost'].includes(new URL(origin).hostname);
 const base=local?'/':'/decision/',checks=[],errors=[],failures=[];
 const context=await page.context().browser().newContext({viewport:{width:1440,height:960},reducedMotion:'no-preference'}),qa=await context.newPage();
 qa.on('pageerror',error=>errors.push(error.message));
 qa.on('response',response=>{if(response.status()>=400&&new URL(response.url()).origin===origin)failures.push({url:response.url(),status:response.status()});});
 const check=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
 const fits=async()=>{await qa.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);};
 const save=async(name,data)=>{const download=qa.waitForEvent('download');await qa.evaluate(({name,data})=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},{name,data});await(await download).saveAs('output/playwright/'+name);};
 try{
  for(const competition of [false,true]){
   const edition=competition?'competition':'project',home=competition?base+'aic/home.html':local?'/home.html':'/';
   await qa.setViewportSize({width:1440,height:960});await qa.goto(origin+home);
   check(await qa.locator('#intro').isVisible(),edition+' entry loader visible');
   const names=await qa.locator('#intro').evaluate(n=>n.getAnimations({subtree:true}).map(a=>a.animationName));
   check(['assemble','observation'].every(n=>names.includes(n)),edition+' resource loader has assembly and observation motion');
   await qa.locator('#introSkip').click();await qa.locator('#intro').waitFor({state:'hidden'});
   await qa.locator('.hero-scene[data-rendered=true]').waitFor({timeout:20000});await qa.evaluate(async()=>{await document.fonts.ready;await Promise.all([document.fonts.load('400 16px "WJTJ Sans"'),document.fonts.load('400 32px "WJTJ Numeric"')]);});
   check(await qa.evaluate(()=>document.fonts.check('400 16px "WJTJ Sans"')&&document.fonts.check('400 32px "WJTJ Numeric"')),edition+' licensed UI fonts loaded');
   const hotspot=await qa.locator('.hero-hotspot').evaluate(n=>{const r=n.getBoundingClientRect(),l=n.querySelector('span').getBoundingClientRect();return {value:Number(n.dataset.value),x:r.left+r.width/2,y:r.top+r.height/2,l:l.left,bottom:l.bottom};});
   check(hotspot.value>=.65&&hotspot.l<hotspot.x&&hotspot.bottom<hotspot.y,edition+' label remains above-left of an actual hot cell');
   await qa.mouse.move(320,300);await qa.waitForTimeout(500);const before=await qa.locator('.hero-scene canvas').screenshot();
   await qa.mouse.move(1100,420);await qa.waitForTimeout(500);const after=await qa.locator('.hero-scene canvas').screenshot();
   check(!before.equals(after),edition+' pointer interaction changes real scene pixels');
   await qa.mouse.wheel(0,500);await qa.waitForTimeout(850);
   check(await qa.locator('#platform').evaluate(n=>Math.abs(n.getBoundingClientRect().top-document.querySelector('.topbar').offsetHeight)<3),edition+' real wheel advances to next chapter');
   await qa.mouse.wheel(0,-500);await qa.waitForTimeout(850);
   check(await qa.locator('.hero h1').evaluate(n=>getComputedStyle(n).opacity==='1'),edition+' hero reappears on return');
   for(const [width,height]of [[1600,900],[1280,720],[390,844],[320,640]]){
    await qa.setViewportSize({width,height});await fits();await qa.waitForTimeout(200);
    const strip=await qa.locator('.strip').boundingBox();check(strip.y<height,edition+' next section visible at '+width+'x'+height);
    await qa.screenshot({path:'output/playwright/design-d-'+edition+'-home-'+width+'.png'});
   }
   if(competition)check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await qa.content()),'competition homepage anonymous');
   await qa.setViewportSize({width:1440,height:960});await qa.locator('#motionEnabled').uncheck();
   check(await qa.locator('html').getAttribute('data-motion')==='off',edition+' motion toggle disables animation');
   await qa.emulateMedia({reducedMotion:'reduce'});await qa.goto(origin+home);check(!await qa.locator('#intro').isVisible(),edition+' reduced motion avoids loader');
   await qa.emulateMedia({reducedMotion:'no-preference'});await qa.evaluate(()=>localStorage.removeItem('wjtj-home-motion'));
  }
  for(const competition of [false,true]){
   const edition=competition?'competition':'project',blog=competition?base+'aic/journal.html':'/author/project/';
   await qa.setViewportSize({width:1440,height:960});await qa.goto(origin+blog);await qa.locator('.journal-entry').first().waitFor();
   check(await qa.locator('.journal-entry').count()===3,edition+' blog shows actual three entries');
   const covers=await qa.locator('.journal-entry img').evaluateAll(async images=>{await Promise.all(images.map(img=>img.decode()));return images.map(img=>img.src);});
   check(new Set(covers).size===3,edition+' covers are distinct and decoded');
   await qa.locator('button[data-topic]').nth(1).click();check(await qa.locator('.journal-entry:visible').count()===1,edition+' category filter works');
   await qa.locator('button[data-topic=all]').click();await qa.locator('#journal-search').fill('<img src=x onerror=alert(1)>');
   check(await qa.locator('.journal-entry:visible').count()===0&&await qa.locator('#journal-empty').isVisible(),edition+' search safely handles markup and empty state');
   await qa.locator('#journal-search').fill('');check(await qa.locator('.journal-entry:visible').count()===3,edition+' clearing search restores entries');
   await qa.locator('.journal-entry h2 a').first().click();await qa.locator(competition?'.journal-reading:visible':'.journal-article').waitFor();
   check((await qa.locator(competition?'.journal-reading:visible':'.journal-prose').innerText()).length>100,edition+' article navigation reads actual content');
   if(competition)check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await qa.content()),'competition blog anonymous');
   for(const width of [1440,390,320]){await qa.setViewportSize({width,height:960});await fits();checks.push(edition+' blog reading fits '+width);}
  }
  check(errors.length===0,'no uncaught content exceptions');check(failures.length===0,'all same-origin resources succeed');
  await save((local?'local':'public')+'-design-d-content.json',{checks,errors,failures});return {checks,errors,failures};
 }catch(error){await qa.screenshot({path:'output/playwright/design-d-content-failure.png'});await save((local?'local':'public')+'-design-d-content-partial.json',{checks,errors,failures,error:String(error)});throw error;}finally{await context.close();}
}
