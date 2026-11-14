async page=>{
 const root='G:/Working/大创/output/aic-submission-20261027';
 const context=await page.context().browser().newContext({viewport:{width:1440,height:900},recordVideo:{dir:root+'/private-build/route-recording',size:{width:1440,height:900}}});
 const q=await context.newPage();await q.goto('https://aic.nogamenolife.cn/aic/#screen');
 await q.locator('.sandbox-legend[data-valid-cells]:not([data-valid-cells="0"])').waitFor({timeout:65000});await q.locator('#sb-collection').waitFor({state:'attached'});
 await q.locator('#dock-tab-sandbox').click();await q.locator('#sb-collection').click();
 const pending=q.waitForResponse(r=>r.url().endsWith('/collection/simulate'),{timeout:65000});await q.locator('#collection-generate').click();const r=await pending,data=await r.json();
 if(!r.ok())throw Error(JSON.stringify(data));await q.locator('#collection-play:not([disabled])').waitFor();
 await q.screenshot({path:root+'/evidence/screens/14-collection.png'});
 await q.locator('#collection-play').click();await q.waitForTimeout(2500);await q.locator('#collection-close').click();await q.waitForTimeout(6000);
 await q.screenshot({path:root+'/evidence/screens/15-routing.png'});
 const video=q.video(),path=await video.path();const output={videoPath:path,tracks:data.tracks.map(t=>({device:t.device_id,samples:t.samples.length,status:t.status})),snapshot_sha256:data.snapshot_sha256};await context.close();return output;
}
