async (page) => {
  await page.unrouteAll();
  const checks=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const [edition,url] of [['project','https://weather.nogamenolife.cn/'],['aic','https://aic.nogamenolife.cn/aic/home.html']]){
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:width===390?844:960});
      await page.goto(url);
      await page.waitForFunction(()=>document.querySelector('.hero-scene')?.dataset.rendered==='true');
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('#intro')).visibility==='hidden'&&
        [...document.querySelectorAll('.hero .reveal')].every(node=>Number(getComputedStyle(node).opacity)>.99));
      const result=await page.evaluate(()=>({
        sceneVersion:document.querySelector('script[src*="scene.js"]').getAttribute('src'),
        rendered:document.querySelector('.hero-scene').dataset.rendered,
        overflow:document.documentElement.scrollWidth>innerWidth,
        schoolDisclosed:/郑州大学|闫梓宇/.test(document.body.innerText),
        localInspectionHookPresent:!!window.__surfaceQA
      }));
      if(!result.sceneVersion.includes('20261028-surfaces')||result.overflow||result.localInspectionHookPresent||edition==='aic'&&result.schoolDisclosed)throw new Error(JSON.stringify(result));
      await page.screenshot({path:`output/playwright/surface-fix/public-${edition}-${width}.png`});
      checks.push({edition,width,...result});
    }
  }
  if(errors.length)throw new Error(errors.join('\n'));
  return {checks,errors};
}
