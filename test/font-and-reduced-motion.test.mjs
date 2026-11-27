// Issue #98（自定义会话正文与代码字体）+ Issue #101（纯页内忽略系统 prefers-reduced-motion 开关）全链路单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createSettingsMiniDom } from './helpers/mini-dom.mjs';
import { collectNativePluginEntries } from '../scripts/build-common.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');

const cdp = require(path.join(ROOT, 'cdp.js'));
const rmGuard = require(path.join(ROOT, 'src', 'runtime', 'reduced-motion-guard.js'));
const fontCustomizer = require(path.join(ROOT, 'src', 'runtime', 'font-customizer.js'));
const i18nExt = require(path.join(ROOT, 'src', 'runtime', 'i18n-ext-beta4.js'));
const settingsExt = require(path.join(ROOT, 'src', 'runtime', 'settings-ext-beta4.js'));
const settingsPanel = require(path.join(ROOT, 'settings-panel.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));
const motionEngine = require(path.join(ROOT, 'motion-engine.js'));
const pulseVialBridge = require(path.join(ROOT, 'pulse-vial-bridge.js'));

const CANONICAL_9_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'tr'];
const NON_CJK_LOCALES = ['en', 'ko', 'es', 'fr', 'de', 'tr'];
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const FORBIDDEN_TERM_RE = /八方旅人|octopath/i;

function createFakeDom(initialHtmlAttrs = {}) {
  const mkNode = (tag) => {
    const attrs = new Map();
    const listeners = new Map();
    const kids = [];
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      value: '',
      hidden: false,
      style: {
        setProperty(k, v) { this[k] = String(v); },
        removeProperty(k) { delete this[k]; },
      },
      dataset: {},
      children: kids,
      parentNode: null,
      parentElement: null,
      get firstChild() { return kids[0] || null; },
      get nextSibling() {
        const p = this.parentNode;
        if (!p) return null;
        const idx = p.children.indexOf(this);
        return idx >= 0 ? p.children[idx + 1] || null : null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') el.id = String(v);
        if (k === 'hidden') el.hidden = true;
      },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'hidden') el.hidden = false;
      },
      appendChild(c) {
        if (c.parentNode && c.parentNode !== el) c.remove();
        c.parentNode = el;
        c.parentElement = el;
        kids.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.remove();
        const idx = kids.indexOf(ref);
        c.parentNode = el;
        c.parentElement = el;
        if (idx < 0) kids.push(c);
        else kids.splice(idx, 0, c);
        return c;
      },
      removeChild(c) {
        const idx = kids.indexOf(c);
        if (idx >= 0) kids.splice(idx, 1);
        c.parentNode = null;
        c.parentElement = null;
        return c;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(ev) {
        for (const fn of [...(listeners.get(ev.type) || [])]) fn(ev);
        return true;
      },
      querySelectorAll(sel) {
        const parts = String(sel || '').split(',').map((s) => s.trim()).filter(Boolean);
        const out = [];
        const walk = (n) => {
          for (const ch of n.children || []) {
            const hit = parts.some((p) => {
              if (p.startsWith('#')) return ch.id === p.slice(1);
              if (p.startsWith('[') && p.endsWith(']')) {
                const m = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(p);
                return Boolean(m && (m[2] !== undefined ? ch.getAttribute(m[1]) === m[2] : ch.hasAttribute(m[1])));
              }
              return false;
            });
            if (hit) out.push(ch);
            walk(ch);
          }
        };
        walk(el);
        return out;
      },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    };
    return el;
  };

  const html = mkNode('html');
  const head = mkNode('head');
  const body = mkNode('body');
  for (const [k, v] of Object.entries(initialHtmlAttrs)) html.setAttribute(k, v);
  html.appendChild(head);
  html.appendChild(body);
  const docListeners = new Map();
  const doc = {
    documentElement: html,
    head,
    body,
    createElement: (t) => mkNode(t),
    getElementById: (id) => html.querySelector('#' + id),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener(t, fn) {
      if (!docListeners.has(t)) docListeners.set(t, new Set());
      docListeners.get(t).add(fn);
    },
    dispatchEvent(ev) {
      for (const fn of [...(docListeners.get(ev.type) || [])]) fn(ev);
      return true;
    },
  };
  return { doc, html, head, body };
}

test('Issue #98 + #101 Schema contract: defaults, validators, maxLength=160, and config.example.json alignment', () => {
  assert.equal(cdp.DEFAULT_CONFIG.ignoreReducedMotion, false);
  assert.equal(cdp.DEFAULT_CONFIG.chatFont, 'default');
  assert.equal(cdp.DEFAULT_CONFIG.chatFontCustom, '');
  assert.equal(cdp.DEFAULT_CONFIG.codeFont, 'default');
  assert.equal(cdp.DEFAULT_CONFIG.codeFontCustom, '');

  assert.equal(cdp.VALIDATORS.ignoreReducedMotion, 'boolean');
  assert.deepEqual(cdp.VALIDATORS.chatFont, ['default', 'system-sans', 'noto-sans', 'inter', 'harmony', 'custom']);
  assert.equal(cdp.VALIDATORS.chatFontCustom, 'string');
  assert.deepEqual(cdp.VALIDATORS.codeFont, ['default', 'jetbrains', 'cascadia', 'sfmono', 'custom']);
  assert.equal(cdp.VALIDATORS.codeFontCustom, 'string');

  assert.equal(cdp.validateConfigEntry('ignoreReducedMotion', true), true);
  assert.equal(cdp.validateConfigEntry('ignoreReducedMotion', false), true);
  assert.equal(cdp.validateConfigEntry('chatFont', 'harmony'), true);
  assert.equal(cdp.validateConfigEntry('chatFont', 'custom'), true);
  assert.equal(cdp.validateConfigEntry('chatFont', 'comic-invalid'), false);
  assert.equal(cdp.validateConfigEntry('codeFont', 'custom'), true);
  assert.equal(cdp.validateConfigEntry('chatFontCustom', 'LXGW WenKai, Inter'), true);
  assert.equal(cdp.validateConfigEntry('chatFontCustom', 'A'.repeat(160)), true);
  assert.equal(cdp.validateConfigEntry('chatFontCustom', 'A'.repeat(161)), false);
  assert.equal(cdp.validateConfigEntry('chatFontCustom', 'Bad\nLine'), false);
  assert.equal(cdp.validateConfigEntry('codeFontCustom', 42), false);

  const exampleCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  assert.equal(exampleCfg.ignoreReducedMotion, false);
  assert.equal(exampleCfg.chatFont, 'default');
  assert.equal(exampleCfg.chatFontCustom, '');
  assert.equal(exampleCfg.codeFontCustom, '');
});

test('Issue #98 CSS injection sanitizer blocks all malicious payloads and preserves safe Unicode/CJK font stacks', () => {
  const maliciousPayloads = [
    'Evil; } body { display: none !important; }',
    'url(https://evil.example/a.woff2)',
    'expression(alert(1))',
    '@import url("https://evil.example/x.css")',
    'Foo </style><script>alert(1)</script>',
    'Bad\\22Font',
    'Line1\nLine2',
    'Line1\rLine2',
    'Bad"Inner"Quote',
    'Bad(Paren)',
    'javascript:alert(1)',
    'inherit',
    'initial',
  ];

  for (const payload of maliciousPayloads) {
    const out = fontCustomizer.sanitizeFontFamilyInput(payload, 'chat');
    assert.equal(out, '', `Malicious payload must be rejected completely: ${payload}`);
    assert.equal(/[;{}()\\<>]|@import|expression\(|url\(/i.test(out), false);
  }

  // Mixed input: keeps valid Unicode/CJK names and strips injected segments
  const mixed = fontCustomizer.sanitizeFontFamilyInput(
    '"LXGW WenKai", Evil; } body{background:red}, \'PingFang SC\', @import "x", Noto Sans JP 2.0',
    'chat'
  );
  assert.ok(mixed.startsWith('"LXGW WenKai", "PingFang SC", "Noto Sans JP 2.0", '));
  assert.ok(mixed.includes('sans-serif'), 'Chat stack must append sans-serif fallback');
  assert.equal(/Evil|@import|background|;|\{|\}/.test(mixed), false);

  const codeStack = fontCustomizer.sanitizeFontFamilyInput('Maple Mono NF CN, Fira Code', 'code');
  assert.ok(codeStack.startsWith('"Maple Mono NF CN", "Fira Code", '));
  assert.ok(codeStack.includes('monospace'), 'Code stack must append monospace fallback');
  assert.equal(codeStack.includes('var(--editor-font-family'), false, 'Code fallback must not create CSS var cycle');
});

test('Issue #98 scoped <style id="ag-prism-custom-fonts-style"> isolates body vs code, preserves codicon & ligatures, and cleans up cleanly', () => {
  const { doc, html } = createFakeDom({ 'data-ag-cs-style': '1' });

  // 1) Default -> zero style element injected
  const resDef = fontCustomizer.applyCustomFonts({ chatFont: 'default', chatFontCustom: '', codeFont: 'default', codeFontCustom: '' }, doc);
  assert.equal(resDef.active, false);
  assert.equal(doc.getElementById(fontCustomizer.STYLE_ID), null);

  // 2) Custom chat font + custom code font
  const resCustom = fontCustomizer.applyCustomFonts(
    {
      chatFont: 'custom',
      chatFontCustom: 'LXGW WenKai, PingFang SC',
      codeFont: 'custom',
      codeFontCustom: 'Maple Mono, JetBrains Mono',
    },
    doc
  );
  assert.equal(resCustom.active, true);
  assert.equal(html.getAttribute('data-ag-cs-chat-font'), 'custom');
  const styleEl = doc.getElementById(fontCustomizer.STYLE_ID);
  assert.ok(styleEl, 'Managed custom fonts <style> must be mounted');
  const css = styleEl.textContent;
  assert.ok(css.includes('"LXGW WenKai", "PingFang SC"'));
  assert.ok(css.includes('"Maple Mono", "JetBrains Mono"'));
  assert.ok(css.includes('[data-testid="conversation-view"]'), 'Chat font must target conversation messages');
  assert.ok(css.includes('[data-testid="agent-input-box"]'), 'Chat font must target composer input');
  assert.ok(css.includes('var(--ag-cs-mono-stack) !important'), 'Chat font rules must protect pre/code monospace stack');
  assert.ok(css.includes('font-variant-ligatures:var(--_fvl) !important'), 'Code font must preserve codeLigatures integration');
  assert.equal(css.includes('.codicon'), false, 'Must never override codicon icon font');
  assert.equal(css.includes('* {') || css.includes('*{'), false, 'Must never apply universal wildcard font override');

  // 3) Reset back to default -> removes <style> & root attr with zero residue
  const resReset = fontCustomizer.applyCustomFonts({ chatFont: 'default', chatFontCustom: '', codeFont: 'default', codeFontCustom: '' }, doc);
  assert.equal(resReset.active, false);
  assert.equal(doc.getElementById(fontCustomizer.STYLE_ID), null);
  assert.equal(html.hasAttribute('data-ag-cs-chat-font'), false);
});

test('Issue #98 listLocalFontFamilies is strictly opt-in, deduplicates/sorts, and degrades silently on unsupported or denied', async () => {
  // Unsupported host
  const resNoApi = await fontCustomizer.listLocalFontFamilies({});
  assert.equal(resNoApi.ok, false);
  assert.equal(resNoApi.supported, false);
  assert.deepEqual(resNoApi.families, []);

  // Permission denied
  const resDenied = await fontCustomizer.listLocalFontFamilies({
    queryLocalFonts: async () => { throw new Error('Permission denied'); },
  });
  assert.equal(resDenied.ok, false);
  assert.equal(resDenied.supported, true);
  assert.equal(resDenied.denied, true);

  // Success with deduplication, sorting, and unsafe-name filtering
  const resOk = await fontCustomizer.listLocalFontFamilies({
    queryLocalFonts: async () => [
      { family: 'JetBrains Mono' },
      { family: 'Inter' },
      { family: 'inter' },
      { family: 'Evil; } body{}' },
      { family: 'LXGW WenKai' },
    ],
  });
  assert.equal(resOk.ok, true);
  assert.deepEqual(resOk.families, ['Inter', 'JetBrains Mono', 'LXGW WenKai']);
});

test('Issue #101 in-page ignoreReducedMotion honors motionLevel="off" top priority, dispatches live event, and syncs across runtime modules with 0 Emulation.*', () => {
  const { doc, html } = createFakeDom({ 'data-ag-cs-motion': 'ultra' });
  const winEvents = [];
  const win = {
    document: doc,
    matchMedia: () => ({ matches: true }),
    dispatchEvent(ev) { winEvents.push(ev); return true; },
  };
  doc.defaultView = win;

  // 1) Default (ignoreReducedMotion=false): honors system prefers-reduced-motion: reduce
  assert.equal(rmGuard.isReducedMotion(doc, win), true);

  // 2) Enable ignoreReducedMotion=true: ignores system prefers-reduced-motion and fires ag-prism-rm-change
  rmGuard.applyIgnoreReducedMotion(true, doc, win);
  assert.equal(html.getAttribute('data-ag-cs-ignore-rm'), '1');
  assert.equal(rmGuard.isReducedMotion(doc, win), false);
  assert.equal(winEvents.length, 1);
  assert.equal(winEvents[0].type, 'ag-prism-rm-change');
  assert.equal(winEvents[0].detail.ignoreReducedMotion, true);
  assert.equal(winEvents[0].detail.reduced, false);

  // 3) motionLevel === 'off' ALWAYS takes highest precedence even when ignoreReducedMotion=true!
  html.setAttribute('data-ag-cs-motion', 'off');
  assert.equal(rmGuard.isReducedMotion(doc, win), true, 'motionLevel="off" must override ignoreReducedMotion=true');

  // 4) Switch back to standard -> resumes ignoring system reduced motion
  html.setAttribute('data-ag-cs-motion', 'standard');
  assert.equal(rmGuard.isReducedMotion(doc, win), false);

  // 5) Toggle off -> removes attribute and respects system again
  rmGuard.applyIgnoreReducedMotion(false, doc, win);
  assert.equal(html.hasAttribute('data-ag-cs-ignore-rm'), false);
  assert.equal(rmGuard.isReducedMotion(doc, win), true);
  assert.equal(winEvents.length, 2);

  // 6) motion-engine.js obeys data-ag-cs-ignore-rm & motion=off priority
  const prevDoc = globalThis.document;
  const prevMatch = globalThis.matchMedia;
  const prevGuard = globalThis.__agPrismReducedMotion;
  globalThis.document = doc;
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.__agPrismReducedMotion = rmGuard.isReducedMotion;
  try {
    html.setAttribute('data-ag-cs-motion', 'ultra');
    assert.equal(motionEngine.getMotionTier(), 'off');
    rmGuard.applyIgnoreReducedMotion(true, doc, win);
    assert.equal(motionEngine.getMotionTier(), 'ultra');
    html.setAttribute('data-ag-cs-motion', 'off');
    assert.equal(motionEngine.getMotionTier(), 'off');
  } finally {
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatch;
    if (prevGuard === undefined) delete globalThis.__agPrismReducedMotion;
    else globalThis.__agPrismReducedMotion = prevGuard;
  }

  // 7) pulse-vial-bridge.js obeys __agPrismReducedMotion & data-ag-cs-ignore-rm
  const pvWin = {
    document: doc,
    matchMedia: () => ({ matches: true }),
    __agPrismReducedMotion: () => rmGuard.isReducedMotion(doc, pvWin),
    addEventListener() {},
    removeEventListener() {},
  };
  html.setAttribute('data-ag-cs-motion', 'ultra');
  html.removeAttribute('data-ag-cs-ignore-rm');
  const pvInst = pulseVialBridge.mountPulseVialBridge({ win: pvWin, doc, autoPoll: false, allowMultiple: true });
  assert.equal(pvInst.getDebugState().motionTier, 'off');
  html.setAttribute('data-ag-cs-ignore-rm', '1');
  assert.equal(pvInst.getDebugState().motionTier, 'ultra');
  html.setAttribute('data-ag-cs-motion', 'off');
  assert.equal(pvInst.getDebugState().motionTier, 'off');
  pvInst.destroy();

  // 8) Verify style.css @media (prefers-reduced-motion:reduce) has :root:not([data-ag-cs-ignore-rm="1"]) guard
  const cssText = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(
    cssText.includes('@media (prefers-reduced-motion:reduce){:root:not([data-ag-cs-ignore-rm="1"]){'),
    'style.css prefers-reduced-motion block must be guarded by :root:not([data-ag-cs-ignore-rm="1"])'
  );

  // 9) Zero CDP Emulation.* references across src/runtime/
  for (const name of ['reduced-motion-guard.js', 'font-customizer.js', 'i18n-ext-beta4.js', 'settings-ext-beta4.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'runtime', name), 'utf8');
    assert.equal(/Emulation\./i.test(src), false, `${name} must never reference CDP Emulation.*`);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/.test(src), false, `${name} must have 0 HTML sink usage`);
    assert.equal(FORBIDDEN_TERM_RE.test(src), false, `${name} must contain 0 forbidden terms`);
  }
});

test('9-locale i18n-ext-beta4 completeness: 0 CJK leakage in non-CJK locales, 0 yue, 0 forbidden terms', () => {
  assert.deepEqual([...i18nExt.LOCALES], CANONICAL_9_LOCALES);
  const keys = Object.keys(i18nExt.TABLE);
  assert.ok(keys.length >= 16);

  for (const k of keys) {
    assert.equal(i18nExt.TABLE[k].length, 9, `Key ${k} must have exactly 9 locale entries`);
  }

  for (const loc of CANONICAL_9_LOCALES) {
    const dict = i18nExt.getStrings(loc);
    for (const k of keys) {
      assert.ok(typeof dict[k] === 'string' && dict[k].trim().length > 0, `i18n-ext-beta4[${loc}].${k} must be non-empty`);
      assert.equal(FORBIDDEN_TERM_RE.test(dict[k]), false, `Forbidden term in ${loc}.${k}`);
      if (NON_CJK_LOCALES.includes(loc)) {
        assert.equal(CJK_RE.test(dict[k]), false, `CJK char leaked into non-CJK locale ${loc}.${k}: "${dict[k]}"`);
      }
    }
  }
  assert.equal(i18nExt.normalizeLocale('yue'), 'zh-CN');
  assert.equal(i18nExt.normalizeLocale('tr-TR'), 'tr');
});

test('Settings panel beta.4 extension mounts ignoreReducedMotion, chatFont & codeFont custom controls with opt-in local font probe and live persistence', async () => {
  const { doc } = createSettingsMiniDom();
  const state = {
    ...settingsPanel.getDefaultSettingsPatch(),
    language: 'zh-CN',
    ignoreReducedMotion: false,
    chatFont: 'default',
    chatFontCustom: '',
    codeFont: 'default',
    codeFontCustom: '',
  };
  const savedCalls = [];
  let localFontCalls = 0;

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevI18nExt = globalThis.__agPrismI18nExtBeta4;
  const prevSetExt = globalThis.__agPrismSettingsExtBeta4;
  const prevFc = globalThis.__agPrismFontCustomizer;
  const prevApplyRm = globalThis.__agPrismApplyIgnoreReducedMotion;

  const fakeWin = {
    document: doc,
    matchMedia: () => ({ matches: true }),
    queryLocalFonts: async () => {
      localFontCalls += 1;
      return [{ family: 'LXGW WenKai' }, { family: 'Maple Mono' }];
    },
    __agPrismFontCustomizer: fontCustomizer,
    __agPrismApplyIgnoreReducedMotion: (flag) => rmGuard.applyIgnoreReducedMotion(flag, doc, fakeWin),
  };
  doc.defaultView = fakeWin;
  globalThis.document = doc;
  globalThis.window = fakeWin;
  globalThis.__agPrismI18nExtBeta4 = i18nExt;
  globalThis.__agPrismSettingsExtBeta4 = settingsExt;
  globalThis.__agPrismFontCustomizer = fontCustomizer;
  globalThis.__agPrismApplyIgnoreReducedMotion = fakeWin.__agPrismApplyIgnoreReducedMotion;

  try {
    const syncPanel = () => {
      settingsPanel.mountOrSyncSettingsSection({
        version: cdp.PLUGIN_VERSION,
        lazyFold: false,
        getLang: () => state.language,
        uiText: (l) => i18nLocales.getUiStrings(l),
        isZh: () => state.language === 'zh-CN' || state.language === 'zh-TW',
        i18nCore,
        formatSettingsSummary: () => 'summary',
        resolveSettingRowActiveValue: (k) => state[k],
        isSettingButtonMatch: (k, valJson, cur) => JSON.stringify(cur) === valJson,
        saveSetting: (k, v) => {
          state[k] = v;
          savedCalls.push([k, v]);
        },
        saveSettingsBatch: (patch) => {
          Object.assign(state, patch);
          savedCalls.push(['batch', { ...patch }]);
        },
        getThoughtTranslateMode: () => 'off',
        handledGroupClicks: new WeakSet(),
        runSettingsGroupGlide: () => {},
        runGuardedMut: (fn) => fn(),
      });
    };

    syncPanel();
    const sec = doc.getElementById('ag-cs-settings-sec');
    assert.ok(sec, 'Settings section must mount');
    // Must NEVER auto-probe local fonts on panel mount
    assert.equal(localFontCalls, 0, 'Must never call queryLocalFonts() automatically on mount');

    // 1) ignoreReducedMotion row exists and toggles live + persists
    const rmRow = sec.querySelector('[data-ag-cs-row="ignoreReducedMotion"]');
    assert.ok(rmRow, 'ignoreReducedMotion row must mount in motion group');
    const rmOnBtn = rmRow.querySelector('button[data-ag-cs-ext-role="on"]');
    assert.ok(rmOnBtn);
    rmOnBtn.click();
    assert.equal(state.ignoreReducedMotion, true);
    assert.equal(doc.documentElement.getAttribute('data-ag-cs-ignore-rm'), '1');

    // 2) chatFont select + custom input + opt-in local font button + reset
    const chatRow = sec.querySelector('[data-ag-cs-row="chatFont"]');
    assert.ok(chatRow, 'chatFont row must mount in typography/interaction group');
    const chatSel = chatRow.querySelector('select[data-ag-cs-ext-select="chatFont"]');
    assert.ok(chatSel);
    chatSel.value = 'custom';
    chatSel.dispatchEvent({ type: 'change' });
    assert.equal(state.chatFont, 'custom');

    const chatLoadBtn = chatRow.querySelector('button[data-ag-cs-ext-action="load-local-fonts"]');
    assert.ok(chatLoadBtn);
    chatLoadBtn.click();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(localFontCalls, 1, 'queryLocalFonts() must trigger only when user clicks load button');

    const chatInp = chatRow.querySelector('input[data-ag-cs-ext-input="chatFontCustom"]');
    chatInp.value = 'LXGW WenKai';
    chatInp.dispatchEvent({ type: 'change' });
    assert.equal(state.chatFontCustom, 'LXGW WenKai');
    assert.ok(doc.getElementById(fontCustomizer.STYLE_ID)?.textContent.includes('"LXGW WenKai"'));

    const chatResetBtn = chatRow.querySelector('button[data-ag-cs-ext-action="reset-chat-font"]');
    chatResetBtn.click();
    assert.equal(state.chatFont, 'default');
    assert.equal(state.chatFontCustom, '');

    // 3) codeFont custom button + custom input + reset
    const codeRow = sec.querySelector('[data-ag-cs-row="codeFont"]');
    const codeCustomBtn = codeRow.querySelector('button[data-ag-cs-code-custom="1"]');
    assert.ok(codeCustomBtn, 'codeFont row must have Custom button appended');
    codeCustomBtn.click();
    assert.equal(state.codeFont, 'custom');

    const codeInp = codeRow.querySelector('input[data-ag-cs-ext-input="codeFontCustom"]');
    codeInp.value = 'Maple Mono';
    codeInp.dispatchEvent({ type: 'change' });
    assert.equal(state.codeFontCustom, 'Maple Mono');
    assert.ok(doc.getElementById(fontCustomizer.STYLE_ID)?.textContent.includes('"Maple Mono"'));

    // 4) Live in-place language switch updates all extension labels cleanly (without remounting DOM)
    state.language = 'en';
    settingsExt.sync(sec, {
      doc,
      win: fakeWin,
      lang: 'en',
      ui: i18nLocales.getUiStrings('en'),
      effVal: (k) => state[k],
      saveSetting: (k, v) => { state[k] = v; savedCalls.push([k, v]); },
      saveSettingsBatch: (patch) => { Object.assign(state, patch); savedCalls.push(['batch', { ...patch }]); },
      runGuardedMut: (fn) => fn(),
    });
    assert.equal(
      sec.querySelector('[data-ag-cs-row="ignoreReducedMotion"]').querySelector('[data-k="t"]').textContent,
      'Ignore System Reduced Motion'
    );
    assert.equal(
      sec.querySelector('[data-ag-cs-row="chatFont"]').querySelector('[data-k="t"]').textContent,
      'Chat Body Font'
    );
    assert.ok(savedCalls.length >= 4);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    if (prevI18nExt === undefined) delete globalThis.__agPrismI18nExtBeta4; else globalThis.__agPrismI18nExtBeta4 = prevI18nExt;
    if (prevSetExt === undefined) delete globalThis.__agPrismSettingsExtBeta4; else globalThis.__agPrismSettingsExtBeta4 = prevSetExt;
    if (prevFc === undefined) delete globalThis.__agPrismFontCustomizer; else globalThis.__agPrismFontCustomizer = prevFc;
    if (prevApplyRm === undefined) delete globalThis.__agPrismApplyIgnoreReducedMotion; else globalThis.__agPrismApplyIgnoreReducedMotion = prevApplyRm;
  }
});

test('Ch1 / Ch9 / configRefresh budgets, live incremental refresh, full teardown, and packaging coverage', () => {
  // 1) Budgets
  const ch1AutoBytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }, { noDiskCache: true }), 'utf8');
  assert.ok(ch1AutoBytes < 390000, `Ch1 auto (${ch1AutoBytes} B) must stay < 390,000 B`);
  const ch9Expr = cdp.buildSettingsChannelExpression(null, { noDiskCache: true });
  const ch9Bytes = Buffer.byteLength(ch9Expr, 'utf8');
  assert.ok(ch9Bytes < 512000, `Ch9 settings (${ch9Bytes} B) must stay < 512,000 B`);
  assert.ok(ch9Expr.includes('__agPrismI18nExtBeta4') && ch9Expr.includes('__agPrismSettingsExtBeta4'));

  const refreshExpr = cdp.buildConfigRefreshExpression({
    ignoreReducedMotion: true,
    chatFont: 'custom',
    chatFontCustom: 'Inter',
    codeFont: 'custom',
    codeFontCustom: 'Maple Mono',
  });
  const refreshBytes = Buffer.byteLength(refreshExpr, 'utf8');
  assert.ok(refreshBytes < 4096, `configRefresh (${refreshBytes} B) must stay < 4,096 B`);

  // 2) Live incremental configRefresh execution applies ignoreReducedMotion & custom fonts
  const { doc, html } = createFakeDom({ 'data-ag-cs-style': '1' });
  const applied = { rm: null, fontCfg: null };
  const codeHash = cdp.buildConfigRefreshExpression({ palette: 'warm' }).match(/"codeHash":"([^"]+)"/)?.[1] || '';
  const refSandbox = {
    document: doc,
    window: null,
    globalThis: null,
    navigator: { language: 'en' },
  };
  refSandbox.window = {
    __agPrism: {
      version: cdp.PLUGIN_VERSION,
      codeHash,
      refreshConfig(next) { this._cfg = next; return true; },
      getState() { return { cfg: this._cfg }; },
    },
    __agPrismApplyIgnoreReducedMotion: (v) => { applied.rm = v; rmGuard.applyIgnoreReducedMotion(v, doc, refSandbox.window); },
    __agPrismFontCustomizer: { applyCustomFonts: (c, d) => { applied.fontCfg = c; fontCustomizer.applyCustomFonts(c, d); } },
  };
  refSandbox.globalThis = refSandbox.window;
  const refRes = vm.runInNewContext(refreshExpr, refSandbox);
  assert.equal(refRes.refreshed, true);
  assert.equal(applied.rm, true);
  assert.equal(html.getAttribute('data-ag-cs-ignore-rm'), '1');
  assert.equal(applied.fontCfg.chatFontCustom, 'Inter');
  assert.equal(applied.fontCfg.codeFontCustom, 'Maple Mono');
  assert.ok(doc.getElementById(fontCustomizer.STYLE_ID));

  // 3) Full REMOVE_EXPRESSION teardown removes all new globals, <style> tags, and root attributes
  const remWin = {
    document: doc,
    __agPrismReducedMotion: rmGuard.isReducedMotion,
    __agPrismApplyIgnoreReducedMotion: rmGuard.applyIgnoreReducedMotion,
    __agPrismReducedMotionGuard: rmGuard,
    __agPrismFontCustomizer: fontCustomizer,
    __agPrismI18nExtBeta4: i18nExt,
    __agPrismSettingsExtBeta4: settingsExt,
  };
  remWin.window = remWin;
  remWin.globalThis = remWin;
  const extCss = doc.createElement('style');
  extCss.id = settingsExt.STYLE_ID;
  doc.head.appendChild(extCss);
  vm.runInNewContext(cdp.REMOVE_EXPRESSION, remWin);
  assert.equal(doc.getElementById(fontCustomizer.STYLE_ID), null);
  assert.equal(doc.getElementById(settingsExt.STYLE_ID), null);
  assert.equal(html.hasAttribute('data-ag-cs-ignore-rm'), false);
  assert.equal(html.hasAttribute('data-ag-cs-chat-font'), false);
  for (const k of [
    '__agPrismReducedMotion',
    '__agPrismApplyIgnoreReducedMotion',
    '__agPrismReducedMotionGuard',
    '__agPrismFontCustomizer',
    '__agPrismI18nExtBeta4',
    '__agPrismSettingsExtBeta4',
  ]) {
    assert.equal(remWin[k], undefined, `REMOVE_EXPRESSION must clean global ${k}`);
  }

  // 4) Packaging automatically includes all 4 src/runtime/*.js modules
  const nativeEntries = new Set(collectNativePluginEntries().map((e) => e.name));
  for (const f of [
    'native-plugin/src/runtime/reduced-motion-guard.js',
    'native-plugin/src/runtime/font-customizer.js',
    'native-plugin/src/runtime/i18n-ext-beta4.js',
    'native-plugin/src/runtime/settings-ext-beta4.js',
  ]) {
    assert.ok(nativeEntries.has(f), `Packaging missing ${f}`);
  }
});
