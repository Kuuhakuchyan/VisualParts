async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage(),checks=[],errors=[];
  const ok=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  qa.on('pageerror',error=>errors.push(error.message));
  try{
    for(const route of ['/','/author/','/monitor','/sensors','/logs']){
      await qa.goto('https://weather.nogamenolife.cn'+route);
      await qa.waitForLoadState('domcontentloaded');
      if(route==='/monitor'){
        await qa.waitForFunction(()=>document.querySelector('#deviceSelect').options.length>0);
        await qa.waitForFunction(()=>document.querySelector('#lastUpdate').textContent.includes('更新于'));
        const options=await qa.locator('#deviceSelect option').allTextContents();
        ok(options.length>=2,'monitor loads connected device identifiers');
        if(options.length>1){
          const value=await qa.locator('#deviceSelect option').nth(1).getAttribute('value');
          const response=qa.waitForResponse(r=>r.url().includes('/api/history/'+encodeURIComponent(value)));
          await qa.locator('#deviceSelect').selectOption(value);await response;
          ok(await qa.locator('#deviceSelect').inputValue()===value,'public monitor device switch uses selected device');
        }
        await qa.locator('#viewToggle').click();
        await qa.waitForFunction(()=>document.querySelector('#deviceRows').textContent.includes('暂无设备数据')||document.querySelector('.device-card'));
        ok(true,'public split-device view completes with real history or explicit empty state');
        await qa.locator('#viewToggle').click();
      }
      if(route==='/sensors'){
        await qa.waitForSelector('.device-node');
        const count=await qa.locator('.device-node').count();
        await qa.locator('.device-node').nth(count-1).click();
        ok(await qa.locator('.device-node.active').count()===1,'sensor tree has exactly one active selection');
      }
      if(route==='/logs'){
        await qa.waitForSelector('.device-tab');
        const count=await qa.locator('.device-tab').count();
        await qa.locator('.device-tab').nth(count-1).click();
        await qa.waitForFunction(()=>!document.querySelector('#dateContent').textContent.includes('正在读取'));
        ok(await qa.locator('.device-tab.active').count()===1,'public logs switch to one selected device');
      }
      for(const width of [1440,390,320]){
        await qa.setViewportSize({width,height:900});
        await qa.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,null,{timeout:2500});
        ok(true,route+' '+width+'px no document overflow');
      }
      await qa.setViewportSize({width:1440,height:960});
    }
    ok(errors.length===0,'home/blog/monitor/sensors/logs have no uncaught browser errors');
    return {checks,errors,note:'Read-only public operation, no configuration or telemetry was written.'};
  }finally{await context.close();}
}
