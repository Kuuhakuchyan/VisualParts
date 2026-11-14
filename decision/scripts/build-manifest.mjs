import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function writeBuildManifest(output, { base = '/decision/' } = {}) {
  const identity = JSON.parse(fs.readFileSync(path.join(root, 'release-version.json'), 'utf8'));
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (packageVersion !== identity.version) throw new Error('Frontend/backend software versions differ');
  let sourceRevision = null, sourceDirty = null;
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    sourceRevision = git(['rev-parse', 'HEAD']);
    sourceDirty = Boolean(git(['status', '--porcelain', '--untracked-files=normal']));
  } catch {
    // Source archives can build without Git; do not invent a revision.
  }
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Build output contains a symlink');
      if (entry.isDirectory()) walk(target);
      else {
        const relative = path.relative(output, target).split(path.sep).join('/');
        if (relative === 'build-manifest.json') continue;
        if (entry.name.startsWith('.env') || /\.(?:sqlite3|db|pem|key)$/.test(entry.name)) throw new Error('Private file found in build output');
        const bytes = fs.readFileSync(target);
        files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  walk(output);
  const manifest = { ...identity, schema_version: 'WJTJ-build-manifest-1.0',
    base_path: base, built_at: new Date().toISOString(), source_revision: sourceRevision, source_dirty: sourceDirty, files };
  fs.writeFileSync(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
