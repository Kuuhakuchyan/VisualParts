async (page) => {
  const origin=new URL(page.url()).origin;
  const local=['localhost','127.0.0.1'].includes(new URL(origin).hostname);
  const label=local?'local':'public',checks=[],errors=[],observations=[];
  const homes=local?['/home.html','/aic/home.html']:['/','/decision/aic/home.html'];
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960},recordVideo:{dir:'output/playwright/restored-effects-video',size:{width:1280,height:720}}});
  const q=await context.newPage(),video=q.video();
  q.on('pageerror',e=>errors.push(e.message));
  const check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};
  const settled=()=>q.waitForFunction(()=>!document.documentElement.dataset.pageTransition);
  const moveToChapter=async id=>{
    for(let i=0;i<15;i++){
      const position=await q.locator('#'+id).evaluate(n=>n.getBoundingClientRect().top-document.querySelector('.topbar').offsetHeight);
      if(Math.abs(position)<3)return;
      await q.mouse.wheel(0,Math.sign(position)*450);await q.waitForTimeout(850);await settled();
    }
    throw Error('Real wheel could not reach '+id);
  };
  try{
    for(const [edition,path] of homes.entries()){
      for(const [width,height] of [[1440,960],[1024,600],[900,700],[768,600]]){
        const tag=(edition?'competition':'project')+' '+width+'x'+height;
        await q.setViewportSize({width,height});await q.goto(origin+path);
        const scanner=()=>q.locator('#intro').evaluate(n=>getComputedStyle(n,'::after').transform);
        const first=await scanner();await q.waitForTimeout(200);
        check(first!==await scanner(),tag+' original loading scanner moves');
        await q.locator('#intro').waitFor({state:'hidden'});await q.waitForTimeout(300);
        const runtime=await q.evaluate(()=>({
          version:document.querySelector('meta[name="application-version"]').content,
          mode:document.documentElement.dataset.pageMode,
          sheets:[...document.styleSheets].length,scripts:document.scripts.length,
          workers:navigator.serviceWorker.controller?.scriptURL||null,
          canceledHeading:[...document.styleSheets].flatMap(s=>[...s.cssRules]).some(r=>r.selectorText==='.active-section .section-head h2'&&r.style.animationName==='none'),
          overflow:document.documentElement.scrollWidth>innerWidth+1
        }));
        check(runtime.version==='20261023-motion3'&&runtime.sheets===1&&runtime.scripts===1&&!runtime.workers,tag+' runs exactly one current stylesheet and script');
        check(!runtime.canceledHeading,tag+' no later rule cancels the title entrance');
        check(runtime.mode==='chapters',tag+' chapter paging works at this actual viewport');
        check(!runtime.overflow,tag+' navigation fits viewport');
        const geometry=()=>q.locator('section.content').evaluateAll(nodes=>nodes.map(n=>({id:n.id,top:n.offsetTop,height:n.offsetHeight})));
        const beforeGeometry=await geometry();
        await q.mouse.move(width*.2,Math.min(height*.4,250));await q.waitForTimeout(150);
        const transform=()=>q.locator('.hero').evaluate(n=>{const m=new DOMMatrix(getComputedStyle(n,'::before').transform);return{x:m.e,y:m.f};});
        const before=await transform();
        await q.mouse.move(width*.8,Math.min(height*.7,440));await q.waitForTimeout(150);
        const after=await transform();
        check(Math.abs(after.x-before.x)>10&&Math.abs(after.y-before.y)>3,tag+' pointer movement visibly changes hero scene transform');
        await q.mouse.move(width*.55,height*.55);await moveToChapter('platform');
        check(await q.locator('#platform h2').evaluate(n=>getComputedStyle(n).animationName==='chapter-in'),tag+' chapter title entrance survives the stylesheet cascade');
        check(JSON.stringify(beforeGeometry)===JSON.stringify(await geometry()),tag+' chapter activation does not change section heights or scroll destinations');
        if(width===1440){
          check(await q.locator('.section-rail em').first().isVisible(),tag+' original chapter labels are visible');
          await q.screenshot({path:'output/playwright/home-restored-'+label+'-'+edition+'-chapter.png'});
          await moveToChapter('fieldwork');await q.waitForTimeout(800);
          await q.mouse.wheel(0,-450);await q.waitForTimeout(850);await settled();
          check(await q.locator('#platform h2').evaluate(n=>n.getAnimations().some(a=>a.animationName==='chapter-in')),tag+' returning to chapter creates its title animation again');
        }
        if(width===900||width===768){
          await q.locator('#menuButton').click();
          check(await q.locator('#navLinks').isVisible(),tag+' embedded-width navigation opens');
          await q.locator('#navLinks a[href="#team"]').click();await q.waitForTimeout(850);await settled();
          check(await q.locator('#team').evaluate(n=>Math.abs(n.getBoundingClientRect().top-document.querySelector('.topbar').offsetHeight)<3),tag+' embedded navigation reaches team and closes');
          check(JSON.stringify(beforeGeometry)===JSON.stringify(await geometry()),tag+' long chapter navigation keeps every section geometry stable');
          await q.screenshot({path:'output/playwright/home-restored-'+label+'-'+edition+'-'+width+'.png'});
        }
        observations.push({tag,runtime,parallax:{before,after}});
      }
    }
    check(errors.length===0,'no uncaught browser exceptions');
    return {origin,checks,errors,observations,video:'output/playwright/home-restored-'+label+'.webm'};
  }catch(e){await q.screenshot({path:'output/playwright/home-restored-'+label+'-failure.png'});throw Error(JSON.stringify({message:e.message,checks,url:q.url(),errors,state:await q.evaluate(()=>({y:scrollY,header:document.querySelector('.topbar').offsetHeight,team:document.querySelector('#team').getBoundingClientRect().top,transition:document.documentElement.dataset.pageTransition,nav:document.querySelector('#navLinks').className}))}));}
  finally{await context.close();await video.saveAs('output/playwright/home-restored-'+label+'.webm');}
}
