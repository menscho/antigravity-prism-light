import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function assertBalancedDelimiters(src, label) {
  let braces = 0, parens = 0, brackets = 0;
  for (const ch of src) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    assert.ok(braces >= 0 && parens >= 0 && brackets >= 0, `${label}: unmatched closing delimiter`);
  }
  assert.equal(braces, 0, `${label}: unbalanced {}`);
  assert.equal(parens, 0, `${label}: unbalanced ()`);
  assert.equal(brackets, 0, `${label}: unbalanced []`);
}

test('Issue #109 & PR #111: DeepSeek whale & cat keep eyes closed (loafShut) across all loaf/sleep ticks with 0 blinking', () => {
  const rig = require(path.join(ROOT, 'dual-mascot-rig.js'));
  const rigSrc = fs.readFileSync(path.join(ROOT, 'dual-mascot-rig.js'), 'utf8');
  const loafBlock = /loaf\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\},/.exec(rigSrc);
  assert.ok(loafBlock && loafBlock[0].includes("s.eyes = 'loafShut';"), 'POSE_RECIPES.loaf must force s.eyes = \'loafShut\'');

  // Compare whale & cat loaf/sleep eye layer rows across all 32 ticks -> strictly identical to closed-eye sleep baseline (0 blinking)
  for (const [species, layerIndices] of [['whale', [1, 3]], ['cat', [4]]]) {
    const sleepBase = rig.buildClipLayers(species, 'sleep', 0, {}).map((l) => JSON.stringify(l.rows));
    for (let tick = 0; tick < 32; tick++) {
      const loafRows = rig.buildClipLayers(species, 'loaf', tick, {}).map((l) => JSON.stringify(l.rows));
      const sleepRows = rig.buildClipLayers(species, 'sleep', tick, {}).map((l) => JSON.stringify(l.rows));
      for (const idx of layerIndices) {
        assert.deepEqual(loafRows[idx], sleepBase[idx], `${species} loaf layer[${idx}] at tick=${tick} must keep loafShut eyes without blinking`);
        assert.deepEqual(sleepRows[idx], sleepBase[idx], `${species} sleep layer[${idx}] at tick=${tick} must keep loafShut eyes without blinking`);
      }
    }
  }
});

test('Repo-wide WebGL2 redline: strictly 0 preserveDrawingBuffer:true and explicit preserveDrawingBuffer:false on all runtime WebGL2 contexts', () => {
  const runtimeFiles = [
    'ripple-core.js',
    'src/runtime/ripple-worker.js',
    'crystal-prism-core.js',
    'vial-core.js',
    'vendor/periodic-picker/keyboard-3d-gl.js',
  ];
  for (const rel of runtimeFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(/preserveDrawingBuffer\s*:\s*true/.test(src), false, `${rel} must NEVER enable preserveDrawingBuffer: true`);
    assert.ok(/preserveDrawingBuffer\s*:\s*false/.test(src), `${rel} must explicitly specify preserveDrawingBuffer: false`);
    const inlineMatches = [...src.matchAll(/getContext(?:\?\.)?\(\s*['"]webgl2['"]\s*,\s*\{[^}]{0,400}\}/g)];
    for (const m of inlineMatches) {
      assert.ok(
        /preserveDrawingBuffer\s*:\s*false/.test(m[0]),
        `${rel} inline WebGL2 getContext options must explicitly set preserveDrawingBuffer: false: ${m[0]}`
      );
    }
  }
  // 全仓扫描所有 JS 文件（不含 test/ 与 node_modules/）确保零 preserveDrawingBuffer: true
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'test') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(?:js|mjs|cjs)$/.test(ent.name)) {
        const s = fs.readFileSync(full, 'utf8');
        assert.equal(/preserveDrawingBuffer\s*:\s*true/.test(s), false, `${path.relative(ROOT, full)} must NEVER use preserveDrawingBuffer: true`);
      }
    }
  };
  walk(ROOT);
});

test('PR #108 & home-ripple-host: reattach sync wake(true), ResizeObserver !isLost guard, dom-bus subscription, and GlyphField Worker offload + fallback', async () => {
  const hostSrc = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
  assert.ok(hostSrc.includes('invAll(); wake(true);'), 'reattach must invoke sync wake(true) anti-flicker');
  assert.ok(hostSrc.includes('hasFSz() && !fLost && !isLost(cv, st.field)'), 'ResizeObserver live check must guard !isLost');
  assert.ok(hostSrc.includes('wRef.__agDomBus || wRef.__agPrismDomBus'), 'home-ripple-host must prefer __agDomBus when available');

  // Verify GlyphField OffscreenCanvas Worker offload & fallback in ripple-worker.js
  const workerMod = require(path.join(ROOT, 'src/runtime/ripple-worker.js'));
  const rippleCore = require(path.join(ROOT, 'ripple-core.js'));
  assert.equal(typeof workerMod.mountFieldWorker, 'function');
  assert.equal(typeof workerMod.mountManagedField, 'function');
  assert.ok(workerMod.RENDER_WORKER_SRC.includes("mode==='field'"), 'RENDER_WORKER_SRC must support GlyphField mode');

  const prevBlob = globalThis.Blob, prevURL = globalThis.URL, prevWorker = globalThis.Worker, prevOff = globalThis.OffscreenCanvas;
  const posted = [];
  let terminated = 0;
  try {
    workerMod.resetProbeCache();
    globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
    globalThis.URL = { createObjectURL: () => 'blob:mock-field', revokeObjectURL() {} };
    globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } };
    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
      }
      postMessage(msg) {
        posted.push(msg);
        if (msg.type === 'probe') queueMicrotask(() => this.onmessage?.({ data: { type: 'probe', ok: true, reason: 'ok' } }));
        else if (msg.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
      }
      terminate() { terminated++; }
    };

    const probeRes = await workerMod.probeWorkerWebGL2({ force: true });
    assert.equal(probeRes.ok, true);

    let transferred = 0;
    const fakeCv = {
      width: 0, height: 0, style: {},
      transferControlToOffscreen() { transferred++; return { width: 0, height: 0 }; },
      getContext: () => null,
    };
    const waves = rippleCore.createWaveField(20, 10, () => 0.5);
    const field = workerMod.mountManagedField({
      getCanvas: () => fakeCv,
      swapCanvas: () => fakeCv,
      cols: 20, rows: 10, dpr: 1, waves, rippleCore,
    });
    assert.equal(field.mode, 'worker-webgl2', 'mountManagedField must offload GlyphField to OffscreenCanvas Worker when probe passes');
    assert.equal(transferred, 1);
    await Promise.resolve();
    field.draw(1000, { dark: true, ink: [146, 148, 156], wave: [214, 218, 228], aura: null }, false);
    assert.ok(posted.some((m) => m.type === 'init' && m.mode === 'field'));
    assert.ok(posted.some((m) => m.type === 'draw' && m.params && m.cellsBuf instanceof ArrayBuffer));
    field.dispose();
    assert.ok(terminated >= 2);
  } finally {
    workerMod.disposeAll();
    workerMod.resetProbeCache();
    globalThis.Blob = prevBlob;
    globalThis.URL = prevURL;
    globalThis.Worker = prevWorker;
    globalThis.OffscreenCanvas = prevOff;
  }
});

test('Canvas slimming: dual-mascot-rig lazy miniCrabs (0 canvas when disabled), pure CSS SVG habitat prop (0 canvas, 0 innerHTML), and dom-bus subscription', () => {
  const rig = require(path.join(ROOT, 'dual-mascot-rig.js'));
  const rigSrc = fs.readFileSync(path.join(ROOT, 'dual-mascot-rig.js'), 'utf8');
  assert.equal(/\.innerHTML\s*=/.test(rigSrc), false, 'dual-mascot-rig.js must keep 0 innerHTML writes');

  let canvasCreated = 0;
  let ctx2dAcquired = 0;
  const busSubs = [];
  const makeEl = (tag) => {
    const attrs = new Map();
    const children = [];
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      style: {},
      dataset: {},
      width: 0,
      height: 0,
      children,
      parentNode: null,
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { children.push(c); c.parentNode = el; return c; },
      removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); c.parentNode = null; },
      remove() { el.parentNode?.removeChild(el); },
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 96, bottom: 84, width: 96, height: 84 }),
      getContext(kind) {
        if (kind !== '2d') return null;
        ctx2dAcquired++;
        return { setTransform() {}, clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage() {} };
      },
    };
    if (el.tagName === 'CANVAS') canvasCreated++;
    return el;
  };
  const win = {
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    __agDomBus: {
      subscribe(id, fn, opts) { busSubs.push({ id, fn, opts }); return () => { busSubs.push({ unsub: id }); }; },
    },
  };
  const doc = {
    hidden: false,
    documentElement: makeEl('html'),
    defaultView: win,
    createElement(t) { const n = makeEl(t); n.ownerDocument = doc; return n; },
    addEventListener() {},
    removeEventListener() {},
  };
  const host = doc.createElement('div');
  const stage = rig.mountDualMascotStage(host, { miniPileEnabled: false, reducedMotion: true });

  const miniGroup = host.children.find((n) => n.className === 'ag-v2-mini-pile');
  const habEl = host.children.find((n) => n.className === 'ag-v2-habitat-prop');
  assert.ok(miniGroup && habEl);
  assert.equal(miniGroup.children.length, 0, '!miniPileEnabled must create strictly 0 mini crab <canvas> nodes');
  assert.equal(habEl.tagName, 'DIV', 'habitat prop must be a pure CSS <div>, not <canvas>');
  assert.ok(String(habEl.style.backgroundImage || '').includes('data:image/svg+xml'), 'habitat prop must use SVG DataURI');
  assert.equal(ctx2dAcquired, 2, 'Only 2 main mascot actors acquire 2D contexts when miniPileEnabled=false');
  assert.ok(busSubs.some((s) => s.id === 'dual-mascot-root'), 'dual-mascot-rig must subscribe via window.__agDomBus');

  // Enable miniPile -> lazily mounts 3 mini canvases; disable -> zeroCv + remove()
  stage.setState({ miniPileEnabled: true });
  assert.equal(miniGroup.children.length, 3, 'Enabling miniPileEnabled lazily mounts 3 mini canvases');
  const mountedMinis = [...miniGroup.children];
  assert.ok(mountedMinis.every((c) => c.tagName === 'CANVAS' && c.width > 0 && c.height > 0));

  stage.setState({ miniPileEnabled: false });
  assert.equal(miniGroup.children.length, 0, 'Disabling miniPileEnabled must remove all 3 mini canvases from DOM');
  assert.ok(mountedMinis.every((c) => c.width === 0 && c.height === 0), 'Disabling miniPileEnabled must zeroCv(cv, true) on all 3 mini canvases');

  stage.dispose();
  assert.ok(busSubs.some((s) => s.unsub === 'dual-mascot-root'), 'dispose() must unsubscribe from __agDomBus');
});

test('3D Periodic Picker: 20s warm standby (<16ms reuse), 2s hidden reclaim, isContextLost() cold rebuild, __agPeriodicPendingOpen handshake, UBO & no static will-change', () => {
  const pickerSrc = fs.readFileSync(path.join(ROOT, 'vendor/periodic-picker/periodic-picker.js'), 'utf8');
  const kbSrc = fs.readFileSync(path.join(ROOT, 'vendor/periodic-picker/keyboard-3d-gl.js'), 'utf8');
  const bentoSrc = fs.readFileSync(path.join(ROOT, 'vendor/periodic-picker/bento-ui.js'), 'utf8');

  // 1) Keyboard 3D GL UBO + F_Schlick 4-mul + bento-ui static will-change removal
  assert.ok(kbSrc.includes('layout(std140) uniform FrameGlobals'), 'keyboard-3d-gl.js must declare FrameGlobals std140 UBO');
  assert.ok(kbSrc.includes('gl.bufferSubData(frameUboTarget, 0, _frameUboFloats)'), 'keyboard-3d-gl.js must upload FrameGlobals UBO via bufferSubData');
  assert.equal(/vec3 F_Schlick\([\s\S]{0,180}pow\(/.test(kbSrc), false, 'F_Schlick must avoid pow(..., 5.0)');
  assert.equal(/vec3 F_SchlickRoughness\([\s\S]{0,200}pow\(/.test(kbSrc), false, 'F_SchlickRoughness must avoid pow(..., 5.0)');
  assert.equal(/['"]\.ag-pp-floor-shadow\{[^}]*will-change\s*:\s*transform/.test(bentoSrc), false, '.ag-pp-floor-shadow must not keep static will-change:transform');
  assert.equal(/\.ag-pp-floor-shadow::after\{[^}]*will-change\s*:\s*transform/.test(bentoSrc), false, '.ag-pp-floor-shadow::after must not keep static will-change:transform');
  assert.ok(bentoSrc.includes('[data-orbit-dragging="1"] .ag-pp-floor-shadow{transition:none;will-change:transform;}'), 'Interactive orbit drag must attach will-change:transform');
  assert.ok(bentoSrc.includes('--pp-shadow-px') && bentoSrc.includes('--pp-shadow-py'), 'bento-ui.js must preserve --pp-shadow-px/y inheritance');
  assert.ok(pickerSrc.includes('STANDBY_RECLAIM_MS = 20000') && pickerSrc.includes('STANDBY_HIDDEN_MS = 2000'));

  // 2) Live lifecycle test: warm standby reuse, context-lost cold rebuild, 2s hidden reclaim, and __agPeriodicPendingOpen handshake
  const pickerMod = require(path.join(ROOT, 'vendor/periodic-picker/periodic-picker.js'));
  let nowMs = 10000, timerSeq = 1;
  const timers = new Map();
  let createCalls = 0, disposeCalls = 0, pausedCalls = [], forceLost = false;

  const makeNode = (tag) => {
    const attrs = new Map(), kids = [];
    const n = {
      nodeType: 1, tagName: String(tag).toUpperCase(), className: '', style: { setProperty() {}, removeProperty() {} },
      children: kids, childNodes: kids, parentNode: null, isConnected: true, textContent: '',
      classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { kids.push(c); c.parentNode = n; return c; },
      insertBefore(c, ref) { const i = kids.indexOf(ref); if (i >= 0) kids.splice(i, 0, c); else kids.push(c); c.parentNode = n; return c; },
      removeChild(c) { const i = kids.indexOf(c); if (i >= 0) kids.splice(i, 1); c.parentNode = null; },
      remove() { n.parentNode?.removeChild(n); },
      contains(t) { return t === n || kids.some((k) => k.contains?.(t)); },
      querySelector(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        for (const k of kids) {
          if (cls && String(k.className || '').split(/\s+/).includes(cls)) return k;
          const r = k.querySelector?.(sel);
          if (r) return r;
        }
        return null;
      },
      querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700, right: 1200, bottom: 700 }),
    };
    return n;
  };
  const docListeners = new Map();
  const doc = {
    hidden: false, visibilityState: 'visible',
    documentElement: makeNode('html'), body: makeNode('body'), head: makeNode('head'),
    createElement: (t) => makeNode(t), createTextNode: (s) => ({ nodeType: 3, textContent: s }),
    createElementNS: (_ns, t) => makeNode(t),
    getElementById: (id) => doc.body.children.find((c) => c.id === id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener(t, fn) { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(fn); },
    removeEventListener(t, fn) { docListeners.get(t)?.delete(fn); },
  };
  const win = {
    document: doc, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
    setTimeout(fn, ms) { const id = timerSeq++; timers.set(id, { fn, due: nowMs + Math.max(0, Number(ms) || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener() {}, removeEventListener() {},
    __agPrismKeyboard3D: {
      createKeyboard3DRenderer(cfg) {
        createCalls++;
        const cv = cfg.canvas;
        return {
          canvas: cv,
          setState() {}, resize() {}, syncCanvasBounds() {}, pick: () => null,
          getInteractiveProjectedRects: () => ({ keys: [], auxKeys: [], efforts: [], controls: {} }),
          getChassisOrbit: () => ({ pitch: 0, yaw: 0, isRotated: false }),
          getRendererMode: () => 'webgl2',
          setPaused(v) { pausedCalls.push(Boolean(v)); },
          cancelAnimLoop() {},
          isContextLost: () => forceLost,
          dispose() { disposeCalls++; },
        };
      },
    },
    __agPeriodicPendingOpen: { trigger: null, pointerDownAt: Date.now() - 120, autoOpen: true },
  };
  const advance = (ms) => {
    nowMs += ms;
    for (const [id, t] of [...timers.entries()]) {
      if (t.due <= nowMs) { timers.delete(id); t.fn(); }
    }
  };

  // Fresh __agPeriodicPendingOpen (< 2500ms & autoOpen) -> auto-opens immediately & sets __agPeriodicFullLoaded = true
  const inst = pickerMod.mountPeriodicPicker({ root: win, doc, mode: 'on' });
  assert.equal(win.__agPeriodicFullLoaded, true, 'mountPeriodicPicker must set __agPeriodicFullLoaded = true');
  assert.equal(win.__agPeriodicPendingOpen, undefined, 'mountPeriodicPicker must consume __agPeriodicPendingOpen');
  assert.equal(inst.isOpen(), true, 'Fresh __agPeriodicPendingOpen (< 2500ms, autoOpen) must seamlessly open picker');
  assert.equal(createCalls, 1);

  // Close -> 0fps standby (NOT disposed immediately), warm reopen within 20s reuses renderer (0 extra createCalls!)
  inst.close();
  assert.equal(inst.isOpen(), false);
  assert.equal(inst.getStatus().standbyActive, true);
  assert.equal(disposeCalls, 0, 'Normal close must NOT immediately dispose WebGL2 renderer');
  assert.equal(pausedCalls.at(-1), true, 'Normal close must pause renderer to 0fps immediately');

  advance(5000);
  assert.equal(disposeCalls, 0, 'Standby renderer stays alive at 5s (< 20s)');
  assert.equal(inst.open(), true);
  assert.equal(createCalls, 1, 'Warm reopen within 20s must reuse live standby renderer (0 cold rebuild)');

  // Context lost during standby -> reopen detects isContextLost() and cold-rebuilds!
  inst.close();
  forceLost = true;
  assert.equal(inst.open(), true);
  assert.equal(disposeCalls, 1, 'Lost standby renderer must be disposed on reopen');
  assert.equal(createCalls, 2, 'Lost standby context must trigger clean cold rebuild');
  forceLost = false;

  // document.hidden shortens standby reclaim timer to 2000ms
  inst.close();
  doc.hidden = true; doc.visibilityState = 'hidden';
  for (const fn of docListeners.get('visibilitychange') || []) fn({});
  advance(1500);
  assert.equal(disposeCalls, 1, 'Hidden standby stays alive before 2000ms');
  advance(600);
  assert.equal(disposeCalls, 2, 'Hidden standby must reclaim WebGL2 at 2000ms');
  assert.equal(inst.getStatus().standbyActive, false);
  inst.destroy();

  // Stale __agPeriodicPendingOpen (>= 2500ms) must NOT auto-open
  doc.hidden = false; doc.visibilityState = 'visible';
  win.__agPeriodicPendingOpen = { trigger: null, pointerDownAt: Date.now() - 4000, autoOpen: true };
  const inst2 = pickerMod.mountPeriodicPicker({ root: win, doc, mode: 'on' });
  assert.equal(inst2.isOpen(), false, 'Stale __agPeriodicPendingOpen (>= 2500ms) must not auto-open');
  inst2.destroy();
});

test('Four core GLSL shaders: syntax balance, CPU precomputation, ALU reductions & early-out guards', () => {
  const rippleCore = require(path.join(ROOT, 'ripple-core.js'));
  const crystalSrc = fs.readFileSync(path.join(ROOT, 'crystal-prism-core.js'), 'utf8');
  const vialSrc = fs.readFileSync(path.join(ROOT, 'vial-core.js'), 'utf8');

  // 1) HORIZON_FRAGMENT_SHADER
  const hFrag = rippleCore.HORIZON_FRAGMENT_SHADER;
  assert.ok(hFrag.startsWith('#version 300 es'));
  assertBalancedDelimiters(hFrag, 'HORIZON_FRAGMENT_SHADER');
  assert.ok(hFrag.includes('INV_FIELD_NORM') && hFrag.includes('uPre0') && hFrag.includes('uSpecModes'));
  assert.ok(hFrag.indexOf('glowUpper * topFeather < 0.0008') > 0 && hFrag.indexOf('glowUpper * topFeather < 0.0008') < hFrag.indexOf('fbm3(p * 2.0'), 'Coarse analytic early-out must precede 4x fbm3');
  assert.equal(hFrag.includes('pow(1.0 - sp, 1.45)'), false);
  assert.equal(hFrag.includes('pow(uPresence, 0.68)'), false);
  assert.equal(hFrag.includes('uSpectrum > 4.5'), false);

  // 2) GlyphField FRAGMENT_SHADER
  const gFrag = rippleCore.FRAGMENT_SHADER;
  assert.ok(gFrag.startsWith('#version 300 es'));
  assertBalancedDelimiters(gFrag, 'GlyphField FRAGMENT_SHADER');
  assert.ok(gFrag.includes('uSpec0') && gFrag.includes('uSpec3') && gFrag.includes('uIdleParams') && gFrag.includes('uIdleMetrics'));
  assert.ok(gFrag.includes('inversesqrt(') && gFrag.includes('fastAtan2Turns('));
  assert.equal(/\batan\s*\(/.test(gFrag), false, 'GlyphField shader must replace 4x atan() with fast polynomial');
  assert.equal(gFrag.includes('spectrumCode >'), false, 'GlyphField shader must eliminate 5-way spectrum branch');

  // 3) crystal-prism-core.js FS_SRC
  const cMatch = crystalSrc.match(/const FS_SRC = `([\s\S]*?)`;/);
  assert.ok(cMatch, 'crystal-prism-core.js FS_SRC must be present');
  const cFrag = cMatch[1];
  assert.ok(cFrag.startsWith('#version 300 es'));
  assertBalancedDelimiters(cFrag, 'crystal-prism-core FS_SRC');
  assert.ok(cFrag.includes('uniform vec3 u_sp0;') && cFrag.includes('inversesqrt('));
  assert.equal(/ox\s*<=\s*2|oy\s*<=\s*2/.test(cFrag), false, 'fVor second loop must shrink from 5x5 to 3x3');
  assert.equal(/pow\([^,]+,\s*(?:2\.0|9\.0|12\.0|26\.0|38\.0)\)/.test(cFrag), false, 'crystal FS_SRC must replace integer pow() with multiplications');

  // 4) vial-core.js FRAG_SRC
  const vMatch = vialSrc.match(/const FRAG_SRC = `([\s\S]*?)`;/);
  assert.ok(vMatch, 'vial-core.js FRAG_SRC must be present');
  const vFrag = vMatch[1];
  assert.ok(vFrag.startsWith('#version 300 es'));
  assertBalancedDelimiters(vFrag, 'vial-core FRAG_SRC');
  assert.ok(vFrag.includes('precision mediump float;'));
  assert.ok(vFrag.includes('uniform vec3 u_tiltTrig;') && vFrag.includes('uniform sampler2D u_waveTex;') && vFrag.includes('uniform sampler2D u_scaleTex;'));
  assert.ok(vFrag.includes('fastAsin('));
  assert.equal(/\basin\s*\(/.test(vFrag), false, 'vial FRAG_SRC must replace asin() with polynomial fastAsin()');
  assert.equal(/u_wave\[24\]/.test(vFrag), false, 'vial FRAG_SRC must replace dynamic u_wave[24] indexing with 24x1 texture');
  assert.equal(/pow\([^,]+,\s*(?:2\.0|3\.0)\)/.test(vFrag), false, 'vial FRAG_SRC must replace pow(x,2/3) with multiplications');
});

test('conv-aura.js dom-bus + borderBoxSize priority & docs/CONTRIBUTORS.md credits', () => {
  const convSrc = fs.readFileSync(path.join(ROOT, 'conv-aura.js'), 'utf8');
  assert.ok(convSrc.includes('wRef.__agDomBus || wRef.__agPrismDomBus'), 'conv-aura.js must prefer __agDomBus');
  assert.ok(convSrc.includes('borderBoxSize') && convSrc.includes('inlineSize') && convSrc.includes('blockSize'), 'conv-aura.js ResizeObserver must prefer entry.borderBoxSize?.[0]');

  const contrib = fs.readFileSync(path.join(ROOT, 'docs/CONTRIBUTORS.md'), 'utf8');
  for (const handle of ['@dengshu2', '@L-yifan', '@LnGXi', '@yaoguaiLYG']) {
    assert.ok(contrib.includes(handle), `docs/CONTRIBUTORS.md must credit ${handle}`);
  }
});
