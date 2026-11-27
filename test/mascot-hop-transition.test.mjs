// 专项单测：侧边栏/多分屏桌宠注意力聚焦限定至输入框 + 跨窗格「翻身潜入 -> 弹性蹦出」物理跃迁动画
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { collectNativePluginEntries } from '../scripts/build-common.mjs';
import { collectLinuxPortableEntries } from '../scripts/build-linux.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const hopMod = require(path.join(ROOT, 'src', 'runtime', 'mascot-hop-transition.js'));

function createMockEnv({ reducedMatches = false } = {}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const mqListeners = new Set();
  let timerSeq = 1;
  const timers = new Map();
  let nowMs = 0;

  function addL(map, type, fn, opts) {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add({ fn, opts });
  }
  function remL(map, type, fn) {
    const s = map.get(type);
    if (!s) return;
    for (const rec of s) if (rec.fn === fn) s.delete(rec);
  }
  function emitL(map, type, ev = {}) {
    const s = map.get(type);
    if (!s) return;
    ev.type = type;
    ev.preventDefault = ev.preventDefault || (() => {});
    ev.stopPropagation = ev.stopPropagation || (() => {});
    for (const rec of [...s]) rec.fn(ev);
  }

  function matchSimple(el, sel) {
    if (!sel || sel === '*') return true;
    let rest = sel.trim();
    const notM = rest.match(/:not\(([^)]+)\)/);
    if (notM) {
      if (matchSimple(el, notM[1])) return false;
      rest = rest.replace(notM[0], '');
    }
    const tagM = rest.match(/^([a-zA-Z0-9_-]+)/);
    if (tagM) {
      if (el.tagName.toLowerCase() !== tagM[1].toLowerCase()) return false;
      rest = rest.slice(tagM[0].length);
    }
    const idM = rest.match(/#((?:\\.|[a-zA-Z0-9_-])+)/);
    if (idM) {
      const targetId = idM[1].replace(/\\(.)/g, '$1');
      if (el.id !== targetId) return false;
      rest = rest.replace(idM[0], '');
    }
    for (const cm of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!el.classList.contains(cm[1])) return false;
    }
    for (const am of rest.matchAll(/\[([^\]=^$*]+)(?:(\^?)=["']?([^"'\]]*)["']?)?\]/g)) {
      const val = el.getAttribute(am[1]);
      if (am[3] === undefined) {
        if (val === null) return false;
      } else if (am[2] === '^') {
        if (!val || !val.startsWith(am[3])) return false;
      } else if (val !== am[3]) {
        return false;
      }
    }
    return true;
  }

  function mkEl(tag, attrs = {}, rect = null) {
    const attrMap = new Map();
    const children = [];
    const elListeners = new Map();
    const styleProps = new Map();
    const styleObj = {
      getPropertyValue(k) { return styleProps.get(k) || ''; },
      setProperty(k, v) { styleProps.set(k, String(v)); this[k] = String(v); },
      removeProperty(k) { styleProps.delete(k); delete this[k]; },
    };
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      parentNode: null,
      get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; },
      children,
      childNodes: children,
      get firstChild() { return children[0] || null; },
      get firstElementChild() { return children[0] || null; },
      get lastElementChild() { return children[children.length - 1] || null; },
      get isConnected() {
        let c = this;
        while (c) {
          if (c === doc || c === html) return true;
          c = c.parentNode || c.host || null;
        }
        return false;
      },
      hidden: false,
      disabled: false,
      style: styleObj,
      _text: '',
      _rect: rect || { left: 20, top: 400, width: 620, height: 96, right: 640, bottom: 496 },
      offsetHeight: 48,
      clientWidth: rect?.width ?? 620,
      clientHeight: rect?.height ?? 96,
      get textContent() { return children.length ? children.map((c) => c.textContent).join('') : this._text; },
      set textContent(v) { this._text = String(v ?? ''); children.length = 0; },
      get className() { return attrMap.get('class') || ''; },
      set className(v) { attrMap.set('class', String(v || '')); },
      get id() { return attrMap.get('id') || ''; },
      set id(v) { if (v) attrMap.set('id', String(v)); else attrMap.delete('id'); },
      classList: {
        contains: (c) => (attrMap.get('class') || '').split(/\s+/).includes(c),
        add: (...cs) => {
          const s = new Set((attrMap.get('class') || '').split(/\s+/).filter(Boolean));
          cs.forEach((c) => s.add(c));
          attrMap.set('class', [...s].join(' '));
        },
        remove: (...cs) => {
          const s = new Set((attrMap.get('class') || '').split(/\s+/).filter(Boolean));
          cs.forEach((c) => s.delete(c));
          attrMap.set('class', [...s].join(' '));
        },
      },
      setAttribute(k, v) { attrMap.set(k, String(v)); },
      getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
      hasAttribute(k) { return attrMap.has(k); },
      removeAttribute(k) { attrMap.delete(k); },
      appendChild(c) {
        if (c.parentNode) c.remove();
        c.parentNode = this;
        children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.remove();
        c.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, c);
        else children.push(c);
        return c;
      },
      removeChild(c) {
        const i = children.indexOf(c);
        if (i >= 0) { children.splice(i, 1); c.parentNode = null; }
        return c;
      },
      replaceChildren() {
        while (children.length) { const c = children.pop(); c.parentNode = null; }
      },
      remove() {
        if (!this.parentNode) return;
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
        this.parentNode = null;
      },
      contains(other) {
        for (let c = other; c; c = c.parentNode) if (c === this) return true;
        return false;
      },
      matches(sel) {
        return sel.split(',').map((s) => s.trim()).filter(Boolean).some((part) => {
          const toks = part.split(/\s+/);
          if (!matchSimple(this, toks[toks.length - 1])) return false;
          if (toks.length === 1) return true;
          let p = this.parentElement;
          let idx = toks.length - 2;
          while (p && idx >= 0) {
            if (matchSimple(p, toks[idx])) idx -= 1;
            p = p.parentElement;
          }
          return idx < 0;
        });
      },
      closest(sel) {
        for (let c = this; c && c.nodeType === 1; c = c.parentElement) if (c.matches(sel)) return c;
        return null;
      },
      querySelectorAll(sel) {
        const res = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (c.matches(sel)) res.push(c);
            walk(c);
          }
        };
        walk(this);
        return res;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      getElementById(id) {
        const target = String(id);
        const find = (n) => {
          for (const c of n.children) {
            if (c.id === target) return c;
            const hit = find(c);
            if (hit) return hit;
          }
          return null;
        };
        return find(this);
      },
      getBoundingClientRect() { return this._rect; },
      get ownerDocument() { return doc; },
      dataset: {},
      getContext: tag.toLowerCase() === 'canvas'
        ? () => ({
            clearRect() {}, save() {}, restore() {}, fillRect() {}, setTransform() {},
            translate() {}, scale() {}, rotate() {}, beginPath() {}, arc() {}, fill() {},
            stroke() {}, moveTo() {}, lineTo() {}, drawImage() {},
          })
        : undefined,
      focus() { doc.activeElement = this; },
      addEventListener(t, fn) { addL(elListeners, t, fn); },
      removeEventListener(t, fn) { remL(elListeners, t, fn); },
      dispatchEvent(ev) { emitL(elListeners, ev.type, { ...ev, target: ev.target || this }); },
    };
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    return el;
  }

  const html = mkEl('html');
  const head = mkEl('head');
  const body = mkEl('body');
  html.appendChild(head);
  html.appendChild(body);

  const mql = {
    matches: reducedMatches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener(type, fn) { if (type === 'change') mqListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'change') mqListeners.delete(fn); },
    emitChange(nextVal) {
      this.matches = !!nextVal;
      for (const fn of [...mqListeners]) fn({ matches: this.matches });
    },
  };

  const moInstances = [];
  class MockMutationObserver {
    constructor(cb) { this.cb = cb; this.target = null; this.disconnected = false; moInstances.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.disconnected = true; }
    takeRecords() { return []; }
    trigger(records) { if (!this.disconnected) this.cb(records); }
  }

  const win = {
    location: { pathname: '/c/11111111-1111-1111-1111-111111111111' },
    navigator: { language: 'zh-CN' },
    devicePixelRatio: 1,
    performance: { now: () => nowMs },
    requestAnimationFrame: (fn) => { fn(nowMs + 16); return 1; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms = 0) {
      const id = timerSeq++;
      timers.set(id, { fn, runAt: nowMs + Math.max(0, Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 1,
    clearInterval() {},
    matchMedia: (q) => (String(q).includes('prefers-reduced-motion') ? mql : { matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'relative' }),
    Event: class { constructor(t) { this.type = t; } },
    MutationObserver: MockMutationObserver,
    ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: (t, fn, opts) => addL(winListeners, t, fn, opts),
    removeEventListener: (t, fn) => remL(winListeners, t, fn),
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON, Proxy,
  };

  const doc = {
    hidden: false,
    defaultView: win,
    documentElement: html,
    head,
    body,
    activeElement: body,
    hasFocus: () => true,
    createElement: (t) => mkEl(t),
    createElementNS: (_ns, t) => mkEl(t),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    getElementById: (id) => html.getElementById(id),
    contains: (n) => html.contains(n),
    addEventListener: (t, fn, opts) => addL(docListeners, t, fn, opts),
    removeEventListener: (t, fn) => remL(docListeners, t, fn),
    dispatch: (t, ev) => emitL(docListeners, t, ev),
  };

  win.document = doc;
  win.window = win;
  win.globalThis = win;

  function advanceTimers(deltaMs) {
    const target = nowMs + deltaMs;
    while (true) {
      let nextId = null;
      let nextRec = null;
      for (const [id, rec] of timers.entries()) {
        if (rec.runAt <= target && (!nextRec || rec.runAt < nextRec.runAt)) {
          nextId = id;
          nextRec = rec;
        }
      }
      if (!nextRec) break;
      timers.delete(nextId);
      nowMs = nextRec.runAt;
      nextRec.fn();
    }
    nowMs = target;
  }

  return {
    win, doc, html, head, body, mkEl, mql, timers, moInstances,
    advanceTimers,
    dispatchWin: (t, ev) => emitL(winListeners, t, ev),
  };
}

function buildConversationPane(mkEl, parent, opts = {}) {
  const {
    cid = '11111111-1111-1111-1111-111111111111',
    isSidePanel = false,
    isMainBody = false,
    tilingPane = null,
    rect = { left: 40, top: 520, width: 620, height: 96, right: 660, bottom: 616 },
  } = opts;

  let container = parent;
  if (tilingPane != null) {
    const tp = mkEl('div', { 'data-tiling-pane': String(tilingPane) });
    parent.appendChild(tp);
    container = tp;
  }
  if (isMainBody) {
    const mb = mkEl('div', { 'data-main-content-body': 'true' });
    container.appendChild(mb);
    container = mb;
  }
  if (isSidePanel) {
    const sp = mkEl('aside', { 'data-side-panel-body': 'true', 'data-side-panel-focus-scope': 'true', class: 'agent-side-panel' });
    container.appendChild(sp);
    container = sp;
  }

  const cv = mkEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': cid });
  const header = mkEl('header', { class: 'pane-header', text: 'Session Title' });
  const viewport = mkEl('div', { 'data-testid': 'autoscroll-viewport' });
  const msgPara = mkEl('p', { class: 'message-body', text: 'Assistant message content' });
  const thinkingBtn = mkEl('button', { 'data-testid': 'thinking-collapsible-trigger', text: 'Thought for 4s' });
  const pre = mkEl('pre');
  const codeCopyBtn = mkEl('button', { 'aria-label': 'Copy code', text: 'Copy' });
  pre.appendChild(codeCopyBtn);
  viewport.appendChild(msgPara);
  viewport.appendChild(thinkingBtn);
  viewport.appendChild(pre);

  const boxAttrs = { 'data-testid': 'agent-input-box' };
  if (isSidePanel) boxAttrs.id = 'antigravity.agentSidePanelInputBox';
  const box = mkEl('div', boxAttrs, rect);
  const card = mkEl('div', { class: 'surface-composer-card' }, rect);
  const editor = mkEl('div', { contenteditable: 'true', 'data-lexical-editor': 'true', role: 'textbox' });
  const textarea = mkEl('textarea', { class: 'composer-textarea' });
  const sendBtn = mkEl('button', { 'data-testid': 'input-send-button', text: 'Send' });
  card.appendChild(editor);
  card.appendChild(textarea);
  card.appendChild(sendBtn);
  box.appendChild(card);

  cv.appendChild(header);
  cv.appendChild(viewport);
  cv.appendChild(box);
  container.appendChild(cv);

  return { container, cv, header, viewport, msgPara, thinkingBtn, codeCopyBtn, box, card, editor, textarea, sendBtn };
}

function buildMockStage(mkEl, { species = ['cat', 'clawd', 'dragon', 'whale'], withMinis = true } = {}) {
  const stage = mkEl('div', { class: 'ag-cs-crab ag-cs-dual-stage', 'data-mascot-stage': 'true' });
  const miniPile = mkEl('div', { class: 'ag-v2-mini-pile' });
  const minis = [];
  if (withMinis) {
    ['cowboy', 'shades', 'wizard'].forEach((id, idx) => {
      const mc = mkEl('canvas', { class: 'ag-v2-mini-crab-canvas' });
      mc.dataset.miniCrab = id;
      mc.style.transform = `translate3d(${14 + idx * 36}px, 0px, 0)`;
      miniPile.appendChild(mc);
      minis.push(mc);
    });
  }
  stage.appendChild(miniPile);
  const actors = [];
  for (const id of species) {
    const actor = mkEl('div', { class: 'ag-v2-mascot-actor', 'data-mascot-id': id });
    const canvas = mkEl('canvas', { class: 'ag-v2-mascot-canvas' });
    actor.appendChild(canvas);
    stage.appendChild(actor);
    actors.push({ id, actor, canvas });
  }
  const prop = mkEl('canvas', { class: 'ag-v2-habitat-prop' });
  stage.appendChild(prop);
  return { stage, miniPile, minis, actors, prop };
}

test('1) Single main session preserves native experience: clicking anywhere in main conversation keeps/selects mascot', () => {
  const env = createMockEnv();
  const main = buildConversationPane(env.mkEl, env.body, { isMainBody: true });
  const cards = [main.card];

  for (const target of [main.msgPara, main.viewport, main.thinkingBtn, main.codeCopyBtn, main.header, main.editor]) {
    const dec = hopMod.shouldTransferMascotFocus({ target, targetCard: main.card, currentCard: main.card, cards, doc: env.doc });
    assert.equal(dec.allow, true, `Single main pane must allow clicking ${target.tagName}`);
    assert.equal(dec.reason, 'single-main-pane');
  }
  // Initial selection when currentCard is null
  const initDec = hopMod.shouldTransferMascotFocus({ target: main.msgPara, targetCard: main.card, currentCard: null, cards, doc: env.doc });
  assert.equal(initDec.allow, true);
});

test('2) Sidebar (agentSidePanel) & Multi-Pane Split strictly restrict non-primary mascot focus to composer input', () => {
  const env = createMockEnv();
  const auxSplit = env.mkEl('div', { 'data-testid': 'aux-pane-split' });
  env.body.appendChild(auxSplit);

  const mainPane = buildConversationPane(env.mkEl, auxSplit, {
    cid: '11111111-1111-1111-1111-111111111111',
    isMainBody: true,
    tilingPane: 1,
    rect: { left: 40, top: 520, width: 580, height: 96, right: 620, bottom: 616 },
  });
  const splitPane2 = buildConversationPane(env.mkEl, auxSplit, {
    cid: '22222222-2222-2222-2222-222222222222',
    tilingPane: 2,
    rect: { left: 660, top: 520, width: 420, height: 96, right: 1080, bottom: 616 },
  });
  const sidePanel = buildConversationPane(env.mkEl, env.body, {
    cid: '33333333-3333-3333-3333-333333333333',
    isSidePanel: true,
    rect: { left: 1100, top: 520, width: 320, height: 96, right: 1420, bottom: 616 },
  });

  const cards = [mainPane.card, splitPane2.card, sidePanel.card];

  // Clicking sidebar message / scrollbar / thinking card / code copy button / header MUST NOT steal mascot
  for (const nonInput of [sidePanel.msgPara, sidePanel.viewport, sidePanel.thinkingBtn, sidePanel.codeCopyBtn, sidePanel.header]) {
    const dec = hopMod.shouldTransferMascotFocus({ target: nonInput, targetCard: sidePanel.card, currentCard: mainPane.card, cards, doc: env.doc });
    assert.equal(dec.allow, false, `Sidebar non-input ${nonInput.tagName} must NOT steal mascot`);
    assert.equal(dec.reason, 'sidebar-non-input');
  }

  // Clicking or focusing sidebar composer input / textarea / composer card DOES transfer mascot
  for (const inputTarget of [sidePanel.editor, sidePanel.textarea, sidePanel.card, sidePanel.box, sidePanel.sendBtn]) {
    const dec = hopMod.shouldTransferMascotFocus({ target: inputTarget, targetCard: sidePanel.card, currentCard: mainPane.card, cards, doc: env.doc });
    assert.equal(dec.allow, true, `Sidebar composer target ${inputTarget.tagName} must transfer mascot`);
    assert.equal(dec.transfer, true);
    assert.equal(dec.reason, 'sidebar-composer-input');
  }

  // Secondary split pane (Pane 2, even inside non-sidebar tiling split) also blocks non-input clicks
  const splitCards = [mainPane.card, splitPane2.card];
  for (const nonInput of [splitPane2.msgPara, splitPane2.viewport, splitPane2.thinkingBtn, splitPane2.codeCopyBtn, splitPane2.header]) {
    const dec = hopMod.shouldTransferMascotFocus({ target: nonInput, targetCard: splitPane2.card, currentCard: mainPane.card, cards: splitCards, doc: env.doc });
    assert.equal(dec.allow, false, `Secondary split non-input ${nonInput.tagName} must NOT steal mascot`);
  }
  const splitInputDec = hopMod.shouldTransferMascotFocus({ target: splitPane2.editor, targetCard: splitPane2.card, currentCard: mainPane.card, cards: splitCards, doc: env.doc });
  assert.equal(splitInputDec.allow, true);
  assert.equal(splitInputDec.transfer, true);

  // While sidebar/split is open, clicking MAIN session body still keeps/returns mascot to primary main session
  const mainBodyFromSide = hopMod.shouldTransferMascotFocus({ target: mainPane.msgPara, targetCard: mainPane.card, currentCard: sidePanel.card, cards, doc: env.doc });
  assert.equal(mainBodyFromSide.allow, true, 'Clicking main session body returns mascot to main session');
  assert.equal(mainBodyFromSide.transfer, true);
  assert.equal(mainBodyFromSide.reason, 'primary-main-body');

  // Settings / modal overlay clicks are always ignored
  const dlg = env.mkEl('div', { role: 'dialog' });
  const dlgBtn = env.mkEl('button', { text: 'Close' });
  dlg.appendChild(dlgBtn);
  env.body.appendChild(dlg);
  assert.equal(hopMod.shouldTransferMascotFocus({ target: dlgBtn, targetCard: sidePanel.card, currentCard: mainPane.card, cards, doc: env.doc }).allow, false);
});

test('3) Cross-pane two-phase physics transition (dive-flip-out -> hop-pop-in) covers all species, staggered minis & coordinates', () => {
  const env = createMockEnv();
  const paneA = buildConversationPane(env.mkEl, env.body, {
    isMainBody: true,
    rect: { left: 40, top: 520, width: 560, height: 96, right: 600, bottom: 616 },
  });
  const paneB = buildConversationPane(env.mkEl, env.body, {
    isSidePanel: true,
    rect: { left: 820, top: 500, width: 340, height: 96, right: 1160, bottom: 596 },
  });
  const { stage, minis, actors } = buildMockStage(env.mkEl, { species: ['cat', 'clawd', 'dragon', 'whale'], withMinis: true });
  paneA.card.appendChild(stage);

  let committedCount = 0;
  let completedCount = 0;
  const startRes = hopMod.runMascotHopTransition({
    stageEl: stage,
    fromAnchor: paneA.card,
    toAnchor: paneB.card,
    motionLevel: 'ultra',
    doc: env.doc,
    win: env.win,
    onCommitAnchor: () => {
      committedCount += 1;
      paneB.card.appendChild(stage);
      return true;
    },
    onComplete: () => { completedCount += 1; },
  });

  // Phase 1: dive-flip-out at source pane A
  assert.equal(startRes.animated, true);
  assert.equal(startRes.phase, 'dive-flip-out');
  assert.equal(startRes.mode, 'full');
  assert.equal(startRes.dir, 1, 'Jumping left->right uses positive flip direction (+1)');
  assert.equal(startRes.fromRect.left, 40);
  assert.equal(startRes.toRect.left, 820);
  assert.equal(stage.parentElement, paneA.card, 'Stage remains anchored on Pane A during dive-flip-out');
  assert.equal(stage.getAttribute('data-ag-mascot-hop'), 'dive-out');
  assert.equal(stage.getAttribute('data-ag-mascot-hop-mode'), 'full');
  assert.equal(stage.style.getPropertyValue('--ag-prism-hop-dir'), '1');
  assert.ok(env.doc.getElementById(hopMod.STYLE_ID), 'Managed CSS style element must be injected');
  assert.ok(env.doc.getElementById(hopMod.STYLE_ID).textContent.includes('@keyframes ag-prism-mascot-dive-out'));
  assert.ok(env.doc.getElementById(hopMod.STYLE_ID).textContent.includes('@keyframes ag-prism-mascot-pop-in'));

  // All 4 main species & 3 mini crabs get GPU-only stagger variables (35-55ms wave for minis, base translate preserved)
  assert.equal(actors.length, 4);
  assert.equal(actors[0].canvas.style.getPropertyValue('--ag-prism-hop-delay'), '0ms');
  assert.equal(actors[1].canvas.style.getPropertyValue('--ag-prism-hop-delay'), '28ms');
  const miniDelays = minis.map((m) => parseInt(m.style.getPropertyValue('--ag-prism-hop-delay'), 10));
  assert.equal(miniDelays[1] - miniDelays[0], 42, 'Mini crabs stagger by 42ms (within 35-55ms wave range)');
  assert.equal(miniDelays[2] - miniDelays[1], 42);
  assert.equal(minis[0].style.getPropertyValue('--ag-prism-hop-bx'), '14px', 'Mini crab base X offset preserved');
  assert.equal(minis[1].style.getPropertyValue('--ag-prism-hop-bx'), '50px');

  // Re-invoking sync for the same active target B during dive-out reuses active animation without reset
  const reused = hopMod.runMascotHopTransition({
    stageEl: stage, fromAnchor: paneA.card, toAnchor: paneB.card, motionLevel: 'ultra', doc: env.doc, win: env.win,
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.gen, startRes.gen);

  // Advance through Phase 1 (220ms + maxStagger 108ms = 328ms) -> commits anchor to Pane B & enters hop-pop-in
  env.advanceTimers(330);
  assert.equal(committedCount, 1);
  assert.equal(stage.parentElement, paneB.card, 'Stage re-attaches to Pane B right before hop-pop-in');
  assert.equal(hopMod.getTransitionState().phase, 'hop-pop-in');
  assert.equal(stage.getAttribute('data-ag-mascot-hop'), 'pop-in');

  // Advance through Phase 2 (280ms + 108ms = 388ms) -> settles cleanly at 0fps with 0 timers & 0 leftover attrs
  env.advanceTimers(400);
  assert.equal(completedCount, 1);
  const finalState = hopMod.getTransitionState();
  assert.equal(finalState.phase, 'idle');
  assert.equal(finalState.active, false);
  assert.equal(finalState.timersCount, 0, 'Zero timers left after animation completes (0fps sleep)');
  assert.equal(env.timers.size, 0);
  assert.equal(stage.hasAttribute('data-ag-mascot-hop'), false);
  assert.equal(minis[0].style.getPropertyValue('--ag-prism-hop-bx'), '');

  // Reverse direction B -> A uses dir = -1
  const revRes = hopMod.runMascotHopTransition({
    stageEl: stage, fromAnchor: paneB.card, toAnchor: paneA.card, motionLevel: 'standard', doc: env.doc, win: env.win,
    onCommitAnchor: () => { paneA.card.appendChild(stage); return true; },
  });
  assert.equal(revRes.animated, true);
  assert.equal(revRes.dir, -1, 'Jumping right->left flips in negative direction (-1)');
  hopMod.dispose(env.doc);
});

test('4) Rapid multi-pane clicking increments transitionGen, cancels stale animations, handles reversal & leaves zero ghost artifacts', () => {
  const env = createMockEnv();
  const paneA = buildConversationPane(env.mkEl, env.body, { rect: { left: 20, top: 500, width: 400, height: 90, right: 420, bottom: 590 } });
  const paneB = buildConversationPane(env.mkEl, env.body, { rect: { left: 460, top: 500, width: 400, height: 90, right: 860, bottom: 590 } });
  const paneC = buildConversationPane(env.mkEl, env.body, { rect: { left: 900, top: 500, width: 400, height: 90, right: 1300, bottom: 590 } });
  const { stage } = buildMockStage(env.mkEl, { species: ['cat', 'clawd'], withMinis: false });
  paneA.card.appendChild(stage);

  const commits = [];
  const r1 = hopMod.runMascotHopTransition({
    stageEl: stage, fromAnchor: paneA.card, toAnchor: paneB.card, motionLevel: 'ultra', doc: env.doc, win: env.win,
    onCommitAnchor: () => { commits.push('B'); paneB.card.appendChild(stage); return true; },
  });
  env.advanceTimers(60);

  // Rapid click C mid-dive -> supersedes gen1 cleanly
  const r2 = hopMod.runMascotHopTransition({
    stageEl: stage, fromAnchor: paneA.card, toAnchor: paneC.card, motionLevel: 'ultra', doc: env.doc, win: env.win,
    onCommitAnchor: () => { commits.push('C'); paneC.card.appendChild(stage); return true; },
  });
  assert.ok(r2.gen > r1.gen, 'transitionGen must strictly increment on rapid retarget');
  assert.equal(env.timers.size, 1, 'Stale Phase 1 timer from B must be cancelled immediately');

  // Complete transition -> ONLY C commits, never B!
  env.advanceTimers(800);
  assert.deepEqual(commits, ['C'], 'Superseded Pane B commit must never fire');
  assert.equal(stage.parentElement, paneC.card);
  assert.equal(env.timers.size, 0);

  // Mid-dive reversal back to current anchor C pops mascot right back up on C without stuck opacity
  const r3 = hopMod.runMascotHopTransition({
    stageEl: stage, fromAnchor: paneC.card, toAnchor: paneA.card, motionLevel: 'standard', doc: env.doc, win: env.win,
    onCommitAnchor: () => { paneA.card.appendChild(stage); return true; },
  });
  env.advanceTimers(80);
  const rBack = hopMod.runMascotHopTransition({
    stageEl: stage, fromAnchor: paneC.card, toAnchor: paneC.card, motionLevel: 'standard', doc: env.doc, win: env.win,
  });
  assert.equal(rBack.animated, true);
  assert.equal(rBack.reversed, true);
  assert.equal(rBack.phase, 'hop-pop-in');
  assert.ok(rBack.gen > r3.gen);
  env.advanceTimers(500);
  assert.equal(stage.parentElement, paneC.card);
  assert.equal(stage.hasAttribute('data-ag-mascot-hop'), false);
  assert.equal(env.timers.size, 0);
  hopMod.dispose(env.doc);
});

test('5) Motion level & accessibility matrix: subtle / off / prefers-reduced-motion / data-ag-cs-ignore-rm="1" (incl. dual-mascot-rig contract)', () => {
  const env = createMockEnv({ reducedMatches: true });
  const paneA = buildConversationPane(env.mkEl, env.body, { rect: { left: 20, top: 500, width: 400, height: 90, right: 420, bottom: 590 } });
  const paneB = buildConversationPane(env.mkEl, env.body, { rect: { left: 520, top: 500, width: 400, height: 90, right: 920, bottom: 590 } });
  const { stage } = buildMockStage(env.mkEl);
  paneA.card.appendChild(stage);

  // System prefers-reduced-motion: reduce (without ignore-rm) -> 0 animation instant switch
  assert.equal(hopMod.isReducedMotionActive({ win: env.win, doc: env.doc, motionLevel: 'standard' }), true);
  const rmOff = hopMod.runMascotHopTransition({ stageEl: stage, fromAnchor: paneA.card, toAnchor: paneB.card, motionLevel: 'standard', doc: env.doc, win: env.win });
  assert.equal(rmOff.animated, false);
  assert.equal(rmOff.reason, 'motion-disabled');

  // Set Issue #101 contract data-ag-cs-ignore-rm="1" -> ignores system reduced-motion & runs subtle/full animations!
  env.html.setAttribute('data-ag-cs-ignore-rm', '1');
  assert.equal(hopMod.isReducedMotionActive({ win: env.win, doc: env.doc, motionLevel: 'standard' }), false);

  // Subtle mode: shortened restrained profile (140ms dive + 170ms pop)
  const subProf = hopMod.resolveHopMotionProfile({ win: env.win, doc: env.doc, motionLevel: 'subtle' });
  assert.equal(subProf.mode, 'subtle');
  assert.equal(subProf.diveMs, 140);
  assert.equal(subProf.popMs, 170);
  const subRes = hopMod.runMascotHopTransition({
    stageEl: stage, fromAnchor: paneA.card, toAnchor: paneB.card, motionLevel: 'subtle', doc: env.doc, win: env.win,
    onCommitAnchor: () => { paneB.card.appendChild(stage); return true; },
  });
  assert.equal(subRes.animated, true);
  assert.equal(subRes.mode, 'subtle');
  assert.equal(stage.getAttribute('data-ag-mascot-hop-mode'), 'subtle');
  env.advanceTimers(500);
  assert.equal(stage.parentElement, paneB.card);

  // motionLevel === 'off' ALWAYS disables animations even when data-ag-cs-ignore-rm="1" is set!
  assert.equal(hopMod.isReducedMotionActive({ win: env.win, doc: env.doc, motionLevel: 'off' }), true);
  const offRes = hopMod.runMascotHopTransition({ stageEl: stage, fromAnchor: paneB.card, toAnchor: paneA.card, motionLevel: 'off', doc: env.doc, win: env.win });
  assert.equal(offRes.animated, false);

  // Verify dual-mascot-rig.js unified prefers-reduced-motion + data-ag-cs-ignore-rm="1" contract (mount + mq change + MO attr toggle)
  const rigMod = require(path.join(ROOT, 'dual-mascot-rig.js'));
  const rigHost = env.mkEl('div', { class: 'ag-cs-crab ag-cs-dual-stage' });
  paneA.card.appendChild(rigHost);

  // With data-ag-cs-ignore-rm="1" and system reducedMatches=true -> rig reducedMotion must be false
  const rigInst = rigMod.mountDualMascotStage(rigHost, { mascot: 'crab' });
  assert.equal(rigInst.getLayoutSnapshot().reducedMotion, false, 'dual-mascot-rig honors data-ag-cs-ignore-rm="1" on initial mount');

  // System matchMedia change event while ignore-rm="1" -> remains false
  env.mql.emitChange(true);
  assert.equal(rigInst.getLayoutSnapshot().reducedMotion, false, 'dual-mascot-rig honors data-ag-cs-ignore-rm="1" on matchMedia change');

  // Remove ignore-rm -> MO refreshes reducedMotion to true
  env.html.removeAttribute('data-ag-cs-ignore-rm');
  for (const mo of env.moInstances) mo.trigger([{ attributeName: 'data-ag-cs-ignore-rm' }]);
  assert.equal(rigInst.getLayoutSnapshot().reducedMotion, true, 'Removing data-ag-cs-ignore-rm restores system prefers-reduced-motion');

  // Re-enable ignore-rm + set data-ag-cs-motion="off" -> motionLevel off still wins (true)
  env.html.setAttribute('data-ag-cs-ignore-rm', '1');
  env.html.setAttribute('data-ag-cs-motion', 'off');
  for (const mo of env.moInstances) mo.trigger([{ attributeName: 'data-ag-cs-motion' }]);
  assert.equal(rigInst.getLayoutSnapshot().reducedMotion, true, 'data-ag-cs-motion="off" always takes precedence over ignore-rm');

  rigInst.dispose();
  hopMod.dispose(env.doc);
});

test('6) End-to-end ui-runtime + Ch10 mascot wiring, complete dispose/teardown & packaging coverage', () => {
  // Verify Ch10 registry + bundle compilation prepends mascot-hop-transition.js & stays within 128 KB budget
  const chMascot = cdp.findChannel('mascot');
  assert.ok(chMascot);
  assert.deepEqual([...chMascot.files], ['src/runtime/mascot-hop-transition.js', 'dual-mascot-rig.js']);
  assert.equal(cdp.buildMascotChannelExpression({ ...cdp.DEFAULT_CONFIG, mascot: 'off' }, { noDiskCache: true }), '');
  const ch10Expr = cdp.buildMascotChannelExpression({ ...cdp.DEFAULT_CONFIG, mascot: 'crab' }, { noDiskCache: true });
  assert.ok(ch10Expr.includes('__agPrismMascotHop'), 'Ch10 compiled expression must prepend mascot-hop-transition.js');
  assert.ok(Buffer.byteLength(ch10Expr, 'utf8') < 131072, 'Ch10 mascot channel must stay < 131,072 B');

  // Verify packaging scripts auto-include src/runtime/mascot-hop-transition.js
  const nativeEntries = new Set(collectNativePluginEntries().map((e) => e.name));
  assert.ok(nativeEntries.has('native-plugin/src/runtime/mascot-hop-transition.js'), 'build-common native-plugin must include mascot-hop-transition.js');
  const linuxEntries = new Set(collectLinuxPortableEntries().map((e) => e.name));
  assert.ok(linuxEntries.has('obsidian-prism-linux/native-plugin/src/runtime/mascot-hop-transition.js'), 'build-linux portable archive must include mascot-hop-transition.js');

  // Full ui-runtime + mascot-hop-transition integration test
  const env = createMockEnv({ reducedMatches: false });
  const mainPane = buildConversationPane(env.mkEl, env.body, {
    cid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    isMainBody: true,
    rect: { left: 40, top: 520, width: 580, height: 96, right: 620, bottom: 616 },
  });
  const sidePanel = buildConversationPane(env.mkEl, env.body, {
    cid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    isSidePanel: true,
    rect: { left: 960, top: 520, width: 340, height: 96, right: 1300, bottom: 616 },
  });

  const uiMainFactory = require(path.join(ROOT, 'ui-runtime.js'));
  const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
  const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
  const hopSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'mascot-hop-transition.js'), 'utf8');

  const sb = env.win;
  sb.__agPrismI18nCore = i18nCore;
  sb.__agPrismI18nLocales = i18nLocales;
  sb.__agDualMascotRig = {
    mountDualMascotStage(rootEl) {
      const a = env.mkEl('div', { class: 'ag-v2-mascot-actor' });
      a.appendChild(env.mkEl('canvas', { class: 'ag-v2-mascot-canvas' }));
      rootEl.appendChild(a);
      return { setState() {}, syncPowerState() {}, notify() {}, dispose() {} };
    },
  };
  vm.runInNewContext(hopSrc, sb);
  vm.runInNewContext(
    `(${uiMainFactory.toString()})(${JSON.stringify({ ...cdp.DEFAULT_CONFIG, mascot: 'crab', motionLevel: 'ultra', smoothCaret: false })}, { version: '1.0.8-beta.3', codeHash: 'hop-e2e' });`,
    sb
  );
  const api = sb.__agPrism;

  // Starts on main pane
  assert.ok(mainPane.card.querySelector('.ag-cs-crab'), 'Mascot mounts on primary main pane initially');
  assert.equal(sidePanel.card.querySelector('.ag-cs-crab'), null);

  // Clicking sidebar message body / thinking trigger / copy button / header MUST NOT move mascot
  for (const el of [sidePanel.msgPara, sidePanel.thinkingBtn, sidePanel.codeCopyBtn, sidePanel.header]) {
    env.doc.dispatch('pointerdown', { target: el });
    api.sync();
    assert.ok(mainPane.card.querySelector('.ag-cs-crab'), `Sidebar non-input click on ${el.tagName} must keep mascot on main pane`);
    assert.equal(sidePanel.card.querySelector('.ag-cs-crab'), null);
  }

  // Clicking sidebar composer editor triggers dive-flip-out -> hop-pop-in transition to sidebar!
  env.doc.dispatch('pointerdown', { target: sidePanel.editor });
  api.sync();
  const stageEl = env.doc.querySelector('.ag-cs-crab');
  assert.equal(stageEl.parentElement, mainPane.card, 'During dive-flip-out, stage stays on main pane');
  assert.equal(stageEl.getAttribute('data-ag-mascot-hop'), 'dive-out');

  env.advanceTimers(260);
  assert.equal(stageEl.parentElement, sidePanel.card, 'After dive-flip-out, stage commits to sidebar composer card');
  assert.equal(stageEl.getAttribute('data-ag-mascot-hop'), 'pop-in');

  env.advanceTimers(320);
  assert.equal(stageEl.hasAttribute('data-ag-mascot-hop'), false, 'Pop-in completes and cleans transition attributes');
  assert.equal(sb.__agPrismMascotHop.getTransitionState().active, false);

  // Teardown via MASCOT_REMOVE_EXPRESSION & REMOVE_EXPRESSION leaves zero styles, layers, timers, or globals
  assert.ok(env.doc.getElementById('ag-prism-mascot-hop-style'));
  vm.runInNewContext(cdp.MASCOT_REMOVE_EXPRESSION, sb);
  assert.equal(env.doc.getElementById('ag-prism-mascot-hop-style'), null, 'MASCOT_REMOVE_EXPRESSION must remove #ag-prism-mascot-hop-style');
  assert.equal(sb.__agPrismMascotHop, undefined, 'MASCOT_REMOVE_EXPRESSION must delete __agPrismMascotHop');

  // Re-inject hop style & test full REMOVE_EXPRESSION
  vm.runInNewContext(hopSrc, sb);
  sb.__agPrismMascotHop.ensureStyle(env.doc);
  const ghostLayer = env.mkEl('div', { class: 'ag-prism-mascot-hop-layer' });
  env.body.appendChild(ghostLayer);
  vm.runInNewContext(cdp.REMOVE_EXPRESSION, sb);
  assert.equal(env.doc.getElementById('ag-prism-mascot-hop-style'), null, 'REMOVE_EXPRESSION must remove #ag-prism-mascot-hop-style');
  assert.equal(env.doc.querySelector('.ag-prism-mascot-hop-layer'), null, 'REMOVE_EXPRESSION must remove any hop layers');
  assert.equal(sb.__agPrismMascotHop, undefined, 'REMOVE_EXPRESSION must delete __agPrismMascotHop');
  assert.equal(env.timers.size, 0);
});

test('7) Real Antigravity Split View DOM ([data-main-content-body] > [data-split-panes] > [data-tiling-pane] x2): pane 2 non-input never steals mascot, composer triggers hop', () => {
  const env = createMockEnv({ reducedMatches: false });
  const mainBody = env.mkEl('div', { 'data-main-content-body': 'true' });
  const splitPanes = env.mkEl('div', { 'data-split-panes': 'true' });
  mainBody.appendChild(splitPanes);
  env.body.appendChild(mainBody);

  const pane1 = buildConversationPane(env.mkEl, splitPanes, {
    cid: '11111111-aaaa-1111-1111-111111111111',
    tilingPane: 1,
    rect: { left: 40, top: 520, width: 540, height: 96, right: 580, bottom: 616 },
  });
  const pane2 = buildConversationPane(env.mkEl, splitPanes, {
    cid: '22222222-bbbb-2222-2222-222222222222',
    tilingPane: 2,
    rect: { left: 620, top: 520, width: 540, height: 96, right: 1160, bottom: 616 },
  });
  const cards = [pane1.card, pane2.card];

  // Both panes sit under [data-main-content-body], yet ONLY pane 1 is primary
  assert.equal(hopMod.isMainPrimaryCard(pane1.card, cards), true, 'First tiling pane under [data-main-content-body] is primary');
  assert.equal(hopMod.isMainPrimaryCard(pane2.card, cards), false, 'Second tiling pane under [data-main-content-body] must NOT be treated as primary');

  // Clicking pane 1 body keeps/focuses mascot
  for (const el of [pane1.msgPara, pane1.viewport, pane1.thinkingBtn, pane1.header]) {
    const dec = hopMod.shouldTransferMascotFocus({ target: el, targetCard: pane1.card, currentCard: pane1.card, cards, doc: env.doc });
    assert.equal(dec.allow, true, `Primary split pane 1 body (${el.tagName}) must keep mascot`);
  }

  // Clicking pane 2 body / code copy button / scrollbar viewport / thinking trigger / header MUST NOT steal mascot
  for (const el of [pane2.msgPara, pane2.codeCopyBtn, pane2.viewport, pane2.thinkingBtn, pane2.header]) {
    const dec = hopMod.shouldTransferMascotFocus({ target: el, targetCard: pane2.card, currentCard: pane1.card, cards, doc: env.doc });
    assert.equal(dec.allow, false, `Split pane 2 non-input (${el.tagName}) must NOT steal mascot`);
    assert.equal(dec.transfer, false);
    assert.equal(dec.reason, 'split-non-input');
  }

  // Clicking pane 2 composer input triggers hop transfer
  for (const el of [pane2.editor, pane2.textarea, pane2.card, pane2.sendBtn]) {
    const dec = hopMod.shouldTransferMascotFocus({ target: el, targetCard: pane2.card, currentCard: pane1.card, cards, doc: env.doc });
    assert.equal(dec.allow, true, `Split pane 2 composer (${el.tagName}) must trigger hop`);
    assert.equal(dec.transfer, true);
    assert.equal(dec.reason, 'split-composer-input');
  }

  // Clicking pane 1 body while mascot is on pane 2 recalls mascot to primary pane 1
  const recallDec = hopMod.shouldTransferMascotFocus({ target: pane1.msgPara, targetCard: pane1.card, currentCard: pane2.card, cards, doc: env.doc });
  assert.equal(recallDec.allow, true);
  assert.equal(recallDec.transfer, true);
  assert.equal(recallDec.reason, 'primary-main-body');

  // End-to-end ui-runtime check on the real nested Split View DOM
  const uiMainFactory = require(path.join(ROOT, 'ui-runtime.js'));
  const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
  const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
  const hopSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'mascot-hop-transition.js'), 'utf8');

  const sb = env.win;
  sb.__agPrismI18nCore = i18nCore;
  sb.__agPrismI18nLocales = i18nLocales;
  sb.__agDualMascotRig = {
    mountDualMascotStage(rootEl) {
      const a = env.mkEl('div', { class: 'ag-v2-mascot-actor' });
      a.appendChild(env.mkEl('canvas', { class: 'ag-v2-mascot-canvas' }));
      rootEl.appendChild(a);
      return { setState() {}, syncPowerState() {}, notify() {}, dispose() {} };
    },
  };
  vm.runInNewContext(hopSrc, sb);
  vm.runInNewContext(
    `(${uiMainFactory.toString()})(${JSON.stringify({ ...cdp.DEFAULT_CONFIG, mascot: 'crab', motionLevel: 'ultra', smoothCaret: false })}, { version: '1.0.8-beta.4', codeHash: 'split-view-e2e' });`,
    sb
  );
  const api = sb.__agPrism;

  assert.ok(pane1.card.querySelector('.ag-cs-crab'), 'Mascot mounts on Split View pane 1 initially');
  assert.equal(pane2.card.querySelector('.ag-cs-crab'), null);

  // Clicking pane 2 body, code copy button & scrollbar viewport must NOT steal mascot
  for (const el of [pane2.msgPara, pane2.codeCopyBtn, pane2.viewport]) {
    env.doc.dispatch('pointerdown', { target: el });
    api.sync();
    assert.ok(pane1.card.querySelector('.ag-cs-crab'), `Pane 2 ${el.tagName} click must keep mascot on pane 1`);
    assert.equal(pane2.card.querySelector('.ag-cs-crab'), null);
  }

  // Clicking pane 2 composer input triggers flip-dive hop transition to pane 2
  env.doc.dispatch('pointerdown', { target: pane2.editor });
  api.sync();
  const stageEl = env.doc.querySelector('.ag-cs-crab');
  assert.equal(stageEl.parentElement, pane1.card, 'During dive-out, stage stays anchored on pane 1');
  assert.equal(stageEl.getAttribute('data-ag-mascot-hop'), 'dive-out');

  env.advanceTimers(260);
  assert.equal(stageEl.parentElement, pane2.card, 'After dive-out, stage commits to pane 2 composer');
  assert.equal(stageEl.getAttribute('data-ag-mascot-hop'), 'pop-in');

  env.advanceTimers(320);
  assert.equal(stageEl.hasAttribute('data-ag-mascot-hop'), false);
  vm.runInNewContext(cdp.REMOVE_EXPRESSION, sb);
  assert.equal(env.timers.size, 0);
});

test('8) ask_question 问答卡与 side-question-panel 点击焦点转移 + 多 conversation-view 下 peek 与底边棱镜反射', () => {
  const env = createMockEnv({ reducedMatches: false });
  const mainBody = env.mkEl('div', { 'data-main-content-body': 'true' });
  const splitPanes = env.mkEl('div', { 'data-split-panes': 'true' });
  mainBody.appendChild(splitPanes);
  env.body.appendChild(mainBody);

  const pane1 = buildConversationPane(env.mkEl, splitPanes, {
    cid: '33333333-aaaa-1111-1111-111111111111',
    tilingPane: 1,
    rect: { left: 40, top: 520, width: 540, height: 96, right: 580, bottom: 616 },
  });
  const pane2 = buildConversationPane(env.mkEl, splitPanes, {
    cid: '44444444-bbbb-2222-2222-222222222222',
    tilingPane: 2,
    rect: { left: 620, top: 520, width: 540, height: 96, right: 1160, bottom: 616 },
  });

  // 在 pane2 中挂载 interaction-takeover-card 与 side-question-panel
  const tkCard = env.mkEl('div', { class: 'agy-takeover-frame', 'data-testid': 'interaction-takeover-card' }, { left: 620, top: 360, width: 540, height: 140, right: 1160, bottom: 500 });
  const tkOpt = env.mkEl('button', { 'data-testid': 'ask-question-option' }, { left: 632, top: 380, width: 500, height: 32, right: 1132, bottom: 412 });
  tkCard.appendChild(tkOpt);
  pane2.cv.insertBefore(tkCard, pane2.box);

  const sideQ = env.mkEl('div', { 'data-testid': 'side-question-panel' }, { left: 620, top: 240, width: 540, height: 100, right: 1160, bottom: 340 });
  const sideQBtn = env.mkEl('button', { type: 'button' }, { left: 632, top: 260, width: 120, height: 28, right: 752, bottom: 288 });
  sideQ.appendChild(sideQBtn);
  pane2.cv.insertBefore(sideQ, tkCard);

  const cards = [pane1.card, pane2.card];

  // 1) 同窗格问答卡与 side-question-panel 应纳入可转移焦点的 composer 关联区
  assert.equal(hopMod.isComposerInputTarget(tkOpt, pane2.card), true, '同窗格 interaction-takeover-card 选项应视为 composer 关联区');
  assert.equal(hopMod.isComposerInputTarget(sideQBtn, pane2.card), true, '同窗格 side-question-panel 按钮应视为 composer 关联区');
  assert.equal(hopMod.isComposerInputTarget(tkOpt, pane1.card), false, '跨窗格问答卡不得误匹配其他窗格卡片');
  assert.equal(hopMod.isComposerInputTarget(sideQBtn, pane1.card), false, '跨窗格 side-question-panel 不得误匹配其他窗格卡片');

  const decTk = hopMod.shouldTransferMascotFocus({ target: tkOpt, targetCard: pane2.card, currentCard: pane1.card, cards, doc: env.doc });
  assert.equal(decTk.allow, true, '点击次分屏问答选项卡必须允许转移桌宠焦点');
  assert.equal(decTk.transfer, true);
  assert.equal(decTk.reason, 'split-composer-input');

  const decSq = hopMod.shouldTransferMascotFocus({ target: sideQBtn, targetCard: pane2.card, currentCard: pane1.card, cards, doc: env.doc });
  assert.equal(decSq.allow, true, '点击次分屏 side-question-panel 必须允许转移桌宠焦点');
  assert.equal(decSq.transfer, true);
  assert.equal(decSq.reason, 'split-composer-input');

  // 2) 端到端 ui-runtime 验证：多 conversation-view 场景点击 pane2 问答卡可切焦点并立刻 peek，且全局无归属 takeover 卡也不被多 CV 误跳过
  const uiMainFactory = require(path.join(ROOT, 'ui-runtime.js'));
  const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
  const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
  const hopSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'mascot-hop-transition.js'), 'utf8');

  const sb = env.win;
  sb.__agPrismI18nCore = i18nCore;
  sb.__agPrismI18nLocales = i18nLocales;
  let lastYieldMode = 'none';
  sb.__agDualMascotRig = {
    mountDualMascotStage(rootEl, initOpts) {
      lastYieldMode = initOpts?.yieldMode || 'none';
      const a = env.mkEl('div', { class: 'ag-v2-mascot-actor' });
      a.appendChild(env.mkEl('canvas', { class: 'ag-v2-mascot-canvas' }));
      rootEl.appendChild(a);
      return {
        setState(st) { if (st && st.yieldMode !== undefined) lastYieldMode = st.yieldMode; },
        syncPowerState() {},
        notify() {},
        dispose() {},
      };
    },
  };
  vm.runInNewContext(hopSrc, sb);
  vm.runInNewContext(
    `(${uiMainFactory.toString()})(${JSON.stringify({ ...cdp.DEFAULT_CONFIG, mascot: 'crab', motionLevel: 'off', smoothCaret: false })}, { version: '1.0.8-beta.4', codeHash: 'ask-peek-e2e' });`,
    sb
  );
  const api = sb.__agPrism;

  // 初始焦点在 pane1，不因 pane2 的 takeover 误 peek
  assert.ok(pane1.card.querySelector('.ag-cs-crab'), '初始主宠挂载在 pane1');
  assert.equal(lastYieldMode, 'none', '非活跃 pane2 的 takeover 不应干扰 pane1');

  // 点击 pane2 问答选项 -> 切换焦点到 pane2 并立即进入 peek，且问答卡挂 prism-box 与底边 reflect
  env.doc.dispatch('pointerdown', { target: tkOpt });
  api.sync();
  assert.ok(pane2.card.querySelector('.ag-cs-crab'), '点击 pane2 问答卡后主宠应转移到 pane2');
  assert.equal(lastYieldMode, 'peek', 'pane2 问答卡可见时主宠必须进入 peek');
  assert.equal(tkCard.getAttribute('data-ag-cs-prism-box'), '1', '问答卡必须启用 prism-box');
  assert.equal(tkCard.getAttribute('data-ag-cs-prism-reflect'), 'bottom', '问答卡必须启用底边环境棱镜反射');

  // 切回 pane1 且移除 pane2 局部 takeover，挂载全局无 CV 归属的可见 takeover 卡 -> 多 conversation-view 下仍应触发 peek
  tkCard.remove();
  sideQ.remove();
  env.doc.dispatch('pointerdown', { target: pane1.editor });
  api.sync();
  assert.equal(lastYieldMode, 'none');

  const globalTk = env.mkEl('div', { class: 'agy-takeover-frame', 'data-testid': 'interaction-takeover-card' }, { left: 100, top: 320, width: 520, height: 120, right: 620, bottom: 440 });
  env.body.appendChild(globalTk);
  api.sync();
  assert.equal(lastYieldMode, 'peek', '多 conversation-view 场景下全局可见非 subagent takeover 卡仍必须触发 peek');

  vm.runInNewContext(cdp.REMOVE_EXPRESSION, sb);
  assert.equal(env.timers.size, 0);
});
