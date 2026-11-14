async (page) => {
  const checks=[];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  const response=mode=>page.waitForResponse(r=>r.url().endsWith('/api/weather/sandbox/heatmap')&&r.request().method()==='POST'&&r.request().postDataJSON().data_mode===mode,{timeout:60000});
  await page.setViewportSize({width:1440,height:960});await page.keyboard.press('Escape');
  await page.locator('#screen-site').selectOption('zhongyuan');await page.locator('#sb-use-lcz').waitFor();
  const livePending=response('live');await page.reload();await livePending;
  await page.waitForFunction(()=>document.querySelector('.sandbox-legend')?.dataset.totalCells==='4');
  await expect('remembered neighborhood remains real weather, not undisclosed synthetic data',async()=>await page.locator('#screen-site').inputValue()==='zhongyuan'&&await page.locator('#sb-data-mode').inputValue()==='live');
  await expect('one source grid is explicitly distinguished from computational cells',async()=>(await page.locator('.sandbox-legend').textContent()).includes('公开气象源网格（非微气候计算网格）'));
  const campusPending=response('lcz_simulation');await page.locator('#sb-use-lcz').click();const campus=await (await campusPending).json();
  await page.waitForFunction(()=>document.querySelector('.sandbox-legend')?.dataset.totalCells==='2610');
  await expect('single action recovers campus and 2610 LCZ cells from old site preference',async()=>campus.cells.features.length===2610&&await page.locator('#screen-site').inputValue()==='campus'&&await page.locator('#sb-data-mode').inputValue()==='lcz_simulation');
  await expect('site replacement does not leave duplicate map or legend',async()=>await page.locator('.maplibregl-canvas').count()===1&&await page.locator('.sandbox-legend').count()===1);
  await page.locator('#map-home').click();await page.waitForTimeout(700);
  await page.screenshot({path:'output/playwright/grid-streets-final-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'output/playwright/grid-streets-final-mobile.png'});
  return {url:page.url(),checks};
}
