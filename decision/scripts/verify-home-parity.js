async (page) => {
  const origin = 'http://127.0.0.1:5173';
  const checks = [], errors = [];
  const onError = error => errors.push(error.message);
  const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  const snapshot = () => page.evaluate(() => {
    const main = document.querySelector('main').cloneNode(true);
    main.querySelector('.team-note')?.remove();
    const normalize = text => text.replace(/郑州大学主校区|郑州大学|Zhengzhou University/gi, '某校园').replaceAll('某校园校园', '某校园').replace(/\s+/g, ' ').trim();
    return {
      text: normalize(main.textContent),
      sections: [...main.querySelectorAll('section')].map(section => section.id || section.className),
      headings: [...main.querySelectorAll('h1,h2,h3')].map(node => normalize(node.textContent)),
      navigation: [...document.querySelectorAll('#navLinks a')].map(node => node.textContent),
      members: [...main.querySelectorAll('.member h3')].map(node => node.textContent),
      script: document.querySelector('body > script').textContent,
    };
  });
  page.on('pageerror', onError);
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(origin + '/home.html');
    const original = await snapshot();
    await page.goto(origin + '/aic/home.html');
    const competition = await snapshot();
    for (const key of ['text', 'sections', 'headings', 'navigation', 'members', 'script']) {
      check(JSON.stringify(original[key]) === JSON.stringify(competition[key]), key + ' matches original homepage apart from anonymity');
    }
    check(!/郑州大学|Zhengzhou University|闫梓宇|\/home-assets\//i.test(await page.content()), 'school, supervisor and identifying asset paths are absent');
    const images = await page.locator('img').evaluateAll(async nodes => {
      await Promise.all(nodes.map(image => { image.loading = 'eager'; return image.decode().catch(() => {}); }));
      return nodes.filter(image => !image.complete || !image.naturalWidth).map(image => image.src);
    });
    check(images.length === 0, 'all inline images decode' + (images.length ? ': ' + JSON.stringify(images) : ''));
    for (const file of ['homepage-scene.png', 'landcover.png', 'field-observation.webp', 'data-platform.webp']) {
      const response = await page.request.get(origin + '/aic/assets/' + file);
      check(response.ok() && response.headers()['content-type'].startsWith('image/'), file + ' loads as an image');
    }
    const styles = await page.evaluate(() => [
      getComputedStyle(document.querySelector('.hero'), '::before').backgroundImage,
      getComputedStyle(document.querySelector('.platform-card.observation'), '::after').backgroundImage,
      getComputedStyle(document.querySelector('.platform-card.operations'), '::after').backgroundImage,
    ]);
    check(styles[0].includes('homepage-scene.png'), 'hero uses anonymous street-and-building scene');
    check(styles[1].includes('field-observation.webp'), 'observation retains a station photograph instead of a chart');
    check(styles[2].includes('data-platform.webp'), 'operations retains a platform illustration instead of a validation plot');
    await page.locator('#intro').evaluate(node => node.classList.add('done'));
    await page.locator('#intro').waitFor({ state: 'hidden' });
    await page.screenshot({ path: 'output/playwright/aic-home-parity-desktop.png' });
    await page.locator('#fieldwork').screenshot({ path: 'output/playwright/aic-home-parity-fieldwork.png' });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(origin + '/aic/home.html');
      await page.locator('#intro').evaluate(node => node.classList.add('done'));
      await page.locator('#intro').waitFor({ state: 'hidden' });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + 'px layout fits');
      await page.locator('#menuButton').click();
      await page.locator('#navLinks a[href="#team"]').click();
      check(await page.locator('#menuButton').getAttribute('aria-expanded') === 'false', width + 'px chapter selection closes menu');
      check(new URL(page.url()).hash === '#team', width + 'px team chapter is reachable');
      await page.goto(origin + '/aic/home.html');
      await page.locator('#intro').evaluate(node => node.classList.add('done'));
      await page.locator('#intro').waitFor({ state: 'hidden' });
      await page.screenshot({ path: 'output/playwright/aic-home-parity-' + width + '.png' });
    }
    check(errors.length === 0, 'no uncaught browser exceptions');
    return { checks, errors, sections: competition.sections, members: competition.members };
  } finally { page.off('pageerror', onError); }
}
