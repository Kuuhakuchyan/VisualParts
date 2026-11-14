async page => {
  const context = await page.context().browser().newContext();
  const q = await context.newPage();
  try {
    await q.goto('http://127.0.0.1:5174/#screen');
    await q.locator('#dock-tab-sandbox').click();
    await q.locator('#sb-data-mode').waitFor({state:'attached',timeout:60000});
    await q.locator('#sb-data-mode').selectOption('live');
    return await q.evaluate(()=>({mode:document.querySelector('#sb-data-mode').value,
      anomalyDisabled:document.querySelector('#sb-layer option[value="anomaly"]').disabled,
      layer:document.querySelector('#sb-layer').value}));
  } finally { await context.close(); }
}
