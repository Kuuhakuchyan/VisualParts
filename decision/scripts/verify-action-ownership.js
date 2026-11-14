async (page) => {
  const checks=[],errors=[],counts={planPost:0,planDelete:0,scenePost:0,sceneDelete:0};
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage();
  qa.on('pageerror',error=>errors.push(error.message));
  qa.on('request',request=>{const u=new URL(request.url()),m=request.method();if(u.pathname==='/api/weather/workspace/plans'&&m==='POST')counts.planPost++;if(u.pathname.startsWith('/api/weather/workspace/plans/')&&m==='DELETE')counts.planDelete++;if(u.pathname==='/api/weather/sandbox/scenes'&&m==='POST')counts.scenePost++;if(u.pathname.startsWith('/api/weather/sandbox/scenes/')&&m==='DELETE')counts.sceneDelete++;});
  const base=page.url().split('#')[0];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  const ids={plans:[],scenes:[]};
  try{
    await qa.bringToFront();await qa.goto(base+'#plans',{waitUntil:'domcontentloaded'});
    await qa.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
    for(let i=0;i<2;i++){
      if(!await qa.locator('[name="name"]').isVisible())await qa.locator('.plan-create > summary').click();
      await qa.locator('[name="name"]').fill('QA interaction ownership '+Date.now()+' '+i);
      await qa.evaluate(()=>{const form=document.querySelector('#plan-form');form.requestSubmit();form.requestSubmit();form.requestSubmit();});
      await qa.waitForFunction(()=>!document.querySelector('#save-plan').disabled);
      const rows=qa.locator('[data-delete-plan]');
      await expect('plan '+(i+1)+' single POST despite repeated submit',async()=>counts.planPost===i+1&&await rows.count()===i+1);
    }
    ids.plans=await qa.locator('[data-delete-plan]').evaluateAll(nodes=>nodes.map(n=>n.dataset.deletePlan));
    await qa.locator('[data-select-plan]').first().uncheck();
    await expect('comparison checkbox cannot trigger deletion',()=>counts.planDelete===0);
    await qa.locator('[data-delete-plan]').first().click();
    await qa.locator('#delete-dialog [value="cancel"]').click();
    await expect('cancelled plan deletion sends no DELETE',async()=>counts.planDelete===0&&await qa.locator('[data-delete-plan]').count()===2);
    await qa.evaluate(()=>{const buttons=[...document.querySelectorAll('[data-delete-plan]')];buttons[0].click();document.querySelector('#delete-dialog [value="confirm"]').click();buttons[1].click();});
    await qa.waitForFunction(()=>document.querySelectorAll('[data-delete-plan]').length===1);
    await expect('old close event cannot dismiss new delete confirmation',()=>qa.locator('#delete-dialog').isVisible());
    await qa.locator('#delete-dialog [value="cancel"]').click();
    await expect('new confirmation does not inherit previous confirm value',async()=>counts.planDelete===1&&await qa.locator('[data-delete-plan]').count()===1);
    await qa.locator('[data-delete-plan]').click();
    await qa.evaluate(()=>{const form=document.querySelector('#delete-dialog form'),submit=form.querySelector('[value="confirm"]');form.requestSubmit(submit);form.requestSubmit(submit);});
    await qa.waitForFunction(()=>document.querySelectorAll('[data-delete-plan]').length===0);
    await expect('one confirmed deletion targets exactly one remaining plan',()=>counts.planDelete===2);

    await qa.goto(base+'#screen',{waitUntil:'domcontentloaded'});await qa.locator('#dock-tab-sandbox').click();await qa.locator('#sb-save').waitFor({timeout:60000});
    await qa.locator('#sb-name').fill('QA scene ownership '+Date.now());await qa.locator('#sb-name').press('Tab');
    await qa.evaluate(()=>{const button=document.querySelector('#sb-save');button.click();button.click();button.click();});
    await qa.waitForFunction(()=>!document.querySelector('#sb-save').disabled);
    await qa.locator('.sandbox-library > summary').click();
    await qa.locator('[data-delete-scene]').waitFor();
    ids.scenes=await qa.locator('[data-delete-scene]').evaluateAll(nodes=>nodes.map(n=>n.dataset.deleteScene));
    await expect('scene rapid save creates one stored record',async()=>counts.scenePost===1&&ids.scenes.length===1);
    await qa.locator('[data-delete-scene]').click();await qa.locator('#sb-confirm-dialog [value="cancel"]').click();
    await expect('cancelled scene deletion sends no DELETE',()=>counts.sceneDelete===0);
    await qa.evaluate(()=>{const button=document.querySelector('[data-delete-scene]');button.click();button.click();});
    await qa.locator('#sb-confirm-dialog [value="confirm"]').click();
    await qa.waitForFunction(()=>!document.querySelector('[data-delete-scene]'));
    await expect('duplicate scene action has one confirmation owner and DELETE',()=>counts.sceneDelete===1);
    await expect('scene deletion leaves original map geometry unchanged',async()=>(await qa.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'));
    await expect('no uncaught page errors',()=>errors.length===0);
    return {url:qa.url(),checks,counts,errors,note:'Real requests in a fresh isolated browser workspace. QA records deleted after verification.'};
  }finally{
    // Only remove IDs created in this isolated QA context.
    const token=await qa.evaluate(()=>localStorage.getItem(location.pathname.includes('/aic/')?'microclimate-competition-token':'microclimate-workspace-token')).catch(()=>null);
    if(token)for(const [kind,list]of Object.entries(ids))for(const id of list){const path=kind==='plans'?'/api/weather/workspace/plans/':'/api/weather/sandbox/scenes/';await qa.request.delete(new URL(path,qa.url()).href,{headers:{'X-Workspace-Token':token}}).catch(()=>{});}
    await context.close();await page.bringToFront();
  }
}
