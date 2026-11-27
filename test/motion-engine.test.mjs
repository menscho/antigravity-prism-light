import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const motionEngine = require(path.join(ROOT_DIR, 'motion-engine.js'));
const animatedIcons = require(path.join(ROOT_DIR, 'animated-icons.js'));
const i18nLocales = require(path.join(ROOT_DIR, 'i18n-locales.js'));
void animatedIcons;

function createTestElement(tagName = 'div', attrs = {}, rect = { left: 0, top: 0, width: 88, height: 30 }) {
  const attrMap = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
  const children = [];
  const listeners = new Map();
  const animateCalls = [];
  let attrWrites = 0;

  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    style: {},
    disabled: attrMap.has('disabled'),
    isContentEditable: attrMap.get('contenteditable') === 'true' || attrMap.get('contenteditable') === '',
    children,
    parentElement: null,
    parentNode: null,
    animateCalls,
    get attrWrites() {
      return attrWrites;
    },
    get className() {
      return attrMap.get('class') || '';
    },
    set className(v) {
      attrWrites++;
      if (v) attrMap.set('class', String(v));
      else attrMap.delete('class');
    },
    get id() {
      return attrMap.get('id') || '';
    },
    setAttribute(k, v) {
      attrWrites++;
      attrMap.set(k, String(v));
      if (k === 'disabled') el.disabled = true;
    },
    getAttribute(k) {
      return attrMap.has(k) ? attrMap.get(k) : null;
    },
    hasAttribute(k) {
      return attrMap.has(k);
    },
    removeAttribute(k) {
      attrWrites++;
      attrMap.delete(k);
      if (k === 'disabled') el.disabled = false;
    },
    appendChild(child) {
      child.parentElement = el;
      child.parentNode = el;
      children.push(child);
      return child;
    },
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    getBoundingClientRect() {
      return { ...rect };
    },
    matches(selector) {
      if (selector === ':focus-visible') return true;
      return String(selector)
        .split(',')
        .map((s) => s.trim())
        .some((tok) => {
          if (!tok) return false;
          if (tok === el.tagName.toLowerCase()) return true;
          if (tok === '[data-anim-icon]' && attrMap.has('data-anim-icon')) return true;
          if (tok === '[role="button"]' && attrMap.get('role') === 'button') return true;
          if (tok === '[role="textbox"]' && attrMap.get('role') === 'textbox') return true;
          if (tok === '[contenteditable="true"]' && attrMap.get('contenteditable') === 'true') return true;
          if (tok.startsWith('.')) {
            return (attrMap.get('class') || '').split(/\s+/).includes(tok.slice(1));
          }
          return false;
        });
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (cur.matches && cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      const walk = (n) => {
        for (const ch of n.children || []) {
          if (ch.matches && ch.matches(selector)) out.push(ch);
          walk(ch);
        }
      };
      walk(el);
      return out;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, init = {}) {
      for (const fn of [...(listeners.get(type) || [])]) {
        fn({ type, button: 0, target: el, ...init });
      }
    },
    animate(keyframes, options) {
      let cancelled = false;
      const anim = {
        keyframes,
        options,
        get cancelled() {
          return cancelled;
        },
        finished: Promise.resolve(),
        cancel() {
          cancelled = true;
        },
        commitStyles() {},
      };
      animateCalls.push(anim);
      return anim;
    },
  };
  return el;
}

test('getMotionTier resolves data-ag-cs-motion 4 tiers and prefers-reduced-motion override', () => {
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.matchMedia;
  const html = createTestElement('html');
  globalThis.document = { documentElement: html };
  globalThis.matchMedia = () => ({ matches: false });

  try {
    assert.equal(motionEngine.getMotionTier(), 'ultra');
    for (const tier of ['off', 'subtle', 'standard', 'ultra']) {
      html.setAttribute('data-ag-cs-motion', tier);
      assert.equal(motionEngine.getMotionTier(), tier);
    }
    html.setAttribute('data-ag-cs-motion', 'unknown-value');
    assert.equal(motionEngine.getMotionTier(), 'ultra');

    assert.equal(motionEngine.getMotionTier('subtle'), 'subtle');
    assert.equal(motionEngine.getMotionTier(true), 'off');

    globalThis.matchMedia = () => ({ matches: true });
    html.setAttribute('data-ag-cs-motion', 'ultra');
    assert.equal(motionEngine.getMotionTier(), 'off');
    assert.equal(motionEngine.getMotionTier(false), 'ultra');
  } finally {
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatch;
  }
});

test('spring, stagger, glideIndicator, drawStroke, and triggerIcon adapt across off / subtle / standard / ultra', () => {
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.matchMedia;
  const html = createTestElement('html');
  globalThis.document = { documentElement: html };
  globalThis.matchMedia = () => ({ matches: false });

  try {
    html.setAttribute('data-ag-cs-motion', 'off');
    const offEl = createTestElement('div');
    const offRes = motionEngine.spring(
      offEl,
      [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }],
      { fill: 'forwards' }
    );
    assert.equal(offRes.durationMs, 0);
    assert.equal(offEl.animateCalls.length, 0);
    assert.equal(offEl.style.opacity, '1');

    const offPath = createTestElement('path', { 'data-path-length': '20' });
    motionEngine.drawStroke(offPath);
    assert.equal(offPath.style.strokeDashoffset, '0');
    assert.equal(offPath.animateCalls.length, 0);

    html.setAttribute('data-ag-cs-motion', 'subtle');
    const subEl = createTestElement('div');
    const subRes = motionEngine.spring(subEl, [
      { transform: 'scale(0.84)' },
      { transform: 'scale(1.12)' },
      { transform: 'scale(1)' },
    ]);
    assert.equal(subRes.durationMs, 120);
    assert.equal(subRes.easing, 'ease-out');
    assert.equal(subEl.animateCalls.length, 1);
    assert.equal(subEl.animateCalls[0].keyframes.length, 2, 'Subtle tier must strip overshoot middle keyframes');
    assert.equal(subEl.animateCalls[0].options.duration, 120);
    assert.equal(subEl.animateCalls[0].options.easing, 'ease-out');

    const btn = createTestElement('button');
    const svg = createTestElement('svg', { 'data-anim-icon': 'copy-check', class: 'ag-anim-icon' });
    const cp = createTestElement('g', { class: 'ai-part-copy' });
    const ck = createTestElement('path', { class: 'ai-part-check', 'data-path-length': '22' });
    svg.appendChild(cp);
    svg.appendChild(ck);
    btn.appendChild(svg);

    const hoverSub = motionEngine.triggerIcon(btn, 'hover');
    assert.equal(hoverSub.handles.length, 0, 'Subtle tier must suppress exaggerated hover bounce on icons');

    const checkSub = motionEngine.triggerIcon(btn, 'check');
    assert.equal(cp.style.opacity, '0');
    assert.equal(ck.style.opacity, '1');
    assert.ok(checkSub.handles.length >= 1);
    assert.equal(ck.animateCalls[0].options.duration, 120);
    assert.equal(ck.animateCalls[0].options.easing, 'ease-out');

    html.setAttribute('data-ag-cs-motion', 'standard');
    const prevBtn = createTestElement('button', {}, { left: 20, top: 10, width: 64, height: 26 });
    const nextBtn = createTestElement('button', {}, { left: 96, top: 10, width: 80, height: 26 });
    const glideRes = motionEngine.glideIndicator(prevBtn, nextBtn);
    assert.ok(glideRes.durationMs > 120);
    assert.equal(prevBtn.animateCalls.length, 0);
    assert.equal(nextBtn.animateCalls.length, 1);
    assert.match(nextBtn.animateCalls[0].keyframes[0].transform, /translate3d\(-76\.00px, 0\.00px, 0\)/);
  } finally {
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatch;
  }
});

test('bindMicroInteractions explicitly skips .ag-prism-thought-raw-toggle and .ag-prism-thought-overlay with 0 animations and 0 attribute mutations', () => {
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.matchMedia;
  const html = createTestElement('html', { 'data-ag-cs-motion': 'ultra' });
  globalThis.document = { documentElement: html };
  globalThis.matchMedia = () => ({ matches: false });

  const root = createTestElement('div');
  const normalBtn = createTestElement('button');
  const roleBtn = createTestElement('div', { role: 'button' });
  const iconBtn = createTestElement('button');
  const iconSvg = createTestElement('svg', { 'data-anim-icon': 'plus-spin', class: 'ag-anim-icon' });
  iconBtn.appendChild(iconSvg);

  // 中文思考转译组件「原文」按钮与浮层树
  const thoughtOverlay = createTestElement('div', { class: 'ag-prism-thought-overlay' });
  const thoughtRawBtn = createTestElement('button', { class: 'ag-prism-thought-raw-toggle' });
  const thoughtInnerSvg = createTestElement('svg', { 'data-anim-icon': 'sparkles-pen' });
  thoughtRawBtn.appendChild(thoughtInnerSvg);
  thoughtOverlay.appendChild(thoughtRawBtn);
  const standaloneRawBtn = createTestElement('button', { class: 'btn ag-prism-thought-raw-toggle secondary' });

  const disabledBtn = createTestElement('button', { disabled: 'true' });
  const ariaDisabledBtn = createTestElement('div', { role: 'button', 'aria-disabled': 'true' });
  const noSpringBtn = createTestElement('button', { 'data-no-press-spring': '1' });
  const editableInBtn = createTestElement('div', { contenteditable: 'true' });
  const wrapperRoleBtn = createTestElement('div', { role: 'button' });
  wrapperRoleBtn.appendChild(editableInBtn);
  const composerBox = createTestElement('div', { role: 'button', 'data-testid': 'agent-input-box' });
  const hugeContainer = createTestElement('div', { role: 'button' }, { left: 0, top: 0, width: 640, height: 180 });

  for (const n of [
    normalBtn,
    roleBtn,
    iconBtn,
    thoughtOverlay,
    standaloneRawBtn,
    disabledBtn,
    ariaDisabledBtn,
    noSpringBtn,
    wrapperRoleBtn,
    composerBox,
    hugeContainer,
  ]) {
    root.appendChild(n);
  }

  const binding = motionEngine.bindMicroInteractions(root);
  try {
    root.dispatch('pointerdown', { target: normalBtn });
    assert.equal(normalBtn.animateCalls.length, 1);
    assert.deepEqual(normalBtn.animateCalls[0].keyframes[1], { transform: 'scale(0.965)' });

    root.dispatch('pointerdown', { target: roleBtn });
    assert.equal(roleBtn.animateCalls.length, 1);

    root.dispatch('pointerdown', { target: iconSvg });
    assert.equal(iconSvg.animateCalls.length, 1);
    assert.equal(iconBtn.animateCalls.length, 1);

    // 验证 .ag-prism-thought-raw-toggle 及其子节点在所有事件与显式调用下 0 动画、0 属性改写
    for (const thoughtTarget of [thoughtRawBtn, thoughtInnerSvg, thoughtOverlay, standaloneRawBtn]) {
      root.dispatch('pointerover', { target: thoughtTarget, relatedTarget: root });
      root.dispatch('focusin', { target: thoughtTarget });
      root.dispatch('pointerdown', { target: thoughtTarget });
    }
    motionEngine.spring(thoughtRawBtn, [{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }]);
    motionEngine.triggerIcon(thoughtRawBtn, 'hover');

    assert.equal(thoughtRawBtn.animateCalls.length, 0, '.ag-prism-thought-raw-toggle must never receive WAAPI animations');
    assert.equal(thoughtInnerSvg.animateCalls.length, 0, 'Icons inside .ag-prism-thought-raw-toggle must never animate');
    assert.equal(standaloneRawBtn.animateCalls.length, 0, 'Standalone .ag-prism-thought-raw-toggle must never animate');
    assert.equal(thoughtRawBtn.attrWrites, 0, '.ag-prism-thought-raw-toggle must have 0 attribute mutations');
    assert.deepEqual(thoughtRawBtn.style, {}, '.ag-prism-thought-raw-toggle inline style must remain completely untouched');

    for (const excluded of [disabledBtn, ariaDisabledBtn, noSpringBtn, editableInBtn, wrapperRoleBtn, composerBox, hugeContainer]) {
      root.dispatch('pointerdown', { target: excluded });
    }
    assert.equal(disabledBtn.animateCalls.length, 0);
    assert.equal(ariaDisabledBtn.animateCalls.length, 0);
    assert.equal(noSpringBtn.animateCalls.length, 0);
    assert.equal(wrapperRoleBtn.animateCalls.length, 0);
    assert.equal(composerBox.animateCalls.length, 0);
    assert.equal(hugeContainer.animateCalls.length, 0);

    html.setAttribute('data-ag-cs-motion', 'subtle');
    root.dispatch('pointerdown', { target: normalBtn });
    assert.equal(normalBtn.animateCalls.length, 1);
  } finally {
    binding.unbind();
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatch;
  }
});

test('i18n-locales UI_TABLE defines all 6 motionLevel keys across all 5 languages', () => {
  const requiredKeys = [
    'setMotionLevelTitle',
    'setMotionLevelDesc',
    'optMotionOff',
    'optMotionSubtle',
    'optMotionStandard',
    'optMotionUltra',
  ];
  for (const lang of ['zh-CN', 'zh-TW', 'yue', 'en', 'ja']) {
    const ui = i18nLocales.getUiStrings(lang);
    for (const k of requiredKeys) {
      assert.ok(typeof ui[k] === 'string' && ui[k].length > 0, `Missing ${k} for ${lang}`);
    }
  }
});

test('cdp.REMOVE_EXPRESSION cleanly unwraps stream chunks without losing text, restores injected host icons, and purges transient attributes when cdp.js is present', (t) => {
  const cdpPath = path.join(ROOT_DIR, 'cdp.js');
  if (!fs.existsSync(cdpPath)) {
    t.skip('cdp.js not yet generated by prism-repo');
    return;
  }
  const cdp = require(cdpPath);

  function makeNode(tag, attrs = {}) {
    const attrMap = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    const childNodes = [];
    const node = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      hidden: attrMap.has('hidden'),
      style: { removeProperty() {} },
      childNodes,
      parentNode: null,
      get firstChild() {
        return childNodes[0] || null;
      },
      get attributes() {
        return [...attrMap.keys()].map((name) => ({ name, value: attrMap.get(name) }));
      },
      classList: {
        remove(...cls) {
          const set = new Set((attrMap.get('class') || '').split(/\s+/).filter(Boolean));
          for (const c of cls) set.delete(c);
          const next = [...set].join(' ');
          if (next) attrMap.set('class', next);
          else attrMap.delete('class');
        },
        get length() {
          return (attrMap.get('class') || '').split(/\s+/).filter(Boolean).length;
        },
      },
      setAttribute(k, v) {
        attrMap.set(k, String(v));
        if (k === 'hidden') node.hidden = true;
      },
      getAttribute(k) {
        return attrMap.has(k) ? attrMap.get(k) : null;
      },
      hasAttribute(k) {
        return attrMap.has(k);
      },
      removeAttribute(k) {
        attrMap.delete(k);
        if (k === 'hidden') node.hidden = false;
      },
      appendChild(ch) {
        if (ch.parentNode) ch.remove();
        ch.parentNode = node;
        childNodes.push(ch);
        return ch;
      },
      insertBefore(ch, ref) {
        const idx = childNodes.indexOf(ref);
        if (idx < 0) return node.appendChild(ch);
        if (ch.parentNode) ch.remove();
        ch.parentNode = node;
        childNodes.splice(idx, 0, ch);
        return ch;
      },
      remove() {
        if (!node.parentNode) return;
        const idx = node.parentNode.childNodes.indexOf(node);
        if (idx >= 0) node.parentNode.childNodes.splice(idx, 1);
        node.parentNode = null;
      },
      normalize() {
        for (let i = 0; i < childNodes.length - 1; ) {
          if (childNodes[i].nodeType === 3 && childNodes[i + 1].nodeType === 3) {
            childNodes[i].textContent += childNodes[i + 1].textContent;
            childNodes.splice(i + 1, 1);
          } else {
            i++;
          }
        }
      },
      get textContent() {
        return childNodes.map((c) => c.textContent).join('');
      },
      matches(sel) {
        return String(sel)
          .split(',')
          .map((s) => s.trim())
          .some((tok) => {
            if (!tok) return false;
            if (tok.startsWith('style#')) return node.tagName === 'STYLE' && attrMap.get('id') === tok.slice(6);
            if (tok.startsWith('#')) return attrMap.get('id') === tok.slice(1);
            if (tok.startsWith('.')) return (attrMap.get('class') || '').split(/\s+/).includes(tok.slice(1));
            const m = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(tok);
            if (m) return m[2] === undefined ? attrMap.has(m[1]) : attrMap.get(m[1]) === m[2];
            return false;
          });
      },
      querySelectorAll(sel) {
        const res = [];
        const walk = (n) => {
          for (const ch of n.childNodes || []) {
            if (ch.nodeType === 1) {
              if (ch.matches(sel)) res.push(ch);
              walk(ch);
            }
          }
        };
        walk(node);
        return res;
      },
      getElementById(id) {
        return node.querySelectorAll('#' + id)[0] || null;
      },
    };
    return node;
  }

  const makeText = (txt) => {
    const tn = {
      nodeType: 3,
      textContent: txt,
      parentNode: null,
      remove() {
        if (!tn.parentNode) return;
        const idx = tn.parentNode.childNodes.indexOf(tn);
        if (idx >= 0) tn.parentNode.childNodes.splice(idx, 1);
        tn.parentNode = null;
      },
    };
    return tn;
  };

  const root = makeNode('html', { 'data-ag-cs-motion': 'ultra', 'data-ag-cs-lang': 'zh-CN', 'data-ag-prism': '1.0.1' });
  const body = makeNode('body');
  root.appendChild(body);

  const para = makeNode('p', {
    'data-ag-cs-sonar': '1',
    'data-ag-cs-liftoff-bubble': '1',
  });
  para.appendChild(makeText('Hello '));
  const chunk1 = makeNode('span', { class: 'ag-cs-stream-chunk' });
  chunk1.appendChild(makeText('Antigravity '));
  const chunk2 = makeNode('span', { class: 'ag-cs-thought-chunk' });
  chunk2.appendChild(makeText('Prism!'));
  para.appendChild(chunk1);
  para.appendChild(chunk2);
  body.appendChild(para);

  const copyBtn = makeNode('button', { 'data-ag-cs-icon-injected': 'copy-check' });
  const origSvg = makeNode('svg', { hidden: '', 'data-ag-cs-orig-svg': '1' });
  const animSvg = makeNode('svg', { class: 'ag-anim-icon ag-icon-copy-check' });
  copyBtn.appendChild(origSvg);
  copyBtn.appendChild(animSvg);
  body.appendChild(copyBtn);

  const documentMock = {
    documentElement: root,
    body,
    querySelector: (s) => root.querySelectorAll(s)[0] || null,
    querySelectorAll: (s) => root.querySelectorAll(s),
    getElementById: (id) => root.getElementById(id),
  };
  const sandbox = {
    document: documentMock,
    window: {},
    globalThis: {},
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(cdp.REMOVE_EXPRESSION, sandbox);
  assert.equal(root.hasAttribute('data-ag-cs-motion'), false);
  assert.equal(para.textContent, 'Hello Antigravity Prism!');
  assert.equal(para.childNodes.length, 1);
  assert.equal(copyBtn.hasAttribute('data-ag-cs-icon-injected'), false);
  assert.equal(origSvg.hidden, false);
  assert.equal(animSvg.parentNode, null);
});

test('motionEngine WeakMap ancestor exclusion cache short-circuits repeated 300Hz pointerover walks while staying reactive to class changes', () => {
  const prevPerf = globalThis.performance;
  let fakeNow = 1000;
  globalThis.performance = { now: () => fakeNow };

  try {
    let parentClassReads = 0;
    const makeTrackedNode = (cls = '') => {
      let curCls = cls;
      const children = [];
      const n = {
        parentElement: null,
        parentNode: null,
        get className() {
          return curCls;
        },
        set className(v) {
          curCls = String(v);
        },
        getAttribute(k) {
          if (k === 'class') {
            parentClassReads++;
            return curCls;
          }
          return null;
        },
        hasAttribute() {
          return false;
        },
        appendChild(ch) {
          ch.parentElement = n;
          ch.parentNode = n;
          children.push(ch);
          return ch;
        },
      };
      return n;
    };

    const rootWrap = makeTrackedNode('conversation-root');
    const midA = makeTrackedNode('prose-section');
    const midB = makeTrackedNode('prose-paragraph');
    const leaf = makeTrackedNode('prose-word');
    rootWrap.appendChild(midA);
    midA.appendChild(midB);
    midB.appendChild(leaf);

    motionEngine.invalidateExclusionCache();
    assert.equal(motionEngine.isThoughtExcluded(leaf), false);
    const readsFirstCall = parentClassReads;
    assert.ok(readsFirstCall >= 3);

    // 50 repeated checks within the same 48ms high-refresh window only inspect leaf's own class (0 ancestor walks)
    parentClassReads = 0;
    for (let i = 0; i < 50; i++) {
      assert.equal(motionEngine.isThoughtExcluded(leaf), false);
    }
    assert.equal(parentClassReads, 50, 'Ancestors must be served from WeakMap without walking up DOM tree');

    // Sibling under cached midB also short-circuits at midB without walking midA / rootWrap
    const siblingLeaf = makeTrackedNode('prose-code');
    midB.appendChild(siblingLeaf);
    parentClassReads = 0;
    assert.equal(motionEngine.isThoughtExcluded(siblingLeaf), false);
    assert.equal(parentClassReads, 2, 'Sibling leaf should stop immediately at cached parent midB');

    // Mutating leaf itself or invalidating cache reflects exclusion immediately
    leaf.className = 'ag-prism-thought-raw-toggle';
    assert.equal(motionEngine.isThoughtExcluded(leaf), true);

    leaf.className = 'prose-word';
    rootWrap.className = 'ag-prism-thought-overlay';
    motionEngine.invalidateExclusionCache();
    assert.equal(motionEngine.isThoughtExcluded(leaf), true);
  } finally {
    globalThis.performance = prevPerf;
  }
});

test('smooth-caret tracks editor/host scrollTop without floating stale caret and snaps to physical sub-pixels on HiDPI displays', () => {
  require(path.join(ROOT_DIR, 'smooth-caret.js'));
  const smoothCaretMod = globalThis.__agPrismSmoothCaret;
  assert.ok(smoothCaretMod && typeof smoothCaretMod.createSmoothCaretController === 'function');
  assert.equal(smoothCaretMod.snapDevicePx(14.49, 1), 14);
  assert.equal(smoothCaretMod.snapDevicePx(14.49, 2), 14.5);
  assert.equal(smoothCaretMod.snapDevicePx(14.39, 2.5), 14.4);

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevGetCs = globalThis.getComputedStyle;
  const prevRaf = globalThis.requestAnimationFrame;
  const rafCbs = [];
  globalThis.requestAnimationFrame = (cb) => {
    rafCbs.push(cb);
    return rafCbs.length;
  };

  let caretTopInViewport = 124.4;
  let caretLeftInViewport = 52.5;

  const textLeaf = { nodeType: 3, textContent: 'Line 1\nLine 2\nLine 3' };
  const hostChildren = [];
  const host = {
    clientLeft: 0,
    clientTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    hasAttribute(k) { return this.attrs.has(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    getBoundingClientRect: () => ({ left: 40, top: 100, width: 400, height: 80 }),
    appendChild(ch) {
      ch.isConnected = true;
      hostChildren.push(ch);
      return ch;
    },
    querySelector(sel) {
      if (sel.startsWith('.ag-cs-smooth-caret')) {
        return hostChildren.find((c) => c.className === 'ag-cs-smooth-caret') || null;
      }
      return null;
    },
  };

  const ed = {
    parentElement: host,
    scrollLeft: 0,
    scrollTop: 0,
    scrollHeight: 220,
    clientHeight: 80,
    childNodes: [textLeaf],
    textContent: textLeaf.textContent,
    attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    hasAttribute(k) { return this.attrs.has(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    contains: (n) => n === textLeaf,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 40, top: 100, right: 440, bottom: 180, width: 400, height: 80 }),
  };

  globalThis.window = { devicePixelRatio: 2 };
  globalThis.getComputedStyle = () => ({ paddingLeft: '8px', paddingTop: '8px', fontSize: '14px', lineHeight: '22px' });
  globalThis.document = {
    activeElement: ed,
    createElement(tag) {
      const attrs = new Map();
      return {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        isConnected: false,
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
        hasAttribute(k) { return attrs.has(k); },
        removeAttribute(k) { attrs.delete(k); },
        remove() { this.isConnected = false; },
      };
    },
    getSelection: () => ({
      rangeCount: 1,
      isCollapsed: true,
      focusNode: textLeaf,
      focusOffset: 6,
      getRangeAt: () => ({
        startContainer: textLeaf,
        startOffset: 6,
        getClientRects: () => [{ left: caretLeftInViewport, top: caretTopInViewport, height: 18.5 }],
      }),
    }),
    querySelectorAll(sel) {
      if (sel.includes('[contenteditable="true"]')) return [ed];
      if (sel === '.ag-cs-smooth-caret') return hostChildren;
      return [];
    },
  };

  try {
    const ctl = smoothCaretMod.createSmoothCaretController({
      isDestroyed: () => false,
      isEnabled: () => true,
      setAttrIfChanged(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); },
      runGuardedMut(fn) { return fn(); },
    });

    ctl.sync(true, false);
    const caret = host.querySelector('.ag-cs-smooth-caret');
    assert.ok(caret);
    // Physical 2x DPR subpixel alignment: 52.5 - 40 = 12.5px, 124.4 - 100 = 24.4 -> snapped to 24.5px
    assert.equal(caret.style.transform, 'translate3d(12.5px, 24.5px, 0)');
    assert.equal(caret.style.height, '18.5px');

    // Wheel scroll changes ed.scrollTop while selection focusNode/focusOffset stay identical!
    ed.scrollTop = 18;
    caretTopInViewport = 106.4;
    ctl.sync(false, false);
    assert.equal(
      caret.style.transform,
      'translate3d(12.5px, 6.5px, 0)',
      'Caret must update immediately on editor scrollTop change instead of floating at stale Y'
    );
    assert.equal(caret.style.transition, 'none', 'Scroll-only sync should suppress laggy glide transition');
    while (rafCbs.length) rafCbs.shift()();
    assert.equal(caret.style.transition, '', 'Next animation frame restores smooth glide transition');

    ctl.teardown();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.getComputedStyle = prevGetCs;
    globalThis.requestAnimationFrame = prevRaf;
  }
});

test('smooth-caret bumpMetricsEpoch invalidates emptyCaretProbeCache and prism-rim-canvas honors accentTone, ambient=0, subtle/off motion, orphan cleanup, and invalidateMetrics', () => {
  const smoothCaretMod = require('../smooth-caret.js');
  const prismRimMod = require('../prism-rim-canvas.js');

  // Part A: smooth-caret emptyCaretProbeCache invalidation on bumpMetricsEpoch()
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevGetCs = globalThis.getComputedStyle;
  const prevPerf = globalThis.performance;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;

  let padLeftPx = 8;
  let padTopPx = 8;
  let brViewportRect = { left: 48, top: 108, height: 18 };
  let hasSelectionRange = true;
  const hostKids = [];
  const brNode = {
    nodeName: 'BR',
    nodeType: 1,
    hasAttribute: () => true,
    getBoundingClientRect: () => brViewportRect,
  };
  const host = {
    clientLeft: 0,
    clientTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    attrs: new Map(),
    getBoundingClientRect: () => ({ left: 40, top: 100, width: 360, height: 60 }),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    hasAttribute(k) { return this.attrs.has(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    appendChild(c) { c.isConnected = true; hostKids.push(c); return c; },
    querySelector: () => hostKids[0] || null,
  };
  const ed = {
    nodeType: 1,
    parentElement: host,
    scrollLeft: 0,
    scrollTop: 0,
    scrollHeight: 60,
    clientHeight: 60,
    childNodes: [brNode],
    textContent: '',
    attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    hasAttribute(k) { return this.attrs.has(k); },
    removeAttribute(k) { this.attrs.delete(k); },
    contains: (n) => n === ed || n === brNode,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 40, top: 100, right: 400, bottom: 160, width: 360, height: 60 }),
  };

  let rafQueue = [];
  globalThis.performance = { now: () => 1000 };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
  globalThis.cancelAnimationFrame = () => { rafQueue = []; };
  globalThis.getComputedStyle = (el) => {
    if (el === ed) return { paddingLeft: `${padLeftPx}px`, paddingTop: `${padTopPx}px`, fontSize: '14px', lineHeight: '20px' };
    return { borderTopLeftRadius: `${el._radiusPx || 10}px` };
  };
  globalThis.document = {
    activeElement: ed,
    documentElement: {
      attrs: new Map([['data-ag-cs-accent', 'mono'], ['data-ag-cs-ambient', '1'], ['data-ag-cs-motion', 'ultra']]),
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    },
    createElement(tag) {
      const attrs = new Map();
      return {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        dataset: {},
        width: 0,
        height: 0,
        isConnected: true,
        parentElement: null,
        classList: { contains(c) { return String(this._owner?.className || '').split(/\s+/).includes(c); } },
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
        hasAttribute(k) { return attrs.has(k); },
        removeAttribute(k) { attrs.delete(k); },
        remove() {
          this.isConnected = false;
          if (this.parentElement && Array.isArray(this.parentElement._kids)) {
            const idx = this.parentElement._kids.indexOf(this);
            if (idx >= 0) this.parentElement._kids.splice(idx, 1);
          }
        },
        getContext: () => null,
      };
    },
    getSelection: () => (hasSelectionRange ? {
      rangeCount: 1,
      isCollapsed: true,
      focusNode: ed,
      focusOffset: 0,
      getRangeAt: () => ({
        startContainer: ed,
        startOffset: 0,
        getClientRects: () => [],
        getBoundingClientRect: () => ({ left: 0, top: 0, height: 0 }),
      }),
    } : { rangeCount: 0, isCollapsed: true }),
    querySelectorAll(sel) {
      if (sel.includes('[contenteditable="true"]')) return [ed];
      if (sel === '.ag-cs-smooth-caret') return hostKids;
      if (sel === '[data-ag-cs-prism-box="1"]') return prismBoxes.filter((b) => b.getAttribute('data-ag-cs-prism-box') === '1');
      if (sel === '.ag-cs-prism-rim-cv') return prismBoxes.flatMap((b) => b._kids.filter((k) => k.className === 'ag-cs-prism-rim-cv'));
      if (sel === '[data-ag-cs-prism-cv]') return prismBoxes.filter((b) => b.hasAttribute('data-ag-cs-prism-cv'));
      return [];
    },
    getElementById: () => null,
  };

  let prismBoxes = [];
  try {
    const caretCtl = smoothCaretMod.createSmoothCaretController({
      isDestroyed: () => false,
      isEnabled: () => true,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
    });
    // Seed emptyCaretProbeCache via BR rect at dx=8, dy=8
    caretCtl.sync(false, false);
    const caret = hostKids[0];
    assert.equal(caret.style.transform, 'translate3d(8px, 8px, 0)');

    // Selection temporarily empty (falls back to emptyCaretProbeCache); then composerRestyle changes padding to 16px, 14px!
    hasSelectionRange = false;
    padLeftPx = 16;
    padTopPx = 14;
    caretCtl.bumpMetricsEpoch();
    caretCtl.sync(false, true);
    assert.ok(
      caret.style.transform.startsWith('translate3d(16px, '),
      `bumpMetricsEpoch must evict stale emptyCaretProbeCache (dx=8) and use fresh padL=16, got ${caret.style.transform}`
    );
    caretCtl.teardown();
    rafQueue = [];

    // Part B: prism-rim-canvas accentTone, ambient=0, subtle/off motion, orphan cleanup, and invalidateMetrics
    const stopsSeen = [];
    const roundRectRadii = [];
    let clearsCount = 0;
    const mock2d = {
      globalAlpha: 1,
      lineWidth: 1,
      strokeStyle: null,
      clearRect() { clearsCount++; },
      beginPath() {},
      roundRect(_x, _y, _w, _h, r) { roundRectRadii.push(r); },
      stroke() {},
      createRadialGradient() {
        const stops = [];
        stopsSeen.push(stops);
        return { addColorStop(off, col) { stops.push([off, col]); } };
      },
    };
    const origCreate = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => {
      const el = origCreate(tag);
      el.classList._owner = el;
      if (tag === 'canvas') el.getContext = () => mock2d;
      return el;
    };

    const boxAttrs = new Map([['data-ag-cs-prism-box', '1']]);
    const box = {
      _radiusPx: 10,
      _kids: [],
      isConnected: true,
      style: { setProperty() {}, removeProperty() {} },
      get firstElementChild() { return this._kids[0] || null; },
      setAttribute(k, v) { boxAttrs.set(k, String(v)); },
      getAttribute(k) { return boxAttrs.has(k) ? boxAttrs.get(k) : null; },
      hasAttribute(k) { return boxAttrs.has(k); },
      removeAttribute(k) { boxAttrs.delete(k); },
      appendChild(c) { c.parentElement = box; c.isConnected = true; this._kids.push(c); return c; },
      querySelector(sel) {
        if (sel === '.ag-cs-prism-rim-cv') return this._kids.find((k) => k.className === 'ag-cs-prism-rim-cv') || null;
        return null;
      },
      getBoundingClientRect: () => ({ left: 50, top: 50, right: 350, bottom: 130, width: 300, height: 80 }),
    };
    prismBoxes = [box];

    const rimCtl = prismRimMod.createPrismRimCanvasController({
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

    rimCtl.onPointerMove({ clientX: 120, clientY: 80 });
    assert.equal(rafQueue.length, 1);
    rafQueue.shift()(1016);
    assert.equal(stopsSeen.length, 1);
    const monoColors = stopsSeen[0].map((s) => s[1]);
    assert.ok(monoColors.includes('#E2E8F0') && !monoColors.includes('#EA4335'), `mono accent must use silver-titanium stops, got ${monoColors}`);
    assert.equal(roundRectRadii[0], 10);

    // Change cornerStyle (borderRadius 10 -> 14) and call invalidateMetrics() -> refreshes cached borderRadius!
    box._radiusPx = 14;
    globalThis.document.documentElement.attrs.set('data-ag-cs-accent', 'amber');
    rimCtl.invalidateMetrics();
    assert.equal(rafQueue.length, 1);
    rafQueue.shift()(1040);
    assert.equal(roundRectRadii[roundRectRadii.length - 1], 14, 'invalidateMetrics must refresh cached borderRadius from 10px to 14px');
    const amberColors = stopsSeen[stopsSeen.length - 1].map((s) => s[1]);
    assert.ok(amberColors.includes('#F2B84B'), `amber accent must use amber stops, got ${amberColors}`);

    // ambient=0 clears canvas and skips rAF on pointermove (0fps)
    const clearsBeforeZero = clearsCount;
    globalThis.document.documentElement.attrs.set('data-ag-cs-ambient', '0');
    rimCtl.invalidateMetrics();
    assert.ok(clearsCount > clearsBeforeZero, 'ambient=0 must clear rim canvas immediately');
    rimCtl.onPointerMove({ clientX: 140, clientY: 85 });
    assert.equal(rafQueue.length, 0, 'ambient=0 must not schedule rAF on pointermove');

    // motionLevel=subtle also skips rAF
    globalThis.document.documentElement.attrs.set('data-ag-cs-ambient', '1');
    globalThis.document.documentElement.attrs.set('data-ag-cs-motion', 'subtle');
    rimCtl.onPointerMove({ clientX: 145, clientY: 85 });
    assert.equal(rafQueue.length, 0, 'motion=subtle must not run 300Hz rim pointer loop');

    // composerRestyle: false removes data-ag-cs-prism-box -> markDirty() prunes orphan canvas & data-ag-cs-prism-cv
    box.removeAttribute('data-ag-cs-prism-box');
    rimCtl.markDirty();
    assert.equal(box._kids.length, 0, 'Orphan .ag-cs-prism-rim-cv must be removed when composerRestyle turns off');
    assert.equal(box.hasAttribute('data-ag-cs-prism-cv'), false);

    rimCtl.teardown();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.getComputedStyle = prevGetCs;
    globalThis.performance = prevPerf;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
  }
});

test('#257: Velvet stream feathering — Layer A block reveal, Layer B 5-bucket CSS.highlights ink fade (0 DOM split & 0fps idle), and Layer C .ag-prism-thought-chunk CSS', () => {
  const streamMod = require(path.join(ROOT_DIR, 'stream-choreography.js'));
  const cssSrc = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');

  // Verify Layer B & Layer C CSS rules in style.css
  for (let i = 0; i < 5; i++) {
    assert.ok(cssSrc.includes(`::highlight(ag-stream-f${i})`), `Missing ::highlight(ag-stream-f${i}) in style.css`);
  }
  assert.match(cssSrc, /\.ag-prism-thought-chunk\{animation:ag-prism-thought-chunk-in (?:\.32s|320ms) cubic-bezier\(\.22,1,\.36,1\) both;?\}/);
  assert.match(cssSrc, /@keyframes ag-prism-thought-chunk-in\{0%\{opacity:\.08;?\}68%\{opacity:\.94;?\}100%\{opacity:1;?\}\}/);

  const prevDoc = globalThis.document;
  const prevCss = globalThis.CSS;
  const prevHl = globalThis.Highlight;
  const prevPerf = globalThis.performance;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;

  let nowMs = 1000;
  let nextRafId = 1;
  const rafMap = new Map();
  const highlightMap = new Map();

  class MockHighlight extends Set {}

  function mkElem(tag, attrs = {}) {
    const attrMap = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    const classSet = new Set((attrMap.get('class') || '').split(/\s+/).filter(Boolean));
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      isConnected: true,
      parentElement: null,
      parentNode: null,
      previousElementSibling: null,
      nextElementSibling: null,
      childNodes: [],
      children: [],
      classList: {
        add(c) { classSet.add(c); },
        remove(c) { classSet.delete(c); },
        contains(c) { return classSet.has(c); },
      },
      getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
      setAttribute(k, v) { attrMap.set(k, String(v)); },
      hasAttribute(k) { return attrMap.has(k); },
      removeAttribute(k) { attrMap.delete(k); },
      appendChild(ch) {
        ch.parentElement = el;
        ch.parentNode = el;
        ch.isConnected = true;
        const prevEl = el.children[el.children.length - 1] || null;
        if (ch.nodeType === 1) {
          if (prevEl) {
            prevEl.nextElementSibling = ch;
            ch.previousElementSibling = prevEl;
          }
          el.children.push(ch);
        }
        el.childNodes.push(ch);
        return ch;
      },
      matches(sel) {
        return String(sel)
          .split(',')
          .map((s) => s.trim())
          .some((tok) => {
            if (!tok) return false;
            if (tok.startsWith('.')) return classSet.has(tok.slice(1));
            const m = tok.match(/^\[([a-zA-Z0-9_-]+)="([^"]+)"\]$/);
            if (m) return attrMap.get(m[1]) === m[2];
            return tok.toUpperCase() === el.tagName;
          });
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelectorAll() { return []; },
      querySelector() { return null; },
    };
    return el;
  }

  function mkText(str) {
    return {
      nodeType: 3,
      data: str,
      get nodeValue() { return this.data; },
      isConnected: true,
      parentElement: null,
      parentNode: null,
    };
  }

  try {
    const html = mkElem('html', { 'data-ag-cs-style': 'true', 'data-ag-cs-motion': 'standard' });
    const body = mkElem('body');
    const conv = mkElem('div', { 'data-testid': 'conversation-view' });
    const prose = mkElem('div', { 'data-testid': 'planner-response-text' });
    const thoughtOverlay = mkElem('div', { class: 'ag-prism-thought-overlay' });
    const inputBox = mkElem('div', { 'data-testid': 'agent-input-box' });
    conv.appendChild(prose);
    conv.appendChild(thoughtOverlay);
    conv.appendChild(inputBox);
    body.appendChild(conv);

    const preThoughtBucket = new MockHighlight();
    const foreignThoughtRange = { foreign: 'thought-client-range' };
    preThoughtBucket.add(foreignThoughtRange);
    highlightMap.set('ag-stream-f0', preThoughtBucket);

    globalThis.CSS = { highlights: highlightMap };
    globalThis.Highlight = MockHighlight;
    globalThis.performance = { now: () => nowMs };
    globalThis.requestAnimationFrame = (cb) => {
      const id = nextRafId++;
      rafMap.set(id, cb);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
      rafMap.delete(id);
    };
    globalThis.document = {
      documentElement: html,
      body,
      createRange() {
        return {
          startContainer: null,
          startOffset: 0,
          endContainer: null,
          endOffset: 0,
          setStart(n, o) { this.startContainer = n; this.startOffset = o; },
          setEnd(n, o) { this.endContainer = n; this.endOffset = o; },
        };
      },
      querySelectorAll: () => [],
      querySelector: () => null,
    };

    let motionEnabled = true;
    const ctl = streamMod.createStreamChoreographyController({
      motionEngine: null,
      isDestroyed: () => false,
      isComposerRestyleEnabled: () => true,
      isMotionStandardOrUltra: () => motionEnabled,
      isMotionUltra: () => false, // Verify standard tier ALSO enables stream feathering!
      isConvRunning: () => true,
      isThoughtIsolatedNode: () => false,
      isThoughtMutationRecord: () => false,
      isManagedThoughtPanel: () => false,
      setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
      runGuardedMut: (fn) => fn(),
      cloneCachedSvgElement: () => null,
      buildBrandMarkSvg: () => '<svg></svg>',
      applySingleHostIcon: () => {},
      rippleCtl: null,
      convAuraCtl: null,
      notifyMascot: () => {},
    });

    // 1. Layer A: New paragraph block receives single .ag-cs-stream-chunk and snapshots initial text length
    const p1 = mkElem('p');
    const t1 = mkText('Hello');
    p1.appendChild(t1);
    prose.appendChild(p1);
    ctl.onStreamMutations([{ type: 'childList', target: prose, addedNodes: [p1] }]);
    assert.equal(p1.classList.contains('ag-cs-stream-chunk'), true, 'New block must receive .ag-cs-stream-chunk in standard tier');
    assert.equal(ctl.getHighlightFadeState().activeCount, 0, 'Initial block snapshot must not double-fade initial text');

    // 2. Layer B: Appending text via characterData on the SAME TextNode creates Range [5, 11] in ag-stream-f0 with ZERO DOM split!
    nowMs = 1020;
    t1.data = 'Hello world';
    ctl.onStreamMutations([{ type: 'characterData', target: t1 }]);
    assert.equal(p1.childNodes.length, 1, 'React TextNode must NEVER be split or wrapped');
    assert.equal(p1.childNodes[0], t1);
    let st = ctl.getHighlightFadeState();
    assert.equal(st.activeCount, 1);
    assert.equal(st.rafActive, true);
    assert.equal(highlightMap.get('ag-stream-f0'), preThoughtBucket, 'Must reuse pre-registered Highlight bucket without evicting thought-client');
    assert.equal(preThoughtBucket.has(foreignThoughtRange), true, 'Must preserve foreign thought-client Range in shared bucket');
    assert.deepEqual(st.buckets, [2, 0, 0, 0, 0]);
    const r0 = [...highlightMap.get('ag-stream-f0')].find((r) => r !== foreignThoughtRange);
    assert.equal(r0.startOffset, 5);
    assert.equal(r0.endOffset, 11);

    // Sub-frame rapid append (<= 34ms) coalesces into the SAME Range [5, 12] without allocating a second Range
    nowMs = 1040;
    t1.data = 'Hello world!';
    ctl.onStreamMutations([{ type: 'characterData', target: t1 }]);
    assert.equal(ctl.getHighlightFadeState().activeCount, 1, 'Sub-frame delta on same TextNode must coalesce');
    assert.equal(r0.endOffset, 12);

    // 3. Step through all 5 buckets (f0 -> f1 -> f2 -> f3 -> f4) and graduate cleanly to 0fps at >= 300ms
    const stepAt = (ts) => {
      nowMs = ts;
      const fn = [...rafMap.values()][0];
      rafMap.clear();
      fn(ts);
      return ctl.getHighlightFadeState();
    };
    assert.deepEqual(stepAt(1090).buckets, [1, 1, 0, 0, 0], '70ms age -> ag-stream-f1 while foreign range stays in f0');
    assert.deepEqual(stepAt(1150).buckets, [1, 0, 1, 0, 0], '130ms age -> ag-stream-f2');
    assert.deepEqual(stepAt(1210).buckets, [1, 0, 0, 1, 0], '190ms age -> ag-stream-f3');
    assert.deepEqual(stepAt(1270).buckets, [1, 0, 0, 0, 1], '250ms age -> ag-stream-f4');
    const graduated = stepAt(1330);
    assert.deepEqual(graduated.buckets, [1, 0, 0, 0, 0], '>=300ms age -> own range graduated, foreign thought range untouched!');
    assert.equal(preThoughtBucket.has(foreignThoughtRange), true, 'clearHighlightFade on graduation must NEVER .clear() foreign range');
    assert.equal(graduated.activeCount, 0);
    assert.equal(graduated.rafActive, false, 'Empty fade ring must immediately return to 0fps (zero rAF)');
    assert.equal(rafMap.size, 0);

    // 4. Exclusions: .ag-prism-thought-overlay and agent-input-box mutations never trigger Highlight ranges
    const ovTxt = mkText('翻译中');
    thoughtOverlay.appendChild(ovTxt);
    const inTxt = mkText('typing');
    inputBox.appendChild(inTxt);
    ctl.onStreamMutations([
      { type: 'characterData', target: ovTxt },
      { type: 'characterData', target: inTxt },
    ]);
    assert.equal(ctl.getHighlightFadeState().activeCount, 0, 'Overlay and input box must be strictly excluded');

    // 5. Bounded 48-item ring + immediate cleanup on motion="off" / disconnectStreamObserver
    for (let k = 0; k < 56; k++) {
      nowMs += 40;
      const tn = mkText(`word-${k}`);
      p1.appendChild(tn);
      ctl.onStreamMutations([{ type: 'childList', target: p1, addedNodes: [tn] }]);
    }
    assert.equal(ctl.getHighlightFadeState().activeCount, 48, 'Fade ring must cap strictly at 48 active ranges');
    html.setAttribute('data-ag-cs-motion', 'off');
    motionEnabled = false;
    ctl.disconnectStreamObserver();
    assert.equal(ctl.getHighlightFadeState().activeCount, 0);
    assert.equal(ctl.getHighlightFadeState().rafActive, false);
    assert.deepEqual(ctl.getHighlightFadeState().buckets, [1, 0, 0, 0, 0]);
    assert.equal(preThoughtBucket.has(foreignThoughtRange), true, 'disconnectStreamObserver must drop only own ranges and keep foreign thought range');

    ctl.clearTransientTimers();
  } finally {
    globalThis.document = prevDoc;
    globalThis.CSS = prevCss;
    globalThis.Highlight = prevHl;
    globalThis.performance = prevPerf;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCaf;
  }
});

test('smooth-caret invalidates stale cache on inline decorator mount with 0 full ed.textContent reads, supports invalidateSelection, and aligns collapsed element boundary to inline pill right edge', () => {
  const smoothCaretMod = require('../smooth-caret.js');
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevGetCs = globalThis.getComputedStyle;
  const prevRaf = globalThis.requestAnimationFrame;

  const hostKids = [];
  const makeEl = (tag) => {
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      nodeType: 1,
      className: '',
      style: {},
      isConnected: true,
      parentNode: null,
      childNodes: [],
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      remove() { this.isConnected = false; },
      appendChild(c) { c.parentNode = el; el.childNodes.push(c); return c; },
    };
    return el;
  };

  const trailingSpace = { nodeType: 3, nodeValue: ' ', textContent: ' ', parentNode: null };
  let decoText = '';
  const decoSpan = makeEl('span');
  decoSpan.setAttribute('contenteditable', 'false');
  decoSpan.setAttribute('data-lexical-decorator', 'true');
  Object.defineProperty(decoSpan, 'textContent', { get: () => decoText });
  decoSpan.getBoundingClientRect = () => ({ left: 620, right: 691, top: 937, bottom: 954, width: 71, height: 17 });
  const textWrapSpan = makeEl('span');
  textWrapSpan.appendChild(trailingSpace);
  const pNode = makeEl('p');
  pNode.appendChild(decoSpan);
  pNode.appendChild(textWrapSpan);
  pNode.getBoundingClientRect = () => ({ left: 620, right: 1340, top: 937, bottom: 954, width: 720, height: 17 });

  const host = makeEl('div');
  host.clientLeft = 0;
  host.clientTop = 0;
  host.scrollLeft = 0;
  host.scrollTop = 0;
  host.getBoundingClientRect = () => ({ left: 612, top: 925, width: 738, height: 40 });
  host.appendChild = (ch) => { ch.isConnected = true; hostKids.push(ch); return ch; };
  host.querySelector = (sel) => (sel.startsWith('.ag-cs-smooth-caret') ? hostKids.find((c) => c.className === 'ag-cs-smooth-caret') || null : null);

  let fullEdTextReads = 0;
  let caretLeft = 623;
  let useCollapsedBoundary = false;
  let clientRects = () => [{ left: caretLeft, top: 935, height: 17 }];

  const ed = makeEl('div');
  ed.parentElement = host;
  ed.scrollLeft = 0;
  ed.scrollTop = 0;
  ed.scrollHeight = 40;
  ed.clientHeight = 40;
  ed.appendChild(pNode);
  ed.firstChild = pNode;
  Object.defineProperty(ed, 'textContent', { get: () => { fullEdTextReads += 1; return decoText + ' '; } });
  ed.contains = (n) => n === trailingSpace || n === textWrapSpan || n === pNode || n === decoSpan;
  ed.querySelectorAll = () => [];
  ed.getBoundingClientRect = () => ({ left: 612, right: 1350, top: 925, bottom: 965, width: 738, height: 40 });

  globalThis.window = { devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ paddingLeft: '8px', paddingTop: '10px', fontSize: '14px', lineHeight: '22px' });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.document = {
    activeElement: ed,
    createElement: (tag) => makeEl(tag),
    getSelection: () => {
      const container = useCollapsedBoundary ? pNode : trailingSpace;
      const offset = 1;
      return {
        rangeCount: 1,
        isCollapsed: true,
        focusNode: container,
        focusOffset: offset,
        getRangeAt: () => ({
          collapsed: true,
          startContainer: container,
          startOffset: offset,
          endContainer: container,
          endOffset: offset,
          getClientRects: clientRects,
          getBoundingClientRect: () => ({ left: 0, top: 0, height: 0 }),
        }),
      };
    },
    querySelectorAll: (sel) => {
      if (sel.includes('[contenteditable="true"]')) return [ed];
      if (sel === '.ag-cs-smooth-caret') return hostKids;
      return [];
    },
  };

  try {
    const ctl = smoothCaretMod.createSmoothCaretController({
      isDestroyed: () => false,
      isEnabled: () => true,
      setAttrIfChanged(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); },
      runGuardedMut: (fn) => fn(),
    });

    // 1. Focusin before React decorator content mounts: trailing space sits at left=623 (dx=11px)
    ctl.sync(false, false);
    const caret = host.querySelector('.ag-cs-smooth-caret');
    assert.equal(caret.style.transform, 'translate3d(11px, 10px, 0)');

    // 2. Decorator mounts "gmail": focusNode/focusOffset/ed.childNodes.length stay identical; local prevNode sig detects mount with 0 ed.textContent reads
    decoText = 'gmail';
    decoSpan.appendChild({ nodeType: 3, nodeValue: 'gmail' });
    caretLeft = 694;
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(82px, 10px, 0)', 'Smooth caret must re-measure when decorator text mounts before same trailing text node');
    assert.equal(fullEdTextReads, 0, 'Decorator detection must stay O(1) with strictly 0 full ed.textContent reads');

    // 3. Icon-only decorator resize with unchanged textContent: invalidateSelection forces re-measure
    caretLeft = 710;
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(98px, 10px, 0)', 'invalidateSelection must bypass selectionSigCache even when text length stays constant');

    // 4. Collapsed element boundary directly after inline decorator span with empty clientRects()
    useCollapsedBoundary = true;
    clientRects = () => [];
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(79px, 12px, 0)', 'Element boundary after inline pill must align to pill.right (691 - 612 = 79px) rather than paragraph left');
    assert.equal(fullEdTextReads, 0, 'Collapsed element boundary alignment must execute 0 full ed.textContent reads');

    ctl.teardown();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.getComputedStyle = prevGetCs;
    globalThis.requestAnimationFrame = prevRaf;
  }
});

test('smooth-caret aligns trailing ZWSP/BOM text node after inline Quote pill and fails safe to native caret before emptyCaretProbeCache on non-empty/decorator editors', () => {
  const smoothCaretMod = require('../smooth-caret.js');
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevGetCs = globalThis.getComputedStyle;
  const prevRaf = globalThis.requestAnimationFrame;

  const hostKids = [];
  const makeEl = (tag) => {
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      nodeType: 1,
      className: '',
      style: {},
      isConnected: true,
      parentNode: null,
      childNodes: [],
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      remove() { this.isConnected = false; },
      appendChild(c) { c.parentNode = el; el.childNodes.push(c); return c; },
    };
    return el;
  };
  const makeTxt = (v) => ({ nodeType: 3, nodeValue: v, data: v, parentNode: null });

  const host = makeEl('div');
  host.clientLeft = 0;
  host.clientTop = 0;
  host.scrollLeft = 0;
  host.scrollTop = 0;
  host.getBoundingClientRect = () => ({ left: 600, top: 900, width: 720, height: 60 });
  host.appendChild = (ch) => { ch.isConnected = true; hostKids.push(ch); return ch; };
  host.querySelector = (sel) => (sel.startsWith('.ag-cs-smooth-caret') ? hostKids.find((c) => c.className === 'ag-cs-smooth-caret') || null : null);

  const ed = makeEl('div');
  ed.parentElement = host;
  ed.scrollLeft = 0;
  ed.scrollTop = 0;
  ed.scrollHeight = 60;
  ed.clientHeight = 60;
  ed.getBoundingClientRect = () => ({ left: 600, right: 1320, top: 900, bottom: 960, width: 720, height: 60 });
  ed.contains = (n) => { for (let c = n; c; c = c.parentNode) if (c === ed) return true; return false; };
  ed.querySelectorAll = () => [];

  let selState = { rangeCount: 0, isCollapsed: true };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ paddingLeft: '8px', paddingTop: '10px', fontSize: '14px', lineHeight: '22px' });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.document = {
    activeElement: ed,
    createElement: (tag) => makeEl(tag),
    getSelection: () => selState,
    querySelectorAll: (sel) => {
      if (sel.includes('[contenteditable="true"]')) return [ed];
      if (sel === '.ag-cs-smooth-caret') return hostKids;
      return [];
    },
  };

  const setCollapsedSel = (container, offset, rects = []) => {
    selState = {
      rangeCount: 1,
      isCollapsed: true,
      focusNode: container,
      focusOffset: offset,
      getRangeAt: () => ({
        collapsed: true,
        startContainer: container,
        startOffset: offset,
        endContainer: container,
        endOffset: offset,
        getClientRects: () => rects,
        getBoundingClientRect: () => ({ left: 0, top: 0, height: 0 }),
      }),
    };
  };

  try {
    const ctl = smoothCaretMod.createSmoothCaretController({
      isDestroyed: () => false,
      isEnabled: () => true,
      setAttrIfChanged(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); },
      runGuardedMut: (fn) => fn(),
    });

    // Seed emptyCaretProbeCache on a genuinely empty editor (<p><br></p>)
    const emptyP = makeEl('p');
    const br = makeEl('br');
    br.setAttribute('data-lexical-managed-linebreak', 'true');
    br.getBoundingClientRect = () => ({ left: 612, top: 914, right: 612, bottom: 932, width: 0, height: 18 });
    emptyP.appendChild(br);
    ed.appendChild(emptyP);
    setCollapsedSel(emptyP, 0, []);
    ctl.sync(false, false);
    const caret = host.querySelector('.ag-cs-smooth-caret');
    assert.equal(caret.getAttribute('data-ag-cs-caret-visible'), '1');
    assert.equal(caret.style.transform, 'translate3d(12px, 14px, 0)');

    // Confirm genuine empty editor still uses emptyCaretProbeCache when selection has no range
    selState = { rangeCount: 0, isCollapsed: true };
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.getAttribute('data-ag-cs-caret-visible'), '1', 'True empty editor must preserve emptyCaretProbeCache experience');
    assert.equal(caret.style.transform, 'translate3d(12px, 14px, 0)');

    // Edge 1a: Collapsed caret in direct trailing ZWSP (\u200b) Text node after Cmd+L Quote pill with empty clientRects
    ed.childNodes = [];
    const p1 = makeEl('p');
    const quotePill = makeEl('span');
    quotePill.setAttribute('contenteditable', 'false');
    quotePill.setAttribute('data-lexical-decorator', 'true');
    quotePill.appendChild(makeTxt('Quote: foo.ts:12'));
    quotePill.getBoundingClientRect = () => ({ left: 612, right: 742, top: 913, bottom: 931, width: 130, height: 18 });
    const zwspDirect = makeTxt('\u200b');
    p1.appendChild(quotePill);
    p1.appendChild(zwspDirect);
    ed.appendChild(p1);
    setCollapsedSel(zwspDirect, 1, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.getAttribute('data-ag-cs-caret-visible'), '1');
    assert.equal(caret.style.transform, 'translate3d(142px, 13px, 0)', 'Edge 1a: ZWSP text node after Quote pill must align to pill.right (742 - 600 = 142px)');

    // Edge 1b: Wrapped BOM (\ufeff) Text node inside <span> preceded by zero-width empty shell <span>
    const emptyShell = makeEl('span');
    emptyShell.getBoundingClientRect = () => ({ left: 612, right: 612, top: 913, bottom: 931, width: 0, height: 18 });
    const bomWrap = makeEl('span');
    const bomTxt = makeTxt('\ufeff');
    bomWrap.appendChild(bomTxt);
    p1.childNodes = [];
    p1.appendChild(quotePill);
    p1.appendChild(emptyShell);
    p1.appendChild(bomWrap);
    setCollapsedSel(bomTxt, 0, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.getAttribute('data-ag-cs-caret-visible'), '1');
    assert.equal(caret.style.transform, 'translate3d(142px, 13px, 0)', 'Edge 1b: Wrapped BOM text node must walk across empty inline shell to Quote pill right edge');

    // Edge 1c + Edge 2a: ZWSP on a second paragraph must NOT snap to previous paragraph's Quote pill, and must fail safe to native caret instead of emptyCaretProbeCache (12, 14)
    const p2 = makeEl('p');
    const p2Zwsp = makeTxt('\u200b');
    p2.appendChild(p2Zwsp);
    ed.appendChild(p2);
    setCollapsedSel(p2Zwsp, 0, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.hasAttribute('data-ag-cs-caret-visible'), false, 'Edge 1c/2: Non-empty editor with unmeasurable ZWSP on line 2 must yield to native caret rather than jumping to pill or emptyCaretProbeCache');
    assert.equal(ed.hasAttribute('data-ag-cs-smooth-caret'), false, 'Native caret must be restored when smooth-caret fails safe');

    // Edge 2b: Editor containing an unmeasured inline decorator (contenteditable="false") with empty rects fails safe to native caret
    ed.childNodes = [];
    const pDecoOnly = makeEl('p');
    const unmeasuredDeco = makeEl('span');
    unmeasuredDeco.setAttribute('contenteditable', 'false');
    unmeasuredDeco.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
    const afterUnmeasured = makeTxt('\u200b');
    pDecoOnly.appendChild(unmeasuredDeco);
    pDecoOnly.appendChild(afterUnmeasured);
    ed.appendChild(pDecoOnly);
    setCollapsedSel(afterUnmeasured, 1, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.hasAttribute('data-ag-cs-caret-visible'), false, 'Edge 2b: Unmeasured decorator pill must fail safe to native caret instead of projecting onto emptyCaretProbeCache');
    assert.equal(ed.hasAttribute('data-ag-cs-smooth-caret'), false);

    // Edge 2c: Non-empty plain text with empty range rects fails safe to native caret instead of emptyCaretProbeCache
    ed.childNodes = [];
    const pTxt = makeEl('p');
    const helloTxt = makeTxt('hello world');
    pTxt.appendChild(helloTxt);
    ed.appendChild(pTxt);
    setCollapsedSel(helloTxt, 5, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.hasAttribute('data-ag-cs-caret-visible'), false, 'Edge 2c: Non-empty text with empty range rects must fail safe to native caret');
    assert.equal(ed.hasAttribute('data-ag-cs-smooth-caret'), false);

    // Edge 2d: Clearing back to a genuinely empty editor (<p>\u200b</p>) cleanly resumes emptyCaretProbeCache
    ed.childNodes = [];
    const pCleared = makeEl('p');
    const clearedZwsp = makeTxt('\u200b');
    pCleared.appendChild(clearedZwsp);
    ed.appendChild(pCleared);
    setCollapsedSel(clearedZwsp, 0, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.getAttribute('data-ag-cs-caret-visible'), '1', 'Edge 2d: Truly empty ZWSP-only editor must resume smooth emptyCaretProbeCache');
    assert.equal(caret.style.transform, 'translate3d(12px, 14px, 0)');

    ctl.teardown();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.getComputedStyle = prevGetCs;
    globalThis.requestAnimationFrame = prevRaf;
  }
});

test('ui-runtime invalidates smooth-caret selection and queues lightweight caret sync on in-editor decorator mount without waking composer clearance scan', () => {
  const vm = require('node:vm');
  const cdp = require(path.join(ROOT_DIR, 'cdp.js'));
  const uiSrc = fs.readFileSync(path.join(ROOT_DIR, 'ui-runtime.js'), 'utf8');
  const mos = [];
  const makeNode = (tag, attrsObj = {}) => {
    const attrs = new Map(Object.entries(attrsObj));
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      className: '',
      classList: { add() {}, remove() {}, contains: () => false, toggle: () => false },
      style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
      childNodes: [],
      children: [],
      isConnected: true,
      parentNode: null,
      parentElement: null,
      offsetHeight: 80,
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) {
        c.parentNode = c.parentElement = el;
        el.childNodes.push(c);
        if (c.nodeType === 1) el.children.push(c);
        return c;
      },
      matches(sel) {
        if (sel.includes('agent-input-box')) return attrs.get('data-testid') === 'agent-input-box';
        if (sel.includes('contenteditable="true"')) return attrs.get('contenteditable') === 'true';
        return false;
      },
      closest(sel) {
        for (let c = el; c && c.nodeType === 1; c = c.parentElement) if (c.matches?.(sel)) return c;
        return null;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 80, right: 400, bottom: 80 }),
      checkVisibility: () => true,
    };
    return el;
  };
  const html = makeNode('html');
  const body = makeNode('body');
  const ib = makeNode('div', { 'data-testid': 'agent-input-box' });
  const card = makeNode('div');
  const ed = makeNode('div', { contenteditable: 'true' });
  const p = makeNode('p');
  const deco = makeNode('span', { contenteditable: 'false', 'data-lexical-decorator': 'true' });
  p.appendChild(deco);
  ed.appendChild(p);
  card.appendChild(ed);
  ib.appendChild(card);
  body.appendChild(ib);
  html.appendChild(body);

  let invalidateCalls = 0;
  let queueCalls = 0;
  let offsetReads = 0;
  Object.defineProperty(card, 'offsetHeight', { get() { offsetReads += 1; return 80; } });

  class MockMO {
    constructor(cb) { this.cb = cb; this.active = false; this.target = null; mos.push(this); }
    observe(target) { this.active = true; this.target = target; }
    disconnect() { this.active = false; }
    takeRecords() { return []; }
    emit(recs) { if (this.active) this.cb(recs, this); }
  }

  const doc = {
    nodeType: 9,
    documentElement: html,
    head: makeNode('head'),
    body,
    hidden: false,
    readyState: 'complete',
    activeElement: ed,
    hasFocus: () => true,
    createElement: (t) => makeNode(t),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  const win = {
    document: doc,
    location: { href: 'vscode-file://vscode-app/index.html', pathname: '/c/test' },
    navigator: { language: 'en' },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    performance: { now: () => 1000 },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static', getPropertyValue: () => '' }),
    MutationObserver: MockMO,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    addEventListener() {},
    removeEventListener() {},
    __agPrismSmoothCaret: {
      createSmoothCaretController: () => ({
        teardown() {},
        bumpMetricsEpoch() {},
        invalidateSelection() { invalidateCalls += 1; },
        measureSnapshot: () => [],
        applyMutations() {},
        sync() {},
        queue() { queueCalls += 1; },
      }),
    },
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Promise, RegExp, JSON, Error,
  };
  win.window = win.globalThis = win.self = win;
  vm.runInNewContext(uiSrc, win);
  win.__agCsUiMain({ ...cdp.DEFAULT_CONFIG, smoothCaret: true, mascot: 'off' });

  invalidateCalls = 0;
  queueCalls = 0;
  offsetReads = 0;
  const rootMo = mos.find((m) => m.active && m.target === html);
  assert.ok(rootMo, 'ui-runtime root MO must be active');

  // React mounts text content inside an inline Lexical decorator span inside [contenteditable="true"]
  const pillTxt = { nodeType: 3, nodeValue: 'gmail', parentNode: deco };
  deco.appendChild(pillTxt);
  rootMo.emit([{ type: 'childList', target: deco, addedNodes: [pillTxt], removedNodes: [] }]);
  assert.equal(invalidateCalls, 1, 'In-editor decorator text mount must invoke smoothCaretCtl.invalidateSelection()');
  assert.equal(queueCalls, 1, 'In-editor decorator mount must queue lightweight caret sync without full composer sync');
  assert.equal(offsetReads, 0, 'In-editor decorator mount must NOT trigger measureCrabClearanceAll layout reads');

  win.__agPrism.destroy();
});

test('smooth-caret hardens inline chip guards: inside-chip closest alignment, pre-rect element boundary, offset-0/ZWSP bogus rect cross-check, wrapped multi-rect chips, and bounded text-predecessor range without full editor scans', () => {
  const smoothCaretMod = require('../smooth-caret.js');
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevGetCs = globalThis.getComputedStyle;
  const prevRaf = globalThis.requestAnimationFrame;

  const hostKids = [];
  let fullEdTextReads = 0;
  let edQsaCalls = 0;
  let hotQsCalls = 0;

  const makeEl = (tag) => {
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      nodeType: 1,
      className: '',
      style: {},
      isConnected: true,
      parentNode: null,
      parentElement: null,
      childNodes: [],
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      remove() { this.isConnected = false; },
      appendChild(c) {
        c.parentNode = el;
        c.parentElement = el;
        el.childNodes.push(c);
        return c;
      },
      matches(sel) {
        return String(sel)
          .split(',')
          .map((s) => s.trim())
          .some((tok) => {
            if (tok === '[contenteditable="false"]') return attrs.get('contenteditable') === 'false';
            if (tok === '[data-lexical-decorator]') return attrs.has('data-lexical-decorator');
            return false;
          });
      },
      closest(sel) {
        for (let c = el; c && c.nodeType === 1; c = c.parentElement || c.parentNode) {
          if (c.matches?.(sel)) return c;
        }
        return null;
      },
      querySelector() {
        hotQsCalls += 1;
        return null;
      },
      querySelectorAll() {
        hotQsCalls += 1;
        return [];
      },
    };
    return el;
  };
  const makeTxt = (v) => ({ nodeType: 3, nodeValue: v, data: v, parentNode: null, parentElement: null });

  const host = makeEl('div');
  host.clientLeft = 0;
  host.clientTop = 0;
  host.scrollLeft = 0;
  host.scrollTop = 0;
  host.getBoundingClientRect = () => ({ left: 600, top: 900, width: 720, height: 80 });
  host.appendChild = (ch) => { ch.isConnected = true; ch.parentElement = host; hostKids.push(ch); return ch; };
  host.querySelector = (sel) => (sel.startsWith('.ag-cs-smooth-caret') ? hostKids.find((c) => c.className === 'ag-cs-smooth-caret') || null : null);

  const ed = makeEl('div');
  ed.setAttribute('contenteditable', 'true');
  ed.parentElement = host;
  ed.scrollLeft = 0;
  ed.scrollTop = 0;
  ed.scrollHeight = 80;
  ed.clientHeight = 80;
  ed.getBoundingClientRect = () => ({ left: 600, right: 1320, top: 900, bottom: 980, width: 720, height: 80 });
  ed.contains = (n) => { for (let c = n; c; c = c.parentNode) if (c === ed) return true; return false; };
  Object.defineProperty(ed, 'textContent', {
    get() {
      fullEdTextReads += 1;
      return 'forbidden-full-scan';
    },
  });
  ed.querySelector = () => {
    hotQsCalls += 1;
    return null;
  };
  ed.querySelectorAll = () => {
    edQsaCalls += 1;
    return [];
  };

  let selState = { rangeCount: 0, isCollapsed: true };
  let tempRangeRectResolver = () => [];
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ paddingLeft: '8px', paddingTop: '10px', fontSize: '14px', lineHeight: '22px' });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
  globalThis.document = {
    activeElement: ed,
    createElement: (tag) => makeEl(tag),
    createRange: () => {
      const r = {
        startContainer: null,
        startOffset: 0,
        endContainer: null,
        endOffset: 0,
        setStart(n, o) { this.startContainer = n; this.startOffset = o; },
        setEnd(n, o) { this.endContainer = n; this.endOffset = o; },
        getClientRects() { return tempRangeRectResolver(this); },
        getBoundingClientRect() {
          const rs = tempRangeRectResolver(this);
          return rs && rs.length ? rs[rs.length - 1] : { left: 0, right: 0, top: 0, height: 0 };
        },
      };
      return r;
    },
    getSelection: () => selState,
    querySelectorAll: (sel) => {
      if (sel.includes('[contenteditable="true"]')) return [ed];
      if (sel === '.ag-cs-smooth-caret') return hostKids;
      return [];
    },
  };

  const setCollapsedSel = (container, offset, rects = []) => {
    selState = {
      rangeCount: 1,
      isCollapsed: true,
      focusNode: container,
      focusOffset: offset,
      getRangeAt: () => ({
        collapsed: true,
        startContainer: container,
        startOffset: offset,
        endContainer: container,
        endOffset: offset,
        getClientRects: () => rects,
        getBoundingClientRect: () => (rects.length ? rects[rects.length - 1] : { left: 0, top: 0, height: 0 }),
      }),
    };
  };

  try {
    const ctl = smoothCaretMod.createSmoothCaretController({
      isDestroyed: () => false,
      isEnabled: () => true,
      setAttrIfChanged(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v); },
      runGuardedMut: (fn) => fn(),
    });

    // Guard 1: caret reported inside a non-editable chip aligns to the chip's right edge & centers vertically on tall pills
    const p1 = makeEl('p');
    p1.getBoundingClientRect = () => ({ left: 612, right: 1300, top: 910, bottom: 934, width: 688, height: 24 });
    const chip = makeEl('span');
    chip.setAttribute('contenteditable', 'false');
    chip.setAttribute('data-lexical-decorator', 'true');
    chip.getBoundingClientRect = () => ({ left: 612, right: 760, top: 910, bottom: 934, width: 148, height: 24 });
    const chipInner = makeEl('span');
    const chipTxt = makeTxt('Quote: app.ts:10');
    chipInner.appendChild(chipTxt);
    chip.appendChild(chipInner);
    p1.appendChild(chip);
    ed.appendChild(p1);

    setCollapsedSel(chipTxt, 5, [{ left: 640, top: 913, height: 18 }]);
    ctl.sync(false, false);
    const caret = host.querySelector('.ag-cs-smooth-caret');
    assert.ok(caret);
    // Tall pill (h=24, gh=18): top = 910 + (24-18)/2 = 913 -> y=13px, x = 760 - 600 = 160px
    assert.equal(caret.style.transform, 'translate3d(160px, 13px, 0)', 'Guard 1: caret inside non-editable chip must snap to chip right edge');
    assert.equal(caret.style.height, '18px');

    // Guard 2: element-level caret immediately after inline chip overrides bogus range.getClientRects()
    chip.getBoundingClientRect = () => ({ left: 612, right: 760, top: 913, bottom: 931, width: 148, height: 18 });
    setCollapsedSel(p1, 1, [{ left: 612, top: 913, height: 18 }]);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(160px, 13px, 0)', 'Guard 2: element boundary after inline chip must override stale paragraph-left clientRect');

    // Guard 2 negative: block-level <p> preceding element cursor on editor root must NOT snap to block's right edge (1300)
    setCollapsedSel(ed, 1, [{ left: 612, top: 935, height: 18 }]);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(12px, 35px, 0)', 'Guard 2 must ignore block elements like <p> and trust range rect');

    // Guard 3a: text node at offset===0 following inline chip cross-checks bogus same-line rect (612 < 760 - 2) -> pr.right + 1
    const afterSpan = makeEl('span');
    const afterTxt = makeTxt('hello');
    afterSpan.appendChild(afterTxt);
    p1.appendChild(afterSpan);
    setCollapsedSel(afterTxt, 0, [{ left: 612, top: 913, height: 18 }]);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(161px, 13px, 0)', 'Guard 3a: offset===0 bogus rect left of same-line chip must snap to pr.right + 1 (161px)');

    // Guard 3b: ZWSP text node at offset===1 with bogus same-line rect also cross-checks against chip.right -> pr.right + 1
    const zwspAfter = makeTxt('\u200b');
    p1.childNodes = [];
    p1.appendChild(chip);
    p1.appendChild(zwspAfter);
    setCollapsedSel(zwspAfter, 1, [{ left: 612, top: 913, height: 18 }]);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(161px, 13px, 0)', 'Guard 3b: ZWSP bogus same-line rect must snap to pr.right + 1 (161px)');

    // Guard 3c: wrapped next-line rect (deltaY >= max(gh, pr.height)) must NOT snap back to chip on previous line
    setCollapsedSel(zwspAfter, 0, [{ left: 612, top: 938, height: 18 }]);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(12px, 38px, 0)', 'Guard 3c: next-line rect must not snap to preceding line chip');

    // Guard 3d: accurate rect already at chip right edge (760 >= 760 - 2) stays untouched
    setCollapsedSel(zwspAfter, 0, [{ left: 760, top: 913, height: 18 }]);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(160px, 13px, 0)', 'Guard 3d: valid rect at chip right edge must not be shifted');

    // Guard 4a: wrapped multi-rect chip uses last non-zero getClientRects() entry rather than union bounding box
    const wrappedChip = makeEl('span');
    wrappedChip.setAttribute('contenteditable', 'false');
    wrappedChip.setAttribute('data-lexical-decorator', 'true');
    wrappedChip.getBoundingClientRect = () => ({ left: 612, right: 1200, top: 913, bottom: 953, width: 588, height: 40 });
    wrappedChip.getClientRects = () => [
      { left: 612, right: 1200, top: 913, bottom: 931, width: 588, height: 18 },
      { left: 612, right: 708, top: 935, bottom: 953, width: 96, height: 18 },
      { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
    ];
    const wrappedZwsp = makeTxt('\u200b');
    p1.childNodes = [];
    p1.appendChild(wrappedChip);
    p1.appendChild(wrappedZwsp);
    setCollapsedSel(wrappedZwsp, 1, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(108px, 35px, 0)', 'Guard 4a: wrapped multi-rect chip must align to last non-zero line rect (708 - 600 = 108px, 935 - 900 = 35px)');

    // Guard 4b-i: empty inline span after plain text measures end of preceding text via temp Range (collapsed hit)
    const plainTxt = makeTxt('hello');
    const emptyInline = makeEl('span');
    p1.childNodes = [];
    p1.appendChild(plainTxt);
    p1.appendChild(emptyInline);
    tempRangeRectResolver = (r) => (r.startContainer === plainTxt && r.startOffset === 5 && r.endOffset === 5 ? [{ left: 668, top: 913, height: 18 }] : []);
    setCollapsedSel(emptyInline, 0, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(68px, 13px, 0)', 'Guard 4b-i: empty span after plain text must align to end of preceding text via temp Range');

    // Guard 4b-ii: ZWSP after plain text with trailing ZWSP falls back to last visible char range [end-1, end]
    const plainWithTailZwsp = makeTxt('hello\u200b');
    const trailingZwsp = makeTxt('\u200b');
    p1.childNodes = [];
    p1.appendChild(plainWithTailZwsp);
    p1.appendChild(trailingZwsp);
    tempRangeRectResolver = (r) =>
      r.startContainer === plainWithTailZwsp && r.startOffset === 4 && r.endOffset === 5
        ? [{ left: 660, right: 669, top: 913, height: 18 }]
        : [];
    setCollapsedSel(trailingZwsp, 1, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.style.transform, 'translate3d(69px, 13px, 0)', 'Guard 4b-ii: ZWSP after text must fall back to last visible char right edge (669 - 600 = 69px)');

    // Guard 4b-iii: bounded walk must NEVER cross block boundary (<p>) to snap to previous paragraph text
    const p2 = makeEl('p');
    const p2EmptySpan = makeEl('span');
    p2EmptySpan.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
    p2.appendChild(p2EmptySpan);
    ed.appendChild(p2);
    setCollapsedSel(p2EmptySpan, 0, []);
    ctl.invalidateSelection();
    ctl.sync(false, false);
    assert.equal(caret.hasAttribute('data-ag-cs-caret-visible'), false, 'Guard 4b-iii: empty span on paragraph 2 must never cross block boundary to paragraph 1 text');
    assert.equal(ed.hasAttribute('data-ag-cs-smooth-caret'), false);

    // Performance & anti-regression invariants
    assert.equal(fullEdTextReads, 0, 'Must perform strictly 0 full ed.textContent reads across all 4 guards');
    assert.equal(edQsaCalls, 0, 'Must perform strictly 0 ed.querySelectorAll("*") calls');
    assert.equal(hotQsCalls, 0, 'Must perform strictly 0 hot-path querySelector/querySelectorAll calls');

    ctl.teardown();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.getComputedStyle = prevGetCs;
    globalThis.requestAnimationFrame = prevRaf;
  }
});
