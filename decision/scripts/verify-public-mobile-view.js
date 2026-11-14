async (page) => {
  const checks=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:/^UGV (在线|离线)$/}).waitFor({timeout:40000});
  checks.push('new upload appears through polling');
  for(const kind of ['UGV','UAV']){
    await page.getByRole('button',{name:new RegExp('^'+kind+' (在线|离线)$')}).click();
    await page.getByRole('heading',{name:kind,exact:true}).waitFor();
    await page.locator('mobile-observations tbody tr').first().waitFor();
    const summary=await page.locator('mobile-observations').evaluate(el=>({data:el.data,text:el.shadowRoot.textContent}));
    if(summary.data.stats.total!==3||!summary.text.includes('27.6 °C')||!summary.text.includes('62.4 %RH'))throw new Error('UI/backend reading mismatch');
    checks.push(kind+' readings agree with API');
    await page.getByRole('button',{name:'定位轨迹',exact:true}).click();
    if(await page.locator('mobile-observations tbody tr').count()!==3)throw new Error('track count mismatch');
    await page.getByRole('button',{name:'视觉图像',exact:true}).click();
    await page.waitForFunction(()=>{const images=[...document.querySelector('mobile-observations').shadowRoot.querySelectorAll('img')];return images.length===3&&images.every(i=>i.complete&&i.naturalWidth>0);});
    checks.push(kind+' track and images');
  }
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.locator('mobile-observations').scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/mobile-telemetry/public-sensors-${width}.png`});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('sensor overflow');
  }
  await page.getByRole('link',{name:'在观测工作台查看'}).click();
  await page.getByRole('combobox',{name:'移动观测设备'}).waitFor();
  await page.locator('mobile-observations tbody tr').first().waitFor();
  await page.waitForFunction(()=>typeof mobileMarker!=='undefined'&&mobileMarker&&mobileTrack,{timeout:30000});
  checks.push('monitor selected-device deep link and map overlays');
  const data=await page.locator('mobile-observations').evaluate(el=>el.data);
  if(data.device.device_type!=='UAV'||data.track.features.length!==3)throw new Error('wrong monitor device');
  const collection=await (await page.request.get('https://weather.nogamenolife.cn/api/weather/sandbox/collection/devices')).json();
  for(const type of ['UGV','UAV']){
    const row=collection.devices.find(d=>d.device_type===type&&d.device_id.startsWith('UI-QA-'));
    if(!row||row.label!==type||row.temperature_c!==null)throw new Error('collection adapter/quality gate');
  }
  checks.push('screen collection includes mobile devices and rejects flagged samples');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.locator('mobile-observations').scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/mobile-telemetry/public-monitor-${width}.png`});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('monitor overflow');
  }
  checks.push('desktop and mobile layout');
  const aic=await page.request.get('https://aic.nogamenolife.cn/api/weather/mobile-observations/devices');
  if(aic.status()!==404)throw new Error('AIC not isolated');
  checks.push('AIC read projection blocked');
  if(errors.length)throw new Error(errors.join(';'));
  return {checks,passed:checks.length,pageErrors:errors};
}
