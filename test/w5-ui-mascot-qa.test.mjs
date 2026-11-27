// Wave 5 UI/Mascot/QA 综合回归单测：CSS 分片无错分、PR #114 首页顶栏避让、问答卡第 0 帧 peek+边光、排队窗口动效+桌宠上跳与重力落地
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const cssFlatten = require(path.join(ROOT, 'src', 'compiler', 'css-flatten.cjs'));
const cssPack = require(path.join(ROOT, 'src', 'compiler', 'css-pack.cjs'));
const hopMod = require(path.join(ROOT, 'src', 'runtime', 'mascot-hop-transition.js'));
const rigMod = require(path.join(ROOT, 'dual-mascot-rig.js'));
const rimMod = require(path.join(ROOT, 'prism-rim-canvas.js'));
const hopSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'mascot-hop-transition.js'), 'utf8');
const rigSrc = fs.readFileSync(path.join(ROOT, 'dual-mascot-rig.js'), 'utf8');
const rimSrc = fs.readFileSync(path.join(ROOT, 'prism-rim-canvas.js'), 'utf8');
const uiMainFactory = require(path.join(ROOT, 'ui-runtime.js'));
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));

function createQaDomEnv({ reducedMatches = false } = {}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const timers = new Map();
  const rafs = [];
  const mos = [];
  let timerSeq = 1;
  let nowMs = 1000;

  const addL = (m, t, fn, o) => { if (!m.has(t)) m.set(t, new Set()); m.get(t).add({ fn, o }); };
  const remL = (m, t, fn) => { const s = m.get(t); if (s) for (const r of s) if (r.fn === fn) s.delete(r); };

  function matchSimple(el, sel) {
    if (!sel || sel === '*') return true;
    let rest = sel.trim();
    for (const nm of [...rest.matchAll(/:not\(([^)]+)\)/g)]) {
      if (matchSimple(el, nm[1])) return false;
      rest = rest.replace(nm[0], '');
    }
    const tm = rest.match(/^([a-zA-Z0-9_-]+)/);
    if (tm) {
      if (el.tagName.toLowerCase() !== tm[1].toLowerCase()) return false;
      rest = rest.slice(tm[0].length);
    }
    const im = rest.match(/#((?:\\.|[a-zA-Z0-9_-])+)/);
    if (im) {
      if (el.id !== im[1].replace(/\\(.)/g, '$1')) return false;
      rest = rest.replace(im[0], '');
    }
    for (const cm of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!el.classList.contains(cm[1])) return false;
    }
    for (const am of rest.matchAll(/\[([^\]=^$*]+)(?:([\^$*]?)=["']?([^"'\]]*)["']?)?\]/g)) {
      const val = el.getAttribute(am[1]);
      if (am[3] === undefined) { if (val === null) return false; }
      else if (am[2] === '^') { if (!val || !val.startsWith(am[3])) return false; }
      else if (am[2] === '$') { if (!val || !val.endsWith(am[3])) return false; }
      else if (am[2] === '*') { if (!val || !val.includes(am[3])) return false; }
      else if (val !== am[3]) return false;
    }
    return true;
  }

  function matchSelector(el, sel) {
    return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((part) => {
      const hasDirect = part.includes('>');
      if (hasDirect) {
        const segs = part.split(/\s*>\s*/);
        if (!matchSimple(el, segs[segs.length - 1])) return false;
        let cur = el.parentElement;
        for (let i = segs.length - 2; i >= 0; i--) {
          if (!cur || !matchSimple(cur, segs[i])) return false;
          cur = cur.parentElement;
        }
        return true;
      }
      const toks = part.split(/\s+/);
      if (!matchSimple(el, toks[toks.length - 1])) return false;
      if (toks.length === 1) return true;
      let p = el.parentElement;
      let idx = toks.length - 2;
      while (p && idx >= 0) {
        if (matchSimple(p, toks[idx])) idx--;
        p = p.parentElement;
      }
      return idx < 0;
    });
  }

  function mkEl(tag, attrs = {}, rect = null) {
    const attrMap = new Map();
    const children = [];
    const styleProps = new Map();
    const elListeners = new Map();
    const style = new Proxy({
      getPropertyValue(k) { return styleProps.get(k) || ''; },
      setProperty(k, v) { styleProps.set(k, String(v)); },
      removeProperty(k) { styleProps.delete(k); },
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        const cssName = String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        return styleProps.get(prop) ?? styleProps.get(cssName) ?? '';
      },
      set(target, prop, val) {
        const cssName = String(prop).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        if (val === '' || val == null) { styleProps.delete(prop); styleProps.delete(cssName); }
        else { styleProps.set(prop, String(val)); styleProps.set(cssName, String(val)); }
        return true;
      },
    });
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
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx >= 0 ? this.parentElement.children[idx + 1] || null : null;
      },
      get previousElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx > 0 ? this.parentElement.children[idx - 1] || null : null;
      },
      get isConnected() {
        for (let c = this; c; c = c.parentNode) if (c === html || c === doc) return true;
        return false;
      },
      hidden: false,
      style,
      dataset: {},
      _text: '',
      _rect: rect || { left: 20, top: 420, width: 640, height: 96, right: 660, bottom: 516 },
      get clientWidth() { return this._rect.width; },
      get clientHeight() { return this._rect.height; },
      get offsetWidth() { return this._rect.width; },
      get offsetHeight() { return this._rect.height; },
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
          cs.forEach((c) => c && s.add(c));
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
      appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; children.push(c); return c; },
      insertBefore(c, ref) {
        if (c.parentNode) c.remove();
        c.parentNode = this;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, c); else children.push(c);
        return c;
      },
      removeChild(c) {
        const i = children.indexOf(c);
        if (i >= 0) { children.splice(i, 1); c.parentNode = null; }
        return c;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      contains(o) { for (let c = o; c; c = c.parentNode) if (c === this) return true; return false; },
      matches(sel) { return matchSelector(this, sel); },
      closest(sel) { for (let c = this; c && c.nodeType === 1; c = c.parentElement) if (c.matches(sel)) return c; return null; },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
        walk(this);
        return out;
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
      getContext: tag.toLowerCase() === 'canvas'
        ? () => ({
            clearRect() {}, save() {}, restore() {}, fillRect() {}, setTransform() {},
            translate() {}, scale() {}, rotate() {}, beginPath() {}, arc() {}, fill() {},
            stroke() {}, moveTo() {}, lineTo() {}, drawImage() {}, roundRect() {}, clip() {},
            createRadialGradient: () => ({ addColorStop() {} }),
            createLinearGradient: () => ({ addColorStop() {} }),
          })
        : undefined,
      addEventListener(t, fn, o) { addL(elListeners, t, fn, o); },
      removeEventListener(t, fn) { remL(elListeners, t, fn); },
      dispatchEvent(ev) {
        const s = elListeners.get(ev.type);
        if (s) for (const r of [...s]) r.fn({ target: this, preventDefault() {}, stopPropagation() {}, ...ev });
      },
    };
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    return el;
  }

  const html = mkEl('html', {}, { left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 });
  const head = mkEl('head');
  const body = mkEl('body', {}, { left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 });
  html.appendChild(head);
  html.appendChild(body);

  class MockMO {
    constructor(cb) { this.cb = cb; this.target = null; this.opts = null; this.disconnected = false; mos.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.disconnected = true; }
    takeRecords() { return []; }
    trigger(recs) { if (!this.disconnected) this.cb(recs); }
  }

  const win = {
    location: { pathname: '/c/55555555-5555-5555-5555-555555555555', href: 'vscode-file://vscode-app/index.html' },
    navigator: { language: 'zh-CN' },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    performance: { now: () => nowMs },
    requestAnimationFrame(fn) { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms = 0) {
      const id = timerSeq++;
      timers.set(id, { fn, runAt: nowMs + Math.max(0, Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 1,
    clearInterval() {},
    matchMedia: (q) => ({ matches: String(q).includes('prefers-reduced-motion') ? reducedMatches : false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: (el) => ({
      display: el?.style?.display || 'block',
      visibility: el?.style?.visibility || 'visible',
      opacity: el?.style?.opacity || '1',
      position: el?.style?.position || 'relative',
      borderRadius: '10px',
      getPropertyValue: () => '',
    }),
    MutationObserver: MockMO,
    ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: (t, fn, o) => addL(winListeners, t, fn, o),
    removeEventListener: (t, fn) => remL(winListeners, t, fn),
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON, Proxy, Error,
  };

  const doc = {
    hidden: false,
    readyState: 'complete',
    defaultView: win,
    documentElement: html,
    head,
    body,
    hasFocus: () => true,
    createElement: (t) => mkEl(t),
    createElementNS: (_ns, t) => mkEl(t),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    getElementById: (id) => html.getElementById(id),
    contains: (n) => html.contains(n),
    addEventListener: (t, fn, o) => addL(docListeners, t, fn, o),
    removeEventListener: (t, fn) => remL(docListeners, t, fn),
  };
  win.document = doc;
  win.window = win;
  win.globalThis = win;

  function flushRaf(step = 16) {
    nowMs += step;
    const batch = rafs.splice(0, rafs.length);
    for (const fn of batch) fn(nowMs);
  }

  function advanceTimers(deltaMs) {
    const end = nowMs + deltaMs;
    while (true) {
      let pick = null;
      for (const [id, rec] of timers.entries()) {
        if (rec.runAt <= end && (!pick || rec.runAt < pick.rec.runAt)) pick = { id, rec };
      }
      if (!pick) break;
      timers.delete(pick.id);
      nowMs = pick.rec.runAt;
      pick.rec.fn();
    }
    nowMs = end;
  }

  return { win, doc, html, head, body, mkEl, mos, rafs, timers, flushRaf, advanceTimers };
}

test('1) CSS bucket classifier: 0 mixed-rule misrouting, step-plan/overview rim-cv strictly in core, 0 [composer="on"][composer="off"], dark-chat < 180 KB', () => {
  const rawCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.equal(/:has\(/.test(rawCss), false, 'style.css must have 0 :has()');
  assert.equal(/[^\x00-\x7F]/.test(rawCss), false, 'style.css must be 100% ASCII');

  const flatMin = cssPack.minifyCss(cssFlatten.flattenNestedCss(cssPack.minifyCss(rawCss)));
  assert.equal(
    flatMin.includes('[data-ag-cs-composer="on"][data-ag-cs-composer="off"]'),
    false,
    'Flattened CSS must contain 0 contradictory [data-ag-cs-composer="on"][data-ag-cs-composer="off"] selectors'
  );

  const buckets = cssPack.splitCssIntoBuckets(flatMin);
  // Regression guard: step-plan & overview-shell rim canvas MUST stay in core with position:absolute!important
  const coreRules = cssPack.splitTopLevelCssRules(buckets.core);
  const rimPosRule = coreRules.find(
    (r) => r.includes('[data-ag-cs-prism-mirror="1"]>.ag-cs-prism-rim-cv') && r.includes('[data-testid="step-plan"]>.ag-cs-prism-rim-cv')
  );
  assert.ok(rimPosRule && rimPosRule.includes('position:absolute!important'), 'step-plan & overview-shell .ag-cs-prism-rim-cv position:absolute!important must stay in core');

  // Shared scrollbars, prefers-reduced-motion, global backdrop-filter:none, pre/code MUST NOT leak into viewHome/viewSettings/thoughtExt
  assert.equal(buckets.viewHome.includes('.ag-cs-prism-rim-cv'), false, 'viewHome must never swallow shared .ag-cs-prism-rim-cv rules');
  assert.equal(buckets.viewHome.includes('::-webkit-scrollbar'), false, 'viewHome must never swallow shared scrollbar rules');
  assert.equal(buckets.viewHome.includes('prefers-reduced-motion'), false, 'viewHome must never swallow global prefers-reduced-motion media block');
  assert.equal(buckets.viewSettings.includes('backdrop-filter:none'), false, 'viewSettings must never swallow global backdrop-filter:none degradation rules');
  assert.equal(buckets.viewSettings.includes('.agy-field'), false, 'viewSettings must never swallow shared .agy-field rules');
  assert.equal(buckets.viewSettings.includes('[data-slot="toggle-group"]'), false, 'viewSettings must never swallow shared [data-slot="toggle-group"] rules');
  assert.equal(buckets.thoughtExt.includes('monaco-editor'), false, 'thoughtExt must never swallow shared pre/code font rules');

  // Synthetic unit verification of strict multi-branch & :is() classification
  assert.equal(
    cssPack.classifyCssRule('html[data-ag-cs-style] :is([data-testid="step-plan"]>.ag-cs-prism-rim-cv,.ag-cs-home-panel>.ag-cs-prism-rim-cv){position:absolute!important}'),
    'core'
  );
  assert.equal(
    cssPack.classifyCssRule('html[data-ag-cs-style] .agy-home .foo,html[data-ag-cs-style] .ag-cs-home-card{color:red}'),
    'viewHome'
  );
  assert.equal(
    cssPack.classifyCssRule('html[data-ag-cs-style] .agy-home .foo,html[data-ag-cs-style] .generic-card{color:red}'),
    'core'
  );
  assert.equal(
    cssPack.classifyCssRule('@media (prefers-reduced-motion:reduce){html[data-ag-cs-style] .ag-cs-home-card{animation:none}html[data-ag-cs-style] .generic{animation:none}}'),
    'core'
  );

  // Active dark-chat CSS budget (< 180 KB)
  const darkChatActive = ['core', 'viewSidebar', 'motionFull'].reduce((s, k) => s + Buffer.byteLength(buckets[k] || '', 'utf8'), 0);
  assert.ok(darkChatActive < 180 * 1024, `Dark-chat active CSS (${darkChatActive} B) must stay strictly < 180 KB`);

  // Sidebar selected & selected-running restrained obsidian-glass optics + strict 0 content-visibility on conversation-row-sidebar
  const sbDarkLine =
    rawCss.split('\n').find((l) => l.includes('[data-testid="conversation-row-sidebar"],.agy-sidebar-row') && l.includes('[data-ag-cs-row-running="1"]')) || '';
  const sbLightLine =
    rawCss.split('\n').find((l) => l.includes('[data-testid="conversation-row-sidebar"],.agy-sidebar-row)[data-selected="true"]')) || '';
  assert.ok(
    rawCss.includes('--_ss:rgba(255,255,255,.068);') &&
      rawCss.includes('--_sy:inset 0 1px 0 rgba(255,255,255,.15),inset 0 0 0 1px rgba(255,255,255,.085),0 2px 10px -4px rgba(0,0,0,.52);') &&
      sbDarkLine.includes('radial-gradient(58% 130% at 0% 50%,color-mix(in srgb,var(--ag-cs-accent) 13%,transparent),transparent 68%)') &&
      sbDarkLine.includes('&[data-selected="true"]{background-image:radial-gradient(58% 130% at 0% 50%,color-mix(in srgb,var(--ag-cs-accent) 13%,transparent),transparent 68%),var(--ag-cs-run-wash)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 0 0 1px rgba(255,255,255,.11),0 4px 12px -4px rgba(0,0,0,.58)!important}') &&
      !sbDarkLine.includes('var(--_s1)') &&
      sbLightLine.includes('radial-gradient(54% 130% at 0% 50%') &&
      !sbLightLine.includes('var(--_s1)'),
    'style.css must use restrained obsidian-glass card + subtle left-edge diffusion for selected and selected-running sidebar rows without harsh --_s1 outline'
  );
  const sbRowRules = coreRules.concat(cssPack.splitTopLevelCssRules(buckets.viewSidebar)).filter((r) => r.includes('conversation-row-sidebar'));
  assert.equal(
    sbRowRules.some((r) => r.includes('content-visibility')),
    false,
    'conversation-row-sidebar must NEVER use content-visibility'
  );
});

test('2) PR #114 home top-toolbar clearance + ask_question frame-0 peek/pointer-events/prism-rim without session switch', async () => {
  const env = createQaDomEnv();
  const home = env.mkEl('div', { class: 'agy-home' }, { left: 0, top: 0, width: 1200, height: 760, right: 1200, bottom: 760 });
  const inputBox = env.mkEl('div', { 'data-testid': 'agent-input-box' }, { left: 200, top: 460, width: 640, height: 140, right: 840, bottom: 600 });
  const shell = env.mkEl('div', { id: 'antigravity.agentSidePanelInputBox' }, { left: 200, top: 420, width: 640, height: 140, right: 840, bottom: 560 });
  const topToolbar = env.mkEl('div', { 'data-testid': 'input-box-bottom-toolbar' }, { left: 200, top: 420, width: 640, height: 34, right: 840, bottom: 454 });
  const composerCard = env.mkEl('div', { class: 'surface-composer-card' }, { left: 200, top: 460, width: 640, height: 96, right: 840, bottom: 556 });
  shell.appendChild(topToolbar);
  shell.appendChild(composerCard);
  inputBox.appendChild(shell);
  home.appendChild(inputBox);
  env.body.appendChild(home);

  env.win.__agPrismI18nCore = i18nCore;
  env.win.__agPrismI18nLocales = i18nLocales;
  vm.runInNewContext(rigSrc, env.win);
  vm.runInNewContext(rimSrc, env.win);
  vm.runInNewContext(hopSrc, env.win);

  vm.runInNewContext(
    `(${uiMainFactory.toString()})(${JSON.stringify({ ...cdp.DEFAULT_CONFIG, mascot: 'crab', motionLevel: 'standard', smoothCaret: false })}, { version: '1.0.8-beta.4', codeHash: 'w5-qa-1' });`,
    env.win
  );
  const api = env.win.__agPrism;
  let rig = null;
  try {
    env.flushRaf();

    // PR #114: home top toolbar receives data-ag-cs-top-toolbar="1" and mascot stays full-height (NOT peek)
    assert.equal(topToolbar.getAttribute('data-ag-cs-top-toolbar'), '1', 'Home top toolbar above composer must receive data-ag-cs-top-toolbar="1"');
    const stage = composerCard.querySelector('.ag-cs-crab');
    assert.ok(stage, 'Mascot stage must mount on composer card');
    assert.equal(stage.hasAttribute('data-ag-mascot-peek'), false, 'Home top toolbar clearance must NOT trigger mascot peek');

    // Switch to conversation view & simulate async React mount of ask_question takeover card with initial 0px height!
    home.remove();
    const conv = env.mkEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': '55555555-5555-5555-5555-555555555555' }, { left: 0, top: 0, width: 1200, height: 760, right: 1200, bottom: 760 });
    const convWrap = env.mkEl('div', { class: 'relative flex flex-col' }, { left: 200, top: 420, width: 640, height: 180, right: 840, bottom: 600 });
    const convInputBox = env.mkEl('div', { 'data-testid': 'agent-input-box' }, { left: 200, top: 460, width: 640, height: 110, right: 840, bottom: 570 });
    const convCard = env.mkEl('div', { class: 'surface-composer-card' }, { left: 200, top: 460, width: 640, height: 96, right: 840, bottom: 556 });
    convInputBox.appendChild(convCard);
    convWrap.appendChild(convInputBox);
    conv.appendChild(convWrap);
    env.body.appendChild(conv);
    api.sync();
    env.flushRaf();

    const convStage = convCard.querySelector('.ag-cs-crab');
    assert.ok(convStage, 'Mascot stage must mount on conversation composer');

    // Async insert of takeover card (frame 0: height=0 before layout settle) — NO session switch!
    const tkHost = env.mkEl('div', { class: 'relative z-[1] mb-1 flex flex-col' }, { left: 200, top: 360, width: 640, height: 0, right: 840, bottom: 360 });
    const tkFrame = env.mkEl('div', { class: 'agy-takeover-frame', 'data-testid': 'interaction-takeover-card' }, { left: 200, top: 360, width: 640, height: 0, right: 840, bottom: 360 });
    const opt = env.mkEl('button', { 'data-testid': 'ask-question-option' }, { left: 210, top: 370, width: 600, height: 32, right: 810, bottom: 402 });
    tkFrame.appendChild(opt);
    tkHost.appendChild(tkFrame);
    convWrap.insertBefore(tkHost, convInputBox);

    // Trigger root MutationObserver childList record (same as React mount)
    for (const mo of env.mos) {
      mo.trigger([{ type: 'childList', target: convWrap, addedNodes: [tkHost], removedNodes: [] }]);
    }
    await Promise.resolve();

    assert.equal(env.html.getAttribute('data-ag-cs-takeover-open'), '1', 'Frame-0 takeover mount must set html[data-ag-cs-takeover-open="1"] immediately');
    assert.equal(convStage.getAttribute('data-ag-mascot-peek'), '1', 'Frame-0 takeover mount must force mascot peek immediately without session switch');
    assert.equal(convStage.style.pointerEvents, 'none', 'Mascot host must enforce pointer-events: none during ask_question peek');
    assert.equal(convStage.style.zIndex, '8', 'Mascot host must drop to z-index: 8 during ask_question peek');
    assert.equal(tkFrame.getAttribute('data-ag-cs-prism-box'), '1', 'Frame-0 takeover card must receive data-ag-cs-prism-box="1"');
    assert.equal(tkFrame.getAttribute('data-ag-cs-prism-reflect'), 'bottom', 'Frame-0 takeover card must receive bottom prism reflection');
    const rimCv = tkFrame.querySelector('.ag-cs-prism-rim-cv');
    assert.ok(rimCv, 'Frame-0 takeover card must mount .ag-cs-prism-rim-cv canvas immediately');
    assert.equal(rimCv.style.getPropertyValue('position'), 'absolute', '.ag-cs-prism-rim-cv must carry inline position:absolute double-guard');
    assert.equal(rimCv.style.getPropertyValue('inset'), '0', '.ag-cs-prism-rim-cv must carry inline inset:0 double-guard');
    assert.equal(rimCv.style.getPropertyValue('width'), '100%', '.ag-cs-prism-rim-cv must carry inline width:100% double-guard');
    assert.equal(rimCv.style.getPropertyValue('height'), '100%', '.ag-cs-prism-rim-cv must carry inline height:100% double-guard');
    assert.equal(rimCv.style.getPropertyValue('pointer-events'), 'none', '.ag-cs-prism-rim-cv must carry inline pointer-events:none double-guard');

    // Verify dual-mascot-rig directly in sandboxed clock: peek overrides active overridePose and ignores hover/approach
    const directHost = env.mkEl('div', { class: 'ag-cs-crab ag-cs-dual-stage' });
    convCard.appendChild(directHost);
    rig = env.win.__agDualMascotRig.mountDualMascotStage(directHost, { mascot: 'crab', reducedMotion: false });
    rig.notify('pet');
    rig.setState({ yieldMode: 'peek' });
    assert.equal(directHost.style.pointerEvents, 'none');
    assert.equal(directHost.style.zIndex, '8');
    const snapPeek = rig.getLayoutSnapshot();
    assert.equal(snapPeek.yieldMode, 'peek');
    assert.ok(snapPeek.actors.length > 0 && snapPeek.actors.every((a) => a.pose === 'peek'));
    rig.dispose();
    rig = null;
    // Re-attach home before destroy so destroy() teardown cleanup of data-ag-cs-top-toolbar & takeover attrs is genuinely verified
    env.body.appendChild(home);
  } finally {
    try { rig?.dispose?.(); } catch {}
    try { api?.destroy?.(); } catch {}
  }

  assert.equal(topToolbar.hasAttribute('data-ag-cs-top-toolbar'), false);
  assert.equal(env.html.hasAttribute('data-ag-cs-takeover-open'), false);
  assert.ok(cdp.REMOVE_EXPRESSION.includes('data-ag-cs-top-toolbar'), 'teardown REMOVE_EXPRESSION must strip data-ag-cs-top-toolbar');
});

test('3) Queued messages spring CSS + mascot hop-up & gravity-land animation (squash/stretch/settle, 0 rAF idle, 0fps sleep preserved, rapid-click safe)', async () => {
  const rawCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(rawCss.includes('@keyframes ag-cs-queued-in{') && rawCss.includes('@keyframes ag-q-o{'), 'style.css must define GPU queued enter/exit spring keyframes');
  assert.ok(hopMod.HOP_CSS.includes('@keyframes ag-prism-mascot-hop-up{') && hopMod.HOP_CSS.includes('@keyframes ag-prism-mascot-gravity-land{'), 'HOP_CSS must define hop-up & gravity-land keyframes');
  assert.ok(
    hopMod.HOP_CSS.includes('scale(1.12,.86)') && hopMod.HOP_CSS.includes('scale(.96,1.05)') && hopMod.HOP_CSS.includes('scale(1,1)'),
    'gravity-land keyframes must include squash (1.12, 0.86) -> stretch (0.96, 1.05) -> settle (1, 1)'
  );

  const env = createQaDomEnv();
  const conv = env.mkEl('div', { 'data-testid': 'conversation-view', 'data-cascade-id': '66666666-6666-6666-6666-666666666666' }, { left: 0, top: 0, width: 1200, height: 760, right: 1200, bottom: 760 });
  const inputBox = env.mkEl('div', { 'data-testid': 'agent-input-box' }, { left: 200, top: 440, width: 640, height: 140, right: 840, bottom: 580 });
  const card = env.mkEl('div', { class: 'surface-composer-card' }, { left: 200, top: 484, width: 640, height: 96, right: 840, bottom: 580 });
  inputBox.appendChild(card);
  conv.appendChild(inputBox);
  env.body.appendChild(conv);

  const notifyEvents = [];
  env.win.__agPrismI18nCore = i18nCore;
  env.win.__agPrismI18nLocales = i18nLocales;
  env.win.__agPrismMascotHop = hopMod;
  env.win.__agDualMascotRig = {
    mountDualMascotStage(rootEl) {
      const actor = env.mkEl('div', { class: 'ag-v2-mascot-actor' });
      actor.appendChild(env.mkEl('canvas', { class: 'ag-v2-mascot-canvas' }));
      rootEl.appendChild(actor);
      return {
        setState() {},
        syncPowerState() {},
        notify(ev) { notifyEvents.push(ev); },
        dispose() {},
      };
    },
  };

  vm.runInNewContext(
    `(${uiMainFactory.toString()})(${JSON.stringify({ ...cdp.DEFAULT_CONFIG, mascot: 'crab', motionLevel: 'standard', smoothCaret: false })}, { version: '1.0.8-beta.4', codeHash: 'w5-qa-queued' });`,
    env.win
  );
  const api = env.win.__agPrism;
  env.flushRaf();

  const stage = card.querySelector('.ag-cs-crab');
  assert.ok(stage, 'Mascot starts on composer card');

  // 1) Queued messages card appears above composer -> mascot hops UP onto queued card roof
  const qWrap = env.mkEl('div', { class: 'mb-1' }, { left: 200, top: 424, width: 640, height: 56, right: 840, bottom: 480 });
  const qCard = env.mkEl('div', { 'data-testid': 'queued-messages-card' }, { left: 200, top: 424, width: 640, height: 56, right: 840, bottom: 480 });
  qWrap.appendChild(qCard);
  inputBox.insertBefore(qWrap, card);
  const rafBeforeHop = env.rafs.length;
  api.sync();
  env.flushRaf();

  assert.equal(stage.parentElement, qCard, 'Mascot must anchor onto queued-messages-card roof');
  assert.equal(stage.getAttribute('data-ag-mascot-hop'), 'hop-up', 'Queued popup must trigger hop-up roof transition');
  assert.equal(stage.style.getPropertyValue('--ag-prism-roof-dy'), '56px');
  assert.equal(env.rafs.length, rafBeforeHop, 'hop-up transition must use pure GPU CSS with 0 extra rAF loops');

  // 2) Rapid dismiss while hop-up still running -> safely cancels hop-up and launches gravity-land!
  qWrap.remove();
  api.sync();
  env.flushRaf();

  assert.equal(stage.parentElement, card, 'Mascot must return synchronously to composer card when queued card disappears');
  assert.equal(stage.getAttribute('data-ag-mascot-hop'), 'gravity-land', 'Queued dismiss must trigger gravity-land transition');
  assert.equal(stage.style.getPropertyValue('--ag-prism-roof-dy'), '56px');

  env.advanceTimers(450);
  assert.equal(stage.hasAttribute('data-ag-mascot-hop'), false, 'gravity-land must clean up transition attrs upon landing');
  assert.ok(notifyEvents.includes('roof-land'), 'Completing gravity-land must emit roof-land feedback to mascot rig');
  assert.equal(hopMod.getTransitionState().active, false);
  assert.equal(env.timers.size, 0, 'Zero lingering timers after gravity-land settles');

  // 3) Verify real dual-mascot-rig in sandboxed clock does NOT wake from 0fps hidden sleep when roof-land fires
  const sleepHost = env.mkEl('div', { class: 'ag-cs-crab ag-cs-dual-stage' });
  card.appendChild(sleepHost);
  let sleepRafCalls = 0;
  env.win.requestAnimationFrame = () => { sleepRafCalls++; return sleepRafCalls; };
  env.doc.hidden = true;
  vm.runInNewContext(rigSrc, env.win);
  const sleepRig = env.win.__agDualMascotRig.mountDualMascotStage(sleepHost, { mascot: 'crab', reducedMotion: false });
  sleepRig.syncPowerState();
  sleepRafCalls = 0;
  sleepRig.notify('roof-land');
  assert.equal(sleepRafCalls, 0, 'roof-land must NEVER break strict 0fps hidden sleep');
  sleepRig.dispose();

  api.destroy();
});

test('4) docs/CONTRIBUTORS.md credits @Gruu6y (#111), @DDykarc (#114/#115), and @xiaojiang233 (#112)', () => {
  const contrib = fs.readFileSync(path.join(ROOT, 'docs', 'CONTRIBUTORS.md'), 'utf8');
  assert.ok(contrib.includes('Gruu6y') && contrib.includes('#111'), 'CONTRIBUTORS.md must credit @Gruu6y for PR #111');
  assert.ok(contrib.includes('DDykarc') && contrib.includes('#114') && contrib.includes('#115'), 'CONTRIBUTORS.md must credit @DDykarc for PR #114/#115');
  assert.ok(contrib.includes('xiaojiang233') && contrib.includes('#112'), 'CONTRIBUTORS.md must credit @xiaojiang233 for Issue #112');
});

test('5) prism-rim-canvas: 0-lag scroll/transitionend/animationend & 64ms rect sync, local clipped mirror fillRect, 0.5px deadzone & 0-leak teardown', () => {
  const domBusSrc = fs.readFileSync(path.join(ROOT, 'src', 'runtime', 'dom-bus.js'), 'utf8');
  const env = createQaDomEnv();
  const docCaps = [];
  const winCaps = [];
  const htmlCaps = [];
  const normCap = (o) => (typeof o === 'boolean' ? o : Boolean(o && o.capture));

  env.doc.addEventListener = (t, fn, o) => { docCaps.push({ t, fn, cap: normCap(o), o, active: true }); };
  env.doc.removeEventListener = (t, fn, o) => {
    const cap = normCap(o);
    const rec = docCaps.find((r) => r.active && r.t === t && r.fn === fn && r.cap === cap);
    if (rec) rec.active = false;
  };
  env.doc.dispatchCapture = (ev) => {
    for (const r of [...docCaps]) if (r.active && r.t === ev.type) r.fn(ev);
  };
  env.win.addEventListener = (t, fn, o) => { winCaps.push({ t, fn, cap: normCap(o), o, active: true }); };
  env.win.removeEventListener = (t, fn, o) => {
    const cap = normCap(o);
    const rec = winCaps.find((r) => r.active && r.t === t && r.fn === fn && r.cap === cap);
    if (rec) rec.active = false;
  };
  env.win.dispatchCapture = (ev) => {
    for (const r of [...winCaps]) if (r.active && r.t === ev.type) r.fn(ev);
  };
  env.html.addEventListener = (t, fn, o) => { htmlCaps.push({ t, fn, cap: normCap(o), o, active: true }); };
  env.html.removeEventListener = (t, fn, o) => {
    const cap = normCap(o);
    const rec = htmlCaps.find((r) => r.active && r.t === t && r.fn === fn && r.cap === cap);
    if (rec) rec.active = false;
  };
  env.html.dispatchEl = (ev) => {
    for (const r of [...htmlCaps]) if (r.active && r.t === ev.type) r.fn(ev);
  };

  // Spy on canvas 2D drawing calls (radial gradient center/radius + fillRect bounding boxes)
  const drawsByCanvas = new WeakMap();
  const origCreate = env.doc.createElement;
  env.doc.createElement = (tag) => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'canvas') {
      const log = { radials: [], fills: [], clears: 0 };
      drawsByCanvas.set(el, log);
      const ctx = {
        globalAlpha: 1,
        lineWidth: 1,
        fillStyle: null,
        strokeStyle: null,
        clearRect() { log.clears++; },
        save() {},
        restore() {},
        clip() {},
        translate() {},
        beginPath() {},
        roundRect() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {},
        stroke() {},
        fillRect(x, y, w, h) { log.fills.push({ x, y, w, h }); },
        createRadialGradient(x0, y0, r0, x1, y1, r1) {
          log.radials.push({ x0, y0, r0, x1, y1, r1 });
          return { addColorStop() {} };
        },
        createLinearGradient() { return { addColorStop() {} }; },
      };
      el.getContext = () => ctx;
    }
    return el;
  };

  env.html.setAttribute('data-ag-cs-motion', 'ultra');
  env.html.setAttribute('data-ag-cs-ambient', '1');

  // Mount real dom-bus & prism-rim-canvas inside sandboxed VM (with ResizeObserver active, never firing on scroll/translate)
  vm.runInNewContext(domBusSrc, env.win);
  vm.runInNewContext(rimSrc, env.win);
  const bus = env.win.__agDomBus;
  assert.ok(bus && typeof bus.observeSize === 'function', 'dom-bus must be active');

  const outerWrap = env.mkEl('div', { class: 'outer-anim-wrap' });
  const mirrorPanel = env.mkEl(
    'div',
    { 'data-ag-cs-prism-box': '1', 'data-ag-cs-prism-mirror': '1', 'data-ag-cs-overview-shell': '1' },
    { left: 100, top: 80, right: 1000, bottom: 680, width: 900, height: 600 }
  );
  const innerChild = env.mkEl('div', { class: 'panel-inner' });
  mirrorPanel.appendChild(innerChild);
  outerWrap.appendChild(mirrorPanel);
  env.body.appendChild(outerWrap);

  const beforeDocCount = docCaps.filter((r) => r.active).length;
  const beforeWinCount = winCaps.filter((r) => r.active).length;
  const beforeHtmlCount = htmlCaps.filter((r) => r.active).length;

  const ctl = env.win.__agPrismRimCanvas.createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    canMountRealCanvas: () => true,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
    getActiveCrystalTrack: () => null,
    setCrystalPointerClient: () => {},
    onPointerActivity: () => {},
  });

  const rimDocListeners = docCaps.slice(beforeDocCount);
  const rimWinListeners = winCaps.slice(beforeWinCount);
  assert.equal(rimDocListeners.filter((r) => r.t === 'scroll' && r.active).length, 0, 'prism-rim-canvas must NOT attach scroll listener on document (keeps smoothCaret=false document scroll count at 0)');
  const scrollRec = rimWinListeners.find((r) => r.t === 'scroll' && r.active);
  assert.ok(scrollRec, 'prism-rim-canvas must register window capture scroll listener');
  assert.equal(scrollRec.cap, true, 'window scroll listener must use capture:true');
  assert.equal(Boolean(scrollRec.o && scrollRec.o.passive), true, 'window scroll listener must use passive:true');
  for (const evName of ['transitionend', 'animationend']) {
    const rec = rimDocListeners.find((r) => r.t === evName && r.active);
    assert.ok(rec, `prism-rim-canvas must register document ${evName} listener`);
    assert.equal(rec.cap, true, `${evName} listener must use capture:true`);
    assert.equal(Boolean(rec.o && rec.o.passive), true, `${evName} listener must use passive:true`);
  }

  try {
    // 1) Initial hover draw + verify local clipped fillRect on large 900x600 mirror canvas
    ctl.onPointerMove({ clientX: 220, clientY: 400 });
    env.flushRaf(16);
    const cv = mirrorPanel.querySelector('.ag-cs-prism-rim-cv');
    assert.ok(cv, 'Mirror panel must mount .ag-cs-prism-rim-cv');
    const log = drawsByCanvas.get(cv);
    const glow0 = log.radials.find((r) => r.r1 === 210);
    assert.ok(glow0, 'Mirror 210px ambient glow must draw');
    assert.equal(glow0.x0, 120);
    assert.equal(glow0.y0, 320);
    assert.equal(log.fills.length, 1);
    assert.deepEqual(log.fills[0], { x: 0, y: 110, w: 330, h: 420 }, 'Large mirror canvas must clip fillRect to glow bounding box instead of full 900x600');
    assert.ok(log.fills[0].w * log.fills[0].h < 900 * 600 * 0.4, 'Clipped fillRect area must save >60% over full canvas');

    // 2) Scroll moves panel top by +240px with NO ResizeObserver -> FIRST frame after scroll must align 0px error (no 5000ms wait, no 1-frame async lag)
    log.radials.length = 0;
    log.fills.length = 0;
    mirrorPanel._rect = { left: 100, top: 320, right: 1000, bottom: 920, width: 900, height: 600 };
    env.win.dispatchCapture({ type: 'scroll', target: env.body });
    env.flushRaf(16);
    const glowScroll = log.radials.find((r) => r.r1 === 210);
    assert.ok(glowScroll, 'Scroll must trigger immediate first-frame redraw while pointer is inside');
    assert.equal(glowScroll.x0, 120);
    assert.equal(glowScroll.y0, 80, 'Scroll +240px must align localY = 400 - 320 = 80 on frame 1 (0px misalignment)');

    // 3) 0.5px pointer deadzone (0.8px move must NOT be swallowed by legacy 1.5px deadzone)
    log.radials.length = 0;
    ctl.onPointerMove({ clientX: 220.8, clientY: 400 });
    env.flushRaf(16);
    const glowMicro = log.radials.find((r) => r.r1 === 210);
    assert.ok(glowMicro, '0.8px slow pointer movement must redraw instead of sticking on legacy 1.5px deadzone');
    assert.ok(Math.abs(glowMicro.x0 - 120.8) < 1e-6);

    // 4) Chat stream push without scroll or RO: >= 64ms hover re-measures synchronously on the SAME frame (no 5000ms lag, no bus.measure 1-frame delay)
    log.radials.length = 0;
    mirrorPanel._rect = { left: 100, top: 180, right: 1000, bottom: 780, width: 900, height: 600 };
    ctl.onPointerMove({ clientX: 222, clientY: 400 });
    env.flushRaf(70);
    const glow64 = log.radials.find((r) => r.r1 === 210);
    assert.ok(glow64, 'Hover move after >=64ms must redraw');
    assert.equal(glow64.x0, 122);
    assert.equal(glow64.y0, 220, '64ms sync re-measure must apply new rect.top=180 on the exact same frame (localY=220)');

    // 5) Entrance transform transitionend (on child) & animationend (on ancestor wrapper) realign on first frame without moving pointer
    log.radials.length = 0;
    mirrorPanel._rect = { left: 100, top: 80, right: 1000, bottom: 680, width: 900, height: 600 };
    env.doc.dispatchCapture({ type: 'transitionend', target: innerChild });
    env.flushRaf(16);
    const glowTrans = log.radials.find((r) => r.r1 === 210);
    assert.ok(glowTrans, 'transitionend inside floating panel must schedule immediate realignment');
    assert.equal(glowTrans.y0, 320, 'transitionend must realign localY = 400 - 80 = 320 on frame 1');

    log.radials.length = 0;
    mirrorPanel._rect = { left: 100, top: 140, right: 1000, bottom: 740, width: 900, height: 600 };
    env.doc.dispatchCapture({ type: 'animationend', target: outerWrap });
    env.flushRaf(16);
    const glowAnim = log.radials.find((r) => r.r1 === 210);
    assert.ok(glowAnim, 'animationend on ancestor wrapping floating panel must schedule immediate realignment');
    assert.equal(glowAnim.y0, 260, 'animationend must realign localY = 400 - 140 = 260 on frame 1');

    // 6) Medium mirror panel (<=120,000 area) also clips 26px cursor reflection halo fillRect
    const smallMirror = env.mkEl(
      'div',
      { 'data-ag-cs-prism-box': '1', 'data-ag-cs-prism-mirror': '1' },
      { left: 50, top: 50, right: 350, bottom: 250, width: 300, height: 200 }
    );
    env.body.appendChild(smallMirror);
    ctl.markDirty();
    ctl.onPointerMove({ clientX: 200, clientY: 150 });
    env.flushRaf(16);
    const smallCv = smallMirror.querySelector('.ag-cs-prism-rim-cv');
    assert.ok(smallCv);
    const smallLog = drawsByCanvas.get(smallCv);
    assert.equal(smallLog.fills.length, 2, 'Medium mirror draws ambient 210px glow + 26px cursor reflection halo');
    const haloFill = smallLog.fills[1];
    assert.ok(haloFill.w <= 54 && haloFill.h <= 54, `26px reflection halo fillRect must be locally clipped (<=54x54), got ${haloFill.w}x${haloFill.h}`);

    // 7) Pointer leave preserves strict 0fps idle on scroll/transitionend/animationend
    env.html.dispatchEl({ type: 'pointerleave' });
    env.flushRaf(16);
    const rafBeforeIdle = env.rafs.length;
    env.win.dispatchCapture({ type: 'scroll', target: env.body });
    env.doc.dispatchCapture({ type: 'transitionend', target: mirrorPanel });
    env.doc.dispatchCapture({ type: 'animationend', target: outerWrap });
    assert.equal(env.rafs.length, rafBeforeIdle, 'Off-screen pointer must schedule 0 rAF on scroll/transitionend/animationend');
  } finally {
    ctl.teardown();
    bus.dispose(env.doc, env.win);
  }

  // 8) teardown() removes 100% of scroll/transitionend/animationend/visibilitychange/pointerleave/blur listeners (capture-exact)
  assert.equal(docCaps.slice(beforeDocCount).filter((r) => r.active).length, 0, 'teardown() must remove 100% of document scroll/transitionend/animationend/visibilitychange listeners');
  assert.equal(winCaps.slice(beforeWinCount).filter((r) => r.active).length, 0, 'teardown() must remove 100% of window blur listeners');
  assert.equal(htmlCaps.slice(beforeHtmlCount).filter((r) => r.active).length, 0, 'teardown() must remove 100% of pointerleave listeners');
});
