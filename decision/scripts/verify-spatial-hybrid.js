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
        LayoutSandbox.prototype.paint=function(...args){window.__spatialQA=this;return paint.apply(this,args);};
      });
      await q.locator('[data-screen-panel="risk"]').first().click();await q.locator('#region-mode').selectOption('history');await q.locator('#region-ai').check();
      const assessed=q.waitForResponse(r=>r.url().endsWith('/aic/regional-assess'),{timeout:120000});
      await q.locator('#regional-submit').click();check((await assessed).ok(),edition+' historical context loads');await q.keyboard.press('Escape');
      await q.locator('#map-home').click();await q.waitForTimeout(1100);
      await q.locator('[data-mode="edit"]').click();await q.locator('[data-operation="add"]').click();
      for(const id of ['width','depth'])await q.locator('#sb-'+id).fill('20');await q.locator('#sb-height').fill('60');
      const point=await q.evaluate(()=>{const s=window.__spatialQA,r=document.querySelector('#workspace-map').getBoundingClientRect(),p=s.map.project([113.528143,34.813813]);return {x:r.left+p.x,y:r.top+p.y};});
      await q.mouse.click(point.x,point.y);check(!await q.locator('#sb-confirm').isDisabled(),edition+' construction accepts position');
      const valid=q.waitForResponse(r=>r.url().endsWith('/sandbox/validate'));await q.locator('#sb-confirm').click();check((await valid).ok(),edition+' validates actual scene');
      await q.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
      const pending=q.waitForResponse(r=>r.url().endsWith('/sandbox/collaborate'),{timeout:120000});const started=Date.now();
      await q.locator('#sb-run').click();const response=await pending,body=await response.json();
      const download=q.waitForEvent('download');
      await q.evaluate(data=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='joint-response.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},body);
      await (await download).saveAs('output/playwright/joint-calculation-'+edition+'-response.json');
      check(response.ok(),edition+' hybrid computation succeeds');
      await q.waitForFunction(hash=>document.querySelector('#workspace-map').dataset.resultSha256===hash,body.report_sha256,{timeout:120000});
      check(body.schema_version==='solar-layout-screening-1.5',edition+' latest spatial engine');
      check(body.spatial_inference.available&&body.spatial_inference.accepted_cell_scenarios>0,edition+' trained model actually infers grid values');
      check(body.neighbourhood.computed_cells===body.cells.features.length,edition+' every grid has neighbourhood calculation');
      check(body.cells.features.every(f=>f.properties.grid_id&&f.properties.baseline_neighbourhood['50']&&f.properties.proposed_neighbourhood['300']&&f.properties.neighbourhood_effect),edition+' multiscale input and physical mechanism fields complete');
      const workflow=body.orchestration,comparison=workflow.layout_comparison;
      check(comparison?.alternatives.length>=1&&comparison.alternatives.length<=3,edition+' AI-proposed height variants actually computed');
      check(comparison.reference_scene_sha256===body.scene_sha256&&comparison.weather_id===body.weather_boundary.id,edition+' variants retain exact scene reference and weather');
      check(comparison.scene_applied===false&&body.scene.additions[0].height_m===60,edition+' comparisons never overwrite user building');
      check(comparison.alternatives.every(v=>v.height_changes[0].height_m===Math.max(2,Math.min(120,Math.round(60*v.proposal.height_factor*1000)/1000))),edition+' model parameters enter physical geometry exactly');
      const proposalCall=workflow.tools.find(t=>t.name==='compare_layout_alternatives');
      check(comparison.alternatives.every(v=>proposalCall.arguments.candidates.some(p=>JSON.stringify(p)===JSON.stringify(v.proposal))),edition+' computed candidate parameters match actual AI tool arguments');
      check(workflow.schema_version==='hybrid-tool-workflow/1.2'&&workflow.baseline_numerical_sha256===workflow.numerical_sha256,edition+' physics baseline precedes parameter planning without mutating current result');
      check(workflow.stages.includes('physics_candidate_recalculation'),edition+' joint workflow includes parameter feedback calculation');
      check(comparison.alternatives.every(v=>v.summary.comparable_area_m2===body.summary.comparable_area_m2),edition+' comparison retains same outdoor area');
      if(!local){
        check(workflow.planner.status==='accepted',edition+' live DeepSeek tool planning accepted '+JSON.stringify(workflow.planner));
        check(comparison.proposal_origin==='deepseek'&&workflow.stages.includes('deepseek_parameter_proposals'),edition+' proposals originate from live DeepSeek');
        check(workflow.tools.some(t=>t.name==='compare_layout_alternatives'&&t.trigger==='deepseek'&&t.status==='completed'),edition+' DeepSeek really invokes candidate calculations');
        check(workflow.mode==='deepseek_tools_local_models',edition+' live DeepSeek assessment accepted '+JSON.stringify(workflow.interpretation));
      }
      check(JSON.stringify(body.regional_report.layout_exposure.neighbourhood)===JSON.stringify(body.neighbourhood),edition+' report and map share same grid evidence');
      await q.locator('#sb-layer').selectOption('utci');await q.locator('[data-mode="delta"]').click();
      const actual=await q.evaluate(()=>window.__spatialQA.map.getSource('sandbox-heat').getData());
      check(actual.features.every(f=>f.properties.value===body.cells.features[f.id].properties.delta_utci_c),edition+' rendered grid equals hybrid numerical response');
      await q.locator('#sb-report').click();check(await q.locator('.sandbox-neighbourhood').isVisible(),edition+' neighbourhood report visible');check(await q.locator('.sandbox-alternatives').isVisible(),edition+' alternatives report visible');
      check((await q.locator('.sandbox-alternatives').textContent()).includes('AI建议 × 物理回算'),edition+' report shows joint calculation');
      await q.locator('.sandbox-alternatives').scrollIntoViewIfNeeded();await q.screenshot({path:'output/playwright/joint-calculation-'+edition+'-report.png'});
      if(edition==='competition'){
        await q.setViewportSize({width:390,height:844});await q.locator('.sandbox-alternatives').scrollIntoViewIfNeeded();
        check(await q.evaluate(()=>{const d=document.querySelector('#sb-report-dialog');return d.scrollWidth<=d.clientWidth+1;}),edition+' joint report fits mobile dialog');
        await q.screenshot({path:'output/playwright/joint-calculation-'+edition+'-mobile-report.png'});
      }
      const chosen=comparison.alternatives.find(v=>v.id===comparison.recommendation.selected_candidate_id)||comparison.alternatives[0];
      const adoption=q.waitForResponse(r=>r.url().endsWith('/sandbox/simulate'),{timeout:120000});
      await q.locator('[data-adopt-candidate="'+chosen.id+'"]').click();const adopted=await adoption,adoptedBody=await adopted.json();
      check(adopted.ok()&&adoptedBody.scene_sha256===chosen.scene_sha256,edition+' adopt AI candidate uses exact tested geometry');
      await q.waitForFunction(hash=>document.querySelector('#workspace-map').dataset.resultSha256===hash,adoptedBody.report_sha256,{timeout:120000});
      check(Math.abs(adoptedBody.summary.proposed_utci_c-chosen.summary.proposed_utci_c)<1e-6,edition+' adopted per-grid recomputation reproduces candidate thermal result');
      check(!await q.locator('#sb-report-dialog').isVisible(),edition+' adopting invalidates and closes stale report');
      await q.setViewportSize({width:1440,height:960});
      await q.locator('[data-mode="edit"]').click();await q.locator('#sb-undo').click();
      check(await q.evaluate(()=>window.__spatialQA.scene.additions[0].height_m===60&&!window.__spatialQA.result),edition+' AI adoption supports undo and invalidates old grid result');
      await q.setViewportSize({width:390,height:844});check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),edition+' mobile viewport fits');
      await q.screenshot({path:'output/playwright/joint-calculation-'+edition+'-mobile.png'});
      const record={edition,ms:Date.now()-started,scene_sha256:body.scene_sha256,report_sha256:body.report_sha256,
        spatial_inference:body.spatial_inference,neighbourhood:body.neighbourhood,orchestration:workflow,summary:body.summary};
      evidence.push(record);
    }catch(error){await q.screenshot({path:'output/playwright/joint-calculation-'+edition+'-failure.png'});throw error;}
    finally{await context.close();}
  }
  check(!errors.length,'no runtime errors');return {checks,errors,evidence};
}
