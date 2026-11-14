async (page) => {
  const origin = new URL(page.url()).origin;
  const local = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname);
  const base = local ? '/' : '/decision/';
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 } });
  const qa = await context.newPage(), checks = [], errors = [], reports = [];
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  qa.on('pageerror', error => errors.push(error.message));
  try {
    for (const edition of ['', 'aic/']) {
      await qa.goto(origin + base + edition + '#screen');
      await qa.locator('#sb-auto').waitFor({ timeout: 60000 });
      await qa.locator('#sb-auto').uncheck();
      await qa.locator('.screen-nav [data-screen-panel=risk]').click();
      await qa.locator('#region-mode').selectOption('history');
      await qa.locator('#region-grid-resolution').selectOption('100');
      await qa.locator('#region-ai').uncheck();
      const assessment = qa.waitForResponse(r => r.url().endsWith('/regional-assess') && r.request().method() === 'POST', { timeout: 120000 });
      await qa.locator('#regional-submit').click();
      const assessed = await assessment;
      check(assessed.ok(), edition + ' historical regional assessment succeeds');
      const regional = await assessed.json();
      await qa.locator('.regional-result-banner').waitFor({ timeout: 15000 });
      check(await qa.locator('.regional-output button.context-help svg').count() > 0, edition + ' report help icons render after AI section insertion');
      check((await qa.locator('#regional-result').innerText()).includes('非当前'), edition + ' historical data warning remains visible');
      check(await qa.locator('.regional-sources a').count() === regional.sources.length, edition + ' source links survive sample-note updates');
      if (regional.samples.length > 80) check(await qa.locator('#regional-sample-note').isVisible(), edition + ' truncated sample table has a visible count');
      await qa.locator('#screen-panel-close').click();
      await qa.locator('#sb-resolution').selectOption('100');
      const simulated = qa.waitForResponse(r => /\/sandbox\/(simulate|collaborate)$/.test(r.url()) && r.request().method() === 'POST', { timeout: 120000 });
      await qa.locator('#sb-run').click();
      const response = await simulated, result = await response.json();
      check(response.ok(), edition + ' sandbox calculation succeeds');
      await qa.waitForFunction(hash => document.querySelector('#workspace-map').dataset.resultSha256 === hash, result.report_sha256, { timeout: 20000 });
      check(await qa.locator('#sb-summary button.context-help svg').count() === 1, edition + ' numerical summary help icon is visible');
      check((await qa.locator('#sb-summary').innerText()).includes('未现场标定'), edition + ' calibration status remains visible');
      const contrast = await qa.locator('#sb-summary .notice').evaluate(node => {
        const style = getComputedStyle(node);
        const luminance = color => {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      check(contrast >= 4.5, edition + ' simulation status has readable text contrast');
      await qa.getByRole('button', { name: '热暴露统计说明', exact: true }).click();
      await qa.locator('#workspace-context-tooltip').waitFor({ state: 'visible' });
      check((await qa.locator('#workspace-context-tooltip').innerText()).includes('不是人员患病比例'), edition + ' risk metric definition is available');
      await qa.keyboard.press('Escape');
      await qa.locator('#sb-report').click();
      check((await qa.locator('#sb-report-content').innerText()).includes(result.report_sha256), edition + ' report matches latest map result');
      await qa.locator('#sb-report-close').click();
      reports.push({ edition, report_sha256: result.report_sha256, scene_sha256: result.scene_sha256, cells: result.cells.features.length });
      await qa.screenshot({ path: 'output/playwright/copy-results-' + (local ? 'local-' : 'public-') + (edition ? 'competition' : 'project') + '.png' });
    }
    check(errors.length === 0, 'no uncaught errors while rendering real calculation results');
    return { label: local ? 'local' : 'public', passed: checks.length, checks, reports, errors };
  } catch (error) { throw new Error('After ' + checks.length + ' checks: ' + error.message); }
  finally { await context.close(); }
}
