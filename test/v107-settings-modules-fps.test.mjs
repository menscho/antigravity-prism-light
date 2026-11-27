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
  };
}

function makeFakeClock(initialNow = 1000) {
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
      const delay = Math.max(0, Number(ms) || 0);
      timers.set(id, { fn, ms: delay, due: now + delay });
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

function createMiniDom() {
  function matchesSimple(el, rawSel) {
    if (!el || el.nodeType !== 1) return false;
    const sel = rawSel.trim();
    if (!sel) return false;
    let rem = sel;
    const notMatch = rem.match(/:not\(\[([a-zA-Z0-9_-]+)="([^"]+)"\]\)/);
    if (notMatch) {
      if (el.getAttribute(notMatch[1]) === notMatch[2]) return false;
      rem = rem.replace(notMatch[0], '');
    }
    const idMatch = rem.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      if (el.id !== idMatch[1]) return false;
      rem = rem.replace(idMatch[0], '');
    }
    const tagMatch = rem.match(/^[a-zA-Z0-9-]+/);
    if (tagMatch) {
      if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
      rem = rem.slice(tagMatch[0].length);
    }
    for (const cm of rem.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!el.classList.contains(cm[1])) return false;
    }
    rem = rem.replace(/\.[a-zA-Z0-9_-]+/g, '');
    for (const am of rem.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)) {
      if (!el.hasAttribute(am[1])) return false;
      if (am[2] !== undefined && el.getAttribute(am[1]) !== am[2]) return false;
    }
    return true;
  }

  function matchesList(el, selList) {
    return String(selList || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((part) => {
        if (!/\s/.test(part)) return matchesSimple(el, part);
        const toks = part.split(/\s+/);
        if (!matchesSimple(el, toks[toks.length - 1])) return false;
        let cur = el.parentElement;
        let idx = toks.length - 2;
        while (idx >= 0 && cur) {
          if (matchesSimple(cur, toks[idx])) idx -= 1;
          cur = cur.parentElement;
        }
        return idx < 0;
      });
  }

  function makeEl(tag) {
    const attrs = new Map();
    const classes = new Set();
    const styleProps = new Map();
    const bus = makeEventBus();
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      children: [],
      childNodes: [],
      parentNode: null,
      parentElement: null,
      isConnected: true,
      _text: '',
      style: {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
        removeProperty(k) { styleProps.delete(k); },
        get color() { return styleProps.get('color') || ''; },
        set color(v) { if (v) styleProps.set('color', String(v)); else styleProps.delete('color'); },
        get opacity() { return styleProps.get('opacity') || ''; },
        set opacity(v) { if (v) styleProps.set('opacity', String(v)); else styleProps.delete('opacity'); },
        get fontWeight() { return styleProps.get('fontWeight') || ''; },
        set fontWeight(v) { if (v) styleProps.set('fontWeight', String(v)); else styleProps.delete('fontWeight'); },
      },
      classList: {
        add(...cs) {
          for (const c of cs) if (c) classes.add(c);
          attrs.set('class', [...classes].join(' '));
        },
        remove(...cs) {
          for (const c of cs) classes.delete(c);
          const s = [...classes].join(' ');
          if (s) attrs.set('class', s);
          else attrs.delete('class');
        },
        contains(c) { return classes.has(c); },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { if (v) attrs.set('id', String(v)); else attrs.delete('id'); },
      get className() { return attrs.get('class') || ''; },
      set className(v) {
        classes.clear();
        for (const c of String(v || '').split(/\s+/).filter(Boolean)) classes.add(c);
        if (classes.size) attrs.set('class', [...classes].join(' '));
        else attrs.delete('class');
      },
      get textContent() {
        if (el.children.length === 0) return el._text;
        return el._text + el.children.map((c) => c.textContent).join('');
      },
      set textContent(v) {
        el._text = String(v ?? '');
        for (const c of el.children) {
          c.parentNode = null;
          c.parentElement = null;
          c.isConnected = false;
        }
        el.children = [];
        el.childNodes = [];
      },
      set innerHTML(v) {
        el._innerHTML = String(v || '');
        el.children = [];
        el.childNodes = [];
        const span = makeEl('svg');
        span._html = el._innerHTML;
        span.cloneNode = () => makeEl('svg');
        el.appendChild(span);
      },
      get firstChild() { return el.children[0] || null; },
      get firstElementChild() { return el.children[0] || null; },
      get nextElementSibling() {
        if (!el.parentElement) return null;
        const idx = el.parentElement.children.indexOf(el);
        return idx >= 0 ? el.parentElement.children[idx + 1] || null : null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'class') el.className = v;
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'class') classes.clear();
      },
      appendChild(child) {
        if (child.parentNode) child.remove();
        child.parentNode = el;
        child.parentElement = el;
        child.isConnected = el.isConnected;
        el.children.push(child);
        el.childNodes.push(child);
        return child;
      },
      insertBefore(child, ref) {
        const idx = ref ? el.children.indexOf(ref) : -1;
        if (idx < 0) return el.appendChild(child);
        if (child.parentNode) child.remove();
        child.parentNode = el;
        child.parentElement = el;
        child.isConnected = el.isConnected;
        el.children.splice(idx, 0, child);
        el.childNodes.splice(idx, 0, child);
        return child;
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx >= 0) {
          el.children.splice(idx, 1);
          el.childNodes.splice(idx, 1);
          child.parentNode = null;
          child.parentElement = null;
          child.isConnected = false;
        }
        return child;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentNode;
        }
        return false;
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (matchesList(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (node) => {
          for (const ch of node.children || []) {
            if (matchesList(ch, sel)) out.push(ch);
            walk(ch);
          }
        };
        walk(el);
        return out;
      },
      getElementById(id) {
        let found = null;
        const walk = (node) => {
          for (const ch of node.children || []) {
            if (!found && ch.id === id) found = ch;
            if (!found) walk(ch);
          }
        };
        walk(el);
        return found;
      },
      addEventListener: (t, fn) => bus.add(t, fn),
      removeEventListener: (t, fn) => bus.remove(t, fn),
      dispatch: (t, ev) => bus.dispatch(t, ev),
    };
    return el;
  }

  const html = makeEl('html');
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  const docBus = makeEventBus();
  const doc = {
    hidden: false,
    documentElement: html,
    head,
    body,
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => html.getElementById(id),
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener: (t, fn) => docBus.add(t, fn),
    removeEventListener: (t, fn) => docBus.remove(t, fn),
    dispatch: (t, ev) => docBus.dispatch(t, ev),
  };

  return { doc, html, head, body, makeEl };
}

// ── 1. model-glyph-crystal.js: #2a effortSliderModule='off' + #8b palette='host' ──
test('model-glyph-crystal (#2a & #8b): effortSliderModule="off" blocks/cleans orchestrator-effort-bar & crystal loop, and light palette="host" avoids alabaster warm tint', () => {
  const src = fs.readFileSync(path.join(ROOT, 'model-glyph-crystal.js'), 'utf8');
  const clock = makeFakeClock(1000);
  const { doc, html, body, makeEl } = createMiniDom();

  const panel = makeEl('div');
  panel.setAttribute('data-testid', 'model-selector-panel');
  const orchRow = makeEl('button');
  orchRow.setAttribute('role', 'menuitem');
  orchRow.setAttribute('data-selected', 'true');
  orchRow.textContent = 'Orchestrator';
  const geminiRow = makeEl('button');
  geminiRow.setAttribute('role', 'menuitem');
  geminiRow.textContent = 'Gemini 4 Carbon (High)';
  panel.appendChild(orchRow);
  panel.appendChild(geminiRow);
  body.appendChild(panel);

  const sb = {
    document: doc,
    performance: clock.performance,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, RegExp,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);

  let mountCount = 0;
  let disposeCount = 0;
  let stepCount = 0;
  let capturedGetState = null;
  let isDark = false;
  let cfgMode = 'auto';

  const ctl = sb.__agPrismModelGlyphCrystal.createModelGlyphCrystalController({
    animatedIcons: null,
    crystalPrismCore: {
      mountCrystalPrismBar(_cv, opts) {
        mountCount += 1;
        capturedGetState = opts.getState;
        return {
          setReduceMotion() {},
          setPointerClient() {},
          wake() {},
          step() { stepCount += 1; },
          isIdle: () => false,
          dispose() { disposeCount += 1; },
        };
      },
    },
    isDestroyed: () => false,
    isComposerRestyleEnabled: () => true,
    isZh: () => true,
    isDarkTheme: () => isDark,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    canMountRealCanvas: () => true,
    getLastPointerPos: () => ({ x: 50, y: 50 }),
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    getCfg: () => ({ effortSliderModule: cfgMode }),
  });

  // 1a) Starting with html[data-ag-cs-effort-slider="off"] -> never mounts orchestrator-effort-bar, keeps model glyphs
  html.setAttribute('data-ag-cs-effort-slider', 'off');
  ctl.syncModelSelectorPanel({ isOrchestrator: true, brand: 'antigravity', tier: 'auto' });
  clock.flushRafs(16);
  assert.equal(panel.querySelector('[data-testid="orchestrator-effort-bar"]'), null, 'off attr must block orchestrator-effort-bar mount');
  assert.equal(mountCount, 0, 'off attr must mount 0 crystal instances');
  assert.equal(ctl.getActiveCrystalTrack(), null);
  assert.ok(panel.querySelectorAll('.ag-cs-panel-row-glyph').length >= 1, 'Model row brand glyphs must remain mounted');

  // 1b) getCfg().effortSliderModule === 'off' also blocks mount even when html attr is absent
  html.removeAttribute('data-ag-cs-effort-slider');
  cfgMode = 'off';
  ctl.syncModelSelectorPanel({ isOrchestrator: true, brand: 'antigravity', tier: 'auto' });
  clock.flushRafs(16);
  assert.equal(panel.querySelector('[data-testid="orchestrator-effort-bar"]'), null, 'getCfg().effortSliderModule="off" must block mount');
  assert.equal(mountCount, 0);

  // 1c) Enable -> mounts bar & crystal loop; verify #8b palette="host" vs "obsidian" vs "warm" in light mode
  cfgMode = 'auto';
  html.setAttribute('data-ag-cs-effort-slider', 'auto');
  html.setAttribute('data-ag-cs-accent', 'follow');
  html.setAttribute('data-ag-cs-light-preset', 'alabaster');
  ctl.syncModelSelectorPanel({ isOrchestrator: true, brand: 'antigravity', tier: 'auto' });
  clock.flushRafs(16);
  assert.ok(panel.querySelector('[data-testid="orchestrator-effort-bar"]'), 'auto mode must mount orchestrator-effort-bar');
  assert.equal(mountCount, 1);
  assert.ok(ctl.getActiveCrystalTrack(), 'Active crystal track must be exposed while Orchestrator bar is mounted');
  assert.equal(clock.rafs.size, 1, 'Crystal animation loop must be active while non-idle');

  isDark = false;
  html.setAttribute('data-ag-cs-palette', 'obsidian');
  assert.equal(capturedGetState().accentTone, 'warm', 'Light obsidian + alabaster must use warm crystal accent');
  html.setAttribute('data-ag-cs-palette', 'host');
  assert.equal(capturedGetState().accentTone, 'default', 'Light host + alabaster must stay default (never warm alabaster)');
  html.setAttribute('data-ag-cs-palette', 'warm');
  assert.equal(capturedGetState().accentTone, 'warm', 'Light warm palette must keep warm crystal accent');
  html.setAttribute('data-ag-cs-accent', 'cobalt');
  assert.equal(capturedGetState().accentTone, 'cobalt', 'Explicit accentTone must override palette');

  // 1d) Live switch auto -> off -> immediately removes existing bar, disposes crystal instance, cancels rAF
  const stepsBeforeOff = stepCount;
  html.setAttribute('data-ag-cs-effort-slider', 'off');
  ctl.syncModelSelectorPanel({ isOrchestrator: true, brand: 'antigravity', tier: 'auto' });
  assert.equal(panel.querySelector('[data-testid="orchestrator-effort-bar"]'), null, 'Live off must remove existing orchestrator-effort-bar immediately');
  assert.equal(panel.hasAttribute('data-ag-cs-orch-active'), false);
  assert.equal(disposeCount, 1, 'Live off must dispose crystal instance immediately');
  assert.equal(clock.rafs.size, 0, 'Live off must cancel pending crystal rAF');
  assert.equal(ctl.getActiveCrystalTrack(), null);
  ctl.setCrystalPointerClient(80, 80);
  clock.flushRafs(16);
  assert.equal(stepCount, stepsBeforeOff, 'Pointer updates after off must not step disposed crystal instance');

  // 1e) Re-enable off -> on restores bar & mounts fresh crystal instance
  html.setAttribute('data-ag-cs-effort-slider', 'on');
  ctl.syncModelSelectorPanel({ isOrchestrator: true, brand: 'antigravity', tier: 'auto' });
  clock.flushRafs(16);
  assert.ok(panel.querySelector('[data-testid="orchestrator-effort-bar"]'));
  assert.equal(mountCount, 2);
  ctl.teardownCrystalMount();
});

// ── 2. vendor/effort-slider/slider-coexist.js: #2b 'on' vs 'auto' + 'off' hide CSS ──
test('slider-coexist (#2b): "auto" yields to external slider, "on" forcefully mounts built-in over external, and "off" injects orchestrator-effort-bar hide rule', () => {
  const sliderMod = require(path.join(ROOT, 'vendor', 'effort-slider', 'slider-coexist.js'));
  const { doc, head, body, makeEl } = createMiniDom();

  const observers = [];
  class TrackingMO {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = false;
      observers.push(this);
    }
    observe() {}
    disconnect() { this.disconnected = true; }
    takeRecords() { return []; }
  }

  let extStopCalls = 0;
  let extRescanCalls = 0;
  const extInst = {
    stop() { extStopCalls += 1; },
    rescan() { extRescanCalls += 1; },
  };
  const win = {
    document: doc,
    MutationObserver: TrackingMO,
    matchMedia: () => ({ matches: false }),
    __agCodexEffortSliderInstance: extInst,
  };

  // External style element without Prism owner attr
  const extStyle = makeEl('style');
  extStyle.id = 'ag-codex-effort-slider-styles';
  head.appendChild(extStyle);

  const ctl = sliderMod.createEffortSliderController({ window: win, document: doc });

  // 2a) mode='auto' yields politely to external instance
  const stAuto = ctl.sync({ effortSliderModule: 'auto' });
  assert.equal(stAuto.mode, 'auto');
  assert.equal(stAuto.yieldedToExternal, true);
  assert.equal(stAuto.mountedPrism, false);
  assert.equal(extStopCalls, 0, 'auto mode must NOT stop external instance');
  assert.equal(extRescanCalls, 1, 'auto mode should rescan external instance');
  assert.equal(observers.length, 0, 'auto yield must create 0 built-in MutationObservers');

  // 2b) mode='on' takes authoritative control, stops external instance, mounts built-in
  const stOn = ctl.sync({ effortSliderModule: 'on' });
  assert.equal(stOn.mode, 'on');
  assert.equal(stOn.mountedPrism, true, 'mode="on" must mount built-in slider even when external slider exists');
  assert.equal(stOn.yieldedToExternal, false, 'mode="on" must report yieldedToExternal=false');
  assert.equal(extStopCalls, 1, 'mode="on" must stop replaced external instance');
  assert.equal(win.__agCodexEffortSliderInstance.__prismOwned, true);
  assert.equal(doc.getElementById('ag-codex-effort-slider-styles')?.getAttribute('data-ag-prism-slider'), '1');
  assert.ok(observers.length >= 1);

  // 2c) mode='off' stops built-in and injects hide CSS covering orchestrator-effort-bar
  const stOff = ctl.sync({ effortSliderModule: 'off' });
  assert.equal(stOff.mode, 'off');
  assert.equal(stOff.mountedPrism, false);
  assert.equal(stOff.yieldedToExternal, false);
  assert.equal(win.__agCodexEffortSliderInstance, undefined);
  const hideStyle = doc.getElementById('ag-prism-effort-slider-hide');
  assert.ok(hideStyle, 'mode="off" must inject #ag-prism-effort-slider-hide');
  assert.ok(
    hideStyle.textContent.includes('[data-testid="orchestrator-effort-bar"]{display:none!important}'),
    'HIDE_CSS_TEXT must include [data-testid="orchestrator-effort-bar"]{display:none!important} fallback'
  );
  ctl.destroy();
  assert.equal(doc.getElementById('ag-prism-effort-slider-hide'), null);
});

// ── 3. prism-rim-canvas.js: 1A high-FPS unlock + #8b palette='host' + idle/micro-move guards ──
test('prism-rim-canvas (1A & #8b): follows targetFps (native/180/120/60) without 16ms cap, preserves <1.5px skip & 1800ms VRAM zeroing, and fixes light palette="host"', () => {
  const src = fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8');
  const clock = makeFakeClock(1000);
  const { doc, html, body, makeEl } = createMiniDom();
  const winBus = makeEventBus();

  let strokeCount = 0;
  let lastGradientStops = [];
  const createdCanvases = [];
  const origCreateEl = doc.createElement;
  doc.createElement = (tag) => {
    const el = origCreateEl(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      el.width = 0;
      el.height = 0;
      el.getContext = () => ({
        globalAlpha: 1,
        lineWidth: 1,
        strokeStyle: null,
        clearRect() {},
        save() {},
        restore() {},
        translate() {},
        beginPath() {},
        roundRect() {},
        createRadialGradient() {
          const stops = [];
          return {
            addColorStop(offset, color) { stops.push([offset, color]); },
            _stops: stops,
          };
        },
        stroke() {
          strokeCount += 1;
          if (this.strokeStyle?._stops) lastGradientStops = this.strokeStyle._stops;
        },
      });
      createdCanvases.push(el);
    }
    return el;
  };

  const box = makeEl('div');
  box.setAttribute('data-ag-cs-prism-box', '1');
  box.getBoundingClientRect = () => ({ left: 100, top: 100, right: 400, bottom: 200, width: 300, height: 100 });
  body.appendChild(box);

  const sb = {
    document: doc,
    devicePixelRatio: 1,
    performance: clock.performance,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getComputedStyle: () => ({ borderTopLeftRadius: '12px' }),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    Math, Number, String, Boolean, Array, Object, Map, Set,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);

  let gapMs = 0;
  let isDark = true;
  const ctl = sb.__agPrismRimCanvas.createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => isDark,
    motionReduced: () => false,
    getMinFrameGapMs: () => gapMs,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'follow',
    canMountRealCanvas: () => true,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });

  // 3a) native (gap=0): 240Hz pointer frames (4.17ms apart) draw every frame without 16ms cap
  gapMs = 0;
  let px = 120;
  for (let i = 0; i < 4; i++) {
    px += 12;
    ctl.onPointerMove({ clientX: px, clientY: 140 });
    clock.flushRafs(4.17);
  }
  assert.equal(strokeCount, 4, 'native targetFps (0ms) must draw every 240Hz frame without 16ms cap');

  // 3b) 180Hz (gap=4.8ms): 3.5ms skips, next +2ms (5.5ms total) draws
  gapMs = 4.8;
  strokeCount = 0;
  px += 12;
  ctl.onPointerMove({ clientX: px, clientY: 140 });
  clock.flushRafs(3.5);
  assert.equal(strokeCount, 0, '180Hz (4.8ms) must throttle 3.5ms interval');
  clock.flushRafs(2.0);
  assert.equal(strokeCount, 1, '180Hz (4.8ms) must draw once 5.5ms elapsed');

  // 3c) 120Hz (gap=7.5ms): 6ms skips, +2.5ms (8.5ms total) draws
  gapMs = 7.5;
  strokeCount = 0;
  px += 12;
  ctl.onPointerMove({ clientX: px, clientY: 140 });
  clock.flushRafs(6.0);
  assert.equal(strokeCount, 0, '120Hz (7.5ms) must throttle 6ms interval');
  clock.flushRafs(2.5);
  assert.equal(strokeCount, 1, '120Hz (7.5ms) must draw once 8.5ms elapsed');

  // 3d) 60Hz (gap=15.2ms): 10ms skips, +6ms (16ms total) draws
  gapMs = 15.2;
  strokeCount = 0;
  px += 12;
  ctl.onPointerMove({ clientX: px, clientY: 140 });
  clock.flushRafs(10.0);
  assert.equal(strokeCount, 0, '60Hz (15.2ms) must throttle 10ms interval');
  clock.flushRafs(6.0);
  assert.equal(strokeCount, 1, '60Hz (15.2ms) must draw once 16ms elapsed');

  // 3e) < 0.5px micro-jitter skips redraw while 1.0px fine move draws smoothly under native (0ms)
  gapMs = 0;
  strokeCount = 0;
  ctl.onPointerMove({ clientX: px + 0.3, clientY: 140.2 });
  clock.flushRafs(5);
  assert.equal(strokeCount, 0, '<0.5px micro-jitter must skip redraw');
  ctl.onPointerMove({ clientX: px + 1.3, clientY: 140.2 });
  clock.flushRafs(5);
  assert.equal(strokeCount, 1, '1.0px fine move must trigger crisp rim redraw');
  px += 1.3;

  // 3f) #8b Light mode palette='host' vs 'obsidian' vs 'warm' under alabaster preset
  isDark = false;
  html.setAttribute('data-ag-cs-accent', 'follow');
  html.setAttribute('data-ag-cs-light-preset', 'alabaster');

  html.setAttribute('data-ag-cs-palette', 'obsidian');
  px += 12;
  ctl.onPointerMove({ clientX: px, clientY: 140 });
  clock.flushRafs(5);
  assert.equal(lastGradientStops[0][1], '#9A3412', 'Light obsidian + alabaster must use warm rim stops');

  html.setAttribute('data-ag-cs-palette', 'host');
  px += 12;
  ctl.onPointerMove({ clientX: px, clientY: 140 });
  clock.flushRafs(5);
  assert.equal(lastGradientStops[0][1], '#2563EB', 'Light host + alabaster must stay default blue rim stops');

  html.setAttribute('data-ag-cs-palette', 'warm');
  px += 12;
  ctl.onPointerMove({ clientX: px, clientY: 140 });
  clock.flushRafs(5);
  assert.equal(lastGradientStops[0][1], '#9A3412', 'Light warm palette must keep warm rim stops');

  // 3g) Idle VRAM reclaim after 1800ms when pointer leaves box range
  assert.ok(createdCanvases[0].width > 0);
  ctl.onPointerMove({ clientX: 900, clientY: 900 });
  clock.flushRafs(5);
  clock.advanceTimers(1850);
  assert.equal(createdCanvases[0].width, 0, 'Cleared rim canvas must zero VRAM after 1800ms idle');
  assert.equal(createdCanvases[0].height, 0);

  ctl.teardown();
});

// ── 4. home-ripple-host.js: #4 ambient=0 press guard + 1A active high-FPS + #8b palette='host' ──
test('home-ripple-host (#4, 1A, #8b): ambient=0 blocks click disturb/rAF, active ripple unlocks targetFps while low-energy stays 33ms, and light palette="host" avoids alabaster warm tint', () => {
  const src = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
  const clock = makeFakeClock(1000);
  const { doc, html, body, makeEl } = createMiniDom();
  const winBus = makeEventBus();

  const home = makeEl('div');
  home.className = 'agy-home';
  home.clientWidth = 1000;
  home.clientHeight = 600;
  home.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
  body.appendChild(home);

  const origCreateEl = doc.createElement;
  doc.createElement = (tag) => {
    const el = origCreateEl(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      el.width = 300;
      el.height = 150;
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
    }
    return el;
  };

  const sb = {
    document: doc,
    devicePixelRatio: 1,
    performance: clock.performance,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    Float32Array, Math, Number, String, Boolean, Array, Object, Map, Set,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);

  let ambientVal = 0;
  let gapMs = 0;
  let isDark = false;
  let waveActive = false;
  let fieldBusy = false;
  let disturbCalls = 0;
  let mascotPressCalls = 0;
  let fieldDrawCalls = 0;
  let lastPal = null;
  let lastGlowOpts = null;

  const rippleCore = {
    RIPPLE: { cellWidth: 16, cellHeight: 24 },
    parseCssColorToRgb: () => null,
    createWaveField: () => ({
      height: new Float32Array(1),
      active: () => waveActive,
      disturb() { disturbCalls += 1; waveActive = true; },
      skimmer() {},
      advance() {},
    }),
    createGlyphField: () => ({
      mode: 'webgl2',
      busy: () => fieldBusy || waveActive,
      needsDraw: () => fieldBusy || waveActive,
      setCalmZones() {},
      invalidate() {},
      draw(_now, pal) {
        fieldDrawCalls += 1;
        lastPal = pal;
      },
      dispose() {},
    }),
    mountBrandHorizonGlow: (cv) => ({
      mode: 'webgl2',
      resize(w, h, dpr) { cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr)); },
      releaseBackingStore() { cv.width = 0; cv.height = 0; },
      invalidate() {},
      clear() {},
      draw(_now, opts) { lastGlowOpts = opts; },
      dispose() {},
    }),
  };

  const ctl = sb.__agPrismHomeRippleHost.createHomeRippleController({
    rippleCore,
    isDestroyed: () => false,
    isAllowed: () => true,
    isDarkTheme: () => isDark,
    motionReduced: () => false,
    getMinFrameGapMs: () => gapMs,
    getAmbientIntensity: () => ambientVal,
    getAccentTone: () => 'follow',
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    onPointerPressMascot: () => { mascotPressCalls += 1; },
  });

  // 4a) #4 ambientIntensity = 0 -> initial draw sleeps cleanly, then click does 0 disturb & 0 rAF
  ctl.sync();
  clock.flushRafs(16);
  const m = ctl.getMount();
  assert.equal(m.sleeping, true);
  assert.equal(clock.rafs.size, 0);

  m.onPress({ button: 0, clientX: 240, clientY: 180 });
  assert.equal(disturbCalls, 0, 'ambient=0 click must perform 0 disturb() calls');
  assert.equal(clock.rafs.size, 0, 'ambient=0 click must schedule 0 rAF frames');
  assert.equal(mascotPressCalls, 0);
  assert.equal(m.sleeping, true);

  // 4b) #8b Light mode palette='host' vs 'obsidian' vs 'warm' under alabaster preset
  ambientVal = 1;
  isDark = false;
  html.setAttribute('data-ag-cs-accent', 'follow');
  html.setAttribute('data-ag-cs-light-preset', 'alabaster');

  html.setAttribute('data-ag-cs-palette', 'obsidian');
  ctl.refreshTheme();
  clock.flushRafs(16);
  assert.equal(lastGlowOpts.spectrum, 'warm');
  assert.deepEqual(Array.from(lastPal.wave), [194, 89, 52], 'Light obsidian + alabaster must use warm wave RGB');

  html.setAttribute('data-ag-cs-palette', 'host');
  ctl.refreshTheme();
  clock.flushRafs(16);
  assert.equal(lastGlowOpts.spectrum, 'default');
  assert.deepEqual(Array.from(lastPal.wave), [37, 99, 235], 'Light host + alabaster must stay default blue wave RGB');

  html.setAttribute('data-ag-cs-palette', 'warm');
  ctl.refreshTheme();
  clock.flushRafs(16);
  assert.equal(lastGlowOpts.spectrum, 'warm');
  assert.deepEqual(Array.from(lastPal.wave), [194, 89, 52]);

  // 4c) 1A Active ripple pulse follows targetFps (native/180/120/60) without 16ms cap
  clock.now = 5000; // past intro window
  m.onPress({ button: 0, clientX: 300, clientY: 220 });
  assert.equal(disturbCalls, 1);
  assert.equal(waveActive, true);
  clock.flushRafs(16); // prime lastRippleRenderAt

  // native (0ms): 240Hz (4.17ms) renders every frame
  gapMs = 0;
  fieldDrawCalls = 0;
  for (let i = 0; i < 4; i++) clock.flushRafs(4.17);
  assert.equal(fieldDrawCalls, 4, 'Active ripple under native (0ms) must render every 240Hz frame');

  // 180Hz (4.8ms): 3.5ms skips, +2ms draws
  gapMs = 4.8;
  fieldDrawCalls = 0;
  clock.flushRafs(3.5);
  assert.equal(fieldDrawCalls, 0, 'Active ripple under 180Hz (4.8ms) must skip 3.5ms frame');
  clock.flushRafs(2.0);
  assert.equal(fieldDrawCalls, 1, 'Active ripple under 180Hz (4.8ms) must draw once 5.5ms elapsed');

  // 120Hz (7.5ms): 5ms skips, +3.5ms draws
  gapMs = 7.5;
  fieldDrawCalls = 0;
  clock.flushRafs(5.0);
  assert.equal(fieldDrawCalls, 0);
  clock.flushRafs(3.5);
  assert.equal(fieldDrawCalls, 1);

  // 60Hz (15.2ms): 10ms skips, +6ms draws
  gapMs = 15.2;
  fieldDrawCalls = 0;
  clock.flushRafs(10.0);
  assert.equal(fieldDrawCalls, 0);
  clock.flushRafs(6.0);
  assert.equal(fieldDrawCalls, 1);

  // 4d) Low-energy / afterglow tail (waveActive=false, fieldBusy=true) still keeps 33ms power-saving cadence
  waveActive = false;
  fieldBusy = true;
  gapMs = 0;
  fieldDrawCalls = 0;
  clock.flushRafs(3.3);
  assert.equal(fieldDrawCalls, 0, 'Low-energy tail must retain 33ms power-saving floor even when rawGap=0');
  assert.equal(clock.rafs.size, 0);
  assert.equal(clock.timers.size, 1, 'Low-energy 300Hz frame should align via setTimeout');

  // And when fieldBusy settles, returns cleanly to 0fps idle sleep
  fieldBusy = false;
  clock.advanceTimers(40);
  clock.flushRafs(4);
  assert.equal(m.sleeping, true);
  assert.equal(clock.rafs.size, 0);
  ctl.unmount();
});

// ── 5. vendor/omni-viewer/omni-client.js: #7c omniModule='off' disconnects rootAttrObserver & restores cleanly ──
test('omni-client (#7c): sync({ omniModule: "off" }) disconnects rootAttrObserver with 0 active observers, cleans root attrs, and restores on re-enable', () => {
  const omniMod = require(path.join(ROOT, 'vendor', 'omni-viewer', 'omni-client.js'));
  const { doc, html, head, body, makeEl } = createMiniDom();

  const activeObservers = new Set();
  let observerCreations = 0;
  class TrackingMO {
    constructor(cb) {
      this.cb = cb;
      this.target = null;
      observerCreations += 1;
    }
    observe(target, opts) {
      this.target = target;
      this.opts = opts;
      activeObservers.add(this);
    }
    disconnect() {
      activeObservers.delete(this);
    }
  }

  const winBus = makeEventBus();
  const win = {
    document: doc,
    MutationObserver: TrackingMO,
    addEventListener: (t, fn) => winBus.add(t, fn),
    removeEventListener: (t, fn) => winBus.remove(t, fn),
    location: { href: 'http://127.0.0.1/test', origin: 'http://127.0.0.1' },
  };
  doc.defaultView = win;
  doc.createTextNode = (t) => ({
    nodeType: 3,
    nodeValue: String(t ?? ''),
    get textContent() { return this.nodeValue; },
    parentNode: null,
    parentElement: null,
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
  });
  doc.createDocumentFragment = () => makeEl('#fragment');

  const client = omniMod.createOmniClient({ window: win, document: doc });

  // 5a) Cold start with omniModule='off' creates 0 observers (no rootAttrObserver, no domObserver)
  const stColdOff = client.sync({ omniModule: 'off' });
  assert.equal(stColdOff.enabled, false);
  assert.equal(stColdOff.mounted, false);
  assert.equal(observerCreations, 0, 'Cold omniModule="off" must NOT create rootAttrObserver');
  assert.equal(activeObservers.size, 0);

  // 5b) Turn on -> mounts rootAttrObserver (on html) + domObserver (on body) + style
  const stOn = client.sync({ omniModule: 'on', linkTarget: 'builtin' });
  assert.equal(stOn.enabled, true);
  assert.equal(stOn.mounted, true);
  assert.equal(html.getAttribute('data-ag-prism-omni'), 'on');
  assert.equal(html.getAttribute('data-ag-prism-link-target'), 'builtin');
  assert.ok(head.querySelector('#ag-prism-omni-css') || doc.getElementById('ag-prism-omni-css'));
  assert.equal(activeObservers.size, 2, 'Enabled omni must observe root attrs + DOM mutations');
  assert.ok([...activeObservers].some((o) => o.target === html), 'rootAttrObserver must observe <html> while enabled');

  // Simulate hover token attribute left on <html>
  html.setAttribute('data-ag-omni-hover-token', '1');

  // 5c) Turn off -> detachRuntime(true) disconnects BOTH domObserver & rootAttrObserver and clears root attrs
  const stOff = client.sync({ omniModule: 'off' });
  assert.equal(stOff.enabled, false);
  assert.equal(stOff.mounted, false);
  assert.equal(activeObservers.size, 0, 'omniModule="off" must disconnect rootAttrObserver & domObserver leaving 0 active observers');
  assert.equal(doc.getElementById('ag-prism-omni-css'), null, 'omniModule="off" must remove injected stylesheet');
  assert.equal(html.hasAttribute('data-ag-prism-omni'), false);
  assert.equal(html.hasAttribute('data-ag-prism-link-target'), false);
  assert.equal(html.hasAttribute('data-ag-omni-hover-token'), false);

  // 5d) Re-enable -> cleanly restores rootAttrObserver + domObserver + style + root attrs
  const stReOn = client.sync({ omniModule: 'on', linkTarget: 'external' });
  assert.equal(stReOn.enabled, true);
  assert.equal(stReOn.mounted, true);
  assert.equal(stReOn.linkTarget, 'external');
  assert.equal(activeObservers.size, 2, 'Re-enabling omniModule="on" must restore both observers cleanly');
  assert.ok([...activeObservers].some((o) => o.target === html));
  assert.equal(html.getAttribute('data-ag-prism-omni'), 'on');
  assert.equal(html.getAttribute('data-ag-prism-link-target'), 'external');

  client.destroy();
  assert.equal(activeObservers.size, 0);
});
