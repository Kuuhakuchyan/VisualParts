async page => {
  const checks = [], errors = [];
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 } });
  const qa = await context.newPage();
  qa.on('pageerror', error => errors.push(error.message));
  const check = (value, name) => { if (!value) throw Error(name); checks.push(name); };
  const preview = async (selector, edition) => {
    const image = qa.locator(selector);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(node => node.decode());
    const result = await image.evaluate(node => ({ src: node.src, width: node.naturalWidth, height: node.naturalHeight }));
    check(result.width === 1800 && result.height === 1100, `${edition}: preview decodes at original resolution`);
    check(new URL(result.src).origin === new URL(qa.url()).origin && result.src.includes('/assets/workspace-media/'), `${edition}: preview uses own workspace assets`);
  };
  try {
    for (const [edition, url] of [
      ['project', 'https://weather.nogamenolife.cn/decision/'],
      ['competition', 'https://aic.nogamenolife.cn/aic/'],
    ]) {
      await qa.setViewportSize({ width: 1440, height: 960 });
      await qa.goto(url + '#plans');
      await preview('.plan-context img', edition);
      await qa.waitForFunction(() => !document.querySelector('#refresh-all').disabled);
      check(!(await qa.locator('#plan-list').innerText()).includes('服务暂不可用'), `${edition}: archive API loads`);
      await qa.getByRole('button', { name: '新建方案', exact: true }).click();
      check(await qa.locator('.plan-create').getAttribute('open') !== null, `${edition}: create panel opens`);
      await qa.locator('.plan-create summary').click();
      check(await qa.locator('.plan-create').getAttribute('open') === null, `${edition}: create panel closes`);
      await qa.locator('.plan-context a').click();
      await qa.waitForURL('**/#spatial');
      check(await qa.title() === '空间研判 · 微境探界', `${edition}: sandbox link switches view`);
      await qa.goto(url + '#risk');
      await preview('.regional-scene img', edition);
      await qa.setViewportSize({ width: 390, height: 844 });
      await qa.goto(url + '#plans');
      await preview('.plan-context img', edition + ' mobile');
      check(await qa.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${edition}: mobile has no horizontal overflow`);
      await qa.screenshot({ path: `output/playwright/workspace-preview-${edition}-mobile.png`, fullPage: true });
      await qa.setViewportSize({ width: 1440, height: 960 });
      await qa.screenshot({ path: `output/playwright/workspace-preview-${edition}-desktop.png`, fullPage: true });
    }
    check((await qa.request.get('https://weather.nogamenolife.cn/decision/aic/')).status() === 404, 'project still blocks competition routes');
    check((await qa.request.get('https://aic.nogamenolife.cn/decision/')).status() === 404, 'competition still blocks project routes');
    check(errors.length === 0, `no browser runtime errors: ${errors.join('; ')}`);
    return { checks: checks.length, passed: checks, errors };
  } finally { await context.close(); }
}
