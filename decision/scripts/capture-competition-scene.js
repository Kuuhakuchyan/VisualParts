async(page)=>{
  await page.setViewportSize({width:1600,height:1000});
  await page.waitForSelector('#sb-layer');
  await page.locator('#map-home').click();
  await page.waitForTimeout(1000);
  await page.evaluate(()=>document.querySelectorAll('#decision-screen>*:not(.screen-map),.map-interaction,.sandbox-legend,.maplibregl-control-container').forEach(n=>n.style.visibility='hidden'));
  await page.locator('#workspace-map canvas').screenshot({path:'public/aic/assets/sandbox-scene.png'});
  await page.evaluate(()=>document.querySelectorAll('#decision-screen>*:not(.screen-map),.map-interaction,.sandbox-legend,.maplibregl-control-container').forEach(n=>n.style.removeProperty('visibility')));
}
