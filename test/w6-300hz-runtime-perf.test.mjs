import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const domBusMod = require(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'));
const enhancerMod = require(path.join(ROOT, 'host-workbench-enhancer.js'));

function createMiniDom() {
  const matchSimple = (el, part) => {
    let s = part.trim();
    if (!s || el.nodeType !== 1) return false;
    const tm = /^[a-zA-Z0-9-]+/.exec(s);
    if (tm) {
      if (el.tagName !== tm[0].toUpperCase()) return false;
      s = s.slice(tm[0].length);
    }
    while (s) {
      if (s[0] === '.') {
        const m = /^\.([a-zA-Z0-9_-]+)/.exec(s);
        if (!m || !el.classList.contains(m[1])) return false;
        s = s.slice(m[0].length);
      } else if (s[0] === '#') {
        const m = /^#([a-zA-Z0-9_-]+)/.exec(s);
        if (!m || el.id !== m[1]) return false;
        s = s.slice(m[0].length);
      } else if (s[0] === '[') {
        const m = /^\[([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/.exec(s);
        if (!m) return false;
        const [, k, v1, v2, v3] = m;
        const val = v1 ?? v2 ?? v3;
        if (val === undefined) { if (!el.hasAttribute(k)) return false; }
        else if (el.getAttribute(k) !== val) return false;
        s = s.slice(m[0].length);
      } else {
        return false;
      }
    }
    return true;
  };
  const matchChain = (el, chain) => {
    const segs = chain.trim().split(/\s+/);
    if (!matchSimple(el, segs[segs.length - 1])) return false;
    let cur = el.parentElement;
    for (let i = segs.length - 2; i >= 0; i--) {
      let ok = false;
      while (cur) { if (matchSimple(cur, segs[i])) { ok = true; cur = cur.parentElement; break; } cur = cur.parentElement; }
      if (!ok) return false;
    }
    return true;
  };
  const matchesSel = (el, sel) => String(sel || '').split(',').some((p) => matchChain(el, p));
  const mkNode = (nodeType, tag = '') => {
    const attrs = new Map();
    const clsSet = new Set();
    const n = {
      nodeType,
      tagName: tag.toUpperCase(),
      nodeValue: '',
      data: '',
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      hidden: false,
      style: { setProperty() {}, removeProperty() {} },
      classList: {
        add: (...cs) => { cs.forEach((c) => c && clsSet.add(c)); attrs.set('class', [...clsSet].join(' ')); },
        remove: (...cs) => { cs.forEach((c) => clsSet.delete(c)); attrs.set('class', [...clsSet].join(' ')); },
        contains: (c) => clsSet.has(c),
      },
      get parentElement() { return n.parentNode?.nodeType === 1 ? n.parentNode : null; },
      get children() { return n.childNodes.filter((c) => c.nodeType === 1); },
      get firstChild() { return n.childNodes[0] || null; },
      get firstElementChild() { return n.children[0] || null; },
      get lastElementChild() { const ch = n.children; return ch[ch.length - 1] || null; },
      get nextSibling() { const a = n.parentNode?.childNodes; const i = a ? a.indexOf(n) : -1; return i >= 0 ? a[i + 1] || null : null; },
      get nextElementSibling() { let c = n.nextSibling; while (c && c.nodeType !== 1) c = c.nextSibling; return c || null; },
      get previousElementSibling() { const ch = n.parentElement?.children; const i = ch ? ch.indexOf(n) : -1; return i > 0 ? ch[i - 1] : null; },
      get isConnected() { let c = n; while (c) { if (c === doc.documentElement) return true; c = c.parentNode; } return false; },
      get id() { return attrs.get('id') || ''; },
      set id(v) { attrs.set('id', String(v || '')); },
      get className() { return attrs.get('class') || ''; },
      set className(v) { clsSet.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => clsSet.add(c)); attrs.set('class', [...clsSet].join(' ')); },
      get textContent() { return n.nodeType === 3 ? n.data : n.childNodes.map((c) => c.textContent).join(''); },
      set textContent(v) {
        if (n.nodeType === 3) { n.data = n.nodeValue = String(v ?? ''); return; }
        for (const c of n.childNodes) c.parentNode = null;
        n.childNodes = [];
        const s = String(v ?? '');
        if (s) n.appendChild(doc.createTextNode(s));
      },
      setAttribute(k, v) { const s = String(v); attrs.set(k, s); if (k === 'class') n.className = s; },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); if (k === 'class') clsSet.clear(); },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = n; c.ownerDocument = doc; n.childNodes.push(c); return c; },
      insertBefore(c, ref) {
        if (!ref) return n.appendChild(c);
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = n.childNodes.indexOf(ref);
        c.parentNode = n; c.ownerDocument = doc;
        if (i < 0) n.childNodes.push(c); else n.childNodes.splice(i, 0, c);
        return c;
      },
      removeChild(c) { const i = n.childNodes.indexOf(c); if (i >= 0) { n.childNodes.splice(i, 1); c.parentNode = null; } return c; },
      remove() { if (n.parentNode) n.parentNode.removeChild(n); },
      contains(o) { let c = o; while (c) { if (c === n) return true; c = c.parentNode; } return false; },
      matches(sel) { return matchesSel(n, sel); },
      closest(sel) { let c = n; while (c && c.nodeType === 1) { if (matchesSel(c, sel)) return c; c = c.parentElement; } return null; },
      querySelectorAll(sel) { const out = []; const w = (x) => { for (const c of x.childNodes) if (c.nodeType === 1) { if (matchesSel(c, sel)) out.push(c); w(c); } }; w(n); return out; },
      querySelector(sel) { return n.querySelectorAll(sel)[0] || null; },
      getElementsByClassName(cn) { return n.querySelectorAll(`.${cn}`); },
      getElementsByTagName(tg) { return n.querySelectorAll(tg); },
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, right: 600, bottom: 200, width: 600, height: 200 }; },
    };
    return n;
  };
  const docLs = new Map(), winLs = new Map();
  const bindLs = (m) => ({
    addEventListener(t, fn) { if (!m.has(t)) m.set(t, []); m.get(t).push(fn); },
    removeEventListener(t, fn) { const a = m.get(t); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    dispatchEvent(ev) { for (const fn of (m.get(ev.type) || []).slice()) fn(ev); return true; },
  });
  const doc = {
    nodeType: 9, hidden: false, readyState: 'complete', visibilityState: 'visible',
    ...bindLs(docLs),
    createElement: (tag) => { const e = mkNode(1, tag); e.ownerDocument = doc; return e; },
    createTextNode: (t) => { const e = mkNode(3); e.data = e.nodeValue = String(t ?? ''); e.ownerDocument = doc; return e; },
    getElementById: (id) => doc.documentElement.querySelector(`#${id}`),
    querySelector: (s) => doc.documentElement.querySelector(s),
    querySelectorAll: (s) => doc.documentElement.querySelectorAll(s),
    getElementsByClassName: (c) => doc.documentElement.querySelectorAll(`.${c}`),
  };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  const win = {
    document: doc, innerWidth: 1440, innerHeight: 900,
    ...bindLs(winLs),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: { language: 'en-US' },
  };
  doc.defaultView = win;
  return { doc, win };
}

function makeNode(doc, tag, attrs = {}) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// 1. host-workbench-enhancer: scroll read/write separation, code block stamp fast-skip, merged ambient scan & 120ms throttle
test('w6-1: host-workbench-enhancer eliminates scroll layout thrashing, skips code textContent concat in hot phase, and merges/throttles ambient scan', () => {
  const { doc, win } = createMiniDom();
  const events = [];
  const bus = domBusMod.createInstance(doc, win);
  win.__agDomBus = bus;

  const origMeasure = bus.measure.bind(bus);
  const origMutate = bus.mutate.bind(bus);
  let measureCalls = 0;
  let mutateCalls = 0;
  bus.measure = (k, fn) => {
    measureCalls++;
    return origMeasure(k, () => {
      events.push(`read:${k}`);
      return fn();
    });
  };
  bus.mutate = (k, fn) => {
    mutateCalls++;
    return origMutate(k, () => {
      events.push(`write:${k}`);
      return fn();
    });
  };

  // Build scrollable scope with non-S_VP plain container so scrollHeight/clientHeight getter is exercised
  const scope = makeNode(doc, 'div', { 'data-testid': 'side-question-panel' });
  const scroller = makeNode(doc, 'div', { class: 'overflow-y-auto' });
  let scrollHeightReads = 0;
  Object.defineProperty(scroller, 'scrollHeight', {
    get() {
      scrollHeightReads++;
      events.push('layout:scrollHeight');
      return 1200;
    },
    configurable: true,
  });
  Object.defineProperty(scroller, 'clientHeight', { get: () => 300, configurable: true });
  scroller.scrollTop = 40;
  const scrollBtn = makeNode(doc, 'button', { class: 'agy-scroll-bottom' });
  scope.appendChild(scroller);
  scope.appendChild(scrollBtn);
  doc.body.appendChild(scope);

  let setScrollingCount = 0;
  const origSetAttr = scope.setAttribute.bind(scope);
  scope.setAttribute = (k, v) => {
    if (k === 'data-ag-scrolling') {
      setScrollingCount++;
      events.push('dom:set-scrolling');
    }
    return origSetAttr(k, v);
  };

  let running = true;
  const conv = makeNode(doc, 'div', { 'data-testid': 'conversation-view' });
  const resp = makeNode(doc, 'div', { 'data-testid': 'agent-response' });
  const pre = makeNode(doc, 'pre');
  const card = makeNode(doc, 'div', { class: 'relative my-2 rounded-xl bg-muted border' });
  const hdr = makeNode(doc, 'div', { class: 'min-h-7 relative flex items-center justify-between border-b px-2' });
  hdr.appendChild(makeNode(doc, 'div'));
  hdr.appendChild(makeNode(doc, 'div'));
  const bodyWrap = makeNode(doc, 'div', { class: 'p-3' });
  const codeBlock = makeNode(doc, 'div', { class: 'code-block' });
  for (let i = 0; i < 60; i++) {
    const ln = makeNode(doc, 'div', { class: 'code-line' });
    ln.appendChild(doc.createTextNode(`const x_${i} = ${i};`));
    codeBlock.appendChild(ln);
  }
  bodyWrap.appendChild(codeBlock);
  card.appendChild(hdr);
  card.appendChild(bodyWrap);
  pre.appendChild(card);
  const trailingP = makeNode(doc, 'p');
  trailingP.textContent = 'after code';
  resp.appendChild(pre);
  resp.appendChild(trailingP);
  // Add a second trailing response so first response is non-streaming but conversation is still running
  const resp2 = makeNode(doc, 'div', { 'data-testid': 'agent-response' });
  const p2 = makeNode(doc, 'p');
  p2.textContent = 'streaming...';
  resp2.appendChild(p2);
  conv.appendChild(resp);
  conv.appendChild(resp2);
  doc.body.appendChild(conv);

  // Also mount subagent / overview ambient DOM
  const ovShell = makeNode(doc, 'div', { 'data-ag-cs-overview-shell': '1' });
  const ovPanel = makeNode(doc, 'div', { 'data-testid': 'overview-panel' });
  const subNode = makeNode(doc, 'div', { 'data-testid': 'subagent-node' });
  const spin = makeNode(doc, 'span', { 'data-testid': 'status-loading-spinner' });
  subNode.appendChild(spin);
  ovPanel.appendChild(subNode);
  ovShell.appendChild(ovPanel);
  doc.body.appendChild(ovShell);

  const ctl = enhancerMod.createHostEnhancerController({
    doc,
    win,
    getLang: () => 'en',
    isConvRunning: () => running,
  });

  try {
    // 1a) Passive scroll no longer performs scrollHeight layout reads or writes useless data-ag-scrolling="1" onto whole scope container
    win.dispatchEvent({ type: 'scroll', target: scroller });
    bus.flushNow();
    assert.equal(scope.hasAttribute('data-ag-scrolling'), false, 'Passive scroll must NOT stamp data-ag-scrolling="1" onto whole scope container');
    assert.equal(scrollHeightReads, 0, 'Passive scroll must trigger 0 scrollHeight layout reads');
    assert.equal(setScrollingCount, 0, 'Passive scroll must trigger 0 scope data-ag-scrolling DOM writes');

    // 1b) 50 subsequent scroll events on same target remain 0 layout reads & 0 scope DOM writes
    for (let i = 0; i < 50; i++) win.dispatchEvent({ type: 'scroll', target: scroller });
    bus.flushNow();
    assert.equal(scrollHeightReads, 0, 'Repeated scroll events must perform 0 scrollHeight reads');
    assert.equal(setScrollingCount, 0, 'Repeated scroll events must perform 0 scope DOM writes');

    // 1c) Code block sync in hot/scrolling phase avoids full bodyWrap.textContent concatenation
    ctl.sync();
    assert.equal(hdr.getAttribute('data-ag-cs-code-sticky'), '1');
    let bodyTextConcatReads = 0;
    Object.defineProperty(bodyWrap, 'textContent', {
      get() {
        bodyTextConcatReads++;
        return 'concat';
      },
      configurable: true,
    });
    // Force non-sealed artifact pre to verify hot-phase childNodes.length + leafLen fast path never triggers body textContent concat
    const artView = makeNode(doc, 'div', { 'data-testid': 'artifact-view' });
    const artPre = makeNode(doc, 'pre');
    const artCard = makeNode(doc, 'div', { class: 'relative my-2 rounded-xl bg-muted border' });
    const artHdr = makeNode(doc, 'div', { class: 'min-h-7 relative flex items-center justify-between border-b px-2' });
    artHdr.appendChild(makeNode(doc, 'div'));
    artHdr.appendChild(makeNode(doc, 'div'));
    const artBody = makeNode(doc, 'div', { class: 'p-3' });
    const artCode = makeNode(doc, 'div', { class: 'code-block' });
    for (let i = 0; i < 55; i++) {
      const ln = makeNode(doc, 'div', { class: 'code-line' });
      ln.appendChild(doc.createTextNode(`line_${i}`));
      artCode.appendChild(ln);
    }
    artBody.appendChild(artCode);
    artCard.appendChild(artHdr);
    artCard.appendChild(artBody);
    artPre.appendChild(artCard);
    artView.appendChild(artPre);
    doc.body.appendChild(artView);

    ctl.sync();
    let artBodyConcatReads = 0;
    Object.defineProperty(artBody, 'textContent', {
      get() {
        artBodyConcatReads++;
        return 'art-concat';
      },
      configurable: true,
    });
    for (let i = 0; i < 10; i++) ctl.sync({ c: true });
    assert.equal(bodyTextConcatReads, 0, 'Sealed code block must perform 0 body.textContent reads');
    assert.equal(artBodyConcatReads, 0, 'Unsealed code block with unchanged childNodes during hot/scroll phase must perform 0 body.textContent reads');

    // 1d) syncSubagentRunningAmbient merges queries into 1 combined selector and throttles incremental calls within 120ms
    let ambientQaCalls = 0;
    const origQsa = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = (sel) => {
      if (String(sel).includes('subagent-node') || String(sel).includes('step-plan') || String(sel).includes('overview-panel')) {
        ambientQaCalls++;
      }
      return origQsa(sel);
    };
    ctl.sync(); // full sync -> exactly 1 merged querySelectorAll
    assert.equal(ambientQaCalls, 1, 'syncSubagentRunningAmbient must issue 1 merged querySelectorAll instead of 3-4 separate tree walks');
    assert.equal(subNode.getAttribute('data-ag-sub-running'), '1');

    // Rapid streaming/content incremental syncs within 120ms window are throttled (0 immediate extra scans)
    for (let i = 0; i < 8; i++) ctl.sync({ c: true });
    assert.equal(ambientQaCalls, 1, 'Incremental ambient syncs inside 120ms window must be throttled');
    // Explicit overlay/overview sync ({ o: true }) runs synchronously without 120ms UI lag
    ctl.sync({ o: true });
    assert.equal(ambientQaCalls, 2, 'Explicit overview sync ({ o: true }) must update synchronously');
  } finally {
    ctl.destroy();
    bus.dispose(doc, win);
    assert.equal(scope.hasAttribute('data-ag-scrolling'), false, 'destroy() must clean up data-ag-scrolling');
  }
});

// 2. ui-runtime: legacy syncBleedTables cleans Wave 6 turn/response over-marking, axO debounces childList & reuses MO, syncTakeoverNow batches & keeps Read < Write
test('w6-2: ui-runtime omits Wave 6 whole-turn bleed marking, axO debounces childList without redundant disconnect, syncTakeoverNow separates Read/Write', async () => {
  const { doc, win } = createMiniDom();
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');

  // Static contract check for syncTakeoverNow (Read before Write, no immediate rescanNow after Write)
  const tkBlock = uiSrc.match(/const syncTakeoverNow = \(\) => \{[\s\S]*?\n\};/);
  assert.ok(tkBlock, 'syncTakeoverNow must exist in ui-runtime.js');
  assert.ok(tkBlock[0].includes('tkMicroQueued'), 'syncTakeoverNow must deduplicate queued microtasks');
  assert.ok(tkBlock[0].includes('measureCrabClearanceAll()'), 'syncTakeoverNow must run measureCrabClearanceAll in read phase');
  assert.ok(tkBlock[0].includes('smoothCaretCtl.measureSnapshot'), 'syncTakeoverNow must pre-measure caret snapshot before mutating');
  assert.equal(tkBlock[0].includes('rescanNow'), false, 'syncTakeoverNow must not synchronously call rescanNow right after Write');

  // Live VM boot to verify syncBleedTables + axO childList debounce/reuse
  const moInstances = [];
  class SpyMO {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      this.disconnectCount = 0;
      this.observeCount = 0;
      moInstances.push(this);
    }
    observe(target, opts) {
      this.observeCount++;
      this.targets.push({ target, opts });
    }
    disconnect() {
      this.disconnectCount++;
      this.targets = [];
    }
    takeRecords() { return []; }
  }

  const pendingTimers = new Map();
  let nextTid = 1;
  const fakeST = (fn, ms) => {
    const id = nextTid++;
    pendingTimers.set(id, { fn, ms });
    return id;
  };
  const fakeCT = (id) => { pendingTimers.delete(id); };

  const vp = makeNode(doc, 'div', { 'data-testid': 'autoscroll-viewport' });
  const turnCards = makeNode(doc, 'div', { 'data-testid': 'turn-cards-container' });
  const agentResp = makeNode(doc, 'div', { 'data-testid': 'agent-response' });
  const tblHost = makeNode(doc, 'div', { class: 'md-table-host' });
  agentResp.appendChild(tblHost);
  turnCards.appendChild(agentResp);
  vp.appendChild(turnCards);
  doc.body.appendChild(vp);

  const auxSplit = makeNode(doc, 'div', { 'data-testid': 'aux-pane-split' });
  const auxLeft = makeNode(doc, 'div', { style: 'width: 500px' });
  const auxMid = makeNode(doc, 'div', { role: 'separator' });
  const auxRight = makeNode(doc, 'div', { style: 'width: 400px' });
  auxSplit.appendChild(auxLeft);
  auxSplit.appendChild(auxMid);
  auxSplit.appendChild(auxRight);
  doc.body.appendChild(auxSplit);

  const sb = {
    window: null,
    globalThis: null,
    document: doc,
    MutationObserver: SpyMO,
    setTimeout: fakeST,
    clearTimeout: fakeCT,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => fakeST(fn, 16),
    cancelAnimationFrame: fakeCT,
    performance: { now: () => 1000 },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    location: { pathname: '/c/test-w6' },
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    __agMotionEngine: { glideIndicator() {}, bindMicroInteractions: () => ({ unbind() {} }) },
    Set, WeakSet, Map, WeakMap, Array, Object, Number, Math, String, Boolean, JSON, Promise, Date, RegExp,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'stream-choreography.js'), 'utf8'), sb);
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8'), sb);
  const uiFactory = require(path.join(ROOT, 'ui-runtime.js'));
  vm.runInNewContext(`(${uiFactory.toString()})(${JSON.stringify(cdp.DEFAULT_CONFIG)})`, sb);

  const api = sb.window.__agPrism;
  try {
    // 2a) Wave 6 whole-turn content-visibility:auto was reverted, so agent-response & turn-cards-container no longer need bleed workaround attrs
    assert.equal(agentResp.hasAttribute('data-ag-cs-bleed'), false, 'agent-response no longer requires Wave 6 bleed attr');
    assert.equal(turnCards.hasAttribute('data-ag-cs-bleed'), false, 'turn-cards-container no longer requires Wave 6 bleed attr');
    tblHost.remove();
    api.sync();

    // 2b) axO childList storm is debounced (64ms) & reuses same observer (0 disconnect when first/last unchanged)
    const axMo = moInstances.find((m) => m.targets.some((t) => t.target === auxSplit));
    assert.ok(axMo, 'axO must be active on aux-pane-split');
    const dcBefore = axMo.disconnectCount;
    const obsBefore = axMo.observeCount;

    for (let i = 0; i < 15; i++) {
      axMo.cb([{ type: 'childList', target: auxSplit }]);
    }
    assert.equal(axMo.disconnectCount, dcBefore, 'Burst childList mutations must not synchronously call disconnect()');
    const debounceEntries = [...pendingTimers.values()].filter((t) => t.ms === 64);
    assert.equal(debounceEntries.length, 1, '15 childList mutations must coalesce into 1 single 64ms debounce timer');

    // Fire 64ms timer with unchanged [auxLeft, auxRight] -> 0 disconnect, 0 re-observe
    debounceEntries[0].fn();
    assert.equal(axMo.disconnectCount, dcBefore, 'Unchanged first/last children must reuse existing axO with 0 disconnect');
    assert.equal(axMo.observeCount, obsBefore, 'Unchanged first/last children must trigger 0 redundant observe() calls');

    // Replace last child -> single clean rebind on next 64ms flush
    const newRight = makeNode(doc, 'div', { style: 'width: 360px' });
    auxRight.remove();
    auxSplit.appendChild(newRight);
    axMo.cb([{ type: 'childList', target: auxSplit }]);
    const deb2 = [...pendingTimers.values()].find((t) => t.ms === 64);
    assert.ok(deb2);
    deb2.fn();
    assert.equal(axMo.disconnectCount, dcBefore + 1, 'Changed last child must rebind axO once');
  } finally {
    api.destroy();
  }
});

// 3. thought-client: Read-before-Write separation in scanNow/scanToolSummaryContainers & 48ms MO debounce
test('w6-3: thought-client batches all probeViewportBand reads before translation DOM writes and debounces streaming/wait MOs', async () => {
  const { doc, win } = createMiniDom();
  const opLog = [];
  const moInstances = [];
  class SpyMO {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = false;
      moInstances.push(this);
    }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.disconnected = true; }
  }

  let now = 1000;
  const convRoot = makeNode(doc, 'div', { 'data-testid': 'conversation-view' });

  // Build 2 expanded thought panels (panel1 non-latest -> triggers probeViewportBand, panel2 latest)
  const makeThought = (text, streaming = false) => {
    const wrap = makeNode(doc, 'div');
    const btn = makeNode(doc, 'button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    btn.textContent = streaming ? 'Thinking...' : 'Thought for 2s';
    const panel = makeNode(doc, 'div');
    const p = makeNode(doc, 'p');
    p.textContent = text;
    panel.appendChild(p);
    panel.getBoundingClientRect = () => {
      opLog.push('read:thought-rect');
      return { left: 0, top: 80, right: 600, bottom: 240, width: 600, height: 160 };
    };
    const origIns = panel.insertBefore.bind(panel);
    panel.insertBefore = (c, ref) => {
      opLog.push('write:thought-dom');
      return origIns(c, ref);
    };
    const origApp = panel.appendChild.bind(panel);
    panel.appendChild = (c) => {
      opLog.push('write:thought-dom');
      return origApp(c);
    };
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    convRoot.appendChild(wrap);
    return { btn, panel };
  };

  makeThought('Analyzing project performance bottlenecks for first thought block.');
  const second = makeThought('Planning second step optimization for rendering latency.');

  // Add a visible tool summary trigger + row
  const toolTrig = makeNode(doc, 'button', { 'data-testid': 'tool-group-collapsible', 'aria-expanded': 'true' });
  toolTrig.textContent = 'Analyzed 3 files';
  toolTrig.getBoundingClientRect = () => {
    opLog.push('read:tool-rect');
    return { left: 0, top: 300, right: 600, bottom: 330, width: 600, height: 30 };
  };
  const toolBody = makeNode(doc, 'div');
  toolBody.getBoundingClientRect = () => {
    opLog.push('read:tool-rect');
    return { left: 0, top: 330, right: 600, bottom: 420, width: 600, height: 90 };
  };
  const toolRow = makeNode(doc, 'div', { 'data-testid': 'tool-call-row' });
  const toolSpan = makeNode(doc, 'span');
  toolSpan.textContent = 'Searched runtime hooks in workspace';
  toolRow.appendChild(toolSpan);
  toolBody.appendChild(toolRow);
  convRoot.appendChild(toolTrig);
  convRoot.appendChild(toolBody);
  doc.body.appendChild(convRoot);

  const sb = {
    window: null,
    globalThis: null,
    document: doc,
    innerHeight: 900,
    innerWidth: 1440,
    MutationObserver: SpyMO,
    Date: { now: () => now },
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __agPrismThoughtBridge: {
      call: async () => ({ ok: true }),
      translateStream: async () => ({ ok: true, text: '已分析性能瓶颈', items: ['已分析 3 个文件', '已搜索工作区运行时钩子'] }),
    },
    Set, WeakSet, Map, WeakMap, Array, Object, Number, Math, String, Boolean, JSON, Promise, RegExp,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8'), sb);

  const api = sb.window.__agPrismThought;
  try {
    api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand', language: 'zh-CN', translateToolSummaries: true, translateTitles: false });
    opLog.length = 0;
    api.scanImmediate();

    const lastReadIdx = Math.max(opLog.lastIndexOf('read:thought-rect'), opLog.lastIndexOf('read:tool-rect'));
    const firstWriteIdx = opLog.indexOf('write:thought-dom');
    assert.ok(lastReadIdx >= 0, 'Must perform viewport rect reads during scanImmediate');
    assert.ok(firstWriteIdx > lastReadIdx, `All getBoundingClientRect reads (last@${lastReadIdx}) must precede any translation DOM write (first@${firstWriteIdx}): ${JSON.stringify(opLog)}`);

    // Verify streaming MO debounces 30 rapid token mutations into 1 leading + 1 trailing (48ms) instead of 30 synchronous checks
    const streamTrig = makeNode(doc, 'button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    streamTrig.textContent = 'Thinking';
    const streamPanel = makeNode(doc, 'div');
    const sp = makeNode(doc, 'p');
    sp.textContent = 'Drafting...';
    streamPanel.appendChild(sp);
    const wrap3 = makeNode(doc, 'div');
    wrap3.appendChild(streamTrig);
    wrap3.appendChild(streamPanel);
    convRoot.appendChild(wrap3);
    second.btn.setAttribute('aria-expanded', 'false');
    api.scanImmediate();

    const streamMo = moInstances.find((m) => m.target === streamTrig && !m.disconnected);
    assert.ok(streamMo, 'Streaming trigger observer must be attached');
    let textReads = 0;
    const origTextDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(streamTrig), 'textContent');
    Object.defineProperty(streamTrig, 'textContent', {
      get() {
        textReads++;
        return 'Thinking';
      },
      configurable: true,
    });
    for (let i = 0; i < 30; i++) streamMo.cb([{ type: 'characterData', target: streamTrig }]);
    assert.ok(textReads <= 2, `30 burst streaming mutations inside 48ms must debounce checks (got ${textReads} textContent reads)`);
    if (origTextDesc) Object.defineProperty(streamTrig, 'textContent', origTextDesc);
  } finally {
    api.destroy();
    assert.ok(moInstances.every((m) => m.disconnected || m.target === doc.documentElement), 'destroy() must disconnect streaming/wait observers');
  }
});

// 4. prompt-suggester: 0 querySelector calls on streaming text/inline nodes & 120ms debounce on onMut
test('w6-4: prompt-suggester avoids querySelector storms on streaming text/inline nodes and debounces onMut by 120ms', () => {
  const { doc, win } = createMiniDom();
  const captured = [];
  win.MutationObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { captured.push(this); }
    disconnect() { this.disconnected = true; }
  };

  const conv = makeNode(doc, 'div', { 'data-testid': 'conversation-view', 'data-cascade-id': 'c-w6' });
  const vp = makeNode(doc, 'div', { 'data-testid': 'autoscroll-viewport' });
  const resp = makeNode(doc, 'div', { 'data-testid': 'planner-response-text' });
  vp.appendChild(resp);
  conv.appendChild(vp);
  doc.body.appendChild(conv);

  const sb = {
    window: win,
    globalThis: null,
    document: doc,
    setTimeout,
    clearTimeout,
    Set, WeakSet, Map, WeakMap, Array, Object, Number, Math, String, Boolean, JSON, Promise, Date, RegExp,
  };
  sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'vendor', 'prompt-suggester', 'suggester-client.js'), 'utf8'), sb);
  const ctl = sb.__agPrismSuggesterFactory({ document: doc, window: win });
  try {
    ctl.applyConfig({ enabled: true, language: 'en' });
    assert.equal(captured.length, 1);
    const mo = captured[0];

    let qsCalls = 0;
    const muts = [];
    for (let i = 0; i < 40; i++) {
      const txt = doc.createTextNode(`token_${i}`);
      const span = makeNode(doc, 'span');
      const code = makeNode(doc, 'code');
      const inner = makeNode(doc, 'em');
      span.appendChild(inner);
      span.querySelector = () => { qsCalls++; return null; };
      code.querySelector = () => { qsCalls++; return null; };
      muts.push({ type: 'childList', target: resp, addedNodes: [txt, span, code], removedNodes: [] });
    }
    mo.cb(muts);
    assert.equal(qsCalls, 0, 'Streaming text and inline SPAN/CODE nodes must trigger 0 querySelector calls');

    // Even a batch of 20 nested DIVs inside autoscroll-viewport is capped by budget (<= 8 querySelector calls)
    const divMuts = [];
    let divQsCalls = 0;
    for (let i = 0; i < 20; i++) {
      const d = makeNode(doc, 'div');
      d.appendChild(makeNode(doc, 'span'));
      d.querySelector = () => { divQsCalls++; return null; };
      divMuts.push({ type: 'childList', target: vp, addedNodes: [d], removedNodes: [] });
    }
    mo.cb(divMuts);
    assert.ok(divQsCalls <= 8, `Nested container querySelector calls per batch must be capped <= 8 (got ${divQsCalls})`);
  } finally {
    ctl.destroy();
  }
});

// 5. Extension modules smooth default GPU animations, perf-scoped win-blur freeze, perf-mode blur stripping, 0 :has(, pure ASCII
test('w6-5: omni, sidebar-studio, and effort-slider keep smooth default animations, perf-scoped win-blur freeze, and performance blur removal', () => {
  const omniSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'omni-viewer', 'omni-client.js'), 'utf8');
  const omniCss = (omniSrc.match(/const OMNI_CSS = \[([\s\S]*?)\]\.join\(''\);/) || [])[1] || '';
  assert.ok(omniCss.includes('html[data-ag-cs-style]:is([data-ag-cs-win-blur="1"],[data-ag-cs-perf-mode="performance"],[data-ag-cs-motion="off"]) :is(.ag-omni-menu,.ag-prism-omni-menu){backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'), 'OMNI_CSS must strip backdrop-filter on win-blur/performance/motion=off');
  assert.equal(/:has\(/.test(omniCss), false, 'OMNI_CSS must contain 0 :has(');
  assert.equal(/[^\x00-\x7F]/.test(omniCss), false, 'OMNI_CSS must remain pure ASCII');

  const sbSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'sidebar-studio', 'sidebar-client.js'), 'utf8');
  const sbCss = (sbSrc.match(/const CLIENT_CSS = \[([\s\S]*?)\]\.join\(''\);/) || [])[1] || '';
  for (const needle of [
    'animation:ag-sb-dot-pulse 2s ease-in-out infinite',
    'animation:ag-sb-dot-pulse 1.5s ease-in-out infinite',
    'animation:ag-sb-spin 1s linear infinite',
    'animation:ag-sb-breathe-a 8s ease-in-out infinite',
    'animation:ag-sb-breathe-b 11.5s ease-in-out infinite alternate',
    'animation:ag-sb-halo 7.5s linear infinite',
    'html[data-ag-cs-style][data-ag-cs-win-blur="1"]:is([data-ag-cs-perf-mode="performance"],[data-ag-cs-perf-mode="eco"]) .ag-prism-vessel-halo::after,html[data-ag-cs-style][data-ag-cs-win-blur="1"]:is([data-ag-cs-perf-mode="performance"],[data-ag-cs-perf-mode="eco"]) :is(.ag-prism-aura-orb,.ag-prism-sb-spin,.ag-prism-sb-dot){animation-play-state:paused!important}',
    'html[data-ag-cs-style]:is([data-ag-cs-perf-mode="performance"],[data-ag-cs-motion="off"]) :is(.ag-prism-sidebar-popover,.ag-prism-chat-policy-chip){backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:var(--ag-sb-container)!important;opacity:.98}',
  ]) {
    assert.ok(sbCss.includes(needle), `sidebar-client CLIENT_CSS missing: ${needle}`);
  }
  assert.equal(/steps\(/i.test(sbCss), false, 'sidebar-client CLIENT_CSS must have 0 choppy steps() animations');
  assert.equal(/:is\([^)]*::(?:before|after)/.test(sbCss), false, 'sidebar-client CLIENT_CSS must not place pseudo-elements inside :is()');
  assert.equal(/:has\(/.test(sbCss), false, 'sidebar-client CLIENT_CSS must contain 0 :has(');
  assert.equal(/[^\x00-\x7F]/.test(sbCss.replace(/content:"[^"]*"/g, '')), false, 'sidebar-client CLIENT_CSS selectors/props must remain pure ASCII');

  const efSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'effort-slider', 'upstream-client.js'), 'utf8');
  const efCss = (efSrc.match(/var SLIDER_CSS = "([^\n]*)";/) || [])[1] || '';
  for (const needle of [
    'animation:ces-sweep 2.4s linear infinite',
    'animation:ces-star-sweep linear infinite',
    "html[data-ag-cs-style][data-ag-cs-perf-mode='performance'] :is(.ces-star,.ces-energy__sweep){animation-timing-function:steps(24)!important}",
    "html[data-ag-cs-style][data-ag-cs-win-blur='1'] :is(.ces-star,.ces-energy__sweep){animation-play-state:paused!important}",
    "html[data-ag-cs-style]:is([data-ag-cs-win-blur='1'],[data-ag-cs-perf-mode='performance'],[data-ag-cs-motion='off']) .ces-set{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:rgba(24,24,28,.99)}",
  ]) {
    assert.ok(efCss.includes(needle), `effort-slider SLIDER_CSS missing: ${needle}`);
  }
  assert.equal(efCss.includes('animation:ces-sweep 2.4s steps(24)'), false, 'default ces-sweep must stay smooth linear (not throttled to steps(24))');
  assert.equal(efCss.includes('animation:ces-star-sweep steps(24)'), false, 'default ces-star-sweep must stay smooth linear (not throttled to steps(24))');
  assert.equal(/[^\x00-\x7F]/.test(efCss), false, 'effort-slider SLIDER_CSS must remain pure ASCII');
});

// 6. Hygiene & budget redlines across all modified files and channels
test('w6-6: 0 innerHTML writes, 0 UTF-8 BOM, 0 CRLF, and all Channel 1 + modified channel budgets pass', () => {
  const touched = [
    'host-workbench-enhancer.js',
    'ui-runtime.js',
    'vendor/thought-translator/thought-client.js',
    'vendor/prompt-suggester/suggester-client.js',
    'vendor/omni-viewer/omni-client.js',
    'vendor/sidebar-studio/sidebar-client.js',
    'vendor/effort-slider/upstream-client.js',
    'test/w6-300hz-runtime-perf.test.mjs',
  ];
  for (const rel of touched) {
    const raw = fs.readFileSync(path.join(ROOT, rel));
    assert.equal(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf, false, `${rel} must have 0 UTF-8 BOM`);
    assert.equal(raw.includes(0x0d), false, `${rel} must have 0 CRLF`);
    if (!rel.startsWith('test/')) {
      const txt = raw.toString('utf8');
      assert.equal(/\.\s*innerHTML\s*=/.test(txt), false, `${rel} must have 0 innerHTML writes`);
    }
  }

  for (const lang of ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr']) {
    const expr = cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: lang }, { bundleCachePath: '' });
    const bytes = Buffer.byteLength(expr, 'utf8');
    assert.ok(bytes < 390000, `Channel 1 [${lang}] must be < 390,000 B, got ${bytes}`);
  }
});
