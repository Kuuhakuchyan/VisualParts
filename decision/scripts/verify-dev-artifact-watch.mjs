import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin = process.argv[2] || 'http://127.0.0.1:5174';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const client = await (await fetch(origin + '/@vite/client')).text();
const token = client.match(/const wsToken = "([^"]+)"/)[1];
const socketURL = new URL(origin.replace('http', 'ws'));
socketURL.searchParams.set('token', token);
const socket = new WebSocket(socketURL, 'vite-hmr');
const messages = [];
socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
const timer = setTimeout(() => socket.close(), 5000);
const paths = ['output/workspace-watch-probe.html', '.playwright-cli/workspace-watch-probe.html'];
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  for (const name of paths) fs.writeFileSync(name, '<!doctype html><title>Generated verification artifact</title>');
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.ok(messages.some(message => message.type === 'connected'));
  assert.equal(messages.some(message => message.type === 'full-reload' || message.type === 'update'), false);
  console.log(JSON.stringify({ checks: ['Vite HMR connected', 'generated output does not reload application', 'Playwright artifacts do not reload application'], errors: [] }));
} finally {
  clearTimeout(timer);
  for (const name of paths) if (fs.existsSync(name)) fs.unlinkSync(name);
  socket.close();
}
