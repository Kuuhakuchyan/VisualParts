import fs from 'node:fs';
import crypto from 'node:crypto';
const release=process.argv[2];
if(!release)throw new Error('Pass the release manifest path');
const manifest=JSON.parse(fs.readFileSync(release,'utf8'));
const files=Object.entries(manifest.hashes).filter(([name])=>/^dist\/(?:index\.html|aic\/index\.html|assets\/(?:main-|map-|sandbox-|regional-).*)$/.test(name)||(manifest.dataFiles||[]).some(file=>name==='dist/'+file)||(manifest.extraStatic||[]).some(file=>name==='dist/'+file));
const checks=[];
for(const [name,expected]of files){
  const response=await fetch('https://weather.nogamenolife.cn/decision/'+name.slice(5)+'?verify='+manifest.releaseId,{cache:'no-store'});
  if(!response.ok)throw new Error(name+': '+response.status);
  const hash=crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  if(hash!==expected)throw new Error(name+': deployed SHA mismatch');
  checks.push({name,sha256:hash});
}
const evidence={releaseId:manifest.releaseId,checks};
if(manifest.lczRefinement||manifest.lczWorkflow){
  const local=JSON.parse(fs.readFileSync(new URL('../public/data/campus-lcz-simulation.geojson',import.meta.url),'utf8')).metadata;
  const response=await fetch('https://weather.nogamenolife.cn/api/weather/sandbox/lcz-metadata?verify='+manifest.releaseId,{cache:'no-store'});
  if(!response.ok)throw new Error('LCZ metadata HTTP '+response.status);
  const remote=await response.json();
  if(remote.classification_sha256!==local.classification_sha256||remote.parameters_sha256!==local.parameters_sha256)throw new Error('Backend and static LCZ versions disagree');
  evidence.lcz={classification_sha256:remote.classification_sha256,parameters_sha256:remote.parameters_sha256,model_version:remote.model_version};
}
fs.writeFileSync('output/playwright/thermal-static-release.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
