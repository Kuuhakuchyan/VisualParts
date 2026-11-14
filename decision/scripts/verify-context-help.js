async (page) => {
  const origin = new URL(page.url()).origin;
  const local = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname);
  const base = local ? '/' : '/decision/';
  const label = local ? 'local' : 'public';
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true });
  page = await context.newPage();
  const checks = [], errors = [], layouts = [];
  const onError = error => errors.push(error.message);
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const tip = () => page.locator('#workspace-context-tooltip');
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const go = async (edition, view) => {
    await page.goto(origin + base + edition + '#' + view);
    await page.locator('#page-title').waitFor({ state: 'attached' });
    await page.waitForFunction(() => !document.querySelector('#refresh-all').disabled, null, { timeout: 35000 });
    if (['screen', 'spatial'].includes(view)) await page.locator('.layout-sandbox').waitFor({ timeout: 45000 });
  };
  const bounds = async () => {
    const b = await tip().boundingBox();
    return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= page.viewportSize().width + 1 && b.y + b.height <= page.viewportSize().height + 1;
  };
  const dismiss = async () => { await page.keyboard.press('Escape'); await tip().waitFor({ state: 'hidden' }); };
  page.on('pageerror', onError);
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    for (const edition of ['', 'aic/']) {
      await page.setViewportSize({ width: 1440, height: 960 });
      await go(edition, 'overview');
      check(await page.locator('#page-description').count() === 0, edition + ' long heading description removed');
      check(await page.locator('.sidebar-bottom').count() === 0, edition + ' sidebar slogan removed');
      check(!(await page.locator('body').innerText()).includes('从区域天气出发'), edition + ' redundant overview guidance absent');
      check(await page.locator('.metric .context-help').count() === 3, edition + ' metric definitions are contextual');
      const heading = page.locator('#page-help button');
      await heading.hover();
      await tip().waitFor({ state: 'visible' });
      check((await tip().innerText()).includes('小时明细'), edition + ' hover opens useful help');
      check(await heading.getAttribute('aria-describedby') === 'workspace-context-tooltip', edition + ' help is associated accessibly');
      check(await bounds(), edition + ' desktop tooltip stays in viewport');
      await tip().hover(); await page.waitForTimeout(220);
      check(await tip().isVisible(), edition + ' tooltip remains readable while hovered');
      await heading.click(); await page.mouse.move(1400, 900); await page.waitForTimeout(220);
      check(await tip().isVisible(), edition + ' click pins help');
      await heading.click(); await tip().waitFor({ state: 'hidden' });
      check(!(await heading.getAttribute('aria-describedby')), edition + ' closing removes stale description');
      await heading.blur(); await heading.focus(); await tip().waitFor({ state: 'visible' });
      await dismiss();
      check(await heading.evaluate(n => n === document.activeElement), edition + ' Escape preserves keyboard focus');
      await heading.click(); await page.locator('#page-title').click(); await tip().waitFor({ state: 'hidden' });
      check(true, edition + ' outside click dismisses help');
      await page.screenshot({ path: 'output/playwright/context-help-' + label + '-' + (edition ? 'competition' : 'project') + '-overview.png' });

      await go(edition, 'risk');
      const initial = await page.locator('#region-duration').inputValue();
      await page.getByRole('button', { name: 'AI辅助研判说明', exact: true }).click();
      await tip().waitFor({ state: 'visible' });
      check(await page.locator('#regional-submit').isEnabled(), edition + ' help does not submit analysis');
      check(await page.locator('#region-duration').inputValue() === initial, edition + ' help preserves form values');
      check(!(await page.locator('.regional-intro').innerText()).includes('AI结合'), edition + ' repeated intro is not persistent');
      await dismiss();
      await go(edition, 'plans');
      await page.locator('#new-plan').click();
      await page.getByRole('button', { name: '方案保存说明', exact: true }).click();
      await tip().waitFor({ state: 'visible' });
      check((await tip().innerText()).includes('清除浏览器存储'), edition + ' storage warning remains discoverable');
      check(await page.locator('#plan-error').isHidden(), edition + ' help does not submit plan form');
      await dismiss();

      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        for (const view of ['overview', 'risk', 'plans', 'evidence']) {
          await go(edition, view);
          check(await fits(), edition + view + ' ' + width + 'px has no horizontal overflow');
          await page.locator('#page-help button').tap();
          await tip().waitFor({ state: 'visible' });
          check(await bounds(), edition + view + ' ' + width + 'px tap opens visible help');
          await page.locator('#page-help button').tap();
          await tip().waitFor({ state: 'hidden' });
          layouts.push({ edition, view, width });
        }
        await page.screenshot({ path: 'output/playwright/context-help-' + label + '-' + (edition ? 'competition' : 'project') + '-' + width + '.png' });
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await go(edition, 'screen');
      check(await page.locator('.screen-scene-caption').count() === 0, edition + ' map slogan removed');
      await page.locator('[data-operation=add]').click();
      await page.getByRole('button', { name: '新建建筑帮助', exact: true }).click();
      await tip().waitFor({ state: 'visible' });
      check(await page.locator('#workspace-map').getAttribute('data-interaction') === 'add', edition + ' help does not change construction tool');
      await dismiss();
      check(await page.locator('#workspace-map').getAttribute('data-interaction') === 'add', edition + ' first Escape closes only help');
      await page.keyboard.press('Escape');
      check(await page.locator('#workspace-map').getAttribute('data-interaction') === 'inspect', edition + ' second Escape cancels construction normally');
      for (const mode of ['baseline', 'proposed', 'delta']) {
        await page.locator('[data-mode=' + mode + ']').click();
        await page.locator('#sb-view-description button').click();
        await tip().waitFor({ state: 'visible' });
        check(await bounds(), edition + mode + ' mode help is visible');
        if (mode === 'delta') check((await tip().innerText()).includes('不是气温差'), edition + ' delta meaning preserved');
        await dismiss();
      }
      await page.locator('[data-mode=edit]').click();
      await page.locator('#sb-collection').click();
      await page.getByRole('button', { name: '现场传感器说明', exact: true }).click();
      await tip().waitFor({ state: 'visible' });
      check(await tip().evaluate(n => n.closest('dialog')?.id === 'collection-dialog'), edition + ' help appears above modal dialog');
      await dismiss();
      check(await page.locator('#collection-dialog').evaluate(n => n.open), edition + ' help Escape does not close dialog');
      await page.locator('#collection-close').click();
      await page.locator('#screen-fullscreen').click();
      await page.waitForFunction(() => !!document.fullscreenElement);
      await page.getByRole('button', { name: '沙盘模式帮助', exact: true }).click();
      await tip().waitFor({ state: 'visible' });
      check(await tip().evaluate(n => document.fullscreenElement.contains(n)), edition + ' fullscreen help uses fullscreen host');
      await page.locator('#screen-fullscreen').click();
      await tip().waitFor({ state: 'hidden' });
      await page.locator('.screen-nav [data-screen-panel=risk]').click();
      await page.getByRole('button', { name: '区域人群研判帮助', exact: true }).click();
      await tip().waitFor({ state: 'visible' });
      check(await tip().evaluate(n => n.closest('dialog')?.id === 'screen-drawer'), edition + ' drawer help uses correct modal');
      await dismiss(); await page.locator('#screen-panel-close').click();
      await page.getByRole('button', { name: '沙盘模式帮助', exact: true }).click();
      await page.locator('.screen-nav a[href="#overview"]').click();
      await tip().waitFor({ state: 'hidden' });
      check(true, edition + ' navigation clears pinned help');
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await go(edition, 'screen');
        await page.locator('.sandbox-mobile-toggle').tap();
        const mobileHelp = page.getByRole('button', { name: '沙盘模式帮助', exact: true });
        await mobileHelp.tap();
        await tip().waitFor({ state: 'visible' });
        check(await bounds(), edition + ' ' + width + 'px sandbox help stays in viewport');
        check(await fits(), edition + ' ' + width + 'px sandbox controls do not overflow');
        await page.screenshot({ path: 'output/playwright/context-help-' + label + '-' + (edition ? 'competition' : 'project') + '-screen-' + width + '.png' });
        await mobileHelp.tap(); await tip().waitFor({ state: 'hidden' });
        await page.locator('.sandbox-mobile-close').tap();
      }
    }
    const fallbackContext = await page.context().browser().newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true });
    const fallback = await fallbackContext.newPage();
    fallback.on('pageerror', onError);
    try {
      await fallback.addInitScript(() => {
        HTMLElement.prototype.showPopover = undefined;
        const original = Element.prototype.matches;
        Element.prototype.matches = function (selector) { if (selector === ':popover-open') throw new Error('Popover selector unavailable'); return original.call(this, selector); };
      });
      await fallback.goto(origin + base + '#overview');
      await fallback.waitForFunction(() => !document.querySelector('#refresh-all').disabled, null, { timeout: 35000 });
      await fallback.locator('#page-help button').tap();
      await fallback.locator('#workspace-context-tooltip').waitFor({ state: 'visible' });
      check(true, 'older browser fallback opens help without popover support');
      await fallback.keyboard.press('Escape');
      await fallback.locator('#workspace-context-tooltip').waitFor({ state: 'hidden' });
      check(true, 'older browser fallback closes help without unsupported selectors');
    } finally { await fallbackContext.close(); }
    check(errors.length === 0, 'no JavaScript exceptions in both editions');
    return { label, passed: checks.length, checks, layouts, errors };
  } catch (error) { throw new Error(label + ' after ' + checks.length + ' checks: ' + error.message); }
  finally { page.off('pageerror', onError); await context.close(); }
}
