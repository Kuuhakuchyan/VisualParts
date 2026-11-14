async page => {
  const origin = 'https://aic.nogamenolife.cn', checks = [], errors = [], failures = [], consoleErrors = [];
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 960 } });
  const q = await context.newPage();
  q.on('pageerror', error => errors.push(error.message));
  q.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  q.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === origin) failures.push({ url: response.url(), status: response.status() }); });
  const check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const anonymous = async label => check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await q.locator('body').innerText()), label + ' anonymous visible text');
  const fits = async label => { await q.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1); checks.push(label + ' fits viewport'); };
  try {
    const redirect = await q.request.get('http://aic.nogamenolife.cn/', { maxRedirects: 0 });
    check(redirect.status() === 301 && redirect.headers().location === origin + '/', 'HTTP redirects to HTTPS');
    const release = await (await q.request.get(origin + '/release.json')).json();
    check(release.releaseId === 'ui-complete-20261026-1792951436648', 'new hostname serves final D release');
    await q.goto(origin + '/'); await q.waitForURL('**/aic/home.html');
    await q.locator('#intro').waitFor({ state: 'hidden' });
    check(await q.locator('main>section').count() === 6, 'root reaches complete six-chapter homepage');
    await anonymous('homepage');
    const broken = await q.locator('img').evaluateAll(async nodes => {
      await Promise.all(nodes.map(img => { img.loading = 'eager'; return img.decode().catch(() => {}); }));
      return nodes.filter(img => !img.naturalWidth).map(img => img.src);
    });
    check(!broken.length, 'all homepage images decode');
    await q.locator('.hero-scene[data-rendered=true]').waitFor();
    check(true, 'anonymous homepage 3D canvas renders');
    const links = await q.locator('a[href]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
    check(!links.some(href => /weather\.nogamenolife\.cn|^\/(author|monitor|sensors)/.test(href)), 'homepage has no identifying edition links');
    await q.setViewportSize({ width: 390, height: 844 });
    await fits('mobile homepage');
    await q.screenshot({ path: 'output/playwright/public-aic-host-home-mobile.png' });
    await q.locator('#menuButton').click(); await q.locator('#navLinks a').nth(3).click();
    await q.waitForURL('**/aic/journal.html');
    check(await q.locator('.journal-entry').count() === 3, 'fourth menu item reaches anonymous journal');
    await anonymous('journal');
    for (const entry of ['project', 'engineering', 'validation']) {
      await q.locator('.journal-entry h2 a[href="#' + entry + '"]').click();
      check((await q.locator('.journal-reading:visible').innerText()).length > 100, 'actual journal content ' + entry);
      await fits('mobile journal ' + entry);
      await q.goto(origin + '/aic/journal.html');
    }
    for (const path of ['/#screen', '/aic/#screen', '/decision/#screen']) {
      await q.setViewportSize({ width: 1440, height: 960 }); await q.goto(origin + path);
      await q.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({ timeout: 60000 });
      check(await q.locator('html').getAttribute('data-edition') === 'competition', path + ' selects competition edition');
      check(await q.locator('.screen-home-nav').getAttribute('href') === '/aic/home.html', path + ' home link stays anonymous');
      await anonymous(path); await fits(path);
    }
    for (const route of ['overview', 'spatial', 'risk', 'plans', 'evidence']) {
      await q.goto(origin + '/aic/#' + route); await q.locator('#view-root').waitFor();
      await anonymous(route); await fits(route + ' desktop');
      await q.setViewportSize({ width: 320, height: 844 }); await fits(route + ' mobile');
      await q.setViewportSize({ width: 1440, height: 960 });
    }
    const timelineResponse = await q.request.get(origin + '/api/weather/aic/timeline?site=campus');
    const timeline = await timelineResponse.json(), future = timeline.points.filter(p => p.period === 'forecast');
    check(timelineResponse.ok() && future.length === 24, 'same-origin API returns 24 forecast hours');
    check(future.every((p, i) => !i || Date.parse(p.time) - Date.parse(future[i - 1].time) === 3600000), 'hourly forecast is consecutive');
    check(timeline.snapshot.units.temperature_2m === '°C' && timeline.snapshot.units.wind_speed_10m === 'm/s', 'forecast units are explicit');
    check(!errors.length, 'no uncaught hostname runtime exceptions');
    check(!failures.length, 'no failed same-origin resources');
    check(!consoleErrors.length, 'no browser console errors including stylesheet MIME failures');
    return { release: release.releaseId, checks, errors, failures, consoleErrors };
  } catch (error) { await q.screenshot({ path: 'output/playwright/public-aic-host-failure.png' }); throw Error(String(error) + '; completed: ' + checks.join(' | ')); }
  finally { await context.close(); }
}
