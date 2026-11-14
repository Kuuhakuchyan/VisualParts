async page=>{
  const origin=new URL(page.url()).origin,checks=[],errors=[];
  const context=await page.context().browser().newContext({viewport:{width:1600,height:1000}}),q=await context.newPage();
  const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  q.on('pageerror',e=>errors.push(e.message));
  const fits=()=>q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  try{
    for(const edition of ['', 'aic/']){
      const label=edition?'competition':'project';
      for(const width of [1600,390]){
        await q.setViewportSize({width,height:width===1600?1000:844});await q.goto(origin+'/'+edition+'#spatial');
        await q.waitForFunction(()=>Number(document.querySelector('.sandbox-legend')?.dataset.validCells)>0,null,{timeout:40000});
        const legend=q.locator('.sandbox-legend');
        check(await legend.evaluate(n=>getComputedStyle(n).backgroundColor==='rgb(252, 253, 253)'),label+' spatial legend is solid light '+width);
        await legend.locator('summary').click();
        check(await legend.locator('details').evaluate(n=>n.open),label+' spatial legend opens on click '+width);
        await legend.locator('summary').click();
        check(!await legend.locator('details').evaluate(n=>n.open),label+' spatial legend closes '+width);
        check(await fits(),label+' spatial fits '+width);
      }
      for(const width of [390,320]){
        await q.setViewportSize({width,height:844});await q.goto(origin+'/'+edition+'#plans');await q.locator('#new-plan').waitFor();
        const sizes=await q.locator('.page-actions .button').evaluateAll(nodes=>nodes.map(n=>({h:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize)})));
        check(sizes.every(n=>n.h>=44&&n.font>=14),label+' page actions meet touch and type dimensions '+width);
        await q.locator('#new-plan').click();check(await q.locator('#plan-form').isVisible(),label+' form opens '+width);
        check(await fits(),label+' open form fits '+width);
        await q.evaluate(()=>scrollTo(0,0));await q.waitForTimeout(350);
        await q.screenshot({path:'.impeccable/review/'+label+'-plans-form-'+width+'.png'});
        await q.goto(origin+'/'+edition+'#screen');await q.locator('.screen-map-tools').waitFor();await q.waitForTimeout(500);
        const tools=await q.locator('.screen-map-tools button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0).map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
        check(tools.every(n=>n.w>=44&&n.h>=44),label+' map toolbar has 44px hit areas '+width);
        await q.locator('#map-pitch').click();check(await q.locator('#map-pitch').getAttribute('aria-pressed')==='false',label+' 3D tool works '+width);
        await q.locator('#map-pitch').click();
        await q.locator('.screen-dock-expand').click();
        check(await q.locator('#decision-screen').evaluate(n=>n.classList.contains('sandbox-mobile-open')),label+' mobile panel expands '+width);
        check(!await q.locator('.screen-left').isVisible(),label+' expanded controls do not cover weather card '+width);
        check(await q.locator('.screen-mobile-nav a[href="#overview"]').isVisible(),label+' weather remains reachable '+width);
        check(await fits(),label+' expanded map fits '+width);
        await q.screenshot({path:'.impeccable/review/'+label+'-screen-expanded-'+width+'.png'});
      }
    }
    check(!errors.length,'no exceptions');return {checks,errors};
  }finally{await context.close();}
}
