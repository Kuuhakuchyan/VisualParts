async page=>{
 const origin=new URL(page.url()).origin,local=['127.0.0.1','localhost'].includes(new URL(origin).hostname),base=local?'/':'/decision/';
 const context=await page.context().browser().newContext({viewport:{width:1440,height:960}}),qa=await context.newPage(),checks=[],errors=[],created=[];
 qa.on('pageerror',e=>errors.push(e.message));const check=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
 try{
  for(const edition of ['', 'aic/']){
   await qa.goto(origin+base+edition+'#plans');await qa.locator('#plan-form').waitFor({state:'attached'});await qa.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
   const name='UI-D-QA-'+Date.now();await qa.locator('#new-plan').click();await qa.locator('#plan-form [name=name]').fill(name);
   const pending=qa.waitForResponse(r=>r.url().endsWith('/workspace/plans')&&r.request().method()==='POST');
   let posts=0;const count=r=>{if(r.url().endsWith('/workspace/plans')&&r.method()==='POST')posts++;};qa.on('request',count);
   await qa.locator('#plan-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});const response=await pending,record=await response.json();qa.off('request',count);
   check(response.ok(),edition+' plan saves through existing API');created.push({edition,id:record.id});check(posts===1,edition+' rapid repeated submit creates one request');
   await qa.locator(`[data-delete-plan="${record.id}"]`).waitFor();check(await qa.locator('.plan-comparison-summary').isVisible(),edition+' real selected plan summary renders');
   check((await qa.locator('#comparison').innerText()).includes(name),edition+' comparison uses returned plan');
   const exported=qa.waitForEvent('download');await qa.locator(`[data-export-plan="${record.id}"]`).click();await(await exported).saveAs('output/playwright/design-d-'+(edition?'competition':'project')+'-plan.json');
   await qa.reload();await qa.locator(`[data-delete-plan="${record.id}"]`).waitFor();check(true,edition+' saved plan survives reload');
   await qa.locator('#plan-search').fill(name);check(await qa.locator('.plan-row').count()===1,edition+' archive search locates saved plan');
   await qa.locator(`[data-delete-plan="${record.id}"]`).click();await qa.locator('#delete-dialog button[value=cancel]').click();check(await qa.locator(`[data-delete-plan="${record.id}"]`).count()===1,edition+' cancel deletion preserves record');
   await qa.locator(`[data-delete-plan="${record.id}"]`).click();const deletion=qa.waitForResponse(r=>r.url().endsWith('/workspace/plans/'+record.id)&&r.request().method()==='DELETE');await qa.locator('#delete-dialog button[value=confirm]').click();check((await deletion).ok(),edition+' confirmed delete reaches API');await qa.locator(`[data-delete-plan="${record.id}"]`).waitFor({state:'detached'});created.pop();
   check(true,edition+' archive removes deleted record');
   for(const width of [1440,768,390,320]){await qa.setViewportSize({width,height:960});await qa.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);checks.push(edition+' plans fit '+width);}
   await qa.setViewportSize({width:1440,height:960});
  }
  check(errors.length===0,'no plan runtime errors');return {checks,errors};
 }catch(error){await qa.screenshot({path:'output/playwright/design-d-plan-failure.png'});throw Error(String(error)+'; completed checks: '+checks.join(' | '));}finally{
  for(const {id,edition}of created){const token=await qa.evaluate(key=>localStorage.getItem(key),edition?'microclimate-competition-token':'microclimate-workspace-token');if(token)await qa.request.delete(origin+'/api/weather/workspace/plans/'+id,{headers:{'X-Workspace-Token':token}});}
  await context.close();
 }
}
