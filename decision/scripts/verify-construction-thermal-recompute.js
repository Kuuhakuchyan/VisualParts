async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage(),checks=[],errors=[],stages=[],responses=[],images=[];
  const origin=new URL(page.url()).origin;
  const base=new URL(page.url()).pathname.replace(/index\.html$/,'');
  const edition=new URL(page.url()).pathname.includes('/aic/')?'competition':'project';
  const artifact=name=>'construction-thermal-'+edition+'-'+name;
  const capture=async(file,title)=>{
    await qa.mouse.move(0,0);
    await qa.screenshot({path:'output/playwright/copyright-v1/'+file});
    images.push({file,title,url:qa.url(),viewport:qa.viewportSize(),role:'synthetic-workflow-acceptance'});
  };
  const check=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  qa.on('pageerror',e=>errors.push(e.message));
  const endpoint=r=>r.url().endsWith('/sandbox/simulate')&&r.request().method()==='POST';
  const calculate=async(name,action)=>{
    const started=Date.now(),pending=qa.waitForResponse(endpoint,{timeout:120000});
    await action();
    const response=await pending,body=await response.json();
    check(response.ok(),name+' API succeeds: '+(body.detail||response.status()));
    await qa.waitForFunction(hash=>document.querySelector('#workspace-map')?.dataset.resultSha256===hash,body.report_sha256,{timeout:120000});
    check(await qa.locator('#workspace-map').getAttribute('data-scene-sha256')===body.scene_sha256,name+' displayed scene matches response');
    check(body.regional_report.layout_exposure.scene_sha256===body.scene_sha256,name+' linked regional report matches scene');
    check(!(await qa.locator('#sb-report').isDisabled()),name+' latest report is available');
    check(body.cells.features.length>1,name+' returns spatial grid');
    responses.push({name,request:response.request().postDataJSON(),response:body});
    stages.push({name,ms:Date.now()-started,scene_sha256:body.scene_sha256,report_sha256:body.report_sha256,
      summary:body.summary,solar:body.solar,weather_time:body.weather_boundary.observed_at});
    return body;
  };
  const compare=(a,b)=>{
    check(a.cells.features.length===b.cells.features.length,'comparison uses identical cell count');
    check(a.cells.features.every((f,i)=>JSON.stringify(f.geometry)===JSON.stringify(b.cells.features[i].geometry)),'comparison uses identical per-cell geometry');
    const keys=['mrt_c','utci_c','shade','occupied','svf'];
    const counts=Object.fromEntries(keys.map(k=>[k,0]));let air=0,humidity=0;const delta=[];
    a.cells.features.forEach((f,i)=>{
      const p=f.properties,q=b.cells.features[i].properties;
      for(const key of keys)if(p['proposed_'+key]!==q['proposed_'+key])counts[key]++;
      if(p.air_temperature_c!==q.air_temperature_c)air++;
      if(p.humidity_pct!==q.humidity_pct)humidity++;
      if(Number.isFinite(p.proposed_utci_c)&&Number.isFinite(q.proposed_utci_c))delta.push(q.proposed_utci_c-p.proposed_utci_c);
    });
    return {...counts,air_temperature:air,humidity,utci_delta_min:Math.min(...delta),utci_delta_max:Math.max(...delta)};
  };
  const saveEvidence=async(name,data)=>{
    const pending=qa.waitForEvent('download');
    await qa.evaluate(({name,data})=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},{name,data});
    await (await pending).saveAs('output/playwright/'+name);
  };
  const selectProposed=async(point)=>{
    await qa.locator('[data-mode="edit"]').click();
    if(await qa.locator('#workspace-map').getAttribute('data-interaction')!=='select')await qa.locator('[data-operation="select"]').click();
    await qa.mouse.click(...point);
    check(!(await qa.locator('#sb-edit').isDisabled()),'proposed building can be selected at footprint');
  };
  try{
    await qa.goto(origin+base+'#screen',{waitUntil:'domcontentloaded'});
    await qa.locator('#sb-auto').waitFor({state:'attached',timeout:60000});
    await qa.locator('#dock-tab-sandbox').click();
    await qa.locator('#workspace-map[data-buildings="225"]').waitFor({timeout:60000});
    await qa.locator('#sb-auto').uncheck();
    await qa.evaluate(async()=>{
      const moduleURL=performance.getEntriesByType('resource').map(r=>r.name).find(url=>/\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(url));
      if(!moduleURL)throw new Error('Loaded sandbox module not found');
      const {LayoutSandbox}=await import(moduleURL),paint=LayoutSandbox.prototype.paint;
      LayoutSandbox.prototype.paint=function(...args){window.__thermalQA=this;return paint.apply(this,args);};
    });
    check((await qa.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'),'isolated QA scene starts empty');
    await qa.locator('#map-home').click();await qa.waitForTimeout(1500);
    if(await qa.locator('#map-pitch').getAttribute('aria-pressed')==='true')await qa.locator('#map-pitch').click();
    await qa.waitForTimeout(1000);
    await qa.locator('[data-operation="add"]').click();
    for(const id of ['width','depth'])await qa.locator('#sb-'+id).fill('20');
    await qa.locator('#sb-height').fill('18');
    let placed=null,building=null;
    for(const point of [[710,440],[680,400],[770,400],[660,480],[740,510],[810,460],[610,400],[820,530],[740,350],[600,520]]){
      await qa.mouse.click(...point);
      if(await qa.locator('#sb-confirm').isDisabled())continue;
      const pending=qa.waitForResponse(r=>r.url().endsWith('/sandbox/validate'));
      await qa.locator('#sb-confirm').click();const r=await pending;
      await qa.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
      if(r.ok()){placed=point;building=r.request().postDataJSON().additions[0];break;}
    }
    check(placed,'collision-checked building created through public UI');
    await qa.locator('#sb-undo').click();
    const lon=building.longitude,lat=building.latitude;
    check(Number.isFinite(lon)&&Number.isFinite(lat),'capture exact proposed position');
    const bounds={west:lon-0.0025,east:lon+0.0025,south:lat-0.002,north:lat+0.002};
    await qa.locator('[data-screen-panel="risk"]').first().click();
    await qa.locator('#region-mode').selectOption('history');
    for(const [k,v] of Object.entries(bounds))await qa.locator('#bound-'+k).fill(String(v));
    await qa.locator('#region-ai').uncheck();
    const assessed=qa.waitForResponse(r=>r.url().endsWith('/aic/regional-assess'),{timeout:120000});
    await qa.locator('#regional-submit').click();check((await assessed).ok(),'regional setup accepts current-weather subregion');
    await qa.keyboard.press('Escape');
    await qa.locator('#sb-resolution').selectOption('25');
    const baseline=await calculate('baseline',()=>qa.locator('#sb-auto').check());
    await qa.locator('[data-mode="baseline"]').click();
    await capture('11-sandbox-baseline.png','建筑干预前的模拟热场');
    const built=await calculate('build18m',()=>qa.locator('#sb-redo').click());
    check(built.scene.additions.length===1&&built.scene.additions[0].height_m===18,'18m geometry included in inference');
    const first=compare(baseline,built);
    await qa.locator('[data-mode="proposed"]').click();
    await capture('12-sandbox-built.png','新增建筑与重新计算的模拟热场');
    check(first.mrt_c+first.occupied>0,'construction changes radiative field or occupied samples');
    check(built.solar.altitude_deg>=2,'effect acceptance uses explicit daylight boundary');
    check(built.summary.changed_cells>0&&first.utci_c>0,'construction changes finite UTCI values, not only geometry');
    await selectProposed(placed);
    await qa.locator('#sb-height').fill('60');
    const tall=await calculate('height60m',async()=>{
      await qa.locator('#sb-edit').click();
      await qa.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
    });
    check(tall.scene.additions[0].height_m===60,'60m height reaches numerical model');
    const heightChange=compare(built,tall);
    check(heightChange.mrt_c+heightChange.shade+heightChange.svf>0,'height change alters spatial radiative results');
    check(heightChange.utci_c>0,'height edit changes finite UTCI values');
    check(built.scene_sha256!==tall.scene_sha256&&built.report_sha256!==tall.report_sha256,'height edit creates fresh scene and result digests');
    for(const metric of ['utci','mrt','shade']){
      await qa.locator('[data-mode="proposed"]').click();await qa.locator('#sb-layer').selectOption(metric);
      check(await qa.locator('.sandbox-legend').getAttribute('data-layer')===metric,metric+' selected metric reaches map legend');
      check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>0,metric+' renders valid cells');
      check(await qa.locator('#workspace-map').getAttribute('data-result-sha256')===tall.report_sha256,metric+' displays latest height result');
      const source=await qa.evaluate(()=>window.__thermalQA.map.getSource('sandbox-heat').getData());
      const expected=tall.cells.features.flatMap((f,index)=>{
        const p=f.properties,value=metric==='shade'?(p.proposed_occupied?null:9+29*(1-p.proposed_shade_fraction)):p['proposed_'+metric+'_c'];
        return Number.isFinite(value)?[{geometry:f.geometry,value,id:index}]:[];
      });
      check(JSON.stringify(source.features.map(f=>({geometry:f.geometry,value:f.properties.value,id:f.id})))===JSON.stringify(expected),metric+' actual MapLibre source contains latest per-cell calculation values');
    }
    await qa.locator('[data-mode="delta"]').click();
    const difference=await qa.evaluate(()=>window.__thermalQA.map.getSource('sandbox-heat').getData());
    check(difference.features.some(f=>Math.abs(f.properties.value)>=0.001),'actual difference map contains nonzero values after height edit');
    check(difference.features.every(f=>f.properties.value===tall.cells.features[f.id].properties.delta_utci_c),'actual difference source matches latest API values cell by cell');
    await qa.screenshot({path:'output/playwright/'+artifact('height-difference.png')});
    await capture('13-sandbox-difference.png','同刻建筑干预前后差值');
    await qa.locator('#sb-report').click();
    check((await qa.locator('#sb-report-content').textContent()).includes(tall.report_sha256),'visible report references latest height result');
    await capture('14-sandbox-report.png','与地图结果版本一致的区域报告');
    await qa.locator('#sb-report-close').click();
    const exported=qa.waitForEvent('download');await qa.locator('#sb-export').click();
    await (await exported).saveAs('output/playwright/'+artifact('ui-export.json'));
    await qa.locator('[data-mode="edit"]').click();
    await qa.locator('[data-operation="remove"]').click();await qa.mouse.click(...placed);
    check(!(await qa.locator('#sb-confirm').isDisabled()),'built footprint selectable for demolition');
    await qa.locator('#sb-confirm').click();
    const removed=await calculate('remove',()=>qa.locator('#sb-confirm-dialog button[value="confirm"]').click());
    check(removed.scene.additions.length===0,'demolition actually removes proposed geometry');
    const restored=compare(baseline,removed);
    check(restored.mrt_c===0&&restored.utci_c===0&&restored.occupied===0&&restored.shade===0,'removing proposed building restores baseline per-cell field');
    const undone=await calculate('undoRemoval',()=>qa.locator('#sb-undo').click());
    const undoDiff=compare(tall,undone);
    check(undoDiff.mrt_c===0&&undoDiff.utci_c===0&&undoDiff.occupied===0,'undo removal recomputes same 60m field');
    const redone=await calculate('redoRemoval',()=>qa.locator('#sb-redo').click());
    const redoDiff=compare(removed,redone);
    check(redoDiff.mrt_c===0&&redoDiff.utci_c===0,'redo removal recomputes original field');
    check(first.air_temperature===0&&heightChange.air_temperature===0,'air-temperature boundary remains unchanged by current radiative model');
    check(first.humidity===0&&heightChange.humidity===0,'humidity boundary remains unchanged by current radiative model');
    await qa.locator('[data-mode="edit"]').click();
    await qa.locator('[data-operation="remove"]').click();
    let existingPoint=null;
    const candidates=await qa.evaluate(bounds=>{
      const sandbox=window.__thermalQA,rect=document.getElementById('workspace-map').getBoundingClientRect();
      return sandbox.base.features.flatMap(feature=>{
        const ring=feature.geometry.type==='Polygon'?feature.geometry.coordinates[0]:feature.geometry.coordinates[0][0];
        const lon=ring.slice(0,-1).reduce((sum,p)=>sum+p[0],0)/(ring.length-1),lat=ring.slice(0,-1).reduce((sum,p)=>sum+p[1],0)/(ring.length-1);
        if(lon<bounds.west||lon>bounds.east||lat<bounds.south||lat>bounds.north)return [];
        const point=sandbox.map.project([lon,lat]);const x=point.x+rect.left,y=point.y+rect.top;
        return x>280&&x<1100&&y>190&&y<650?[[x,y]]:[];
      });
    },bounds);
    for(const point of candidates){
      await qa.mouse.click(...point);
      if(!(await qa.locator('#sb-confirm').isDisabled())){existingPoint=point;break;}
    }
    check(existingPoint,'existing building can be selected for scenario demolition');
    await qa.locator('#sb-confirm').click();
    const existing=await calculate('removeExisting',()=>qa.locator('#sb-confirm-dialog button[value="confirm"]').click());
    check(existing.scene.removed_ids.length===1&&existing.scene.additions.length===0,'existing demolition passes correct removed ID to solver');
    const existingChange=compare(baseline,existing);
    await capture('15-existing-demolition.png','既有建筑拟拆除与热场更新');
    check(existingChange.mrt_c+existingChange.occupied+existingChange.shade>0,'existing demolition changes per-cell outdoor field');
    const restoredExisting=await calculate('undoExistingRemoval',()=>qa.locator('#sb-undo').click());
    const restoredExistingChange=compare(baseline,restoredExisting);
    check(restoredExistingChange.mrt_c===0&&restoredExistingChange.utci_c===0&&restoredExistingChange.occupied===0,'undo existing demolition restores original field');
    await qa.setViewportSize({width:390,height:844});
    await qa.locator('.screen-dock-expand').click();
    const mobileRemoved=await calculate('mobileRedoExistingRemoval',()=>qa.locator('#sb-redo').click());
    check(compare(existing,mobileRemoved).utci_c===0,'mobile redo reproduces existing demolition field');
    const mobileRestored=await calculate('mobileUndoExistingRemoval',()=>qa.locator('#sb-undo').click());
    check(compare(baseline,mobileRestored).utci_c===0,'mobile undo restores original grid');
    await qa.locator('#sb-layer').selectOption('utci');
    await qa.locator('.screen-dock-expand').click();
    check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page has no horizontal overflow');
    check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>0,'mobile map retains calculated thermal grid after closing editor');
    await qa.screenshot({path:'output/playwright/'+artifact('mobile.png')});
    await capture('16-sandbox-mobile.png','手机布局中的拆建撤销与热场恢复');
    await qa.setViewportSize({width:1440,height:960});
    check(errors.length===0,'no browser runtime exceptions');
    await qa.locator('[data-mode="proposed"]').click();await qa.locator('#sb-layer').selectOption('utci');
    await qa.screenshot({path:'output/playwright/'+artifact('after-removal.png')});
    const evidence={origin,edition,placed,building,bounds,checks,errors,stages,comparisons:{construction:first,height:heightChange,removal:restored,undo:undoDiff,redo:redoDiff,existingRemoval:existingChange,undoExisting:restoredExistingChange},responses};
    await saveEvidence(artifact('public-evidence.json'),evidence);
    return {edition,checks:checks.length,errors,stages,images,browser:page.context().browser().version(),comparisons:evidence.comparisons,responses:responses.map(r=>({name:r.name,cells:r.response.cells.features.length}))};
  }catch(error){
    await qa.screenshot({path:'output/playwright/'+artifact('failure.png')}).catch(()=>{});
    await saveEvidence(artifact('partial-evidence.json'),{checks,errors,stages,responses,error:String(error)}).catch(()=>{});
    throw error;
  }finally{await context.close();}
}
