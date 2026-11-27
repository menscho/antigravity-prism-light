/**
 * Obsidian Prism — Channel 4 On-Demand Host UI Localization Runtime (UMD, WeakMap reversible, 0fps idle)
 *
 * Upstream Credit:
 *   Dictionary & DOM localization approach inspired by yiheng8023/antigravity-chinese (v3.3.63)
 *   (MIT License, Copyright (c) 2026 Antigravity Chinese Localization Contributors,
 *    https://github.com/yiheng8023/antigravity-chinese).
 *   Re-architected for Obsidian Prism (GPL-3.0-only) as a Zero-ASAR pure CDP on-demand channel.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    var api = factory(root);
    if (root) root.__agPrismHostI18nFactory = api;
 }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function (root) {
 'use strict';
 var hasOwn = Object.prototype.hasOwnProperty;
 var ZH_CHAR_RE = /[\u4e00-\u9fa5]/;
 var EN_ALPHA_RE = /[a-zA-Z]/;
 var IGNORED_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, SVG: 1, PATH: 1, CANVAS: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, KBD: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, TITLE: 1 };
 var IGNORED_CLASSES = ['monaco-editor', 'monaco-diff-editor', 'diffOverview', 'view-lines', 'view-line', 'cdr', 'line-insert', 'line-delete', 'monaco-mouse-cursor-text', 'xterm', 'terminal', 'token', 'hljs', 'shiki', 'cm-editor', 'code-block', 'editor-instance', 'ag-cs-inline-diff-box', 'ag-cs-inline-diff-card', 'diff-editor', 'diff-view', 'diff-line', 'diff-hunk'];
 var DIFF_CLASS_SUBSTRS = ['diff-editor', 'diff-view', 'diff-line', 'diff-hunk', 'cm-editor', 'shiki', 'hljs'];
 function toLookupMap(arr) {
 var map = Object.create(null);
 for (var i = 0; i < arr.length; i++) map[arr[i]] = 1;
 return map;
 }
 var IGNORED_CLASS_MAP = toLookupMap(IGNORED_CLASSES);
 var MODEL_SELECTOR_TESTIDS = { 'model-selector-trigger': 1, 'model-selector-panel': 1, 'model-selector-item': 1, 'model-selector-effort-option': 1, 'model-selector-effort-group': 1, 'model-selector-list': 1, 'model-selector-orchestrator': 1, 'orchestrator-effort-bar': 1, 'orchestrator-picker-row': 1, 'orchestrator-picker-effort': 1 };
 var PRISM_OWNED_IDS = { 'ag-cs-settings-sec': 1, 'ag-prism-settings-sec': 1, 'ag-prism-pulse-bar': 1, 'ag-pulse-status-bar': 1, 'ag-prism-periodic-picker-root': 1, 'ag-prism-overlay-portal': 1 };
 var PRISM_OWNED_ATTRS = ['data-ag-prism-pulse-bar', 'data-ag-prism-ui', 'data-ag-cs-ui', 'data-ag-no-i18n', 'data-ag-owned', 'data-ces-part', 'data-ag-prism-sidebar-owned', 'data-ag-prism-omni-owned', 'data-ag-prism-fallback', 'data-ag-prism-overlay'];
 var PRISM_CLASS_PREFIXES = ['ag-cs-', 'ag-prism-', 'ag-v2-', 'ag-omni-', 'ag-ss-', 'ag-pp-', 'ces-', 'ag-anim-'];
 var EXTERNAL_OWNED_IDS = { 'agy-theme-switcher': 1, 'agy-theme-menu': 1, 'antigravity-quota-widget': 1, 'antigravity-translation-audit': 1 };
 var EXTERNAL_OWNED_ATTRS = ['data-agy-hans-ui'];
 var CHAT_PROSE_CLASSES = ['prose', 'markdown-body', 'chat-markdown-message', 'rendered-markdown'];
 var CHAT_PROSE_CLASS_MAP = toLookupMap(CHAT_PROSE_CLASSES);
 var CHAT_PROSE_ATTRS = ['data-markdown-root', 'data-message-content', 'data-message-id'];
 var CHAT_PROSE_TESTIDS = { 'user-message': 1, 'assistant-message': 1, 'agent-input-box': 1, 'user-message-bubble': 1, 'user-message-content': 1, 'user-input-step': 1, 'planner-response-text': 1, 'artifact-view': 1, 'side-question-panel': 1, 'side-question-conversation': 1, 'subagent-tab-conversation': 1, 'terminal-output': 1, 'background-task-command': 1, 'entity-pill': 1, 'attached-context-pill': 1, 'user-message-document-chip': 1, 'artifact-card': 1, 'bubble-artifact-card': 1 };
 var INTERACTIVE_CHAT_TESTIDS = { 'permissions-selector-trigger': 1, 'plan-command-fyi-alert': 1, 'changed-files-card-header': 1, 'worked-for-collapsible': 1, 'tool-group-collapsible': 1, 'step-plan-chip': 1, 'thinking-collapsible-trigger': 1 };
 var USER_CONTENT_BOUNDARY = {
 testids: { 'conversation-list-sidebar': 1, 'conversation-row-sidebar': 1, 'project-header': 1, 'workspace-switcher': 1, 'home-greeting': 1, 'conversation-navigator': 1, 'editor-tabs': 1, 'file-tabs': 1, 'file-tab': 1, 'editor-tab': 1 },
 classes: ['tabs-container', 'tab-label', 'monaco-icon-label', 'editor-tabs', 'file-tabs'],
 attrs: ['data-resource-name', 'data-uri', 'data-file-path', 'data-file-href', 'data-omni-path'],
 };
 var USER_CONTENT_CLASS_MAP = toLookupMap(USER_CONTENT_BOUNDARY.classes);
 var MAX_SAFE_BOUNDARY_DEPTH = 128;
 var TRANSLATABLE_ATTRS = ['title', 'placeholder', 'aria-label', 'data-tooltip', 'alt', 'aria-description'];
 var EXTERNAL_GLOBAL_SIGNATURE_GROUPS = [
 { provider: 'antigravity-cn-community', keys: ['__agySidebarDragFixInstalled'] },
 { provider: 'yuexps/Antigravity-Hans', keys: ['__antigravityZhPatchInstalled', '__antigravityZhSetLang', '__antigravityZhPatchObserver'] },
 { provider: 'yiheng8023', keys: ['__AGY_I18N_INITIALIZED__', '__AGY_I18N_DATA__', '__AGY_CREATE_ENGINE__', '__AGY_SWARM_I18N__', '__AGY_I18N__'] },
 { provider: '3169657175', keys: ['__agyI18n', '__agyTranslateEnhancementText'] },
 { provider: 'renkeshui', keys: ['__antigravity_i18n_runner_active', '__ANTIGRAVITY_I18N_DATA__', '__ANTIGRAVITY_REVERSE_MAP__'] },
 { provider: 'nianshou555qiansui', keys: ['__ag_hanhua_engine__'] },
 { provider: 'Ace2025001', keys: ['__AGY_ZHCN__', '__AGY_ZHCN_LOOKUP__'] },
 { provider: 'Zero-Touch', keys: ['__antigravityZh', '__antigravityZhDict'] },
 { provider: 'yunjuanyunshu', keys: ['__AG_ZH__'] },
 { provider: 'agy-powertools', keys: ['__agyLocalization'] },
 { provider: 'generic-external', keys: ['__ANTIGRAVITY_CN__', '__ANTIGRAVITY_I18N__', '__AG_I18N__', '__AG_CN_PATCH__', '__AGY_CN__', '__I18N_PATCHED__'] },
 ];
 var KNOWN_EXTERNAL_ATTRS = ['data-agy-i18n', 'data-ag-cn', 'data-i18n-patched', 'data-translated'];
 var CHROME_ZH_ANCHORS = { 设置: 1, 偏好设置: 1, 新建对话: 1, 扩展: 1, 终端: 1, 源代码管理: 1, 工作区: 1, 视图: 1, 窗口: 1, 自动化: 1, 项目列表: 1 };
 function getAttr(el, name) {
 if (!el || typeof el.getAttribute !== 'function') return null;
 return el.getAttribute(name);
 }
 function hasAttr(el, name) {
 if (!el) return false;
 if (typeof el.hasAttribute === 'function') return el.hasAttribute(name);
 return getAttr(el, name) !== null;
 }
 var EMPTY_CLASS_TOKENS = [];
 var classTokenCache = typeof WeakMap === 'function' ? new WeakMap() : null;
 function getClassTokens(el) {
 if (!el) return EMPTY_CLASS_TOKENS;
 var raw = typeof el.className === 'string' ? el.className : '';
 if (!raw) return EMPTY_CLASS_TOKENS;
 if (classTokenCache) {
 var cached = classTokenCache.get(el);
 if (cached && cached.raw === raw) return cached.tokens;
 }
 var tokens = [], len = raw.length, start = -1;
 for (var i = 0; i < len; i++) {
 var c = raw.charCodeAt(i);
 if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 160) {
 if (start >= 0) { tokens.push(raw.slice(start, i)); start = -1; }
 } else if (start < 0) start = i;
 }
 if (start >= 0) tokens.push(start === 0 ? raw : raw.slice(start));
 if (classTokenCache) classTokenCache.set(el, { raw: raw, tokens: tokens });
 return tokens;
 }
 function hasElementChild(el) {
 if (!el) return false;
 if (el.firstElementChild !== undefined) return Boolean(el.firstElementChild);
 var ch = el.firstChild;
 while (ch) {
 if (ch.nodeType === 1) return true;
 ch = ch.nextSibling;
 }
 return false;
 }
 function getChildElementCount(el) {
 if (!el) return 0;
 if (typeof el.childElementCount === 'number') return el.childElementCount;
 if (el.children) return el.children.length;
 var cnt = 0;
 var ch = el.firstChild;
 while (ch) {
 if (ch.nodeType === 1) cnt++;
 ch = ch.nextSibling;
 }
 return cnt;
 }
 function isPrismOwnedSelf(el, preTokens) {
 if (!el || el.nodeType !== 1) return false;
 var id = el.id || getAttr(el, 'id') || '';
 if (id && hasOwn.call(PRISM_OWNED_IDS, id)) return true;
 for (var i = 0; i < PRISM_OWNED_ATTRS.length; i++) {
 if (hasAttr(el, PRISM_OWNED_ATTRS[i])) return true;
 }
 var tokens = preTokens || getClassTokens(el);
 for (var t = 0; t < tokens.length; t++) {
 var cls = tokens[t];
 for (var p = 0; p < PRISM_CLASS_PREFIXES.length; p++) {
 if (cls.indexOf(PRISM_CLASS_PREFIXES[p]) === 0) return true;
 }
 }
 return false;
 }
 function hasMatchingAncestor(el, pred, maxDepth) {
 var cur = el && el.nodeType === 3 ? el.parentElement || el.parentNode : el;
 var limit = maxDepth || MAX_SAFE_BOUNDARY_DEPTH;
 for (var depth = 0; cur && depth < limit; depth++) {
 if (cur.nodeType === 1 && pred(cur)) return true;
 cur = cur.parentElement || cur.parentNode;
 }
 return false;
 }
 function isPrismOwnedElement(el) {
 return hasMatchingAncestor(el, isPrismOwnedSelf);
 }
 function isModelSelectorSelf(el, preTid) {
 if (!el || el.nodeType !== 1) return false;
 var tid = preTid !== undefined ? preTid : getAttr(el, 'data-testid');
 if (tid && hasOwn.call(MODEL_SELECTOR_TESTIDS, tid)) return true;
 return (
 hasAttr(el, 'data-effort') ||
 hasAttr(el, 'data-ag-cs-model-submenu') ||
 hasAttr(el, 'data-ag-cs-orch-l2') ||
 hasAttr(el, 'data-ag-cs-orch-l3') ||
 hasAttr(el, 'data-ces-orch-row')
 );
 }
 function isModelSelectorElement(el) {
 return hasMatchingAncestor(el, isModelSelectorSelf);
 }
 function isOnlyIgnoredElemChildren(el) {
 var ch = firstElemChild(el);
 if (!ch) return true;
 var n = 0;
 while (ch) {
 if (++n > 6 || !isDirectIgnoredSelf(ch)) return false;
 ch = nextElemSib(ch);
 }
 return true;
 }
 function isChatProseSelf(el, preTokens, preTid) {
 if (!el || el.nodeType !== 1) return false;
 var tid = preTid !== undefined ? preTid : getAttr(el, 'data-testid');
 if (tid && hasOwn.call(CHAT_PROSE_TESTIDS, tid)) return true;
 for (var i = 0; i < CHAT_PROSE_ATTRS.length; i++) {
 if (hasAttr(el, CHAT_PROSE_ATTRS[i])) return true;
 }
 var tokens = preTokens || getClassTokens(el);
 for (var t = 0; t < tokens.length; t++) {
 if (CHAT_PROSE_CLASS_MAP[tokens[t]]) return true;
 }
 return false;
 }
 var STEP_ARG_CLASS_MAP = toLookupMap(['font-mono', 'monospace', 'file-path', 'file-name', 'cmd-arg', 'command-text']);
 var STEP_ARG_ATTRS = ['data-path', 'data-filename', 'data-command', 'data-symbol', 'data-arg'];
 var STEP_VERB_SET = toLookupMap(['Read', 'Edited', 'Analyzed', 'Searched', 'Ran', 'Running', 'Viewed', 'Explored', 'Created', 'Updated', 'Deleted', 'Listed', 'Checked', 'Posted', 'Killed', '已读取', '已编辑', '已分析', '已搜索', '已运行', '正在运行', '已查看', '已探索', '已创建', '创建于', '已更新', '更新于', '已删除', '已列出', '已检查', '已发布', '已终止', 'Okundu', 'Düzenlendi', 'Analiz edildi', 'Arandı', 'Çalıştırıldı', 'Çalışıyor', 'Görüntülendi', 'Keşfedildi', 'Oluşturuldu', 'Güncellendi', 'Silindi', 'Listelendi', 'Kontrol edildi', 'Gönderildi', 'Sonlandırıldı', 'İncelendi']);
 function isStepPathSegChar(c) {
 return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 46 || c === 45;
 }
 function isStepWhitespaceChar(c) {
 return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 160;
 }
 var STEP_CMD_PREFIX_RE = /^(?:[a-zA-Z]:[\\/]|\/|\.\.?[\\/]|~[\\/]|(?:npm|pnpm|yarn|npx|node|git|python3?|pip|uv|cargo|go|make|bash|sh|pwsh|powershell|cmd|curl|rg|grep|find|ls|dir|cat|sed|awk|docker|kubectl|gh|tsc|eslint|vitest|jest)\s)/;
 function looksLikeStepPathOrCmd(s) {
 if (!s || typeof s !== 'string' || s.length > 260) return false;
 if (STEP_CMD_PREFIX_RE.test(s)) return true;
 var len = s.length;
 for (var i = 1; i < len - 1; i++) {
 var ch = s.charCodeAt(i);
 if ((ch === 47 || ch === 92) && isStepPathSegChar(s.charCodeAt(i - 1)) && isStepPathSegChar(s.charCodeAt(i + 1))) {
 return true;
 }
 if (
 ch === 45 &&
 i + 2 < len &&
 s.charCodeAt(i + 1) === 45 &&
 (isStepWhitespaceChar(s.charCodeAt(i - 1)) || /\s/.test(s.charAt(i - 1))) &&
 isStepPathSegChar(s.charCodeAt(i + 2)) &&
 s.charCodeAt(i + 2) !== 46
 ) {
 return true;
 }
 }
 return false;
 }
 var STEP_SAFE_SUFFIX_RE = /^(?:Task Log|任务日志|Görev günlüğü|finished|Finished)$|(?:^|\s)finished$|(?:^|\s|·\s*)Exited\s+with\s+code\s+-?\d+$|:\s*Notification\s+timeout\s+reached$|^Notification\s+timeout\s+reached$/;
 var STEP_PLAIN_TEXT_PREFIX_RE = /^(?:(?:Thought|Worked)\s+for\b|Thinking(?:\.\.\.|…)?$|Thought\s+process$|Asking(?:\s|$)|Waiting(?:\s|$)|Explored(?:\s|,|$)|Ran(?:\s|$)|Running(?:\s|$)|Edited(?:\s|$)|Read(?:\s|$)|Analyzed(?:\s|$)|Searched(?:\s|$)|Viewed(?:\s|$)|Listed(?:\s|$)|Checked(?:\s|$)|Deleted(?:\s|$)|Posted(?:\s|$)|Killed(?:\s|$)|Worked$|Timed\s+\d+|Timer\s+has\s+expired$|\d+(?:\s*\/\s*\d+)?\s+steps?$|\d+\s+tasks?\s+running$|(?:Outside|Inside)\s+of\s+Project$|Task\s+Logs?$|Agent\s+finished|Process\s+exited|Exited\s+with\s+code\s+-?\d+$|Notification\s+timeout\s+reached$|finished$|Finished$)/;
 var STEP_TAIL_EXITED_RE = /^\s*Exited\s+with\s+code\s+-?\d+$/;
 var STEP_TAIL_TIMEOUT_RE = /^\s*Notification\s+timeout\s+reached$/;
 function isStepPlainTextAllowed(trimmed) {
 if (!trimmed || typeof trimmed !== 'string' || trimmed.length > 260) return false;
 if (STEP_PLAIN_TEXT_PREFIX_RE.test(trimmed)) return true;
 var len = trimmed.length;
 if (len >= 9 && trimmed.slice(len - 8) === 'finished') {
 var prevCh = trimmed.charAt(len - 9);
 if (isStepWhitespaceChar(prevCh.charCodeAt(0)) || /\s/.test(prevCh)) return true;
 }
 var dotIdx = trimmed.lastIndexOf('·');
 if (dotIdx !== -1 && STEP_TAIL_EXITED_RE.test(trimmed.slice(dotIdx + 1))) return true;
 var colonIdx = trimmed.lastIndexOf(':');
 if (colonIdx !== -1 && STEP_TAIL_TIMEOUT_RE.test(trimmed.slice(colonIdx + 1))) return true;
 return false;
 }
 function firstElemChild(el) {
 if (!el) return null;
 if (el.firstElementChild !== undefined) return el.firstElementChild;
 for (var c = el.firstChild; c; c = c.nextSibling) { if (c.nodeType === 1) return c; }
 return null;
 }
 function nextElemSib(el) {
 if (!el) return null;
 if (el.nextElementSibling !== undefined) return el.nextElementSibling;
 for (var s = el.nextSibling; s; s = s.nextSibling) { if (s.nodeType === 1) return s; }
 return null;
 }
 function prevElemSib(el) {
 if (!el) return null;
 if (el.previousElementSibling !== undefined) return el.previousElementSibling;
 for (var s = el.previousSibling; s; s = s.previousSibling) { if (s.nodeType === 1) return s; }
 return null;
 }
 function isAllowedStaticUriLabel(el) {
 if (!el || el.nodeType !== 1) return false;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 var role = getAttr(el, 'role');
 if (tag !== 'BUTTON' && tag !== 'SPAN' && role !== 'button') return false;
 if (getChildElementCount(el) > 2) return false;
 var txt = String(el.textContent || '').trim();
 return txt === 'Task Log' || txt === '任务日志' || txt === 'Görev günlüğü';
 }
 function isUserContentBoundarySelf(el, preTokens, preTid) {
 if (!el || el.nodeType !== 1) return false;
 var tid = preTid !== undefined ? preTid : getAttr(el, 'data-testid');
 if (tid && hasOwn.call(USER_CONTENT_BOUNDARY.testids, tid)) return true;
 for (var i = 0; i < USER_CONTENT_BOUNDARY.attrs.length; i++) {
 var a = USER_CONTENT_BOUNDARY.attrs[i];
 if (hasAttr(el, a)) {
 if (a === 'data-uri' && isAllowedStaticUriLabel(el)) continue;
 return true;
 }
 }
 var tokens = preTokens || getClassTokens(el);
 for (var t = 0; t < tokens.length; t++) {
 if (USER_CONTENT_CLASS_MAP[tokens[t]]) return true;
 }
 return false;
 }
 function isUserContentBoundary(el) {
 return hasMatchingAncestor(el, isUserContentBoundarySelf);
 }
 function isConversationStreamSelf(el) {
 if (!el || el.nodeType !== 1) return false;
 var tid = getAttr(el, 'data-testid');
 if (tid === 'conversation-view' || tid === 'agent-input-box' || tid === 'agent-response') return true;
 return hasAttr(el, 'data-cascade-id');
 }
 function isStepContainerSelf(el) {
 return Boolean(el && el.nodeType === 1 && (hasAttr(el, 'data-step-rows') || hasAttr(el, 'data-step-index')));
 }
 function isStepControlSelf(el) {
 if (!el || el.nodeType !== 1) return false;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 if (tag === 'BUTTON') return true;
 var role = getAttr(el, 'role');
 if (role === 'button' || role === 'menu' || role === 'menuitem' || role === 'tooltip' || role === 'toolbar' || role === 'tab' || role === 'tablist') return true;
 var tid = getAttr(el, 'data-testid');
 return Boolean(tid && hasOwn.call(INTERACTIVE_CHAT_TESTIDS, tid));
 }
 function isInteractiveChatChromeSelf(el, skipDirectCheck) {
 if (!el || el.nodeType !== 1) return false;
 if (!skipDirectCheck && isDirectIgnoredSelf(el)) return false;
 return isStepControlSelf(el) || isStepContainerSelf(el);
 }
 function isStepArgElementSelf(el) {
 if (!el || el.nodeType !== 1) return false;
 if (isStepContainerSelf(el) || isAllowedStaticUriLabel(el)) return false;
 var tid = getAttr(el, 'data-testid');
 if (tid && hasOwn.call(INTERACTIVE_CHAT_TESTIDS, tid)) return false;
 for (var ai = 0; ai < STEP_ARG_ATTRS.length; ai++) { if (hasAttr(el, STEP_ARG_ATTRS[ai])) return true; }
 var tokens = getClassTokens(el);
 for (var ti = 0; ti < tokens.length; ti++) { if (STEP_ARG_CLASS_MAP[tokens[ti]]) return true; }
 var ttl = getAttr(el, 'title');
 if (ttl && ttl.length <= 260 && looksLikeStepPathOrCmd(ttl.trim())) return true;
 var pSib = prevElemSib(el);
 for (var hops = 0; pSib && hops < 3; hops++, pSib = prevElemSib(pSib)) {
 if (isStepContainerSelf(pSib)) break;
 var pt = pSib.tagName ? String(pSib.tagName).toUpperCase() : '';
 if (pt === 'SVG' || pt === 'I') continue;
 if (getChildElementCount(pSib) <= 2) {
 var pv = String(pSib.textContent || '').trim();
 if (pv && STEP_VERB_SET[pv]) {
 var selfTxt = String(el.textContent || '').trim();
 return !(selfTxt && STEP_SAFE_SUFFIX_RE.test(selfTxt));
 }
 }
 break;
 }
 return false;
 }
 function isBlockTagName(tag) {
 return tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'P';
 }
 function hasNoFollowingBlockSib(node, stopAt) {
 for (var cur = node, d = 0; cur && cur !== stopAt && d < 4; cur = cur.parentElement, d++) {
 for (var nxt = nextElemSib(cur); nxt; nxt = nextElemSib(nxt)) {
 if (isBlockTagName(nxt.tagName ? String(nxt.tagName).toUpperCase() : '')) return false;
 }
 }
 return true;
 }
 function findShallowThinkingTrigger(node) {
 if (!node || node.nodeType !== 1) return null;
 if (getAttr(node, 'data-testid') === 'thinking-collapsible-trigger') return node;
 if (hasAttr(node, 'data-step-index') || hasAttr(node, 'data-step-rows') || hasAttr(node, 'data-step-list') || isConversationStreamSelf(node)) return null;
 for (var ch = firstElemChild(node), n = 0; ch && n < 4; ch = nextElemSib(ch), n++) {
 if (getAttr(ch, 'data-testid') === 'thinking-collapsible-trigger') return ch;
 for (var gc = firstElemChild(ch), gn = 0; gc && gn < 3; gc = nextElemSib(gc), gn++) {
 if (getAttr(gc, 'data-testid') === 'thinking-collapsible-trigger') return gc;
 }
 }
 return null;
 }
 function isThinkingTriggerHeader(node) {
 var tr = findShallowThinkingTrigger(node);
 return Boolean(tr && (tr === node || hasNoFollowingBlockSib(tr, node)));
 }
 function isThinkingPanelSelf(el, tag, tid) {
 if (hasAttr(el, 'data-op-thought') || hasAttr(el, 'data-op-zh-ready')) return true;
 if (hasAttr(el, 'data-step-index') || hasAttr(el, 'data-step-rows')) return false;
 if (tid) {
 if (hasOwn.call(INTERACTIVE_CHAT_TESTIDS, tid) || tid === 'changed-files-card' || tid === 'turn-cards-container') return false;
 var tl = String(tid).toLowerCase();
 if (tl.indexOf('thinking') !== -1 && (tl.indexOf('panel') !== -1 || tl.indexOf('body') !== -1 || tl.indexOf('content') !== -1 || tl.indexOf('text') !== -1 || tl.indexOf('collapsible') !== -1)) return true;
 }
 if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'ARTICLE') return false;
 if (findShallowThinkingTrigger(el)) return false;
 var prev = prevElemSib(el);
 for (var hops = 0; prev && hops < 2; hops++, prev = prevElemSib(prev)) {
 if (isThinkingTriggerHeader(prev)) return true;
 if (hasAttr(prev, 'data-step-index') || hasAttr(prev, 'data-step-rows')) break;
 if (isBlockTagName(prev.tagName ? String(prev.tagName).toUpperCase() : '')) break;
 }
 var elId = el.id || getAttr(el, 'id');
 if (elId && el.parentElement) {
 for (var sib = firstElemChild(el.parentElement), sc = 0; sib && sc < 8; sib = nextElemSib(sib), sc++) {
 if (sib === el) continue;
 var st = findShallowThinkingTrigger(sib);
 if (st && getAttr(st, 'aria-controls') === elId) return true;
 }
 }
 return false;
 }
 function isExternalPluginOwnedSelf(el) {
 if (!el || el.nodeType !== 1) return false;
 var id = el.id || getAttr(el, 'id') || '';
 if (id && hasOwn.call(EXTERNAL_OWNED_IDS, id)) return true;
 for (var i = 0; i < EXTERNAL_OWNED_ATTRS.length; i++) {
 if (hasAttr(el, EXTERNAL_OWNED_ATTRS[i])) return true;
 }
 return false;
 }
 function isExternalOwnedElement(el) {
 return hasMatchingAncestor(el, isExternalPluginOwnedSelf);
 }
 function isCodeDiffContainerSelf(el, tokens, tid) {
 if (hasAttr(el, 'data-ag-cs-inline-diff')) return true;
 if (tid) { var tl = String(tid).toLowerCase(); if (tl.indexOf('diff') !== -1 || tl.indexOf('code-viewer') !== -1 || tl.indexOf('file-viewer') !== -1 || tl.indexOf('terminal') !== -1 || tl.indexOf('command-output') !== -1) return true; }
 for (var i = 0; i < tokens.length; i++) {
 var tok = tokens[i];
 if (IGNORED_CLASS_MAP[tok]) return true;
 var cl = tok.toLowerCase();
 for (var d = 0; d < DIFF_CLASS_SUBSTRS.length; d++) { if (cl.indexOf(DIFF_CLASS_SUBSTRS[d]) !== -1) return true; }
 }
 return false;
 }
 function isFocusGuardSelf(el) {
 return Boolean(el && el.nodeType === 1 && (hasAttr(el, 'data-floating-ui-focus-guard') || hasAttr(el, 'data-base-ui-focus-guard')));
 }
 function isDirectIgnoredSelf(el) {
 if (!el || el.nodeType !== 1) return false;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 if (IGNORED_TAGS[tag]) return true;
 if (el.isContentEditable === true || getAttr(el, 'contenteditable') === 'true') return true;
 if (isFocusGuardSelf(el)) return true;
 var tokens = getClassTokens(el);
 var tid = getAttr(el, 'data-testid');
 if (isThinkingPanelSelf(el, tag, tid)) return true;
 if (isPrismOwnedSelf(el, tokens)) return true;
 if (isExternalPluginOwnedSelf(el)) return true;
 if (isModelSelectorSelf(el, tid)) return true;
 if (isChatProseSelf(el, tokens, tid)) return true;
 if (isUserContentBoundarySelf(el, tokens, tid)) return true;
 return isCodeDiffContainerSelf(el, tokens, tid);
 }
 function measureSafeBoundaryDepth(el) {
 if (!el) return { blocked: false, canDescendConv: false, state: 0, remDepth: MAX_SAFE_BOUNDARY_DEPTH, inStep: false, inStepControl: false };
 var startEl = el.nodeType === 3 ? el.parentElement || el.parentNode : el;
 if (!startEl || startEl.nodeType !== 1) {
 return { blocked: false, canDescendConv: false, state: 0, remDepth: MAX_SAFE_BOUNDARY_DEPTH, inStep: false, inStepControl: false };
 }
 var cur = startEl, sawInteractiveChrome = false, sawConvStream = false, blockedByConvStream = false, inStep = false, inStepControl = false, stepChecked = false, depth = 0;
 while (cur && depth < MAX_SAFE_BOUNDARY_DEPTH) {
 if (cur.nodeType === 1) {
 if (isDirectIgnoredSelf(cur)) return { blocked: true, canDescendConv: false, state: -1, remDepth: -1, inStep: inStep, inStepControl: inStepControl };
 var isCtl = isStepControlSelf(cur);
 var isStp = isStepContainerSelf(cur);
 if (isCtl) { sawInteractiveChrome = true; if (!inStep) inStepControl = true; }
 if (isStp) {
 sawInteractiveChrome = true;
 inStep = true;
 if (!stepChecked) {
 stepChecked = true;
 for (var sn = startEl; sn && sn !== cur; sn = sn.parentElement || sn.parentNode) {
 if (sn.nodeType === 1 && isStepArgElementSelf(sn)) return { blocked: true, canDescendConv: false, state: -1, remDepth: -1, inStep: true, inStepControl: inStepControl };
 }
 }
 }
 if (isConversationStreamSelf(cur)) {
 sawConvStream = true;
 if (!sawInteractiveChrome) blockedByConvStream = true;
 }
 }
 cur = cur.parentElement || cur.parentNode;
 depth++;
 }
 if (cur) return { blocked: true, canDescendConv: false, state: -1, remDepth: -1, inStep: inStep, inStepControl: inStepControl };
 var remDepth = MAX_SAFE_BOUNDARY_DEPTH - depth;
 if (blockedByConvStream) return { blocked: true, canDescendConv: true, state: 1, remDepth: remDepth, inStep: false, inStepControl: false };
 return { blocked: false, canDescendConv: false, state: sawConvStream ? 2 : 0, remDepth: remDepth, inStep: inStep, inStepControl: inStepControl };
 }
 function advanceBoundaryForChild(parentCtx, childEl) {
 var nextRem = parentCtx.remDepth - 1;
 if (nextRem < 0 || parentCtx.state === -1) return null;
 if (isDirectIgnoredSelf(childEl)) return null;
 if (parentCtx.inStep && isStepArgElementSelf(childEl)) return null;
 var pState = parentCtx.state;
 var isCtl = isStepControlSelf(childEl);
 var isStp = isStepContainerSelf(childEl);
 var isInter = isCtl || isStp;
 var isConv = isConversationStreamSelf(childEl);
 var nextState = pState;
 if (pState === 0) { if (isConv) nextState = isInter ? 2 : 1; }
 else if (pState === 1) { nextState = isInter ? 2 : 1; }
 else if (pState === 2) { if (isConv && !isInter) nextState = 1; }
 var nextInStep = parentCtx.inStep || isStp;
 var nextInStepCtl = nextInStep ? (parentCtx.inStepControl || isCtl) : false;
 return { blocked: nextState === 1, canDescendConv: nextState === 1, state: nextState, remDepth: nextRem, inStep: nextInStep, inStepControl: nextInStepCtl };
 }
 function isIgnoredBoundary(el) {
 return measureSafeBoundaryDepth(el).blocked;
 }
 function isInsideConversationStream(el) {
 return hasMatchingAncestor(el, function (cur) {
 return isConversationStreamSelf(cur) || isChatProseSelf(cur);
 });
 }
 function isChromeControlElement(el) {
 if (!el || el.nodeType !== 1) return false;
 var tid = getAttr(el, 'data-testid');
 if (tid === 'sidebar-split' || tid === 'aux-pane-split') return false;
 if (isUserContentBoundarySelf(el)) return false;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 if (tag === 'NAV' || tag === 'ASIDE' || tag === 'HEADER' || tag === 'BUTTON') return true;
 var role = getAttr(el, 'role');
 if (role === 'tablist' || role === 'toolbar' || role === 'menubar' || role === 'menu' || role === 'tab' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
 return true;
 }
 if (tid === 'permissions-selector-trigger') return true;
 return false;
 }
 function isLeafChromeControl(el) {
 if (!el || el.nodeType !== 1) return false;
 var tid = getAttr(el, 'data-testid');
 if (tid === 'sidebar-split' || tid === 'aux-pane-split') return false;
 if (isUserContentBoundarySelf(el)) return false;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 if (tag === 'BUTTON') return true;
 var role = getAttr(el, 'role');
 if (role === 'tab' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio') return true;
 if (tid === 'permissions-selector-trigger' || tid === 'new-conversation-button' || tid === 'settings-button') return true;
 return false;
 }
 function isExplicitDelayedChromeControl(el) {
 if (!el || el.nodeType !== 1) return false;
 var tid = getAttr(el, 'data-testid');
 if (tid === 'sidebar-split' || tid === 'aux-pane-split') return false;
 if (isUserContentBoundarySelf(el)) return false;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 if (tag === 'BUTTON' || tag === 'NAV' || tag === 'HEADER') return true;
 var role = getAttr(el, 'role');
 if (role === 'button' || role === 'menu' || role === 'menubar' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio' || role === 'tab' || role === 'tablist' || role === 'toolbar') {
 return true;
 }
 if (tid === 'permissions-selector-trigger' || tid === 'new-conversation-button' || tid === 'settings-button') return true;
 return false;
 }
 function isInsideExplicitDelayedChrome(el) {
 var cur = el && el.nodeType === 3 ? el.parentElement || el.parentNode : el;
 var depth = 0;
 while (cur && depth < 128) {
 if (cur.nodeType === 1) {
 if (isDirectIgnoredSelf(cur) || isConversationStreamSelf(cur)) return false;
 if (isExplicitDelayedChromeControl(cur)) return true;
 }
 cur = cur.parentElement || cur.parentNode;
 depth++;
 }
 return false;
 }
 function safeReadLocalStorage(rootObj, key) {
 try {
 var ls = (rootObj && rootObj.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
 if (ls && typeof ls.getItem === 'function') {
 return ls.getItem(key);
 }
 } catch (e) {}
 return null;
 }
 function hasElementClassToken(el, token) {
 if (!el) return false;
 if (el.classList && typeof el.classList.contains === 'function') {
 try {
 if (el.classList.contains(token)) return true;
 } catch (e) {}
 }
 var tokens = getClassTokens(el);
 for (var i = 0; i < tokens.length; i++) {
 if (tokens[i] === token) return true;
 }
 return false;
 }
 function detectLayer1External(rootObj, doc) {
 if (rootObj) {
 for (var g = 0; g < EXTERNAL_GLOBAL_SIGNATURE_GROUPS.length; g++) {
 var grp = EXTERNAL_GLOBAL_SIGNATURE_GROUPS[g];
 for (var i = 0; i < grp.keys.length; i++) {
 var key = grp.keys[i];
 try {
 if (rootObj[key]) {
 return { hit: true, provider: grp.provider, detail: 'global:' + key };
 }
 } catch (e) {}
 }
 }
 }
 var hansLang = safeReadLocalStorage(rootObj, 'antigravityHansLang');
 if (hansLang !== null) {
 var normHans = String(hansLang).trim().toLowerCase();
 if (normHans && normHans !== 'en' && normHans !== 'en-us' && normHans !== 'off' && normHans !== 'false' && normHans !== '0') {
 return { hit: true, provider: 'yuexps/Antigravity-Hans', detail: 'storage:antigravityHansLang' };
 }
 }
 var lucasDict = safeReadLocalStorage(rootObj, 'antigravity_chinese_patch_dict');
 if (lucasDict !== null && String(lucasDict).trim() !== '') {
 return { hit: true, provider: 'LucasvonLiu', detail: 'storage:antigravity_chinese_patch_dict' };
 }
 if (doc) {
 var docEl = doc.documentElement;
 var body = doc.body;
 if (docEl && (hasElementClassToken(docEl, 'agy-theme-active') || hasElementClassToken(docEl, 'agy-theme-active-v2'))) {
 return { hit: true, provider: '3169657175', detail: 'class:agy-theme-active' };
 }
 if (typeof doc.querySelector === 'function') {
 try {
 if (doc.querySelector('[data-agy-hans-ui]')) {
 return { hit: true, provider: 'yuexps/Antigravity-Hans', detail: 'dom:[data-agy-hans-ui]' };
 }
 } catch (e) {}
 try {
 if (doc.querySelector('#agy-theme-switcher, #antigravity-quota-widget')) {
 return { hit: true, provider: '3169657175', detail: 'dom:#agy-theme-switcher|#antigravity-quota-widget' };
 }
 } catch (e) {}
 try {
 if (doc.querySelector('[data-model-selector-badge="true"]')) {
 return { hit: true, provider: 'Ace2025001', detail: 'dom:[data-model-selector-badge="true"]' };
 }
 } catch (e) {}
 try {
 if (doc.querySelector('script[src*="ag_agent_hanhua.js"]')) {
 return { hit: true, provider: 'cshitian', detail: 'script:ag_agent_hanhua.js' };
 }
 } catch (e) {}
 }
 if (typeof doc.querySelectorAll === 'function') {
 try {
 var scripts = doc.querySelectorAll('script');
 if (scripts && scripts.length > 0) {
 for (var sIdx = 0; sIdx < scripts.length; sIdx++) {
 var sSrc = String(getAttr(scripts[sIdx], 'src') || scripts[sIdx].src || '');
 if (sSrc.indexOf('ag_agent_hanhua.js') !== -1) {
 return { hit: true, provider: 'cshitian', detail: 'script:ag_agent_hanhua.js' };
 }
 }
 }
 } catch (e) {}
 }
 for (var j = 0; j < KNOWN_EXTERNAL_ATTRS.length; j++) {
 var attr = KNOWN_EXTERNAL_ATTRS[j];
 if ((docEl && hasAttr(docEl, attr)) || (body && hasAttr(body, attr))) {
 return { hit: true, provider: 'generic-external', detail: 'attr:' + attr };
 }
 }
 if (docEl && !hasAttr(docEl, 'data-ag-prism-lang-owned')) {
 var htmlLang = String(getAttr(docEl, 'lang') || docEl.lang || '').trim();
 if (/^zh(?:$|[-_])/i.test(htmlLang)) {
 return { hit: true, provider: 'html-lang-zh', detail: 'html-lang:' + htmlLang };
 }
 }
 }
 return { hit: false, provider: null, detail: null };
 }
 function collectTextSkippingIgnored(el, outChunks, textSnapshots) {
 if (!el) return;
 if (el.nodeType === 3) {
 if (textSnapshots && textSnapshots.has(el)) {
 var snap = textSnapshots.get(el);
 if (snap && snap.expected === el.nodeValue) return;
 }
 var val = el.nodeValue || '';
 if (val) outChunks.push(val);
 return;
 }
 if (el.nodeType !== 1) return;
 if (isDirectIgnoredSelf(el) || isConversationStreamSelf(el)) return;
 var child = el.firstChild;
 while (child) {
 collectTextSkippingIgnored(child, outChunks, textSnapshots);
 child = child.nextSibling;
 }
 }
 function detectLayer2ChromeZh(doc, options) {
 if (!doc) return { hit: false, sampled: 0, zhCount: 0, anchorHits: 0 };
 var rootEl = doc.body || doc.documentElement;
 if (!rootEl) return { hit: false, sampled: 0, zhCount: 0, anchorHits: 0 };
 var opts = options || {};
 var textSnapshots = opts.textSnapshots || null;
 var samples = [];
 var seenTexts = Object.create(null);
 var zhCount = 0;
 var anchorHits = 0;
 var visited = 0;
 var MAX_VISIT = 2200;
 var MAX_SAMPLES = 48;
 function recordSample(text) {
 var trimmed = String(text || '').replace(/\s+/g, ' ').trim();
 if (!trimmed || trimmed.length > 60) return;
 if (!ZH_CHAR_RE.test(trimmed) && !EN_ALPHA_RE.test(trimmed)) return;
 if (hasOwn.call(seenTexts, trimmed)) return;
 seenTexts[trimmed] = 1;
 samples.push(trimmed);
 if (ZH_CHAR_RE.test(trimmed)) {
 zhCount++;
 if (hasOwn.call(CHROME_ZH_ANCHORS, trimmed)) {
 anchorHits++;
 }
 }
 }
 function walk(node, insideChrome) {
 if (!node || samples.length >= MAX_SAMPLES || visited >= MAX_VISIT) return;
 visited++;
 if (node.nodeType === 3) {
 if (insideChrome) {
 if (textSnapshots && textSnapshots.has(node)) {
 var snap = textSnapshots.get(node);
 if (snap && snap.expected === node.nodeValue) return;
 }
 recordSample(node.nodeValue);
 }
 return;
 }
 if (node.nodeType !== 1) return;
 if (isDirectIgnoredSelf(node) || isConversationStreamSelf(node)) return;
 if (isLeafChromeControl(node)) {
 var chunks = [];
 collectTextSkippingIgnored(node, chunks, textSnapshots);
 if (chunks.length > 0) {
 recordSample(chunks.join(' '));
 }
 return;
 }
 var nowInChrome = insideChrome || isChromeControlElement(node);
 var child = node.firstChild;
 while (child && samples.length < MAX_SAMPLES && visited < MAX_VISIT) {
 walk(child, nowInChrome);
 child = child.nextSibling;
 }
 }
 walk(rootEl, false);
 var ratio = samples.length > 0 ? zhCount / samples.length : 0;
 var hit = (zhCount >= 3 && ratio >= 0.25) || anchorHits >= 2;
 return {
 hit: hit,
 sampled: samples.length,
 zhCount: zhCount,
 anchorHits: anchorHits,
 ratio: ratio,
 };
 }
 function detectExternalLocalization(rootObj, doc, options) {
 if (options && options.locale === 'tr') return { detected: false, layer: 0, reason: null, provider: null, detail: null };
 var l1 = detectLayer1External(rootObj, doc);
 if (l1.hit) return { detected: true, layer: 1, reason: 'external-ui-zh', provider: l1.provider || 'generic-external', detail: l1.detail };
 var l2 = detectLayer2ChromeZh(doc, options);
 if (l2.hit) return { detected: true, layer: 2, reason: 'external-ui-zh', provider: 'generic-zh-dom', detail: l2 };
 return { detected: false, layer: 0, reason: null, provider: null, detail: l2 };
 }
/**
 * Bounded 2-generation LRU cache backed exclusively by Object.create(null).
 * 100% immune to external monkey-patching of Map.prototype.has/get/set (e.g. renkeshui)
 * and Object.prototype keys (__proto__, constructor, toString).
 */
 function createNullProtoBoundedCache(maxSize) {
 var cap = maxSize > 4 ? maxSize : 2048;
 var genCap = cap >> 1;
 var hot = Object.create(null);
 var cold = Object.create(null);
 var hotSize = 0;
 var coldSize = 0;
 return {
 has: function (key) {
 return key in hot || key in cold;
 },
 get: function (key) {
 if (key in hot) return hot[key];
 if (key in cold) {
 var val = cold[key];
 delete cold[key];
 coldSize--;
 if (hotSize >= genCap) {
 cold = hot;
 coldSize = hotSize;
 hot = Object.create(null);
 hotSize = 0;
 }
 hot[key] = val;
 hotSize++;
 return val;
 }
 return undefined;
 },
 set: function (key, val) {
 if (key in hot) {
 hot[key] = val;
 return;
 }
 if (key in cold) {
 delete cold[key];
 coldSize--;
 }
 if ((hotSize >= genCap && hotSize + coldSize >= cap) || hotSize >= cap) {
 cold = hot;
 coldSize = hotSize;
 hot = Object.create(null);
 hotSize = 0;
 }
 hot[key] = val;
 hotSize++;
 },
 delete: function (key) {
 var removed = false;
 if (key in hot) {
 delete hot[key];
 hotSize--;
 removed = true;
 }
 if (key in cold) {
 delete cold[key];
 coldSize--;
 removed = true;
 }
 return removed;
 },
 clear: function () {
 hot = Object.create(null);
 cold = Object.create(null);
 hotSize = 0;
 coldSize = 0;
 },
 get size() {
 return hotSize + coldSize;
 },
 };
 }
 function readRegexQuantifier(src, pos) {
 if (pos >= src.length) return { kind: 'one', end: pos };
 var q = src.charAt(pos);
 if (q === '?' || q === '*') {
 return { kind: 'zero', end: pos + (src.charAt(pos + 1) === '?' ? 2 : 1) };
 }
 if (q === '+') {
 return { kind: 'plus', end: pos + (src.charAt(pos + 1) === '?' ? 2 : 1) };
 }
 if (q === '{') {
 var closeIdx = pos + 1;
 while (closeIdx < src.length && src.charAt(closeIdx) !== '}') closeIdx++;
 if (closeIdx < src.length) {
 var afterBrace = closeIdx + 1;
 if (src.charAt(afterBrace) === '?') afterBrace++;
 return { kind: 'brace', end: afterBrace };
 }
 return { kind: 'brace', end: pos + 1 };
 }
 return { kind: 'one', end: pos };
 }
 function extractPatternIndexMeta(src, flags) {
 if (flags && (flags.indexOf('i') !== -1 || flags.indexOf('m') !== -1)) {
 return { anchor1: '', anchor2: '', bucketType: 'general', startChars: null };
 }
 var depth = 0;
 var inClass = false;
 var hasTopAlt = false;
 for (var k = 0; k < src.length; k++) {
 var ch = src.charAt(k);
 if (ch === '\\') {
 k++;
 continue;
 }
 if (inClass) {
 if (ch === ']') inClass = false;
 continue;
 }
 if (ch === '[') {
 inClass = true;
 continue;
 }
 if (ch === '(') depth++;
 else if (ch === ')') {
 if (depth > 0) depth--;
 } else if (ch === '|' && depth === 0) {
 hasTopAlt = true;
 break;
 }
 }
 if (hasTopAlt) {
 return { anchor1: '', anchor2: '', bucketType: 'general', startChars: null };
 }
 var runs = [];
 var cur = '';
 function flushRun() {
 if (cur.length > 0) {
 if (cur.length >= 2 || !/^\s+$/.test(cur)) {
 runs.push(cur);
 }
 cur = '';
 }
 }
 var i = 0;
 while (i < src.length) {
 var c = src.charAt(i);
 if (c === '\\') {
 if (i + 1 >= src.length) {
 flushRun();
 break;
 }
 var nx = src.charAt(i + 1);
 if (nx === 'u') {
 flushRun();
 if (src.charAt(i + 2) === '{') {
 var uEnd = i + 3;
 while (uEnd < src.length && src.charAt(uEnd) !== '}') uEnd++;
 i = readRegexQuantifier(src, uEnd < src.length ? uEnd + 1 : uEnd).end;
 } else {
 i = readRegexQuantifier(src, Math.min(src.length, i + 6)).end;
 }
 continue;
 }
 if (nx === 'x') {
 flushRun();
 i = readRegexQuantifier(src, Math.min(src.length, i + 4)).end;
 continue;
 }
 if (nx === 'c') {
 flushRun();
 i = readRegexQuantifier(src, Math.min(src.length, i + 3)).end;
 continue;
 }
 if ((nx === 'p' || nx === 'P') && src.charAt(i + 2) === '{') {
 flushRun();
 var pEnd = i + 3;
 while (pEnd < src.length && src.charAt(pEnd) !== '}') pEnd++;
 i = readRegexQuantifier(src, pEnd < src.length ? pEnd + 1 : pEnd).end;
 continue;
 }
 if (nx === 'k' && src.charAt(i + 2) === '<') {
 flushRun();
 var kEnd = i + 3;
 while (kEnd < src.length && src.charAt(kEnd) !== '>') kEnd++;
 i = readRegexQuantifier(src, kEnd < src.length ? kEnd + 1 : kEnd).end;
 continue;
 }
 if (/[a-zA-Z0-9]/.test(nx)) {
 flushRun();
 var escEnd = i + 2;
 if (/[0-9]/.test(nx)) {
 while (escEnd < src.length && /[0-9]/.test(src.charAt(escEnd))) escEnd++;
 }
 i = readRegexQuantifier(src, escEnd).end;
 continue;
 }
 var qEsc = readRegexQuantifier(src, i + 2);
 if (qEsc.kind === 'one') {
 cur += nx;
 } else if (qEsc.kind === 'plus') {
 cur += nx;
 flushRun();
 } else {
 flushRun();
 }
 i = qEsc.end;
 continue;
 }
 if (c === '[') {
 flushRun();
 i++;
 while (i < src.length) {
 if (src.charAt(i) === '\\') {
 i += 2;
 continue;
 }
 if (src.charAt(i) === ']') {
 i++;
 break;
 }
 i++;
 }
 i = readRegexQuantifier(src, i).end;
 continue;
 }
 if (c === '(') {
 flushRun();
 i++;
 var gDepth = 1;
 var gClass = false;
 while (i < src.length && gDepth > 0) {
 var gc = src.charAt(i);
 if (gc === '\\') {
 i += 2;
 continue;
 }
 if (gClass) {
 if (gc === ']') gClass = false;
 i++;
 continue;
 }
 if (gc === '[') {
 gClass = true;
 i++;
 continue;
 }
 if (gc === '(') gDepth++;
 else if (gc === ')') gDepth--;
 i++;
 }
 i = readRegexQuantifier(src, i).end;
 continue;
 }
 if (c === '^' || c === '$' || c === '.' || c === '?' || c === '*' || c === '+' || c === ')' || c === ']') {
 flushRun();
 i++;
 continue;
 }
 if (c === '{') {
 flushRun();
 i = readRegexQuantifier(src, i).end;
 continue;
 }
 var qLit = readRegexQuantifier(src, i + 1);
 if (qLit.kind === 'one') {
 cur += c;
 } else if (qLit.kind === 'plus') {
 cur += c;
 flushRun();
 } else {
 flushRun();
 }
 i = qLit.end;
 }
 flushRun();
 var multiCharRuns = [];
 var singleCharRuns = [];
 for (var rIdx = 0; rIdx < runs.length; rIdx++) {
 var r = runs[rIdx];
 if (r.length >= 2 && !/^\s+$/.test(r)) multiCharRuns.push(r);
 else if (r.length === 1 && !/\s/.test(r)) singleCharRuns.push(r);
 }
 multiCharRuns.sort(function (a, b) {
 return b.length - a.length;
 });
 var anchor1 = '';
 var anchor2 = '';
 if (multiCharRuns.length > 0) {
 anchor1 = multiCharRuns[0];
 for (var mIdx = 1; mIdx < multiCharRuns.length; mIdx++) {
 if (anchor1.indexOf(multiCharRuns[mIdx]) === -1) {
 anchor2 = multiCharRuns[mIdx];
 break;
 }
 }
 } else if (singleCharRuns.length > 0) {
 anchor1 = singleCharRuns[0];
 }
 var bucketType = 'general';
 var startChars = null;
 if (src.charAt(0) === '^') {
 var mLit = /^\^([^\\^$.*+?()[\]{}|])(?![?*{])/.exec(src);
 var mEsc = !mLit ? /^\^\\([^a-zA-Z0-9])(?![?*{])/.exec(src) : null;
 if (mLit) {
 bucketType = 'chars';
 startChars = [mLit[1]];
 } else if (mEsc) {
 bucketType = 'chars';
 startChars = [mEsc[1]];
 } else if (/^\^(?:\\d(?![?*]|\\{0)|\(\\d(?:\+|\{[1-9]\d*(?:,\d*)?\})[^()\\|]*\)(?![?*{]))/.test(src)) {
 bucketType = 'digit';
 } else {
 var mPair = /^\^\[([A-Za-z])([A-Za-z])\](?![?*{])/.exec(src);
 if (mPair) {
 bucketType = 'chars';
 startChars = mPair[1] === mPair[2] ? [mPair[1]] : [mPair[1], mPair[2]];
 } else {
 var mAltGroup = /^\^\((?:\?:)?([^()[\]{}^$.*+?]+)\)(?![?*{])/.exec(src);
 if (mAltGroup && mAltGroup[1].indexOf('\\|') === -1) {
 var alts = mAltGroup[1].split('|');
 var charMap = Object.create(null);
 var charList = [];
 var allValid = alts.length > 0;
 for (var aIdx = 0; aIdx < alts.length; aIdx++) {
 var alt = alts[aIdx];
 if (!alt || !/^[A-Za-z0-9\u4e00-\u9fa5]/.test(alt)) {
 allValid = false;
 break;
 }
 var fc = alt.charAt(0);
 if (!charMap[fc]) {
 charMap[fc] = 1;
 charList.push(fc);
 }
 }
 if (allValid && charList.length > 0) {
 bucketType = 'chars';
 startChars = charList;
 }
 }
 }
 }
 }
 return {
 anchor1: anchor1,
 anchor2: anchor2,
 bucketType: bucketType,
 startChars: startChars,
 };
 }
 function mergeSortedPatternLists(listA, listB, listC) {
 var combined = [];
 if (listA && listA.length) combined = combined.concat(listA);
 if (listB && listB.length) combined = combined.concat(listB);
 if (listC && listC.length) combined = combined.concat(listC);
 if (combined.length <= 1) return combined;
 combined.sort(function (a, b) {
 return a.order - b.order;
 });
 var dedup = [combined[0]];
 for (var i = 1; i < combined.length; i++) {
 if (combined[i].order !== combined[i - 1].order) {
 dedup.push(combined[i]);
 }
 }
 return dedup;
 }
 var cachedDefaultReverseModule = null;
 function resolveDefaultReverseModule(winObj) {
 if (winObj && winObj.__agPrismHostI18nReversePatterns) {
 return winObj.__agPrismHostI18nReversePatterns;
 }
 if (root && root.__agPrismHostI18nReversePatterns) {
 return root.__agPrismHostI18nReversePatterns;
 }
 if (cachedDefaultReverseModule) return cachedDefaultReverseModule;
 if (typeof require === 'function') {
 try {
 cachedDefaultReverseModule = require('./reverse-patterns.js');
 return cachedDefaultReverseModule;
 } catch (e) {}
 }
 return null;
 }
 function rankReverseCaseStyle(s) {
 if (/^[A-Z][a-z]/.test(s) && s !== s.toUpperCase()) return 0;
 if (s !== s.toLowerCase() && s !== s.toUpperCase()) return 1;
 if (s === s.toLowerCase()) return 2;
 return 3;
 }
 function scoreReverseEnCandidate(s) {
 var score = s.length * 10 + rankReverseCaseStyle(s);
 if (/\s+[.,!?;:]$/.test(s)) score += 500;
 return score;
 }
 function mapZhTrailingPuncToEn(punc) {
 var out = '';
 for (var i = 0; i < punc.length; i++) {
 var ch = punc.charAt(i);
 if (ch === '：') out += ':';
 else if (ch === '。') out += '.';
 else if (ch === '？') out += '?';
 else if (ch === '！') out += '!';
 else if (ch === '…') out += '...';
 else out += ch;
 }
 return out;
 }
 function splitOuterWhitespace(str) {
 var len = str.length;
 var start = 0;
 while (start < len && /\s/.test(str.charAt(start))) start++;
 var end = len;
 while (end > start && /\s/.test(str.charAt(end - 1))) end--;
 return {
 leading: str.slice(0, start),
 core: str.slice(start, end),
 trailing: str.slice(end),
 };
 }
 function createHostI18nEngine(dictData, engineOptions) {
 var engOpts = engineOptions || {};
 var direction = engOpts.direction === 'reverse' ? 'reverse' : 'forward';
 var data = dictData || {};
 var exactDict = data.exact || {};
 var revModule = null;
 var revExactOverrides = null;
 var rawPatterns = null;
 var crossNodeRules = [];
 if (direction === 'reverse') {
 var customRev = engOpts.reversePatterns;
 var fallbackRev = resolveDefaultReverseModule(engOpts.root || null);
 if (Array.isArray(customRev)) {
 rawPatterns = customRev.slice();
 revExactOverrides =
 engOpts.reverseExactOverrides || (fallbackRev && fallbackRev.REVERSE_EXACT_OVERRIDES) || null;
 crossNodeRules =
 engOpts.reverseCrossNodeRules || (fallbackRev && fallbackRev.REVERSE_CROSS_NODE_RULES) || [];
 } else {
 revModule = customRev && typeof customRev === 'object' ? customRev : fallbackRev;
 rawPatterns =
 (revModule && (revModule.REVERSE_PATTERNS || revModule.patterns))
 ? (revModule.REVERSE_PATTERNS || revModule.patterns).slice()
 : [];
 revExactOverrides =
 engOpts.reverseExactOverrides ||
 (revModule && (revModule.REVERSE_EXACT_OVERRIDES || revModule.exactOverrides)) ||
 null;
 crossNodeRules =
 engOpts.reverseCrossNodeRules ||
 (revModule && (revModule.REVERSE_CROSS_NODE_RULES || revModule.crossNodeRules)) ||
 [];
 }
 } else {
 rawPatterns = (data.patterns || []).concat(data.rules || []);
 }
 var patterns = [];
 var charBuckets = Object.create(null);
 var digitBucket = [];
 var generalBucket = [];
 var mergedByFirstChar = Object.create(null);
 for (var i = 0; i < rawPatterns.length; i++) {
 var p = rawPatterns[i];
 if (!p || typeof p.regex !== 'string' || typeof p.replacement !== 'string') continue;
 try {
 var compiledRe = new RegExp(p.regex);
 var meta = extractPatternIndexMeta(p.regex, compiledRe.flags || '');
 var entry = {
 regex: compiledRe,
 replacement: p.replacement,
 order: patterns.length,
 anchor1: meta.anchor1,
 anchor2: meta.anchor2,
 };
 patterns.push(entry);
 if (meta.bucketType === 'chars' && meta.startChars) {
 for (var sc = 0; sc < meta.startChars.length; sc++) {
 var chKey = meta.startChars[sc];
 if (!charBuckets[chKey]) charBuckets[chKey] = [];
 charBuckets[chKey].push(entry);
 }
 } else if (meta.bucketType === 'digit') {
 digitBucket.push(entry);
 } else {
 generalBucket.push(entry);
 }
 } catch (e) {}
 }
 function getCandidatesForText(text) {
 if (!text) return generalBucket;
 var ch0 = text.charAt(0);
 var cachedList = mergedByFirstChar[ch0];
 if (cachedList !== undefined) return cachedList;
 var cBucket = charBuckets[ch0] || null;
 var dBucket = ch0 >= '0' && ch0 <= '9' ? digitBucket : null;
 var merged = !cBucket && !dBucket ? generalBucket : mergeSortedPatternLists(cBucket, dBucket, generalBucket);
 mergedByFirstChar[ch0] = merged;
 return merged;
 }
 function matchesPatternAnchors(text, pat) {
 if (pat.anchor1 && text.indexOf(pat.anchor1) === -1) return false;
 if (pat.anchor2 && text.indexOf(pat.anchor2) === -1) return false;
 return true;
 }
 function normalizeWhitespace(str) {
 return str.replace(/\s+/g, ' ').trim();
 }
 var exactLookup = Object.create(null);
 var translatedValues = Object.create(null);
 var reverseScores = direction === 'reverse' ? Object.create(null) : null;
 if (direction === 'reverse') {
 for (var enKey in exactDict) {
 if (!hasOwn.call(exactDict, enKey)) continue;
 var zhVal = exactDict[enKey];
 if (typeof enKey !== 'string' || typeof zhVal !== 'string') continue;
 var normZh = normalizeWhitespace(zhVal);
 var normEn = normalizeWhitespace(enKey);
 if (!normZh || !normEn || !ZH_CHAR_RE.test(normZh)) continue;
 var candScore = scoreReverseEnCandidate(normEn);
 if (!(normZh in exactLookup) || candScore < reverseScores[normZh]) {
 exactLookup[normZh] = normEn;
 reverseScores[normZh] = candScore;
 }
 }
 reverseScores = null;
 if (revExactOverrides && typeof revExactOverrides === 'object') {
 for (var ovZh in revExactOverrides) {
 if (typeof ovZh === 'string' && typeof revExactOverrides[ovZh] === 'string') {
 var cleanZh = normalizeWhitespace(ovZh);
 if (cleanZh) {
 exactLookup[cleanZh] = revExactOverrides[ovZh];
 }
 }
 }
 }
 } else {
 for (var k in exactDict) {
 if (hasOwn.call(exactDict, k)) {
 exactLookup[k] = exactDict[k];
 translatedValues[exactDict[k]] = true;
 }
 }
 }
 // Release strong references to external input dictionary objects (~0.6 MiB/window saved)
 dictData = null;
 engineOptions = null;
 engOpts = null;
 data = null;
 exactDict = null;
 rawPatterns = null;
 revModule = null;
 revExactOverrides = null;
 var MAX_UNIT_CACHE_SIZE = 2048;
 var unitCache = createNullProtoBoundedCache(MAX_UNIT_CACHE_SIZE);
 function cacheAndReturn(key, value) {
 unitCache.set(key, value);
 return value;
 }
 function applyPatterns(text) {
 if (!text || patterns.length === 0) return null;
 var cands = getCandidatesForText(text);
 for (var ci = 0; ci < cands.length; ci++) {
 var pat = cands[ci];
 if (!matchesPatternAnchors(text, pat)) continue;
 pat.regex.lastIndex = 0;
 if (pat.regex.test(text)) {
 pat.regex.lastIndex = 0;
 var result = text.replace(pat.regex, pat.replacement);
 if (!result) return result;
 var cands2 = getCandidatesForText(result);
 var c2Idx = 0;
 while (c2Idx < cands2.length) {
 var pat2 = cands2[c2Idx];
 if (!matchesPatternAnchors(result, pat2)) {
 c2Idx++;
 continue;
 }
 pat2.regex.lastIndex = 0;
 if (pat2.regex.test(result)) {
 pat2.regex.lastIndex = 0;
 var prevCh0 = result.charAt(0);
 var matchedOrder = pat2.order;
 result = result.replace(pat2.regex, pat2.replacement);
 if (!result) break;
 if (result.charAt(0) !== prevCh0) {
 cands2 = getCandidatesForText(result);
 c2Idx = 0;
 while (c2Idx < cands2.length && cands2[c2Idx].order <= matchedOrder) {
 c2Idx++;
 }
 continue;
 }
 }
 c2Idx++;
 }
 return result;
 }
 }
 return null;
 }
 if (direction === 'reverse') {
 function lookupReverseExactOrVariant(norm) {
 if (norm in exactLookup) return exactLookup[norm];
 var tailCh = norm.charAt(norm.length - 1);
 if (':：….。？?!！'.indexOf(tailCh) !== -1) {
 var puncMatch = norm.match(/^(.+?)([:：…\.。？\?!！]+)$/);
 if (puncMatch) {
 var base = puncMatch[1].trim();
 var punc = puncMatch[2];
 if (base in exactLookup) {
 var baseEn = exactLookup[base];
 var mappedPunc = mapZhTrailingPuncToEn(punc);
 var baseEnd = baseEn.charAt(baseEn.length - 1);
 if (mappedPunc === '.' && (baseEnd === '.' || baseEnd === '!' || baseEnd === '?')) {
 return baseEn;
 }
 return baseEn + mappedPunc;
 }
 if (punc === '…' && base + '...' in exactLookup) {
 return exactLookup[base + '...'];
 }
 if (punc === '...' && base + '…' in exactLookup) {
 return exactLookup[base + '…'];
 }
 }
 }
 if (norm.indexOf('+') !== -1) {
 var hkMatch = norm.match(
 /(\((?:Ctrl|Cmd|Alt|Shift)\+[^\s\)]+\)|\b(?:Ctrl|Cmd|Alt|Shift)\+[\w;:,\\/+\-]+)$/i
 );
 if (hkMatch && hkMatch.index > 0) {
 var cmdBase = norm.slice(0, hkMatch.index).trim();
 var hk = hkMatch[1].trim();
 if (cmdBase && cmdBase in exactLookup) {
 return exactLookup[cmdBase] + ' ' + hk;
 }
 }
 }
 return null;
 }
 function translateReverseUnit(rawUnit) {
 if (!rawUnit || typeof rawUnit !== 'string' || rawUnit.length > 512) return null;
 if (!ZH_CHAR_RE.test(rawUnit)) return null;
 var normalized = normalizeWhitespace(rawUnit);
 if (!normalized || !ZH_CHAR_RE.test(normalized)) return null;
 if (unitCache.has(normalized)) {
 return unitCache.get(normalized);
 }
 var exactHit = lookupReverseExactOrVariant(normalized);
 if (exactHit !== null && exactHit !== normalized) {
 return cacheAndReturn(normalized, exactHit);
 }
 var patHit = applyPatterns(normalized);
 if (patHit !== null && patHit !== normalized) {
 return cacheAndReturn(normalized, patHit);
 }
 if (
 normalized.indexOf('。') !== -1 ||
 normalized.indexOf('！') !== -1 ||
 normalized.indexOf('？') !== -1
 ) {
 var zhParts = normalized.split(/([。！？]\s*)/);
 if (zhParts.length >= 3) {
 var anyRev = false;
 var allRev = true;
 var outSegs = [];
 for (var zIdx = 0; zIdx < zhParts.length; zIdx++) {
 var seg = zhParts[zIdx];
 var trimSeg = seg.trim();
 if (!trimSeg) continue;
 if (/^[。！？\s]+$/.test(seg)) {
 outSegs.push(mapZhTrailingPuncToEn(trimSeg) + ' ');
 continue;
 }
 var segRes = lookupReverseExactOrVariant(trimSeg) || applyPatterns(trimSeg);
 if (segRes && segRes !== trimSeg) {
 anyRev = true;
 outSegs.push(segRes.replace(/[.!?]+$/, ''));
 } else {
 allRev = false;
 break;
 }
 }
 if (anyRev && allRev) {
 return cacheAndReturn(normalized, outSegs.join('').trim());
 }
 }
 }
 return cacheAndReturn(normalized, null);
 }
 function translateReverseText(rawStr) {
 if (!rawStr || typeof rawStr !== 'string' || rawStr.length > 512) return null;
 if (!ZH_CHAR_RE.test(rawStr)) return null;
 var parts = splitOuterWhitespace(rawStr);
 if (!parts.core) return null;
 var coreRes = translateReverseUnit(parts.core);
 if (coreRes === null || coreRes === parts.core) return null;
 return parts.leading + coreRes + parts.trailing;
 }
 return {
 direction: 'reverse',
 translate: translateReverseText,
 translateText: translateReverseText,
 translateUnit: translateReverseUnit,
 exactDict: exactLookup,
 reverseExact: exactLookup,
 patterns: patterns,
 crossNodeRules: crossNodeRules,
 patternIndex: {
 charBuckets: charBuckets,
 digitBucket: digitBucket,
 generalBucket: generalBucket,
 getCandidatesForText: getCandidatesForText,
 },
 translatedValues: translatedValues,
 cache: unitCache,
 unitCache: unitCache,
 maxCacheSize: MAX_UNIT_CACHE_SIZE,
 normalizeWhitespace: normalizeWhitespace,
 };
 }
 function translateSingleUnit(rawStr) {
 if (!rawStr || typeof rawStr !== 'string' || rawStr.length > 512) return null;
 var normalized = normalizeWhitespace(rawStr);
 if (!normalized) return null;
 if (unitCache.has(normalized)) {
 return unitCache.get(normalized);
 }
 if (normalized in exactLookup) {
 return cacheAndReturn(normalized, exactLookup[normalized]);
 }
 if (!EN_ALPHA_RE.test(normalized)) {
 return cacheAndReturn(normalized, null);
 }
 if (translatedValues[normalized]) {
 return cacheAndReturn(normalized, null);
 }
 if (ZH_CHAR_RE.test(normalized) && !/[a-zA-Z]{2,}/.test(normalized)) {
 return cacheAndReturn(normalized, null);
 }
 var patRes = applyPatterns(normalized);
 if (patRes !== null) {
 return cacheAndReturn(normalized, patRes);
 }
 var lastCh = normalized.charAt(normalized.length - 1);
 if (':：….？?!！'.indexOf(lastCh) !== -1) {
 var punctuationMatch = normalized.match(/^([\w\s\-\/]+)([:：…\.？\?!！]+)$/);
 if (punctuationMatch) {
 var base = punctuationMatch[1].trim();
 var punc = punctuationMatch[2];
 if (base in exactLookup) {
 return cacheAndReturn(normalized, exactLookup[base] + (punc === ':' ? '：' : punc));
 }
 }
 }
 if (normalized.indexOf('+') !== -1) {
 var hotkeyMatch = normalized.match(
 /(\((?:Ctrl|Cmd|Alt|Shift)\+[^\s\)]+\)|\b(?:Ctrl|Cmd|Alt|Shift)\+[\w;:,\\/+\-]+)$/i
 );
 if (hotkeyMatch && hotkeyMatch.index > 0) {
 var cmdBase = normalized.slice(0, hotkeyMatch.index).trim();
 var hotkey = hotkeyMatch[1].trim();
 if (cmdBase && /^[\w\s\-\/]+$/.test(cmdBase) && cmdBase in exactLookup) {
 return cacheAndReturn(normalized, exactLookup[cmdBase] + ' ' + hotkey);
 }
 }
 }
 if (
 normalized.indexOf('. ') !== -1 ||
 normalized.indexOf('! ') !== -1 ||
 normalized.indexOf('? ') !== -1 ||
 normalized.indexOf('。') !== -1
 ) {
 var sentences = normalized.split(/([.!?]\s+|[。！？]\s*)/);
 var anyTranslated = false;
 var allTranslated = true;
 var translatedParts = [];
 for (var sIdx = 0; sIdx < sentences.length; sIdx++) {
 var part = sentences[sIdx];
 var trimmedPart = part.trim();
 if (!trimmedPart || /^[.!?。！？\s]+$/.test(part)) {
 translatedParts.push(part.replace(/\.\s*/g, '。 '));
 continue;
 }
 var transPart =
 (trimmedPart in exactLookup ? exactLookup[trimmedPart] : null) ||
 (trimmedPart + '.' in exactLookup ? exactLookup[trimmedPart + '.'] : null);
 if (!transPart) {
 transPart = applyPatterns(trimmedPart);
 }
 if (!transPart) {
 var pLast = trimmedPart.charAt(trimmedPart.length - 1);
 if (':：….？?!！'.indexOf(pLast) !== -1) {
 var pMatch = trimmedPart.match(/^([\w\s\-\/]+)([:：…\.？\?!！]+)$/);
 if (pMatch && pMatch[1].trim() in exactLookup) {
 transPart = exactLookup[pMatch[1].trim()] + (pMatch[2] === ':' ? '：' : pMatch[2]);
 }
 }
 }
 if (transPart) {
 anyTranslated = true;
 translatedParts.push(transPart);
 } else {
 allTranslated = false;
 break;
 }
 }
 if (anyTranslated && allTranslated) {
 return cacheAndReturn(
 normalized,
 translatedParts.join('').replace(/([。！？])[。！？.]*\s*/g, '$1 ').trim()
 );
 }
 }
 return cacheAndReturn(normalized, null);
 }
 function translateForwardText(rawStr) {
 if (!rawStr || typeof rawStr !== 'string' || rawStr.length > 512) return null;
 var parts = splitOuterWhitespace(rawStr);
 if (!parts.core) return null;
 var coreRes = translateSingleUnit(parts.core);
 if (coreRes === null || coreRes === parts.core) return null;
 return parts.leading + coreRes + parts.trailing;
 }
 return {
 direction: 'forward',
 translate: translateSingleUnit,
 translateText: translateForwardText,
 translateUnit: translateSingleUnit,
 exactDict: exactLookup,
 patterns: patterns,
 crossNodeRules: crossNodeRules,
 patternIndex: {
 charBuckets: charBuckets,
 digitBucket: digitBucket,
 generalBucket: generalBucket,
 getCandidatesForText: getCandidatesForText,
 },
 translatedValues: translatedValues,
 cache: unitCache,
 unitCache: unitCache,
 maxCacheSize: MAX_UNIT_CACHE_SIZE,
 normalizeWhitespace: normalizeWhitespace,
 };
 }
 function isPortalAttr(el) {
 return hasAttr(el, 'data-floating-ui-portal') || hasAttr(el, 'data-base-ui-portal');
 }
 function isDialogOrPortalWrappingDialog(el) {
 if (!el || el.nodeType !== 1) return false;
 var role = getAttr(el, 'role');
 if (role === 'dialog') return true;
 if (isPortalAttr(el) && typeof el.querySelector === 'function') {
 if (el.querySelector('[role="dialog"]')) return true;
 }
 return false;
 }
 function isFloatingElement(el, doc) {
 if (!el || el.nodeType !== 1) return false;
 if (doc && (el === doc.body || el === doc.documentElement)) return false;
 if (el.id === 'workbench' || el.id === 'root' || el.id === 'app') return false;
 var cls = typeof el.className === 'string' ? el.className : '';
 if (cls && cls.indexOf('monaco-workbench') !== -1) return false;
 var role = getAttr(el, 'role') || '';
 if (role === 'dialog') return false;
 if (role === 'tooltip' || role === 'menu' || role === 'listbox') return true;
 if (isPortalAttr(el)) {
 return !isDialogOrPortalWrappingDialog(el);
 }
 if (hasAttr(el, 'data-radix-popper-content-wrapper')) return true;
 if (cls) {
 if (
 cls.indexOf('popover') !== -1 ||
 cls.indexOf('tooltip') !== -1 ||
 cls.indexOf('context-view') !== -1 ||
 cls.indexOf('monaco-hover') !== -1
 ) {
 return true;
 }
 }
 return false;
 }
 function isWorkbenchOrRoot(el, doc) {
 if (!el || el.nodeType !== 1) return true;
 if (doc && (el === doc.body || el === doc.documentElement)) return true;
 if (el.id === 'workbench' || el.id === 'root' || el.id === 'app') return true;
 var tid = getAttr(el, 'data-testid');
 if (tid === 'sidebar-split' || tid === 'aux-pane-split') return true;
 var cls = typeof el.className === 'string' ? el.className : '';
 if (cls && cls.indexOf('monaco-workbench') !== -1) return true;
 return false;
 }
 function createWeakNodeTracker() {
 var hasWeakRef = typeof WeakRef === 'function';
 if (!hasWeakRef) {
 var fallbackSet = new Set();
 return {
 add: function (node) {
 if (!node) return;
 fallbackSet.add(node);
 if (fallbackSet.size > 256) this.prune();
 },
 delete: function (node) {
 fallbackSet.delete(node);
 },
 prune: function () {
 fallbackSet.forEach(function (n) {
 if (!n || n.isConnected === false) fallbackSet.delete(n);
 });
 },
 forEachAll: function (cb) {
 fallbackSet.forEach(function (n) {
 if (n) cb(n);
 });
 },
 countActive: function () {
 var count = 0;
 fallbackSet.forEach(function (n) {
 if (!n || n.isConnected === false) {
 fallbackSet.delete(n);
 return;
 }
 count++;
 });
 return count;
 },
 clear: function () {
 fallbackSet.clear();
 },
 };
 }
 var refs = new Set();
 var nodeToRef = new WeakMap();
 return {
 add: function (node) {
 if (!node || nodeToRef.has(node)) return;
 var ref = new WeakRef(node);
 nodeToRef.set(node, ref);
 refs.add(ref);
 if (refs.size > 256) this.prune();
 },
 delete: function (node) {
 if (!node) return;
 var ref = nodeToRef.get(node);
 if (ref) {
 refs.delete(ref);
 nodeToRef.delete(node);
 }
 },
 prune: function () {
 refs.forEach(function (ref) {
 var n = ref.deref();
 if (!n || n.isConnected === false) {
 refs.delete(ref);
 if (n) nodeToRef.delete(n);
 }
 });
 },
 forEachAll: function (cb) {
 refs.forEach(function (ref) {
 var n = ref.deref();
 if (!n) {
 refs.delete(ref);
 return;
 }
 cb(n);
 });
 },
 countActive: function () {
 var count = 0;
 refs.forEach(function (ref) {
 var n = ref.deref();
 if (!n || n.isConnected === false) {
 refs.delete(ref);
 if (n) nodeToRef.delete(n);
 return;
 }
 count++;
 });
 return count;
 },
 clear: function () {
 refs.clear();
 nodeToRef = new WeakMap();
 },
 };
 }
 function isInsideDialog(el) {
 return hasMatchingAncestor(el, function (cur) {
 return getAttr(cur, 'role') === 'dialog';
 }, 48);
 }
 function isSmallHoverControlSelf(el) {
 if (!el || el.nodeType !== 1) return false;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
 var role = getAttr(el, 'role');
 if (
 role === 'button' ||
 role === 'menuitem' ||
 role === 'menuitemcheckbox' ||
 role === 'menuitemradio' ||
 role === 'option' ||
 role === 'tab' ||
 role === 'switch' ||
 role === 'checkbox' ||
 role === 'combobox' ||
 role === 'tooltip'
 ) {
 return true;
 }
 if (
 getChildElementCount(el) <= 4 &&
 (hasAttr(el, 'title') || hasAttr(el, 'aria-label') || hasAttr(el, 'data-tooltip'))
 ) {
 return true;
 }
 return false;
 }
 function isSmallHoverControl(el) {
 if (!el || el.nodeType !== 1) return false;
 if (isSmallHoverControlSelf(el)) return true;
 var p = el.parentElement;
 if (p && p.nodeType === 1 && getAttr(p, 'role') !== 'dialog' && isSmallHoverControlSelf(p)) {
 return true;
 }
 return false;
 }
 function mountHostI18n(options) {
 var opts = options || {};
 var win = opts.root || (typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
 var doc = opts.doc || (win && win.document) || (typeof document !== 'undefined' ? document : null);
 try {
 if (win && win.__agPrismHostI18n && typeof win.__agPrismHostI18n.destroy === 'function') {
 win.__agPrismHostI18n.destroy();
 }
 } catch (e) {}
 var mode = opts.mode === 'on' || opts.mode === 'off' ? opts.mode : 'auto';
 var locale = opts.locale === 'tr' ? 'tr' : 'zh-CN';
 var initialHtmlLang = doc && doc.documentElement ? getAttr(doc.documentElement, 'lang') : null;
 var nowFn = typeof opts.nowFn === 'function' ? opts.nowFn : function () { return Date.now(); };
 var perfNowFn =
 typeof opts.perfNowFn === 'function'
 ? opts.perfNowFn
 : typeof opts.nowFn === 'function'
 ? nowFn
 : typeof performance !== 'undefined' && typeof performance.now === 'function'
 ? function () {
 return performance.now();
 }
 : nowFn;
 var setTimeoutFn =
 typeof opts.setTimeoutFn === 'function'
 ? opts.setTimeoutFn
 : function (fn, ms) {
 return setTimeout(fn, ms);
 };
 var clearTimeoutFn =
 typeof opts.clearTimeoutFn === 'function'
 ? opts.clearTimeoutFn
 : function (id) {
 clearTimeout(id);
 };
 var hasCustomRaf = typeof opts.rafFn === 'function';
 var hasRafSupport =
 hasCustomRaf || Boolean(win && typeof win.requestAnimationFrame === 'function');
 var rafFn =
 typeof opts.rafFn === 'function'
 ? opts.rafFn
 : win && typeof win.requestAnimationFrame === 'function'
 ? function (cb) {
 return win.requestAnimationFrame(cb);
 }
 : function (cb) {
 return setTimeoutFn(cb, 16);
 };
 var cancelRafFn =
 typeof opts.cancelRafFn === 'function'
 ? opts.cancelRafFn
 : win && typeof win.cancelAnimationFrame === 'function'
 ? function (id) {
 win.cancelAnimationFrame(id);
 }
 : function (id) {
 clearTimeoutFn(id);
 };
 var customMutationObserver = opts.MutationObserver || null;
 var inputDict = opts.dict || { exact: {}, patterns: [] };
 var customReversePatterns = opts.reversePatterns || null;
 var customReverseOverrides = opts.reverseExactOverrides || null;
 var customReverseCrossRules = opts.reverseCrossNodeRules || null;
 var seedExact = Object.create(null);
 if (inputDict.exact && typeof inputDict.exact === 'object') {
 for (var sk in inputDict.exact) {
 if (hasOwn.call(inputDict.exact, sk)) {
 seedExact[sk] = inputDict.exact[sk];
 }
 }
 }
 var internalDictSeed = {
 exact: seedExact,
 patterns: Array.isArray(inputDict.patterns) ? inputDict.patterns.slice() : [],
 rules: Array.isArray(inputDict.rules) ? inputDict.rules.slice() : [],
 };
 // Sever closure retention of options / options.dict immediately
 inputDict = null;
 options = null;
 opts = null;
 var forwardEngine = null;
 var reverseEngine = null;
 var activeEngine = null;
 var translateSingleUnit = null;
 var translatedValues = Object.create(null);
 var activeCrossNodeRules = [];
 function selectEngineForMode(targetMode) {
 if (targetMode === 'off') {
 if (!reverseEngine) {
 reverseEngine = createHostI18nEngine(internalDictSeed, {
 direction: 'reverse',
 reversePatterns: customReversePatterns,
 reverseExactOverrides: customReverseOverrides,
 reverseCrossNodeRules: customReverseCrossRules,
 root: win,
 });
 }
 activeEngine = reverseEngine;
 translateSingleUnit = reverseEngine.translateUnit;
 translatedValues = Object.create(null);
 activeCrossNodeRules = reverseEngine.crossNodeRules || [];
 } else {
 if (!forwardEngine) {
 forwardEngine = createHostI18nEngine(internalDictSeed, {
 direction: 'forward',
 root: win,
 });
 }
 activeEngine = forwardEngine;
 translateSingleUnit = forwardEngine.translateUnit || forwardEngine.translate;
 translatedValues = forwardEngine.translatedValues || Object.create(null);
 activeCrossNodeRules = [];
 }
 }
 var state = {
 active: false,
 mode: mode,
 status: 'off',
 reason: null,
 detectedProvider: null,
 yielded: false,
 destroyed: false,
 };
 var TIER2_SKIP_ATTRS = [
 ['data-ag-localization-skip', 'true'],
 ['data-antigravity-zh-skip', '1'],
 ];
 var textSnapshots = new WeakMap();
 var textUntranslatedCache = new WeakMap();
 var attrSnapshots = new WeakMap();
 var attrUntranslatedCache = new WeakMap();
 var elementConflictState = new WeakMap();
 var exemptElements = new WeakSet();
 var exemptNodes = new WeakSet();
 var processedAlerts = new WeakSet();
 var tier2SkipSnapshots = new WeakMap();
 var offPendingRetryElements = new WeakMap();
 var modifiedTextNodes = createWeakNodeTracker();
 var modifiedAttrElements = createWeakNodeTracker();
 var tier2MarkedElements = createWeakNodeTracker();
 var blockedElementsTracker = createWeakNodeTracker();
 var tier1State = null;
 var offRetryTimers = new Set();
 var inOffRetryPass = false;
 var observer = null;
 var observing = false;
 var dirtyObserver = null;
 var dirtyProbeActive = false;
 var winBlurObserver = null;
 var pendingFullFloatScan = false;
 var pendingSidebarRescan = false;
 var pendingConvViewRescan = false;
 var pendingNodes = [];
 var pendingNodeSet = new Set();
 var rafId = null;
 var hoverScanTimer = null;
 var hoverCardTimer = null;
 var pendingHoverCardNode = null;
 var focusWakeTimer = null;
 var layer2bTimers = [];
 var domReadyHandler = null, hoverHandler = null, visibilityHandler = null, blurHandler = null, focusHandler = null, cvRevealHandler = null;
 var observedCvEls = new WeakSet(), cvUnsubs = [];
 var bootAt = nowFn();
 var delayedExternalNodes = new Set();
 var globalConflictRecords = [];
 var lastHoverTime = 0;
 var pausedByWindowBlur = false;
 var hibernating = false;
 var missedWhilePaused = false;
 var initialScanDraining = false;
 var MAX_NODES_PER_FRAME = 80;
 var FRAME_BUDGET_MS = 5;
 var INITIAL_SYNC_MAX_NODES = 160;
 var INITIAL_SYNC_BUDGET_MS = 5;
 var MAX_PENDING_NODES = 4096;
 var LAYER2B_WINDOW_MS = 1200;
 var CONFLICT_WINDOW_MS = 3000;
 var NODE_CONFLICT_THRESHOLD = 3;
 var GLOBAL_CONFLICT_NODE_THRESHOLD = 5;
 var OFF_RETRY_DELAY_MS = 16;
 function isDocHidden() {
 return Boolean(doc && doc.hidden === true);
 }
 function isWinBlurAttrSet() {
 return Boolean(doc && doc.documentElement && getAttr(doc.documentElement, 'data-ag-cs-win-blur') === '1');
 }
 // 元素周期表 3D 键盘打开期间进入休眠，避免高频扫键触发宿主 i18n 扫描与 hover 拦截
 function isPeriodicPickerOpen() {
 return Boolean(doc && doc.documentElement && getAttr(doc.documentElement, 'data-ag-pp-open') === '1');
 }
 function isPerformancePerfMode() {
 if (!doc || !doc.documentElement) return false;
 var ds = doc.documentElement.dataset;
 var raw = String((ds && ds.agCsPerfMode) || getAttr(doc.documentElement, 'data-ag-cs-perf-mode') || '').trim().toLowerCase();
 return raw === 'performance' || raw === 'eco';
 }
 function canDrainVisibleBlur() {
 return !isDocHidden() && !isPeriodicPickerOpen() && !isPerformancePerfMode();
 }
 function canContinuePendingFlush() {
 return initialScanDraining && canDrainVisibleBlur();
 }
 function isPaused() {
 return isDocHidden() || pausedByWindowBlur || isWinBlurAttrSet() || isPeriodicPickerOpen();
 }
 function setRootStatusAttr(val) {
 try {
 if (doc && doc.documentElement && typeof doc.documentElement.setAttribute === 'function') {
 doc.documentElement.setAttribute('data-ag-prism-host-i18n', val);
 }
 } catch (e) {}
 }
 function removeRootStatusAttr() {
 try {
 if (doc && doc.documentElement && typeof doc.documentElement.removeAttribute === 'function') {
 doc.documentElement.removeAttribute('data-ag-prism-host-i18n');
 }
 } catch (e) {}
 }
 function activateTier1Suppression() {
 tier1State = {
 hansSwitched: false,
 hansPrevLang: null,
 patchObserverPaused: false,
 patchObserverRef: null,
 patchObserverTarget: null,
 patchObserverOpts: null,
 agyCachePaused: false,
 agyCacheRef: null,
 agyOrigHasDesc: null,
 agyOrigGetDesc: null,
 htmlLangModified: false,
 htmlLangOrig: null,
 };
 if (win && typeof win.__antigravityZhSetLang === 'function') {
 var storedHans = safeReadLocalStorage(win, 'antigravityHansLang');
 var normStored = storedHans !== null ? String(storedHans).trim().toLowerCase() : '';
 if (
 storedHans === null ||
 (normStored !== 'en' &&
 normStored !== 'en-us' &&
 normStored !== 'off' &&
 normStored !== 'false' &&
 normStored !== '0')
 ) {
 tier1State.hansPrevLang = storedHans && String(storedHans).trim() ? String(storedHans).trim() : 'zh-CN';
 try {
 win.__antigravityZhSetLang('en');
 tier1State.hansSwitched = true;
 } catch (e) {}
 }
 } else if (
 win &&
 win.__antigravityZhPatchObserver &&
 typeof win.__antigravityZhPatchObserver.disconnect === 'function' &&
 typeof win.__antigravityZhPatchObserver.observe === 'function' &&
 doc &&
 (doc.body || doc.documentElement)
 ) {
 try {
 var extObs = win.__antigravityZhPatchObserver;
 tier1State.patchObserverRef = extObs;
 tier1State.patchObserverTarget = extObs._target || extObs.target || doc.documentElement;
 tier1State.patchObserverOpts = extObs.options || { childList: true, subtree: true, characterData: true };
 extObs.disconnect();
 tier1State.patchObserverPaused = true;
 } catch (e) {}
 }
 // 兼容 Main World 注入版 yiheng8023/antigravity-chinese：仅对单实例 __AGY_CACHE__ 做可逆自有属性静音，绝不碰 Map.prototype
 if (
 win &&
 win.__AGY_CACHE__ &&
 typeof win.__AGY_CACHE__.has === 'function' &&
 typeof win.__AGY_CACHE__.get === 'function' &&
 (win.__AGY_I18N_INITIALIZED__ || win.__AGY_I18N_DATA__)
 ) {
 try {
 var agyCache = win.__AGY_CACHE__;
 tier1State.agyCacheRef = agyCache;
 tier1State.agyOrigHasDesc = Object.getOwnPropertyDescriptor(agyCache, 'has') || null;
 tier1State.agyOrigGetDesc = Object.getOwnPropertyDescriptor(agyCache, 'get') || null;
 Object.defineProperty(agyCache, 'has', {
 value: function () {
 return true;
 },
 configurable: true,
 writable: true,
 });
 Object.defineProperty(agyCache, 'get', {
 value: function () {
 return null;
 },
 configurable: true,
 writable: true,
 });
 tier1State.agyCachePaused = true;
 } catch (e) {}
 }
 if (doc && doc.documentElement && !hasAttr(doc.documentElement, 'data-ag-prism-lang-owned')) {
 var curHtmlLang = getAttr(doc.documentElement, 'lang');
 if (curHtmlLang && /^zh(?:$|[-_])/i.test(String(curHtmlLang).trim())) {
 tier1State.htmlLangOrig = curHtmlLang;
 try {
 doc.documentElement.setAttribute('lang', 'en');
 tier1State.htmlLangModified = true;
 } catch (e) {}
 }
 }
 }
 function restoreTier1Suppression() {
 if (!tier1State) return;
 var saved = tier1State;
 tier1State = null;
 if (saved.htmlLangModified && doc && doc.documentElement && typeof doc.documentElement.setAttribute === 'function') {
 try {
 if (getAttr(doc.documentElement, 'lang') === 'en') {
 doc.documentElement.setAttribute('lang', saved.htmlLangOrig);
 }
 } catch (e) {}
 }
 if (saved.agyCachePaused && saved.agyCacheRef) {
 try {
 if (saved.agyOrigHasDesc) {
 Object.defineProperty(saved.agyCacheRef, 'has', saved.agyOrigHasDesc);
 } else {
 delete saved.agyCacheRef.has;
 }
 if (saved.agyOrigGetDesc) {
 Object.defineProperty(saved.agyCacheRef, 'get', saved.agyOrigGetDesc);
 } else {
 delete saved.agyCacheRef.get;
 }
 if (win && typeof win.__AGY_RUN_FULL_SCAN__ === 'function') {
 win.__AGY_RUN_FULL_SCAN__();
 }
 } catch (e) {}
 }
 if (saved.patchObserverPaused && saved.patchObserverRef && saved.patchObserverTarget) {
 try {
 saved.patchObserverRef.observe(saved.patchObserverTarget, saved.patchObserverOpts);
 } catch (e) {}
 }
 if (saved.hansSwitched && win && typeof win.__antigravityZhSetLang === 'function') {
 try {
 win.__antigravityZhSetLang(saved.hansPrevLang || 'zh-CN');
 } catch (e) {}
 }
 }
 function markTier2SkipElement(el) {
 if (state.mode !== 'off' || !el || el.nodeType !== 1 || typeof el.setAttribute !== 'function') return;
 if (doc && el === doc.documentElement) return;
 var tag = el.tagName ? String(el.tagName).toUpperCase() : '';
 if (IGNORED_TAGS[tag] || tag === 'HEAD' || tag === 'META' || tag === 'LINK') return;
 var snap = tier2SkipSnapshots.get(el);
 if (!snap) {
 snap = Object.create(null);
 for (var i = 0; i < TIER2_SKIP_ATTRS.length; i++) {
 var attrName = TIER2_SKIP_ATTRS[i][0];
 snap[attrName] = hasAttr(el, attrName) ? getAttr(el, attrName) : null;
 }
 tier2SkipSnapshots.set(el, snap);
 }
 for (var j = 0; j < TIER2_SKIP_ATTRS.length; j++) {
 var name = TIER2_SKIP_ATTRS[j][0];
 var targetVal = TIER2_SKIP_ATTRS[j][1];
 if (getAttr(el, name) !== targetVal) {
 try {
 el.setAttribute(name, targetVal);
 } catch (e) {}
 }
 }
 tier2MarkedElements.add(el);
 }
 function rollbackTier2Element(el) {
 var snap = tier2SkipSnapshots.get(el);
 if (!snap) return;
 for (var i = 0; i < TIER2_SKIP_ATTRS.length; i++) {
 var name = TIER2_SKIP_ATTRS[i][0];
 var writtenVal = TIER2_SKIP_ATTRS[i][1];
 var prevVal = snap[name];
 try {
 if (getAttr(el, name) === writtenVal) {
 if (prevVal === null) {
 if (typeof el.removeAttribute === 'function') el.removeAttribute(name);
 } else if (typeof el.setAttribute === 'function') {
 el.setAttribute(name, prevVal);
 }
 }
 } catch (e) {}
 }
 tier2SkipSnapshots.delete(el);
 }
 function countTranslatedUnits() {
 var textCount = modifiedTextNodes.countActive();
 var attrCount = 0;
 modifiedAttrElements.prune();
 modifiedAttrElements.forEachAll(function (el) {
 if (el.isConnected === false) return;
 var mapRec = attrSnapshots.get(el);
 if (mapRec) attrCount += mapRec.count;
 });
 return textCount + attrCount;
 }
 var busDomUnsub = null;
 function getHostDomBus() {
 return (!customMutationObserver && win && (win.__agDomBus || win.__agPrismDomBus)) || null;
 }
 function disconnectObserver(hard) {
 if (observer && (observing || hard)) {
 try {
 observer.disconnect(hard);
 } catch (e) {}
 observing = false;
 }
 }
 function reconnectObserver() {
 if (state.destroyed || !state.active) return;
 if (observer && !observing && doc && doc.documentElement) {
 try {
 observer.observe(doc.documentElement, {
 childList: true,
 subtree: true,
 characterData: true,
 });
 observing = true;
 } catch (e) {}
 }
 }
 function disconnectDirtyObserver() {
 if (dirtyObserver && dirtyProbeActive) {
 try {
 dirtyObserver.disconnect();
 } catch (e) {}
 }
 dirtyProbeActive = false;
 }
 function armDirtyObserver() {
 if (state.destroyed || !state.active || dirtyProbeActive || !doc || !doc.documentElement) return;
 var MOClass =
 customMutationObserver ||
 (win && win.MutationObserver) ||
 (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
 if (!MOClass) {
 missedWhilePaused = true;
 return;
 }
 try {
 if (!dirtyObserver) {
 dirtyObserver = new MOClass(function () {
 missedWhilePaused = true;
 disconnectDirtyObserver();
 });
 }
 dirtyObserver.observe(doc.documentElement, {
 childList: true,
 subtree: true,
 characterData: true,
 });
 dirtyProbeActive = true;
 } catch (e) {
 dirtyProbeActive = false;
 missedWhilePaused = true;
 }
 }
 function clearOffRetryTimers() {
 var hadAny = offRetryTimers.size > 0;
 if (hadAny) {
 offRetryTimers.forEach(function (tid) {
 try {
 clearTimeoutFn(tid);
 } catch (e) {}
 });
 offRetryTimers.clear();
 }
 offPendingRetryElements = new WeakMap();
 return hadAny;
 }
 function clearAllTimersAndListeners() {
 disconnectDirtyObserver();
 dirtyObserver = null;
 pendingFullFloatScan = false;
 pendingSidebarRescan = false;
 pendingConvViewRescan = false;
 clearOffRetryTimers();
 if (rafId === 'bus') {
 try { var _b = getHostDomBus(); if (_b && typeof _b.cancelTask === 'function') _b.cancelTask('conv:host-i18n-flush'); } catch (e) {}
 rafId = null;
 } else if (rafId !== null) {
 try {
 cancelRafFn(rafId);
 } catch (e) {}
 rafId = null;
 }
 if (hoverScanTimer !== null) {
 try {
 clearTimeoutFn(hoverScanTimer);
 } catch (e) {}
 hoverScanTimer = null;
 }
 if (hoverCardTimer !== null) {
 try {
 clearTimeoutFn(hoverCardTimer);
 } catch (e) {}
 hoverCardTimer = null;
 }
 pendingHoverCardNode = null;
 if (focusWakeTimer !== null) {
 try {
 clearTimeoutFn(focusWakeTimer);
 } catch (e) {}
 focusWakeTimer = null;
 }
 while (layer2bTimers.length > 0) {
 var tid = layer2bTimers.pop();
 try {
 clearTimeoutFn(tid);
 } catch (e) {}
 }
 if (winBlurObserver) {
 try {
 winBlurObserver.disconnect();
 } catch (e) {}
 winBlurObserver = null;
 }
 if (doc && typeof doc.removeEventListener === 'function') {
 if (domReadyHandler) doc.removeEventListener('DOMContentLoaded', domReadyHandler);
 if (hoverHandler) {
 doc.removeEventListener('pointerenter', hoverHandler, { capture: true });
 doc.removeEventListener('contextmenu', hoverHandler, { capture: true });
 doc.removeEventListener('click', hoverHandler, { capture: true });
 }
 if (visibilityHandler) doc.removeEventListener('visibilitychange', visibilityHandler);
 if (cvRevealHandler) doc.removeEventListener('contentvisibilityautostatechange', cvRevealHandler, { capture: true });
 }
 while (cvUnsubs.length > 0) { try { cvUnsubs.pop()(); } catch (e) {} }
 observedCvEls = new WeakSet();
 if (win && typeof win.removeEventListener === 'function') {
 if (blurHandler) win.removeEventListener('blur', blurHandler);
 if (focusHandler) win.removeEventListener('focus', focusHandler);
 }
 domReadyHandler = hoverHandler = visibilityHandler = blurHandler = focusHandler = cvRevealHandler = null;
 }
 function rollbackAllSnapshots() {
 disconnectObserver(true);
 var rollbackTextNode = function (node) {
 var snap = textSnapshots.get(node);
 if (snap) {
 try {
 if (node.nodeValue === snap.expected) {
 node.nodeValue = snap.orig;
 }
 } catch (e) {}
 textSnapshots.delete(node);
 }
 };
 var rollbackAttrEl = function (el) {
 var mapRec = attrSnapshots.get(el);
 if (mapRec && mapRec.entries) {
 for (var attr in mapRec.entries) {
 var snap = mapRec.entries[attr];
 try {
 if (snap && el.getAttribute(attr) === snap.expected && typeof el.setAttribute === 'function') {
 el.setAttribute(attr, snap.orig);
 }
 } catch (e) {}
 }
 attrSnapshots.delete(el);
 }
 };
 modifiedTextNodes.forEachAll(rollbackTextNode);
 modifiedTextNodes.clear();
 modifiedAttrElements.forEachAll(rollbackAttrEl);
 modifiedAttrElements.clear();
 tier2MarkedElements.forEachAll(rollbackTier2Element);
 tier2MarkedElements.clear();
 // DOM 兜底扫回：防止节点曾因暂时脱离 DOM 被 prune 剪枝后又被 React 复用回挂导致漏回滚
 var rootEl = doc && (doc.body || doc.documentElement);
 if (rootEl) {
 try {
 if (typeof doc.createTreeWalker === 'function') {
 var tw = doc.createTreeWalker(rootEl, 5);
 var cur = tw.currentNode;
 while (cur) {
 if (cur.nodeType === 3) {
 rollbackTextNode(cur);
 } else if (cur.nodeType === 1) {
 rollbackAttrEl(cur);
 rollbackTier2Element(cur);
 }
 cur = tw.nextNode();
 }
 } else {
 var stack = [rootEl];
 while (stack.length) {
 var nd = stack.pop();
 if (!nd) continue;
 if (nd.nodeType === 3) {
 rollbackTextNode(nd);
 } else if (nd.nodeType === 1) {
 rollbackAttrEl(nd);
 rollbackTier2Element(nd);
 var ch = nd.childNodes;
 if (ch && ch.length) {
 for (var ci = ch.length - 1; ci >= 0; ci--) stack.push(ch[ci]);
 }
 }
 }
 }
 } catch (e) {}
 }
 }
 function resetTransientRuntimeCaches() {
 textUntranslatedCache = new WeakMap();
 attrUntranslatedCache = new WeakMap();
 elementConflictState = new WeakMap();
 hoverBoundaryCache = new WeakMap();
 exemptElements = new WeakSet();
 exemptNodes = new WeakSet();
 processedAlerts = new WeakSet();
 blockedElementsTracker.clear();
 }
 function teardownRuntime(nextStatus, nextReason, yieldedFlag, providerName, removeRootAttrFlag) {
 state.active = false;
 state.destroyed = true;
 state.status = nextStatus;
 state.reason = nextReason;
 state.detectedProvider = yieldedFlag ? providerName || null : null;
 state.yielded = Boolean(yieldedFlag);
 hibernating = false;
 pausedByWindowBlur = false;
 initialScanDraining = false;
 inOffRetryPass = false;
 clearAllTimersAndListeners();
 rollbackAllSnapshots();
 restoreTier1Suppression();
 resetTransientRuntimeCaches();
 pendingNodes.length = 0;
 pendingNodeSet.clear();
 delayedExternalNodes.clear();
 globalConflictRecords.length = 0;
 if (removeRootAttrFlag) {
 removeRootStatusAttr();
 } else {
 setRootStatusAttr(nextStatus);
 }
 }
 function yieldAndRollback(reason, providerName) {
 if (state.yielded || state.status === 'yielded') return;
 var resolvedProvider = providerName || null;
 if (!resolvedProvider && reason === 'external-ui-zh') {
 var l1Now = detectLayer1External(win, doc);
 resolvedProvider = l1Now.hit ? l1Now.provider : 'generic-zh-dom';
 } else if (!resolvedProvider && reason === 'conflict-breaker') {
 var l1Conflict = detectLayer1External(win, doc);
 resolvedProvider = l1Conflict.hit ? l1Conflict.provider : 'conflict-breaker';
 }
 teardownRuntime('yielded', reason, true, resolvedProvider, false);
 }
 function scheduleOffConflictRetry(el) {
 if (!el || el.nodeType !== 1 || !state.active || state.destroyed || state.mode !== 'off') return;
 if (exemptElements.has(el) || offPendingRetryElements.has(el)) return;
 var tid = setTimeoutFn(function () {
 offRetryTimers.delete(tid);
 offPendingRetryElements.delete(el);
 if (!state.active || state.destroyed || state.mode !== 'off') return;
 if (el.isConnected === false || exemptElements.has(el)) return;
 if (isPaused()) {
 missedWhilePaused = true;
 return;
 }
 var visited = new WeakSet();
 disconnectObserver();
 inOffRetryPass = true;
 try {
 translateElement(el, visited, null, null);
 } catch (e) {}
 inOffRetryPass = false;
 reconnectObserver();
 }, OFF_RETRY_DELAY_MS);
 offRetryTimers.add(tid);
 offPendingRetryElements.set(el, tid);
 }
 function cancelOffRetryForElement(el) {
 if (!el) return;
 var pendingTid = offPendingRetryElements.get(el);
 if (pendingTid !== undefined) {
 offPendingRetryElements.delete(el);
 offRetryTimers.delete(pendingTid);
 try {
 clearTimeoutFn(pendingTid);
 } catch (e) {}
 }
 }
 function recordGlobalConflict(el, now) {
 var cutoff = now - CONFLICT_WINDOW_MS;
 var nextList = [];
 var found = false;
 for (var i = 0; i < globalConflictRecords.length; i++) {
 var rec = globalConflictRecords[i];
 if (rec.at >= cutoff) {
 if (rec.node === el) {
 rec.at = now;
 found = true;
 }
 nextList.push(rec);
 }
 }
 if (!found) {
 nextList.push({ node: el, at: now });
 }
 globalConflictRecords = nextList;
 return globalConflictRecords.length;
 }
 function exemptDirectTextChildren(el) {
 for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
 if (ch.nodeType === 3) {
 exemptNodes.add(ch);
 modifiedTextNodes.delete(ch);
 textSnapshots.delete(ch);
 }
 }
 }
 function recordElementConflict(el, currentText, expectedText, origText, translatedAt) {
 if (!el || el.nodeType !== 1) return false;
 if (exemptElements.has(el)) return 'blocked';
 var st = elementConflictState.get(el);
 if (!st) return false;
 var now = nowFn();
 var isBackToOrig =
 origText !== undefined
 ? currentText === origText
 : hasOwn.call(st.entries, currentText) || currentText === st.lastOrig;
 var isExternalZh = locale !== 'tr' && ZH_CHAR_RE.test(currentText || '') && currentText !== expectedText;
 if (isBackToOrig || isExternalZh) {
 var refAt = translatedAt || st.lastTranslatedAt;
 var inWindow =
 now - refAt <= CONFLICT_WINDOW_MS ||
 (st.conflicts.length > 0 && now - st.conflicts[st.conflicts.length - 1] <= CONFLICT_WINDOW_MS);
 if (inWindow) {
 if (st.lastCountedVersion === st.writeVersion) {
 if (exemptElements.has(el)) return 'blocked';
 return state.mode === 'off' ? 'deferred' : false;
 }
 st.lastCountedVersion = st.writeVersion;
 var recent = [];
 for (var i = 0; i < st.conflicts.length; i++) {
 if (now - st.conflicts[i] <= CONFLICT_WINDOW_MS) {
 recent.push(st.conflicts[i]);
 }
 }
 recent.push(now);
 st.conflicts = recent;
 if (state.mode === 'off') {
 if (recent.length >= NODE_CONFLICT_THRESHOLD) {
 cancelOffRetryForElement(el);
 exemptElements.add(el);
 blockedElementsTracker.add(el);
 exemptDirectTextChildren(el);
 if (state.status !== 'off-blocked') {
 state.status = 'off-blocked';
 state.reason = 'external-override-blocked';
 if (!state.detectedProvider) {
 var l1Blk = detectLayer1External(win, doc);
 if (l1Blk.hit) state.detectedProvider = l1Blk.provider;
 }
 setRootStatusAttr('off-blocked');
 try {
 var pApi = win && (win.__agPrism || win.__agClaudeStyle);
 if (pApi && typeof pApi.sync === 'function') pApi.sync();
 } catch (e) {}
 }
 return 'blocked';
 }
 scheduleOffConflictRetry(el);
 return 'deferred';
 }
 if (recent.length >= 2) {
 var globalCount = recordGlobalConflict(el, now);
 if (globalCount >= GLOBAL_CONFLICT_NODE_THRESHOLD) {
 yieldAndRollback('conflict-breaker');
 return 'blocked';
 }
 }
 if (recent.length >= NODE_CONFLICT_THRESHOLD) {
 exemptElements.add(el);
 exemptDirectTextChildren(el);
 return 'blocked';
 }
 return false;
 }
 }
 return false;
 }
/**
 * Checks whether a previously translated/restored node was modified externally.
 * Returns true if the node should NOT be processed synchronously right now
 * (either exempted/circuit-broken, or scheduled for a gentle 16ms retry in 'off' mode).
 */
 function checkNodeConflict(node) {
 if (!node || node.nodeType !== 3) return false;
 var parent = node.parentElement || node.parentNode;
 if (parent && exemptElements.has(parent)) return true;
 if (exemptNodes.has(node)) return true;
 var snap = textSnapshots.get(node);
 if (!snap) return false;
 var currentVal = node.nodeValue;
 if (currentVal === snap.expected) return false;
 if (parent && parent.nodeType === 1) {
 var conflictRes = recordElementConflict(parent, currentVal, snap.expected, snap.orig, snap.translatedAt);
 if (conflictRes === 'blocked' || conflictRes === true) {
 exemptNodes.add(node);
 modifiedTextNodes.delete(node);
 textSnapshots.delete(node);
 return true;
 }
 if (conflictRes === 'deferred') {
 return true;
 }
 }
 // Host updated to genuinely new English copy (e.g. "Save" -> "Saved")
 var isBackToOrig = currentVal === snap.orig;
 var isExternalZh = locale !== 'tr' && ZH_CHAR_RE.test(currentVal || '');
 if (!isBackToOrig && !isExternalZh) {
 textSnapshots.delete(node);
 modifiedTextNodes.delete(node);
 }
 return false;
 }
 function checkChildListConflict(el) {
 if (!el || el.nodeType !== 1) return false;
 if (exemptElements.has(el)) return true;
 var st = elementConflictState.get(el);
 if (!st) return false;
 var curText = el.textContent || '';
 if (curText === st.lastExpected) return false;
 var isBackToOrig = hasOwn.call(st.entries, curText) || curText === st.lastOrig;
 var isExternalZh =
 locale !== 'tr' &&
 ZH_CHAR_RE.test(curText) &&
 curText !== st.lastExpected &&
 (!st.lastExpected || curText.indexOf(st.lastExpected) === -1) &&
 !hasElementChild(el);
 if (isBackToOrig || isExternalZh) {
 var cRes = recordElementConflict(
 el,
 curText,
 st.lastExpected,
 isBackToOrig ? curText : undefined,
 st.lastTranslatedAt
 );
 if (cRes) {
 return true;
 }
 } else {
 elementConflictState.delete(el);
 }
 return false;
 }
 function applyTextWrite(node, origVal, newVal) {
 var prevSnap = textSnapshots.get(node);
 var baseOrig = prevSnap ? prevSnap.orig : origVal;
 var now = nowFn();
 node.nodeValue = newVal;
 textSnapshots.set(node, {
 orig: baseOrig,
 expected: newVal,
 translatedAt: now,
 });
 textUntranslatedCache.delete(node);
 modifiedTextNodes.add(node);
 var parent = node.parentElement || node.parentNode;
 if (parent && parent.nodeType === 1) {
 if (state.mode === 'off') {
 markTier2SkipElement(parent);
 }
 var st = elementConflictState.get(parent);
 if (!st) {
 st = {
 writeVersion: 0,
 lastCountedVersion: 0,
 lastTranslatedAt: now,
 lastOrig: baseOrig,
 lastExpected: newVal,
 entries: Object.create(null),
 conflicts: [],
 };
 elementConflictState.set(parent, st);
 }
 st.writeVersion++;
 st.lastTranslatedAt = now;
 st.lastOrig = baseOrig;
 st.lastExpected = newVal;
 if (Object.keys(st.entries).length > 16) {
 st.entries = Object.create(null);
 }
 st.entries[baseOrig] = true;
 }
 }
 var sliceEdgeWhitespace = splitOuterWhitespace;
 function enqueueNode(node) {
 if (!node || !state.active || state.destroyed) return;
 if (node.isConnected === false) return;
 if (pendingNodeSet.has(node)) return;
 if (pendingNodes.length < MAX_PENDING_NODES) {
 pendingNodes.push(node);
 pendingNodeSet.add(node);
 }
 }
 function createScanBudget(maxNodes, budgetMs) {
 var start = perfNowFn();
 return {
 processed: 0,
 maxNodes: maxNodes,
 deadline: start + budgetMs,
 exhausted: false,
 tick: function () {
 this.processed++;
 if (this.processed >= this.maxNodes) {
 this.exhausted = true;
 return true;
 }
 if ((this.processed & 3) === 0 || this.processed === 1) {
 if (perfNowFn() >= this.deadline) {
 this.exhausted = true;
 return true;
 }
 }
 return false;
 },
 isExhausted: function () {
 if (this.exhausted) return true;
 if (this.processed >= this.maxNodes) {
 this.exhausted = true;
 return true;
 }
 if (this.processed > 0 && perfNowFn() >= this.deadline) {
 this.exhausted = true;
 return true;
 }
 return false;
 },
 };
 }
 function deferRemainingChildren(ownerEl, startChild) {
 var hasLaterText = false;
 var probe = startChild.nextSibling;
 while (probe) {
 if (probe.nodeType === 3 && (probe.nodeValue || '').trim()) {
 hasLaterText = true;
 break;
 }
 probe = probe.nextSibling;
 }
 if (hasLaterText) {
 enqueueNode(ownerEl);
 } else {
 var rem = startChild;
 while (rem) {
 if (rem.nodeType === 1) enqueueNode(rem);
 rem = rem.nextSibling;
 }
 }
 }
 function translateTextNode(node, knownSafeParent, nodeCtx) {
 if (!state.active || state.destroyed) return;
 if (!node || node.nodeType !== 3) return;
 if (node.isConnected === false) return;
 if (exemptNodes.has(node)) return;
 var parent = node.parentElement || node.parentNode;
 if (parent && exemptElements.has(parent)) return;
 if (!knownSafeParent && parent) {
 var pCtx = measureSafeBoundaryDepth(parent);
 if (pCtx.blocked) return;
 nodeCtx = pCtx;
 }
 if (!inOffRetryPass && (checkNodeConflict(node) || !state.active)) return;
 var original = node.nodeValue;
 if (!original) return;
 var snap = textSnapshots.get(node);
 if (snap && snap.expected === original) { modifiedTextNodes.add(node); return; }
 if (!snap && textUntranslatedCache.get(node) === original) return;
 var trimmed = original.trim();
 if (!trimmed) { textUntranslatedCache.set(node, original); return; }
 if (state.mode === 'off') {
 if (trimmed === '。' && node.previousSibling) {
 var prevSibText = (node.previousSibling.textContent || '').trim();
 if (prevSibText && EN_ALPHA_RE.test(prevSibText) && !ZH_CHAR_RE.test(prevSibText)) {
 applyTextWrite(node, original, original.replace('。', '.'));
 return;
 }
 }
 var restored = translateSingleUnit(trimmed);
 if (restored !== null && restored !== trimmed) {
 var revEdges = sliceEdgeWhitespace(original);
 applyTextWrite(node, original, revEdges.leading + restored + revEdges.trailing);
 } else { textUntranslatedCache.set(node, original); }
 return;
 }
 if (nodeCtx && nodeCtx.inStep && !nodeCtx.inStepControl && !isStepPlainTextAllowed(trimmed)) { textUntranslatedCache.set(node, original); return; }
 if (trimmed === '.' && node.previousSibling && ZH_CHAR_RE.test(node.previousSibling.textContent || '')) {
 applyTextWrite(node, original, original.replace('.', '。'));
 return;
 }
 var translated = translateSingleUnit(trimmed);
 if (translated !== null && translated !== trimmed) {
 var edges = sliceEdgeWhitespace(original);
 var leadingSpace = edges.leading, trailingSpace = edges.trailing;
 if (!leadingSpace && node.previousSibling) {
 var prevText = (node.previousSibling.textContent || '').trim();
 if (/[a-zA-Z0-9]$/.test(prevText) && /^[\u4e00-\u9fa5]/.test(translated)) leadingSpace = ' ';
 }
 applyTextWrite(node, original, leadingSpace + translated + trailingSpace);
 } else { textUntranslatedCache.set(node, original); }
 }
 function translateAttributes(el, elCtx) {
 if (!el || el.nodeType !== 1 || el.isConnected === false || typeof el.getAttribute !== 'function') return;
 var wroteAnyAttr = false;
 var hasUri = hasAttr(el, 'data-uri');
 for (var i = 0; i < TRANSLATABLE_ATTRS.length; i++) {
 var attr = TRANSLATABLE_ATTRS[i];
 if (!hasAttr(el, attr)) continue;
 var val = getAttr(el, attr);
 if (!val) continue;
 if (attr === 'title' && (hasUri || (elCtx && elCtx.inStep && val.length <= 260 && looksLikeStepPathOrCmd(val.trim())))) continue;
 var mapRec = attrSnapshots.get(el);
 var snap = mapRec && attr in mapRec.entries ? mapRec.entries[attr] : null;
 if (snap && snap.expected === val) { modifiedAttrElements.add(el); continue; }
 if (snap && snap.expected !== val) {
 delete mapRec.entries[attr];
 mapRec.count--;
 if (mapRec.count <= 0) { attrSnapshots.delete(el); modifiedAttrElements.delete(el); mapRec = null; }
 snap = null;
 }
 var untransMap = attrUntranslatedCache.get(el);
 if (!snap && untransMap && attr in untransMap && untransMap[attr] === val) continue;
 var trans = state.mode === 'off' && activeEngine && typeof activeEngine.translateText === 'function'
 ? activeEngine.translateText(val) : translateSingleUnit(val);
 if (trans !== null && trans !== val && typeof el.setAttribute === 'function') {
 var baseOrig = val;
 el.setAttribute(attr, trans);
 if (!mapRec) { mapRec = { count: 0, entries: Object.create(null) }; attrSnapshots.set(el, mapRec); }
 if (!(attr in mapRec.entries)) mapRec.count++;
 mapRec.entries[attr] = { orig: baseOrig, expected: trans };
 modifiedAttrElements.add(el);
 wroteAnyAttr = true;
 if (untransMap && attr in untransMap) delete untransMap[attr];
 } else {
 if (!untransMap) { untransMap = Object.create(null); attrUntranslatedCache.set(el, untransMap); }
 untransMap[attr] = val;
 }
 }
 if (wroteAnyAttr && state.mode === 'off') markTier2SkipElement(el);
 }
 function applyReverseCrossNodeRulesOnElement(el) {
 if (!activeCrossNodeRules || activeCrossNodeRules.length === 0) return;
 for (var rIdx = 0; rIdx < activeCrossNodeRules.length; rIdx++) {
 var rule = activeCrossNodeRules[rIdx];
 if (!rule) continue;
 if (rule.kind === 'testid-span-prefix') {
 if (getAttr(el, 'data-testid') === rule.testid && typeof el.querySelector === 'function') {
 var alertSpan = el.querySelector('span');
 if (alertSpan && !processedAlerts.has(alertSpan)) {
 var aCh = alertSpan.firstChild;
 while (aCh) {
 if (aCh.nodeType === 3 && aCh.nodeValue && !exemptNodes.has(aCh)) {
 var aTrim = aCh.nodeValue.trim();
 if (rule.matchTrimmed && rule.matchTrimmed.indexOf(aTrim) !== -1) {
 var repPrefix = aCh.nodeValue.replace(aTrim, rule.replacement);
 if (aCh.nextSibling && aCh.nextSibling.nodeType === 1 && !/\s$/.test(repPrefix)) {
 repPrefix += ' ';
 }
 applyTextWrite(aCh, aCh.nodeValue, repPrefix);
 }
 }
 aCh = aCh.nextSibling;
 }
 processedAlerts.add(alertSpan);
 }
 }
 } else if (rule.kind === 'element-sandwich') {
 var first = el.firstChild;
 if (first && first.nextSibling) {
 var hasElemSib = false;
 var probe = first;
 while (probe) {
 if (probe.nodeType === 1) {
 hasElemSib = true;
 break;
 }
 probe = probe.nextSibling;
 }
 if (hasElemSib) {
 var leadNode = null;
 var sawMidElement = false;
 var tailNode = null;
 var cur = first;
 while (cur) {
 if (cur.nodeType === 3 && cur.nodeValue) {
 var cTrim = cur.nodeValue.trim();
 if (!leadNode && rule.leadTrimmed && rule.leadTrimmed.indexOf(cTrim) !== -1) {
 leadNode = cur;
 } else if (leadNode && sawMidElement && rule.tailTrimmed && rule.tailTrimmed.indexOf(cTrim) !== -1) {
 tailNode = cur;
 break;
 }
 } else if (cur.nodeType === 1 && leadNode) {
 sawMidElement = true;
 }
 cur = cur.nextSibling;
 }
 if (leadNode && tailNode && !exemptNodes.has(leadNode) && !exemptNodes.has(tailNode)) {
 applyTextWrite(leadNode, leadNode.nodeValue, rule.leadReplacement);
 applyTextWrite(tailNode, tailNode.nodeValue, rule.tailReplacement);
 }
 }
 }
 }
 }
 }
 function translateElement(el, visitedSet, boundaryCtx, budget) {
 if (!state.active || state.destroyed) return;
 if (!el || el.nodeType !== 1 || el.isConnected === false || exemptElements.has(el)) return;
 var _bus = getHostDomBus();
 if (_bus && typeof _bus.isSkipped === 'function' && _bus.isSkipped(el)) {
 if (!cvRevealHandler && typeof _bus.observeVisibility === 'function' && cvUnsubs.length < 256) {
 var cvRoot = el;
 for (var cvUp = el.parentElement, cvH = 0; cvUp && cvH < 12; cvUp = cvUp.parentElement, cvH++) {
 if (_bus.isSkipped(cvUp)) cvRoot = cvUp; else break;
 }
 if (!observedCvEls.has(cvRoot)) {
 observedCvEls.add(cvRoot);
 var unsubCv = null;
 unsubCv = _bus.observeVisibility(cvRoot, function (info) {
 if (!info || info.skipped) return;
 if (unsubCv) { try { unsubCv(); } catch (e) {} var ui = cvUnsubs.indexOf(unsubCv); if (ui !== -1) cvUnsubs.splice(ui, 1); unsubCv = null; }
 observedCvEls.delete(cvRoot);
 if (!state.active || state.destroyed || cvRoot.isConnected === false || exemptElements.has(cvRoot)) return;
 if (isPaused()) { missedWhilePaused = true; return; }
 enqueueNode(cvRoot);
 scheduleFlush();
 }, { doc: doc, io: false });
 if (typeof unsubCv === 'function') cvUnsubs.push(unsubCv);
 }
 }
 return;
 }
 var ctx = boundaryCtx || measureSafeBoundaryDepth(el);
 if (!ctx || ctx.state === -1 || ctx.remDepth < 0) return;
 if (visitedSet) { if (visitedSet.has(el)) return; visitedSet.add(el); }
 if (ctx.state === 1) {
 var sub = el.firstChild;
 while (sub) {
 if (!state.active || state.destroyed) return;
 if (sub.nodeType === 1) {
 if (budget && budget.isExhausted()) { deferRemainingChildren(el, sub); return; }
 var subCtx = advanceBoundaryForChild(ctx, sub);
 if (subCtx) translateElement(sub, visitedSet, subCtx, budget);
 }
 sub = sub.nextSibling;
 }
 return;
 }
 if (state.mode === 'off') {
 translateAttributes(el, ctx);
 applyReverseCrossNodeRulesOnElement(el);
 } else {
 if (getAttr(el, 'data-testid') === 'plan-command-fyi-alert' && typeof el.querySelector === 'function') {
 var alertSpan = el.querySelector('span');
 if (alertSpan && !processedAlerts.has(alertSpan)) {
 for (var alertChild = alertSpan.firstChild; alertChild; alertChild = alertChild.nextSibling) {
 if (alertChild.nodeType === 3 && alertChild.nodeValue && alertChild.nodeValue.trim() === 'Type') {
 applyTextWrite(alertChild, alertChild.nodeValue, alertChild.nodeValue.replace('Type', '输入'));
 }
 }
 processedAlerts.add(alertSpan);
 }
 }
 translateAttributes(el, ctx);
 var first = el.firstChild;
 if (first && first.nextSibling) {
 var hasElementSibling = false;
 for (var cur = first; cur; cur = cur.nextSibling) { if (cur.nodeType === 1) { hasElementSibling = true; break; } }
 if (hasElementSibling) {
 var alsoNode = null, whenNode = null;
 for (var scanCur = first; scanCur; scanCur = scanCur.nextSibling) {
 if (scanCur.nodeType === 3 && scanCur.nodeValue) {
 var tVal = scanCur.nodeValue.trim();
 if (tVal === 'Also includes') alsoNode = scanCur;
 else if (alsoNode && tVal === 'when working in this project.') { whenNode = scanCur; break; }
 }
 }
 if (alsoNode && whenNode && !exemptNodes.has(alsoNode) && !exemptNodes.has(whenNode)) {
 applyTextWrite(alsoNode, alsoNode.nodeValue, '在此项目中工作时，也包含');
 for (var between = alsoNode.nextSibling; between && between !== whenNode; between = between.nextSibling) {
 if (between.nodeType === 3 && !(between.nodeValue || '').trim()) applyTextWrite(between, between.nodeValue, '');
 }
 applyTextWrite(whenNode, whenNode.nodeValue, '。');
 }
 }
 }
 }
 if (budget) budget.tick();
 for (var child = el.firstChild; child; child = child.nextSibling) {
 if (!state.active || state.destroyed) return;
 if (child.nodeType === 3) {
 translateTextNode(child, true, ctx);
 } else if (child.nodeType === 1) {
 if (budget && budget.isExhausted()) { deferRemainingChildren(el, child); return; }
 var childCtx = advanceBoundaryForChild(ctx, child);
 if (childCtx) translateElement(child, visitedSet, childCtx, budget);
 }
 }
 }
 // 侧栏固定 UI 骨架选择器（on/auto 正向汉化 + off 反向还原共享，严格豁免会话标题行、项目名与工作区切换器）
 var SIDEBAR_LIST_SEL = '[data-testid="conversation-list-sidebar"]';
 var SIDEBAR_CTRL_SEL = 'button, [role="button"], h1, h2, h3';
 var SIDEBAR_HEADER_SEL = '[data-testid="pinned-section-header"], [data-testid="section-header"], [data-testid="coordinator-section-header"]';
 var SIDEBAR_USER_SEL = '[data-testid="conversation-row-sidebar"], [data-testid="project-header"], [data-testid="workspace-switcher"]';
 function isSidebarUserTestId(tid) {
 return tid === 'conversation-row-sidebar' || tid === 'project-header' || tid === 'workspace-switcher';
 }
 function isSidebarHeaderTestId(tid) {
 return tid === 'pinned-section-header' || tid === 'section-header' || tid === 'coordinator-section-header';
 }
 function isSidebarProtectedAttrSelf(el) {
 return hasAttr(el, 'data-resource-name') || hasAttr(el, 'data-uri') || hasAttr(el, 'data-file-path') || hasAttr(el, 'data-file-href') || hasAttr(el, 'data-omni-path');
 }
 function scanSidebarChrome(scope) {
 if (!state.active || state.destroyed || !doc || typeof doc.querySelectorAll !== 'function') return;
 var rootScope = scope && scope.nodeType === 1 ? scope : doc;
 if (rootScope !== doc) {
 if (rootScope.isConnected === false || exemptElements.has(rootScope)) return;
 if (isPrismOwnedElement(rootScope) || isExternalOwnedElement(rootScope)) return;
 if (typeof rootScope.closest === 'function' && rootScope.closest(SIDEBAR_USER_SEL)) return;
 }
 var walkSubtree = function (el, checkAncestors) {
 if (!el || el.nodeType !== 1 || el.isConnected === false || exemptElements.has(el)) return;
 if (el.isContentEditable === true || getAttr(el, 'contenteditable') === 'true') return;
 if (IGNORED_TAGS[String(el.tagName || '').toUpperCase()]) return;
 if (checkAncestors ? isPrismOwnedElement(el) || isExternalOwnedElement(el) : isPrismOwnedSelf(el) || isExternalPluginOwnedSelf(el)) return;
 var tid = getAttr(el, 'data-testid');
 if (isSidebarUserTestId(tid) || isModelSelectorSelf(el, tid) || isSidebarProtectedAttrSelf(el)) return;
 translateAttributes(el);
 for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
 if (!state.active || state.destroyed) return;
 if (ch.nodeType === 3) translateTextNode(ch, true);
 else if (ch.nodeType === 1) walkSubtree(ch, false);
 }
 };
 var scanListRoot = function (listRoot) {
 if (!listRoot || typeof listRoot.querySelectorAll !== 'function') return;
 var items = listRoot.querySelectorAll(SIDEBAR_CTRL_SEL);
 for (var b = 0; b < items.length; b++) {
 var item = items[b];
 if (!item || item.isConnected === false) continue;
 var insideUserRow = false;
 for (var cur = item; cur && cur !== listRoot; cur = cur.parentElement) {
 if (isSidebarUserTestId(getAttr(cur, 'data-testid'))) { insideUserRow = true; break; }
 }
 if (!insideUserRow) walkSubtree(item, true);
 }
 };
 var rootTid = rootScope !== doc ? getAttr(rootScope, 'data-testid') : '';
 try {
 if (isSidebarHeaderTestId(rootTid)) walkSubtree(rootScope, false);
 var headers = rootScope.querySelectorAll(SIDEBAR_HEADER_SEL);
 for (var i = 0; i < headers.length; i++) walkSubtree(headers[i], true);
 } catch (e) {}
 try {
 if (rootScope !== doc) {
 var inSidebarList = rootTid === 'conversation-list-sidebar' || Boolean(typeof rootScope.closest === 'function' && rootScope.closest(SIDEBAR_LIST_SEL));
 if (inSidebarList) {
 var rootTag = String(rootScope.tagName || '').toUpperCase();
 if (rootTag === 'BUTTON' || rootTag === 'H1' || rootTag === 'H2' || rootTag === 'H3' || getAttr(rootScope, 'role') === 'button') {
 walkSubtree(rootScope, false);
 }
 scanListRoot(rootScope);
 }
 } else {
 var listRoots = doc.querySelectorAll(SIDEBAR_LIST_SEL);
 for (var l = 0; l < listRoots.length; l++) scanListRoot(listRoots[l]);
 }
 } catch (e) {}
 }
 function safeFullScan() {
 if (!state.active || state.destroyed || !doc || !doc.documentElement) return;
 var visitedSet = new WeakSet();
 disconnectObserver();
 try {
 translateElement(doc.documentElement, visitedSet, null, null);
 scanSidebarChrome();
 } catch (e) {}
 reconnectObserver();
 }
 function safeBudgetedScan() {
 if (!state.active || state.destroyed || !doc || !doc.documentElement) return;
 if (!hasRafSupport) {
initialScanDraining = false;
 safeFullScan();
if (isPaused()) disconnectObserver();
 return;
 }
 var visitedSet = new WeakSet();
 var budget = createScanBudget(INITIAL_SYNC_MAX_NODES, INITIAL_SYNC_BUDGET_MS);
 disconnectObserver();
 try {
 translateElement(doc.documentElement, visitedSet, null, budget);
 scanSidebarChrome();
 } catch (e) {}
if (!isPaused() || (state.mode === 'auto' && nowFn() - bootAt <= LAYER2B_WINDOW_MS)) {
 reconnectObserver();
 }
if (state.active && !state.destroyed && pendingNodes.length > 0) {
initialScanDraining = true;
scheduleFlush();
 } else {
initialScanDraining = false;
 }
 }
function flushPendingNodes() {
 rafId = null;
 if (!state.active || state.destroyed) return;
 if (isPaused() && !canContinuePendingFlush()) {
initialScanDraining = false;
if (!hibernating) enterHibernation(true);
else missedWhilePaused = true;
 return;
 }
modifiedTextNodes.prune();
 modifiedAttrElements.prune();
if (pendingNodes.length === 0) {
initialScanDraining = false;
if (isPaused() && !hibernating) enterHibernation(false);
 return;
 }
var takeCount = Math.min(pendingNodes.length, MAX_NODES_PER_FRAME);
var batch = pendingNodes.splice(0, takeCount);
for (var b = 0; b < batch.length; b++) {
pendingNodeSet.delete(batch[b]);
 }
var budget = createScanBudget(MAX_NODES_PER_FRAME, FRAME_BUDGET_MS);
 var visitedSet = new WeakSet();
var shouldObserve = !isPaused() || (state.mode === 'auto' && nowFn() - bootAt <= LAYER2B_WINDOW_MS);
 disconnectObserver();
 try {
for (var i = 0; i < batch.length; i++) {
if (!state.active || state.destroyed) break;
var node = batch[i];
if (!node || node.isConnected === false) continue;
if (i > 0 && budget.isExhausted()) {
for (var r = i; r < batch.length; r++) {
enqueueNode(batch[r]);
 }
 break;
 }
if (node.nodeType === 1) {
translateElement(node, visitedSet, null, budget);
} else if (node.nodeType === 3) {
translateTextNode(node, false);
budget.tick();
 }
 }
 } catch (e) {}
if (shouldObserve) reconnectObserver();
if (state.active && !state.destroyed && pendingNodes.length > 0) {
scheduleFlush();
 } else {
initialScanDraining = false;
if (state.active && !state.destroyed && isPaused() && !hibernating) enterHibernation(false);
 }
 }
function scheduleFlush() {
 if (!state.active || state.destroyed) return;
 if (isPaused() && !canContinuePendingFlush()) {
initialScanDraining = false;
if (!hibernating) enterHibernation(true);
else missedWhilePaused = true;
 return;
 }
if (rafId === null) {
var _b = !hasCustomRaf ? getHostDomBus() : null;
if (_b && typeof _b.scheduleTask === 'function') {
rafId = 'bus';
_b.scheduleTask('conv:host-i18n-flush', flushPendingNodes, { priority: 'background' });
 } else {
rafId = rafFn(flushPendingNodes);
 }
 }
 }
function inspectExternalDelayedMutation(node) {
if (state.mode !== 'auto') return false;
if (nowFn() - bootAt > LAYER2B_WINDOW_MS) return false;
if (!node) return false;
function checkSingleTextNode(tNode) {
if (!tNode || tNode.nodeType !== 3) return;
var parent = tNode.parentElement || tNode.parentNode;
 if (
!parent ||
isPrismOwnedElement(parent) ||
isUserContentBoundary(parent) ||
isInsideConversationStream(parent) ||
isIgnoredBoundary(parent)
 ) {
 return;
 }
var val = (tNode.nodeValue || '').trim();
if (!val || !ZH_CHAR_RE.test(val)) return;
var snap = textSnapshots.get(tNode);
if (snap && snap.expected === tNode.nodeValue) return;
if (hasOwn.call(translatedValues, val) || isInsideExplicitDelayedChrome(parent)) {
delayedExternalNodes.add(parent);
 }
 }
 if (node.nodeType === 3) {
checkSingleTextNode(node);
} else if (node.nodeType === 1) {
 if (
isPrismOwnedElement(node) ||
isUserContentBoundary(node) ||
isInsideConversationStream(node) ||
isIgnoredBoundary(node)
 ) {
 return false;
 }
var stack = [node];
var steps = 0;
while (stack.length > 0 && steps < 120) {
steps++;
var cur = stack.pop();
 if (cur.nodeType === 3) {
checkSingleTextNode(cur);
 } else if (
cur.nodeType === 1 &&
!isDirectIgnoredSelf(cur) &&
!isConversationStreamSelf(cur)
 ) {
var ch = cur.firstChild;
 while (ch) {
stack.push(ch);
 ch = ch.nextSibling;
 }
 }
 }
 }
if (delayedExternalNodes.size >= 2) {
yieldAndRollback('external-ui-zh');
 return true;
 }
 return false;
 }
var FLOATING_CONTAINER_SEL =
'[role="tooltip"], [role="menu"], [role="listbox"], [data-floating-ui-portal], [data-base-ui-portal], [data-radix-popper-content-wrapper], .popover, .tooltip, .context-view, .monaco-hover';
function hasFloatingShellHint(el) {
 if (!el || el.nodeType !== 1) return false;
if (isFocusGuardSelf(el)) return true;
if (isDialogOrPortalWrappingDialog(el) || isDirectIgnoredSelf(el)) return false;
if (isFloatingElement(el, doc)) return true;
if (hasAttr(el, 'data-radix-portal')) return true;
var idStr = typeof el.id === 'string' ? el.id.toLowerCase() : '';
return Boolean(idStr && (idStr.indexOf('portal') !== -1 || idStr.indexOf('tooltip') !== -1 || idStr.indexOf('popover') !== -1));
 }
function collectTriggerFloatingHint(target, addCandidate) {
var hit = false;
var cur = target;
for (var depth = 0; depth < 2 && cur && cur.nodeType === 1; depth++) {
var desc = getAttr(cur, 'aria-describedby') || getAttr(cur, 'aria-controls') || '';
if (desc) {
hit = true;
if (typeof doc.getElementById === 'function') {
var parts = desc.trim().split(/\s+/);
for (var i = 0; i < parts.length; i++) {
if (!parts[i]) continue;
var refEl = doc.getElementById(parts[i]);
if (refEl) addCandidate(refEl);
 }
 }
 }
if (getAttr(cur, 'data-state') === 'open' || getAttr(cur, 'aria-expanded') === 'true') {
hit = true;
 }
 cur = cur.parentElement;
 }
return hit;
 }
function scanFloatingContainers(fullScan, triggerTarget) {
if (!state.active || state.destroyed || !doc || !doc.body) return;
 if (isPaused()) {
if (!hibernating) enterHibernation();
 return;
 }
var candidates = [];
var candidateSet = new Set();
function addCandidate(el) {
if (!el || el.nodeType !== 1 || el.isConnected === false) return;
if (candidateSet.has(el) || exemptElements.has(el)) return;
if (isDialogOrPortalWrappingDialog(el) || isDirectIgnoredSelf(el)) return;
if (hasAttr(el, 'data-hover-card-popup') || (typeof el.querySelector === 'function' && isPortalAttr(el) && el.querySelector('[data-hover-card-popup]'))) return;
candidateSet.add(el);
candidates.push(el);
 }
var hasFloatHint = Boolean(fullScan);
var tail = doc.body.lastElementChild;
for (var step = 0; tail && step < 4; step++, tail = tail.previousElementSibling) {
if (isFloatingElement(tail, doc)) {
addCandidate(tail);
hasFloatHint = true;
} else if (!hasFloatHint && hasFloatingShellHint(tail)) {
hasFloatHint = true;
 }
 }
if (!fullScan && triggerTarget && collectTriggerFloatingHint(triggerTarget, addCandidate)) {
hasFloatHint = true;
 }
if ((fullScan || hasFloatHint) && typeof doc.querySelectorAll === 'function') {
var popups = doc.querySelectorAll(FLOATING_CONTAINER_SEL);
if (popups && popups.length > 0) {
for (var pIdx = 0; pIdx < popups.length; pIdx++) {
addCandidate(popups[pIdx]);
 }
 }
 }
if (candidates.length === 0) return;
 var visitedSet = new WeakSet();
var domBus = (win && (win.__agDomBus || win.__agPrismDomBus)) || (typeof window !== 'undefined' && (window.__agDomBus || window.__agPrismDomBus));
if (candidates.length > 24 && domBus && typeof domBus.runChunked === 'function') {
domBus.runChunked(candidates, function (el) {
if (!state.active || state.destroyed || isPaused()) return;
 disconnectObserver();
try { translateElement(el, visitedSet, null, null); } catch (e) {}
 reconnectObserver();
}, { budgetMs: 3.5 });
 return;
 }
 disconnectObserver();
 try {
for (var cIdx = 0; cIdx < candidates.length; cIdx++) {
if (!state.active || state.destroyed) break;
translateElement(candidates[cIdx], visitedSet, null, null);
 }
 } catch (e) {}
 reconnectObserver();
 }
var hoverBoundaryCache = new WeakMap();
function getHoverBoundary(el, now) {
if (!el || el.nodeType !== 1) return { blocked: true };
var cached = hoverBoundaryCache.get(el);
if (cached && now - cached.ts < 64) return cached.res;
var res = measureSafeBoundaryDepth(el);
hoverBoundaryCache.set(el, { ts: now, res: res });
return res;
 }
function hasHoverCandidateWork(el, includeSubtree) {
if (!el || el.nodeType !== 1 || state.mode === 'off') return true;
if (exemptElements.has(el)) return false;
var stack = [[el, 0]], visited = 0;
 while (stack.length) {
var pair = stack.pop(), cur = pair[0], depth = pair[1];
if (!cur || cur.nodeType !== 1 || cur.isConnected === false || exemptElements.has(cur)) continue;
if (depth > 0 && (IGNORED_TAGS[String(cur.tagName || '').toUpperCase()] || isIgnoredBoundary(cur))) continue;
if (++visited > 40) return true;
for (var ai = 0; ai < TRANSLATABLE_ATTRS.length; ai++) {
var attr = TRANSLATABLE_ATTRS[ai];
if (!hasAttr(cur, attr)) continue;
var val = getAttr(cur, attr);
 if (!val) continue;
var mapRec = attrSnapshots.get(cur), aSnap = mapRec && attr in mapRec.entries ? mapRec.entries[attr] : null;
if (aSnap && aSnap.expected === val) continue;
var untransMap = attrUntranslatedCache.get(cur);
if (!aSnap && untransMap && attr in untransMap && untransMap[attr] === val) continue;
 return true;
 }
for (var child = cur.firstChild; child; child = child.nextSibling) {
 if (child.nodeType === 3) {
if (!exemptNodes.has(child)) {
var txt = child.nodeValue;
if (txt && txt.trim()) {
var tSnap = textSnapshots.get(child);
if (!(tSnap && tSnap.expected === txt) && !(!tSnap && textUntranslatedCache.get(child) === txt)) return true;
 }
 }
} else if (child.nodeType === 1 && includeSubtree) {
if (depth >= 4) return true;
stack.push([child, depth + 1]);
 }
 }
 }
 return false;
 }
function runHoverTargetScan(target, preBound) {
if (!state.active || state.destroyed || isPaused() || !target || target.nodeType !== 1) return;
if (target.isConnected === false || exemptElements.has(target)) return;
if (isDialogOrPortalWrappingDialog(target) || isWorkbenchOrRoot(target, doc)) return;
var now = nowFn(), targetCtx = preBound || getHoverBoundary(target, now);
if (targetCtx.blocked) return;
var scanTarget = getChildElementCount(target) <= 12, parent = target.parentElement, parentCtx = null;
if (parent && !isWorkbenchOrRoot(parent, doc) && !isDialogOrPortalWrappingDialog(parent) && getChildElementCount(parent) <= 8) {
var pCtx = getHoverBoundary(parent, now);
if (!pCtx.blocked) parentCtx = pCtx;
 }
if (!scanTarget && !parentCtx) return;
var needTarget = scanTarget && hasHoverCandidateWork(target, true), needParent = !!parentCtx && hasHoverCandidateWork(parent, true);
 var visitedSet = new WeakSet();
 disconnectObserver();
 try {
if (needTarget) translateElement(target, visitedSet, targetCtx, null);
if (needParent && state.active && !state.destroyed) translateElement(parent, visitedSet, parentCtx, null);
} catch (err) {}
 reconnectObserver();
 }
function enterHibernation(markMissed) {
 if (!state.active || state.destroyed) return;
if (canContinuePendingFlush() && pendingNodes.length > 0) {
if (markMissed) missedWhilePaused = true;
if (state.mode !== 'auto' || nowFn() - bootAt > LAYER2B_WINDOW_MS) {
disconnectObserver(true);
missedWhilePaused = true;
 }
 return;
 }
initialScanDraining = false;
var wasCovered = observing || dirtyProbeActive;
hibernating = true;
 pendingFullFloatScan = false;
 pendingSidebarRescan = false;
 pendingConvViewRescan = false;
 if (rafId === 'bus') {
try { var _hb = getHostDomBus(); if (_hb && typeof _hb.cancelTask === 'function') _hb.cancelTask('conv:host-i18n-flush'); } catch (e) {}
 rafId = null;
 } else if (rafId !== null) {
 cancelRafFn(rafId);
 rafId = null;
 }
 if (hoverScanTimer !== null) {
 clearTimeoutFn(hoverScanTimer);
 hoverScanTimer = null;
 }
 if (hoverCardTimer !== null) {
 clearTimeoutFn(hoverCardTimer);
 hoverCardTimer = null;
 }
 pendingHoverCardNode = null;
 if (focusWakeTimer !== null) {
 clearTimeoutFn(focusWakeTimer);
 focusWakeTimer = null;
 }
var hadOffRetry = clearOffRetryTimers();
if (markMissed || hadOffRetry || pendingNodes.length > 0 || !wasCovered) missedWhilePaused = true;
 pendingNodes.length = 0;
 pendingNodeSet.clear();
var hiddenNow = Boolean(doc && doc.hidden === true);
if (hiddenNow) {
 missedWhilePaused = true;
 disconnectDirtyObserver();
 }
if (state.mode !== 'auto' || nowFn() - bootAt > LAYER2B_WINDOW_MS) {
if (observer && observing) {
 try {
if (typeof observer.takeRecords === 'function') {
var recs = observer.takeRecords();
if (recs && recs.length > 0) missedWhilePaused = true;
 }
 } catch (e) {}
 }
 disconnectObserver(true);
if (!hiddenNow && !missedWhilePaused) {
armDirtyObserver();
 } else {
 disconnectDirtyObserver();
 }
 }
 }
function wakeFromHibernation() {
 if (!state.active || state.destroyed) return;
if (isPaused()) return;
 hibernating = false;
var hadProbe = dirtyProbeActive;
 if (dirtyObserver && dirtyProbeActive) {
 try {
if (typeof dirtyObserver.takeRecords === 'function') {
var recs = dirtyObserver.takeRecords();
if (recs && recs.length > 0) missedWhilePaused = true;
 }
 } catch (e) {}
 disconnectDirtyObserver();
 }
if (missedWhilePaused || pendingNodes.length > 0 || (!observing && !hadProbe)) {
missedWhilePaused = false;
 pendingNodes.length = 0;
 pendingNodeSet.clear();
safeBudgetedScan();
 }
 reconnectObserver();
 }
function attachListenersAndObserver() {
if (!doc || !doc.documentElement || state.destroyed || !state.active) return;
var MutationObserverClass =
 customMutationObserver ||
 (win && win.MutationObserver) ||
 (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
var isFocusGuard = isFocusGuardSelf;
var isHoverCardPortalOrSelf = function (n) {
if (!n || n.nodeType !== 1 || n === doc.body || n === doc.documentElement) return false;
if (hasAttr(n, 'data-hover-card-popup')) return true;
if (typeof n.closest === 'function' && n.closest('[data-hover-card-popup]')) return true;
if ((hasAttr(n, 'data-base-ui-portal') || hasAttr(n, 'data-floating-ui-portal') || getAttr(n, 'role') === 'presentation') && typeof n.querySelector === 'function' && n.querySelector('[data-hover-card-popup]')) return true;
for (var c = n.firstElementChild, k = 0; c && k < 4; c = c.nextElementSibling, k++) {
if (hasAttr(c, 'data-hover-card-popup') || hasAttr(c.firstElementChild, 'data-hover-card-popup') || hasAttr(c.lastElementChild, 'data-hover-card-popup')) return true;
 }
 return false;
 };
var scheduleHoverCardNode = function (n) {
pendingHoverCardNode = n;
if (hoverCardTimer !== null) clearTimeoutFn(hoverCardTimer);
hoverCardTimer = setTimeoutFn(function () {
 hoverCardTimer = null;
var hc = pendingHoverCardNode;
 pendingHoverCardNode = null;
if (!state.active || state.destroyed || isPaused() || !hc || hc.isConnected === false) return;
enqueueNode(hc);
scheduleFlush();
}, 120);
 };
var domBusInst = getHostDomBus();
var onDomMutations = function (mutations) {
if (!observing || !state.active || state.destroyed) return;
var inLayer2b = state.mode === 'auto' && nowFn() - bootAt <= LAYER2B_WINDOW_MS;
var pausedNow = isPaused();
if (pausedNow) {
if (!hibernating) enterHibernation(true);
else missedWhilePaused = true;
if (!inLayer2b) return;
 }
var batchBoundaryCache = new WeakMap();
var immediateFloatNodes = [];
var sidebarNodes = [];
function getCachedBoundary(el) {
var hit = batchBoundaryCache.get(el);
if (hit !== undefined) return hit;
var res = measureSafeBoundaryDepth(el);
batchBoundaryCache.set(el, res);
return res;
 }
function isImmediateFloatingMenu(el, parentEl) {
if (isDialogOrPortalWrappingDialog(el)) return false;
if (isFloatingElement(el, doc) || hasAttr(el, 'data-radix-portal')) return true;
if (
(parentEl === doc.body || hasFloatingShellHint(el)) &&
typeof el.querySelector === 'function' &&
el.querySelector('[role="menu"], [role="listbox"]')
) {
return true;
}
return false;
 }
function collectDynamicSidebarChromeNodes(targetEl, added, isDirectSidebarList) {
if (pausedNow || !added || added.length === 0) return;
if (!isDirectSidebarList) {
if (isPrismOwnedSelf(targetEl) || isExternalPluginOwnedSelf(targetEl)) return;
var tTid = getAttr(targetEl, 'data-testid');
if (isSidebarUserTestId(tTid)) return;
if (typeof targetEl.closest !== 'function' || !targetEl.closest(SIDEBAR_LIST_SEL)) return;
if (targetEl.closest(SIDEBAR_USER_SEL)) return;
}
for (var sj = 0; sj < added.length; sj++) {
var sn = added[sj];
if (!sn || sn.nodeType !== 1 || sn.isConnected === false) continue;
if (exemptElements.has(sn) || isSidebarUserTestId(getAttr(sn, 'data-testid'))) continue;
if (isPrismOwnedSelf(sn) || isExternalPluginOwnedSelf(sn)) continue;
sidebarNodes.push(sn);
}
 }
for (var i = 0; i < mutations.length; i++) {
 if (!state.active || state.destroyed) return;
var mutation = mutations[i];
if (mutation.type === 'childList') {
var targetEl = mutation.target;
var added = mutation.addedNodes;
if (targetEl && targetEl.nodeType === 1) {
if (targetEl.isConnected === false || exemptElements.has(targetEl)) continue;
var targetIsHoverCard = isHoverCardPortalOrSelf(targetEl);
if (targetIsHoverCard) {
if (!pausedNow && added && added.length > 0) scheduleHoverCardNode(targetEl);
 continue;
 }
if (isChatProseSelf(targetEl)) continue;
if (isDirectIgnoredSelf(targetEl)) {
if (getAttr(targetEl, 'data-testid') === 'conversation-list-sidebar') {
collectDynamicSidebarChromeNodes(targetEl, added, true);
}
continue;
}
var targetBound = getCachedBoundary(targetEl);
if (targetBound.blocked && !targetBound.canDescendConv) {
collectDynamicSidebarChromeNodes(targetEl, added, false);
continue;
}
if (!pausedNow && !targetBound.blocked && checkChildListConflict(targetEl)) {
 continue;
 }
 if (!state.active || state.destroyed) return;
if (!added || added.length === 0) continue;
for (var j = 0; j < added.length; j++) {
var addedNode = added[j];
if (!addedNode || addedNode.isConnected === false) continue;
if (addedNode.nodeType === 3) {
if (targetBound.blocked || exemptNodes.has(addedNode)) continue;
} else if (addedNode.nodeType === 1) {
if (exemptElements.has(addedNode) || isChatProseSelf(addedNode) || isDirectIgnoredSelf(addedNode) || isFocusGuard(addedNode)) continue;
if (isHoverCardPortalOrSelf(addedNode)) {
if (!pausedNow) scheduleHoverCardNode(addedNode);
 continue;
 }
 if (
targetBound.canDescendConv &&
!isInteractiveChatChromeSelf(addedNode, true) &&
isOnlyIgnoredElemChildren(addedNode)
 ) {
 continue;
 }
if (!pausedNow && !targetBound.blocked && isImmediateFloatingMenu(addedNode, targetEl)) {
if (inLayer2b && inspectExternalDelayedMutation(addedNode)) return;
immediateFloatNodes.push(addedNode);
continue;
}
 } else {
 continue;
 }
if (inLayer2b && inspectExternalDelayedMutation(addedNode)) return;
if (!pausedNow) enqueueNode(addedNode);
 }
} else if (added && added.length > 0) {
for (var k = 0; k < added.length; k++) {
var rootAdded = added[k];
if (!rootAdded || rootAdded.isConnected === false) continue;
if (inLayer2b && inspectExternalDelayedMutation(rootAdded)) return;
if (!pausedNow) enqueueNode(rootAdded);
 }
 }
} else if (mutation.type === 'characterData' && mutation.target) {
var target = mutation.target;
if (target.isConnected === false || exemptNodes.has(target)) continue;
var parent = target.parentElement || target.parentNode;
if (!parent || parent.nodeType !== 1 || parent.isConnected === false || exemptElements.has(parent)) {
 continue;
 }
if (isHoverCardPortalOrSelf(parent)) {
if (!pausedNow) scheduleHoverCardNode(parent);
 continue;
 }
if (isChatProseSelf(parent) || isDirectIgnoredSelf(parent)) continue;
var snap = textSnapshots.get(target);
if (snap && snap.expected === target.nodeValue) continue;
var parentBound = getCachedBoundary(parent);
if (parentBound.blocked) continue;
if (inLayer2b && inspectExternalDelayedMutation(target)) return;
if (pausedNow) continue;
if (checkNodeConflict(target)) continue;
 if (!state.active || state.destroyed) return;
enqueueNode(target);
 }
 }
if (!pausedNow && (immediateFloatNodes.length > 0 || sidebarNodes.length > 0)) {
var immediateVisited = new WeakSet();
disconnectObserver();
try {
for (var fi = 0; fi < immediateFloatNodes.length; fi++) {
if (!state.active || state.destroyed) break;
translateElement(immediateFloatNodes[fi], immediateVisited, null, null);
}
for (var si = 0; si < sidebarNodes.length; si++) {
if (!state.active || state.destroyed) break;
scanSidebarChrome(sidebarNodes[si]);
}
} catch (e) {}
reconnectObserver();
}
if (!pausedNow && pendingNodes.length > 0) scheduleFlush();
 };
if (domBusInst && typeof domBusInst.subscribe === 'function') {
observer = {
observe: function () {
if (!busDomUnsub) busDomUnsub = domBusInst.subscribe('host-i18n-dom', onDomMutations, { doc: doc, win: win, priority: 'low', observeOptions: { childList: true, subtree: true, characterData: true } });
 },
disconnect: function (hard) {
if (hard && busDomUnsub) { try { busDomUnsub(); } catch (e) {} busDomUnsub = null; }
 },
 };
} else if (MutationObserverClass) {
observer = new MutationObserverClass(onDomMutations);
 }
if (typeof doc.addEventListener === 'function' && !cvRevealHandler) {
cvRevealHandler = function (e) {
if (!state.active || state.destroyed || !e || e.skipped) return;
var t = e.target;
if (!t || t.nodeType !== 1 || t.isConnected === false || exemptElements.has(t)) return;
if (isChatProseSelf(t) || isDirectIgnoredSelf(t)) return;
if (isPaused()) { missedWhilePaused = true; return; }
var b = measureSafeBoundaryDepth(t);
if (!b || b.state === -1) return;
if (b.canDescendConv && !isInteractiveChatChromeSelf(t, true) && isOnlyIgnoredElemChildren(t)) return;
enqueueNode(t);
scheduleFlush();
};
doc.addEventListener('contentvisibilityautostatechange', cvRevealHandler, { capture: true, passive: true });
}
if (!isPaused()) {
safeBudgetedScan();
 } else if (state.mode === 'off' && !isDocHidden()) {
// 窗口可见但暂时失焦（如热切换配置/外部改 config.json）时，off 模式先同步执行一次全量还原，随后保持 0fps 休眠
 safeFullScan();
 disconnectObserver();
hibernating = true;
 missedWhilePaused = true;
 } else if (state.mode !== 'off' && canDrainVisibleBlur()) {
// 默认 balanced/quality 档下，可见但失焦的主窗热注入/冷启动需先完成一次性首扫与 pendingNodes 排空，再进入 0fps 休眠
hibernating = false;
safeBudgetedScan();
if (pendingNodes.length === 0 && isPaused()) {
enterHibernation(false);
 }
 } else {
hibernating = true;
 missedWhilePaused = true;
 }
 if (!state.active || state.destroyed) return;
if (observer && (!isPaused() || (state.mode === 'auto' && nowFn() - bootAt <= LAYER2B_WINDOW_MS))) {
 reconnectObserver();
 }
var onWinBlurMuts = function (muts) {
 if (!state.active || state.destroyed) return;
var sawPauseAttr = false;
for (var wi = 0; wi < muts.length; wi++) {
var attrName = muts[wi].attributeName;
if (muts[wi].type === 'attributes' && (!attrName || attrName === 'data-ag-cs-win-blur' || attrName === 'data-ag-pp-open')) { sawPauseAttr = true; break; }
 }
if (!sawPauseAttr) return;
if (isPaused()) enterHibernation();
else if (hibernating || !observing) wakeFromHibernation();
 };
if (doc.documentElement) {
if (domBusInst && typeof domBusInst.subscribe === 'function') {
winBlurObserver = { disconnect: domBusInst.subscribe('host-i18n-blur', onWinBlurMuts, { doc: doc, win: win, priority: 'high', observeOptions: { childList: false, subtree: false, attributes: true, attributeFilter: ['data-ag-cs-win-blur', 'data-ag-pp-open'] } }) };
} else if (MutationObserverClass) {
 try {
winBlurObserver = new MutationObserverClass(onWinBlurMuts);
winBlurObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-ag-cs-win-blur', 'data-ag-pp-open'] });
} catch (e) { winBlurObserver = null; }
 }
 }
// Layer 2b delayed-plugin check within 1200ms window (auto mode only)
if (state.mode === 'auto') {
var checkDelays = [450, 1150];
for (var d = 0; d < checkDelays.length; d++) {
(function (delayMs) {
 var tid = setTimeoutFn(function () {
if (!state.active || state.destroyed || state.mode !== 'auto') return;
if (nowFn() - bootAt > LAYER2B_WINDOW_MS + 100) return;
var l1 = detectLayer1External(win, doc);
if (l1.hit) {
yieldAndRollback('external-ui-zh', l1.provider);
 return;
 }
var l2 = detectLayer2ChromeZh(doc, { textSnapshots: textSnapshots });
if (l2.hit) {
yieldAndRollback('external-ui-zh', 'generic-zh-dom');
 return;
 }
if (delayMs >= 1150 && isPaused()) {
 disconnectObserver();
if (canContinuePendingFlush() && pendingNodes.length > 0) {
 missedWhilePaused = true;
} else if (isDocHidden()) {
 missedWhilePaused = true;
} else if (!missedWhilePaused) {
armDirtyObserver();
 }
 }
}, delayMs);
layer2bTimers.push(tid);
})(checkDelays[d]);
 }
 }
// 单趟 O(1) 判定侧栏点击目标（off 模式或非侧栏区域秒退，避免 300Hz 点击卡顿）
function classifySidebarClickTarget(target) {
var inRow = false;
var inSidebar = false;
var cur = target;
for (var depth = 0; cur && cur.nodeType === 1 && depth < 16; depth++) {
if (cur === doc.body || cur === doc.documentElement) break;
if (isPrismOwnedSelf(cur) || isExternalPluginOwnedSelf(cur)) {
return { inRow: false, inSidebar: false };
}
var tid = getAttr(cur, 'data-testid');
if (tid === 'conversation-view' || tid === 'agent-input-box') {
return { inRow: false, inSidebar: false };
}
if (tid === 'conversation-row-sidebar') {
inRow = true;
inSidebar = true;
} else if (tid === 'conversation-list-sidebar') {
inSidebar = true;
break;
}
cur = cur.parentElement;
}
return { inRow: inRow, inSidebar: inSidebar };
}
// Hover, ContextMenu & Sidebar Click targeted floating/conversation rescan
hoverHandler = function (e) {
 if (!state.active || state.destroyed) return;
var evType = e && e.type;
var isClick = evType === 'click';
if (isClick && state.mode === 'off') return;
 if (isPaused()) {
if (!hibernating) enterHibernation();
 return;
 }
if (hibernating) wakeFromHibernation();
var rawTarget = e && e.target;
var target = rawTarget && rawTarget.nodeType === 3 ? rawTarget.parentElement || rawTarget.parentNode : rawTarget;
if (!target || target.nodeType !== 1 || target.isConnected === false) return;
var now = nowFn();
var isContextMenu = evType === 'contextmenu';
var hoverBound = null;
if (isContextMenu) {
if (e.defaultPrevented || exemptElements.has(target) || target.closest?.('.ag-cs-ctx-menu,.ag-cs-diff-ctx-menu,.ag-omni-menu,#ag-prism-overlay-portal,[data-ag-owned="1"],[data-ag-prism-overlay]')) return;
pendingFullFloatScan = true;
} else if (isClick) {
if (exemptElements.has(target) || hasAttr(target, 'data-ag-owned') || hasAttr(target, 'data-ag-no-i18n')) return;
var clickInfo = classifySidebarClickTarget(target);
if (!clickInfo.inSidebar) return;
pendingSidebarRescan = true;
if (clickInfo.inRow) pendingConvViewRescan = true;
pendingFullFloatScan = true;
} else if (evType === 'pointerenter') {
var tg = String(target.tagName || '').toUpperCase();
if (IGNORED_TAGS[tg] || tg === 'PATH' || tg === 'CIRCLE' || tg === 'RECT' || tg === 'LINE' || tg === 'POLYLINE' || tg === 'POLYGON' || tg === 'ELLIPSE' || tg === 'G' || tg === 'DEFS' || tg === 'USE' || tg === 'STOP') return;
if (exemptElements.has(target) || hasAttr(target, 'data-ag-owned') || hasAttr(target, 'data-ag-no-i18n') || isDialogOrPortalWrappingDialog(target)) return;
if (target.closest?.(SIDEBAR_USER_SEL + ',' + SIDEBAR_LIST_SEL + ',[data-testid="sidebar-split"]>div:first-child,[data-hover-card-popup]')) return;
hoverBound = getHoverBoundary(target, now);
if (hoverBound.blocked) return;
if (isInsideDialog(target) && !isSmallHoverControl(target)) return;
 }
var elapsed = now - lastHoverTime;
var ranImmediate = false;
if (!isClick && elapsed >= 120) {
lastHoverTime = now;
ranImmediate = true;
runHoverTargetScan(target, hoverBound);
}
if (hoverScanTimer !== null) clearTimeoutFn(hoverScanTimer);
var delay = isClick ? 30 : ranImmediate ? 50 : Math.max(50, 120 - elapsed + 20);
hoverScanTimer = setTimeoutFn(function () {
 hoverScanTimer = null;
lastHoverTime = nowFn();
if (!isClick && !ranImmediate) runHoverTargetScan(target, hoverBound);
var doFull = pendingFullFloatScan;
var doSidebar = pendingSidebarRescan;
var doConvView = pendingConvViewRescan;
 pendingFullFloatScan = false;
pendingSidebarRescan = false;
pendingConvViewRescan = false;
scanFloatingContainers(doFull, target);
if (doSidebar && state.active && !state.destroyed && !isPaused()) {
disconnectObserver();
try {
scanSidebarChrome();
} catch (err) {}
reconnectObserver();
}
if (doConvView && state.active && !state.destroyed && !isPaused() && typeof doc.querySelectorAll === 'function') {
var convViews = doc.querySelectorAll('[data-testid="conversation-view"]');
for (var ci = 0; ci < convViews.length; ci++) {
enqueueNode(convViews[ci]);
}
if (convViews.length > 0) scheduleFlush();
}
}, delay);
 };
if (typeof doc.addEventListener === 'function') {
doc.addEventListener('pointerenter', hoverHandler, { capture: true, passive: true });
doc.addEventListener('contextmenu', hoverHandler, { capture: true, passive: true });
doc.addEventListener('click', hoverHandler, { capture: true, passive: true });
visibilityHandler = function () {
 if (!state.active || state.destroyed) return;
 if (isPaused()) {
enterHibernation();
 } else {
wakeFromHibernation();
 }
 };
doc.addEventListener('visibilitychange', visibilityHandler);
 }
if (win && typeof win.addEventListener === 'function') {
blurHandler = function () {
pausedByWindowBlur = true;
enterHibernation();
 };
focusHandler = function () {
 pausedByWindowBlur = false;
if (!isPaused()) {
wakeFromHibernation();
} else if (isWinBlurAttrSet() && focusWakeTimer === null) {
// Allow companion runtime's focus handler to clear data-ag-cs-win-blur in the same turn
focusWakeTimer = setTimeoutFn(function () {
 focusWakeTimer = null;
if (!isPaused()) wakeFromHibernation();
}, 0);
 }
 };
win.addEventListener('blur', blurHandler);
win.addEventListener('focus', focusHandler);
 }
 }
function boot(targetMode) {
mode = targetMode === 'on' || targetMode === 'off' ? targetMode : 'auto';
state.mode = mode;
if (locale === 'tr' && doc && doc.documentElement) { try { doc.documentElement.setAttribute('lang', 'tr'); } catch (e) {} }
selectEngineForMode(mode);
state.destroyed = false;
state.yielded = false;
state.reason = null;
state.detectedProvider = null;
bootAt = nowFn();
 pausedByWindowBlur = false;
 initialScanDraining = false;
hibernating = Boolean(isDocHidden() || ((isWinBlurAttrSet() || isPeriodicPickerOpen()) && !canDrainVisibleBlur()));
missedWhilePaused = false;
 dirtyProbeActive = false;
 pendingFullFloatScan = false;
 pendingSidebarRescan = false;
 pendingConvViewRescan = false;
 inOffRetryPass = false;
 delayedExternalNodes.clear();
 globalConflictRecords.length = 0;
if (mode === 'off') {
var l1Pre = detectLayer1External(win, doc);
if (l1Pre.hit) state.detectedProvider = l1Pre.provider || null;
activateTier1Suppression();
state.active = true;
state.status = 'off-enforced';
setRootStatusAttr('off-enforced');
 if (doc) {
if (doc.readyState === 'loading' && typeof doc.addEventListener === 'function') {
domReadyHandler = function () {
 if (!state.active || state.destroyed || state.mode !== 'off') return;
attachListenersAndObserver();
 };
doc.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
 } else {
attachListenersAndObserver();
 }
 }
 return;
 }
 if (mode === 'auto') {
 var extCheck = detectExternalLocalization(win, doc, { locale: locale });
 if (extCheck.detected) {
 state.active = false; state.status = 'yielded'; state.reason = extCheck.reason || 'external-ui-zh';
 state.detectedProvider = extCheck.provider || 'generic-external'; state.yielded = true; setRootStatusAttr('yielded');
 return;
 }
 }
state.active = true;
 state.status = 'active';
 setRootStatusAttr('active');
 if (doc) {
if (doc.readyState === 'loading' && typeof doc.addEventListener === 'function') {
domReadyHandler = function () {
 if (!state.active || state.destroyed) return;
if (state.mode === 'auto') {
 var recheck = detectExternalLocalization(win, doc, { locale: locale });
 if (recheck.detected) {
 yieldAndRollback(recheck.reason || 'external-ui-zh', recheck.provider);
 return;
 }
 }
attachListenersAndObserver();
 };
doc.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
 } else {
attachListenersAndObserver();
 }
 }
 }
 boot(mode);
 var instance = {
 getStatus: function () {
 var modUnits = countTranslatedUnits();
 var isOffMode = state.mode === 'off';
 return {
 active: state.active, mode: state.mode, status: state.status, reason: state.reason,
 detectedProvider: state.detectedProvider, translatedCount: isOffMode ? 0 : modUnits,
 restoredCount: isOffMode ? modUnits : 0, blockedCount: isOffMode ? blockedElementsTracker.countActive() : 0, yielded: state.yielded,
 };
 },
 destroy: function () {
 teardownRuntime('off', 'destroyed', false, null, true);
 if (locale === 'tr' && doc && doc.documentElement && getAttr(doc.documentElement, 'lang') === 'tr') {
 try { if (initialHtmlLang === null) doc.documentElement.removeAttribute('lang'); else doc.documentElement.setAttribute('lang', initialHtmlLang); } catch (e) {}
 }
 },
 setMode: function (nextMode, forceReboot) {
 var norm = nextMode === 'on' || nextMode === 'off' ? nextMode : 'auto';
 if (
 !forceReboot &&
 !state.destroyed &&
 norm === state.mode &&
 ((norm === 'off' && state.active && (state.status === 'off-enforced' || state.status === 'off-blocked')) ||
 (norm !== 'off' && state.active && state.status === 'active'))
 ) {
 return instance.getStatus();
 }
 teardownRuntime('off', 'mode-switch', false, null, false);
 boot(norm);
 return instance.getStatus();
 },
 scan: function () {
 if (state.active && !state.destroyed) {
 if (!isPaused() && hibernating) {
wakeFromHibernation();
 } else if (!isPaused()) {
 safeFullScan();
 } else if (!(doc && doc.hidden === true)) {
 safeFullScan();
 disconnectObserver();
 }
 }
 return instance.getStatus();
 },
 };
 if (win) {
 win.__agPrismHostI18n = instance;
 }
 return instance;
 }
 return {
 createHostI18nEngine: createHostI18nEngine,
 mountHostI18n: mountHostI18n,
 detectExternalLocalization: detectExternalLocalization,
 detectLayer1External: detectLayer1External,
 detectLayer2ChromeZh: detectLayer2ChromeZh,
 isPrismOwnedElement: isPrismOwnedElement,
 isExternalOwnedElement: isExternalOwnedElement,
 isModelSelectorElement: isModelSelectorElement,
 isUserContentBoundary: isUserContentBoundary,
 isIgnoredBoundary: isIgnoredBoundary,
 measureSafeBoundaryDepth: measureSafeBoundaryDepth,
 isStepPlainTextAllowed: isStepPlainTextAllowed,
 looksLikeStepPathOrCmd: looksLikeStepPathOrCmd,
 };
 });
