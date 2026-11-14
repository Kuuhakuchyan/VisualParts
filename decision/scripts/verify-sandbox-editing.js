async (page) => {
  const checks=[];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  await page.setViewportSize({width:1440,height:960});
  await page.keyboard.press('Escape');
  await page.locator('#screen-site').selectOption('campus');
  await page.locator('#workspace-map[data-buildings="225"]').waitFor();
  await page.locator('[data-operation="add"]').waitFor();
  await page.locator('#map-home').click();await page.waitForTimeout(650);
  if(!(await page.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'))throw new Error('Use a clean QA browser; existing local geometry must be preserved');
  let placed=null;
  await page.locator('[data-operation="add"]').click();
  await page.mouse.click(710,440);
  await page.locator('#sb-width').fill('0');
  await expect('invalid dimensions disable construction',()=>page.locator('#sb-confirm').isDisabled());
  await page.locator('#sb-width').fill('20');
  for(const point of [[710,440],[680,400],[770,400],[660,480],[740,510],[810,460],[610,400],[820,530]]){
    await page.mouse.click(...point);
    const pending=page.waitForResponse(r=>r.url().endsWith('/api/weather/sandbox/validate')&&r.request().method()==='POST');
    await page.locator('#sb-confirm').click();
    const response=await pending;
    await page.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
    if(response.ok()){placed=point;break;}
  }
  if(!placed)throw new Error('No collision-free QA location found');
  await expect('actual construction changes scene',async()=>(await page.locator('#sb-count').textContent()).includes('新增 1 / 拟拆除 0'));
  await page.locator('#sb-undo').click();
  await expect('undo restores geometry and exits action',async()=>(await page.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0')&&await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect');
  await page.locator('#sb-redo').click();
  await expect('redo restores construction',async()=>(await page.locator('#sb-count').textContent()).includes('新增 1 / 拟拆除 0'));
  await page.locator('[data-operation="select"]').click();
  await page.mouse.click(...placed);
  await page.locator('#sb-height').fill('36');
  const editResponse=page.waitForResponse(r=>r.url().endsWith('/api/weather/sandbox/validate')&&r.request().method()==='POST');
  await page.locator('#sb-edit').click();
  if(!(await editResponse).ok())throw new Error('Dimension edit rejected');
  await page.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
  await expect('dimension edit does not add duplicate building',async()=>(await page.locator('#sb-count').textContent()).includes('新增 1 / 拟拆除 0'));
  await page.locator('#sb-undo').click();
  await page.locator('[data-operation="move"]').click();
  await page.mouse.click(...placed);
  await expect('move requires a destination',()=>page.locator('#sb-confirm').isDisabled());
  let moved=false;const rejectedMoves=[];
  for(const offset of [[35,0],[0,35],[-35,0],[0,-35],[70,0],[0,70],[-70,0],[0,-70]]){
    await page.mouse.click(placed[0]+offset[0],placed[1]+offset[1]);
    const moveResponse=page.waitForResponse(r=>r.url().endsWith('/api/weather/sandbox/validate')&&r.request().method()==='POST');
    await page.locator('#sb-confirm').click();
    const response=await moveResponse;
    await page.waitForFunction(()=>document.querySelector('.layout-sandbox').dataset.validating==='false');
    const movedBuilding=response.request().postDataJSON().additions[0];
    if(movedBuilding.width_m!==20||movedBuilding.depth_m!==20||movedBuilding.height_m!==18)throw new Error('Moving must not change dimensions');
    if(response.ok()){moved=true;break;}
    rejectedMoves.push({offset,body:await response.json(),request:response.request().postDataJSON()});
  }
  if(!moved)throw new Error('No valid relocation found: '+JSON.stringify(rejectedMoves));
  await expect('move keeps one proposed building',async()=>(await page.locator('#sb-count').textContent()).includes('新增 1 / 拟拆除 0'));
  await page.locator('#sb-undo').click();
  await page.locator('[data-operation="remove"]').click();
  await page.mouse.click(...placed);
  await expect('constructed building can be selected for removal',async()=>!(await page.locator('#sb-confirm').isDisabled()));
  await page.locator('#sb-confirm').click();
  await page.locator('#sb-confirm-dialog button[value="cancel"]').click();
  await expect('cancel removal preserves scene',async()=>(await page.locator('#sb-count').textContent()).includes('新增 1 / 拟拆除 0'));
  await page.locator('#sb-confirm').click();
  await page.keyboard.press('Escape');
  await expect('dialog Escape cancels without cancelling underlying tool',async()=>(await page.locator('#sb-count').textContent()).includes('新增 1 / 拟拆除 0')&&await page.locator('#workspace-map').getAttribute('data-interaction')==='remove');
  await page.locator('#sb-confirm').click();
  await page.locator('#sb-confirm-dialog button[value="confirm"]').click();
  await expect('confirmed removal deletes only proposed building',async()=>(await page.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'));
  await page.keyboard.press('Escape');
  await page.locator('#sb-undo').click();
  await expect('undo removal restores proposed building',async()=>(await page.locator('#sb-count').textContent()).includes('新增 1 / 拟拆除 0'));
  await page.locator('#sb-reset').click();
  await page.locator('#sb-confirm-dialog button[value="confirm"]').click();
  await expect('reset leaves clean scene and idle mode',async()=>(await page.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0')&&await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect');
  return {url:page.url(),placed,checks,note:'Only browser-local geometry and validation API were used; nothing saved to server.'};
}
