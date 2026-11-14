async (page) => {
  const origin = new URL(page.url()).origin;
  const local = ['127.0.0.1','localhost'].includes(new URL(origin).hostname);
  const checks = [], errors = [];
  const onError = error => errors.push(error.message);
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const fits = async () => {
    try {
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 4000 });
      return true;
    } catch { return false; }
  };
  page.on('pageerror', onError);
  try {
    for (const slug of ['', 'microjie-overview/', 'platform-architecture/', 'roadmap-security/']) {
      const response = await page.goto(origin + '/author/project/' + slug);
      check(response.ok(), (slug || 'journal') + ' responds successfully');
      await page.locator('#journal-main h1').waitFor();
      const imageFailures = await page.locator('#journal-main img').evaluateAll(async images => {
        await Promise.all(images.map(img => { img.loading = 'eager'; return img.decode().catch(() => {}); }));
        return images.filter(img => !img.naturalWidth).map(img => img.src);
      });
      check(imageFailures.length === 0, (slug || 'journal') + ' images decode');
      if (!slug) {
        const covers = await page.locator('.journal-entry-image img').evaluateAll(images => images.map(img => img.src));
        check(covers.length === 3 && new Set(covers).size === 3, 'three real project entries use distinct covers');
      } else {
        check((await page.locator('.journal-prose').innerText()).length > 200, slug + ' renders actual article content');
        const outline = page.locator('.journal-outline');
        if (await outline.count()) {
          await outline.locator('summary').click();
          const missing = await outline.locator('a').evaluateAll(links => links.filter(a => !document.getElementById(decodeURIComponent(a.hash.slice(1)))).map(a => a.hash));
          check(missing.length === 0, slug + ' table of contents targets real headings');
        }
      }
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 960 });
        check(await fits(), (slug || 'journal') + ' fits ' + width + 'px');
        if (width !== 320) await page.screenshot({ path: 'output/playwright/design-project-' + (slug ? slug.slice(0, -1) : 'journal') + '-' + width + '.png', fullPage: false });
      }
    }
    for (const path of ['/monitor', '/sensors', '/logs']) {
      const response = await page.goto(origin + path);
      check(response.ok(), path + ' preview responds successfully');
      await page.locator('body[class*=console-]').waitFor();
      await page.waitForTimeout(2000);
      check(await page.locator('.console-nav').isVisible(), path + ' retains platform navigation');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 960 });
        check(await fits(), path + ' fits ' + width + 'px');
        if (width !== 320) await page.screenshot({ path: 'output/playwright/design-console-' + path.slice(1) + '-' + width + '.png', fullPage: false });
      }
    }
    await page.goto(origin + (local ? '/home.html' : '/'));
    await page.locator('#menuButton').click();
    await page.locator('#navLinks a').nth(3).click();
    await page.waitForURL('**/author/project/');
    check(await page.locator('.journal-entry').count() === 3, 'homepage fourth navigation item reaches actual project journal');
    check(errors.length === 0, 'no uncaught browser exceptions');
    return { checks, errors };
  } finally { page.off('pageerror', onError); }
}
