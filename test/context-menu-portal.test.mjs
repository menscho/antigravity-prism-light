import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ctxMenuMod = require(path.join(ROOT, 'context-menu-btw.js'));
const uiRuntimeFactory = require(path.join(ROOT, 'ui-runtime.js'));
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

function createPortalDom() {
  const docListeners = [];
  const winListeners = [];
  const bodyDirectAppends = [];

  function matchesSingle(el, rawSel) {
    if (!el || el.nodeType !== 1) return false;
    const sel = rawSel.trim();
    if (!sel) return false;
    let rem = sel;
    const tagM = rem.match(/^[a-zA-Z0-9-]+/);
    if (tagM) {
      if (el.tagName.toLowerCase() !== tagM[0].toLowerCase()) return false;
      rem = rem.slice(tagM[0].length);
    }
    const idM = rem.match(/#([a-zA-Z0-9_-]+)/);
    if (idM) {
      if (el.id !== idM[1]) return false;
      rem = rem.replace(idM[0], '');
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

  function matchesAny(el, selList) {
    return String(selList || '')
      .split(',')
      .some((part) => {
        const s = part.trim();
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

  function makeEl(tag, init = {}) {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const children = [];
    let text = init.text || '';
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      parentElement: null,
      parentNode: null,
      children,
      childNodes: children,
      isConnected: false,
      value: '',
      _qsCalls: 0,
      style: {
        cssText: '',
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
      },
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
      get firstElementChild() { return children[0] || null; },
      get textContent() { return children.length && !text ? children.map((c) => c.textContent).join('') : text; },
      set textContent(v) { children.length = 0; text = String(v ?? ''); },
      setAttribute(k, v) {
        const sv = String(v);
        attrs.set(k, sv);
        if (k === 'class') this.className = sv;
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(ch) {
        if (ch.parentElement) ch.parentElement.removeChild(ch);
        ch.parentElement = el;
        ch.parentNode = el;
        children.push(ch);
        if (el === body) bodyDirectAppends.push(ch);
        const mark = (n, v) => { n.isConnected = v; for (const c of n.children) mark(c, v); };
        if (el.isConnected) mark(ch, true);
        return ch;
      },
      removeChild(ch) {
        const idx = children.indexOf(ch);
        if (idx >= 0) children.splice(idx, 1);
        ch.parentElement = null;
        ch.parentNode = null;
        const mark = (n) => { n.isConnected = false; for (const c of n.children) mark(c); };
        mark(ch);
        return ch;
      },
      remove() {
        if (el.parentElement) el.parentElement.removeChild(el);
        else el.isConnected = false;
      },
      contains(target) {
        let cur = target;
        while (cur) {
          if (cur === el) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (matchesAny(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (matchesAny(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      querySelector(sel) {
        el._qsCalls += 1;
        return el.querySelectorAll(sel)[0] || null;
      },
      getElementsByTagName(t) {
        const u = String(t).toUpperCase();
        const out = [];
        const walk = (n) => {
          for (const c of n.children) {
            if (c.tagName === u) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      click() {
        for (const fn of [...(listeners.get('click') || [])]) {
          fn({ type: 'click', target: el, preventDefault() {}, stopPropagation() {} });
        }
      },
      select() {},
      focus() {},
      getBoundingClientRect() { return { left: 20, top: 20, width: 240, height: 220 }; },
    };
    if (init.id) el.id = init.id;
    if (init.className) el.className = init.className;
    if (init.attrs) for (const [k, v] of Object.entries(init.attrs)) el.setAttribute(k, v);
    return el;
  }

  const html = makeEl('html', { attrs: { 'data-ag-cs-lang': 'zh-CN', 'data-ag-cs-motion': 'ultra' } });
  html.isConnected = true;
  const head = makeEl('head');
  const body = makeEl('body');
  html.appendChild(head);
  html.appendChild(body);

  let copyTextareaParentId = '';
  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    readyState: 'complete',
    title: 'Antigravity',
    hasFocus: () => true,
    createElement: (t) => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener: (t, fn, opts) => docListeners.push({ t, fn, opts }),
    removeEventListener: (t, fn) => {
      for (let i = docListeners.length - 1; i >= 0; i--) {
        if (docListeners[i].t === t && docListeners[i].fn === fn) docListeners.splice(i, 1);
      }
    },
    getSelection: () => ({ isCollapsed: true, toString: () => '' }),
    execCommand(cmd) {
      if (cmd === 'copy') {
        const ta = html.querySelector('textarea');
        copyTextareaParentId = ta?.parentElement?.id || '';
        return true;
      }
      return false;
    },
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    document: doc,
    navigator: { language: 'zh-CN' },
    location: { href: 'vscode-file://vscode-app/index.html', pathname: '/' },
    getSelection: doc.getSelection,
    addEventListener: (t, fn, opts) => winListeners.push({ t, fn, opts }),
    removeEventListener: (t, fn) => {
      for (let i = winListeners.length - 1; i >= 0; i--) {
        if (winListeners[i].t === t && winListeners[i].fn === fn) winListeners.splice(i, 1);
      }
    },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };

  return {
    html, head, body, doc, win, makeEl,
    docListeners, winListeners, bodyDirectAppends,
    getCopyTextareaParentId: () => copyTextareaParentId,
  };
}

test('context-menu-btw mounts menu/toast/copy-textarea in #ag-prism-overlay-portal, uses <div role="separator"> (0 <hr>), passive scroll, and cleans empty portal on destroy', async () => {
  const env = createPortalDom();
  const ctl = ctxMenuMod.createContextMenuController({ doc: env.doc, win: env.win, nav: env.win.navigator, stepDelayMs: 0 });

  // 1) Open menu in selection mode -> mounted inside #ag-prism-overlay-portal (only portal appended directly to body)
  const menu = ctl.openAt(180, 160, { selectedText: 'portal isolation test' });
  const portal = env.doc.getElementById('ag-prism-overlay-portal');
  assert.ok(portal, '#ag-prism-overlay-portal must be created lazily');
  assert.equal(portal.parentElement, env.body);
  assert.equal(portal.getAttribute('data-ag-owned'), '1');
  assert.equal(portal.getAttribute('translate'), 'no');
  assert.equal(portal.getAttribute('data-ag-no-i18n'), '1');
  assert.ok(portal.style.cssText.includes('contain:layout style'), 'portal must enforce contain:layout style');
  assert.ok(portal.style.cssText.includes('pointer-events:none'), 'portal must set pointer-events:none');
  assert.equal(menu.parentElement, portal, 'context menu must mount inside #ag-prism-overlay-portal, not directly under <body>');
  assert.equal(env.bodyDirectAppends.length, 1, '<body> must receive only the persistent portal node');

  // 2) Strictly 0 <hr> tags; separators must be <div role="separator"> to prevent .md-divider-spacing hr + * invalidation
  assert.equal(menu.querySelectorAll('hr').length, 0, 'context menu must render strictly 0 <hr> elements');
  const seps = menu.querySelectorAll('[role="separator"]');
  assert.equal(seps.length, 2, 'selection mode must render 2 <div role="separator"> dividers');
  for (const sep of seps) {
    assert.equal(sep.tagName, 'DIV', 'separator must be a <div> element');
  }

  // 3) Scroll listener registered as passive + capture
  const scrollRec = env.docListeners.find((l) => l.t === 'scroll');
  assert.ok(scrollRec && scrollRec.opts && scrollRec.opts.capture === true && scrollRec.opts.passive === true, 'scroll dismissal listener must use { capture: true, passive: true }');

  // 4) Copy fallback textarea & status toast mount inside #ag-prism-overlay-portal without appending to <body>
  menu.querySelector('[data-ctx-action="copy"]').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(env.getCopyTextareaParentId(), 'ag-prism-overlay-portal', 'fallback copy textarea must mount in #ag-prism-overlay-portal');
  const toast = env.doc.querySelector('.ag-cs-ctx-toast');
  assert.ok(toast && toast.parentElement === portal, 'toast must mount inside #ag-prism-overlay-portal');
  assert.equal(env.bodyDirectAppends.length, 1, 'toast and copy textarea must never append directly to <body>');

  // 5) Non-empty portal is preserved if another module owns a sibling overlay inside it
  const foreignOverlay = env.makeEl('div', { className: 'ag-omni-menu' });
  portal.appendChild(foreignOverlay);
  ctl.destroy();
  assert.ok(env.doc.getElementById('ag-prism-overlay-portal'), 'destroy() must not remove portal while sibling overlays are present');
  foreignOverlay.remove();

  // 6) Empty portal is removed cleanly on destroy()
  const ctl2 = ctxMenuMod.createContextMenuController({ doc: env.doc, win: env.win, nav: env.win.navigator, stepDelayMs: 0 });
  ctl2.openAt(120, 120, { selectedText: '' });
  assert.equal(env.doc.querySelectorAll('.ag-cs-ctx-menu hr').length, 0, 'plain mode must also have 0 <hr>');
  ctl2.destroy();
  assert.equal(env.doc.getElementById('ag-prism-overlay-portal'), null, 'destroy() must remove empty #ag-prism-overlay-portal with zero DOM leak');
});

test('ui-runtime mounts glide pill in #ag-prism-overlay-portal, prunes streaming prose subtree querySelectors via single probe, cleans portal on destroy, and style.css guards against C-class regressions', () => {
  const env = createPortalDom();
  const convView = env.makeEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  env.body.appendChild(convView);
  const dlg = env.makeEl('div', { attrs: { role: 'dialog' } });
  env.body.appendChild(dlg);
  env.bodyDirectAppends.length = 0;

  let rootMoCb = null;
  let capturedGlide = null;
  const sb = {
    document: env.doc,
    location: env.win.location,
    navigator: env.win.navigator,
    devicePixelRatio: 1,
    performance: { now: () => 1000 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe(target) { if (target === env.html || target === env.body) rootMoCb = this.cb; }
      disconnect() {}
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: env.win.addEventListener,
    removeEventListener: env.win.removeEventListener,
    __agPrismI18nCore: i18nCore,
    __agPrismI18nLocales: i18nLocales,
    __agCsLocales: i18nLocales,
    __agMotionEngine: { glideIndicator() {} },
    __agPrismSettingsPanel: {
      mountOrSyncSettingsSection(ctx) { capturedGlide = ctx.runSettingsGroupGlide; },
    },
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON, Proxy, Error,
  };
  sb.window = sb;
  sb.globalThis = sb;

  vm.runInNewContext(
    `(${uiRuntimeFactory.toString()})(${JSON.stringify({ ...cdp.DEFAULT_CONFIG, mascot: 'off', smoothCaret: false })}, { version: '1.0.8-beta.4', codeHash: 'portal-dom-test' });`,
    sb
  );
  assert.ok(rootMoCb, 'ui-runtime root MutationObserver must be active');
  assert.equal(typeof capturedGlide, 'function', 'ui-runtime must pass runSettingsGroupGlide to settings panel');

  // 0) Settings group glide pill mounts lazily inside #ag-prism-overlay-portal (not directly on <body>)
  const grp = env.makeEl('div');
  const b1 = env.makeEl('button');
  const b2 = env.makeEl('button');
  capturedGlide(grp, b1, b2, { left: 10, top: 10, width: 60, height: 24 }, { left: 80, top: 10, width: 60, height: 24 });
  const portal = env.doc.getElementById('ag-prism-overlay-portal');
  const pill = env.doc.querySelector('.ag-cs-pill-glide');
  assert.ok(portal && pill, 'runSettingsGroupGlide must create #ag-prism-overlay-portal and .ag-cs-pill-glide');
  assert.equal(pill.parentElement, portal, '.ag-cs-pill-glide must mount inside #ag-prism-overlay-portal');
  assert.equal(env.bodyDirectAppends.length, 1, 'only #ag-prism-overlay-portal is appended directly to <body>');

  // 1) Non-leaf prose block appended inside conversation-view must collapse 7+ subtree querySelectors into 1 fast probe
  const proseBlock = env.makeEl('p');
  const innerSpan = env.makeEl('span', { text: 'Streaming markdown token chunk' });
  proseBlock.appendChild(innerSpan);
  convView.appendChild(proseBlock);
  proseBlock._qsCalls = 0;
  rootMoCb([{ type: 'childList', target: convView, addedNodes: [proseBlock], removedNodes: [] }]);
  assert.ok(
    proseBlock._qsCalls <= 2,
    `Non-leaf prose block in conversation stream should use single merged probe (<=2 querySelector calls), got ${proseBlock._qsCalls}`
  );

  // 2) ui-runtime.destroy() must remove #ag-prism-overlay-portal cleanly
  sb.__agPrism.destroy();
  assert.equal(env.doc.getElementById('ag-prism-overlay-portal'), null, 'ui-runtime.destroy() must clean up #ag-prism-overlay-portal');

  // 3) style.css portal rules + separator styling + strict guard against C-class backdrop-filter/animation regressions
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(css.includes('#ag-prism-overlay-portal{position:fixed;inset:0;pointer-events:none;z-index:9990;contain:layout style}'));
  assert.ok(css.includes('&>:is(hr,[role="separator"])'));
  assert.ok(css.includes('pointer-events:auto;contain:layout style;'));
  assert.equal(/data-ag-scrolling="1"[^}]*backdrop-filter\s*:\s*none/.test(css), false, 'style.css must NEVER strip backdrop-filter on data-ag-scrolling="1"');
  assert.equal(/data-ag-pp-open="1"[^}]*backdrop-filter\s*:\s*none/.test(css), false, 'style.css must NEVER strip backdrop-filter on data-ag-pp-open="1"');
  assert.equal(/data-ag-cs-resizing="1"[^}]*backdrop-filter\s*:\s*none/.test(css), false, 'style.css must NEVER strip backdrop-filter on data-ag-cs-resizing="1"');
});
