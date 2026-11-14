export class ForecastFrames {
  constructor({ limit = 8, ttlMs = 300000, now = () => Date.now() } = {}) {
    this.limit = limit; this.ttlMs = ttlMs; this.now = now; this.frames = new Map();
  }
  get(key) {
    const entry = this.frames.get(key);
    if (!entry) return null;
    if (this.now() - entry.created >= this.ttlMs) { this.frames.delete(key); return null; }
    this.frames.delete(key); this.frames.set(key, entry);
    return entry.result;
  }
  put(key, result) {
    this.frames.delete(key); this.frames.set(key, { result, created: this.now() });
    while (this.frames.size > this.limit) this.frames.delete(this.frames.keys().next().value);
  }
  clear() { this.frames.clear(); }
}

export class ForecastPlayback {
  constructor({ render, advance, changed, dwellMs = 5000, timers = globalThis }) {
    Object.assign(this, { render, advance, changed, dwellMs, timers });
    this.generation = 0; this.playing = false; this.timer = null;
  }
  stop() {
    this.generation++; this.timers.clearTimeout(this.timer); this.timer = null;
    this.playing = false; this.changed?.(false);
  }
  play() {
    if (this.playing) return;
    this.playing = true; this.changed?.(true);
    this.step(++this.generation);
  }
  async step(generation) {
    let result;
    try { result = await this.render(); } catch { result = null; }
    if (!this.playing || generation !== this.generation) return;
    if (!result) { this.stop(); return; }
    this.schedule(generation);
  }
  schedule(generation) {
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (!this.playing || generation !== this.generation) return;
      if (!this.advance()) { this.stop(); return; }
      this.step(generation);
    }, this.dwellMs);
  }
  setDwell(dwellMs) {
    this.dwellMs = dwellMs;
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer); this.schedule(this.generation);
    }
  }
}

// A response is not yet a visible frame: wait for the GeoJSON workers and then
// a rendered map frame. Abort removes every listener, including during teardown.
export function waitForHeatRender(map, signal, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let done = false, timer;
    const finish = error => {
      if (done) return; done = true;
      clearTimeout(timer); map.off('sourcedata', source); map.off('render', rendered);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const loaded = () => ['sandbox-heat', 'sandbox-heat-coverage'].every(id => map.getSource(id) && map.isSourceLoaded(id)) &&
      (!map.getSource('sandbox-layout-impact') || map.isSourceLoaded('sandbox-layout-impact'));
    const rendered = () => { if (loaded()) finish(); };
    const source = () => { if (loaded()) map.triggerRepaint(); };
    const abort = () => finish(signal.reason || new DOMException('已取消', 'AbortError'));
    if (signal?.aborted) { abort(); return; }
    map.on('sourcedata', source); map.on('render', rendered);
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('热场绘制尚未完成，播放已暂停，请重试。')), timeoutMs);
    map.triggerRepaint();
  });
}
