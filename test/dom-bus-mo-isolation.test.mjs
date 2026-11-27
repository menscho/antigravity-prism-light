// 模块域单测：dom-bus 静默 discardMutations / 根属性 MO 隔离 / omni 悬停局部化 / host-i18n & swarm-i18n 剪枝负缓存 / thought-client IO 增量追踪
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
const swarmI18nMod = require(path.join(ROOT, 'vendor', 'host-i18n', 'swarm-i18n-runtime.js'));
const omniMod = require(path.join(ROOT, 'vendor', 'omni-viewer', 'omni-client.js'));

async function waitFor(predicate, timeoutMs = 2000, stepMs = 15) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return Boolean(predicate());
}

function makeMockEl(tag = 'div', attrs = {}) {
  const attrMap = new Map(Object.entries(attrs));
  const listeners = new Map();
  const children = [];
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: attrs.id || '',
    className: attrs.class || '',
    hidden: false,
    isConnected: true,
    parentElement: null,
    parentNode: null,
    children,
    childNodes: children,
    dataset: {},
    classList: {
      add(...cs) {
        const s = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
        for (const c of cs) if (c) s.add(c);
        el.className = [...s].join(' ');
        attrMap.set('class', el.className);
      },
      remove(...cs) {
        const s = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
        for (const c of cs) s.delete(c);
        el.className = [...s].join(' ');
        attrMap.set('class', el.className);
      },
      contains(c) { return String(el.className || '').split(/\s+/).includes(c); },
    },
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue() { return ''; },
    },
    get textContent() {
      if (this._text !== undefined) return this._text;
      return children.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    },
    set textContent(v) {
      children.length = 0;
      const s = String(v ?? '');
      if (s) {
        const tn = makeMockText(s);
        tn.parentElement = this;
        tn.parentNode = this;
        children.push(tn);
      }
    },
    get firstChild() { return children[0] || null; },
    get firstElementChild() { return children.find((c) => c.nodeType === 1) || null; },
    get childElementCount() { return children.filter((c) => c.nodeType === 1).length; },
    get nextSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const idx = p.childNodes.indexOf(this);
      return idx >= 0 ? p.childNodes[idx + 1] || null : null;
    },
    get nextElementSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const idx = p.childNodes.indexOf(this);
      for (let i = idx + 1; i < p.childNodes.length; i++) if (p.childNodes[i].nodeType === 1) return p.childNodes[i];
      return null;
    },
    get previousSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const idx = p.childNodes.indexOf(this);
      return idx > 0 ? p.childNodes[idx - 1] || null : null;
    },
    get previousElementSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const idx = p.childNodes.indexOf(this);
      for (let i = idx - 1; i >= 0; i--) if (p.childNodes[i].nodeType === 1) return p.childNodes[i];
      return null;
    },
    getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
    setAttribute(k, v) {
      attrMap.set(k, String(v));
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
    },
    hasAttribute(k) { return attrMap.has(k); },
    removeAttribute(k) { attrMap.delete(k); },
    appendChild(c) {
      if (!c) return c;
      if (c.parentNode) c.parentNode.removeChild?.(c);
      c.parentElement = this;
      c.parentNode = this;
      children.push(c);
      return c;
    },
    insertBefore(c, ref) {
      if (!c) return c;
      if (c.parentNode) c.parentNode.removeChild?.(c);
      c.parentElement = this;
      c.parentNode = this;
      const idx = ref ? children.indexOf(ref) : -1;
      if (idx >= 0) children.splice(idx, 0, c);
      else children.push(c);
      return c;
    },
    removeChild(c) {
      const i = children.indexOf(c);
      if (i >= 0) { children.splice(i, 1); c.parentElement = c.parentNode = null; }
      return c;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild?.(this); },
    contains(other) {
      let cur = other;
      while (cur) { if (cur === this) return true; cur = cur.parentElement || cur.parentNode; }
      return false;
    },
    matches(sel) {
      const matchOne = (s) => {
        let rest = s.trim();
        if (!rest) return false;
        const attrsRe = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
        let m;
        while ((m = attrsRe.exec(rest))) {
          const [, k, v] = m;
          if (!this.hasAttribute(k)) return false;
          if (v !== undefined && this.getAttribute(k) !== v) return false;
        }
        rest = rest.replace(attrsRe, '');
        if (!rest) return true;
        const cls = String(this.className || '').split(/\s+/).filter(Boolean);
        for (const part of rest.match(/#[a-z0-9_-]+|\.[a-z0-9_-]+|^[a-z0-9_-]+/gi) || []) {
          if (part.startsWith('#')) { if (this.id !== part.slice(1)) return false; }
          else if (part.startsWith('.')) { if (!cls.includes(part.slice(1))) return false; }
          else if (this.tagName !== part.toUpperCase()) return false;
        }
        return true;
      };
      return sel.split(',').map((x) => x.trim()).filter(Boolean).some(matchOne);
    },
    closest(sel) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (c.matches(sel)) out.push(c);
            walk(c);
          }
        }
      };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
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
      const e = { target: this, preventDefault() {}, stopPropagation() {}, ...ev };
      for (const rec of [...(listeners.get(e.type) || [])]) rec.fn(e);
      if (e.bubbles) {
        if (this.parentElement) this.parentElement.dispatchEvent(e);
        else if (this._doc) this._doc.dispatchEvent(e);
      }
      return true;
    },
    getBoundingClientRect() {
      return this._rect || { left: 0, top: 40, right: 600, bottom: 160, width: 600, height: 120 };
    },
  };
  return el;
}

function makeMockText(val) {
  return {
    nodeType: 3,
    nodeValue: String(val ?? ''),
    isConnected: true,
    parentElement: null,
    parentNode: null,
    get nextSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const i = p.childNodes.indexOf(this);
      return i >= 0 ? p.childNodes[i + 1] || null : null;
    },
    get previousSibling() {
      const p = this.parentElement;
      if (!p) return null;
      const i = p.childNodes.indexOf(this);
      return i > 0 ? p.childNodes[i - 1] || null : null;
    },
  };
}

function createEnv() {
  const html = makeMockEl('html');
  const head = makeMockEl('head');
  const body = makeMockEl('body');
  html.appendChild(head);
  html.appendChild(body);
  const mos = [];
  const ios = [];
  const docListeners = [];
  const winListeners = [];

  class MockMO {
    constructor(cb) {
      this.cb = cb;
      this.connected = false;
      this.target = null;
      this.opts = null;
      this.pending = [];
      mos.push(this);
    }
    observe(target, opts) {
      this.connected = true;
      this.target = target;
      this.opts = opts;
    }
    disconnect() {
      this.connected = false;
      this.pending.length = 0;
    }
    takeRecords() {
      return this.pending.splice(0, this.pending.length);
    }
    emit(recs) {
      if (this.connected) this.cb(recs);
    }
  }

  class MockIO {
    constructor(cb, opts) {
      this.cb = cb;
      this.opts = opts || {};
      this.observed = new Set();
      this.connected = true;
      ios.push(this);
    }
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
    createElement: (tag, attrs) => { const e = makeMockEl(tag, attrs); e._doc = doc; return e; },
    createDocumentFragment: () => { const f = makeMockEl('fragment'); f.nodeType = 11; f._doc = doc; return f; },
    createTextNode: (txt) => makeMockText(txt),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(type, fn, opts) { docListeners.push({ type, fn, opts, active: true }); },
    removeEventListener(type, fn) {
      const rec = docListeners.find((x) => x.active && x.type === type && x.fn === fn);
      if (rec) rec.active = false;
    },
    dispatchEvent(ev) {
      for (const rec of [...docListeners]) if (rec.active && rec.type === ev.type) rec.fn(ev);
    },
  };
  html._doc = doc; head._doc = doc; body._doc = doc;

  const win = {
    document: doc,
    location: { protocol: 'http:', hostname: '127.0.0.1', href: 'http://127.0.0.1:4000/swarm', pathname: '/swarm' },
    innerWidth: 1440,
    innerHeight: 900,
    MutationObserver: MockMO,
    IntersectionObserver: MockIO,
    addEventListener(type, fn, opts) { winListeners.push({ type, fn, opts, active: true }); },
    removeEventListener(type, fn) {
      const rec = winListeners.find((x) => x.active && x.type === type && x.fn === fn);
      if (rec) rec.active = false;
    },
    dispatchEvent(ev) {
      for (const rec of [...winListeners]) if (rec.active && rec.type === ev.type) rec.fn(ev);
    },
  };
  doc.defaultView = win;
  return { html, head, body, doc, win, mos, ios, docListeners, winListeners };
}

test('dom-bus: silent discardMutations() drops records with 0 broadcast, rootAttrMo isolates subtree:false, and perfBusy is pure in-memory', async () => {
  const { html, body, doc, win, mos } = createEnv();
  const bus = domBusMod.createInstance(doc, win);

  const subTreeHits = [];
  const rootAttrHits = [];
  const bodyAttrHits = [];

  const uTree = bus.subscribe('sub-tree', (m) => subTreeHits.push(m), {
    priority: 'high',
    observeOptions: { childList: true, subtree: true },
  });
  const uAttr = bus.subscribe('sub-root-attr', (m) => rootAttrHits.push(m), {
    priority: 'high',
    observeOptions: { childList: false, subtree: false, attributes: true, attributeFilter: ['data-ag-cs-win-blur'] },
  });
  const uBody = bus.subscribe('home-ripple-root', (m) => bodyAttrHits.push(m), {
    priority: 'high',
    observeBody: true,
    observeOptions: { childList: false, subtree: false, attributes: true, attributeFilter: ['data-ag-cs-win-blur', 'data-has-browser-hole'] },
  });

  const active = mos.filter((m) => m.connected);
  const rootMo = active.find((m) => m.opts.subtree === true);
  const rootAttrMo = active.find((m) => m.opts.subtree === false && m.target === html);
  const bodyAttrMo = active.find((m) => m.opts.subtree === false && m.target === body);

  assert.ok(rootMo, 'Global subtree rootMo must exist');
  assert.equal(Boolean(rootMo.opts.attributes), false, 'Global subtree rootMo must NOT be polluted by root-attribute subscribers');
  assert.ok(rootAttrMo && rootAttrMo.opts.childList === false && rootAttrMo.opts.attributes === true, 'rootAttrMo must observe <html> with subtree:false');
  assert.ok(bodyAttrMo && bodyAttrMo.opts.childList === false && bodyAttrMo.opts.attributes === true, 'bodyAttrMo must observe <body> with subtree:false');

  // 1) Silent discardMutations() consumes ONLY slots[0] (rootMo) with ZERO dispatch,
  //    while preserving slots[1] (rootAttrMo <html>) and slots[2] (bodyAttrMo <body>) records
  rootMo.pending.push({ type: 'childList', target: body });
  html.setAttribute('data-ag-cs-win-blur', '1');
  rootAttrMo.pending.push({ type: 'attributes', target: html, attributeName: 'data-ag-cs-win-blur' });
  body.setAttribute('data-has-browser-hole', '1');
  bodyAttrMo.pending.push({ type: 'attributes', target: body, attributeName: 'data-has-browser-hole' });
  const discarded = bus.discardMutations();
  assert.equal(discarded.length, 1, 'discardMutations() must ONLY drain slots[0] (rootMo)');
  assert.equal(subTreeHits.length, 0, 'discardMutations() must NEVER broadcast to subtree subscribers');
  assert.equal(rootAttrMo.pending.length, 1, 'discardMutations() must preserve slots[1] (<html> rootAttrMo) pending records');
  assert.equal(bodyAttrMo.pending.length, 1, 'discardMutations() must preserve slots[2] (<body> bodyAttrMo) pending records');
  assert.equal(bus.discardMutations().length, 0);

  // Preserved rootAttrMo & bodyAttrMo records deliver normally to external root-attr subscribers
  rootAttrMo.emit(rootAttrMo.takeRecords());
  bodyAttrMo.emit(bodyAttrMo.takeRecords());
  assert.equal(subTreeHits.length, 0, 'rootMo must stay silent after root-attr delivery');
  assert.equal(rootAttrHits.length, 1, '<html> root-attr subscriber must receive preserved data-ag-cs-win-blur="1" record');
  assert.equal(rootAttrHits[0][0].target.getAttribute('data-ag-cs-win-blur'), '1');
  assert.equal(bodyAttrHits.length, 2, 'observeBody subscriber must receive preserved <html> and <body> attr records');

  // 2) Legacy drainMutations() continues dispatching records per channel
  subTreeHits.length = 0; rootAttrHits.length = 0; bodyAttrHits.length = 0;
  rootMo.pending.push({ type: 'childList', target: body });
  rootAttrMo.pending.push({ type: 'attributes', target: html, attributeName: 'data-ag-cs-win-blur' });
  bodyAttrMo.pending.push({ type: 'attributes', target: body, attributeName: 'data-has-browser-hole' });
  const drained = bus.drainMutations();
  assert.equal(drained.length, 3);
  assert.equal(subTreeHits.length, 1);
  assert.equal(rootAttrHits.length, 1, 'html-only subscriber must receive html attr and NOT body attr');
  assert.equal(bodyAttrHits.length, 2, 'observeBody subscriber receives both html and body attrs');

  // 3) Pure in-memory perfBusy never mutates html[data-ag-perf-busy]
  bus.bumpScrollBusy(60);
  assert.equal(bus.isBusy(), true);
  assert.equal(bus.isPerfBusy(), true);
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false);
  await waitFor(() => !bus.isPerfBusy(), 1000, 15);
  assert.equal(bus.isPerfBusy(), false);
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false);

  bus.setStreaming(true);
  assert.equal(bus.isPerfBusy(), true);
  assert.equal(html.hasAttribute('data-ag-perf-busy'), false);
  bus.setStreaming(false);
  assert.equal(bus.isPerfBusy(), false);

  // 4) Static check: home-ripple-host.js subscribes home-ripple-root with subtree: false
  const rippleSrc = fs.readFileSync(path.join(ROOT, 'home-ripple-host.js'), 'utf8');
  assert.match(rippleSrc, /home-ripple-root[\s\S]{0,280}subtree:\s*false/, 'home-ripple-host.js must subscribe home-ripple-root with subtree: false');

  uTree(); uAttr(); uBody();
  assert.equal(mos.filter((m) => m.connected).length, 0, 'All MOs disconnect when subscribers drop to 0');
  bus.dispose(doc, win);
});

test('omni-client: hover token cursor scopes to local hit element and never writes data-ag-omni-hover-token onto <html>', () => {
  const { html, doc, win } = createEnv();
  const makeHl = () => {
    const s = new Set();
    return s;
  };
  win.CSS = { highlights: new Map() };
  win.Highlight = class MockHighlight extends Set {};
  doc.createRange = () => ({
    setStart(n, o) { this.startContainer = n; this.startOffset = o; },
    setEnd(n, o) { this.endContainer = n; this.endOffset = o; },
    getClientRects() { return [{ left: 0, top: 0, right: 400, bottom: 30 }]; },
  });

  let caretNode = null;
  let caretOffset = 0;
  doc.caretPositionFromPoint = () => (caretNode ? { offsetNode: caretNode, offset: caretOffset } : null);

  const resp = doc.createElement('div', { 'data-testid': 'planner-response-text' });
  const p1 = doc.createElement('p');
  const t1 = doc.createTextNode('Visit https://example.com/one now');
  p1.appendChild(t1);
  const p2 = doc.createElement('p');
  const t2 = doc.createTextNode('Visit https://example.com/two now');
  p2.appendChild(t2);
  resp.appendChild(p1);
  resp.appendChild(p2);
  doc.body.appendChild(resp);

  const client = omniMod.createOmniClient({ window: win, document: doc });
  client.sync({ omniModule: 'on', linkTarget: 'builtin' });

  const styleEl = doc.getElementById('ag-prism-omni-css');
  assert.ok(styleEl, 'Omni CSS style element must mount');
  assert.equal(styleEl.textContent.includes('html[data-ag-omni-hover-token'), false, 'OMNI_CSS must not use html[data-ag-omni-hover-token] root selector');
  assert.ok(styleEl.textContent.includes('[data-ag-omni-hover-token="1"]{cursor:pointer}'));

  // Hover p1 -> only p1 gets attribute, <html> untouched
  caretNode = t1; caretOffset = 12;
  p1.dispatchEvent({ type: 'mousemove', bubbles: true, clientX: 50, clientY: 12 });
  assert.equal(p1.getAttribute('data-ag-omni-hover-token'), '1');
  assert.equal(html.hasAttribute('data-ag-omni-hover-token'), false);

  // Move directly to p2 -> p1 cleared, p2 marked, <html> still untouched
  caretNode = t2; caretOffset = 12;
  p2.dispatchEvent({ type: 'mousemove', bubbles: true, clientX: 50, clientY: 12 });
  assert.equal(p1.hasAttribute('data-ag-omni-hover-token'), false);
  assert.equal(p2.getAttribute('data-ag-omni-hover-token'), '1');
  assert.equal(html.hasAttribute('data-ag-omni-hover-token'), false);

  // Destroy clears local element attribute
  client.destroy();
  assert.equal(p2.hasAttribute('data-ag-omni-hover-token'), false);
  assert.equal(html.hasAttribute('data-ag-omni-hover-token'), false);
});

test('host-i18n: cvRevealHandler & onDomMutations prune chat prose/code blocks early and step plain-text miss writes negative cache', () => {
  const { doc, win, mos } = createEnv();
  const bus = domBusMod.createInstance(doc, win);
  win.__agDomBus = bus;
  win.__agPrismDomBus = bus;

  const conv = doc.createElement('div', { 'data-testid': 'conversation-view' });
  const prose = doc.createElement('div', { class: 'prose' });
  const proseSpan = doc.createElement('span');
  proseSpan.appendChild(doc.createTextNode('Settings'));
  prose.appendChild(proseSpan);
  const pre = doc.createElement('pre');
  pre.appendChild(doc.createTextNode('Settings'));
  const proseWrap = doc.createElement('div');
  const innerMd = doc.createElement('div', { 'data-markdown-root': '' });
  innerMd.appendChild(doc.createTextNode('Settings'));
  proseWrap.appendChild(innerMd);
  const stepBox = doc.createElement('div', { 'data-step-rows': 'true' });
  const stepSpan = doc.createElement('span');
  const stepUnallowedText = doc.createTextNode('custom_user_symbol_not_step_phrase');
  stepSpan.appendChild(stepUnallowedText);
  stepBox.appendChild(stepSpan);
  conv.appendChild(prose);
  conv.appendChild(pre);
  conv.appendChild(proseWrap);
  conv.appendChild(stepBox);
  doc.body.appendChild(conv);

  let scheduledFlushes = 0;
  const inst = hostI18nMod.mountHostI18n({
    root: win,
    doc,
    dict: { exact: { Settings: '设置', custom_user_symbol_not_step_phrase: '不应被翻' }, patterns: [] },
    mode: 'on',
    rafFn: (fn) => { scheduledFlushes++; fn(); return scheduledFlushes; },
  });

  const flushesAfterBoot = scheduledFlushes;
  // Trigger contentvisibilityautostatechange reveal on prose, pre, and pure-prose wrapper -> pruned with 0 flush scheduled!
  doc.dispatchEvent({ type: 'contentvisibilityautostatechange', skipped: false, target: prose });
  doc.dispatchEvent({ type: 'contentvisibilityautostatechange', skipped: false, target: pre });
  doc.dispatchEvent({ type: 'contentvisibilityautostatechange', skipped: false, target: proseWrap });
  assert.equal(scheduledFlushes, flushesAfterBoot, 'cvRevealHandler must prune prose/code/pure-prose wrappers with 0 enqueue/flush');

  // Trigger onDomMutations childList inside prose / adding prose wrapper -> 0 flush scheduled!
  const rootMo = mos.find((m) => m.connected && m.opts.subtree === true);
  assert.ok(rootMo);
  const addedProse = doc.createElement('div', { class: 'markdown-body' });
  addedProse.appendChild(doc.createTextNode('Settings'));
  prose.appendChild(addedProse);
  rootMo.emit([{ type: 'childList', target: prose, addedNodes: [addedProse], removedNodes: [] }]);
  const addedWrap = doc.createElement('div');
  const innerPre = doc.createElement('pre');
  innerPre.appendChild(doc.createTextNode('Settings'));
  addedWrap.appendChild(innerPre);
  conv.appendChild(addedWrap);
  rootMo.emit([{ type: 'childList', target: conv, addedNodes: [addedWrap], removedNodes: [] }]);
  assert.equal(scheduledFlushes, flushesAfterBoot, 'onDomMutations must prune prose/code targets & wrappers with 0 flush');
  assert.equal(proseSpan.textContent, 'Settings');
  assert.equal(stepUnallowedText.nodeValue, 'custom_user_symbol_not_step_phrase');

  // Static check: step early-exit caches into textUntranslatedCache
  const hiSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'), 'utf8');
  assert.match(hiSrc, /!isStepPlainTextAllowed\(trimmed\)\)\s*\{\s*textUntranslatedCache\.set\(node,\s*original\);/, 'Step early-exit must populate textUntranslatedCache');

  inst.destroy();
  bus.dispose(doc, win);
});

test('swarm-i18n: WeakMap node miss cache + engine miss cache avoids re-running 56 regexes on unchanged misses and invalidates on text change', () => {
  const { doc, win } = createEnv();
  // Swarm sentinel element
  const sentinel = doc.createElement('div', { id: 'tabbtn-feed', 'data-testid': 'swarm-tabs' });
  const missBox = doc.createElement('span', { class: 'o2-h' });
  const missText = doc.createTextNode('Unmatched Custom Status Alpha-42');
  missBox.appendChild(missText);
  doc.body.appendChild(sentinel);
  doc.body.appendChild(missBox);

  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor', 'host-i18n', 'swarm-zh-CN.json'), 'utf8'));
  assert.ok(Array.isArray(dict.patterns) && dict.patterns.length >= 20, 'Real swarm dictionary should contain pattern list');

  let regexTestCount = 0;
  const origTest = RegExp.prototype.test;
  RegExp.prototype.test = function (str) {
    if (str === 'Unmatched Custom Status Alpha-42') regexTestCount++;
    return origTest.call(this, str);
  };
  let inst = null;
  try {
    inst = swarmI18nMod.mountSwarmI18n({ root: win, doc, dict, allowNonSwarmLocation: true });
    const afterFirst = regexTestCount;
    assert.ok(afterFirst > 0, 'First scan should evaluate pattern regexes on unmatched text');

    // 10 repeated scans on unchanged node must hit WeakMap miss cache with ZERO regex executions
    for (let i = 0; i < 10; i++) inst.scan();
    assert.equal(regexTestCount, afterFirst, 'Repeated scans must hit WeakMap node miss cache with 0 extra regex runs');

    // Mutate node text to a translatable string -> cache key invalidates automatically & translates
    missText.nodeValue = 'Waiting';
    inst.scan();
    assert.notEqual(missText.nodeValue, 'Waiting', 'Changed node text must invalidate miss cache and translate');
  } finally {
    RegExp.prototype.test = origTest;
    inst?.destroy?.();
  }
});

test('thought-client: scroll with dom-bus/IntersectionObserver performs 0 getBoundingClientRect & 0 full scans; IO reveal incrementally hydrates', async () => {
  const { doc, win, ios } = createEnv();
  const bus = domBusMod.createInstance(doc, win);
  win.__agDomBus = bus;
  win.__agPrismDomBus = bus;

  let rectReads = 0;
  const conv = doc.createElement('div', { 'data-testid': 'conversation-view' });

  const makeThought = (text, rect) => {
    const wrap = doc.createElement('div');
    const btn = doc.createElement('button', { 'data-testid': 'thinking-collapsible-trigger', 'aria-expanded': 'true' });
    btn.textContent = 'Thought for 2s';
    const panel = doc.createElement('div');
    const p = doc.createElement('p');
    p.textContent = text;
    panel.appendChild(p);
    panel._rect = rect;
    panel.getBoundingClientRect = () => { rectReads++; return panel._rect; };
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    conv.appendChild(wrap);
    return { btn, panel };
  };

  const far1 = makeThought('Historical thought block far offscreen above viewport for IO test.', { left: 0, top: -2400, right: 600, bottom: -2200, width: 600, height: 200 });
  const latest = makeThought('Latest visible thought block inside viewport.', { left: 0, top: 100, right: 600, bottom: 260, width: 600, height: 160 });

  const toolTrig = doc.createElement('button', { 'data-testid': 'tool-group-collapsible', 'aria-expanded': 'true' });
  toolTrig.textContent = 'Analyzed 4 files';
  toolTrig._rect = { left: 0, top: -2000, right: 600, bottom: -1970, width: 600, height: 30 };
  toolTrig.getBoundingClientRect = () => { rectReads++; return toolTrig._rect; };
  conv.appendChild(toolTrig);
  doc.body.appendChild(conv);

  let qsaCalls = 0;
  const origQsa = conv.querySelectorAll.bind(conv);
  conv.querySelectorAll = (sel) => { qsaCalls++; return origQsa(sel); };

  let cacheWarmCalled = false;
  const sb = {
    window: null,
    globalThis: null,
    document: doc,
    innerHeight: 900,
    innerWidth: 1440,
    IntersectionObserver: win.IntersectionObserver,
    __agDomBus: bus,
    __agPrismDomBus: bus,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __agPrismThoughtBridge: {
      call: async (payload) => {
        if (payload?.action === 'get-cache') cacheWarmCalled = true;
        return { ok: true };
      },
      translateStream: async (payload) => {
        if (String(payload.mode || '').startsWith('tool-batch')) return { ok: true, items: ['已分析 4 个文件'] };
        return { ok: true, text: '远端历史思考块增量译文' };
      },
    },
    Set, WeakSet, Map, WeakMap, Array, Object, Number, Math, String, Boolean, JSON, Promise, RegExp,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'vendor', 'thought-translator', 'thought-client.js'), 'utf8'), sb);

  const api = sb.window.__agPrismThought;
  try {
    api.sync({ thoughtTranslate: 'machine', thoughtTrigger: 'expand', language: 'zh-CN', translateToolSummaries: true, translateTitles: false });
    api.scanImmediate();
    // Flush microtasks so ensureInitialized()'s get-cache .then() queues its deferred scheduleScan(20)
    // onto dom-bus before we wait for all boot/warmup tasks to drain (on Windows 15.625ms timer ticks,
    // dom-bus two-hop fallback timers for delay=20ms can fire at ~31-47ms rather than ~21ms).
    await Promise.resolve();
    await Promise.resolve();
    const settled = await waitFor(
      () =>
        cacheWarmCalled &&
        bus.getDebugState().pendingTasks === 0 &&
        latest.panel.getAttribute('data-op-zh-ready') === '1',
      2000,
      15
    );
    assert.equal(settled, true, 'Initial sync + get-cache warmup scan must settle before scroll baseline');

    // Offscreen thought panel & offscreen tool trigger must be registered on shared IO (rootMargin 800px 0px)
    const io800 = ios.find((x) => x.connected && x.opts?.rootMargin === '800px 0px');
    assert.ok(io800, 'Offscreen thought/tool blocks must register on IntersectionObserver with 800px 0px rootMargin');
    assert.ok(io800.observed.has(far1.panel), 'Offscreen thought panel must be IO-observed');
    assert.ok(io800.observed.has(toolTrig), 'Offscreen tool trigger must be IO-observed');
    assert.equal(far1.panel.getAttribute('data-op-zh-ready'), null, 'Offscreen thought panel remains deferred');

    // Burst 20 scroll events across 140ms -> ZERO getBoundingClientRect & ZERO full qsa scans!
    const rectsBeforeScroll = rectReads;
    const qsaBeforeScroll = qsaCalls;
    for (let i = 0; i < 20; i++) doc.dispatchEvent({ type: 'scroll' });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(rectReads, rectsBeforeScroll, 'Scrolling with IO active must incur 0 getBoundingClientRect calls');
    assert.equal(qsaCalls, qsaBeforeScroll, 'Scrolling with IO active must incur 0 full qsa scans');

    // IO notifies far1.panel + toolTrig entered viewport -> incremental hydrate with 0 extra getBoundingClientRect!
    io800.emit([
      { target: far1.panel, isIntersecting: true },
      { target: toolTrig, isIntersecting: true },
    ]);
    await waitFor(
      () => far1.panel.getAttribute('data-op-zh-ready') === '1' && toolTrig.textContent === '已分析 4 个文件',
      2000,
      15
    );
    assert.equal(rectReads, rectsBeforeScroll, 'IO-driven incremental hydration must incur 0 getBoundingClientRect reflows');
    assert.equal(far1.panel.getAttribute('data-op-zh-ready'), '1', 'IO reveal must incrementally translate revealed thought panel');
    assert.equal(toolTrig.textContent, '已分析 4 个文件', 'IO reveal must incrementally translate revealed tool summary');
  } finally {
    api.destroy();
    bus.dispose(doc, win);
  }
  assert.equal(ios.filter((x) => x.connected).length, 0, 'destroy() must disconnect all IntersectionObservers');
});
