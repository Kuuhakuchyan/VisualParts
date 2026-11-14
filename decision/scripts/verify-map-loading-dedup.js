async page => {
  const origin = new URL(page.url()).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Fault injection is local-only');
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 } });
  const qa = await context.newPage(), checks = [], errors = [];
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  qa.on('pageerror', error => errors.push(error.message));
  try {
    for (const edition of ['', 'aic/']) {
      const counts = { roads: 0, landcover: 0 };
      let release, failBuildings = true;
      const blocked = new Promise(resolve => { release = resolve; });
      const routes = [
        ['roads', '**/data/campus-streets.geojson'],
        ['landcover', '**/data/campus-lcz-simulation.geojson'],
      ];
      for (const [name, pattern] of routes) await qa.route(pattern, async route => {
        counts[name]++;
        await blocked;
        await route.continue();
      });
      await qa.route('**/api/weather/sandbox/buildings', route => failBuildings
        ? route.fulfill({ status: 503, json: { detail: 'QA temporary building failure' } }) : route.continue());
      try {
        await qa.goto(origin + '/' + edition + '#screen');
        await qa.waitForFunction(() => document.querySelector('#map-state')?.textContent.includes('建筑暂不可用'));
        await qa.waitForFunction(() => !document.querySelector('#refresh-all').disabled);
        check(counts.roads === 1 && counts.landcover === 1, edition + ' initial geometry requests started once');
        await qa.locator('#screen-refresh').click();
        await qa.waitForTimeout(200);
        check(counts.roads === 1 && counts.landcover === 1, edition + ' refresh joins pending road and landcover loads');
        release();
        await qa.waitForFunction(() => !document.querySelector('#screen-refresh').disabled, null, { timeout: 60000 });
        await qa.waitForFunction(() => Number(document.querySelector('#workspace-map')?.dataset.streetRoads) > 0
          && Number(document.querySelector('#workspace-map')?.dataset.landcover) > 0);
        check(true, edition + ' both geometry layers finish after shared load');
        failBuildings = false;
        await qa.locator('#screen-refresh').click();
        await qa.locator('#sb-auto').waitFor({ timeout: 60000 });
        await qa.locator('#sb-auto').uncheck();
        await qa.waitForFunction(() => !document.querySelector('#screen-refresh').disabled, null, { timeout: 60000 });
        check(counts.roads === 1 && counts.landcover === 1, edition + ' successful geometry is not redundantly fetched on later refresh');
        check(await qa.locator('#workspace-map').getAttribute('data-buildings') === '225', edition + ' failed building initialization remains recoverable');
        check(await qa.locator('#sb-run').isVisible(), edition + ' sandbox available after recovery');
      } finally {
        release();
        for (const [, pattern] of routes) await qa.unroute(pattern);
        await qa.unroute('**/api/weather/sandbox/buildings');
      }
    }
    check(errors.length === 0, 'no duplicate-source or layer initialization exceptions');
    return { checks, errors, note: 'Local failure and delay injection; real geometry and backend responses, no saved records.' };
  } finally { await context.close(); }
}
