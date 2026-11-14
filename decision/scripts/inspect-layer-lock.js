async (page) => {
  await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
  const state = () => page.evaluate(() => ({
    view: document.querySelector('.layout-sandbox').dataset.displayMode,
    layer: document.querySelector('#sb-layer').value,
    options: [...document.querySelector('#sb-layer').options].map(o => ({value:o.value,disabled:o.disabled})),
    legend: document.querySelector('.sandbox-legend').textContent,
  }));
  const initial = await state();
  await page.locator('[data-mode="delta"]').click();
  const delta = await state();
  await page.locator('#sb-layer').selectOption({value:'weather'}, {force:true});
  const attemptedWeather = await state();
  await page.locator('[data-operation="add"]').count();
  return {initial,delta,attemptedWeather};
}
