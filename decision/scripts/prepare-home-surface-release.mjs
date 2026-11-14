import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'output/releases','home-surfaces-20261028-'+Date.now());
fs.mkdirSync(out,{recursive:true});
const files={};
for(const name of ['scene.js','campus-scene.webp','d-context.webp','d-intervention.webp'])files['api/'+name]=path.join(root,'../api/static/home',name);
for(const name of ['scene.js','homepage-scene.png','d-context.png','d-intervention.png'])files['aic/'+name]=path.join(root,'public/aic/assets',name);
files['deploy.py']=path.join(root,'scripts/deploy-home-surfaces.py');
const hashes={};
for(const [name,source] of Object.entries(files)){
  const content=fs.readFileSync(source);
  fs.mkdirSync(path.dirname(path.join(out,name)),{recursive:true});
  fs.writeFileSync(path.join(out,name),content);
  hashes[name]=crypto.createHash('sha256').update(content).digest('hex');
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({out,hashes},null,2));
fs.writeFileSync(path.join(root,'output/playwright/surface-fix/release.json'),JSON.stringify({out,hashes},null,2));
console.log(out);
