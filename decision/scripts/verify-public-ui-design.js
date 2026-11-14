async (page) => {
  const origin = 'https://weather.nogamenolife.cn';
  const checks = [], errors = [], screenThemes = [];
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const onError = error => errors.push(error.message);
  const onConsole = message => { if (message.type() === 'error') errors.push(message.text()); };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  try {
    for (const competition of [false, true]) {
      const label = competition ? 'competition' : 'project';
      const base = origin + '/decision/' + (competition ? 'aic/' : '');
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(base + '#screen');
      await page.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
      await page.locator('#workspace-map[data-street-roads="120"]').waitFor({ timeout: 30000 });
      check(await page.locator('#map-streets').getAttribute('aria-pressed') === 'true', label + ' defaults to vector streets');
      check((await page.locator('.maplibregl-ctrl-attrib').innerText()).includes('OpenFreeMap'), label + ' vector basemap loaded');
      check(await page.locator('.screen-dock-tabs [role=tab]').count() === 3, label + ' uses the new task tabs');
      screenThemes.push(await page.locator('.screen-right').evaluate(node => ({ color: getComputedStyle(node).backgroundColor, width: getComputedStyle(node).width, radius: getComputedStyle(node).borderRadius })));
      await page.locator('[data-operation=add]').click();
      await page.locator('#dock-tab-risk').click();
      check(await page.locator('#workspace-map').getAttribute('data-interaction') === 'inspect', label + ' task change clears building mode');
      await page.locator('#dock-tab-sandbox').click();
      await page.locator('#map-orbit').click();
      await page.locator('#map-orbit').click();
      check(await page.locator('#map-orbit').getAttribute('aria-pressed') === 'false', label + ' orbit stops and clears highlight');
      await page.screenshot({ path: 'output/playwright/public-ui-' + label + '-desktop.png' });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' screen fits ' + width + 'px');
        check(await page.locator('.screen-home-nav').isVisible(), label + ' home navigation remains visible at ' + width + 'px');
      }
      await page.screenshot({ path: 'output/playwright/public-ui-' + label + '-mobile.png' });
      await page.locator('.screen-home-nav').click();
      await page.locator('.hero h1').waitFor();
      check(await page.locator('.hero h1').innerText() === '微境探界', label + ' home link retains the project name');
      check(await page.locator('main section').count() === 6, label + ' full homepage has six sections');
      await page.locator('#intro').waitFor({ state: 'hidden' });
      if (competition) check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await page.content()), 'competition homepage remains anonymous');
      await page.locator('#menuButton').click();
      await page.locator('#navLinks a').nth(3).click();
      if (competition) {
        await page.waitForURL('**/aic/journal.html');
        check(await page.locator('section.content').count() === 3, 'anonymous journal opens from the fourth menu item');
      } else {
        await page.waitForURL('**/author/project/');
        check(await page.locator('.journal-entry').count() === 3, 'project journal opens from the fourth menu item');
        await page.locator('.journal-entry h2 a').first().click();
        await page.locator('.journal-prose').waitFor();
        check((await page.locator('.journal-prose').innerText()).length > 200, 'project article navigation renders full content');
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'project article fits mobile viewport');
      }
    }
    check(JSON.stringify(screenThemes[0]) === JSON.stringify(screenThemes[1]), 'public editions use the same big-screen panel design');
    for (const path of ['/monitor', '/sensors', '/logs']) {
      await page.goto(origin + path);
      await page.locator('body[class*=console-]').waitFor();
      check(await page.locator('.header').evaluate(node => getComputedStyle(node).backgroundColor) === 'rgb(255, 255, 255)', path + ' uses the new console theme');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path + ' fits compact viewport');
    }
    check(errors.length === 0, 'no uncaught browser exceptions or console errors');
    return { checks, errors, origin };
  } finally { page.off('pageerror', onError); page.off('console', onConsole); }
}
