// Inline Diff UX 专项回归单测：固定 Header 不进滚动体、自然行号升序、匹配本步高亮与平滑滚动、#ag-prism-overlay-portal 隔离容器、0 C类负优化
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { parseInlineUnifiedDiff } from '../src/daemon/inline-diff-filter.mjs';
import { readSafeInlineDiff } from '../src/daemon/inline-diff-service.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const inlineDiff = require(path.join(ROOT, 'vendor', 'inline-diff', 'inline-diff-client.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

function createInlineDiffTestDom(lang = 'zh-CN', { deferRaf = false } = {}) {
  const winListeners = new Map();
  const rafQueue = [];
  let rafSeq = 1;

  const makeNode = (tag, attrs = {}) => {
    const am = new Map(Object.entries(attrs));
    const kids = [];
    const cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const elListeners = new Map();
    const scrollCalls = [];
    const n = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      children: kids,
      childNodes: kids,
      parentNode: null,
      parentElement: null,
      isConnected: true,
      scrollTop: 0,
      _scrollCalls: scrollCalls,
      _txt: '',
      style: {
        cssText: '',
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
        getPropertyValue(k) { return this[k] || ''; },
      },
      get id() { return am.get('id') || ''; },
      set id(v) { if (v) am.set('id', String(v)); else am.delete('id'); },
      get className() { return [...cls].join(' '); },
      set className(v) {
        cls.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c));
        if (cls.size) am.set('class', [...cls].join(' '));
        else am.delete('class');
      },
      classList: {
        add: (...c) => { c.forEach((x) => cls.add(x)); am.set('class', [...cls].join(' ')); },
        remove: (...c) => { c.forEach((x) => cls.delete(x)); if (cls.size) am.set('class', [...cls].join(' ')); else am.delete('class'); },
        contains: (c) => cls.has(c),
      },
      get firstChild() { return kids[0] || null; },
      get textContent() { return kids.length && !n._txt ? kids.map((c) => c.textContent).join('') : n._txt; },
      set textContent(v) { kids.length = 0; n._txt = String(v ?? ''); },
      get offsetParent() { return n.parentElement; },
      get offsetTop() {
        if (!n.parentElement) return 0;
        const idx = n.parentElement.children.indexOf(n);
        return idx >= 0 ? idx * 24 : 0;
      },
      scrollTo(arg) {
        scrollCalls.push(arg);
        if (arg && typeof arg === 'object' && Number.isFinite(arg.top)) n.scrollTop = arg.top;
      },
      setAttribute(k, v) { am.set(k, String(v)); if (k === 'class') n.className = v; },
      getAttribute(k) { return am.has(k) ? am.get(k) : null; },
      hasAttribute(k) { return am.has(k); },
      removeAttribute(k) { am.delete(k); if (k === 'class') cls.clear(); },
      appendChild(c) {
        if (c.parentNode && Array.isArray(c.parentNode.children)) {
          const i = c.parentNode.children.indexOf(c);
          if (i >= 0) c.parentNode.children.splice(i, 1);
        }
        c.parentNode = c.parentElement = n;
        kids.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode && Array.isArray(c.parentNode.children)) {
          const prev = c.parentNode.children.indexOf(c);
          if (prev >= 0) c.parentNode.children.splice(prev, 1);
        }
        c.parentNode = c.parentElement = n;
        const i = ref ? kids.indexOf(ref) : -1;
        if (i >= 0) kids.splice(i, 0, c);
        else kids.push(c);
        return c;
      },
      removeChild(c) {
        const i = kids.indexOf(c);
        if (i >= 0) kids.splice(i, 1);
        c.parentNode = c.parentElement = null;
        return c;
      },
      remove() { n.parentNode?.removeChild(n); },
      contains(target) {
        let cur = target;
        while (cur) {
          if (cur === n) return true;
          cur = cur.parentNode;
        }
        return false;
      },
      addEventListener(t, fn) { if (!elListeners.has(t)) elListeners.set(t, new Set()); elListeners.get(t).add(fn); },
      removeEventListener(t, fn) { elListeners.get(t)?.delete(fn); },
      dispatchEvent(ev) {
        const e = { target: n, preventDefault() {}, stopPropagation() {}, ...ev };
        for (const fn of elListeners.get(e.type) || []) fn(e);
      },
      click() { n.dispatchEvent({ type: 'click' }); },
      get nextElementSibling() {
        if (!n.parentNode) return null;
        const i = n.parentNode.children.indexOf(n);
        return i >= 0 ? n.parentNode.children[i + 1] || null : null;
      },
      matches(sel) {
        return String(sel || '').split(',').map((p) => p.trim()).some((part) => {
          if (!part) return false;
          if (part.startsWith('.')) return part.slice(1).split('.').every((c) => cls.has(c));
          if (part.startsWith('#')) return am.get('id') === part.slice(1);
          const m = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(part);
          if (m) return m[2] === undefined ? am.has(m[1]) : am.get(m[1]) === m[2];
          return n.tagName === part.toUpperCase();
        });
      },
      closest(s) { let p = n; while (p) { if (p.matches?.(s)) return p; p = p.parentElement; } return null; },
      querySelector(s) { return n.querySelectorAll(s)[0] || null; },
      querySelectorAll(s) {
        const out = [];
        const walk = (x) => { for (const k of x.children) { if (k.matches?.(s)) out.push(k); walk(k); } };
        walk(n);
        return out;
      },
      getBoundingClientRect: () => ({ left: 0, top: n.offsetTop, width: 720, height: 24 }),
    };
    return n;
  };

  const html = makeNode('html', { 'data-ag-cs-lang': lang, 'data-ag-cs-style': '1' });
  const head = makeNode('head');
  const body = makeNode('body');
  html.appendChild(head);
  html.appendChild(body);
  const doc = {
    documentElement: html,
    head,
    body,
    readyState: 'complete',
    createElement: (t) => makeNode(t),
    createElementNS: (_ns, t) => makeNode(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    document: doc,
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle: (el) => ({ display: 'flex', flexDirection: el?.className?.includes('flex-col') ? 'column' : 'row' }),
    addEventListener(t, fn) { if (!winListeners.has(t)) winListeners.set(t, new Set()); winListeners.get(t).add(fn); },
    removeEventListener(t, fn) { winListeners.get(t)?.delete(fn); },
    dispatchEvent(ev) {
      const e = { preventDefault() {}, stopPropagation() {}, ...ev };
      for (const fn of winListeners.get(e.type) || []) fn(e);
    },
    requestAnimationFrame(fn) {
      const id = rafSeq++;
      if (deferRaf) rafQueue.push({ id, fn });
      else fn(16);
      return id;
    },
    cancelAnimationFrame(id) {
      const idx = rafQueue.findIndex((r) => r.id === id);
      if (idx >= 0) rafQueue.splice(idx, 1);
    },
    setTimeout,
    clearTimeout,
  };
  const flushRaf = () => { while (rafQueue.length) { const item = rafQueue.shift(); item.fn(16); } };
  return { win, doc, html, body, makeNode, flushRaf };
}

test('Inline Diff UX 1: fixed top header sits outside scrollable body with non-overlapping right-aligned actions (both notice & compact modes)', async () => {
  const { win, doc, body, makeNode } = createInlineDiffTestDom('zh-CN');
  const col = makeNode('div', { class: 'flex flex-col' });
  const cumRow = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row', 'data-ag-diff-uri': 'file:///C:/repo/demo.js' });
  const cumBadge = makeNode('span', { 'data-testid': 'diff-line-count' });
  cumBadge.textContent = '+1 -0';
  cumRow.appendChild(cumBadge);
  col.appendChild(cumRow);

  const exactRow = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row' });
  const exactBadge = makeNode('span', {
    'data-testid': 'diff-line-count',
    'data-ag-diff-json': JSON.stringify({ file: 'exact.js', startLine: 11, oldText: 'const a = 1;', newText: 'const a = 2;' }),
  });
  exactBadge.textContent = '+1 -1';
  exactRow.appendChild(exactBadge);
  col.appendChild(exactRow);
  body.appendChild(col);

  win.__agPrismInlineDiffCall = (raw) => {
    const req = JSON.parse(raw);
    queueMicrotask(() => win.__agPrismInlineDiffResolve?.(req.id, {
      ok: true,
      mode: 'git-diff',
      fileName: 'demo.js',
      additions: 4,
      deletions: 3,
      cumulativeDiff: true,
      focused: true,
      focusHunk: 1,
      truncated: false,
      totalLines: 10,
      lines: [
        { kind: 'hunk', ln: '', sign: '@@', text: '@@ -3,4 +3,4 @@' },
        { kind: 'del', ln: '3', sign: '-', text: 'const old3 = 1;' },
        { kind: 'del', ln: '4', sign: '-', text: 'const old4 = 2;' },
        { kind: 'del', ln: '5', sign: '-', text: 'const old5 = 3;' },
        { kind: 'add', ln: '3', sign: '+', text: 'const new3 = 10;' },
        { kind: 'add', ln: '4', sign: '+', text: 'const new4 = 20;' },
        { kind: 'add', ln: '5', sign: '+', text: 'const new5 = 30;' },
        { kind: 'hunk', ln: '', sign: '@@', text: '@@ -11,2 +11,3 @@' },
        { kind: 'ctx', ln: '11', sign: ' ', text: 'function keep() {' },
        { kind: 'add', ln: '12', sign: '+', text: '  return 42;' },
      ],
    }));
  };

  const client = inlineDiff.createInlineDiffClient({ win, doc, getLang: () => 'zh-CN' });
  try {
    assert.equal(client.toggleInlineDiffPreview(cumBadge, { noAnim: true }), true);
    assert.equal(client.toggleInlineDiffPreview(exactBadge, { noAnim: true }), true);
    await new Promise((r) => setTimeout(r, 20));

    // Cumulative diff card: notice + actions live inside fixed .ag-cs-inline-diff-top OUTSIDE .ag-cs-inline-diff-body
    const cumBox = cumRow.nextElementSibling;
    const cumCard = cumBox.querySelector('.ag-cs-inline-diff-card');
    const cumTop = cumCard.querySelector('.ag-cs-inline-diff-top');
    const cumBody = cumCard.querySelector('.ag-cs-inline-diff-body');
    const cumNote = cumTop?.querySelector('.ag-cs-inline-diff-note');
    const cumActs = cumTop?.querySelector('.ag-cs-inline-diff-float-acts');
    assert.ok(cumTop && cumBody, 'Card must contain dedicated top bar and separate scroll body');
    assert.equal(cumCard.children[0], cumTop, 'Fixed top header must sit above scrollable body');
    assert.equal(cumCard.children[1], cumBody, 'Scrollable body must sit cleanly below fixed top header');
    assert.equal(cumTop.classList.contains('is-compact'), false, 'Notice mode must use full top header layout');
    assert.ok(cumNote && cumNote.textContent.includes('(+4 -3)'), 'Top header must display full cumulative diff notice');
    assert.equal(cumBody.querySelector('.ag-cs-inline-diff-note'), null, '.ag-cs-inline-diff-note must NEVER sit inside scrollable .ag-cs-inline-diff-body');
    assert.ok(cumActs, 'Action buttons must align inside fixed top header');
    assert.equal(cumBody.querySelector('.ag-cs-inline-diff-float-acts'), null, 'Action buttons must never overlap code body');
    assert.equal(cumBox.querySelector('.ag-cs-inline-diff-head'), null, 'Preserves D12 compatibility (no legacy .ag-cs-inline-diff-head)');
    assert.equal(cumBox.querySelector('.ag-cs-inline-diff-bar'), null, 'Must never restore legacy .ag-cs-inline-diff-bar');

    // Exact step-patch card: compact fixed top bar with 0 redundant cumulative note & 0 focus badge
    const exactBox = exactRow.nextElementSibling;
    const exactTop = exactBox.querySelector('.ag-cs-inline-diff-top');
    const exactBody = exactBox.querySelector('.ag-cs-inline-diff-body');
    assert.ok(exactTop && exactTop.classList.contains('is-compact'), 'Exact step diff must use compact non-overlapping top bar');
    assert.equal(exactTop.querySelector('.ag-cs-inline-diff-note'), null, 'Exact step diff must have 0 cumulative notice');
    assert.ok(exactTop.querySelector('.ag-cs-inline-diff-float-acts'), 'Compact top bar still hosts top-right actions outside code rows');
    assert.equal(exactBody.querySelector('[data-ag-diff-focus="1"]'), null, 'Exact step diff must not add redundant focus badge');

    // CSS contract: .ag-cs-inline-diff-float-acts uses position:static inside flex header, never position:absolute overlapping line 11
    assert.ok(inlineDiff.INLINE_DIFF_CSS.includes('.ag-cs-inline-diff-top{display:flex;'), 'CSS must define flex fixed top header');
    assert.ok(inlineDiff.INLINE_DIFF_CSS.includes('.ag-cs-inline-diff-float-acts{position:static;'), 'Action group must be position:static inside top header');

    // Snapshot mode also mounts notice inside fixed .ag-cs-inline-diff-top outside .ag-cs-inline-diff-body with 0 focus tags
    const snapRow = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row', 'data-ag-diff-uri': 'file:///C:/non-git/readme.md' });
    const snapBadge = makeNode('span', { 'data-testid': 'diff-line-count' });
    snapBadge.textContent = '+2 -0';
    snapRow.appendChild(snapBadge);
    col.appendChild(snapRow);
    win.__agPrismInlineDiffCall = (raw) => {
      const req = JSON.parse(raw);
      queueMicrotask(() => win.__agPrismInlineDiffResolve?.(req.id, {
        ok: true,
        mode: 'snapshot',
        fileName: 'readme.md',
        additions: 0,
        deletions: 0,
        truncated: false,
        totalLines: 2,
        lines: [
          { kind: 'ctx', ln: '1', sign: ' ', text: '# Doc' },
          { kind: 'ctx', ln: '2', sign: ' ', text: 'Hello' },
        ],
      }));
    };
    assert.equal(client.toggleInlineDiffPreview(snapBadge, { noAnim: true }), true);
    await new Promise((r) => setTimeout(r, 20));
    const snapBox = snapRow.nextElementSibling;
    const snapTop = snapBox.querySelector('.ag-cs-inline-diff-top');
    const snapBody = snapBox.querySelector('.ag-cs-inline-diff-body');
    assert.ok(snapTop && !snapTop.classList.contains('is-compact') && snapTop.querySelector('.ag-cs-inline-diff-note'), 'Snapshot notice must live in fixed top bar');
    assert.equal(snapBody.querySelector('.ag-cs-inline-diff-note'), null, 'Snapshot notice must NOT sit inside scrollable body');
    assert.equal(snapBody.querySelector('[data-ag-diff-focus="1"]'), null, 'Snapshot mode must not show step focus badge');
  } finally {
    client.destroy();
  }
});

test('Inline Diff UX 2: strict ascending line numbers (no hunk inversion) + matching step focus highlight & auto smooth scroll inside body', async () => {
  // 2a) Pure parser test: lines 3-6 (+3 -3) stay ABOVE lines 11-15 (+1 -0), while focusHunk points to hunk 1
  const rawDiff = [
    'diff --git a/demo.js b/demo.js',
    '--- a/demo.js',
    '+++ b/demo.js',
    '@@ -3,4 +3,4 @@',
    '-const a = 1;',
    '-const b = 2;',
    '-const c = 3;',
    '+const a = 10;',
    '+const b = 20;',
    '+const c = 30;',
    ' const keep = true;',
    '@@ -11,4 +11,5 @@',
    ' function tail() {',
    '   const x = 1;',
    '+  const addedInThisStep = 2;',
    '   return x;',
    ' }',
  ].join('\n');

  const parsed = parseInlineUnifiedDiff(rawDiff, { hints: { additions: 1, deletions: 0 } });
  assert.equal(parsed.cumulativeDiff, true, 'Cumulative (+4 -3) vs step (+1 -0) must flag cumulativeDiff=true');
  assert.equal(parsed.focusedByHint, true);
  assert.equal(parsed.focusHunk, 1, 'focusHunk must point to matching second hunk (index 1)');
  const lnSeq = parsed.lines.filter((l) => l.kind !== 'hunk').map((l) => Number(l.ln));
  assert.equal(lnSeq[0], 3, 'First hunk (line 3) must remain first');
  assert.ok(lnSeq.indexOf(3) < lnSeq.indexOf(11), 'Lines 3-6 must stay strictly ABOVE lines 11-15 (never inverted)');
  assert.ok(lnSeq.indexOf(11) < lnSeq.indexOf(13), 'Trailing hunk lines must stay strictly ascending');

  // 2b) Truncated multi-hunk git repo test: picked hunks still output in strict ascending order
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-idiff-ux-order-'));
  try {
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Prism Test',
      GIT_AUTHOR_EMAIL: 'prism-test@example.invalid',
      GIT_COMMITTER_NAME: 'Prism Test',
      GIT_COMMITTER_EMAIL: 'prism-test@example.invalid',
    };
    const runGit = (args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnv });
    runGit(['init']);
    runGit(['config', 'user.name', 'Prism Test']);
    runGit(['config', 'user.email', 'prism-test@example.invalid']);
    runGit(['config', 'core.autocrlf', 'false']);
    const fp = path.join(repoDir, 'order.js');
    const base = Array.from({ length: 140 }, (_, i) => `const r_${i + 1} = ${i + 1};`);
    fs.writeFileSync(fp, base.join('\n') + '\n', 'utf8');
    runGit(['add', 'order.js']);
    runGit(['commit', '-m', 'init']);
    const mod = base.map((l, i) => {
      if (i >= 2 && i < 6) return `const early_${i + 1} = ${i + 100};`;
      if (i === 120) return `${l}\nconst single_step_add = true;`;
      return l;
    });
    fs.writeFileSync(fp, mod.join('\n') + '\n', 'utf8');
    const res = await readSafeInlineDiff(fp, { hints: { additions: 1, deletions: 0 }, maxDiffLines: 120 });
    assert.equal(res.ok, true);
    assert.equal(res.cumulativeDiff, true);
    assert.equal(res.focusHunk, 1);
    const earlyPos = res.lines.findIndex((l) => l.text.includes('early_3'));
    const latePos = res.lines.findIndex((l) => l.text.includes('single_step_add'));
    assert.ok(earlyPos >= 0 && latePos > earlyPos, `Real git diff must preserve natural order (early=${earlyPos}, late=${latePos})`);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }

  // 2c) Client UI: highlights matching hunk with 9-locale badge & smoothly scrolls .ag-cs-inline-diff-body on first frame
  const { win, doc, body, makeNode, flushRaf } = createInlineDiffTestDom('en', { deferRaf: true });
  const col = makeNode('div', { class: 'flex flex-col' });
  const row = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row', 'data-ag-diff-uri': 'file:///C:/repo/demo.js' });
  const badge = makeNode('span', { 'data-testid': 'diff-line-count' });
  badge.textContent = '+1 -0';
  row.appendChild(badge);
  col.appendChild(row);
  body.appendChild(col);

  // Also verify client-side fallback matching when server omits focusHunk but sets cumulativeDiff:true
  win.__agPrismInlineDiffCall = (raw) => {
    const req = JSON.parse(raw);
    queueMicrotask(() => win.__agPrismInlineDiffResolve?.(req.id, {
      ok: true,
      mode: 'git-diff',
      fileName: 'demo.js',
      additions: 4,
      deletions: 3,
      cumulativeDiff: true,
      truncated: false,
      totalLines: parsed.lines.length,
      lines: parsed.lines,
    }));
  };

  const client = inlineDiff.createInlineDiffClient({ win, doc, getLang: () => 'en' });
  try {
    assert.equal(client.toggleInlineDiffPreview(badge, { noAnim: true }), true);
    await new Promise((r) => setTimeout(r, 20));

    const box = row.nextElementSibling;
    const diffBody = box.querySelector('.ag-cs-inline-diff-body');
    const codeRows = diffBody.querySelectorAll('.ag-cs-inline-diff-line').filter((el) => !el.classList.contains('is-hunk'));
    const renderedLns = codeRows.map((el) => Number(el.querySelector('.ag-cs-inline-diff-ln')?.textContent));
    assert.equal(renderedLns[0], 3, 'Rendered UI must start at line 3 (natural ascending order)');
    assert.ok(renderedLns.indexOf(3) < renderedLns.indexOf(11), 'Rendered UI must place line 3-6 above line 11-15');

    const stepTag = diffBody.querySelector('.ag-cs-inline-diff-step-tag');
    assert.ok(stepTag, 'Matching hunk must display concise step badge');
    assert.equal(stepTag.textContent, 'This step', 'English locale must render "This step" badge');
    const focusLines = diffBody.querySelectorAll('.ag-cs-inline-diff-line.is-focus');
    assert.ok(focusLines.length >= 4, 'All lines in matching hunk must receive .is-focus marker');
    assert.equal(focusLines[0].classList.contains('is-focus-start'), true);
    assert.equal(focusLines[focusLines.length - 1].classList.contains('is-focus-end'), true);
    assert.ok(focusLines.some((el) => el.textContent.includes('addedInThisStep')), 'Focused lines must correspond to matching +1 -0 hunk');

    // Before rAF fires, scroll has not yet moved; flushing rAF scrolls .ag-cs-inline-diff-body smoothly to matching hunk
    assert.equal(diffBody._scrollCalls.length, 0, 'Focus scroll must wait for post-render rAF frame');
    flushRaf();
    assert.equal(diffBody._scrollCalls.length, 1, 'Post-render rAF must auto-scroll .ag-cs-inline-diff-body to matching hunk');
    assert.ok(diffBody._scrollCalls[0].top > 0, `Expected scrollTop > 0 to focus hunk 1, got ${diffBody._scrollCalls[0].top}`);
    assert.equal(diffBody._scrollCalls[0].behavior, 'smooth', 'Auto-focus scroll must use smooth behavior when motion is enabled');

    // 2d) Leading focusHunk === 0 renders dedicated .ag-cs-inline-diff-focus-sep banner while keeping ascending order
    const leadRow = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row', 'data-ag-diff-uri': 'file:///C:/repo/lead.js' });
    const leadBadge = makeNode('span', { 'data-testid': 'diff-line-count' });
    leadBadge.textContent = '+3 -3';
    leadRow.appendChild(leadBadge);
    col.appendChild(leadRow);
    win.__agPrismInlineDiffCall = (raw) => {
      const req = JSON.parse(raw);
      queueMicrotask(() => win.__agPrismInlineDiffResolve?.(req.id, {
        ok: true,
        mode: 'git-diff',
        fileName: 'lead.js',
        additions: 4,
        deletions: 3,
        cumulativeDiff: true,
        focused: true,
        focusHunk: 0,
        truncated: false,
        totalLines: parsed.lines.length,
        lines: parsed.lines,
      }));
    };
    assert.equal(client.toggleInlineDiffPreview(leadBadge, { noAnim: true }), true);
    await new Promise((r) => setTimeout(r, 20));
    const leadBody = leadRow.nextElementSibling.querySelector('.ag-cs-inline-diff-body');
    const leadSep = leadBody.querySelector('.ag-cs-inline-diff-focus-sep');
    assert.ok(leadSep && leadSep.querySelector('.ag-cs-inline-diff-step-tag')?.textContent === 'This step', 'focusHunk=0 must render leading focus banner');
    assert.equal(leadBody.children[0], leadSep, 'Leading focus banner sits cleanly above first hunk');
    flushRaf();
  } finally {
    client.destroy();
  }
});

test('Inline Diff UX 3: #ag-prism-overlay-portal lazy creation, reuse, contain:layout style, and safe destroy cleanup', () => {
  const { win, doc, body, makeNode } = createInlineDiffTestDom('zh-CN');
  const col = makeNode('div', { class: 'flex flex-col' });
  const row = makeNode('div', { class: 'group flex w-full', 'data-testid': 'tool-call-row' });
  const badge = makeNode('span', {
    'data-testid': 'diff-line-count',
    'data-ag-diff-json': JSON.stringify({ file: 'portal.js', uri: 'file:///C:/repo/portal.js', oldText: 'a', newText: 'b' }),
  });
  badge.textContent = '+1 -1';
  row.appendChild(badge);
  col.appendChild(row);
  body.appendChild(col);

  const client = inlineDiff.createInlineDiffClient({ win, doc, getLang: () => 'zh-CN' });
  try {
    // 1) First right-click lazily creates #ag-prism-overlay-portal with contain: layout style and mounts menu inside it
    let prevented = false;
    win.dispatchEvent({
      type: 'contextmenu',
      target: badge,
      clientX: 180,
      clientY: 220,
      preventDefault() { prevented = true; },
      stopPropagation() {},
    });
    assert.equal(prevented, true);
    const portal = doc.getElementById('ag-prism-overlay-portal');
    assert.ok(portal, 'Must lazily create shared #ag-prism-overlay-portal');
    assert.equal(portal.parentElement, body, 'Portal must mount directly on document.body');
    assert.equal(portal.getAttribute('data-ag-owned'), '1', 'Portal must carry data-ag-owned="1"');
    assert.equal(portal.getAttribute('translate'), 'no', 'Portal must carry anti-translation attrs');
    assert.ok(portal.style.cssText.includes('contain:layout style'), 'Portal must enforce contain:layout style');

    const menu = portal.querySelector('.ag-cs-diff-ctx-menu');
    assert.ok(menu, 'Context menu must mount inside #ag-prism-overlay-portal');
    assert.equal(menu.parentElement, portal, 'Context menu parent must be #ag-prism-overlay-portal, not document.body');
    assert.equal(menu.style.pointerEvents, 'auto');
    assert.equal(menu.style.contain, 'layout style');

    // 2) Closing menu removes only menu and keeps shared portal for zero future body style invalidations
    assert.equal(client.closeMenuIfOpen(), true);
    assert.equal(portal.querySelector('.ag-cs-diff-ctx-menu'), null);
    assert.equal(doc.getElementById('ag-prism-overlay-portal'), portal, 'Shared portal persists across menu opens');

    // 3) Re-opening reuses the exact same portal instance without duplicating
    win.dispatchEvent({ type: 'contextmenu', target: badge, clientX: 200, clientY: 240, preventDefault() {}, stopPropagation() {} });
    assert.equal(body.querySelectorAll('#ag-prism-overlay-portal').length, 1, 'Must reuse existing #ag-prism-overlay-portal');

    // 4) Foreign sibling overlay inside shared portal is preserved on destroy()
    const siblingOverlay = makeNode('div', { class: 'ag-cs-ctx-menu' });
    portal.appendChild(siblingOverlay);
    client.destroy();
    assert.equal(portal.querySelector('.ag-cs-diff-ctx-menu'), null, 'destroy() must remove inline-diff menu');
    assert.equal(doc.getElementById('ag-prism-overlay-portal'), portal, 'destroy() must NOT remove portal while other overlays are active');
    assert.equal(siblingOverlay.parentElement, portal, 'destroy() must preserve sibling channel overlays');

    // 5) When portal is empty, destroy() cleans up empty owned portal cleanly
    siblingOverlay.remove();
    const client2 = inlineDiff.createInlineDiffClient({ win, doc, getLang: () => 'zh-CN' });
    client2.destroy();
    assert.equal(doc.getElementById('ag-prism-overlay-portal'), null, 'destroy() must remove empty owned #ag-prism-overlay-portal');
  } finally {
    client.destroy();
  }
});

test('Inline Diff UX 4: 300Hz anti-degradation redline (no win-blur/scroll backdrop-filter strip), 9-locale step badge 0-CJK, and budgets', () => {
  const css = inlineDiff.INLINE_DIFF_CSS;
  // Default tier must keep frosted glass on .ag-cs-diff-ctx-menu (no win-blur / pp-open / resizing / scroll stripping)
  const blurNoneRules = css.split('\n').filter((l) => /backdrop-filter\s*:\s*none/i.test(l));
  assert.ok(blurNoneRules.length >= 1);
  for (const rule of blurNoneRules) {
    assert.equal(rule.includes('data-ag-cs-win-blur'), false, `Must NOT strip backdrop-filter on win-blur: ${rule}`);
    assert.equal(rule.includes('data-ag-pp-open'), false, `Must NOT strip backdrop-filter on pp-open: ${rule}`);
    assert.equal(rule.includes('data-ag-cs-resizing'), false, `Must NOT strip backdrop-filter on resizing: ${rule}`);
    assert.equal(rule.includes('data-ag-scrolling'), false, `Must NOT strip backdrop-filter on scrolling: ${rule}`);
  }
  assert.ok(
    blurNoneRules.some((r) => r.includes('data-ag-cs-perf-mode="performance"') && r.includes('data-ag-cs-motion="off"')),
    'Backdrop-filter disable must be scoped to performance/eco/motion=off'
  );

  // 9-locale completeness & 0 CJK in non-CJK locales for new inlineDiffStepBadge
  const src = fs.readFileSync(path.join(ROOT, 'vendor/inline-diff/inline-diff-client.js'), 'utf8');
  const m = /inlineDiffStepBadge\s*:\s*\{([^\n]+)\}/.exec(src);
  assert.ok(m, 'DIFF_FALLBACK must define inlineDiffStepBadge');
  const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  for (const loc of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr']) {
    const lm = new RegExp(`['"]?${loc}['"]?\\s*:\\s*'([^']+)'`).exec(m[1]);
    assert.ok(lm && lm[1].length > 0, `inlineDiffStepBadge[${loc}] missing`);
    if (['en', 'ko', 'es', 'fr', 'de', 'tr'].includes(loc)) {
      assert.equal(CJK_RE.test(lm[1]), false, `inlineDiffStepBadge[${loc}] leaked CJK: ${lm[1]}`);
    }
  }

  // Channel 6 compiled budget <= 57,344 B & source file <= 69,394 B ratchet
  const srcBytes = fs.statSync(path.join(ROOT, 'vendor/inline-diff/inline-diff-client.js')).size;
  assert.ok(srcBytes <= 69394, `inline-diff-client.js ${srcBytes} B exceeds Law 2 ratchet 69,394 B`);
  const report = cdp.getChannelBudgetReport(cdp.DEFAULT_CONFIG, { noDiskCache: true });
  const ch6 = report.channels.find((c) => c.id === 'inlineDiff');
  assert.ok(ch6 && ch6.bytes > 0 && ch6.bytes <= 57344, `Channel 6 inlineDiff ${ch6?.bytes} B exceeds 57,344 B budget`);
});
