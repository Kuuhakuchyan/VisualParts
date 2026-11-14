async page=>{
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const q=await context.newPage();
  try{
    await q.goto('http://127.0.0.1:5173/#screen');
    await q.locator('.sandbox-legend[data-valid-cells]:not([data-valid-cells="0"])').waitFor({timeout:60000});
    await q.evaluate(async()=>{
      const url=performance.getEntriesByType('resource').map(r=>r.name).find(u=>/\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));
      const {LayoutSandbox}=await import(url),paint=LayoutSandbox.prototype.paint;
      LayoutSandbox.prototype.paint=function(...args){window.__expirySandbox=this;return paint.apply(this,args);};
    });
    await q.locator('#dock-tab-sandbox').click();
    await q.locator('#sb-layer').selectOption('weather');
    return await q.evaluate(()=>{
      const s=window.__expirySandbox,heat=s.heat,realNow=Date.now,stamp=realNow();
      const source=s.map.getSource('sandbox-heat'),setData=source.setData;
      const checks=[];
      const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
      let submissions=0;
      source.setData=function(...args){submissions++;return setData.apply(this,args);};
      try{
        s.heat=structuredClone(heat);
        for(const f of s.heat.cells.features)f.properties.time=new Date(stamp).toISOString();
        s.paint();
        check(Number(s.legend.dataset.validCells)>0,'fresh weather is visible');
        submissions=0;s.paint();
        check(submissions===0,'unchanged fresh data skips worker submission');
        Date.now=()=>stamp+7200002;
        s.paint();
        check(submissions===1,'expiry invalidates unchanged-data guard');
        check(Number(s.legend.dataset.validCells)===0,'expired weather is no longer presented as current');
        Date.now=realNow;submissions=0;
        s.paint();
        check(submissions===1&&Number(s.legend.dataset.validCells)>0,'clock recovery restores valid weather');
        return {checks};
      }finally{
        Date.now=realNow;source.setData=setData;s.heat=heat;s.paint();
      }
    });
  }finally{await context.close();}
}
