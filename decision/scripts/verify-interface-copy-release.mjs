import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseId = process.argv[2];
if (!/^interface-copy-\d+$/.test(releaseId || '')) throw new Error('Provide an interface-copy release ID.');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'output/releases', releaseId, 'manifest.json'), 'utf8'));
const origin = 'https://weather.nogamenolife.cn';
const checks = [];
for (const [name, expected] of Object.entries(manifest.hashes)) {
  if (!name.endsWith('.html') && !/^dist\/assets\/(main|regional|sandbox|map)-/.test(name)) continue;
  const url = origin + (name.startsWith('api/') ? '/' : '/decision/' + name.slice('dist/'.length));
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  const actual = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  checks.push({ name, status: response.status, matches: response.ok && actual === expected, expected, actual });
}
const result = { releaseId, verified_at: new Date().toISOString(), passed: checks.filter(c => c.matches).length, total: checks.length, checks };
const directory = path.join(root, 'output/playwright');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'interface-copy-public-files.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.passed !== result.total) process.exitCode = 1;
