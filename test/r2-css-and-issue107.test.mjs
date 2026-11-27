// R2 CSS 极致瘦身、分片按需 adoptedStyleSheets、Issue #107 修复、@property 零级联与零回流回归测试
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const cssFlatten = require(path.join(ROOT, 'src', 'compiler', 'css-flatten.cjs'));
const cssPack = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));
const wallpaperClientMod = require(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-client.js'));
const homeStudioMod = require(path.join(ROOT, 'home-studio-panel.js'));
const usageCoreMod = require(path.join(ROOT, 'usage-core.js'));
const effortSliderMod = require(path.join(ROOT, 'vendor', 'effort-slider', 'upstream-client.js'));

function makeMiniEl(tag, opts = {}) {
  const attrs = new Map(Object.entries(opts.attrs || {}));
  const styleMap = new Map();
  const classes = new Set((opts.className || '').split(/\s+/).filter(Boolean));
  const listeners = new Map();
  const children = [];
  let _text = opts.text || '';
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: opts.id || '',
    parentNode: null,
    parentElement: null,
    children,
    childNodes: children,
    hidden: false,
    isConnected: true,
    _popoverOpen: false,
    _showPopoverCalls: 0,
    _hidePopoverCalls: 0,
    _rectReads: 0,
    _layoutReads: 0,
    style: {
      display: '',
      transform: '',
      left: '',
      top: '',
      setProperty(k, v) { styleMap.set(k, String(v)); this[k] = String(v); },
      getPropertyValue(k) { return styleMap.get(k) || ''; },
      removeProperty(k) { styleMap.delete(k); delete this[k]; },
    },
    classList: {
      add(...cs) { cs.forEach((c) => c && classes.add(c)); attrs.set('class', [...classes].join(' ')); },
      remove(...cs) { cs.forEach((c) => classes.delete(c)); attrs.set('class', [...classes].join(' ')); },
      contains(c) { return classes.has(c); },
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    get firstChild() { return children[0] || null; },
    get lastElementChild() { return children[children.length - 1] || null; },
    get childElementCount() { return children.length; },
    get nextSibling() {
      if (!this.parentElement) return null;
      const idx = this.parentElement.children.indexOf(this);
      return idx >= 0 ? this.parentElement.children[idx + 1] || null : null;
    },
    get textContent() { return children.length && !_text ? children.map((c) => c.textContent).join('') : _text; },
    set textContent(v) { children.length = 0; _text = String(v ?? ''); },
    get clientWidth() { el._layoutReads++; return opts.clientWidth ?? 480; },
    get clientHeight() { el._layoutReads++; return opts.clientHeight ?? 96; },
    get offsetLeft() { el._layoutReads++; return opts.offsetLeft ?? 40; },
    get offsetTop() { el._layoutReads++; return opts.offsetTop ?? 20; },
    get offsetWidth() { el._layoutReads++; return opts.offsetWidth ?? 12; },
    get offsetHeight() { el._layoutReads++; return opts.offsetHeight ?? 12; },
    getBoundingClientRect() { el._rectReads++; return opts.rect || { left: 100, top: 200, right: 240, bottom: 232, width: 140, height: 32 }; },
    showPopover() { el._popoverOpen = true; el._showPopoverCalls++; },
    hidePopover() { el._popoverOpen = false; el._hidePopoverCalls++; },
    setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'id') el.id = String(v); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    removeAttribute(k) { attrs.delete(k); },
    appendChild(c) {
      if (c.parentElement) c.parentElement.removeChild(c);
      c.parentElement = el; c.parentNode = el; children.push(c); return c;
    },
    insertBefore(c, ref) {
      if (c.parentElement) c.parentElement.removeChild(c);
      c.parentElement = el; c.parentNode = el;
      const idx = ref ? children.indexOf(ref) : -1;
      if (idx >= 0) children.splice(idx, 0, c); else children.push(c);
      return c;
    },
    removeChild(c) {
      const idx = children.indexOf(c);
      if (idx >= 0) children.splice(idx, 1);
      c.parentElement = null; c.parentNode = null; return c;
    },
    remove() { if (el.parentElement) el.parentElement.removeChild(el); },
    replaceChildren(...nodes) { children.length = 0; nodes.forEach((n) => el.appendChild(n)); },
    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); },
    removeEventListener(t, fn) { const a = listeners.get(t); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    dispatch(t, extra = {}) { for (const fn of [...(listeners.get(t) || [])]) fn({ type: t, target: el, stopPropagation() {}, preventDefault() {}, ...extra }); },
    matches(sel) {
      if (sel === ':popover-open') return el._popoverOpen;
      return String(sel).split(',').some((s) => {
        const t = s.trim();
        if (!t) return false;
        if (t.startsWith('#')) return el.id === t.slice(1);
        if (t.startsWith('.')) return el.classList.contains(t.slice(1));
        const am = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(t);
        if (am) return am[2] === undefined ? el.hasAttribute(am[1]) : el.getAttribute(am[1]) === am[2];
        const tagAttr = /^([a-z]+)\[([^=\]]+)="([^"]*)"\]$/i.exec(t);
        if (tagAttr) return el.tagName === tagAttr[1].toUpperCase() && el.getAttribute(tagAttr[2]) === tagAttr[3];
        return el.tagName === t.toUpperCase();
      });
    },
    closest(sel) { let c = el; while (c) { if (c.matches(sel)) return c; c = c.parentElement; } return null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
      walk(el);
      return out;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
  };
  return el;
}

test('1. Issue #107: style.css strips dark/light sharp box border/outline/box-shadow on [data-testid="agent-input-box"] and #antigravity.agentSidePanelInputBox', () => {
  const rawCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.equal(/:has\(/.test(rawCss), false, 'style.css must contain 0 :has()');
  assert.equal(/[^\x00-\x7F]/.test(rawCss), false, 'style.css must stay 100% ASCII');

  const composerIdx = rawCss.indexOf('html[data-ag-cs-style][data-ag-cs-composer="on"]{');
  assert.ok(composerIdx > 0, 'composer block must exist');
  const composerSlice = rawCss.slice(composerIdx, composerIdx + 1200);

  assert.ok(
    composerSlice.includes('& [data-testid="agent-input-box"]{background:transparent!important;border:0!important;outline:none!important;box-shadow:none!important;&:is(:focus,:focus-within,:focus-visible){border:0!important;outline:none!important;box-shadow:none!important}}'),
    'Outer [data-testid="agent-input-box"] and its focus states must clear sharp border/outline/box-shadow'
  );
  assert.ok(
    composerSlice.includes('& #antigravity\\.agentSidePanelInputBox{\nbackground:transparent!important;border:0!important;outline:none!important;box-shadow:none!important;'),
    '#antigravity.agentSidePanelInputBox must declare outline:none!important'
  );
  assert.ok(
    composerSlice.includes('&:is(:focus,:focus-within,:focus-visible){border:0!important;outline:none!important;box-shadow:none!important}'),
    '#antigravity.agentSidePanelInputBox focus states must clear border/outline/box-shadow'
  );
  // Inner .surface-composer-card retains rounded prism border & :focus-within glow
  assert.ok(rawCss.includes('& .surface-composer-card{') && rawCss.includes('&:focus-within{border-color:var(--ag-prism-b38) !important;'));
  // Redundant >body:is(.theme-light,.light-theme,.light) aliases purged from style.css
  assert.equal(rawCss.includes('>body:is(.theme-light,.light-theme,.light)'), false, 'style.css must drop redundant >body:is(.theme-light,...) aliases');
});

test('2. css-flatten.cjs + css-pack.cjs: eliminates +126.8 KB cartesian bloat, splits buckets cleanly, dark-chat active CSS < 180 KB, Ch1 < 390 KB', () => {
  const rawCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const minRaw = cssPack.minifyCss(rawCss);
  const flatCompact = cssPack.minifyCss(cssFlatten.flattenNestedCss(minRaw));
  const flatExpanded = cssPack.minifyCss(cssFlatten.flattenNestedCss(minRaw, { expandTopLevelIs: true }));

  const compactBytes = Buffer.byteLength(flatCompact, 'utf8');
  const expandedBytes = Buffer.byteLength(flatExpanded, 'utf8');
  assert.ok(compactBytes < expandedBytes - 40000, `Default flatten (${compactBytes} B) must save > 40 KB over expandTopLevelIs (${expandedBytes} B)`);
  assert.equal((flatCompact.match(/(?<!["'=\w])&(?![\w])/g) || []).length, 0, 'Flattened CSS must have 0 residual & nesting');

  const buckets = cssPack.splitCssIntoBuckets(flatCompact);
  for (const name of ['core', 'themeLight', 'viewHome', 'viewSidebar', 'viewSettings', 'paletteWarm', 'paletteHost', 'motionSubtle', 'motionFull']) {
    assert.ok(typeof buckets[name] === 'string' && buckets[name].length > 0, `Bucket ${name} must be non-empty`);
  }

  // Dark chat active rules (core + viewSidebar + motionFull) MUST stay strictly < 180 KB
  const darkChatActiveBytes = ['core', 'viewSidebar', 'motionFull'].reduce(
    (sum, k) => sum + Buffer.byteLength(buckets[k], 'utf8'),
    0
  );
  assert.ok(
    darkChatActiveBytes < 180 * 1024,
    `Active dark-chat CSS (${(darkChatActiveBytes / 1024).toFixed(2)} KB) must stay strictly < 180 KB`
  );

  // Default packCssJsExpr outputs single-block flat CSS (0 /*@ag: markers, beats legacy bucketed LZSS, 0 &, Ch1 < 390,000 B)
  const packedExpr = cssPack.packCssJsExpr(minRaw);
  const bucketedExpr = cssPack.packCssJsExpr(minRaw, { bucketize: true });
  const unpacked = vm.runInNewContext(packedExpr);
  assert.equal(typeof unpacked, 'string');
  assert.equal(unpacked, flatCompact, 'Default packCssJsExpr must preserve single-block flattened CSS verbatim');
  assert.equal(unpacked.includes('/*@ag:'), false, 'Default single-block packCssJsExpr must contain 0 /*@ag: bucket markers');
  assert.ok(unpacked.includes('[data-ag-cs-theme="light"]') && unpacked.includes('div[role="dialog"]'), 'Single-block CSS must include light theme and deep dialog rules');
  assert.ok(
    Buffer.byteLength(packedExpr, 'utf8') < Buffer.byteLength(bucketedExpr, 'utf8'),
    `Single-block packed CSS (${Buffer.byteLength(packedExpr, 'utf8')} B) must save bytes over bucketed CSS (${Buffer.byteLength(bucketedExpr, 'utf8')} B)`
  );
  assert.equal((unpacked.match(/(?<!["'=\w])&(?![\w])/g) || []).length, 0);

  const ch1Bytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }, { noDiskCache: true }), 'utf8');
  assert.ok(ch1Bytes < 390000, `Ch1(auto) ${ch1Bytes} B must stay < 390,000 B`);
});

test('3. window.__agPrismCssMgr: single-block adoptedStyleSheets mount, 0 extra MOs, host sheet preservation, idempotent self-heal, fallback <style>, and lightweight inject return', () => {
  class MockCSSStyleSheet {
    constructor() { this.text = ''; this.replaceCalls = 0; }
    replaceSync(t) { this.text = String(t); this.replaceCalls++; }
  }

  const hostSheet = new MockCSSStyleSheet();
  hostSheet.replaceSync('/* host-owned-sheet */');

  const html = makeMiniEl('html');
  const head = makeMiniEl('head');
  const body = makeMiniEl('body', { className: 'theme-dark' });
  html.appendChild(head);
  html.appendChild(body);
  const conv = makeMiniEl('div', { attrs: { 'data-testid': 'conversation-view' } });
  body.appendChild(conv);

  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    readyState: 'complete',
    adoptedStyleSheets: [hostSheet],
    createElement: (t) => makeMiniEl(t),
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };

  const moObservedTargets = [];
  const sandbox = {
    document: doc,
    CSSStyleSheet: MockCSSStyleSheet,
    navigator: { language: 'zh-CN' },
    location: { pathname: '/', href: 'vscode-file://vscode-app/index.html' },
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class {
      observe(target, opts) { moObservedTargets.push({ target, opts }); }
      disconnect() {}
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    performance: { now: () => 1000 },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl, Symbol,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const res = vm.runInNewContext(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, palette: 'obsidian', motionLevel: 'standard' }, { noDiskCache: true }), sandbox);
  assert.equal(res.status, 'ok');
  assert.equal(typeof res.codeHash, 'string');
  assert.equal('state' in res, false, 'Inject wrapper must omit bloated state payload serialization');

  const mgr = sandbox.window.__agPrismCssMgr;
  assert.ok(mgr, '__agPrismCssMgr must be exposed on window');
  assert.equal(mgr.mode, 'adopted', 'Must use adoptedStyleSheets when CSSStyleSheet is available');
  assert.equal(mgr.singlePack, true, 'CssMgr must run in single-pack flat CSS mode');
  assert.deepEqual(Array.from(mgr.activeKeys), ['all']);
  assert.equal(doc.adoptedStyleSheets.length, 2, 'Must mount strictly 1 single-pack Prism sheet alongside hostSheet');
  assert.equal(doc.adoptedStyleSheets[0], hostSheet, 'Host-owned sheet must stay intact');
  const prismSheet = doc.adoptedStyleSheets[1];
  assert.equal(prismSheet.replaceCalls, 1, 'Single-pack sheet must replaceSync exactly once');
  assert.equal(prismSheet.text.includes('/*@ag:'), false, 'Single-pack sheet must contain 0 bucket markers');
  assert.ok(
    prismSheet.text.includes('[data-ag-cs-theme="light"]') &&
      prismSheet.text.includes('div[role="dialog"]') &&
      prismSheet.text.includes('#ag-cs-settings-sec') &&
      prismSheet.text.includes('.agy-home'),
    'Single-pack sheet must always cover light theme, deep nested dialogs, settings & home without fragile MO activation'
  );
  assert.equal(mgr.activeBytes, prismSheet.text.length);
  assert.equal(
    moObservedTargets.some((m) => m.target === body && m.opts && m.opts.childList === true && !m.opts.subtree),
    false,
    'CssMgr must no longer attach fragile D.body childList-only MutationObserver'
  );

  // Sentinel <style id="ag-prism-css" data-ag-cs-adopted="1"> stays empty for cross-module presence checks with 0 parsed rules
  const sentinel = doc.getElementById('ag-prism-css');
  assert.ok(sentinel && sentinel.getAttribute('data-ag-cs-adopted') === '1' && sentinel.textContent === '');

  // Repeated sync() is idempotent (0 extra replaceSync calls) and self-heals if host resets adoptedStyleSheets
  mgr.sync({ palette: 'warm', motionLevel: 'subtle' });
  assert.equal(prismSheet.replaceCalls, 1, 'Idempotent sync() must not re-parse CSS');
  assert.deepEqual(Array.from(doc.adoptedStyleSheets), [hostSheet, prismSheet]);
  doc.adoptedStyleSheets = [hostSheet];
  mgr.sync();
  assert.deepEqual(Array.from(doc.adoptedStyleSheets), [hostSheet, prismSheet], 'sync() must re-attach single Prism sheet if evicted');

  // destroy() via __agPrism.destroy() hook removes ONLY Prism-owned sheet and never touches hostSheet
  sandbox.window.__agPrism.destroy();
  assert.deepEqual(Array.from(doc.adoptedStyleSheets), [hostSheet], 'destroy() must clean Prism sheet without removing host adoptedStyleSheets');
  assert.equal(doc.getElementById('ag-prism-css'), null);
  assert.equal(mgr._disposed, true);

  // Fallback <style> mode (no CSSStyleSheet): mounts single-block flat CSS directly into #ag-prism-css without data-ag-cs-adopted
  const fbHtml = makeMiniEl('html');
  const fbHead = makeMiniEl('head');
  const fbBody = makeMiniEl('body', { className: 'theme-dark' });
  fbHtml.appendChild(fbHead);
  fbHtml.appendChild(fbBody);
  const fbDoc = {
    documentElement: fbHtml,
    head: fbHead,
    body: fbBody,
    hidden: false,
    readyState: 'complete',
    createElement: (t) => makeMiniEl(t),
    getElementById: (id) => fbHtml.querySelector('#' + id),
    querySelector: (s) => fbHtml.querySelector(s),
    querySelectorAll: (s) => fbHtml.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };
  const fbSandbox = {
    document: fbDoc,
    navigator: { language: 'zh-CN' },
    location: { pathname: '/', href: 'vscode-file://vscode-app/index.html' },
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    performance: { now: () => 1000 },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl, Symbol,
  };
  fbSandbox.window = fbSandbox;
  fbSandbox.globalThis = fbSandbox;
  const fbRes = vm.runInNewContext(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG }, { noDiskCache: true }), fbSandbox);
  assert.equal(fbRes.status, 'ok');
  const fbMgr = fbSandbox.window.__agPrismCssMgr;
  assert.equal(fbMgr.mode, 'style');
  assert.equal(fbMgr.singlePack, true);
  assert.deepEqual(Array.from(fbMgr.activeKeys), ['all']);
  const fbStyle = fbDoc.getElementById('ag-prism-css');
  assert.ok(fbStyle && fbStyle.getAttribute('data-ag-cs-adopted') === null);
  assert.equal(fbStyle.textContent.includes('/*@ag:'), false);
  assert.ok(fbStyle.textContent.includes('div[role="dialog"]') && fbStyle.textContent.includes('[data-ag-cs-theme="light"]'));
  fbSandbox.window.__agPrism.destroy();
  assert.equal(fbDoc.getElementById('ag-prism-css'), null);
});

test('4. @property (inherits:false) & variable sinking: wallpaper-client, upstream-client, and style.css pseudo-element safety redline', () => {
  // 4a) style.css registers safe local tokens as inherits:false and NEVER sets inherits:false on pseudo-element vars (unused --_fa @property purged)
  const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.equal(/@property\s+--_fa\b/.test(styleCss), false, 'style.css must remove uninterpolated @property --_fa after GPU transform/opacity migration');
  for (const safeVar of ['--ag-origin-x', '--ag-origin-y', '--ag-row-i']) {
    assert.ok(
      new RegExp(`@property\\s+${safeVar}\\s*\\{[^}]*inherits\\s*:\\s*false`).test(styleCss),
      `style.css must register @property ${safeVar} with inherits:false`
    );
  }
  for (const forbidden of ['--ag-px', '--ag-py', '--orch-px', '--orch-py', '--knob-px', '--knob-py', '--ag-lift-x', '--ag-lift-y']) {
    assert.equal(
      new RegExp(`@property\\s+${forbidden}\\b`).test(styleCss),
      false,
      `REDLINE VIOLATION: pseudo-element var ${forbidden} must NEVER be registered with @property inherits:false`
    );
  }

  // 4b) effort-slider upstream-client removes uninterpolated @property declarations (--ces-energy/--ces-fill/--ces-star-opacity) & keeps --ces-glow-color inherited
  const effortSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'effort-slider', 'upstream-client.js'), 'utf8');
  for (const v of ['--ces-energy', '--ces-fill', '--ces-star-opacity']) {
    assert.equal(
      new RegExp(`@property\\s+${v}\\b`).test(effortSrc),
      false,
      `upstream-client must remove redundant uninterpolated @property ${v}`
    );
  }
  assert.equal(/@property\s+--ces-glow-color\b/.test(effortSrc), false, '--ces-glow-color must keep inheritance for ::before/::after');
  assert.ok(effortSliderMod && typeof effortSliderMod.mountCodexEffortSlider === 'function');

  // 4c) wallpaper-client sinks 6 --ag-prism-wp-* vars onto #ag-prism-wallpaper-root (0 writes to html.style) + adoptedStyleSheets
  const wpCss = wallpaperClientMod.WALLPAPER_CSS;
  for (const v of ['--ag-prism-wp-opacity', '--ag-prism-wp-blur', '--ag-prism-wp-filter', '--ag-prism-wp-blur-pad', '--ag-prism-wp-dim', '--ag-prism-wp-fit']) {
    assert.ok(new RegExp(`@property\\s+${v}\\{[^}]*inherits:false`).test(wpCss), `WALLPAPER_CSS must declare @property ${v} inherits:false`);
  }

  class MockSheet { constructor() { this.text = ''; } replaceSync(t) { this.text = String(t); } }
  const hostSheet = new MockSheet();
  const html = makeMiniEl('html');
  const head = makeMiniEl('head');
  const body = makeMiniEl('body');
  html.appendChild(head);
  html.appendChild(body);
  const doc = {
    documentElement: html, head, body, hidden: false,
    adoptedStyleSheets: [hostSheet],
    createElement: (t) => makeMiniEl(t),
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {}, removeEventListener() {},
  };
  const win = { document: doc, CSSStyleSheet: MockSheet, addEventListener() {}, removeEventListener() {} };
  const wp = wallpaperClientMod.createWallpaperClient({ window: win, document: doc });
  wp.applyConfig({
    enabled: true, mediaPath: 'C:/wp.png', mediaType: 'image',
    mediaUrl: 'http://127.0.0.1:45555/wp/1', opacity: 0.42, blurPx: 6, dimOverlay: 0.35, fit: 'contain', rev: 1,
  });

  assert.equal(doc.adoptedStyleSheets.length, 2, 'Wallpaper client must mount its CSS via adoptedStyleSheets when supported');
  assert.equal(doc.adoptedStyleSheets[0], hostSheet);
  const wpRoot = doc.getElementById('ag-prism-wallpaper-root');
  assert.ok(wpRoot);
  assert.equal(html.style.getPropertyValue('--ag-prism-wp-opacity'), '', 'html.style must NEVER be written with --ag-prism-wp-*');
  assert.equal(html.style.getPropertyValue('--ag-prism-wp-filter'), '', 'html.style must NEVER be written with --ag-prism-wp-filter');
  assert.equal(wpRoot.style.getPropertyValue('--ag-prism-wp-opacity'), '0.42');
  assert.equal(wpRoot.style.getPropertyValue('--ag-prism-wp-filter'), 'blur(6px)');
  assert.equal(wpRoot.style.getPropertyValue('--ag-prism-wp-dim'), '0.35');
  assert.equal(wpRoot.style.getPropertyValue('--ag-prism-wp-fit'), 'contain');

  wp.destroy();
  assert.deepEqual(doc.adoptedStyleSheets, [hostSheet], 'Wallpaper destroy() must remove only its own adoptedStyleSheet');
});

test('5. Chrome 152 native CSS Anchor Positioning (0 Forced Reflow), scroll-driven top fade, thought containment & GPU blur/will-change purge', () => {
  // 5a) home-studio-panel heatmap tooltip uses popover + anchor-name with 0 layout reads when CSS.supports('anchor-name', '--a')
  const html = makeMiniEl('html');
  const head = makeMiniEl('head');
  const body = makeMiniEl('body');
  const home = makeMiniEl('div', { className: 'agy-home' });
  const greeting = makeMiniEl('div', { attrs: { 'data-testid': 'home-greeting' } });
  home.appendChild(greeting);
  body.appendChild(home);
  html.appendChild(head);
  html.appendChild(body);
  const doc = {
    documentElement: html, head, body,
    createElement: (t) => makeMiniEl(t),
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
  };
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevCss = globalThis.CSS;
  const prevRaf = globalThis.requestAnimationFrame;
  const win = {
    document: doc,
    CSS: { supports: (p, v) => p === 'anchor-name' && Boolean(v) },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame() {},
  };
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.CSS = win.CSS;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  try {
    const ctl = homeStudioMod.createHomeStudioPanelController({
      usageCore: usageCoreMod,
      isDestroyed: () => false,
      getHomeLayout: () => 'studio',
      getLang: () => 'en',
      uiText: () => ({}),
      getDisplayName: () => '',
      ensureHooks: () => ({}),
      canMountRealCanvas: () => false,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
    });
    ctl.renderHomePanel(true);
    const heat = home.querySelector('.ag-cs-home-heat');
    const cell = home.querySelector('.ag-cs-home-heat-cell');
    const hint = home.querySelector('.ag-cs-home-heat-hint');
    assert.ok(heat && cell && hint);
    cell.setAttribute('data-tip', 'Nov 26 — 12K tokens');
    heat._layoutReads = 0;
    cell._layoutReads = 0;
    heat.dispatch('mouseover', { target: cell });
    assert.equal(heat._layoutReads, 0, 'Anchor Positioning heatmap tooltip must perform 0 clientWidth/clientHeight reads');
    assert.equal(cell._layoutReads, 0, 'Anchor Positioning heatmap tooltip must perform 0 offsetLeft/offsetTop reads');
    assert.equal(cell.style.getPropertyValue('anchor-name'), '--ag-heat-cell');
    assert.equal(hint.getAttribute('popover'), 'manual');
    assert.equal(hint.getAttribute('data-ag-anchor'), '1');
    assert.equal(hint._showPopoverCalls, 1);
    ctl.dispose();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    if (prevCss === undefined) delete globalThis.CSS; else globalThis.CSS = prevCss;
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = prevRaf;
  }

  // 5b) sidebar-client: Anchor Positioning 0-reflow path + GPU blur & static will-change purge
  const sbSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'sidebar-studio', 'sidebar-client.js'), 'utf8');
  assert.ok(sbSrc.includes('@supports (anchor-name:--a){.ag-prism-sidebar-popover[data-ag-anchor="1"]'), 'sidebar-client must declare CSS Anchor Positioning rule');
  assert.ok(sbSrc.includes("anchorEl.style.setProperty('anchor-name', '--ag-sb-pop-anchor')") && sbSrc.includes("pop.setAttribute('popover', 'manual')"));
  assert.equal(sbSrc.includes('filter:blur(24px)'), false, '.ag-prism-aura-orb must remove GPU filter:blur(24px)');
  assert.equal(sbSrc.includes('backdrop-filter:blur(6px)'), false, '.ag-prism-modal-backdrop must remove fullscreen backdrop-filter:blur(6px)');
  const vesselLine = sbSrc.split('\n').find((l) => l.includes("'.ag-prism-vessel{")) || '';
  assert.ok(vesselLine.includes('93%') && !vesselLine.includes('backdrop-filter'), '.ag-prism-vessel must use ~93% opacity with 0 backdrop-filter');
  const sbSliderLine = sbSrc.split('\n').find((l) => l.includes("'.ag-prism-sb-slider{")) || '';
  const subSliderLine = sbSrc.split('\n').find((l) => l.includes("'.ag-prism-subslider{")) || '';
  assert.equal(sbSliderLine.includes('will-change'), false, '.ag-prism-sb-slider must not set static will-change');
  assert.equal(subSliderLine.includes('will-change'), false, '.ag-prism-subslider must not set static will-change');

  // 5c) style.css: scroll-driven top fade, expanded thought contain:layout style (no paint), static will-change & drop-shadow purge
  const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(
    styleCss.includes('@supports (animation-timeline:scroll()){html[data-ag-cs-style] [data-testid="conversation-view"]::before{opacity:0;animation:ag-cs-top-fade linear both;animation-timeline:scroll(nearest block);animation-range:0px 28px}}'),
    'conversation-view top fade must upgrade to scroll-driven opacity animation'
  );
  const thoughtExpLine = styleCss.split('\n').find((l) => l.includes('border-left:1px solid var(--ag-cs-thought-rule)')) || '';
  assert.ok(thoughtExpLine.includes('contain:layout style;') && !thoughtExpLine.includes('contain:layout style paint'), 'Expanded thinking block must use contain:layout style without paint');
  const lines = styleCss.split('\n');
  for (const needle of ['ag-ov-br 4s', 'ag-cs-spark-orbit 2.4s', 'ag-cs-caret-blink 1.05s', 'ag-cs-orbit-spin 2.4s', 'ag-cs-comet-tip 1.1s']) {
    const ln = lines.find((l) => l.includes(needle)) || '';
    assert.ok(ln.length > 0, `Expected rule containing ${needle}`);
    assert.equal(ln.includes('will-change'), false, `Rule (${needle}) must not declare static will-change`);
  }
  const spLine = lines.find((l) => l.includes('[data-testid="step-plan-item"]{')) || '';
  assert.equal(spLine.includes('drop-shadow('), false, 'Completed step-plan checkmark must not use filter:drop-shadow');
});

test('6. Issue #142: hot-reload with unchanged cssHash + changed codeHash preserves __agPrismCssMgr and stylesheet, heals cross-version legacy destroy, and keeps explicit destroy()', () => {
  class MockCSSStyleSheet {
    constructor() { this.text = ''; this.replaceCalls = 0; }
    replaceSync(t) { this.text = String(t); this.replaceCalls++; }
  }

  const hostSheet = new MockCSSStyleSheet();
  hostSheet.replaceSync('/* host-owned-sheet */');

  const html = makeMiniEl('html');
  const head = makeMiniEl('head');
  const body = makeMiniEl('body', { className: 'theme-dark' });
  html.appendChild(head);
  html.appendChild(body);
  body.appendChild(makeMiniEl('div', { attrs: { 'data-testid': 'conversation-view' } }));

  const doc = {
    documentElement: html,
    head,
    body,
    hidden: false,
    readyState: 'complete',
    adoptedStyleSheets: [hostSheet],
    createElement: (t) => makeMiniEl(t),
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };

  const sandbox = {
    document: doc,
    CSSStyleSheet: MockCSSStyleSheet,
    navigator: { language: 'zh-CN' },
    location: { pathname: '/', href: 'vscode-file://vscode-app/index.html' },
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    performance: { now: () => 1000 },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, Uint8Array, Float32Array, Intl, Symbol,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const expr1 = cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, palette: 'obsidian', motionLevel: 'standard' }, { noDiskCache: true });
  const res1 = vm.runInNewContext(expr1, sandbox);
  assert.equal(res1.status, 'ok');
  const mgr1 = sandbox.window.__agPrismCssMgr;
  assert.ok(mgr1 && !mgr1._disposed);
  assert.equal(doc.adoptedStyleSheets.length, 2);
  const sheet1 = doc.adoptedStyleSheets[1];
  assert.equal(sheet1.replaceCalls, 1);

  // Hot-reload with identical cssHash and changed codeHash: reused __agPrismCssMgr must NOT be disposed
  const hash2 = res1.codeHash === 'hotreload02' ? 'hotreload02b' : 'hotreload02';
  const expr2 = expr1.replaceAll(JSON.stringify(res1.codeHash), JSON.stringify(hash2));
  assert.notEqual(expr2, expr1, 'test must actually mutate codeHash in inject expression');
  const res2 = vm.runInNewContext(expr2, sandbox);
  assert.equal(res2.status, 'ok');
  assert.equal(res2.codeHash, hash2);
  assert.equal(sandbox.window.__agPrismCssMgr, mgr1, 'unchanged cssHash hot-reload must reuse existing __agPrismCssMgr');
  assert.equal(mgr1._disposed, false, 'reused __agPrismCssMgr must stay alive after JS-only hot-reload');
  assert.equal(mgr1._hold, 0, 'transient _hold guard must be cleared after hot-reload');
  assert.deepEqual(Array.from(doc.adoptedStyleSheets), [hostSheet, sheet1], 'adoptedStyleSheets must retain main stylesheet');
  assert.equal(sheet1.replaceCalls, 1, 'reused stylesheet must not re-parse on JS-only hot-reload');
  assert.ok(doc.getElementById('ag-prism-css'), 'sentinel <style id="ag-prism-css"> must remain mounted');

  // Cross-version upgrade from legacy pre-fix api.destroy (which unconditionally disposes W.__agPrismCssMgr)
  const prevApi = sandbox.window.__agPrism;
  const origDestroy = prevApi.destroy.bind(prevApi);
  prevApi.destroy = (...a) => {
    sandbox.window.__agPrismCssMgr?.destroy?.();
    return origDestroy(...a);
  };
  const hash3 = 'hotreload03';
  const expr3 = expr1.replaceAll(JSON.stringify(res1.codeHash), JSON.stringify(hash3));
  const res3 = vm.runInNewContext(expr3, sandbox);
  assert.equal(res3.status, 'ok');
  assert.equal(res3.codeHash, hash3);
  const mgr3 = sandbox.window.__agPrismCssMgr;
  assert.ok(mgr3 && !mgr3._disposed, 'cross-version fallback must rebuild disposed __agPrismCssMgr');
  assert.equal(doc.adoptedStyleSheets.length, 2, 'cross-version fallback must restore main adoptedStyleSheet');
  assert.equal(doc.adoptedStyleSheets[0], hostSheet);
  assert.ok(doc.adoptedStyleSheets[1].text.includes('.ag-cs-crab'), 'restored main stylesheet must contain full Prism rules');
  assert.ok(doc.getElementById('ag-prism-css'));

  // Explicit window.__agPrism.destroy() still disposes current __agPrismCssMgr and unmounts stylesheet
  sandbox.window.__agPrism.destroy();
  assert.equal(mgr3._disposed, true, 'explicit destroy() must dispose __agPrismCssMgr');
  assert.deepEqual(Array.from(doc.adoptedStyleSheets), [hostSheet], 'explicit destroy() must remove only Prism sheet');
  assert.equal(doc.getElementById('ag-prism-css'), null, 'explicit destroy() must remove sentinel style element');
});
