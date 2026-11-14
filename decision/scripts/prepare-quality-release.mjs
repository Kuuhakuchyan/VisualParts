import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const speed=process.argv.includes('--thermal-speed');
const accuracy=process.argv.includes('--thermal-accuracy');
const fine=process.argv.includes('--fine-grid');
const neighborhood=process.argv.includes('--neighborhood');
const joint=fine||process.argv.includes('--joint-calculation');
const spatial=joint||process.argv.includes('--spatial-hybrid');
const releaseId=(neighborhood?'neighborhood-model-':fine?'fine-grid-':joint?'joint-calculation-':spatial?'spatial-hybrid-':accuracy?'thermal-accuracy-':speed?'thermal-speed-':'platform-quality-')+Date.now(),output=path.join(root,'output/releases',releaseId),hashes={};
const runtime=['sandbox.py','collection.py',...(speed||accuracy||spatial?['lcz.py']:[]),...(spatial?['neighbourhood.py','spatial_surrogate.py','hybrid.py','aic/decision.py']:[])];
const models=spatial?['spatial-utci-emulator.json']:[];
const data=neighborhood?['neighborhood-buildings.geojson','neighborhood-streets.geojson','neighborhood-landcover.geojson']:[];
const tests=[];
function discover(folder,prefix=''){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    if(entry.isDirectory()&&entry.name!=='__pycache__')discover(path.join(folder,entry.name),prefix+entry.name+'/');
    else if(entry.isFile()&&/^test_.*\.py$/.test(entry.name))tests.push(prefix+entry.name);
  }
}
discover(path.join(root,'backend'));
function copy(source,name){
  if(fs.statSync(source).isDirectory()){for(const file of fs.readdirSync(source))copy(path.join(source,file),name+'/'+file);return;}
  const target=path.join(output,name);fs.mkdirSync(path.dirname(target),{recursive:true});
  const bytes=name==='deploy.sh'?Buffer.from(fs.readFileSync(source,'utf8').replaceAll('\r\n','\n')):fs.readFileSync(source);
  fs.writeFileSync(target,bytes);hashes[name]=crypto.createHash('sha256').update(bytes).digest('hex');
}
for(const file of [...runtime,...tests])copy(path.join(root,'backend',file),'backend/'+file);
for(const file of models)copy(path.join(root,'models',file),'models/'+file);
for(const file of data)copy(path.join(root,'public/data',file),'public/data/'+file);
for(const file of ['index.html','aic/index.html','assets','ui-fonts'])copy(path.join(root,'dist',file),'dist/'+file);
copy(path.join(root,'scripts/deploy-quality-release.sh'),'deploy.sh');
const manifest={releaseId,runtime,models,data,tests,hashes,builtAt:new Date().toISOString(),scope:neighborhood?'Independent district building and road model, context-safe editing, geometry calculations and scene libraries':fine?'Real 30m thermal computations, explicit LCZ warm/cool anomaly view and equivalent batched sky geometry':joint?'Physical baseline, live DeepSeek parameter proposals, per-grid physical feedback and candidate adoption':spatial?'Per-grid neighbourhood evidence, physics-checked local ML inference and DeepSeek candidate comparisons':accuracy?'Fixed temperature and difference scales, local geometry screening and area-weighted sun/shade UTCI':speed?'Bounded geometry caches, faster thermal JSON responses and deduplicated heat-layer updates':'Forecast collection consistency, historical scene transitions, stable editing controls and collection accessibility'};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(output,'release.sha256'),Object.entries(hashes).map(([name,hash])=>hash+'  '+name+'\n').join(''));
fs.writeFileSync(path.join(output,'release.json'),JSON.stringify({releaseId,builtAt:manifest.builtAt,scope:manifest.scope},null,2));
console.log(JSON.stringify({releaseId,output,files:Object.keys(hashes).length}));
