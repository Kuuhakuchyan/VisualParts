import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseId = `ui-complete-20261026-${Date.now()}`;
const output = path.join(root, 'output/releases', releaseId);
const hashes = {};
function copy(source, relative) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    for (const file of fs.readdirSync(source)) copy(path.join(source, file), relative + '/' + file);
    return;
  }
  const target = path.join(output, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  hashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}
for (const file of ['index.html', 'assets', 'aic', 'ui-fonts', 'logo.png']) copy(path.join(root, 'dist', file), 'decision/' + file);
for (const file of ['app.py', 'templates', 'static']) copy(path.join(root, '../api', file), 'api/' + file);
copy(path.resolve(root, '../../../author-homepage/dist'), 'blog');
copy(path.join(root, '../nginx/aic.nogamenolife.cn.conf'), 'nginx/aic.conf');
copy(path.join(root, 'scripts/deploy-ui-complete.sh'), 'deploy.sh');
const deployPath = path.join(output, 'deploy.sh');
const deploy = fs.readFileSync(deployPath, 'utf8').replaceAll('\r\n', '\n');
fs.writeFileSync(deployPath, deploy);
hashes['deploy.sh'] = crypto.createHash('sha256').update(deploy).digest('hex');
const release = { releaseId, builtAt: new Date().toISOString(), scope: 'Complete D UI, all site media and templates, anonymous hostname; numerical and medical runtime unchanged' };
fs.writeFileSync(path.join(output, 'decision/release.json'), JSON.stringify(release, null, 2));
hashes['decision/release.json'] = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, 'decision/release.json'))).digest('hex');
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ ...release, hashes }, null, 2));
fs.writeFileSync(path.join(output, 'release.sha256'), Object.entries(hashes).map(([file, hash]) => `${hash}  ${file}\n`).join(''));
console.log(JSON.stringify({ releaseId, output, files: Object.keys(hashes).length }));
