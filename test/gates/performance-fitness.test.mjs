import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..');

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
    flushRafs(stepMs = 16) {
      now += stepMs;
      const list = [...rafs.entries()];
      rafs.clear();
      for (const [, fn] of list) fn(now);
      return list.length;
    },
    advance(deltaMs, tickMs = 16) {
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
    count(t) { return (m.get(t) || new Set()).size; },
  };
}

function createTrackingWebGL2() {
  const stats = {
    createProgram: 0,
    deleteProgram: 0,
    compileShader: 0,
    texStorage2D: 0,
    texImage2D: 0,
    texSubImage2D: 0,
    drawArrays: 0,
    loseContext: 0,
    lost: false,
    shaderSources: [],
  };
  const gl = {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, FLOAT: 0x1406, COLOR_BUFFER_BIT: 0x4000,
    TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005, TEXTURE_2D: 0x0de1, TEXTURE0: 0x84c0, TEXTURE1: 0x84c1,
    RGBA: 0x1908, RGBA8: 0x8058, UNSIGNED_BYTE: 0x1401, NEAREST: 0x2600, LINEAR: 0x2601, CLAMP_TO_EDGE: 0x812f,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    isContextLost: () => stats.lost,
    createShader: (type) => ({ type }),
    shaderSource: (_s, src) => { stats.shaderSources.push(src); },
    compileShader: () => { stats.compileShader += 1; },
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader() {},
    createProgram: () => { stats.createProgram += 1; return { id: stats.createProgram }; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram() {},
    deleteProgram: () => { stats.deleteProgram += 1; },
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {},
    deleteBuffer() {},
    getAttribLocation: () => 0,
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getUniformLocation: (_p, n) => ({ n }),
    createTexture: () => ({}),
    deleteTexture() {},
    activeTexture() {},
    bindTexture() {},
    texParameteri() {},
    texStorage2D: () => { stats.texStorage2D += 1; },
    texImage2D: () => { stats.texImage2D += 1; },
    texSubImage2D: () => { stats.texSubImage2D += 1; },
    viewport() {},
    clearColor() {},
    clear() {},
    uniform1i() {},
    uniform1f() {},
    uniform2f() {},
    uniform3f() {},
    uniform4f() {},
    uniform1fv() {},
    uniform2fv() {},
    uniform3fv() {},
    uniform4fv() {},
    drawArrays: () => { stats.drawArrays += 1; },
    getExtension: (n) => (n === 'WEBGL_lose_context' ? { loseContext() { stats.loseContext += 1; } } : null),
  };
  return { gl, stats };
}

function makeFakeElement(tag, docRef, opts = {}) {
  const attrs = new Map();
  const bus = makeBus();
  const kids = [];
  let ctxCache = null;
  let glTracker = null;
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    className: '',
    dataset: {},
    width: tag === 'canvas' ? 300 : undefined,
    height: tag === 'canvas' ? 150 : undefined,
    clientWidth: opts.w ?? 1200,
    clientHeight: opts.h ?? 720,
    hidden: false,
    isConnected: true,
    parentNode: null,
    parentElement: null,
    ownerDocument: docRef,
    children: kids,
    style: { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } },
    get firstChild() { return kids[0] || null; },
    setAttribute(k, v) {
      attrs.set(k, String(v));
      if (k === 'data-ag-cs-perf-mode') el.dataset.agCsPerfMode = String(v);
    },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) {
      attrs.delete(k);
      if (k === 'data-ag-cs-perf-mode') delete el.dataset.agCsPerfMode;
    },
    appendChild(c) { c.parentNode = c.parentElement = el; c.isConnected = true; kids.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = c.parentElement = el; c.isConnected = true;
      const idx = ref ? kids.indexOf(ref) : -1;
      if (idx >= 0) kids.splice(idx, 0, c); else kids.unshift(c);
      return c;
    },
    replaceChild(next, old) {
      const idx = kids.indexOf(old);
      if (idx >= 0) kids.splice(idx, 1, next); else kids.push(next);
      old.parentNode = old.parentElement = null; old.isConnected = false;
      next.parentNode = next.parentElement = el; next.isConnected = true;
      return old;
    },
    replaceWith(next) { if (el.parentNode) el.parentNode.replaceChild(next, el); },
    remove() {
      if (el.parentNode) {
        const i = el.parentNode.children.indexOf(el);
        if (i >= 0) el.parentNode.children.splice(i, 1);
        el.parentNode = el.parentElement = null;
      }
      el.isConnected = false;
    },
    matches: (sel) => Boolean(el.getAttribute('data-testid') && sel.includes(`"${el.getAttribute('data-testid')}"`)),
    closest: () => null,
    contains: (other) => { let c = other; while (c) { if (c === el) return true; c = c.parentNode; } return false; },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (t, fn) => bus.add(t, fn),
    removeEventListener: (t, fn) => bus.remove(t, fn),
    dispatch: (t, ev = {}) => bus.dispatch(t, { preventDefault() {}, ...ev }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }),
    getContext(kind, ctxOpts) {
      if (tag !== 'canvas') return null;
      if (opts.onGetContext) opts.onGetContext(el, kind, ctxOpts);
      if (kind === 'webgl2') {
        if (opts.failWebGL2) return null;
        if (!glTracker) glTracker = createTrackingWebGL2();
        el._glStats = glTracker.stats;
        return glTracker.gl;
      }
      if (kind === '2d') {
        if (!ctxCache) {
          ctxCache = {
            font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
            save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {}, fillText() {},
            beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
            translate() {}, rotate() {}, ellipse() {}, arc() {}, roundRect() {}, clip() {},
            drawImage() { el._drawImageCalls = (el._drawImageCalls || 0) + 1; },
            createLinearGradient: () => ({ addColorStop() {} }),
            createRadialGradient: () => ({ addColorStop() {} }),
            getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
            createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
            putImageData() {},
          };
        }
        return ctxCache;
      }
      return null;
    },
  };
  return el;
}

// ── 1 & 2: Issue #97 主页闪烁修复 + 原地 resize 不销毁重建 WebGL2 + 0fps 休眠 ──
test('Performance Fitness 1 & 2: home-ripple-host 120ms resize debounce, in-place WebGL2 resize (0 program rebuild), sync wake(true) anti-flicker, and strict 0fps sleep', () => {
  const rippleCoreSrc = fs.readFileSync(path.join(ROOT, 'ripple-core.js'), 'utf8');
  const hostSrc = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
  const clock = makeClock(1000);
  const docBus = makeBus();
  const winBus = makeBus();
  let roCb = null;
  const mos = [];

  const doc = { hidden: false };
  const html = makeFakeElement('html', doc);
  html.setAttribute('data-ag-cs-palette', 'obsidian');
  html.setAttribute('data-ag-cs-ambient', '1');
  const body = makeFakeElement('body', doc);
  const home = makeFakeElement('div', doc, { w: 1200, h: 720 });
  doc.documentElement = html;
  doc.body = body;
  doc.createElement = (tag) => makeFakeElement(tag, doc);
  doc.querySelector = (sel) => (sel === '.agy-home' ? home : null);
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
    ResizeObserver: class { constructor(cb) { roCb = cb; } observe() {} disconnect() {} },
    MutationObserver: class { constructor(cb) { this.cb = cb; mos.push(this); } observe() {} disconnect() {} },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    Float32Array, Uint8Array, Uint32Array, Uint8ClampedArray, Map, Set, WeakMap, WeakSet,
    Math, Number, String, Boolean, Array, Object, Date, Promise, RegExp, Error,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(workerSrc, sb);
  vm.runInNewContext(rippleCoreSrc, sb);
  vm.runInNewContext(hostSrc, sb);

  const ctl = sb.__agPrismHomeRippleHost.createHomeRippleController({
    rippleCore: sb.__agCsRippleCore,
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
  clock.flushRafs(16);
  const m = ctl.getMount();
  assert.equal(m.field.mode, 'webgl2');
  assert.equal(m.glow.mode, 'webgl2');
  // balanced 默认档（2x DPR）: ripple 封顶 1.5x, glow 低 DPR (<=1.25)
  assert.equal(m.dpr, 1.5, 'balanced perf mode must cap ripple DPR at 1.5 on 2x screen');
  const fieldGl = m.canvas._glStats;
  const glowGl = m.glowCanvas._glStats;
  assert.equal(fieldGl.createProgram, 1);
  assert.equal(fieldGl.texImage2D, 1, 'GlyphAtlas uploaded once');
  const initFieldDraws = fieldGl.drawArrays;
  const initGlowDraws = glowGl.drawArrays;
  assert.ok(initFieldDraws >= 1 && initGlowDraws >= 1);

  // Issue #97 核心验证：侧边栏打开设置 data-ag-cs-resizing="1"，连续 20 帧宽度变化期间 0 重建、0 尺寸重设、0 闪烁
  html.setAttribute('data-ag-cs-resizing', '1');
  const widthBeforeDrag = m.canvas.width;
  const drawsBeforeDrag = fieldGl.drawArrays;
  for (let i = 1; i <= 20; i++) {
    clock.now += 16;
    home.clientWidth = 1200 - i * 16;
    roCb([]);
  }
  assert.equal(m.canvas.width, widthBeforeDrag, 'During data-ag-cs-resizing="1", canvas backing buffer must stay intact for CSS stretch');
  assert.equal(fieldGl.deleteProgram, 0, 'Must NEVER dispose WebGL2 program during sidebar resize');
  assert.equal(fieldGl.createProgram, 1, 'Must NEVER recreate WebGL2 program during sidebar resize');

  // 释放 resizing，120ms 防抖到期 -> 原地 resize + 同帧同步 wake(true) 绘制（无需等下一次 rAF！）
  html.removeAttribute('data-ag-cs-resizing');
  const fieldDrawsPreFlush = fieldGl.drawArrays;
  const glowDrawsPreFlush = glowGl.drawArrays;
  clock.advance(125, 16);
  assert.equal(m.width, 880, 'Final settled width applied once after 120ms debounce');
  assert.equal(fieldGl.createProgram, 1, 'In-place resize must reuse WebGL2 program (0 recompile)');
  assert.equal(fieldGl.deleteProgram, 0, 'In-place resize must not delete WebGL2 program');
  assert.equal(fieldGl.texImage2D, 1, 'In-place resize at unchanged DPR must reuse GlyphAtlas (0 re-upload)');
  assert.ok(fieldGl.drawArrays > fieldDrawsPreFlush, 'Sync wake(true) must repaint glyph field in same frame after canvas.width reset (anti-#97 flicker)');
  assert.ok(glowGl.drawArrays > glowDrawsPreFlush, 'Sync wake(true) must repaint brand glow in same frame after resize');

  // 严格 0fps 休眠：隐藏 / 失焦 / 周期表开启 / 静置 >1200ms
  clock.advance(1800, 32);
  assert.equal(m.sleeping, true, 'Idle home ripple must settle to 0fps sleep after intro');
  assert.equal(clock.rafs.size, 0, '0 rAF scheduled in idle sleep');
  assert.equal(clock.timers.size, 0, '0 timers scheduled in idle sleep');

  // 模拟窗口失焦 -> 0fps
  m.onMove({ clientX: 200, clientY: 200 });
  assert.equal(clock.rafs.size, 1);
  winBus.dispatch('blur');
  assert.equal(m.sleeping, true);
  assert.equal(clock.rafs.size, 0, 'window.blur must immediately cancel rAF to 0fps');

  // 周期表打开 -> 0fps
  winBus.dispatch('focus');
  html.setAttribute('data-ag-pp-open', '1');
  for (const mo of mos) mo.cb([]);
  assert.equal(m.sleeping, true);
  assert.equal(clock.rafs.size, 0, 'data-ag-pp-open="1" must enforce 0fps sleep');

  // document.hidden -> 0x0 VRAM 回收 + 0fps
  html.removeAttribute('data-ag-pp-open');
  doc.hidden = true;
  docBus.dispatch('visibilitychange');
  assert.equal(m.canvas.width, 0);
  assert.equal(m.glowCanvas.width, 0);
  assert.equal(clock.rafs.size, 0);

  ctl.unmount();
  assert.equal(clock.rafs.size, 0);
  assert.equal(clock.timers.size, 0);
});

// ── 3: conv-aura PR #102 native VSync + performance 60fps 封顶 + Issue #97 同步重绘 + swapCv 自愈 ──
test('Performance Fitness 3: conv-aura native VSync pacing (~53-60fps), performance <=60fps cap, sync resize repaint, and webglcontextlost swapCv recovery', () => {
  const convAuraSrc = fs.readFileSync(path.join(ROOT, 'conv-aura.js'), 'utf8');
  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
  const clock = makeClock(1000);
  const docBus = makeBus();
  const winBus = makeBus();
  let roCb = null;

  const doc = { hidden: false, hasFocus: () => true };
  const html = makeFakeElement('html', doc);
  const seat = makeFakeElement('div', doc, { w: 900, h: 600 });
  const convView = makeFakeElement('div', doc, { w: 900, h: 600 });
  convView.setAttribute('data-testid', 'conversation-view');
  const stopBtn = makeFakeElement('button', doc);
  stopBtn.setAttribute('data-testid', 'stop-button');
  seat.appendChild(convView);
  convView.appendChild(stopBtn);

  doc.documentElement = html;
  doc.createElement = (tag) => makeFakeElement(tag, doc);
  doc.querySelector = () => null;
  doc.querySelectorAll = (sel) => {
    if (sel.includes('conversation-view')) return [convView];
    if (sel.includes('stop-button')) return [stopBtn];
    return [];
  };
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
    ResizeObserver: class { constructor(cb) { roCb = cb; } observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    WeakSet, Set, Map, Array, Object, Math, Number, String, Boolean, Date, Promise,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(workerSrc, sb);
  vm.runInNewContext(convAuraSrc, sb);

  let glowDraws = 0;
  let lastLostCb = null;
  const mountedCanvases = [];
  const mountedModes = [];
  const mockRippleCore = {
    resolveHorizonDpr: (raw, sc) => Math.min(raw, 2) * sc,
    mountBrandHorizonGlow(cv, opts) {
      mountedCanvases.push(cv);
      const mode = opts?.prefer2D ? '2d' : 'webgl2';
      mountedModes.push(mode);
      lastLostCb = opts?.onContextLost || null;
      return {
        mode,
        resize(w, h, dpr) { cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr)); },
        releaseBackingStore() { cv.width = cv.height = 0; },
        invalidate() {},
        clear() {},
        draw() { glowDraws += 1; },
        drawStaticSnapshot() { glowDraws += 1; },
        dispose() {},
      };
    },
  };

  const ctl = sb.__agPrismConvAura.createConvAuraController({
    isDestroyed: () => false,
    isHomeRippleEnabled: () => true,
    isMotionStandardOrUltra: () => true,
    isDarkTheme: () => true,
    getMinFrameGapMs: () => 0, // targetFps: 'native'
    getAmbientIntensity: () => 1,
    getSpectrumMode: () => 'default',
    isWindowFocused: () => true,
    rippleCore: mockRippleCore,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });

  ctl.sync();
  const inst = ctl.getInstance();
  assert.equal(inst.phase, 'running');

  // 1) PR #102 native 160Hz (6.25ms/tick) VSync pacing: ~53.4fps (NOT ~26fps setTimeout!)
  const drawsBefore160 = glowDraws;
  clock.advance(1000, 6.25);
  const fps160 = glowDraws - drawsBefore160;
  assert.ok(fps160 >= 50 && fps160 <= 64, `PR #102 native 160Hz VSync expected 50..64 fps, got ${fps160}`);

  // 2) performance 档位下软封顶 <= 60fps
  html.setAttribute('data-ag-cs-perf-mode', 'performance');
  const drawsBeforePerf = glowDraws;
  clock.advance(1000, 3.333); // 300Hz
  const fpsPerf = glowDraws - drawsBeforePerf;
  assert.ok(fpsPerf <= 60, `performance mode must soft-cap FPS <= 60 on 300Hz, got ${fpsPerf}`);

  // 3) Issue #97: 单次缩放 & 120ms 防抖结算均同步 wake(true) 立即重绘（不留 1 帧透明微闪！）
  clock.now += 500;
  const drawsPreSingleResize = glowDraws;
  roCb([{ contentRect: { width: 760, height: 600 } }]);
  assert.equal(glowDraws, drawsPreSingleResize + 1, 'Single resize must synchronously repaint via wake(true) without waiting next rAF');

  html.setAttribute('data-ag-cs-resizing', '1');
  for (let i = 1; i <= 5; i++) {
    clock.now += 16;
    roCb([{ contentRect: { width: 760 - i * 20, height: 600 } }]);
  }
  html.removeAttribute('data-ag-cs-resizing');
  const drawsPreDebounceFlush = glowDraws;
  // 仅触发 120ms timer，不手动 flush rAF -> 必须已同步重绘！
  const nextDue = Math.min(...[...clock.timers.values()].map((t) => t.due));
  clock.now = nextDue;
  for (const [id, t] of [...clock.timers.entries()]) {
    if (t.due <= clock.now) { clock.timers.delete(id); t.fn(); }
  }
  assert.ok(glowDraws > drawsPreDebounceFlush, 'flushPendingResize must synchronously paint via wake(true) to eliminate 1-frame flicker');

  // 4) webglcontextlost -> swapCv() 替换画布并自愈（第 2 次降级 2D）
  const firstCanvas = inst.canvas;
  assert.equal(typeof lastLostCb, 'function');
  lastLostCb();
  clock.advance(40, 16);
  assert.notEqual(inst.canvas, firstCanvas, 'onContextLost must replace canvas via swapCv()');
  assert.equal(mountedCanvases.length, 2);
  // 再次 lost -> 第 2 次恢复降级 2D
  lastLostCb();
  clock.advance(40, 16);
  assert.equal(mountedModes[mountedModes.length - 1], '2d', 'Repeated context loss must degrade safely to 2D');

  ctl.unmount();
  assert.equal(clock.rafs.size, 0);
  assert.equal(clock.timers.size, 0);
});

// ── 4: ripple-worker 1x1 探针通过、120ms 超时/CSP 失败、webglcontextlost 回退、0fps/0 IPC 与 0 泄漏 ──
test('Performance Fitness 4: ripple-worker 1x1 probe cache, 120ms timeout & CSP fallback, webglcontextlost swapCv recovery, 0 postMessage sleep, perf modes & disposeAll 0 leak', async () => {
  const workerSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'ripple-worker.js'), 'utf8');
  const rippleCore = require(path.join(ROOT, 'ripple-core.js'));

  function makeWorkerHarness({ mode = 'ok' } = {}) {
    let createdWorkers = 0;
    let terminatedWorkers = 0;
    let revokedUrls = 0;
    let urlSeq = 1;
    const workers = [];
    const doc = {
      hidden: false,
      documentElement: {
        dataset: {},
        _attrs: new Map(),
        setAttribute(k, v) { this._attrs.set(k, String(v)); if (k === 'data-ag-cs-perf-mode') this.dataset.agCsPerfMode = String(v); },
        getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
        removeAttribute(k) { this._attrs.delete(k); if (k === 'data-ag-cs-perf-mode') delete this.dataset.agCsPerfMode; },
      },
    };
    class MockOffscreenCanvas {
      constructor(w, h) { this.width = w; this.height = h; }
    }
    class MockWorker {
      constructor(url) {
        if (mode === 'csp-throw') throw new Error('SecurityError: CSP blocked blob: worker');
        this.url = url;
        this.terminated = false;
        this.sent = [];
        this.onmessage = null;
        this.onerror = null;
        createdWorkers += 1;
        workers.push(this);
      }
      postMessage(msg) {
        this.sent.push(msg);
        if (msg.type === 'probe') {
          if (mode === 'ok') {
            queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { type: 'probe', ok: true, reason: 'ok' } }); });
          } else if (mode === 'webgl-null') {
            queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { type: 'probe', ok: false, reason: 'webgl2-null' } }); });
          }
          // mode === 'timeout': intentionally never replies
        } else if (msg.type === 'init') {
          if (mode === 'ok') {
            queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: { type: 'ready' } }); });
          }
        }
      }
      terminate() {
        if (!this.terminated) { this.terminated = true; terminatedWorkers += 1; }
      }
    }
    const sb = {
      document: doc,
      OffscreenCanvas: MockOffscreenCanvas,
      Worker: MockWorker,
      Blob: class { constructor(parts) { this.parts = parts; } },
      URL: {
        createObjectURL: () => `blob:prism-${urlSeq++}`,
        revokeObjectURL: () => { revokedUrls += 1; },
      },
      setTimeout, clearTimeout, queueMicrotask, Promise, Math, Number, String, Boolean, Array, Object, Date, Set, Map, Error,
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(workerSrc, sb);
    return {
      api: sb.__agPrismRippleWorker,
      doc,
      workers,
      getCounts: () => ({ createdWorkers, terminatedWorkers, revokedUrls }),
    };
  }

  // 4a) 1x1 探针通过、缓存复用、transferControlToOffscreen 挂载、休眠 0 postMessage IPC 与 webglcontextlost 回退
  {
    const h = makeWorkerHarness({ mode: 'ok' });
    const p1 = await h.api.probeWorkerWebGL2({ timeoutMs: 80 });
    assert.equal(p1.ok, true);
    assert.equal(h.api.getActiveWorkerCount(), 0, 'Probe worker must terminate immediately after probe');
    const p2 = await h.api.probeWorkerWebGL2({ timeoutMs: 80 });
    assert.equal(p2.ok, true);
    assert.equal(h.getCounts().createdWorkers, 1, 'Probe result must be globally cached (no duplicate probe worker)');

    let transferred = 0;
    let fallbackReasons = [];
    const cv = {
      ownerDocument: h.doc,
      transferControlToOffscreen() { transferred += 1; return { width: 10, height: 10 }; },
    };
    const sess = h.api.mountGlowWorker(cv, {
      rippleCore, doc: h.doc, width: 600, height: 200, dpr: 1,
      onFallback: (r) => fallbackReasons.push(r),
    });
    assert.ok(sess && sess.mode === 'worker-webgl2');
    assert.equal(transferred, 1);
    assert.equal(h.api.getActiveWorkerCount(), 1);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sess.getStats().ready, true);

    // 休眠后严格 0 postMessage IPC
    sess.setPaused(true);
    h.doc.hidden = true;
    const msgsAtSleep = sess.getStats().postMessageCount;
    for (let i = 0; i < 10; i++) sess.draw(1000 + i * 16, { dark: true, strength: 1 });
    assert.equal(sess.getStats().postMessageCount, msgsAtSleep, 'Hidden/paused worker must send 0 postMessage IPC');
    h.doc.hidden = false;

    // 模拟 Worker 内 webglcontextlost -> 立即终止 Worker 并触发 onFallback（供宿主 swapCv() 切回主线程）
    const activeW = h.workers[h.workers.length - 1];
    activeW.onmessage({ data: { type: 'contextlost' } });
    assert.equal(activeW.terminated, true, 'webglcontextlost must immediately terminate worker');
    assert.equal(h.api.getActiveWorkerCount(), 0, '0 zombie workers after contextlost');
    assert.deepEqual(fallbackReasons, ['contextlost']);
    assert.equal(sess.isContextLost(), true);
  }

  // 4b) 探针 120ms 超时保护 + 0 泄漏
  {
    const h = makeWorkerHarness({ mode: 'timeout' });
    const t0 = Date.now();
    const res = await h.api.probeWorkerWebGL2({ timeoutMs: 40 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'timeout');
    assert.ok(Date.now() - t0 >= 30);
    assert.equal(h.api.getActiveWorkerCount(), 0, 'Timed-out probe worker must be terminated');
    assert.equal(h.getCounts().terminatedWorkers, 1);
    assert.equal(h.getCounts().revokedUrls, 1);
  }

  // 4c) CSP 拦截 blob: 构造抛 SecurityError -> 零未捕获异常 + 自动回退 + 0 泄漏
  {
    const h = makeWorkerHarness({ mode: 'csp-throw' });
    const fallbacks = [];
    const cv = { transferControlToOffscreen() { throw new Error('must not transfer before probe succeeds'); } };
    const sess = await h.api.mountGlowWorkerWithProbe(cv, { rippleCore, onFallback: (r) => fallbacks.push(r) });
    assert.equal(sess, null);
    assert.equal(fallbacks.length, 1);
    assert.equal(h.api.getActiveWorkerCount(), 0);
    assert.equal(h.getCounts().revokedUrls, 1, 'CSP failure must still revoke Blob URL');
  }

  // 4d) disposeAll() 彻底终止所有活跃 Worker + 三档性能模式校验
  {
    const h = makeWorkerHarness({ mode: 'ok' });
    await h.api.probeWorkerWebGL2();
    const mkCv = () => ({ ownerDocument: h.doc, transferControlToOffscreen: () => ({ width: 1, height: 1 }) });
    const s1 = h.api.mountGlowWorker(mkCv(), { rippleCore, doc: h.doc });
    const s2 = h.api.mountGlowWorker(mkCv(), { rippleCore, doc: h.doc });
    assert.ok(s1 && s2 && h.api.getActiveWorkerCount() === 2);
    h.api.disposeAll();
    assert.equal(h.api.getActiveWorkerCount(), 0, 'disposeAll() must terminate all workers with 0 leaks');

    // balanced / performance / quality 策略核验
    assert.equal(h.api.getPerfMode(h.doc), 'balanced');
    assert.equal(h.api.resolveRippleDpr(2, h.doc), 1.5);
    assert.ok(h.api.resolveGlowDpr(1, h.doc) === 0.7);
    h.doc.documentElement.setAttribute('data-ag-cs-perf-mode', 'performance');
    assert.equal(h.api.resolveRippleDpr(2, h.doc), 1.0);
    assert.equal(h.api.resolveGlowDpr(1, h.doc), 0.55);
    assert.ok(h.api.getPerfMinGapMs(h.doc) >= 16.6);
    h.doc.documentElement.setAttribute('data-ag-cs-perf-mode', 'quality');
    assert.equal(h.api.resolveRippleDpr(2, h.doc), 2.0);
    assert.equal(h.api.getPerfProfile(h.doc).msaa, true);
  }

  // 4e) 首屏探针超时调优（PROBE_TIMEOUT_MS >= 500, INIT_TIMEOUT_MS >= 800）+ timeout 首次允许延迟重试 1 次（最多 1 次）
  {
    const h = makeWorkerHarness({ mode: 'timeout' });
    assert.ok(h.api.PROBE_TIMEOUT_MS >= 500, `PROBE_TIMEOUT_MS must be >= 500 to avoid Ch1 startup false timeout (got ${h.api.PROBE_TIMEOUT_MS})`);
    assert.ok(h.api.INIT_TIMEOUT_MS >= 800, `INIT_TIMEOUT_MS must be >= 800 (got ${h.api.INIT_TIMEOUT_MS})`);

    const first = await h.api.probeWorkerWebGL2({ timeoutMs: 25, retryDelayMs: 20 });
    assert.equal(first.ok, false);
    assert.equal(first.reason, 'timeout');
    assert.equal(first.retryable, true, 'First timeout failure must allow one delayed retry');
    assert.equal(h.getCounts().createdWorkers, 1);

    // 冷却期内直接命中缓存不风暴重试
    const duringCooldown = await h.api.probeWorkerWebGL2({ timeoutMs: 25 });
    assert.equal(duringCooldown.ok, false);
    assert.equal(h.getCounts().createdWorkers, 1, 'Must not retry before retryDelayMs expires');

    // 冷却期过后自动允许第 2 次探针（且仅此 1 次重试）
    await new Promise((r) => setTimeout(r, 30));
    const second = await h.api.probeWorkerWebGL2({ timeoutMs: 25, retryDelayMs: 20 });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'timeout');
    assert.equal(second.retryable, false, 'Second consecutive timeout must permanently lock cache');
    assert.equal(h.getCounts().createdWorkers, 2);

    // 第 3 次调用绝不再建 Worker
    await new Promise((r) => setTimeout(r, 30));
    const third = await h.api.probeWorkerWebGL2({ timeoutMs: 25 });
    assert.equal(third.ok, false);
    assert.equal(h.getCounts().createdWorkers, 2, 'Must never exceed 1 retry after consecutive timeouts');
    assert.equal(h.api.getActiveWorkerCount(), 0);
  }

  // 4f) mountManagedGlow 同步抛错防双挂载孤儿上下文泄漏：transferControlToOffscreen 同步抛错时 mountBrandHorizonGlow 仅调用 1 次
  {
    const h = makeWorkerHarness({ mode: 'ok' });
    await h.api.probeWorkerWebGL2({ timeoutMs: 60 });

    let mountCalls = 0;
    let swapCalls = 0;
    let workerFailed = false;
    const createdInstances = [];
    const mkCanvas = (id, throwOnTransfer) => ({
      id,
      ownerDocument: h.doc,
      transferControlToOffscreen() {
        if (throwOnTransfer) throw new Error('InvalidStateError: transferControlToOffscreen failed synchronously');
        return { width: 1, height: 1 };
      },
    });
    let currentCanvas = mkCanvas('cv-0', true);
    const swapCanvas = () => {
      swapCalls += 1;
      currentCanvas = mkCanvas(`cv-${swapCalls}`, false);
      return currentCanvas;
    };
    const mockCore = {
      HORIZON_FRAGMENT_SHADER: rippleCore.HORIZON_FRAGMENT_SHADER,
      GLOW_VERT_SHADER: rippleCore.GLOW_VERT_SHADER,
      mountBrandHorizonGlow(cv, opts) {
        mountCalls += 1;
        const inst = { id: `glow-${mountCalls}`, canvas: cv, mode: opts?.prefer2D ? '2d' : 'webgl2', resize() {}, clear() {}, draw() {}, drawStaticSnapshot() {}, dispose() {} };
        createdInstances.push(inst);
        return inst;
      },
    };

    const state = { glow: null };
    function mountGlow(p2d, sw) {
      if (sw) { swapCanvas(); }
      const g = h.api.mountManagedGlow({
        getCanvas: () => currentCanvas,
        swapCanvas,
        rippleCore: mockCore,
        doc: h.doc,
        prefer2D: !!p2d,
        allowWorker: !workerFailed,
        onFallbackDone: () => {
          workerFailed = true;
          mountGlow(0, 1);
        },
      });
      state.glow = g;
      return g;
    }

    const returned = mountGlow(0, 0);
    assert.equal(workerFailed, true, 'Sync transfer failure must trigger onFallbackDone');
    assert.equal(swapCalls, 1, 'Canvas must be swapped once on sync fallback');
    assert.equal(mountCalls, 1, 'mountBrandHorizonGlow must be called strictly ONCE on sync throw (0 orphan glow context leak)');
    assert.equal(returned, createdInstances[0], 'Outer mountManagedGlow must return the unique inner fallback instance');
    assert.equal(state.glow, createdInstances[0], 'Host state.glow must retain the live fallback instance without clobbering');
    assert.equal(h.api.getActiveWorkerCount(), 0);
  }
});

// ── 5: ripple-core PR #103 + mediump/highp/ign | vial-core 双 Canvas 零 drawImage | crystal-prism-core DPR/MSAA ──
test('Performance Fitness 5: ripple-core fbm3/mediump/ign, vial-core layered zero-copy Canvas (0 drawImage), and crystal-prism-core MSAA/DPR caps', () => {
  // 5a) ripple-core shader 精度与 PR #103 fbm3 / early-out / halftone guard
  const rippleCore = require(path.join(ROOT, 'ripple-core.js'));
  const hFrag = rippleCore.HORIZON_FRAGMENT_SHADER;
  assert.ok(hFrag.includes('precision mediump float;'), 'HORIZON_FRAGMENT_SHADER must use precision mediump float');
  assert.ok(hFrag.includes('uniform highp vec2 uRes;') && hFrag.includes('float ign(highp vec2 p)'), 'Must preserve highp vec2 coords & ign() anti-banding dither');
  assert.ok(hFrag.includes('float fbm3(') && hFrag.includes('0.0625'), 'Must include PR #103 midpoint-preserving 3-octave fbm3');
  assert.ok(hFrag.includes('glow * topFeather < 0.0008'), 'Must include PR #103 transparent fragment early-out');
  assert.ok(hFrag.includes('dotMsk > 0.001 ? halftone('), 'Must guard halftone() with dotMsk > 0.001');

  const rawRipple = fs.readFileSync(path.join(ROOT, 'ripple-core.js'), 'utf8');
  assert.ok(rawRipple.includes('const FRAGMENT_SHADER = `#version 300 es\nprecision mediump float;'), 'ASCII FRAGMENT_SHADER must use precision mediump float');
  assert.ok(rawRipple.includes('uniform highp vec2 size;'), 'ASCII FRAGMENT_SHADER must keep highp vec2 coords');

  // 5b) vial-core 双叠层 Canvas：DOM 挂载态严格 0 次 ctx2d.drawImage(glCanvas) 跨上下文拷贝
  const vialCore = require(path.join(ROOT, 'vial-core.js'));
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const doc = { hidden: false };
  const html = makeFakeElement('html', doc);
  doc.documentElement = html;
  const created = [];
  doc.createElement = (tag) => { const n = makeFakeElement(tag, doc); created.push(n); return n; };
  globalThis.document = doc;
  globalThis.window = { devicePixelRatio: 2 };
  try {
    const slot = makeFakeElement('div', doc);
    const topCanvas = makeFakeElement('canvas', doc);
    slot.appendChild(topCanvas);
    const vial = vialCore.mountPhysicalWaterVial(topCanvas, {
      fill: 0.48,
      streaming: true,
      getState: () => ({ isDark: true, camp: 'gemini', critical: false, fill: 0.48, maxTokens: 512000, hoveredSlice: -1, streaming: true }),
    });
    assert.equal(vial.getDebugState().rendererMode, 'webgl2');
    assert.equal(vial.getDebugState().zeroCopy, true, 'Mounted vial must activate single-canvas zero-copy WebGL2');
    assert.equal(vial.getDebugState().singleCanvas, true, 'Mounted vial must restore single <canvas> architecture');
    assert.equal(slot.children.length, 1, 'Parent slot must contain strictly 1 <canvas> (scale marks composited via u_scaleTex)');

    for (let i = 0; i < 20; i++) vial.step(0.016);
    assert.equal(topCanvas._drawImageCalls || 0, 0, 'Single-canvas vial must execute strictly 0 ctx2d.drawImage(glCanvas) cross-context blits');
    assert.ok(topCanvas._glStats.drawArrays >= 20, 'WebGL2 canvas renders directly every frame');
    assert.ok(topCanvas._glStats.texImage2D >= 2, 'WebGL2 canvas must upload waveTex + static u_scaleTex overlay');

    // contextlost 自动退回 2D 不黑屏
    topCanvas.dispatch('webglcontextlost');
    vial.step(0.016);
    assert.equal(vial.getDebugState().rendererMode, '2d');

    vial.dispose();
    assert.equal(slot.children.length, 1, 'dispose() leaves original single <canvas> intact');
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin;
  }

  // 5c) crystal-prism-core 默认关闭冗余 MSAA（仅 quality 开启）且 DPR 封顶 <=1.5（performance <=1.0）
  const crystalCore = require(path.join(ROOT, 'crystal-prism-core.js'));
  const capturedGlOpts = [];
  const prevDoc2 = globalThis.document;
  const prevWin2 = globalThis.window;
  const doc2 = { hidden: false };
  const html2 = makeFakeElement('html', doc2);
  doc2.documentElement = html2;
  globalThis.document = doc2;
  globalThis.window = { devicePixelRatio: 3 };
  try {
    // 默认 balanced 档：antialias=false, DPR 封顶 1.5
    const cv1 = makeFakeElement('canvas', doc2, { w: 200, h: 28, onGetContext: (_el, k, o) => { if (k === 'webgl2') capturedGlOpts.push(o); } });
    const bar1 = crystalCore.mountCrystalPrismBar(cv1, { getState: () => ({ isDark: true, prismStrength: 1 }) });
    bar1.step(0.016);
    assert.equal(capturedGlOpts[0]?.antialias, false, 'Default balanced mode must disable redundant MSAA on crystal-prism-core');
    assert.equal(cv1.width, Math.round(200 * 1.5), 'Default balanced mode must cap crystal DPR at 1.5 on 3x screen');
    bar1.dispose();

    // performance 档：antialias=false, DPR 封顶 1.0
    html2.setAttribute('data-ag-cs-perf-mode', 'performance');
    const cv2 = makeFakeElement('canvas', doc2, { w: 200, h: 28, onGetContext: (_el, k, o) => { if (k === 'webgl2') capturedGlOpts.push(o); } });
    const bar2 = crystalCore.mountCrystalPrismBar(cv2, { getState: () => ({ isDark: true, prismStrength: 1 }) });
    bar2.step(0.016);
    assert.equal(capturedGlOpts[1]?.antialias, false);
    assert.equal(cv2.width, 200, 'performance mode must cap crystal DPR at 1.0 on 3x screen');
    bar2.dispose();

    // quality 档：仅此档允许开启 MSAA，DPR 仍封顶 <= 1.5
    html2.setAttribute('data-ag-cs-perf-mode', 'quality');
    const cv3 = makeFakeElement('canvas', doc2, { w: 200, h: 28, onGetContext: (_el, k, o) => { if (k === 'webgl2') capturedGlOpts.push(o); } });
    const bar3 = crystalCore.mountCrystalPrismBar(cv3, { getState: () => ({ isDark: true, prismStrength: 1 }) });
    bar3.step(0.016);
    assert.equal(capturedGlOpts[2]?.antialias, true, 'quality mode may enable MSAA');
    assert.equal(cv3.width, Math.round(200 * 1.5), 'crystal DPR remains capped <= 1.5');
    bar3.dispose();
  } finally {
    if (prevDoc2 === undefined) delete globalThis.document; else globalThis.document = prevDoc2;
    if (prevWin2 === undefined) delete globalThis.window; else globalThis.window = prevWin2;
  }
});

// ── 6: profile-live-perf.mjs CLI --help 冒烟 + 打包/同步/清理覆盖验证 ──
test('Performance Fitness 6: profile-live-perf CLI --help smoke, expression safety, and packaging/sync/teardown coverage of src/runtime/ripple-worker.js', async () => {
  // 6a) CLI --help 冒烟
  const helpOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'profile-live-perf.mjs'), '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.ok(helpOut.includes('profile-live-perf') && helpOut.includes('--duration') && helpOut.includes('Runtime.evaluate'));

  // 6b) 只读表达式在沙盒内可干净执行且无副作用
  const profMod = await import('../../scripts/profile-live-perf.mjs');
  const expr = profMod.buildPerfSampleExpression(500);
  const sample = await vm.runInNewContext(expr, {
    performance: { now: () => 1000, memory: { usedJSHeapSize: 104857600, totalJSHeapSize: 157286400, jsHeapSizeLimit: 2147483648 } },
    document: { hidden: false, documentElement: { dataset: { agCsPerfMode: 'balanced' }, getAttribute: () => 'standard' }, querySelector: () => null, querySelectorAll: () => [] },
    window: {},
    setTimeout, clearTimeout, Promise, Math, Number, String, Boolean, Array, Object, Date,
  });
  assert.equal(sample.dom.perfMode, 'balanced');
  assert.equal(sample.memory.usedJSHeapMB, 100);
  assert.ok(profMod.formatPerfReport({ ...sample, port: 9222, status: 'HEALTHY', warnings: [] }).includes('Live Performance Profile'));

  // 6c) Ch1 RUNTIME_PARTS、teardown.cjs、Windows/macOS/Linux 打包脚本与 repo-sync.cjs 全链路覆盖
  const cdp = require(path.join(ROOT, 'cdp.js'));
  assert.ok(cdp.RUNTIME_PARTS.includes('src/runtime/ripple-worker.js'), 'RUNTIME_PARTS must include src/runtime/ripple-worker.js');
  assert.ok(cdp.REMOVE_EXPRESSION.includes('__agPrismRippleWorker') && cdp.REMOVE_EXPRESSION.includes('disposeAll'), 'REMOVE_EXPRESSION must dispose and delete __agPrismRippleWorker');

  const { collectNativePluginEntries } = await import('../../scripts/build-common.mjs');
  const entries = new Set(collectNativePluginEntries(path.join(ROOT, 'config.example.json')).map((e) => e.name));
  assert.ok(entries.has('native-plugin/src/runtime/ripple-worker.js'), 'Win/macOS/Linux collectNativePluginEntries must auto-include src/runtime/ripple-worker.js');

  const { copyUpdatedRuntimeFromRepo } = require(path.join(ROOT, 'src', 'platform', 'repo-sync.cjs'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-sync-rw-'));
  try {
    copyUpdatedRuntimeFromRepo(ROOT, tmpDir);
    assert.equal(fs.existsSync(path.join(tmpDir, 'src', 'runtime', 'ripple-worker.js')), true, 'repo-sync.cjs must auto-sync src/runtime/ripple-worker.js');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── 7: ui-runtime homeStudio 缓存校对 usageCore 迟到自动销毁重建 ──
test('Performance Fitness 7: ui-runtime resolveHomeStudioCtl disposes and recreates homeStudio instance when usageCore arrives late', () => {
  const cdp = require(path.join(ROOT, 'cdp.js'));
  const uiMainFactory = require(path.join(ROOT, 'ui-runtime.js'));
  const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
  const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));

  const docBus = makeBus();
  const winBus = makeBus();
  const doc = { hidden: false, readyState: 'complete', title: 'Antigravity', hasFocus: () => true };
  const html = makeFakeElement('html', doc);
  const head = makeFakeElement('head', doc);
  const body = makeFakeElement('body', doc);
  html.appendChild(head);
  html.appendChild(body);
  doc.documentElement = html;
  doc.head = head;
  doc.body = body;
  doc.createElement = (tag) => makeFakeElement(tag, doc);
  doc.createElementNS = (_ns, tag) => makeFakeElement(tag, doc);
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.getElementById = () => null;
  doc.addEventListener = (t, fn) => docBus.add(t, fn);
  doc.removeEventListener = (t, fn) => docBus.remove(t, fn);

  const created = [];
  const disposed = [];
  const sb = {
    document: doc,
    location: { href: 'vscode-file://vscode-app/index.html', pathname: '/' },
    navigator: { language: 'zh-CN' },
    devicePixelRatio: 1,
    performance: { now: () => 1000 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    __agPrismI18nCore: i18nCore,
    __agPrismI18nLocales: i18nLocales,
    __agPrismHomeStudioPanel: {
      createHomeStudioPanelController(opts) {
        const id = created.length + 1;
        const rec = { id, usageCore: opts.usageCore };
        created.push(rec);
        return {
          sync() {},
          wasHero: () => false,
          getScopeKey: () => 'local',
          getUsageRecordsCount: () => (opts.usageCore ? 42 : 0),
          hasConnectedPanel: () => Boolean(opts.usageCore),
          dispose() { disposed.push(id); },
        };
      },
    },
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON, Proxy, Error,
  };
  sb.window = sb;
  sb.globalThis = sb;

  vm.runInNewContext(
    `(${uiMainFactory.toString()})(${JSON.stringify({ ...cdp.DEFAULT_CONFIG, homeLayout: 'studio', mascot: 'off', smoothCaret: false })}, { version: '1.0.8-beta.4', codeHash: 'hs-late-uc' });`,
    sb
  );
  const api = sb.__agPrism;
  assert.equal(created.length, 1, 'Initial homeStudio instance created before usageCore loads');
  assert.equal(created[0].usageCore, null);
  assert.deepEqual(disposed, []);

  // Sync again while usageCore is still absent -> reuses instance #1 without thrashing
  api.sync();
  assert.equal(created.length, 1);

  // Late-arriving Ch12 usage-core attaches to globalThis
  const lateUsageCore = { id: 'usage-core-v1' };
  sb.__agCsUsageCore = lateUsageCore;
  api.sync();
  assert.deepEqual(disposed, [1], 'Stale homeStudio instance created without usageCore must be disposed when usageCore arrives');
  assert.equal(created.length, 2, 'New homeStudio instance must be recreated with live usageCore');
  assert.equal(created[1].usageCore, lateUsageCore);

  // Subsequent syncs with same usageCore reuse instance #2
  api.sync();
  assert.equal(created.length, 2);
  api.destroy();
});

// ── 8: R2 永久性能红线门禁（V8 .prop IC / 0 preserveDrawingBuffer:true / 暗色 CSS <180KB + wallpaper 不写 html.style / Canvas 瘦身 + stub <2KB）──
test('Performance Fitness 8 (R2 Permanent Redlines): V8 .prop IC lock, 0 preserveDrawingBuffer:true, dark CSS <180KB + wallpaper no html.style, lazy miniCrabs + single-canvas vial + stub <2KB', () => {
  const cdp = require(path.join(ROOT, 'cdp.js'));
  const cssPack = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));
  const cssFlatten = require(path.join(ROOT, 'src', 'compiler', 'css-flatten.cjs'));
  const ch1BundleSrc = fs.readFileSync(path.join(ROOT, 'src', 'compiler', 'ch1-bundle.cjs'), 'utf8');

  // 8a) Ch1 热路径 3 模块与核心延迟通道永久禁用 .prop 池化
  for (const hotPart of ['src/runtime/dom-bus.js', 'stream-choreography.js', 'ui-runtime.js']) {
    assert.ok(ch1BundleSrc.includes(`'${hotPart}'`), `CH1_NO_MEMBER_PROP_POOL_PARTS must permanently lock ${hotPart}`);
  }
  const ch1Expr = cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }, { noDiskCache: true });
  assert.ok(ch1Expr.includes('.addEventListener(') && ch1Expr.includes('.querySelector('), 'Ch1 hot DOM modules must preserve native .prop V8 IC');
  const omniExpr = cdp.buildOmniClientExpression(null, null, { noDiskCache: true });
  assert.ok(omniExpr.includes('.addEventListener('), 'Core delayed channel omni must preserve native .prop V8 IC');
  const diffExpr = cdp.buildInlineDiffInjectExpression(cdp.DEFAULT_CONFIG, { noDiskCache: true });
  assert.ok(diffExpr.includes('.addEventListener('), 'Core delayed channel inlineDiff must preserve native .prop V8 IC');

  // 8b) 全仓 0 处 preserveDrawingBuffer: true，且所有运行期 WebGL2 上下文显式声明 preserveDrawingBuffer: false
  const webglRuntimeFiles = [
    'ripple-core.js',
    'src/runtime/ripple-worker.js',
    'crystal-prism-core.js',
    'vial-core.js',
    'vendor/periodic-picker/keyboard-3d-gl.js',
  ];
  for (const rel of webglRuntimeFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(/preserveDrawingBuffer\s*:\s*true/.test(src), false, `${rel} must NEVER use preserveDrawingBuffer: true`);
    assert.ok(/preserveDrawingBuffer\s*:\s*false/.test(src), `${rel} must explicitly specify preserveDrawingBuffer: false`);
  }
  const walkCode = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'test' || ent.name === 'dist') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walkCode(full);
      else if (/\.(?:js|mjs|cjs)$/.test(ent.name)) {
        const s = fs.readFileSync(full, 'utf8');
        assert.equal(/preserveDrawingBuffer\s*:\s*true/.test(s), false, `${path.relative(ROOT, full)} must contain 0 preserveDrawingBuffer: true`);
      }
    }
  };
  walkCode(ROOT);

  // 8c) 暗色对话态激活 CSS < 180 KB 且 wallpaper-client.js 变量不写 html.style
  const rawCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const flatMin = cssPack.minifyCss(cssFlatten.flattenNestedCss(cssPack.minifyCss(rawCss)));
  const buckets = cssPack.splitCssIntoBuckets(flatMin);
  const darkChatActiveBytes = ['core', 'viewSidebar', 'motionFull'].reduce((sum, k) => sum + Buffer.byteLength(buckets[k] || '', 'utf8'), 0);
  assert.ok(darkChatActiveBytes < 180 * 1024, `Dark-chat active CSS (${darkChatActiveBytes} B) must stay strictly < 180 KB`);

  const wpMod = require(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-client.js'));
  const wpDoc = { hidden: false };
  const wpHtml = makeFakeElement('html', wpDoc);
  const wpHead = makeFakeElement('head', wpDoc);
  const wpBody = makeFakeElement('body', wpDoc);
  wpHtml.appendChild(wpHead);
  wpHtml.appendChild(wpBody);
  wpDoc.documentElement = wpHtml;
  wpDoc.head = wpHead;
  wpDoc.body = wpBody;
  wpDoc.createElement = (t) => makeFakeElement(t, wpDoc);
  wpDoc.getElementById = (id) => {
    const walk = (n) => {
      if (n.id === id) return n;
      for (const c of n.children || []) { const r = walk(c); if (r) return r; }
      return null;
    };
    return walk(wpHtml);
  };
  wpDoc.querySelector = () => null;
  wpDoc.querySelectorAll = () => [];
  const wp = wpMod.createWallpaperClient({ window: { document: wpDoc, addEventListener() {}, removeEventListener() {} }, document: wpDoc });
  wp.applyConfig({ enabled: true, mediaPath: 'C:/wp.png', mediaType: 'image', mediaUrl: 'http://127.0.0.1:45555/wp/1', opacity: 0.4, blurPx: 4, dimOverlay: 0.25, fit: 'cover', rev: 1 });
  for (const prop of ['--ag-prism-wp-opacity', '--ag-prism-wp-blur', '--ag-prism-wp-filter', '--ag-prism-wp-dim', '--ag-prism-wp-fit']) {
    assert.equal(wpHtml.style[prop], undefined, `wallpaper-client.js must NEVER write ${prop} onto html.style`);
  }
  const wpRoot = wpDoc.getElementById('ag-prism-wallpaper-root');
  assert.ok(wpRoot && wpRoot.style['--ag-prism-wp-opacity'] === '0.4', 'wallpaper-client.js must sink --ag-prism-wp-* onto #ag-prism-wallpaper-root');
  wp.destroy();

  // 8d) dual-mascot-rig miniCrabs 惰性 0 Canvas + vial-core 单 Canvas 纹理叠加 0 drawImage + periodic-picker-stub.js < 2048 B
  const rig = require(path.join(ROOT, 'dual-mascot-rig.js'));
  const mDoc = { hidden: false };
  const mHtml = makeFakeElement('html', mDoc);
  mDoc.documentElement = mHtml;
  mDoc.defaultView = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  mDoc.createElement = (t) => makeFakeElement(t, mDoc);
  mDoc.addEventListener = () => {};
  mDoc.removeEventListener = () => {};
  const mHost = makeFakeElement('div', mDoc);
  const stage = rig.mountDualMascotStage(mHost, { miniPileEnabled: false, reducedMotion: true });
  const miniGroup = mHost.children.find((n) => n.className === 'ag-v2-mini-pile');
  assert.ok(miniGroup && miniGroup.children.length === 0, 'dual-mascot-rig miniCrabs must create strictly 0 <canvas> when disabled');
  stage.dispose();

  const vialSrc = fs.readFileSync(path.join(ROOT, 'vial-core.js'), 'utf8');
  assert.ok(vialSrc.includes('u_scaleTex'), 'vial-core.js must composite scale marks via single-canvas u_scaleTex texture overlay');
  assert.equal(/\.drawImage\s*\(\s*glCanvas/.test(vialSrc), false, 'vial-core.js must perform 0 ctx2d.drawImage(glCanvas) copies');

  const stubPath = path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker-stub.js');
  const stubBytes = fs.statSync(stubPath).size;
  assert.ok(stubBytes < 2048, `periodic-picker-stub.js (${stubBytes} B) must stay strictly < 2048 B`);
});
