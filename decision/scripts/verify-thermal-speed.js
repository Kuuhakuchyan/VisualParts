async page=>{
  const checks=[],records=[],errors=[];
  const origin=new URL(page.url()).origin,local=['127.0.0.1','localhost'].includes(new URL(origin).hostname);
  for(const edition of ['project','competition']){
    const base=local?origin+(edition==='competition'?'/aic/':'/'):edition==='competition'?'https://aic.nogamenolife.cn/aic/':'https://weather.nogamenolife.cn/decision/';
    const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),q=await context.newPage();
    q.on('pageerror',error=>errors.push(error.message));
    try{
      const started=Date.now();await q.goto(base+'#screen');
      await q.locator('.sandbox-legend[data-valid-cells]:not([data-valid-cells="0"])').waitFor({timeout:60000});
      const initial_heat_ms=Date.now()-started;
      await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-auto').uncheck();
      await q.evaluate(async()=>{
        const url=performance.getEntriesByType('resource').map(r=>r.name).find(u=>/\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));
        const {LayoutSandbox}=await import(url),paint=LayoutSandbox.prototype.paint;
        window.__thermalFrames={};
        document.querySelector('#screen-forecast-hour').addEventListener('input',()=>window.__thermalFrameStart=performance.now(),{capture:true});
        LayoutSandbox.prototype.paint=function(...args){
          window.__thermalSpeed=this;const result=paint.apply(this,args);
          if(this.result&&window.__thermalFrameStart&&!window.__thermalFrames[this.result.report_sha256]){
            const record=window.__thermalFrames[this.result.report_sha256]={paint_ms:performance.now()-window.__thermalFrameStart};
            const started=window.__thermalFrameStart;
            this.map.once('idle',()=>record.map_idle_ms=performance.now()-started);
          }
          return result;
        };
      });
      await q.locator('#sb-layer').selectOption('risk');
      const redraw=await q.evaluate(()=>{
        const s=window.__thermalSpeed,a=s.map.getSource('sandbox-heat'),b=s.map.getSource('sandbox-heat-coverage');
        const counts={heat:0,coverage:0},original=[a.setData,b.setData];
        a.setData=function(...args){counts.heat++;return original[0].apply(this,args);};
        b.setData=function(...args){counts.coverage++;return original[1].apply(this,args);};
        const started=performance.now();for(let i=0;i<20;i++)s.paint();
        a.setData=original[0];b.setData=original[1];
        return {ms:performance.now()-started,counts,cells:s.displayCells.length};
      });
      const frames=[];
      await q.locator('#screen-forecast-hour:not([disabled])').waitFor({timeout:60000});
      for(const hour of ['0','1','0']){
        const response=q.waitForResponse(r=>r.url().endsWith('/sandbox/simulate'),{timeout:120000}),start=Date.now();
        let submitted=0;const onRequest=r=>{if(r.url().endsWith('/sandbox/simulate'))submitted=Date.now();};q.on('request',onRequest);
        await q.locator('#screen-forecast-hour').fill(hour);
        const r=await response,received=Date.now(),body=await r.json(),parsed=Date.now();q.off('request',onRequest);if(!r.ok())throw Error(JSON.stringify(body));
        await q.waitForFunction(hash=>document.querySelector('#workspace-map').dataset.resultSha256===hash,body.report_sha256,{timeout:60000});
        const actual=await q.evaluate(async()=>window.__thermalSpeed.map.getSource('sandbox-heat').getData());
        const expected=body.cells.features.flatMap((f,i)=>Number.isFinite(f.properties.proposed_utci_c)?[{id:i,value:f.properties.proposed_utci_c}]:[]);
        if(JSON.stringify(actual.features.map(f=>({id:f.id,value:f.properties.value})))!==JSON.stringify(expected))throw Error('display/API mismatch');
        const browser=await q.evaluate(hash=>window.__thermalFrames[hash],body.report_sha256);
        frames.push({hour,automation_ms:Date.now()-start,browser,submit_ms:submitted-start,headers_ms:received-submitted,body_ms:parsed-received,update_ms:Date.now()-parsed,timing:r.request().timing(),valid_time:body.valid_time,cells:body.cells.features.length,values:expected});
        checks.push(edition+' hour '+hour+' displayed grid equals API');
      }
      if(JSON.stringify(frames[0].values)!==JSON.stringify(frames[2].values))throw Error('revisited hour changed values');
      checks.push(edition+' revisiting forecast reuses identical numerical evidence');
      records.push({edition,initial_heat_ms,redraw,frames:frames.map(({values,...frame})=>frame)});
    }finally{await context.close();}
  }
  if(errors.length)throw Error(JSON.stringify(errors));
  return {checks,errors,records};
}
