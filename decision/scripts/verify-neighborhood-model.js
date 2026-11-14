async page => {
  const origin=new URL(page.url()).origin, local=['localhost','127.0.0.1'].includes(new URL(origin).hostname);
  const checks=[],errors=[],samples=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  for(const edition of ['project','competition']){
    const url=local?origin+(edition==='competition'?'/aic/':'/'):edition==='competition'?'https://aic.nogamenolife.cn/aic/':'https://weather.nogamenolife.cn/decision/';
    const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),q=await context.newPage();
    await q.addInitScript(()=>performance.setResourceTimingBufferSize(10000));
    const saved=[];let headers,stage='initial';
    q.on('pageerror',e=>errors.push(e.message));
    try{
      await q.goto(url+'?capture=1#screen',{waitUntil:'domcontentloaded'});
      await q.locator('#workspace-map[data-buildings="225"]').waitFor({timeout:65000});
      await q.locator('#sb-run').waitFor({state:'attached',timeout:30000});
      await q.evaluate(async()=>{
        const u=performance.getEntriesByType('resource').map(r=>r.name).find(u=>u.includes('/workspace/sandbox.js')||/\/sandbox-[^/]+\.js/.test(u));
        const {LayoutSandbox}=await import(u),paint=LayoutSandbox.prototype.paint;
        LayoutSandbox.prototype.paint=function(...args){window.__districtQA=this;return paint.apply(this,args);};
      });
      stage='district load';await q.locator('#screen-site').selectOption('zhongyuan');
      await q.locator('#workspace-map[data-area-kind="neighborhood"][data-buildings="751"][data-street-roads="139"]').waitFor({timeout:65000});
      await q.waitForFunction(()=>window.__districtQA?.scene.area_kind==='neighborhood');
      await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-auto').uncheck();
      const model=await q.evaluate(async()=>{const s=window.__districtQA;return {scene:s.scene,area:s.regional().area_kind,coverage:s.base.coverage,geometryCount:(await s.map.getSource('campus-buildings').getData()).features.length,modelCount:s.workspace.modelLayer.featureGroups.size,center:s.map.getCenter(),reference:!!s.map.getSource('reference-station'),roads:s.workspace.streetRoads};});
      check(model.area==='neighborhood'&&model.scene.area_kind==='neighborhood',edition+' scene and weather context agree');
      check(model.geometryCount===751&&model.modelCount===751,edition+' full district model reaches map and Three.js');
      check(model.coverage.simulated_buildings===0&&model.coverage.public_footprints===751,edition+' independent public footprints are used instead of invented buildings');
      check(model.roads===139&&!model.reference,edition+' district roads replace campus assets without misplaced reference station');
      check(model.center.lng>113.59&&model.center.lng<113.63&&model.center.lat>34.73&&model.center.lat<34.77,edition+' camera moves to district');
      check(!await q.locator('#sb-run').isDisabled(),edition+' covered district can run physical simulation');
      await q.locator('#map-home').click();await q.waitForTimeout(800);
      const existing=await q.evaluate(()=>{const s=window.__districtQA,r=document.getElementById('workspace-map').getBoundingClientRect();return s.base.features.filter(f=>f.geometry.coordinates[0].length===5).map(f=>{const ring=f.geometry.coordinates[0].slice(0,-1),longitude=ring.reduce((a,p)=>a+p[0],0)/4,latitude=ring.reduce((a,p)=>a+p[1],0)/4,p=s.map.project([longitude,latitude]);return {x:r.left+p.x,y:r.top+p.y};}).filter(p=>p.x>500&&p.x<1000&&p.y>230&&p.y<650).sort((a,b)=>Math.hypot(a.x-740,a.y-410)-Math.hypot(b.x-740,b.y-410))[0];});
      check(!!existing,edition+' individual public building is visible and reachable');
      stage='remove';await q.locator('[data-operation="remove"]').click();await q.mouse.click(existing.x,existing.y);
      check(await q.evaluate(()=>!!window.__districtQA.selected&&!window.__districtQA.selected.id.startsWith('new-')),edition+' actual click selects a public footprint for removal');
      await q.locator('#sb-confirm').click();await q.locator('#sb-confirm-dialog [value="confirm"]').click();await q.waitForFunction(()=>window.__districtQA.scene.removed_ids.length===1&&!window.__districtQA.validating);
      check(await q.evaluate(()=>window.__districtQA.workspace.modelLayer.featureGroups.size===750),edition+' removal affects one building rather than an entire merged block');
      stage='undo';await q.locator('#sb-undo').click();await q.waitForFunction(()=>window.__districtQA.scene.removed_ids.length===0);
      check(await q.evaluate(()=>window.__districtQA.workspace.modelLayer.featureGroups.size===751),edition+' undo restores the public building');
      const candidates=await q.evaluate(()=>{const s=window.__districtQA,r=document.getElementById('workspace-map').getBoundingClientRect();return s.base.features.map(f=>{const ring=f.geometry.coordinates[0].slice(0,-1),longitude=ring.reduce((a,p)=>a+p[0],0)/ring.length+30/91500,latitude=ring.reduce((a,p)=>a+p[1],0)/ring.length;const p=s.map.project([longitude,latitude]);return {longitude,latitude,x:r.left+p.x,y:r.top+p.y};}).filter(p=>p.x>500&&p.x<1000&&p.y>230&&p.y<650).sort((a,b)=>Math.hypot(a.x-740,a.y-410)-Math.hypot(b.x-740,b.y-410));});
      let chosen;
      for(const p of candidates.slice(0,15)){
        const response=await q.request.post(new URL('/api/weather/sandbox/validate',url).href,{data:{area_kind:'neighborhood',name:'district QA',additions:[{id:'new-probe',longitude:p.longitude,latitude:p.latitude,width_m:6,depth_m:10,height_m:90,rotation_deg:0}],removed_ids:[]}});
        if(response.ok()){chosen=p;break;}
      }
      check(!!chosen,edition+' legal district construction location exists');
      await q.locator('[data-mode="edit"]').click();await q.locator('[data-operation="add"]').click();
      await q.locator('#sb-width').fill('6');await q.locator('#sb-depth').fill('10');await q.locator('#sb-height').fill('90');
      await q.mouse.click(chosen.x,chosen.y);
      check(!await q.locator('#sb-confirm').isDisabled(),edition+' actual map click places a district proposal');
      stage='add';await q.locator('#sb-confirm').click();await q.waitForFunction(()=>window.__districtQA.scene.additions.length===1);
      const newId=await q.evaluate(()=>window.__districtQA.scene.additions[0].id);
      for(const mode of ['proposed','edit']){
        await q.locator(`[data-mode="${mode}"]`).click();
        check(await q.evaluate(async id=>{const s=window.__districtQA;return (await s.map.getSource('sandbox-proposed').getData()).features.some(f=>f.id===id)&&s.map.getLayoutProperty('sandbox-proposed-fill','visibility')!=='none';},newId),edition+' proposed building survives '+mode+' view');
      }
      await q.locator('#sb-name').fill('街区建模验收');
      const savedResponse=q.waitForResponse(r=>r.url().endsWith('/sandbox/scenes')&&r.request().method()==='POST');
      await q.locator('#sb-save').click();const response=await savedResponse,record=await response.json();
      check(response.status()===201&&record.scene.area_kind==='neighborhood',edition+' saved scene binds district geometry');saved.push(record.id);
      headers=await q.evaluate(()=>window.__districtQA.headers());
      stage='campus restore';await q.locator('#screen-site').selectOption('campus');await q.locator('#workspace-map[data-area-kind="campus"][data-buildings="225"]').waitFor({timeout:65000});
      await q.waitForFunction(()=>window.__districtQA?.scene.area_kind==='campus'&&!window.__districtQA.disposed);
      check(await q.evaluate(()=>window.__districtQA.scene.area_kind==='campus'&&window.__districtQA.scene.additions.length===0),edition+' no district edits leak into campus');
      stage='district restore';await q.locator('#screen-site').selectOption('zhongyuan');await q.locator('#workspace-map[data-buildings="751"]').waitFor({timeout:65000});
      await q.waitForFunction(()=>window.__districtQA.scene.area_kind==='neighborhood'&&window.__districtQA.scene.additions.length===1);
      check(true,edition+' unsaved district draft survives site switch');
      if(!local){
        await q.locator('[data-screen-panel="risk"]').first().click();await q.locator('#region-mode').selectOption('history');await q.locator('#region-ai').uncheck();
        const b={west:chosen.longitude-.001,east:chosen.longitude+.001,south:chosen.latitude-.001,north:chosen.latitude+.001};
        for(const [key,value] of Object.entries(b))await q.locator('#bound-'+key).fill(String(value));
        const assessment=q.waitForResponse(r=>r.url().endsWith('/aic/regional-assess'),{timeout:120000});
        await q.locator('#regional-submit').click();check((await assessment).ok(),edition+' district historical weather assessment succeeds');
        await q.keyboard.press('Escape');await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-auto').uncheck();
        const resultResponse=q.waitForResponse(r=>/\/sandbox\/(collaborate|simulate)$/.test(r.url()),{timeout:120000});
        stage='inference';await q.locator('#sb-run').click();const result=await (await resultResponse).json();
        check(result.scene?.area_kind==='neighborhood'&&result.geometry_coverage?.count===751,edition+' public calculation uses district model');
        await q.waitForFunction(()=>!!window.__districtQA.result);
        check(await q.evaluate(sha=>window.__districtQA.result.scene_sha256===sha&&document.getElementById('workspace-map').dataset.sceneSha256===sha,result.scene_sha256),edition+' map and report share API scene result');
        samples.push({edition,cells:result.cells.features.length,changed:result.cells.features.filter(f=>Math.abs(f.properties.delta_utci_c||0)>.001).length,geometry_sha256:result.geometry_sha256});
      }
      await q.locator('#map-home').click();await q.waitForTimeout(800);
      await q.screenshot({path:`output/playwright/district-${local?'local':'public'}-${edition}-desktop.png`});
      await q.setViewportSize({width:390,height:844});await q.waitForTimeout(700);
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' mobile has no document overflow');
      await q.screenshot({path:`output/playwright/district-${local?'local':'public'}-${edition}-mobile.png`});
    }catch(error){
      await q.screenshot({path:`output/playwright/district-failure-${edition}.png`});
      throw Error(error.message+' '+JSON.stringify({edition,stage,checks,state:await q.evaluate(()=>({map:document.getElementById('workspace-map')?.dataset,scene:window.__districtQA?.scene,disposed:window.__districtQA?.disposed,validating:window.__districtQA?.validating,error:document.getElementById('sb-error')?.textContent,status:document.getElementById('sb-status')?.textContent}))}));
    }finally{
      for(const id of saved){const r=await q.request.delete(new URL('/api/weather/sandbox/scenes/'+id,url).href,{headers});check(r.ok(),edition+' QA scene removed');}
      await context.close();
    }
  }
  check(!errors.length,'no JavaScript page errors');return {checks,samples,errors};
}
