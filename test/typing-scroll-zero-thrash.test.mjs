import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');

// 通用轻量 DOM 模拟器（零外部依赖，严格支持 closest/contains/querySelectorAll/MutationObserver/IntersectionObserver）
function createMiniDom() {
  const docListeners = new Map();
  const winListeners = new Map();
  let nowMs = 1000;
  let nextTimer = 1;
  let nextRaf = 1;
  const timers = new Map();
  const rafs = new Map();
  const mos = [];
  const ios = [];
  let activeElement = null;
  let selection = null;
  let docRef = null;

  const parseAttrSel = (sel) => {
    const out = [];
    for (const part of String(sel).split(',').map((s) => s.trim()).filter(Boolean)) {
      const tokens = [];
      let rem = part;
      const tagM = /^[a-zA-Z0-9_-]+/.exec(rem);
      if (tagM) { tokens.push({ type: 'tag', val: tagM[0].toUpperCase() }); rem = rem.slice(tagM[0].length); }
      const idM = /#([a-zA-Z0-9_-]+)/g;
      let m;
      while ((m = idM.exec(rem))) tokens.push({ type: 'id', val: m[1] });
      const clsM = /\.([a-zA-Z0-9_-]+)/g;
      while ((m = clsM.exec(rem))) tokens.push({ type: 'cls', val: m[1] });
      const notAttrM = /:not\(\[([a-zA-Z0-9_-]+)\]\)/g;
      const notSet = new Set();
      while ((m = notAttrM.exec(rem))) { notSet.add(m[1]); tokens.push({ type: 'notAttr', val: m[1] }); }
      const remNoNot = rem.replace(/:not\([^)]*\)/g, '');
      const attrM = /\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g;
      while ((m = attrM.exec(remNoNot))) tokens.push({ type: 'attr', key: m[1], val: m[2] });
      out.push(tokens);
    }
    return out;
  };

  const matchSimple = (el, sel) => {
    if (!el || el.nodeType !== 1) return false;
    const raw = String(sel).trim();
    if (raw.includes(',')) {
      return raw.split(',').some((branch) => matchSimple(el, branch));
    }
    // 支持简单后代组合（如 "A B"）
    if (/\s+/.test(raw)) {
      const segs = raw.split(/\s+/);
      if (!matchSimple(el, segs[segs.length - 1])) return false;
      let cur = el.parentElement;
      for (let i = segs.length - 2; i >= 0; i--) {
        let hit = false;
        while (cur) {
          if (matchSimple(cur, segs[i])) { hit = true; cur = cur.parentElement; break; }
          cur = cur.parentElement;
        }
        if (!hit) return false;
      }
      return true;
    }
    for (const tokens of parseAttrSel(raw)) {
      if (!tokens.length) continue;
      let ok = true;
      for (const tk of tokens) {
        if (tk.type === 'tag' && el.tagName !== tk.val) { ok = false; break; }
        if (tk.type === 'id' && el.id !== tk.val) { ok = false; break; }
        if (tk.type === 'cls' && !el.classList.contains(tk.val)) { ok = false; break; }
        if (tk.type === 'notAttr' && el.hasAttribute(tk.val)) { ok = false; break; }
        if (tk.type === 'attr') {
          if (tk.val === undefined) { if (!el.hasAttribute(tk.key)) { ok = false; break; } }
          else if (el.getAttribute(tk.key) !== tk.val) { ok = false; break; }
        }
      }
      if (ok) return true;
    }
    return false;
  };

  const makeText = (val) => {
    const node = {
      nodeType: 3,
      nodeValue: String(val ?? ''),
      get data() { return this.nodeValue; },
      set data(v) { this.nodeValue = String(v ?? ''); },
      parentNode: null,
      parentElement: null,
      isConnected: false,
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    };
    return node;
  };

  const makeEl = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const clsSet = new Set(String(opts.className || '').split(/\s+/).filter(Boolean));
    const childNodes = [];
    const styleProps = Object.create(null);
    let textVal = opts.text ?? '';
    let rect = opts.rect || { left: 100, top: 400, right: 600, bottom: 480, width: 500, height: 80 };
    const listeners = new Map();
    const upperTag = String(tag).toUpperCase();

    const styleObj = new Proxy(styleProps, {
      set(target, prop, val) {
        target[prop] = String(val ?? '');
        return true;
      },
      get(target, prop) {
        if (prop === 'setProperty') return (k, v) => { target[k] = String(v ?? ''); };
        if (prop === 'getPropertyValue') return (k) => target[k] || '';
        if (prop === 'removeProperty') return (k) => { delete target[k]; };
        return target[prop] || '';
      },
    });

    const el = {
      nodeType: 1,
      tagName: upperTag,
      id: opts.id || attrs.get('id') || '',
      hidden: false,
      disabled: false,
      media: attrs.get('media') || '',
      sheet: upperTag === 'STYLE' ? { disabled: false, cssRules: [] } : null,
      dataset: Object.create(null),
      parentNode: null,
      parentElement: null,
      get ownerDocument() { return docRef; },
      set ownerDocument(_v) {},
      isConnected: false,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 800,
      clientHeight: 400,
      clientWidth: 500,
      offsetHeight: opts.offsetHeight ?? 80,
      offsetWidth: opts.offsetWidth ?? 500,
      width: upperTag === 'CANVAS' ? 300 : 0,
      height: upperTag === 'CANVAS' ? 150 : 0,
      childNodes,
      style: styleObj,
      classList: {
        add: (...cs) => cs.forEach((c) => c && clsSet.add(c)),
        remove: (...cs) => cs.forEach((c) => clsSet.delete(c)),
        contains: (c) => clsSet.has(c),
        toggle: (c, f) => { const on = f === undefined ? !clsSet.has(c) : !!f; on ? clsSet.add(c) : clsSet.delete(c); return on; },
      },
      get className() { return Array.from(clsSet).join(' '); },
      set className(v) { clsSet.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => clsSet.add(c)); },
      get children() { return childNodes.filter((n) => n.nodeType === 1); },
      get firstChild() { return childNodes[0] || null; },
      get lastChild() { return childNodes[childNodes.length - 1] || null; },
      get firstElementChild() { return childNodes.find((n) => n.nodeType === 1) || null; },
      get lastElementChild() { for (let i = childNodes.length - 1; i >= 0; i--) if (childNodes[i].nodeType === 1) return childNodes[i]; return null; },
      get nextSibling() {
        if (!this.parentNode) return null;
        const i = this.parentNode.childNodes.indexOf(this);
        return i >= 0 && i + 1 < this.parentNode.childNodes.length ? this.parentNode.childNodes[i + 1] : null;
      },
      get previousElementSibling() {
        if (!this.parentNode) return null;
        const list = this.parentNode.children;
        const i = list.indexOf(this);
        return i > 0 ? list[i - 1] : null;
      },
      get textContent() {
        if (childNodes.length) return childNodes.map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent)).join('');
        return textVal;
      },
      set textContent(v) {
        childNodes.length = 0;
        textVal = String(v ?? '');
      },
      get isContentEditable() { return attrs.get('contenteditable') === 'true'; },
      getAttribute(k) {
        if (k === 'id') return this.id || null;
        if (k === 'class') return this.className || null;
        return attrs.has(k) ? attrs.get(k) : null;
      },
      setAttribute(k, v) {
        const sv = String(v ?? '');
        attrs.set(k, sv);
        if (k === 'id') this.id = sv;
        if (k === 'class') this.className = sv;
        if (k === 'media') this.media = sv;
      },
      hasAttribute(k) { return k === 'id' ? Boolean(this.id) : attrs.has(k); },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'id') this.id = '';
        if (k === 'media') this.media = '';
      },
      appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = c.parentElement = this;
        const markConn = (n, on) => { n.isConnected = on; if (n.childNodes) for (const k of n.childNodes) markConn(k, on); };
        markConn(c, this.isConnected);
        childNodes.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (!ref) return this.appendChild(c);
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = c.parentElement = this;
        const markConn = (n, on) => { n.isConnected = on; if (n.childNodes) for (const k of n.childNodes) markConn(k, on); };
        markConn(c, this.isConnected);
        const idx = childNodes.indexOf(ref);
        if (idx >= 0) childNodes.splice(idx, 0, c); else childNodes.push(c);
        return c;
      },
      removeChild(c) {
        const i = childNodes.indexOf(c);
        if (i >= 0) childNodes.splice(i, 1);
        c.parentNode = c.parentElement = null;
        const markConn = (n, on) => { n.isConnected = on; if (n.childNodes) for (const k of n.childNodes) markConn(k, on); };
        markConn(c, false);
        return c;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      contains(other) {
        for (let cur = other; cur; cur = cur.parentNode) if (cur === this) return true;
        return false;
      },
      matches(sel) { return matchSimple(this, sel); },
      closest(sel) {
        for (let cur = this; cur && cur.nodeType === 1; cur = cur.parentElement) {
          if (matchSimple(cur, sel)) return cur;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.childNodes || []) {
            if (c.nodeType !== 1) continue;
            if (matchSimple(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      getElementsByTagName(t) {
        const up = String(t).toUpperCase();
        const out = [];
        const walk = (n) => {
          for (const c of n.childNodes || []) {
            if (c.nodeType !== 1) continue;
            if (up === '*' || c.tagName === up) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      getBoundingClientRect() { return { ...rect }; },
      setRect(r) { rect = { ...r }; },
      getClientRects() { return [this.getBoundingClientRect()]; },
      checkVisibility() { return !this.hidden && this.style.display !== 'none'; },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(ev) { for (const fn of [...(listeners.get(ev.type) || [])]) fn(ev); },
      getContext(kind) {
        if (upperTag !== 'CANVAS' || kind !== '2d') return null;
        if (!el._ctx2d) {
          const stats = { clearRect: 0, fillRect: 0, drawImage: 0 };
          el._ctxStats = stats;
          el._ctx2d = {
            imageSmoothingEnabled: false, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '',
            save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
            clearRect() { stats.clearRect += 1; },
            fillRect() { stats.fillRect += 1; },
            strokeRect() {}, fillText() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
            arc() {}, ellipse() {}, roundRect() {}, quadraticCurveTo() {}, bezierCurveTo() {}, clip() {}, fill() {}, stroke() {},
            drawImage() { stats.drawImage += 1; },
            createLinearGradient: () => ({ addColorStop() {} }),
            createRadialGradient: () => ({ addColorStop() {} }),
          };
        }
        return el._ctx2d;
      },
    };
    return el;
  };

  const html = makeEl('html');
  html.isConnected = true;
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  const doc = {
    nodeType: 9,
    documentElement: html,
    head,
    body,
    hidden: false,
    readyState: 'complete',
    title: 'Antigravity',
    get activeElement() { return activeElement || body; },
    set activeElement(v) { activeElement = v; },
    hasFocus: () => true,
    getSelection: () => selection,
    createElement(tag) { const e = makeEl(tag); e.ownerDocument = doc; return e; },
    createElementNS(_ns, tag) { const e = makeEl(tag); e.ownerDocument = doc; return e; },
    createTextNode: makeText,
    getElementById(id) { if (html.id === id) return html; return html.querySelector('#' + id); },
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    getElementsByClassName: (c) => html.querySelectorAll('.' + c),
    addEventListener(t, fn) { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(fn); },
    removeEventListener(t, fn) { docListeners.get(t)?.delete(fn); },
    dispatch(t, ev = {}) { for (const fn of [...(docListeners.get(t) || [])]) fn({ type: t, ...ev }); },
  };
  docRef = doc;
  html.ownerDocument = head.ownerDocument = body.ownerDocument = doc;

  class MockMO {
    constructor(cb) { this.cb = cb; this.active = false; this.target = null; this.opts = null; this._queue = []; mos.push(this); }
    observe(target, opts) { this.active = true; this.target = target; this.opts = opts; }
    disconnect() { this.active = false; this._queue.length = 0; }
    takeRecords() { return this._queue.splice(0, this._queue.length); }
    emit(records) { if (this.active) this.cb(records, this); }
  }

  class MockIO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); this.disconnected = false; ios.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    emit(entries) { if (!this.disconnected) this.cb(entries, this); }
  }

  const win = {
    document: doc,
    location: { href: 'vscode-file://vscode-app/index.html', pathname: '/c/11111111-2222-3333-4444-555555555555' },
    navigator: { language: 'zh-CN' },
    devicePixelRatio: 2,
    innerWidth: 1440,
    innerHeight: 900,
    performance: { now: () => nowMs },
    Date: Object.assign(function FakeDate(...a) { return new Date(...a); }, { now: () => nowMs }),
    setTimeout(fn, ms = 0) { const id = nextTimer++; timers.set(id, { fn, runAt: nowMs + Math.max(0, Number(ms) || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 9999,
    clearInterval() {},
    requestAnimationFrame(fn) { const id = nextRaf++; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: (el) => ({ display: el?.style?.display || 'block', visibility: el?.style?.visibility || 'visible', position: el?.style?.position || 'static', borderRadius: '16px', paddingLeft: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', fontSize: '14px', lineHeight: '20px', getPropertyValue: (k) => el?.style?.getPropertyValue?.(k) || '' }),
    MutationObserver: MockMO,
    IntersectionObserver: MockIO,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    Event: class { constructor(t) { this.type = t; } },
    addEventListener(t, fn) { if (!winListeners.has(t)) winListeners.set(t, new Set()); winListeners.get(t).add(fn); },
    removeEventListener(t, fn) { winListeners.get(t)?.delete(fn); },
    dispatch(t, ev = {}) { for (const fn of [...(winListeners.get(t) || [])]) fn({ type: t, ...ev }); },
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Promise, RegExp, JSON, Error, Proxy, Symbol, Float32Array, Uint8Array,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  doc.defaultView = win;

  const advance = (ms) => {
    nowMs += ms;
    for (const [id, item] of [...timers.entries()]) {
      if (item.runAt <= nowMs) { timers.delete(id); item.fn(); }
    }
  };
  const flushRafs = (stepMs = 16) => {
    nowMs += stepMs;
    const list = [...rafs.entries()];
    rafs.clear();
    for (const [, fn] of list) fn(nowMs);
    return list.length;
  };

  return {
    win, doc, html, head, body, makeEl, makeText, mos, ios, timers, rafs,
    setSelection: (s) => { selection = s; },
    getNow: () => nowMs,
    setNow: (v) => { nowMs = v; },
    advance, flushRafs,
  };
}

// ── 1: dual-mascot-rig 打字 0 重绘 GPU 点头 + 单帧 rAF 合并 + 末 4 字符标点识别 ──
test('1) dual-mascot-rig: typing keeps Canvas rc frame cache 100% hit (0 redraws), coalesces burst keys in 1 rAF, GPU-nods via translate3d, and reads <=4 tail chars for ?/!', () => {
  const env = createMiniDom();
  const rigSrc = fs.readFileSync(path.join(ROOT, 'dual-mascot-rig.js'), 'utf8');
  vm.runInNewContext(rigSrc, env.win);
  const host = env.makeEl('div', { rect: { left: 0, top: 0, width: 420, height: 60, right: 420, bottom: 60 } });
  env.body.appendChild(host);

  const stage = env.win.__agDualMascotRig.mountDualMascotStage(host, {
    camp: 'gemini', mascot: 'crab', streaming: false, miniPileEnabled: false, reducedMotion: false,
  });
  // 首帧建立 Canvas 帧缓存
  env.flushRafs(16);
  env.flushRafs(16);
  const snap0 = stage.getLayoutSnapshot();
  const drawsBefore = snap0.perf.canvasDraws;
  const skipsBefore = snap0.perf.canvasSkips;

  // 同帧连敲 5 键普通字符：必须合并为单帧 rAF，且 GPU translate3d 点头，绝不击穿 Canvas 帧缓存
  const rafsBefore = env.rafs.size;
  stage.onUserType('h');
  stage.onUserType('e');
  stage.onUserType('l');
  stage.onUserType('l');
  stage.onUserType('o');
  assert.ok(env.rafs.size - rafsBefore <= 1, `Burst typing in same frame must coalesce into <=1 rAF (queued ${env.rafs.size - rafsBefore})`);

  const actorEl = host.querySelector('.ag-v2-mascot-actor');
  assert.ok(actorEl, 'Primary actor wrapper must exist');

  // 执行合并 rAF 后：GPU translate3d 下沉点头且 Canvas 帧缓存 0 击穿（canvasDraws 增量 === 0，canvasSkips 递增）
  env.flushRafs(16);
  assert.match(actorEl.style.transform, /translate3d\([^,]+,\s*[1-9]\d*(?:\.\d+)?px,\s*0\)/, `Typing nod must drive GPU translate3d Y offset, got: ${actorEl.style.transform}`);
  const snap1 = stage.getLayoutSnapshot();
  assert.equal(snap1.perf.canvasDraws, drawsBefore, `Typing nod must NOT break Canvas rc cache (draws ${drawsBefore} -> ${snap1.perf.canvasDraws})`);
  assert.ok(snap1.perf.canvasSkips > skipsBefore, `Typing frame must hit rc cache (skips ${skipsBefore} -> ${snap1.perf.canvasSkips})`);

  // 超长字符串末尾 ? / ! 仅看末尾 <=4 字符即可触发同步倾斜 / 惊讶
  stage.onUserType('a'.repeat(5000) + '?');
  const cv = host.querySelector('.ag-v2-mascot-canvas');
  assert.equal(cv.style.transform, 'rotate(-9deg)', 'Tail "?" must synchronously tilt actor canvas');
  stage.dispose();
});

// ── 2: ui-runtime 打字 0 读整段 ed.textContent + 输入框内纯打字 0 触发 measureCrabClearanceAll ──
test('2) ui-runtime: typing reads <=4 tail chars with 0 full ed.textContent reads, and pure editor text mutations skip measureCrabClearanceAll', () => {
  const env = createMiniDom();
  const cdp = require(path.join(ROOT, 'cdp.js'));
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');

  const conv = env.makeEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  const ib = env.makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } });
  const sibSlot = env.makeEl('div', { className: 'composer-sib-slot' });
  const card = env.makeEl('div', { className: 'surface-composer-card' });
  const ed = env.makeEl('div', { attrs: { contenteditable: 'true' } });
  const pNode = env.makeEl('p');
  const txtNode = env.makeText('Hello world?');
  pNode.appendChild(txtNode);
  ed.appendChild(pNode);
  card.appendChild(ed);
  ib.appendChild(sibSlot);
  ib.appendChild(card);
  conv.appendChild(ib);
  env.body.appendChild(conv);

  let fullTextReads = 0;
  Object.defineProperty(ed, 'textContent', {
    configurable: true,
    get() { fullTextReads += 1; return 'Hello world?'; },
    set() {},
  });

  let checkVisCalls = 0;
  let offsetHCalls = 0;
  sibSlot.checkVisibility = () => { checkVisCalls += 1; return true; };
  Object.defineProperty(card, 'offsetHeight', {
    configurable: true,
    get() { offsetHCalls += 1; return 80; },
  });

  const typedPayloads = [];
  env.win.__agDualMascotRig = {
    mountDualMascotStage: () => ({
      setState() {},
      notify() {},
      syncPowerState() {},
      onUserType(s) { typedPayloads.push(s); },
      dispose() {},
    }),
  };

  vm.runInNewContext(uiSrc, env.win);
  env.win.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, mascot: 'crab', smoothCaret: true });
  env.flushRafs(16);

  // 初始 sync 完成后清零计数器
  fullTextReads = 0;
  checkVisCalls = 0;
  offsetHCalls = 0;

  // 2a) input 事件：带 ev.data 或 Selection 锚点，严禁读取 ed.textContent
  env.doc.activeElement = ed;
  env.setSelection({ rangeCount: 1, getRangeAt: () => ({ endContainer: txtNode, endOffset: txtNode.nodeValue.length }), focusNode: txtNode, focusOffset: txtNode.nodeValue.length });
  env.doc.dispatch('input', { target: ed, data: '?' });
  env.doc.dispatch('input', { target: ed });
  assert.equal(fullTextReads, 0, 'ui-runtime onDocCaretEvent must NEVER read full ed.textContent on input');
  assert.deepEqual(typedPayloads, ['?', 'rld?'], 'ui-runtime must pass <=4 tail chars to mascot.onUserType');

  // 2b) 输入框内纯打字节点变化（换行插入 <p>/<span>）：0 触发 measureCrabClearanceAll
  const rootMo = env.mos.find((m) => m.active && m.target === env.html);
  assert.ok(rootMo, 'ui-runtime root MO must be active');
  const newPara = env.makeEl('p');
  ed.appendChild(newPara);
  rootMo.emit([{ type: 'childList', target: ed, addedNodes: [newPara], removedNodes: [] }]);
  env.flushRafs(16);
  env.advance(120);
  env.flushRafs(16);
  assert.equal(checkVisCalls, 0, 'Pure typing inside [contenteditable="true"] must NOT invoke checkVisibility via measureCrabClearanceAll');
  assert.equal(offsetHCalls, 0, 'Pure typing inside [contenteditable="true"] must NOT read card.offsetHeight via measureCrabClearanceAll');

  // 2c) 输入区外部插入排队卡：必须正常触发 measureCrabClearanceAll
  const qCard = env.makeEl('div', { attrs: { 'data-testid': 'queued-messages-card' }, text: 'Queued prompt' });
  sibSlot.appendChild(qCard);
  rootMo.emit([{ type: 'childList', target: sibSlot, addedNodes: [qCard], removedNodes: [] }]);
  env.flushRafs(16);
  assert.ok(offsetHCalls > 0 || checkVisCalls > 0, 'External queued-messages-card insertion must still trigger clearance measurement');

  env.win.__agPrism.destroy();
});

// ── 3: smooth-caret 0 qsa('p, div') + 0 全框 textContent + 0 caret.getAnimations() ──
test('3) smooth-caret: 0 querySelectorAll(p,div), 0 full ed.textContent reads, and 0 caret.getAnimations() during rapid typing', () => {
  const env = createMiniDom();
  const scSrc = fs.readFileSync(path.join(ROOT, 'smooth-caret.js'), 'utf8');
  vm.runInNewContext(scSrc, env.win);

  const ib = env.makeEl('div', { attrs: { 'data-testid': 'agent-input-box' } });
  const card = env.makeEl('div', { className: 'surface-composer-card', rect: { left: 100, top: 400, width: 500, height: 80, right: 600, bottom: 480 } });
  const ed = env.makeEl('div', { attrs: { contenteditable: 'true' }, rect: { left: 112, top: 412, width: 476, height: 40, right: 588, bottom: 452 } });
  const p = env.makeEl('p');
  const tn = env.makeText('abc');
  p.appendChild(tn);
  ed.appendChild(p);
  card.appendChild(ed);
  ib.appendChild(card);
  env.body.appendChild(ib);

  let qsaCalls = 0;
  let fullTextReads = 0;
  let getAnimCalls = 0;
  const origQsa = ed.querySelectorAll.bind(ed);
  ed.querySelectorAll = (sel) => { qsaCalls += 1; return origQsa(sel); };
  Object.defineProperty(ed, 'textContent', {
    configurable: true,
    get() { fullTextReads += 1; return 'abc'; },
    set() {},
  });
  const origCreate = env.doc.createElement.bind(env.doc);
  env.doc.createElement = (tag) => {
    const el = origCreate(tag);
    el.getAnimations = () => { getAnimCalls += 1; return [{ currentTime: 0 }]; };
    return el;
  };

  env.doc.activeElement = ed;
  let curOffset = 1;
  env.setSelection({
    rangeCount: 1,
    anchorNode: tn,
    anchorOffset: 1,
    focusNode: tn,
    focusOffset: 1,
    getRangeAt: () => ({
      collapsed: true,
      startContainer: tn,
      startOffset: curOffset,
      endContainer: tn,
      endOffset: curOffset,
      cloneRange() { return this; },
      getClientRects: () => [{ left: 120 + curOffset * 8, top: 416, width: 0, height: 18, right: 120 + curOffset * 8, bottom: 434 }],
      getBoundingClientRect: () => ({ left: 120 + curOffset * 8, top: 416, width: 0, height: 18, right: 120 + curOffset * 8, bottom: 434 }),
    }),
  });

  const ctl = env.win.__agPrismSmoothCaret.createSmoothCaretController({
    isDestroyed: () => false,
    isEnabled: () => true,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });

  for (let i = 0; i < 10; i += 1) {
    curOffset = (i % 3) + 1;
    tn.nodeValue = 'abc' + 'x'.repeat(i);
    ctl.sync(true, false);
    env.advance(16);
  }

  assert.equal(qsaCalls, 0, 'smooth-caret must execute strictly 0 ed.querySelectorAll("p, div") scans');
  assert.equal(fullTextReads, 0, 'smooth-caret must execute strictly 0 full ed.textContent reads');
  assert.equal(getAnimCalls, 0, 'smooth-caret must execute strictly 0 caret.getAnimations() calls');
  const caretEl = card.querySelector('.ag-cs-smooth-caret');
  assert.ok(caretEl, 'Smooth caret element must be mounted and active');
  assert.equal(caretEl.getAttribute('data-ag-cs-caret-typing'), '1', 'Typing hold state must be driven by timestamp');
  ctl.teardown();
});

// ── 4: prism-rim-canvas 滚聊天/侧栏容器 0 唤醒底部输入框测距，无关动画 0 唤醒 ──
test('4) prism-rim-canvas: scrolling unrelated chat/sidebar containers and unrelated transitionend/animationend trigger 0 rect resets or rAF wakeups', () => {
  const env = createMiniDom();
  const rimSrc = fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8');
  vm.runInNewContext(rimSrc, env.win);

  const chatVp = env.makeEl('div', { attrs: { 'data-testid': 'autoscroll-viewport' } });
  const msgNode = env.makeEl('div', { className: 'chat-msg' });
  chatVp.appendChild(msgNode);
  const sidebar = env.makeEl('aside');
  const composerWrap = env.makeEl('div', { className: 'composer-outer' });
  const box = env.makeEl('div', {
    className: 'surface-composer-card',
    attrs: { 'data-ag-cs-prism-box': '1' },
    rect: { left: 200, top: 700, width: 600, height: 90, right: 800, bottom: 790 },
  });
  composerWrap.appendChild(box);
  env.body.appendChild(chatVp);
  env.body.appendChild(sidebar);
  env.body.appendChild(composerWrap);

  let busMeasureCalls = 0;
  env.win.__agDomBus = {
    measure(_k, fn) { busMeasureCalls += 1; fn(); },
  };

  let rectReads = 0;
  const origRect = box.getBoundingClientRect.bind(box);
  box.getBoundingClientRect = () => { rectReads += 1; return origRect(); };

  const ctl = env.win.__agPrismRimCanvas.createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    canMountRealCanvas: () => true,
    setAttrIfChanged: (e, k, v) => e.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });
  env.html.setAttribute('data-ag-cs-ambient', '1');
  ctl.onPointerMove({ clientX: 400, clientY: 740, target: box });
  env.flushRafs(16);
  env.flushRafs(16);

  // 稳定后清零计数器
  busMeasureCalls = 0;
  rectReads = 0;
  env.rafs.clear();

  // 滚聊天记录与侧栏列表：不包含 box -> 0 唤醒、0 测距
  env.win.dispatch('scroll', { target: chatVp });
  env.win.dispatch('scroll', { target: sidebar });
  assert.equal(busMeasureCalls, 0, 'Scrolling chat viewport or sidebar must NOT trigger prism-rim-canvas bus.measure');
  assert.equal(env.rafs.size, 0, 'Scrolling unrelated container must NOT schedule prism-rim-canvas rAF');
  assert.equal(rectReads, 0, 'Scrolling unrelated container must NOT re-read composer bounding rect');

  // 无关消息节点 transitionend / animationend：0 唤醒
  env.doc.dispatch('transitionend', { target: msgNode });
  env.doc.dispatch('animationend', { target: msgNode });
  assert.equal(env.rafs.size, 0, 'Unrelated transitionend/animationend must NOT wake prism-rim-canvas');

  // 包含 box 的祖先容器滚动 -> 正常唤醒测距
  env.win.dispatch('scroll', { target: composerWrap });
  assert.ok(busMeasureCalls > 0 || env.rafs.size > 0, 'Scrolling ancestor of registered prism box must refresh metrics');

  // 正常消费上一次 scroll 的 rAF，使 prismRaf 归零后再验证 box 自身 transitionend 唤醒
  env.flushRafs(16);
  env.doc.dispatch('transitionend', { target: box });
  assert.ok(env.rafs.size > 0, 'transitionend on registered box must wake rim canvas');
  ctl.teardown();
});

// ── 5: 静默 discardMutations + 共享 IO 离屏暂停 + streamMutating 真置位 + 侧栏批量扫描 ──
test('5) ui-runtime & stream-choreography: runGuardedMut prefers discardMutations(), shared IO toggles data-ag-offscreen="1", streamMutating sets true, and sidebar snapshot avoids per-row qsa(button)', () => {
  const env = createMiniDom();
  const cdp = require(path.join(ROOT, 'cdp.js'));
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  const scSrc = fs.readFileSync(path.join(ROOT, 'stream-choreography.js'), 'utf8');

  let discardCalls = 0;
  let drainCalls = 0;
  let subUnsubCalls = 0;
  env.win.__agDomBus = {
    attach() {},
    subscribe() { return () => { subUnsubCalls += 1; }; },
    discardMutations() { discardCalls += 1; return []; },
    drainMutations() { drainCalls += 1; return []; },
    applyPerformanceMode() {},
    dispose() {},
  };

  // 3 类运行指示器
  const rowRunning = env.makeEl('div', { attrs: { 'data-testid': 'conversation-row-sidebar', 'data-ag-cs-row-running': '1' } });
  const subRunning = env.makeEl('div', { attrs: { 'data-ag-sub-running': '1' } });
  const spinner = env.makeEl('span', { attrs: { 'data-testid': 'status-loading-spinner' } });
  env.body.appendChild(rowRunning);
  env.body.appendChild(subRunning);
  env.body.appendChild(spinner);

  vm.runInNewContext(uiSrc, env.win);
  env.win.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, mascot: 'off', smoothCaret: false });

  // 5a) runGuardedMut 优先调用 discardMutations，绝不误调 drainMutations
  assert.ok(discardCalls > 0, 'ui-runtime runGuardedMut must call domBus.discardMutations()');
  assert.equal(drainCalls, 0, 'ui-runtime must NOT fall back to domBus.drainMutations() when discardMutations() exists');

  // 5b) 单一共享 IntersectionObserver 监控 3 类运行指示器并切换 data-ag-offscreen="1"
  assert.equal(env.ios.length, 1, 'ui-runtime must use 1 shared IntersectionObserver for offscreen running indicators');
  const io = env.ios[0];
  assert.equal(io.targets.has(rowRunning), true);
  assert.equal(io.targets.has(subRunning), true);
  assert.equal(io.targets.has(spinner), true);

  io.emit([
    { target: rowRunning, isIntersecting: false },
    { target: subRunning, isIntersecting: false },
    { target: spinner, isIntersecting: false },
  ]);
  assert.equal(rowRunning.getAttribute('data-ag-offscreen'), '1');
  assert.equal(subRunning.getAttribute('data-ag-offscreen'), '1');
  assert.equal(spinner.getAttribute('data-ag-offscreen'), '1');

  io.emit([{ target: rowRunning, isIntersecting: true }]);
  assert.equal(rowRunning.getAttribute('data-ag-offscreen'), null, 'Visible row must clear data-ag-offscreen immediately');

  env.win.__agPrism.destroy();
  assert.equal(io.disconnected, true, 'destroy() must disconnect shared offscreen IO');
  assert.equal(subRunning.getAttribute('data-ag-offscreen'), null, 'destroy() must clean up all data-ag-offscreen attributes');
  assert.equal(subUnsubCalls, 1);

  // 5c) stream-choreography: streamMutating 真实置位 + 侧栏批量扫描避免逐行 qsa('button')
  const env2 = createMiniDom();
  vm.runInNewContext(scSrc, env2.win);
  let sawStreamMutatingTrue = false;
  let guardedMutCalls = 0;
  let scCtl = null;
  scCtl = env2.win.__agPrismStreamChoreography.createStreamChoreographyController({
    motionEngine: null,
    isDestroyed: () => false,
    isComposerRestyleEnabled: () => true,
    isMotionStandardOrUltra: () => true,
    isMotionUltra: () => true,
    isConvRunning: () => true,
    isThoughtIsolatedNode: () => false,
    isThoughtMutationRecord: () => false,
    isManagedThoughtPanel: () => false,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => {
      guardedMutCalls += 1;
      if (scCtl?.isStreamMutating()) sawStreamMutatingTrue = true;
      return fn();
    },
    cloneCachedSvgElement: () => null,
    buildBrandMarkSvg: () => '',
    applySingleHostIcon() {},
    rippleCtl: {},
    convAuraCtl: {},
    notifyMascot() {},
  });

  const dummy = env2.makeEl('div');
  env2.body.appendChild(dummy);
  scCtl.scheduleTransient(() => {
    dummy.setAttribute('data-ag-cs-sonar', '1');
  }, 10);
  env2.advance(20);
  assert.ok(guardedMutCalls > 0, 'stream-choreography transient writes must route through runGuardedMut');
  assert.equal(sawStreamMutatingTrue, true, 'streamMutating must be true during stream-choreography guarded mutations');
  assert.equal(scCtl.isStreamMutating(), false, 'streamMutating must reset to false after mutation completes');

  // 20 个共享 listP 的侧栏行：逐行 row.querySelectorAll('button') 必须为 0
  const listP = env2.makeEl('div', { attrs: { 'data-testid': 'conversation-list-sidebar' } });
  let perRowBtnQsa = 0;
  for (let i = 0; i < 20; i += 1) {
    const row = env2.makeEl('div', { attrs: { 'data-testid': 'conversation-row-sidebar' } });
    if (i === 5) {
      row.setAttribute('data-selected', 'true');
      row.appendChild(env2.makeEl('span', { attrs: { 'data-testid': 'status-loading-spinner' } }));
    }
    const origRowQsa = row.querySelectorAll.bind(row);
    row.querySelectorAll = (sel) => {
      if (String(sel).includes('button')) perRowBtnQsa += 1;
      return origRowQsa(sel);
    };
    listP.appendChild(row);
  }
  env2.body.appendChild(listP);
  const snap = scCtl.measureSidebarSelectionSnapshot();
  assert.equal(perRowBtnQsa, 0, `Shared-parent sidebar scan must avoid per-row qsa('button'), got ${perRowBtnQsa}`);
  const runningRows = (snap.st || []).filter(([, run]) => run);
  assert.equal(runningRows.length, 1, 'Batched sidebar scan must still detect the exact running row');
  scCtl.disconnectStreamObserver();
  scCtl.clearTransientTimers();
});

// ── 6: host-workbench-enhancer + inline-diff-client: 被动滚屏 0 写 scope[data-ag-scrolling]，增量作用域跳过已封存代码块并透传给 inline-diff ──
test('6) host-workbench-enhancer & inline-diff-client: passive scroll never sets scope[data-ag-scrolling], and incremental sync scopes code blocks & inline-diff chips', () => {
  const env = createMiniDom();
  const enhSrc = fs.readFileSync(path.join(ROOT, 'host-workbench-enhancer.js'), 'utf8');
  const diffSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'), 'utf8');
  vm.runInNewContext(diffSrc, env.win);
  vm.runInNewContext(enhSrc, env.win);

  const conv = env.makeEl('div', { attrs: { 'data-testid': 'conversation-view', 'data-cascade-id': 'cid-1' } });
  const vp = env.makeEl('div', { attrs: { 'data-testid': 'autoscroll-viewport' } });

  // 构造标准宿主代码卡 (<pre><div class="code-card"><div class="header"><button>Copy</button></div><div class="body"><code>...</code></div></div></pre>)
  const makeCodePre = (lineText) => {
    const pre = env.makeEl('pre');
    const card = env.makeEl('div', { className: 'code-card' });
    const hdr = env.makeEl('div', { className: 'code-hdr justify-between border-b' });
    hdr.appendChild(env.makeEl('span', { text: 'javascript' }));
    hdr.appendChild(env.makeEl('button', { attrs: { 'aria-label': 'Copy' }, text: 'Copy' }));
    const body = env.makeEl('div', { className: 'code-body' });
    const code = env.makeEl('code', { text: `${lineText}\n`.repeat(30) });
    body.appendChild(code);
    card.appendChild(hdr);
    card.appendChild(body);
    pre.appendChild(card);
    return { pre, hdr };
  };

  // 历史响应代码块 + 历史 diff chip
  const oldTurn = env.makeEl('div', { attrs: { 'data-testid': 'planner-response-text' }, className: 'turn-old' });
  const { pre: oldPre, hdr: oldHdr } = makeCodePre('const oldLine = 1;');
  const oldChip = env.makeEl('span', { attrs: { 'data-testid': 'diff-line-count' }, text: '+2 -1' });
  oldTurn.appendChild(oldPre);
  oldTurn.appendChild(oldChip);

  // 新增响应代码块 + 新增 diff chip
  const newTurn = env.makeEl('div', { attrs: { 'data-testid': 'planner-response-text' }, className: 'turn-new' });
  const { pre: newPre, hdr: newHdr } = makeCodePre('const newLine = 2;');
  const newChip = env.makeEl('span', { attrs: { 'data-testid': 'diff-line-count' }, text: '+5 -0' });
  newTurn.appendChild(newPre);
  newTurn.appendChild(newChip);

  vp.appendChild(oldTurn);
  conv.appendChild(vp);
  env.body.appendChild(conv);

  const enh = env.win.__agPrismHostEnhancer.createHostEnhancerController({
    doc: env.doc,
    win: env.win,
    getLang: () => 'zh-CN',
    t: () => '',
    isDestroyed: () => false,
    isConvRunning: () => false,
    runGuardedMut: (fn) => fn(),
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    getConfig: () => ({ sidebarNavFold: 'off', scrollBottomMotion: 'smooth' }),
  });

  // 首轮同步让历史代码块完成增强，随后追加新回合
  enh.sync();
  assert.equal(oldHdr.getAttribute('data-ag-cs-code-sticky'), '1', 'Historical code block should be enhanced first');
  vp.appendChild(newTurn);

  // 6a) 被动滚动绝不向 viewport/conv 写 data-ag-scrolling="1"
  env.win.dispatch('scroll', { target: vp });
  env.doc.dispatch('scroll', { target: vp });
  assert.equal(vp.hasAttribute('data-ag-scrolling'), false, 'Passive scroll must NEVER set data-ag-scrolling on viewport');
  assert.equal(conv.hasAttribute('data-ag-scrolling'), false, 'Passive scroll must NEVER set data-ag-scrolling on conversation');

  // 6b) 监控全文档 doc.querySelectorAll('[data-testid="diff-line-count"]') 与 oldTurn.querySelectorAll
  let docFullDiffQsa = 0;
  let oldTurnQsa = 0;
  const origDocQsa = env.doc.querySelectorAll.bind(env.doc);
  env.doc.querySelectorAll = (sel) => {
    if (String(sel).includes('diff-line-count')) docFullDiffQsa += 1;
    return origDocQsa(sel);
  };
  const origOldQsa = oldTurn.querySelectorAll.bind(oldTurn);
  oldTurn.querySelectorAll = (sel) => { oldTurnQsa += 1; return origOldQsa(sel); };

  // 记录传给 inlineDiff.sync 的 scope 参数
  const origDiffSync = env.win.__agPrismInlineDiff.sync.bind(env.win.__agPrismInlineDiff);
  let receivedScopes = null;
  env.win.__agPrismInlineDiff.sync = (nextCfg, hooks) => {
    receivedScopes = hooks?.scope || null;
    return origDiffSync(nextCfg, hooks);
  };

  // 增量作用域同步仅传 newTurn
  enh.sync({ l: true, dirtyAddedRoots: [newTurn], activeConv: conv });
  assert.ok(Array.isArray(receivedScopes) && receivedScopes.includes(newTurn), 'host-workbench-enhancer must forward incremental scope to inline-diff-client');
  assert.equal(docFullDiffQsa, 0, 'Incremental inline-diff syncChips(scope) must perform 0 full-document diff-line-count queries');
  assert.equal(oldTurnQsa, 0, 'Incremental sync must NOT re-scan untouched historical turns');
  assert.equal(newHdr.getAttribute('data-ag-cs-code-sticky'), '1', 'Newly added code block inside dirty scope must still be enhanced');
  assert.equal(newPre.getAttribute('data-ag-cs-rich-pre'), '1', 'Newly added rich code block must be stamped');

  enh.destroy();
});

// ── 7: ui-runtime 彻底静音 7 份重复 alert.css <style> 且不破坏 React 协调，destroy 100% 复原 ──
test('7) ui-runtime: silences 7 duplicate alert.css <style> tags (empty textContent + media=not all + disabled=true) in place without DOM removal and restores 100% on destroy', () => {
  const env = createMiniDom();
  const cdp = require(path.join(ROOT, 'cdp.js'));
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  const alertCss = '/* remark-github-blockquote-alert/alert.css */\n.markdown-alert{padding:8px}' + ' /*x*/'.repeat(1000);

  const dupStyles = [];
  for (let i = 0; i < 7; i += 1) {
    const msg = env.makeEl('div', { className: 'msg-bubble' });
    const st = env.makeEl('style', { text: alertCss });
    msg.appendChild(st);
    env.body.appendChild(msg);
    dupStyles.push(st);
  }

  vm.runInNewContext(uiSrc, env.win);
  env.win.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, mascot: 'off', smoothCaret: false });

  const singleton = env.doc.getElementById('ag-prism-host-alert-css');
  assert.ok(singleton && singleton.textContent === alertCss, 'Singleton #ag-prism-host-alert-css must preserve full alert.css');
  for (let i = 0; i < 7; i += 1) {
    const st = dupStyles[i];
    assert.ok(st.parentNode, `Duplicate style #${i} must stay in parent DIV (React DOM reconciliation safe)`);
    assert.equal(st.getAttribute('data-ag-turbo-dedup'), '1');
    assert.equal(st.textContent, '', `Duplicate style #${i} textContent must be emptied to eliminate 47KB duplicate CSS`);
    assert.equal(st.media, 'not all');
    assert.equal(st.getAttribute('media'), 'not all');
    assert.equal(st.disabled, true);
    assert.equal(st.sheet.disabled, true);
  }

  // 模拟 React 重渲染重新向第 3 份 <style> 写入文本并触发 childList mutation
  const rootMo = env.mos.find((m) => m.active && m.target === env.html);
  dupStyles[2].textContent = alertCss;
  rootMo.emit([{ type: 'childList', target: dupStyles[2], addedNodes: [env.makeText(alertCss)], removedNodes: [] }]);
  env.flushRafs(16);
  env.advance(120);
  env.flushRafs(16);
  assert.equal(dupStyles[2].textContent, '', 'Re-hydrated duplicate alert.css <style> must be re-silenced automatically');

  // destroy() 完整复原全部 7 份
  env.win.__agPrism.destroy();
  assert.equal(env.doc.getElementById('ag-prism-host-alert-css'), null);
  for (let i = 0; i < 7; i += 1) {
    const st = dupStyles[i];
    assert.equal(st.textContent, alertCss, `destroy() must restore textContent on style #${i}`);
    assert.equal(st.disabled, false);
    assert.equal(st.sheet.disabled, false);
    assert.equal(st.media, '');
    assert.equal(st.hasAttribute('data-ag-turbo-dedup'), false);
  }
});

// ── 8: periodic-picker-stub 接 dom-bus（精确 filter），0 游离 doc.body MO，<2048 B ──
test('8) periodic-picker-stub: stays <2048 B, subscribes via dom-bus with precise filter (0 stray doc.body MO & 0 streaming qsa), and paints badge when trigger arrives', () => {
  const stubPath = path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker-stub.js');
  const stubSrc = fs.readFileSync(stubPath, 'utf8');
  const stubBytes = Buffer.byteLength(stubSrc, 'utf8');
  assert.ok(stubBytes < 2048, `periodic-picker-stub.js must stay strictly < 2048 B (got ${stubBytes} B)`);
  assert.equal(/[^\x00-\x7f]/.test(stubSrc), false, 'periodic-picker-stub.js must be pure ASCII');
  assert.equal(stubSrc.includes('innerHTML'), false, 'periodic-picker-stub.js must have 0 innerHTML');

  const env = createMiniDom();
  const domBusSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'), 'utf8');
  vm.runInNewContext(domBusSrc, env.win);
  env.win.__agDomBus.attach(env.doc, env.win);

  const stubMod = require(stubPath);
  const stub = stubMod.mountPeriodicPickerStub({ root: env.win, doc: env.doc });

  // 绝不能额外挂游离 MO 到 doc.body（仅有 dom-bus 统一挂在 html 上的 1 个根 MO）
  const bodyMos = env.mos.filter((m) => m.active && m.target === env.body);
  assert.equal(bodyMos.length, 0, 'periodic-picker-stub must NOT attach any stray MutationObserver to doc.body when dom-bus exists');
  const busMo = env.mos.find((m) => m.active && m.target === env.html);
  assert.ok(busMo, 'dom-bus unified root MO must be active');

  // 流式爆发 30 条无关正文字段 mutation：精确 filter 拦截，0 qsa、0 timer
  let qsaCount = 0;
  const origQsa = env.doc.querySelectorAll.bind(env.doc);
  env.doc.querySelectorAll = (sel) => { qsaCount += 1; return origQsa(sel); };
  for (let i = 0; i < 30; i += 1) {
    const sp = env.makeEl('span', { text: 'token-' + i });
    env.body.appendChild(sp);
    busMo.emit([{ type: 'childList', target: env.body, addedNodes: [sp], removedNodes: [] }]);
  }
  assert.equal(env.timers.size, 0, 'Streaming non-trigger mutations must schedule 0 stub timers');
  assert.equal(qsaCount, 0, 'Streaming non-trigger mutations must execute 0 querySelectorAll scans');

  // 插入包含 model-selector-trigger 的新 composer -> filter 放行并绘制 [6C] 键帽
  const composer = env.makeEl('div', { className: 'surface-composer-card' });
  const trig = env.makeEl('button', { attrs: { 'data-testid': 'model-selector-trigger' }, text: 'Gemini 4 Carbon (High)' });
  composer.appendChild(trig);
  env.body.appendChild(composer);
  busMo.emit([{ type: 'childList', target: env.body, addedNodes: [composer], removedNodes: [] }]);
  assert.equal(env.timers.size, 1, 'Trigger insertion must schedule 1 coalesced badge timer');
  env.advance(110);
  const badge = trig.querySelector('.ag-pp-mini-keycap');
  assert.ok(badge, 'Stub must paint .ag-pp-mini-keycap after trigger arrives via dom-bus');
  assert.equal(badge.getAttribute('data-z'), '6');
  assert.equal(badge.getAttribute('data-symbol'), 'C');

  stub.destroy();
  assert.equal(trig.querySelector('.ag-pp-mini-keycap'), null, 'destroy() must remove stub badge');
  assert.equal(env.mos.filter((m) => m.active).length, 0, 'Unsubscribing last dom-bus consumer must disconnect root MO cleanly');
});
