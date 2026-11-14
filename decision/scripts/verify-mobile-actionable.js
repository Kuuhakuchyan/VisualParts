async page => {
  const origin=new URL(page.url()).origin;
  const local=/localhost|127\.0\.0\.1/.test(origin);
  const context=await page.context().browser().newContext({viewport:{width:390,height:700},isMobile:true,hasTouch:true,colorScheme:'dark'});
  const q=await context.newPage(),checks=[],errors=[];
  q.on('pageerror',e=>errors.push(e.message));
  const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  try{
    for(const edition of ['project','competition']){
      const url=local?origin+(edition==='competition'?'/aic/':'/'):edition==='competition'?'https://aic.nogamenolife.cn/aic/':'https://weather.nogamenolife.cn/decision/';
      await q.goto(url+'#screen');
      await q.locator('.sandbox-legend[data-total-cells]').waitFor({timeout:60000});
      for(const [width,height] of [[320,600],[360,640],[390,700],[430,844]]){
        await q.setViewportSize({width,height});
        await q.waitForTimeout(200);
        check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' width '+width);
        check(await q.locator('#decision-screen').evaluate(n=>Math.abs(n.getBoundingClientRect().height-innerHeight)<2),edition+' dynamic viewport '+height);
        check(await q.locator('.screen-map-tools>button:visible').count()===3,edition+' compact toolbar '+width);
        const geo=await q.evaluate(()=>Object.fromEntries(['.screen-header','.screen-left','.screen-right','.sandbox-legend','.screen-map-tools','.screen-mobile-nav'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,{top:r.top,bottom:r.bottom,left:r.left,right:r.right}];})));
        check(geo['.sandbox-legend'].right<=geo['.screen-map-tools'].left,edition+' legend beside toolbar '+width);
        check(geo['.screen-map-tools'].bottom<=geo['.screen-right'].top,edition+' tools above sheet '+width);
        check(geo['.screen-left'].bottom<geo['.screen-map-tools'].top,edition+' usable map between controls '+width);
        const rows=await q.locator('.screen-person-row').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),p=n.closest('.screen-right').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;}));
        check(rows.length===3&&rows.every(Boolean),edition+' all initial groups visible '+width);
        await q.locator('#map-more').tap();
        check(await q.locator('#map-more').getAttribute('aria-expanded')==='true',edition+' touch opens tools '+width);
        check(await q.locator('.screen-map-tools>button:visible').count()>3,edition+' additional tools available '+width);
        await q.locator('#screen-refresh').tap();
        check(await q.locator('#map-more').getAttribute('aria-expanded')==='false',edition+' outside tap closes tools '+width);
        if(width===390)await q.screenshot({path:'output/playwright/mobile-actionable-'+edition+'-390.png'});
      }
      await q.setViewportSize({width:390,height:700});
      await q.locator('.screen-dock-expand').tap();
      check(await q.locator('#decision-screen').evaluate(n=>n.classList.contains('sandbox-mobile-open')),edition+' touch expands sheet');
      await q.locator('#dock-tab-sandbox').tap();
      await q.locator('[data-operation=add]').tap();
      check(await q.locator('#workspace-map').getAttribute('data-interaction')==='add',edition+' touch build mode');
      await q.locator('#dock-tab-risk').tap();
      check(await q.locator('#workspace-map').getAttribute('data-interaction')==='inspect',edition+' leaving build resets interaction');
      await q.locator('.screen-dock-expand').tap();
      check((await q.locator('html').evaluate(n=>getComputedStyle(n).colorScheme)).includes('light'),edition+' light surface in dark preference');
    }
    check(errors.length===0,'no mobile runtime exceptions');
    return {checks,errors};
  }catch(error){await q.screenshot({path:'output/playwright/mobile-actionable-failure.png'});throw error;}
  finally{await context.close();}
}
