async (page) => ({url:page.url(),surface:await page.locator('#workspace-map').evaluate(n=>({...n.dataset})),
  status:await page.locator('#sb-status').textContent(),
  workflow:await page.evaluate(()=>window.qaHybridResult?.orchestration?.planner||null)})
