async (page) => {
  const checks=[],errors=[];
  const ok=(v,name)=>{if(!v)throw new Error(name);checks.push(name);};
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:960});
  await page.waitForSelector('#sb-auto');await page.locator('#sb-auto').uncheck();
  await page.locator('[data-mode="edit"]').click();
  await page.locator('#map-home').click();
  const visible=selector=>page.locator(selector).isVisible();
  ok(await visible('#sb-editor')&&!await visible('.sandbox-dimensions'),'marking has its own panel without building dimensions');
  ok(!await visible('#sb-confirm')&&!await visible('#sb-edit'),'marking cannot expose construction commands');
  await page.locator('[data-operation="add"]').click();
  ok(await visible('.sandbox-dimensions')&&await visible('#sb-confirm'),'construction exposes dimensions and its own confirmation');
  ok((await page.locator('#sb-confirm').textContent()).includes('确认建造'),'construction action is explicitly named');
  await page.locator('#sb-width').fill('-1');await page.mouse.click(710,440);
  ok(await page.locator('#sb-confirm').isDisabled(),'invalid dimensions cannot submit');
  await page.locator('[data-operation="remove"]').click();
  ok(!await visible('.sandbox-dimensions')&&await page.locator('#sb-width').isDisabled(),'removal ignores hidden construction inputs');
  ok((await page.locator('#sb-confirm').textContent()).includes('确认拟拆除'),'removal has a distinct command');
  ok(await page.locator('#sb-confirm').isDisabled(),'removal requires a building selection');
  await page.locator('[data-operation="move"]').click();
  ok(!await visible('.sandbox-dimensions')&&(await page.locator('#sb-tool-title').textContent()).includes('移动'),'moving has a destination panel rather than a dimension editor');
  await page.locator('[data-operation="move"]').click();
  ok(await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect','second tool click cancels the active action');
  for(const [mode,title] of [['baseline','现状基线'],['proposed','方案预览'],['delta','前后差值']]){
    await page.locator('[data-mode="'+mode+'"]').click();
    ok(!await visible('#sb-editor')&&await visible('#sb-view-panel'),mode+' isolates viewing from editing');
    ok((await page.locator('#sb-view-title').textContent())===title,mode+' has its own heading');
    ok(await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect',mode+' cancels geometry actions');
  }
  ok(await page.locator('#sb-layer').inputValue()==='utci','delta view uses actual comparable UTCI differences');
  ok(!await page.locator('#sb-layer option[value="weather"]').evaluate(option=>option.disabled),'weather remains reachable from delta instead of locking the user');
  ok((await page.locator('#sb-view-state').textContent()).includes('尚未完成推演'),'missing result is explicit rather than a fake difference');
  await page.locator('#sb-enter-edit').click();
  ok(await visible('#sb-editor')&&!await visible('#sb-view-panel'),'edit entry restores the tool workspace');
  ok(await page.locator('#sb-layer').inputValue()!=='utci','leaving empty delta restores the previous weather layer');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.sandbox-mobile-toggle').click();
  await page.locator('[data-operation="add"]').click();
  ok(await page.locator('#decision-screen').evaluate(el=>el.classList.contains('sandbox-mobile-open')),'mobile tool switch keeps controls open');
  ok(await visible('.sandbox-dimensions'),'mobile construction controls remain usable');
  await page.locator('#sb-width').fill('20');
  await page.screenshot({path:'output/playwright/contextual-sandbox-mobile.png'});
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:960});
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,null,{timeout:2000});
    ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px layout has no horizontal overflow');
  }
  await page.keyboard.press('Escape');
  ok(await page.locator('#workspace-map').getAttribute('data-interaction')==='inspect','Escape exits pending construction');
  await page.screenshot({path:'output/playwright/contextual-sandbox-desktop.png'});
  ok(errors.length===0,'no browser runtime errors');
  return {checks,errors,note:'No server records were created or removed.'};
}
