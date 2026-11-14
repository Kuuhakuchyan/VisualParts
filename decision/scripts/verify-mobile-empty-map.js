async (page) => {
  const sample=await (await page.request.get('http://127.0.0.1:8876/api/weather/mobile-observations/devices/UGV-UI-QA')).json();
  let empty=false;
  await page.route('**/api/weather/mobile-observations/devices',route=>route.fulfill({json:{devices:empty?[]:[sample.device]}}));
  await page.route('**/api/weather/mobile-observations/devices/UGV-UI-QA',route=>route.fulfill({json:sample}));
  await page.goto('https://weather.nogamenolife.cn/?view=monitor&mobile=UGV-UI-QA#mobile-observations');
  await page.waitForFunction(()=>typeof mobileMarker!=='undefined'&&mobileMarker&&mobileTrack);
  empty=true;
  await page.getByRole('button',{name:'刷新设备与观测'}).click();
  await page.waitForFunction(()=>document.querySelector('mobile-observations').data===null&&!document.querySelector('mobile-observations').busy);
  if(await page.evaluate(()=>mobileMarker!==null||mobileTrack!==null))throw new Error('empty data leaves old map overlay');
  await page.unrouteAll();
  await page.reload();
  await page.getByRole('heading',{name:'UGV',exact:true}).waitFor();
  const live=await (await page.request.get('https://weather.nogamenolife.cn/api/weather/mobile-observations/devices')).json();
  if(live.devices.some(d=>d.device_id.startsWith('UI-QA-')))throw new Error('QA records remain');
  return {emptyMapCleared:true,liveDevices:live.devices.length,qaRecordsRemoved:true};
}
