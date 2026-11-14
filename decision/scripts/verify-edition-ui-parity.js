async (page) => {
  const origin = 'http://127.0.0.1:5173';
  const checks = [], errors = [], editions = [];
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const onError = error => errors.push(error.message);
  const theme = () => page.evaluate(() => {
    const properties = {
      '.screen-header': ['backgroundColor', 'height', 'paddingLeft'],
      '.screen-right': ['backgroundColor', 'width', 'borderRadius'],
      '.screen-dock-tabs button': ['fontSize', 'minHeight', 'color'],
      '.screen-map-tools': ['backgroundColor', 'borderRadius'],
    };
    return Object.fromEntries(Object.entries(properties).map(([selector, keys]) => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, Object.fromEntries(keys.map(key => [key, style[key]]))];
    }));
  });
  page.on('pageerror', onError);
  try {
    for (const competition of [false, true]) {
      const label = competition ? 'competition' : 'project';
      const home = competition ? './home.html' : '/home.html';
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(origin + (competition ? '/aic/' : '/') + '#screen');
      await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
      await page.locator('#workspace-map[data-street-roads="120"]').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => Number(document.querySelector('#workspace-map').dataset.landcover) > 0);
      check(await page.locator('.screen-home-nav').getAttribute('href') === home, label + ' header links to its own homepage');
      check(await page.locator('.screen-brand').getAttribute('href') === home, label + ' brand returns to its own homepage');
      check(await page.locator('.screen-home-nav').count() === 1, label + ' has exactly one header home entry');
      check(await page.locator('.screen-footer>a').count() === 0, label + ' has no duplicate footer home entry');
      const navigation = await page.locator('.screen-nav').innerText();
      const desktopTheme = await theme();
      const basemap = await page.locator('#workspace-map').getAttribute('data-basemap');
      check(basemap === 'streets' && await page.locator('#map-streets').getAttribute('aria-pressed') === 'true', label + ' defaults to the shared vector streets');
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
      check(resources.some(url => url.includes('tiles.openfreemap.org/styles/positron')), label + ' loads the shared vector style');
      check(!resources.some(url => url.includes('/tiles/world-topo/')), label + ' no longer requests the old raster street tiles');
      check((await page.locator('.maplibregl-ctrl-attrib').innerText()).includes('OpenFreeMap'), label + ' retains vector map attribution');
      await page.locator('#map-imagery').click();
      check(await page.locator('#workspace-map').getAttribute('data-basemap') === 'imagery', label + ' alternative basemap remains selectable');
      check(await page.locator('.sandbox-legend').getAttribute('data-total-cells') === '2610', label + ' basemap switch retains heatmap cells');
      if (!competition) {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: 'output/playwright/ui-parity-project-imagery.png' });
      }
      await page.locator('#map-streets').click();
      check(await page.locator('#map-streets').getAttribute('aria-pressed') === 'true', label + ' vector streets can be restored');
      check(await page.locator('.screen-dock-tabs [role=tab]').count() === 3, label + ' uses the three task tabs');
      await page.locator('[data-operation=add]').click();
      await page.locator('#dock-tab-risk').click();
      check(await page.locator('#workspace-map').getAttribute('data-interaction') === 'inspect', label + ' task switching cancels building interaction');
      await page.locator('#dock-tab-sandbox').click();
      await page.locator('#map-orbit').click();
      check(await page.locator('#map-orbit').getAttribute('aria-pressed') === 'true', label + ' orbit highlights while active');
      await page.locator('#map-orbit').click();
      check(await page.locator('#map-orbit').getAttribute('aria-pressed') === 'false', label + ' orbit highlight clears');
      await page.locator('#map-home').click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: 'output/playwright/ui-parity-' + label + '-desktop.png' });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' screen fits ' + width + 'px');
        check(await page.locator('.screen-home-nav').isVisible(), label + ' homepage entry is visible at ' + width + 'px');
        await page.screenshot({ path: 'output/playwright/ui-parity-' + label + '-' + width + '.png' });
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(origin + (competition ? '/aic/' : '/') + '#overview');
      await page.locator('#page-title').waitFor();
      check(await page.locator('.primary-nav>a').first().getAttribute('href') === home, label + ' workbench has matching home navigation');
      const workbench = await page.locator('.workspace-main').evaluate(node => ({ background: getComputedStyle(document.body).backgroundColor, color: getComputedStyle(node).color, font: getComputedStyle(node).fontFamily }));
      editions.push({ label, navigation, desktopTheme, workbench, basemap });
    }
    check(editions[0].navigation === editions[1].navigation, 'both editions use the same big-screen navigation');
    check(JSON.stringify(editions[0].desktopTheme) === JSON.stringify(editions[1].desktopTheme), 'both editions use the same panel, typography and toolbar styles');
    check(JSON.stringify(editions[0].workbench) === JSON.stringify(editions[1].workbench), 'both editions use the same workbench theme');
    for (const competition of [false, true]) {
      const label = competition ? 'competition' : 'project';
      const styleUrl = 'https://tiles.openfreemap.org/styles/positron';
      await page.route(styleUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
      try {
        await page.goto(origin + (competition ? '/aic/' : '/') + '#screen');
        await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
        check(await page.locator('.maplibregl-canvas').count() === 1, label + ' street provider failure retains campus and heatmap');
        check(await page.locator('#map-state').evaluate(node => node.classList.contains('warn')), label + ' street provider failure is disclosed');
        await page.locator('#map-imagery').click();
        await page.locator('#map-streets').click();
        check(await page.locator('#map-state').evaluate(node => node.classList.contains('warn')), label + ' switching back cannot hide a failed street provider');
      } finally { await page.unroute(styleUrl); }
    }
    check(errors.length === 0, 'no uncaught browser exceptions');
    return { checks, errors, editions };
  } finally { page.off('pageerror', onError); }
}
