import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = net.createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
child.stdout.on('data', value => { output += value; });
child.stderr.on('data', value => { output += value; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error('Vite exited before serving assets: ' + output.slice(-2000));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/home-assets/mobile-devices.js`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && response.headers.get('content-type')?.includes('javascript')) { ready = true; break; }
    } catch {}
    await delay(250);
  }
  assert.ok(ready, 'Vite did not serve the mobile module');
  for (const name of ['mobile-devices.js', 'mobile-devices.css']) {
    const response = await fetch(`http://127.0.0.1:${port}/home-assets/${name}?release-check=1`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), name.endsWith('.js') ? /javascript/ : /text\/css/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, '../api/static/home', name)));
  }
  for (const route of ['/sensors', '/monitor']) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /\/home-assets\/mobile-devices\.js/);
  }
  console.log('Local sensor/monitor routes and mobile asset MIME/content: PASS');
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}
