async page => {
  const origin = new URL(page.url()).origin, local = ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname);
  const base = local ? '/' : '/decision/', checks = [], errors = [];
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 } });
  const q = await context.newPage();
  q.on('pageerror', error => errors.push(error.message));
  const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const pick = async () => {
    const point = await q.evaluate(() => {
      const s = window.__selectionQA, rect = s.map.getContainer().getBoundingClientRect();
      const mobile = innerWidth <= 600;
      for (const f of s.displayCells) {
        if (f.properties.display_state !== 'valid') continue;
        const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
        const coords = ring.slice(0, -1), center = coords.reduce((a, c) => [a[0] + c[0] / coords.length, a[1] + c[1] / coords.length], [0, 0]);
        const p = s.map.project(center), x = p.x + rect.left, y = p.y + rect.top;
        if (x > (mobile ? 20 : 450) && x < (mobile ? innerWidth - 20 : innerWidth - 370) && y > (mobile ? 180 : 310) && y < (mobile ? 415 : 600) && document.elementFromPoint(x, y) === s.map.getCanvas()) return { x, y, gridId: f.properties.grid_id, value: f.properties.temperature_c };
      }
      throw Error('No unobscured valid cell available');
    });
    await q.mouse.click(point.x, point.y);
    await q.locator(q.viewportSize().width <= 600 ? '#screen-selection-summary .selection-reading' : '.grid-selection-popup .selection-reading').waitFor();
    return point;
  };
  try {
    for (const edition of ['', 'aic/']) {
      const label = edition ? 'competition' : 'project';
      await q.setViewportSize({ width: 1440, height: 960 });
      await q.goto(origin + base + edition + '#screen');
      await q.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
      await q.locator('#dock-tab-sandbox').click();
      await q.locator('#sb-auto').uncheck();
      await q.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map(r => r.name).find(u => /\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));
        const { LayoutSandbox } = await import(url), paint = LayoutSandbox.prototype.paint;
        LayoutSandbox.prototype.paint = function (...args) { window.__selectionQA = this; return paint.apply(this, args); };
      });
      await q.locator('#sb-layer').selectOption('weather');
      await q.locator('#dock-tab-risk').click();
      await q.locator('#map-home').click(); await q.waitForTimeout(650);
      const selected = await pick(), card = q.locator('.grid-selection-popup');
      check(await card.locator('[data-grid-id]').getAttribute('data-grid-id') === selected.gridId, label + ' exact picked grid identity');
      check((await card.locator('.selection-reading').innerText()).includes(selected.value.toFixed(1)), label + ' temperature matches actual displayed cell');
      check(await card.locator('.selection-region').count() === 1 && await card.locator('.selection-cell').count() === 1, label + ' two compact card columns');
      await card.locator('summary').click();
      check((await card.innerText()).includes(selected.gridId), label + ' original grid identifier available in details');
      await q.screenshot({ path: 'output/playwright/grid-selection-' + label + '-1440.png' });
      // Exercise the real paint path with another metric, not a fabricated response.
      await q.evaluate(() => { const s = window.__selectionQA; s.$('sb-layer').value = 'lcz'; s.paint(); });
      check((await card.innerText()).includes('LCZ分类'), label + ' open card follows displayed metric');
      await q.evaluate(() => { const s = window.__selectionQA; s.$('sb-layer').value = 'weather'; s.paint(); });
      const weatherRequest = q.waitForResponse(r => r.url().endsWith('/sandbox/heatmap') && r.request().method() === 'POST');
      await q.evaluate(() => window.__selectionQA.refreshHeat());
      const response = await weatherRequest, heat = await response.json();
      check(response.ok(), label + ' refresh uses real heatmap endpoint');
      await q.waitForFunction(hash => document.querySelector('.grid-selection-popup [data-snapshot]')?.dataset.snapshot === hash, heat.snapshot_sha256);
      check(await card.locator('[data-grid-id]').getAttribute('data-grid-id') === selected.gridId, label + ' refresh retains selected grid and current snapshot');
      await q.locator('#dock-tab-sandbox').click(); await q.locator('[data-operation="add"]').click();
      check(await card.count() === 0, label + ' construction closes inspection card');
      check(await q.locator('#workspace-map').getAttribute('data-interaction') === 'add', label + ' card does not block construction mode');
      await q.locator('#dock-tab-risk').click();
      for (const width of [390, 320]) {
        await q.setViewportSize({ width, height: 844 });
        await q.locator('#map-home').click(); await q.waitForTimeout(650);
        await pick();
        check(await q.locator('#screen-selection-summary').isVisible(), label + ' mobile selection summary visible ' + width);
        check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' selected layout fits ' + width);
        const bounds = await q.locator('#screen-selection-summary').boundingBox();
        check(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && !await card.isVisible(), label + ' mobile sheet fits without duplicate popup ' + width);
        await q.screenshot({ path: 'output/playwright/grid-selection-' + label + '-' + width + '.png' });
        await q.locator('.selection-dismiss').click();
        check(await q.locator('#screen-selection-summary').isHidden(), label + ' close clears mobile summary ' + width);
      }
      await q.setViewportSize({ width: 1440, height: 960 });
      const timelineResponse = await q.request.get(origin + '/api/weather/aic/timeline?site=campus');
      const timeline = await timelineResponse.json(), future = timeline.points.filter(p => p.period === 'forecast');
      check(timelineResponse.ok() && future.length === 24, label + ' real API contains 24 future hourly points');
      check(future.every((p, i) => !i || Date.parse(p.time) - Date.parse(future[i - 1].time) === 3600000), label + ' forecast hours are consecutive');
      check(timeline.snapshot.units.wind_speed_10m === 'm/s' && timeline.snapshot.units.temperature_2m === '°C', label + ' forecast units and provenance present');
      if (edition) check(!/郑州大学|闫梓宇|Zhengzhou University/.test(await q.locator('body').innerText()), label + ' selection remains anonymous');
    }
    check(!errors.length, 'no uncaught selection runtime exceptions');
    return { checks, errors };
  } catch (error) { await q.screenshot({ path: 'output/playwright/grid-selection-failure.png' }); throw Error(String(error) + '; passed: ' + checks.join(' | ')); }
  finally { await context.close(); }
}
