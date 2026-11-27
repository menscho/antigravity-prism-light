// R2 DOM 调度中枢、全仓 MO/RO 收编、V8 热路径微架构优化与 Issue #105 专项回归单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const domBusMod = require(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'));
const hostI18nMod = require(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'));
const enhancerMod = require(path.join(ROOT, 'host-workbench-enhancer.js'));

function createMockElement(tag = 'div', attrs = {}) {
  const attrMap = new Map(Object.entries(attrs));
  const listeners = new Map();
  const children = [];
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: attrs.id || '',
    className: attrs.class || '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    type: '',
    isConnected: true,
    parentElement: null,
    parentNode: null,
    children,
    childNodes: children,
    dataset: {},
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue() { return ''; },
    },
    get firstChild() { return children[0] || null; },
    get firstElementChild() { return children.find((c) => c.nodeType === 1) || null; },
    get lastElementChild() { for (let i = children.length - 1; i >= 0; i--) if (children[i].nodeType === 1) return children[i]; return null; },
    get nextElementSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const idx = p.children.indexOf(this);
      for (let i = idx + 1; i < p.children.length; i++) if (p.children[i].nodeType === 1) return p.children[i];
      return null;
    },
    get nextSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const idx = p.children.indexOf(this);
      return idx >= 0 ? p.children[idx + 1] || null : null;
    },
    getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
    setAttribute(k, v) {
      attrMap.set(k, String(v));
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
    },
    hasAttribute(k) { return attrMap.has(k); },
    removeAttribute(k) { attrMap.delete(k); },
    appendChild(child) {
      if (child) {
        child.parentElement = this;
        child.parentNode = this;
        children.push(child);
      }
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) { children.splice(idx, 1); child.parentElement = child.parentNode = null; }
      return child;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    replaceChildren(...nodes) {
      for (const c of children) c.parentElement = c.parentNode = null;
      children.length = 0;
      for (const n of nodes) this.appendChild(n);
    },
    contains(other) {
      let cur = other;
      while (cur) { if (cur === this) return true; cur = cur.parentElement; }
      return false;
    },
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, opts });
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.findIndex((x) => x.fn === fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      const e = { target: this, stopPropagation() {}, preventDefault() {}, ...ev };
      const arr = [...(listeners.get(e.type) || [])];
      for (const rec of arr) rec.fn(e);
      return true;
    },
    click() { this.dispatchEvent({ type: 'click' }); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      const matchOne = (node, s) => {
        if (s.startsWith('#')) return node.id === s.slice(1);
        const attrMatch = /^([a-z0-9_-]*)\[([^\]=]+)(?:="([^"]*)")?\]$/i.exec(s);
        if (attrMatch) {
          const [, tg, k, v] = attrMatch;
          if (tg && node.tagName !== tg.toUpperCase()) return false;
          if (!node.hasAttribute(k)) return false;
          return v === undefined ? true : node.getAttribute(k) === v;
        }
        if (s.startsWith('.')) return String(node.className || '').split(/\s+/).includes(s.slice(1));
        return node.tagName === s.toUpperCase();
      };
      const parts = sel.split(',').map((x) => x.trim()).filter(Boolean);
      const walk = (n) => {
        for (const c of n.children) {
          if (c.nodeType === 1) {
            if (parts.some((p) => matchOne(c, p))) out.push(c);
            walk(c);
          }
        }
      };
      walk(this);
      return out;
    },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 80, width: 200, height: 80 }; },
  };
  return el;
}

function createRichMockDom() {
  const html = createMockElement('html');
  const head = createMockElement('head');
  const body = createMockElement('body');
  html.appendChild(head);
  html.appendChild(body);
  const docListeners = [];
  const winListeners = [];
  const mos = [];
  const ros = [];
  const ios = [];

  class MockMO {
    constructor(cb) { this.cb = cb; this.connected = false; this.target = null; this.opts = null; mos.push(this); }
    observe(t, o) { this.connected = true; this.target = t; this.opts = o; }
    disconnect() { this.connected = false; }
    takeRecords() { return []; }
    emit(recs) { if (this.connected) this.cb(recs); }
  }
  class MockRO {
    constructor(cb) { this.cb = cb; this.observed = new Set(); this.connected = true; ros.push(this); }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.connected = false; this.observed.clear(); }
    emit(entries) { if (this.connected) this.cb(entries); }
  }
  class MockIO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts || {}; this.observed = new Set(); this.connected = true; ios.push(this); }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.connected = false; this.observed.clear(); }
    emit(entries) { if (this.connected) this.cb(entries); }
  }

  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    readyState: 'complete',
    createElement: (tag, attrs) => createMockElement(tag, attrs),
    createTextNode: (txt) => ({ nodeType: 3, nodeValue: String(txt || ''), isConnected: true, parentElement: null, parentNode: null }),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(type, fn, opts) { docListeners.push({ type, fn, opts, active: true }); },
    removeEventListener(type, fn) {
      const rec = docListeners.find((x) => x.active && x.type === type && x.fn === fn);
      if (rec) rec.active = false;
    },
    dispatchEvent(ev) {
      for (const rec of docListeners) if (rec.active && rec.type === ev.type) rec.fn(ev);
    },
  };

  const win = {
    document: doc,
    innerWidth: 1440,
    innerHeight: 900,
    MutationObserver: MockMO,
    ResizeObserver: MockRO,
    IntersectionObserver: MockIO,
    AbortController,
    MessageChannel,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    addEventListener(type, fn, opts) { winListeners.push({ type, fn, opts, active: true }); },
    removeEventListener(type, fn) {
      const rec = winListeners.find((x) => x.active && x.type === type && x.fn === fn);
      if (rec) rec.active = false;
    },
    dispatchEvent(ev) {
      for (const rec of winListeners) if (rec.active && rec.type === ev.type) rec.fn(ev);
    },
  };
  doc.defaultView = win;
  return { html, head, body, doc, win, docListeners, winListeners, mos, ros, ios };
}

test('Issue #105: clicking thought stylePreset immediately persists via api.saveConfig({ stylePreset }), guards re-entrancy & swallows errors', async () => {
  const { doc, win, body } = createRichMockDom();
  const savedPayloads = [];
  let pendingResolve = null;
  let mode = 'pending';

  const mockThoughtApi = {
    getConfig: async () => ({
      ok: true,
      stylePreset: savedPayloads.length ? savedPayloads[savedPayloads.length - 1].stylePreset : 'technical',
      customPrompt: '',
      viewMode: 'immersive',
      translateToolSummaries: true,
      translateTitles: false,
      activeProfileId: 'p1',
      profiles: [{ id: 'p1', name: 'Default', baseUrl: 'https://api.example/v1', model: 'gpt-4o-mini', hasApiKey: true, maskedKey: 'sk-***' }],
    }),
    saveConfig(payload) {
      savedPayloads.push(payload);
      if (mode === 'pending') {
        return new Promise((res) => { pendingResolve = res; });
      }
      if (mode === 'reject') {
        return Promise.reject(new Error('network boom'));
      }
      if (mode === 'throw') {
        throw new Error('sync boom');
      }
      return Promise.resolve({ ok: true, ...payload });
    },
    getCacheStats: async () => ({ ok: true, localOnly: true, totalEntries: 0, diskBytes: 0 }),
  };

  const sandbox = {
    window: win,
    document: doc,
    globalThis: win,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    WeakMap,
    WeakSet,
    URL,
  };
  win.window = win;
  win.globalThis = win;
  win.__agPrismThought = mockThoughtApi;

  const settingsUiSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'thought-translator', 'thought-settings-ui.js'), 'utf8');
  vm.runInNewContext(settingsUiSrc, sandbox);

  const mkEl = (tag, cls) => { const e = doc.createElement(tag); if (cls) e.className = cls; return e; };
  const ctrl = win.__agPrismThoughtSettingsUi.createThoughtAiConfigBox({
    mkEl, btnClass: 'btn', ui: {}, lang: 'zh-CN', getLang: () => 'zh-CN', getMode: () => 'ai', runGuardedMut: (fn) => fn(),
  });
  body.appendChild(ctrl.box);
  await new Promise((r) => setTimeout(r, 15));

  const conciseBtn = ctrl.box.querySelector('button[data-thought-style="concise"]');
  const customBtn = ctrl.box.querySelector('button[data-thought-style="custom"]');
  const techBtn = ctrl.box.querySelector('button[data-thought-style="technical"]');
  assert.ok(conciseBtn && customBtn && techBtn, 'All three stylePreset buttons must mount');

  // 1) First click immediately calls api.saveConfig({ stylePreset: 'concise' })
  conciseBtn.click();
  assert.equal(conciseBtn.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(JSON.parse(JSON.stringify(savedPayloads)), [{ stylePreset: 'concise' }]);

  // 2) Re-entrancy guard: clicking while previous save is still in-flight must not fire overlapping saveConfig
  customBtn.click();
  assert.equal(customBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(savedPayloads.length, 1, 'Re-entrant click while styleSaving=true must not invoke overlapping saveConfig');

  // 3) Resolve in-flight promise -> coalescing queue drains queued 'custom' preset automatically & releases lock
  mode = 'ok';
  pendingResolve({ ok: true, stylePreset: 'concise' });
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(JSON.parse(JSON.stringify(savedPayloads)), [{ stylePreset: 'concise' }, { stylePreset: 'custom' }]);

  // 4) Error resilience (async reject & sync throw never crash or leave lock stuck)
  mode = 'reject';
  techBtn.click();
  assert.equal(savedPayloads.length, 3);
  await new Promise((r) => setTimeout(r, 15));

  mode = 'throw';
  conciseBtn.click();
  assert.equal(savedPayloads.length, 4);

  mode = 'ok';
  customBtn.click();
  assert.equal(savedPayloads.length, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(savedPayloads[4])), { stylePreset: 'custom' });

  // 5) Re-mounting settings UI reads persisted 'custom' preset rather than reverting to default 'technical'
  const ctrl2 = win.__agPrismThoughtSettingsUi.createThoughtAiConfigBox({
    mkEl, btnClass: 'btn', ui: {}, lang: 'zh-CN', getLang: () => 'zh-CN', getMode: () => 'ai', runGuardedMut: (fn) => fn(),
  });
  body.appendChild(ctrl2.box);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(ctrl2.box.querySelector('button[data-thought-style="custom"]')?.getAttribute('aria-pressed'), 'true');
});

test('dom-bus.js: window.__agDomBus alias, Chrome 152 scheduler.postTask + TaskController (priority/abort/setPriority) & graceful fallback', async () => {
  // Verify global alias & destroy alias
  assert.equal(globalThis.__agDomBus, globalThis.__agPrismDomBus);
  assert.equal(domBusMod.destroy, domBusMod.dispose);

  // 1) Native Chrome 152 scheduler.postTask + TaskController path
  const { doc, win } = createRichMockDom();
  const posted = [];
  const controllers = [];
  class MockTaskController {
    constructor(opts = {}) {
      this.priority = opts.priority || 'user-visible';
      this.aborted = false;
      this.signal = { aborted: false, priority: this.priority };
      this.priorityHistory = [this.priority];
      controllers.push(this);
    }
    setPriority(p) { this.priority = p; this.signal.priority = p; this.priorityHistory.push(p); }
    abort() { this.aborted = true; this.signal.aborted = true; }
  }
  win.TaskController = MockTaskController;
  win.scheduler = {
    postTask(cb, opts = {}) {
      return new Promise((resolve, reject) => {
        const entry = { cb, opts, resolve, reject };
        posted.push(entry);
      });
    },
    yield: () => Promise.resolve(),
  };

  const nativeBus = domBusMod.createInstance(doc, win);
  const ran = [];
  const p1 = nativeBus.scheduleTask('conv:scan', () => { ran.push('first'); return 1; }, { priority: 'background', delay: 40 });
  assert.equal(controllers.length, 1);
  assert.equal(controllers[0].priority, 'background');
  assert.equal(posted[0].opts.delay, 40);
  assert.equal(posted[0].opts.priority, undefined, 'Must pass TaskController.signal without static priority override');

  // Same key cancels previous task cleanly
  const p2 = nativeBus.scheduleTask('conv:scan', () => { ran.push('second'); return 2; }, { priority: 'background' });
  assert.equal(controllers[0].aborted, true, 'Duplicate key must abort previous TaskController');
  posted[0].reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  assert.equal(await p1, undefined);

  // Dynamic reprioritization background -> user-visible
  assert.equal(nativeBus.reprioritizeTask('conv:scan', 'user-visible'), true);
  assert.deepEqual(controllers[1].priorityHistory, ['background', 'user-visible']);

  // cancelGroup cancels prefix only
  const pOther = nativeBus.scheduleTask('ui:keep', () => { ran.push('keep'); return 'ok'; }, { priority: 'user-visible' });
  const pConv2 = nativeBus.scheduleTask('conv:titles', () => { ran.push('titles'); return 3; }, { priority: 'background' });
  assert.equal(nativeBus.cancelGroup('conv:'), 2);
  assert.equal(controllers[1].aborted, true);
  assert.equal(controllers[3].aborted, true);
  assert.equal(controllers[2].aborted, false);
  posted[1].reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  posted[3].reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  posted[2].resolve(posted[2].cb());
  assert.equal(await p2, undefined);
  assert.equal(await pConv2, undefined);
  assert.equal(await pOther, 'ok');
  assert.deepEqual(ran, ['keep']);

  // destroy() aborts any remaining tasks
  const pLeft = nativeBus.scheduleTask('leftover', () => { ran.push('never'); });
  nativeBus.destroy(doc, win);
  assert.equal(controllers[4].aborted, true);
  assert.equal(nativeBus.getDebugState().pendingTasks, 0);
  posted[4].reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  assert.equal(await pLeft, undefined);

  // 2) Graceful fallback path (no scheduler.postTask -> requestIdleCallback + MessageChannel + AbortController)
  const fbEnv = createRichMockDom();
  const idleQueue = new Map();
  let idleSeq = 0;
  fbEnv.win.requestIdleCallback = (cb) => { const id = ++idleSeq; idleQueue.set(id, cb); return id; };
  fbEnv.win.cancelIdleCallback = (id) => { idleQueue.delete(id); };
  const fbBus = domBusMod.createInstance(fbEnv.doc, fbEnv.win);

  const fbOrder = [];
  const bgProm = fbBus.scheduleTask('conv:bg-fb', () => { fbOrder.push('bg-promoted'); return 'promoted'; }, { priority: 'background' });
  assert.equal(idleQueue.size, 1, 'Background fallback task must queue on requestIdleCallback');
  // Promote from background to user-visible -> cancels idle callback & runs promptly
  assert.equal(fbBus.reprioritizeTask('conv:bg-fb', 'user-visible'), true);
  assert.equal(idleQueue.size, 0, 'Reprioritizing fallback task must cancel pending requestIdleCallback');
  const ubProm = fbBus.scheduleTask('ub-fb', () => { fbOrder.push('user-blocking'); return 'fast'; }, { priority: 'user-blocking' });
  const deadProm = fbBus.scheduleTask('conv:dead', () => { fbOrder.push('never'); }, { priority: 'background' });
  assert.equal(fbBus.cancelTask('conv:dead'), true);
  assert.equal(await ubProm, 'fast');
  assert.equal(await bgProm, 'promoted');
  assert.equal(await deadProm, undefined);
  assert.equal(fbOrder.includes('never'), false);
  fbBus.destroy(fbEnv.doc, fbEnv.win);
});

test('dom-bus.js: observeSize prefers borderBoxSize[0] (fallback contentBoxSize/contentRect), observeVisibility + isSkipped + beforematch + destroy()', () => {
  const { doc, win, body, docListeners, ros, ios } = createRichMockDom();
  const bus = domBusMod.createInstance(doc, win);
  const el = doc.createElement('div');
  const child = doc.createElement('span');
  el.appendChild(child);
  body.appendChild(el);

  // 1) observeSize prefers borderBoxSize[0] over contentRect
  const sizes = [];
  const unobsSize = bus.observeSize(el, (sz) => sizes.push(sz));
  assert.equal(ros.length, 1);
  ros[0].emit([{ target: el, borderBoxSize: [{ inlineSize: 420, blockSize: 180 }], contentRect: { width: 400, height: 160 } }]);
  assert.equal(sizes[0].width, 420);
  assert.equal(sizes[0].height, 180);
  assert.equal(sizes[0].source, 'borderBoxSize');
  assert.equal(bus.getSize(el).width, 420);

  // Fallback to contentBoxSize then contentRect
  ros[0].emit([{ target: el, contentBoxSize: [{ inlineSize: 390, blockSize: 150 }], contentRect: { width: 380, height: 140 } }]);
  assert.equal(sizes[1].source, 'contentBoxSize');
  assert.equal(sizes[1].width, 390);
  ros[0].emit([{ target: el, contentRect: { width: 350, height: 120 } }]);
  assert.equal(sizes[2].source, 'contentRect');
  assert.equal(sizes[2].width, 350);

  // 2) observeVisibility + contentvisibilityautostatechange + ancestor isSkipped + beforematch + shared IO(250px)
  const visEvents = [];
  const unobsVis = bus.observeVisibility(el, (info) => visEvents.push(info));
  assert.equal(ios.length, 1);
  assert.equal(ios[0].opts.rootMargin, '250px 0px');
  assert.equal(bus.isSkipped(el), false);
  assert.equal(bus.isSkipped(child), false);

  // content-visibility: auto skipped -> both container & descendant report isSkipped=true
  el.dispatchEvent({ type: 'contentvisibilityautostatechange', skipped: true, target: el });
  assert.equal(bus.isSkipped(el), true);
  assert.equal(bus.isSkipped(child), true, 'Descendant inside skipped content-visibility container must report isSkipped=true');
  assert.equal(visEvents[visEvents.length - 1].skipped, true);
  assert.equal(visEvents[visEvents.length - 1].source, 'content-visibility');

  // beforematch unlocks offscreen element for Ctrl+F search
  el.dispatchEvent({ type: 'beforematch', target: el });
  assert.equal(bus.isSkipped(el), false);
  assert.equal(bus.isSkipped(child), false);
  assert.equal(visEvents[visEvents.length - 1].visible, true);
  assert.equal(visEvents[visEvents.length - 1].source, 'beforematch');

  // Shared IntersectionObserver marks non-intersecting offscreen & restores on intersect
  ios[0].emit([{ target: el, isIntersecting: false }]);
  assert.equal(bus.isSkipped(el), true);
  ios[0].emit([{ target: el, isIntersecting: true }]);
  assert.equal(bus.isSkipped(el), false);

  // 3) Unobserve & destroy() release 100% of observers and document listeners
  unobsSize();
  assert.equal(ros[0].connected, false);
  unobsVis();
  assert.equal(ios[0].connected, false);
  bus.destroy(doc, win);
  assert.equal(docListeners.filter((l) => l.active).length, 0, 'destroy() must detach all document visibility listeners');
  const dbg = bus.getDebugState();
  assert.equal(dbg.sizeObservedCount, 0);
  assert.equal(dbg.visibilityObservedCount, 0);
  assert.equal(dbg.observing, false);
});

test('MO convergence into dom-bus & offscreen skipping across host-i18n, omni-client, inline-fallback, suggester-client, workbench-enhancer & ui-runtime', () => {
  // 1) host-i18n-runtime routes MO through dom-bus (only 1 shared root MO) + skips isSkipped elements + charCodeAt getClassTokens
  const env = createRichMockDom();
  const bus = domBusMod.createInstance(env.doc, env.win);
  env.win.__agDomBus = bus;
  env.win.__agPrismDomBus = bus;

  const skippedBox = env.doc.createElement('div');
  const skippedBtn = env.doc.createElement('button');
  const skippedTxt = env.doc.createTextNode('Settings');
  skippedBtn.appendChild(skippedTxt);
  skippedBox.appendChild(skippedBtn);
  env.body.appendChild(skippedBox);
  bus.observeVisibility(skippedBox, () => {});
  skippedBox.dispatchEvent({ type: 'contentvisibilityautostatechange', skipped: true, target: skippedBox });
  assert.equal(bus.isSkipped(skippedBtn), true);

  const inst = hostI18nMod.mountHostI18n({ root: env.win, doc: env.doc, mode: 'on', rafFn: (fn) => { fn(); return 1; } });
  // Separate isolated MOs in dom-bus: 1 subtree rootMo (0 root-attr pollution) + 1 subtree:false rootAttrMo
  const activeMos = env.mos.filter((m) => m.connected);
  assert.equal(activeMos.length, 2, 'host-i18n dom (subtree) & winBlur (root-attr subtree:false) must isolate into rootMo + rootAttrMo');
  const subtreeMo = activeMos.find((m) => m.opts?.subtree === true);
  const rootAttrMo = activeMos.find((m) => m.opts?.subtree === false && m.opts?.attributes === true);
  assert.ok(subtreeMo && !subtreeMo.opts?.attributes, 'Global subtree rootMo must have zero root-attribute pollution');
  assert.ok(rootAttrMo && rootAttrMo.opts?.childList === false, 'Root-attribute MO must observe with subtree:false and childList:false');
  assert.equal(skippedTxt.nodeValue, 'Settings', 'Skipped offscreen content-visibility subtree must not be scanned/mutated');
  const clsProbe = env.doc.createElement('div', { class: '  foo\t ag-cs-panel \n bar  ' });
  assert.equal(hostI18nMod.isPrismOwnedElement(clsProbe), true);
  clsProbe.className = 'plain-host-class';
  assert.equal(hostI18nMod.isPrismOwnedElement(clsProbe), false, 'WeakMap classTokenCache must invalidate on className mutation');
  inst.destroy();
  bus.destroy(env.doc, env.win);

  // 2) host-workbench-enhancer: iframeRo reads borderBoxSize via dom-bus observeSize with 0 getBoundingClientRect calls
  const wbEnv = createRichMockDom();
  const wbBus = domBusMod.createInstance(wbEnv.doc, wbEnv.win);
  wbEnv.win.__agDomBus = wbBus;
  const iframe = wbEnv.doc.createElement('iframe', { 'data-testid': 'sidecar-iframe' });
  let gbrCount = 0;
  iframe.getBoundingClientRect = () => { gbrCount++; return { width: 100, height: 100 }; };
  const postedMsgs = [];
  iframe.contentWindow = { postMessage: (m) => postedMsgs.push(m) };
  wbEnv.body.appendChild(iframe);
  const wbCtl = enhancerMod.createHostEnhancerController({ doc: wbEnv.doc, win: wbEnv.win, getLang: () => 'zh-CN' });
  wbCtl.sync();
  assert.equal(wbEnv.ros.length, 1, 'workbench-enhancer should reuse dom-bus ResizeObserver');
  gbrCount = 0;
  wbEnv.ros[0].emit([{ target: iframe, borderBoxSize: [{ inlineSize: 640, blockSize: 480 }] }]);
  wbCtl.sync();
  assert.equal(gbrCount, 0, 'borderBoxSize resize update & subsequent sync must incur 0 getBoundingClientRect forced reflows');
  wbCtl.destroy();
  wbBus.destroy(wbEnv.doc, wbEnv.win);

  // 3) Static architectural verification across all R2 targets
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  assert.equal(/\bnew\s+Proxy\b/.test(uiSrc), false, 'ui-runtime.js must contain 0 new Proxy allocations');
  assert.equal(/(?:Array\.from|AF)\s*\([^)]*\.children\b/.test(uiSrc), false, 'ui-runtime.js must contain 0 Array.from/AF(*.children) allocations');
  assert.ok(uiSrc.includes('PICK_SETS') && !uiSrc.includes("s.split('|').includes(v)"), 'ui-runtime.js pickOf must use cached Set');
  assert.ok(uiSrc.includes("domBus.subscribe('ui-runtime-root'"), 'ui-runtime.js root MO must subscribe through dom-bus');
  assert.ok(uiSrc.includes('Math.max(30000,'), 'ui-runtime.js fallback poll timer must back off to >= 30s');
  assert.ok(uiSrc.includes('__agPrismCssMgr')?.valueOf() && uiSrc.includes('?.sync?.(cfg)'), 'ui-runtime.js must notify __agPrismCssMgr?.sync?.(cfg)');

  const omniSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'omni-viewer', 'omni-client.js'), 'utf8');
  assert.ok(omniSrc.includes("bus.subscribe('omni-root-attr'") && omniSrc.includes("bus.subscribe('omni-dom'"), 'omni-client MOs must converge into dom-bus');

  const fbSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'pulse-dashboard', 'inline-fallback.js'), 'utf8');
  assert.ok(fbSrc.includes("subMo('pulse-blur'") && fbSrc.includes("subMo('pulse-seat'") && fbSrc.includes('borderBoxSize'), 'inline-fallback MOs & RO must converge into dom-bus + borderBoxSize');

  const sugSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'prompt-suggester', 'suggester-client.js'), 'utf8');
  assert.ok(sugSrc.includes("domBus.subscribe('suggester-dom'"), 'suggester-client MO must converge into dom-bus');

  const thSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8');
  assert.ok(thSrc.includes('getDomBus()?.isSkipped?.(el)') && thSrc.includes("bus.scheduleTask('conv:thought-scan'"), 'thought-client must integrate domBus.isSkipped and background scheduleTask');

  const scSrc = fs.readFileSync(path.join(ROOT, 'stream-choreography.js'), 'utf8');
  assert.ok(scSrc.includes('bus?.isSkipped?.(hdr)') && scSrc.includes('getBus()?.isSkipped?.(baseEl)') && scSrc.includes("bus.measure('sc:caustics-r'"), 'stream-choreography must integrate domBus.isSkipped and measure/mutate');

  const rimSrc = fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8');
  assert.ok(rimSrc.includes('bus.observeVisibility(p') && rimSrc.includes('bus.observeSize(box') && rimSrc.includes("bus.measure('rim:rects'"), 'prism-rim-canvas must integrate observeVisibility, observeSize and measure');

  const hiSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'), 'utf8');
  assert.ok(hiSrc.includes('classTokenCache') && hiSrc.includes('raw.charCodeAt(i)') && hiSrc.includes("domBusInst.subscribe('host-i18n-dom'"), 'host-i18n must use WeakMap+charCodeAt getClassTokens and dom-bus subscribe');
});

test('V8 hot-path equivalence: thought-client single-pass TOOL_PROTECT_RE matches all 17 legacy rules & countScripts matches 5-regex baseline', () => {
  const thSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8');
  assert.equal(thSrc.includes('TOOL_PROTECT_RES'), false, 'Legacy 17-pass TOOL_PROTECT_RES array must be replaced by single-pass TOOL_PROTECT_RE');

  // Extract ciPat, TOOL_PROTECT_RE, protectToolSummaryTokens & countScripts directly from thought-client.js source
  const csMatch = /function countScripts\(str\)\s*\{[\s\S]*?\n  \}/.exec(thSrc);
  const reMatch = /const ciPat =[\s\S]*?\.join\('\|'\), 'g'\);/.exec(thSrc);
  const fnMatch = /function protectToolSummaryTokens\(text\)\s*\{[\s\S]*?\n  \}/.exec(thSrc);
  assert.ok(csMatch && reMatch && fnMatch, 'Must locate upgraded countScripts, TOOL_PROTECT_RE and protectToolSummaryTokens');

  const box = {};
  vm.runInNewContext(`${csMatch[0]}\n${reMatch[0]}\n${fnMatch[0]}\nthis.countScripts = countScripts; this.protectToolSummaryTokens = protectToolSummaryTokens;`, box);

  // Reference 17-pass implementation
  const LEGACY_17_RES = [
    /\x60[^\x60\n]+\x60/g,
    /\bExited\s+with\s+(?:exit\s+)?code\s+-?\d+\b/gi,
    /\bexit\s+code\s+-?\d+\b/gi,
    /\bHTTP\s+\d{3}\b/g,
    /(?:https?|file|socks5h?):\/\/[^\s\x22\x27<>()]+/gi,
    /[A-Za-z]:[\\/][^\s\x22\x27<>|]+/g,
    /(?<![A-Za-z0-9_])(?:\.{1,2}\/|\/)(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?(?::\d+)?)?/g,
    /(?<![A-Za-z0-9_./\\-])(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?(?::\d+)?)?/g,
    /#L\d+(?:-L?\d+)?\b/gi,
    /\bL\d+-L?\d+\b/g,
    /(?<!\w):\d+(?:-\d+)(?::\d+)?\b/g,
    /(?<![A-Za-z0-9_./\\-])[A-Za-z0-9_][A-Za-z0-9_.-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?)?(?![A-Za-z0-9_])/g,
    /(?<=^|[\s([{\x22\x27])--?[A-Za-z][A-Za-z0-9_-]*(?:=[^\s)\]}\x22\x27]+)?/g,
    /\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g,
    /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)\b/g,
    /\b[A-Za-z_][A-Za-z0-9_]*\(\)/g,
    /\b(?:xlsx|xls|docx|pptx|csv|tsv|json|jsonl|yaml|yml|toml|xml|html|htm|css|scss|less|mjs|cjs|jsx|tsx|pyc|cpp|hpp|ps1|bat|cmd|sql|mdx|txt|pdf|png|jpg|jpeg|webp|svg|gif|ico|zip|tar|tgz|rar|env|ini|cfg|conf|diff|patch|exe|dll|dylib|wasm|ipynb|parquet|sqlite)\b/gi,
  ];
  const legacyProtect = (text) => {
    const tokens = [];
    let masked = String(text || '');
    for (const re of LEGACY_17_RES) {
      re.lastIndex = 0;
      masked = masked.replace(re, (m) => (!m || m.includes('__OPID_') ? m : `__OPID_${tokens.push(m) - 1}__`));
    }
    return { masked, tokens };
  };

  // Verify every single one of the 17 rules + case-sensitivity boundaries
  const cases = [
    'Run `npm run test:gates` now',
    'Process exited with exit code -1 after build',
    'Process Exited with code 127',
    'Returned EXIT CODE 0 cleanly',
    'Server responded HTTP 502 while http 502 is prose',
    'Fetching HTTPS://Example.com/api/v1?x=1 and socks5h://127.0.0.1:7890',
    'Read C:\\Users\\dev\\project\\index.mjs successfully',
    'Inspect ./src/runtime/dom-bus.js#L10-L45 and /etc/hosts',
    'Check vendor/thought-translator/thought-client.js:725-789',
    'Jump to #l12-l30 and #L99',
    'Compare L10-L25 with l10-l25',
    'Error at :12-34:5 in block',
    'Edit package.json and style.css:10-20',
    'Pass --dry-run and -v to CLI',
    'Update active_chunk_epoch and max_retry_count',
    'Call scheduleTask and TaskController but keep reading lowercase words',
    'Invoke render() cleanly',
    'Export JSON, SQLite, WebP and XLSX reports',
  ];
  const restore = ({ masked, tokens }) => masked.replace(/__OPID_(\d+)__/g, (_, i) => tokens[Number(i)]);
  for (const sample of cases) {
    const cur = JSON.parse(JSON.stringify(box.protectToolSummaryTokens(sample)));
    const leg = legacyProtect(sample);
    assert.equal(restore(cur), sample, `Roundtrip restore failed on: ${sample}`);
    assert.equal(cur.masked.replace(/__OPID_\d+__/g, '__T__'), leg.masked.replace(/__OPID_\d+__/g, '__T__'), `Masked template mismatch on: ${sample}`);
    assert.deepEqual([...cur.tokens].sort(), [...leg.tokens].sort(), `Protected token set mismatch on: ${sample}`);
  }

  // Verify countScripts charCodeAt equivalence against 5-regex baseline
  const legacyCountScripts = (str) => ({
    lw: (str.match(/[A-Za-z]{3,}/g) || []).length,
    lc: (str.match(/[A-Za-z]/g) || []).length,
    cjk: (str.match(/[\u4e00-\u9fa5]/g) || []).length,
    kana: (str.match(/[\u3040-\u30ff]/g) || []).length,
    han: (str.match(/[\uac00-\ud7af]/g) || []).length,
  });
  for (const s of [
    '',
    'a ab abc abcd XYz',
    '中文测试 Hello world 日本語カタカナ 한국어テスト',
    '123!@# foo_bar-baz a1b2c3',
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(box.countScripts(s))), legacyCountScripts(s), `countScripts mismatch on "${s}"`);
  }
});

test('V8 hot-path: omni-client BARE_TOKEN_RE O(n) pre-check prunes pure prose & slash-heavy non-extension lines without regression', () => {
  const omniSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'omni-viewer', 'omni-client.js'), 'utf8');
  const m1 = /const BARE_TOKEN_RE = new RegExp\([\s\S]*?\);/.exec(omniSrc);
  const m2 = /function mayContainBareToken\(raw\)\s*\{[\s\S]*?\n  \}/.exec(omniSrc);
  assert.ok(m1 && m2, 'Must extract BARE_TOKEN_RE and mayContainBareToken from omni-client.js');

  const box = {};
  vm.runInNewContext(`${m1[0]}\n${m2[0]}\nthis.BARE_TOKEN_RE = BARE_TOKEN_RE; this.mayContainBareToken = mayContainBareToken;`, box);

  // Pure natural language -> fast false
  assert.equal(box.mayContainBareToken('This is plain English prose without links or file paths.'), false);
  assert.equal(box.mayContainBareToken('这是一段没有任何路径或网址的纯自然语言段落。'), false);

  // Adversarial multi-slash string without any extension (even with trailing period) -> pruned in O(n), < 5ms
  const adversarial = `Compare ${'seg/'.repeat(1500)}tail.`;
  const t0 = performance.now();
  const hit = box.mayContainBareToken(adversarial);
  const dt = performance.now() - t0;
  assert.equal(hit, false, 'Multi-slash non-extension text with trailing sentence period must be pruned before regex');
  assert.ok(dt < 20, `O(n) pre-check took ${dt.toFixed(2)}ms (expected < 20ms)`);

  // Valid URLs & file paths -> still pass pre-check and match BARE_TOKEN_RE
  for (const valid of [
    'Open https://github.com/RMvdesi/obsidian-prism/issues/105 now',
    'Preview at localhost:3773/api/health',
    'Edit C:\\workspace\\src\\app.ts#L10-L20',
    'Check ./src/runtime/dom-bus.js:12 and vendor/omni-viewer/omni-client.js',
  ]) {
    assert.equal(box.mayContainBareToken(valid), true, `Valid token line must pass pre-check: ${valid}`);
    box.BARE_TOKEN_RE.lastIndex = 0;
    assert.ok(box.BARE_TOKEN_RE.exec(valid), `BARE_TOKEN_RE must match valid token in: ${valid}`);
  }
});
