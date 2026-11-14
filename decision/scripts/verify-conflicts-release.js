async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage(),errors=[],failed=[];
  qa.on('pageerror',e=>errors.push(e.message));
  qa.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  qa.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});});
  try{
    await qa.bringToFront();
    await qa.goto('https://weather.nogamenolife.cn/decision/?capture=1#screen');
    await qa.locator('#screen-site').selectOption('campus');
    await qa.locator('#workspace-map[data-buildings="225"]').waitFor();
    await qa.locator('#sb-refresh').waitFor();
    await qa.waitForFunction(()=>!document.querySelector('#refresh-all').disabled&&document.querySelector('#sb-status').textContent.includes('采样'));
    const assets=await qa.evaluate(()=>performance.getEntriesByType('resource').filter(r=>/\/assets\/(main-|map-|sandbox-).*\.js/.test(r.name)).map(r=>new URL(r.name).pathname));
    await qa.screenshot({path:'output/playwright/conflicts-final-desktop.png'});
    await qa.goto('https://weather.nogamenolife.cn/decision/aic/?capture=1#screen');
    await qa.locator('#sb-refresh').waitFor();
    await qa.waitForFunction(()=>!document.querySelector('#refresh-all').disabled&&document.querySelector('#sb-status').textContent.includes('采样'));
    await qa.setViewportSize({width:390,height:844});
    await qa.screenshot({path:'output/playwright/conflicts-final-competition-mobile.png'});
    const anonymity=await qa.evaluate(()=>!(/郑州大学|闫梓宇|Zhengzhou\s+University|ZZU/i.test(document.body.innerText)));
    const overflow=await qa.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
    const response=await qa.request.get('https://weather.nogamenolife.cn/decision/aic/app.js');
    const code=await response.text();
    const selfcheck_sha256=await qa.evaluate(async code=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))].map(n=>n.toString(16).padStart(2,'0')).join(''),code);
    if(errors.length||failed.length||!anonymity||overflow||response.status()!==200)throw new Error(JSON.stringify({errors,failed,anonymity,overflow}));
    return {url:qa.url(),assets,selfcheck_sha256,anonymity,overflow,errors,failed};
  }finally{await context.close();await page.bringToFront();}
}
