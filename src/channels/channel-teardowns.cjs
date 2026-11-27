// 分通道无损卸载表达式集合与主帧 Isolated Context 协同静音表达式
'use strict';

const OMNI_REMOVE_EXPRESSION = `(() => {
  try { window.__agPrismOmni?.destroy?.(); } catch {}
  try { window.__agPrismOmniBridge?.dispose?.(); } catch {}
  try { document.getElementById?.('ag-prism-omni-css')?.remove?.(); } catch {}
  try { document.querySelectorAll?.('.ag-omni-dock, .ag-omni-menu, .ag-prism-omni-menu, .ag-prism-omni-pane, [data-ag-prism-omni-owned="1"]')?.forEach?.((n) => n.remove()); } catch {}
  try { delete window.__agPrismOmni; } catch {}
  try { delete globalThis.__agPrismOmni; } catch {}
  try { delete window.__agPrismOmniBridge; } catch {}
  try { delete window.__agPrismOmniResolve; } catch {}
  try { delete window.__agPrismOmniServerMeta; } catch {}
  try { delete window.__agPrismOmniBootCfg; delete globalThis.__agPrismOmniBootCfg; } catch {}
  try { delete window.__agPrismOmniDisableAutoBoot; delete globalThis.__agPrismOmniDisableAutoBoot; } catch {}
  return { ok: true, status: 'off' };
})()`;

const SIDEBAR_REMOVE_EXPRESSION = `(() => {
  try { window.__agPrismSidebar?.destroy?.({ preserveRuntimeState: false }); } catch {}
  try { window.__agPrismSidebarBridge?.dispose?.(); } catch {}
  try { document.getElementById?.('ag-prism-sidebar-studio-css')?.remove?.(); } catch {}
  try { document.querySelectorAll?.('[data-ag-prism-sidebar-owned="1"], .ag-prism-sidebar-studio, .ag-prism-sidebar-rail, .ag-prism-sidebar-popover, .ag-prism-sidebar-modal')?.forEach?.((n) => n.remove()); } catch {}
  try {
    if (document.documentElement) {
      ['data-ag-prism-sidebar-studio', 'data-ag-prism-mode', 'data-ag-prism-chat-kind', 'data-ag-prism-chat-telemetry', 'data-ag-cs-space', 'data-ag-cs-space-palette', 'data-ag-cs-space-accent'].forEach((a) => document.documentElement.removeAttribute(a));
    }
  } catch {}
  try { delete window.__agPrismSidebar; } catch {}
  try { delete globalThis.__agPrismSidebar; } catch {}
  try { delete window.__agPrismSidebarBridge; } catch {}
  try { delete window.__agPrismSidebarResolve; } catch {}
  try { delete window.__agPrismSidebarMeta; } catch {}
  for (const k of ['__agPrismSidebarHostOps', '__agPrismSidebarLastSendError', '__agPrismSidebarLastStartStage', '__agPrismSidebarLastStartFallback', '__agPrismSidebarLastSendFallback']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  return { ok: true, status: 'off' };
})()`;

const HOST_I18N_REMOVE_EXPRESSION = `(() => {
  try { window.__agPrismHostI18n?.destroy?.(); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-prism-host-i18n'); } catch {}
  try { delete window.__agPrismHostI18n; } catch {}
  try { delete globalThis.__agPrismHostI18n; } catch {}
  try { delete window.__agPrismHostI18nFactory; } catch {}
  try { delete globalThis.__agPrismHostI18nFactory; } catch {}
  try { delete window.__agPrismHostI18nReversePatterns; } catch {}
  try { delete globalThis.__agPrismHostI18nReversePatterns; } catch {}
  return { ok: true, status: 'off' };
})()`;

// 主帧 Electron Isolated Context 外部汉化器（如 preload 注入版 yiheng8023/antigravity-chinese、yuexps/Antigravity-Hans）可逆协同静音表达式
// 零 app.asar 修改、绝不修改 Map.prototype、绝不删改词典/缓存条目，退出或切回 auto/on 时 100% 无损恢复
const ISOLATED_HOST_I18N_PAUSE_EXPRESSION = `(() => {
  try {
    const g = globalThis;
    const prev = g.__agPrismIsoHostI18nState;
    if (prev && prev.paused) {
      return { ok: true, detected: true, paused: true, alreadyPaused: true, provider: prev.provider || null };
    }
    const st = {
      paused: false,
      provider: null,
      agyCachePaused: false,
      agyCacheRef: null,
      agyOrigHasDesc: null,
      agyOrigGetDesc: null,
      hansSwitched: false,
      hansPrevLang: null,
      patchObserverPaused: false,
      patchObserverRef: null,
      patchObserverTarget: null,
      patchObserverOpts: null,
    };
    if (
      g.__AGY_CACHE__ &&
      typeof g.__AGY_CACHE__.has === 'function' &&
      typeof g.__AGY_CACHE__.get === 'function' &&
      (g.__AGY_I18N_INITIALIZED__ || g.__AGY_I18N_DATA__)
    ) {
      const cache = g.__AGY_CACHE__;
      st.agyCacheRef = cache;
      st.agyOrigHasDesc = Object.getOwnPropertyDescriptor(cache, 'has') || null;
      st.agyOrigGetDesc = Object.getOwnPropertyDescriptor(cache, 'get') || null;
      Object.defineProperty(cache, 'has', { value: () => true, configurable: true, writable: true });
      Object.defineProperty(cache, 'get', { value: () => null, configurable: true, writable: true });
      st.agyCachePaused = true;
      st.paused = true;
      st.provider = 'yiheng8023';
    }
    if (typeof g.__antigravityZhSetLang === 'function') {
      let stored = null;
      try { stored = g.localStorage && g.localStorage.getItem('antigravityHansLang'); } catch {}
      const norm = stored !== null ? String(stored).trim().toLowerCase() : '';
      if (stored === null || (norm !== 'en' && norm !== 'en-us' && norm !== 'off' && norm !== 'false' && norm !== '0')) {
        st.hansPrevLang = stored && String(stored).trim() ? String(stored).trim() : 'zh-CN';
        try {
          g.__antigravityZhSetLang('en');
          st.hansSwitched = true;
          st.paused = true;
          if (!st.provider) st.provider = 'yuexps/Antigravity-Hans';
        } catch {}
      }
    } else if (
      g.__antigravityZhPatchObserver &&
      typeof g.__antigravityZhPatchObserver.disconnect === 'function' &&
      typeof g.__antigravityZhPatchObserver.observe === 'function'
    ) {
      try {
        const obs = g.__antigravityZhPatchObserver;
        st.patchObserverRef = obs;
        st.patchObserverTarget = obs._target || obs.target || (typeof document !== 'undefined' && (document.documentElement || document.body)) || null;
        st.patchObserverOpts = obs.options || { childList: true, subtree: true, characterData: true };
        obs.disconnect();
        st.patchObserverPaused = true;
        st.paused = true;
        if (!st.provider) st.provider = 'yuexps/Antigravity-Hans';
      } catch {}
    }
    if (!st.paused) {
      return { ok: true, detected: false, paused: false, alreadyPaused: false, provider: null };
    }
    g.__agPrismIsoHostI18nState = st;
    return { ok: true, detected: true, paused: true, alreadyPaused: false, provider: st.provider };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
})()`;

const ISOLATED_HOST_I18N_RESUME_EXPRESSION = `(() => {
  try {
    const g = globalThis;
    const st = g.__agPrismIsoHostI18nState;
    if (!st || !st.paused) {
      return { ok: true, resumed: false, provider: null };
    }
    try { delete g.__agPrismIsoHostI18nState; } catch { g.__agPrismIsoHostI18nState = null; }
    if (st.agyCachePaused && st.agyCacheRef) {
      try {
        if (st.agyOrigHasDesc) Object.defineProperty(st.agyCacheRef, 'has', st.agyOrigHasDesc);
        else delete st.agyCacheRef.has;
        if (st.agyOrigGetDesc) Object.defineProperty(st.agyCacheRef, 'get', st.agyOrigGetDesc);
        else delete st.agyCacheRef.get;
      } catch {}
      try {
        if (typeof g.__AGY_RUN_FULL_SCAN__ === 'function') g.__AGY_RUN_FULL_SCAN__();
      } catch {}
    }
    if (st.patchObserverPaused && st.patchObserverRef && st.patchObserverTarget) {
      try { st.patchObserverRef.observe(st.patchObserverTarget, st.patchObserverOpts); } catch {}
    }
    if (st.hansSwitched && typeof g.__antigravityZhSetLang === 'function') {
      try { g.__antigravityZhSetLang(st.hansPrevLang || 'zh-CN'); } catch {}
    }
    return { ok: true, resumed: true, provider: st.provider || null };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
})()`;

const SWARM_I18N_REMOVE_EXPRESSION = `(() => {
  try { window.__agPrismSwarmI18n?.destroy?.(); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-prism-swarm-i18n'); } catch {}
  try { delete window.__agPrismSwarmI18n; } catch {}
  try { delete globalThis.__agPrismSwarmI18n; } catch {}
  try { delete window.__agPrismSwarmI18nFactory; } catch {}
  try { delete globalThis.__agPrismSwarmI18nFactory; } catch {}
  return { ok: true, status: 'off' };
})()`;

const THOUGHT_REMOVE_EXPRESSION = `(() => {
  try { window.__agPrismThought?.destroy?.(); } catch {}
  try { document.querySelectorAll?.('[data-testid="prism-thought-ai-config"], [data-testid="prism-thought-general-config"]')?.forEach?.((el) => el.remove()); } catch {}
  try { delete window.__agPrismThought; } catch {}
  try { delete globalThis.__agPrismThought; } catch {}
  try { delete window.__agPrismToolStepVerbs; } catch {}
  try { delete globalThis.__agPrismToolStepVerbs; } catch {}
  try { delete window.__agPrismThoughtSettingsUi; } catch {}
  try { delete globalThis.__agPrismThoughtSettingsUi; } catch {}
  try {
    const sec = document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec');
    if (sec) {
      sec.__prismThoughtUiHandle = null;
      sec.__prismMountThoughtUi?.();
    }
  } catch {}
  return { ok: true, status: 'off' };
})()`;

const INLINE_DIFF_REMOVE_EXPRESSION = `(() => {
  try { window.__agPrismInlineDiff?.destroy?.(); } catch {}
  try { document.getElementById?.('ag-prism-inline-diff-css')?.remove?.(); } catch {}
  try { document.querySelectorAll?.('.ag-cs-inline-diff-box, .ag-cs-diff-ctx-menu')?.forEach?.((el) => el.remove()); } catch {}
  try { delete window.__agPrismInlineDiff; } catch {}
  try { delete globalThis.__agPrismInlineDiff; } catch {}
  try { delete window.__agPrismInlineDiffFactory; } catch {}
  try { delete globalThis.__agPrismInlineDiffFactory; } catch {}
  try { delete window.__agPrismInlineDiffResolve; } catch {}
  try { delete window.__agPrismResolveInlineDiff; delete globalThis.__agPrismResolveInlineDiff; } catch {}
  return { ok: true, status: 'off' };
})()`;

const WALLPAPER_REMOVE_EXPRESSION = `(() => {
  try {
    document.querySelectorAll?.('#ag-prism-wallpaper-root video')?.forEach?.((v) => {
      try { v.pause?.(); } catch {}
      try { v.removeAttribute?.('src'); } catch {}
      try { v.src = ''; } catch {}
      try { v.load?.(); } catch {}
    });
  } catch {}
  try { (window.__agPrismWallpaper || globalThis.__agPrismWallpaper)?.destroy?.(); } catch {}
  try { (window.__agPrismWallpaperBridge || globalThis.__agPrismWallpaperBridge)?.dispose?.(); } catch {}
  try { document.getElementById?.('ag-prism-wallpaper-root')?.remove?.(); } catch {}
  try { document.getElementById?.('ag-prism-wallpaper-css')?.remove?.(); } catch {}
  try {
    const slot = document.querySelector?.('[data-testid="prism-wallpaper-slot"]');
    if (slot) {
      try { slot.__agPrismWpUiHandle?.destroy?.(); } catch {}
      slot.__agPrismWpUiHandle = null;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
    }
  } catch {}
  try {
    const de = document.documentElement;
    if (de) {
      de.removeAttribute?.('data-ag-prism-wallpaper');
      de.removeAttribute?.('data-ag-prism-wallpaper-hole');
      if (de.style && typeof de.style.removeProperty === 'function') {
        ['--ag-prism-wp-opacity', '--ag-prism-wp-blur', '--ag-prism-wp-blur-pad', '--ag-prism-wp-dim', '--ag-prism-wp-fit'].forEach((p) =>
          de.style.removeProperty(p)
        );
      }
    }
  } catch {}
  try { delete window.__agPrismWallpaper; } catch {}
  try { delete globalThis.__agPrismWallpaper; } catch {}
  try { delete window.__agPrismWallpaperFactory; } catch {}
  try { delete globalThis.__agPrismWallpaperFactory; } catch {}
  try { delete window.__agPrismWallpaperSettingsUi; } catch {}
  try { delete globalThis.__agPrismWallpaperSettingsUi; } catch {}
  try { delete window.__prismMountWallpaperUi; } catch {}
  try { delete globalThis.__prismMountWallpaperUi; } catch {}
  try { delete window.__agPrismWallpaperBridge; } catch {}
  try { delete globalThis.__agPrismWallpaperBridge; } catch {}
  try { delete window.__agPrismWallpaperResolve; } catch {}
  try { delete globalThis.__agPrismWallpaperResolve; } catch {}
  return { ok: true, status: 'off' };
})()`;

const PERIODIC_PICKER_REMOVE_EXPRESSION = `(() => {
  try { window.__agPrismPeriodicPicker?.destroy?.(); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-prism-periodic-picker'); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-pp-open'); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-pp-holding'); } catch {}
  try {
    document
      .querySelectorAll?.('#ag-prism-periodic-picker-css, #ag-prism-periodic-picker-root, .ag-pp-hold-ring, .ag-pp-mini-keycap')
      .forEach((n) => n.remove());
  } catch {}
  for (const k of ['__agPrismPeriodicPicker', '__agPrismPeriodicPickerFactory', '__agPrismKeyboard3D', '__agPrismPeriodicKeyboard3D', '__agPrismOledScreen', '__agPrismGrainAssets', '__agPeriodicAudioFx', '__agPeriodicModelCatalog', '__agPeriodicHostBridge', '__agPeriodicMockHost', '__agPeriodicBentoUi', '__agPeriodicPbrGrainAssets', '__agPeriodicOledScreen', '__agPeriodicKeyboard3D']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  return { ok: true, status: 'off' };
})()`;

const SETTINGS_REMOVE_EXPRESSION = `(() => {
  try {
    const sec = document.getElementById('ag-cs-settings-sec');
    sec?.__agMascotStageApi?.dispose?.();
    sec?.remove?.();
  } catch {}
  try { (window.__agPrismSettingsExtBeta4 || globalThis.__agPrismSettingsExtBeta4)?.dispose?.(document); } catch {}
  try { document.getElementById?.('ag-prism-settings-ext-beta4-css')?.remove?.(); } catch {}
  try { document.getElementById?.('ag-prism-local-fonts-list')?.remove?.(); } catch {}
  try { delete window.__agPrismSettingsPanel; } catch {}
  try { delete globalThis.__agPrismSettingsPanel; } catch {}
  try { delete window.__agPrismSettingsExtBeta4; } catch {}
  try { delete globalThis.__agPrismSettingsExtBeta4; } catch {}
  try { delete window.__agPrismI18nExtBeta4; } catch {}
  try { delete globalThis.__agPrismI18nExtBeta4; } catch {}
  try { delete window.__agPrismBrandLogoSvg; } catch {}
  try { delete globalThis.__agPrismBrandLogoSvg; } catch {}
  try { delete window.__agOctopathStageWebGL; } catch {}
  try { delete globalThis.__agOctopathStageWebGL; } catch {}
  try { delete window.__agOctopathTavernAtlas; } catch {}
  try { delete globalThis.__agOctopathTavernAtlas; } catch {}
  return { ok: true, status: 'off' };
})()`;

const MASCOT_REMOVE_EXPRESSION = `(() => {
  try { (window.__agPrismMascotHop || globalThis.__agPrismMascotHop)?.dispose?.(); } catch {}
  try { window.__agDualMascotRig?.dispose?.(); } catch {}
  try { (window.__agPrism || window.__agClaudeStyle)?.sync?.(); } catch {}
  try { document.getElementById?.('ag-prism-mascot-hop-style')?.remove?.(); } catch {}
  try {
    document.querySelectorAll?.('.ag-cs-crab, .ag-cs-dual-stage, .ag-cs-crab-stage, .ag-cs-mascot-stage, .ag-v2-mascot-stage, .ag-v2-habitat-prop, .ag-prism-mascot-hop-layer').forEach((n) => {
      try { n.__agMascotApi?.dispose?.(); } catch {}
      n.remove?.();
    });
  } catch {}
  try { document.querySelectorAll?.('[data-ag-cs-crab-anchor]').forEach((n) => n.removeAttribute?.('data-ag-cs-crab-anchor')); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-cs-has-crab'); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-cs-mascot-drag'); } catch {}
  try { delete window.__agDualMascotRig; } catch {}
  try { delete globalThis.__agDualMascotRig; } catch {}
  try { delete window.__agPrismMascotArt; } catch {}
  try { delete globalThis.__agPrismMascotArt; } catch {}
  try { delete window.__agPrismMascotHop; } catch {}
  try { delete globalThis.__agPrismMascotHop; } catch {}
  return { ok: true, status: 'off' };
})()`;

const SUGGESTER_REMOVE_EXPRESSION = `(() => {
  try { (window.__agPrismSuggester || globalThis.__agPrismSuggester)?.destroy?.(); } catch {}
  try { (window.__agPrismSuggesterBridge || globalThis.__agPrismSuggesterBridge)?.dispose?.(); } catch {}
  try { document.getElementById?.('ag-prism-suggester-css')?.remove?.(); } catch {}
  try { document.getElementById?.('ag-prism-model-dd-css')?.remove?.(); } catch {}
  try { document.querySelectorAll?.('[data-testid="prism-suggest-trigger"], [data-testid="prism-ghost-overlay"]')?.forEach?.((n) => n.remove()); } catch {}
  try {
    document.querySelectorAll?.('[data-ag-prism-ghost-active]')?.forEach?.((el) => {
      el.removeAttribute('data-ag-prism-ghost-active');
      el.style?.removeProperty?.('--ag-prism-ghost-min-h');
    });
  } catch {}
  try {
    const slot = document.querySelector?.('[data-testid="prism-suggester-slot"]');
    if (slot) {
      try { slot.__agPrismSgUiHandle?.destroy?.(); } catch {}
      slot.__agPrismSgUiHandle = null;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
    }
  } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-prism-suggester'); } catch {}
  try { delete window.__agPrismSuggester; } catch {}
  try { delete globalThis.__agPrismSuggester; } catch {}
  try { delete window.__agPrismSuggesterFactory; } catch {}
  try { delete globalThis.__agPrismSuggesterFactory; } catch {}
  try { delete window.__agPrismSuggesterSettingsUi; } catch {}
  try { delete globalThis.__agPrismSuggesterSettingsUi; } catch {}
  try { delete window.__prismMountSuggesterUi; } catch {}
  try { delete globalThis.__prismMountSuggesterUi; } catch {}
  try { delete window.__agPrismSuggesterBridge; } catch {}
  try { delete globalThis.__agPrismSuggesterBridge; } catch {}
  try { delete window.__agPrismSuggesterResolve; } catch {}
  try { delete globalThis.__agPrismSuggesterResolve; } catch {}
  return { ok: true, status: 'off' };
})()`;

const HOME_STUDIO_REMOVE_EXPRESSION = `(() => {
  try { (window.__agPrism || window.__agClaudeStyle)?.detachHomeStudio?.(); } catch {}
  try { document.getElementById?.('ag-prism-studio-v101-css')?.remove?.(); } catch {}
  try { document.querySelectorAll?.('.ag-cs-home-panel-seat, .ag-cs-home-panel')?.forEach?.((n) => n.remove()); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ag-prism-scope'); } catch {}
  try { delete window.__agPrismHomeStudioPanel; } catch {}
  try { delete globalThis.__agPrismHomeStudioPanel; } catch {}
  try { delete window.__agHomeStudioPanel; } catch {}
  try { delete globalThis.__agHomeStudioPanel; } catch {}
  return { ok: true, status: 'off' };
})()`;

const TELEMETRY_REMOVE_EXPRESSION = `(() => {
  try { (window.__agPrism || window.__agClaudeStyle)?.detachTelemetry?.(); } catch {}
  try { (window.__agCsPulseBridgeInst || globalThis.__agCsPulseBridgeInst)?.destroy?.(); } catch {}
  try { (window.__agPrismTelemetry || globalThis.__agPrismTelemetry)?.destroy?.(); } catch {}
  try { document.querySelectorAll?.('[data-ag-prism-fallback="1"]')?.forEach?.((n) => n.remove()); } catch {}
  try {
    document.querySelectorAll?.('[data-ag-prism-hidden="1"]')?.forEach?.((el) => {
      el.removeAttribute('data-ag-prism-hidden');
      const st = el.style;
      if (st && typeof st.removeProperty === 'function') {
        ['display','position','left','top','width','height','opacity','pointer-events','visibility','overflow'].forEach((p) => st.removeProperty(p));
      }
    });
  } catch {}
  for (const k of ['__agPrismTelemetry','__agVialCore','__agCsPulseVialBridge','__agCsPulseBridgeInst','__agPrismMetricsBridge','__agPulseExternalBridge']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  try {
    if (typeof window !== 'undefined' && window && !window.__agPulseDispose) {
      try { window.__agPulseRuntimeBridge?.dispose?.(); } catch {}
      try { delete window.__agPulseRuntimeBridge; delete globalThis.__agPulseRuntimeBridge; } catch {}
      try { delete window.__agPulseRuntimeOwner; delete globalThis.__agPulseRuntimeOwner; } catch {}
    }
  } catch {}
  return { ok: true, status: 'off' };
})()`;

const EFFORT_SLIDER_REMOVE_EXPRESSION = `(() => {
  try { (window.__agPrismEffortSlider || globalThis.__agPrismEffortSlider)?.destroy?.(); } catch {}
  try {
    if (window.__agCodexEffortSliderInstance && window.__agCodexEffortSliderInstance.__prismOwned) {
      try { window.__agCodexEffortSliderInstance.stop?.(); } catch {}
      delete window.__agCodexEffortSliderInstance;
    }
  } catch {}
  try { document.querySelector?.('#ag-codex-effort-slider-styles[data-ag-prism-slider="1"]')?.remove?.(); } catch {}
  try { document.getElementById?.('ag-prism-effort-slider-hide')?.remove?.(); } catch {}
  try { document.documentElement?.removeAttribute?.('data-ces-slider-ready'); } catch {}
  for (const k of ['__agPrismEffortSlider','AntigravityCodexEffortSlider','__agCodexEffortSliderDisableAutoBoot']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  return { ok: true, status: 'off' };
})()`;

const WORKBENCH_ENHANCER_REMOVE_EXPRESSION = `(() => {
  try { (window.__agPrism || window.__agClaudeStyle)?.detachHostEnhancer?.(); } catch {}
  try {
    document.querySelectorAll?.('.ag-cs-code-fold-btn,.ag-cs-nav-outline-popover,.ag-cs-nav-outline-trigger,.ag-cs-sb-more-wrap')?.forEach?.((n) => n.remove());
  } catch {}
  try { delete window.__agPrismHostEnhancer; } catch {}
  try { delete globalThis.__agPrismHostEnhancer; } catch {}
  return { ok: true, status: 'off' };
})()`;

const CONTEXT_MENU_REMOVE_EXPRESSION = `(() => {
  try { (window.__agPrismContextMenu || globalThis.__agPrismContextMenu)?.destroy?.(); } catch {}
  try { document.querySelectorAll?.('.ag-cs-ctx-menu,.ag-cs-ctx-toast')?.forEach?.((n) => n.remove()); } catch {}
  try { delete window.__agPrismContextMenu; } catch {}
  try { delete globalThis.__agPrismContextMenu; } catch {}
  return { ok: true, status: 'off' };
})()`;

const CHANNEL_TEARDOWN_MAP = Object.freeze({
  omni: OMNI_REMOVE_EXPRESSION,
  sidebar: SIDEBAR_REMOVE_EXPRESSION,
  hostI18n: HOST_I18N_REMOVE_EXPRESSION,
  swarmI18n: SWARM_I18N_REMOVE_EXPRESSION,
  thought: THOUGHT_REMOVE_EXPRESSION,
  inlineDiff: INLINE_DIFF_REMOVE_EXPRESSION,
  wallpaper: WALLPAPER_REMOVE_EXPRESSION,
  periodicPicker: PERIODIC_PICKER_REMOVE_EXPRESSION,
  settings: SETTINGS_REMOVE_EXPRESSION,
  mascot: MASCOT_REMOVE_EXPRESSION,
  suggester: SUGGESTER_REMOVE_EXPRESSION,
  homeStudio: HOME_STUDIO_REMOVE_EXPRESSION,
  telemetry: TELEMETRY_REMOVE_EXPRESSION,
  effortSlider: EFFORT_SLIDER_REMOVE_EXPRESSION,
  workbenchEnhancer: WORKBENCH_ENHANCER_REMOVE_EXPRESSION,
  contextMenu: CONTEXT_MENU_REMOVE_EXPRESSION,
});

module.exports = {
  OMNI_REMOVE_EXPRESSION,
  SIDEBAR_REMOVE_EXPRESSION,
  HOST_I18N_REMOVE_EXPRESSION,
  ISOLATED_HOST_I18N_PAUSE_EXPRESSION,
  ISOLATED_HOST_I18N_RESUME_EXPRESSION,
  SWARM_I18N_REMOVE_EXPRESSION,
  THOUGHT_REMOVE_EXPRESSION,
  INLINE_DIFF_REMOVE_EXPRESSION,
  WALLPAPER_REMOVE_EXPRESSION,
  PERIODIC_PICKER_REMOVE_EXPRESSION,
  SETTINGS_REMOVE_EXPRESSION,
  MASCOT_REMOVE_EXPRESSION,
  SUGGESTER_REMOVE_EXPRESSION,
  HOME_STUDIO_REMOVE_EXPRESSION,
  TELEMETRY_REMOVE_EXPRESSION,
  EFFORT_SLIDER_REMOVE_EXPRESSION,
  WORKBENCH_ENHANCER_REMOVE_EXPRESSION,
  CONTEXT_MENU_REMOVE_EXPRESSION,
  CHANNEL_TEARDOWN_MAP,
};
