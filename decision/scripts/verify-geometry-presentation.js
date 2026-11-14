async (page) => {
  if(!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname))throw new Error('Module instrumentation is local-only');
  const checks=[];
  const check=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage();
  try{
    await qa.goto(new URL(page.url()).origin+'/#screen');
    await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
    await qa.locator('#sb-auto').uncheck();
    await qa.evaluate(async()=>{
      const loaded=performance.getEntriesByType('resource').map(r=>r.name);
      const sandboxURL=loaded.findLast(url=>new URL(url).pathname==='/frontend/workspace/sandbox.js');
      const mapURL=loaded.findLast(url=>new URL(url).pathname==='/frontend/workspace/map.js');
      if(!sandboxURL||!mapURL)throw new Error('Cannot identify the actual loaded Vite modules');
      const {LayoutSandbox}=await import(sandboxURL);
      const {SpatialWorkspace}=await import(mapURL);
      window.qaGeometryWrites=0;window.qaSceneUpdates=0;
      const update=LayoutSandbox.prototype.updateScene;
      LayoutSandbox.prototype.updateScene=function(...args){
        window.qaSceneUpdates++;
        const source=this.map.getSource('campus-buildings'),write=source.setData;
        source.setData=function(...values){window.qaGeometryWrites++;return write.apply(this,values);};
        try{return update.apply(this,args);}finally{source.setData=write;}
      };
      const buildings=SpatialWorkspace.prototype.setBuildings;
      SpatialWorkspace.prototype.setBuildings=function(...args){
        const result=buildings.apply(this,args);
        window.qaVisibility=Object.fromEntries(['campus-building','campus-picking','sandbox-ghost-fill','sandbox-preview-fill','sandbox-selection-outline'].map(id=>[id,this.map.getLayoutProperty(id,'visibility')]));
        return result;
      };
    });
    for(let i=0;i<4;i++)for(const layer of ['weather','risk','shade','mrt','utci','off'])await qa.locator('#sb-layer').selectOption(layer);
    check(await qa.evaluate(()=>window.qaSceneUpdates>=24),'instrumentation observes the actual mounted sandbox, including Vite module version queries');
    check(await qa.evaluate(()=>window.qaGeometryWrites===0),'24 metric changes do not resubmit unchanged building geometry to the renderer');
    await qa.locator('[data-mode="delta"]').click();await qa.locator('[data-return-weather]').click();
    check(await qa.evaluate(()=>window.qaGeometryWrites===0),'returning from delta to weather does not rebuild unchanged 3D geometry');
    await qa.locator('[data-mode="baseline"]').click();
    const written=await qa.evaluate(()=>window.qaGeometryWrites);
    await qa.locator('[data-mode="baseline"]').click();
    check(await qa.evaluate(()=>window.qaGeometryWrites)===written,'reclicking a selected view does not issue a duplicate geometry update');
    await qa.locator('#dock-tab-layers').click();await qa.locator('#layer-buildings').uncheck();
    check(await qa.evaluate(()=>Object.values(window.qaVisibility).every(v=>v==='none')),'hiding buildings also hides demolition ghosts, previews, picking, and selection outlines');
    await qa.locator('#dock-tab-sandbox').click();await qa.locator('#sb-show-weather').click();
    check(!await qa.locator('#layer-buildings').isChecked(),'weather recovery respects an explicitly hidden building layer');
    await qa.locator('[data-operation="add"]').click();
    check(await qa.evaluate(()=>Object.values(window.qaVisibility).every(v=>v==='visible')),'explicit building tool restores all required building overlays together');
    check(await qa.locator('#layer-buildings').isChecked(),'building visibility checkbox agrees with restored geometry');
    await qa.keyboard.press('Escape');
    return {checks,note:'Local-only observation of actual renderer calls through exported module methods. Instrumentation is discarded with the isolated browser context.'};
  }finally{await context.close();}
}
