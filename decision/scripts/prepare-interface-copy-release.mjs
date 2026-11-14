import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseId = 'interface-copy-' + Date.now();
const release = path.join(root, 'output/releases', releaseId);
const files = new Map();
for (const name of fs.readdirSync(path.join(root, 'dist/assets'))) {
  const source = path.join(root, 'dist/assets', name);
  if (fs.statSync(source).isFile()) files.set('dist/assets/' + name, fs.readFileSync(source));
}
for (const name of ['index.html', 'aic/index.html', 'aic/home.html']) files.set('dist/' + name, fs.readFileSync(path.join(root, 'dist', name)));
files.set('api/templates/home.html', fs.readFileSync(path.join(root, '../api/templates/home.html')));
files.set('scripts/deploy-interface-copy.sh', Buffer.from(fs.readFileSync(path.join(root, 'scripts/deploy-interface-copy.sh'), 'utf8').replaceAll('\r\n', '\n')));
const hashes = {};
for (const [name, contents] of files) {
  const destination = path.join(release, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
  hashes[name] = crypto.createHash('sha256').update(contents).digest('hex');
}
fs.writeFileSync(path.join(release, 'release.sha256'), Object.entries(hashes).map(([name, hash]) => hash + '  ' + name + '\n').join(''));
fs.writeFileSync(path.join(release, 'manifest.json'), JSON.stringify({ releaseId, hashes }, null, 2));
console.log(JSON.stringify({ releaseId, release, files: files.size }, null, 2));
