async (page) => {
  const root = new URL('/decision/', page.url());
  const checks = [], errors = [], grids = [];
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const onError = error => errors.push(error.message);
  const onResponse = async response => {
    if (!response.url().endsWith('/api/weather/sandbox/heatmap') || !response.ok()) return;
    try { const result = await response.json(); grids.push({ count: result.cells.features.length, snapshot: result.snapshot_sha256 }); } catch {}
  };
  const pixels = () => page.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas'), gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('Map WebGL2 context unavailable');
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buffer = new Uint8Array(w * h * 4), samples = [];
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
    for (let y = 20; y < h; y += 25) for (let x = 20; x < w; x += 25) {
      const i = 4 * (y * w + x); samples.push([buffer[i], buffer[i + 1], buffer[i + 2]]);
    }
    return { samples, width: w, height: h, colors: new Set(samples.map(p => p.join(','))).size };
  });
  page.on('pageerror', onError); page.on('response', onResponse);
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(new URL('aic/?capture=1#screen', root).href);
    await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
    await page.locator('#workspace-map[data-street-roads="120"]').waitFor({ timeout: 30000 });
    check(await page.locator('.screen-nav .competition-home-nav').isVisible(), 'public competition dashboard shows project homepage in top navigation');
    check((await page.locator('.maplibregl-ctrl-attrib').innerText()).includes('OpenFreeMap'), 'public competition map loads anonymous vector street source');
    check(await page.locator('.sandbox-legend').getAttribute('data-valid-cells') === '2372', 'public grid displays 2372 valid and 238 neutral cells');
    await page.locator('#map-home').click();
    await page.waitForTimeout(2000);
    const colored = await pixels();
    check(colored.width > 0 && colored.height > 0 && colored.colors > 30, 'public WebGL map renders diverse nonblank pixels');
    await page.locator('#sb-layer').selectOption('off');
    await page.waitForTimeout(700);
    const plain = await pixels();
    const changed = plain.samples.filter((p, i) => p.some((value, k) => Math.abs(value - colored.samples[i][k]) > 15)).length;
    check(changed > 50, 'heatmap changes actual map pixels rather than only legend text');
    check(plain.colors > 30, 'street basemap remains visible with heatmap disabled');
    await page.screenshot({ path: 'output/playwright/competition-label-free-streets-public.png' });
    await page.locator('#sb-layer').selectOption('utci');
    check(await page.locator('.sandbox-legend').getAttribute('data-total-cells') === '2610', 'uncomputed scenario retains neutral grid footprint on public release');
    await page.locator('#sb-layer').selectOption('weather');
    await page.screenshot({ path: 'output/playwright/competition-grid-stable-public-desktop.png' });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(250);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + 'px public dashboard has no horizontal overflow');
      check(await page.locator('.screen-nav .competition-home-nav').isVisible(), width + 'px homepage entry remains visible');
    }
    await page.screenshot({ path: 'output/playwright/competition-grid-stable-public-mobile.png' });
    await page.locator('.screen-nav .competition-home-nav').click();
    await page.waitForURL('**/aic/home.html');
    check(await page.locator('section.content').count() >= 5, 'public competition homepage has full project and team presentation');
    check(!/郑州大学|Zhengzhou University|闫梓宇/i.test(await page.content()), 'public competition homepage remains anonymous');
    await page.goto(new URL('aic/', root).href);
    await page.waitForURL('**/aic/home.html');
    check(true, 'competition root without hash opens the project homepage');
    await page.goto(new URL('aic/journal.html', root).href);
    check(await page.locator('section.content').count() === 3, 'public competition journal renders three adapted articles');
    check(!/郑州大学|Zhengzhou University|闫梓宇/i.test(await page.content()), 'public competition journal remains anonymous');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(new URL('?capture=1#screen', root).href);
    await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
    check(await page.locator('#workspace-map').getAttribute('data-basemap') === 'imagery', 'standard edition retains its original imagery basemap');
    check(await page.locator('.screen-nav .competition-home-nav').count() === 0, 'competition navigation is not injected into standard edition');
    check(grids.some(grid => grid.count === 2610), 'API response and displayed grid both contain 2610 cells');
    check(errors.length === 0, 'no uncaught browser errors across public competition and standard editions');
    return { checks, errors, grids, canvas: { width: colored.width, height: colored.height, colors: colored.colors, heatmap_changed_samples: changed }, url: page.url(), note: 'Read-only navigation and non-persisting heatmap requests only; no fault injection or record mutation.' };
  } finally { page.off('pageerror', onError); page.off('response', onResponse); }
}
