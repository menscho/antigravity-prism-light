import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

function makeEventBus() {
  const map = new Map();
  return {
    map,
    add(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    },
    remove(type, fn) {
      map.get(type)?.delete(fn);
    },
    dispatch(type, ev = {}) {
      for (const fn of [...(map.get(type) || [])]) fn(ev);
    },
    count(type) {
      return (map.get(type) || new Set()).size;
    },
  };
}

function makeFakeTimerEnv(initialNow = 1000) {
  let now = initialNow;
  let seq = 1;
  const timers = new Map();
  const rafs = new Map();
  return {
    get now() { return now; },
    set now(v) { now = v; },
    timers,
    rafs,
    performance: { now: () => now },
    setTimeout(fn, ms = 0) {
      const id = seq++;
      timers.set(id, { fn, ms: Number(ms) || 0, due: now + Math.max(0, Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(fn) {
      const id = seq++;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    flushRafs(stepMs = 16) {
      now += stepMs;
      const list = [...rafs.entries()];
      rafs.clear();
      for (const [, fn] of list) fn(now);
      return list.length;
    },
    advanceTimers(deltaMs) {
      const target = now + deltaMs;
      while (true) {
        let next = null;
        for (const [id, t] of timers.entries()) {
          if (t.due <= target && (!next || t.due < next.t.due)) next = { id, t };
        }
        if (!next) break;
        now = next.t.due;
        timers.delete(next.id);
        next.t.fn();
      }
      now = target;
    },
  };
}

test('A1 home-ripple-host: document.hidden true->false shrinks & restores backing stores without losing state or throwing at 0x0', () => {
  const src = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
  const env = makeFakeTimerEnv(1000);
  const docBus = makeEventBus();
  const winBus = makeEventBus();
  let roCb = null;
  let roDisconnected = 0;

  const createdCanvases = [];
  const makeEl = (tag) => {
    const attrs = new Map();
    const elBus = makeEventBus();
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      width: tag === 'canvas' ? 300 : undefined,
      height: tag === 'canvas' ? 150 : undefined,
      style: {},
      isConnected: true,
      children: [],
      get firstChild() { return this.children[0] || null; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { this.children.push(c); c.isConnected = true; return c; },
      insertBefore(c) { this.children.unshift(c); c.isConnected = true; return c; },
      remove() { this.isConnected = false; },
      querySelector: () => null,
      addEventListener: (t, fn) => elBus.add(t, fn),
      removeEventListener: (t, fn) => elBus.remove(t, fn),
      _bus: elBus,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: home.clientWidth, height: home.clientHeight }),
    };
    if (tag === 'canvas') createdCanvases.push(el);
    return el;
  };

  const home = makeEl('div');
  home.clientWidth = 1280;
  home.clientHeight = 720;

  const html = makeEl('html');
  html.setAttribute('data-ag-cs-palette', 'obsidian');
  html.setAttribute('data-ag-cs-ambient', '1');

  const fakeDoc = {
    hidden: false,
    documentElement: html,
    createElement: (tag) => makeEl(tag),
    querySelector: (sel) => (sel === '.agy-home' ? home : null),
    addEventListener: (t, fn) => docBus.add(t, fn),
    removeEventListener: (t, fn) => docBus.remove(t, fn),
  };

  const sb = {
    document: fakeDoc,
    devicePixelRatio: 1,
    performance: env.performance,
    requestAnimationFrame: env.requestAnimationFrame,
    cancelAnimationFrame: env.cancelAnimationFrame,
    setTimeout: env.setTimeout,
    clearTimeout: env.clearTimeout,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class {
      constructor(cb) { roCb = cb; }
      observe() {}
      disconnect() { roDisconnected += 1; }
    },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    Float32Array, Math, Number, String, Boolean, Array, Object, Map, Set,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);

  let fieldDraws = 0;
  let fieldDisposes = 0;
  let fieldInvalidates = 0;
  let glowDraws = 0;
  let glowResizes = 0;
  let glowReleases = 0;
  let glowInvalidates = 0;

  const rippleCore = {
    RIPPLE: { cellWidth: 16, cellHeight: 24 },
    parseCssColorToRgb: () => null,
    createWaveField: () => ({
      height: new Float32Array(1),
      active: () => false,
      disturb() {},
      skimmer() {},
      advance() {},
    }),
    createGlyphField(cv) {
      return {
        mode: 'webgl2',
        busy: () => false,
        needsDraw: () => false,
        setCalmZones() {},
        invalidate() { fieldInvalidates += 1; },
        draw() {
          if (cv.width <= 0 || cv.height <= 0) throw new Error('WebGL viewport(0,0,0,0) violation');
          fieldDraws += 1;
        },
        dispose() { fieldDisposes += 1; },
      };
    },
    mountBrandHorizonGlow(cv) {
      return {
        mode: 'webgl2',
        resize(w, h, dpr) {
          glowResizes += 1;
          cv.width = Math.max(1, Math.round(w * dpr));
          cv.height = Math.max(1, Math.round(h * dpr));
        },
        releaseBackingStore() {
          glowReleases += 1;
          cv.width = 0;
          cv.height = 0;
        },
        invalidate() { glowInvalidates += 1; },
        clear() {
          if (cv.width <= 0 || cv.height <= 0) throw new Error('Glow clear at 0x0 violation');
        },
        draw() {
          if (cv.width <= 0 || cv.height <= 0) throw new Error('Glow draw at 0x0 violation');
          glowDraws += 1;
        },
        dispose() {},
      };
    },
  };

  const ctl = sb.__agPrismHomeRippleHost.createHomeRippleController({
    rippleCore,
    isDestroyed: () => false,
    isAllowed: () => true,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'follow',
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
  });

  ctl.sync();
  const mount = ctl.getMount();
  assert.ok(mount);
  const { canvas, glowCanvas } = mount;
  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 720);
  assert.equal(glowCanvas.width, Math.round(1280 * 0.6));
  assert.equal(glowCanvas.height, Math.round(720 * 0.6));
  env.flushRafs(16);
  assert.equal(fieldDraws, 1);
  assert.equal(glowDraws, 1);

  // Regular window blur (document still visible) must NOT shrink backing stores
  winBus.dispatch('blur');
  assert.equal(mount.sleeping, true);
  assert.equal(canvas.width, 1280, 'Visible blurred window must keep canvas pixels to prevent black flash');
  assert.equal(glowCanvas.width, Math.round(1280 * 0.6));
  winBus.dispatch('focus');
  env.flushRafs(16);

  // document.hidden = true -> pauses loop and shrinks both canvases to 0x0 without disposing field/waves
  const savedWaves = mount.waves;
  const savedField = mount.field;
  const disposesBeforeHide = fieldDisposes;
  fakeDoc.hidden = true;
  docBus.dispatch('visibilitychange');

  assert.equal(mount.sleeping, true);
  assert.equal(mount.rafId, 0);
  assert.equal(env.rafs.size, 0, 'Hidden window must cancel pending rAF');
  assert.equal(canvas.width, 0, 'Main ripple canvas must shrink to width=0 when hidden');
  assert.equal(canvas.height, 0, 'Main ripple canvas must shrink to height=0 when hidden');
  assert.equal(glowCanvas.width, 0, 'Horizon glow canvas must shrink to width=0 when hidden');
  assert.equal(glowCanvas.height, 0, 'Horizon glow canvas must shrink to height=0 when hidden');
  assert.equal(glowReleases, 1, 'glow.releaseBackingStore should be invoked when supported');
  assert.equal(mount.width, 1280, 'Logical width must be preserved');
  assert.equal(mount.height, 720, 'Logical height must be preserved');
  assert.equal(mount.waves, savedWaves, 'Wave field state must be preserved');
  assert.equal(mount.field, savedField, 'Glyph field must not be disposed on hide');
  assert.equal(fieldDisposes, disposesBeforeHide);

  // Operations while hidden + 0x0 must NOT draw or throw
  const drawsWhileHidden = fieldDraws;
  const glowDrawsWhileHidden = glowDraws;
  assert.doesNotThrow(() => {
    mount.wake();
    ctl.refreshTheme();
    ctl.triggerTideSwell();
    roCb?.();
  });
  assert.equal(fieldDraws, drawsWhileHidden, '0 glyph draws while hidden at 0x0');
  assert.equal(glowDraws, glowDrawsWhileHidden, '0 glow draws while hidden at 0x0');
  assert.equal(canvas.width, 0);
  assert.equal(glowCanvas.width, 0);

  // Restore visibility with unchanged container size -> restores backing store in-place and immediately paints first frame
  const resizesBeforeShow = glowResizes;
  fakeDoc.hidden = false;
  docBus.dispatch('visibilitychange');

  assert.equal(canvas.width, 1280, 'Main canvas width must restore immediately');
  assert.equal(canvas.height, 720, 'Main canvas height must restore immediately');
  assert.equal(glowCanvas.width, Math.round(1280 * 0.6), 'Glow canvas width must restore immediately');
  assert.equal(glowCanvas.height, Math.round(720 * 0.6), 'Glow canvas height must restore immediately');
  assert.equal(mount.field, savedField, 'Unchanged container size must restore in-place without disposing field');
  assert.equal(fieldDisposes, disposesBeforeHide);
  assert.ok(glowResizes > resizesBeforeShow);
  assert.ok(fieldInvalidates > 0 && glowInvalidates > 0);
  assert.equal(fieldDraws, drawsWhileHidden + 1, 'Must synchronously paint first frame on visibility restore (zero black flash)');
  assert.equal(glowDraws, glowDrawsWhileHidden + 1);
  assert.ok(env.rafs.size >= 1, 'Active intro/tide animation must resume rAF cadence after restore');

  // Hide again, resize container while hidden (1280x720 -> 960x540), then show -> rebuilds to new size cleanly
  fakeDoc.hidden = true;
  docBus.dispatch('visibilitychange');
  assert.equal(canvas.width, 0);
  home.clientWidth = 960;
  home.clientHeight = 540;
  roCb?.();
  assert.equal(canvas.width, 0, 'Resize while hidden must NOT allocate backing store');
  fakeDoc.hidden = false;
  docBus.dispatch('visibilitychange');
  assert.equal(canvas.width, Math.ceil(960 / 16) * 16);
  assert.equal(canvas.height, Math.ceil(540 / 24) * 24);
  assert.equal(glowCanvas.width, Math.round(960 * 0.6));
  assert.equal(glowCanvas.height, Math.round(540 * 0.6));

  // Unmount cleans up all timers, rAFs, ResizeObserver, and event listeners
  ctl.unmount();
  assert.equal(docBus.count('visibilitychange'), 0);
  assert.equal(winBus.count('blur'), 0);
  assert.equal(winBus.count('focus'), 0);
  assert.equal(env.rafs.size, 0);
  assert.equal(env.timers.size, 0);
  assert.ok(roDisconnected >= 1);
});

test('A1 home-ripple-host + real ripple-core 2D integration: 0x0 hide & visible restore never throws', () => {
  const rippleCore = require('../ripple-core.js');
  const homeRippleMod = require('../home-ripple-host.js');
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevPerf = globalThis.performance;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;

  const env = makeFakeTimerEnv(1000);
  const docBus = makeEventBus();
  const winBus = makeEventBus();
  const make2DCanvas = () => {
    const attrs = new Map();
    const cv = {
      width: 300,
      height: 150,
      className: '',
      isConnected: true,
      style: {},
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      remove() { this.isConnected = false; },
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 }),
      ownerDocument: null,
      getContext(type) {
        if (type !== '2d') return null;
        return {
          setTransform() {},
          clearRect() {},
          fillText() {},
          getImageData(_x, _y, w, h) {
            if (w <= 0 || h <= 0) throw new Error('getImageData(0x0)');
            return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          },
          createImageData(w, h) {
            if (w <= 0 || h <= 0) throw new Error('createImageData(0x0)');
            return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          },
          putImageData() {
            if (cv.width <= 0 || cv.height <= 0) throw new Error('putImageData(0x0)');
          },
        };
      },
    };
    return cv;
  };
  const homeNode = {
    clientWidth: 320,
    clientHeight: 180,
    children: [],
    get firstChild() { return this.children[0] || null; },
    insertBefore(n) { this.children.unshift(n); n.isConnected = true; return n; },
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const fakeDoc = {
    hidden: false,
    documentElement: { getAttribute: () => '1' },
    querySelector: (s) => (s === '.agy-home' ? homeNode : null),
    addEventListener: (t, fn) => docBus.add(t, fn),
    removeEventListener: (t, fn) => docBus.remove(t, fn),
    createElement(tag) {
      if (tag === 'canvas') {
        const c = make2DCanvas();
        c.ownerDocument = fakeDoc;
        return c;
      }
      const attrs = new Map();
      const kids = [];
      return {
        className: '', isConnected: true,
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        hasAttribute: (k) => attrs.has(k),
        removeAttribute: (k) => attrs.delete(k),
        appendChild: (c) => { kids.push(c); return c; },
        remove() {},
      };
    },
  };
  globalThis.document = fakeDoc;
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
  };
  globalThis.performance = env.performance;
  globalThis.requestAnimationFrame = env.requestAnimationFrame;
  globalThis.cancelAnimationFrame = env.cancelAnimationFrame;

  try {
    const ctl = homeRippleMod.createHomeRippleController({
      rippleCore,
      isDestroyed: () => false,
      isAllowed: () => true,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    });
    ctl.sync();
    env.flushRafs(16);
    const m = ctl.getMount();
    assert.ok(m.canvas.width > 0 && m.glowCanvas.width > 0);

    fakeDoc.hidden = true;
    docBus.dispatch('visibilitychange');
    assert.equal(m.canvas.width, 0);
    assert.equal(m.canvas.height, 0);
    assert.equal(m.glowCanvas.width, 0);
    assert.equal(m.glowCanvas.height, 0);

    fakeDoc.hidden = false;
    assert.doesNotThrow(() => docBus.dispatch('visibilitychange'));
    assert.ok(m.canvas.width > 0 && m.canvas.height > 0);
    assert.ok(m.glowCanvas.width > 0 && m.glowCanvas.height > 0);

    ctl.unmount();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.performance = prevPerf;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
  }
});

test('A1 conv-aura: document.hidden true->false releases & restores backing store across running, settled idle, and resize with zero 0x0 draws', () => {
  const src = fs.readFileSync(path.join(ROOT, 'conv-aura.js'), 'utf8');
  const env = makeFakeTimerEnv(1000);
  const docBus = makeEventBus();
  const winBus = makeEventBus();
  let roCb = null;
  let roDisconnected = 0;

  const makeEl = (tag, testId = '') => {
    const attrs = new Map();
    if (testId) attrs.set('data-testid', testId);
    const kids = [];
    return {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      className: '',
      width: tag === 'canvas' ? 300 : undefined,
      height: tag === 'canvas' ? 150 : undefined,
      hidden: false,
      isConnected: true,
      parentElement: null,
      clientWidth: 800,
      clientHeight: 600,
      style: { setProperty(k, v) { this[k] = v; } },
      get firstChild() { return kids[0] || null; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      insertBefore(c) { c.parentElement = this; c.isConnected = true; kids.unshift(c); return c; },
      appendChild(c) { c.parentElement = this; c.isConnected = true; kids.push(c); return c; },
      remove() { this.isConnected = false; },
      closest: () => null,
      matches: (sel) => testId && sel.includes(`"${testId}"`),
      querySelectorAll: () => [],
    };
  };

  const seat = makeEl('div');
  const convView = makeEl('div', 'conversation-view');
  seat.appendChild(convView);
  const stopBtn = makeEl('button', 'stop-button');
  let running = true;

  const fakeDoc = {
    hidden: false,
    documentElement: makeEl('html'),
    hasFocus: () => true,
    createElement: (tag) => makeEl(tag),
    querySelector: () => null,
    querySelectorAll(sel) {
      if (sel.includes('conversation-view')) return [convView];
      if (sel.includes('stop-button')) return running ? [stopBtn] : [];
      return [];
    },
    addEventListener: (t, fn) => docBus.add(t, fn),
    removeEventListener: (t, fn) => docBus.remove(t, fn),
  };

  const sb = {
    document: fakeDoc,
    devicePixelRatio: 2,
    performance: env.performance,
    requestAnimationFrame: env.requestAnimationFrame,
    cancelAnimationFrame: env.cancelAnimationFrame,
    setTimeout: env.setTimeout,
    clearTimeout: env.clearTimeout,
    ResizeObserver: class {
      constructor(cb) { roCb = cb; }
      observe() {}
      disconnect() { roDisconnected += 1; }
    },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    WeakSet, Set, Map, Array, Object, Math, Number, String, Boolean,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);

  let glowDraws = 0;
  let glowSnaps = 0;
  let glowResizes = 0;
  let glowReleases = 0;

  const mockRippleCore = {
    resolveHorizonDpr: (raw, scale) => Math.min(raw, 2) * scale,
    mountBrandHorizonGlow(cv) {
      return {
        mode: 'webgl2',
        resize(w, h, dpr) {
          glowResizes += 1;
          cv.width = Math.max(1, Math.round(w * dpr));
          cv.height = Math.max(1, Math.round(h * dpr));
        },
        releaseBackingStore() {
          glowReleases += 1;
          cv.width = 0;
          cv.height = 0;
        },
        invalidate() {},
        clear() {
          if (cv.width <= 0 || cv.height <= 0) throw new Error('conv-aura clear at 0x0');
        },
        draw() {
          if (cv.width <= 0 || cv.height <= 0) throw new Error('conv-aura draw at 0x0');
          glowDraws += 1;
        },
        drawStaticSnapshot() {
          if (cv.width <= 0 || cv.height <= 0) throw new Error('conv-aura staticSnapshot at 0x0');
          glowSnaps += 1;
        },
        dispose() {},
      };
    },
  };

  const ctl = sb.__agPrismConvAura.createConvAuraController({
    isDestroyed: () => false,
    isHomeRippleEnabled: () => true,
    isMotionStandardOrUltra: () => true,
    isDarkTheme: () => true,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getSpectrumMode: () => 'default',
    isWindowFocused: () => true,
    rippleCore: mockRippleCore,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });

  ctl.sync();
  const inst = ctl.getInstance();
  assert.ok(inst);
  const cv = inst.canvas;
  assert.equal(inst.phase, 'running');
  assert.ok(cv.width > 0 && cv.height > 0);
  assert.equal(inst.backingReleased, false);
  assert.equal(glowDraws, 1);

  // Regular window blur (document visible) pauses animation without releasing canvas pixels
  const prevW = cv.width;
  winBus.dispatch('blur');
  assert.equal(inst.sleeping, true);
  assert.equal(cv.width, prevW, 'Visible window blur must preserve backing store');
  assert.equal(inst.backingReleased, false);
  winBus.dispatch('focus');

  // Hide document -> shrinks canvas to 0x0, stops timers/rAF, preserves logical width/height
  fakeDoc.hidden = true;
  docBus.dispatch('visibilitychange');
  assert.equal(cv.width, 0);
  assert.equal(cv.height, 0);
  assert.equal(inst.backingReleased, true);
  assert.equal(glowReleases, 1);
  assert.equal(inst.sleeping, true);
  assert.equal(inst.sleepReason, 'hidden');
  assert.equal(env.timers.size, 0, 'Hidden conv-aura must cancel scheduled timers');
  assert.equal(env.rafs.size, 0, 'Hidden conv-aura must cancel pending rAF');
  assert.equal(inst.width, 800, 'Logical width must be preserved');
  assert.equal(inst.height, Math.round(600 * 0.32), 'Logical height must be preserved');

  // Operations while hidden + 0x0 must NOT draw or throw
  const drawsHidden = glowDraws;
  const snapsHidden = glowSnaps;
  assert.doesNotThrow(() => {
    ctl.refreshTheme();
    ctl.sync();
    inst.wake(true);
    roCb?.([{ contentRect: { width: 1000, height: 750 } }]);
  });
  assert.equal(glowDraws, drawsHidden);
  assert.equal(glowSnaps, snapsHidden);
  assert.equal(cv.width, 0);
  assert.equal(cv.height, 0);

  // Show document with updated container size -> rebuilds backing store & draws first frame immediately
  seat.clientWidth = 1000;
  seat.clientHeight = 750;
  const resizesBeforeShow = glowResizes;
  fakeDoc.hidden = false;
  docBus.dispatch('visibilitychange');
  assert.equal(inst.backingReleased, false);
  assert.ok(glowResizes > resizesBeforeShow);
  assert.equal(inst.width, 1000);
  assert.equal(inst.height, Math.round(750 * 0.32));
  assert.ok(cv.width > 0 && cv.height > 0);
  assert.equal(glowDraws, drawsHidden + 1, 'Must immediately paint first frame on visibility restore');
  assert.ok(env.timers.size + env.rafs.size >= 1, 'Running aura must resume frame scheduler (VSync rAF or timer) on restore');

  // Settled 0fps idle aura: hide -> 0x0, show -> restores backing store, draws 1 static snapshot, and returns to 0fps sleep
  running = false;
  stopBtn.isConnected = false;
  env.now += 2000;
  ctl.sync();
  for (let i = 0; i < 6 && (env.timers.size > 0 || env.rafs.size > 0); i++) {
    env.advanceTimers(1500);
    env.flushRafs(16);
  }
  assert.equal(inst.phase, 'idle');
  assert.equal(inst.sleeping, true);
  assert.equal(env.timers.size, 0);

  fakeDoc.hidden = true;
  docBus.dispatch('visibilitychange');
  assert.equal(cv.width, 0);
  assert.equal(cv.height, 0);
  assert.equal(inst.backingReleased, true);

  // Even if container temporarily reports 0 clientWidth on restore, fallback restores using saved logical size
  seat.clientWidth = 0;
  seat.clientHeight = 0;
  convView.clientWidth = 0;
  convView.clientHeight = 0;
  const snapsBeforeIdleRestore = glowSnaps;
  fakeDoc.hidden = false;
  docBus.dispatch('visibilitychange');
  assert.equal(inst.backingReleased, false);
  assert.ok(cv.width > 0 && cv.height > 0, 'Must restore backing store via logical dimensions fallback');
  assert.equal(glowSnaps, snapsBeforeIdleRestore + 1, 'Settled idle must repaint 1 static snapshot after restore');
  assert.equal(inst.sleeping, true, 'Settled idle must remain 0fps sleep after repainting snapshot');
  assert.equal(env.timers.size, 0);

  // Unmount cleans up listeners, observers, timers, and rAFs
  ctl.unmount();
  assert.equal(docBus.count('visibilitychange'), 0);
  assert.equal(winBus.count('blur'), 0);
  assert.equal(winBus.count('focus'), 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.rafs.size, 0);
  assert.ok(roDisconnected >= 1);
});

test('A1 prism-rim-canvas: hidden immediate 0x0 shrink, visible idle timeout shrink (~1800ms), selective active preservation, seamless re-entry restore, and teardown cleanup', () => {
  const src = fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8');
  const env = makeFakeTimerEnv(5000);
  const docBus = makeEventBus();
  const rootBus = makeEventBus();

  let strokeCalls = 0;
  let clearCalls = 0;
  const makeMockCanvas = () => {
    const attrs = new Map();
    const cv = {
      width: 300,
      height: 150,
      className: '',
      isConnected: true,
      parentElement: null,
      nextElementSibling: null,
      classList: { contains: (c) => cv.className.split(/\s+/).includes(c) },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      remove() { this.isConnected = false; },
      getContext(type) {
        if (type !== '2d') return null;
        return {
          globalAlpha: 1,
          lineWidth: 1,
          strokeStyle: null,
          clearRect(_x, _y, w, h) {
            if (cv.width <= 0 || cv.height <= 0 || w <= 0 || h <= 0) throw new Error('clearRect at 0x0');
            clearCalls += 1;
          },
          beginPath() {},
          roundRect() {},
          stroke() {
            if (cv.width <= 0 || cv.height <= 0) throw new Error('stroke at 0x0');
            strokeCalls += 1;
          },
          createRadialGradient() {
            return { addColorStop() {} };
          },
        };
      },
    };
    return cv;
  };

  const makeBox = (rect) => {
    const attrs = new Map([['data-ag-cs-prism-box', '1']]);
    const kids = [];
    const box = {
      isConnected: true,
      style: { setProperty() {} },
      get firstElementChild() { return kids[0] || null; },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      appendChild(c) {
        c.parentElement = box;
        c.isConnected = true;
        kids.push(c);
        return c;
      },
      querySelector: (s) => (s === '.ag-cs-prism-rim-cv' ? kids.find((k) => k.className === 'ag-cs-prism-rim-cv') || null : null),
      getBoundingClientRect: () => rect,
      _kids: kids,
    };
    return box;
  };

  const box1 = makeBox({ left: 100, top: 100, right: 400, bottom: 180, width: 300, height: 80 });
  const box2 = makeBox({ left: 900, top: 600, right: 1200, bottom: 680, width: 300, height: 80 });
  const boxes = [box1, box2];

  const html = {
    getAttribute: (k) => (k === 'data-ag-cs-motion' ? 'standard' : k === 'data-ag-cs-ambient' ? '1' : null),
    addEventListener: (t, fn) => rootBus.add(t, fn),
    removeEventListener: (t, fn) => rootBus.remove(t, fn),
  };

  const fakeDoc = {
    hidden: false,
    documentElement: html,
    createElement: (tag) => (tag === 'canvas' ? makeMockCanvas() : {}),
    getElementById: () => null,
    querySelectorAll(sel) {
      if (sel.includes('data-ag-cs-prism-box')) return boxes;
      if (sel.includes('.ag-cs-prism-rim-cv')) return boxes.map((b) => b.firstElementChild).filter(Boolean);
      if (sel.includes('data-ag-cs-prism-cv')) return boxes.filter((b) => b.hasAttribute('data-ag-cs-prism-cv'));
      return [];
    },
    addEventListener: (t, fn) => docBus.add(t, fn),
    removeEventListener: (t, fn) => docBus.remove(t, fn),
  };

  const sb = {
    document: fakeDoc,
    devicePixelRatio: 1,
    performance: env.performance,
    requestAnimationFrame: env.requestAnimationFrame,
    cancelAnimationFrame: env.cancelAnimationFrame,
    setTimeout: env.setTimeout,
    clearTimeout: env.clearTimeout,
    getComputedStyle: () => ({ borderTopLeftRadius: '10px' }),
    Set, Map, Array, Math, Number, String, Boolean,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);

  const ctl = sb.__agPrismRimCanvas.createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'follow',
    canMountRealCanvas: () => true,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });

  // 1) Hover near box1: box1 allocates & paints; untouched box2 stays 0x0 (no default 300x150 waste)
  ctl.onPointerMove({ clientX: 200, clientY: 140 });
  env.flushRafs(20);
  const cv1 = box1.firstElementChild;
  const cv2 = box2.firstElementChild;
  assert.ok(cv1 && cv2);
  assert.equal(cv1.width, 302);
  assert.equal(cv1.height, 82);
  assert.equal(cv2.width, 0, 'Untouched inactive rim canvas must start at 0x0');
  assert.equal(cv2.height, 0);
  assert.equal(strokeCalls, 1);
  assert.equal(env.timers.size, 0, 'No idle shrink timer needed when no non-zero idle canvases exist');

  // 2) Move pointer to box2 (leaving box1 idle while keeping box2 active)
  ctl.onPointerMove({ clientX: 1000, clientY: 640 });
  env.flushRafs(20);
  assert.equal(cv2.width, 302);
  assert.equal(cv2.height, 82);
  assert.equal(cv1.width, 302, 'box1 clears immediately but waits for idle delay before shrinking');
  assert.equal(env.timers.size, 1, 'Idle shrink timer must be armed for cleared box1');
  const [{ ms: idleDelay }] = [...env.timers.values()];
  assert.ok(idleDelay >= 1500 && idleDelay <= 2000, `Idle shrink delay must be in 1500..2000ms, got ${idleDelay}`);

  // 3) Advance past idle delay: ONLY idle box1 shrinks to 0x0; active box2 stays lit & non-zero!
  env.advanceTimers(idleDelay + 50);
  assert.equal(cv1.width, 0, 'Idle cleared box1 must shrink to 0x0 after idle delay');
  assert.equal(cv1.height, 0);
  assert.equal(cv2.width, 302, 'Active lit box2 must NOT shrink while hovered');
  assert.equal(cv2.height, 82);

  // 4) Pointer re-enters box1 before timer on box2 expires -> box1 seamlessly restores size & repaints
  const strokesBeforeReenter = strokeCalls;
  ctl.onPointerMove({ clientX: 220, clientY: 150 });
  env.flushRafs(20);
  assert.equal(cv1.width, 302, 'Re-entering box1 must restore width on demand');
  assert.equal(cv1.height, 82);
  assert.equal(strokeCalls, strokesBeforeReenter + 1);

  // 5) Pointer leaves document -> clears active box1 and shrinks both to 0x0 after idle delay
  rootBus.dispatch('pointerleave');
  env.flushRafs(20);
  assert.equal(env.timers.size, 1);
  env.advanceTimers(idleDelay + 50);
  assert.equal(cv1.width, 0);
  assert.equal(cv1.height, 0);
  assert.equal(cv2.width, 0);
  assert.equal(cv2.height, 0);

  // 6) Activate box1 again, then document.hidden = true -> immediate 0x0 shrink + stop rAF
  ctl.onPointerMove({ clientX: 210, clientY: 145 });
  env.flushRafs(20);
  assert.equal(cv1.width, 302);
  // Queue another pending rAF before hiding to verify cancelPendingRaf
  ctl.onPointerMove({ clientX: 230, clientY: 145 });
  assert.equal(env.rafs.size, 1);

  fakeDoc.hidden = true;
  docBus.dispatch('visibilitychange');
  assert.equal(env.rafs.size, 0, 'Hidden document must cancel pending rim rAF');
  assert.equal(env.timers.size, 0, 'Hidden document must cancel idle timer');
  assert.equal(cv1.width, 0, 'Hidden document must immediately shrink active rim canvas to 0x0');
  assert.equal(cv1.height, 0);

  // Hidden operations at 0x0 must not throw or reallocate
  assert.doesNotThrow(() => {
    ctl.onPointerMove({ clientX: 240, clientY: 150 });
    ctl.invalidateMetrics();
  });
  assert.equal(cv1.width, 0);
  assert.equal(env.rafs.size, 0);

  // Restore visibility -> schedules redraw rAF and seamlessly restores box1 (pointer still in range)
  const strokesBeforeVisRestore = strokeCalls;
  fakeDoc.hidden = false;
  docBus.dispatch('visibilitychange');
  assert.equal(env.rafs.size, 1, 'Visibility restore with in-range pointer must schedule redraw rAF');
  env.flushRafs(20);
  assert.equal(cv1.width, 302);
  assert.equal(cv1.height, 82);
  assert.equal(strokeCalls, strokesBeforeVisRestore + 1);

  // 7) Teardown clears pending idle timer, rAF, and document listeners with zero leaks
  ctl.onPointerMove({ clientX: 5000, clientY: 5000 }); // move far away (> maxRange=280) -> arms idle timer
  env.flushRafs(20);
  assert.equal(env.timers.size, 1, 'Idle timer pending before teardown');
  ctl.teardown();
  assert.equal(env.timers.size, 0, 'teardown() must clear pending idle timer (zero leak)');
  assert.equal(env.rafs.size, 0, 'teardown() must cancel pending rAF');
  assert.equal(docBus.count('visibilitychange'), 0, 'teardown() must unbind visibilitychange');
  assert.equal(rootBus.count('pointerleave'), 0, 'teardown() must unbind pointerleave');
  assert.equal(cv1.width, 0);
  assert.equal(cv1.height, 0);
});
