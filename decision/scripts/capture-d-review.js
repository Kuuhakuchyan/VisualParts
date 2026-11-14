async page => {
  const origin=new URL(page.url()).origin;
  const context=await page.context().browser().newContext({viewport:{width:1600,height:1000},deviceScaleFactor:2.4});
  const q=await context.newPage(),captures=[];
  const capture=async name=>{await q.screenshot({path:'.impeccable/review/'+name+'.png'});captures.push(name);};
  try{
    await q.goto(origin+'/home.html');await q.locator('#intro').waitFor({state:'hidden'});
    await q.waitForFunction(()=>document.querySelector('.hero-scene')?.dataset.rendered==='true');
    await q.waitForTimeout(500);await capture('home-4k');
    for(const route of ['screen','overview','spatial','risk','plans','evidence']){
      await q.goto(origin+'/#'+route);await q.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
      if(['screen','spatial'].includes(route))await q.waitForFunction(()=>Number(document.querySelector('.sandbox-legend')?.dataset.validCells)>0,null,{timeout:40000});
      await q.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));scrollTo(0,0);});
      await q.waitForTimeout(400);await capture(route+'-4k');
    }
  }finally{await context.close();}
  const mobileContext=await page.context().browser().newContext({viewport:{width:390,height:844}}),m=await mobileContext.newPage();
  try{
    for(const route of ['home','screen','plans','spatial','risk']){
      await m.goto(origin+(route==='home'?'/home.html':'/#'+route));
      if(route==='home')await m.locator('#intro').waitFor({state:'hidden'});
      else await m.waitForFunction(()=>!document.querySelector('#refresh-all').disabled);
      if(['screen','spatial'].includes(route))await m.waitForFunction(()=>Number(document.querySelector('.sandbox-legend')?.dataset.validCells)>0,null,{timeout:40000});
      await m.waitForTimeout(400);await m.evaluate(()=>scrollTo(0,0));
      await m.screenshot({path:'.impeccable/review/'+route+'-mobile.png'});captures.push(route+'-mobile');
    }
  }finally{await mobileContext.close();}
  return captures;
}
