async page => {
  const origin=new URL(page.url()).origin,checks=[],images=[],errors=[];
  if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Use the isolated local fixture');
  const context=await page.context().browser().newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const q=await context.newPage();q.on('pageerror',e=>errors.push(e.message));
  const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const capture=async(file,title)=>{await q.screenshot({path:'output/playwright/copyright-v1/'+file});images.push({file,title,url:q.url(),viewport:q.viewportSize(),role:'synthetic-touch-acceptance'});};
  try {
    await q.goto(origin+'/sensors');
    await q.getByRole('button',{name:/^UGV (在线|离线)$/}).tap();
    await q.locator('mobile-observations').getByRole('table').waitFor();
    check(await q.locator('mobile-observations tbody tr').count()===3,'touch UGV history shows all three samples');
    await q.getByRole('button',{name:'定位轨迹',exact:true}).tap();
    check(await q.locator('mobile-observations tbody tr').count()===3,'touch track tab shows positions');
    await q.getByRole('button',{name:'视觉图像',exact:true}).tap();
    await q.waitForFunction(()=>Array.from(document.querySelector('mobile-observations').shadowRoot.querySelectorAll('img')).every(i=>i.complete&&i.naturalWidth>0));
    check(await q.locator('mobile-observations img').count()>0,'touch visual frames render');
    await q.locator('mobile-observations').scrollIntoViewIfNeeded();
    await capture('17-touch-ugv-images.png','手机触控：UGV模拟视觉观测');
    await q.getByRole('button',{name:/^UAV (在线|离线)$/}).tap();
    await q.getByRole('heading',{name:'UAV',exact:true}).waitFor();
    check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'touch device page fits 390px');
    await q.goto(origin+'/decision/#screen');
    await q.locator('.sandbox-legend[data-total-cells]').waitFor({timeout:60000});
    await q.waitForFunction(()=>Number(document.querySelector('.sandbox-legend').dataset.totalCells)>5,null,{timeout:60000});
    await q.locator('.screen-dock-expand').tap();
    await q.locator('#dock-tab-sandbox').tap();
    await q.locator('#sb-auto').uncheck();
    await q.locator('[data-mode="edit"]').tap();
    for(const mode of ['add','select','remove','inspect']){
      await q.locator('[data-operation="'+mode+'"]').tap();
      check(await q.locator('[data-operation][aria-pressed="true"]').count()===1,'touch selects exactly one tool: '+mode);
      check(await q.locator('#workspace-map').getAttribute('data-interaction')===mode,'touch tool reaches map interaction: '+mode);
    }
    await q.locator('[data-operation="add"]').tap();
    await q.locator('#sb-width').fill('0');
    check(await q.locator('#sb-confirm').isDisabled(),'touch invalid width cannot submit construction');
    await q.locator('#sb-width').fill('20');
    await q.locator('[data-operation="inspect"]').tap();
    await q.locator('#sb-show-weather').tap();
    check(await q.locator('#workspace-map').getAttribute('data-interaction')==='inspect','touch return-to-heat exits edit operation');
    await q.locator('.screen-dock-expand').tap();
    await q.locator('#map-more').tap();
    const orbit=q.locator('#map-orbit');
    await orbit.tap();check(await orbit.getAttribute('aria-pressed')==='true','touch orbit starts');
    await orbit.tap();check(await orbit.getAttribute('aria-pressed')==='false','touch orbit stops and releases highlight');
    check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'touch decision screen fits viewport');
    await capture('18-touch-decision.png','手机触控：图层、工具与视角操作');
    check(!errors.length,'touch workflow has no page exceptions');
    return {passed:checks.length,checks,images,errors,browser:page.context().browser().version(),emulation:'mobile touch; not physical handset'};
  } finally {await context.close();}
}
