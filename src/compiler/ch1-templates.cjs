// Channel 1 运行时语种切片、增量 configRefresh 模板与主注入壳模板生成器
'use strict';

const fs = require('fs');
const path = require('path');
const { getFileSig } = require('../utils/fs-safe.cjs');
const {
  STYLE_ID,
  LEGACY_STYLE_ID,
  SETTING_BINDING,
  DEFAULT_CONFIG,
  isPerformanceModeExplicit,
  wasPerformanceModeAuto,
  reconcileConfigAliases,
} = require('../config/schema.cjs');
const { minifySingleSource } = require('./js-string-pool.cjs');

// Channel 1 自身实际消费的最小运行时 key 集（Omni / InlineDiff 均在各自独立通道内自带完整 8 语表，无需重复打入 Channel 1 bootCfg）
const CH1_RUNTIME_UI_KEYS = Object.freeze([
  'cacheRead', 'cacheShort', 'effortTitle', 'fiveHourLabel',
  'homeLocalOnlyTag', 'homeLocalScopeNote', 'homeScopeActive', 'homeScopeActiveCount', 'homeScopeAll', 'homeScopeArchivedCount',
  'kpiCacheHit', 'kpiCalls', 'kpiDays', 'kpiFavModel', 'kpiSessions', 'kpiTokens',
  'noModelUsage',
  'optHost', 'optLightAlabaster', 'optLightCrystal', 'optMotionOff', 'optMotionStandard', 'optMotionSubtle',
  'optMotionUltra', 'optObsidian', 'optThoughtBilingual', 'optThoughtImmersive', 'optWarm',
  'quotaEmptyHint', 'quotaJustNow', 'quotaLoading', 'quotaPoolsTitle', 'refreshBtnTitle', 'sessionsUnit',
  'showLess', 'sidebarLessLabel', 'sidebarMoreLabel', 'studioPlaceholder', 'subagentsUnit', 'swarmBadge',
  'tabModels', 'tabOverview', 'tabQuotas', 'thinkingEllipsis', 'tokenUnit', 'tokensInShort', 'tokensOutShort',
  'weeklyLabel', 'workspaceAll', 'workspaceFilterAria',
]);

function normalizeLangIdNode(rawLang, fallback = 'en') {
  const raw = typeof rawLang === 'string' ? rawLang.trim().toLowerCase().replace(/_/g, '-') : '';
  if (!raw || raw === 'auto') return fallback;
  if (raw === 'en' || raw.startsWith('en-') || raw === 'english') return 'en';
  if (raw === 'ja' || raw.startsWith('ja-') || raw === 'jp' || raw === 'japanese') return 'ja';
  if (raw === 'ko' || raw.startsWith('ko-') || raw === 'kr' || raw === 'korean') return 'ko';
  if (raw === 'es' || raw.startsWith('es-') || raw === 'spanish') return 'es';
  if (raw === 'fr' || raw.startsWith('fr-') || raw === 'french') return 'fr';
  if (raw === 'de' || raw.startsWith('de-') || raw === 'german') return 'de';
  if (raw === 'tr' || raw.startsWith('tr-') || raw === 'turkish' || raw === 'türkçe' || raw === 'turkce') return 'tr';
  if (raw === 'yue' || raw.startsWith('yue-') || raw === 'zh-yue' || raw.includes('cantonese')) return 'zh-CN';
  if (raw === 'zh-tw' || raw === 'zh-hk' || raw.startsWith('zh-hk-') || raw === 'zh-mo' || raw === 'zh-hant' || raw.startsWith('zh-hant-') || raw === 'tw' || raw === 'hant') return 'zh-TW';
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans' || raw.startsWith('zh-')) return 'zh-CN';
  return fallback;
}

function extractSingleLangRuntimeSlice(mod, langId) {
  if (!mod) return {};
  const src =
    typeof mod.getRuntimeUiSlice === 'function'
      ? mod.getRuntimeUiSlice(langId)?.strings
      : typeof mod.getUiStrings === 'function'
        ? mod.getUiStrings(langId)
        : null;
  if (!src || typeof src !== 'object') return {};
  const out = {};
  for (let i = 0; i < CH1_RUNTIME_UI_KEYS.length; i++) {
    const k = CH1_RUNTIME_UI_KEYS[i];
    if (typeof src[k] === 'string') out[k] = src[k];
  }
  return out;
}

function createCh1Templates({
  rootDir = path.resolve(__dirname, '..', '..'),
  pluginVersion,
  readConfig,
  resolveCurrentBundleCodeHash,
  detectSystemUiLocale,
}) {
  let _localesFreshCache = { sig: '', mod: null };
  let _diskPerfCache = { sig: '', exists: false, explicit: false, isAuto: false };
  let _configRefreshTemplate = '';
  let _injectWrapperTemplate = null;
  const DEFAULT_KEY_COUNT = Object.keys(DEFAULT_CONFIG).length;

  function readDiskPerfExplicitState() {
    const cfgPath = path.join(rootDir, 'config.json');
    try {
      const st = fs.statSync(cfgPath);
      if (!st.isFile()) {
        _diskPerfCache = { sig: '', exists: false, explicit: false, isAuto: false };
        return _diskPerfCache;
      }
      const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}`;
      if (_diskPerfCache.sig === sig) return _diskPerfCache;
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const explicit = isPerformanceModeExplicit(raw);
      const isAuto = Boolean(
        raw &&
          typeof raw === 'object' &&
          !Array.isArray(raw) &&
          typeof raw.performanceMode === 'string' &&
          raw.performanceMode.trim().toLowerCase() === 'auto'
      );
      _diskPerfCache = { sig, exists: true, explicit, isAuto };
      return _diskPerfCache;
    } catch {
      _diskPerfCache = { sig: '', exists: false, explicit: false, isAuto: false };
      return _diskPerfCache;
    }
  }

  // 返回 0=显式锁定，1=缺省未设置（低配机自动默认 performance，但尊重用户手动偏好），2=显式设为 auto
  function resolvePerfModeAutoTag(config, rawInput = undefined) {
    if (rawInput !== undefined) {
      if (rawInput === null) {
        const disk = readDiskPerfExplicitState();
        return disk.explicit ? 0 : disk.isAuto ? 2 : 1;
      }
      if (typeof rawInput === 'object' && !Array.isArray(rawInput)) {
        if (rawInput.perfModeExplicit === true || rawInput.perfModeAuto === false) return 0;
        if (rawInput.perfModeAuto === true) return 1;
        if (!Object.prototype.hasOwnProperty.call(rawInput, 'performanceMode')) return 0;
        if (isPerformanceModeExplicit(rawInput)) return 0;
        const rv = typeof rawInput.performanceMode === 'string' ? rawInput.performanceMode.trim().toLowerCase() : '';
        return rv === 'auto' ? 2 : 1;
      }
      return 0;
    }
    if (!config || typeof config !== 'object') {
      const disk = readDiskPerfExplicitState();
      return disk.explicit ? 0 : disk.isAuto ? 2 : 1;
    }
    if (config.perfModeExplicit === true || config.perfModeAuto === false) return 0;
    if (config.perfModeAuto === true) return 1;
    if (wasPerformanceModeAuto(config)) return 2;
    if (!Object.prototype.hasOwnProperty.call(config, 'performanceMode')) return 1;
    const raw = typeof config.performanceMode === 'string' ? config.performanceMode.trim().toLowerCase() : '';
    if (!raw) return 1;
    if (raw === 'auto') return 2;
    if (raw !== 'balanced') return 0;
    // performanceMode === 'balanced'：区分「磁盘无显式配置由 readConfig() 补全的全量默认对象」与「调用方显式指定 balanced」
    const keyCount = Object.keys(config).length;
    if (keyCount < DEFAULT_KEY_COUNT) return 0;
    const disk = readDiskPerfExplicitState();
    return disk.explicit ? 0 : disk.isAuto ? 2 : 1;
  }

  function loadLocalesModuleFresh() {
    const locPath = path.join(rootDir, 'i18n-locales.js');
    if (!fs.existsSync(locPath)) return null;
    try {
      const sig = getFileSig(locPath);
      if (_localesFreshCache.sig === sig && _localesFreshCache.mod) {
        return _localesFreshCache.mod;
      }
      try { delete require.cache[require.resolve(locPath)]; } catch {}
      const mod = require(locPath);
      _localesFreshCache = { sig, mod };
      return mod;
    } catch {
      return null;
    }
  }

  function resolveSystemLangNode(hostLocaleHint = null) {
    const sysLocale = hostLocaleHint || detectSystemUiLocale();
    const stripped = String(sysLocale || '').trim().split(/[.@]/)[0];
    return normalizeLangIdNode(stripped, 'en');
  }

  // 为 Channel 1 bootCfg 生成当前活跃语言（及 auto 模式下的 en 兜底）迷你运行时词典（列式编码消除双语重复键名）
  function buildRuntimeUiSlicePayload(config) {
    const mod = loadLocalesModuleFresh();
    if (!mod) return null;
    const rawLang = (config && (config.language || config.lang)) || 'auto';
    const isAuto = String(rawLang).trim().toLowerCase() === 'auto';
    const primary = isAuto ? resolveSystemLangNode() : normalizeLangIdNode(rawLang, 'en');
    const pObj = extractSingleLangRuntimeSlice(mod, primary);
    const enObj = isAuto && primary !== 'en' ? extractSingleLangRuntimeSlice(mod, 'en') : null;
    const keys = CH1_RUNTIME_UI_KEYS.filter((k) => typeof pObj[k] === 'string' || typeof enObj?.[k] === 'string');
    const vals = { [primary]: keys.map((k) => pObj[k] ?? '') };
    if (enObj) vals.en = keys.map((k) => enObj[k] ?? '');
    const pmAuto = resolvePerfModeAutoTag(config);
    return pmAuto ? { active: primary, keys, vals, pmAuto } : { active: primary, keys, vals };
  }

  function getConfigRefreshTemplate() {
    if (_configRefreshTemplate) return _configRefreshTemplate;
    const rawTpl = `(() => {
      const cfg = __AG_REF_CFG__, W = window, D = document, G = globalThis;
      const api = W.__agPrism || W.__agClaudeStyle;
      if (api && api.version === __AG_REF_VER__ && api.codeHash === __AG_REF_HASH__ && typeof api.refreshConfig === 'function') {
        const off = (v) => v === 'off' || v === false, T = (f) => { try { f(); } catch {} };
        if (cfg.__pmAuto) T(() => (W.__agDomBus || G.__agDomBus)?.resolveAutoBootPerfMode?.(cfg, W));
        if (api.refreshConfig(cfg) === false) return { refreshed: true, skippedStale: true, version: api.version };
        const e = api.getState?.()?.cfg || cfg, de = D.documentElement;
        const qa = (s) => D.querySelectorAll?.(s) || [];
        const rm = (s) => qa(s).forEach((n) => n.remove?.());
        const ra = (s) => de && s.split(',').forEach((a) => de.removeAttribute?.(a));
        const dw = (s, p = '') => s.split(',').forEach((k) => { T(() => delete W[p + k]); T(() => delete G[p + k]); });
        T(() => (off(e?.telemetryModule) ? (api.detachTelemetry?.(), W.__agPrismTelemetry?.destroy?.()) : (W.__agPrismTelemetry?.sync?.(e), api.syncTelemetry?.())));
        T(() => (off(e?.effortSliderModule) ? W.__agPrismEffortSlider?.destroy?.() : W.__agPrismEffortSlider?.sync?.(e)));
        if (off(e?.contextMenu)) T(() => W.__agPrismContextMenu?.destroy?.());
        T(() => W.__agPrismThought?.sync?.(e));
        T(() => W.__agPrismInlineDiff?.sync?.(e));
        T(() => (e?.omniModule === 'off' ? W.__agPrismOmni?.destroy?.() : W.__agPrismOmni?.sync?.(e, W.__agPrismOmniServerMeta || null)));
        if (e?.sidebarStudio !== 'on') {
          T(() => { W.__agPrismSidebar?.sync?.(e, W.__agPrismSidebarMeta || null); W.__agPrismSidebar?.destroy?.(); delete W.__agPrismSidebar; });
          T(() => ra('data-ag-prism-mode,data-ag-prism-chat-kind,data-ag-prism-chat-telemetry,data-ag-cs-space,data-ag-cs-space-palette,data-ag-cs-space-accent'));
        } else T(() => W.__agPrismSidebar?.sync?.(e, W.__agPrismSidebarMeta || null));
        T(() => {
          const m = e?.hostLocalization, l = e?.language;
          const navL = String((typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || '').trim();
          if (m === 'off' || m === 'on') W.__agPrismHostI18n?.setMode?.(m);
          else if ((l && l !== 'zh-CN' && l !== 'tr' && l !== 'auto') || ((!l || l === 'auto') && navL && !/^(?:zh(?:$|-(?:cn|hans|sg)(?:-|$))|tr(?:$|-))/i.test(navL))) W.__agPrismHostI18n?.destroy?.();
          else W.__agPrismHostI18n?.setMode?.('auto');
        });
        if (off(e?.mascot)) {
          T(() => W.__agDualMascotRig?.dispose?.()); T(() => api.sync?.());
          T(() => qa('.ag-cs-crab,.ag-cs-dual-stage,.ag-cs-crab-stage,.ag-cs-mascot-stage,.ag-v2-mascot-stage,.ag-v2-habitat-prop').forEach((n) => { T(() => n.__agMascotApi?.dispose?.()); n.remove?.(); }));
          T(() => qa('[data-ag-cs-crab-anchor]').forEach((n) => n.removeAttribute?.('data-ag-cs-crab-anchor')));
          ra('data-ag-cs-has-crab,data-ag-cs-mascot-drag');
          dw('__agDualMascotRig,__agPrismMascotArt');
        }
        if (e?.homeLayout && e.homeLayout !== 'studio') {
          T(() => {
            api.detachHomeStudio?.(); D.getElementById?.('ag-prism-studio-v101-css')?.remove?.();
            rm('.ag-cs-home-panel-seat,.ag-cs-home-panel'); ra('data-ag-prism-scope');
            dw('__agPrismHomeStudioPanel,__agHomeStudioPanel');
          });
        }
        if (off(e?.periodicModelPicker)) {
          T(() => {
            W.__agPrismPeriodicStub?.destroy?.();
            W.__agPrismPeriodicPicker?.destroy?.();
            ra('data-ag-prism-periodic-picker,data-ag-pp-open,data-ag-pp-holding');
            rm('#ag-prism-periodic-stub-css,#ag-prism-periodic-picker-css,#ag-prism-periodic-picker-root,.ag-pp-hold-ring,.ag-pp-mini-keycap');
            dw('PeriodicStub,PeriodicStubFactory,PeriodicPicker,PeriodicPickerFactory,Keyboard3D,PeriodicKeyboard3D,OledScreen,GrainAssets', '__agPrism');
            dw('PendingOpen,FullLoaded,StubHash,AudioFx,ModelCatalog,HostBridge,BentoUi,PbrGrainAssets,OledScreen,Keyboard3D', '__agPeriodic');
          });
        }
        if (de) {
          if (e?.thoughtTranslate && e.thoughtTranslate !== 'off') de.setAttribute('data-ag-prism-thought-view', e.thoughtView === 'bilingual' ? 'bilingual' : 'immersive');
          else de.removeAttribute('data-ag-prism-thought-view');
          de.setAttribute('data-ag-prism-sidebar-studio', e?.sidebarStudio === 'on' ? 'on' : 'off');
        }
        T(() => {
          const pm = e?.performanceMode;
          if (W.__agPrismDomBus?.applyPerformanceMode) W.__agPrismDomBus.applyPerformanceMode(pm, D, W);
          else if (de && pm) de.setAttribute('data-ag-cs-perf-mode', pm === 'eco' ? 'performance' : pm === 'auto' ? 'balanced' : pm);
          W.__agPrismApplyIgnoreReducedMotion?.(!!e?.ignoreReducedMotion);
          W.__agPrismFontCustomizer?.applyCustomFonts?.(e, D);
        });
        return { refreshed: true, version: api.version };
      }
      return { refreshed: false };
    })()`;
    _configRefreshTemplate = minifySingleSource(rawTpl);
    return _configRefreshTemplate;
  }

  function buildConfigRefreshExpression(customConfig, extraMeta = null) {
    const config = customConfig ? reconcileConfigAliases(customConfig) : readConfig();
    const codeHash = resolveCurrentBundleCodeHash();
    const hasExplicitLang = !customConfig || Object.prototype.hasOwnProperty.call(config, 'language') || Object.prototype.hasOwnProperty.call(config, 'lang');
    const uiSlice = hasExplicitLang ? buildRuntimeUiSlicePayload(config) : null;
    const pmAuto = resolvePerfModeAutoTag(config, customConfig ? customConfig : null);
    const bootCfg = {
      ...config,
      ...(uiSlice ? { __uiSlice: uiSlice } : {}),
      ...(pmAuto ? { __pmAuto: pmAuto } : {}),
      ...(extraMeta && typeof extraMeta === 'object' ? extraMeta : {}),
      binding: SETTING_BINDING,
      codeHash,
      __fromFile: true,
    };
    return getConfigRefreshTemplate()
      .replace('__AG_REF_CFG__', () => JSON.stringify(bootCfg))
      .replace('__AG_REF_VER__', () => JSON.stringify(pluginVersion))
      .replace('__AG_REF_HASH__', () => JSON.stringify(codeHash));
  }

  function getInjectWrapperTemplate() {
    if (_injectWrapperTemplate) return _injectWrapperTemplate;
    const rawTpl = `(() => {
      const W = window, D = document, G = globalThis;
      const isF = (v) => typeof v === 'function', isS = (v) => typeof v === 'string', isO = (v) => !!(v && typeof v === 'object');
      const T = (f) => { try { return f(); } catch {} }, sp = (s) => s.split(',');
      const gid = (i) => D.getElementById?.(i), qa = (s) => D.querySelectorAll?.(s) || [], qs = (s) => T(() => D.querySelector(s));
      const VER = ${JSON.stringify(pluginVersion)}, SID = ${JSON.stringify(STYLE_ID)}, LSID = ${JSON.stringify(LEGACY_STYLE_ID)}, OFF_MSG = 'Sidecar daemon offline';
      let _css = null;
      const getCss = () => (_css === null ? (_css = __AG_INJ_CSS__) : _css);
      const cleanOld = () => {
        T(() => gid(LSID)?.remove());
        T(() => {
          const o = W.__agClaudeStyle;
          if (o && (!W.__agPrism || Number(o.version) <= 2)) { if (isF(o.destroy)) o.destroy(); delete W.__agClaudeStyle; }
        });
      };
      const cM = () => W.__agPrismCssMgr;
      const ensureCssMgr = () => {
        const fk = __AG_INJ_CSSHASH__, prev = cM();
        if (prev && prev.cssHash === fk && !prev._disposed) return prev;
        T(() => prev?.destroy?.());
        const css = getCss(), SC = W.CSSStyleSheet || (typeof CSSStyleSheet === 'function' ? CSSStyleSheet : null);
        const hasAd = () => isF(D.adoptedStyleSheets?.[Symbol.iterator]);
        const canA = () => !!T(() => SC && isF(SC.prototype?.replaceSync) && hasAd());
        let sh = null;
        const dropAd = () => { if (sh && hasAd()) T(() => { D.adoptedStyleSheets = Array.from(D.adoptedStyleSheets).filter((s) => s !== sh); }); };
        const setSent = (txt, ad) => {
          const p = D.head || D.documentElement;
          if (!p) return;
          let st = gid(SID);
          if (!st) { st = D.createElement('style'); st.id = SID; }
          const sa = (k, v) => { if (st.getAttribute?.(k) !== v) st.setAttribute?.(k, v); };
          if (ad) { if (st.textContent) st.textContent = ''; sa('data-ag-cs-adopted', '1'); }
          else { if (st.hasAttribute?.('data-ag-cs-adopted')) st.removeAttribute?.('data-ag-cs-adopted'); if (st.textContent !== txt) st.textContent = txt; }
          sa('data-ag-cs-css-hash', fk);
          sa('data-ag-cs-flat', fk + ':' + (ad ? 0 : txt.length));
          if (st.parentNode !== p || (!ad && p.lastElementChild !== st)) p.appendChild(st);
        };
        const mgr = {
          cssHash: fk, mode: canA() ? 'adopted' : 'style', singlePack: true, activeKeys: ['all'], activeBytes: css.length, _disposed: false,
          sync() {
            if (mgr._disposed) return mgr;
            const ad = canA();
            mgr.mode = ad ? 'adopted' : 'style';
            mgr.activeKeys = ['all']; mgr.activeBytes = css.length;
            if (ad) {
              if (!sh) { sh = new SC(); sh.replaceSync(css); }
              const cur = Array.from(D.adoptedStyleSheets);
              if (!cur.includes(sh)) D.adoptedStyleSheets = cur.concat(sh);
              setSent('', true);
            } else {
              dropAd();
              setSent(css, false);
            }
            return mgr;
          },
          destroy(opts) {
            if (mgr._disposed) return;
            mgr._disposed = true;
            dropAd();
            sh = null; mgr.activeKeys = []; mgr.activeBytes = 0;
            T(() => { const s = gid(SID); if (s) { if (opts?.keepStyleNode) s.textContent = ''; else s.remove?.(); } });
          },
        };
        return (W.__agPrismCssMgr = G.__agPrismCssMgr = mgr);
      };
      const applyStyle = () => {
        if (!(D.head || D.documentElement)) return;
        cleanOld();
        ensureCssMgr().sync();
        T(() => { if (cM()?.mode !== 'adopted') W.__agPrism?.flattenCss?.(); });
      };
      const hookApiCssMgr = (api) => {
        if (!api || api.__agCssMgrHooked) return;
        api.__agCssMgrHooked = true;
        const own = cM(), d = isF(api.destroy) && api.destroy.bind(api);
        if (d) api.destroy = (...a) => { T(() => { const m = cM(); if (m && !m._hold && (!own || m === own)) m.destroy?.(); }); return d(...a); };
      };

      const mkRpc = (bk, lim, onTo, onErr, disp) => {
        const pend = new Map();
        let seq = 0;
        const send = (mkReq, ms, ext, bypass) =>
          new Promise((res) => {
            if (!bypass && pend.size >= lim) return res(onErr('busy', true));
            const id = ++seq, it = ext ? { res, t: null, ...ext } : { res, t: null };
            it.arm = (d = ms) => { clearTimeout(it.t); it.t = setTimeout(() => { pend.delete(id); res(onTo()); }, d); };
            it.arm(); pend.set(id, it);
            try { W[bk](JSON.stringify(mkReq(id))); }
            catch (e) { clearTimeout(it.t); pend.delete(id); res(onErr(String(e?.message || e), false)); }
          });
        const resolve = (id, r) => { const it = pend.get(id); if (it) { clearTimeout(it.t); pend.delete(id); it.res(r); } };
        const dispose = () => { for (const it of pend.values()) { clearTimeout(it.t); it.res(disp); } pend.clear(); };
        return { pend, send, resolve, dispose };
      };

      const ensureRepo = () => T(() => {
        if (W.__agPrismRepoBridge?.__prismBridgeReady) return;
        const c = mkRpc('__agPrismRepoCall', 8, () => ({ ok: false, timeout: true, noRemote: true, hasRemote: false }), (e) => ({ ok: false, error: e }), { ok: false, disposed: true });
        const fn = (inp) => {
          const p = isS(inp) ? { action: inp } : isO(inp) ? { ...inp } : { action: 'status' }, a = p.action || 'status';
          if (!isF(W.__agPrismRepoCall)) return Promise.resolve({ ok: false, offline: true, action: a, isGitRepo: false, noRemote: true, hasRemote: false, branch: 'local', commit: VER, shortHash: VER, remoteUrl: '', hasUpdates: false, upToDate: true, updated: false, message: OFF_MSG });
          return c.send((id) => ({ id, action: a, input: p }), 16000).then((r) => (r && !r.action ? { ...r, action: a } : r));
        };
        Object.assign(fn, { __prismBridgeReady: true, call: fn, request: fn, status: () => fn({ action: 'status' }), pull: () => fn({ action: 'pull' }), sync: () => fn({ action: 'pull' }), resolve: c.resolve, dispose: c.dispose });
        W.__agPrismRepoBridge = fn; W.__agPrismRepoResolve = c.resolve;
      });

      const ensureThought = () => T(() => {
        const cur = W.__agPrismThoughtBridge;
        if (cur?.__prismBridgeReady && isF(cur.cacheStats) && isF(cur.cancelTranslate)) return;
        T(() => cur?.dispose?.());
        const c = mkRpc('__agPrismThoughtCall', 64, () => ({ ok: false, timeout: true, error: 'Request timed out' }), (e) => ({ ok: false, error: e }), { ok: false, disposed: true });
        const rpc = (p, onP, ms = 48000) => {
          const a = p?.action || 'get-config';
          if (!isF(W.__agPrismThoughtCall)) return Promise.resolve({ ok: false, offline: true, action: a, error: OFF_MSG });
          return c.send((id) => ({ id, action: a, input: p }), ms, onP ? { onP, buf: '' } : null, a === 'cancel-translate' || a === 'cache-stats' || a === 'clear-cache').then((r) => (r && !r.action && !r.ok ? { ...r, action: a } : r));
        };
        const b = {
          __prismBridgeReady: true,
          call: (i) => rpc(isO(i) ? { ...i } : { action: String(i || 'get-config') }, null, 25000),
          translateStream: (o, onP) => rpc({ ...(isO(o) ? o : {}), action: 'translate-stream', text: o?.text || '', mode: o?.mode || 'ai' }, onP, Math.min(180000, 90000 + Math.max(0, c.pend.size - 2) * 30000)),
          cancelTranslate: (v) => rpc(isO(v) ? { ...v, action: 'cancel-translate' } : { action: 'cancel-translate', requestId: v, key: v }, null, 8000),
          cacheStats: () => rpc({ action: 'cache-stats' }, null, 8000),
          clearCache: () => rpc({ action: 'clear-cache' }, null, 8000),
          onChunk: (id, ch) => {
            const it = c.pend.get(id);
            if (!it || !isF(it.onP)) return;
            let txt = null;
            if (isS(ch)) it.buf = txt = ch;
            else if (isO(ch) && isS(ch.a)) { const s = isS(it.buf) ? it.buf : ''; if ((ch.o | 0) === s.length) it.buf = txt = s + ch.a; }
            if (txt !== null) { T(() => it.arm?.(60000)); T(() => it.onP(txt)); }
          },
          resolve: c.resolve, dispose: c.dispose,
        };
        W.__agPrismThoughtBridge = b; W.__agPrismThoughtOnChunk = b.onChunk; W.__agPrismThoughtResolve = c.resolve;
      });

      const ensureUsage = () => T(() => {
        const cur = W.__agPrismUsageBridge;
        if (cur?.__prismBridgeReady && isF(cur.listSummaries)) return;
        T(() => cur?.dispose?.());
        const fu = (x) => ({ ok: false, records: [], summaries: [], ...x });
        const c = mkRpc('__agPrismUsageCall', 12, () => fu({ timeout: true }), (e, b) => fu(b ? { busy: true } : { error: e }), fu({ disposed: true }));
        const rpc = (q, ms = 18000) => (!isF(W.__agPrismUsageCall) ? Promise.resolve(fu({ offline: true })) : c.send((id) => ({ id, ...q }), ms));
        const b = {
          __prismBridgeReady: true, isOnline: () => isF(W.__agPrismUsageCall),
          fetchBatch: (o, ms = 18000) => (isO(o) && !Array.isArray(o) ? rpc({ action: o.action || 'fetch-batch', items: Array.isArray(o.items) ? o.items : [], includeSummaries: !!o.includeSummaries }, ms) : rpc({ action: 'fetch-batch', items: Array.isArray(o) ? o : [] }, ms)),
          listSummaries: (ms = 12000) => rpc({ action: 'list-summaries', items: [], includeSummaries: true }, ms),
          resolve: c.resolve, dispose: c.dispose,
        };
        W.__agPrismUsageBridge = b; W.__agPrismUsageResolve = c.resolve;
      });

      const destroyMods = (extra) => {
        T(() => W.__agPrismRippleWorker?.disposeAll?.());
        const ks = sp('__agPrismTelemetry,__agPrismEffortSlider,__agPrismThought,__agPrismOmni,__agPrismContextMenu');
        if (extra) ks.push(...sp(extra));
        for (const k of ks) T(() => W[k]?.destroy?.());
      };

      const stripForeign = () => {
        destroyMods('__agPrism,__agPrismInlineDiff,__agPrismHostI18n,__agPrismPeriodicStub,__agPrismPeriodicPicker,__agPrismCssMgr');
        T(() => {
          const de = D.documentElement;
          for (const a of sp('data-ag-prism-host-i18n,data-ag-prism-periodic-picker,data-ag-pp-open,data-ag-cs-model-menu')) de?.removeAttribute?.(a);
          for (const a of sp('data-ag-cs-aux-dual,data-ag-cs-model-overlay')) qa('[' + a + ']').forEach((el) => el.removeAttribute(a));
          qa('[data-testid="prism-thought-ai-config"],[data-testid="prism-thought-general-config"],.ag-cs-ctx-menu,.ag-cs-ctx-toast,.ag-cs-inline-diff-box,.ag-cs-diff-ctx-menu,.ag-pp-hold-ring,.ag-pp-mini-keycap').forEach((el) => el.remove());
        });
        for (const k of sp('__agPrismRepoBridge,__agPrismThoughtBridge,__agPrismUsageBridge,__agPrismOmniBridge')) T(() => W[k]?.dispose?.());
        for (const id of [SID, LSID, ...sp('ag-prism-settings-v101-css,ag-prism-studio-v101-css,ag-prism-omni-css,ag-prism-inline-diff-css,ag-prism-periodic-stub-css,ag-prism-periodic-picker-css')]) T(() => gid(id)?.remove());
        for (const k of sp('__agPrismCssMgr,__agPrismPeriodicStub,__agPrismPeriodicStubFactory,__agPeriodicPendingOpen,__agPeriodicFullLoaded,__agPeriodicStubHash,__agPrismThought,__agPrismThoughtSettingsUi,__agPrismInlineDiff,__agPrismInlineDiffFactory,__agPrismInlineDiffResolve,__agPrismOmni,__agPrismContextMenu,__agPrism,__agClaudeStyle')) { delete W[k]; delete G[k]; }
      };

      const hasMarkers = () => !!T(() => {
        const cl = D.body?.classList;
        return (cl && (cl.contains('theme-standalone') || cl.contains('monaco-workbench'))) || qs('.agy-shell,.agy-home,[data-testid="aux-pane-split"],[data-testid="conversation-view"],[data-testid="agent-input-box"],[data-testid="model-selector-trigger"],.monaco-workbench');
      });

      const checkHost = () => T(() => {
        const href = isS(W.location?.href) ? W.location.href : '';
        if (!href) return 'ok';
        const low = href.toLowerCase(), ttl = String(D.title || '');
        if (/^(?:devtools:\\/\\/|data:|chrome:|chrome-extension:|edge:|blob:|plugin:)/.test(low)) return 'reject';
        if (/^(?:vscode-file:\\/\\/|app:\\/\\/|about:)/.test(low)) return /^(?:untitled|launchpad)$/i.test(ttl.trim()) || /\\/launchpad(?:\\.html)?(?:[?#]|$)/i.test(low) ? 'reject' : 'ok';
        const m = /^(https?):\\/\\/(127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?(\\/[^?#]*)?(?:[?#]|$)/i.exec(href);
        if (!m) return /^https?:/.test(low) ? 'reject' : 'ok';
        if (/^\\/(?:viewer(?:\\/|$)|sandbox(?:\\/|$)|stream(?:\\/|$)|api(?:\\/|$))/.test((m[3] || '/').toLowerCase())) return 'reject';
        if (hasMarkers()) return 'ok';
        const rs = String(D.readyState || '');
        if (m[1].toLowerCase() === 'http') return rs === 'loading' ? 'defer' : 'reject';
        return /\\bantigravity\\b/i.test(ttl) ? 'ok' : (rs === 'complete' ? 'reject' : 'ok');
      }) || 'ok';

      let status = 'ok', mounted = false;
      const mount = () => {
        if (mounted || !D.documentElement) return;
        const v = checkHost();
        if (v === 'reject') { status = 'skipped-non-host'; stripForeign(); return; }
        if (v === 'defer') { status = 'deferred'; D.addEventListener('DOMContentLoaded', mount, { once: true }); return; }
        mounted = true;
        if (W.addEventListener && String(D.readyState || '') !== 'complete') W.addEventListener('load', () => { if (checkHost() === 'reject') stripForeign(); }, { once: true });
        try {
          cleanOld(); ensureRepo(); ensureThought(); ensureUsage();
          const bootCfg = __AG_INJ_BOOTCFG__;
          if (D.head) applyStyle();
          else D.addEventListener('DOMContentLoaded', applyStyle, { once: true });
          const cur = W.__agPrism || W.__agClaudeStyle;
          const autoPm = () => T(() => (W.__agDomBus || G.__agDomBus)?.resolveAutoBootPerfMode?.(bootCfg, W));
          if (cur && cur.version === VER && cur.codeHash === __AG_INJ_CODEHASH__) { autoPm(); cur.refreshConfig(bootCfg); }
          else {
            destroyMods();
            T(() => qa('[data-ag-prism-fallback="1"]').forEach((n) => n.remove()));
            __AG_INJ_BUNDLE__();
            autoPm();
            const km = cM();
            if (km) km._hold = 1;
            try { isF(G.__agCsUiMain) && G.__agCsUiMain(bootCfg); } finally { if (km) km._hold = 0; }
            const cm = cM();
            if (cm?._disposed || (D.head && !cm)) applyStyle();
          }
          if (W.__agClaudeStyle && !W.__agPrism) W.__agPrism = W.__agClaudeStyle;
          else if (W.__agPrism) W.__agClaudeStyle = W.__agPrism;
          hookApiCssMgr(W.__agPrism);
          const eCfg = (isF(W.__agPrism?.getState) ? W.__agPrism.getState()?.cfg : null) || bootCfg;
          T(() => cM()?.sync?.());
          T(() => (eCfg?.omniModule === 'off' ? W.__agPrismOmni?.destroy?.() : W.__agPrismOmni?.sync?.(eCfg, W.__agPrismOmniServerMeta || null)));
          const de = D.documentElement;
          if (de) {
            if (!de.hasAttribute('data-ag-prism')) de.setAttribute('data-ag-prism', VER);
            if (eCfg?.thoughtTranslate && eCfg.thoughtTranslate !== 'off') de.setAttribute('data-ag-prism-thought-view', eCfg.thoughtView === 'bilingual' ? 'bilingual' : 'immersive');
            else de.removeAttribute('data-ag-prism-thought-view');
          }
        } catch (e) {
          status = 'error: ' + (e?.message || String(e));
          if (typeof console !== 'undefined' && console.error) console.error('[obsidian-prism] init error:', e);
        }
      };

      if (D.documentElement) mount();
      else {
        status = 'deferred';
        const onR = () => { if (D.documentElement) { D.removeEventListener('readystatechange', onR); D.removeEventListener('DOMContentLoaded', onR); mount(); } };
        D.addEventListener('readystatechange', onR); D.addEventListener('DOMContentLoaded', onR);
      }
      const api = W.__agPrism || W.__agClaudeStyle;
      return { version: VER, status, codeHash: api?.codeHash || __AG_INJ_CODEHASH__ };
    })()`;
    _injectWrapperTemplate = minifySingleSource(rawTpl);
    return _injectWrapperTemplate;
  }

  return {
    CH1_RUNTIME_UI_KEYS,
    normalizeLangIdNode,
    resolveSystemLangNode,
    loadLocalesModuleFresh,
    resolvePerfModeAutoTag,
    buildRuntimeUiSlicePayload,
    getConfigRefreshTemplate,
    buildConfigRefreshExpression,
    getInjectWrapperTemplate,
  };
}

module.exports = {
  CH1_RUNTIME_UI_KEYS,
  normalizeLangIdNode,
  extractSingleLangRuntimeSlice,
  createCh1Templates,
};
