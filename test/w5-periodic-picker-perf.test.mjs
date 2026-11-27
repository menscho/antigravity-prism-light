import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PP_DIR = path.join(ROOT_DIR, 'vendor', 'periodic-picker');
const GRAIN_FILE = path.join(PP_DIR, 'pbr-grain-assets.js');
const KB3D_FILE = path.join(PP_DIR, 'keyboard-3d-gl.js');
const OLED_FILE = path.join(PP_DIR, 'oled-cyber-screen.js');
const PICKER_FILE = path.join(PP_DIR, 'periodic-picker.js');

const require = createRequire(import.meta.url);
const cdp = require(path.join(ROOT_DIR, 'cdp.js'));

function createMock2DCtx(counters) {
  const noop = () => {};
  const grad = () => ({ addColorStop: noop });
  return {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '12px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    globalAlpha: 1, globalCompositeOperation: 'source-over', shadowBlur: 0, shadowColor: '',
    shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, clip: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop, setLineDash: noop, fillText: noop, strokeText: noop,
    measureText(s) {
      if (counters) counters.measureText += 1;
      const m = /(\d+(?:\.\d+)?)px/.exec(this.font || '');
      return { width: String(s || '').length * (m ? Number(m[1]) : 16) * 0.58 };
    },
    createLinearGradient: grad, createRadialGradient: grad,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    rect: noop, roundRect: noop, ellipse: noop, arc: noop, arcTo: noop, fill: noop, stroke: noop, drawImage: noop,
  };
}

function createMockWebGL2() {
  let nextId = 1;
  const noop = () => {};
  const makeObj = () => ({ id: nextId++ });
  const anisoValues = [];
  const uniformValues = new Map();
  const rgb8Uploads = [];
  const anisoExt = { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff, TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe };
  return {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, UNIFORM_BUFFER: 0x8a11,
    STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8, FLOAT: 0x1406, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405,
    TEXTURE_2D: 0x0de1, TEXTURE0: 0x84c0, RGBA: 0x1908, RGB: 0x1907, RGB8: 0x8051, RG: 0x8227, RG8: 0x822b,
    DEPTH_COMPONENT: 0x1902, DEPTH_COMPONENT24: 0x81a6, DEPTH_COMPONENT16: 0x81a5, UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601, NEAREST: 0x2600, LINEAR_MIPMAP_LINEAR: 0x2703, CLAMP_TO_EDGE: 0x812f, REPEAT: 0x2901,
    UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_ALIGNMENT: 0x0cf5, DEPTH_TEST: 0x0b71, LEQUAL: 0x0203,
    CULL_FACE: 0x0b44, BACK: 0x0405, BLEND: 0x0be2, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE: 1, NONE: 0, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100, POLYGON_OFFSET_FILL: 0x8037,
    FRAMEBUFFER: 0x8d40, DEPTH_ATTACHMENT: 0x8d00, FRAMEBUFFER_COMPLETE: 0x8cd5, TRIANGLES: 0x0004,
    createShader: makeObj, shaderSource: noop, compileShader: noop, deleteShader: noop,
    createProgram: makeObj, attachShader: noop, linkProgram: noop, deleteProgram: noop,
    getProgramParameter: () => true, getShaderParameter: () => true, useProgram: noop,
    getUniformLocation: (_p, name) => ({ name }), getUniformBlockIndex: () => 0, uniformBlockBinding: noop,
    bindBufferBase: noop, createBuffer: makeObj, bindBuffer: noop, bufferData: noop, bufferSubData: noop,
    deleteBuffer: noop, createVertexArray: makeObj, bindVertexArray: noop, deleteVertexArray: noop,
    enableVertexAttribArray: noop, vertexAttribPointer: noop, vertexAttribDivisor: noop,
    createTexture: makeObj, bindTexture: noop, activeTexture: noop, deleteTexture: noop,
    pixelStorei: noop, generateMipmap: noop, texParameteri: noop, texSubImage2D: noop,
    texParameterf(_t, p, v) { if (p === anisoExt.TEXTURE_MAX_ANISOTROPY_EXT) anisoValues.push(v); },
    texImage2D(_t, _l, fmt, w, h, _b, _f, _ty, d) {
      if (fmt === 0x8051) rgb8Uploads.push({ width: w, height: h, byteLength: d ? d.byteLength : 0 });
    },
    createFramebuffer: makeObj, bindFramebuffer: noop, framebufferTexture2D: noop, drawBuffers: noop,
    readBuffer: noop, checkFramebufferStatus: () => 0x8cd5, deleteFramebuffer: noop,
    getExtension: (n) => (n === 'EXT_texture_filter_anisotropic' ? anisoExt : (n === 'WEBGL_lose_context' ? { loseContext: noop } : null)),
    getParameter: (p) => (p === anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT ? 16 : 0),
    uniform1i: noop, uniform1f: noop, uniform3f: noop, uniform3fv: noop, uniform4f: noop, uniformMatrix4fv: noop,
    uniform4fv(loc, val) { if (loc && loc.name) uniformValues.set(loc.name, Array.from(val)); },
    enable: noop, disable: noop, depthFunc: noop, depthMask: noop, cullFace: noop, blendFuncSeparate: noop,
    polygonOffset: noop, viewport: noop, clearColor: noop, clear: noop, drawElements: noop, drawElementsInstanced: noop,
    isContextLost: () => false,
    _inspect: () => ({ anisoValues, uniformValues, rgb8Uploads }),
  };
}

function createPerfSandbox({ withPath2D = false } = {}) {
  let nowMs = 100, nextRafId = 1, path2dConstructs = 0, rectCalls = 0;
  const rafQueue = new Map();
  const contextCalls = [];
  const measureCounters = { measureText: 0 };
  const attrs = new Map();
  const docEl = { getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), setAttribute: (k, v) => attrs.set(k, String(v)) };
  const doc = {
    hidden: false, visibilityState: 'visible', documentElement: docEl,
    addEventListener() {}, removeEventListener() {},
    createElement(tag) {
      if (String(tag).toLowerCase() !== 'canvas') return {};
      const ctx2d = createMock2DCtx(measureCounters);
      return { width: 0, height: 0, getContext: (t) => (t === '2d' ? ctx2d : null) };
    },
  };
  const win = {
    document: doc, devicePixelRatio: 1.5, performance: { now: () => nowMs },
    requestAnimationFrame(cb) { const id = nextRafId++; rafQueue.set(id, cb); return id; },
    cancelAnimationFrame(id) { rafQueue.delete(id); },
    matchMedia: () => ({ matches: false }),
    atob: (b64) => Buffer.from(String(b64), 'base64').toString('binary'),
  };
  const sandbox = {
    window: win, document: doc, globalThis: win, console, Math, Number, String, Boolean, Array, Object,
    Map, Set, WeakMap, Uint8Array, Float32Array, Float64Array, Uint16Array, Date, RegExp, JSON, atob: win.atob,
  };
  if (withPath2D) {
    sandbox.Path2D = class MockPath2D { constructor(d) { this.d = d; path2dConstructs += 1; } };
    win.Path2D = sandbox.Path2D;
  }
  const ctx = vm.createContext(sandbox);
  return {
    win, doc, measureCounters,
    loadFile: (fp) => vm.runInContext(fs.readFileSync(fp, 'utf8'), ctx, { filename: fp }),
    makeCanvas(w = 960, h = 552) {
      const gl = createMockWebGL2();
      return {
        width: w, height: h, _gl: gl, addEventListener() {}, removeEventListener() {},
        getBoundingClientRect() { rectCalls += 1; return { left: 0, top: 0, width: w, height: h, right: w, bottom: h }; },
        getContext(type, opts) {
          contextCalls.push({ type, opts });
          return type === 'webgl2' ? gl : (type === '2d' ? createMock2DCtx(measureCounters) : null);
        },
      };
    },
    flushRafAt(targetMs) {
      nowMs = targetMs;
      const batch = Array.from(rafQueue.entries());
      rafQueue.clear();
      for (const [, cb] of batch) cb(nowMs);
    },
    getRafSize: () => rafQueue.size,
    getPath2DCount: () => path2dConstructs,
    getRectCalls: () => rectCalls,
    getContextCalls: () => contextCalls,
  };
}

test('W5-Perf #7: pbr-grain-assets 64x32 METAL_ENV downsample, atob/Buffer parity & Ch8 budget slimming', () => {
  const grainBytes = fs.statSync(GRAIN_FILE).size;
  assert.ok(grainBytes < 285000, `pbr-grain-assets.js should shrink >20KB from 304,988B, got ${grainBytes}B`);

  const nodeApi = require(GRAIN_FILE);
  assert.equal(nodeApi.ENV_W, 64);
  assert.equal(nodeApi.ENV_H, 32);
  assert.equal(nodeApi.METAL_ENV_WIDTH, 64);
  assert.equal(nodeApi.METAL_ENV_HEIGHT, 32);
  const nodeTex = nodeApi.getGrainTextures();
  assert.equal(nodeTex.envW, 64);
  assert.equal(nodeTex.envH, 32);
  assert.equal(nodeTex.metalEnvRGB.length, 64 * 32 * 3);
  assert.ok(nodeTex.metalEnvRGB.some((v) => v > 0), 'metalEnvRGB must be non-zero');
  assert.equal(nodeTex.combinedRG.length, 128 * 128 * 2);

  // 校验浏览器 atob 解码路径与 Node Buffer 解码字节 100% 一致
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  const browserTex = env.win.__agPrismGrainAssets.getGrainTextures();
  assert.equal(browserTex.metalEnvRGB.length, 6144);
  assert.deepEqual(Array.from(browserTex.metalEnvRGB), Array.from(nodeTex.metalEnvRGB));

  // 校验 Channel 8 编译产物预算净瘦身
  const rep = cdp.getChannelBudgetReport({ ...cdp.DEFAULT_CONFIG, periodicModelPicker: 'on' }, { noDiskCache: true });
  const ch8 = rep.channels.find((c) => c.id === 'periodicPicker');
  assert.ok(ch8 && ch8.bytes < 830000 && ch8.bytes <= ch8.budgetBytes, `Ch8 should stay well under budget (got ${ch8?.bytes})`);
});

test('W5-Perf #1 + W6-Ultra: native 300Hz uncapped transient (0ms gap), performance <=60fps, steady zeroG @60fps, 2.5px debounce & 0.85s hover linger', () => {
  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const avail = new Map([[1, { slotZ: 1 }], [6, { slotZ: 6 }], [10, { slotZ: 10 }], [18, { slotZ: 18 }]]);
  const r = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90, targetFps: 'native',
  });

  // 1) 切键活跃瞬态动画在 native 300Hz (3.33ms) 节拍下返回 0ms 间隔，真正跟满 240Hz/300Hz 高刷
  r.setState({ availableByZ: avail, selectedZ: 6 });
  r.setState({ selectedZ: 10 });
  assert.equal(r.isIdle(), false, 'selecting new key must wake spring transient');
  env.flushRafAt(200);
  const d0 = r.getPerfStats().frameDraws;
  env.flushRafAt(203.33);
  assert.equal(r.getPerfStats().frameDraws, d0 + 1, 'native transient must follow 300Hz (3.33ms) without artificial 7.6ms cap');
  env.flushRafAt(206.66);
  assert.equal(r.getPerfStats().frameDraws, d0 + 2, 'native transient must sustain consecutive 300Hz frames');

  // 1b) performance 模式下即使是 native 档也必须严格锁死 <=60fps (15.5ms) 且阴影降采至 512
  env.doc.documentElement.setAttribute('data-ag-cs-perf-mode', 'performance');
  env.flushRafAt(225);
  const dPerf = r.getPerfStats().frameDraws;
  env.flushRafAt(235); // 10ms < 15.5ms -> 跳过
  assert.equal(r.getPerfStats().frameDraws, dPerf, 'performance mode must cap native transient to <=60fps (skip 10ms tick)');
  env.flushRafAt(241.5); // 16.5ms >= 15.5ms -> 绘制
  assert.equal(r.getPerfStats().frameDraws, dPerf + 1, 'performance mode must draw once >= 15.5ms elapsed');
  env.doc.documentElement.setAttribute('data-ag-cs-perf-mode', 'balanced');

  // 2) 物理弹簧收敛后仅余 zeroGRemainSec 悬浮余韵时，native 自动降频至 60fps (15.5ms)
  for (let i = 0; i < 65; i += 1) r.step(0.016); // ~1.04s: 键帽/磁浮弹簧已收敛，zeroGRemainSec 仍余 ~1.4s
  assert.equal(r.isIdle(), false, 'zeroGRemainSec should still linger after ~1s');
  env.flushRafAt(500);
  const dSteady = r.getPerfStats().frameDraws;
  env.flushRafAt(510); // 10ms < 15.5ms，60fps 稳态门限应跳过
  assert.equal(r.getPerfStats().frameDraws, dSteady, 'steady zeroG-only native mode must throttle to 60fps (skip 10ms tick)');
  env.flushRafAt(516.5);
  assert.equal(r.getPerfStats().frameDraws, dSteady + 1, 'steady zeroG-only native mode must draw after >= 15.5ms');

  // 3) 显式 targetFps='180' (4.9ms) 与 '120' (7.6ms) 仍精确生效
  r.setState({ targetFps: '120', selectedZ: 1 });
  env.flushRafAt(560);
  const d120 = r.getPerfStats().frameDraws;
  env.flushRafAt(564);
  assert.equal(r.getPerfStats().frameDraws, d120, 'explicit 120fps must skip sub-7.6ms tick');
  env.flushRafAt(568.5);
  assert.equal(r.getPerfStats().frameDraws, d120 + 1, 'explicit 120fps must draw once >= 7.6ms');
  r.setState({ targetFps: '180', selectedZ: 18 });
  env.flushRafAt(600);
  const d180 = r.getPerfStats().frameDraws;
  env.flushRafAt(605.3);
  assert.equal(r.getPerfStats().frameDraws, d180 + 1, 'explicit 180fps must allow >= 4.9ms frame interval');
  r.setState({ targetFps: 'native' });

  // 4) 扫键悬停余韵从 1.65s 收紧至 0.85s，停手迅速进入 0fps 休眠
  for (let i = 0; i < 200 && !r.isIdle(); i += 1) r.step(0.016);
  assert.equal(r.isIdle(), true);
  r.setState({ hoveredZ: 6 });
  let hoverSteps = 0;
  for (; hoverSteps < 75 && !r.isIdle(); hoverSteps += 1) r.step(0.016);
  assert.equal(r.isIdle(), true, `hover linger must converge to 0fps well under 1.2s (took ${hoverSteps} steps)`);
  assert.ok(hoverSteps <= 62, `0.85s hover linger should settle in <=62 frames, took ${hoverSteps}`);

  // 5) setPointerClient 亚像素抖动 (<=2.5px) 不得无限续期 zeroGRemainSec
  const k18 = r.getInteractiveProjectedRects().keys.find((k) => k.slotZ === 18);
  assert.ok(k18);
  r.setPointerClient(k18.cx + 18, k18.cy + 12, true);
  assert.equal(r.isIdle(), false);
  let jitterSettled = false;
  for (let j = 0; j < 190; j += 1) {
    const off = (j % 2) * 0.9; // 位移 ~1.27px <= 2.5px
    r.setPointerClient(k18.cx + 18 + off, k18.cy + 12 + off, true);
    r.step(0.016);
    if (r.isIdle()) { jitterSettled = true; break; }
  }
  assert.equal(jitterSettled, true, 'sub-2.5px pointer micro-jitter must not infinitely renew zeroGRemainSec');
  r.setPointerClient(k18.cx + 35, k18.cy + 12, true);
  assert.equal(r.isIdle(), false, 'pointer move > 2.5px must wake near-field tracking');
  r.dispose();
});

test('W5-Perf #6: zero-GC _spOut springs, 3x FNV-1a numeric signatures & Path2D legend cache', () => {
  const kbSrc = fs.readFileSync(KB3D_FILE, 'utf8');
  assert.ok(kbSrc.includes('var _spOut = new Float64Array(3);'), 'must preallocate module-level _spOut Float64Array(3)');
  const spFnSlice = kbSrc.slice(kbSrc.indexOf('function stepExactSecondOrderSpring('), kbSrc.indexOf('function stepExactSecondOrderSpring(') + 1200);
  assert.ok(spFnSlice.includes('return _spOut;') && !spFnSlice.includes('return [nextCur'));

  const sigSlice = kbSrc.slice(kbSrc.indexOf('function computeShadowGeomSignature('), kbSrc.indexOf('function renderWebGL2Frame('));
  assert.ok(sigSlice.includes('2166136261') && sigSlice.includes('fnvMixInt'), 'signatures must use 32-bit FNV-1a');
  assert.equal(sigSlice.includes(".join('|')"), false, 'signatures must eliminate per-frame array/string .join("|")');

  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox({ withPath2D: true });
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const r1 = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });
  const countAfterFirst = env.getPath2DCount();
  assert.ok(countAfterFirst > 0, 'first legend atlas build compiles novelty Path2Ds');
  r1.dispose();
  env.win.__agPrismKeyboard3D.evictLegendAtlasCache(env.doc);
  const r2 = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });
  assert.equal(env.getPath2DCount(), countAfterFirst, 'second legend atlas build must hit Path2D cache (0 new Path2D)');
  r2.dispose();
});

test('W5-Perf #2/#4/#5: static widgetsGpu (0 rebuilds), 66ms drag shadow throttle, maxAniso<=4, ultrawide DPR 1.35 & preserveDrawingBuffer:false', () => {
  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const canvas = env.makeCanvas(960, 552);
  const avail = new Map([[1, { slotZ: 1 }], [6, { slotZ: 6 }], [10, { slotZ: 10 }], [18, { slotZ: 18 }]]);
  const r = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas, doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });

  const glCall = env.getContextCalls().find((c) => c.type === 'webgl2');
  assert.ok(glCall && glCall.opts && glCall.opts.preserveDrawingBuffer === false, 'preserveDrawingBuffer must stay false');
  const glInfo = canvas._gl._inspect();
  assert.ok(glInfo.anisoValues.length > 0 && glInfo.anisoValues.every((v) => v <= 4), `maxAniso must cap <=4, got ${glInfo.anisoValues}`);
  assert.ok(glInfo.rgb8Uploads.some((u) => u.width === 64 && u.height === 32 && u.byteLength === 6144), 'metalEnvTex must upload 64x32 RGB8');

  r.setState({ availableByZ: avail, selectedZ: 10 });
  for (let i = 0; i < 160 && !r.isIdle(); i += 1) r.step(0.016);

  // 静态 widgetsGpu：旋钮转动 + 按钮 hover/press 不触发 CPU 网格重建，仅更新 u_hwDyn0/1/2
  const rebuildsBefore = r.getPerfStats().dynMeshRebuilds;
  const knobAngleBefore = (glInfo.uniformValues.get('u_hwDyn0') || [])[3];
  r.rotateKnobStep(2);
  r.setHardwareState({ hoveredControl: 'prism-wave', pressedControl: 'close' });
  r.triggerControlPress('reset-view');
  for (let i = 0; i < 20; i += 1) r.step(0.016);
  assert.equal(r.getPerfStats().dynMeshRebuilds, rebuildsBefore, 'widgetsGpu must NOT rebuild on knobAngle / hover / press');
  assert.notEqual((glInfo.uniformValues.get('u_hwDyn0') || [])[3], knobAngleBefore, 'u_hwDyn0.w must transmit live knobAngle');
  assert.ok((glInfo.uniformValues.get('u_hwDyn2') || [])[0] < -0.01, 'u_hwDyn2.x must transmit close button press displacement');

  // ShadowMap 拖拽期 66ms 节流 (15Hz) + 松手停稳补高精度阴影
  for (let i = 0; i < 160 && !r.isIdle(); i += 1) r.step(0.016);
  r.dragChassisOrbitDelta(0.08, 0.12);
  r.step(0.016);
  const shAfterFirstDrag = r.getPerfStats().shadowDraws;
  const skipsBeforeDrag = r.getPerfStats().shadowSkips;
  for (let i = 0; i < 3; i += 1) { r.dragChassisOrbitDelta(0.03, 0.04); r.step(0.016); }
  assert.equal(r.getPerfStats().shadowDraws, shAfterFirstDrag, 'orbit drag within 66ms must throttle ShadowMap draws');
  assert.ok(r.getPerfStats().shadowSkips >= skipsBeforeDrag + 3, 'orbit drag sub-66ms ticks must increment shadowSkips');
  r.dragChassisOrbitDelta(0.04, 0.05);
  r.step(0.025);
  assert.equal(r.getPerfStats().shadowDraws, shAfterFirstDrag + 1, 'orbit drag crossing 66ms must draw throttled shadow');
  r.endChassisOrbitDrag(0, 0);
  const shBeforeSettle = r.getPerfStats().shadowDraws;
  for (let i = 0; i < 160 && !r.isIdle(); i += 1) r.step(0.016);
  assert.equal(r.isIdle(), true);
  assert.ok(r.getPerfStats().shadowDraws >= shBeforeSettle);

  // 超宽视口静态 DPR 封顶 1.35 + 总像素面积封顶 2,200,000（防 2K/4K+300Hz 拉爆像素填充率）
  r.resize(960, 552, 2.0);
  assert.equal(r.getPerfStats().dpr, 1.5);
  r.resize(1400, 500, 2.0);
  assert.equal(r.getPerfStats().dpr, 1.35, 'ultrawide (cssWidth*dpr > 1800, <=2.2M px) must clamp dpr to 1.35');
  r.resize(2560, 1440, 2.0);
  assert.ok(r.getPerfStats().dpr < 1.35, '2K fullscreen must scale internal DPR below 1.35 to cap total pixel area');
  assert.ok(canvas.width * canvas.height <= 2205000, `2K canvas pixel count must cap <=2.2M, got ${canvas.width}x${canvas.height}=${canvas.width * canvas.height}`);

  const kbSrc = fs.readFileSync(KB3D_FILE, 'utf8');
  assert.ok(kbSrc.includes('baseN.y>.45'), 'SOLID_FS must restrict grain normal gradient to top faces');
  const vogelSlice = kbSrc.slice(kbSrc.indexOf('float sampleVogelShadow('), kbSrc.indexOf('float sampleVogelShadow(') + 1600);
  assert.ok(vogelSlice.includes('rot8[8]') && vogelSlice.includes('vogel4[4]') && vogelSlice.includes('vogel6[6]') && !vogelSlice.includes('cos(ign)'));
  r.dispose();
});

test('W5-Perf #3: setHardwareState({ deferRender: true }), resize zero-reflow & getInteractiveProjectedRects({ includeKeys: false })', () => {
  const { ELEMENTS_90 } = require(PICKER_FILE);
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(KB3D_FILE);
  const r = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: env.makeCanvas(960, 552), doc: env.doc, root: env.win, slots: ELEMENTS_90,
  });

  const drawsBeforeHw = r.getPerfStats().frameDraws;
  r.setHardwareState({ hoveredControl: 'mute' }, { deferRender: true });
  assert.equal(r.getPerfStats().frameDraws, drawsBeforeHw, 'setHardwareState({ deferRender: true }) must not render synchronously');
  assert.ok(env.getRafSize() >= 1);
  env.flushRafAt(300);
  assert.ok(r.getPerfStats().frameDraws > drawsBeforeHw);

  const rectsBefore = env.getRectCalls();
  const drawsBeforeResize = r.getPerfStats().frameDraws;
  r.resize(1100, 580, 1.5, null, { deferRender: true });
  assert.equal(env.getRectCalls(), rectsBefore, 'resize() must reuse cachedCanvasRect without getBoundingClientRect()');
  assert.equal(r.getPerfStats().frameDraws, drawsBeforeResize, 'resize(..., { deferRender: true }) must coalesce into rAF');
  env.flushRafAt(330);
  assert.ok(r.getPerfStats().frameDraws > drawsBeforeResize);

  const liteRects = r.getInteractiveProjectedRects({ includeKeys: false });
  assert.equal(liteRects.keys.length, 0);
  assert.equal(liteRects.availableKeys.length, 0);
  assert.equal(liteRects.auxKeys.length, 0);
  assert.equal(liteRects.controlList.length, 4);
  assert.ok(liteRects.chassis.width > 10 && liteRects.deck.width > 10);
  assert.equal(r.getInteractiveProjectedRects().keys.length, ELEMENTS_90.length);
  r.dispose();
});

test('W5-Perf #6-OLED: oled-cyber-screen.js 16-entry text measurement LRU cache cuts repeat measureText calls', () => {
  const env = createPerfSandbox();
  env.loadFile(GRAIN_FILE);
  env.loadFile(OLED_FILE);
  const painter = env.win.__agPrismOledScreen.createOledScreenPainter({
    width: 800, height: 240, doc: env.doc, root: env.win, lazyWallpapers: true,
  });
  const makeDeck = (z, sym, title) => ({
    z, numLabel: String(z), symbol: sym, title, subtitle: 'Flagship reasoning core',
    chemLabel: `${z} ${sym} · Element`, isAvailable: true, effortTitle: 'Thinking',
    levels: [{ effort: 'low', label: 'Low', active: false }, { effort: 'medium', label: 'Medium', active: true }, { effort: 'high', label: 'High', active: false }],
  });
  const theme = { id: 'obsidian-dark', isLight: false, isMono: false, ambientMul: 0.7, primaryHex: '#669DF6' };

  env.measureCounters.measureText = 0;
  painter.render({ deckInfo: makeDeck(6, 'C', 'Gemini 4 Carbon Pro'), themeProfile: theme, nowMs: 100 });
  painter.render({ deckInfo: makeDeck(10, 'Ne', 'Gemini 4 Neon Ultra'), themeProfile: theme, nowMs: 400 });
  const coldMeasures = env.measureCounters.measureText;
  assert.ok(coldMeasures >= 8, `expected cold pass to measure text, got ${coldMeasures}`);

  env.measureCounters.measureText = 0;
  painter.render({ deckInfo: makeDeck(6, 'C', 'Gemini 4 Carbon Pro'), themeProfile: theme, nowMs: 700 });
  painter.render({ deckInfo: makeDeck(10, 'Ne', 'Gemini 4 Neon Ultra'), themeProfile: theme, nowMs: 1000 });
  const warmMeasures = env.measureCounters.measureText;
  assert.ok(warmMeasures < coldMeasures * 0.6, `text LRU cache must cut repeat measureText calls (cold=${coldMeasures}, warm=${warmMeasures})`);
  painter.dispose();
});

function createBatchBPickerEnv() {
  let nowMs = 1000, nextTimerId = 1, nextRafId = 1, rectReads = 0;
  const timers = new Map(), rafs = new Map(), resizeObservers = new Set();
  const docListeners = new Map(), winListeners = new Map();
  let stageRect = { left: 260, top: 220, width: 760, height: 340, right: 1020, bottom: 560 };
  let overlayRect = { left: 0, top: 200, width: 1280, height: 360, right: 1280, bottom: 560 };

  const addL = (m, t, fn) => { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(fn); };
  const remL = (m, t, fn) => { const s = m.get(t); if (s) { s.delete(fn); if (!s.size) m.delete(t); } };
  const fireL = (m, ev) => { for (const fn of Array.from(m.get(ev.type) || [])) fn(ev); };

  function makeEl(tag, id = '') {
    const attrs = new Map(), styles = new Map(), cls = new Set(), evs = new Map(), kids = [];
    let glCtx = null;
    if (id) attrs.set('id', id);
    const el = {
      nodeType: 1, tagName: String(tag).toUpperCase(), id, parentNode: null, parentElement: null,
      children: kids, childNodes: kids, textContent: '', hidden: false, isConnected: false,
      get className() { return Array.from(cls).join(' '); },
      set className(v) { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); attrs.set('class', this.className); },
      classList: { add: (...a) => a.forEach((c) => cls.add(c)), remove: (...a) => a.forEach((c) => cls.delete(c)), contains: (c) => cls.has(c) },
      style: {
        setProperty(k, v) { styles.set(String(k), String(v)); },
        removeProperty(k) { styles.delete(String(k)); },
        getPropertyValue(k) { return styles.get(String(k)) || ''; },
      },
      setAttribute(k, v) { const sv = String(v); attrs.set(k, sv); if (k === 'id') el.id = sv; if (k === 'class') el.className = sv; },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener(t, fn) { addL(evs, t, fn); },
      removeEventListener(t, fn) { remL(evs, t, fn); },
      dispatchEvent(ev) { const e = Object.assign({ target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }, ev); fireL(evs, e); return true; },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = el; c.parentElement = el; kids.push(c); syncConn(c, el.isConnected); return c; },
      insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); const idx = kids.indexOf(ref); c.parentNode = el; c.parentElement = el; if (idx >= 0) kids.splice(idx, 0, c); else kids.push(c); syncConn(c, el.isConnected); return c; },
      removeChild(c) { const idx = kids.indexOf(c); if (idx >= 0) kids.splice(idx, 1); c.parentNode = null; c.parentElement = null; syncConn(c, false); return c; },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      contains(node) { let cur = node; while (cur) { if (cur === el) return true; cur = cur.parentNode; } return false; },
      closest() { return null; },
      blur() {},
      getBoundingClientRect() {
        rectReads += 1;
        if (cls.has('ag-pp-stage') || el.tagName === 'CANVAS') return { ...stageRect };
        if (el.id === 'ag-prism-periodic-picker-root' || cls.has('ag-pp-spatial-dock')) return { ...overlayRect };
        return { left: 0, top: 0, width: 280, height: 320, right: 280, bottom: 320 };
      },
      getContext(type) {
        if (el.tagName !== 'CANVAS') return null;
        if (type === 'webgl2') { if (!glCtx) glCtx = createMockWebGL2(); return glCtx; }
        return type === '2d' ? createMock2DCtx() : null;
      },
      querySelector(sel) { return queryAll(el, sel)[0] || null; },
      querySelectorAll(sel) { return queryAll(el, sel); },
    };
    return el;
  }
  function syncConn(n, flag) { n.isConnected = flag; for (const c of n.children || []) syncConn(c, flag); }
  function matchSimple(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    const s = sel.trim();
    if (s.startsWith('#')) return el.id === s.slice(1);
    if (s.startsWith('.')) return el.classList.contains(s.slice(1));
    const am = /^([a-z0-9_-]*)\[([a-z0-9_-]+)(?:="([^"]*)")?\]$/i.exec(s);
    if (am) return (!am[1] || el.tagName === am[1].toUpperCase()) && (am[3] !== undefined ? el.getAttribute(am[2]) === am[3] : el.hasAttribute(am[2]));
    return el.tagName === s.toUpperCase();
  }
  function queryAll(rootNode, sel) {
    const out = [], parts = sel.split(',').map((p) => p.trim()).filter(Boolean);
    const walk = (n) => { for (const c of n.children || []) { if (parts.some((p) => matchSimple(c, p))) out.push(c); walk(c); } };
    walk(rootNode); return out;
  }

  const html = makeEl('html'), head = makeEl('head'), body = makeEl('body');
  html.isConnected = true; html.appendChild(head); html.appendChild(body);
  const doc = {
    documentElement: html, head, body, hidden: false, visibilityState: 'visible', activeElement: null,
    createElement: (t) => makeEl(t), createElementNS: (_ns, t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), parentNode: null, remove() {} }),
    getElementById: (id) => queryAll(html, `#${id}`)[0] || null,
    querySelector: (s) => queryAll(html, s)[0] || null,
    querySelectorAll: (s) => queryAll(html, s),
    addEventListener: (t, fn) => addL(docListeners, t, fn),
    removeEventListener: (t, fn) => remL(docListeners, t, fn),
    dispatchEvent: (ev) => { fireL(docListeners, Object.assign({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }, ev)); return true; },
  };
  class MockResizeObserver {
    constructor(cb) { this._cb = cb; this._obs = new Set(); }
    observe(t) { if (t) this._obs.add(t); resizeObservers.add(this); }
    unobserve(t) { this._obs.delete(t); if (!this._obs.size) resizeObservers.delete(this); }
    disconnect() { this._obs.clear(); resizeObservers.delete(this); }
  }
  const win = {
    document: doc, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1.5,
    location: { href: 'http://127.0.0.1/chat' }, history: { pushState() {}, replaceState() {} },
    navigator: { language: 'en' }, performance: { now: () => nowMs },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ display: 'block', flexDirection: 'row' }),
    atob: (b64) => Buffer.from(String(b64), 'base64').toString('binary'),
    ResizeObserver: MockResizeObserver,
    setTimeout(fn, ms) { const id = nextTimerId++; timers.set(id, { fn, due: nowMs + Math.max(0, Number(ms) || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = nextRafId++; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    addEventListener: (t, fn) => addL(winListeners, t, fn),
    removeEventListener: (t, fn) => remL(winListeners, t, fn),
    dispatchEvent: (ev) => { fireL(winListeners, Object.assign({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }, ev)); return true; },
  };
  const ctx = vm.createContext({
    window: win, document: doc, globalThis: win, console, Math, Number, String, Boolean, Array, Object,
    Map, Set, WeakMap, Uint8Array, Float32Array, Float64Array, Uint16Array, Date, RegExp, JSON,
    atob: win.atob, ResizeObserver: MockResizeObserver,
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  });
  for (const rel of ['pbr-grain-assets.js', 'oled-cyber-screen.js', 'keyboard-3d-gl.js', 'model-catalog.js', 'host-bridge.js', 'bento-ui.js', 'audio-fx.js', 'periodic-picker.js']) {
    const fp = path.join(PP_DIR, rel);
    vm.runInContext(fs.readFileSync(fp, 'utf8'), ctx, { filename: fp });
  }
  return {
    win, doc, body, makeEl,
    setOverlayRect: (r) => { overlayRect = { ...overlayRect, ...r }; },
    setStageRect: (r) => { stageRect = { ...stageRect, ...r }; },
    getRectReads: () => rectReads,
    resetRectReads: () => { rectReads = 0; },
    triggerResize(target, width, height) {
      for (const obs of Array.from(resizeObservers)) {
        if (obs._obs.has(target)) obs._cb([{ target, contentRect: { width, height, left: 0, top: 0, right: width, bottom: height } }], obs);
      }
    },
    flushRaf(stepMs = 16) {
      nowMs += stepMs;
      const batch = Array.from(rafs.entries()); rafs.clear();
      for (const [, fn] of batch) fn(nowMs);
    },
    advanceTime(ms) {
      nowMs += ms;
      for (const [id, t] of Array.from(timers.entries())) {
        if (t.due <= nowMs) { timers.delete(id); t.fn(); }
      }
    },
    getCounts: () => ({ activeTimers: timers.size, activeRafs: rafs.size, activeObservers: resizeObservers.size }),
  };
}

test('W5-Perf Batch B #3/#8: syncSceneAndDom deferRender (0 double render), dockResizeObserver rAF batch & 300ms transition lock, data-gl-stage includeKeys:false + Tab/focusin/resize a11y recovery', () => {
  const env = createBatchBPickerEnv();
  const hwCalls = [], resizeCalls = [], projCalls = [];
  const origCreate = env.win.__agPrismKeyboard3D.createKeyboard3DRenderer;
  let activeSpyRenderer = null;
  env.win.__agPrismKeyboard3D.createKeyboard3DRenderer = (opts) => {
    const r = origCreate(opts);
    const origHw = r.setHardwareState, origResize = r.resize, origProj = r.getInteractiveProjectedRects;
    r.setHardwareState = (patch, setOpts) => {
      const d0 = r.getPerfStats().frameDraws;
      const res = origHw(patch, setOpts);
      hwCalls.push({ deferRender: Boolean(setOpts && setOpts.deferRender === true), syncDraws: r.getPerfStats().frameDraws - d0 });
      return res;
    };
    r.resize = (w, h, dpr, bRect, rOpts) => {
      resizeCalls.push({ w, h, deferRender: Boolean(rOpts && rOpts.deferRender === true) });
      return origResize(w, h, dpr, bRect, rOpts);
    };
    r.getInteractiveProjectedRects = (rectOpts) => {
      projCalls.push({ includeKeys: !(rectOpts && rectOpts.includeKeys === false) });
      return origProj(rectOpts);
    };
    activeSpyRenderer = r;
    return r;
  };

  const triggerBtn = env.makeEl('button');
  triggerBtn.setAttribute('data-testid', 'model-selector-trigger');
  triggerBtn.textContent = 'Gemini 4 Carbon (High)';
  env.body.appendChild(triggerBtn);
  env.win.__agPeriodicMockHost = {
    selectedModel: { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-c-high' },
    modelOptions: [
      { label: 'Gemini 4 Hydrogen (High)', modelId: 'gemini-4-h-high' },
      { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-c-high' },
      { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-ne-high' },
    ],
  };

  const inst = env.win.__agPrismPeriodicPickerFactory.mountPeriodicPicker({ root: env.win, doc: env.doc, mode: 'on' });
  assert.equal(inst.open(triggerBtn), true);
  assert.ok(activeSpyRenderer && hwCalls.length >= 1, 'open() must invoke setHardwareState');
  assert.ok(hwCalls.every((c) => c.deferRender === true && c.syncDraws === 0), 'syncSceneAndDom must pass deferRender:true to setHardwareState (0 sync double-render)');
  assert.ok(resizeCalls.length === 1 && resizeCalls[0].deferRender === true, 'open() initial resize must pass deferRender:true');

  const rootEl = env.doc.getElementById('ag-prism-periodic-picker-root');
  const hitLayerEl = rootEl.querySelector('.ag-pp-hit-layer');
  const canvasEl = rootEl.querySelector('.ag-pp-gl-canvas');
  assert.equal(rootEl.getAttribute('data-gl-stage'), '1');

  // 1) 进入 300ms 抽屉展开过渡期：openRafId 锁定画布不重建，随后 6 帧高度插值 RO 0 回流 / 0 画布重建
  env.flushRaf();
  assert.equal(rootEl.getAttribute('data-open'), '1');
  const resizeAfterOpenRaf = resizeCalls.length;
  const lockedCanvasW = canvasEl.width, lockedCanvasH = canvasEl.height;
  env.resetRectReads();
  for (const h of [90, 150, 210, 270, 310, 336]) {
    env.setOverlayRect({ width: 1280, height: h });
    env.setStageRect({ width: 760, height: Math.max(80, h - 20) });
    env.triggerResize(rootEl, 1280, h);
    env.flushRaf();
  }
  assert.equal(resizeCalls.length, resizeAfterOpenRaf, '300ms drawer height transition must NOT call resize() per frame');
  assert.equal(canvasEl.width, lockedCanvasW);
  assert.equal(canvasEl.height, lockedCanvasH);
  assert.equal(env.getRectReads(), 0, '300ms drawer height transition must trigger 0 getBoundingClientRect() reflows');

  // 180ms opacity transitionend 不提前解锁；300ms height transitionend 仅执行 1 次稳态同步
  env.setOverlayRect({ width: 1280, height: 360 });
  env.setStageRect({ width: 760, height: 356 });
  rootEl.dispatchEvent({ type: 'transitionend', target: rootEl, propertyName: 'opacity' });
  assert.equal(resizeCalls.length, resizeAfterOpenRaf, 'opacity transitionend must not unlock height transition early');
  rootEl.dispatchEvent({ type: 'transitionend', target: rootEl, propertyName: 'height' });
  assert.equal(resizeCalls.length, resizeAfterOpenRaf + 1, 'height transitionend must perform exactly 1 steady-state resize');
  assert.equal(resizeCalls[resizeCalls.length - 1].h, 356);
  assert.equal(canvasEl.style.getPropertyValue('height'), '', 'height transitionend must clear locked inline canvas height');

  // 1b) P2-2: 抽屉初始折叠态 (stageHeight=120 < 稳态高度) 展开时，canvas 预估目标稳态高度并锁住内联 height 防止 300ms 过渡期间纵向拉伸
  inst.close();
  resizeCalls.length = 0;
  env.setOverlayRect({ width: 1280, height: 0 });
  env.setStageRect({ width: 760, height: 120 });
  assert.equal(inst.open(triggerBtn), true);
  const rootElStretch = env.doc.getElementById('ag-prism-periodic-picker-root');
  const canvasStretch = rootElStretch.querySelector('.ag-pp-gl-canvas');
  assert.ok(resizeCalls.length === 1 && resizeCalls[0].h >= 300, `drawer open from collapsed stage must pre-size canvas to steady height (>=300), got ${resizeCalls[0]?.h}`);
  assert.equal(canvasStretch.style.getPropertyValue('height'), `${resizeCalls[0].h}px`, 'drawer transition must lock canvas inline height to prevent vertical stretching');
  env.flushRaf();
  env.setOverlayRect({ width: 1280, height: 360 });
  env.setStageRect({ width: 760, height: 356 });
  rootElStretch.dispatchEvent({ type: 'transitionend', target: rootElStretch, propertyName: 'height' });
  assert.equal(canvasStretch.style.getPropertyValue('height'), '', 'transitionend must release inline canvas height lock cleanly');
  assert.equal(resizeCalls[resizeCalls.length - 1].h, 356);

  // 2) 稳态 dockResizeObserver rAF 合批防抖：同帧 8 次爆发合并为 1 次
  const resizeBeforeBurst = resizeCalls.length;
  for (let i = 0; i < 8; i += 1) {
    env.setOverlayRect({ width: 1120 + i * 8, height: 360 });
    env.setStageRect({ width: 680 + i * 8, height: 356 });
    env.triggerResize(rootEl, 1120 + i * 8, 360);
  }
  assert.equal(resizeCalls.length, resizeBeforeBurst, 'steady dockResizeObserver burst must coalesce into rAF (0 sync calls)');
  env.flushRaf();
  assert.equal(resizeCalls.length, resizeBeforeBurst + 1, 'steady dockResizeObserver burst must execute exactly once on rAF flush');

  // 3) #8 data-gl-stage="1" 默认 includeKeys:false 跳过 96 键投影；Tab 首次补算 1 次，连续 Tab 不重复风暴
  assert.ok(projCalls.length > 0 && projCalls.every((p) => p.includeKeys === false), 'GL stage default syncHitLayerRects must pass { includeKeys: false }');
  const fullProjBeforeTab = projCalls.filter((p) => p.includeKeys).length;
  assert.equal(fullProjBeforeTab, 0);
  env.doc.dispatchEvent({ type: 'keydown', key: 'Tab' });
  assert.equal(projCalls.filter((p) => p.includeKeys).length, 1, 'first Tab must compute full 96-key projection once');
  const carbonKeyBtn = rootEl.querySelector('button[data-z="6"]');
  assert.ok(carbonKeyBtn && carbonKeyBtn.style.getPropertyValue('width'), 'Tab recovery must populate a11y hit button geometry');
  env.doc.dispatchEvent({ type: 'keydown', key: 'Tab' });
  env.doc.dispatchEvent({ type: 'keydown', key: 'Tab' });
  assert.equal(projCalls.filter((p) => p.includeKeys).length, 1, 'subsequent Tab presses must not storm 96-key projection');

  // 4) close() 干净重置状态，热重开后再由 hitLayer focusin 补算 1 次，window resize 补算 1 次
  inst.close();
  projCalls.length = 0;
  assert.equal(inst.open(triggerBtn), true);
  env.flushRaf();
  assert.equal(projCalls.filter((p) => p.includeKeys).length, 0, 'warm reopen after close() must reset a11yKeyRectsSynced & keep includeKeys:false');
  hitLayerEl.dispatchEvent({ type: 'focusin', target: carbonKeyBtn });
  assert.equal(projCalls.filter((p) => p.includeKeys).length, 1, 'hitLayer focusin must recover full 96-key projection once');
  env.win.dispatchEvent({ type: 'resize' });
  assert.equal(projCalls.filter((p) => p.includeKeys).length, 2, 'window resize must refresh full 96-key projection once');

  inst.destroy();
  const c = env.getCounts();
  assert.equal(c.activeTimers, 0);
  assert.equal(c.activeRafs, 0);
  assert.equal(c.activeObservers, 0);
});

test('W6-3D-Ultra: 512 reduced shadowMap, zero-trig SOLID_FS env dedup, open Read-then-Write, hoverOnly Bento skip, single-node cursor & card rim xor throttle', () => {
  // 1) ShadowMap 分级 (ultra=1024, low/medium/subtle/performance=512) + SOLID_FS 零 atan/acos & 共享 Ruv
  const kbSrc = fs.readFileSync(KB3D_FILE, 'utf8');
  const bentoSrc = fs.readFileSync(path.join(PP_DIR, 'bento-ui.js'), 'utf8');
  assert.ok(kbSrc.includes('SHADOW_MAP_SIZE_REDUCED = 512'), 'reduced shadow map must be 512px');
  assert.ok(kbSrc.includes('sampleMetalStudioEnvUv('), 'SOLID_FS must share precomputed equirect UV via sampleMetalStudioEnvUv');
  const eqSlice = kbSrc.slice(kbSrc.indexOf('vec2 dirToEquirectUv('), kbSrc.indexOf('vec2 dirToEquirectUv(') + 700);
  assert.equal(/\b(?:atan|acos)\s*\(/.test(eqSlice), false, 'dirToEquirectUv must eliminate trig atan()/acos()');
  assert.ok(bentoSrc.includes('.ag-pp-floor-shadow::after{content:"";position:absolute;inset:20% 5% 0% 5%;pointer-events:none;border-radius:50%;contain:strict;'), 'floor-shadow::after must isolate compositing with contain:strict');

  const { ELEMENTS_90 } = require(PICKER_FILE);
  const glEnv = createPerfSandbox();
  glEnv.loadFile(GRAIN_FILE);
  glEnv.loadFile(KB3D_FILE);
  const rUltra = glEnv.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: glEnv.makeCanvas(960, 552), doc: glEnv.doc, root: glEnv.win, slots: ELEMENTS_90, motionLevel: 'ultra',
  });
  assert.equal(rUltra.getPerfStats().shadowMapSize, 1024, 'ultra motion must keep 1024px shadow map');
  rUltra.setState({ motionLevel: 'low' });
  assert.equal(rUltra.getPerfStats().shadowMapSize, 512, 'low motion must drop shadow map to 512px');
  rUltra.setState({ motionLevel: 'subtle' });
  assert.equal(rUltra.getPerfStats().shadowMapSize, 512, 'subtle motion must keep 512px shadow map');
  rUltra.setState({ motionLevel: 'ultra' });
  assert.equal(rUltra.getPerfStats().shadowMapSize, 1024, 'switching back to ultra restores 1024px shadow map');
  glEnv.doc.documentElement.setAttribute('data-ag-cs-perf-mode', 'performance');
  const rPerf = glEnv.win.__agPrismKeyboard3D.createKeyboard3DRenderer({
    canvas: glEnv.makeCanvas(960, 552), doc: glEnv.doc, root: glEnv.win, slots: ELEMENTS_90, motionLevel: 'ultra',
  });
  assert.equal(rPerf.getPerfStats().shadowMapSize, 512, 'performance mode must downgrade shadow map to 512px even under ultra motion');
  rUltra.dispose();
  rPerf.dispose();

  // 2) open() + 首帧 rAF 合并 Read-then-Write（16ms 内不再连读第二轮 6x getBoundingClientRect）
  const env = createBatchBPickerEnv();
  let bentoSyncCalls = 0;
  const origSyncBento = env.win.__agPeriodicBentoUi.syncBentoTwinCardsDom;
  env.win.__agPeriodicBentoUi.syncBentoTwinCardsDom = function () {
    bentoSyncCalls += 1;
    return origSyncBento.apply(this, arguments);
  };
  const triggerBtn = env.makeEl('button');
  triggerBtn.setAttribute('data-testid', 'model-selector-trigger');
  triggerBtn.textContent = 'Gemini 4 Carbon (High)';
  env.body.appendChild(triggerBtn);
  env.win.__agPeriodicMockHost = {
    selectedModel: { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-c-high' },
    modelOptions: [
      { label: 'Gemini 4 Hydrogen (High)', modelId: 'gemini-4-h-high' },
      { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-c-high' },
      { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-ne-high' },
    ],
  };
  const inst = env.win.__agPrismPeriodicPickerFactory.mountPeriodicPicker({ root: env.win, doc: env.doc, mode: 'on' });
  env.resetRectReads();
  assert.equal(inst.open(triggerBtn), true);
  const readsAfterOpenSync = env.getRectReads();
  assert.ok(readsAfterOpenSync <= 6, `open() sync phase must measure at most 1 round (<=6 rects), got ${readsAfterOpenSync}`);
  env.flushRaf(16);
  assert.equal(env.getRectReads(), readsAfterOpenSync, 'openRafId within 16ms must reuse cached rects with 0 duplicate getBoundingClientRect() calls');

  const rootEl = env.doc.getElementById('ag-prism-periodic-picker-root');
  const stageEl = rootEl.querySelector('.ag-pp-stage');
  const canvasEl = rootEl.querySelector('.ag-pp-gl-canvas');
  const specRim = rootEl.querySelector('.ag-pp-spec-rim');
  const teleRim = rootEl.querySelector('.ag-pp-tele-rim');

  // 3) 96 键悬停扫盲键：跳过冗余 Bento 全量重算，且 cursor 仅单写 stageEl（0 写 canvasEl）
  const proj = inst.getProjectedRects();
  const blindA = proj.keys.find((k) => k.z === 22);
  const blindB = proj.keys.find((k) => k.z === 23);
  const keyNe = proj.keys.find((k) => k.z === 10);
  assert.ok(blindA && blindB && keyNe);

  let stageCursorWrites = 0, canvasCursorWrites = 0;
  const origStageSet = stageEl.style.setProperty.bind(stageEl.style);
  const origCanvasSet = canvasEl.style.setProperty.bind(canvasEl.style);
  stageEl.style.setProperty = (k, v) => { if (k === 'cursor') stageCursorWrites += 1; return origStageSet(k, v); };
  canvasEl.style.setProperty = (k, v) => { if (k === 'cursor') canvasCursorWrites += 1; return origCanvasSet(k, v); };

  bentoSyncCalls = 0;
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 260 + blindA.cx, clientY: 220 + blindA.cy, target: canvasEl });
  env.flushRaf(16);
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 260 + blindB.cx, clientY: 220 + blindB.cy, target: canvasEl });
  env.flushRaf(16);
  assert.equal(bentoSyncCalls, 0, 'sweeping across blind keys with unchanged display model must skip Bento DOM rebuild (0 calls)');
  // 在 3D 舞台扫键时绝不触发卡片 -webkit-mask-composite: xor 光斑重绘
  assert.equal(specRim.style.getPropertyValue('--ag-pp-card-px'), '', 'stage key sweep must not repaint specCard rim mask');
  assert.equal(teleRim.style.getPropertyValue('--ag-pp-right-px'), '', 'stage key sweep must not repaint telePod rim mask');

  // 切到可用键 Ne -> 立即刷新 Bento 且 cursor 只写 1 次 canvasEl、0 次 stageEl
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 260 + keyNe.cx, clientY: 220 + keyNe.cy, target: canvasEl });
  env.flushRaf(16);
  assert.equal(bentoSyncCalls, 1, 'hovering a different available model key must refresh Bento panel once');
  assert.equal(stageCursorWrites, 0, 'cursor must never duplicate-write onto stageEl');
  assert.equal(canvasEl.style.getPropertyValue('cursor'), 'pointer');
  const writesBeforeSameHover = canvasCursorWrites;
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 260 + keyNe.cx + 0.5, clientY: 220 + keyNe.cy + 0.5, target: canvasEl });
  env.flushRaf(16);
  assert.equal(canvasCursorWrites, writesBeforeSameHover, 'unchanged cursor state must not re-write canvasEl.style.cursor');

  // 4) 悬停在卡片上：首次点亮，位移 <2px 与 300Hz (<16ms) 微节流跳过重复写 --ag-pp-card-px/py
  let cardPxWrites = 0;
  const origSpecRimSet = specRim.style.setProperty.bind(specRim.style);
  specRim.style.setProperty = (k, v) => { if (k === '--ag-pp-card-px') cardPxWrites += 1; return origSpecRimSet(k, v); };
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 100, target: rootEl });
  env.flushRaf(20);
  assert.equal(cardPxWrites, 1, 'entering specCard must illuminate card rim once');
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 101, clientY: 100, target: rootEl }); // 1px < 2px (even after 20ms)
  env.flushRaf(20);
  assert.equal(cardPxWrites, 1, 'sub-2px pointer move must skip card rim CSS var write');
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 120, clientY: 110, target: rootEl }); // >=16ms since first write -> refreshes
  env.flushRaf(1);
  assert.equal(cardPxWrites, 2, 'pointer move >=2px after >=16ms refreshes card rim');
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 140, clientY: 120, target: rootEl }); // >2px but only 3ms later -> throttled!
  env.flushRaf(3);
  assert.equal(cardPxWrites, 2, '300Hz (3ms) continuous move must micro-throttle card rim xor repaint');
  rootEl.dispatchEvent({ type: 'pointermove', clientX: 160, clientY: 130, target: rootEl }); // >=16ms later -> refreshes
  env.flushRaf(18);
  assert.equal(cardPxWrites, 3, 'card rim must refresh smoothly once >=16ms elapsed');

  inst.destroy();
  const c2 = env.getCounts();
  assert.equal(c2.activeTimers, 0);
  assert.equal(c2.activeRafs, 0);
  assert.equal(c2.activeObservers, 0);
});
