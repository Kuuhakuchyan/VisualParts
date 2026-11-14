async (page) => {
  await page.unrouteAll();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://weather.nogamenolife.cn/sensors');
  for(const type of ['UGV','UAV']){
    await page.getByRole('button',{name:type,exact:true}).click();
    await page.getByRole('heading',{name:type,exact:true}).waitFor();
    await page.getByRole('button',{name:'定位轨迹',exact:true}).click();
    await page.getByRole('button',{name:'视觉图像',exact:true}).click();
    if(!await page.getByRole('button',{name:'导出',exact:true}).isDisabled())throw new Error('empty export');
  }
  if((await page.locator('body').innerText()).includes('尚未上报'))throw new Error('old banner');
  await page.setViewportSize({width:390,height:900});
  await page.locator('mobile-observations').scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/playwright/mobile-telemetry/public-fixed-entries-390.png'});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('mobile overflow');
  await page.getByRole('link',{name:'在观测工作台查看'}).click();
  await page.getByRole('heading',{name:'UAV',exact:true}).waitFor();
  const select=page.getByRole('combobox',{name:'移动观测设备'});
  await select.selectOption('type:UGV');
  await page.getByRole('heading',{name:'UGV',exact:true}).waitFor();
  const text=await page.locator('mobile-observations').evaluate(el=>el.shadowRoot.textContent);
  if(/尚未|未上报|暂无|尚无/.test(text))throw new Error('old empty copy');
  if(errors.length)throw new Error(errors.join(';'));
  return {fixedEntries:['UGV','UAV'],tabs:true,mobile:true,monitorTypeLink:true,oldCopyRemoved:true,pageErrors:errors};
}
