async (page) => {
  if(!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname))throw new Error('Fault injection is local-only');
  const checks=[];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  await page.setViewportSize({width:1440,height:960});
  await page.locator('#screen-site').selectOption('campus');
  await page.locator('#workspace-map[data-buildings="225"]').waitFor();
  await page.locator('[data-operation="add"]').waitFor();
  await page.locator('#map-home').click();await page.waitForTimeout(650);
  await page.locator('[data-operation="add"]').click();await page.mouse.click(710,440);
  let release,seen;
  const blocked=new Promise(resolve=>release=resolve),started=new Promise(resolve=>seen=resolve);
  const pattern='**/api/weather/sandbox/validate';
  await page.route(pattern,async route=>{seen();await blocked;await route.fulfill({status:200,contentType:'application/json',body:'{"valid":true}'});});
  try{
    await page.locator('#sb-confirm').click();await started;
    await expect('pending validation locks geometry inputs',()=>page.locator('#sb-width').isDisabled());
    await expect('pending validation locks save',()=>page.locator('#sb-save').isDisabled());
    const selected=await page.locator('#sb-selection').textContent();
    await page.mouse.click(760,460);
    await expect('pending validation ignores extra map clicks',async()=>await page.locator('#sb-selection').textContent()===selected);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
    await expect('cancel releases validation lock',async()=>await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect');
    release();await page.waitForTimeout(200);
    await expect('late successful response cannot create cancelled building',async()=>(await page.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'));
  }finally{release();await page.unroute(pattern);}
  await page.route(pattern,route=>route.fulfill({status:422,contentType:'application/json',body:'{"detail":"QA injected geometry rejection"}'}));
  try{
    await page.locator('[data-operation="add"]').click();await page.mouse.click(710,440);
    await page.locator('#sb-width').fill('28');
    await page.locator('#sb-confirm').click();
    await page.waitForFunction(()=>!document.querySelector('#sb-error').hidden);
    await expect('validation failure preserves user dimensions',async()=>await page.locator('#sb-width').inputValue()==='28');
    await expect('validation failure unlocks retry',async()=>!await page.locator('#sb-confirm').isDisabled());
    await expect('validation failure leaves geometry unchanged',async()=>(await page.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'));
  }finally{await page.unroute(pattern);await page.keyboard.press('Escape');}
  return {url:page.url(),checks,note:'Local-only fault injection, never persisted or used as production evidence.'};
}
