async(page)=>{
  await page.goto('file:///G:/Working/大创/_git_publish/VisualParts-weather/decision/output/weather-training/chart-page.html');
  await page.setViewportSize({width:1200,height:1280});
  await page.locator('#timeseries').screenshot({path:'public/aic/assets/station-timeseries.png'});
  await page.locator('#validation').screenshot({path:'public/aic/assets/model-validation.png'});
}
