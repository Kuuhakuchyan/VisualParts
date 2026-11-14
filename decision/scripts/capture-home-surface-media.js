async (page) => {
  const results=[];
  const context=await page.context().browser().newContext({viewport:{width:1800,height:1100},deviceScaleFactor:2});
  const target=await context.newPage();
  try{
    for(const [view,kind,file] of [['home','hero','homepage-scene.png'],['blog','blog','d-context.png'],['plans','plan','d-intervention.png']]){
      await target.goto('http://127.0.0.1:5188/preview.html?view='+view+'&export=4k');
      await target.waitForFunction(()=>document.body.dataset.ready==='true');
      await target.evaluate(kind=>{
        const holder=document.querySelector(`[data-scene="${kind}"]`);
        document.body.append(holder);
        holder.style.cssText='position:fixed;inset:0;z-index:1000;width:100vw;height:100vh;';
        document.querySelectorAll('.hero-marker,.hero-map-label,.concept-caption').forEach(node=>node.remove());
      },kind);
      await target.waitForFunction(()=>{
        const canvas=document.querySelector('body>[data-scene] canvas');
        return canvas.width===innerWidth*2&&canvas.height===innerHeight*2;
      });
      await target.locator('body>[data-scene] canvas').screenshot({path:'public/aic/assets/'+file,scale:'device'});
      results.push({file,width:3600,height:2200});
    }
  }finally{await context.close();}
  return results;
}
