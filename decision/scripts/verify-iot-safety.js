async (page) => {
  const checks=[],errors=[];
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage();
  const ok=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  const hostile=`qa'\"><img src=x onerror=window.qaXss=1>`;
  const devices=[{device_id:hostile,online:false},{device_id:'qa-second',online:true},{device_id:'__proto__',online:false}];
  const timestamp='2026-10-21T06:00:00Z';
  let failHistory=false;
  qa.on('pageerror',error=>errors.push(error.message));
  await qa.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=decodeURIComponent(url.pathname);
    let body=[];
    if(path==='/api/devices')body=devices;
    else if(path==='/api/map/devices')body=[];
    else if(path.startsWith('/api/history/')){
      if(failHistory)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
      await new Promise(r=>setTimeout(r,path.endsWith('qa-second')?15:200));
      body=[{ts:timestamp,temp_c:path.endsWith('qa-second')?31:22,humidity:50,extra:{'<img src=x onerror=window.qaXss=2>':hostile}}];
    }else if(path.startsWith('/api/track/'))body={type:'FeatureCollection',features:[]};
    else if(path.startsWith('/api/latest/'))body={temp_c:22,humidity:50};
    else if(path.startsWith('/api/dates/')){
      await new Promise(r=>setTimeout(r,path.endsWith('qa-second')?15:250));
      body=[{date_str:path.endsWith('qa-second')?'2026-10-22':hostile,rows:1}];
    }
    try{await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});}catch(error){if(!/closed|handled/i.test(error.message))throw error;}
  });
  await qa.route('https://webapi.amap.com/**',route=>route.fulfill({contentType:'text/javascript',body:''}));
  try {
    await qa.goto('http://127.0.0.1:8188/?view=monitor');
    await qa.waitForFunction(()=>document.querySelector('#tableWrap').textContent.includes('22.00'));
    ok(!await qa.evaluate(()=>window.qaXss),'monitor device and extra fields cannot execute HTML');
    ok(await qa.locator('#tempLegend img,#tableWrap img,#statusPanel img').count()===0,'hostile data remains text in legends/status/table');
    await qa.locator('#tableDeviceTags span').first().click();
    ok(await qa.locator('#deviceSelect').inputValue()===hostile,'escaped inline action preserves exact device key');
    const aligned=await qa.evaluate(()=>{
      const rows=[{ts:'2026-10-21T06:00:00Z',temp_c:20,humidity:null},
        {ts:'2026-10-21T06:00:10Z',temp_c:30,humidity:50}];
      updateChartsMulti([{id:'a',data:rows},{id:'b',data:[{ts:'2026-10-21T06:00:20Z',temp_c:40,humidity:60}]}]);
      return {times:tempChart.data.labels,values:tempChart.data.datasets.map(d=>({id:d.label,values:d.data})),humidity:alignToGrid(rows,10).humids};
    });
    ok(aligned.times.length===3&&new Set(aligned.times).size===3,'10-second samples in one minute retain distinct chart positions');
    ok(JSON.stringify(aligned.values.find(d=>d.id==='a').values)==='[20,30,null]','multi-device timestamps use a union with missing values, not first-minute duplication');
    ok(aligned.humidity[0]===null,'missing humidity stays null, not NaN or zero');
    await qa.evaluate(()=>{updateChartsMulti([]);});
    ok(await qa.evaluate(()=>tempChart.data.labels.length===0&&tempChart.data.datasets.length===0),'empty history clears old chart values');
    await qa.locator('#deviceSelect').selectOption('qa-second');
    await qa.waitForFunction(()=>document.querySelector('#tableWrap').textContent.includes('31.00'));
    await qa.waitForTimeout(350);
    ok((await qa.locator('#tableWrap').textContent()).includes('31.00'),'old device response cannot overwrite selected device');
    ok((await qa.locator('#dateSelect').textContent()).includes('2026-10-22')&&!(await qa.locator('#dateSelect').textContent()).includes(hostile),'archive dropdown follows selected device');
    await qa.evaluate(()=>removeDevice('qa-second'));
    await qa.evaluate(()=>loadAll());
    ok(await qa.evaluate(()=>!tempChart.data.datasets.some(d=>d.label==='qa-second')),'removed chart device is not silently re-added by refresh');
    await qa.locator('#deviceSelect').selectOption('__proto__');
    await qa.waitForFunction(()=>document.querySelector('#tableWrap').textContent.includes('22.00'));
    ok(await qa.evaluate(()=>tempChart.data.datasets.some(d=>d.label==='__proto__')),'special object-key device names work without prototype collisions');
    await qa.locator('#viewToggle').click();
    await qa.waitForSelector('.device-card');
    ok(await qa.locator('#deviceRows img').count()===0&&!await qa.evaluate(()=>window.qaXss),'split-device view escapes titles and canvas attributes');
    await qa.locator('#viewToggle').click();
    failHistory=true;
    await qa.evaluate(()=>loadAll());
    ok((await qa.locator('#lastUpdate').textContent()).includes('刷新失败'),'upstream failure is explicit and preserves last successful history');
    failHistory=false;
    for(const width of [390,320]){
      await qa.setViewportSize({width,height:844});
      ok(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px monitor has no document overflow');
    }
    await qa.screenshot({path:'output/playwright/iot-monitor-mobile.png'});
    await qa.goto('http://127.0.0.1:8188/logs');
    await qa.waitForSelector('.device-tab');
    await qa.locator('.device-tab').nth(1).click();
    await qa.waitForFunction(()=>document.querySelector('#dateContent').textContent.includes('2026-10-22'));
    await qa.waitForTimeout(350);
    ok((await qa.locator('#dateContent').textContent()).includes('2026-10-22')&&!(await qa.locator('#dateContent').textContent()).includes(hostile),'logs suppress late archive response from previous device');
    await qa.locator('.device-tab').first().click();
    await qa.waitForFunction(()=>document.querySelector('.date-item'));
    ok(await qa.locator('#dateContent img,#deviceTabs img').count()===0&&!await qa.evaluate(()=>window.qaXss),'logs escape hostile device/date/count fields');
    ok((await qa.locator('.date-item a').getAttribute('href')).includes(encodeURIComponent(hostile)),'download parameters are URI encoded');
    ok(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'320px logs has no document overflow');
    ok(errors.length===0,'no uncaught JavaScript errors in injected test cases');
    return {checks,errors,note:'Browser-only fixtures; malicious strings were never submitted to public storage.'};
  } finally { await context.close(); }
}
