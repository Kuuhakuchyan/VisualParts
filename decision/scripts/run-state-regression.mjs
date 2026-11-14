import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const suites=process.argv.slice(2);
if(!suites.length)throw new Error('Provide explicit verification script names');
const results=[];
const suiteURL=process.env.STATE_SUITE_URL||'http://127.0.0.1:5173/#screen';
if(!/^https?:\/\/[a-z0-9.:-]+\/[a-z0-9/#?=_-]*$/i.test(suiteURL))throw new Error('Invalid verification URL');
const runId=Date.now().toString(36);
const summaryFile=process.env.STATE_SUITE_SUMMARY||'output/playwright/state-regression-summary.json';
for(const [index,name] of suites.entries()){
  if(!/^verify-[a-z0-9-]+\.js$/.test(name))throw new Error('Invalid verification script name');
  const session='state'+runId+'x'+index;
  const run=args=>spawnSync('cmd.exe',['/d','/s','/c','npx.cmd --yes --package @playwright/cli playwright-cli -s='+session+' '+args],{encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024});
  console.log('START '+name);
  let result;
  try{
    const open=run('open '+suiteURL);
    if(open.status!==0)throw new Error(open.stdout+open.stderr);
    const test=run('run-code --filename scripts/'+name);
    fs.writeFileSync('output/playwright/state-suite-'+name.replace('.js','.txt'),test.stdout+(test.stderr||''));
    const line=test.stdout.match(/### Result\r?\n([^\r\n]+)/)?.[1];
    if(test.status!==0||!line)throw new Error(test.stdout.slice(0,1800)+test.stderr);
    const data=JSON.parse(line);
    const passed=Array.isArray(data.checks)?data.checks.length:data.checks;
    if(!Number.isInteger(passed)||passed<1)throw new Error('Verification returned no check count');
    result={name,passed,errors:data.errors||[]};
    console.log('PASS '+name+' '+result.passed);
  }catch(error){result={name,failed:String(error)};console.log('FAIL '+name+' '+String(error).slice(0,1800));}
  finally{run('close');}
  results.push(result);
  fs.writeFileSync(summaryFile,JSON.stringify(results,null,2));
}
console.log(JSON.stringify({suites:results.length,passed:results.filter(r=>!r.failed).length,checks:results.reduce((n,r)=>n+(r.passed||0),0)},null,2));
if(results.some(r=>r.failed))process.exitCode=1;
