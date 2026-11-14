async page=>{
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname);
  const checks=[],evidence=[],errors=[];
  const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  for(const edition of ['project','competition']){
    const url=local?origin+(edition==='competition'?'/aic/':'/'):edition==='competition'?'https://aic.nogamenolife.cn/aic/':'https://weather.nogamenolife.cn/decision/';
    const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),q=await context.newPage();
    q.on('pageerror',error=>errors.push(error.message));
    try{
      await q.goto(url+'#screen');
      await q.locator('.sandbox-legend[data-valid-cells]:not([data-valid-cells="0"])').waitFor({timeout:60000});
      await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-auto').uncheck();
      await q.evaluate(async()=>{
        const url=performance.getEntriesByType('resource').map(r=>r.name).find(u=>/\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));
        const {LayoutSandbox}=await import(url),paint=LayoutSandbox.prototype.paint;
        LayoutSandbox.prototype.paint=function(...args){window.__accuracy=this;return paint.apply(this,args);};
      });
      await q.locator('#sb-layer').selectOption('weather');
      const temperatureScale=await q.evaluate(()=>window.__accuracy.map.getPaintProperty('sandbox-heat-fill','fill-color'));
      await q.locator('[data-screen-panel="risk"]').first().click();
      await q.locator('#region-mode').selectOption('history');await q.locator('#region-ai').uncheck();
      const assessed=q.waitForResponse(r=>r.url().endsWith('/aic/regional-assess'),{timeout:120000});
      await q.locator('#regional-submit').click();check((await assessed).ok(),edition+' historical boundary loads');await q.keyboard.press('Escape');
      const endpoint=r=>r.url().endsWith('/sandbox/simulate')&&r.request().method()==='POST';
      const calculated=async action=>{
        const pending=q.waitForResponse(endpoint,{timeout:120000});await action();const r=await pending,body=await r.json();
        check(r.ok(),edition+' numerical endpoint succeeds');
        await q.waitForFunction(hash=>document.querySelector('#workspace-map').dataset.resultSha256===hash,body.report_sha256,{timeout:120000});
        return body;
      };
      await calculated(()=>q.locator('#sb-auto').check());
      check(await q.locator('#sb-layer').inputValue()==='weather',edition+' no-edit run preserves temperature metric');
      check(JSON.stringify(await q.evaluate(()=>window.__accuracy.map.getPaintProperty('sandbox-heat-fill','fill-color')))===JSON.stringify(temperatureScale),edition+' weather color scale independent of historical temperatures');
      await q.locator('#map-home').click();await q.waitForTimeout(1100);
      await q.locator('[data-mode="edit"]').click();await q.locator('[data-operation="add"]').click();
      for(const id of ['width','depth'])await q.locator('#sb-'+id).fill('20');await q.locator('#sb-height').fill('18');
      const point=await q.evaluate(()=>{const s=window.__accuracy,r=document.querySelector('#workspace-map').getBoundingClientRect(),p=s.map.project([113.528143,34.813813]);return {x:r.left+p.x,y:r.top+p.y};});
      await q.mouse.click(point.x,point.y);check(!await q.locator('#sb-confirm').isDisabled(),edition+' open location accepts building');
      const built=await calculated(()=>q.locator('#sb-confirm').click());
      check(built.schema_version==='solar-layout-screening-1.5',edition+' uses updated physical model');
      check(await q.locator('.sandbox-legend').getAttribute('data-display-mode')==='edit'&&await q.locator('#sb-layer').inputValue()==='weather',edition+' construction preserves the selected weather metric');
      check(await q.locator('#workspace-map').getAttribute('data-interaction')==='add',edition+' computation preserves the explicitly selected construction interaction');
      check(built.summary.changed_cells>0&&built.summary.changed_cells<built.cells.features.length/2,edition+' building has local resolved effects');
      check(built.cells.features.every(f=>f.properties.delta_utci_c===null||f.properties.delta_utci_c<=0.0001),edition+' opaque shading does not invent regional warming');
      await q.locator('[data-mode="delta"]').click();
      const actual=await q.evaluate(()=>window.__accuracy.map.getSource('sandbox-heat').getData());
      check(actual.features.every(f=>f.properties.value===built.cells.features[f.id].properties.delta_utci_c),edition+' displayed change equals API cell values');
      const differenceScale=await q.evaluate(()=>window.__accuracy.map.getPaintProperty('sandbox-heat-fill','fill-color'));
      check(JSON.stringify(differenceScale.filter(x=>typeof x==='number'))===JSON.stringify([-5,-2,-0.1,0.1,2,5]),edition+' difference uses fixed degree scale');
      await q.screenshot({path:'output/playwright/thermal-accuracy-'+edition+'-difference.png'});
      await q.locator('[data-mode="proposed"]').click();await q.locator('#sb-layer').selectOption('utci');
      const absolute=await q.evaluate(()=>window.__accuracy.map.getSource('sandbox-heat').getData());
      check(absolute.features.every(f=>f.properties.value===built.cells.features[f.id].properties.proposed_utci_c),edition+' explicit absolute UTCI remains correct');
      await q.locator('[data-mode="baseline"]').click();
      const baseline=await q.evaluate(()=>window.__accuracy.map.getSource('sandbox-heat').getData());
      check(baseline.features.every(f=>f.properties.value===built.cells.features[f.id].properties.baseline_utci_c),edition+' same-boundary baseline remains correct');
      await q.locator('[data-mode="delta"]').click();
      check(JSON.stringify(await q.evaluate(()=>window.__accuracy.map.getPaintProperty('sandbox-heat-fill','fill-color')))===JSON.stringify(differenceScale),edition+' revisiting difference retains fixed colors');
      await q.locator('#sb-report').click();check((await q.locator('#sb-report-content').innerText()).includes(built.report_sha256),edition+' report uses same calculation');await q.locator('#sb-report-close').click();
      await q.setViewportSize({width:390,height:844});
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' mobile has no page overflow');
      await q.screenshot({path:'output/playwright/thermal-accuracy-'+edition+'-mobile.png'});
      evidence.push({edition,summary:built.summary,weather:built.weather_boundary.observed_at,model:built.schema_version,sha:built.report_sha256});
    }finally{await context.close();}
  }
  check(!errors.length,'no runtime errors');return {checks,errors,evidence};
}
