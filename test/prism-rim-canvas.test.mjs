// prism-rim-canvas 模块域单测：主输入框全周棱镜光 vs 问答卡/排队卡底边环境棱镜反射
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const { createPrismRimCanvasController } = require(path.join(ROOT, 'prism-rim-canvas.js'));

function createMockRimDom() {
  const attrsOf = new WeakMap();
  const makeStyle = () => {
    const map = new Map();
    return {
      setProperty(k, v) { map.set(k, String(v)); },
      getPropertyValue(k) { return map.get(k) || ''; },
      removeProperty(k) { map.delete(k); },
    };
  };
  const makeCtx = () => {
    const ops = [];
    return {
      ops,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      clearRect(...a) { ops.push(['clearRect', ...a]); },
      beginPath() {},
      roundRect(...a) { ops.push(['roundRect', ...a]); },
      moveTo() {},
      arcTo() {},
      closePath() {},
      save() { ops.push(['save']); },
      restore() { ops.push(['restore']); },
      clip() { ops.push(['clip']); },
      translate(...a) { ops.push(['translate', ...a]); },
      fillRect(...a) { ops.push(['fillRect', ...a]); },
      stroke() { ops.push(['stroke', this.lineWidth, this.globalAlpha, this.globalCompositeOperation]); },
      createRadialGradient(...a) {
        ops.push(['radial', ...a]);
        return { addColorStop() {} };
      },
      createLinearGradient(...a) {
        ops.push(['linear', ...a]);
        return { addColorStop() {} };
      },
    };
  };
  const boxes = [];
  const makeEl = (tag, attrs = {}, rect = { left: 100, top: 200, width: 400, height: 120, right: 500, bottom: 320 }) => {
    const am = new Map(Object.entries(attrs));
    const cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const kids = [];
    const ctx = tag === 'canvas' ? makeCtx() : null;
    const el = {
      tagName: tag.toUpperCase(),
      nodeType: 1,
      isConnected: true,
      width: 0,
      height: 0,
      style: makeStyle(),
      children: kids,
      parentElement: null,
      classList: {
        contains: (c) => cls.has(c),
        add: (...a) => a.forEach((c) => cls.add(c)),
        remove: (...a) => a.forEach((c) => cls.delete(c)),
      },
      getAttribute: (k) => (am.has(k) ? am.get(k) : null),
      setAttribute: (k, v) => {
        am.set(k, String(v));
        if (k === 'class') { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); }
      },
      removeAttribute: (k) => am.delete(k),
      hasAttribute: (k) => am.has(k),
      get firstElementChild() { return kids[0] || null; },
      get nextElementSibling() {
        const p = el.parentElement;
        if (!p) return null;
        const i = p.children.indexOf(el);
        return i >= 0 ? p.children[i + 1] || null : null;
      },
      appendChild(c) { c.parentElement = el; kids.push(c); return c; },
      remove() { el.isConnected = false; if (el.parentElement) { const i = el.parentElement.children.indexOf(el); if (i >= 0) el.parentElement.children.splice(i, 1); } },
      querySelector: (s) => (s === '.ag-cs-prism-rim-cv' ? kids.find((k) => k.className === 'ag-cs-prism-rim-cv') || null : null),
      getBoundingClientRect: () => rect,
      getContext: () => ctx,
      _ctx: ctx,
    };
    Object.defineProperty(el, 'className', {
      get: () => Array.from(cls).join(' '),
      set: (v) => { cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
    });
    attrsOf.set(el, am);
    return el;
  };
  const html = makeEl('html', { 'data-ag-cs-ambient': '1', 'data-ag-cs-motion': 'ultra', 'data-ag-cs-theme': 'dark' });
  const doc = {
    hidden: false,
    documentElement: html,
    createElement: (tag) => makeEl(tag),
    getElementById: () => null,
    querySelectorAll: (sel) => {
      if (sel.includes('data-ag-cs-prism-box="1"')) return boxes.filter((b) => b.getAttribute('data-ag-cs-prism-box') === '1');
      if (sel.includes('.ag-cs-prism-rim-cv')) return boxes.map((b) => b.querySelector('.ag-cs-prism-rim-cv')).filter(Boolean);
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return { doc, html, boxes, makeEl };
}

test('surface-composer-card 使用全周 prism rim，interaction-takeover-card 与 queued-messages-card 统一底边环境反射', () => {
  const { doc, boxes, makeEl } = createMockRimDom();
  const prevDoc = globalThis.document;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  const prevPerf = globalThis.performance;
  const rafs = [];
  let now = 100;

  globalThis.document = doc;
  globalThis.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => now };

  const composerCard = makeEl(
    'div',
    { class: 'surface-composer-card', 'data-ag-cs-prism-box': '1' },
    { left: 100, top: 760, width: 420, height: 96, right: 520, bottom: 856 }
  );
  const tkCard = makeEl(
    'div',
    { 'data-testid': 'interaction-takeover-card', class: 'agy-takeover-frame', 'data-ag-cs-prism-box': '1', 'data-ag-cs-prism-reflect': 'bottom' },
    { left: 100, top: 100, width: 420, height: 140, right: 520, bottom: 240 }
  );
  const queuedCard = makeEl(
    'div',
    { 'data-testid': 'queued-messages-card', 'data-ag-cs-prism-box': '1', 'data-ag-cs-prism-reflect': 'bottom' },
    { left: 100, top: 300, width: 420, height: 60, right: 520, bottom: 360 }
  );
  boxes.push(composerCard, tkCard, queuedCard);

  const ctl = createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'default',
    canMountRealCanvas: () => true,
    setAttrIfChanged: (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); },
    runGuardedMut: (fn) => fn(),
  });

  try {
    ctl.mountNewBoxes();
    // 1) 鼠标停留在问答卡底边附近（y=210，不命中下方 queued/composer）-> 问答卡走底边环境棱镜反射（lineWidth 1.15 + 0.46x 衰减 + destination-in 线性渐变裁切）
    ctl.onPointerMove({ clientX: 260, clientY: 210, target: tkCard });
    while (rafs.length) rafs.shift()(now += 16);

    const compCv = composerCard.querySelector('.ag-cs-prism-rim-cv');
    const tkCv = tkCard.querySelector('.ag-cs-prism-rim-cv');
    const qCv = queuedCard.querySelector('.ag-cs-prism-rim-cv');
    assert.ok(compCv && tkCv && qCv, '主输入框、问答卡与排队卡均应挂载 prism rim canvas');

    const tkStroke = tkCv._ctx.ops.find((op) => op[0] === 'stroke');
    assert.ok(tkStroke, '问答卡应绘制底边环境棱镜反射 stroke');
    assert.equal(tkStroke[1], 1.15, '问答卡底边反射线宽应保持 1.15');
    assert.ok(tkStroke[2] < 0.5, '问答卡底边反射应经 0.46x 克制衰减');
    assert.equal(tkCv._ctx.ops.some((op) => op[0] === 'linear'), true, '问答卡应启用底边反射 destination-in 线性裁切');

    // 2) 鼠标移动到排队卡底边（y=358）-> 排队卡保持一致底边反射（lineWidth 1.15 + destination-in 线性渐变裁切）
    qCv._ctx.ops.length = 0;
    ctl.onPointerMove({ clientX: 260, clientY: 358, target: queuedCard });
    while (rafs.length) rafs.shift()(now += 16);
    const qStroke = qCv._ctx.ops.find((op) => op[0] === 'stroke');
    assert.ok(qStroke, '排队卡应正常绘制底边反射 stroke');
    assert.equal(qStroke[1], 1.15, '排队卡底边反射线宽应保持 1.15');
    assert.equal(qCv._ctx.ops.some((op) => op[0] === 'linear'), true, '排队卡应保留底边反射 destination-in 线性裁切');

    // 3) 鼠标停留在主输入框边缘（y=770）-> 主输入框全周光框应全强度绘制，且不触发 destination-in 裁切
    compCv._ctx.ops.length = 0;
    ctl.onPointerMove({ clientX: 260, clientY: 770, target: composerCard });
    while (rafs.length) rafs.shift()(now += 16);
    const compOps = compCv._ctx.ops;
    const compStroke = compOps.find((op) => op[0] === 'stroke');
    assert.ok(compStroke, '鼠标在主输入框边缘时必须绘制全周棱镜边框 stroke');
    assert.equal(compStroke[1], 1.45, '主输入框全周棱镜边框线宽应为 1.45');
    assert.equal(compStroke[2], 1, '主输入框全周棱镜边框不应被底边反射 0.46x 衰减');
    assert.equal(compOps.some((op) => op[0] === 'linear'), false, '主输入框全周光框不得套用 destination-in 底边渐变裁切');
  } finally {
    ctl.teardown();
    globalThis.document = prevDoc;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancel;
    globalThis.performance = prevPerf;
  }

  // style.css 共享底边反射 canvas 样式与暗/浅双主题边缘质感契约
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(
    css.includes('& .surface-composer-card>.ag-cs-prism-rim-cv,& [data-ag-cs-prism-reflect="bottom"]>.ag-cs-prism-rim-cv{'),
    'style.css 必须为 [data-ag-cs-prism-reflect="bottom"] 卡片（含问答卡与排队卡）挂载共享 .ag-cs-prism-rim-cv 定位样式'
  );
  assert.ok(
    css.includes('& :is([data-testid="interaction-takeover-card"],.agy-takeover-frame){border-color:var(--border,var(--ag-cs-border-2))!important}'),
    'style.css 必须赋予暗色问答卡与输入框呼应的边缘质感'
  );
  assert.ok(
    css.includes('border-color:rgba(15,23,42,.11)!important;box-shadow:var(--_sp),0 1px 3px rgba(15,23,42,.06)'),
    'style.css 必须赋予浅色问答卡清晰的边缘高光与质感'
  );
});

test('同一 surface-composer-card 节点圆角从 28px 切换为 10px/14px/6px 时，markDirty 与 invalidateMetrics 均立即同步 roundRect 半径绝不锁死旧值', () => {
  const { doc, boxes, makeEl } = createMockRimDom();
  const prevDoc = globalThis.document;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancel = globalThis.cancelAnimationFrame;
  const prevPerf = globalThis.performance;
  const prevGcs = globalThis.getComputedStyle;
  const prevDpr = globalThis.devicePixelRatio;
  const rafs = [];
  let now = 100;
  let currentCornerPx = '28px';

  globalThis.document = doc;
  globalThis.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.performance = { now: () => now };
  globalThis.devicePixelRatio = 1;
  globalThis.getComputedStyle = (el) => ({
    borderTopLeftRadius: el === composerCard ? currentCornerPx : '10px',
  });

  const composerCard = makeEl(
    'div',
    { class: 'surface-composer-card', 'data-ag-cs-prism-box': '1' },
    { left: 100, top: 760, width: 420, height: 96, right: 520, bottom: 856 }
  );
  boxes.push(composerCard);

  const ctl = createPrismRimCanvasController({
    isDestroyed: () => false,
    isDarkTheme: () => true,
    motionReduced: () => false,
    getMinFrameGapMs: () => 0,
    getAmbientIntensity: () => 1,
    getAccentTone: () => 'default',
    canMountRealCanvas: () => true,
    setAttrIfChanged: (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); },
    runGuardedMut: (fn) => fn(),
  });

  try {
    ctl.mountNewBoxes();
    ctl.onPointerMove({ clientX: 260, clientY: 770, target: composerCard });
    while (rafs.length) rafs.shift()(now += 16);

    const readDrawnRoundRect = () => {
      const tr = compCv._ctx.ops.find((op) => op[0] === 'translate');
      const rr = compCv._ctx.ops.find((op) => op[0] === 'roundRect');
      assert.ok(tr && rr, '应包含 translate 与 roundRect 绘制指令');
      return [tr[1] + rr[1], tr[2] + rr[2], rr[3], rr[4], rr[5]];
    };

    const compCv = composerCard.querySelector('.ag-cs-prism-rim-cv');
    assert.ok(compCv, '主输入框应挂载 prism rim canvas');
    assert.equal(compCv.width, 422, 'w 应为 rect.width + ip(2)');
    assert.equal(compCv.height, 98, 'h 应为 rect.height + ip(2)');
    assert.deepEqual(readDrawnRoundRect(), [1, 1, 420, 96, 28], '初始 Chat 复用节点应按 28px 绘制');

    // 切回 Agent 模式：同一 DOM 节点圆角变为 10px，仅触发 markDirty() -> rfBox() 必须重读 readRad(box, 10)
    currentCornerPx = '10px';
    compCv._ctx.ops.length = 0;
    ctl.markDirty();
    ctl.onPointerMove({ clientX: 264, clientY: 770, target: composerCard });
    while (rafs.length) rafs.shift()(now += 16);
    assert.deepEqual(readDrawnRoundRect(), [1, 1, 420, 96, 10], 'markDirty() 重扫描后圆角必须立即同步为 10px，绝不滞留 28px');

    // 切换 cornerStyle=soft (14px) 并调用 invalidateMetrics()，无需移动鼠标也要直接刷新重绘
    currentCornerPx = '14px';
    compCv._ctx.ops.length = 0;
    ctl.invalidateMetrics();
    while (rafs.length) rafs.shift()(now += 16);
    assert.deepEqual(readDrawnRoundRect(), [1, 1, 420, 96, 14], 'invalidateMetrics() 应立即以 14px 同心重绘');

    // 切换 cornerStyle=sharp (6px) 并调用 invalidateMetrics()
    currentCornerPx = '6px';
    compCv._ctx.ops.length = 0;
    ctl.invalidateMetrics();
    while (rafs.length) rafs.shift()(now += 16);
    assert.deepEqual(readDrawnRoundRect(), [1, 1, 420, 96, 6], 'invalidateMetrics() 应立即以 6px 同心重绘');
  } finally {
    ctl.teardown();
    globalThis.document = prevDoc;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancel;
    globalThis.performance = prevPerf;
    globalThis.getComputedStyle = prevGcs;
    globalThis.devicePixelRatio = prevDpr;
  }

  // 验证 ui-runtime.js 监听 data-ag-prism-mode 与 data-ag-cs-corners 变更时均调用 invRim()
  const uiRt = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  assert.ok(uiRt.includes('data-ag-cs-corners'), 'ui-runtime.js ROOT_ATTR_FILTER 必须包含 data-ag-cs-corners');
  assert.match(
    uiRt,
    /if\s*\(an\s*===\s*'data-ag-prism-mode'\s*\|\|\s*an\s*===\s*'data-ag-cs-corners'\)\s*\{\s*invRim\(\);/,
    'ui-runtime.js 必须在 data-ag-prism-mode 或 data-ag-cs-corners 变更时立即调用 invRim()'
  );
});
