import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const releaseId='forecast-thermal-'+Date.now(),output=path.join(root,'output/releases',releaseId),hashes={};
const runtime=['sandbox.py','aic/risk.py','aic/regional.py','aic/router.py'];
const tests=['test_forecast_sandbox.py','test_sandbox.py','test_lcz.py','test_hybrid.py','aic/test_aic.py','aic/test_regional.py','aic/test_decision.py','aic/test_prevention.py'];
function copy(source,name){
  if(fs.statSync(source).isDirectory()){for(const file of fs.readdirSync(source))copy(path.join(source,file),name+'/'+file);return;}
  const target=path.join(output,name);fs.mkdirSync(path.dirname(target),{recursive:true});
  const bytes=name==='deploy.sh'?Buffer.from(fs.readFileSync(source,'utf8').replaceAll('\r\n','\n')):fs.readFileSync(source);
  fs.writeFileSync(target,bytes);hashes[name]=crypto.createHash('sha256').update(bytes).digest('hex');
}
for(const file of [...runtime,...tests])copy(path.join(root,'backend',file),'backend/'+file);
for(const file of ['index.html','aic/index.html','assets','ui-fonts'])copy(path.join(root,'dist',file),'dist/'+file);
copy(path.join(root,'scripts/deploy-forecast-release.sh'),'deploy.sh');
const manifest={releaseId,runtime,tests,hashes,builtAt:new Date().toISOString(),scope:'Hourly forecast-driven thermal fields and area-weighted layout simulation'};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(output,'release.sha256'),Object.entries(hashes).map(([name,hash])=>hash+'  '+name+'\n').join(''));
fs.writeFileSync(path.join(output,'release.json'),JSON.stringify({releaseId,builtAt:manifest.builtAt,scope:manifest.scope},null,2));
console.log(JSON.stringify({releaseId,output,files:Object.keys(hashes).length}));
