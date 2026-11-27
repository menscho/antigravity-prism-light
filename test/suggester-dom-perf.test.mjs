import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));

function createSuggesterPerfDom() {
  const listeners = new Map();
  let moInstance = null;
  let takeRecordsCalls = 0;

  function matchesSingle(el, raw) {
    if (!el || el.nodeType !== 1) return false;
    let rem = raw.trim();
    if (!rem) return false;
    const tm = rem.match(/^[a-zA-Z0-9-]+/);
    if (tm) {
      if (el.tagName.toLowerCase() !== tm[0].toLowerCase()) return false;
      rem = rem.slice(tm[0].length);
    }
    const idm = rem.match(/#([a-zA-Z0-9_-]+)/);
    if (idm) {
      if (el.id !== idm[1]) return false;
      rem = rem.replace(idm[0], '');
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

  function matchSel(el, sel) {
    return String(sel || '').split(',').some((p) => {
      const s = p.trim();
      if (!s) return false;
      if (s.includes(' ')) {
        const segs = s.split(/\s+/).filter(Boolean);
        if (!matchesSingle(el, segs[segs.length - 1])) return false;
        let cur = el.parentElement;
        for (let i = segs.length - 2; i >= 0; i--) {
          while (cur && !matchesSingle(cur, segs[i])) cur = cur.parentElement;
          if (!cur) return false;
          cur = cur.parentElement;
        }
        return true;
      }
      return matchesSingle(el, s);
    });
  }

  function makeText(val) {
    return { nodeType: 3, nodeValue: String(val), textContent: String(val), parentNode: null, parentElement: null };
  }

  function makeEl(tag) {
    const attrs = new Map();
    const classes = new Set();
    const childNodes = [];
    const elListeners = new Map();
    let offsetHeightReads = 0;
    let removeChildCalls = 0;
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      parentNode: null,
      parentElement: null,
      childNodes,
      get children() { return childNodes.filter((n) => n.nodeType === 1); },
      get firstChild() { return childNodes[0] || null; },
      get firstElementChild() { return childNodes.find((n) => n.nodeType === 1) || null; },
      isConnected: false,
      style: { setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } },
      classList: {
        contains: (c) => classes.has(c),
        add: (...cs) => { cs.forEach((c) => c && classes.add(c)); attrs.set('class', [...classes].join(' ')); },
        remove: (...cs) => { cs.forEach((c) => classes.delete(c)); attrs.set('class', [...classes].join(' ')); },
      },
      get id() { return attrs.get('id') || ''; },
      set id(v) { if (v) attrs.set('id', String(v)); else attrs.delete('id'); },
      get className() { return [...classes].join(' '); },
      set className(v) {
        classes.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
        if (classes.size) attrs.set('class', [...classes].join(' '));
        else attrs.delete('class');
      },
      get textContent() { return childNodes.map((c) => c.textContent).join(''); },
      set textContent(v) {
        childNodes.length = 0;
        if (v) el.appendChild(makeText(v));
      },
      get offsetHeight() { offsetHeightReads += 1; return 28; },
      _getOffsetHeightReads: () => offsetHeightReads,
      _getRemoveChildCalls: () => removeChildCalls,
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'class') el.className = String(v);
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(ch) {
        if (ch.parentNode) ch.parentNode.removeChild(ch);
        ch.parentNode = el;
        ch.parentElement = el;
        childNodes.push(ch);
        const mark = (n, v) => { n.isConnected = v; for (const c of n.childNodes || []) mark(c, v); };
        if (el.isConnected) mark(ch, true);
        return ch;
      },
      removeChild(ch) {
        removeChildCalls += 1;
        const i = childNodes.indexOf(ch);
        if (i >= 0) childNodes.splice(i, 1);
        ch.parentNode = null;
        ch.parentElement = null;
        const mark = (n) => { n.isConnected = false; for (const c of n.childNodes || []) mark(c); };
        mark(ch);
        return ch;
      },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      contains(target) {
        let cur = target;
        while (cur) { if (cur === el) return true; cur = cur.parentNode; }
        return false;
      },
      matches: (s) => matchSel(el, s),
      closest(s) {
        let cur = el;
        while (cur) { if (cur.nodeType === 1 && matchSel(cur, s)) return cur; cur = cur.parentElement; }
        return null;
      },
      querySelectorAll(s) {
        const out = [];
        const walk = (n) => {
          for (const c of n.childNodes || []) {
            if (c.nodeType === 1) { if (matchSel(c, s)) out.push(c); walk(c); }
          }
        };
        walk(el);
        return out;
      },
      querySelector(s) { return el.querySelectorAll(s)[0] || null; },
      addEventListener(t, fn) { if (!elListeners.has(t)) elListeners.set(t, []); elListeners.get(t).push(fn); },
      removeEventListener() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 420 }; },
    };
    return el;
  }

  const html = makeEl('html');
  html.isConnected = true;
  html.setAttribute('data-ag-cs-lang', 'en');
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  const convView = makeEl('div');
  convView.setAttribute('data-testid', 'conversation-view');
  convView.setAttribute('data-cascade-id', 'cid-perf-1');
  body.appendChild(convView);

  const composer = makeEl('div');
  composer.className = 'surface-composer';
  composer.setAttribute('data-testid', 'agent-input-box');
  const caretHost = makeEl('div');
  caretHost.setAttribute('data-ag-cs-caret-host', '1');
  const editor = makeEl('div');
  editor.setAttribute('data-lexical-editor', 'true');
  editor.setAttribute('contenteditable', 'true');
  caretHost.appendChild(editor);
  composer.appendChild(caretHost);
  const footer = makeEl('div');
  composer.appendChild(footer);
  body.appendChild(composer);

  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    activeElement: editor,
    createElement: makeEl,
    createTextNode: makeText,
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); },
    removeEventListener(t, fn) {
      const arr = listeners.get(t);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent(ev) { for (const fn of [...(listeners.get(ev.type) || [])]) fn(ev); },
  };

  class SpyMO {
    constructor(cb) { this.cb = cb; this.disconnected = false; moInstance = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
    takeRecords() { takeRecordsCalls += 1; return []; }
  }

  const win = {
    document: doc,
    location: { pathname: '/c/cid-perf-1' },
    navigator: { language: 'en-US' },
    MutationObserver: SpyMO,
    Event: class { constructor(type) { this.type = type; } },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 1),
    cancelAnimationFrame: (id) => clearTimeout(id),
    Map, Set, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON, Error,
  };
  win.window = win;
  win.globalThis = win;

  return {
    doc, win, html, convView, caretHost, footer, makeEl, makeText,
    getMo: () => moInstance,
    getTakeRecordsCalls: () => takeRecordsCalls,
  };
}

test('suggester-client performs tail-scan pruning, drains MutationObserver via takeRecords(), skips steady-state rebuild/reflow, and defers while hidden', async () => {
  const env = createSuggesterPerfDom();
  let capturedTurns = null;
  let suggestCalls = 0;

  // Build 24 historical turns + nested wrapper around last assistant turn; instrument text nodeValue on first 12 turns to verify tail-scan skips extractCleanNodeText on them
  let earlyNodeWalks = 0;
  for (let i = 0; i < 24; i++) {
    const isUser = i % 2 === 0;
    const msg = env.makeEl('div');
    msg.setAttribute('data-testid', isUser ? 'user-message-content' : 'planner-response-text');
    const txt = env.makeText(`${isUser ? 'User' : 'Assistant'} turn #${i}`);
    if (i < 12) {
      const rawVal = txt.nodeValue;
      Object.defineProperty(txt, 'nodeValue', {
        get() { earlyNodeWalks += 1; return rawVal; },
        configurable: true,
      });
    }
    msg.appendChild(txt);
    env.convView.appendChild(msg);
  }
  // Add nested container wrapping an inner assistant node to prove O(N*depth) pruning avoids duplicate extraction
  const outerWrap = env.makeEl('div');
  outerWrap.setAttribute('data-testid', 'agent-response');
  const innerResp = env.makeEl('div');
  innerResp.setAttribute('data-testid', 'planner-response-text');
  innerResp.appendChild(env.makeText('Final nested assistant reply'));
  outerWrap.appendChild(innerResp);

  env.win.__agPrismSuggestCall = (raw) => {
    const msg = JSON.parse(raw);
    setTimeout(() => {
      if (msg.action === 'get-config') {
        env.win.__agPrismSuggesterResolve(msg.id, {
          ok: true,
          config: { enabled: true, ttlMinutes: 15 },
          backend: { aiReady: true, profileName: 'Default', model: 'gpt-4o-mini' },
        });
      } else if (msg.action === 'suggest') {
        suggestCalls += 1;
        capturedTurns = msg.payload?.turns || [];
        env.win.__agPrismSuggesterResolve(msg.id, { ok: true, engine: 'ai', suggestion: 'Run the full test suite next' });
      } else {
        env.win.__agPrismSuggesterResolve(msg.id, { ok: true });
      }
    }, 5);
  };

  const ctx = vm.createContext(env.win);
  vm.runInContext(cdp.buildSuggesterExpression(), ctx);
  await new Promise((r) => setTimeout(r, 25));

  // Transition running -> completed with new nested assistant reply
  const cancelBtn = env.makeEl('button');
  cancelBtn.setAttribute('data-testid', 'input-cancel-button');
  env.footer.appendChild(cancelBtn);
  env.win.__agPrismSuggester.checkAgentStateTransition();

  earlyNodeWalks = 0;
  env.convView.appendChild(outerWrap);
  cancelBtn.remove();
  env.win.__agPrismSuggester.checkAgentStateTransition();
  await new Promise((r) => setTimeout(r, 850));

  // 1) Tail-scan pruning: early historical turns were NEVER traversed; nested outer wrapper did not duplicate inner text
  assert.equal(suggestCalls, 1);
  assert.equal(earlyNodeWalks, 0, 'Tail-scan must stop after 6 merged turns and never walk early historical turns');
  assert.equal(capturedTurns.length, 6, 'Exactly 6 latest turns extracted');
  assert.equal(
    capturedTurns[capturedTurns.length - 1].text.includes('Final nested assistant reply\n\nFinal nested assistant reply'),
    false,
    'Nested container pruning must not duplicate inner message text'
  );

  // 2) Overlay tagged as suggester-owned & takeRecords() drained after mounting overlay
  const overlay = env.doc.querySelector('[data-testid="prism-ghost-overlay"]');
  assert.ok(overlay, 'ghost overlay must mount');
  assert.equal(overlay.getAttribute('data-ag-prism-suggester-owned'), '1');
  const takeAfterMount = env.getTakeRecordsCalls();
  assert.ok(takeAfterMount >= 1, 'syncOverlayForActiveCascade must drain MutationObserver via takeRecords()');

  // 3) Steady-state fast path: re-syncing identical suggestion skips DOM rebuild & forced offsetHeight reflow
  const readsBefore = overlay._getOffsetHeightReads();
  const removesBefore = overlay._getRemoveChildCalls();
  const mo = env.getMo();
  mo.cb([
    { type: 'attributes', target: env.html, attributeName: 'data-ag-cs-lang' },
    { type: 'attributes', target: env.html, attributeName: 'data-ag-prism-lang' },
  ]);
  assert.equal(overlay._getOffsetHeightReads(), readsBefore, 'Steady-state sync must skip forced offsetHeight reflow');
  assert.equal(overlay._getRemoveChildCalls(), removesBefore, 'Steady-state sync must skip rebuilding overlay children');

  // 4) Hidden document defers mutation checks until visibilitychange restores visibility
  env.doc.hidden = true;
  mo.cb([{ type: 'childList', target: env.convView, addedNodes: [env.makeEl('div')], removedNodes: [] }]);
  env.doc.hidden = false;
  env.doc.dispatchEvent({ type: 'visibilitychange' });

  // 5) Clearing overlay via blocking UI drains takeRecords()
  const takeBeforeClear = env.getTakeRecordsCalls();
  env.html.setAttribute('data-ag-pp-open', '1');
  mo.cb([{ type: 'attributes', target: env.html, attributeName: 'data-ag-pp-open' }]);
  assert.equal(env.doc.querySelector('[data-testid="prism-ghost-overlay"]'), null);
  assert.ok(env.getTakeRecordsCalls() > takeBeforeClear, 'removeOverlayDom must drain MutationObserver via takeRecords()');

  env.win.__agPrismSuggester.destroy();
  assert.equal(mo.disconnected, true);
});
