async (page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('http://127.0.0.1:5173/aic/#screen');
  await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
  await page.locator('#map-streets[aria-pressed=true]').waitFor();
  await page.locator('#map-home').click();
  await page.waitForTimeout(2500);
  const hidden = '#decision-screen > :not(.screen-map), .map-interaction, .sandbox-legend, .maplibregl-ctrl-top-left, .maplibregl-ctrl-top-right';
  try {
    await page.locator(hidden).evaluateAll(nodes => nodes.forEach(node => {
      node.dataset.captureVisibility = node.style.visibility;
      node.style.visibility = 'hidden';
    }));
    await page.locator('#workspace-map').screenshot({ path: 'public/aic/assets/homepage-scene.png' });
  } finally {
    await page.locator(hidden).evaluateAll(nodes => nodes.forEach(node => {
      node.style.visibility = node.dataset.captureVisibility || '';
      delete node.dataset.captureVisibility;
    }));
  }
}
