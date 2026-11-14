async page=>{
  const checks=[],errors=[],evidence=[];
  const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  for(const [edition,url] of [['competition','https://aic.nogamenolife.cn/aic/'],['project','https://weather.nogamenolife.cn/decision/']]){
    const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),q=await context.newPage();
    q.on('pageerror',e=>errors.push(e.message));
    try{
      await q.goto(url+'#screen');
      await q.locator('#screen-forecast-hour:not([disabled])').waitFor({timeout:60000});
      await q.locator('.sandbox-legend[data-total-cells]').waitFor({timeout:60000});
      await q.evaluate(async()=>{
        const moduleURL=performance.getEntriesByType('resource').map(r=>r.name).find(url=>/\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(url));
        const {LayoutSandbox}=await import(moduleURL),paint=LayoutSandbox.prototype.paint;
        LayoutSandbox.prototype.paint=function(...args){window.__forecastQA=this;return paint.apply(this,args);};
      });
      await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-show-weather').click();
      const timeline=await q.request.get(new URL(url).origin+'/api/weather/aic/timeline?site=campus');
      const points=(await timeline.json()).points.filter(p=>p.period==='forecast');
      const endpoint=r=>r.url().endsWith('/sandbox/simulate')&&r.request().method()==='POST';
      const awaitFrame=async action=>{
        const pending=q.waitForResponse(endpoint,{timeout:120000});await action();
        const response=await pending,body=await response.json();check(response.ok(),edition+' frame endpoint '+response.status());
        await q.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,body.report_sha256,{timeout:120000});
        check(await q.locator('#workspace-map').getAttribute('data-valid-time')===body.valid_time,edition+' map valid time matches API');
        check(body.valid_time===body.solar.time&&body.valid_time===body.regional_report.layout_exposure.valid_time,edition+' report solar frame linked');
        check(await q.locator('.sandbox-legend').getAttribute('data-layer')==='utci',edition+' forecast shows computed UTCI');
        const actual=await q.evaluate(()=>window.__forecastQA.map.getSource('sandbox-heat').getData());
        const expected=body.cells.features.flatMap((f,i)=>Number.isFinite(f.properties.proposed_utci_c)?[{id:i,value:f.properties.proposed_utci_c}]:[]);
        check(JSON.stringify(actual.features.map(f=>({id:f.id,value:f.properties.value})))===JSON.stringify(expected),edition+' displayed grid equals API cell values');
        check(actual.features.length>1,edition+' computed cells visible');
        evidence.push({edition,time:body.valid_time,sha:body.report_sha256,summary:body.summary});
        return body;
      };
      const first=await awaitFrame(()=>q.locator('#screen-forecast-hour').fill('0'));
      const second=await awaitFrame(()=>q.locator('#screen-forecast-hour').fill('2'));
      check(first.valid_time!==second.valid_time,edition+' hour selection changes valid time');
      check(JSON.stringify(first.cells)!==JSON.stringify(second.cells),edition+' hour selection changes thermal field');
      for(const layer of ['weather','risk']){
        await q.locator('#sb-layer').selectOption(layer);
        const snapshot=await q.evaluate(async()=>({features:(await window.__forecastQA.map.getSource('sandbox-heat').getData()).features}));
        check(snapshot.features.length>1&&snapshot.features.every(f=>Date.parse(f.properties.time)===Date.parse(second.valid_time)),edition+' '+layer+' uses selected forecast hour');
      }
      await q.locator('#sb-layer').selectOption('utci');
      const next=q.waitForResponse(r=>endpoint(r)&&r.request().postDataJSON().valid_time===points[3].time,{timeout:120000});
      await q.locator('#screen-forecast-play').click();
      const played=await next,body=await played.json();
      await q.locator('#screen-forecast-play').click();
      check(body.is_forecast,edition+' playback advances computation to next hour');
      check(await q.locator('#screen-forecast-play').getAttribute('aria-pressed')==='false',edition+' pause releases selected state');
      const dayIndex=points.findIndex(p=>p.time.includes('T12:00'));
      const day=await awaitFrame(()=>q.locator('#screen-forecast-hour').fill(String(dayIndex)));
      await q.locator('#map-home').click();await q.waitForTimeout(1100);
      await q.locator('[data-mode=edit]').click();await q.locator('[data-operation=add]').click();
      for(const id of ['width','depth'])await q.locator('#sb-'+id).fill('20');
      await q.locator('#sb-height').fill('60');
      const point=await q.evaluate(()=>{const s=window.__forecastQA,r=document.querySelector('#workspace-map').getBoundingClientRect(),p=s.map.project([113.528143,34.813813]);return {x:r.left+p.x,y:r.top+p.y};});
      await q.mouse.click(point.x,point.y);
      check(!await q.locator('#sb-confirm').isDisabled(),edition+' open site accepts building selection');
      const built=await awaitFrame(()=>q.locator('#sb-confirm').click());
      check(built.scene.additions.length===1&&built.summary.changed_cells>0,edition+' building changes computed cells');
      check(built.valid_time===day.valid_time,edition+' building reuses chosen forecast hour');
      check(built.scene_sha256!==day.scene_sha256,edition+' new geometry has new digest');
      await q.locator('#sb-report').click();
      check((await q.locator('#sb-report-content').innerText()).includes(built.report_sha256),edition+' report displays same building result');
      await q.locator('#sb-report-close').click();
      await q.setViewportSize({width:390,height:700});
      check(await q.locator('#screen-forecast-hour').isVisible(),edition+' forecast control visible on mobile');
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' mobile forecast fits');
      await q.screenshot({path:'output/playwright/forecast-'+edition+'-mobile.png'});
      const current=q.waitForResponse(r=>endpoint(r)&&!r.request().postDataJSON().valid_time,{timeout:120000});
      await q.locator('#screen-forecast-current').click();const restored=await(await current).json();
      await q.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,restored.report_sha256,{timeout:120000});
      check(!restored.is_forecast&&restored.scene.additions.length===1,edition+' returning current keeps edits');
      await q.setViewportSize({width:1440,height:960});
      await awaitFrame(()=>q.locator('#sb-data-mode').selectOption('live'));
      const liveForecast=await awaitFrame(()=>q.locator('#screen-forecast-hour').fill('2'));
      await q.locator('#sb-layer').selectOption('weather');
      const liveCells=await q.evaluate(async()=>(await window.__forecastQA.map.getSource('sandbox-heat').getData()).features);
      check(liveCells.length>1&&liveCells.every(f=>f.properties.time===liveForecast.valid_time),edition+' public weather mode retains same-hour forecast support cells');
    }catch(error){await q.screenshot({path:'output/playwright/forecast-'+edition+'-failure.png'});throw error;}
    finally{await context.close();}
  }
  check(!errors.length,'no forecast runtime exceptions');return {checks,errors,evidence};
}
