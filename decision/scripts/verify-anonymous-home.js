async(page)=>{
  const checks=[],errors=[];const check=(v,n)=>{if(!v)throw new Error(n);checks.push(n);};
  page.on('pageerror',e=>errors.push(e.message));
  const home=new URL('./home.html',page.url()).href;
  await page.goto(home);await page.setViewportSize({width:1440,height:960});await page.waitForTimeout(2300);
  check(await page.title()==='微境探界｜AIC 智慧气象','project name is retained');
  check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await page.content()),'no school or supervisor names in anonymous homepage');
  check(await page.locator('#navLinks a').nth(3).textContent()==='项目博客','fourth navigation item is project journal');
  const targets=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(a=>a.getAttribute('href')));
  check(!targets.some(h=>/^\/(author|monitor|sensors)/.test(h)),'anonymous navigation does not lead to identifying original pages');
  check(await page.locator('section.content').count()>=5,'full presentation contains project, team, method and journal sections');
  check(await page.locator('.member').count()>=3,'team roles remain visible');
  check(await page.locator('img').evaluateAll(nodes=>nodes.every(n=>n.complete&&n.naturalWidth>0||n.loading==='lazy')),'eager images load');
  await page.screenshot({path:'output/playwright/aic-home-desktop.png'});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+'px homepage no horizontal overflow');
    await page.locator('#menuButton').click();check(await page.locator('#navLinks').evaluate(n=>n.classList.contains('open')),width+'px mobile menu opens');
    await page.locator('#menuButton').click();
  }
  await page.screenshot({path:'output/playwright/aic-home-mobile.png'});
  await page.locator('#navLinks a').nth(3).evaluate(n=>n.click());await page.waitForURL('**/journal.html');
  check(!/郑州大学|Zhengzhou University|闫梓宇/.test(await page.content()),'project journal is anonymous');
  check(await page.locator('section.content').count()===3,'journal contains three adapted project articles');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile journal no horizontal overflow');
  check(errors.length===0,'no homepage or journal runtime errors');
  return{checks,errors};
}
