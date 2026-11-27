// 输入框桌宠栖息地 11 款像素摆件池与纯 GPU 三层环境光回归单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const rig = require(path.join(ROOT, 'dual-mascot-rig.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

const ALL_11_MODES = [
  'lamp', 'lantern', 'candle', 'campfire',
  'crystal', 'starjar',
  'cactus', 'hourglass', 'coffee', 'books', 'vinyl',
];
const WARM_MODES = ['lamp', 'lantern', 'candle', 'campfire'];
const PRISM_MODES = ['crystal', 'starjar'];
const STILL_MODES = ['cactus', 'hourglass', 'coffee', 'books', 'vinyl'];

function createHabitatMockEnv({ width = 720, theme = 'dark', accent = 'follow', palette = 'obsidian' } = {}) {
  const byId = new Map();
  const rootMos = [];
  const gradientCalls = [];

  const makeEl = (tag) => {
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      clientWidth: width,
      width: 96,
      height: 84,
      dataset: {},
      parentNode: null,
      children,
      isConnected: true,
      style: {
        display: '', zIndex: '', transform: '', transition: '', cursor: '',
        pointerEvents: '', backgroundImage: '', overflow: '',
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') {
          if (el.id) byId.delete(el.id);
          el.id = String(v);
          byId.set(el.id, el);
        }
        if (k === 'data-ag-cs-perf-mode') el.dataset.agCsPerfMode = String(v);
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'data-ag-cs-perf-mode') delete el.dataset.agCsPerfMode;
      },
      appendChild(ch) {
        if (ch.parentNode && ch.parentNode.children) {
          const prevIdx = ch.parentNode.children.indexOf(ch);
          if (prevIdx >= 0) ch.parentNode.children.splice(prevIdx, 1);
        }
        children.push(ch);
        ch.parentNode = el;
        if (ch.id) byId.set(ch.id, ch);
        return ch;
      },
      insertBefore(ch, ref) {
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, ch);
        else children.push(ch);
        ch.parentNode = el;
        if (ch.id) byId.set(ch.id, ch);
        return ch;
      },
      removeChild(ch) {
        const idx = children.indexOf(ch);
        if (idx >= 0) children.splice(idx, 1);
        ch.parentNode = null;
        if (ch.id && byId.get(ch.id) === ch) byId.delete(ch.id);
        return ch;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
        if (el.id && byId.get(el.id) === el) byId.delete(el.id);
      },
      addEventListener(t, fn) {
        if (!listeners.has(t)) listeners.set(t, new Set());
        listeners.get(t).add(fn);
      },
      removeEventListener(t, fn) { listeners.get(t)?.delete(fn); },
      getBoundingClientRect() {
        return { left: 0, right: el.width || width, top: 0, bottom: el.height || 84, width: el.width || width, height: el.height || 84 };
      },
      getContext(kind) {
        if (kind !== '2d') return null;
        if (!el._mockCtx) {
          el._mockCtx = {
            fillStyle: '',
            globalCompositeOperation: 'source-over',
            imageSmoothingEnabled: false,
            setTransform() {}, clearRect() {}, save() {}, restore() {},
            translate() {}, scale() {}, rotate() {}, beginPath() {}, rect() {}, clip() {},
            fillRect() {}, drawImage() {},
            createRadialGradient(x0, y0, r0, x1, y1, r1) {
              const stops = [];
              const rec = { canvas: el, x0, y0, r0, x1, y1, r1, stops };
              gradientCalls.push(rec);
              return { addColorStop(o, col) { stops.push([o, col]); } };
            },
          };
        }
        return el._mockCtx;
      },
    };
    return el;
  };

  const html = makeEl('html');
  html.setAttribute('data-ag-cs-theme', theme);
  html.setAttribute('data-ag-cs-accent', accent);
  html.setAttribute('data-ag-cs-palette', palette);
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  class MockMO {
    constructor(cb) { this.cb = cb; this.target = null; this.filter = null; rootMos.push(this); }
    observe(target, opts) { this.target = target; this.filter = opts?.attributeFilter || null; }
    disconnect() { this.disconnected = true; }
  }

  const win = {
    devicePixelRatio: 1,
    MutationObserver: MockMO,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };

  const doc = {
    hidden: false,
    documentElement: html,
    head,
    body,
    defaultView: win,
    createElement(tag) {
      const n = makeEl(tag);
      n.ownerDocument = doc;
      return n;
    },
    getElementById(id) { return byId.get(id) || null; },
    querySelector(sel) {
      if (sel && sel.startsWith('#')) return byId.get(sel.slice(1)) || null;
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  html.ownerDocument = head.ownerDocument = body.ownerDocument = doc;
  const hostEl = doc.createElement('div');
  body.appendChild(hostEl);

  const notifyRootAttr = (attrName) => {
    for (const mo of rootMos) {
      if (!mo.disconnected && mo.target === html && (!mo.filter || mo.filter.includes(attrName))) {
        mo.cb([{ type: 'attributes', target: html, attributeName: attrName }]);
      }
    }
  };

  return { doc, win, html, head, body, hostEl, byId, gradientCalls, notifyRootAttr };
}

test('1) All 11 habitat pixel props render valid non-empty 24x30 crispEdges SVGs with 0 invalid palette chars', () => {
  assert.deepEqual([...rig.HABITAT_MODES], ALL_11_MODES);
  const env = createHabitatMockEnv();
  const stage = rig.mountDualMascotStage(env.hostEl, { miniPileEnabled: false, reducedMotion: true, habitatSeed: 0 });
  try {
    const habEl = env.hostEl.children.find((n) => n.className === 'ag-v2-habitat-prop');
    assert.ok(habEl, 'habitatEl must be mounted in stage');
    assert.equal(habEl.tagName, 'DIV');

    const seenSvgs = new Set();
    for (const mode of ALL_11_MODES) {
      const ret = stage.setHabitatPreview(mode);
      assert.equal(ret, mode, `setHabitatPreview('${mode}') must return '${mode}'`);
      assert.equal(habEl.getAttribute('data-habitat-mode'), mode);

      const bg = String(habEl.style.backgroundImage || '');
      assert.ok(bg.startsWith('url("data:image/svg+xml,'), `${mode} must render SVG DataURI`);
      const encoded = bg.slice('url("data:image/svg+xml,'.length, -2);
      const svg = decodeURIComponent(encoded);
      assert.ok(svg.includes('width="24" height="30" viewBox="0 0 24 30" shape-rendering="crispEdges"'), `${mode} SVG must use 24x30 crispEdges`);
      const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="([^"]+)"\/>/g)];
      assert.ok(rects.length >= 6, `${mode} must contain rich pixel geometry (>=6 rects, got ${rects.length})`);
      for (const [, x, y, w, h, fill] of rects) {
        assert.ok(+x >= 0 && +x + +w <= 24, `${mode} rect x=${x} w=${w} out of 24px bounds`);
        assert.ok(+y >= 0 && +y + +h <= 30, `${mode} rect y=${y} h=${h} out of 30px bounds`);
        assert.ok(fill && fill !== 'undefined', `${mode} rect fill must be defined`);
      }
      assert.equal(seenSvgs.has(svg), false, `${mode} SVG must be visually distinct from other props`);
      seenSvgs.add(svg);
    }
    assert.equal(seenSvgs.size, 11);
  } finally {
    stage.dispose();
  }
});

test('2) Exactly 6 light props set data-habitat-light="warm"|"prism" and 5 still-life props omit data-habitat-light', () => {
  const env = createHabitatMockEnv();
  const stage = rig.mountDualMascotStage(env.hostEl, { miniPileEnabled: false, reducedMotion: true, habitatSeed: 0 });
  try {
    const habEl = env.hostEl.children.find((n) => n.className === 'ag-v2-habitat-prop');
    for (const m of WARM_MODES) {
      stage.setHabitatPreview(m);
      assert.equal(habEl.getAttribute('data-habitat-light'), 'warm', `${m} must set data-habitat-light="warm"`);
      assert.equal(stage.getDebugState().habitat.lightKind, 'warm');
      assert.equal(stage.getDebugState().habitat.poolSize, 11);
    }
    for (const m of PRISM_MODES) {
      stage.setHabitatPreview(m);
      assert.equal(habEl.getAttribute('data-habitat-light'), 'prism', `${m} must set data-habitat-light="prism"`);
      assert.equal(stage.getDebugState().habitat.lightKind, 'prism');
    }
    for (const m of STILL_MODES) {
      stage.setHabitatPreview(m);
      assert.equal(habEl.getAttribute('data-habitat-light'), null, `${m} still-life must NOT set data-habitat-light`);
      assert.equal(habEl.hasAttribute('data-habitat-light'), false);
      assert.equal(stage.getDebugState().habitat.lightKind, null);
      assert.equal(stage.getDebugState().habitat.clawdLightStrength, 0);
    }
    // Invalid preview name safely falls back to auto
    const fallback = stage.setHabitatPreview('non-existent-prop');
    assert.ok(ALL_11_MODES.includes(fallback));
  } finally {
    stage.dispose();
  }
});

test('3) Deterministic diurnal 4-slot auto rotation + /schedule 30-minute hourglass override', () => {
  const mkTime = (hour, minute = 15) => new Date(2026, 10, 27, hour, minute, 0, 0).getTime();

  // Night (21:00 - 05:59): all 6 light props
  const nightPool = new Set(['lamp', 'lantern', 'candle', 'campfire', 'crystal', 'starjar']);
  const seenNight = new Set();
  for (const h of [21, 22, 23, 0, 1, 2, 3, 4, 5]) {
    for (let seed = 0; seed < 6; seed++) {
      const m = rig.resolveHabitatModeForTime(mkTime(h), seed, 0);
      assert.ok(nightPool.has(m), `Night hour ${h} seed ${seed} picked unexpected prop "${m}"`);
      seenNight.add(m);
    }
  }
  assert.equal(seenNight.size, 6, 'Night pool should cover all 6 light props across hours/seeds');

  // Morning (06:00 - 10:59): coffee, cactus, books
  const morningPool = new Set(['coffee', 'cactus', 'books']);
  for (const h of [6, 7, 8, 9, 10]) {
    const m = rig.resolveHabitatModeForTime(mkTime(h), 2, 0);
    assert.ok(morningPool.has(m), `Morning hour ${h} picked unexpected prop "${m}"`);
    // Same hour must stay stable across minutes (no jitter/flicker)
    assert.equal(rig.resolveHabitatModeForTime(mkTime(h, 59), 2, 0), m, `Hour ${h} must remain stable within the hour`);
  }

  // Afternoon (11:00 - 16:59): cactus, coffee, books, vinyl, crystal
  const afternoonPool = new Set(['cactus', 'coffee', 'books', 'vinyl', 'crystal']);
  for (const h of [11, 12, 13, 14, 15, 16]) {
    const m = rig.resolveHabitatModeForTime(mkTime(h), 3, 0);
    assert.ok(afternoonPool.has(m), `Afternoon hour ${h} picked unexpected prop "${m}"`);
  }

  // Evening (17:00 - 20:59): lantern, lamp, starjar, candle, vinyl
  const eveningPool = new Set(['lantern', 'lamp', 'starjar', 'candle', 'vinyl']);
  for (const h of [17, 18, 19, 20]) {
    const m = rig.resolveHabitatModeForTime(mkTime(h), 4, 0);
    assert.ok(eveningPool.has(m), `Evening hour ${h} picked unexpected prop "${m}"`);
  }

  // /schedule override takes priority for 30 minutes and then returns to diurnal slot
  let fakeNow = mkTime(23, 0);
  const env = createHabitatMockEnv();
  const stage = rig.mountDualMascotStage(env.hostEl, {
    miniPileEnabled: false,
    reducedMotion: true,
    habitatSeed: 1,
    getNow: () => fakeNow,
  });
  try {
    const nightBefore = stage.getDebugState().habitat.mode;
    assert.ok(nightPool.has(nightBefore));
    stage.notify('slash-cmd', { cmd: 'schedule' });
    assert.equal(stage.getDebugState().habitat.mode, 'hourglass');
    assert.equal(stage.getDebugState().habitat.scheduleActive, true);
    // 29 min later: still hourglass
    fakeNow += 29 * 60 * 1000;
    assert.equal(stage.getDebugState().habitat.mode, 'hourglass');
    // 31 min later: naturally returns to night light prop
    fakeNow += 2 * 60 * 1000;
    assert.equal(stage.getDebugState().habitat.scheduleActive, false);
    assert.equal(stage.getDebugState().habitat.mode, nightBefore);
  } finally {
    stage.dispose();
  }
});

test('4) pointer-events: none, 3-layer GPU CSS hygiene (0 filter:blur, 0 :has(, 0 innerHTML, light-theme dim, pause rules) & Ch1 +0B / mascot<=131072B', () => {
  const env = createHabitatMockEnv();
  const stage = rig.mountDualMascotStage(env.hostEl, { miniPileEnabled: false, reducedMotion: true });
  try {
    const habEl = env.hostEl.children.find((n) => n.className === 'ag-v2-habitat-prop');
    assert.equal(habEl.style.pointerEvents, 'none', 'habitatEl inline pointerEvents must be none');

    const styleEl = env.doc.getElementById(rig.HABITAT_LIGHT_STYLE_ID);
    assert.ok(styleEl, 'Habitat light <style> must be injected in Ch10 on mount');
    assert.equal(styleEl.getAttribute('data-ag-owned'), '1');
    const css = styleEl.textContent;
    assert.equal(css, rig.HABITAT_LIGHT_CSS);

    // Pure GPU 0-Paint & security redlines
    assert.equal(/filter\s*:\s*blur\s*\(/i.test(css), false, 'Must NEVER use filter: blur()');
    assert.equal(/:has\(/i.test(css), false, 'Must NEVER use :has()');
    assert.equal(/steps\(/i.test(css), false, 'Must NEVER use low-fps steps()');
    assert.ok(/^[\x00-\x7F]*$/.test(css), 'CSS must be 100% ASCII');
    assert.ok(css.includes('.ag-v2-habitat-prop{') && css.includes('pointer-events:none!important'));

    // Layer 1 compact radial halo & Layer 2 all-around feathered top-edge glow (no hard box cutoff, stays within composer right edge)
    const rightInset = parseFloat(habEl.style.right);
    const propW = parseFloat(habEl.style.width);
    const propCenterFromRight = rightInset + propW / 2;
    assert.ok(rightInset >= 24, `habitatEl right inset (${rightInset}px) must sit well inside composer right border-radius (>=24px)`);
    const beforeRule = css.match(/\}\.ag-v2-habitat-prop\[data-habitat-light\]::before\{([^}]+)\}/);
    const afterRule = css.match(/\}\.ag-v2-habitat-prop\[data-habitat-light\]::after\{([^}]+)\}/);
    assert.ok(beforeRule && afterRule, 'Must define ::before halo and ::after top-edge glow rules');
    const beforeW = parseFloat(beforeRule[1].match(/width:(\d+)px/)?.[1]);
    const afterW = parseFloat(afterRule[1].match(/width:(\d+)px/)?.[1]);
    assert.ok(beforeW > 0 && beforeW <= 50, `::before halo width (${beforeW}px) must stay compact (<=50px)`);
    assert.ok(afterW > 0 && afterW <= 60, `::after pool width (${afterW}px) must stay compact (<=60px)`);
    assert.ok(propCenterFromRight - beforeW / 2 >= 10, `::before halo must stay inside right corner radius (margin=${propCenterFromRight - beforeW / 2}px)`);
    assert.ok(propCenterFromRight - afterW / 2 >= 10, `::after glow must stay inside right corner radius (margin=${propCenterFromRight - afterW / 2}px)`);
    assert.ok(beforeRule[1].includes('radial-gradient(circle closest-side at 50% 50%') && beforeRule[1].includes(',0)'));
    assert.ok(afterRule[1].includes('radial-gradient(ellipse closest-side at 50% 50%') && afterRule[1].includes(',0)'));
    assert.equal(afterRule[1].includes('50% 100%'), false, '::after must NOT anchor gradient center at 50% 100% (prevents flat bottom cutoff line)');
    assert.ok(css.includes('@keyframes ag-prism-hab-breath{0%,100%{opacity:.78}50%{opacity:1}}'));
    assert.ok(css.includes('ease-in-out infinite'));

    // Light theme dimming & accent/palette prism tracking
    assert.ok(css.includes('html[data-ag-cs-theme="light"] .ag-v2-habitat-prop[data-habitat-light]{--ag-prism-ha0:.16;--ag-prism-ha1:.065;--ag-prism-ha2:.02;--ag-prism-ga0:.12;--ag-prism-ga1:.04}'));
    assert.ok(css.includes('html[data-ag-cs-accent="cobalt"]'));
    assert.ok(css.includes('html[data-ag-cs-accent="iris"]'));
    assert.ok(css.includes('data-ag-cs-palette="warm"') && css.includes('data-ag-cs-palette="claude"'));

    // Performance / motion=off / win-blur / pp-open / prefers-reduced-motion pause rules
    for (const token of [
      'data-ag-cs-perf-mode="performance"',
      'data-ag-cs-perf-mode="eco"',
      'data-ag-cs-motion="off"',
      'data-ag-cs-win-blur="1"',
      'data-ag-pp-open="1"',
      'prefers-reduced-motion:reduce',
      'data-ag-cs-ignore-rm="1"',
      'animation:none!important',
    ]) {
      assert.ok(css.includes(token), `Habitat light CSS missing pause/guard token: ${token}`);
    }

    // Balanced braces/parens
    let braces = 0, parens = 0;
    for (const ch of css) {
      if (ch === '{') braces++; else if (ch === '}') braces--;
      if (ch === '(') parens++; else if (ch === ')') parens--;
      assert.ok(braces >= 0 && parens >= 0);
    }
    assert.equal(braces, 0);
    assert.equal(parens, 0);

    // Runtime mascot channel off => 0 B; enabled => <= 131,072 B
    const chMascot = cdp.findChannel('mascot');
    assert.equal(chMascot.build({ ...cdp.DEFAULT_CONFIG, mascot: 'off' }, { noDiskCache: true }), '');
    const compiledBytes = Buffer.byteLength(chMascot.build({ ...cdp.DEFAULT_CONFIG, mascot: 'crab' }, { noDiskCache: true }), 'utf8');
    assert.ok(compiledBytes <= 131072, `Ch10 mascot compiled ${compiledBytes} B exceeds 131072 B`);

    const rigSrc = fs.readFileSync(path.join(ROOT, 'dual-mascot-rig.js'), 'utf8');
    assert.equal(/\.innerHTML\s*=/.test(rigSrc), false);
  } finally {
    stage.dispose();
  }
});

test('5) Layer 3 Clawd proximity pixel lighting scales with distance, dims in light theme, adapts to prism accent, and preserves rc static cache (0 redraws when idle)', () => {
  // Narrow stage (320px -> habX=280): Clawd starts close to right side (strong light); wide stage (1200px -> habX=1160) or moved left: weak/zero
  const envNear = createHabitatMockEnv({ width: 320, theme: 'dark', accent: 'follow', palette: 'obsidian' });
  const stageNear = rig.mountDualMascotStage(envNear.hostEl, {
    camp: 'claude',
    mascot: 'r:c1',
    miniPileEnabled: false,
    reducedMotion: true,
    habitatSeed: 0,
  });

  try {
    // Switch to warm lamp -> Clawd is close to right-side lamp (stage width 320, habX=280)
    stageNear.setHabitatPreview('lamp');
    const snapLamp = stageNear.getDebugState();
    const clawdNear = snapLamp.actors.find((a) => a.id === 'clawd');
    assert.ok(clawdNear, 'Clawd must be mounted');
    assert.ok(snapLamp.habitat.clawdLightStrength > 0.3, `Expected strong proximity light when near lamp, got ${snapLamp.habitat.clawdLightStrength}`);
    assert.match(clawdNear.renderCache.tintState, /:h[1-9]\d*_[^:]*_amber_1$/, `Expected warm amber habitat rim in tintState, got ${clawdNear.renderCache.tintState}`);
    assert.ok(envNear.gradientCalls.length > 0, 'Expected source-atop radial gradient lighting drawn on Clawd canvas');

    // Static frame cache hit: repeated setRimLight(null) or stepTick(0) with unchanged pose/position => 0 canvas redraws!
    const drawsBeforeIdle = stageNear.getLayoutSnapshot().perf.canvasDraws;
    const skipsBeforeIdle = stageNear.getLayoutSnapshot().perf.canvasSkips;
    stageNear.stepTick(0);
    stageNear.stepTick(0);
    const snapAfterIdle = stageNear.getLayoutSnapshot();
    assert.equal(snapAfterIdle.perf.canvasDraws, drawsBeforeIdle, 'Static Clawd near lit habitat prop must incur 0 Canvas redraws');
    assert.ok(snapAfterIdle.perf.canvasSkips > skipsBeforeIdle, 'Static Clawd must hit rc frame cache');

    // Light theme automatically dims Clawd habitat light strength and updates tintState dark flag to 0
    envNear.html.setAttribute('data-ag-cs-theme', 'light');
    envNear.notifyRootAttr('data-ag-cs-theme');
    const snapLight = stageNear.getDebugState();
    assert.ok(
      snapLight.habitat.clawdLightStrength > 0 && snapLight.habitat.clawdLightStrength < snapLamp.habitat.clawdLightStrength,
      `Light theme must dim clawdLightStrength (${snapLamp.habitat.clawdLightStrength} -> ${snapLight.habitat.clawdLightStrength})`
    );
    assert.match(snapLight.actors[0].renderCache.tintState, /:h\d+_[^:]*_amber_0$/);

    // Switch to prism crystal + cobalt accent -> pixel rim shifts to cobalt tone
    envNear.html.setAttribute('data-ag-cs-theme', 'dark');
    envNear.html.setAttribute('data-ag-cs-accent', 'cobalt');
    envNear.notifyRootAttr('data-ag-cs-accent');
    stageNear.setHabitatPreview('crystal');
    const snapPrism = stageNear.getDebugState();
    assert.equal(snapPrism.habitat.lightKind, 'prism');
    assert.match(snapPrism.actors[0].renderCache.tintState, /:h[1-9]\d*_[^:]*_cobalt_1$/);

    // Switch to still-life books -> habitat light turns completely off (strength=0, no :h segment)
    stageNear.setHabitatPreview('books');
    const snapBooks = stageNear.getDebugState();
    assert.equal(snapBooks.habitat.clawdLightStrength, 0);
    assert.equal(snapBooks.actors[0].renderCache.tintState.includes(':h'), false);
  } finally {
    stageNear.dispose();
  }

  // Far away comparison: stage width 1200px, Clawd on far left (notify vial-high / left position) => lower/0 light than near
  const envFar = createHabitatMockEnv({ width: 1200, theme: 'dark' });
  const stageFar = rig.mountDualMascotStage(envFar.hostEl, {
    camp: 'gemini',
    mascot: 'crab',
    miniPileEnabled: false,
    reducedMotion: true,
    habitatSeed: 0,
  });
  try {
    stageFar.setHabitatPreview('lamp');
    // Force Clawd near far-left edge via drag or wider layout: compare near (320px) vs far (1200px)
    const snapFar = stageFar.getDebugState();
    const clawdFar = snapFar.actors.find((a) => a.id === 'clawd');
    const distToHab = (1200 - 40) - clawdFar.worldCx;
    if (distToHab >= 240) {
      assert.equal(snapFar.habitat.clawdLightStrength, 0, 'Clawd >240px away from lamp must decay to 0');
      assert.equal(clawdFar.renderCache.tintState.includes(':h'), false);
    } else {
      // Pull Clawd left via stage state or verify monotonic distance decay against near stage
      assert.ok(snapFar.habitat.clawdLightStrength <= 1);
    }
    // Directly verify monotonic decay when host widens while Clawd stays on left (popoverRightWidth pushes pets left away from right-corner lamp)
    stageFar.setState({ popoverRightWidth: 520 });
    const snapPushedLeft = stageFar.getDebugState();
    assert.equal(snapPushedLeft.habitat.clawdLightStrength, 0, 'Clawd pushed >240px left from right-corner lamp must have 0 habitat light');
    assert.equal(snapPushedLeft.actors.find((a) => a.id === 'clawd').renderCache.tintState.includes(':h'), false);
  } finally {
    stageFar.dispose();
  }
});

test('6) dispose() / destroy() cleanly removes #ag-prism-habitat-light-css and habitatEl with 0 DOM leftovers (ref-counted across multi-stage)', () => {
  const env = createHabitatMockEnv();
  const host2 = env.doc.createElement('div');
  env.body.appendChild(host2);

  const stage1 = rig.mountDualMascotStage(env.hostEl, { miniPileEnabled: false, reducedMotion: true });
  const stage2 = rig.mountDualMascotStage(host2, { miniPileEnabled: false, reducedMotion: true });

  assert.ok(env.doc.getElementById(rig.HABITAT_LIGHT_STYLE_ID), 'Style tag must exist while stages are mounted');
  assert.ok(env.hostEl.children.some((n) => n.className === 'ag-v2-habitat-prop'));
  assert.ok(host2.children.some((n) => n.className === 'ag-v2-habitat-prop'));

  // Disposing stage1 removes stage1 habitatEl but keeps shared <style> while stage2 is still alive
  stage1.destroy();
  assert.equal(env.hostEl.children.some((n) => n.className === 'ag-v2-habitat-prop'), false, 'stage1 habitatEl must be removed');
  assert.ok(env.doc.getElementById(rig.HABITAT_LIGHT_STYLE_ID), 'Shared style must stay while stage2 is alive');

  // Disposing stage2 removes stage2 habitatEl AND removes <style id="ag-prism-habitat-light-css"> completely
  stage2.dispose();
  assert.equal(host2.children.some((n) => n.className === 'ag-v2-habitat-prop'), false, 'stage2 habitatEl must be removed');
  assert.equal(env.doc.getElementById(rig.HABITAT_LIGHT_STYLE_ID), null, 'Style tag must be removed when last stage disposes');
  assert.equal(env.head.children.some((n) => n.id === rig.HABITAT_LIGHT_STYLE_ID), false, '0 residual style nodes in <head>');
});
