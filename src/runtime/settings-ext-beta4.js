// Beta.4 设置面板独立扩展模块（Issue #98 自定义正文/代码字体 + Issue #101 忽略系统减弱动效）
// 严格遵循 0 HTML-sink 写入规范，按需挂载于 Ch9 设置面板，不挤占老文件棘轮
(function (root, factory) {
  const api = factory(root);
  if (root) root.__agPrismSettingsExtBeta4 = api;
  if (typeof window !== 'undefined' && window && window !== root) {
    window.__agPrismSettingsExtBeta4 = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function (G) {
  'use strict';

  const STYLE_ID = 'ag-prism-settings-ext-beta4-css';
  const DATALIST_ID = 'ag-prism-local-fonts-list';
  const PERF_MODES = Object.freeze(['performance', 'balanced', 'quality']);
  const PERF_MODE_OPT_KEYS = Object.freeze({
    performance: 'optPerfPerformance',
    balanced: 'optPerfBalanced',
    quality: 'optPerfQuality',
  });
  const QUOTA_MODES = Object.freeze(['compact', 'both']);
  const QUOTA_MODE_OPT_KEYS = Object.freeze({
    compact: 'optQuotaCompact',
    both: 'optQuotaBoth',
  });
  const CHAT_FONT_MODES = Object.freeze(['default', 'system-sans', 'noto-sans', 'inter', 'harmony', 'custom']);
  const CHAT_FONT_OPT_KEYS = Object.freeze({
    default: 'optChatFontDefault',
    'system-sans': 'optChatFontSystemSans',
    'noto-sans': 'optChatFontNotoSans',
    inter: 'optChatFontInter',
    harmony: 'optChatFontHarmony',
    custom: 'optFontCustom',
  });

  const EXT_CSS = [
    '.ag-cs-font-select{min-width:148px;max-width:210px;height:28px;padding:0 8px;border-radius:var(--ag-cs-r-sm,6px);border:1px solid var(--ag-cs-border-1,rgba(148,163,184,.26));background-color:var(--ag-cs-tonal-2,#13161E);color:var(--foreground,#F2F2F5);font-size:12px;font-weight:500;outline:0;cursor:pointer;}',
    '.ag-cs-font-select option{background-color:var(--ag-cs-tonal-2,#13161E);color:var(--foreground,#F2F2F5);}',
    'html[data-ag-cs-theme="light"] .ag-cs-font-select,html[data-ag-cs-theme="light"] .ag-cs-font-select option{background-color:#FFFFFF;color:#0F172A;border-color:rgba(15,23,42,.18);}',
    '.ag-cs-font-custom-box{margin:0 0 10px;padding:8px 10px;border-radius:8px;border:1px solid var(--ag-cs-border-1,rgba(148,163,184,.22));background:var(--ag-cs-tonal-1,rgba(148,163,184,.06));display:flex;flex-direction:column;gap:6px;}',
    '.ag-cs-font-custom-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
    '.ag-cs-font-input{flex:1 1 200px;min-width:140px;height:28px;padding:0 9px;border-radius:6px;border:1px solid var(--ag-cs-border-1,rgba(148,163,184,.28));background:var(--ag-cs-tonal-0,rgba(0,0,0,.22));color:var(--foreground,#F2F2F5);font-size:12px;outline:0;}',
    'html[data-ag-cs-theme="light"] .ag-cs-font-input{background:#FFFFFF;color:#0F172A;border-color:rgba(15,23,42,.18);}',
    '.ag-cs-font-input:focus{border-color:var(--primary,#669DF6);}',
    '.ag-cs-font-act-btn{height:28px;padding:0 9px;border-radius:6px;border:1px solid var(--ag-cs-border-1,rgba(148,163,184,.28));background:var(--ag-cs-tonal-3,rgba(148,163,184,.12));color:var(--foreground,#F2F2F5);font-size:11.5px;font-weight:500;cursor:pointer;white-space:nowrap;}',
    'html[data-ag-cs-theme="light"] .ag-cs-font-act-btn{background:#F1F5F9;color:#0F172A;border-color:rgba(15,23,42,.16);}',
    '.ag-cs-font-act-btn:hover{border-color:var(--primary,#669DF6);}',
    '.ag-cs-font-hint{font-size:11px;line-height:1.4;color:var(--muted-foreground,#94A3B8);}',
    '.ag-cs-font-hint[data-tone="warn"]{color:var(--warning,#F2B84B);}',
  ].join('\n');

  const sa = (el, k, v = '') => el && el.setAttribute && el.setAttribute(k, String(v));
  const ga = (el, k) => (el && el.getAttribute ? el.getAttribute(k) : null);
  const ra = (el, k) => el && el.removeAttribute && el.removeAttribute(k);
  const qs = (el, s) => (el && el.querySelector ? el.querySelector(s) : null);
  const mk = (doc, tag, cls, txt) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (txt !== undefined && txt !== null) el.textContent = String(txt);
    return el;
  };

  function getExtStrings(lang, baseUi) {
    const mod = G.__agPrismI18nExtBeta4 || (typeof window !== 'undefined' ? window.__agPrismI18nExtBeta4 : null);
    if (mod && typeof mod.mergeIntoUiStrings === 'function') {
      return mod.mergeIntoUiStrings(baseUi, lang);
    }
    return Object.assign({}, baseUi || {});
  }

  function ensureStyle(doc) {
    if (!doc || !doc.head) return;
    let st = typeof doc.getElementById === 'function' ? doc.getElementById(STYLE_ID) : null;
    if (!st) {
      st = doc.createElement('style');
      st.id = STYLE_ID;
      st.textContent = EXT_CSS;
      doc.head.appendChild(st);
    } else if (st.textContent !== EXT_CSS) {
      st.textContent = EXT_CSS;
    }
  }

  function ensureLocalFontDatalist(doc, rootEl) {
    let dl = typeof doc.getElementById === 'function' ? doc.getElementById(DATALIST_ID) : qs(rootEl, '#' + DATALIST_ID);
    if (!dl) {
      dl = doc.createElement('datalist');
      dl.id = DATALIST_ID;
      sa(dl, 'id', DATALIST_ID);
      (rootEl || doc.body || doc.documentElement).appendChild(dl);
    }
    return dl;
  }

  function populateDatalist(doc, dl, families) {
    if (!dl) return;
    while (dl.firstChild) dl.removeChild(dl.firstChild);
    for (let i = 0; i < families.length; i++) {
      const opt = doc.createElement('option');
      opt.value = families[i];
      sa(opt, 'value', families[i]);
      dl.appendChild(opt);
    }
  }

  function readLiveCfg(ctx, key, fallback) {
    try {
      if (typeof ctx.effVal === 'function') {
        const v = ctx.effVal(key, ctx.lang);
        if (v !== undefined && v !== null) return v;
      }
    } catch {}
    try {
      const st = (ctx.win || G).__agPrism?.getState?.();
      if (st && st.cfg && Object.prototype.hasOwnProperty.call(st.cfg, key)) {
        return st.cfg[key];
      }
    } catch {}
    return fallback;
  }

  function applyLiveFontPreview(win, doc, patch) {
    const fc = (win && win.__agPrismFontCustomizer) || G.__agPrismFontCustomizer;
    if (!fc || typeof fc.applyCustomFonts !== 'function') return;
    let curCfg = {};
    try {
      curCfg = (win || G).__agPrism?.getState?.()?.cfg || {};
    } catch {}
    fc.applyCustomFonts(Object.assign({}, curCfg, patch), doc);
  }

  function createCustomFontBox(doc, kind, ctx) {
    const customKey = kind === 'code' ? 'codeFontCustom' : 'chatFontCustom';
    const modeKey = kind === 'code' ? 'codeFont' : 'chatFont';
    const box = mk(doc, 'div', 'ag-cs-font-custom-box');
    sa(box, 'data-ag-cs-ext-custom', kind);

    const row = mk(doc, 'div', 'ag-cs-font-custom-row');
    const inp = mk(doc, 'input', 'ag-cs-font-input');
    inp.type = 'text';
    inp.maxLength = 160;
    sa(inp, 'type', 'text');
    sa(inp, 'maxlength', '160');
    sa(inp, 'list', DATALIST_ID);
    sa(inp, 'data-ag-cs-ext-input', customKey);

    const loadBtn = mk(doc, 'button', 'ag-cs-font-act-btn');
    loadBtn.type = 'button';
    sa(loadBtn, 'type', 'button');
    sa(loadBtn, 'data-ag-cs-ext-action', 'load-local-fonts');

    const resetBtn = mk(doc, 'button', 'ag-cs-font-act-btn');
    resetBtn.type = 'button';
    sa(resetBtn, 'type', 'button');
    sa(resetBtn, 'data-ag-cs-ext-action', kind === 'code' ? 'reset-code-font' : 'reset-chat-font');

    const hint = mk(doc, 'div', 'ag-cs-font-hint');
    sa(hint, 'data-ag-cs-ext-hint', kind);
    hint.hidden = true;
    sa(hint, 'hidden', '');

    row.appendChild(inp);
    row.appendChild(loadBtn);
    row.appendChild(resetBtn);
    box.appendChild(row);
    box.appendChild(hint);

    let saveTimer = null;
    const commitInput = (immediate) => {
      const raw = String(inp.value || '').slice(0, 160);
      const fc = (ctx.win && ctx.win.__agPrismFontCustomizer) || G.__agPrismFontCustomizer;
      const check = fc && typeof fc.sanitizeFontFamilyList === 'function' ? fc.sanitizeFontFamilyList(raw) : { hadRejected: false };
      if (check.hadRejected) {
        const s = box.__extStrings || {};
        hint.textContent = s.fontSanitizedNotice || 'Unsafe characters were stripped; only valid font family names are applied';
        sa(hint, 'data-tone', 'warn');
        hint.hidden = false;
        ra(hint, 'hidden');
      } else if (ga(hint, 'data-tone') === 'warn') {
        hint.textContent = '';
        hint.hidden = true;
        sa(hint, 'hidden', '');
        ra(hint, 'data-tone');
      }
      applyLiveFontPreview(ctx.win, doc, { [modeKey]: 'custom', [customKey]: raw });
      const persist = () => {
        if (typeof ctx.saveSetting === 'function') ctx.saveSetting(customKey, raw);
      };
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (immediate) persist();
      else saveTimer = setTimeout(persist, 180);
    };

    inp.addEventListener('input', () => commitInput(false));
    inp.addEventListener('change', () => commitInput(true));

    loadBtn.addEventListener('click', async (ev) => {
      ev?.stopPropagation?.();
      const s = box.__extStrings || {};
      const fc = (ctx.win && ctx.win.__agPrismFontCustomizer) || G.__agPrismFontCustomizer;
      hint.textContent = s.fontLocalLoading || 'Loading local fonts...';
      ra(hint, 'data-tone');
      hint.hidden = false;
      ra(hint, 'hidden');
      if (!fc || typeof fc.listLocalFontFamilies !== 'function') {
        hint.textContent = s.fontLocalUnsupported || 'Local font enumeration is unavailable here';
        return;
      }
      const res = await fc.listLocalFontFamilies(ctx.win);
      if (res && res.ok) {
        const dl = ensureLocalFontDatalist(doc, box.__extRootEl);
        populateDatalist(doc, dl, res.families);
        hint.textContent = String(s.fontLocalLoaded || 'Loaded {n} local fonts').replace('{n}', String(res.families.length));
      } else if (res && res.denied) {
        hint.textContent = s.fontLocalDenied || 'Font permission was declined; you can still enter font names manually';
      } else {
        hint.textContent = s.fontLocalUnsupported || 'Local font enumeration is unavailable here; type font names manually';
      }
    });

    resetBtn.addEventListener('click', (ev) => {
      ev?.stopPropagation?.();
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      inp.value = '';
      hint.textContent = '';
      hint.hidden = true;
      sa(hint, 'hidden', '');
      ra(hint, 'data-tone');
      applyLiveFontPreview(ctx.win, doc, { [modeKey]: 'default', [customKey]: '' });
      if (typeof ctx.saveSettingsBatch === 'function') {
        ctx.saveSettingsBatch({ [modeKey]: 'default', [customKey]: '' });
      } else if (typeof ctx.saveSetting === 'function') {
        ctx.saveSetting(modeKey, 'default');
        ctx.saveSetting(customKey, '');
      }
      if (typeof box.__extResync === 'function') box.__extResync();
    });

    return { box, inp, loadBtn, resetBtn, hint };
  }

  function normPerfMode(raw) {
    const bus = G.__agPrismDomBus || (typeof window !== 'undefined' ? window.__agPrismDomBus : null);
    if (bus && typeof bus.normalizePerformanceMode === 'function') return bus.normalizePerformanceMode(raw);
    const low = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (low === 'performance' || low === 'eco') return 'performance';
    if (low === 'quality') return 'quality';
    return 'balanced';
  }

  function ensurePerformanceModeRow(rootEl, doc, ctx) {
    let row = qs(rootEl, '[data-ag-cs-row="performanceMode"]');
    if (row) return row;
    const motionRow = qs(rootEl, '[data-ag-cs-row="motionLevel"]');
    if (!motionRow || !motionRow.parentElement) return null;

    row = mk(doc, 'div');
    sa(row, 'data-ag-cs-row', 'performanceMode');
    sa(row, 'data-ag-cs-ext-owned', '1');

    const inner = mk(doc, 'div', 'py-2');
    const textCol = mk(doc, 'div', 'flex-1');
    const titleLine = mk(doc, 'div', 'ag-cs-settings-title-line');
    const tSpan = mk(doc, 'span');
    sa(tSpan, 'data-k', 't');
    const dSpan = mk(doc, 'span', 'whitespace-pre-wrap');
    sa(dSpan, 'data-k', 'd');
    titleLine.appendChild(tSpan);
    textCol.appendChild(titleLine);
    textCol.appendChild(dSpan);

    const ctrlWrap = mk(doc, 'div', 'shrink-0');
    const grp = mk(doc, 'div', 'ag-cs-seg-group');
    sa(grp, 'role', 'group');

    const BTN_CLS = 'ag-cs-seg-btn data-[pressed]:bg-secondary data-[pressed]:text-foreground';
    for (let i = 0; i < PERF_MODES.length; i++) {
      const val = PERF_MODES[i];
      const btn = mk(doc, 'button', BTN_CLS);
      btn.type = 'button';
      sa(btn, 'type', 'button');
      sa(btn, 'data-ag-cs-ext-key', 'performanceMode');
      sa(btn, 'data-ag-cs-ext-val', JSON.stringify(val));
      sa(btn, 'data-ag-cs-ext-perf', val);
      btn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        const bus = (ctx.win && ctx.win.__agPrismDomBus) || G.__agPrismDomBus;
        if (bus && typeof bus.applyPerformanceMode === 'function') {
          bus.applyPerformanceMode(val, doc, ctx.win);
        } else if (doc && doc.documentElement) {
          try { if (doc.documentElement.dataset) doc.documentElement.dataset.agCsPerfMode = val; } catch {}
          sa(doc.documentElement, 'data-ag-cs-perf-mode', val);
        }
        if (typeof ctx.saveSetting === 'function') ctx.saveSetting('performanceMode', val);
        if (typeof row.__extResync === 'function') row.__extResync();
      });
      grp.appendChild(btn);
    }

    ctrlWrap.appendChild(grp);
    inner.appendChild(textCol);
    inner.appendChild(ctrlWrap);
    row.appendChild(inner);

    const parent = motionRow.parentElement;
    if (typeof parent.insertBefore === 'function') {
      parent.insertBefore(row, motionRow);
    } else {
      parent.appendChild(row);
    }
    return row;
  }

  function ensureIgnoreRmRow(rootEl, doc, ctx) {
    let row = qs(rootEl, '[data-ag-cs-row="ignoreReducedMotion"]');
    if (row) return row;
    const motionRow = qs(rootEl, '[data-ag-cs-row="motionLevel"]');
    if (!motionRow || !motionRow.parentElement) return null;

    row = mk(doc, 'div');
    sa(row, 'data-ag-cs-row', 'ignoreReducedMotion');
    sa(row, 'data-ag-cs-ext-owned', '1');

    const inner = mk(doc, 'div', 'py-2');
    const textCol = mk(doc, 'div', 'flex-1');
    const titleLine = mk(doc, 'div', 'ag-cs-settings-title-line');
    const tSpan = mk(doc, 'span');
    sa(tSpan, 'data-k', 't');
    const dSpan = mk(doc, 'span', 'whitespace-pre-wrap');
    sa(dSpan, 'data-k', 'd');
    titleLine.appendChild(tSpan);
    textCol.appendChild(titleLine);
    textCol.appendChild(dSpan);

    const ctrlWrap = mk(doc, 'div', 'shrink-0');
    const grp = mk(doc, 'div', 'ag-cs-seg-group');
    sa(grp, 'role', 'group');
    sa(grp, 'data-ui-kind', 'switch');
    sa(grp, 'data-switch-on', '0');

    const thumb = mk(doc, 'span', 'ag-cs-switch-thumb');
    sa(thumb, 'aria-hidden', 'true');
    grp.appendChild(thumb);

    const BTN_CLS = 'ag-cs-seg-btn data-[pressed]:bg-secondary data-[pressed]:text-foreground';
    for (const [val, roleTag] of [[true, 'on'], [false, 'off']]) {
      const btn = mk(doc, 'button', BTN_CLS);
      btn.type = 'button';
      sa(btn, 'type', 'button');
      sa(btn, 'data-ag-cs-ext-key', 'ignoreReducedMotion');
      sa(btn, 'data-ag-cs-ext-val', JSON.stringify(val));
      sa(btn, 'data-ag-cs-ext-role', roleTag);
      btn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        const applyFn = (ctx.win && ctx.win.__agPrismApplyIgnoreReducedMotion) || G.__agPrismApplyIgnoreReducedMotion;
        if (typeof applyFn === 'function') applyFn(val, doc, ctx.win);
        if (typeof ctx.saveSetting === 'function') ctx.saveSetting('ignoreReducedMotion', val);
        if (typeof row.__extResync === 'function') row.__extResync();
      });
      grp.appendChild(btn);
    }

    ctrlWrap.appendChild(grp);
    inner.appendChild(textCol);
    inner.appendChild(ctrlWrap);
    row.appendChild(inner);

    const parent = motionRow.parentElement;
    if (motionRow.nextSibling && typeof parent.insertBefore === 'function') {
      parent.insertBefore(row, motionRow.nextSibling);
    } else {
      parent.appendChild(row);
    }
    return row;
  }

  function ensureChatFontRow(rootEl, doc, ctx) {
    let row = qs(rootEl, '[data-ag-cs-row="chatFont"]');
    if (row) return row;
    const codeRow = qs(rootEl, '[data-ag-cs-row="codeFont"]');
    if (!codeRow || !codeRow.parentElement) return null;

    row = mk(doc, 'div');
    sa(row, 'data-ag-cs-row', 'chatFont');
    sa(row, 'data-ag-cs-ext-owned', '1');

    const inner = mk(doc, 'div', 'py-2');
    const textCol = mk(doc, 'div', 'flex-1');
    const titleLine = mk(doc, 'div', 'ag-cs-settings-title-line');
    const tSpan = mk(doc, 'span');
    sa(tSpan, 'data-k', 't');
    const dSpan = mk(doc, 'span', 'whitespace-pre-wrap');
    sa(dSpan, 'data-k', 'd');
    titleLine.appendChild(tSpan);
    textCol.appendChild(titleLine);
    textCol.appendChild(dSpan);

    const ctrlWrap = mk(doc, 'div', 'shrink-0');
    const sel = mk(doc, 'select', 'ag-cs-font-select');
    sa(sel, 'data-ag-cs-ext-select', 'chatFont');
    for (let i = 0; i < CHAT_FONT_MODES.length; i++) {
      const m = CHAT_FONT_MODES[i];
      const opt = mk(doc, 'option');
      opt.value = m;
      sa(opt, 'value', m);
      sel.appendChild(opt);
    }

    const customUi = createCustomFontBox(doc, 'chat', ctx);
    customUi.box.__extRootEl = rootEl;

    sel.addEventListener('change', () => {
      const val = String(sel.value || 'default');
      applyLiveFontPreview(ctx.win, doc, { chatFont: val, chatFontCustom: String(customUi.inp.value || '') });
      if (typeof ctx.saveSetting === 'function') ctx.saveSetting('chatFont', val);
      if (typeof row.__extResync === 'function') row.__extResync();
    });

    ctrlWrap.appendChild(sel);
    inner.appendChild(textCol);
    inner.appendChild(ctrlWrap);
    row.appendChild(inner);
    row.appendChild(customUi.box);
    row.__extCustomUi = customUi;
    row.__extSelect = sel;

    const parent = codeRow.parentElement;
    if (typeof parent.insertBefore === 'function') {
      parent.insertBefore(row, codeRow);
    } else {
      parent.appendChild(row);
    }
    return row;
  }

  function ensureCodeFontCustomExtension(rootEl, doc, ctx) {
    const codeRow = qs(rootEl, '[data-ag-cs-row="codeFont"]');
    if (!codeRow) return null;

    const grp = qs(codeRow, '.ag-cs-seg-group');
    let customBtn = grp ? qs(grp, 'button[data-ag-cs-code-custom="1"]') : null;
    if (grp && !customBtn) {
      customBtn = mk(doc, 'button', 'ag-cs-seg-btn data-[pressed]:bg-secondary data-[pressed]:text-foreground');
      customBtn.type = 'button';
      sa(customBtn, 'type', 'button');
      sa(customBtn, 'data-ag-cs-key', 'codeFont');
      sa(customBtn, 'data-ag-cs-val', '"custom"');
      sa(customBtn, 'data-ag-cs-code-custom', '1');
      sa(customBtn, 'data-ag-cs-ext-owned', '1');
      sa(customBtn, 'aria-pressed', 'false');
      customBtn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        const sibs = grp.querySelectorAll ? grp.querySelectorAll('button[data-ag-cs-key="codeFont"]') : [];
        for (let i = 0; i < sibs.length; i++) {
          const isCur = sibs[i] === customBtn;
          sibs[i].__agOn = isCur;
          sa(sibs[i], 'aria-pressed', isCur ? 'true' : 'false');
          if (isCur) sa(sibs[i], 'data-pressed');
          else ra(sibs[i], 'data-pressed');
        }
        const curCustom = String(codeRow.__extCustomUi?.inp?.value || '');
        applyLiveFontPreview(ctx.win, doc, { codeFont: 'custom', codeFontCustom: curCustom });
        if (typeof ctx.saveSetting === 'function') ctx.saveSetting('codeFont', 'custom');
        if (typeof codeRow.__extResync === 'function') codeRow.__extResync();
      });
      grp.appendChild(customBtn);
    }

    let customUi = codeRow.__extCustomUi || null;
    if (!customUi) {
      customUi = createCustomFontBox(doc, 'code', ctx);
      customUi.box.__extRootEl = rootEl;
      codeRow.appendChild(customUi.box);
      codeRow.__extCustomUi = customUi;
    }
    return { codeRow, customBtn, customUi };
  }

  function ensureTelemetryQuotaModeRow(rootEl, doc, ctx) {
    let row = qs(rootEl, '[data-ag-cs-row="telemetryQuotaMode"]');
    if (row) return row;
    const telRow = qs(rootEl, '[data-ag-cs-row="telemetryModule"]');
    if (!telRow || !telRow.parentElement) return null;

    row = mk(doc, 'div');
    sa(row, 'data-ag-cs-row', 'telemetryQuotaMode');
    sa(row, 'data-ag-cs-ext-owned', '1');

    const inner = mk(doc, 'div', 'py-2');
    const textCol = mk(doc, 'div', 'flex-1');
    const titleLine = mk(doc, 'div', 'ag-cs-settings-title-line');
    const tSpan = mk(doc, 'span');
    sa(tSpan, 'data-k', 't');
    const dSpan = mk(doc, 'span', 'whitespace-pre-wrap');
    sa(dSpan, 'data-k', 'd');
    titleLine.appendChild(tSpan);
    textCol.appendChild(titleLine);
    textCol.appendChild(dSpan);

    const ctrlWrap = mk(doc, 'div', 'shrink-0');
    const grp = mk(doc, 'div', 'ag-cs-seg-group');
    sa(grp, 'role', 'group');

    const BTN_CLS = 'ag-cs-seg-btn data-[pressed]:bg-secondary data-[pressed]:text-foreground';
    for (let i = 0; i < QUOTA_MODES.length; i++) {
      const val = QUOTA_MODES[i];
      const btn = mk(doc, 'button', BTN_CLS);
      btn.type = 'button';
      sa(btn, 'type', 'button');
      sa(btn, 'data-ag-cs-ext-key', 'telemetryQuotaMode');
      sa(btn, 'data-ag-cs-ext-val', JSON.stringify(val));
      sa(btn, 'data-ag-cs-ext-qmode', val);
      btn.addEventListener('click', (ev) => {
        ev?.stopPropagation?.();
        if (doc && doc.documentElement) sa(doc.documentElement, 'data-ag-cs-telemetry-quota', val);
        const tel = (ctx.win && ctx.win.__agPrismTelemetry) || G.__agPrismTelemetry;
        if (tel && typeof tel.sync === 'function') {
          let curCfg = {};
          try { curCfg = (ctx.win || G).__agPrism?.getState?.()?.cfg || {}; } catch {}
          try { tel.sync(Object.assign({}, curCfg, { telemetryQuotaMode: val })); } catch {}
        }
        if (typeof ctx.saveSetting === 'function') ctx.saveSetting('telemetryQuotaMode', val);
        if (typeof row.__extResync === 'function') row.__extResync();
      });
      grp.appendChild(btn);
    }

    ctrlWrap.appendChild(grp);
    inner.appendChild(textCol);
    inner.appendChild(ctrlWrap);
    row.appendChild(inner);

    const parent = telRow.parentElement;
    if (telRow.nextSibling && typeof parent.insertBefore === 'function') {
      parent.insertBefore(row, telRow.nextSibling);
    } else {
      parent.appendChild(row);
    }
    return row;
  }

  function sync(rootEl, rawCtx) {
    if (!rootEl || ga(rootEl, 'data-body-built') !== '1') return false;
    const doc = (rawCtx && rawCtx.doc) || rootEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return false;
    const win = (rawCtx && rawCtx.win) || doc.defaultView || (typeof window !== 'undefined' ? window : G);
    const lang = (rawCtx && rawCtx.lang) || ga(rootEl, 'data-ag-cs-lang') || 'en';
    const extUi = getExtStrings(lang, rawCtx && rawCtx.ui);
    const ctx = Object.assign({}, rawCtx || {}, { doc, win, lang, ui: extUi });
    const runMut = typeof ctx.runGuardedMut === 'function' ? ctx.runGuardedMut : (fn) => fn();

    const perfMode = normPerfMode(readLiveCfg(ctx, 'performanceMode', 'balanced'));
    const ignoreRm = Boolean(readLiveCfg(ctx, 'ignoreReducedMotion', false));
    const motionOff = readLiveCfg(ctx, 'motionLevel', 'ultra') === 'off';
    const chatFont = String(readLiveCfg(ctx, 'chatFont', 'default') || 'default');
    const chatFontCustom = String(readLiveCfg(ctx, 'chatFontCustom', '') || '');
    const codeFont = String(readLiveCfg(ctx, 'codeFont', 'default') || 'default');
    const codeFontCustom = String(readLiveCfg(ctx, 'codeFontCustom', '') || '');
    const telOff = readLiveCfg(ctx, 'telemetryModule', 'auto') === 'off';
    const telQuotaMode = readLiveCfg(ctx, 'telemetryQuotaMode', 'compact') === 'both' ? 'both' : 'compact';

    const extSig = `${lang}|${perfMode}|${ignoreRm ? 1 : 0}|${motionOff ? 1 : 0}|${chatFont}|${chatFontCustom}|${codeFont}|${codeFontCustom}|${telOff ? 1 : 0}|${telQuotaMode}`;
    if (
      rootEl.__extBeta4Sig === extSig &&
      qs(rootEl, '[data-ag-cs-row="performanceMode"]') &&
      qs(rootEl, '[data-ag-cs-row="ignoreReducedMotion"]') &&
      qs(rootEl, '[data-ag-cs-row="chatFont"]') &&
      qs(rootEl, 'button[data-ag-cs-code-custom="1"]') &&
      (!qs(rootEl, '[data-ag-cs-row="telemetryModule"]') || qs(rootEl, '[data-ag-cs-row="telemetryQuotaMode"]'))
    ) {
      return true;
    }

    const resyncNow = () => { rootEl.__extBeta4Sig = ''; sync(rootEl, rawCtx); };

    runMut(() => {
      ensureStyle(doc);
      ensureLocalFontDatalist(doc, rootEl);

      // 0. 无损性能模式分段选择器（动效区顶部，不改写动效/波纹/宠物设置）
      const perfRow = ensurePerformanceModeRow(rootEl, doc, ctx);
      if (perfRow) {
        perfRow.__extResync = resyncNow;
        const tEl = qs(perfRow, '[data-k="t"]');
        const dEl = qs(perfRow, '[data-k="d"]');
        if (tEl && tEl.textContent !== extUi.setPerformanceModeTitle) tEl.textContent = extUi.setPerformanceModeTitle || 'Performance Mode';
        if (dEl && dEl.textContent !== extUi.setPerformanceModeDesc) dEl.textContent = extUi.setPerformanceModeDesc || '';
        const grp = qs(perfRow, '.ag-cs-seg-group');
        if (grp) {
          const btns = grp.querySelectorAll ? grp.querySelectorAll('button[data-ag-cs-ext-key="performanceMode"]') : [];
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            const val = ga(b, 'data-ag-cs-ext-perf') || 'balanced';
            const optKey = PERF_MODE_OPT_KEYS[val];
            const lbl = (optKey && extUi[optKey]) || val;
            if (b.textContent !== lbl) b.textContent = lbl;
            const act = val === perfMode;
            sa(b, 'aria-pressed', act ? 'true' : 'false');
            if (act) sa(b, 'data-pressed');
            else ra(b, 'data-pressed');
          }
        }
      }

      // 1. 忽略系统减弱动效开关（动效区）
      const rmRow = ensureIgnoreRmRow(rootEl, doc, ctx);
      if (rmRow) {
        rmRow.__extResync = resyncNow;
        const tEl = qs(rmRow, '[data-k="t"]');
        const dEl = qs(rmRow, '[data-k="d"]');
        if (tEl && tEl.textContent !== extUi.setIgnoreReducedMotionTitle) tEl.textContent = extUi.setIgnoreReducedMotionTitle || 'Ignore System Reduced Motion';
        if (dEl && dEl.textContent !== extUi.setIgnoreReducedMotionDesc) dEl.textContent = extUi.setIgnoreReducedMotionDesc || '';
        if (rmRow.style) rmRow.style.opacity = motionOff ? '0.55' : '';
        if (motionOff) sa(rmRow, 'data-ag-cs-dimmed', '1');
        else ra(rmRow, 'data-ag-cs-dimmed');

        const grp = qs(rmRow, '.ag-cs-seg-group');
        if (grp) {
          sa(grp, 'data-switch-on', ignoreRm ? '1' : '0');
          const btns = grp.querySelectorAll ? grp.querySelectorAll('button[data-ag-cs-ext-key="ignoreReducedMotion"]') : [];
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            const isOnBtn = ga(b, 'data-ag-cs-ext-role') === 'on';
            const lbl = isOnBtn ? (extUi.onLabel || 'On') : (extUi.offLabel || 'Off');
            if (b.textContent !== lbl) b.textContent = lbl;
            const act = isOnBtn === ignoreRm;
            sa(b, 'aria-pressed', act ? 'true' : 'false');
            if (act) sa(b, 'data-pressed');
            else ra(b, 'data-pressed');
            b.tabIndex = act ? -1 : 0;
            sa(b, 'tabindex', act ? '-1' : '0');
          }
        }
      }

      // 2. 会话正文字体（字体/排版区）
      const chatRow = ensureChatFontRow(rootEl, doc, ctx);
      if (chatRow) {
        chatRow.__extResync = resyncNow;
        const tEl = qs(chatRow, '[data-k="t"]');
        const dEl = qs(chatRow, '[data-k="d"]');
        if (tEl && tEl.textContent !== extUi.setChatFontTitle) tEl.textContent = extUi.setChatFontTitle || 'Chat Body Font';
        if (dEl && dEl.textContent !== extUi.setChatFontDesc) dEl.textContent = extUi.setChatFontDesc || '';

        const sel = chatRow.__extSelect;
        if (sel) {
          const opts = sel.children || [];
          for (let i = 0; i < opts.length; i++) {
            const opt = opts[i];
            const key = CHAT_FONT_OPT_KEYS[opt.value];
            const lbl = (key && extUi[key]) || opt.value;
            if (opt.textContent !== lbl) opt.textContent = lbl;
          }
          const safeMode = CHAT_FONT_MODES.includes(chatFont) ? chatFont : 'default';
          if (sel.value !== safeMode) sel.value = safeMode;
        }

        const cUi = chatRow.__extCustomUi;
        if (cUi) {
          cUi.box.__extStrings = extUi;
          cUi.box.__extResync = resyncNow;
          const showCustom = chatFont === 'custom';
          cUi.box.hidden = !showCustom;
          if (showCustom) ra(cUi.box, 'hidden');
          else sa(cUi.box, 'hidden', '');
          if (cUi.box.style) cUi.box.style.display = showCustom ? 'flex' : 'none';
          if (doc.activeElement !== cUi.inp && cUi.inp.value !== chatFontCustom) {
            cUi.inp.value = chatFontCustom;
          }
          sa(cUi.inp, 'placeholder', extUi.chatFontCustomPlaceholder || 'Font family names, comma-separated');
          cUi.loadBtn.textContent = extUi.btnLoadLocalFonts || 'Load Local Fonts';
          cUi.resetBtn.textContent = extUi.btnResetFontDefault || 'Reset Default';
        }
      }

      // 3. 代码等宽字体扩展「自定义」选项与输入框
      const codeExt = ensureCodeFontCustomExtension(rootEl, doc, ctx);
      if (codeExt) {
        codeExt.codeRow.__extResync = resyncNow;
        if (codeExt.customBtn) {
          const lbl = extUi.optFontCustom || 'Custom';
          if (codeExt.customBtn.textContent !== lbl) codeExt.customBtn.textContent = lbl;
          const act = codeFont === 'custom';
          sa(codeExt.customBtn, 'aria-pressed', act ? 'true' : 'false');
          if (act) sa(codeExt.customBtn, 'data-pressed');
          else ra(codeExt.customBtn, 'data-pressed');
        }
        const cUi = codeExt.customUi;
        if (cUi) {
          cUi.box.__extStrings = extUi;
          cUi.box.__extResync = resyncNow;
          const showCustom = codeFont === 'custom';
          cUi.box.hidden = !showCustom;
          if (showCustom) ra(cUi.box, 'hidden');
          else sa(cUi.box, 'hidden', '');
          if (cUi.box.style) cUi.box.style.display = showCustom ? 'flex' : 'none';
          if (doc.activeElement !== cUi.inp && cUi.inp.value !== codeFontCustom) {
            cUi.inp.value = codeFontCustom;
          }
          sa(cUi.inp, 'placeholder', extUi.codeFontCustomPlaceholder || 'Monospace font families, comma-separated');
          cUi.loadBtn.textContent = extUi.btnLoadLocalFonts || 'Load Local Fonts';
          cUi.resetBtn.textContent = extUi.btnResetFontDefault || 'Reset Default';
        }
      }

      // 4. 底栏配额显示模式（模块区，紧随 telemetryModule 下方）
      const qmRow = ensureTelemetryQuotaModeRow(rootEl, doc, ctx);
      if (qmRow) {
        qmRow.__extResync = resyncNow;
        const tEl = qs(qmRow, '[data-k="t"]');
        const dEl = qs(qmRow, '[data-k="d"]');
        if (tEl && tEl.textContent !== extUi.setTelemetryQuotaModeTitle) tEl.textContent = extUi.setTelemetryQuotaModeTitle || 'Footer Quota Display';
        if (dEl && dEl.textContent !== extUi.setTelemetryQuotaModeDesc) dEl.textContent = extUi.setTelemetryQuotaModeDesc || '';
        if (qmRow.style) qmRow.style.opacity = telOff ? '0.55' : '';
        if (telOff) sa(qmRow, 'data-ag-cs-dimmed', '1');
        else ra(qmRow, 'data-ag-cs-dimmed');
        const grp = qs(qmRow, '.ag-cs-seg-group');
        if (grp) {
          const btns = grp.querySelectorAll ? grp.querySelectorAll('button[data-ag-cs-ext-key="telemetryQuotaMode"]') : [];
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            const val = ga(b, 'data-ag-cs-ext-qmode') || 'compact';
            const optKey = QUOTA_MODE_OPT_KEYS[val];
            const lbl = (optKey && extUi[optKey]) || val;
            if (b.textContent !== lbl) b.textContent = lbl;
            const act = val === telQuotaMode;
            sa(b, 'aria-pressed', act ? 'true' : 'false');
            if (act) sa(b, 'data-pressed');
            else ra(b, 'data-pressed');
          }
        }
      }
    });

    rootEl.__extBeta4Sig = extSig;
    return true;
  }

  function dispose(docOverride) {
    const doc = docOverride || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    try { doc.getElementById?.(STYLE_ID)?.remove?.(); } catch {}
    try { doc.getElementById?.(DATALIST_ID)?.remove?.(); } catch {}
    try { doc.querySelectorAll?.('[data-ag-cs-ext-owned="1"], [data-ag-cs-ext-custom]')?.forEach?.((n) => n.remove?.()); } catch {}
  }

  return {
    STYLE_ID,
    DATALIST_ID,
    PERF_MODES,
    QUOTA_MODES,
    CHAT_FONT_MODES,
    sync,
    dispose,
  };
});
