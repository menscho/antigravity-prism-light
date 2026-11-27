import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crystalCore = require('../crystal-prism-core.js');

test('crystal-prism-core computeProximityFactor enforces small 105px reaction radius and smooth falloff', () => {
  assert.equal(crystalCore.PROXIMITY_RADIUS_PX, 105);
  assert.ok(crystalCore.PROXIMITY_RADIUS_PX < 220, 'Crystal prism radius must be much smaller than input box 220px');

  const w = 248;
  const h = 28;

  // Inside the capsule -> 1.0
  assert.equal(crystalCore.computeProximityFactor(124, 14, w, h), 1);

  // Far away -> 0.0
  assert.equal(crystalCore.computeProximityFactor(124, 300, w, h), 0);
  assert.equal(crystalCore.computeProximityFactor(-9999, -9999, w, h), 0);

  // Mid-range 60px outside top edge (< 105px) -> strictly in (0, 1) and monotonic
  const f60 = crystalCore.computeProximityFactor(124, -60, w, h);
  const f30 = crystalCore.computeProximityFactor(124, -30, w, h);
  assert.ok(f60 > 0 && f60 < 1, `Expected 60px distance proximity in (0,1), got ${f60}`);
  assert.ok(f30 > f60 && f30 < 1, `Expected 30px proximity (${f30}) > 60px (${f60})`);
});

test('crystal-prism-core evaluateDeterministicGlints emits sparse stochastic sparkles and respects reduceMotion', () => {
  const reduced = crystalCore.evaluateDeterministicGlints(12.34, true);
  const reducedLater = crystalCore.evaluateDeterministicGlints(45.67, true);
  assert.deepEqual(reduced, reducedLater, 'reduceMotion glints must stay static over time');

  let activeSlotsPeak = 0;
  for (let i = 0; i < 60; i++) {
    const glints = crystalCore.evaluateDeterministicGlints(i * 0.25, false);
    assert.equal(glints.length, 4);
    const activeCount = glints.filter((g) => g.intensity > 0.15).length;
    if (activeCount > activeSlotsPeak) activeSlotsPeak = activeCount;
    assert.ok(activeCount <= 3, `Glints should stay sparse, not uniform sweep (${activeCount} active at step ${i})`);
  }
  assert.ok(activeSlotsPeak >= 1, 'Expected at least 1 pinpoint crystal glint over 15s window');
});

test('crystal-prism-core mountCrystalPrismBar renders zero-copy single WebGL2 pass with shader-etched lock and skips idle frames', () => {
  const prevDoc = globalThis.document;
  let extraCanvasesCreated = 0;
  let glDraws = 0;
  let twoDContextCalls = 0;
  const shaderSources = [];
  const uniforms = new Map();

  globalThis.document = {
    createElement() {
      extraCanvasesCreated++;
      throw new Error('Must not allocate offscreen glCanvas for cross-context blit');
    },
  };

  const mockGl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    COLOR_BUFFER_BIT: 0x4000,
    TRIANGLE_STRIP: 0x0005,
    createShader(type) { return { type, source: '' }; },
    shaderSource(sh, src) { sh.source = src; shaderSources.push(src); },
    compileShader() {},
    getShaderParameter() { return true; },
    getShaderInfoLog() { return ''; },
    deleteShader() {},
    createProgram() { return { id: 'crystal-prog' }; },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return true; },
    getProgramInfoLog() { return ''; },
    deleteProgram() {},
    createBuffer() { return { id: 'quad-buf' }; },
    bindBuffer() {},
    bufferData() {},
    deleteBuffer() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getUniformLocation(_p, name) { return { name }; },
    viewport() {},
    clearColor() {},
    clear() {},
    useProgram() {},
    uniform1f(loc, v) { if (loc) uniforms.set(loc.name, v); },
    uniform2f(loc, x, y) { if (loc) uniforms.set(loc.name, [x, y]); },
    uniform4f(loc, a, b, c, d) { if (loc) uniforms.set(loc.name, [a, b, c, d]); },
    drawArrays() { glDraws++; },
    getExtension() { return { loseContext() {} }; },
  };

  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 248, height: 28 };
    },
    addEventListener() {},
    removeEventListener() {},
    getContext(type) {
      if (type === 'webgl2') return mockGl;
      if (type === '2d') {
        twoDContextCalls++;
        return null;
      }
      return null;
    },
  };

  try {
    const bar = crystalCore.mountCrystalPrismBar(canvas, {
      reduceMotion: false,
      getState: () => ({ isDark: true, prismStrength: 1 }),
    });
    assert.ok(bar);
    assert.equal(extraCanvasesCreated, 0, 'Zero offscreen canvases should be created');
    assert.equal(twoDContextCalls, 0, '2D context must not be requested when WebGL2 succeeds');

    const fsSrc = shaderSources.find((s) => s.includes('etchedLockMask'));
    assert.ok(fsSrc, 'WebGL2 fragment shader must embed etchedLockMask SDF');

    // Initial step renders base crystal frame
    assert.equal(bar.step(0.016), true);
    assert.equal(glDraws, 1);

    // Advance across 300 steps at 300Hz (1.0s) with pointer far away -> skips >85% of GPU draws via empty-glint & ~30fps glint cap
    for (let i = 0; i < 300; i++) {
      bar.step(1 / 300);
    }
    const dbgIdle = bar.getDebugState();
    assert.equal(dbgIdle.rendererMode, 'webgl2');
    assert.equal(dbgIdle.zeroCopy, true);
    assert.ok(dbgIdle.skippedCount >= 260, `Expected >=260 skipped frames out of 300 on 300Hz idle bar, got ${dbgIdle.skippedCount}`);

    // Moving pointer near capsule wakes dispersion draws immediately
    const drawsBeforeHover = glDraws;
    bar.setPointerClient(220, 214);
    assert.equal(bar.step(0.016), true);
    assert.equal(glDraws, drawsBeforeHover + 1);
    assert.equal(bar.isIdle(), false);

    // Optical wake sweep forces draw even after pointer leaves
    bar.setPointerClient(-9999, -9999);
    for (let i = 0; i < 40; i++) bar.step(0.05);
    bar.wake();
    assert.equal(bar.getDebugState().waking, true);
    const drawsBeforeWakeStep = glDraws;
    assert.equal(bar.step(0.05), true);
    assert.equal(glDraws, drawsBeforeWakeStep + 1);

    bar.dispose();
  } finally {
    globalThis.document = prevDoc;
  }
});

test('crystal-prism-core 2D fallback with reduceMotion draws once and skips 100% of subsequent static frames', () => {
  let clears = 0;
  const ctx2d = {
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    clip() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillRect() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    arc() {},
    setTransform() {},
    clearRect() { clears++; },
  };
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 220, height: 28 }),
    getContext: (type) => (type === '2d' ? ctx2d : null),
  };

  const bar = crystalCore.mountCrystalPrismBar(canvas, {
    reduceMotion: true,
    force2D: true,
    getState: () => ({ isDark: false, prismStrength: 1 }),
  });
  assert.equal(bar.step(0.016), true);
  assert.equal(clears, 1);
  assert.equal(bar.isIdle(), true);

  for (let i = 0; i < 20; i++) {
    assert.equal(bar.step(0.016), false);
  }
  assert.equal(clears, 1, 'Static reduced-motion bar must draw 0 extra frames');
  assert.equal(bar.getDebugState().skippedCount, 20);
  bar.dispose();
});

test('crystal-prism-core & model-glyph-crystal honor accentTone (mono/cobalt/iris/amber/warm), ambientIntensity=0 0fps sleep, and dynamic motionLevel', () => {
  const modelGlyphMod = require('../model-glyph-crystal.js');
  assert.equal(crystalCore.resolveCrystalAccentCode('mono'), 5);
  assert.equal(crystalCore.resolveCrystalAccentCode('amber'), 4);
  assert.equal(crystalCore.resolveCrystalAccentCode('iris'), 3);
  assert.equal(crystalCore.resolveCrystalAccentCode('cobalt'), 2);
  assert.equal(crystalCore.resolveCrystalAccentCode('warm'), 1);
  assert.equal(crystalCore.resolveCrystalAccentCode('follow'), 0);

  let accent = 'mono';
  let ambient = 1;
  const fillStyles = [];
  const ctx2d = {
    globalAlpha: 1,
    set fillStyle(v) { fillStyles.push(String(v)); },
    get fillStyle() { return '#000'; },
    strokeStyle: '#000',
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    clip() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillRect() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    arc() {},
    setTransform() {},
    clearRect() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 220, height: 28 }),
    getContext: (type) => (type === '2d' ? ctx2d : null),
  };

  const bar = crystalCore.mountCrystalPrismBar(canvas, {
    reduceMotion: false,
    force2D: true,
    getState: () => ({ isDark: true, prismStrength: 1, accentTone: accent, ambientIntensity: ambient }),
  });
  bar.setPointerClient(110, 14);
  assert.equal(bar.step(0.05), true);
  assert.equal(bar.getDebugState().accentCode, 5);
  assert.equal(bar.getDebugState().dispersionActive, false, 'mono accent must disable 4-color dispersion');
  assert.ok(!fillStyles.includes('#ea4335') && !fillStyles.includes('#d96570'), 'mono fallback must not paint coral/red spectrum');

  // Switch ambientIntensity -> 0: immediately converges to 0fps idle and suppresses subsequent draws
  ambient = 0;
  assert.equal(bar.step(0.016), true, 'Transition to ambient=0 redraws clean static crystal');
  assert.equal(bar.isIdle(), true, 'ambient=0 must report idle immediately');
  for (let i = 0; i < 15; i++) {
    assert.equal(bar.step(0.016), false, 'ambient=0 must skip 100% of subsequent animation steps');
  }

  // Dynamic setReduceMotion toggle
  ambient = 1;
  accent = 'iris';
  bar.setReduceMotion(true);
  assert.equal(bar.step(0.016), true);
  assert.equal(bar.getDebugState().accentCode, 3);
  assert.equal(bar.getDebugState().reduceMotion, true);
  assert.equal(bar.isIdle(), true);
  bar.dispose();

  // Verify model-glyph-crystal monochrome SVG switch on data-ag-cs-accent="mono"
  const prevDoc = globalThis.document;
  const htmlAttrs = new Map([['data-ag-cs-accent', 'follow'], ['data-ag-cs-ambient', '1']]);
  globalThis.document = {
    hidden: false,
    documentElement: {
      getAttribute: (k) => (htmlAttrs.has(k) ? htmlAttrs.get(k) : null),
    },
    createElement(tag) {
      const attrs = new Map();
      const children = [];
      return {
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
        style: { setProperty() {} },
        children,
        get firstChild() { return children[0] || null; },
        get firstElementChild() { return children[0] || null; },
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
        hasAttribute(k) { return attrs.has(k); },
        removeAttribute(k) { attrs.delete(k); },
        insertBefore(n) { children.unshift(n); return n; },
        appendChild(n) { children.push(n); return n; },
        querySelector(sel) {
          if (sel === '.ag-cs-model-glyph') return children.find((c) => c.className.includes('ag-cs-model-glyph')) || null;
          return null;
        },
        querySelectorAll() { return []; },
        classList: { contains: (c) => false, remove() {}, add() {} },
      };
    },
  };
  try {
    const ctl = modelGlyphMod.createModelGlyphCrystalController({
      animatedIcons: null,
      crystalPrismCore: crystalCore,
      isDestroyed: () => false,
      isComposerRestyleEnabled: () => true,
      isZh: () => true,
      isDarkTheme: () => true,
      motionReduced: () => false,
      getMinFrameGapMs: () => 0,
      canMountRealCanvas: () => false,
      getLastPointerPos: () => ({ x: -9999, y: -9999 }),
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    });
    const btn = globalThis.document.createElement('button');
    btn.setAttribute('aria-label', 'Antigravity Orchestrator');
    ctl.syncModelGlyphOnButton(btn);
    const glyph = btn.querySelector('.ag-cs-model-glyph');
    assert.equal(glyph.getAttribute('data-mono'), '0');
    assert.equal(glyph.children[0]?.children?.[0]?.getAttribute?.('fill'), '#669DF6', 'Default Orchestrator spark uses accent fill');

    htmlAttrs.set('data-ag-cs-accent', 'mono');
    ctl.syncModelGlyphOnButton(btn);
    assert.equal(glyph.getAttribute('data-mono'), '1');
    assert.equal(glyph.children[0]?.children?.[0]?.getAttribute?.('fill'), 'currentColor', 'mono accent switches Orchestrator spark to monochrome currentColor');
  } finally {
    globalThis.document = prevDoc;
  }
});
