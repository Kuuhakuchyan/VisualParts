import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blog = path.resolve(root, '../../../author-homepage/dist');
const releaseId = `ui-design-d-20261025-${Date.now()}`;
const destination = path.join(root, 'output/releases', releaseId);
const hashes = {};
function copy(source, relative) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source)) copy(path.join(source, entry), relative + '/' + entry);
    return;
  }
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const content = fs.readFileSync(source);
  fs.writeFileSync(target, content);
  hashes[relative] = crypto.createHash('sha256').update(content).digest('hex');
}
for (const name of ['index.html', 'aic/index.html', 'aic/home.html', 'aic/journal.html', 'assets', 'aic/assets', 'ui-fonts']) {
  copy(path.join(root, 'dist', name), 'decision/' + name);
}
for (const name of ['templates/home.html', 'templates/author.html', 'static/console.css', 'static/home/design.css', 'static/home/author.css', 'static/home/scene.js', 'static/home/scene.json']) {
  copy(path.join(root, '../api', name), 'api/' + name);
}
for (const name of ['_astro', 'project']) copy(path.join(blog, name), 'blog/' + name);
const script = fs.readFileSync(path.join(root, 'scripts/deploy-ui-design.sh'), 'utf8').replaceAll('\r\n', '\n');
fs.writeFileSync(path.join(destination, 'deploy.sh'), script);
hashes['deploy.sh'] = crypto.createHash('sha256').update(script).digest('hex');
fs.writeFileSync(path.join(destination, 'release.sha256'), Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}\n`).join(''));
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({releaseId, scope: 'D design UI and static resources only; existing data and decision backend unchanged', hashes}, null, 2));
console.log(JSON.stringify({releaseId, destination, files: Object.keys(hashes).length}, null, 2));
