async (page) => {
  const report=[];
  for(const [width,height] of [[1440,960],[1024,600],[900,700],[768,600],[390,844]]){
    const context=await page.context().browser().newContext({viewport:{width,height}});
    try{
      const q=await context.newPage();
      await q.goto('https://weather.nogamenolife.cn/');
      await q.locator('#intro').waitFor({state:'hidden'});
      report.push(await q.evaluate(()=>({
        viewport:[innerWidth,innerHeight],mode:document.documentElement.dataset.pageMode,
        motion:document.documentElement.dataset.motion,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,
        sheets:[...document.styleSheets].map(s=>s.href||'inline'),scripts:[...document.scripts].map(s=>s.src||'inline'),
        workers:navigator.serviceWorker.controller?.scriptURL||null,
        heroAnimation:getComputedStyle(document.querySelector('.hero'),'::before').animationName,
        parallaxScript:[...document.scripts].some(s=>s.textContent.includes('pointermove')),
        hiddenChapterLabels:getComputedStyle(document.querySelector('.section-rail em')).display,
        headingRules:[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>r.selectorText?.includes('.section-head h2')).map(r=>r.cssText),
        overflow:document.documentElement.scrollWidth-innerWidth
      })));
    }finally{await context.close();}
  }
  return report;
}
