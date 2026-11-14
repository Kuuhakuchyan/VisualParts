async (page) => {
  const origin=new URL(page.url()).origin;
  const paths=new URL(page.url()).searchParams.has('competitionOnly')?['/aic/home.html']:['/home.html','/aic/home.html'];
  const checks=[],errors=[],observations=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const context=await page.context().browser().newContext({viewport:{width:1600,height:1000}});
  const q=await context.newPage();q.on('pageerror',error=>errors.push(error.message));
  const settle=async()=>{await q.locator('#intro').waitFor({state:'hidden'});await q.waitForTimeout(300);};
  const screenshot=async name=>q.screenshot({path:'decision/output/playwright/d-home/'+name+'.png'});
  const images=async()=>q.locator('img').evaluateAll(async nodes=>{
    await Promise.all(nodes.map(image=>{image.loading='eager';return image.decode().catch(()=>{});}));
    return nodes.filter(image=>!image.naturalWidth).map(image=>image.src);
  });
  try{
    for(const path of paths){
      const edition=path.includes('aic')?'competition':'project';
      await q.setViewportSize({width:1600,height:1000});await q.goto(origin+path);await settle();
      check(await q.locator('main>section').count()===6,edition+' retains six chapters');
      const members=edition==='competition'?['董少睿','胡翔宇','吴悦嘉']:['董少睿','胡翔宇','李彝巍','吕怡纬'];
      check(await q.locator('.member h3').allTextContents().then(v=>v.join()===members.join()),edition+' shows its own team roster');
      check((await images()).length===0,edition+' all image routes decode');
      check(await q.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('WJTJ Sans')&&document.fonts.check('400 16px "WJTJ Sans"','微境探界')),edition+' approved font loads');
      await q.waitForFunction(()=>document.querySelector('.hero-scene').dataset.rendered==='true');
      check(await q.locator('#intro').getAttribute('data-release')==='ready',edition+' intro released by real resources');
      await screenshot(edition+'-desktop');
      const before=await q.locator('.hero-scene canvas').screenshot();
      await q.mouse.move(1400,500);await q.waitForTimeout(350);
      const after=await q.locator('.hero-scene canvas').screenshot();
      check(!before.equals(after),edition+' pointer changes the rendered 3D canvas');
      for(const id of ['platform','fieldwork','team','approach','journal']){
        for(let step=0;step<12;step++){
          const delta=await q.locator('#'+id).evaluate(n=>n.getBoundingClientRect().top-document.querySelector('.topbar').offsetHeight);
          if(Math.abs(delta)<3)break;
          await q.mouse.wheel(0,Math.sign(delta)*520);await q.waitForTimeout(900);
        }
        check(await q.locator('#'+id).evaluate(n=>Math.abs(n.getBoundingClientRect().top-document.querySelector('.topbar').offsetHeight)<3),edition+' real wheel reaches '+id);
        await q.waitForTimeout(350);await screenshot(edition+'-'+id);
      }
      await q.locator('.section-rail a[href="#fieldwork"]').click();await q.waitForTimeout(850);
      check(await q.locator('#fieldwork .section-head').evaluate(n=>n.classList.contains('visible')),edition+' revisited chapter reveals again');
      if(edition==='competition')check(!/郑州大学|Zhengzhou University|闫梓宇|\/home-assets\/|href="\/(?:author|monitor|sensors)/i.test(await q.content()),'competition text, alt, CSS and links stay anonymous');
      for(const [width,height] of [[1024,600],[768,600],[390,844],[320,740]]){
        await q.setViewportSize({width,height});await q.goto(origin+path);await settle();
        check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' fits '+width+'px');
        await q.locator('#menuButton').click();await q.locator('#navLinks a[href="#team"]').click();await q.waitForTimeout(850);
        check(await q.locator('#menuButton').getAttribute('aria-expanded')==='false'&&new URL(q.url()).hash==='#team',edition+' menu reaches team at '+width+'px');
        if(width===390||width===320){await q.goto(origin+path);await settle();await screenshot(edition+'-'+width);}
      }
    }
    await q.setViewportSize({width:1600,height:1000});await q.goto(origin+'/aic/journal.html');
    check((await images()).length===0,'anonymous blog covers decode');
    check(new Set(await q.locator('.journal-entry-image img').evaluateAll(nodes=>nodes.map(n=>n.src))).size===3,'blog uses three different covers');
    await screenshot('journal-desktop');
    await q.locator('[data-topic="技术路径"]').first().click();check(await q.locator('.journal-entry:visible').count()===1,'blog category filters');
    await q.locator('button[data-topic="all"]').click();await q.locator('#journal-search').fill('不存在的文章');
    check(await q.locator('#journal-empty').isVisible(),'blog empty search state');
    await q.locator('#journal-search').fill('');await q.locator('.journal-entry h2 a').first().click();
    check(await q.locator('[data-article="project"]').isVisible()&&!await q.locator('#journal-index').isVisible(),'blog opens article');
    await q.locator('[data-article="project"] a[href="#all"]').click();check(await q.locator('#journal-index').isVisible(),'blog returns to index');
    await q.setViewportSize({width:320,height:740});await q.goto(origin+'/aic/journal.html');
    check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'blog fits 320px');await screenshot('journal-mobile');
    await q.emulateMedia({reducedMotion:'reduce'});await q.goto(origin+'/aic/home.html');
    check(await q.locator('#intro').isHidden(),'reduced motion bypasses loader');
    check(await q.evaluate(()=>document.documentElement.dataset.pageMode==='natural'),'reduced motion uses natural scrolling');
    await q.emulateMedia({reducedMotion:'no-preference'});
    await q.route('**/scene.js*',route=>route.abort());await q.goto(origin+'/aic/home.html');
    await settle();const releaseMs=Number(await q.locator('#intro').getAttribute('data-release-ms'));check(releaseMs>=3200&&releaseMs<3700,'module failure releases entry at its 3.2 second deadline ('+releaseMs+'ms)');
    check(await q.locator('#intro').getAttribute('data-release')==='timeout','module failure releases timeout');await q.unroute('**/scene.js*');
    await q.route('**/scene.json',route=>route.abort());await q.goto(origin+'/aic/home.html');await settle();
    check(await q.locator('.hero-scene').getAttribute('data-rendered')==='false','geometry error uses static scene');
    check(await q.locator('[data-resource="scene"]').getAttribute('data-state')==='fallback','geometry error reports fallback');await q.unroute('**/scene.json');
    await q.route('**/scene.js*',route=>route.abort());await q.goto(origin+'/aic/home.html');await q.locator('#introSkip').click();
    check(await q.locator('#intro').getAttribute('data-release')==='skipped','skip releases entry immediately');await q.unroute('**/scene.js*');
    check(errors.length===0,'no uncaught browser exceptions');
    observations.push({origin,checks:checks.length});return {checks,errors,observations};
  }catch(error){await screenshot('failure');throw Error(JSON.stringify({message:error.message,checks,errors,url:q.url()}));}
  finally{await context.close();}
}
