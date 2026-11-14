async (page) => {
  if(!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname))throw new Error('Response replay and fault injection are local-only');
  const checks=[],errors=[],fixtures=[];
  const check=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  const origin=new URL(page.url()).origin;
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage();
  qa.on('pageerror',e=>errors.push(e.message));
  let heatRequest;
  qa.on('request',r=>{if(new URL(r.url()).pathname==='/api/weather/sandbox/heatmap'&&r.method()==='POST')heatRequest=r.postDataJSON();});
  try{
    for(const edition of ['', 'aic/']){
      const label=edition?'competition':'project';
      await qa.goto(origin+'/'+edition+'#screen');
      await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
      await qa.locator('#sb-auto').uncheck();
      const response=await qa.request.post(origin+'/api/weather/sandbox/simulate',{
        data:{scene:{name:'布局方案',additions:[],removed_ids:[]},regional:{...heatRequest,use_ai:false},resolution_m:100},timeout:115000,
      });
      if(!response.ok())throw new Error('Actual numerical fixture failed: '+response.status()+' '+await response.text());
      const fixture=await response.json();
      check(fixture.cells.features.length>1,label+' fixture comes from actual multi-cell numerical inference, not invented values');
      fixtures.push({edition:label,report_sha256:fixture.report_sha256,cells:fixture.cells.features.length});
      const hold=async(automatic,during,after)=>{
        let release,started;
        const gate=new Promise(r=>release=r),seen=new Promise(r=>started=r);
        const endpoint='**/api/weather/sandbox/'+(automatic?'simulate':'collaborate');
        let count=0;
        await qa.route(endpoint,async route=>{count++;started();await gate;await route.fulfill({status:200,json:fixture}).catch(()=>{});});
        try{
          if(automatic)await qa.locator('#sb-auto').check();else await qa.locator('#sb-run').click();
          await seen;
          await during();release();
          await qa.waitForFunction(()=>document.querySelector('#sb-run')&&!document.querySelector('#sb-run').disabled,{timeout:20000});
          await after();
          check(count===1,label+' pending '+(automatic?'automatic':'manual')+' calculation is not duplicated by display changes');
        }finally{release();await qa.unroute(endpoint);if(automatic)await qa.locator('#sb-auto').uncheck();}
      };
      await hold(false,async()=>{},async()=>{
        check(await qa.locator('.layout-sandbox').getAttribute('data-display-mode')==='proposed',label+' explicit run opens proposed results when no newer view was chosen');
        check(await qa.locator('#sb-layer').inputValue()==='weather',label+' no-edit calculation retains the weather grid');
        check(await qa.locator('#workspace-map').getAttribute('data-result-sha256')===fixture.report_sha256,label+' rendered scenario retains the exact API report digest');
      });
      await qa.locator('#sb-show-weather').click();
      await hold(false,async()=>{await qa.locator('#sb-layer').selectOption('risk');},async()=>{
        check(await qa.locator('#sb-layer').inputValue()==='risk',label+' late manual result cannot replace a newer risk layer choice');
        check(await qa.locator('.layout-sandbox').getAttribute('data-display-mode')==='edit',label+' late manual result cannot change the newer display mode');
      });
      await hold(false,async()=>{await qa.locator('[data-mode="delta"]').click();},async()=>{
        check(await qa.locator('.layout-sandbox').getAttribute('data-display-mode')==='delta',label+' late result keeps the chosen delta view');
        check(await qa.locator('.sandbox-legend').getAttribute('data-display-mode')==='delta',label+' delta legend matches the selected view after completion');
      });
      await qa.locator('#sb-show-weather').click();
      await hold(false,async()=>{await qa.locator('#sb-layer').selectOption('off');},async()=>{
        check(await qa.locator('#sb-layer').inputValue()==='off'&&!await qa.locator('.sandbox-legend').isVisible(),label+' late result does not reactivate a deliberately hidden heatmap');
      });
      await qa.locator('#sb-show-weather').click();
      await qa.locator('#sb-layer').selectOption('weather');
      await hold(false,async()=>{
        await qa.locator('[data-mode="delta"]').click();await qa.locator('[data-return-weather]').click();
      },async()=>{
        check(await qa.locator('#sb-layer').inputValue()==='weather',label+' one-click return remains authoritative when a pending result arrives');
      });
      let selected;
      await qa.locator('#map-home').click();await qa.waitForTimeout(700);
      await hold(false,async()=>{
        await qa.locator('[data-operation="add"]').click();await qa.mouse.click(710,440);
        selected=await qa.locator('#sb-selection').textContent();
        check(!await qa.locator('#sb-confirm').isDisabled(),label+' new construction preview can be placed during an earlier calculation');
      },async()=>{
        check(await qa.locator('#workspace-map').getAttribute('data-interaction')==='add',label+' old manual completion cannot cancel the newer building operation');
        check(await qa.locator('#sb-selection').textContent()===selected&&!await qa.locator('#sb-confirm').isDisabled(),label+' old result cannot clear the newer construction location');
      });
      await qa.keyboard.press('Escape');await qa.locator('#sb-layer').selectOption('weather');
      await hold(true,async()=>{},async()=>{
        check(await qa.locator('#sb-layer').inputValue()==='weather',label+' background recomputation preserves the weather grid');
        check(await qa.locator('.layout-sandbox').getAttribute('data-display-mode')==='edit',label+' background recomputation preserves edit mode');
      });
      await hold(true,async()=>{await qa.locator('#sb-layer').selectOption('off');},async()=>{
        check(await qa.locator('#sb-layer').inputValue()==='off',label+' background recomputation also respects hide-heatmap');
      });
      await qa.locator('#sb-show-weather').click();
      const endpoint='**/api/weather/sandbox/collaborate';
      await qa.route(endpoint,route=>route.fulfill({status:503,json:{detail:'QA injected calculation failure'}}));
      try{
        await qa.locator('#sb-run').click();
        await qa.locator('#sb-error').waitFor({state:'visible'});
        check(!await qa.locator('#sb-run').isDisabled(),label+' calculation failure unlocks retry');
        check(await qa.locator('#sb-layer').inputValue()==='weather',label+' calculation failure leaves available weather visible');
        check(await qa.locator('#sb-report').isDisabled(),label+' failed calculation never exposes an obsolete report');
      }finally{await qa.unroute(endpoint);}
      check((await qa.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'),label+' race tests never commit their building previews');
    }
    check(errors.length===0,'no uncaught browser exceptions');
    return {checks,errors,fixtures,note:'Local-only controlled latency/failure injection. Actual numerical API outputs are replayed only to test UI state ownership; no fabricated values, AI claims, or server records.'};
  }finally{await context.close();}
}
