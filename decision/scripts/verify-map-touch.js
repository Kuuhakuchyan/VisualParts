async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const mobile=await context.newPage(),checks=[];
  const expect=async(name,fn)=>{if(!await fn())throw new Error(name);checks.push(name);};
  try{
    await mobile.goto(page.url().split('#')[0]+'#screen');
    await mobile.locator('[data-operation="add"]').waitFor();
    await mobile.locator('.sandbox-mobile-toggle').tap();
    await mobile.locator('[data-operation="add"]').tap();
    await mobile.locator('.screen-dock-close').tap();
    await mobile.locator('#workspace-map').scrollIntoViewIfNeeded();
    const b=await mobile.locator('#workspace-map').boundingBox();
    await mobile.touchscreen.tap(b.x+b.width*.5,b.y+b.height*.26);
    await expect('touch tap places construction preview',async()=>(await mobile.locator('#sb-selection').textContent()).includes('建造位置'));
    await mobile.locator('[data-interaction-editor]').tap();
    await expect('touch editor exposes pending confirmation',async()=>!await mobile.locator('#sb-confirm').isDisabled());
    await mobile.locator('#dock-tab-risk').tap();
    await mobile.locator('#screen-select-region').tap();
    await expect('touch region cancels construction',async()=>await mobile.locator('#workspace-map').getAttribute('data-interaction')==='region'&&await mobile.locator('#sb-confirm').isDisabled());
    await mobile.locator('#workspace-map').scrollIntoViewIfNeeded();
    const area=await mobile.locator('#workspace-map').boundingBox();
    await mobile.touchscreen.tap(area.x+area.width*.35,area.y+area.height*.27);
    await mobile.waitForTimeout(100);
    await mobile.touchscreen.tap(area.x+area.width*.6,area.y+area.height*.36);
    await expect('touch two corners finish selection',async()=>await mobile.locator('#workspace-map').getAttribute('data-interaction')==='inspect');
    await mobile.locator('#map-orbit').tap();
    await expect('touch rotation starts',async()=>await mobile.locator('#map-orbit').getAttribute('aria-pressed')==='true');
    await mobile.locator('#map-orbit').tap();
    await expect('touch rotation stops',async()=>await mobile.locator('#map-orbit').getAttribute('aria-pressed')==='false');
    await mobile.screenshot({path:'output/playwright/interaction-touch.png'});
    return {url:mobile.url(),checks};
  }finally{await context.close();}
}
