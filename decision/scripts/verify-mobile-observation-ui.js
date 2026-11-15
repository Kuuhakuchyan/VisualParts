async (page) => {
  const checks=[];
  await page.goto(new URL('/sensors',page.url()).href);
  await page.getByRole('button',{name:/^UGV (在线|离线)$/}).click();
  await page.locator('mobile-observations').getByRole('table').waitFor();
  if(await page.locator('mobile-observations tbody tr').count()!==3)throw new Error('history missing');
  checks.push('UGV temperature/history');
  await page.getByRole('button',{name:'定位轨迹',exact:true}).click();
  if(await page.locator('mobile-observations tbody tr').count()!==3)throw new Error('track missing');
  await page.getByRole('button',{name:'刷新设备与观测'}).click();
  await page.waitForFunction(()=>!document.querySelector('mobile-observations').busy);
  if(await page.getByRole('button',{name:'定位轨迹',exact:true}).getAttribute('aria-pressed')!=='true')throw new Error('refresh resets tab');
  checks.push('track and refresh preserve selection');
  await page.getByRole('button',{name:'视觉图像',exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelector('mobile-observations').shadowRoot.querySelectorAll('img')).every(i=>i.complete&&i.naturalWidth>0));
  checks.push('image previews loaded');
  await page.getByRole('button',{name:'刷新传感器'}).click();
  await page.waitForFunction(()=>!document.querySelector('.icon-tool').disabled);
  if(await page.getByRole('button',{name:'视觉图像',exact:true}).getAttribute('aria-pressed')!=='true')throw new Error('sensor polling resets detail');
  checks.push('sensor refresh preserves detail');
  await page.getByRole('button',{name:/^UAV (在线|离线)$/}).click();
  await page.getByRole('heading',{name:'UAV',exact:true}).waitFor();
  checks.push('UAV selection');
  await page.getByRole('searchbox',{name:'搜索设备'}).fill('no-match');
  await page.getByText('没有匹配的设备，请调整搜索或状态。').waitFor();
  await page.getByRole('searchbox',{name:'搜索设备'}).fill('UGV');
  await page.getByRole('heading',{name:'UGV',exact:true}).waitFor();
  checks.push('search and empty state');
  for(const width of [1440,390,360]){
    await page.setViewportSize({width,height:900});
    await page.locator('mobile-observations').scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/mobile-telemetry/local-${width}.png`});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('overflow '+width);
    checks.push('layout '+width);
  }
  await page.route('**/api/weather/mobile-observations/devices/UGV-UI-QA',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.getByRole('button',{name:'刷新设备与观测'}).click();
  await page.getByText(/保留上次记录/).waitFor();
  if(await page.locator('mobile-observations tbody tr').count()!==3)throw new Error('failure discarded history');
  checks.push('upstream failure retains data');
  await page.unrouteAll();
  return {checks,passed:checks.length};
}
