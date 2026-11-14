import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { ForecastFrames, ForecastPlayback, waitForHeatRender } from '../frontend/workspace/forecast-frames.js';

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function clock() {
  let now = 0, id = 0; const jobs = new Map();
  return { jobs,
    setTimeout(fn, ms) { jobs.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout(key) { jobs.delete(key); },
    async tick(ms) {
      now += ms;
      for (const [key, job] of [...jobs]) if (job.at <= now) { jobs.delete(key); job.fn(); }
      await flush();
    },
  };
}
function fakeMap() {
  const map = new EventEmitter(); map.loaded = new Set(); map.repaint = 0;
  map.sources = new Set(['sandbox-heat', 'sandbox-heat-coverage']);
  map.getSource = id => map.sources.has(id) ? { id } : null; map.isSourceLoaded = id => map.loaded.has(id);
  map.triggerRepaint = () => { map.repaint++; };
  return map;
}

test('frames expire from calculation time, use bounded LRU and clear after changed inputs', () => {
  let now = 0; const frames = new ForecastFrames({ limit: 2, ttlMs: 100, now: () => now });
  const first = { report_sha256: 'first' };
  frames.put('scene-A/hour-1', first); frames.put('scene-A/hour-2', {});
  assert.equal(frames.get('scene-A/hour-1'), first);
  frames.put('scene-A/hour-3', {});
  assert.equal(frames.get('scene-A/hour-2'), null);
  assert.equal(frames.get('scene-B/hour-1'), null);
  now = 99; assert.equal(frames.get('scene-A/hour-1'), first);
  now = 100; assert.equal(frames.get('scene-A/hour-1'), null);
  frames.clear(); assert.equal(frames.frames.size, 0);
});
test('slow rendering does not consume the five second viewing interval', async () => {
  const timers = clock(), rendered = deferred(); let advances = 0, renders = 0;
  const playback = new ForecastPlayback({ timers, render: () => { renders++; return rendered.promise; }, advance: () => { advances++; return true; } });
  playback.play(); await timers.tick(20000);
  assert.equal(advances, 0); assert.equal(timers.jobs.size, 0);
  rendered.resolve({}); await flush();
  await timers.tick(4999); assert.equal(advances, 0);
  await timers.tick(1); assert.equal(advances, 1); assert.equal(renders, 2);
  playback.stop(); assert.equal(timers.jobs.size, 0);
});
test('pause and resume during one pending render cannot create duplicate playback loops', async () => {
  const timers = clock(), rendered = deferred(); let advances = 0;
  const playback = new ForecastPlayback({ timers, render: () => rendered.promise, advance: () => { advances++; return true; } });
  playback.play(); playback.stop(); playback.play(); rendered.resolve({}); await flush();
  assert.equal(timers.jobs.size, 1);
  await timers.tick(5000); assert.equal(advances, 1); assert.equal(timers.jobs.size, 1);
  playback.stop(); await timers.tick(50000); assert.equal(advances, 1);
});
test('failure pauses without advancing; last hour stops instead of wrapping', async () => {
  const timers = clock(); let advances = 0;
  const failed = new ForecastPlayback({ timers, render: async () => null, advance: () => { advances++; return true; } });
  failed.play(); await flush(); assert.equal(failed.playing, false); assert.equal(advances, 0);
  const last = new ForecastPlayback({ timers, render: async () => ({}), advance: () => false });
  last.play(); await flush(); await timers.tick(5000);
  assert.equal(last.playing, false); assert.equal(timers.jobs.size, 0);
});
test('changing dwell resets visible-frame timer and applies to following frames', async () => {
  const timers = clock(); let advances = 0;
  const playback = new ForecastPlayback({ timers, render: async () => ({}), advance: () => { advances++; return true; } });
  playback.play(); await flush(); await timers.tick(4000); playback.setDwell(8000);
  await timers.tick(7999); assert.equal(advances, 0);
  await timers.tick(1); assert.equal(advances, 1);
  await timers.tick(7999); assert.equal(advances, 1);
  await timers.tick(1); assert.equal(advances, 2); playback.stop();
});
test('map acknowledgement requires both heat sources loaded and a subsequent render', async () => {
  const map = fakeMap(), abort = new AbortController(); let done = false;
  const pending = waitForHeatRender(map, abort.signal).then(() => { done = true; });
  map.emit('render'); await flush(); assert.equal(done, false);
  map.loaded.add('sandbox-heat'); map.emit('sourcedata'); map.emit('render'); await flush(); assert.equal(done, false);
  map.loaded.add('sandbox-heat-coverage'); map.emit('sourcedata'); await flush(); assert.equal(done, false);
  map.emit('render'); await pending; assert.equal(done, true);
  assert.equal(map.listenerCount('render') + map.listenerCount('sourcedata'), 0);
});
test('aborting render waits removes listeners even when already aborted', async () => {
  for (const before of [false, true]) {
    const map = fakeMap(), abort = new AbortController();
    if (before) abort.abort();
    const pending = waitForHeatRender(map, abort.signal);
    if (!before) abort.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(map.listenerCount('render') + map.listenerCount('sourcedata'), 0);
  }
});
test('forecast dwell also waits for the optional local-impact overlay to render', async () => {
  const map = fakeMap(); map.sources.add('sandbox-layout-impact');
  map.loaded.add('sandbox-heat'); map.loaded.add('sandbox-heat-coverage');
  let done = false;
  const pending = waitForHeatRender(map).then(() => { done = true; });
  map.emit('render'); await flush(); assert.equal(done, false);
  map.loaded.add('sandbox-layout-impact'); map.emit('render'); await pending;
  assert.equal(done, true);
});
test('render timeout rejects and removes all listeners', async () => {
  const map = fakeMap();
  await assert.rejects(waitForHeatRender(map, undefined, 5), /播放已暂停/);
  assert.equal(map.listenerCount('render') + map.listenerCount('sourcedata'), 0);
});
