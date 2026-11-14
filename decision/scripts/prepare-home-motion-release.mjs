import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {competitionHome,competitionJournal} from './competition-home.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const releaseId='home-motion-preference-20261026-'+Date.now();
const release=path.join(root,'output/releases',releaseId);
const files={
  'api/templates/home.html':fs.readFileSync(path.join(root,'../api/templates/home.html')),
  'api/static/home/design.css':fs.readFileSync(path.join(root,'../api/static/home/design.css')),
  'api/static/home/scene.js':fs.readFileSync(path.join(root,'../api/static/home/scene.js')),
  'api/static/home/scene.json':fs.readFileSync(path.join(root,'../api/static/home/scene.json')),
  'decision/aic/assets/scene.js':fs.readFileSync(path.join(root,'public/aic/assets/scene.js')),
  'decision/aic/assets/scene.json':fs.readFileSync(path.join(root,'public/aic/assets/scene.json')),
  'decision/aic/home.html':Buffer.from(competitionHome()),
  'decision/aic/journal.html':Buffer.from(competitionJournal()),
  'scripts/deploy-home-motion.sh':Buffer.from(fs.readFileSync(path.join(root,'scripts/deploy-home-motion.sh'),'utf8').replaceAll('\r\n','\n')),
  'scripts/patch-home-cache.py':Buffer.from(fs.readFileSync(path.join(root,'scripts/patch-home-cache.py'),'utf8').replaceAll('\r\n','\n')),
};
const hashes={};
for(const [name,content] of Object.entries(files)){
  const target=path.join(release,name);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,content);hashes[name]=crypto.createHash('sha256').update(content).digest('hex');
}
fs.writeFileSync(path.join(release,'release.sha256'),Object.entries(hashes).map(([name,hash])=>hash+'  '+name+'\n').join(''));
fs.writeFileSync(path.join(release,'manifest.json'),JSON.stringify({releaseId,hashes},null,2));
console.log(JSON.stringify({releaseId,release,hashes},null,2));
