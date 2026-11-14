async (page) => {
  const origin=new URL(page.url()).origin;
  if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Local module observation only');
  const checks=[],errors=[];
  const check=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage();qa.on('pageerror',e=>errors.push(e.message));
  try{
    for(const edition of ['', 'aic/']){
      await qa.goto(origin+'/'+edition+'#screen');
      await qa.locator('#sb-auto').waitFor({timeout:60000});await qa.locator('#sb-auto').uncheck();
      await qa.evaluate(async()=>{
        const url=performance.getEntriesByType('resource').map(r=>r.name).findLast(url=>new URL(url).pathname==='/frontend/workspace/sandbox.js');
        const {LayoutSandbox}=await import(url),original=LayoutSandbox.prototype.updateScene;
        LayoutSandbox.prototype.updateScene=function(...args){window.thermalQA=this;return original.apply(this,args);};
      });
      await qa.locator('#sb-layer').selectOption('utci');
      await qa.evaluate(()=>window.thermalQA.map.jumpTo({center:[113.528143,34.813813],zoom:17,pitch:45,bearing:0}));
      await qa.locator('[data-operation="add"]').click();
      for(const id of ['width','depth'])await qa.locator('#sb-'+id).fill('20');await qa.locator('#sb-height').fill('60');
      const pixel=await qa.evaluate(()=>{const m=window.thermalQA.map,p=m.project([113.528143,34.813813]),b=m.getCanvas().getBoundingClientRect();return [p.x+b.x,p.y+b.y];});
      await qa.mouse.click(...pixel);const validation=qa.waitForResponse(r=>r.url().endsWith('/sandbox/validate'));
      await qa.locator('#sb-confirm').click();check((await validation).ok(),edition+' UI construction accepted');
      await qa.waitForFunction(()=>window.thermalQA.scene.additions.length===1&&!window.thermalQA.validating);
      for(const mode of ['proposed','delta','edit','baseline','proposed']){
        await qa.locator('[data-mode="'+mode+'"]').click();
        const state=await qa.evaluate(async()=>{const s=window.thermalQA;return {mode:s.mode,count:(await s.map.getSource('sandbox-proposed').getData()).features.length,
          visible:s.map.getLayoutProperty('sandbox-proposed-fill','visibility'),preview:(await s.map.getSource('sandbox-preview').getData()).features.length,
          modelNew:[...s.workspace.modelLayer.featureGroups.keys()].filter(id=>String(id).startsWith('new-')).length};});
        check(state.mode===mode,edition+' '+mode+' selected');
        check(state.count===(mode==='baseline'?0:1),edition+' '+mode+' persistent geometry agrees');
        check(state.visible==='visible'&&state.modelNew===0,edition+' '+mode+' independent extrusion without duplicate mesh');
        check(state.preview===0,edition+' '+mode+' not relying on temporary preview');
      }
      await qa.waitForTimeout(600);
      await qa.screenshot({path:'output/playwright/proposed-persistent-'+(edition?'competition':'project')+'.png'});
      await qa.locator('#dock-tab-layers').click();await qa.locator('#layer-buildings').uncheck();
      check(await qa.evaluate(()=>window.thermalQA.map.getLayoutProperty('sandbox-proposed-fill','visibility'))==='none',edition+' explicit hide affects proposals');
      await qa.locator('#layer-buildings').check();await qa.locator('#dock-tab-sandbox').click();
      await qa.setViewportSize({width:390,height:844});
      await qa.evaluate(()=>window.thermalQA.map.resize());
      check(await qa.evaluate(async()=>(await window.thermalQA.map.getSource('sandbox-proposed').getData()).features.length)===1,edition+' mobile keeps proposal');
      check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' mobile fits');
      await qa.screenshot({path:'output/playwright/proposed-persistent-'+(edition?'competition':'project')+'-mobile.png'});
      await qa.setViewportSize({width:1440,height:960});
    }
    check(errors.length===0,'no runtime errors');
    return {checks,errors,note:'Actual source and renderer state, no mocked API. Isolated UI scenes are not saved.'};
  }finally{await context.close();}
}
