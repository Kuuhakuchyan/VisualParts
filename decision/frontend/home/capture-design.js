async (page) => {
  const output='decision/public/aic/assets/';
  await page.setViewportSize({width:1800,height:1100});
  const captures=[['home','hero','homepage-scene.png'],['blog','blog','d-context.png'],['plans','plan','d-intervention.png']];
  for(const [view,kind,file] of captures){
    await page.goto('http://127.0.0.1:5191/preview.html?view='+view);
    const canvas=page.locator('[data-scene="'+kind+'"] canvas');
    await canvas.waitFor();
    await page.evaluate(({kind})=>{
      const holder=document.querySelector('[data-scene="'+kind+'"]');
      document.body.append(holder);
      holder.style.cssText='position:fixed;inset:0;z-index:1000;width:100vw;height:100vh;';
      document.querySelectorAll('.hero-marker,.hero-map-label,.concept-caption').forEach(n=>n.remove());
      dispatchEvent(new Event('resize'));
    },{kind});
    await page.waitForTimeout(700);
    await canvas.screenshot({path:output+file});
  }
  return {captures:captures.map(([,kind,file])=>({kind,file})),source:'Approved D design, canvas only; no UI, labels or school names. Thermal values are deterministic visual fixtures.'};
}
