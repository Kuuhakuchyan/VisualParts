async (page) => {
  const local = ['localhost','127.0.0.1'].includes(new URL(page.url()).hostname);
  const origin = local ? new URL(page.url()).origin : 'https://weather.nogamenolife.cn';
  const provenance = local ? await (await page.request.get(origin+'/api/synthetic-provenance')).json() : null;
  const output = 'output/playwright/copyright-v1';
  const images = [], errors = [];
  const errorListener = error => errors.push(error.message);
  page.on('pageerror', errorListener);
  const entries = [
    ['01-home.png', '项目主页', '/', '.hero h1'],
    ['02-screen.png', '可视化决策大屏', '/decision/#screen', '#sb-run'],
    ['03-overview.png', '天气与逐小时预报', '/decision/#overview', '#weather-chart'],
    ['04-risk.png', '区域人群研判', '/decision/#risk', '#regional-submit'],
    ['05-plans.png', '干预档案', '/decision/#plans', '#plan-form'],
    ['06-evidence.png', '数据与依据', '/decision/#evidence', '#source-search'],
    ['07-sensors.png', '设备与传感器管理', '/sensors', 'h1'],
    ['08-logs.png', '观测日志', '/logs', 'h1'],
  ];
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [file, title, route, selector] of entries) {
      await page.goto(origin + (local && route==='/'?'/home.html':route));
      await page.locator(selector).waitFor({ state: 'attached', timeout: 60000 });
      if (route.startsWith('/decision/')) {
        await page.waitForFunction(() => !document.querySelector('#refresh-all')?.disabled, null, { timeout: 60000 });
      }
      if (route === '/') await page.locator('#intro').waitFor({ state: 'hidden', timeout: 30000 });
      if (route === '/decision/#screen') {
        await page.waitForFunction(() => Number(document.querySelector('.sandbox-legend')?.dataset.totalCells) > 5, null, { timeout: 90000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 });
      }
      await page.screenshot({ path: output + '/' + file });
      images.push({ file, title, url: page.url(), viewport: { width: 1440, height: 1000 }, role: local?'synthetic-interface-acceptance':'public-interface-reference' });
    }
    await page.goto(origin + '/sensors');
    await page.getByRole('button', { name: /^UGV(?: 在线| 离线)?$/ }).click();
    await page.getByRole('heading', { name: 'UGV', exact: true }).waitFor();
    if(local) await page.waitForFunction(()=>document.querySelector('mobile-observations')?.shadowRoot.querySelectorAll('tbody tr').length===3);
    await page.locator('mobile-observations').scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + '/09-ugv.png' });
    images.push({ file: '09-ugv.png', title: 'UGV 模拟观测数据', url: page.url(), viewport: { width: 1440, height: 1000 }, role: local?'synthetic-interface-acceptance':'public-interface-reference' });
    await page.getByRole('button', { name: /^UAV(?: 在线| 离线)?$/ }).click();
    await page.getByRole('heading', { name: 'UAV', exact: true }).waitFor();
    if(local) await page.waitForFunction(()=>document.querySelector('mobile-observations')?.shadowRoot.querySelectorAll('tbody tr').length===3);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('mobile-observations').scrollIntoViewIfNeeded();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile layout overflow');
    await page.screenshot({ path: output + '/10-mobile-uav.png' });
    images.push({ file: '10-mobile-uav.png', title: '手机端 UAV 模拟观测数据', url: page.url(), viewport: { width: 390, height: 900 }, role: local?'synthetic-interface-acceptance':'public-interface-reference' });
    if (errors.length) throw new Error('Uncaught page exceptions: ' + errors.join('; '));
    return { origin, captured_at: new Date().toISOString(), public_source_revision_verified: false,
      source_revision:provenance?.source_revision, frozen_local_source_verified:!!provenance?.source_revision,
      test_fixture:!!provenance?.test_fixture,
      note: local?'Frozen local UI with synthetic inputs; actual calculation modules.':'Reference screenshots of public UI; no records created and no raw observations exported.', images, errors };
  } finally {
    page.off('pageerror', errorListener);
  }
}
