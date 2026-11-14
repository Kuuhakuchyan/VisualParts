import fs from 'node:fs';

const names=['layer-state','layer-races','contextual-sandbox','map-interactions','map-navigation','map-touch','map-races','sandbox-editing','workspace-conflicts','panel-lifecycle','refresh-races','competition-grid-ui','lcz-persistence','action-ownership','collection','reactive-release','hybrid-ui','geometry-presentation'];
const readResult=file=>{
  const text=fs.readFileSync(file,'utf8');
  const line=text.match(/### Result\r?\n([^\r\n]+)/)?.[1];
  if(!line)throw new Error('Missing successful browser result: '+file);
  const result=JSON.parse(line);
  if(result.errors?.length)throw new Error('Browser errors in '+file);
  return {file,checks:result.checks.length,errors:result.errors||[]};
};
const local=names.map(name=>readResult('output/playwright/state-suite-verify-'+name+'.txt'));
const publicBrowser=['layer-state-public-qa.txt','state-platform-public-qa.txt','state-ui-public-qa.txt'].map(name=>readResult('output/playwright/'+name));
const backendLog=fs.readFileSync('output/playwright/state-backend-tests.txt','utf8');
const backendTests=Number(backendLog.match(/Ran (\d+) tests/)?.[1]);
if(!backendTests||!/^OK\r?$/m.test(backendLog))throw new Error('Backend tests did not pass');
const release=JSON.parse(fs.readFileSync('output/playwright/state-release-hashes.json','utf8'));
const surface=JSON.parse(fs.readFileSync('output/playwright/public-surface.json','utf8'));
const summary={backendTests,localBrowserChecks:local.reduce((n,r)=>n+r.checks,0),publicBrowserChecks:publicBrowser.reduce((n,r)=>n+r.checks,0),releaseChecks:release.passed,surfaceChecks:surface.checks.length,local,publicBrowser,
  note:'Counts are assertions/test cases, not unique defects or scientific validation. Latest successful artifact per suite supersedes earlier runs; some cases overlap across local/public environments.'};
fs.writeFileSync('output/playwright/state-audit-final-summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({...summary,local:local.length,publicBrowser:publicBrowser.length},null,2));
