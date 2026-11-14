async (page) => {
  const checks=[],errors=[],requests=[];
  const base=new URL(page.url());
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage();
  qa.on('pageerror',error=>errors.push(error.message));
  qa.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)requests.push({url:r.url(),status:r.status()});});
  const ok=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  const anchors={screen:'#sb-run',overview:'#weather-chart',spatial:'#sb-run',risk:'#regional-submit',plans:'#plan-form',evidence:'#source-search'};
  try {
    const local=['localhost','127.0.0.1'].includes(base.hostname);
    for(const [edition,url] of local?[['',base.origin+'/'],['aic/',base.origin+'/aic/']]:[['','https://weather.nogamenolife.cn/decision/'],['aic/','https://aic.nogamenolife.cn/aic/']]){
      for(const [view,anchor] of Object.entries(anchors)){
        await qa.goto(url+'?qa='+Date.now()+'#'+view);
        await qa.waitForSelector(anchor,{state:'attached',timeout:60000});
        await qa.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
        if(view==='screen'||view==='spatial')await qa.waitForSelector('#workspace-map[data-buildings="225"]');
        ok((await qa.title()).includes('微境探界'),edition+view+' renders actual workbench');
        for(const width of [1440,768,390,320]){
          await qa.setViewportSize({width,height:960});
          await qa.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,null,{timeout:2000});
          ok(true,edition+view+' '+width+'px no horizontal page overflow');
        }
        if(edition)ok(!/郑州大学|Zhengzhou University|闫梓宇/.test(await qa.locator('body').innerText()),'anonymous '+view+' has no school/supervisor text');
        if(view==='risk'){
          if(!await qa.locator('#region-duration').isVisible())await qa.locator('.regional-parameters > summary').click();
          await qa.locator('#region-duration').fill('-1');
          ok(!await qa.locator('#regional-form').evaluate(form=>form.checkValidity()),edition+'negative exposure blocked before submission');
          await qa.locator('#region-duration').fill('30');
        }
        if(view==='overview')await qa.screenshot({path:'output/playwright/'+(edition?'aic':'standard')+'-overview-mobile.png'});
        await qa.setViewportSize({width:1440,height:960});
      }
      await qa.goto(url+'#unknown-route');
      await qa.waitForSelector('#sb-run',{state:'attached',timeout:60000});
      ok(true,edition+'unknown route falls back to usable screen');
    }
    ok(requests.length===0,'read-only smoke has no failed platform API requests');
    ok(errors.length===0,'all workbenches have no uncaught browser errors');
    return {checks,errors,requests};
  } finally { await context.close(); }
}
