async page=>{
  const context=await page.context().browser().newContext({viewport:{width:390,height:844}}),q=await context.newPage();
  await q.goto(new URL(page.url()).origin+'/aic/#risk');
  await q.locator('#region-mode').selectOption('history');
  await q.locator('#region-ai').uncheck();
  const pending=q.waitForResponse(r=>r.url().includes('/aic/regional-assess')&&r.request().method()==='POST');
  await q.locator('#regional-submit').click();await pending;
  const card=q.locator('.regional-cohorts article:visible');
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  await q.screenshot({path:'output/playwright/actionable-card-390.png'});
  return {text:(await card.innerText()).slice(0,900)};
}
