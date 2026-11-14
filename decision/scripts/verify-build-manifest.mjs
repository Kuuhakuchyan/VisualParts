import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.env.VITE_OUTPUT_DIR || 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'build-manifest.json'), 'utf8'));
const identity = JSON.parse(fs.readFileSync(path.join(root, 'release-version.json'), 'utf8'));
assert.equal(manifest.schema_version, 'WJTJ-build-manifest-1.0');
assert.equal(manifest.version, identity.version);
const actual = new Set();
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Symlink in build output');
    if (entry.isDirectory()) walk(target);
    else actual.add(path.relative(output, target).split(path.sep).join('/'));
  }
}
walk(output);
actual.delete('build-manifest.json');
assert.equal(manifest.files.length, actual.size, 'Manifest omits or repeats build outputs');
for (const file of manifest.files) {
  assert.ok(actual.delete(file.path), 'Missing or duplicated manifest entry');
  const bytes = fs.readFileSync(path.join(output, file.path));
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
}
assert.equal(actual.size, 0);
const cesiumFile = path.posix.join(manifest.base_path.replace(/^\/+/, ''), 'cesium/Assets/approximateTerrainHeights.json');
for (const file of ['index.html', 'aic/home.html', 'aic/index.html', cesiumFile]) {
  assert.ok(manifest.files.some(entry => entry.path === file), 'Required delivery output missing: ' + file);
}
console.log(`Build manifest verified: ${manifest.files.length} files, software ${manifest.version}`);
