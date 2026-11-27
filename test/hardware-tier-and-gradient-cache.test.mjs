// N8 模块域单测：低配硬件零风控纯标准只读自适应档位 + PR #126 纯 A 类 2D 渐变缓存与离屏可见性
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const schema = require(path.join(ROOT, 'src', 'config', 'schema.cjs'));
const { createCh1Templates } = require(path.join(ROOT, 'src', 'compiler', 'ch1-templates.cjs'));
const domBusMod = require(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'));
const crystalCore = require(path.join(ROOT, 'crystal-prism-core.js'));
const { createPrismRimCanvasController } = require(path.join(ROOT, 'prism-rim-canvas.js'));

function createMockBrowserSandbox({ navigator: navObj = {}, localStorageInit = null } = {}) {
  const attrs = new Map();
  const dataset = {};
  const lsStore = new Map(Object.entries(localStorageInit || {}));
  const localStorage = {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => { lsStore.set(String(k), String(v)); },
    removeItem: (k) => { lsStore.delete(String(k)); },
    _dump: () => Object.fromEntries(lsStore.entries()),
  };
  const makeNode = (tag) => {
    const m = new Map();
    const kids = [];
    const cls = new Set();
    const styleMap = new Map();
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: '',
      textContent: '',
      children: kids,
      parentNode: null,
      parentElement: null,
      isConnected: true,
      dataset: tag === 'html' ? dataset : {},
      style: {
        setProperty(k, v) { styleMap.set(k, String(v)); },
        getPropertyValue(k) { return styleMap.get(k) || ''; },
        removeProperty(k) { styleMap.delete(k); },
      },
      classList: {
        contains: (c) => cls.has(c),
        add: (...a) => a.forEach((c) => cls.add(c)),
        remove: (...a) => a.forEach((c) => cls.delete(c)),
      },
      setAttribute(k, v) {
        const s = String(v);
        if (tag === 'html') {
          attrs.set(k, s);
          if (k === 'data-ag-cs-perf-mode') dataset.agCsPerfMode = s;
        } else {
          m.set(k, s);
        }
      },
      getAttribute(k) {
        if (tag === 'html') return attrs.has(k) ? attrs.get(k) : null;
        return m.has(k) ? m.get(k) : null;
      },
      hasAttribute(k) { return tag === 'html' ? attrs.has(k) : m.has(k); },
      removeAttribute(k) {
        if (tag === 'html') {
          attrs.delete(k);
          if (k === 'data-ag-cs-perf-mode') delete dataset.agCsPerfMode;
        } else {
          m.delete(k);
        }
      },
      appendChild(c) { c.parentNode = c.parentElement = node; kids.push(c); return c; },
      remove() {
        node.isConnected = false;
        if (node.parentNode) {
          const i = node.parentNode.children.indexOf(node);
          if (i >= 0) node.parentNode.children.splice(i, 1);
          node.parentNode = node.parentElement = null;
        }
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 }),
      get lastElementChild() { return kids[kids.length - 1] || null; },
    };
    return node;
  };
  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body');
  body.classList.add('monaco-workbench');
  html.appendChild(head);
  html.appendChild(body);
  const byIdMap = new Map();
  const doc = {
    hidden: false,
    readyState: 'complete',
    title: 'Antigravity',
    documentElement: html,
    head,
    body,
    adoptedStyleSheets: [],
    hasFocus: () => true,
    createElement(tag) {
      const n = makeNode(tag);
      return new Proxy(n, {
        set(t, prop, val) {
          t[prop] = val;
          if (prop === 'id' && val) byIdMap.set(String(val), t);
          return true;
        },
      });
    },
    createElementNS: (_ns, tag) => makeNode(tag),
    getElementById: (id) => byIdMap.get(String(id)) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const sb = {
    document: doc,
    location: { href: 'vscode-file://vscode-app/index.html', pathname: '/' },
    navigator: { language: 'en-US', ...navObj },
    localStorage,
    devicePixelRatio: 2,
    innerWidth: 1440,
    innerHeight: 900,
    performance: { now: () => 1000 },
    CSSStyleSheet: class { replaceSync(css) { this.cssText = css; } },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    console: { log() {}, warn() {}, error() {} },
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON, Proxy, Error, Float32Array, Uint8Array, Uint32Array, Uint8ClampedArray, Symbol,
  };
  doc.defaultView = sb;
  sb.window = sb;
  sb.globalThis = sb;
  return { sb, doc, html, localStorage };
}

test('detectLowEndHardware: 保守精准识别低配机、0 误伤 8核+/8GB+ 高端机、0 OS 探针与 0 隐私外发', () => {
  // 低配硬件命中
  assert.equal(domBusMod.detectLowEndHardware({ deviceMemory: 2, hardwareConcurrency: 4 }), true);
  assert.equal(domBusMod.detectLowEndHardware({ deviceMemory: 4, hardwareConcurrency: 8 }), true, '4GB RAM 必须判定低配');
  assert.equal(domBusMod.detectLowEndHardware({ deviceMemory: 4 }), true);
  assert.equal(domBusMod.detectLowEndHardware({ hardwareConcurrency: 4 }), true, '4 核且无明确 >=8GB 内存判定低配');
  assert.equal(domBusMod.detectLowEndHardware({ hardwareConcurrency: 2, deviceMemory: 0 }), true);
  assert.equal(domBusMod.detectLowEndHardware({ navigator: { deviceMemory: 4, hardwareConcurrency: 4 } }), true);
  assert.equal(domBusMod.detectLowEndHardware({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' }), true);
  assert.equal(domBusMod.detectLowEndHardware({ glRenderer: 'llvmpipe (LLVM 15.0, 256 bits)' }), true);

  // 中高端 300Hz 机型与未知环境 100% 判定 false（绝不误伤）
  assert.equal(domBusMod.detectLowEndHardware({ hardwareConcurrency: 8, deviceMemory: 8 }), false);
  assert.equal(domBusMod.detectLowEndHardware({ hardwareConcurrency: 16, deviceMemory: 8 }), false);
  assert.equal(domBusMod.detectLowEndHardware({ hardwareConcurrency: 12, deviceMemory: 16 }), false);
  assert.equal(domBusMod.detectLowEndHardware({ hardwareConcurrency: 8 }), false);
  assert.equal(domBusMod.detectLowEndHardware({ hardwareConcurrency: 4, deviceMemory: 8 }), false, '明确 >=8GB RAM 时不因低核心数误伤');
  assert.equal(domBusMod.detectLowEndHardware({}), false, '空环境保守返回 false');
  assert.equal(domBusMod.detectLowEndHardware({ deviceMemory: -2, hardwareConcurrency: 'invalid' }), false);

  // 零隐私外发 / 零 OS 探针 / 零额外 WebGL 上下文 / 零 PR #126 掉帧误判逻辑
  const domBusSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'), 'utf8');
  const ch1TplSrc = fs.readFileSync(path.join(ROOT, 'src', 'compiler', 'ch1-templates.cjs'), 'utf8');
  for (const [name, src] of [['dom-bus.js', domBusSrc], ['ch1-templates.cjs', ch1TplSrc]]) {
    assert.equal(/\b(?:child_process|execSync|execFile|spawnSync|wmic|Get-CimInstance|Get-WmiObject|powershell|reg\.exe|WScript)\b/i.test(src), false, `${name} 严禁调用任何 OS/WMI/PS 探针`);
    assert.equal(/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/.test(src), false, `${name} 严禁网络外发任何硬件信息`);
    assert.equal(/getContext\s*\(\s*['"]webgl/i.test(src), false, `${name} 严禁新建额外 WebGL 上下文抢占槽位`);
    assert.equal(/localStorage\.setItem/.test(src), false, `${name} 严禁持久化写入任何硬件信息`);
    assert.equal(/\bfEmaDt\b/.test(src), false, `${name} 严禁引入 PR #126 30Hz 掉帧误判逻辑`);
  }
});

test('三端 Schema 默认值零改动 + isPerformanceModeExplicit / resolveEffectivePerformanceMode / resolvePerfModeAutoTag 契约', () => {
  // Schema 默认值绝对不变
  assert.equal(cdp.DEFAULT_CONFIG.performanceMode, 'balanced');
  assert.equal(cdp.DEFAULT_CONFIG.motionLevel, 'ultra');
  assert.equal(cdp.DEFAULT_CONFIG.targetFps, '180');

  // isPerformanceModeExplicit 精准区分显式与缺省/auto
  assert.equal(schema.isPerformanceModeExplicit(null), false);
  assert.equal(schema.isPerformanceModeExplicit({}), false);
  assert.equal(schema.isPerformanceModeExplicit({ palette: 'warm' }), false);
  assert.equal(schema.isPerformanceModeExplicit({ performanceMode: '' }), false);
  assert.equal(schema.isPerformanceModeExplicit({ performanceMode: 'auto' }), false);
  assert.equal(schema.isPerformanceModeExplicit({ performanceMode: 'balanced' }), true);
  assert.equal(schema.isPerformanceModeExplicit({ performanceMode: 'quality' }), true);
  assert.equal(schema.isPerformanceModeExplicit({ performanceMode: 'performance' }), true);
  assert.equal(schema.isPerformanceModeExplicit({ performanceMode: 'eco' }), true);

  // resolveEffectivePerformanceMode 纯函数判定
  const lowEnv = { deviceMemory: 4, hardwareConcurrency: 4 };
  const highEnv = { deviceMemory: 8, hardwareConcurrency: 16 };
  assert.equal(domBusMod.resolveEffectivePerformanceMode(undefined, { explicit: false, env: lowEnv }), 'performance');
  assert.equal(domBusMod.resolveEffectivePerformanceMode('balanced', { explicit: false, env: lowEnv }), 'performance');
  assert.equal(domBusMod.resolveEffectivePerformanceMode('auto', { explicit: false, env: lowEnv }), 'performance');
  assert.equal(domBusMod.resolveEffectivePerformanceMode('balanced', { explicit: false, env: highEnv }), 'balanced');
  assert.equal(domBusMod.resolveEffectivePerformanceMode('auto', { explicit: false, env: highEnv }), 'balanced');
  // 显式偏好 100% 优先，低配机也绝不覆盖
  assert.equal(domBusMod.resolveEffectivePerformanceMode('balanced', { explicit: true, env: lowEnv }), 'balanced');
  assert.equal(domBusMod.resolveEffectivePerformanceMode('quality', { explicit: true, env: lowEnv }), 'quality');
  assert.equal(domBusMod.resolveEffectivePerformanceMode('balanced', { explicit: false, savedMode: 'balanced', env: lowEnv }), 'balanced');
  assert.equal(domBusMod.resolveEffectivePerformanceMode('balanced', { explicit: false, savedMode: 'balanced', forceAuto: true, env: lowEnv }), 'performance');

  // 真实磁盘 config.json 识别（无文件 / 无 performanceMode 键 / 显式 balanced / 显式 auto）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-n8-cfg-'));
  try {
    const tpl = createCh1Templates({
      rootDir: tmpDir,
      pluginVersion: cdp.PLUGIN_VERSION,
      readConfig: () => ({ ...cdp.DEFAULT_CONFIG }),
      resolveCurrentBundleCodeHash: () => 'test-hash',
      detectSystemUiLocale: () => 'en-US',
    });
    // 1) 无 config.json -> 自动默认 (1)
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }), 1);
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }, null), 1);
    // 2) 老配置 config.json 无 performanceMode 键 -> 自动默认 (1)
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ palette: 'warm' }), 'utf8');
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }), 1);
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }, null), 1);
    // 3) 用户显式写入 performanceMode: 'balanced' -> 锁定显式 (0)
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ palette: 'warm', performanceMode: 'balanced' }), 'utf8');
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }), 0);
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }, null), 0);
    // 4) 用户显式写入 performanceMode: 'auto' -> 显式自动 (2)
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ palette: 'warm', performanceMode: 'auto' }), 'utf8');
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }), 2);
    assert.equal(tpl.resolvePerfModeAutoTag({ ...cdp.DEFAULT_CONFIG }, null), 2);
    // 5) 部分显式补丁 { palette: 'warm', performanceMode: 'balanced' } -> 锁定显式 (0)
    assert.equal(tpl.resolvePerfModeAutoTag({ palette: 'warm', performanceMode: 'balanced' }), 0);
    assert.equal(tpl.resolvePerfModeAutoTag({ palette: 'warm' }), 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('端到端 Ch1 注入与 configRefresh：低配机缺省自动 performance、高端机保持 balanced、显式偏好 100% 不被覆盖', () => {
  // 1) 低配机（4GB RAM / 4 核）+ 未显式配置 performanceMode -> 自动落 performance 档
  {
    const { sb, html, localStorage } = createMockBrowserSandbox({ navigator: { deviceMemory: 4, hardwareConcurrency: 4 } });
    const expr = cdp.buildInjectExpression({ palette: 'obsidian', language: 'en' }, { noDiskCache: true });
    const res = vm.runInNewContext(expr, sb);
    assert.equal(res.status, 'ok');
    assert.equal(sb.__agPrism.getState().cfg.performanceMode, 'performance');
    assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'performance');
    assert.equal(sb.__agPrismDomBus.getPerfCaps(null, sb.document).maxFps, 60);
    assert.equal(sb.__agPrismDomBus.getPerfCaps(null, sb.document).maxDpr, 1);
    assert.equal(sb.__agPrismDomBus.getPerfCaps(null, sb.document).disableHeavyBlur, true);
    // localStorage 不含任何硬件探针键
    const lsDump = JSON.stringify(localStorage._dump());
    assert.equal(/deviceMemory|hardwareConcurrency/i.test(lsDump), false);

    // 用户随后在设置面板显式点选 balanced -> 增量刷新立刻生效且绝不被低配机覆盖
    const refBalanced = cdp.buildConfigRefreshExpression({ performanceMode: 'balanced' });
    const r1 = vm.runInNewContext(refBalanced, sb);
    assert.equal(r1.refreshed, true);
    assert.equal(sb.__agPrism.getState().cfg.performanceMode, 'balanced');
    assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'balanced');

    // 用户切换为 quality -> 同样 100% 尊重
    const refQuality = cdp.buildConfigRefreshExpression({ performanceMode: 'quality' });
    const r2 = vm.runInNewContext(refQuality, sb);
    assert.equal(r2.refreshed, true);
    assert.equal(sb.__agPrism.getState().cfg.performanceMode, 'quality');
    assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'quality');

    sb.__agPrism.destroy();
  }

  // 2) 中高端机（16 核 / 8GB+）+ 相同缺省配置 -> 保持 balanced 满血默认档
  {
    const { sb, html } = createMockBrowserSandbox({ navigator: { deviceMemory: 8, hardwareConcurrency: 16 } });
    const expr = cdp.buildInjectExpression({ palette: 'obsidian', language: 'en' }, { noDiskCache: true });
    const res = vm.runInNewContext(expr, sb);
    assert.equal(res.status, 'ok');
    assert.equal(sb.__agPrism.getState().cfg.performanceMode, 'balanced');
    assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'balanced');
    assert.equal(sb.__agPrismDomBus.getPerfCaps(null, sb.document).maxFps, 180);
    assert.equal(sb.__agPrismDomBus.getPerfCaps(null, sb.document).disableHeavyBlur, false);
    sb.__agPrism.destroy();
  }

  // 3) 低配机 + 初始显式配置 performanceMode: 'balanced' / 'quality' -> 100% 尊重不被覆盖
  for (const explicitMode of ['balanced', 'quality']) {
    const { sb, html } = createMockBrowserSandbox({ navigator: { deviceMemory: 2, hardwareConcurrency: 2 } });
    const expr = cdp.buildInjectExpression({ palette: 'obsidian', language: 'en', performanceMode: explicitMode }, { noDiskCache: true });
    const res = vm.runInNewContext(expr, sb);
    assert.equal(res.status, 'ok');
    assert.equal(sb.__agPrism.getState().cfg.performanceMode, explicitMode, `低配机上显式配置 ${explicitMode} 不得被覆盖`);
    assert.equal(html.getAttribute('data-ag-cs-perf-mode'), explicitMode);
    sb.__agPrism.destroy();
  }
});

test('dom-bus 保守版 getAdaptiveDprCap 与安全版 observeViewportVisibility（基于 IntersectionObserver 离屏暂停）', () => {
  const ioInstances = [];
  class MockIO {
    constructor(cb, opts) {
      this.cb = cb;
      this.opts = opts;
      this.observed = new Set();
      this.disconnected = false;
      ioInstances.push(this);
    }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    emit(el, isIntersecting) { this.cb([{ target: el, isIntersecting }]); }
  }
  const attrs = new Map();
  const dataset = {};
  const html = {
    nodeType: 1,
    dataset,
    setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'data-ag-cs-perf-mode') dataset.agCsPerfMode = String(v); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) { attrs.delete(k); if (k === 'data-ag-cs-perf-mode') delete dataset.agCsPerfMode; },
  };
  const win = { IntersectionObserver: MockIO, addEventListener() {}, removeEventListener() {} };
  const doc = { documentElement: html, defaultView: win, addEventListener() {}, removeEventListener() {} };
  win.document = doc;

  const bus = domBusMod.createInstance(doc, win);
  // 高端机 balanced 不收紧 DPR
  const highEnv = { deviceMemory: 8, hardwareConcurrency: 12 };
  const low4gEnv = { deviceMemory: 4, hardwareConcurrency: 4 };
  const low2gEnv = { deviceMemory: 2, hardwareConcurrency: 2 };
  assert.equal(bus.getAdaptiveDprCap(1.5, highEnv), 1.5);
  assert.equal(bus.getAdaptiveDprCap(2, highEnv), 2);
  assert.equal(bus.getAdaptiveDprCap(0.75, highEnv), 0.75);
  // 低配机保守收紧
  assert.equal(bus.getAdaptiveDprCap(1.5, low4gEnv), 1.25);
  assert.equal(bus.getAdaptiveDprCap(1.5, low2gEnv), 1);
  // performance 档位强制封顶 <= 1
  bus.applyPerformanceMode('performance', doc, win);
  assert.equal(bus.getAdaptiveDprCap(2, highEnv), 1);

  // observeViewportVisibility 去重与离屏暂停清理
  const el = { nodeType: 1, addEventListener() {}, removeEventListener() {} };
  const states = [];
  const off = bus.observeViewportVisibility(el, (vis) => states.push(vis));
  assert.equal(ioInstances.length, 1);
  assert.equal(ioInstances[0].opts?.rootMargin, '0px');
  ioInstances[0].emit(el, true);
  ioInstances[0].emit(el, true); // 重复状态去重
  ioInstances[0].emit(el, false);
  ioInstances[0].emit(el, false); // 重复状态去重
  ioInstances[0].emit(el, true);
  assert.deepEqual(states, [true, false, true]);
  off();
  assert.equal(ioInstances[0].disconnected, true, '取消订阅后应断开闲置 IntersectionObserver');
  bus.dispose(doc, win);
});

test('crystal-prism-core 2D Canvas 渐变按尺寸/主题缓存复用，切换尺寸或主题时自动失效重建', () => {
  let linearCreated = 0;
  let radialCreated = 0;
  let isDark = true;
  let height = 28;
  const ctx2d = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save() {},
    restore() {},
    translate() {},
    beginPath() {},
    roundRect() {},
    clip() {},
    fillRect() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    arc() {},
    setTransform() {},
    clearRect() {},
    createLinearGradient() { linearCreated += 1; return { id: `lg-${linearCreated}`, addColorStop() {} }; },
    createRadialGradient() { radialCreated += 1; return { id: `rg-${radialCreated}`, addColorStop() {} }; },
  };
  const canvas = {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 220, height }),
    getContext: (type) => (type === '2d' ? ctx2d : null),
  };

  const bar = crystalCore.mountCrystalPrismBar(canvas, {
    reduceMotion: false,
    force2D: true,
    getState: () => ({ isDark, prismStrength: 1, hideLock: true, fillRatio: 0.5, ambientIntensity: 1 }),
  });

  // 首帧（含悬停 + 唤醒扫光）：创建 base + slot + gloss + wake = 4 线性渐变，spot = 1 径向渐变
  bar.setPointerClient(100, 14);
  bar.wake();
  assert.equal(bar.step(0.05), true);
  assert.equal(linearCreated, 4, '首帧应创建 base/slot/gloss/wake 共 4 个缓存线性渐变');
  assert.equal(radialCreated, 1, '首帧应创建 1 个缓存径向渐变');

  // 连续 10 帧指针移动与动画更新（尺寸、主题未变）-> 严格 0 次新增渐变分配！
  for (let i = 0; i < 10; i++) {
    bar.setPointerClient(60 + i * 10, 14);
    assert.equal(bar.step(0.05), true);
  }
  assert.equal(linearCreated, 4, '同尺寸同主题连续重绘应 100% 命中线性渐变缓存（0 新增）');
  assert.equal(radialCreated, 1, '同尺寸同主题连续重绘应 100% 命中径向渐变缓存（0 新增）');

  // 切换主题（dark -> light）-> base/slot/gloss 3 个主题渐变自动失效重建
  isDark = false;
  assert.equal(bar.step(0.05), true);
  assert.equal(linearCreated, 7, '切换暗/浅主题后 base/slot/gloss 应自动失效重建');
  assert.equal(bar.step(0.05), true);
  assert.equal(linearCreated, 7, '主题切换后再次重绘继续命中缓存');

  // 改变画布高度（28 -> 36）-> base/slot/gloss 3 个尺寸相关渐变自动失效重建
  height = 36;
  assert.equal(bar.step(0.05), true);
  assert.equal(linearCreated, 10, '画布高度变化后 base/slot/gloss 应自动失效重建');
  assert.equal(bar.step(0.05), true);
  assert.equal(linearCreated, 10, '尺寸变化后再次重绘继续命中缓存');

  bar.dispose();
});

test('prism-rim-canvas 2D 渐变按尺寸/主题缓存复用、切换失效重建及低配 DPR 收紧', () => {
  const makeCtx = () => {
    const counts = { linear: 0, radial: 0 };
    return {
      counts,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arcTo() {},
      closePath() {},
      save() {},
      restore() {},
      clip() {},
      translate() {},
      fillRect() {},
      fill() {},
      stroke() {},
      createRadialGradient() { counts.radial += 1; return { addColorStop() {} }; },
      createLinearGradient() { counts.linear += 1; return { addColorStop() {} }; },
    };
  };
  const boxes = [];
  const makeEl = (tag, attrs = {}, rect = { left: 100, top: 100, width: 400, height: 80, right: 500, bottom: 180 }) => {
    const am = new Map(Object.entries(attrs));
    const cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const kids = [];
    const ctx = tag === 'canvas' ? makeCtx() : null;
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      isConnected: true,
      width: 0,
      height: 0,
      style: { setProperty() {}, removeProperty() {} },
      children: kids,
      parentElement: null,
      _rect: rect,
      classList: { contains: (c) => cls.has(c), add: (...a) => a.forEach((c) => cls.add(c)), remove: (...a) => a.forEach((c) => cls.delete(c)) },
      getAttribute: (k) => (am.has(k) ? am.get(k) : null),
      setAttribute: (k, v) => { am.set(k, String(v)); if (k === 'class') { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); } },
      removeAttribute: (k) => am.delete(k),
      hasAttribute: (k) => am.has(k),
      get firstElementChild() { return kids[0] || null; },
      get nextElementSibling() { const p = el.parentElement; if (!p) return null; const i = p.children.indexOf(el); return i >= 0 ? p.children[i + 1] || null : null; },
      appendChild(c) { c.parentElement = el; kids.push(c); return c; },
      remove() { el.isConnected = false; },
      querySelector: (s) => (s === '.ag-cs-prism-rim-cv' ? kids.find((k) => k.className === 'ag-cs-prism-rim-cv') || null : null),
      getBoundingClientRect: () => el._rect,
      getContext: () => ctx,
      _ctx: ctx,
    };
    Object.defineProperty(el, 'className', {
      get: () => Array.from(cls).join(' '),
      set: (v) => { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
    });
    return el;
  };

  const html = makeEl('html', { 'data-ag-cs-ambient': '1', 'data-ag-cs-motion': 'ultra', 'data-ag-cs-theme': 'dark' });
  const doc = {
    hidden: false,
    documentElement: html,
    createElement: (t) => makeEl(t),
    getElementById: () => null,
    querySelectorAll: (sel) => {
      if (sel.includes('data-ag-cs-prism-box="1"')) return boxes.filter((b) => b.getAttribute('data-ag-cs-prism-box') === '1');
      if (sel.includes('.ag-cs-prism-rim-cv')) return boxes.map((b) => b.querySelector('.ag-cs-prism-rim-cv')).filter(Boolean);
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const prevDoc = globalThis.document;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  const prevPerf = globalThis.performance;
  const prevDpr = globalThis.devicePixelRatio;
  const prevBus = globalThis.__agDomBus;
  const rafs = [];
  let now = 100;
  let dark = true;

  globalThis.document = doc;
  globalThis.devicePixelRatio = 2;
  globalThis.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => now };
  globalThis.__agDomBus = {
    getAdaptiveDprCap: (base) => Math.min(base, 1), // 模拟低配机 DPR=1.0 收紧
  };

  const queuedCard = makeEl(
    'div',
    { 'data-testid': 'queued-messages-card', 'data-ag-cs-prism-box': '1', 'data-ag-cs-prism-reflect': 'bottom' },
    { left: 100, top: 200, width: 400, height: 60, right: 500, bottom: 260 }
  );
  // mirror 卡面积 > 120000（600x260=156000）且远离排队卡（top=700 > 260+280），避免被排队卡指针测试误触发
  const mirrorCard = makeEl(
    'div',
    { class: 'ag-cs-home-panel', 'data-ag-cs-prism-box': '1', 'data-ag-cs-prism-mirror': '1' },
    { left: 100, top: 700, width: 600, height: 260, right: 700, bottom: 960 }
  );
  boxes.push(queuedCard, mirrorCard);

  const ctl = createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => dark,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'default',
    canMountRealCanvas: () => true,
    setAttrIfChanged: (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); },
    runGuardedMut: (fn) => fn(),
  });

  try {
    ctl.mountNewBoxes();
    // 1) 排队卡：首帧创建 2 径向 + 1 线性渐变，且采用低配 DPR=1.0（width = 400 + pad 2 = 402）
    ctl.onPointerMove({ clientX: 250, clientY: 255, target: queuedCard });
    while (rafs.length) rafs.shift()(now += 16);
    const qCv = queuedCard.querySelector('.ag-cs-prism-rim-cv');
    assert.equal(qCv.width, 402, '低配 DPR 收紧到 1.0 时 canvas 物理宽度应按 1x 分配');
    assert.equal(qCv._ctx.counts.linear, 1);
    assert.equal(qCv._ctx.counts.radial, 2);

    // 连续 5 次移动鼠标 -> 0 次新增渐变分配
    for (let i = 1; i <= 5; i++) {
      ctl.onPointerMove({ clientX: 250 + i * 15, clientY: 255, target: queuedCard });
      while (rafs.length) rafs.shift()(now += 16);
    }
    assert.equal(qCv._ctx.counts.linear, 1, '排队卡连续移动鼠标应 100% 复用 destination-in 线性渐变');
    assert.equal(qCv._ctx.counts.radial, 2, '排队卡连续移动鼠标应 100% 复用径向渐变');

    // 切换浅色主题 -> 径向渐变失效重建，高度未变线性遮罩继续复用
    dark = false;
    ctl.onPointerMove({ clientX: 300, clientY: 255, target: queuedCard });
    while (rafs.length) rafs.shift()(now += 16);
    assert.equal(qCv._ctx.counts.radial, 4, '主题切换后排队卡径向渐变应自动失效重建');
    assert.equal(qCv._ctx.counts.linear, 1, '高度未变时纯黑 alpha 线性遮罩无需重建');

    // 改变高度 -> 线性遮罩自动失效重建
    queuedCard._rect = { left: 100, top: 200, width: 400, height: 90, right: 500, bottom: 290 };
    ctl.invalidateMetrics();
    ctl.onPointerMove({ clientX: 310, clientY: 285, target: queuedCard });
    while (rafs.length) rafs.shift()(now += 16);
    assert.equal(qCv._ctx.counts.linear, 2, '卡片高度变化后线性遮罩应自动失效重建');

    // 2) mirror 卡：保留局部裁剪 210px 柔光（每帧 1 次）同时缓存 240px 外框径向渐变（首帧 2 次，后续每移动仅 +1 次而非 +2 次；切换主题时重建外框缓存）
    const mCv = mirrorCard.querySelector('.ag-cs-prism-rim-cv');
    ctl.onPointerMove({ clientX: 300, clientY: 800, target: mirrorCard });
    while (rafs.length) rafs.shift()(now += 16);
    assert.equal(mCv._ctx.counts.radial, 2, 'mirror 卡首帧应创建局部柔光 + 外框共 2 个径向渐变');
    for (let i = 1; i <= 5; i++) {
      ctl.onPointerMove({ clientX: 300 + i * 20, clientY: 800, target: mirrorCard });
      while (rafs.length) rafs.shift()(now += 16);
    }
    assert.equal(mCv._ctx.counts.radial, 7, 'mirror 卡 5 次移动鼠标外框渐变 100% 命中缓存（仅局部柔光 +5，非 +10）');
    dark = true;
    ctl.onPointerMove({ clientX: 360, clientY: 800, target: mirrorCard });
    while (rafs.length) rafs.shift()(now += 16);
    assert.equal(mCv._ctx.counts.radial, 9, 'mirror 卡切换主题后外框径向渐变应自动失效重建（+1 柔光 +1 新外框）');
  } finally {
    ctl.teardown();
    globalThis.document = prevDoc;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancel;
    globalThis.performance = prevPerf;
    if (prevDpr === undefined) delete globalThis.devicePixelRatio; else globalThis.devicePixelRatio = prevDpr;
    if (prevBus === undefined) delete globalThis.__agDomBus; else globalThis.__agDomBus = prevBus;
  }
});

test('原生 C# / Swift 注入器对齐 N8 __pmAuto & resolveAutoBootPerfMode、configRefresh G.__agDomBus 兜底与代码签名口径一致', { skip: 'safe build: native installers removed' }, () => {
  const csSrc = fs.readFileSync(path.join(ROOT, 'installer', 'common', 'CdpClient.cs'), 'utf8');
  const swiftSrc = fs.readFileSync(path.join(ROOT, 'installer', 'macos', 'Common', 'CdpClient.swift'), 'utf8');
  const ch1TplSrc = fs.readFileSync(path.join(ROOT, 'src', 'compiler', 'ch1-templates.cjs'), 'utf8');
  const signDoc = fs.readFileSync(path.join(ROOT, 'docs', 'CODE_SIGNING_POLICY.md'), 'utf8');

  // 1) ch1-templates.cjs configRefresh 补齐 (W.__agDomBus || G.__agDomBus) 并在仅 globalThis.__agDomBus 存在时正常工作
  assert.ok(
    ch1TplSrc.includes('(W.__agDomBus || G.__agDomBus)?.resolveAutoBootPerfMode?.(cfg, W)'),
    'ch1-templates.cjs configRefresh must use (W.__agDomBus || G.__agDomBus) consistently with mount wrapper'
  );
  {
    const { sb, html } = createMockBrowserSandbox({ navigator: { deviceMemory: 4, hardwareConcurrency: 4 } });
    const expr = cdp.buildInjectExpression({ palette: 'obsidian', language: 'en', performanceMode: 'balanced' }, { noDiskCache: true });
    assert.equal(vm.runInNewContext(expr, sb).status, 'ok');
    assert.equal(sb.__agPrism.getState().cfg.performanceMode, 'balanced');
    // 模拟仅 globalThis.__agDomBus 可用的上下文：移除 window 侧引用但保留 globalThis.__agDomBus
    const isolatedWin = { ...sb, __agDomBus: undefined };
    const refSandbox = {
      ...sb,
      window: isolatedWin,
      globalThis: { ...sb, __agDomBus: sb.__agDomBus },
    };
    const refAuto = cdp.buildConfigRefreshExpression({ performanceMode: 'auto' });
    const refRes = vm.runInNewContext(refAuto, refSandbox);
    assert.equal(refRes.refreshed, true);
    assert.equal(sb.__agPrism.getState().cfg.performanceMode, 'performance');
    assert.equal(html.getAttribute('data-ag-cs-perf-mode'), 'performance');
    sb.__agPrism.destroy();
  }

  // 2) C# CdpClient.cs 与 Swift CdpClient.swift 均完整实现 __pmAuto 判定与首次注入/热刷新 resolveAutoBootPerfMode 调用
  assert.ok(csSrc.includes('public static int ResolvePerfModeAutoTag(string baseDir)'));
  assert.ok(csSrc.includes('nextCfg["__pmAuto"] = pmAuto;'));
  assert.ok(csSrc.includes('initCfg["__pmAuto"] = pmAuto;'));
  assert.ok(csSrc.includes('(window.__agDomBus || globalThis.__agDomBus)?.resolveAutoBootPerfMode?.(nextCfg, window)'));
  assert.ok(csSrc.includes('(window.__agDomBus || globalThis.__agDomBus)?.resolveAutoBootPerfMode?.(bootCfg, window)'));

  assert.ok(swiftSrc.includes('static func resolvePerfModeAutoTag(baseDir: String) -> Int'));
  assert.ok(swiftSrc.includes('nextCfg["__pmAuto"] = .int(Int64(pmAuto))'));
  assert.ok(swiftSrc.includes('initCfg["__pmAuto"] = .int(Int64(pmAuto))'));
  assert.ok(swiftSrc.includes('(window.__agDomBus || globalThis.__agDomBus)?.resolveAutoBootPerfMode?.(nextCfg, window)'));
  assert.ok(swiftSrc.includes('(window.__agDomBus || globalThis.__agDomBus)?.resolveAutoBootPerfMode?.(bootCfg, window)'));

  // 3) docs/CODE_SIGNING_POLICY.md 英文声明与中文及 README 口径 100% 统一
  assert.ok(
    signDoc.includes('is planned to be provided by [SignPath.io]'),
    'CODE_SIGNING_POLICY.md English notice must state "is planned to be provided by [SignPath.io]"'
  );
  assert.equal(
    /Free code signing for official Windows release binaries of \*\*Obsidian Prism\*\* is provided by/.test(signDoc),
    false
  );
});
