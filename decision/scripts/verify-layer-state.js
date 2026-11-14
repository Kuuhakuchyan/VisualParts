async (page) => {
  const checks=[],errors=[],unexpected=[];
  const check=(value,name)=>{if(!value)throw new Error(name);checks.push(name);};
  const origin=new URL(page.url()).origin;
  const local=['127.0.0.1','localhost'].includes(new URL(origin).hostname);
  const prefix=local?'/':'/decision/';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:960}});
  const qa=await context.newPage();
  qa.on('pageerror',e=>errors.push(e.message));
  qa.on('request',r=>{if(r.method()==='POST'&&/sandbox\/(simulate|collaborate|validate|scenes)$/.test(new URL(r.url()).pathname))unexpected.push(r.url());});
  try{
    for(const edition of ['', 'aic/']){
      const label=edition?'competition':'project';
      await qa.goto(origin+prefix+edition+'#screen');
      await qa.locator('.sandbox-legend[data-total-cells="2610"]').waitFor({timeout:60000});
      await qa.locator('#sb-auto').uncheck();
      await qa.locator('[data-mode="delta"]').click();
      check(await qa.locator('#sb-layer').inputValue()==='utci',label+' delta explicitly selects the comparison metric');
      check(!await qa.locator('#sb-layer option[value="weather"]').evaluate(n=>n.disabled),label+' weather option remains enabled in delta');
      await qa.locator('#sb-layer').selectOption('weather');
      check(await qa.locator('#sb-layer').inputValue()==='weather',label+' weather cannot be forced back to UTCI by paint');
      check(await qa.locator('.layout-sandbox').getAttribute('data-display-mode')!=='delta',label+' weather leaves delta rather than mislabelling unchanged weather as a difference');
      check(Number(await qa.locator('.sandbox-legend').getAttribute('data-valid-cells'))>2000,label+' weather grid recovers actual available cells');
      for(const view of ['baseline','edit','proposed','delta']){
        for(const layer of ['risk','weather','heatindex','utci','mrt','shade','off']){
          await qa.locator('[data-mode="'+view+'"]').click();
          await qa.locator('#sb-layer').selectOption(layer);
          check(await qa.locator('#sb-layer').inputValue()===layer,label+' '+view+' → '+layer+' stays selected');
          const legend=await qa.locator('.sandbox-legend').evaluate(n=>({...n.dataset}));
          check(legend.requestedLayer===layer,label+' '+view+' → '+layer+' legend retains requested metric');
          if(legend.fallback){
            check(['pending','night_no_shortwave','no_edits','no_comparable_cells'].includes(legend.fallback)&&['risk','weather','heatindex'].includes(legend.layer),label+' '+view+' → '+layer+' unavailable scenario explicitly falls back to weather');
            check(Number(legend.totalCells)>2000&&Number(legend.validCells)+Number(legend.missingCells)===Number(legend.totalCells),label+' '+view+' → '+layer+' fallback retains grid coverage and explicit missing counts');
          }else check(legend.layer===layer,label+' '+view+' → '+layer+' map and selector agree');
          const selected=await qa.locator('[data-mode][aria-pressed="true"]').getAttribute('data-mode');
          const rendered=await qa.locator('.sandbox-legend').getAttribute('data-display-mode');
          check(selected===rendered,label+' '+view+' → '+layer+' mode button agrees with the grid');
        }
      }
      await qa.locator('#sb-show-weather').click();
      check(await qa.locator('.sandbox-legend').isVisible(),label+' recovery works even after heatmap is switched off');
      await qa.locator('[data-mode="delta"]').click();
      const markers=await qa.locator('.maplibregl-marker').count();
      await qa.locator('[data-return-weather]').click();
      check(await qa.locator('#sb-layer').inputValue()==='heatindex',label+' one-click recovery restores the last explicitly chosen weather metric');
      check(await qa.locator('.maplibregl-marker').count()===markers,label+' legend recovery click does not also mark a location');
      await qa.locator('#sb-layer').selectOption('weather');
      await qa.locator('[data-operation="add"]').click();
      await qa.locator('#dock-tab-sandbox').click();
      check(await qa.locator('#workspace-map').getAttribute('data-interaction')==='add',label+' clicking the selected task tab does not cancel construction');
      await qa.locator('[data-mode="edit"]').click();
      check(await qa.locator('#workspace-map').getAttribute('data-interaction')==='add',label+' clicking the selected edit tab is a no-op');
      await qa.locator('#dock-tab-risk').click();
      check(await qa.locator('#workspace-map').getAttribute('data-interaction')==='inspect',label+' changing tasks cancels the previous construction tool');
      await qa.locator('#dock-tab-sandbox').click();
      await qa.locator('[data-mode="delta"]').click();
      await qa.locator('#sb-enter-edit').click();
      check(await qa.locator('#sb-layer').inputValue()==='weather',label+' delta → edit restores weather rather than an empty building grid');
      await qa.locator('[data-operation="add"]').click();
      await qa.locator('#sb-show-weather').click();
      check(await qa.locator('#workspace-map').getAttribute('data-interaction')==='inspect',label+' return to weather exits construction');
      check((await qa.locator('#sb-count').textContent()).includes('新增 0 / 拟拆除 0'),label+' display changes do not mutate the scene');
      for(const width of [390,320]){
        await qa.setViewportSize({width,height:844});
        await qa.locator('.sandbox-mobile-toggle').click();
        await qa.locator('[data-mode="delta"]').click();
        await qa.locator('.screen-dock-close').click();
        await qa.locator('[data-return-weather]').click();
        check(await qa.locator('#sb-layer').inputValue()==='weather',label+' mobile '+width+'px recovers without reopening the editor');
        check(await qa.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' mobile '+width+'px has no page overflow');
        check(await qa.locator('.sandbox-mobile-toggle').getAttribute('aria-expanded')==='false',label+' mobile recovery leaves the drawer closed');
      }
      await qa.screenshot({path:'output/playwright/layer-state-'+label+'-mobile.png'});
      await qa.setViewportSize({width:1440,height:960});
      await qa.screenshot({path:'output/playwright/layer-state-'+label+'-desktop.png'});
    }
    check(unexpected.length===0,'view and layer operations never submit geometry, simulations, or saves');
    check(errors.length===0,'no uncaught browser exceptions');
    return {checks,errors,unexpected,origin};
  }finally{await context.close();}
}
