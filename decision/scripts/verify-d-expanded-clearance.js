async page=>{
  const origin=new URL(page.url()).origin,checks=[];
  const context=await page.context().browser().newContext(),q=await context.newPage();
  const check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  try{
    for(const edition of ['', 'aic/'])for(const width of [390,320]){
      const label=edition?'competition':'project';
      await q.setViewportSize({width,height:844});await q.goto(origin+'/'+edition+'#screen');
      await q.locator('.screen-dock-expand').waitFor();await q.waitForTimeout(400);
      check(await q.locator('.screen-left').isVisible(),label+' default weather visible '+width);
      await q.locator('.screen-dock-expand').click();await q.waitForTimeout(250);
      check(!await q.locator('.screen-left').isVisible(),label+' expanded weather float removed '+width);
      check(await q.locator('.screen-mobile-nav a[href="#overview"]').isVisible(),label+' weather entry available '+width);
      const tool=q.locator('.screen-map-tools');
      check(await tool.isVisible(),label+' expanded tools visible '+width);
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' expanded fits '+width);
      await q.screenshot({path:'.impeccable/review/'+label+'-screen-expanded-'+width+'.png'});
      await q.locator('.screen-dock-expand').click();check(await q.locator('.screen-left').isVisible(),label+' collapsed weather restored '+width);
    }
    return checks;
  }finally{await context.close();}
}
