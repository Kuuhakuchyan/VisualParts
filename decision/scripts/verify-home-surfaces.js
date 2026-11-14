async (page) => {
  const checks=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const output='output/playwright/surface-fix/';
  await page.route(/\/(?:home-assets|aic\/assets)\/scene\.js(?:\?|$)/,route=>route.fulfill({path:output+'scene-qa.js',contentType:'text/javascript'}));
  for(const route of ['/home.html','/aic/home.html']){
    for(const width of [1440,390]){
      const height=width===390?844:960;
      await page.setViewportSize({width,height});
      await page.goto('http://127.0.0.1:5173'+route);
      await page.waitForFunction(()=>window.__surfaceQA&&document.querySelector('.hero-scene').dataset.rendered==='true');
      await page.evaluate(()=>document.fonts.ready);
      const original=await page.evaluate(()=>{
        const {map,camera}=window.__surfaceQA;
        document.documentElement.dataset.motion='off';
        return {angle:map.rotation.y,near:camera.near,far:camera.far};
      });
      if(original.near!==25||original.far!==7000)throw new Error('Unexpected camera depth range');
      for(const angle of [-.4,0,.4]){
        const result=await page.evaluate(({angle,original})=>{
          const {world,map,renderer,camera}=window.__surfaceQA;
          map.rotation.y=original.angle+angle;map.updateMatrixWorld(true);
          const sample=()=>{
            renderer.render(world,camera);
            const gl=renderer.getContext(),pixel=new Uint8Array(4),values=[];
            for(let y=2;y<10;y++)for(let x=2;x<14;x++){
              gl.readPixels(Math.floor(renderer.domElement.width*x/16),Math.floor(renderer.domElement.height*y/12),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
              values.push([...pixel].join(','));
            }
            return values;
          };
          const first=sample(),second=sample();
          let transparentDepthWriters=0;
          world.traverse(node=>{
            for(const material of (Array.isArray(node.material)?node.material:[node.material]))if(material?.transparent&&material.depthWrite)transparentDepthWriters++;
          });
          return {distinctPixels:new Set(first).size,stable:JSON.stringify(first)===JSON.stringify(second),transparentDepthWriters,
            overflow:document.documentElement.scrollWidth>innerWidth};
        },{angle,original});
        if(result.distinctPixels<5||!result.stable||result.transparentDepthWriters||result.overflow)throw new Error(JSON.stringify(result));
        const edition=route.startsWith('/aic')?'aic':'project';
        await page.locator('.hero-scene canvas').screenshot({path:output+`${edition}-${width}-${angle}.png`});
        checks.push({edition,width,angle,...result});
      }
    }
  }
  if(errors.length)throw new Error(errors.join('\n'));
  return {checks,errors};
}
