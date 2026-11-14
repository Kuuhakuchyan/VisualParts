async (page) => {
  const origin='http://127.0.0.1:5173';
  const checks=[],errors=[],layouts=[];
  const onError=error=>errors.push(error.message);
  const check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
  const fits=async()=>{try{await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,null,{timeout:2000});return true;}catch{return false;}};
  const shot=name=>page.screenshot({path:'output/playwright/design-'+name+'.png',fullPage:false});
  page.on('pageerror',onError);
  try{
    await page.unrouteAll();
    await page.setViewportSize({width:1440,height:960});
    await page.goto(origin+'/aic/#screen');
    await page.locator('.layout-sandbox').waitFor({timeout:45000});
    await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
    check(await page.locator('#sb-run').isVisible(),'primary simulation action is visible');
    check(await page.locator('.screen-dock-tabs [aria-selected=true]').count()===1,'one dock task selected');
    check(!(await page.locator('.screen-risk-section').isVisible()),'risk task is separate from editing');
    await page.locator('[data-operation=add]').click();
    check(await page.locator('#workspace-map').getAttribute('data-interaction')==='add','building tool activates');
    await page.locator('#dock-tab-risk').click();
    check(await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect','switching dock cancels building mode');
    check(await page.locator('#screen-select-region').isVisible(),'region selection belongs to risk task');
    await page.locator('#screen-select-region').click();
    check(await page.locator('#workspace-map').getAttribute('data-interaction')==='region','region selection activates');
    await page.locator('#dock-tab-sandbox').click();
    check(await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect','switching task cancels region selection');
    await page.locator('#dock-tab-layers').click();
    check(await page.locator('#layer-buildings').isVisible(),'layers task exposes visibility controls');
    await page.locator('#dock-tab-layers').press('Home');
    check(await page.locator('#dock-tab-sandbox').getAttribute('aria-selected')==='true','dock supports keyboard selection');
    await page.locator('#map-orbit').click();
    check(await page.locator('#map-orbit').getAttribute('aria-pressed')==='true','orbit indicates active state');
    await page.locator('#map-orbit').click();
    check(await page.locator('#map-orbit').getAttribute('aria-pressed')==='false','orbit clears highlight after stopping');
    await page.locator('#map-home').click();
    await page.waitForTimeout(1500);
    await shot('screen-desktop');
    const mapPng=await page.locator('.maplibregl-canvas').screenshot();
    const canvas=await page.evaluate(async bytes=>{
      const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
      const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);
      const b=ctx.getImageData(0,0,c.width,c.height).data,colors=new Set();
      for(let y=10;y<c.height;y+=30)for(let x=10;x<c.width;x+=30){const i=(y*c.width+x)*4;colors.add(b[i]+','+b[i+1]+','+b[i+2]);}
      bitmap.close();return {w:c.width,h:c.height,colors:colors.size};
    },Array.from(mapPng));
    check(canvas.colors>30,'3D and heatmap render nonblank canvas pixels');
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:960});
      await page.waitForTimeout(200);
      check(await fits(),width+'px dashboard has no horizontal overflow');
      const geometry=await page.evaluate(()=>{
        const l=document.querySelector('.sandbox-legend').getBoundingClientRect(),t=document.querySelector('.screen-map-tools').getBoundingClientRect(),m=document.querySelector('#workspace-map').getBoundingClientRect();
        return {legendBottom:l.bottom,toolbarTop:t.top,mapBottom:m.bottom,toolbarBottom:t.bottom,legendLeft:l.left,legendRight:l.right};
      });
      check(geometry.legendBottom<=geometry.toolbarTop+1,width+'px legend and map tools do not overlap');
      check(geometry.toolbarBottom<=geometry.mapBottom+1,width+'px tools stay in map');
      layouts.push({width,...geometry});
      if(width===390){
        await shot('screen-mobile');
        await page.locator('.sandbox-mobile-toggle').click();
        check(await page.locator('#decision-screen').evaluate(n=>n.classList.contains('sandbox-mobile-open')),'mobile task panel opens');
        await page.locator('[data-operation=add]').click();
        check(await page.locator('#workspace-map').getAttribute('data-interaction')==='add','mobile build mode activates');
        if(await page.locator('.sandbox-mobile-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.sandbox-mobile-toggle').click();
        await page.locator('#dock-tab-risk').click();
        check(await page.locator('#decision-screen').evaluate(n=>n.classList.contains('sandbox-mobile-open')),'mobile task switch preserves panel visibility');
        await page.keyboard.press('Escape');
        await page.locator('#dock-tab-sandbox').click();
        await page.locator('.sandbox-mobile-close').click();
      }
    }
    for(const edition of ['aic/',''])for(const view of ['overview','risk','plans','evidence','spatial']){
      await page.setViewportSize({width:1440,height:960});
      await page.goto(origin+'/'+edition+'#'+view);
      await page.locator('#page-title').waitFor();
      await page.waitForFunction(()=>!document.querySelector('#refresh-all').disabled,null,{timeout:35000});
      if(view==='spatial')await page.locator('.layout-sandbox').waitFor({timeout:45000});
      check(await fits(),edition+view+' desktop layout fits');
      if(edition==='aic/')await shot(view+'-desktop');
      await page.setViewportSize({width:390,height:844});
      check(await fits(),edition+view+' mobile layout fits');
      await page.setViewportSize({width:320,height:844});
      check(await fits(),edition+view+' compact layout fits');
      if(edition==='aic/')await shot(view+'-mobile');
    }
    for(const path of ['/home.html','/aic/home.html','/aic/journal.html','/author-preview.html']){
      await page.setViewportSize({width:1440,height:960});
      await page.goto(origin+path);await page.waitForTimeout(2200);
      check(await fits(),path+' desktop fits');
      if(path.includes('/aic/'))check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await page.content()),path+' contains no university or supervisor identity');
      await shot(path.includes('journal')?'journal-desktop':path.includes('author-preview')?'author-desktop':path.includes('/aic/')?'home-desktop':'home-normal');
      for(const width of [390,320]){
        await page.setViewportSize({width,height:844});
        check(await fits(),path+' '+width+'px fits');
      }
      if(path.endsWith('home.html')){
        await page.locator('#menuButton').click();
        check(await page.locator('#navLinks').isVisible(),path+' mobile navigation opens');
        check(await page.locator('#navLinks a').nth(3).textContent()==='项目博客',path+' fourth item is project blog');
        await page.locator('#menuButton').click();
      }
      await shot(path.includes('journal')?'journal-mobile':path.includes('author-preview')?'author-mobile':path.includes('/aic/')?'home-mobile':'home-normal-mobile');
    }
    check(errors.length===0,'no uncaught browser exceptions');
    return {checks,errors,layouts,canvas};
  }finally{page.off('pageerror',onError);await page.unrouteAll();}
}
