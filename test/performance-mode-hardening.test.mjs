import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const domBusMod = require(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'));
const rippleCore = require(path.join(ROOT, 'ripple-core.js'));
const cssFlatten = require(path.join(ROOT, 'src', 'compiler', 'css-flatten.cjs'));
const cssPack = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));

function makeClock(startNow = 1000) {
  let now = startNow;
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
      const delay = Math.max(0, Number(ms) || 0);
      timers.set(id, { fn, ms: delay, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) {
      const id = seq++;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) { rafs.delete(id); },
    advance(deltaMs, tickMs = 16.5) {
      const end = now + deltaMs;
      while (now < end) {
        let nextTimer = null;
        for (const [id, t] of timers.entries()) {
          if (t.due <= end && (!nextTimer || t.due < nextTimer.t.due)) nextTimer = { id, t };
        }
        const nextRafTime = rafs.size > 0 ? Math.min(end, now + tickMs) : Infinity;
        if (nextTimer && nextTimer.t.due <= nextRafTime) {
          now = nextTimer.t.due;
          timers.delete(nextTimer.id);
          nextTimer.t.fn();
        } else if (nextRafTime < Infinity) {
          now = nextRafTime;
          const list = [...rafs.entries()];
          rafs.clear();
          for (const [, fn] of list) fn(now);
        } else {
          now = end;
        }
      }
    },
  };
}

function makeBus() {
  const m = new Map();
  return {
    add(t, fn) { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(fn); },
    remove(t, fn) { m.get(t)?.delete(fn); },
    dispatch(t, ev = {}) { for (const fn of [...(m.get(t) || [])]) fn(ev); },
  };
}

function createSpy2dContext(counters) {
  return {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: false,
    clearRect() { counters.clearRect += 1; },
    fillRect() { counters.fillRect += 1; },
    fillText() { counters.fillText += 1; },
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    roundRect() {},
    rect() {},
    clip() {},
    fill() { counters.fill += 1; },
    stroke() { counters.stroke += 1; },
    save() {},
    restore() {},
    translate() {},
    scale() {},
    setTransform() {},
    drawImage() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createImageData(w, h) {
      counters.createImageData += 1;
      return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) };
    },
    getImageData(_x, _y, w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) };
    },
    putImageData() { counters.putImageData += 1; },
  };
}

function makeFakeEl(tag, docRef, opts = {}) {
  const attrs = new Map();
  const bus = makeBus();
  const kids = [];
  const cls = new Set(String(opts.className || '').split(/\s+/).filter(Boolean));
  const counters2d = opts.counters2d || { createImageData: 0, putImageData: 0, fillRect: 0, fillText: 0, clearRect: 0, fill: 0, stroke: 0 };
  let ctx2dCache = null;

  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    dataset: {},
    width: tag === 'canvas' ? (opts.cw ?? 300) : undefined,
    height: tag === 'canvas' ? (opts.ch ?? 150) : undefined,
    clientWidth: opts.w ?? 1200,
    clientHeight: opts.h ?? 720,
    hidden: false,
    isConnected: true,
    parentNode: null,
    parentElement: null,
    ownerDocument: docRef,
    children: kids,
    style: {
      setProperty(k, v) { this[k] = String(v); },
      removeProperty(k) { delete this[k]; },
      getPropertyValue(k) { return this[k] || ''; },
    },
    classList: {
      add(...a) { a.forEach((c) => c && cls.add(c)); },
      remove(...a) { a.forEach((c) => cls.delete(c)); },
      contains: (c) => cls.has(c),
    },
    get className() { return Array.from(cls).join(' '); },
    set className(v) { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
    get firstChild() { return kids[0] || null; },
    get firstElementChild() { return kids[0] || null; },
    get nextElementSibling() {
      const p = el.parentElement;
      if (!p) return null;
      const i = p.children.indexOf(el);
      return i >= 0 ? p.children[i + 1] || null : null;
    },
    setAttribute(k, v) {
      const s = String(v);
      attrs.set(k, s);
      if (k === 'data-ag-cs-perf-mode') el.dataset.agCsPerfMode = s;
      if (k === 'class') el.className = s;
    },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) {
      attrs.delete(k);
      if (k === 'data-ag-cs-perf-mode') delete el.dataset.agCsPerfMode;
    },
    appendChild(c) { c.parentNode = c.parentElement = el; c.isConnected = true; kids.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = c.parentElement = el;
      c.isConnected = true;
      const idx = ref ? kids.indexOf(ref) : -1;
      if (idx >= 0) kids.splice(idx, 0, c);
      else kids.push(c);
      return c;
    },
    replaceChild(n, o) {
      const idx = kids.indexOf(o);
      if (idx >= 0) { kids[idx] = n; o.parentNode = o.parentElement = null; o.isConnected = false; }
      else kids.push(n);
      n.parentNode = n.parentElement = el;
      n.isConnected = true;
      return o;
    },
    replaceWith(n) { if (el.parentNode) el.parentNode.replaceChild(n, el); },
    remove() {
      if (el.parentNode) {
        const idx = el.parentNode.children.indexOf(el);
        if (idx >= 0) el.parentNode.children.splice(idx, 1);
      }
      el.parentNode = el.parentElement = null;
      el.isConnected = false;
    },
    addEventListener(t, fn) { bus.add(t, fn); },
    removeEventListener(t, fn) { bus.remove(t, fn); },
    dispatch(t, ev = {}) { bus.dispatch(t, ev); },
    getBoundingClientRect() {
      return opts.rect || { left: 0, top: 0, width: el.clientWidth || 1200, height: el.clientHeight || 720, right: el.clientWidth || 1200, bottom: el.clientHeight || 720 };
    },
    matches(sel) {
      if (!sel) return false;
      return sel.split(',').some((raw) => {
        const s = raw.trim();
        if (!s) return false;
        if (s.startsWith('.')) return cls.has(s.slice(1));
        const m = s.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
        if (m) return el.hasAttribute(m[1]) && (m[2] === undefined || el.getAttribute(m[1]) === m[2]);
        return el.tagName === s.toUpperCase();
      });
    },
    closest(sel) {
      let cur = el;
      while (cur) {
        if (cur.matches?.(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    contains(target) {
      let cur = target;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (c.matches?.(sel)) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    getContext(type) {
      if (typeof opts.getContext === 'function') return opts.getContext(type, el);
      if (type === '2d') {
        if (!ctx2dCache) ctx2dCache = createSpy2dContext(counters2d);
        return ctx2dCache;
      }
      return null;
    },
    _counters2d: counters2d,
  };
  return el;
}

// ── Bug 1: 60Hz VSync (16.5ms) 拍频不掉半帧成 30fps；120/240/300Hz 稳锁 <=60fps；balanced/quality 满血不变 ──
test('Bug 1: 60Hz VSync (16.5ms) never beats down to 30fps in performance mode while 120/240/300Hz cap <=60fps and balanced/quality stay uncapped', () => {
  // 1) dom-bus 档位节流表
  assert.equal(domBusMod.PERF_CAPS_TABLE.performance.minFrameGapMs, 14.5, 'dom-bus performance minFrameGapMs 必须留 VSync 安全余量 14.5ms');
  assert.equal(domBusMod.PERF_CAPS_TABLE.balanced.minFrameGapMs, 0, 'balanced 必须保持 0ms 无节流');
  assert.equal(domBusMod.PERF_CAPS_TABLE.quality.minFrameGapMs, 0, 'quality 必须保持 0ms 无节流');

  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
  const hostSrc = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
  const auraSrc = fs.readFileSync(path.join(ROOT, 'conv-aura.js'), 'utf8');

  // 2) ripple-worker 渲染循环采用 g * 0.88 安全余量，且对外 getPerfMinGapMs 保留 16.67 / 0 语义
  assert.ok(workerSrc.includes('n-lD<g*.88'), 'ripple-worker 内部 rAF 节流必须应用 0.88 VSync 安全余量');

  // 3) home-ripple-host 在 60Hz (16.5ms)、120Hz、240Hz、300Hz 下实测帧率
  {
    const clock = makeClock(1000);
    const docBus = makeBus();
    const winBus = makeBus();
    const mos = [];
    const doc = { hidden: false };
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-perf-mode', 'performance');
    const body = makeFakeEl('body', doc);
    const home = makeFakeEl('div', doc, { className: 'agy-home', w: 1280, h: 720 });
    html.appendChild(body);
    body.appendChild(home);
    doc.documentElement = html;
    doc.body = body;
    doc.createElement = (t) => makeFakeEl(t, doc);
    doc.querySelector = (s) => (s === '.agy-home' ? home : null);
    doc.querySelectorAll = () => [];
    doc.addEventListener = (t, fn) => docBus.add(t, fn);
    doc.removeEventListener = (t, fn) => docBus.remove(t, fn);

    const sb = {
      document: doc,
      devicePixelRatio: 2,
      performance: clock.performance,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { constructor(cb) { this.cb = cb; mos.push(this); } observe() {} disconnect() {} },
      addEventListener: (t, fn) => winBus.add(t, fn),
      removeEventListener: (t, fn) => winBus.remove(t, fn),
      Math, Number, String, Boolean, Array, Object, Map, Set,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(workerSrc, sb);
    vm.runInNewContext(hostSrc, sb);

    assert.equal(sb.__agPrismRippleWorker.getPerfMinGapMs(doc), 16.67);
    let fieldDraws = 0;
    const mockRc = {
      RIPPLE: { cellWidth: 18, cellHeight: 24 },
      parseCssColorToRgb: () => [200, 210, 220],
      createWaveField: () => ({ active: () => true, disturb() {}, advance() {}, skimmer() {} }),
      createGlyphField: () => ({
        mode: 'webgl2',
        resize() {},
        invalidate() {},
        draw() { fieldDraws += 1; },
        needsDraw: () => true,
        busy: () => true,
        setCalmZones() {},
        releaseBackingStore() {},
        dispose() {},
      }),
      mountBrandHorizonGlow: () => ({
        mode: 'webgl2',
        resize() {},
        invalidate() {},
        draw() {},
        clear() {},
        releaseBackingStore() {},
        dispose() {},
      }),
    };

    const ctl = sb.__agPrismHomeRippleHost.createHomeRippleController({
      rippleCore: mockRc,
      isDestroyed: () => false,
      isAllowed: () => true,
      isConvAllowed: () => false,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    });
    ctl.sync();
    // 60Hz 实测 VSync 16.5ms：绝不掉成 30fps！
    const d0 = fieldDraws;
    clock.advance(1000, 16.5);
    const fps60 = fieldDraws - d0;
    assert.ok(fps60 >= 55 && fps60 <= 62, `home-ripple-host performance 档 60Hz (16.5ms) 应保持 ~60fps 而非掉半帧 30fps，实测 ${fps60}`);

    // 120Hz (8.33ms) / 240Hz (4.17ms) / 300Hz (3.33ms)：稳锁 60fps 档
    for (const [hz, dt] of [[120, 8.333], [240, 4.167], [300, 3.333]]) {
      const before = fieldDraws;
      clock.advance(1000, dt);
      const fps = fieldDraws - before;
      assert.ok(fps >= 45 && fps <= 62, `home-ripple-host performance 档 ${hz}Hz 应稳锁 ~60fps，实测 ${fps}`);
    }

    // balanced / quality 档在 240Hz 下满血无节流
    for (const mode of ['balanced', 'quality']) {
      html.setAttribute('data-ag-cs-perf-mode', mode);
      assert.equal(sb.__agPrismRippleWorker.getPerfMinGapMs(doc), 0);
      const before = fieldDraws;
      clock.advance(1000, 4.167);
      const fps = fieldDraws - before;
      assert.ok(fps >= 200, `home-ripple-host ${mode} 档 240Hz 必须满血不变，实测 ${fps}`);
    }
    ctl.unmount();
  }

  // 4) conv-aura 在 60Hz (16.5ms) 不跳帧成 30fps，300Hz 仍 <=60fps
  {
    const clock = makeClock(1000);
    const doc = { hidden: false, hasFocus: () => true };
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-perf-mode', 'performance');
    const seat = makeFakeEl('div', doc, { w: 900, h: 600 });
    const convView = makeFakeEl('div', doc, { w: 900, h: 600 });
    convView.setAttribute('data-testid', 'conversation-view');
    const stopBtn = makeFakeEl('button', doc);
    stopBtn.setAttribute('data-testid', 'stop-button');
    seat.appendChild(convView);
    convView.appendChild(stopBtn);
    doc.documentElement = html;
    doc.createElement = (t) => makeFakeEl(t, doc);
    doc.querySelector = () => null;
    doc.querySelectorAll = (sel) => (sel.includes('conversation-view') ? [convView] : sel.includes('stop-button') ? [stopBtn] : []);
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    const sb = {
      document: doc,
      devicePixelRatio: 2,
      performance: clock.performance,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
      addEventListener() {},
      removeEventListener() {},
      WeakSet, Set, Map, Array, Object, Math, Number, String, Boolean, Date,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(workerSrc, sb);
    vm.runInNewContext(auraSrc, sb);

    let glowDraws = 0;
    const ctl = sb.__agPrismConvAura.createConvAuraController({
      isDestroyed: () => false,
      isHomeRippleEnabled: () => true,
      isMotionStandardOrUltra: () => true,
      isDarkTheme: () => true,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      getSpectrumMode: () => 'default',
      isWindowFocused: () => true,
      rippleCore: {
        resolveHorizonDpr: (raw, sc) => Math.min(raw, 2) * sc,
        mountBrandHorizonGlow: (cv) => ({
          mode: 'webgl2',
          resize(w, h, dpr) { cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr)); },
          releaseBackingStore() { cv.width = cv.height = 0; },
          invalidate() {},
          clear() {},
          draw() { glowDraws += 1; },
          drawStaticSnapshot() { glowDraws += 1; },
          dispose() {},
        }),
      },
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
    });
    ctl.sync();

    const d60 = glowDraws;
    clock.advance(1000, 16.5);
    const fps60 = glowDraws - d60;
    assert.ok(fps60 >= 55 && fps60 <= 62, `conv-aura performance 档 60Hz (16.5ms) 应保持 ~60fps 而非掉半帧 30fps，实测 ${fps60}`);

    const d300 = glowDraws;
    clock.advance(1000, 3.333);
    const fps300 = glowDraws - d300;
    assert.ok(fps300 <= 60 && fps300 >= 50, `conv-aura performance 档 300Hz 应封顶 <=60fps，实测 ${fps300}`);
    ctl.unmount();
  }
});

// ── Bug 2: 热切 performanceMode 立刻触发 optics / ripple / aura / rim 重同步 + CdpClient.cs 无 domBus 兜底 ──
test('Bug 2: hot-switching performanceMode immediately syncs ripple/aura/rim/optics without restart and CdpClient.cs has no-domBus fallback', () => {
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  const domBusSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'), 'utf8');
  const i18nCoreSrc = fs.readFileSync(path.join(ROOT, 'i18n-core.js'), 'utf8');
  const clock = makeClock(1000);
  const lsMap = new Map();
  const doc = { hidden: false, readyState: 'complete', hasFocus: () => true };
  const html = makeFakeEl('html', doc);
  const head = makeFakeEl('head', doc);
  const body = makeFakeEl('body', doc, { className: 'theme-dark' });
  html.appendChild(head);
  html.appendChild(body);
  doc.documentElement = html;
  doc.head = head;
  doc.body = body;
  doc.createElement = (t) => makeFakeEl(t, doc);
  doc.getElementById = (id) => html.querySelector(`#${id}`);
  doc.querySelector = (s) => html.querySelector(s);
  doc.querySelectorAll = (s) => html.querySelectorAll(s);
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};

  const calls = { rippleSync: 0, rippleRefresh: 0, auraSync: 0, auraRefresh: 0, rimInvalidate: 0, caretBump: 0 };
  const sb = {
    document: doc,
    devicePixelRatio: 2,
    performance: clock.performance,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: {
      getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
      setItem: (k, v) => lsMap.set(k, String(v)),
      removeItem: (k) => lsMap.delete(k),
    },
    navigator: { language: 'en-US', deviceMemory: 16, hardwareConcurrency: 16 },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} disconnect() {} },
    WeakSet, WeakMap, Set, Map, Array, Object, Math, Number, String, Boolean, Date, JSON, RegExp, Promise, Error,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(domBusSrc, sb);
  vm.runInNewContext(i18nCoreSrc, sb);
  sb.__agPrismHomeRippleHost = {
    createHomeRippleController: () => ({
      sync() { calls.rippleSync += 1; },
      park() {},
      unmount() {},
      refreshTheme() { calls.rippleRefresh += 1; },
      triggerLiftoffBurst() {},
      triggerTideSwell() {},
      getMount: () => null,
    }),
  };
  sb.__agPrismConvAura = {
    createConvAuraController: () => ({
      prime() {},
      sync() { calls.auraSync += 1; },
      park() {},
      unmount() {},
      refreshTheme() { calls.auraRefresh += 1; },
      triggerStart() {},
      triggerLiftoffEbb() {},
      advancePhase: () => 'off',
      getInstance: () => null,
    }),
  };
  sb.__agPrismRimCanvas = {
    createPrismRimCanvasController: () => ({
      onPointerMove() {},
      cancelPendingRaf() {},
      pauseForOverlay() {},
      teardown() {},
      markDirty() {},
      invalidateMetrics() { calls.rimInvalidate += 1; },
      mountNewBoxes() {},
      rescanNow() {},
      getLastPointerPos: () => ({ x: -9999, y: -9999 }),
    }),
  };
  sb.__agPrismSmoothCaret = {
    createSmoothCaretController: () => ({
      measureSnapshot: () => [],
      applyMutations() {},
      sync() {},
      queue() {},
      teardown() {},
      bumpMetricsEpoch() { calls.caretBump += 1; },
    }),
  };
  vm.runInNewContext(uiSrc, sb);
  sb.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, performanceMode: 'balanced', language: 'en', codeHash: cdp.resolveCurrentBundleCodeHash() });
  assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'balanced');

  // 热切 balanced -> performance（设置面板 saveSettingsBatch 路径）
  const snap1 = { ...calls };
  sb.__agPrism.saveSettingsBatch({ performanceMode: 'performance' });
  assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'performance');
  assert.ok(calls.rippleSync > snap1.rippleSync, '热切 performance 必须立即触发 rippleCtl.sync()');
  assert.ok(calls.rippleRefresh > snap1.rippleRefresh, '热切 performance 必须立即触发 rippleCtl.refreshTheme()');
  assert.ok(calls.auraSync > snap1.auraSync, '热切 performance 必须立即触发 convAuraCtl.sync()');
  assert.ok(calls.auraRefresh > snap1.auraRefresh, '热切 performance 必须立即触发 convAuraCtl.refreshTheme()');
  assert.ok(calls.rimInvalidate > snap1.rimInvalidate, '热切 performance 必须立即触发 prismRimCtl.invalidateMetrics()');
  assert.ok(calls.caretBump > snap1.caretBump, '热切 performance 必须立即触发 smoothCaretCtl.bumpMetricsEpoch()');

  // 热切回 balanced -> 同样立即重同步回血
  const snap2 = { ...calls };
  sb.__agPrism.saveSettingsBatch({ performanceMode: 'balanced' });
  assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'balanced');
  assert.ok(calls.rippleSync > snap2.rippleSync && calls.rippleRefresh > snap2.rippleRefresh);
  assert.ok(calls.auraSync > snap2.auraSync && calls.auraRefresh > snap2.auraRefresh);
  assert.ok(calls.rimInvalidate > snap2.rimInvalidate);

  // configRefresh 在无 domBus 时也能设置 data-ag-cs-perf-mode 且表达式 < 4,000 B
  delete sb.__agDomBus;
  delete sb.__agPrismDomBus;
  const refreshExpr = cdp.buildConfigRefreshExpression({ performanceMode: 'performance' });
  assert.ok(Buffer.byteLength(refreshExpr, 'utf8') < 4000, `configRefresh 体积必须 < 4,000 B，实测 ${Buffer.byteLength(refreshExpr, 'utf8')}`);
  const rr = vm.runInNewContext(refreshExpr, sb);
  assert.equal(rr.refreshed, true);
  assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'performance');
  sb.__agPrism.destroy();

  // SAFE BUILD (2026-11-27): native CdpClient.cs check removed (native installers are removed).
});

// ── Bug 3: performance/eco 档下 WebGL2 失败或 contextlost 严禁落 CPU 逐像素 2D 软渲染，优雅 0 CPU 静态停绘 ──
test('Bug 3: performance/eco blocks CPU 2D fallback on WebGL2 failure or contextlost across ripple-core, worker, host & conv-aura while balanced/quality keep 2D fallback', () => {
  // 1) ripple-core 直接验证
  for (const perfMode of ['performance', 'eco']) {
    const counters = { createImageData: 0, putImageData: 0, fillRect: 0, fillText: 0, clearRect: 0, fill: 0, stroke: 0 };
    const doc = { hidden: false };
    doc.createElement = (t) => makeFakeEl(t, doc, { counters2d: counters, getContext: (type) => (type === '2d' ? createSpy2dContext(counters) : null) });
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-perf-mode', perfMode);
    doc.documentElement = html;
    const cv = doc.createElement('canvas');
    const waves = rippleCore.createWaveField(10, 8);

    const field = rippleCore.createGlyphField(cv, 10, 8, waves, {});
    assert.equal(field.mode, 'none', `ripple-core createGlyphField 在 ${perfMode} 档 WebGL2 失败时必须返回 mode='none'`);
    const fieldPrefer2D = rippleCore.createGlyphField(cv, 10, 8, waves, { prefer2D: true });
    assert.equal(fieldPrefer2D.mode, 'none', `ripple-core createGlyphField 在 ${perfMode} 档 prefer2D 恢复时也严禁落入 CPU 2D`);

    const glow = rippleCore.mountBrandHorizonGlow(cv, { width: 640, height: 240 });
    assert.equal(glow.mode, 'none', `ripple-core mountBrandHorizonGlow 在 ${perfMode} 档 WebGL2 失败时必须返回 mode='none'`);
    const glowPrefer2D = rippleCore.mountBrandHorizonGlow(cv, { width: 640, height: 240, prefer2D: true });
    assert.equal(glowPrefer2D.mode, 'none', `ripple-core mountBrandHorizonGlow 在 ${perfMode} 档 prefer2D 恢复时也严禁落入 CPU 2D`);
    assert.equal(counters.putImageData, 0, `${perfMode} 档必须保持 0 putImageData`);
    assert.equal(counters.createImageData, 0, `${perfMode} 档必须保持 0 createImageData`);
  }

  // balanced / quality 保持原有 2D 优雅降级不变
  for (const richMode of ['balanced', 'quality']) {
    const counters = { createImageData: 0, putImageData: 0, fillRect: 0, fillText: 0, clearRect: 0, fill: 0, stroke: 0 };
    const doc = { hidden: false };
    doc.createElement = (t) => makeFakeEl(t, doc, { counters2d: counters, getContext: (type) => (type === '2d' ? createSpy2dContext(counters) : null) });
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-perf-mode', richMode);
    doc.documentElement = html;
    const cv = doc.createElement('canvas');
    const field = rippleCore.createGlyphField(cv, 8, 6, rippleCore.createWaveField(8, 6), {});
    const glow = rippleCore.mountBrandHorizonGlow(cv, { width: 320, height: 120 });
    assert.equal(field.mode, '2d', `${richMode} 档 WebGL2 失败仍需保持 2D 优雅降级`);
    assert.equal(glow.mode, '2d', `${richMode} 档 glow WebGL2 失败仍需保持 2D 优雅降级`);
    field.dispose();
    glow.dispose();
  }

  // 1b) ripple-worker mountManagedField / mountManagedGlow 在 performance 档拒绝二次强降 2D
  {
    const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
    const counters = { createImageData: 0, putImageData: 0, fillRect: 0, fillText: 0, clearRect: 0, fill: 0, stroke: 0 };
    const doc = { hidden: false };
    doc.createElement = (t) => makeFakeEl(t, doc, { counters2d: counters, getContext: (type) => (type === '2d' ? createSpy2dContext(counters) : null) });
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-perf-mode', 'performance');
    doc.documentElement = html;
    const sb = { document: doc, Math, Number, String, Boolean, Array, Object, Map, Set };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(workerSrc, sb);
    let cv = doc.createElement('canvas');
    let swaps = 0;
    const sw = () => { swaps += 1; cv = doc.createElement('canvas'); return cv; };
    const mf = sb.__agPrismRippleWorker.mountManagedField({
      getCanvas: () => cv, swapCanvas: sw, cols: 8, rows: 6, dpr: 1, waves: rippleCore.createWaveField(8, 6),
      rippleCore, doc, prefer2D: false, allowWorker: false,
    });
    const mg = sb.__agPrismRippleWorker.mountManagedGlow({
      getCanvas: () => cv, swapCanvas: sw, rippleCore, doc, prefer2D: false, allowWorker: false,
    });
    assert.equal(mf.mode, 'none', 'ripple-worker mountManagedField 在 performance 档必须保持 mode=none');
    assert.equal(mg.mode, 'none', 'ripple-worker mountManagedGlow 在 performance 档必须保持 mode=none');
    assert.equal(swaps, 0, 'performance 档 WebGL2 失败后严禁再 swapCanvas 强降 2D');
  }

  // 2) home-ripple-host + 真实 ripple-core：WebGL2 失败 -> 0 CPU 静态停绘；热切 balanced <-> performance 自动淘汰/恢复 2D
  {
    const hostSrc = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
    const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
    const coreSrc = fs.readFileSync(path.join(ROOT, 'ripple-core.js'), 'utf8');
    const clock = makeClock(1000);
    const counters = { createImageData: 0, putImageData: 0, fillRect: 0, fillText: 0, clearRect: 0, fill: 0, stroke: 0 };
    const doc = { hidden: false };
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-perf-mode', 'performance');
    const body = makeFakeEl('body', doc);
    const home = makeFakeEl('div', doc, { className: 'agy-home', w: 800, h: 600 });
    html.appendChild(body);
    body.appendChild(home);
    doc.documentElement = html;
    doc.body = body;
    doc.createElement = (t) => makeFakeEl(t, doc, { counters2d: counters, getContext: (type) => (type === '2d' ? createSpy2dContext(counters) : null) });
    doc.querySelector = (s) => (s === '.agy-home' ? home : null);
    doc.querySelectorAll = () => [];
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    const sb = {
      document: doc,
      devicePixelRatio: 2,
      performance: clock.performance,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
      addEventListener() {},
      removeEventListener() {},
      Math, Number, String, Boolean, Array, Object, Map, Set, Float32Array, Uint8Array, Uint8ClampedArray, Uint32Array,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(coreSrc, sb);
    vm.runInNewContext(workerSrc, sb);
    vm.runInNewContext(hostSrc, sb);

    const ctl = sb.__agPrismHomeRippleHost.createHomeRippleController({
      rippleCore: sb.__agCsRippleCore,
      isDestroyed: () => false,
      isAllowed: () => true,
      isConvAllowed: () => false,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    });
    ctl.sync();
    clock.advance(100, 16);
    const m = ctl.getMount();
    assert.equal(m.field.mode, 'none', 'home-ripple-host performance 档 WebGL2 不可用必须保持 field.mode=none');
    assert.equal(m.glow.mode, 'none', 'home-ripple-host performance 档 WebGL2 不可用必须保持 glow.mode=none');
    assert.equal(m.canvas.style.display, 'none', '无渲染器时 field canvas 必须隐藏');
    assert.equal(m.glowCanvas.style.display, 'none', '无渲染器时 glow canvas 必须隐藏');
    assert.equal(m.sleeping, true, '无渲染器时必须立即进入 0fps 休眠');
    assert.equal(clock.rafs.size, 0, '休眠后必须 0 待执行 rAF');
    assert.equal(counters.putImageData, 0, 'performance 档全程 0 putImageData');

    // 热切到 balanced -> 恢复 2D 优雅降级；再热切回 performance -> 立即丢弃 2D 回归 0 CPU 静态
    html.setAttribute('data-ag-cs-perf-mode', 'balanced');
    ctl.refreshTheme();
    assert.equal(m.field.mode, '2d');
    assert.equal(m.glow.mode, '2d');

    html.setAttribute('data-ag-cs-perf-mode', 'performance');
    ctl.refreshTheme();
    assert.equal(m.field.mode, 'none');
    assert.equal(m.glow.mode, 'none');
    assert.equal(m.sleeping, true);
    assert.equal(clock.rafs.size, 0);
    ctl.unmount();

    // 2b) performance 档下 WebGL2 初次成功但随后连续 2 次 webglcontextlost -> 严禁落 2D，直接 0fps 停绘
    let lostF = null, lostG = null;
    const lostRc = {
      ...sb.__agCsRippleCore,
      createGlyphField(cv, cols, rows, waves, opts) {
        if (opts?.prefer2D) return sb.__agCsRippleCore.createGlyphField(cv, cols, rows, waves, opts);
        lostF = opts?.onContextLost || null;
        return { mode: 'webgl2', resize() {}, invalidate() {}, draw() {}, needsDraw: () => false, busy: () => false, setCalmZones() {}, releaseBackingStore() {}, dispose() {} };
      },
      mountBrandHorizonGlow(cv, opts) {
        if (opts?.prefer2D) return sb.__agCsRippleCore.mountBrandHorizonGlow(cv, opts);
        lostG = opts?.onContextLost || null;
        return { mode: 'webgl2', resize() {}, invalidate() {}, draw() {}, clear() {}, releaseBackingStore() {}, dispose() {} };
      },
    };
    const ctlLost = sb.__agPrismHomeRippleHost.createHomeRippleController({
      rippleCore: lostRc,
      isDestroyed: () => false,
      isAllowed: () => true,
      isConvAllowed: () => false,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    });
    ctlLost.sync();
    assert.equal(ctlLost.getMount().field.mode, 'webgl2');
    lostF?.(); lostG?.();
    clock.advance(40, 16);
    lostF?.(); lostG?.();
    clock.advance(40, 16);
    assert.equal(ctlLost.getMount().field.mode, 'none', 'performance 档连续 contextlost 绝不可降级 CPU 2D');
    assert.equal(ctlLost.getMount().glow.mode, 'none', 'performance 档 glow 连续 contextlost 绝不可降级 CPU 2D');
    assert.equal(ctlLost.getMount().sleeping, true);
    assert.equal(clock.rafs.size, 0);
    ctlLost.unmount();
  }

  // 3) conv-aura + 真实 ripple-core：performance 档 WebGL2 失败直接停绘 0fps；balanced 档正常 2D
  {
    const auraSrc = fs.readFileSync(path.join(ROOT, 'conv-aura.js'), 'utf8');
    const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
    const coreSrc = fs.readFileSync(path.join(ROOT, 'ripple-core.js'), 'utf8');
    const clock = makeClock(1000);
    const counters = { createImageData: 0, putImageData: 0, fillRect: 0, fillText: 0, clearRect: 0, fill: 0, stroke: 0 };
    const doc = { hidden: false, hasFocus: () => true };
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-perf-mode', 'performance');
    const seat = makeFakeEl('div', doc, { w: 800, h: 600 });
    const convView = makeFakeEl('div', doc, { w: 800, h: 600 });
    convView.setAttribute('data-testid', 'conversation-view');
    const stopBtn = makeFakeEl('button', doc);
    stopBtn.setAttribute('data-testid', 'stop-button');
    seat.appendChild(convView);
    convView.appendChild(stopBtn);
    doc.documentElement = html;
    doc.createElement = (t) => makeFakeEl(t, doc, { counters2d: counters, getContext: (type) => (type === '2d' ? createSpy2dContext(counters) : null) });
    doc.querySelector = () => null;
    doc.querySelectorAll = (sel) => (sel.includes('conversation-view') ? [convView] : sel.includes('stop-button') ? [stopBtn] : []);
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    const sb = {
      document: doc,
      devicePixelRatio: 2,
      performance: clock.performance,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
      addEventListener() {},
      removeEventListener() {},
      WeakSet, Set, Map, Array, Object, Math, Number, String, Boolean, Date, Float32Array, Uint8Array, Uint8ClampedArray, Uint32Array,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(coreSrc, sb);
    vm.runInNewContext(workerSrc, sb);
    vm.runInNewContext(auraSrc, sb);

    const ctl = sb.__agPrismConvAura.createConvAuraController({
      isDestroyed: () => false,
      isHomeRippleEnabled: () => true,
      isMotionStandardOrUltra: () => true,
      isDarkTheme: () => true,
      getMinFrameGapMs: () => 0,
      getAmbientIntensity: () => 1,
      getSpectrumMode: () => 'default',
      isWindowFocused: () => true,
      rippleCore: sb.__agCsRippleCore,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
    });
    ctl.sync();
    clock.advance(200, 16);
    const inst = ctl.getInstance();
    assert.equal(inst.glow.mode, 'none', 'conv-aura performance 档 WebGL2 不可用必须保持 glow.mode=none');
    assert.equal(inst.canvas.style.display, 'none');
    assert.equal(inst.sleeping, true);
    assert.equal(clock.rafs.size, 0);
    assert.equal(clock.timers.size, 0);
    assert.equal(counters.putImageData, 0);
    ctl.unmount();
  }
});

// ── Bug 4: performance 档专属漏网降载（prism-rim-canvas 停绘归零、dual-mascot-rig DPR<=1、style.css 聚焦降载），0 影响 balanced/quality ──
test('Bug 4: performance-only drains disable prism-rim-canvas, cap dual-mascot-rig DPR to 1, and scope style.css decorations while leaving balanced/quality intact', () => {
  // 1) prism-rim-canvas：balanced/quality 正常绘制；performance/eco 立即停绘归零释放；切回 balanced 恢复
  {
    const rimSrc = fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8');
    const clock = makeClock(1000);
    const doc = { hidden: false };
    const html = makeFakeEl('html', doc);
    html.setAttribute('data-ag-cs-ambient', '1');
    html.setAttribute('data-ag-cs-motion', 'ultra');
    html.setAttribute('data-ag-cs-theme', 'dark');
    html.setAttribute('data-ag-cs-perf-mode', 'balanced');
    const box = makeFakeEl('div', doc, {
      className: 'surface-composer-card',
      rect: { left: 100, top: 100, width: 400, height: 80, right: 500, bottom: 180 },
    });
    box.setAttribute('data-ag-cs-prism-box', '1');
    const counters = { createImageData: 0, putImageData: 0, fillRect: 0, fillText: 0, clearRect: 0, fill: 0, stroke: 0 };
    doc.documentElement = html;
    doc.createElement = (t) => makeFakeEl(t, doc, { counters2d: counters });
    doc.getElementById = () => null;
    doc.querySelectorAll = (sel) => {
      if (sel.includes('data-ag-cs-prism-box')) return [box];
      if (sel.includes('ag-cs-prism-rim-cv')) return box.children.filter((c) => c.classList.contains('ag-cs-prism-rim-cv'));
      return [];
    };
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};

    const sb = {
      document: doc,
      devicePixelRatio: 2,
      performance: clock.performance,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      getComputedStyle: () => ({ borderRadius: '14px', getPropertyValue: () => '' }),
      addEventListener() {},
      removeEventListener() {},
      Math, Number, String, Boolean, Array, Object, Map, Set,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(rimSrc, sb);

    const ctl = sb.__agPrismRimCanvas.createPrismRimCanvasController({
      isDestroyed: () => false,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getAmbientIntensity: () => 1,
      canMountRealCanvas: () => true,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
    });
    ctl.onPointerMove({ clientX: 220, clientY: 140, target: box });
    clock.advance(40, 16);
    const cv = box.querySelector('.ag-cs-prism-rim-cv');
    assert.ok(cv && cv.width > 0 && cv.height > 0, 'balanced 档必须完整绘制指针跟随棱镜 Canvas');
    assert.ok(counters.stroke > 0 || counters.fill > 0, 'balanced 档必须实际绘制棱镜光晕');

    // 切入 performance -> invalidateMetrics 立即停绘归零释放
    html.setAttribute('data-ag-cs-perf-mode', 'performance');
    ctl.invalidateMetrics();
    assert.equal(cv.width, 0, 'performance 档必须将棱镜 Canvas 宽度归零释放');
    assert.equal(cv.height, 0, 'performance 档必须将棱镜 Canvas 高度归零释放');
    const drawsAtPerf = counters.stroke + counters.fill;
    ctl.onPointerMove({ clientX: 260, clientY: 140, target: box });
    clock.advance(80, 16);
    assert.equal(counters.stroke + counters.fill, drawsAtPerf, 'performance 档移动指针严格 0 棱镜重绘');
    assert.equal(clock.rafs.size, 0, 'performance 档移动指针严格 0 rAF 调度');

    // 切回 quality -> 完整恢复指针跟随棱镜
    html.setAttribute('data-ag-cs-perf-mode', 'quality');
    ctl.invalidateMetrics();
    ctl.onPointerMove({ clientX: 280, clientY: 140, target: box });
    clock.advance(40, 16);
    assert.ok(cv.width > 0 && cv.height > 0, '切回 quality 档必须恢复棱镜 Canvas');
    assert.ok(counters.stroke + counters.fill > drawsAtPerf, '切回 quality 档必须恢复棱镜绘制');
    ctl.teardown();
  }

  // 2) dual-mascot-rig：2x 高分屏下 performance 封顶 DPR=1 (96x84)，balanced/quality 保持 DPR=2 (192x168)，热切同步缩放
  {
    const rigSrc = fs.readFileSync(path.join(ROOT, 'dual-mascot-rig.js'), 'utf8');
    const mountAt = (perfMode) => {
      const clock = makeClock(1000);
      const mos = [];
      const doc = { hidden: false };
      const html = makeFakeEl('html', doc);
      html.setAttribute('data-ag-cs-perf-mode', perfMode);
      const body = makeFakeEl('body', doc);
      const host = makeFakeEl('div', doc, { w: 480, h: 120 });
      html.appendChild(body);
      body.appendChild(host);
      doc.documentElement = html;
      doc.body = body;
      doc.createElement = (t) => makeFakeEl(t, doc);
      doc.querySelector = () => null;
      doc.querySelectorAll = () => [];
      doc.addEventListener = () => {};
      doc.removeEventListener = () => {};

      const sb = {
        document: doc,
        devicePixelRatio: 2,
        performance: clock.performance,
        requestAnimationFrame: clock.requestAnimationFrame,
        cancelAnimationFrame: clock.cancelAnimationFrame,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        addEventListener() {},
        removeEventListener() {},
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
        MutationObserver: class { constructor(cb) { this.cb = cb; mos.push(this); } observe() {} disconnect() {} },
        ResizeObserver: class { observe() {} disconnect() {} },
        Math, Number, String, Boolean, Array, Object, Map, Set, WeakMap, WeakSet, Date, encodeURIComponent,
      };
      sb.window = sb;
      sb.globalThis = sb;
      doc.defaultView = sb;
      vm.runInNewContext(rigSrc, sb);
      const rig = sb.__agDualMascotRig.mountDualMascotStage(host, { mode: 'crab' });
      const actorCvs = host.querySelectorAll('canvas').filter((c) => c.width > 0);
      return { rig, html, mos, actorCvs };
    };

    const perf = mountAt('performance');
    assert.ok(perf.actorCvs.length >= 2);
    assert.equal(perf.actorCvs[0].width, 96, 'performance 档 2x 屏主宠 Canvas 宽度必须锁 DPR=1 (96)');
    assert.equal(perf.actorCvs[0].height, 84, 'performance 档 2x 屏主宠 Canvas 高度必须锁 DPR=1 (84)');
    perf.rig.dispose();

    for (const mode of ['balanced', 'quality']) {
      const rich = mountAt(mode);
      assert.equal(rich.actorCvs[0].width, 192, `${mode} 档 2x 屏主宠 Canvas 必须保持 DPR=2 (192)`);
      assert.equal(rich.actorCvs[0].height, 168, `${mode} 档 2x 屏主宠 Canvas 必须保持 DPR=2 (168)`);
      // 热切到 performance -> 通过属性监听自动降载 DPR 至 1
      rich.html.setAttribute('data-ag-cs-perf-mode', 'performance');
      for (const mo of rich.mos) mo.cb([{ type: 'attributes', attributeName: 'data-ag-cs-perf-mode', target: rich.html }]);
      assert.equal(rich.actorCvs[0].width, 96, `${mode} -> performance 热切必须实时将主宠 Canvas 降至 96`);
      assert.equal(rich.actorCvs[0].height, 84, `${mode} -> performance 热切必须实时将主宠 Canvas 降至 84`);
      rich.rig.dispose();
    }
  }

  // 3) style.css 扁平化产物精准校验：仅在 performance 作用域关纯装饰模糊/滚动合成/流光，保留加载状态语义且 0 影响默认档
  {
    const rawCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
    const flatCss = cssPack.minifyCss(cssFlatten.flattenNestedCss(cssPack.minifyCss(rawCss)));
    assert.ok(flatCss.includes('html[data-ag-cs-style][data-ag-cs-perf-mode="performance"] [data-testid="conversation-view"]::before{animation:none!important;animation-timeline:auto!important;opacity:0!important}'));
    assert.ok(flatCss.includes('html[data-ag-cs-style][data-ag-cs-perf-mode="performance"] :is(.ag-cs-model-glyph,[data-ag-cs-sonar="1"]){filter:none!important;animation:none!important}'));
    assert.ok(flatCss.includes('html[data-ag-cs-style][data-ag-cs-perf-mode="performance"] .ag-cs-liftoff-veil{display:none!important}'));
    assert.ok(flatCss.includes('html[data-ag-cs-style][data-ag-cs-perf-mode="performance"] :is([data-ag-overview-running="1"],[data-ag-sp-running="1"],[data-ag-cs-caustic="1"],[data-ag-cs-fiber-camp])::after{animation:none!important}'));

    // 聚焦态 performance 规则不得隐藏或暂停状态加载环语义
    const perfLine = rawCss.split('\n')[625]; // style.css line 626
    assert.equal(perfLine.includes('status-loading-spinner'), false, '聚焦态 performance 规则必须保留加载环状态语义可见');
    assert.equal(perfLine.includes('input-cancel-button'), false, '聚焦态 performance 规则必须保留停止按钮语义可见');

    // 默认 balanced/quality 的 @supports 滚动驱动顶栏与 model-glyph 规则完好未破坏
    assert.ok(rawCss.includes('@supports (animation-timeline:scroll()){html[data-ag-cs-style] [data-testid="conversation-view"]::before{opacity:0;animation:ag-cs-top-fade linear both;animation-timeline:scroll(nearest block);animation-range:0px 28px}}'));
  }
});
