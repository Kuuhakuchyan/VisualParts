async page=>{
  const origin=new URL(page.url()).origin,checks=[],errors=[],screens=[];
  const base=['127.0.0.1','localhost'].includes(new URL(origin).hostname)?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1600,height:1000}}),q=await context.newPage();
  q.on('pageerror',e=>errors.push(e.message));
  const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  const fits=async()=>check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),q.url()+' fits viewport');
  const screenshot=async name=>{const path='output/playwright/d-interface-'+name+'.png';await q.screenshot({path});screens.push(path);};
  try{
    for(const edition of ['', 'aic/']){
      const label=edition?'competition':'project';
      await q.setViewportSize({width:1600,height:1000});await q.goto(origin+base+edition+'#screen');
      await q.locator('.sandbox-legend[data-total-cells]').waitFor({timeout:60000});
      await q.waitForFunction(()=>Number(document.querySelector('.sandbox-legend')?.dataset.totalCells)>1,null,{timeout:60000});
      check(await q.locator('#dock-tab-risk').getAttribute('aria-selected')==='true',label+' starts with people and risk overview');
      check(await q.locator('.screen-person-row').count()>0,label+' contains real configured cohort scenarios');
      check(await q.locator('#screen-distribution .distribution-bar').isVisible(),label+' distribution derived from returned grid');
      check(Number(await q.locator('.sandbox-legend').getAttribute('data-total-cells'))>1,label+' multiple grid cells loaded');
      check(await q.locator('#map-streets').getAttribute('aria-pressed')==='true',label+' anonymous street map selected');
      await q.locator('#screen-forecast-hour:not([disabled])').waitFor();
      const initial=await q.locator('#screen-forecast-value').innerText();
      await q.locator('#screen-forecast-hour').fill('2');
      check(await q.locator('#screen-forecast-value').innerText()!==initial,label+' timeline selects real forecast hour');
      await q.locator('#screen-forecast-play').click();check(await q.locator('#screen-forecast-play').getAttribute('aria-pressed')==='true',label+' forecast play state');
      await q.locator('#screen-forecast-play').click();check(await q.locator('#screen-forecast-play').getAttribute('aria-pressed')==='false',label+' forecast pause clears state');
      await q.locator('#dock-tab-sandbox').click();await q.locator('[data-operation=add]').click();
      check(await q.locator('#workspace-map').getAttribute('data-interaction')==='add',label+' build tool activates independently');
      await q.locator('#dock-tab-risk').click();check(await q.locator('#workspace-map').getAttribute('data-interaction')==='inspect',label+' leaving editing cancels build tool');
      await q.locator('#screen-select-region').click();check(await q.locator('#workspace-map').getAttribute('data-interaction')==='region',label+' region selection independent');
      await q.locator('#dock-tab-layers').click();check(await q.locator('#workspace-map').getAttribute('data-interaction')==='inspect',label+' changing task cancels region');
      await q.locator('#layer-buildings').uncheck();await q.locator('#layer-buildings').check();
      await q.locator('#dock-tab-risk').click();await q.locator('#dock-tab-risk').press('End');check(await q.locator('#dock-tab-layers').getAttribute('aria-selected')==='true',label+' keyboard End selects last tab');
      await q.locator('#dock-tab-layers').press('Home');check(await q.locator('#dock-tab-risk').getAttribute('aria-selected')==='true',label+' keyboard Home selects first tab');
      await q.locator('#map-orbit').click();await q.locator('#map-orbit').click();check(await q.locator('#map-orbit').getAttribute('aria-pressed')==='false',label+' orbit stops and clears selected style');
      await q.locator('#map-home').click();await q.waitForTimeout(700);await fits();await screenshot(label+'-screen-desktop');
      for(const width of [1280,768,390,320]){
        await q.setViewportSize({width,height:844});await q.waitForTimeout(180);await fits();
        const geo=await q.evaluate(()=>{const m=document.querySelector('#workspace-map').getBoundingClientRect(),t=document.querySelector('.screen-map-tools').getBoundingClientRect(),l=document.querySelector('.sandbox-legend').getBoundingClientRect();return {m:{top:m.top,bottom:m.bottom},t:{top:t.top,bottom:t.bottom,left:t.left,right:t.right},l:{bottom:l.bottom}};});
        check(geo.t.left>=-1&&geo.t.right<=width+1,label+' toolbar fits '+width);
        check(geo.l.bottom<=geo.t.top+2,label+' legend avoids toolbar '+width);
        if(width===390||width===320){
          check(await q.locator('.screen-mobile-nav').isVisible(),label+' mobile navigation at '+width);
          await q.locator('.screen-dock-expand').click();check(await q.locator('#decision-screen').evaluate(n=>n.classList.contains('sandbox-mobile-open')),label+' sheet expands '+width);
          await q.locator('#dock-tab-sandbox').click();await q.locator('[data-operation=add]').click();
          check(await q.locator('#workspace-map').getAttribute('data-interaction')==='add',label+' touch editing activates '+width);
          await q.locator('#dock-tab-risk').click();await q.locator('.screen-dock-expand').click();
          await screenshot(label+'-screen-'+width);
        }
      }
      for(const route of ['overview','spatial','risk','plans','evidence']){
        for(const width of [1440,390,320]){
          await q.setViewportSize({width,height:960});await q.goto(origin+base+edition+'#'+route);await q.locator('#view-root').waitFor();await q.waitForTimeout(200);await fits();
          if(width!==320)await screenshot(label+'-'+route+'-'+width);
        }
      }
      await q.setViewportSize({width:1440,height:960});await q.goto(origin+base+edition+'#risk');
      await q.locator('#region-duration').fill('999');
      check(!await q.locator('#region-duration').evaluate(n=>n.checkValidity()),label+' duration guards excessive input');
      await q.locator('#region-duration').fill('30');
      await q.locator('#self-check-tab').click();await q.locator('#risk-frame').waitFor();check(await q.locator('#risk-frame').isVisible(),label+' auxiliary self-check remains distinct');
      if(edition)check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await q.content()),label+' workspace remains anonymous');
    }
    check(errors.length===0,'no unhandled runtime exceptions');return {checks,errors,screens};
  }catch(error){await q.screenshot({path:'output/playwright/d-interface-failure.png'});throw error;}
  finally{await context.close();}
}
