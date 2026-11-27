import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const inlineDiffMod = require(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'));

const NO_TR_ATTRS = [
  ['translate', 'no'],
  ['data-no-translate', 'true'],
  ['data-ag-localization-skip', 'true'],
  ['data-agy-no-translate', 'true'],
  ['data-antigravity-zh-skip', '1'],
  ['data-ag-no-i18n', ''],
];

function createDomSandbox() {
  const listeners = new Map();
  const makeNode = (tag, attrs = {}) => {
    const attrMap = new Map(Object.entries(attrs));
    const elListeners = new Map();
    const children = [];
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      children,
      parentElement: null,
      parentNode: null,
      _text: '',
      _classList: new Set(String(attrs.class || '').split(/\s+/).filter(Boolean)),
      style: {
        _props: new Map(),
        setProperty(k, v) { this._props.set(k, String(v)); },
        getPropertyValue(k) { return this._props.get(k) || ''; },
        removeProperty(k) { this._props.delete(k); },
      },
      get id() { return attrMap.get('id') || ''; },
      set id(v) { const s = String(v || ''); if (s) attrMap.set('id', s); else attrMap.delete('id'); },
      get className() { return Array.from(this._classList).join(' '); },
      set className(v) {
        this._classList = new Set(String(v || '').split(/\s+/).filter(Boolean));
        const s = this.className;
        if (s) attrMap.set('class', s);
        else attrMap.delete('class');
      },
      classList: {
        add(...cls) { for (const c of cls) node._classList.add(c); attrMap.set('class', node.className); },
        remove(...cls) { for (const c of cls) node._classList.delete(c); attrMap.set('class', node.className); },
        contains(c) { return node._classList.has(c); },
      },
      get textContent() {
        return children.length && !this._text ? children.map((c) => c.textContent).join('') : this._text;
      },
      set textContent(v) { this._text = String(v ?? ''); },
      setAttribute(k, v) {
        const val = String(v);
        attrMap.set(k, val);
        if (k === 'class') this.className = val;
      },
      getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
      hasAttribute(k) { return attrMap.has(k); },
      removeAttribute(k) { attrMap.delete(k); if (k === 'class') this._classList.clear(); },
      appendChild(ch) {
        if (ch.parentNode && Array.isArray(ch.parentNode.children)) {
          const idx = ch.parentNode.children.indexOf(ch);
          if (idx >= 0) ch.parentNode.children.splice(idx, 1);
        }
        children.push(ch);
        ch.parentNode = this;
        ch.parentElement = this;
        return ch;
      },
      insertBefore(ch, ref) {
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, ch);
        else children.push(ch);
        ch.parentNode = this;
        ch.parentElement = this;
        return ch;
      },
      remove() {
        if (this.parentNode && Array.isArray(this.parentNode.children)) {
          const i = this.parentNode.children.indexOf(this);
          if (i >= 0) this.parentNode.children.splice(i, 1);
        }
        this.parentNode = null;
        this.parentElement = null;
      },
      addEventListener(t, fn) {
        if (!elListeners.has(t)) elListeners.set(t, new Set());
        elListeners.get(t).add(fn);
      },
      removeEventListener(t, fn) { elListeners.get(t)?.delete(fn); },
      dispatchEvent(ev) {
        const e = { target: this, preventDefault() {}, stopPropagation() {}, ...ev };
        for (const fn of elListeners.get(e.type) || []) fn(e);
      },
      get nextElementSibling() {
        if (!this.parentNode) return null;
        const idx = this.parentNode.children.indexOf(this);
        return idx >= 0 ? this.parentNode.children[idx + 1] || null : null;
      },
      closest(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        let cur = this;
        while (cur) {
          if (cls && cur.classList?.contains(cls)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
        const matchOne = (el, s) => {
          if (s.startsWith('#')) return el.id === s.slice(1);
          if (s.startsWith('.')) return el.classList.contains(s.slice(1));
          const am = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(s);
          if (am) return am[2] !== undefined ? el.getAttribute(am[1]) === am[2] : el.hasAttribute(am[1]);
          return false;
        };
        const walk = (n) => {
          for (const ch of n.children) {
            if (parts.some((p) => matchOne(ch, p))) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 28, right: 640, bottom: 28 }; },
    };
    return node;
  };

  const html = makeNode('html');
  const head = makeNode('head');
  const body = makeNode('body', { class: 'monaco-workbench' });
  html.appendChild(head);
  html.appendChild(body);

  const doc = {
    readyState: 'complete',
    documentElement: html,
    head,
    body,
    createElement: (t) => makeNode(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (sel) => html.querySelector(sel),
    querySelectorAll: (sel) => html.querySelectorAll(sel),
    addEventListener(t, fn) {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t).add(fn);
    },
    removeEventListener(t, fn) { listeners.get(t)?.delete(fn); },
  };

  const sandbox = {
    window: null,
    globalThis: null,
    self: null,
    top: null,
    document: doc,
    location: { href: 'vscode-file://vscode-app/workbench.html' },
    getComputedStyle: (el) => {
      const cls = el?.className || '';
      const isCol = cls.includes('flex-col');
      return { display: 'flex', flexDirection: isCol ? 'column' : 'row', getPropertyValue: () => '' };
    },
    addEventListener(t, fn) {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t).add(fn);
    },
    removeEventListener(t, fn) { listeners.get(t)?.delete(fn); },
    requestAnimationFrame: (fn) => { fn(16); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    performance: { now: () => Date.now() },
    Math, Date, JSON, Map, Set, Array, Object, String, Number, Boolean, Promise, RegExp, Error,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  return { sandbox, html, head, body, doc, makeNode, listeners };
}

test('Channel 6 inline-diff standalone compilation, idempotent mount, missing-file fail-closed, and full uninstall cleanup', () => {
  assert.equal(cdp.INLINE_DIFF_BINDING, '__agPrismInlineDiffCall');
  assert.equal(cdp.SYNC_VENDOR_FILES, undefined, 'Dead SYNC_VENDOR_FILES export must remain removed');

  // 1) Compiles cleanly & mounts idempotently in a sandbox
  const expr = cdp.buildInlineDiffInjectExpression(cdp.DEFAULT_CONFIG);
  assert.ok(expr.length > 1000, 'Channel 6 expression must be non-empty when vendor/inline-diff/inline-diff-client.js exists');
  assert.doesNotThrow(() => new vm.Script(expr));
  assert.doesNotThrow(() => new vm.Script(cdp.INLINE_DIFF_REMOVE_EXPRESSION));
  assert.doesNotThrow(() => new vm.Script(cdp.REMOVE_EXPRESSION));

  const env = createDomSandbox();
  const mount1 = vm.runInNewContext(expr, env.sandbox);
  assert.equal(mount1.ok, true);
  assert.equal(typeof env.sandbox.__agPrismInlineDiff, 'object');
  assert.equal(typeof env.sandbox.__agPrismInlineDiffFactory, 'function');
  assert.equal(typeof env.sandbox.__agPrismInlineDiffResolve, 'function');

  const styleEl = env.doc.getElementById('ag-prism-inline-diff-css');
  assert.ok(styleEl, 'Channel 6 must mount dedicated <style id="ag-prism-inline-diff-css">');
  assert.equal(styleEl.getAttribute('data-ag-owned'), '1');
  for (const [k, v] of NO_TR_ATTRS) {
    assert.equal(styleEl.getAttribute(k), v, `Channel 6 style must stamp ${k}="${v}"`);
  }

  // Re-running with identical hash must hit fast reuse without duplicating <style>
  const mount2 = vm.runInNewContext(expr, env.sandbox);
  assert.equal(mount2.ok, true);
  assert.equal(mount2.reused, true);
  assert.equal(env.head.querySelectorAll('#ag-prism-inline-diff-css').length, 1);

  // 2) Mount inline diff box & context menu and verify A3 anti-translation + full REMOVE_EXPRESSION cleanup
  const colList = env.makeNode('div', { class: 'flex flex-col' });
  const row = env.makeNode('div', { class: 'group flex w-full' });
  const badge = env.makeNode('span', {
    'data-testid': 'diff-line-count',
    'data-ag-diff-json': JSON.stringify({ file: 'demo.js', additions: 1, deletions: 0, oldText: 'a', newText: 'a\nb' }),
  });
  badge.textContent = '+1 -0';
  row.appendChild(badge);
  colList.appendChild(row);
  env.body.appendChild(colList);

  assert.equal(env.sandbox.__agPrismInlineDiff.toggleInlineDiffPreview(badge), true);
  const diffBox = colList.querySelector('.ag-cs-inline-diff-box');
  assert.ok(diffBox, 'Channel 6 must mount .ag-cs-inline-diff-box');
  assert.equal(diffBox.getAttribute('data-ag-owned'), '1');
  for (const [k, v] of NO_TR_ATTRS) {
    assert.equal(diffBox.getAttribute(k), v, `.ag-cs-inline-diff-box must stamp ${k}="${v}"`);
  }

  // Full uninstall via cdp.REMOVE_EXPRESSION cleans Channel 6 runtime, DOM, style, and root attrs
  env.html.setAttribute('data-ag-cs-sb-fold', 'on');
  env.html.setAttribute('data-ag-cs-scroll-bottom', 'smooth');
  vm.runInNewContext(cdp.REMOVE_EXPRESSION, env.sandbox);
  assert.equal(env.sandbox.__agPrismInlineDiff, undefined);
  assert.equal(env.sandbox.__agPrismInlineDiffFactory, undefined);
  assert.equal(env.sandbox.__agPrismInlineDiffResolve, undefined);
  assert.equal(env.doc.getElementById('ag-prism-inline-diff-css'), null);
  assert.equal(colList.querySelector('.ag-cs-inline-diff-box'), null);
  assert.equal(env.html.hasAttribute('data-ag-cs-sb-fold'), false);
  assert.equal(env.html.hasAttribute('data-ag-cs-scroll-bottom'), false);

  // 3) Missing vendor/inline-diff/inline-diff-client.js must fail closed to ''
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-ch6-missing-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'cdp.js'), path.join(tmpDir, 'cdp.js'));
    fs.cpSync(path.join(ROOT, 'src'), path.join(tmpDir, 'src'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(tmpDir, 'config.example.json'));
    const isolatedCdp = require(path.join(tmpDir, 'cdp.js'));
    assert.equal(isolatedCdp.buildInlineDiffInjectExpression(isolatedCdp.DEFAULT_CONFIG), '');
  } finally {
    delete require.cache[require.resolve(path.join(tmpDir, 'cdp.js'))];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Channel 6 participates in 6-Channel .bundle-cache.json with SHA-256 invalidation and tamper Fail-Open', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-ch6-cache-'));
  const cachePath = path.join(tmpDir, '.bundle-cache.json');
  const clientDir = path.join(tmpDir, 'vendor', 'inline-diff');
  const clientPath = path.join(clientDir, 'inline-diff-client.js');

  try {
    assert.equal(cdp.BUNDLE_CACHE_SCHEMA_VERSION, 2);

    fs.mkdirSync(clientDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'cdp.js'), path.join(tmpDir, 'cdp.js'));
    fs.cpSync(path.join(ROOT, 'src'), path.join(tmpDir, 'src'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(tmpDir, 'config.example.json'));
    fs.copyFileSync(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'), clientPath);

    const loadCdp = () => {
      const p = require.resolve(path.join(tmpDir, 'cdp.js'));
      delete require.cache[p];
      return require(p);
    };

    const cdp1 = loadCdp();
    const exprCold = cdp1.buildInlineDiffInjectExpression(cdp1.DEFAULT_CONFIG, { cachePath });
    assert.ok(exprCold.length > 1000);
    assert.equal(fs.existsSync(cachePath), true);

    const cacheJson = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(cacheJson.schemaVersion, 2);
    assert.ok(cacheJson.channels?.inlineDiff);
    assert.match(cacheJson.channels.inlineDiff.sourceHash, /^[0-9a-f]{64}$/);
    assert.match(cacheJson.channels.inlineDiff.payloadSha256, /^[0-9a-f]{64}$/);

    // Cold reload hits disk cache byte-identically
    const cdp2 = loadCdp();
    const exprHit = cdp2.buildInlineDiffInjectExpression(cdp2.DEFAULT_CONFIG, { cachePath });
    assert.equal(exprHit, exprCold);
    assert.equal(cdp2.getBundleCacheStats().channelHitsByName.inlineDiff, 1);
    assert.equal(cdp2.getBundleCacheStats().channelCompileRuns, 0);

    // Same-length, same-mtime 1-byte edit invalidates via SHA-256
    const st = fs.statSync(clientPath);
    const src = fs.readFileSync(clientPath, 'utf8');
    const mutated = src.replace("const INLINE_DIFF_STYLE_ID = 'ag-prism-inline-diff-css'", "const INLINE_DIFF_STYLE_ID = 'ag-prism-inline-diff-cs2'");
    assert.notEqual(mutated, src, 'Expected target string in inline-diff-client.js');
    assert.equal(Buffer.byteLength(mutated, 'utf8'), Buffer.byteLength(src, 'utf8'));
    fs.writeFileSync(clientPath, mutated, 'utf8');
    fs.utimesSync(clientPath, st.atime, st.mtime);

    const exprAfterEdit = cdp2.buildInlineDiffInjectExpression(cdp2.DEFAULT_CONFIG, { cachePath });
    assert.notEqual(exprAfterEdit, exprCold, 'Channel 6 cache must invalidate on 1-byte same-length/same-mtime edit');

    // Tampered cache payload fails open and self-heals
    const obj = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    obj.channels.inlineDiff.minCode = `${obj.channels.inlineDiff.minCode}/*tamper*/`;
    fs.writeFileSync(cachePath, JSON.stringify(obj), 'utf8');

    const cdp3 = loadCdp();
    const exprHealed = cdp3.buildInlineDiffInjectExpression(cdp3.DEFAULT_CONFIG, { cachePath });
    assert.equal(exprHealed, exprAfterEdit);
    assert.equal(cdp3.getBundleCacheStats().channelCompileRuns, 1);
  } finally {
    delete require.cache[require.resolve(path.join(tmpDir, 'cdp.js'))];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Channel 1 size budget, Channel 6 XSS/CSS hygiene, A3 attrs, and C#/Swift Channel 6 parity', () => {
  // 1) Channel 1 size budget <= 686,080 B and < 704,000 B + pulse-vial-bridge < 31,000 B
  const ch1Expr = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG);
  const ch1Bytes = Buffer.byteLength(ch1Expr, 'utf8');
  assert.ok(ch1Bytes <= 686080, `Channel 1 must stay <= 686,080 B, got ${ch1Bytes} B`);
  assert.ok(ch1Bytes < 704000, `Channel 1 must stay < 704,000 B, got ${ch1Bytes} B`);
  const pvBytes = fs.statSync(path.join(ROOT, 'pulse-vial-bridge.js')).size;
  assert.ok(pvBytes < 31000, `pulse-vial-bridge.js must stay < 31,000 B, got ${pvBytes} B`);

  // 2) style.css redlines
  const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.equal(/:has\(/.test(styleCss), false, 'style.css must have 0 :has()');
  assert.equal(/[^\x00-\x7F]/.test(styleCss), false, 'style.css must have 0 non-ASCII');
  assert.equal((styleCss.match(/\{/g) || []).length, (styleCss.match(/\}/g) || []).length, 'style.css braces must balance');

  // 3) inline-diff-client.js CSS + XSS + A3 redlines
  const clientSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'), 'utf8');
  assert.equal(/:has\(/.test(inlineDiffMod.INLINE_DIFF_CSS), false, 'INLINE_DIFF_CSS must have 0 :has()');
  assert.equal(clientSrc.includes('innerHTML'), false, 'inline-diff-client.js must have 0 innerHTML');
  assert.equal(/\beval\s*\(/.test(clientSrc), false, 'inline-diff-client.js must have 0 eval()');
  assert.equal(/new\s+Function\b/.test(clientSrc), false, 'inline-diff-client.js must have 0 new Function');
  assert.equal(/[^\x00-\x7F]/.test(inlineDiffMod.INLINE_DIFF_CSS), false, 'INLINE_DIFF_CSS must have 0 non-ASCII');
  assert.equal(
    (inlineDiffMod.INLINE_DIFF_CSS.match(/\{/g) || []).length,
    (inlineDiffMod.INLINE_DIFF_CSS.match(/\}/g) || []).length,
    'INLINE_DIFF_CSS braces must balance'
  );
  for (const [k, v] of NO_TR_ATTRS) {
    assert.ok(clientSrc.includes(k) && clientSrc.includes(v), `inline-diff-client.js must define ${k}="${v}"`);
  }

  // SAFE BUILD (2026-11-27): C#/Swift Channel 6 parity check removed (native installers are removed).
});
