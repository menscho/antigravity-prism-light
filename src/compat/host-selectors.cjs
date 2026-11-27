// Antigravity 宿主 UI 弹性选择器契约注册表（L0 纯数据与只读求值叶子模块，0 副作用、0 外部依赖）
'use strict';

const CONTRACT_TIERS = Object.freeze({ CRITICAL: 'critical', MAJOR: 'major', OPTIONAL: 'optional' });
const PROBE_STATUSES = Object.freeze({ OK: 'OK', FALLBACK_ONLY: 'FALLBACK_ONLY', BROKEN_CRITICAL: 'BROKEN_CRITICAL' });

const mkContract = (id, tier, scope, sinceHostVersion, affectedModules, primary, fallback, structural) =>
  Object.freeze({
    id,
    tier,
    scope,
    sinceHostVersion,
    affectedModules: Object.freeze(affectedModules),
    primary: Object.freeze({ selector: primary[0], description: primary[1] }),
    fallback: Object.freeze({ selector: fallback[0], description: fallback[1] }),
    structural: Object.freeze({ selector: structural[0], description: structural[1], fragile: true }),
  });

// 13 条核心宿主 UI 契约：主锚点（稳定 data-testid/role）-> 语义降级（.agy-*）-> 结构兜底（标注 fragile: true）
const HOST_SELECTOR_CONTRACTS = Object.freeze([
  mkContract(
    'sidebarSplit', 'critical', 'shell', '2.33.0',
    ['style.css', 'ui-runtime.js', 'host-workbench-enhancer.js'],
    ['[data-testid="sidebar-split"]', '主侧栏分屏容器稳定测试锚点'],
    ['[data-testid="conversation-list-sidebar"], .agy-shell [data-testid="sidebar-sash"]', '会话列表侧栏或分屏拖拽条语义锚点'],
    ['.agy-shell aside, .agy-shell nav', '侧栏结构标签兜底']
  ),
  mkContract(
    'hoverCardPortal', 'optional', 'overlay', '2.34.0',
    ['style.css', 'ui-runtime.js'],
    ['[data-radix-popper-content-wrapper], [data-testid="hover-card-content"]', 'Radix 浮层 Portal 或 HoverCard 内容节点'],
    ['.agy-overlay[role="tooltip"], .agy-popover', '宿主语义浮层类'],
    ['body > div[style*="translate"]', '顶层定位弹层结构兜底']
  ),
  mkContract(
    'modelSelectorTrigger', 'critical', 'conversation', '2.33.0',
    ['ui-runtime.js', 'vendor/periodic-picker/periodic-picker.js', 'vendor/effort-slider/slider-coexist.js'],
    ['[data-testid="model-selector-trigger"]', '模型切换触发按钮稳定锚点'],
    ['button[aria-haspopup="listbox"][aria-label*="model" i], .agy-model-trigger', '模型触发按钮 ARIA/语义类兜底'],
    ['[data-testid="composer-footer"] button[aria-expanded]', '输入区底栏展开按钮结构兜底']
  ),
  mkContract(
    'modelSelectorPanel', 'optional', 'overlay', '2.33.0',
    ['style.css', 'ui-runtime.js', 'vendor/periodic-picker/periodic-picker.js'],
    ['[data-testid="model-selector-panel"]', '模型选择浮层面板稳定锚点'],
    ['[role="listbox"][aria-label*="model" i], .agy-fastpick', '模型列表角色或快速选择浮层语义类'],
    ['[data-radix-popper-content-wrapper] [role="menu"]', 'Radix 弹出菜单结构兜底']
  ),
  mkContract(
    'composerFooter', 'major', 'conversation', '2.33.0',
    ['style.css', 'ui-runtime.js', 'vendor/effort-slider/slider-coexist.js'],
    ['[data-testid="composer-footer"], [data-testid="agent-input-footer"]', '输入编排器底部操作栏稳定锚点'],
    ['.agy-composer-footer, [data-testid="agent-input-box"] footer', '输入底栏语义类或 footer 子节点'],
    ['[data-testid="agent-input-box"] > div:last-child', '输入框末位子容器结构兜底']
  ),
  mkContract(
    'composerEditor', 'critical', 'conversation', '2.33.0',
    ['style.css', 'ui-runtime.js', 'smooth-caret.js', 'vendor/prompt-suggester/suggester-client.js'],
    ['[data-testid="agent-input-box"], [data-testid="composer-editor"]', '对话输入框核心容器锚点'],
    ['.agy-composer [contenteditable="true"], .ProseMirror[contenteditable="true"]', '富文本可编辑区语义类'],
    ['div[role="textbox"][contenteditable="true"]', '通用 textbox 可编辑节点兜底']
  ),
  mkContract(
    'conversationView', 'critical', 'conversation', '2.33.0',
    ['style.css', 'ui-runtime.js', 'stream-choreography.js', 'conv-aura.js', 'context-menu-btw.js'],
    ['[data-testid="conversation-view"], [data-cascade-id]', '主对话流容器或 cascade 会话锚点'],
    ['.agy-conversation, [data-testid="chat-panel"]', '对话流语义类'],
    ['main [data-testid*="conversation"]', '主内容区模糊 conversation 属性兜底']
  ),
  mkContract(
    'autoscrollViewport', 'major', 'conversation', '2.34.0',
    ['style.css', 'ui-runtime.js', 'host-workbench-enhancer.js'],
    ['[data-testid="autoscroll-viewport"], [data-ag-autoscroll="true"]', '对话自动滚动视口稳定锚点'],
    ['.agy-scroll-viewport, [data-testid="conversation-view"] [data-radix-scroll-area-viewport]', 'Radix 滚动视口或语义类'],
    ['[data-testid="conversation-view"] .overflow-y-auto', 'Tailwind 纵滚类结构兜底']
  ),
  mkContract(
    'overviewPanelHost', 'major', 'shell', '2.34.0',
    ['style.css', 'ui-runtime.js', 'vendor/omni-viewer/omni-client.js'],
    ['[data-testid="overview-panel-host"], [data-testid="overview-panel"]', '右侧概览/辅助宿主面板锚点'],
    ['[data-testid="aux-pane-split"], [data-testid="overview-panel-host-sibling"]', '辅助分屏或兄弟容器锚点'],
    ['.agy-shell aside:last-of-type', '外壳尾部侧栏结构兜底']
  ),
  mkContract(
    'chatBackdropChain', 'critical', 'shell', '2.33.0',
    ['style.css', 'ui-runtime.js', 'home-ripple-host.js', 'conv-aura.js'],
    ['.agy-shell, [data-testid="chat-backdrop-root"]', '宿主最外层背景链根壳体'],
    ['body.theme-standalone, body.monaco-workbench', 'Standalone/Workbench 根主题宿主类'],
    ['.agy-layout-vars', '布局变量承载节点兜底']
  ),
  mkContract(
    'stepPlan', 'optional', 'overlay', '2.34.0',
    ['style.css', 'ui-runtime.js', 'vendor/thought-translator/thought-client.js'],
    ['[data-testid="step-plan"], [data-testid="agent-plan-card"]', '任务计划/思维步骤卡片稳定锚点'],
    ['[data-testid*="thought"], [data-testid*="plan-step"]', '思考/步骤属性模糊语义兜底'],
    ['[data-testid="conversation-view"] details', '折叠详情结构标签兜底']
  ),
  mkContract(
    'sideQuestionButton', 'optional', 'overlay', '2.35.0',
    ['context-menu-btw.js', 'ui-runtime.js'],
    ['[data-testid="side-question-button"], [data-testid="btw-button"]', '侧边追问 (/btw) 原生触发按钮锚点'],
    ['button[aria-label*="side question" i], button[aria-label*="/btw" i]', '侧边追问 ARIA 标签语义兜底'],
    ['[data-testid="composer-footer"] button[title*="btw" i]', '底栏 title 模糊结构兜底']
  ),
  mkContract(
    'mainContentBody', 'critical', 'shell', '2.33.0',
    ['style.css', 'ui-runtime.js', 'home-studio-panel.js', 'host-workbench-enhancer.js'],
    ['[data-testid="main-content-body"], [data-testid="pane-titlebar-toolbar"]', '主工作区内容主体与标题栏锚点'],
    ['.agy-shell main, .agy-home, .agy-shell .surface-glass', '主内容语义标签或首页/毛玻璃容器'],
    ['.agy-shell > div', '外壳直系子容器结构兜底']
  ),
]);

function safeQueryAll(doc, selector) {
  if (!doc || typeof doc.querySelectorAll !== 'function' || !selector) return [];
  try {
    const list = doc.querySelectorAll(selector);
    return list ? Array.from(list) : [];
  } catch { return []; }
}

function inspectMatchGeometry(nodes) {
  let visibleCount = 0;
  let sampleRect = null;
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (!el || typeof el.getBoundingClientRect !== 'function') continue;
    try {
      const r = el.getBoundingClientRect();
      if (!r || typeof r.width !== 'number' || typeof r.height !== 'number') continue;
      if (r.width > 0 && r.height > 0) {
        visibleCount += 1;
        if (!sampleRect) {
          sampleRect = { x: Math.round(r.x || r.left || 0), y: Math.round(r.y || r.top || 0), width: Math.round(r.width), height: Math.round(r.height) };
        }
      }
    } catch {}
  }
  return { visibleCount, sampleRect };
}

// 纯只读评估器：仅调用 querySelectorAll 与可选 getBoundingClientRect，零 DOM 写入、零点击、零副作用
function evaluateSelectorsInDoc(doc, opts = {}) {
  const contracts = Array.isArray(opts.contracts) ? opts.contracts : HOST_SELECTOR_CONTRACTS;
  const snapshotShellOnly = opts.snapshotShellOnly === true;
  const results = [];
  let primary = 0, fallback = 0, structural = 0, missing = 0, deferred = 0, brokenCritical = 0, degradedCore = 0;

  for (let i = 0; i < contracts.length; i++) {
    const c = contracts[i];
    const pNodes = safeQueryAll(doc, c.primary?.selector);
    const fNodes = pNodes.length ? [] : safeQueryAll(doc, c.fallback?.selector);
    const sNodes = pNodes.length || fNodes.length ? [] : safeQueryAll(doc, c.structural?.selector);

    let matchedLayer = 'none', matchedNodes = [], status = 'MISSING', fragile = false, matchedSelector = '';
    if (pNodes.length > 0) {
      matchedLayer = 'primary'; matchedNodes = pNodes; status = 'OK'; matchedSelector = c.primary.selector; primary += 1;
    } else if (fNodes.length > 0) {
      matchedLayer = 'fallback'; matchedNodes = fNodes; status = 'FALLBACK_ONLY'; matchedSelector = c.fallback.selector; fallback += 1;
      if (c.tier === 'critical' || c.tier === 'major') degradedCore += 1;
    } else if (sNodes.length > 0) {
      matchedLayer = 'structural'; matchedNodes = sNodes; status = 'FALLBACK_ONLY'; fragile = c.structural?.fragile !== false;
      matchedSelector = c.structural.selector; structural += 1;
      if (c.tier === 'critical' || c.tier === 'major') degradedCore += 1;
    } else if (snapshotShellOnly && c.scope !== 'shell') {
      status = 'DEFERRED_DYNAMIC'; deferred += 1;
    } else {
      status = c.tier === 'critical' ? 'BROKEN_CRITICAL' : 'MISSING'; missing += 1;
      if (c.tier === 'critical') brokenCritical += 1;
    }

    const geom = inspectMatchGeometry(matchedNodes);
    results.push({
      id: c.id, tier: c.tier, scope: c.scope || 'shell', status, matchedLayer, fragile,
      count: matchedNodes.length, visibleCount: geom.visibleCount, sampleRect: geom.sampleRect,
      sinceHostVersion: c.sinceHostVersion,
      affectedModules: Array.isArray(c.affectedModules) ? [...c.affectedModules] : [],
      matchedSelector,
    });
  }

  const overallStatus =
    brokenCritical > 0 ? PROBE_STATUSES.BROKEN_CRITICAL : degradedCore > 0 ? PROBE_STATUSES.FALLBACK_ONLY : PROBE_STATUSES.OK;

  return {
    overallStatus,
    mode: snapshotShellOnly ? 'shell-snapshot' : 'strict',
    total: contracts.length,
    counts: { primary, fallback, structural, missing, deferred, brokenCritical },
    results,
  };
}

// 生成在运行中 Antigravity 主窗口通过 CDP Runtime.evaluate 执行的纯只读探针表达式（零点击、零写入、零副作用）
function buildLiveProbeExpression(contracts = HOST_SELECTOR_CONTRACTS, opts = {}) {
  const payload = JSON.stringify(
    contracts.map((c) => ({
      id: c.id, tier: c.tier, scope: c.scope || 'shell', sinceHostVersion: c.sinceHostVersion,
      affectedModules: c.affectedModules, primary: c.primary.selector, fallback: c.fallback.selector,
      structural: c.structural.selector, structuralFragile: c.structural.fragile !== false,
    }))
  );
  const shellOnlyFlag = opts.snapshotShellOnly === true ? 'true' : 'false';
  return `(() => {
  const contracts = ${payload}, shellOnly = ${shellOnlyFlag};
  const qsa = (sel) => { try { return sel ? Array.from(document.querySelectorAll(sel)) : []; } catch { return []; } };
  const geom = (nodes) => {
    let visibleCount = 0, sampleRect = null;
    for (let i = 0; i < nodes.length; i++) {
      try {
        const r = nodes[i].getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          visibleCount += 1;
          if (!sampleRect) sampleRect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        }
      } catch {}
    }
    return { visibleCount, sampleRect };
  };
  let primary = 0, fallback = 0, structural = 0, missing = 0, deferred = 0, brokenCritical = 0, degradedCore = 0;
  const results = contracts.map((c) => {
    const p = qsa(c.primary), f = p.length ? [] : qsa(c.fallback), s = p.length || f.length ? [] : qsa(c.structural);
    let matchedLayer = 'none', nodes = [], status = 'MISSING', fragile = false, matchedSelector = '';
    if (p.length) { matchedLayer = 'primary'; nodes = p; status = 'OK'; matchedSelector = c.primary; primary += 1; }
    else if (f.length) { matchedLayer = 'fallback'; nodes = f; status = 'FALLBACK_ONLY'; matchedSelector = c.fallback; fallback += 1; if (c.tier === 'critical' || c.tier === 'major') degradedCore += 1; }
    else if (s.length) { matchedLayer = 'structural'; nodes = s; status = 'FALLBACK_ONLY'; fragile = c.structuralFragile; matchedSelector = c.structural; structural += 1; if (c.tier === 'critical' || c.tier === 'major') degradedCore += 1; }
    else if (shellOnly && c.scope !== 'shell') { status = 'DEFERRED_DYNAMIC'; deferred += 1; }
    else { status = c.tier === 'critical' ? 'BROKEN_CRITICAL' : 'MISSING'; missing += 1; if (c.tier === 'critical') brokenCritical += 1; }
    const g = geom(nodes);
    return { id: c.id, tier: c.tier, scope: c.scope, status, matchedLayer, fragile, count: nodes.length, visibleCount: g.visibleCount, sampleRect: g.sampleRect, sinceHostVersion: c.sinceHostVersion, affectedModules: c.affectedModules, matchedSelector };
  });
  const overallStatus = brokenCritical > 0 ? 'BROKEN_CRITICAL' : (degradedCore > 0 ? 'FALLBACK_ONLY' : 'OK');
  return {
    overallStatus, mode: shellOnly ? 'shell-snapshot' : 'live', total: contracts.length,
    counts: { primary, fallback, structural, missing, deferred, brokenCritical },
    host: {
      title: String(document.title || ''), protocol: String(location && location.protocol || ''),
      userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '',
      prismVersion: document.documentElement ? String(document.documentElement.getAttribute('data-ag-prism') || '') : '',
    },
    results,
  };
})()`;
}

// 跨模块交互与侧栏滚动选择器共享契约（@host-compat，与 ui-runtime / mascot-hop-transition / host-workbench-enhancer 对齐）
const HOST_INTERACTION_SELECTORS = Object.freeze({
  takeoverCard: '[data-testid="interaction-takeover-card"]',
  takeoverFrame: '.agy-takeover-frame',
  sideQuestionPanel: '[data-testid="side-question-panel"]',
  takeoverSurface: '[data-testid="interaction-takeover-card"], .agy-takeover-frame, [data-testid="side-question-panel"]',
  subagentConversation: '[data-testid="subagent-tab-conversation"]',
  sideQuestionTabConversation: '[data-testid="side-question-tab-conversation"]',
  scrollToBottomButton: '.agy-scroll-bottom',
  autoscrollOverlayHost: '[data-autoscroll-overlay-host]',
  auxPaneSplit: '[data-testid="aux-pane-split"]',
});

module.exports = {
  CONTRACT_TIERS,
  PROBE_STATUSES,
  HOST_SELECTOR_CONTRACTS,
  HOST_INTERACTION_SELECTORS,
  evaluateSelectorsInDoc,
  buildLiveProbeExpression,
};
