async (page) => {
  await page.reload();
  const checks=[],errors=[];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  await page.setViewportSize({width:1440,height:960});await page.bringToFront();
  await page.keyboard.press('Escape');
  await page.locator('#screen-site').selectOption('campus');
  await page.locator('[data-operation="select"]').waitFor();
  await page.locator('#map-home').click();await page.waitForTimeout(600);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/weather/sandbox/heatmap')&&r.request().method()==='POST'&&r.request().postDataJSON().data_mode==='lcz_simulation');
  await page.locator('#sb-data-mode').selectOption('lcz_simulation');
  const response=await pending;if(!response.ok())throw new Error('Heatmap HTTP '+response.status());
  const heat=await response.json();
  await page.waitForFunction(()=>document.querySelector('.sandbox-legend')?.dataset.totalCells==='2610');
  const missing=heat.cells.features.filter(f=>f.properties.temperature_c===null).length;
  await expect('all 2610 grid footprints reach the display, not only valid values',async()=>Number(await page.locator('.sandbox-legend').getAttribute('data-total-cells'))===heat.cells.features.length);
  await expect('classification gaps are displayed as explicit neutral cells',async()=>missing>0&&Number(await page.locator('.sandbox-legend').getAttribute('data-missing-cells'))===missing&&(await page.locator('.sandbox-legend').textContent()).includes('不代表低风险'));
  await expect('partial classification does not invent simulated temperatures',()=>heat.cells.features.filter(f=>f.properties.classified_fraction<0.95).every(f=>f.properties.temperature_c===null&&f.properties.risk==='unavailable'));
  await page.locator('[data-operation="select"]').click();
  let building;
  for(const point of [[710,440],[680,400],[770,400],[660,480],[740,510],[810,460],[610,400],[820,530],[780,550],[700,580],[650,550],[820,600]]){
    await page.mouse.click(...point);
    if((await page.locator('#sb-selection').textContent()).includes('建筑 /')){building=point;break;}
  }
  if(!building)throw new Error('No visible building found for click ownership regression');
  await expect('explicit building selection selects without dropping a location pin',async()=>await page.locator('.maplibregl-marker').count()===0&&await page.locator('#use-location').isDisabled());
  await page.locator('[data-operation="inspect"]').click();await page.mouse.click(...building);
  await expect('same building-covered location is markable in default mode',async()=>await page.locator('.maplibregl-marker').count()===1&&!await page.locator('#use-location').isDisabled());
  await expect('marking never selects or enables building changes',async()=>!(await page.locator('#sb-selection').textContent()).includes('建筑 /')&&await page.locator('#sb-confirm').isDisabled()&&await page.locator('#sb-edit').isDisabled());
  await page.locator('[data-operation="remove"]').click();await page.mouse.click(...building);
  await expect('removal selects a building without also changing location',async()=>!(await page.locator('#sb-confirm').isDisabled())&&await page.locator('.maplibregl-marker').count()===0&&await page.locator('#use-location').isDisabled());
  await page.locator('#sb-confirm').click();await page.locator('#sb-confirm-dialog button[value="cancel"]').click();
  await page.locator('[data-operation="inspect"]').click();await page.mouse.click(...building);
  await expect('leaving removal releases all building-covered locations for marking',async()=>await page.locator('.maplibregl-marker').count()===1&&await page.locator('#sb-confirm').isDisabled());
  await page.locator('#sb-layer').selectOption('heatindex');
  await expect('not-applicable heat index retains full grid rather than blank canvas',async()=>Number(await page.locator('.sandbox-legend').getAttribute('data-total-cells'))===heat.cells.features.length);
  await page.locator('#sb-layer').selectOption('off');
  await expect('turning heatmap off also hides its missing-data mesh',async()=>await page.locator('.sandbox-legend').isHidden()&&await page.locator('.sandbox-legend').getAttribute('data-total-cells')==='0');
  await page.locator('#sb-layer').selectOption('weather');
  await page.locator('#map-home').click();await page.waitForTimeout(600);
  await page.screenshot({path:'output/playwright/grid-click-desktop.png'});
  const metadata=await page.request.get(new URL('/api/weather/sandbox/lcz-metadata',page.url()).toString());
  const station=(await metadata.json()).reference_station;
  await expect('reference station label is simply baseline station',()=>station.label==='基准站'&&station.location_status==='user_map_pin'&&station.telemetry_status==='not_connected');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    await page.locator('.sandbox-mobile-toggle').click();
    await expect(width+' toolbar fits and all five modes remain available',async()=>await page.locator('.layout-sandbox').evaluate(n=>n.scrollWidth<=n.clientWidth)&&await page.locator('[data-operation]').count()===5);
    await page.locator('[data-operation="select"]').click();
    await expect(width+' explicit selection mode is active',async()=>await page.locator('#workspace-map').getAttribute('data-interaction')==='select');
    await page.locator('[data-interaction-cancel]').click();
    await expect(width+' cancel returns to normal location marking',async()=>await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect');
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'output/playwright/grid-click-mobile.png'});
  await expect('no uncaught errors in mesh or click modes',()=>errors.length===0);
  page.off('pageerror',onError);
  return {url:page.url(),checks,errors,total_cells:heat.cells.features.length,neutral_cells:missing,building_test_point:building};
}
