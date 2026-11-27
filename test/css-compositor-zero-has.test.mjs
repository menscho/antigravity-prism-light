import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const STYLE_PATH = path.join(ROOT, 'style.css');
const UPSTREAM_PATH = path.join(ROOT, 'vendor', 'effort-slider', 'upstream-client.js');
const SIDEBAR_PATH = path.join(ROOT, 'vendor', 'sidebar-studio', 'sidebar-client.js');

const styleBuf = fs.readFileSync(STYLE_PATH);
const styleCss = styleBuf.toString('utf8');
const upstreamSrc = fs.readFileSync(UPSTREAM_PATH, 'utf8');
const sidebarSrc = fs.readFileSync(SIDEBAR_PATH, 'utf8');
const upstreamMod = require(UPSTREAM_PATH);
const cdp = require(path.join(ROOT, 'cdp.js'));
const { minifyCss, flattenNestedCss } = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));
const flatStyleCss = minifyCss(flattenNestedCss(minifyCss(styleCss)));

function extractKeyframesBody(css, name) {
  const re = new RegExp(`@keyframes\\s+${name}\\s*\\{`);
  const m = re.exec(css);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < css.length && depth > 0; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  return depth === 0 ? css.slice(start, i - 1) : null;
}

function makeMiniEnv() {
  const mkNode = (tag, opts = {}) => {
    const attrs = new Map(Object.entries(opts.attrs || {}));
    const styles = new Map();
    const classes = new Set(String(opts.className || '').split(/\s+/).filter(Boolean));
    const listeners = new Map();
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      parentElement: null,
      parentNode: null,
      children: [],
      childNodes: [],
      isConnected: true,
      _text: opts.text || '',
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      classList: {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        contains: (c) => classes.has(c),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : Boolean(force); on ? classes.add(c) : classes.delete(c); return on; },
      },
      style: {
        setProperty: (k, v) => styles.set(k, String(v)),
        getPropertyValue: (k) => styles.get(k) || '',
        removeProperty: (k) => styles.delete(k),
      },
      get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join(' ') : this._text; },
      set textContent(v) { this._text = String(v); },
      get firstChild() { return this.childNodes[0] || null; },
      get firstElementChild() { return this.children[0] || null; },
      get lastElementChild() { return this.children[this.children.length - 1] || null; },
      get nextSibling() {
        const p = this.parentNode;
        if (!p) return null;
        const idx = p.childNodes.indexOf(this);
        return idx >= 0 ? p.childNodes[idx + 1] || null : null;
      },
      get nextElementSibling() {
        const p = this.parentElement;
        if (!p) return null;
        const idx = p.children.indexOf(this);
        return idx >= 0 ? p.children[idx + 1] || null : null;
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
        this.childNodes.push(child);
        return child;
      },
      insertBefore(child, ref) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        child.parentElement = this;
        const idx = ref ? this.children.indexOf(ref) : -1;
        if (idx >= 0) {
          this.children.splice(idx, 0, child);
          this.childNodes.splice(idx, 0, child);
        } else {
          this.children.push(child);
          this.childNodes.push(child);
        }
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        const cidx = this.childNodes.indexOf(child);
        if (cidx >= 0) this.childNodes.splice(cidx, 1);
        child.parentNode = null;
        child.parentElement = null;
        return child;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      contains(other) {
        for (let c = other; c; c = c.parentNode) if (c === this) return true;
        return false;
      },
      matches(sel) {
        return String(sel).split(',').some((part) => {
          const s = part.trim();
          if (!s) return false;
          if (s.startsWith('div[')) {
            if (this.tagName !== 'DIV') return false;
            return this.matches(s.slice(3));
          }
          if (s.startsWith('button[')) {
            if (this.tagName !== 'BUTTON') return false;
            return this.matches(s.slice(6));
          }
          if (s.startsWith('.')) return classes.has(s.slice(1));
          if (s.startsWith('#')) return attrs.get('id') === s.slice(1);
          const attrMatches = [...s.matchAll(/\[([^\]=^]+)(?:(\^)?=["']?([^"'\]]*)["']?)?\]/g)];
          if (attrMatches.length > 0 && attrMatches.map((m) => m[0]).join('') === s) {
            return attrMatches.every(([, k, caret, val]) => {
              if (!attrs.has(k)) return false;
              if (val === undefined) return true;
              const cur = attrs.get(k);
              return caret ? cur.startsWith(val) : cur === val;
            });
          }
          return this.tagName === s.toUpperCase();
        });
      },
      closest(sel) {
        for (let c = this; c; c = c.parentElement) if (c.matches(sel)) return c;
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const ch of n.children) {
            if (ch.matches(sel)) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatch(type, ev = {}) {
        const e = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }, ev);
        for (const fn of [...(listeners.get(type) || [])]) fn(e);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 220, height: 28, right: 220, bottom: 28 }),
      clientWidth: 220,
    };
    return node;
  };
  const html = mkNode('html');
  const head = mkNode('head');
  const body = mkNode('body');
  html.appendChild(head);
  html.appendChild(body);
  const doc = {
    documentElement: html,
    head,
    body,
    createElement: (t) => mkNode(t),
    getElementById: (id) => html.querySelector(`#${id}`),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    document: doc,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class { observe() {} disconnect() {} },
  };
  doc.defaultView = win;
  return { mkNode, html, head, body, doc, win };
}

test('1. Zero :has() across upstream-client.js (source + compiled Ch14), style.css & sidebar-client.js', () => {
  assert.equal((upstreamSrc.match(/:has\(/g) || []).length, 0, 'upstream-client.js must contain 0 :has() selectors');
  assert.equal((styleCss.match(/:has\(/g) || []).length, 0, 'style.css must contain 0 :has() selectors');
  assert.equal((sidebarSrc.match(/:has\s*\(/g) || []).length, 0, 'sidebar-client.js must contain 0 :has() selectors');

  const ch14 = cdp.buildEffortSliderChannelExpression(cdp.DEFAULT_CONFIG);
  assert.ok(ch14.length > 0, 'Channel 14 effortSlider must compile');
  assert.equal((ch14.match(/:has\(/g) || []).length, 0, 'Compiled Channel 14 effortSlider must contain 0 :has()');
});

test('2. All target animations use pure GPU compositor transform/opacity while preserving default frosted-glass & 300Hz smoothness', () => {
  // 2a) style.css: 5 converted @keyframes use only transform/opacity (no --_fa, background-position, box-shadow, background-color)
  for (const name of ['ag-f-ob', 'ag-c-sw', 'ag-sp-t', 'ag-cs-sonar-pulse', 'ag-cs-sonar-pulse-light']) {
    const body = extractKeyframesBody(styleCss, name);
    assert.ok(body, `style.css must keep @keyframes ${name}`);
    assert.equal(/--_fa|background-position|box-shadow|background-color/.test(body), false, `@keyframes ${name} must not animate non-composited properties: ${body}`);
    assert.ok(/transform|opacity/.test(body), `@keyframes ${name} must animate GPU compositor transform/opacity`);
  }
  assert.equal(/@property\s+--_fa\b/.test(styleCss), false, 'style.css must remove @property --_fa');
  assert.equal(/var\(--_fa\)/.test(styleCss), false, 'style.css must remove all var(--_fa) references');

  // Overview running breathing preserves 4s ease-in-out + isolated paint layer (0 will-change)
  const ovShellLine = styleCss.split('\n').find((l) => l.includes('& [data-ag-cs-overview-shell="1"]{')) || '';
  const ovBrLine = styleCss.split('\n').find((l) => l.includes('[data-ag-overview-running="1"]::after') && l.includes('ag-ov-br 4s ease-in-out infinite')) || '';
  assert.ok(ovShellLine.includes('isolation:isolate;'), 'overview shell must set isolation:isolate');
  assert.ok(ovBrLine.includes('contain:paint;transform:translateZ(0);'), 'ag-ov-br::after must isolate paint & promote compositor layer');
  assert.equal(ovBrLine.includes('will-change'), false, 'ag-ov-br::after must not declare static will-change');

  // Preserve default frosted-glass backdrop-filter (300Hz quality redline)
  assert.ok(styleCss.includes('backdrop-filter:blur(16px) saturate(140%)!important'), 'default frosted-glass backdrop-filter must remain intact');

  // 2b) style.css: exact Tailwind classes, precomputed --ag-stream-f0..f4 tokens, .agy-scroll-bottom contain & safe transition
  assert.equal(styleCss.includes('[class*="animate-spin"]'), false);
  assert.equal(styleCss.includes('[class*="animate-pulse"]'), false);
  assert.equal(styleCss.includes('[class*="animate-bounce"]'), false);
  assert.ok(styleCss.includes('.animate-spin,.animate-pulse,.animate-bounce'), 'win-blur pause must use exact .animate-* classes');
  for (let i = 0; i <= 4; i += 1) {
    assert.ok(styleCss.includes(`:root::highlight(ag-stream-f${i}){color:var(--ag-stream-f${i})}`), `::highlight(ag-stream-f${i}) must reference precomputed --ag-stream-f${i}`);
    assert.match(styleCss, new RegExp(`--ag-stream-f${i}:#[0-9A-Fa-f]{8}\\b`), `style.css must precompute static 8-digit hex --ag-stream-f${i} tokens for built-in palettes`);
  }
  const scrollLine = styleCss.split('\n').find((l) => l.includes('& .agy-scroll-bottom{')) || '';
  assert.ok(scrollLine.includes('contain:layout style paint;'), '.agy-scroll-bottom must set contain:layout style paint');
  assert.equal(scrollLine.includes('margin-left'), false, '.agy-scroll-bottom transition must not animate non-composited margin-left');

  // 2c) upstream-client.js: GPU ces-glow-flash / ces-text-bloom, 0 redundant @property, drag-only will-change, explicit .ces-set-opt transition
  const sliderCss = JSON.parse((upstreamSrc.match(/var SLIDER_CSS = ("(?:\\.|[^"\\])*");/) || [])[1] || '""');
  for (const name of ['ces-glow-flash', 'ces-text-bloom']) {
    const body = extractKeyframesBody(sliderCss, name);
    assert.ok(body, `SLIDER_CSS must define @keyframes ${name}`);
    assert.equal(/filter\s*:|text-shadow\s*:/.test(body), false, `@keyframes ${name} must not animate filter or text-shadow: ${body}`);
    assert.ok(/transform|opacity/.test(body), `@keyframes ${name} must animate transform/opacity`);
  }
  assert.equal(/@property\b/.test(sliderCss), false, 'SLIDER_CSS must remove all 3 uninterpolated @property rules');
  const knobRule = (sliderCss.match(/\.ces-knob\{[^}]*\}/) || [])[0] || '';
  assert.equal(knobRule.includes('will-change'), false, '.ces-knob must not declare static will-change');
  assert.ok(sliderCss.includes(".ces-root[data-ces-dragging='1'] .ces-knob{will-change:transform}"), '.ces-knob must apply will-change:transform only while dragging');
  const setOptRule = (sliderCss.match(/\.ces-set-opt\{[^}]*\}/) || [])[0] || '';
  assert.equal(setOptRule.includes('transition:all'), false, '.ces-set-opt must not use transition:all');
  assert.ok(setOptRule.includes('transition:background-color .12s ease,border-color .12s ease,color .12s ease'));

  // 2d) sidebar-client.js: GPU rotate() vessel halo, 0 @property --ag-sb-halo-angle, explicit .ag-prism-sb-pin-drop transition
  const sbCssBlock = (sidebarSrc.match(/const CLIENT_CSS = \[\s*([\s\S]*?)\s*\]\.join\(''\);/) || [])[1] || '';
  const sbCss = vm.runInNewContext(`[${sbCssBlock}]`).join('\n');
  assert.equal(sbCss.includes('@property --ag-sb-halo-angle'), false, 'sidebar-client.js must remove @property --ag-sb-halo-angle');
  assert.equal(sbCss.includes('--ag-sb-halo-angle'), false, 'sidebar-client.js must remove all --ag-sb-halo-angle references');
  assert.ok(sbCss.includes('.ag-prism-vessel-halo{') && sbCss.includes('overflow:hidden;'), 'vessel halo wrapper must clip rotated conic layer via overflow:hidden');
  const haloKf = extractKeyframesBody(sbCss, 'ag-sb-halo');
  assert.ok(haloKf && haloKf.includes('rotate(0deg)') && haloKf.includes('rotate(360deg)'), 'ag-sb-halo must rotate via pure GPU transform');
  assert.ok(sidebarSrc.includes("el('div', 'ag-prism-vessel-halo')"), 'sidebar-client.js must mount .ag-prism-vessel-halo inside .ag-prism-vessel');
  const pinDropRule = (sbCss.match(/\.ag-prism-sb-pin-drop\{[^}]*\}/) || [])[0] || '';
  assert.equal(pinDropRule.includes('transition:all'), false, '.ag-prism-sb-pin-drop must not use transition:all');
  assert.ok(pinDropRule.includes('background-color 150ms ease,border-color 150ms ease'));
});

test('3. Offscreen pause hook [data-ag-offscreen="1"] pauses offscreen indicators only and never affects visible elements', () => {
  const offMatch = flatStyleCss.match(/[^{}]*\[data-ag-offscreen="1"\][^{}]*\{animation-play-state:paused!important\}/);
  assert.ok(offMatch, 'flattened style.css must define [data-ag-offscreen="1"] pause rule');
  const offRule = offMatch[0];
  for (const sel of [
    'html[data-ag-cs-style] [data-ag-offscreen="1"]',
    'html[data-ag-cs-style] [data-ag-offscreen="1"]::before',
    'html[data-ag-cs-style] [data-ag-offscreen="1"]::after',
    'html[data-ag-cs-style] [data-ag-offscreen="1"] [data-agent-state-dot]:first-child',
  ]) {
    assert.ok(offRule.includes(sel), `offscreen pause rule missing selector: ${sel}`);
  }
  assert.ok(offRule.includes('animation-play-state:paused!important'), 'offscreen hook must set animation-play-state:paused!important');
  // Must appear strictly after status-loading-spinner rule so equal-specificity !important wins for offscreen dots
  const spinnerIdx = flatStyleCss.indexOf('[data-testid="status-loading-spinner"]{contain:strict;');
  const offIdx = flatStyleCss.indexOf(offRule);
  assert.ok(spinnerIdx > 0 && offIdx > spinnerIdx, 'offscreen pause rule must follow status-loading-spinner declaration');
  // Every selector in the offscreen rule must be gated by [data-ag-offscreen="1"] so visible rows stay 300Hz
  const selList = offRule.slice(0, offRule.indexOf('{')).split(',');
  for (const s of selList) {
    assert.ok(s.includes('[data-ag-offscreen="1"]'), `every selector in offscreen rule must require [data-ag-offscreen="1"], got: ${s}`);
  }
});

test('4. Runtime attribute tagging replaces all 15 :has() rules in upstream-client.js & toggles drag-only will-change cleanly', () => {
  const env = makeMiniEnv();
  const opts = [
    { label: 'Gemini 4 Carbon (Low)', value: 'c-low' },
    { label: 'Gemini 4 Carbon (High)', value: 'c-high' },
    { label: 'Orchestrator', value: 'orch' },
  ];
  const effortIdx = new Map([['Gemini 4 Carbon', new Map([['low', opts[0]], ['high', opts[1]]])]]);
  const gmFiber = {
    memoizedProps: { value: { setModelConfigByLabelForConversation() {}, setCurrentModelConfigByLabel() {} } },
    return: null,
  };
  const fiber = {
    memoizedProps: {
      value: {
        effortIndex: effortIdx,
        modelOptions: opts,
        selectedModel: opts[1],
        orchestratorPlanners: [opts[0], opts[1]],
        orchestratorPlannerIndex: effortIdx,
        orchestratorDefaultPlanner: opts[1],
        orchestratorPick: { model: opts[1].value, select() {} },
      },
    },
    return: gmFiber,
  };

  const trigger = env.mkNode('button', { attrs: { 'data-testid': 'model-selector-trigger', 'aria-expanded': 'true' }, text: 'Gemini 4 Carbon High' });
  trigger.__reactFiber$t = fiber;
  env.body.appendChild(trigger);

  const panel = env.mkNode('div', { attrs: { 'data-testid': 'model-selector-panel' } });
  panel.__reactFiber$t = fiber;
  const listWrap = env.mkNode('div');
  const groupItem = env.mkNode('div', { attrs: { role: 'menuitem' } });
  const groupSpan = env.mkNode('span', { attrs: { 'data-testid': 'model-selector-effort-group', 'data-model-base': 'Gemini 4 Carbon' }, text: 'Gemini 4 Carbon' });
  groupItem.appendChild(groupSpan);
  listWrap.appendChild(groupItem);
  panel.appendChild(listWrap);
  env.body.appendChild(panel);

  // Native effort option submenu + presentation wrapper (should be tagged data-ces-hide-panel="1")
  const effPres = env.mkNode('div', { attrs: { role: 'presentation' } });
  const effMenu = env.mkNode('div', { attrs: { role: 'menu' } });
  effMenu.appendChild(env.mkNode('div', { attrs: { 'data-testid': 'model-selector-effort-option' }, text: 'High' }));
  effPres.appendChild(effMenu);
  env.body.appendChild(effPres);

  // L2 orchestrator submenu with trailing non-check icon span and nested L3 effort menu
  const l2Pres = env.mkNode('div', { attrs: { role: 'presentation' } });
  const l2Menu = env.mkNode('div', { attrs: { role: 'menu' } });
  const l2Row = env.mkNode('div', { attrs: { role: 'menuitem', 'data-testid': 'orchestrator-picker-row' } });
  l2Row.appendChild(env.mkNode('span', { text: 'Gemini 4 Carbon' }));
  const chevWrap = env.mkNode('span');
  chevWrap.appendChild(env.mkNode('svg', { className: 'lucide-chevron-right' }));
  l2Row.appendChild(chevWrap);
  l2Menu.appendChild(l2Row);

  const l3Pres = env.mkNode('div', { attrs: { role: 'presentation' } });
  const l3Menu = env.mkNode('div', { attrs: { role: 'menu' } });
  const l3Eff = env.mkNode('div', { attrs: { 'data-testid': 'orchestrator-picker-effort' }, text: 'High' });
  l3Menu.appendChild(l3Eff);
  l3Pres.appendChild(l3Menu);
  l2Menu.appendChild(l3Pres);
  l2Pres.appendChild(l2Menu);
  env.body.appendChild(l2Pres);

  const obs = upstreamMod.installAntigravityObserver({ document: env.doc, window: env.win, MutationObserver: env.win.MutationObserver });
  try {
    assert.equal(env.html.getAttribute('data-ces-slider-ready'), '1');
    assert.equal(groupItem.getAttribute('data-ces-effort-group-item'), '1', 'effort-group menuitem must get data-ces-effort-group-item=1');
    assert.equal(effMenu.getAttribute('data-ces-hide-panel'), '1', 'native effort submenu must get data-ces-hide-panel=1');
    assert.equal(effPres.getAttribute('data-ces-hide-panel'), '1', 'native effort presentation wrapper must get data-ces-hide-panel=1');
    assert.equal(l2Menu.getAttribute('data-ag-cs-orch-l2'), '1');
    assert.equal(l2Menu.hasAttribute('data-ces-hide-panel'), false, 'L2 menu must never get data-ces-hide-panel');
    assert.equal(l2Pres.hasAttribute('data-ces-hide-panel'), false, 'L2 presentation wrapper must never get data-ces-hide-panel');
    assert.equal(chevWrap.getAttribute('data-ces-has-icon'), '1', 'L2 row trailing non-check icon span must get data-ces-has-icon=1');
    assert.equal(l3Eff.getAttribute('data-ces-hide-panel'), '1');
    assert.equal(l3Menu.getAttribute('data-ces-hide-panel'), '1');
    assert.equal(l3Pres.getAttribute('data-ces-hide-panel'), '1');

    // Drag-only will-change hook on .ces-root
    const sliderRoot = panel.querySelector('.ces-root');
    const track = panel.querySelector('.ces-track');
    assert.ok(sliderRoot && track);
    assert.equal(sliderRoot.hasAttribute('data-ces-dragging'), false, 'idle slider must not set data-ces-dragging');
    track.dispatch('pointerdown', { button: 0, clientX: 60, pointerId: 1 });
    assert.equal(sliderRoot.getAttribute('data-ces-dragging'), '1', 'dragging slider must set data-ces-dragging=1');
    track.dispatch('pointerup', { button: 0, clientX: 120, pointerId: 1 });
    assert.equal(sliderRoot.hasAttribute('data-ces-dragging'), false, 'pointerup must clear data-ces-dragging');
  } finally {
    obs.stop();
  }

  // Symmetric cleanup after stop()
  assert.equal(groupItem.hasAttribute('data-ces-effort-group-item'), false);
  assert.equal(effMenu.hasAttribute('data-ces-hide-panel'), false);
  assert.equal(effPres.hasAttribute('data-ces-hide-panel'), false);
  assert.equal(chevWrap.hasAttribute('data-ces-has-icon'), false);
  assert.equal(l3Menu.hasAttribute('data-ces-hide-panel'), false);
});

test('5. style.css .agy-overlay button sizing rule uses zero :has(), skips palette="host", and exempts agy-powertools popups and subagent buttons', () => {
  assert.equal(styleCss.includes(':has('), false, 'style.css must keep strictly 0 :has()');
  assert.equal(flatStyleCss.includes(':has('), false, 'flattened style.css must keep strictly 0 :has()');

  const rawRuleLine = styleCss
    .split('\n')
    .find((l) => l.includes('.agy-overlay:not([data-hover-card-popup])') && l.includes('min-height:30px!important'));
  assert.ok(rawRuleLine, 'style.css must contain the .agy-overlay menu item sizing rule');
  assert.ok(
    rawRuleLine.startsWith('&:not([data-ag-cs-palette="host"]) .agy-overlay:not('),
    '.agy-overlay item sizing rule must gate on &:not([data-ag-cs-palette="host"]) just like the overlay shell rule'
  );
  for (const requiredExcl of [
    ':not([data-testid="agy-context-popup"])',
    ':not([data-testid="agy-subagent-popover"])',
    ':not([data-testid="agy-stats-popup"])',
    ':not([data-testid^="agy-subagent-ctx-"])',
    ':not([data-testid="agy-subagent-open-btn"])',
    ':not([data-testid="agy-context-popup"] *)',
    ':not([data-testid="agy-subagent-popover"] *)',
    ':not([data-testid="agy-stats-popup"] *)',
  ]) {
    assert.ok(rawRuleLine.includes(requiredExcl), `style.css .agy-overlay rule missing exclusion: ${requiredExcl}`);
  }

  // Verify flattened output preserves host-palette guard, all agy-powertools popup/descendant exclusions (with descendant space intact) & normal menu item styling
  const flatMatch = flatStyleCss.match(/[^{}]*agy-context-popup[^{}]*\{[^}]*min-height:30px!important[^}]*\}/);
  assert.ok(flatMatch, 'flattened CSS must retain .agy-overlay sizing rule with agy-context-popup exclusion');
  const flatSel = flatMatch[0].slice(0, flatMatch[0].indexOf('{'));
  assert.ok(flatSel.includes('html[data-ag-cs-style]:not([data-ag-cs-palette="host"])'), 'flattened selector must keep :not([data-ag-cs-palette="host"])');
  assert.ok(
    flatSel.includes(':not([data-testid="agy-context-popup"]):not([data-testid="agy-subagent-popover"]):not([data-testid="agy-stats-popup"])'),
    'flattened selector must exempt all 3 agy-powertools popup containers'
  );
  assert.ok(flatSel.includes('button:not(.ces-knob):not([data-testid^="permissions-"]):not([data-testid^="agy-subagent-ctx-"]):not([data-testid="agy-subagent-open-btn"])'), 'flattened selector must exempt agy-powertools subagent buttons');
  assert.ok(
    flatSel.includes(':not([data-testid="agy-context-popup"] *):not([data-testid="agy-subagent-popover"] *):not([data-testid="agy-stats-popup"] *)'),
    'flattened selector must preserve all 3 complex :not([data-testid="..."] *) descendant exclusions with whitespace intact'
  );
  assert.ok(flatSel.includes('.agy-overlay-item') && flatSel.includes('[role="menuitem"]'), 'normal host overlay menu items must stay styled');
});

test('6. style.css bottom-0 fade overlay mask rule excludes [data-testid="conversation-navigator"] and full-height side rails with 0 :has()', () => {
  assert.equal(styleCss.includes(':has('), false, 'style.css must keep strictly 0 :has()');
  assert.equal(flatStyleCss.includes(':has('), false, 'flattened style.css must keep strictly 0 :has()');

  const rawLine = styleCss
    .split('\n')
    .find((l) => l.includes('div.pointer-events-none[class*="bottom-0"]') && l.includes('opacity:0!important'));
  assert.ok(rawLine, 'style.css must define the bottom-0 fade overlay hide rule');

  const splitTopLevelSelectors = (selText) => {
    const out = [];
    let pDepth = 0;
    let bDepth = 0;
    let quote = '';
    let start = 0;
    for (let i = 0; i < selText.length; i += 1) {
      const ch = selText[i];
      if (quote) {
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') pDepth += 1;
      else if (ch === ')') pDepth = Math.max(0, pDepth - 1);
      else if (ch === '[') bDepth += 1;
      else if (ch === ']') bDepth = Math.max(0, bDepth - 1);
      else if (ch === ',' && pDepth === 0 && bDepth === 0) {
        out.push(selText.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(selText.slice(start).trim());
    return out.filter(Boolean);
  };

  const requiredExcl = ':not([data-testid="conversation-navigator"]):not([class*="inset-y-0"]):not([class*="top-0"])';
  const rawBodyStart = rawLine.indexOf('{');
  const rawBranches = splitTopLevelSelectors(rawLine.slice(0, rawBodyStart));
  assert.equal(rawBranches.length, 2, `expected 2 selector branches on bottom-0 fade rule, got ${rawBranches.length}`);
  for (const branch of rawBranches) {
    assert.ok(
      branch.includes(`div.pointer-events-none[class*="bottom-0"]${requiredExcl}`),
      `source branch must restrict to bottom-0 and exclude conversation-navigator & full-height rails: ${branch}`
    );
  }

  const flatMatches = [...flatStyleCss.matchAll(/([^{}]+)\{([^{}]*opacity:0!important[^{}]*)\}/g)];
  const fadeRules = flatMatches.filter((m) => m[1].includes('pointer-events-none'));
  assert.equal(fadeRules.length, 1, `expected exactly 1 flattened pointer-events-none opacity:0 rule, got ${fadeRules.length}`);

  const flatBranches = splitTopLevelSelectors(fadeRules[0][1]);
  assert.equal(flatBranches.length, 2, 'flattened bottom-0 fade rule must preserve both branches');
  for (const branch of flatBranches) {
    assert.ok(
      branch.includes(`div.pointer-events-none[class*="bottom-0"]${requiredExcl}`),
      `flattened branch must restrict to bottom-0 and exclude conversation-navigator & full-height rails: ${branch}`
    );
  }

  // Evaluate simplified selector semantics against real host DOM shapes for conversation-navigator vs bottom fade overlay
  const matchesTargetDiv = (branch, divSpec) => {
    const tail = branch.slice(branch.lastIndexOf('div.pointer-events-none'));
    const cls = String(divSpec.className || '');
    const testId = String(divSpec.testId || '');
    if (!cls.split(/\s+/).includes('pointer-events-none')) return false;
    if (tail.includes('[class*="bottom-0"]') && !cls.includes('bottom-0')) return false;
    if (tail.includes(':not([data-testid="conversation-navigator"])') && testId === 'conversation-navigator') return false;
    if (tail.includes(':not([class*="inset-y-0"])') && cls.includes('inset-y-0')) return false;
    if (tail.includes(':not([class*="top-0"])') && cls.includes('top-0')) return false;
    return true;
  };

  // Host left Q&A dot rail variants must NEVER be hidden by either branch
  const protectedRails = [
    { testId: 'conversation-navigator', className: 'pointer-events-none absolute inset-y-0 left-0 flex flex-col' },
    { testId: 'conversation-navigator', className: 'pointer-events-none absolute left-0 top-0 bottom-0' },
    { testId: 'conversation-navigator', className: 'pointer-events-none flex' },
    { testId: '', className: 'pointer-events-none absolute inset-y-0 left-0 z-10' },
    { testId: '', className: 'pointer-events-none absolute top-0 bottom-0 left-0 z-10' },
  ];
  for (const rail of protectedRails) {
    for (const branch of flatBranches) {
      assert.equal(
        matchesTargetDiv(branch, rail),
        false,
        `bottom-0 fade branch must NEVER match host nav rail (${JSON.stringify(rail)}): ${branch}`
      );
    }
  }

  // Genuine bottom fade overlay must STILL be matched and hidden by both branches
  const realBottomMask = { testId: '', className: 'pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t' };
  for (const branch of flatBranches) {
    assert.equal(matchesTargetDiv(branch, realBottomMask), true, `genuine bottom fade mask must still match: ${branch}`);
  }

  // Confirm conversation-navigator pointer-events rule remains intact and no other opacity:0 rule targets it
  assert.ok(
    flatStyleCss.includes('html[data-ag-cs-style] [data-testid="conversation-navigator"]{pointer-events:auto!important}'),
    'flattened CSS must preserve [data-testid="conversation-navigator"]{pointer-events:auto!important}'
  );
  for (const [, sel] of flatMatches) {
    assert.equal(
      /(?:^|[\s,>~+])\[data-testid="conversation-navigator"\]/.test(sel),
      false,
      `no opacity:0!important rule may directly target [data-testid="conversation-navigator"]: ${sel}`
    );
  }
});

test('sidebar conversation rows unify padding-left:30px!important so pinned rows align with grouped rows and clear the left accent bar', () => {
  const targetSel = 'html[data-ag-cs-style][data-ag-cs-sidebar="on"] [data-testid="conversation-row-sidebar"]';
  const flatRules = [...flatStyleCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  const baseRowRule = flatRules.find((m) => m[1].trim() === targetSel && m[2].includes('padding-block:4px!important'));
  assert.ok(baseRowRule, `flattened CSS must contain base sidebar row rule for ${targetSel}`);
  const decls = baseRowRule[2];
  assert.ok(
    decls.includes('padding-left:30px!important'),
    `base sidebar row rule must enforce padding-left:30px!important to align px-2 pinned rows with pl-[30px] normal rows: ${decls}`
  );
  assert.equal(
    /(?:^|;)padding(?:-right|-inline)?\s*:/.test(decls),
    false,
    `base sidebar row rule must not use padding/padding-right/padding-inline shorthand that could clobber host pr-2 or trigger CSSOM bugs: ${decls}`
  );

  // Compact sidebar mode must keep inheriting padding-left:30px without resetting horizontal padding
  const compactSel = 'html[data-ag-cs-style][data-ag-cs-sidebar="on"][data-ag-cs-sidebar-compact="on"] [data-testid="conversation-row-sidebar"]';
  const compactRowRule = flatRules.find((m) => m[1].trim() === compactSel);
  assert.ok(compactRowRule, `flattened CSS must retain compact sidebar row rule for ${compactSel}`);
  assert.equal(
    /padding-left\s*:/.test(compactRowRule[2]),
    false,
    `compact sidebar row rule must inherit padding-left:30px!important without overriding it: ${compactRowRule[2]}`
  );

  // Top sidebar nav buttons and project headers must NEVER receive padding-left:30px!important
  const pl30Rules = flatRules.filter((m) => m[2].includes('padding-left:30px!important'));
  assert.equal(pl30Rules.length, 1, `expected exactly 1 padding-left:30px!important rule, got ${pl30Rules.length}`);
  assert.equal(pl30Rules[0][1].trim(), targetSel);
  for (const excluded of ['new-conversation-button', 'automations-button', 'project-header']) {
    assert.equal(
      pl30Rules[0][1].includes(excluded),
      false,
      `padding-left:30px!important must never target ${excluded}`
    );
  }
});
