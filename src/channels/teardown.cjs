// 全量卸载清理表达式（REMOVE_EXPRESSION）与磁盘数据清理白名单（与 install-manifest.cjs 严格对齐）
'use strict';

const { STYLE_ID, LEGACY_STYLE_ID } = require('../config/schema.cjs');
const channelTeardowns = require('./channel-teardowns.cjs');

// 与 src/platform/install-manifest.cjs 中 PURGE_DATA_FILES 保持完全一致
const PURGE_DATA_FILES = Object.freeze([
  'obsidian-prism-config.backup.json',
  'obsidian-prism-thought.json',
  'obsidian-prism-thought-cache.json',
  'obsidian-prism-usage-rollup-cache.json',
  'obsidian-prism-storage-guard-state.json',
  'obsidian-prism-sidebar.json',
  'obsidian-prism-sidebar.json.lock',
  'obsidian-prism-wallpaper.json',
  'obsidian-prism-suggester.json',
]);

const REMOVE_EXPRESSION = `(() => {
  const _hadStyleOrRt = Boolean(document.getElementById?.(${JSON.stringify(STYLE_ID)}) || window.__agPrism || window.__agClaudeStyle || window.__agPrismCssMgr);
  try {
    document.querySelectorAll?.('#ag-prism-wallpaper-root video')?.forEach?.((v) => {
      try { v.pause?.(); } catch {}
      try { v.removeAttribute?.('src'); } catch {}
      try { v.src = ''; } catch {}
      try { v.load?.(); } catch {}
    });
  } catch (e) {}
  try { (window.__agPrismWallpaper || globalThis.__agPrismWallpaper)?.destroy?.(); } catch (e) {}
  try { (window.__agPrismSuggester || globalThis.__agPrismSuggester)?.destroy?.(); } catch (e) {}
  try { document.querySelector?.('[data-testid="prism-suggester-slot"]')?.__agPrismSgUiHandle?.destroy?.(); } catch (e) {}
  try { window.__agPrismInlineDiff?.destroy?.(); } catch (e) {}
  try {
    if (window.__agPrismTelemetry && typeof window.__agPrismTelemetry.destroy === 'function') {
      window.__agPrismTelemetry.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismEffortSlider && typeof window.__agPrismEffortSlider.destroy === 'function') {
      window.__agPrismEffortSlider.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismThought && typeof window.__agPrismThought.destroy === 'function') {
      window.__agPrismThought.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismOmni && typeof window.__agPrismOmni.destroy === 'function') {
      window.__agPrismOmni.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismSidebar && typeof window.__agPrismSidebar.destroy === 'function') {
      window.__agPrismSidebar.destroy({ preserveRuntimeState: false });
    }
  } catch (e) {}
  try {
    if (window.__agPrismHostI18n && typeof window.__agPrismHostI18n.destroy === 'function') {
      window.__agPrismHostI18n.destroy();
    }
  } catch (e) {}
  try {
    if (window.__agPrismPeriodicStub && typeof window.__agPrismPeriodicStub.destroy === 'function') {
      window.__agPrismPeriodicStub.destroy();
    }
    if (window.__agPrismPeriodicPicker && typeof window.__agPrismPeriodicPicker.destroy === 'function') {
      window.__agPrismPeriodicPicker.destroy();
    }
    document
      .querySelectorAll?.('#ag-prism-periodic-stub-css, #ag-prism-periodic-picker-css, #ag-prism-periodic-picker-root, .ag-pp-hold-ring, .ag-pp-mini-keycap')
      .forEach((n) => n.remove());
  } catch (e) {}
  try {
    window.__agPrismContextMenu?.destroy?.();
  } catch (e) {}
  try {
    (window.__agPrismMascotHop || globalThis.__agPrismMascotHop)?.dispose?.();
  } catch (e) {}
  if (Array.isArray(globalThis.__agCsCleanups)) {
    while (globalThis.__agCsCleanups.length) {
      const fn = globalThis.__agCsCleanups.pop();
      try {
        if (typeof fn === 'function') fn();
      } catch (e) {}
    }
  }
  delete globalThis.__agCsCleanups;
  try { (window.__agPrismDomBus || globalThis.__agPrismDomBus)?.dispose?.(document, window); } catch (e) {}
  try { (window.__agPrismFontCustomizer || globalThis.__agPrismFontCustomizer)?.dispose?.(document); } catch (e) {}
  try { (window.__agPrismReducedMotionGuard || globalThis.__agPrismReducedMotionGuard)?.dispose?.(document); } catch (e) {}
  try { (window.__agPrismSettingsExtBeta4 || globalThis.__agPrismSettingsExtBeta4)?.dispose?.(document); } catch (e) {}
  try { (window.__agPrismRippleWorker || globalThis.__agPrismRippleWorker)?.disposeAll?.(); } catch (e) {}
  try {
    if (window.__agPrism && typeof window.__agPrism.destroy === 'function') {
      window.__agPrism.destroy();
    } else if (window.__agClaudeStyle && typeof window.__agClaudeStyle.destroy === 'function') {
      window.__agClaudeStyle.destroy();
    }
  } catch (e) {}
  if (window.__agCsI18n && typeof window.__agCsI18n.destroy === 'function') {
    window.__agCsI18n.destroy();
  }
  try {
    if (window.__agPrismRepoBridge && typeof window.__agPrismRepoBridge.dispose === 'function') {
      window.__agPrismRepoBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismThoughtBridge && typeof window.__agPrismThoughtBridge.dispose === 'function') {
      window.__agPrismThoughtBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismUsageBridge && typeof window.__agPrismUsageBridge.dispose === 'function') {
      window.__agPrismUsageBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismOmniBridge && typeof window.__agPrismOmniBridge.dispose === 'function') {
      window.__agPrismOmniBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismSidebarBridge && typeof window.__agPrismSidebarBridge.dispose === 'function') {
      window.__agPrismSidebarBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismWallpaperBridge && typeof window.__agPrismWallpaperBridge.dispose === 'function') {
      window.__agPrismWallpaperBridge.dispose();
    }
  } catch (e) {}
  try {
    if (window.__agPrismSuggesterBridge && typeof window.__agPrismSuggesterBridge.dispose === 'function') {
      window.__agPrismSuggesterBridge.dispose();
    }
  } catch (e) {}
  delete window.__agPrism;
  delete window.__agClaudeStyle;
  delete window.__agPrismTelemetry;
  delete window.__agPrismEffortSlider;
  delete window.__agPrismThought;
  delete window.__agPrismThoughtSettingsUi;
  delete window.__agPrismOmni;
  delete window.__agPrismOmniBridge;
  delete window.__agPrismOmniResolve;
  delete window.__agPrismOmniServerMeta;
  try { delete window.__agPrismOmniBootCfg; delete globalThis.__agPrismOmniBootCfg; } catch {}
  try { delete window.__agPrismOmniDisableAutoBoot; delete globalThis.__agPrismOmniDisableAutoBoot; } catch {}
  delete window.__agPrismSidebar;
  delete window.__agPrismSidebarBridge;
  delete window.__agPrismSidebarResolve;
  delete window.__agPrismSidebarMeta;
  for (const k of ['__agPrismSidebarHostOps', '__agPrismSidebarLastSendError', '__agPrismSidebarLastStartStage', '__agPrismSidebarLastStartFallback', '__agPrismSidebarLastSendFallback']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  delete window.__agPrismMetricsResolve;
  try { delete window.__agPrismMetricsBridge; delete globalThis.__agPrismMetricsBridge; } catch {}
  delete window.__agPrismRepoBridge;
  delete window.__agPrismRepoResolve;
  delete window.__agPrismThoughtBridge;
  delete window.__agPrismThoughtOnChunk;
  delete window.__agPrismThoughtResolve;
  delete window.__agPrismUsageBridge;
  delete window.__agPrismUsageResolve;
  try { delete window.__agPrismInlineDiff; } catch {}
  try { delete window.__agPrismInlineDiffFactory; } catch {}
  try { delete window.__agPrismInlineDiffResolve; } catch {}
  try { delete window.__agPrismResolveInlineDiff; delete globalThis.__agPrismResolveInlineDiff; } catch {}
  try { delete window.__agPrismWallpaper; } catch {}
  try { delete window.__agPrismWallpaperFactory; } catch {}
  try { delete window.__agPrismWallpaperSettingsUi; } catch {}
  try { delete window.__prismMountWallpaperUi; } catch {}
  try { delete window.__agPrismWallpaperBridge; } catch {}
  try { delete window.__agPrismWallpaperResolve; } catch {}
  try { delete window.__agPrismSuggester; } catch {}
  try { delete window.__agPrismSuggesterFactory; } catch {}
  try { delete window.__agPrismSuggesterSettingsUi; } catch {}
  try { delete window.__prismMountSuggesterUi; } catch {}
  try { delete window.__agPrismSuggesterBridge; } catch {}
  try { delete window.__agPrismSuggesterResolve; } catch {}
  delete window.__agPrismBrandLogoSvg;
  delete window.__agPrismHostI18n;
  delete window.__agPrismHostI18nFactory;
  delete window.__agPrismPeriodicPicker;
  delete window.__agPrismPeriodicPickerFactory;
  delete window.__agPrismKeyboard3D;
  delete window.__agPrismPeriodicKeyboard3D;
  delete window.__agPrismOledScreen;
  delete window.__agPrismGrainAssets;
  for (const k of ['__agPrismPeriodicStub', '__agPrismPeriodicStubFactory', '__agPeriodicPendingOpen', '__agPeriodicFullLoaded', '__agPeriodicStubHash', '__agPeriodicAudioFx', '__agPeriodicModelCatalog', '__agPeriodicHostBridge', '__agPeriodicMockHost', '__agPeriodicBentoUi', '__agPeriodicPbrGrainAssets', '__agPeriodicOledScreen', '__agPeriodicKeyboard3D']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  try { document.documentElement?.removeAttribute?.('data-ag-pp-holding'); } catch {}
  delete window.__agPrismContextMenu;
  delete window.__agCsI18n;
  delete globalThis.__agSP;
  delete globalThis.__agM;
  delete globalThis.__agPrismBrandLogoSvg;
  delete globalThis.__agPrismHostI18n;
  delete globalThis.__agPrismHostI18nFactory;
  delete globalThis.__agPrismHostI18nReversePatterns;
  delete globalThis.__agPrismPeriodicPicker;
  delete globalThis.__agPrismPeriodicPickerFactory;
  delete globalThis.__agPrismKeyboard3D;
  delete globalThis.__agPrismPeriodicKeyboard3D;
  delete globalThis.__agPrismOledScreen;
  delete globalThis.__agPrismGrainAssets;
  delete globalThis.__agPrismContextMenu;
  delete globalThis.__agPrismTelemetry;
  delete globalThis.__agPrismEffortSlider;
  delete globalThis.__agPrismThought;
  delete globalThis.__agPrismInlineDiff;
  delete globalThis.__agPrismInlineDiffFactory;
  delete globalThis.__agPrismWallpaper;
  delete globalThis.__agPrismWallpaperFactory;
  delete globalThis.__agPrismWallpaperSettingsUi;
  delete globalThis.__prismMountWallpaperUi;
  delete globalThis.__agPrismWallpaperBridge;
  delete globalThis.__agPrismWallpaperResolve;
  delete globalThis.__agPrismSuggester;
  delete globalThis.__agPrismSuggesterFactory;
  delete globalThis.__agPrismSuggesterSettingsUi;
  delete globalThis.__prismMountSuggesterUi;
  delete globalThis.__agPrismSuggesterBridge;
  delete globalThis.__agPrismSuggesterResolve;
  delete globalThis.__agPrismOmni;
  delete globalThis.__agPrismSidebar;
  delete globalThis.__agPrismThoughtSettingsUi;
  delete globalThis.__agPrismSettingsPanel;
  try { delete window.__agPrismHomeStudioPanel; } catch {}
  try { delete window.__agHomeStudioPanel; } catch {}
  delete globalThis.__agPrismHomeStudioPanel;
  delete globalThis.__agHomeStudioPanel;
  delete globalThis.__agPrismHomeRippleHost;
  delete globalThis.__agPrismModelGlyphCrystal;
  delete globalThis.__agPrismStreamChoreography;
  delete globalThis.__agPrismRimCanvas;
  delete globalThis.__agPrismHostEnhancer;
  delete globalThis.__agPrismConvAura;
  delete globalThis.__agPrismSmoothCaret;
  for (const k of ['__agPrismSvgUtil', '__agPrismRipple', '__agRippleForce2D', '__agPulseExternalBridge']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  delete globalThis.AntigravityCodexEffortSlider;
  delete globalThis.__agCodexEffortSliderDisableAutoBoot;
  delete globalThis.__agCsUiMain;
  delete globalThis.__agDualMascotRig;
  delete globalThis.__agPrismMascotArt;
  try { delete window.__agPrismMascotHop; } catch {}
  try { delete globalThis.__agPrismMascotHop; } catch {}
  delete globalThis.__agCrystalPrismCore;
  delete globalThis.__agVialCore;
  delete globalThis.__agMotionEngine;
  delete globalThis.__agAnimatedIcons;
  delete globalThis.__agCsPulseVialBridge;
  delete globalThis.__agCsRippleCore;
  delete globalThis.__agCsUsageCore;
  delete globalThis.__agCsI18nCore;
  for (const k of ['__agPrismDomBus', '__agPrismPerfCaps', '__agPrismReducedMotion', '__agPrismApplyIgnoreReducedMotion', '__agPrismReducedMotionGuard', '__agPrismFontCustomizer', '__agPrismI18nExtBeta4', '__agPrismSettingsExtBeta4', '__agPrismRippleWorker']) {
    try { delete window[k]; } catch {}
    try { delete globalThis[k]; } catch {}
  }
  delete globalThis.__agCsLocales;
  const root = document.documentElement;
  if (root) {
    [
      'data-ag-prism',
      'data-ag-cs-style',
      'data-ag-cs-theme',
      'data-ag-cs-palette',
      'data-ag-cs-light-preset',
      'data-ag-cs-motion',
      'data-ag-cs-ignore-rm',
      'data-ag-cs-perf-mode',
      'data-ag-perf-busy',
      'data-ag-cs-stream-active',
      'data-ag-cs-target-fps',
      'data-ag-cs-telemetry',
      'data-ag-cs-effort-slider',
      'data-ces-slider-ready',
      'data-ag-cs-thought-translate',
      'data-ag-prism-thought-owner',
      'data-ag-cs-home',
      'data-ag-cs-composer',
      'data-ag-cs-logo-ink',
      'data-ag-cs-sidebar',
      'data-ag-cs-sidebar-compact',
      'data-ag-cs-sidebar-collapsed',
      'data-ag-cs-sb-fold',
      'data-ag-cs-has-crab',
      'data-ag-cs-model-menu',
      'data-ag-cs-takeover-open',
      'data-ag-cs-lang',
      'data-ag-prism-lang',
      'data-ag-prism-lang-owned',
      'data-ag-cs-cjk',
      'data-ag-cs-effort-accent',
      'data-ag-cs-perf-backdrop',
      'data-ag-cs-accent',
      'data-ag-cs-corners',
      'data-ag-cs-chat-font',
      'data-ag-cs-code-font',
      'data-ag-cs-ligatures',
      'data-ag-cs-ambient',
      'data-ag-cs-dark-aura',
      'data-ag-cs-dark-aura-style',
      'data-ag-prism-thought-view',
      'data-ag-prism-omni',
      'data-ag-prism-link-target',
      'data-ag-prism-sidebar-studio',
      'data-ag-prism-host-i18n',
      'data-ag-prism-periodic-picker',
      'data-ag-pp-open',
      'data-ag-prism-mode',
      'data-ag-prism-chat-kind',
      'data-ag-prism-chat-telemetry',
      'data-ag-prism-sidebar-host-sync',
      'data-ag-prism-sidebar-space',
      'data-ag-prism-scope',
      'data-ag-cs-space',
      'data-ag-cs-space-palette',
      'data-ag-cs-space-accent',
      'data-ag-cs-win-blur',
      'data-ag-cs-scroll-bottom',
      'data-ag-cs-resizing',
      'data-ag-cs-mascot-drag',
      'data-ag-prism-wallpaper',
      'data-ag-prism-wallpaper-hole',
      'data-ag-prism-suggester',
    ].forEach((attr) => root.removeAttribute(attr));
    // Note: Intentionally do NOT remove documentElement[data-theme] — Prism only reads it for host light/dark detection and never writes it to <html>.
    if (root.getAttribute('data-ag-cjk') === '1') root.removeAttribute('data-ag-cjk');
    if (root.style && typeof root.style.removeProperty === 'function') {
      root.style.removeProperty('--ag-spring-sidebar-ease');
      root.style.removeProperty('--ag-spring-sidebar-dur');
      ['--ag-prism-wp-opacity', '--ag-prism-wp-blur', '--ag-prism-wp-blur-pad', '--ag-prism-wp-dim', '--ag-prism-wp-fit'].forEach((p) =>
        root.style.removeProperty(p)
      );
    }
  }
  const chunkParents = new Set();
  Array.from(document.querySelectorAll('.ag-cs-stream-chunk, .ag-cs-thought-chunk, .ag-cs-code-scan'))
    .reverse()
    .forEach((el) => {
      const p = el.parentNode;
      if (el.classList) {
        el.classList.remove('ag-cs-stream-chunk', 'ag-cs-thought-chunk', 'ag-cs-code-scan');
      }
      const isPureSpan =
        el.tagName === 'SPAN' &&
        (!el.classList || el.classList.length === 0) &&
        (!el.attributes ||
          Array.from(el.attributes).every(
            (a) => a.name === 'class' || a.name.startsWith('data-ag-cs-')
          ));
      if (isPureSpan && p) {
        while (el.firstChild) p.insertBefore(el.firstChild, el);
        el.remove();
        chunkParents.add(p);
      } else {
        if (el.getAttribute && el.getAttribute('class') === '') el.removeAttribute('class');
        if (typeof el.normalize === 'function') el.normalize();
      }
    });
  chunkParents.forEach((p) => {
    if (p && typeof p.normalize === 'function') p.normalize();
  });
  document.querySelectorAll('[data-ag-cs-icon-injected]').forEach((btn) => {
    btn.querySelectorAll('.ag-anim-icon').forEach((ic) => ic.remove());
    btn.querySelectorAll('[data-ag-cs-orig-svg]').forEach((svg) => {
      svg.hidden = false;
      svg.removeAttribute('hidden');
      svg.removeAttribute('data-ag-cs-orig-svg');
    });
    btn.removeAttribute('data-ag-cs-icon-injected');
  });
  document.querySelectorAll('[data-ag-row-stagger]').forEach((el) => {
    if (el.style && typeof el.style.removeProperty === 'function') {
      el.style.removeProperty('--ag-row-i');
    }
  });
  document.querySelectorAll('[data-ag-cs-overview-shell]').forEach((el) => {
    el.removeAttribute('data-ag-cs-overview-shell');
    if (el.style && typeof el.style.removeProperty === 'function') {
      el.style.removeProperty('--ag-origin-x');
      el.style.removeProperty('--ag-origin-y');
    }
  });
  [
    'data-ag-cs-caustic',
    'data-ag-cs-fiber-camp',
    'data-ag-cs-sonar',
    'data-ag-cs-stage-glide',
    'data-ag-cs-liftoff-bubble',
    'data-ag-cs-thought-streaming',
    'data-ag-cs-spark-streaming',
    'data-ag-cs-prism-cv',
    'data-ag-cs-prism-mirror',
    'data-ag-cs-prism-reflect',
    'data-ag-cs-settings-dlg',
    'data-ag-cs-settings-nav',
    'data-ag-cs-nav-active',
    'data-ag-cs-code-folded',
    'data-ag-cs-aux-dual',
    'data-ag-cs-model-overlay',
    'data-ag-cs-model-submenu',
    'data-ag-cs-orch-l2',
    'data-ag-cs-orch-l3',
    'data-ces-orch-row',
    'data-ces-model-selected',
    'data-ag-cs-row-running',
    'data-ag-row-stagger',
    'data-ces-orch-b',
    'data-ces-orch-tunable',
    'data-pv-warn',
    'data-ag-inline-diff-open',
    'data-ag-inline-diff-host',
    'data-ag-sb-more-hidden',
    'data-ag-sb-more-item',
    'data-ag-scrolling',
    'data-ag-diff-chip',
    'data-ag-diff-chip-file',
    'data-ag-diff-chip-row',
    'data-ag-diff-stat',
    'data-ag-perm-selected',
    'data-ag-perm-sandbox-sep',
    'data-ag-sub-running',
    'data-ag-sub-sec-running',
    'data-ag-overview-running',
    'data-ag-queued-act',
    'data-ag-ov-sec-anim',
    'data-ag-ov-sec-closing',
    'data-ag-diff-anim',
    'data-ag-diff-state',
    'data-ag-cs-inline-diff',
    'data-ag-prism-scope',
    'data-ag-cs-crab-anchor',
    'data-ag-mascot-hop',
    'data-ag-mascot-hop-mode',
    'data-ag-mascot-hop-self',
    'data-ag-sp-running',
    'data-ag-cs-queued',
    'data-ag-cs-conv-seat',
    'data-ag-cs-home-sheet',
    'data-ag-cs-input-layer',
    'data-ag-cs-vp-wrap',
  ].forEach((attr) => {
    document.querySelectorAll('[' + attr + ']').forEach((el) => el.removeAttribute(attr));
  });
  document.querySelectorAll('.ag-cs-inline-diff-box, .ag-cs-diff-ctx-menu, .ag-cs-sb-more-wrap').forEach((n) => n.remove());
  document.querySelectorAll('[data-ag-cs-top-toolbar]').forEach((el) => {
    el.removeAttribute('data-ag-cs-top-toolbar');
    if (el.style && typeof el.style.removeProperty === 'function') {
      el.style.removeProperty('margin-bottom');
    }
  });
  document.querySelectorAll('[data-ag-cs-prism-box]').forEach((el) => {
    el.removeAttribute('data-ag-cs-prism-box');
    if (el.style && typeof el.style.removeProperty === 'function') {
      el.style.removeProperty('--ag-px');
      el.style.removeProperty('--ag-py');
    }
  });
  document.querySelectorAll('[data-ag-cs-orch-active]').forEach((el) => el.removeAttribute('data-ag-cs-orch-active'));
  document.querySelectorAll('[data-ag-cs-auto-unfolded]').forEach((el) => el.removeAttribute('data-ag-cs-auto-unfolded'));
  document.querySelectorAll('[data-ag-prism-ghost-active]').forEach((el) => {
    el.removeAttribute('data-ag-prism-ghost-active');
    if (el.style && typeof el.style.removeProperty === 'function') {
      el.style.removeProperty('--ag-prism-ghost-min-h');
    }
  });
  // Only remove Prism-owned fallback nodes & styles; NEVER touch external Pulse or external Effort Slider instances!
  document.querySelectorAll('[data-ag-prism-fallback="1"]').forEach((n) => n.remove());
  if (typeof window !== 'undefined' && window && !window.__agPulseDispose) {
    if (window.__agPulseInlineInstalled === true) {
      window.__agPulseInlineInstalled = false;
    }
    try { window.__agPulseRuntimeBridge?.dispose?.(); } catch {}
    try { delete window.__agPulseRuntimeBridge; } catch {}
    try { delete globalThis.__agPulseRuntimeBridge; } catch {}
    try { delete window.__agPulseRuntimeOwner; } catch {}
    try { delete globalThis.__agPulseRuntimeOwner; } catch {}
  }
  document.querySelectorAll('[data-ag-prism-hidden="1"]').forEach((hiddenExtPulse) => {
    hiddenExtPulse.removeAttribute('data-ag-prism-hidden');
    const st = hiddenExtPulse.style;
    if (st) {
      if (typeof st.removeProperty === 'function') {
        ['display', 'position', 'left', 'top', 'width', 'height', 'opacity', 'pointer-events', 'visibility', 'overflow'].forEach((p) =>
          st.removeProperty(p)
        );
      } else {
        st.display = '';
        st.position = '';
        st.left = '';
        st.top = '';
        st.width = '';
        st.height = '';
        st.opacity = '';
        st.pointerEvents = '';
        st.visibility = '';
        st.overflow = '';
      }
    }
  });
  try {
    if (typeof CSS !== 'undefined' && CSS && CSS.highlights && typeof CSS.highlights.delete === 'function') {
      ['ag-stream-f0', 'ag-stream-f1', 'ag-stream-f2', 'ag-stream-f3', 'ag-stream-f4'].forEach((k) => CSS.highlights.delete(k));
      if (typeof CSS.highlights.keys === 'function') {
        for (const k of Array.from(CSS.highlights.keys())) {
          if (typeof k === 'string' && k.startsWith('ag-omni-')) CSS.highlights.delete(k);
        }
      }
    }
  } catch (e) {}
  const prismSliderStyle = document.querySelector('#ag-codex-effort-slider-styles[data-ag-prism-slider="1"]');
  if (prismSliderStyle) prismSliderStyle.remove();
  const prismHideSlider = document.getElementById('ag-prism-effort-slider-hide');
  if (prismHideSlider) prismHideSlider.remove();
  document.querySelectorAll('style[data-ag-turbo-dedup]').forEach((s) => {
    s.disabled = false;
    try { if (s.sheet) s.sheet.disabled = false; } catch (e) {}
    s.removeAttribute('data-ag-turbo-dedup');
  });
  document.querySelectorAll('img[data-ag-turbo-img]').forEach((img) => img.removeAttribute('data-ag-turbo-img'));
  const nodes = document.querySelectorAll(
    '#' + ${JSON.stringify(STYLE_ID)} +
    ', #' + ${JSON.stringify(LEGACY_STYLE_ID)} +
    ', #ag-prism-host-alert-css, #ag-prism-mascot-hop-style, .ag-prism-mascot-hop-layer, #ag-prism-custom-fonts-style, #ag-prism-settings-ext-beta4-css, #ag-prism-local-fonts-list, #ag-prism-settings-v101-css, #ag-prism-studio-v101-css, #ag-prism-omni-css, #ag-prism-sidebar-studio-css, #ag-prism-periodic-stub-css, #ag-prism-periodic-picker-css, #ag-prism-periodic-picker-root, .ag-pp-hold-ring, .ag-pp-mini-keycap, #ag-prism-inline-diff-css, #ag-prism-wallpaper-root, #ag-prism-wallpaper-css, #ag-prism-suggester-css, #ag-prism-model-dd-css, [data-testid="prism-suggest-trigger"], [data-testid="prism-ghost-overlay"], #ag-prism-storage-guard, #ag-prism-storage-guard-css, #ag-cs-settings-sec, [data-testid="prism-thought-ai-config"], [data-testid="prism-thought-general-config"], .ag-omni-dock, .ag-omni-menu, .ag-prism-omni-menu, .ag-prism-omni-pane, [data-ag-prism-omni-owned="1"], [data-ag-prism-sidebar-owned="1"], .ag-prism-sidebar-studio, .ag-prism-sidebar-rail, .ag-prism-sidebar-popover, .ag-prism-sidebar-modal, .ag-cs-home-panel, .ag-cs-home-panel-seat, .ag-cs-ripple-layer, .ag-cs-ripple-host, .ag-cs-conv-aura-host, .ag-cs-crab, .ag-cs-dual-stage, .ag-cs-crab-stage, .ag-cs-mascot-stage, .ag-cs-mascot, .ag-v2-mascot-stage, .ag-v2-habitat-prop, .ag-cs-crystal-bar, [data-testid="orchestrator-effort-bar"], .ag-cs-prism-rim-cv, .ag-cs-code-fold-btn, .ag-cs-nav-outline-popover, .ag-cs-nav-outline-trigger, .ag-cs-smooth-caret, .ag-cs-perf-backdrop, .ag-cs-ctx-menu, .ag-cs-ctx-toast'
  );
  nodes.forEach((n) => n.remove());
  return { removed: nodes.length || (_hadStyleOrRt ? 1 : 0) };
})()`;

function getChannelTeardownExpression(channelId) {
  return channelTeardowns.CHANNEL_TEARDOWN_MAP[channelId] || '';
}

module.exports = {
  ...channelTeardowns,
  PURGE_DATA_FILES,
  REMOVE_EXPRESSION,
  getChannelTeardownExpression,
};
