import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blog = process.env.BLOG_DIST_DIR || path.resolve(root, '../../../author-homepage/dist');
const origin = 'https://weather.nogamenolife.cn';
const pairs = [
  ['/', path.resolve(root, '../api/templates/home.html')],
  ['/console.css', path.resolve(root, '../api/static/console.css')],
  ['/home-assets/design.css', path.resolve(root, '../api/static/home/design.css')],
  ['/home-assets/author.css', path.resolve(root, '../api/static/home/author.css')],
  ['/home-assets/scene.js', path.resolve(root, '../api/static/home/scene.js')],
  ['/home-assets/scene.json', path.resolve(root, '../api/static/home/scene.json')],
  ['/decision/', path.resolve(root, 'dist/index.html')],
  ['/decision/aic/', path.resolve(root, 'dist/aic/index.html')],
  ['/decision/aic/home.html', path.resolve(root, 'dist/aic/home.html')],
  ['/decision/aic/journal.html', path.resolve(root, 'dist/aic/journal.html')],
];
for (const name of fs.readdirSync(path.join(root, 'dist/ui-fonts'))) {
  pairs.push(['/decision/ui-fonts/' + name, path.join(root, 'dist/ui-fonts', name)]);
}
for (const name of ['', 'microjie-overview/', 'platform-architecture/', 'roadmap-security/']) {
  pairs.push(['/author/project/' + name, path.join(blog, 'project', name, 'index.html')]);
}
for (const file of fs.readdirSync(path.join(root, 'dist/assets')).filter(name => /^(main-|map-|sandbox-|buildings3d-)/.test(name))) {
  pairs.push(['/decision/assets/' + file, path.join(root, 'dist/assets', file)]);
}
for (const file of ['homepage-scene.png', 'landcover.png', 'field-observation.webp', 'data-platform.webp']) {
  pairs.push(['/decision/aic/assets/' + file, path.join(root, 'dist/aic/assets', file)]);
}
const journal = fs.readFileSync(path.join(blog, 'project/index.html'), 'utf8');
for (const match of journal.matchAll(/(?:href|src)="(\/author\/_astro\/[^"<>]+)"/g)) {
  pairs.push([match[1], path.join(blog, match[1].slice('/author/'.length))]);
}
const checks = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const [url, file] of pairs) {
  const response = await fetch(origin + url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
  const remote = Buffer.from(await response.arrayBuffer());
  if (hash(remote) !== hash(fs.readFileSync(file))) throw new Error(url + ': content differs from release');
  checks.push({ url, sha256: hash(remote), bytes: remote.length });
}
for (const url of ['/health', '/api/devices', '/api/weather/aic/status', '/api/weather/sandbox/lcz-metadata']) {
  const response = await fetch(origin + url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
  await response.json();
  checks.push({ url, status: response.status });
}
console.log(JSON.stringify({ origin, passed: checks.length, checks }, null, 2));
