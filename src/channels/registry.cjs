// 声明式多通道微内核注册表（全仓 16 通道唯一真相源：CHANNEL_REGISTRY / 磁盘缓存格式 / 探针片段 / 打包清单 / 预算报表）
'use strict';

const { reconcileConfigAliases } = require('../config/schema.cjs');
const { CHANNEL_TEARDOWN_MAP } = require('./channel-teardowns.cjs');

// Ch8 3D 元素周期表模块文件清单（唯一声明源，打破 registry <-> builders-studio 环依赖）
const PERIODIC_PICKER_MODULE_FILES = Object.freeze([
  'pbr-grain-assets.js',
  'audio-fx.js',
  'model-catalog.js',
  'host-bridge.js',
  'oled-cyber-screen.js',
  'keyboard-3d-gl.js',
  'bento-ui.js',
  'periodic-picker.js',
]);

function cap(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function makeStandardFields(id, overrides = {}) {
  const C = cap(id);
  return Object.freeze({
    exprField: `${id}Expr`,
    hashField: `${id}CodeHash`,
    hashSrcField: `_${id}HashSource`,
    scriptField: `${id}ScriptId`,
    mountedField: `${id}Mounted`,
    sigField: `last${C}Sig`,
    scriptSigField: `last${C}ScriptSig`,
    skippedField: null,
    bindingAddedField: null,
    probeHasField: `has${C}`,
    probeHashField: `${id}CodeHash`,
    cdpShouldFn: `shouldEnable${C}`,
    cdpBuildFn: `build${C}ChannelExpression`,
    cdpRemoveConst: `${id.replace(/([A-Z])/g, '_$1').toUpperCase()}_REMOVE_EXPRESSION`,
    ...overrides,
  });
}

function defineSpec(cfg) {
  const probeExpr = Array.isArray(cfg.probeLines) ? cfg.probeLines.join(',\n    ') : String(cfg.probeExpr || '');
  return Object.freeze({
    id: cfg.id,
    cacheKey: cfg.cacheKey || cfg.id,
    cacheFormat: cfg.cacheFormat || 'minRuntime',
    channel: cfg.channelNumber,
    channelNumber: cfg.channelNumber,
    order: cfg.order,
    tier: cfg.tier,
    injectMode: cfg.injectMode || 'main-page-persistent',
    precompileOnBoot: cfg.precompileOnBoot !== false,
    topLevelPack: Boolean(cfg.topLevelPack),
    staticRuntimePack: Boolean(cfg.staticRuntimePack),
    label: cfg.label,
    configKeys: Object.freeze(cfg.configKeys || []),
    files: Object.freeze(cfg.files || []),
    mountGlobal: cfg.mountGlobal,
    bindingConst: cfg.bindingConst || null,
    probeKey: cfg.probeKey !== undefined ? cfg.probeKey : `has${cap(cfg.id)}`,
    probeHashKey: cfg.probeHashKey !== undefined ? cfg.probeHashKey : `${cfg.id}CodeHash`,
    probeExtraKeys: Object.freeze(cfg.probeExtraKeys || []),
    probeExpr,
    hashMode: cfg.hashMode || 'targetHash',
    respectSkippedByLiveCfg: Boolean(cfg.respectSkippedByLiveCfg),
    tracksSkippedNonHost: Boolean(cfg.tracksSkippedNonHost),
    budgetBytes: cfg.budgetBytes,
    fields: makeStandardFields(cfg.id, cfg.fieldOverrides || {}),
    defaultShouldEnable: cfg.defaultShouldEnable,
    cfgSig: cfg.cfgSig,
  });
}

// 静态元数据清单（全部 16 条延迟/按需通道 Ch2~Ch16 唯一真相源）
const CHANNEL_STATIC_SPECS = Object.freeze([
  defineSpec({
    id: 'omni', cacheFormat: 'minCode', channelNumber: 2, order: 20, tier: 'core', topLevelPack: true,
    label: 'Omni File Viewer', configKeys: ['omniModule', 'linkTarget'],
    files: ['vendor/omni-viewer/omni-client.js'], mountGlobal: '__agPrismOmni', bindingConst: 'OMNI_BINDING',
    probeHashKey: '', probeExtraKeys: ['hasOmniBridge', 'hasOmniServerMeta'], hashMode: 'none', budgetBytes: 80 * 1024,
    probeLines: [
      "hasOmniBridge: Boolean(window.__agPrismOmniBridge && typeof window.__agPrismOmniBridge.call === 'function')",
      'hasOmniServerMeta: Boolean(window.__agPrismOmniServerMeta && window.__agPrismOmniServerMeta.baseUrl && window.__agPrismOmniServerMeta.token)',
      'hasOmni: Boolean(window.__agPrismOmni)',
      'omniMode',
    ],
    fieldOverrides: {
      hashField: '', hashSrcField: '', mountedField: '', sigField: 'lastOmniExpr', scriptSigField: 'lastOmniExpr',
      bindingAddedField: 'omniBindingAdded',
      probeHashField: '', cdpShouldFn: '', cdpBuildFn: 'buildOmniClientExpression', cdpRemoveConst: 'OMNI_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: (cfg) => cfg?.omniModule !== 'off' && cfg?.omniModule !== false,
    cfgSig: (cfg) => (cfg?.omniModule === 'off' || cfg?.omniModule === false ? 'off' : String(cfg?.omniModule || 'on')),
  }),
  defineSpec({
    id: 'sidebar', cacheFormat: 'minCode', channelNumber: 3, order: 30, tier: 'core', topLevelPack: true,
    label: 'Sidebar Studio', configKeys: ['sidebarStudio'],
    files: ['vendor/sidebar-studio/sidebar-client.js'], mountGlobal: '__agPrismSidebar', bindingConst: 'SIDEBAR_BINDING',
    probeHashKey: '', probeExtraKeys: ['hasSidebarBridge'], hashMode: 'none', budgetBytes: 144 * 1024,
    probeLines: [
      "hasSidebarBridge: Boolean(window.__agPrismSidebarBridge && typeof window.__agPrismSidebarBridge.call === 'function')",
      'hasSidebar: Boolean(window.__agPrismSidebar)',
      'sidebarMode',
    ],
    fieldOverrides: {
      hashField: '', hashSrcField: '', sigField: '', scriptSigField: '', bindingAddedField: 'sidebarBindingAdded',
      probeHashField: '', cdpShouldFn: '', cdpBuildFn: 'buildSidebarStudioExpression', cdpRemoveConst: 'SIDEBAR_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: (cfg) => cfg?.sidebarStudio === 'on',
    cfgSig: (cfg) => (cfg?.sidebarStudio === 'on' ? 'on' : 'off'),
  }),
  defineSpec({
    id: 'hostI18n', cacheFormat: 'runtimeAndDict', channelNumber: 4, order: 40, tier: 'i18n',
    label: 'Host UI Localization', configKeys: ['hostLocalization', 'language'],
    files: ['vendor/host-i18n/reverse-patterns.js', 'vendor/host-i18n/host-i18n-runtime.js', 'vendor/host-i18n/zh-CN.json', 'vendor/host-i18n/tr.json'],
    mountGlobal: '__agPrismHostI18n', respectSkippedByLiveCfg: true, budgetBytes: 560 * 1024,
    probeLines: [
      'hasHostI18n: Boolean(window.__agPrismHostI18n)',
      "hostI18nMode: String(window.__agPrismHostI18n?.getStatus?.()?.mode || '')",
      "hostI18nCodeHash: String(window.__agPrismHostI18n?.__prismCodeHash || '')",
    ],
    fieldOverrides: {
      hashField: '', hashSrcField: '', cdpShouldFn: 'shouldEnableHostI18n',
      cdpBuildFn: 'buildHostI18nExpression', cdpRemoveConst: 'HOST_I18N_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: () => false,
    cfgSig: (cfg) => `${cfg?.hostLocalization || 'auto'}:${cfg?.language || cfg?.lang || 'auto'}`,
  }),
  defineSpec({
    id: 'swarmI18n', cacheFormat: 'runtimeAndDict', channelNumber: 4.5, order: 45, tier: 'i18n',
    injectMode: 'oopif-swarm', precompileOnBoot: false,
    label: 'Swarm Board Localization', configKeys: ['hostLocalization', 'language'],
    files: ['vendor/host-i18n/swarm-i18n-runtime.js', 'vendor/host-i18n/swarm-zh-CN.json', 'vendor/host-i18n/swarm-tr.json'],
    mountGlobal: '__agPrismSwarmI18n', probeKey: '', probeHashKey: '', probeExpr: '', budgetBytes: 48 * 1024,
    fieldOverrides: {
      hashSrcField: '', scriptField: '', mountedField: '', sigField: '', scriptSigField: '',
      probeHasField: '', probeHashField: '', cdpShouldFn: 'shouldEnableSwarmI18n',
      cdpBuildFn: 'buildSwarmI18nExpression', cdpRemoveConst: 'SWARM_I18N_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: () => false,
    cfgSig: (cfg) => `${cfg?.hostLocalization || 'auto'}:${cfg?.language || cfg?.lang || 'auto'}`,
  }),
  defineSpec({
    id: 'thought', cacheFormat: 'clientAndUi', channelNumber: 5, order: 50, tier: 'addon', topLevelPack: true,
    label: 'Thought Stream Translator', configKeys: ['thoughtTranslate', 'thoughtTrigger', 'thoughtView'],
    files: [
      'vendor/thought-translator/tool-step-verbs.js',
      'vendor/thought-translator/thought-client.js',
      'vendor/thought-translator/thought-settings-ui.js',
    ],
    mountGlobal: '__agPrismThought', bindingConst: 'THOUGHT_BINDING',
    probeHashKey: '', probeExtraKeys: ['hasThoughtSettingsUi'], hashMode: 'sha256', budgetBytes: 160 * 1024,
    probeLines: [
      'hasThought: Boolean(window.__agPrismThought)',
      'hasThoughtSettingsUi: Boolean(window.__agPrismThoughtSettingsUi)',
    ],
    fieldOverrides: {
      bindingAddedField: 'thoughtBindingAdded',
      probeHashField: '', cdpShouldFn: 'shouldEnableThought',
      cdpBuildFn: 'buildThoughtExpression', cdpRemoveConst: 'THOUGHT_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: (cfg) => {
      const m = typeof cfg?.thoughtTranslate === 'string' ? cfg.thoughtTranslate.trim().toLowerCase() : 'off';
      return Boolean(m && m !== 'off');
    },
    cfgSig: (cfg) => {
      const m = typeof cfg?.thoughtTranslate === 'string' ? cfg.thoughtTranslate.trim().toLowerCase() : 'off';
      return m && m !== 'off' ? `1:${m}` : '';
    },
  }),
  defineSpec({
    id: 'inlineDiff', cacheFormat: 'minCode', channelNumber: 6, order: 60, tier: 'core', topLevelPack: true,
    label: 'Inline Diff Preview', files: ['vendor/inline-diff/inline-diff-client.js'],
    mountGlobal: '__agPrismInlineDiff', bindingConst: 'INLINE_DIFF_BINDING',
    probeHashKey: '', tracksSkippedNonHost: true, budgetBytes: 56 * 1024,
    probeExpr: 'hasInlineDiff: Boolean(window.__agPrismInlineDiff && !window.__agPrismInlineDiff.getDebugState?.()?.destroyed)',
    fieldOverrides: {
      sigField: 'lastInlineDiffHash', scriptSigField: 'lastInlineDiffScriptHash',
      skippedField: 'inlineDiffSkipped', bindingAddedField: 'inlineDiffBindingAdded',
      probeHashField: '', cdpShouldFn: '', cdpBuildFn: 'buildInlineDiffInjectExpression', cdpRemoveConst: 'INLINE_DIFF_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: () => true,
    cfgSig: () => 'on',
  }),
  defineSpec({
    id: 'wallpaper', cacheFormat: 'clientAndUi', channelNumber: 7, order: 70, tier: 'studio', topLevelPack: true,
    label: 'Background Wallpaper Studio',
    files: ['vendor/wallpaper/wallpaper-client.js', 'vendor/wallpaper/wallpaper-settings-ui.js'],
    mountGlobal: '__agPrismWallpaper', bindingConst: 'WALLPAPER_BINDING',
    probeExtraKeys: ['hasWallpaperUi'], tracksSkippedNonHost: true, budgetBytes: 64 * 1024,
    probeLines: [
      'hasWallpaper: Boolean(window.__agPrismWallpaper && !window.__agPrismWallpaper.getDebugState?.()?.destroyed)',
      "hasWallpaperUi: Boolean(typeof window.__prismMountWallpaperUi === 'function')",
      "wallpaperCodeHash: String((window.__agPrismWallpaper || globalThis.__agPrismWallpaper)?.__prismCodeHash || '')",
    ],
    fieldOverrides: {
      sigField: 'lastWallpaperHash', scriptSigField: 'lastWallpaperScriptHash',
      skippedField: 'wallpaperSkipped', bindingAddedField: 'wallpaperBindingAdded',
      cdpShouldFn: '', cdpBuildFn: 'buildWallpaperExpression', cdpRemoveConst: 'WALLPAPER_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: () => true,
    cfgSig: () => 'on',
  }),
  defineSpec({
    id: 'periodicPicker', channelNumber: 8, order: 80, tier: 'studio',
    label: 'Periodic 3D Model Picker', configKeys: ['periodicModelPicker'],
    files: [
      'vendor/periodic-picker/periodic-picker-stub.js',
      ...PERIODIC_PICKER_MODULE_FILES.map((name) => `vendor/periodic-picker/${name}`),
    ],
    mountGlobal: '__agPrismPeriodicPicker', budgetBytes: 820 * 1024,
    probeLines: [
      "hasPeriodicPicker: Boolean((window.__agPrismPeriodicPicker && window.__agPrismPeriodicPicker.getStatus?.()?.status !== 'destroyed' && window.__agPrismPeriodicPicker.getStatus?.()?.status !== 'off') || (window.__agPrismPeriodicStub && window.__agPrismPeriodicStub.getStatus?.()?.status !== 'destroyed' && window.__agPrismPeriodicStub.getStatus?.()?.status !== 'off'))",
      "periodicPickerCodeHash: String((window.__agPeriodicFullLoaded && window.__agPeriodicStubHash) || window.__agPrismPeriodicPicker?.__prismCodeHash || window.__agPrismPeriodicStub?.__prismCodeHash || '')",
    ],
    fieldOverrides: {
      cdpShouldFn: 'shouldEnablePeriodicPicker',
      cdpBuildFn: 'buildPeriodicPickerStubExpression',
      cdpFullBuildFn: 'buildPeriodicPickerExpression',
      cdpRemoveConst: 'PERIODIC_PICKER_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: (cfg) => cfg?.periodicModelPicker !== 'off' && cfg?.periodicModelPicker !== false,
    cfgSig: (cfg) => (cfg?.periodicModelPicker === 'off' || cfg?.periodicModelPicker === false ? 'off' : 'on'),
  }),
  defineSpec({
    id: 'settings', channelNumber: 9, order: 90, tier: 'addon', injectMode: 'on-demand-rpc', precompileOnBoot: false,
    label: 'Settings Panel & Full Locales',
    configKeys: ['language', 'performanceMode', 'ignoreReducedMotion', 'chatFont', 'chatFontCustom', 'codeFont', 'codeFontCustom', 'telemetryQuotaMode'],
    files: [
      'src/runtime/i18n-tr-locale.js', 'i18n-locales.js', 'assets/brand-mark-svg.js', 'vendor/clawd-mascot/tavern-atlas-data.js',
      'vendor/clawd-mascot/octopath-stage-webgl.js', 'src/runtime/i18n-ext-beta4.js',
      'settings-panel.js', 'src/runtime/settings-ext-beta4.js',
    ],
    mountGlobal: '__agPrismSettingsPanel', probeKey: 'hasSettingsPanel',
    probeExtraKeys: ['needsSettingsChannel'], budgetBytes: 500 * 1024,
    probeLines: [
      'hasSettingsPanel: Boolean((window.__agPrismSettingsPanel || globalThis.__agPrismSettingsPanel) && window.__agCsLocales && window.__agCsLocales.__isFullLocales)',
      "hasSettingsDialog: Boolean(document.querySelector('[role=\"dialog\"]') || document.getElementById('ag-cs-settings-sec'))",
      "settingsCodeHash: String((window.__agPrismSettingsPanel || globalThis.__agPrismSettingsPanel)?.__prismCodeHash || '')",
      "needsSettingsChannel: Boolean((document.querySelector('[role=\"dialog\"]') || document.getElementById('ag-cs-settings-sec')) && (!window.__agPrismSettingsPanel || !(window.__agCsLocales && window.__agCsLocales.__isFullLocales)))",
    ],
    fieldOverrides: {
      scriptField: '', mountedField: 'settingsChannelDelivered', sigField: '', scriptSigField: '',
      probeHasField: 'hasSettingsPanel', cdpShouldFn: '',
      cdpBuildFn: 'buildSettingsChannelExpression', cdpRemoveConst: 'SETTINGS_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: () => true,
    cfgSig: () => 'on',
  }),
  defineSpec({
    id: 'mascot', channelNumber: 10, order: 100, tier: 'addon',
    label: 'Dual Mascot Rig', configKeys: ['mascot'], files: ['src/runtime/mascot-hop-transition.js', 'dual-mascot-rig.js'],
    mountGlobal: '__agDualMascotRig', budgetBytes: 128 * 1024,
    probeLines: [
      'hasMascot: Boolean(window.__agDualMascotRig || globalThis.__agDualMascotRig)',
      "mascotCodeHash: String((window.__agDualMascotRig || globalThis.__agDualMascotRig)?.__prismCodeHash || '')",
    ],
    fieldOverrides: {
      cdpShouldFn: 'shouldEnableMascot', cdpBuildFn: 'buildMascotChannelExpression',
      cdpRemoveConst: 'MASCOT_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: (cfg) => cfg?.mascot !== 'off' && cfg?.mascot !== false,
    cfgSig: (cfg) => (cfg?.mascot === 'off' || cfg?.mascot === false ? 'off' : String(cfg?.mascot || 'crab')),
  }),
  defineSpec({
    id: 'suggester', cacheFormat: 'clientAndUi', channelNumber: 11, order: 110, tier: 'addon', topLevelPack: true,
    label: 'Prompt Suggester',
    files: ['vendor/prompt-suggester/suggester-client.js', 'vendor/prompt-suggester/suggester-settings-ui.js'],
    mountGlobal: '__agPrismSuggester', bindingConst: 'SUGGESTER_BINDING',
    probeHashKey: '', probeExtraKeys: ['hasSuggesterUi'], tracksSkippedNonHost: true, budgetBytes: 72 * 1024,
    probeLines: [
      'hasSuggester: Boolean(window.__agPrismSuggester && !window.__agPrismSuggester.getDebugState?.()?.destroyed)',
      "hasSuggesterUi: Boolean(typeof window.__prismMountSuggesterUi === 'function')",
    ],
    fieldOverrides: {
      sigField: 'lastSuggesterHash', scriptSigField: 'lastSuggesterScriptHash',
      skippedField: 'suggesterSkipped', bindingAddedField: 'suggesterBindingAdded',
      probeHashField: '', cdpShouldFn: '', cdpBuildFn: 'buildSuggesterExpression', cdpRemoveConst: 'SUGGESTER_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: () => true,
    cfgSig: () => 'on',
  }),
  defineSpec({
    id: 'homeStudio', channelNumber: 12, order: 120, tier: 'studio',
    label: 'Home Studio Dashboard', configKeys: ['homeLayout'], files: ['usage-core.js', 'home-studio-panel.js'],
    mountGlobal: '__agPrismHomeStudioPanel', probeExtraKeys: ['needsHomeStudioChannel'],
    respectSkippedByLiveCfg: true, budgetBytes: 56 * 1024,
    probeLines: [
      'hasHomeStudio: Boolean(window.__agPrismHomeStudioPanel || globalThis.__agPrismHomeStudioPanel || window.__agHomeStudioPanel || globalThis.__agHomeStudioPanel)',
      "homeStudioCodeHash: String((window.__agPrismHomeStudioPanel || globalThis.__agPrismHomeStudioPanel || window.__agHomeStudioPanel || globalThis.__agHomeStudioPanel)?.__prismCodeHash || '')",
      "needsHomeStudioChannel: Boolean(st?.cfg?.homeLayout === 'studio' && document.querySelector('.agy-home') && !(window.__agPrismHomeStudioPanel || globalThis.__agPrismHomeStudioPanel || window.__agHomeStudioPanel || globalThis.__agHomeStudioPanel))",
    ],
    fieldOverrides: {
      cdpShouldFn: 'shouldEnableHomeStudio', cdpBuildFn: 'buildHomeStudioChannelExpression',
      cdpRemoveConst: 'HOME_STUDIO_REMOVE_EXPRESSION',
    },
    defaultShouldEnable: (cfg) => (cfg?.homeLayout || cfg?.homeMode || 'studio') === 'studio',
    cfgSig: (cfg) => ((cfg?.homeLayout || cfg?.homeMode || 'studio') === 'studio' ? 'studio' : 'off'),
  }),
  defineSpec({
    id: 'telemetry', channelNumber: 13, order: 130, tier: 'runtime', topLevelPack: true, staticRuntimePack: true,
    label: 'Telemetry Bar & Physical Vial', configKeys: ['telemetryModule', 'telemetryQuotaMode', 'language'],
    files: ['vial-core.js', 'pulse-vial-bridge.js', 'vendor/pulse-dashboard/inline-fallback.js'],
    mountGlobal: '__agPrismTelemetry', respectSkippedByLiveCfg: true, budgetBytes: 128 * 1024,
    probeLines: [
      'hasTelemetry: Boolean((window.__agPrismTelemetry || globalThis.__agPrismTelemetry) && (window.__agVialCore || globalThis.__agVialCore) && (window.__agCsPulseVialBridge || globalThis.__agCsPulseVialBridge))',
      "telemetryCodeHash: String((window.__agPrismTelemetry || globalThis.__agPrismTelemetry)?.__prismCodeHash || '')",
    ],
    defaultShouldEnable: (cfg) => cfg?.telemetryModule !== 'off' && cfg?.telemetryModule !== false,
    cfgSig: (cfg) => (cfg?.telemetryModule === 'off' || cfg?.telemetryModule === false ? 'off' : String(cfg?.telemetryModule || 'auto')),
  }),
  defineSpec({
    id: 'effortSlider', channelNumber: 14, order: 140, tier: 'runtime', topLevelPack: true, staticRuntimePack: true,
    label: 'Reasoning Effort Slider', configKeys: ['effortSliderModule', 'effortMemory'],
    files: ['vendor/effort-slider/upstream-client.js', 'vendor/effort-slider/slider-coexist.js'],
    mountGlobal: '__agPrismEffortSlider', respectSkippedByLiveCfg: true, budgetBytes: 96 * 1024,
    probeLines: [
      'hasEffortSlider: Boolean(window.__agPrismEffortSlider || globalThis.__agPrismEffortSlider)',
      "effortSliderCodeHash: String((window.__agPrismEffortSlider || globalThis.__agPrismEffortSlider)?.__prismCodeHash || '')",
    ],
    defaultShouldEnable: (cfg) => {
      const raw = cfg?.effortSliderModule !== undefined ? cfg.effortSliderModule : cfg?.effortSlider;
      return raw !== 'off' && raw !== false;
    },
    cfgSig: (cfg) => {
      const raw = cfg?.effortSliderModule !== undefined ? cfg.effortSliderModule : cfg?.effortSlider;
      if (raw === 'off' || raw === false) return 'off';
      const mem = cfg?.effortMemory === 'off' || cfg?.effortMemory === false ? 'off' : 'on';
      return `${String(raw || 'auto')}:${mem}`;
    },
  }),
  defineSpec({
    id: 'workbenchEnhancer', channelNumber: 15, order: 150, tier: 'runtime', topLevelPack: true, staticRuntimePack: true,
    label: 'Workbench Deep-Surface Enhancer',
    configKeys: ['sidebarNavFold', 'scrollBottomMotion', 'sidebarRestyle', 'motionLevel'],
    files: ['host-workbench-enhancer.js'], mountGlobal: '__agPrismHostEnhancer',
    respectSkippedByLiveCfg: true, budgetBytes: 56 * 1024,
    probeLines: [
      'hasWorkbenchEnhancer: Boolean(window.__agPrismHostEnhancer || globalThis.__agPrismHostEnhancer)',
      "workbenchEnhancerCodeHash: String((window.__agPrismHostEnhancer || globalThis.__agPrismHostEnhancer)?.__prismCodeHash || '')",
    ],
    defaultShouldEnable: (cfg) => {
      if (cfg?.workbenchEnhancer === 'off' || cfg?.workbenchEnhancer === false) return false;
      return !(
        cfg?.sidebarRestyle === false &&
        (cfg?.sidebarNavFold === 'off' || cfg?.sidebarNavFold === false) &&
        (cfg?.scrollBottomMotion === 'instant' || cfg?.scrollBottomMotion === 'off') &&
        (cfg?.motionLevel === 'off' || cfg?.motionLevel === 'minimal')
      );
    },
    cfgSig: (cfg) => {
      if (cfg?.workbenchEnhancer === 'off' || cfg?.workbenchEnhancer === false) return 'off';
      return (
        cfg?.sidebarRestyle === false &&
        (cfg?.sidebarNavFold === 'off' || cfg?.sidebarNavFold === false) &&
        (cfg?.scrollBottomMotion === 'instant' || cfg?.scrollBottomMotion === 'off') &&
        (cfg?.motionLevel === 'off' || cfg?.motionLevel === 'minimal')
      ) ? 'off' : 'on';
    },
  }),
  defineSpec({
    id: 'contextMenu', channelNumber: 16, order: 160, tier: 'runtime', topLevelPack: true, staticRuntimePack: true,
    label: 'Context Menu & /btw Side Chat', configKeys: ['contextMenu', 'language', 'motionLevel'],
    files: ['context-menu-btw.js'], mountGlobal: '__agPrismContextMenu',
    respectSkippedByLiveCfg: true, budgetBytes: 28 * 1024,
    probeLines: [
      'hasContextMenu: Boolean((window.__agPrismContextMenu || globalThis.__agPrismContextMenu) && !(window.__agPrismContextMenu || globalThis.__agPrismContextMenu).getState?.()?.destroyed)',
      "contextMenuCodeHash: String((window.__agPrismContextMenu || globalThis.__agPrismContextMenu)?.__prismCodeHash || '')",
    ],
    defaultShouldEnable: (cfg) => cfg?.contextMenu !== false && cfg?.contextMenu !== 'off',
    cfgSig: (cfg) => (cfg?.contextMenu === false || cfg?.contextMenu === 'off' ? 'off' : 'on'),
  }),
]);

// 从唯一真相源自动派生：磁盘缓存键清单、缓存格式映射、Runtime 下沉通道 ID 清单
const CHANNEL_CACHE_NAMES = Object.freeze(CHANNEL_STATIC_SPECS.map((s) => s.cacheKey));
const CHANNEL_CACHE_FORMAT_MAP = Object.freeze(
  Object.fromEntries(CHANNEL_STATIC_SPECS.map((s) => [s.cacheKey, s.cacheFormat]))
);
const RUNTIME_TIER_CHANNEL_IDS = Object.freeze(
  CHANNEL_STATIC_SPECS.filter((s) => s.tier === 'runtime').map((s) => s.id)
);

// 从 CHANNEL_REGISTRY 声明式 probeExpr 自动拼装整页健康探针表达式（零手工复制粘贴）
function buildPageHealthProbeExpression(specs = CHANNEL_STATIC_SPECS) {
  const channelProbeSnippets = specs
    .map((s) => (typeof s?.probeExpr === 'string' ? s.probeExpr.trim() : ''))
    .filter(Boolean)
    .join(',\n    ');
  return `(() => {
  const root = typeof document !== 'undefined' && document.documentElement;
  if (!root || document.readyState === 'loading') return { ready: false };
  const api = window.__agPrism;
  const isHostDom = Boolean(
    api ||
      (document.body &&
        document.body.classList &&
        (document.body.classList.contains('theme-standalone') || document.body.classList.contains('monaco-workbench'))) ||
      document.querySelector(
        '.agy-shell, .agy-home, [data-testid="aux-pane-split"], [data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="model-selector-trigger"], .monaco-workbench'
      )
  );
  const st = api && typeof api.getState === 'function' ? api.getState() : null;
  const telMode = st?.cfg?.telemetryModule || 'auto';
  const omniMode = st?.cfg?.omniModule || 'on';
  const sidebarMode = st?.cfg?.sidebarStudio === 'on' ? 'on' : 'off';
  const needTelCheck = Boolean(api && telMode !== 'off');
  const hasPulseBar = needTelCheck && Boolean(
    (typeof document.getElementById === 'function' &&
      (document.getElementById('ag-prism-pulse-bar') || document.getElementById('ag-pulse-status-bar'))) ||
      document.querySelector('[data-ag-prism-pulse-bar="true"], [data-ag-pulse-bar="true"]')
  );
  const isHome = needTelCheck && !hasPulseBar && Boolean(document.querySelector('.agy-home, [data-testid="home-greeting"]'));
  const hasModelBtn = needTelCheck && !hasPulseBar && !isHome && Boolean(document.querySelector('[data-testid="model-selector-trigger"]'));
  return {
    ready: true,
    isHostDom,
    href: (typeof location !== 'undefined' && location && typeof location.href === 'string') ? location.href : '',
    title: typeof document.title === 'string' ? document.title.slice(0, 200) : '',
    scopeAttr: root.getAttribute('data-ag-prism-scope') || '',
    prismAttr: root.getAttribute('data-ag-prism') || '',
    hasPrism: Boolean(api),
    hasRepoBridge: Boolean(window.__agPrismRepoBridge),
    hasThoughtBridge: Boolean(window.__agPrismThoughtBridge && typeof window.__agPrismThoughtBridge.cacheStats === 'function'),
    hasUsageBridge: Boolean(window.__agPrismUsageBridge && typeof window.__agPrismUsageBridge.listSummaries === 'function'),
    ${channelProbeSnippets},
    codeHash: (api && api.codeHash) || '',
    hasLegacyCss: Boolean(document.getElementById('ag-claude-style-css')),
    needsDashboardSync: Boolean(api && telMode !== 'off' && !isHome && hasModelBtn && !hasPulseBar),
  };
})()`;
}

function createChannelRegistry({ builders, readConfig }) {
  const alwaysEnabled = () => true;
  const specMap = new Map(CHANNEL_STATIC_SPECS.map((s) => [s.id, s]));

  const bindEntry = (id, shouldEnable, build, buildForReport) => {
    const spec = specMap.get(id);
    const resolvedShouldEnable =
      typeof shouldEnable === 'function'
        ? shouldEnable
        : (cfg) => spec.defaultShouldEnable(cfg && typeof cfg === 'object' ? reconcileConfigAliases(cfg) : readConfig());
    return Object.freeze({
      ...spec,
      shouldEnable: resolvedShouldEnable,
      build,
      teardown: CHANNEL_TEARDOWN_MAP[id] || '',
      _buildForReport: buildForReport || ((cfg, opts) => build(cfg, opts)),
    });
  };

  const CHANNEL_REGISTRY = Object.freeze([
    bindEntry(
      'omni',
      null,
      builders.buildOmniClientExpression,
      (_cfg, opts) => builders.buildOmniClientExpression(null, null, opts)
    ),
    bindEntry(
      'sidebar',
      null,
      builders.buildSidebarStudioExpression,
      (_cfg, opts) => builders.buildSidebarStudioExpression(null, null, opts)
    ),
    bindEntry('hostI18n', builders.shouldEnableHostI18n, builders.buildHostI18nExpression, (cfg, opts) => builders.buildHostI18nExpression(cfg, null, opts)),
    bindEntry('swarmI18n', builders.shouldEnableSwarmI18n, builders.buildSwarmI18nExpression, (cfg, opts) => builders.buildSwarmI18nExpression(cfg, null, opts)),
    bindEntry('thought', builders.shouldEnableThought, builders.buildThoughtExpression),
    bindEntry('inlineDiff', alwaysEnabled, builders.buildInlineDiffInjectExpression),
    bindEntry('wallpaper', alwaysEnabled, builders.buildWallpaperExpression),
    bindEntry('periodicPicker', builders.shouldEnablePeriodicPicker, builders.buildPeriodicPickerExpression),
    bindEntry('settings', alwaysEnabled, builders.buildSettingsChannelExpression),
    bindEntry('mascot', builders.shouldEnableMascot, builders.buildMascotChannelExpression),
    bindEntry('suggester', alwaysEnabled, builders.buildSuggesterExpression),
    bindEntry('homeStudio', builders.shouldEnableHomeStudio, builders.buildHomeStudioChannelExpression),
    bindEntry('telemetry', builders.shouldEnableTelemetry, builders.buildTelemetryChannelExpression),
    bindEntry('effortSlider', builders.shouldEnableEffortSlider, builders.buildEffortSliderChannelExpression),
    bindEntry('workbenchEnhancer', builders.shouldEnableWorkbenchEnhancer, builders.buildWorkbenchEnhancerChannelExpression),
    bindEntry('contextMenu', builders.shouldEnableContextMenu, builders.buildContextMenuChannelExpression),
  ]);

  const registryById = new Map(CHANNEL_REGISTRY.map((ch) => [ch.id, ch]));
  const findChannel = (id) => (typeof id === 'string' && id ? registryById.get(id) || null : null);
  const getChannelsByTier = (tier) => CHANNEL_REGISTRY.filter((ch) => ch.tier === tier);
  const getChannelsByInjectMode = (injectMode) => CHANNEL_REGISTRY.filter((ch) => ch.injectMode === injectMode);
  const getChannelDescriptors = () =>
    CHANNEL_REGISTRY.map((ch) => ({
      id: ch.id,
      cacheKey: ch.cacheKey,
      channelNumber: ch.channelNumber,
      order: ch.order,
      tier: ch.tier,
      injectMode: ch.injectMode,
      label: ch.label,
      mountGlobal: ch.mountGlobal,
      probeKey: ch.probeKey,
      configKeys: [...ch.configKeys],
      files: [...ch.files],
      budgetBytes: ch.budgetBytes,
      hasTeardown: typeof ch.teardown === 'string' && ch.teardown.length > 0,
    }));

  function getChannelBudgetReport(config = null, opts = null) {
    const cfg = config && typeof config === 'object' ? reconcileConfigAliases(config) : readConfig();
    const buildOpts = opts && typeof opts === 'object' ? opts : { noDiskCache: true };
    const channels = [];
    const overBudgetChannels = [];
    let totalBytes = 0;
    let totalBudgetBytes = 0;

    for (const ch of CHANNEL_REGISTRY) {
      const enabled = Boolean(ch.shouldEnable(cfg));
      const expr = enabled ? String(ch._buildForReport(cfg, buildOpts) || '') : '';
      const bytes = Buffer.byteLength(expr, 'utf8');
      const withinBudget = bytes <= ch.budgetBytes;
      totalBytes += bytes;
      totalBudgetBytes += ch.budgetBytes;
      if (!withinBudget) overBudgetChannels.push(ch.id);
      channels.push({
        id: ch.id,
        channelNumber: ch.channelNumber,
        label: ch.label,
        enabled,
        bytes,
        budgetBytes: ch.budgetBytes,
        withinBudget,
        files: [...ch.files],
        configKeys: [...ch.configKeys],
      });
    }

    return { ok: overBudgetChannels.length === 0, totalBytes, totalBudgetBytes, overBudgetChannels, channels };
  }

  return {
    CHANNEL_REGISTRY,
    CHANNEL_CACHE_NAMES,
    RUNTIME_TIER_CHANNEL_IDS,
    buildPageHealthProbeExpression,
    findChannel,
    getChannelsByTier,
    getChannelsByInjectMode,
    getChannelDescriptors,
    getChannelBudgetReport,
  };
}

module.exports = {
  PERIODIC_PICKER_MODULE_FILES,
  CHANNEL_STATIC_SPECS,
  CHANNEL_CACHE_NAMES,
  CHANNEL_CACHE_FORMAT_MAP,
  RUNTIME_TIER_CHANNEL_IDS,
  buildPageHealthProbeExpression,
  createChannelRegistry,
};
