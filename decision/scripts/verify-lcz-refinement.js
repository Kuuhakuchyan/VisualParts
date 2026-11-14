async page => {
  const origin=new URL(page.url()).origin,local=['localhost','127.0.0.1'].includes(new URL(origin).hostname),base=local?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage();
  const checks=[],errors=[],results=[];
  const check=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  const response=path=>qa.waitForResponse(r=>r.url().split('?')[0].endsWith(path)&&r.request().method()==='POST',{timeout:120000});
  qa.on('pageerror',error=>errors.push(error.message));
  try{
    for(const edition of ['', 'aic/']){
      const name=edition?'competition':'project';
      const pending=response('/sandbox/heatmap');
      await qa.goto(origin+base+edition+'#screen',{waitUntil:'domcontentloaded'});
      const initial=await pending;check(initial.ok(),name+' default heat request succeeds');
      const initialHeat=await initial.json();
      await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
      await qa.locator('#sb-auto').uncheck();
      const data=await (await qa.request.get(origin+base+'data/campus-lcz-simulation.geojson')).json();
      const model=await (await qa.request.get(origin+'/api/weather/sandbox/lcz-metadata')).json();
      check(data.metadata.classification_sha256===model.classification_sha256,name+' static classification equals backend');
      check(initialHeat.simulation.classification_sha256===model.classification_sha256,name+' initial heat uses refined classification');
      check([5,9,15,17].every(code=>model.available_class_codes.includes(code)),name+' open/sparse buildings roads and water available');
      check(model.profiles.filter(p=>[5,9].includes(p.lcz_code)).every(p=>p.proxy_profile_code===2),name+' built parameter proxies disclosed');
      check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>2000,name+' current heat has full campus coverage with explicit gaps');
      await qa.locator('.screen-nav [data-screen-panel="risk"]').click();
      await qa.locator('#region-ai').uncheck();
      const historyPending=response('/sandbox/heatmap');
      await qa.locator('#region-mode').selectOption('history');
      const historyResponse=await historyPending;check(historyResponse.ok(),name+' historical refined heat succeeds');
      const heat=await historyResponse.json();
      await qa.locator('#screen-panel-close').click();
      await qa.locator('#screen-drawer').waitFor({state:'hidden'});
      check(heat.simulation.classification_sha256===data.metadata.classification_sha256,name+' historical heat uses same classification');
      const temperatures=heat.cells.features.map(f=>f.properties.temperature_c).filter(Number.isFinite);
      check(Math.max(...temperatures)-Math.min(...temperatures)>1,name+' LCZ types change actual simulation temperature');
      check(heat.cells.features.some(f=>f.properties.lcz_fractions['15']>.5),name+' paved cells participate in numerical simulation');
      const run=response('/sandbox/simulate');await qa.locator('#sb-auto').check();
      const computedResponse=await run;check(computedResponse.ok(),name+' historical automatic simulation succeeds');
      const result=await computedResponse.json();
      await qa.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,result.report_sha256,{timeout:120000});
      check(result.lcz_snapshot_sha256===heat.snapshot_sha256,name+' simulation and weather snapshot identical');
      check(result.regional_report.snapshot_sha256===heat.snapshot_sha256,name+' report and heat snapshot identical');
      const byId=new Map(heat.cells.features.map(f=>[f.id,f.properties]));
      check(result.cells.features.filter(f=>f.properties.source_grid_id).every(f=>{
        const source=byId.get(f.properties.source_grid_id);
        return source.temperature_c===f.properties.air_temperature_c&&source.humidity_pct===f.properties.humidity_pct;
      }),name+' layout calculation uses displayed grid temperatures and humidity');
      await qa.locator('#sb-report').click();
      check((await qa.locator('#sb-report-content').textContent()).includes(result.lcz_snapshot_sha256.slice(0,12)),name+' rendered report references exact snapshot');
      await qa.locator('#sb-report-close').click();
      await qa.locator('#sb-show-weather').click();
      check(await qa.locator('.sandbox-legend').getAttribute('data-total-cells')==='2610',name+' returning to weather retains fine heat grid');
      await qa.screenshot({path:'output/playwright/lcz-refinement-'+name+'-desktop.png'});
      await qa.setViewportSize({width:390,height:844});
      await qa.locator('.sandbox-mobile-toggle').click();
      check(await qa.locator('#sb-data-mode').isVisible(),name+' phone simulation controls visible');
      check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' phone has no page overflow');
      if(edition)check(!/郑州大学|指导教师|指导老师|闫梓宇/.test(await qa.locator('body').innerText()),'competition remains anonymous');
      await qa.locator('.sandbox-mobile-close').click();
      await qa.screenshot({path:'output/playwright/lcz-refinement-'+name+'-mobile.png'});
      check(await qa.locator('#workspace-map canvas').evaluate(c=>c.width>300&&c.height>300),name+' phone map canvas has valid dimensions');
      await qa.setViewportSize({width:1440,height:960});
      results.push({edition:name,classification_sha256:model.classification_sha256,snapshot_sha256:result.lcz_snapshot_sha256,
        report_sha256:result.report_sha256,grid_cells:heat.cells.features.length,temperature_range:[Math.min(...temperatures),Math.max(...temperatures)]});
    }
    check(errors.length===0,'no uncaught browser errors');
    return {checks,errors,results};
  }catch(error){await qa.screenshot({path:'output/playwright/lcz-refinement-failure.png'}).catch(()=>{});throw new Error(error.message+' '+JSON.stringify({checks,errors,status:await qa.locator('#sb-status').textContent().catch(()=>null)}));}
  finally{await context.close();}
}
