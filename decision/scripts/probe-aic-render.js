async page=>{
 const errors=[];page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
 await page.reload();await page.waitForTimeout(6500);
 await page.locator('#sb-auto').waitFor({state:'attached'});
 await page.evaluate(async()=>{const url=performance.getEntriesByType('resource').map(r=>r.name).find(u=>/\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));const{LayoutSandbox}=await import(url),paint=LayoutSandbox.prototype.paint;LayoutSandbox.prototype.paint=function(...args){window.__probe=this;return paint.apply(this,args);};});
 await page.locator('#dock-tab-sandbox').click();await page.locator('#sb-layer').selectOption('weather');
 const map=await page.evaluate(async()=>{const s=window.__probe,m=s.map;return{layers:m.getStyle().layers.filter(l=>/heat|road|landcover|boundary/.test(l.id)).map(l=>({id:l.id,visible:l.layout?.visibility,source:l.source})),heat:(await m.getSource('sandbox-heat').getData()).features.length,rendered:m.queryRenderedFeatures().length,worker:performance.getEntriesByType('resource').filter(r=>/worker|tile|geojson/.test(r.name)).map(r=>({name:r.name,status:r.responseStatus,size:r.transferSize})),dataset:document.querySelector('#workspace-map').dataset};});
 return {errors,map};
}
