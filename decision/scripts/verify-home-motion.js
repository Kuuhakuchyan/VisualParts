async (page) => {
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname);
  const homes=[local?'/home.html':'/',local?'/aic/home.html':'/decision/aic/home.html'];
  const journal=local?'/aic/journal.html':'/decision/aic/journal.html';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960},reducedMotion:'no-preference'});
  const qa=await context.newPage(),checks=[],errors=[],observations=[];
  const label=local?'local':'public';
  const check=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  qa.on('pageerror',error=>errors.push(error.message));
  const skip=async()=>{await qa.locator('#introSkip').click();await qa.locator('#intro').waitFor({state:'hidden'});};
  const jump=async id=>{
    await qa.evaluate(id=>{const target=id==='top'?document.querySelector('.hero'):document.getElementById(id);window.scrollTo({top:scrollY+target.getBoundingClientRect().top-document.querySelector('.topbar').offsetHeight,behavior:'instant'});},id);
  };
  try{
    for(const [index,home] of homes.entries()){
      const edition=index?'competition':'project';
      await qa.setViewportSize({width:1440,height:960});
      await qa.goto(origin+home,{waitUntil:'domcontentloaded'});
      check(await qa.locator('#intro').isVisible(),edition+' loading sequence is visible on entry');
      check(await qa.locator('html').evaluate(n=>n.classList.contains('motion-ready')),edition+' motion observer initializes');
      check(await qa.locator('.reveal').count()>=25,edition+' hero and chapter content have reveal targets');
      const loading=await qa.locator('#intro').evaluate(n=>n.getAnimations({subtree:true}).map(a=>a.animationName));
      check(loading.includes('intro-scan')&&loading.includes('intro-load')&&loading.includes('mark-in'),edition+' scanner, progress and emblem have real animations');
      await qa.screenshot({path:'output/playwright/home-motion-'+label+'-'+edition+'-loading.png'});
      await skip();
      await qa.waitForFunction(()=>document.querySelector('.hero').classList.contains('active-section'));
      await qa.waitForFunction(()=>getComputedStyle(document.querySelector('.hero h1')).opacity==='1');
      check(await qa.locator('html').evaluate(n=>n.classList.contains('intro-complete')),edition+' skip releases hero entrance');
      const transform=()=>qa.locator('.hero').evaluate(n=>getComputedStyle(n,'::before').transform);
      const before=await transform();await qa.waitForTimeout(220);const after=await transform();
      check(before!==after,edition+' hero background actually moves');
      check(await qa.locator('.hero-next').evaluate(n=>n.getAnimations().some(a=>a.animationName==='next-pulse'&&a.playState==='running')),edition+' next-chapter indicator animates');
      check(await qa.locator('html').evaluate(n=>n.dataset.pageMode==='chapters'&&getComputedStyle(n).scrollSnapType==='none'),edition+' desktop gesture paging replaces native snapping');
      await qa.screenshot({path:'output/playwright/home-motion-'+label+'-'+edition+'-hero.png'});
      await qa.locator('.section-rail a[href="#platform"]').click();
      await qa.waitForFunction(()=>{const n=document.getElementById('platform');return Math.abs(n.getBoundingClientRect().top-72)<3;},null,{timeout:10000});
      check(await qa.locator('#platform').evaluate(n=>n.classList.contains('active-section')),edition+' chapter navigation updates active section');
      await qa.waitForFunction(()=>[...document.querySelectorAll('#platform .platform-card')].every(n=>getComputedStyle(n).opacity==='1'));
      for(let replay=1;replay<=2;replay++){
        await jump('team');
        await qa.waitForFunction(()=>!document.querySelector('#platform .platform-card').classList.contains('visible'));
        await qa.waitForTimeout(650);
        check(await qa.locator('#platform .platform-card').first().evaluate(n=>getComputedStyle(n).opacity==='0'),edition+' replay '+replay+' resets departed content');
        await jump('platform');
        await qa.waitForFunction(()=>document.querySelector('#platform .platform-card').classList.contains('visible'));
        check(await qa.locator('#platform .platform-card').first().evaluate(n=>n.getAnimations().some(a=>a.transitionProperty==='opacity'&&a.playState==='running')),edition+' replay '+replay+' starts a new opacity transition');
        await qa.waitForFunction(()=>getComputedStyle(document.querySelector('#platform .platform-card')).opacity==='1');
      }
      await jump('top');await qa.waitForTimeout(100);
      check(await qa.locator('.hero').evaluate(n=>n.getAnimations({subtree:true}).some(a=>a.animationName==='scene-drift'&&a.playState==='running')),edition+' hero motion restarts when revisited');
      await qa.keyboard.press('PageDown');
      await qa.waitForFunction(()=>Math.abs(document.getElementById('platform').getBoundingClientRect().top-72)<3,null,{timeout:10000});
      check(await qa.locator('.section-rail a[href="#platform"]').getAttribute('aria-current')==='location',edition+' keyboard paging keeps chapter rail in sync');
      await qa.goto(origin+journal);await qa.goBack({waitUntil:'domcontentloaded'});
      check(await qa.locator('#intro').isVisible(),edition+' returning from another page replays loading sequence');
      await skip();
      const images=await qa.locator('img').evaluateAll(async nodes=>{
        await Promise.all(nodes.map(n=>{n.loading='eager';return n.decode().catch(()=>{});}));
        return nodes.filter(n=>!n.naturalWidth).map(n=>n.src);
      });
      check(images.length===0,edition+' all photographs and logos decode');
      if(index)check(!/郑州大学|Zhengzhou University|闫梓宇|\/home-assets\//i.test(await qa.content()),'competition motion restoration preserves anonymity');
      for(const width of [390,320]){
        await qa.setViewportSize({width,height:844});
        await qa.goto(origin+home);await skip();
        check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' '+width+'px fits viewport');
        check(await qa.locator('html').evaluate(n=>getComputedStyle(n).scrollSnapType==='none'),edition+' '+width+'px preserves natural touch scrolling');
        await qa.locator('#menuButton').click();await qa.locator('#navLinks a[href="#team"]').click();
        check(await qa.locator('#menuButton').getAttribute('aria-expanded')==='false',edition+' '+width+'px chapter navigation closes menu');
        await qa.waitForFunction(()=>getComputedStyle(document.querySelector('.member')).opacity==='1');
        check(await qa.locator('.member').first().evaluate(n=>{const r=n.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;}),edition+' '+width+'px team content reveals in viewport');
        await qa.screenshot({path:'output/playwright/home-motion-'+label+'-'+edition+'-'+width+'.png'});
      }
      observations.push({edition,targets:await qa.locator('.reveal').count(),loadingAnimations:loading});
    }
    await qa.setViewportSize({width:1440,height:960});await qa.goto(origin+homes[0]);
    await qa.locator('#intro').waitFor({state:'hidden',timeout:5000});
    check(await qa.locator('html').evaluate(n=>n.classList.contains('intro-complete')),'loading finishes automatically without interaction');
    await qa.emulateMedia({reducedMotion:'reduce'});await qa.goto(origin+homes[1]);
    check(!(await qa.locator('#intro').isVisible()),'reduced motion bypasses loading overlay');
    check(await qa.locator('.reveal').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).opacity==='1')),'reduced motion keeps all content visible');
    check(await qa.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length===0),'reduced motion disables animation loops');
    const noJS=await page.context().browser().newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    try{
      const basic=await noJS.newPage();await basic.goto(origin+homes[0]);
      check(!(await basic.locator('#intro').isVisible()),'disabled JavaScript cannot trap visitors behind loading screen');
      check(await basic.locator('.hero h1').evaluate(n=>getComputedStyle(n).opacity==='1'),'disabled JavaScript retains visible homepage');
    }finally{await noJS.close();}
    check(errors.length===0,'no uncaught browser errors');
    return {origin,checks,errors,observations};
  }catch(error){await qa.screenshot({path:'output/playwright/home-motion-'+label+'-failure.png'}).catch(()=>{});throw error;}
  finally{await context.close();}
}
