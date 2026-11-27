import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const omniMod = require(path.join(ROOT, 'vendor', 'omni-viewer', 'omni-client.js'));

function createOmniPortalHarness() {
  const listeners = new Map();
  let caretCalls = 0;
  let caretHit = null;
  let copyTaParentId = '';
  const bodyDirectAppends = [];

  class FakeHighlight {
    constructor() { this._set = new Set(); }
    add(r) { this._set.add(r); }
    delete(r) { this._set.delete(r); }
    clear() { this._set.clear(); }
    get size() { return this._set.size; }
  }

  class FakeRange {
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; }
    getClientRects() { return [{ left: 0, top: 0, right: 400, bottom: 40 }]; }
  }

  function matchSingle(el, raw) {
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
        const parts = s.split(/\s+/).filter(Boolean);
        if (!matchSingle(el, parts[parts.length - 1])) return false;
        let cur = el.parentElement;
        for (let i = parts.length - 2; i >= 0; i--) {
          while (cur && !matchSingle(cur, parts[i])) cur = cur.parentElement;
          if (!cur) return false;
          cur = cur.parentElement;
        }
        return true;
      }
      return matchSingle(el, s);
    });
  }

  function makeText(val) {
    return {
      nodeType: 3,
      nodeValue: String(val),
      textContent: String(val),
      parentNode: null,
      parentElement: null,
      isConnected: false,
      childNodes: [],
    };
  }

  function makeEl(tag) {
    const attrs = new Map();
    const classes = new Set();
    const elListeners = new Map();
    const childNodes = [];
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      parentNode: null,
      parentElement: null,
      childNodes,
      get children() { return childNodes.filter((n) => n.nodeType === 1); },
      get firstChild() { return childNodes[0] || null; },
      isConnected: false,
      value: '',
      style: { cssText: '', setProperty(k, v) { this[k] = String(v); }, removeProperty(k) { delete this[k]; } },
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
        if (el === body) bodyDirectAppends.push(ch);
        const mark = (n, v) => { n.isConnected = v; for (const c of n.childNodes || []) mark(c, v); };
        if (el.isConnected) mark(ch, true);
        return ch;
      },
      removeChild(ch) {
        const i = childNodes.indexOf(ch);
        if (i >= 0) childNodes.splice(i, 1);
        ch.parentNode = null;
        ch.parentElement = null;
        const mark = (n) => { n.isConnected = false; for (const c of n.childNodes || []) mark(c); };
        mark(ch);
        return ch;
      },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      matches: (s) => matchSel(el, s),
      closest(s) {
        let cur = el;
        while (cur) {
          if (cur.nodeType === 1 && matchSel(cur, s)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelectorAll(s) {
        const out = [];
        const walk = (n) => {
          for (const c of n.childNodes || []) {
            if (c.nodeType === 1) {
              if (matchSel(c, s)) out.push(c);
              walk(c);
            }
          }
        };
        walk(el);
        return out;
      },
      querySelector(s) { return el.querySelectorAll(s)[0] || null; },
      addEventListener(t, fn) {
        if (!elListeners.has(t)) elListeners.set(t, []);
        elListeners.get(t).push(fn);
      },
      removeEventListener(t, fn) {
        const arr = elListeners.get(t);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      click() {
        for (const fn of [...(elListeners.get('click') || [])]) {
          fn({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} });
        }
      },
      select() {},
      getBoundingClientRect() { return { left: 10, top: 10, width: 220, height: 180 }; },
    };
    return el;
  }

  const html = makeEl('html');
  html.isConnected = true;
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  const doc = {
    documentElement: html,
    head,
    body,
    title: 'Antigravity',
    createElement: makeEl,
    createTextNode: makeText,
    createRange: () => new FakeRange(),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    createTreeWalker(root) {
      const list = [];
      const walk = (n) => {
        for (const c of n.childNodes || []) {
          if (c.nodeType === 3) list.push(c);
          else walk(c);
        }
      };
      walk(root);
      let idx = -1;
      return { nextNode: () => (++idx < list.length ? list[idx] : null) };
    },
    caretRangeFromPoint() {
      caretCalls += 1;
      return caretHit;
    },
    execCommand(cmd) {
      if (cmd === 'copy') {
        const ta = html.querySelector('textarea');
        copyTaParentId = ta?.parentElement?.id || '';
        return true;
      }
      return false;
    },
    addEventListener(t, fn) {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push(fn);
    },
    removeEventListener(t, fn) {
      const arr = listeners.get(t);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch(t, ev) {
      for (const fn of [...(listeners.get(t) || [])]) fn(ev);
    },
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    document: doc,
    CSS: { highlights: new Map() },
    Highlight: FakeHighlight,
    NodeFilter: { SHOW_TEXT: 4 },
    getSelection: () => ({ toString: () => '' }),
    addEventListener() {},
    removeEventListener() {},
  };

  return {
    doc, win, body, makeEl, makeText, bodyDirectAppends,
    setCaretHit: (node, offset) => { caretHit = { startContainer: node, startOffset: offset }; },
    getCaretCalls: () => caretCalls,
    getCopyTaParentId: () => copyTaParentId,
  };
}

test('omni-client guards caretRangeFromPoint on non-highlighted DOM, mounts menu & copy textarea in #ag-prism-overlay-portal, and cleans empty portal on destroy', async () => {
  const env = createOmniPortalHarness();
  const resp = env.makeEl('div');
  resp.setAttribute('data-testid', 'planner-response-text');

  const plainPara = env.makeEl('p');
  plainPara.textContent = 'Ordinary prose paragraph without any links or paths';

  const hlPara = env.makeEl('p');
  const hlText = env.makeText('Inspect https://docs.example.com/guide and src/app/index.ts#L10');
  hlPara.appendChild(hlText);

  resp.appendChild(plainPara);
  resp.appendChild(hlPara);
  env.body.appendChild(resp);
  env.bodyDirectAppends.length = 0;

  const client = omniMod.createOmniClient({ window: env.win, document: env.doc });
  client.sync({ omniModule: 'on', linkTarget: 'builtin' }, { baseUrl: 'http://127.0.0.1:47000', token: 'tok_portal' });

  // 1) Left-click & right-click on non-highlighted paragraph -> strictly 0 caretRangeFromPoint calls
  env.setCaretHit(hlText, 12);
  env.doc.dispatch('click', { target: plainPara, button: 0, clientX: 50, clientY: 20, preventDefault() {}, stopPropagation() {} });
  env.doc.dispatch('contextmenu', { target: plainPara, clientX: 50, clientY: 20, preventDefault() {}, stopPropagation() {} });
  assert.equal(env.getCaretCalls(), 0, 'caretRangeFromPoint must NOT be invoked on non-highlighted elements');

  // 2) Right-click on highlighted paragraph -> invokes caretRangeFromPoint on demand & mounts menu in #ag-prism-overlay-portal
  env.setCaretHit(hlText, 12);
  let prevented = false;
  env.doc.dispatch('contextmenu', {
    target: hlPara,
    clientX: 120,
    clientY: 20,
    preventDefault() { prevented = true; },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  assert.equal(env.getCaretCalls(), 1, 'caretRangeFromPoint must run once on highlighted parent contextmenu');

  const portal = env.doc.getElementById('ag-prism-overlay-portal');
  const menu = env.doc.querySelector('[data-testid="ag-omni-context-menu"]');
  assert.ok(portal, '#ag-prism-overlay-portal must be created');
  assert.equal(portal.getAttribute('data-ag-owned'), '1');
  assert.ok(portal.style.cssText.includes('contain:layout style'));
  assert.ok(menu && menu.parentElement === portal, 'omni context menu must mount inside #ag-prism-overlay-portal');
  assert.equal(menu.style.pointerEvents, 'auto', 'omni context menu must restore pointer-events:auto inside portal');
  assert.equal(menu.style.contain, 'layout style', 'omni context menu must apply contain:layout style');
  assert.equal(env.bodyDirectAppends.length, 1, 'only the portal itself is appended directly to <body>');

  // 3) Copy action fallback textarea mounts inside portal
  const copyBtn = menu.querySelector('[data-omni-action="copy-link"]');
  assert.ok(copyBtn, 'copy-link menu action must exist');
  copyBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(env.getCopyTaParentId(), 'ag-prism-overlay-portal', 'omni copy fallback textarea must mount in #ag-prism-overlay-portal');

  // 4) destroy() removes empty portal cleanly
  client.destroy();
  assert.equal(env.doc.getElementById('ag-prism-overlay-portal'), null, 'omni destroy() must remove empty #ag-prism-overlay-portal');
});
