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
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));

function createSettingsStageHarness() {
  let fakeNow = 1000;
  let canvasRectCalls = 0;
  const winListeners = new Map();
  const docListeners = new Map();
  const moInstances = [];
  const canvasBindOpts = [];

  const storageMap = new Map([['ag-prism:settings-open', '1']]);
  const localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  };

  function matchSingle(el, raw) {
    if (!el || el.nodeType !== 1) return false;
    let rem = raw.trim();
    if (!rem) return false;
    if (rem.startsWith('#')) return el.id === rem.slice(1);
    const tm = rem.match(/^[a-zA-Z0-9-]+/);
    if (tm) {
      if (el.tagName !== tm[0].toUpperCase()) return false;
      rem = rem.slice(tm[0].length);
    }
    for (const cm of rem.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!el.classList.contains(cm[1])) return false;
    }
    for (const am of rem.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
      if (!el.hasAttribute(am[1])) return false;
      if (am[2] !== undefined && el.getAttribute(am[1]) !== am[2]) return false;
    }
    return true;
  }

  function matchChain(el, selList) {
    return String(selList || '').split(',').some((raw) => {
      const parts = raw.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return false;
      let cur = el;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (!cur) return false;
        if (i === parts.length - 1) {
          if (!matchSingle(cur, parts[i])) return false;
          cur = cur.parentElement;
        } else {
          while (cur && !matchSingle(cur, parts[i])) cur = cur.parentElement;
          if (!cur) return false;
          cur = cur.parentElement;
        }
      }
      return true;
    });
  }

  const noopCtx2d = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, fillText() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, roundRect() {}, clip() {}, fill() {}, stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };

  function makeEl(tag, ownerDoc) {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const children = [];
    let text = '';
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      ownerDocument: ownerDoc,
      parentNode: null,
      parentElement: null,
      children,
      childNodes: children,
      hidden: false,
      disabled: false,
      value: '',
      width: tag === 'canvas' ? 640 : 0,
      height: tag === 'canvas' ? 360 : 0,
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
      get isConnected() {
        let cur = el;
        while (cur) { if (cur === ownerDoc.documentElement) return true; cur = cur.parentElement; }
        return false;
      },
      get firstChild() { return children[0] || null; },
      get textContent() { return children.length && !text ? children.map((c) => c.textContent).join('') : text; },
      set textContent(v) { children.length = 0; text = String(v ?? ''); },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'class') el.className = String(v);
        if (k === 'hidden') el.hidden = true;
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'hidden') el.hidden = false;
      },
      appendChild(c) {
        if (c.parentElement) c.parentElement.removeChild(c);
        c.parentElement = el;
        c.parentNode = el;
        children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentElement) c.parentElement.removeChild(c);
        c.parentElement = el;
        c.parentNode = el;
        const i = ref ? children.indexOf(ref) : -1;
        if (i >= 0) children.splice(i, 0, c);
        else children.push(c);
        return c;
      },
      removeChild(c) {
        const i = children.indexOf(c);
        if (i >= 0) children.splice(i, 1);
        c.parentElement = null;
        c.parentNode = null;
        return c;
      },
      remove() { if (el.parentElement) el.parentElement.removeChild(el); },
      closest(sel) {
        let cur = el;
        while (cur) { if (matchChain(cur, sel)) return cur; cur = cur.parentElement; }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children || []) {
            if (matchChain(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      addEventListener(type, fn, opts) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
        if (el.tagName === 'CANVAS') canvasBindOpts.push({ type, opts });
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatch(type, ev = {}) {
        for (const fn of [...(listeners.get(type) || [])]) {
          fn({ type, preventDefault() {}, stopPropagation() {}, ...ev });
        }
      },
      click() { el.dispatch('click', {}); },
      getBoundingClientRect() {
        if (el.tagName === 'CANVAS') canvasRectCalls += 1;
        return { left: 100, top: 80, width: 640, height: 360 };
      },
      getContext: (kind) => (el.tagName === 'CANVAS' && kind === '2d' ? noopCtx2d : null),
    };
    return el;
  }

  class SpyMO {
    constructor(cb) {
      this.cb = cb;
      this.observed = [];
      this.disconnected = false;
      moInstances.push(this);
    }
    observe(target, opts) { this.observed.push({ target, opts: { ...opts } }); }
    disconnect() { this.disconnected = true; }
  }

  const doc = {
    hidden: false,
    documentElement: null,
    head: null,
    body: null,
    defaultView: null,
    createElement: (t) => makeEl(t, doc),
    getElementById: (id) => doc.documentElement.querySelector(`#${id}`),
    querySelector: (s) => doc.documentElement.querySelector(s),
    querySelectorAll: (s) => doc.documentElement.querySelectorAll(s),
    addEventListener(t, fn) { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(fn); },
    removeEventListener(t, fn) { docListeners.get(t)?.delete(fn); },
  };
  doc.documentElement = makeEl('html', doc);
  doc.documentElement.setAttribute('data-ag-cs-theme', 'dark');
  doc.documentElement.setAttribute('data-ag-cs-motion', 'off');
  doc.head = makeEl('head', doc);
  doc.body = makeEl('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  // Build dialog -> panel -> Appearance heading + space-y-2 container, plus unrelated background chat container
  const dialog = makeEl('div', doc);
  dialog.setAttribute('role', 'dialog');
  const panel = makeEl('div', doc);
  panel.className = 'p-6';
  const h2 = makeEl('h2', doc);
  h2.textContent = 'Appearance';
  const hostSpace = makeEl('div', doc);
  hostSpace.className = 'space-y-2';
  panel.appendChild(h2);
  panel.appendChild(hostSpace);
  dialog.appendChild(panel);
  doc.body.appendChild(dialog);

  const chatStream = makeEl('div', doc);
  chatStream.setAttribute('data-testid', 'conversation-view');
  doc.body.appendChild(chatStream);

  const win = {
    document: doc,
    localStorage,
    devicePixelRatio: 1,
    performance: { now: () => fakeNow },
    MutationObserver: SpyMO,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    addEventListener(t, fn, opts) {
      if (!winListeners.has(t)) winListeners.set(t, []);
      winListeners.get(t).push({ fn, opts });
    },
    removeEventListener(t, fn) {
      const arr = winListeners.get(t);
      if (!arr) return;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].fn === fn) arr.splice(i, 1);
      }
    },
    dispatchWin(t, ev = {}) {
      for (const rec of [...(winListeners.get(t) || [])]) rec.fn(ev);
    },
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON, Error,
  };
  win.window = win;
  win.globalThis = win;
  doc.defaultView = win;

  const src = fs.readFileSync(path.join(ROOT, 'settings-panel.js'), 'utf8');
  vm.runInNewContext(src, win);

  return {
    api: win.__agPrismSettingsPanel,
    doc, win, dialog, panel, chatStream, moInstances, canvasBindOpts, winListeners,
    advanceTime: (ms) => { fakeNow += ms; },
    getCanvasRectCalls: () => canvasRectCalls,
  };
}

test('settings-panel caches Canvas rect for 250ms (invalidated on TTL/resize/click), uses passive pointer events, and observes ancestor spine without body subtree:true', () => {
  const h = createSettingsStageHarness();
  const state = h.api.getDefaultSettingsPatch();

  h.api.mountOrSyncSettingsSection({
    version: '1.0.8-beta.4',
    lazyFold: false,
    getLang: () => 'en',
    uiText: (l) => i18nLocales.getUiStrings(l),
    isZh: () => false,
    i18nCore,
    formatSettingsSummary: () => 'Obsidian',
    resolveSettingRowActiveValue: (k) => state[k],
    isSettingButtonMatch: (k, valJson, cur) => JSON.parse(valJson) === cur,
    saveSetting: (k, v) => { state[k] = v; },
    saveSettingsBatch: (patch) => { Object.assign(state, patch); },
    getThoughtTranslateMode: () => 'off',
    handledGroupClicks: new WeakSet(),
    runSettingsGroupGlide: () => {},
    runGuardedMut: (fn) => fn(),
  });

  const openBtn = h.doc.querySelector('[data-ag-mascot-stage-open="1"]');
  const stageView = h.doc.querySelector('[data-ag-mascot-stage-view="1"]');
  const canvas = stageView?.querySelector('canvas');
  assert.ok(openBtn && stageView && canvas, 'Casting stage controls and canvas must mount');

  // 1) Passive listeners bound on canvas pointermove & pointerleave
  const pmBind = h.canvasBindOpts.find((b) => b.type === 'pointermove');
  const plBind = h.canvasBindOpts.find((b) => b.type === 'pointerleave');
  assert.equal(pmBind?.opts?.passive, true, 'canvas pointermove must be registered with { passive: true }');
  assert.equal(plBind?.opts?.passive, true, 'canvas pointerleave must be registered with { passive: true }');

  // Open stage
  openBtn.click();
  assert.equal(stageView.hidden, false, 'Casting stage must open');

  // 2) Canvas rect 250ms cache: 20 rapid pointermoves within 200ms trigger strictly 1 getBoundingClientRect()
  const baseRects = h.getCanvasRectCalls();
  for (let i = 0; i < 20; i++) {
    h.advanceTime(10);
    canvas.dispatch('pointermove', { clientX: 140 + i * 15, clientY: 220 });
  }
  assert.equal(h.getCanvasRectCalls() - baseRects, 1, '20 pointermoves within 250ms must trigger strictly 1 getBoundingClientRect()');

  // Advancing past 250ms TTL refreshes rect once
  h.advanceTime(260);
  canvas.dispatch('pointermove', { clientX: 280, clientY: 220 });
  assert.equal(h.getCanvasRectCalls() - baseRects, 2, 'Rect cache must expire after 250ms TTL');

  // Window resize invalidates rect cache immediately
  const resizeListeners = h.winListeners.get('resize') || [];
  assert.equal(resizeListeners.length, 1, 'openStage must register passive window resize listener');
  assert.equal(resizeListeners[0]?.opts?.passive, true, 'window resize listener must be passive');
  h.win.dispatchWin('resize');
  canvas.dispatch('pointermove', { clientX: 310, clientY: 220 });
  assert.equal(h.getCanvasRectCalls() - baseRects, 3, 'Window resize must invalidate cached Canvas rect');

  // Canvas click invalidates rect cache before hit-testing
  canvas.dispatch('click', { clientX: 310, clientY: 220 });
  assert.equal(h.getCanvasRectCalls() - baseRects, 4, 'Canvas click must invalidate rect cache for accurate hit-test');

  // 3) Ancestor-spine detachMo: strictly NO subtree:true on doc.body or any ancestor; background chatStream never observed
  assert.ok(h.moInstances.length >= 2, 'Ancestor-spine detach observers must be created on openStage');
  const observedTargets = new Set();
  for (const mo of h.moInstances) {
    assert.equal(mo.disconnected, false);
    for (const rec of mo.observed) {
      assert.equal(rec.opts.childList, true, 'detachMo must observe direct childList');
      assert.notEqual(rec.opts.subtree, true, 'detachMo must NEVER use subtree:true (avoids background streaming callback storms)');
      observedTargets.add(rec.target);
    }
  }
  assert.equal(observedTargets.has(h.doc.body), true, 'Ancestor spine must include document.body');
  assert.equal(observedTargets.has(h.dialog), true, 'Ancestor spine must include enclosing [role="dialog"]');
  assert.equal(observedTargets.has(h.chatStream), false, 'Unrelated conversation-view must never be observed by detachMo');

  // 4) Removing enclosing dialog triggers body detachMo -> closes stage, disconnects all MOs, removes resize listener
  h.dialog.remove();
  assert.equal(stageView.isConnected, false);
  const bodyMo = h.moInstances.find((m) => m.observed.some((r) => r.target === h.doc.body));
  bodyMo.cb([{ type: 'childList', target: h.doc.body, removedNodes: [h.dialog] }]);
  assert.equal(stageView.hidden, true, 'Dialog unmount must automatically close casting stage');
  for (const mo of h.moInstances) {
    assert.equal(mo.disconnected, true, 'All ancestor-spine detachMo instances must disconnect on closeStage');
  }
  assert.equal((h.winListeners.get('resize') || []).length, 0, 'window resize listener must be removed on closeStage');
});
