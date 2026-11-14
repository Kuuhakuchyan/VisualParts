import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'output/playwright');
const files=[
  'decision-backend-final.txt','iot-safety-local.txt','iot-browser-safety.txt',
  'verify-contextual-sandbox-local-result.txt','verify-sandbox-editing-local-result.txt',
  'verify-grid-click-fix-local-result.txt','verify-map-races-local-result.txt',
  'verify-panel-lifecycle-local-result.txt','verify-refresh-races-local-result.txt',
  'verify-reactive-release-local-result.txt','verify-action-ownership-local-result.txt',
  'verify-refresh-and-selfcheck-local-result.txt','workspace-conflicts-local.txt',
  'grid-streets-linkage-local.txt','decision-ai-public.json','decision-regional-checks.txt',
  'decision-ui-standard-public.txt','decision-ui-aic-public.txt','platform-pages-public.txt',
  'anonymous-home-public.txt','public-surface-result.txt','public-auxiliary.txt',
  'verify-contextual-sandbox-public-result.txt','verify-sandbox-editing-public-result.txt',
  'verify-reactive-release-public-result.txt','verify-action-ownership-public-result.txt',
  'verify-panel-lifecycle-public-result.txt','verify-grid-streets-public-result.txt',
  'verify-collection-public-result.txt','verify-map-touch-public-result.txt',
  'aic-collection-public.txt','aic-contextual-public.txt',
];
const extra=['platform-build.txt','platform-deployment.txt','iot-final-deployment.txt',
  'linkage-final-deployment.txt','final-server-state.txt','public-surface.json'];
const results=[];
const logs=[];
function redact(value){return value.replace(/sk-[A-Za-z0-9_-]{12,}/g,'[REDACTED_API_KEY]');}
for(const file of [...files,...extra]){
  const full=path.join(output,file);
  if(!fs.existsSync(full)){if(files.includes(file))results.push({file,status:'MISSING'});continue;}
  const text=redact(fs.readFileSync(full,'utf8').replace(/^\uFEFF/,''));
  logs.push('## '+file+'\n\n原始文件：`output/playwright/'+file+'`\n\n````text\n'+text.trim()+'\n````\n');
  if(!files.includes(file))continue;
  let result;
  if(file.endsWith('.json')){try{result=JSON.parse(text);}catch{}}
  const match=text.match(/### Result\s*\r?\n([^\r\n]+)/);
  if(match){try{result=JSON.parse(match[1]);}catch{}}
  if(!result&&text.trim().startsWith('{')){try{result=JSON.parse(text);}catch{}}
  const tests=text.match(/Ran (\d+) tests/);
  const count=result?.checks?.length||result?.passed||Number(tests?.[1]||0);
  const pass=!text.includes('### Error')&&(Array.isArray(result?.checks)||Boolean(result?.passed)||Boolean(tests&&/\nOK\s*$/.test(text)));
  results.push({file,status:pass?'PASS':'FAIL',checks:count,errors:result?.errors||[],modified:fs.statSync(full).mtime.toISOString()});
}
const summary={generated_at:new Date().toISOString(),results,
  scope_note:'Counts are assertions/test cases, not independent production samples. Some paths overlap across suites. No claim of exhaustive security or clinical validation.'};
fs.writeFileSync(path.join(output,'platform-qa-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(root,'docs/终端执行记录补全.md'),
  '# 终端执行记录补全\n\n本文件从已保存的终端输出和本轮重新执行结果生成。当前任务没有挂载旧终端，未保存的旧滚屏无法完整恢复，不伪造缺失内容。密钥不收录。\n\n'+
  '此前中断处的27项协同推演、8项独立人群分析以及普通版/竞赛版报告验收均以本轮实际日志为准；已解决的失败会在综合验收报告记录原因。\n\n'+logs.join('\n'));
console.log(JSON.stringify({suites:results.length,passed:results.filter(x=>x.status==='PASS').length,
  not_passed:results.filter(x=>x.status!=='PASS'),assertions:results.reduce((s,x)=>s+(x.checks||0),0)},null,2));
