async (page) => {
  const checks=[];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  await page.setViewportSize({width:1440,height:960});
  await page.keyboard.press('Escape');
  await page.locator('#sb-name').waitFor();
  const original=await page.locator('#sb-name').inputValue();
  const headers=await page.evaluate(()=>({'X-Workspace-Token':localStorage.getItem(location.pathname.includes('/aic/')?'microclimate-competition-token':'microclimate-workspace-token')||''}));
  const endpoint=new URL('/api/weather/sandbox/scenes',page.url()).toString();
  let id;
  try{
    const name='LCZ-QA-'+Date.now();
    await page.locator('#sb-name').fill(name);await page.locator('#sb-name').blur();
    const pending=page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='POST');
    await page.locator('#sb-save').click();const response=await pending;
    if(response.status()!==201)throw new Error('Save HTTP '+response.status());
    const record=await response.json();id=record.id;
    await expect('save returns exact scene name and geometry',()=>record.scene.name===name&&record.scene.additions.length===0&&record.scene.removed_ids.length===0);
    await page.locator('.sandbox-library').evaluate(n=>n.open=true);
    await page.locator('[data-load-scene="'+id+'"]').waitFor();
    await page.reload();await page.locator('#sb-save').waitFor();
    await page.locator('.sandbox-library').evaluate(n=>n.open=true);
    await page.locator('[data-load-scene="'+id+'"]').waitFor();
    await expect('saved scene survives page reload',()=>page.locator('[data-load-scene="'+id+'"]').textContent().then(t=>t.includes(name)));
    await page.locator('[data-load-scene="'+id+'"]').click();
    await page.waitForFunction(n=>document.querySelector('#sb-name').value===n,name);
    await expect('restored geometry does not restore stale report',()=>page.locator('#sb-report').isDisabled());
    await page.locator('[data-delete-scene="'+id+'"]').click();
    await page.locator('#sb-confirm-dialog button[value="cancel"]').click();
    await expect('cancelled deletion preserves this QA record',()=>page.locator('[data-load-scene="'+id+'"]').isVisible());
    const deleted=page.waitForResponse(r=>r.url()===endpoint+'/'+id&&r.request().method()==='DELETE');
    await page.locator('[data-delete-scene="'+id+'"]').click();
    await page.locator('#sb-confirm-dialog button[value="confirm"]').click();
    const deletion=await deleted;
    await expect('confirmed deletion succeeds once',()=>deletion.status()===200);
    await page.locator('[data-load-scene="'+id+'"]').waitFor({state:'detached'});
    await page.reload();await page.locator('#sb-save').waitFor();
    const listed=await page.request.get(endpoint,{headers});
    const data=await listed.json();
    await expect('deleted QA scene absent from API and refreshed UI',async()=>listed.ok()&&!data.scenes.some(s=>s.id===id)&&await page.locator('[data-load-scene="'+id+'"]').count()===0);
    id=null;
  }finally{
    if(id)await page.request.delete(endpoint+'/'+id,{headers});
    if(await page.locator('#sb-name').count()){await page.locator('#sb-name').fill(original);await page.locator('#sb-name').blur();}
  }
  return {url:page.url(),checks,note:'Only a uniquely named QA scene was saved and deleted; no other records changed.'};
}
