async (page) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) throw new Error('Fault injection is local-only');
  const checks = [];
  const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.unrouteAll();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://127.0.0.1:5173/aic/#screen');
  await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
  await page.locator('#workspace-map[data-street-roads="120"]').waitFor({ timeout: 30000 });
  const home = page.locator('.screen-nav .competition-home-nav');
  check(await home.isVisible() && await home.getAttribute('href') === './home.html', 'competition dashboard exposes a direct project-home link');
  const mapResources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  check(mapResources.some(url => url.includes('tiles.openfreemap.org/styles/positron')) && (await page.locator('.maplibregl-ctrl-attrib').innerText()).includes('OpenFreeMap'), 'label-free vector street style loads without an API key');
  check(!mapResources.some(url => url.includes('cartocdn.com')), 'no API-key-watermarked tile provider is requested');
  check(await page.locator('#map-streets').getAttribute('aria-pressed') === 'true', 'anonymous street basemap is active by default');
  await page.locator('#map-imagery').click();
  check(await page.locator('#map-imagery').getAttribute('aria-pressed') === 'true', 'simple map mode can be selected');
  await page.locator('#map-streets').click();
  check(await page.locator('#map-streets').getAttribute('aria-pressed') === 'true', 'street mode can be restored');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(180);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px dashboard has no horizontal overflow`);
    check(await home.isVisible() && await home.evaluate(node => node.getBoundingClientRect().right <= innerWidth + 1), `${width}px project-home link remains visible`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await home.click();
  await page.waitForURL('**/aic/home.html');
  check((await page.title()).includes('AIC 智慧气象'), 'project-home link opens the anonymous competition homepage');
  check(!/郑州大学|Zhengzhou University|闫梓宇/i.test(await page.locator('body').innerText()), 'competition homepage contains no school or supervisor identity');

  await page.goto('http://127.0.0.1:5173/aic/#screen');
  const legend = page.locator('.sandbox-legend');
  await legend.waitFor();
  await page.waitForFunction(() => (document.querySelector('#sb-status')?.textContent || '').includes('每120秒刷新'), { timeout: 60000 });
  const cellCount = await legend.getAttribute('data-total-cells');
  const validCount = await legend.getAttribute('data-valid-cells');
  await page.route('**/api/weather/sandbox/heatmap', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"QA injected refresh failure"}' }));
  try {
    await page.locator('#sb-refresh').click();
    await page.getByText('热图刷新失败，暂保留上次网格', { exact: false }).waitFor();
    check(await legend.getAttribute('data-total-cells') === cellCount, 'failed heatmap refresh preserves the current grid footprint');
    check(await legend.getAttribute('data-valid-cells') === validCount, 'failed heatmap refresh retains valid values, not just an empty legend');
    check(await legend.getAttribute('data-refresh-state') === 'stale', 'retained heatmap is explicitly marked stale');
    check((await legend.innerText()).includes('刷新失败，保留上次数据'), 'legend discloses that cached values were retained');
  } finally {
    await page.unroute('**/api/weather/sandbox/heatmap');
  }
  await page.locator('#sb-refresh').click();
  await page.waitForFunction(() => document.querySelector('.sandbox-legend')?.dataset.refreshState === 'current');
  check(await legend.getAttribute('data-total-cells') === cellCount, 'successful retry restores the full grid and clears the failure marker');
  await page.locator('#sb-auto').uncheck();
  await page.locator('#sb-layer').selectOption('utci');
  check(await legend.getAttribute('data-total-cells') === cellCount && await legend.getAttribute('data-valid-cells') === '0', 'uncomputed scenario retains neutral grid geometry without inventing UTCI');
  check((await legend.innerText()).includes('等待有效推演结果'), 'neutral scenario cells explain why calculation results are not shown');
  await page.locator('#sb-layer').selectOption('weather');
  check(await legend.getAttribute('data-valid-cells') === validCount, 'returning to temperature immediately restores the cached heatmap');
  const gridResponse = resolution => page.waitForResponse(response => response.url().endsWith('/api/weather/sandbox/heatmap') && response.request().postDataJSON()?.grid_resolution_m === resolution && response.ok(), { timeout: 60000 });
  const coarsePending = gridResponse(100);
  await page.locator('#sb-grid-resolution').selectOption('100');
  const coarse = await (await coarsePending).json();
  await page.waitForFunction(count => document.querySelector('.sandbox-legend')?.dataset.totalCells === String(count), coarse.cells.features.length);
  check(coarse.cells.features.length > 0 && coarse.cells.features.length < Number(cellCount), 'changing spacing loads a distinct coarse grid');
  const finePending = gridResponse(30);
  await page.locator('#sb-grid-resolution').selectOption('50');
  await page.locator('#sb-grid-resolution').selectOption('30');
  await finePending;
  await page.waitForFunction(count => document.querySelector('.sandbox-legend')?.dataset.totalCells === count, cellCount);
  await page.waitForTimeout(500);
  check(await legend.getAttribute('data-total-cells') === cellCount, 'rapid spacing changes cannot leave a late obsolete grid on screen');
  await page.locator('.screen-nav a[href="#overview"]').click();
  await page.locator('.primary-nav a[href="#screen"]').click();
  await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
  check(await page.locator('.maplibregl-canvas').count() === 1 && await page.locator('.sandbox-legend').count() === 1, 'workspace round-trip restores one complete map and one grid legend');
  const styleUrl = 'https://tiles.openfreemap.org/styles/positron';
  await page.route(styleUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  try {
    await page.reload();
    await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
    check(await page.locator('.maplibregl-canvas').count() === 1, 'street-provider failure still allows the campus and grid to initialize');
    check(await page.locator('#map-state').evaluate(node => node.classList.contains('warn')), 'street-provider failure is disclosed');
    await page.locator('#map-imagery').click();
    await page.locator('#map-streets').click();
    check(await page.locator('#map-state').evaluate(node => node.classList.contains('warn')), 'changing basemap cannot falsely clear the provider failure warning');
    check((await page.locator('.maplibregl-ctrl-attrib').innerText()).includes('OpenStreetMap'), 'fallback still retains attribution for the local geometry');
  } finally { await page.unroute(styleUrl); }
  check(errors.length === 0, 'no browser runtime errors');
  return { checks, errors, url: page.url() };
}
