async page => {
  const local = ['localhost', '127.0.0.1'].includes(new URL(page.url()).hostname), origin = new URL(page.url()).origin;
  const checks = [], errors = [], evidence = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  for (const edition of ['project', 'competition']) {
    const url = local ? origin + (edition === 'project' ? '/' : '/aic/') : edition === 'project' ? 'https://weather.nogamenolife.cn/decision/' : 'https://aic.nogamenolife.cn/aic/';
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 } }), q = await context.newPage();
    let stage = 'load', release, firstRelease;
    const requests = [];
    q.on('pageerror', error => errors.push(error.message));
    q.on('request', r => { if (r.url().endsWith('/sandbox/simulate')) requests.push({ time: r.postDataJSON().valid_time, at: Date.now() }); });
    await q.addInitScript(() => performance.setResourceTimingBufferSize(10000));
    try {
      await q.goto(url + '?qa=dwell#screen', { waitUntil: 'domcontentloaded' });
      await q.locator('#workspace-map[data-buildings="225"]').waitFor({ timeout: 65000 });
      await q.locator('#screen-forecast-hour:not([disabled])').waitFor({ timeout: 40000 });
      await q.locator('#sb-auto').waitFor({ state: 'attached', timeout: 40000 });
      await q.evaluate(async () => {
        const urls = performance.getEntriesByType('resource').map(r => r.name);
        const sandboxURL = urls.find(u => /\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));
        const { LayoutSandbox } = await import(sandboxURL), paint = LayoutSandbox.prototype.paint;
        LayoutSandbox.prototype.paint = function (...args) { window.__dwellSandbox = this; return paint.apply(this, args); };
      });
      await q.locator('#dock-tab-sandbox').click(); await q.locator('#sb-auto').uncheck();
      await q.locator('#sb-layer').selectOption('utci');
      await q.evaluate(() => {
        const s = window.__dwellSandbox;
        const bounds = { west: 113.527, east: 113.531, south: 34.812, north: 34.816 };
        s.state.regionalDraft = { ...s.regional(), bounds }; s.setBounds(bounds);
      });
      const frame = () => q.evaluate(async () => {
        const s = window.__dwellSandbox, el = document.getElementById('workspace-map');
        return { ...el.dataset, label: document.getElementById('screen-forecast-value').innerText, cells: (await s.map.getSource('sandbox-heat').getData()).features.map(f => ({ id: f.id, value: f.properties.value })), cacheSize: s.forecastFrames.frames.size };
      });
      const waitPaint = hash => q.waitForFunction(h => {
        const d = document.getElementById('workspace-map').dataset;
        return (!h || d.resultSha256 === h) && !!d.frameRenderedAt && document.querySelector('.screen-forecast-browser').getAttribute('aria-busy') === 'false';
      }, hash, { timeout: 120000 });
      stage = 'first frame';
      const firstRequested = deferred(), firstFetched = deferred(); firstRelease = deferred();
      const firstRoute = async route => {
        firstRequested.resolve();
        const response = await route.fetch({ timeout: 120000 }); firstFetched.resolve();
        await firstRelease.promise; await route.fulfill({ response });
      };
      await q.route('**/sandbox/simulate', firstRoute);
      const firstResponse = q.waitForResponse(r => r.url().endsWith('/sandbox/simulate'), { timeout: 120000 });
      await q.locator('#screen-forecast-hour').fill('0');
      await firstRequested.promise;
      await q.locator('#screen-forecast-hour').fill('0'); await q.waitForTimeout(450);
      check(requests.length === 1, edition + ' repeated seek to pending hour shares one computation');
      await q.locator('#screen-forecast-play').click(); await q.locator('#screen-forecast-play').click(); await q.locator('#screen-forecast-play').click();
      check(requests.length === 1, edition + ' rapid play pause resume shares the pending result');
      await firstFetched.promise; firstRelease.resolve();
      const response = await firstResponse, first = await response.json(); check(response.ok(), edition + ' real forecast API succeeds');
      await waitPaint(first.report_sha256); const initial = await frame();
      await q.locator('#screen-forecast-play').click();
      check(await q.locator('.screen-forecast-browser').getAttribute('aria-busy') === 'false', edition + ' repeated seek and resume finish without a stuck loading state');
      await q.unroute('**/sandbox/simulate', firstRoute);
      check(initial.cells.length > 50, edition + ' physical grid has multiple computed cells');
      check(initial.validTime === first.valid_time, edition + ' visible map time matches API');
      const expected = first.cells.features.flatMap((f, i) => Number.isFinite(f.properties.proposed_utci_c) ? [{ id: i, value: f.properties.proposed_utci_c }] : []);
      check(JSON.stringify(initial.cells) === JSON.stringify(expected), edition + ' visible field exactly matches physical result');
      check(await q.locator('#screen-forecast-dwell').inputValue() === '5000', edition + ' default viewing duration is five seconds');
      const secondTime = await q.evaluate(() => window.__dwellSandbox.state.timeline.points.filter(p => p.period === 'forecast')[1].time);
      const requested = deferred(), fetched = deferred(); release = deferred(); let nextResponse;
      await q.route('**/sandbox/simulate', async route => {
        if (route.request().postDataJSON().valid_time !== secondTime) { await route.continue(); return; }
        requested.resolve(Date.now());
        try { nextResponse = await route.fetch({ timeout: 120000 }); fetched.resolve(); await release.promise; await route.fulfill({ response: nextResponse }); }
        catch (e) { fetched.resolve(); throw e; }
      });
      stage = 'dwell and slow next frame';
      await q.locator('#screen-forecast-play').click();
      await q.waitForFunction(old => {
        const d = document.getElementById('workspace-map').dataset;
        return d.frameCache === 'hit' && Number(d.frameRenderedAt) > Number(old);
      }, initial.frameRenderedAt);
      const started = await q.evaluate(() => performance.timeOrigin + Number(document.getElementById('workspace-map').dataset.frameRenderedAt));
      const nextRequestedAt = await requested.promise;
      check(nextRequestedAt - started >= 4950, edition + ' next request starts only after five visible seconds');
      const waiting = await frame();
      check(waiting.resultSha256 === first.report_sha256 && waiting.validTime === first.valid_time, edition + ' previous result remains while next hour computes');
      check(JSON.stringify(waiting.cells) === JSON.stringify(initial.cells), edition + ' previous heat field stays intact during computation');
      check(waiting.label.startsWith(initial.label.split('\n')[0]) && waiting.label.includes('正在计算'), edition + ' label identifies displayed hour and pending hour separately');
      await fetched.promise;
      const held = await frame(); check(held.resultSha256 === first.report_sha256, edition + ' result stays visible even with response held');
      const second = await nextResponse.json(); check(nextResponse.ok(), edition + ' second real forecast succeeds');
      release.resolve(); await waitPaint(second.report_sha256);
      await q.locator('#screen-forecast-play').click();
      check(await q.locator('#screen-forecast-play').getAttribute('aria-pressed') === 'false', edition + ' pause releases button state');
      const secondFrame = await frame();
      check(secondFrame.validTime === second.valid_time && second.valid_time === second.solar.time && second.valid_time === second.regional_report.layout_exposure.valid_time, edition + ' map solar and report share the same hour');
      await q.locator('#sb-report').click();
      check((await q.locator('#sb-report-content').innerText()).includes(second.report_sha256), edition + ' report opens the displayed final result');
      await q.locator('#sb-report-close').click();
      stage = 'cached seek'; const calls = requests.length;
      await q.locator('#screen-forecast-hour').fill('0'); await waitPaint(first.report_sha256);
      const restored = await frame();
      check(requests.length === calls && restored.frameCache === 'hit', edition + ' cached hour restores without a new API computation');
      check(JSON.stringify(restored.cells) === JSON.stringify(initial.cells), edition + ' cache restores identical final thermal values');
      await q.locator('#screen-forecast-dwell').selectOption('8000');
      check(await q.locator('#screen-forecast-dwell').inputValue() === '8000', edition + ' display duration can be changed to eight seconds');
      stage = 'input invalidation';
      await q.locator('#screen-forecast-play').click();
      await q.waitForFunction(() => document.getElementById('workspace-map').dataset.frameCache === 'hit' && document.querySelector('.screen-forecast-browser').getAttribute('aria-busy') === 'false');
      await q.locator('#sb-resolution').selectOption('50');
      check(await q.locator('#screen-forecast-play').getAttribute('aria-pressed') === 'false', edition + ' changing calculation inputs stops playback');
      check(await q.evaluate(() => window.__dwellSandbox.forecastFrames.frames.size === 0 && !window.__dwellSandbox.result), edition + ' changed inputs invalidate cache and report');
      check((await q.locator('#screen-forecast-value').innerText()).includes('待重新计算') && await q.locator('.screen-forecast-browser').getAttribute('aria-busy') === 'false', edition + ' disabled auto-recalculation does not falsely show computing');
      stage = 'mobile';
      for (const width of [360, 390, 768]) {
        await q.setViewportSize({ width, height: 800 });
        const layout = await q.evaluate(() => {
          const ids = ['screen-forecast-play', 'screen-forecast-value', 'screen-forecast-hour', 'screen-forecast-dwell', 'screen-forecast-current'];
          return { fits: document.documentElement.scrollWidth <= innerWidth + 1, boxes: ids.map(id => { const el = document.getElementById(id), r = el.getBoundingClientRect(); return { id, x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, overflow: el.scrollWidth > el.clientWidth + 2 }; }) };
        });
        check(layout.fits && layout.boxes.every(b => b.x >= 0 && b.right <= width + 1 && b.width > 0 && !b.overflow), edition + ' ' + width + 'px forecast controls fit without clipped text');
        if (width === 390) await q.screenshot({ path: `output/playwright/forecast-dwell-${local ? 'local' : 'public'}-${edition}-mobile.png` });
      }
      evidence.push({ edition, first: first.report_sha256, second: second.report_sha256, visibleMs: Math.round(nextRequestedAt - started), cells: initial.cells.length, requests: requests.length });
    } catch (error) {
      await q.screenshot({ path: 'output/playwright/forecast-dwell-failure-' + edition + '.png' });
      throw Error(error.message + ' ' + JSON.stringify({ edition, stage, checks, errors, requests, state: await q.evaluate(() => ({ map: document.getElementById('workspace-map')?.dataset, status: document.getElementById('sb-status')?.textContent, error: document.getElementById('sb-error')?.textContent, label: document.getElementById('screen-forecast-value')?.innerText, loading: document.querySelector('.screen-forecast-browser')?.getAttribute('aria-busy'), busy: window.__dwellSandbox?.busy })) }));
    } finally { firstRelease?.resolve(); release?.resolve(); await context.close(); }
  }
  check(!errors.length, 'no forecast playback runtime errors'); return { checks, errors, evidence };
}
