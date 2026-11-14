import fs from 'node:fs';
import path from 'node:path';

const root = 'output/playwright';
const suites = {
  public: ['map', 'editing', 'navigation', 'touch', 'ownership', 'panels', 'competition-panels', 'competition-ownership', 'competition-touch'],
  local_faults: ['workspace', 'selfcheck', 'refresh', 'geometry'],
};
const summary = { checked_at: new Date().toISOString(), suites: {}, counts: {} };
for (const [kind, names] of Object.entries(suites)) {
  summary.suites[kind] = [];
  for (const name of names) {
    const filename = `conflicts-${name}-${kind === 'public' ? 'public' : 'local'}.txt`;
    const raw = fs.readFileSync(path.join(root, filename), 'utf8');
    if (raw.includes('### Error')) throw new Error(`Failed suite: ${filename}`);
    const result = JSON.parse(raw.match(/^\{"url".*$/m)?.[0] || 'null');
    if (!result?.checks?.length) throw new Error(`Missing result: ${filename}`);
    summary.suites[kind].push({ file: filename, ...result });
  }
  summary.counts[kind] = summary.suites[kind].reduce((total, result) => total + result.checks.length, 0);
}
fs.writeFileSync(path.join(root, 'conflicts-final-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ counts: summary.counts, suites: Object.fromEntries(Object.entries(summary.suites).map(([k,v])=>[k,v.length])) }));
