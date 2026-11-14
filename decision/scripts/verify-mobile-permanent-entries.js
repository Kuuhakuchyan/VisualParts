async (page) => {
  const root='G:/Working/大创/_git_publish/VisualParts-weather/api';
  const checks=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/sensors',route=>route.fulfill({path:root+'/templates/sensors.html',contentType:'text/html'}));
  await page.route('**/home-assets/mobile-devices.js*',route=>route.fulfill({path:root+'/static/home/mobile-devices.js',contentType:'application/javascript'}));
  let uploaded=false;
  const stamp=new Date().toISOString();
  const device={device_id:'BROWSER-QA-UGV',device_type:'UGV',device_name:'UGV',online:true,
    status:{state:'dwell'},component_times:{status:stamp,measurements:stamp},measurements:{temperature_c:24.5,humidity_pct:60},quality_flag:0};
  await page.route('**/api/weather/mobile-observations/devices',route=>route.fulfill({json:{devices:uploaded?[device]:[]}}));
  await page.route('**/api/weather/mobile-observations/devices/BROWSER-QA-UGV',route=>route.fulfill({json:{device,stats:{total:1},observations:[],track:{features:[]}}}));
  await page.reload();
  await page.getByRole('button',{name:'UGV',exact:true}).click();
  await page.getByRole('heading',{name:'UGV',exact:true}).waitFor();
  const initialCount=await page.locator('.metric .value').first().textContent();
  for(const type of ['UGV','UAV']){
    await page.getByRole('button',{name:type,exact:true}).click();
    await page.getByRole('heading',{name:type,exact:true}).waitFor();
    await page.getByRole('button',{name:'视觉图像',exact:true}).click();
    if(!await page.getByRole('button',{name:'导出',exact:true}).isDisabled())throw new Error('empty export enabled');
    const text=await page.locator('mobile-observations').evaluate(el=>el.shadowRoot.textContent);
    if(/尚未|未上报|暂无|尚无/.test(text))throw new Error('empty explanatory copy remains');
    checks.push(type+' permanent entry and quiet empty detail');
  }
  await page.getByRole('button',{name:'UGV',exact:true}).click();
  uploaded=true;
  await page.getByRole('button',{name:'刷新传感器'}).click();
  await page.getByRole('button',{name:'UGV 在线',exact:true}).waitFor();
  await page.locator('mobile-observations').getByText('24.5 °C',{exact:true}).waitFor();
  if(Number(await page.locator('.metric .value').first().textContent())!==Number(initialCount)+1)throw new Error('placeholder counted as device');
  await page.getByRole('button',{name:'UAV',exact:true}).waitFor();
  checks.push('incoming sample replaces entry without duplicate or wrong selection');
  await page.getByRole('button',{name:'UAV',exact:true}).click();
  await page.getByRole('heading',{name:'UAV',exact:true}).waitFor();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.locator('mobile-observations').scrollIntoViewIfNeeded();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('overflow');
  }
  checks.push('desktop/mobile empty layout');
  if(errors.length)throw new Error(errors.join(';'));
  await page.unrouteAll();
  return {checks,passed:checks.length,errors};
}
