import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd(),id='aic-independent-'+Date.now(),out=path.join(root,'output/releases',id),hashes={};
function copy(src,dest){
  if(fs.statSync(src).isDirectory()){for(const e of fs.readdirSync(src))if(!['__pycache__','.pytest_cache'].includes(e))copy(path.join(src,e),dest+'/'+e);return;}
  const b=fs.readFileSync(src);fs.mkdirSync(path.dirname(path.join(out,dest)),{recursive:true});fs.writeFileSync(path.join(out,dest),b);hashes[dest]=crypto.createHash('sha256').update(b).digest('hex');
}
for(const dir of ['backend','models'])copy(path.join(root,dir),dir);
copy(path.join(root,'public/data'),'public/data');
for(const dir of ['aic','ui-fonts'])copy(path.join(root,'dist-aic',dir),'aic-site/'+dir);
copy(path.join(root,'dist-aic/assets/workspace-media'),'aic-site/assets/workspace-media');
copy(path.join(root,'dist-aic/logo.png'),'aic-site/logo.png');
const pending=[...fs.readFileSync(path.join(root,'dist-aic/aic/index.html'),'utf8').matchAll(/\/assets\/([^"\s]+\.(?:js|css))/g)].map(m=>m[1]),seen=new Set();
while(pending.length){const file=pending.pop();if(seen.has(file))continue;seen.add(file);const src=path.join(root,'dist-aic/assets',file);copy(src,'aic-site/assets/'+file);const text=fs.readFileSync(src,'utf8');for(const m of text.matchAll(/["'`](?:\.\/|\/?assets\/)?([^"'`\/]+\.(?:js|css|woff2?|png|webp))["'`]/g))if(fs.existsSync(path.join(root,'dist-aic/assets',m[1])))pending.push(m[1]);}
copy(path.join(root,'dist-aic/cesium/Widgets'),'aic-site/cesium/Widgets');
for(const file of fs.readdirSync(path.join(root,'dist-aic/data')))if(!/zzu|imagery|map\.png|^campus-buildings/i.test(file))copy(path.join(root,'dist-aic/data',file),'aic-site/data/'+file);
for(const item of ['assets','index.html','self-check','ui-fonts'])copy(path.join(root,'dist',item),'project-site/'+item);
copy(path.join(root,'../nginx/aic.nogamenolife.cn.conf'),'aic.conf');
copy(path.join(root,'scripts/deploy-aic-isolation.sh'),'deploy.sh');
copy(path.join(root,'scripts/configure-aic-isolation.py'),'configure.py');
fs.writeFileSync(path.join(out,'release.json'),JSON.stringify({releaseId:id,builtAt:new Date().toISOString(),edition:'independent-competition',architecture:'separate static root, process, venv, environment and databases'},null,2));
fs.writeFileSync(path.join(out,'release.sha256'),Object.entries(hashes).map(([p,h])=>h+'  '+p+'\n').join(''));
console.log(JSON.stringify({out,id,files:Object.keys(hashes).length}));
