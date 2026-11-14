async (page) => {
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname);
  const homes=local?[origin+'/home.html',origin+'/aic/home.html']:['https://weather.nogamenolife.cn/','https://aic.nogamenolife.cn/aic/home.html'];
  const label=local?'local':'public',checks=[],errors=[],samples=[];
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960},recordVideo:{dir:'output/playwright/home-navigation-video',size:{width:1280,height:720}}});
  const qa=await context.newPage(),video=qa.video();
  const check=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  qa.on('pageerror',e=>errors.push(e.message));
  const landed=async(id,target=qa)=>{
    await target.waitForFunction(id=>{
      const root=document.documentElement,node=id==='top'?document.querySelector('.hero'):document.getElementById(id);
      return !root.dataset.pageTransition&&Math.abs(node.getBoundingClientRect().top-document.querySelector('.topbar').offsetHeight)<3;
    },id,{timeout:10000});
  };
  const ready=async(target=qa)=>{await target.locator('#intro').waitFor({state:'hidden',timeout:6000});await target.waitForTimeout(350);};
  try{
    for(const [index,path] of homes.entries()){
      const edition=index?'competition':'project';
      await qa.setViewportSize({width:1440,height:960});await qa.goto(path,{waitUntil:'domcontentloaded'});
      const preference=await qa.evaluate(()=>({systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,mode:document.documentElement.dataset.motion}));
      if(preference.mode==='off')await qa.locator('#motionEnabled').check();
      const progress=()=>qa.locator('.intro-assembly > i').evaluate(n=>getComputedStyle(n).transform);
      const a=await progress();await qa.waitForTimeout(260);const b=await progress();
      check(a!==b,edition+' loading assembly animates over time');
      await ready();
      await qa.locator('.hero-scene[data-rendered=true]').waitFor({timeout:20000});
      await qa.mouse.move(250,450);await qa.waitForTimeout(300);
      const pixels=await qa.locator('.hero').screenshot();await qa.mouse.move(1200,450);await qa.waitForTimeout(300);
      check(!pixels.equals(await qa.locator('.hero').screenshot()),edition+' hero scene responds visibly to pointer movement');
      await qa.mouse.move(820,500);await qa.mouse.wheel(0,120);await landed('platform');
      check(await qa.evaluate(()=>scrollY>500),edition+' one real 120px mouse detent leaves first screen');
      const startY=await qa.evaluate(()=>scrollY);await qa.waitForTimeout(400);
      check(Math.abs(startY-await qa.evaluate(()=>scrollY))<2,edition+' first chapter does not snap back after wheel settles');
      await qa.screenshot({path:'output/playwright/home-real-'+label+'-'+edition+'-platform.png'});
      for(let i=0;i<30;i++){await qa.mouse.wheel(0,40);await qa.waitForTimeout(25);}
      await landed('fieldwork');
      check(await qa.locator('#fieldwork').evaluate(n=>n.classList.contains('active-section')),edition+' continuous wheel burst advances exactly one chapter');
      await qa.mouse.wheel(0,-120);await landed('platform');
      check(true,edition+' reversing immediately after a long inertia tail is not locked');
      await qa.mouse.wheel(0,-120);await landed('top');
      check(await qa.evaluate(()=>scrollY<2),edition+' reverse wheel returns all the way to hero');
      for(const delta of [2,3,4,7,9,12]){await qa.mouse.wheel(0,delta);await qa.waitForTimeout(25);}
      await landed('platform');
      check(true,edition+' small trackpad deltas accumulate into a page gesture');
      for(const id of ['fieldwork','team','approach','journal']){
        await qa.mouse.wheel(0,120);await landed(id);
        check(await qa.locator('#'+id).evaluate(n=>n.classList.contains('active-section')),edition+' real wheel reaches '+id);
      }
      await qa.mouse.wheel(0,120);
      await qa.waitForFunction(()=>!document.documentElement.dataset.pageTransition&&scrollY+innerHeight>=document.documentElement.scrollHeight-3);
      check(await qa.locator('.footer').evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight+3),edition+' footer remains reachable');
      samples.push({edition,preference,firstChapterY:startY});
      for(const width of [390,320]){
        await qa.setViewportSize({width,height:844});await qa.goto(path);await ready();
        check(await qa.evaluate(()=>document.documentElement.dataset.pageMode==='natural'),edition+' '+width+'px uses natural scrolling');
        const cdp=await context.newCDPSession(qa);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width/2,y:700}]});
        for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width/2,y:700-i*42}]});await qa.waitForTimeout(25);}
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
        await qa.waitForTimeout(500);
        check(await qa.evaluate(()=>scrollY>150),edition+' '+width+'px touch swipe actually scrolls');
        check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' '+width+'px has no horizontal overflow');
        await qa.screenshot({path:'output/playwright/home-real-'+label+'-'+edition+'-'+width+'.png'});
      }
    }
    await qa.setViewportSize({width:1280,height:720});await qa.goto(homes[0]);await ready();
    await qa.mouse.move(750,400);await qa.mouse.wheel(0,120);await landed('platform');
    const y=await qa.evaluate(()=>scrollY);await qa.mouse.wheel(0,100);await qa.waitForTimeout(350);
    check(await qa.evaluate(()=>scrollY)>y,'short desktop scrolls within a tall chapter before advancing');
    check(await qa.locator('#fieldwork').evaluate(n=>n.getBoundingClientRect().top>innerHeight/2),'tall chapter is not skipped by second wheel detent');
    const horizontalY=await qa.evaluate(()=>scrollY);await qa.mouse.wheel(180,0);await qa.waitForTimeout(250);
    check(Math.abs(await qa.evaluate(()=>scrollY)-horizontalY)<2,'horizontal gestures do not trigger vertical paging');
    const reduced=await page.context().browser().newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
    try{
      const rq=await reduced.newPage();rq.on('pageerror',e=>errors.push(e.message));await rq.goto(homes[1]);
      check(!(await rq.locator('#intro').isVisible()),'system reduced-motion preference initially respected');
      check(await rq.locator('.reveal').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).opacity==='1')),'reduced motion shows all text');
      check(await rq.locator('#motionEnabled').isDisabled(),'system reduced-motion keeps the animation control disabled');
      await rq.emulateMedia({reducedMotion:'no-preference'});
      await rq.locator('#motionEnabled').uncheck();await rq.locator('#motionEnabled').check();
      check(await rq.locator('#intro').isVisible(),'animation opt-in replays loading after reduced motion is cleared');
      await ready(rq);await rq.mouse.move(820,500);await rq.mouse.wheel(0,120);await landed('platform',rq);
      check(true,'explicit opt-in enables real wheel paging');
      await rq.reload();await ready(rq);
      check(await rq.locator('#motionEnabled').isChecked(),'animation choice survives a normal page refresh');
      await rq.locator('#motionEnabled').uncheck();
      check(await rq.evaluate(()=>document.documentElement.dataset.pageMode==='natural'),'animation opt-out restores natural scrolling immediately');
    }finally{await reduced.close();}
    check(errors.length===0,'no uncaught browser errors');
    return {origin,checks,errors,samples,video:'output/playwright/home-real-'+label+'-navigation.webm'};
  }catch(error){await qa.screenshot({path:'output/playwright/home-real-'+label+'-failure.png'}).catch(()=>{});throw new Error(JSON.stringify({message:error.message,checks,state:await qa.evaluate(()=>({url:location.href,y:scrollY,mode:document.documentElement.dataset.pageMode,transition:document.documentElement.dataset.pageTransition,sections:[...document.querySelectorAll('.hero,section.content,.footer')].map(n=>({id:n.id,top:n.getBoundingClientRect().top,height:n.offsetHeight})),errors:[]}))}));}
  finally{await context.close();await video.saveAs('output/playwright/home-real-'+label+'-navigation.webm');}
}
