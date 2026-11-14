import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prefix = process.argv[2] || 'forecast-playback';
if (!/^[a-z][a-z0-9-]{0,63}$/.test(prefix)) throw new Error('Invalid release prefix');
const releaseId = prefix + '-' + Date.now();
const output = path.join(root, 'output/releases', releaseId), hashes = {};
const competitionEntry = fs.readFileSync(path.join(root, 'dist-aic/aic/index.html'), 'utf8');
if (!competitionEntry.includes('src="/assets/') || competitionEntry.includes('"/decision/')) {
  throw new Error('Build isolated AIC with VITE_BASE_PATH=/ and VITE_OUTPUT_DIR=dist-aic first');
}
function copy(source, name) {
  if (fs.statSync(source).isDirectory()) {
    for (const entry of fs.readdirSync(source)) copy(path.join(source, entry), name + '/' + entry);
    return;
  }
  const bytes = name === 'deploy.sh' ? Buffer.from(fs.readFileSync(source, 'utf8').replaceAll('\r\n', '\n')) : fs.readFileSync(source);
  fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
  fs.writeFileSync(path.join(output, name), bytes);
  hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
}
for (const file of ['index.html', 'aic/index.html', 'assets']) copy(path.join(root, 'dist', file), 'dist/' + file);
for (const file of ['aic/index.html', 'assets']) copy(path.join(root, 'dist-aic', file), 'competition-dist/' + file);
copy(path.join(root, 'scripts/deploy-forecast-playback.sh'), 'deploy.sh');
const release = { releaseId, builtAt: new Date().toISOString(), scope: process.argv[3] || 'Rendered-frame forecast playback, visible dwell selection, retained thermal frames and context-bound result cache' };
const bytes = Buffer.from(JSON.stringify(release, null, 2));
fs.writeFileSync(path.join(output, 'release.json'), bytes);
hashes['release.json'] = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(output, 'release.sha256'), Object.entries(hashes).map(([file, hash]) => hash + '  ' + file + '\n').join(''));
console.log(JSON.stringify({ ...release, output, files: Object.keys(hashes).length }));
