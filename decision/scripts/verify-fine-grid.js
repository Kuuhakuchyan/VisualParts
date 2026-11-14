async page => {
  const origin = new URL(page.url()).origin;
  const local = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname);
  const checks = [], records = [], errors = [];
  const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  for (const edition of ['project', 'competition']) {
    const url = local ? origin + (edition === 'competition' ? '/aic/' : '/') :
      edition === 'competition' ? 'https://aic.nogamenolife.cn/aic/' : 'https://weather.nogamenolife.cn/decision/';
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 } });
    const q = await context.newPage();
    const requests = [];
    q.on('pageerror', error => errors.push(error.message));
    q.on('request', r => { if (/\/sandbox\/(collaborate|simulate)$/.test(r.url())) requests.push({url:r.url(),input:r.postDataJSON()}); });
    try {
      await q.goto(url + '#screen');
      await q.locator('.sandbox-legend[data-valid-cells]:not([data-valid-cells="0"])').waitFor({ timeout: 60000 });
      await q.locator('#dock-tab-sandbox').click(); await q.locator('#sb-auto').uncheck();
      await q.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map(r => r.name).find(u => /\/sandbox(?:-[^/]+)?\.js(?:\?|$)/.test(u));
        const { LayoutSandbox } = await import(url), paint = LayoutSandbox.prototype.paint;
        LayoutSandbox.prototype.paint = function (...args) { window.__fineGridQA = this; return paint.apply(this, args); };
      });
      check(await q.locator('#sb-layer').inputValue() === 'anomaly', edition + ' defaults to explicitly simulated warm/cool field');
      check(await q.locator('#sb-resolution').inputValue() === '30', edition + ' full-campus computation defaults to 30m');
      check(!await q.locator('#sb-resolution option[value="30"]').isDisabled(), edition + ' full-campus 30m is supported');
      await q.locator('#sb-layer').selectOption('weather'); await q.locator('#sb-layer').selectOption('anomaly');
      await q.waitForFunction(() => window.__fineGridQA?.displayCells.length > 1000);
      const current = await q.evaluate(async () => {
        const s = window.__fineGridQA, cells = s.displayCells.filter(f => f.properties.display_state === 'valid');
        const values = cells.map(f => f.properties.delta_t_grid_c);
        return { count: cells.length, cold: Math.min(...values), warm: Math.max(...values),
          matches: (await s.map.getSource('sandbox-heat').getData()).features.every(f => f.properties.value === f.properties.delta_t_grid_c),
          temperatures: cells.every(f => Math.abs(f.properties.temperature_c - s.heat.baseline.temperature_c - f.properties.delta_t_grid_c) < .0011) };
      });
      check(current.cold < 0 && current.warm > 0, edition + ' actual simulated values include cold and warm cells');
      check(current.matches && current.temperatures, edition + ' colors match API offsets and underlying temperatures');
      check((await q.locator('.sandbox-legend').innerText()).includes('冷暖分布'), edition + ' legend identifies anomaly instead of risk');
      await q.screenshot({ path: 'output/playwright/fine-grid-' + edition + '-current.png' });
      await q.locator('[data-screen-panel="risk"]').first().click();
      await q.locator('#region-mode').selectOption('history'); await q.locator('#region-ai').uncheck();
      for (const [key, value] of Object.entries({ west: 113.526, east: 113.530, south: 34.812, north: 34.816 }))
        await q.locator('#bound-' + key).fill(String(value));
      const assessment = q.waitForResponse(r => r.url().endsWith('/aic/regional-assess'), { timeout: 120000 });
      await q.locator('#regional-submit').click(); check((await assessment).ok(), edition + ' historical simulation context loads');
      await q.keyboard.press('Escape'); await q.locator('#map-home').click(); await q.waitForTimeout(900);
      await q.locator('[data-mode="edit"]').click(); await q.locator('[data-operation="add"]').click();
      for (const id of ['width', 'depth']) await q.locator('#sb-' + id).fill('20');
      await q.locator('#sb-height').fill('60');
      const point = await q.evaluate(() => {
        const s = window.__fineGridQA, r = document.querySelector('#workspace-map').getBoundingClientRect();
        const p = s.map.project([113.528143, 34.813813]); return { x: r.left + p.x, y: r.top + p.y };
      });
      await q.mouse.click(point.x, point.y);
      check(!await q.locator('#sb-confirm').isDisabled(), edition + ' fine grid does not block building placement');
      const validation = q.waitForResponse(r => r.url().endsWith('/sandbox/validate'));
      await q.locator('#sb-confirm').click(); check((await validation).ok(), edition + ' valid building accepted');
      await q.waitForFunction(() => document.querySelector('.layout-sandbox').dataset.validating === 'false');
      const pending = q.waitForResponse(r => r.url().endsWith('/sandbox/collaborate'), { timeout: 120000 });
      const started = Date.now(); await q.locator('#sb-run').click(); const response = await pending, result = await response.json();
      check(response.ok(), edition + ' fine-grid physical inference succeeds');
      check(result.resolution_m === 30 && result.summary.total_cells > 120, edition + ' inference computes actual 30m cells');
      check(result.summary.changed_cells > 0 && result.summary.local_delta_min_c < 0, edition + ' building produces localized thermal changes');
      await q.waitForFunction(hash => document.querySelector('#workspace-map').dataset.resultSha256 === hash, result.report_sha256);
      const grid = await q.evaluate(async () => {
        const s = window.__fineGridQA, rendered = (await s.map.getSource('sandbox-heat').getData()).features;
        return { count: s.displayCells.length, valid: rendered.length, equal: JSON.stringify(s.result.cells.features.map(f => f.properties)) ===
          JSON.stringify(s.displayCells.map(({properties: {display_state, display_reason, ...p}}) => p)),
          values: rendered.every(f => f.properties.value === f.properties.delta_utci_c) };
      });
      check(grid.equal && grid.values && grid.count === result.cells.features.length, edition + ' rendered and picked grids are identical to API result');
      await q.locator('#sb-report').click();
      check((await q.locator('#sb-report-content').innerText()).includes('逐格邻域'), edition + ' report preserves per-grid inference');
      await q.keyboard.press('Escape'); await q.screenshot({ path: 'output/playwright/fine-grid-' + edition + '-inference.png' });
      await q.locator('#sb-show-weather').click(); check(await q.locator('#sb-layer').inputValue() === 'anomaly', edition + ' returning to weather restores cold/warm field');
      await q.locator('#sb-data-mode').selectOption('live');
      await q.waitForFunction(()=>document.querySelector('#sb-layer option[value="anomaly"]').disabled);
      check(await q.locator('#sb-layer option[value="anomaly"]').evaluate(el=>el.disabled), edition + ' real weather cannot use simulated anomaly');
      check(await q.locator('#sb-layer').inputValue() === 'weather', edition + ' mode switch restores absolute weather layer');
      await q.setViewportSize({ width: 390, height: 844 });
      check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), edition + ' mobile has no horizontal overflow');
      await q.screenshot({ path: 'output/playwright/fine-grid-' + edition + '-mobile.png' });
      records.push({ edition, current, inference_ms: Date.now() - started, resolution_m: result.resolution_m, summary: result.summary, grid });
    } catch (error) {
      await q.screenshot({ path: 'output/playwright/fine-grid-' + edition + '-failure.png' });
      throw Error(error.message + JSON.stringify({requests, errors, state:await q.evaluate(()=>({status:document.querySelector('#sb-status')?.textContent,error:document.querySelector('#sb-error')?.textContent,busy:window.__fineGridQA?.busy,disposed:window.__fineGridQA?.disposed}))}));
    } finally { await context.close(); }
  }
  check(!errors.length, 'no browser runtime errors'); return { checks, records, errors };
}
