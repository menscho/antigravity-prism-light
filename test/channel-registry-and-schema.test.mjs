// Phase 2A 契约测试：CONFIG_SCHEMA 单一真相源、CHANNEL_REGISTRY 微内核、cdp.js Facade 兼容与三端打包完整性
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { PURGE_DATA_FILES as MANIFEST_PURGE_DATA_FILES } from '../src/platform/install-manifest.cjs';
import { collectNativePluginEntries, createInstallManifestPayload } from '../scripts/build-common.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));

const LEGACY_CDP_EXPORTS = [
  'STYLE_ID', 'LEGACY_STYLE_ID', 'PLUGIN_VERSION',
  'SETTING_BINDING', 'LEGACY_SETTING_BINDING', 'OMNI_BINDING', 'SIDEBAR_BINDING',
  'INLINE_DIFF_BINDING', 'WALLPAPER_BINDING', 'SUGGESTER_BINDING',
  'PORT_FILE', 'PID_FILE', 'CONFIG_FILE', 'DEFAULT_CONFIG', 'VALIDATORS',
  'validateConfigEntry', 'reconcileConfigAliases',
  'isEligibleTarget', 'isSwarmSidecarUrl', 'redactSensitiveUrl',
  'readPidFromLockFile', 'parseWindowsTasklistCsv', 'inspectProcessSync',
  'matchesExpectedDaemonSignature', 'isExpectedDaemonProcess',
  'CDP_OPT_IN_SWITCH', 'LNK_MAX_FILE_BYTES', 'APP_STORAGE_MAX_BYTES',
  'assertSafeRegularFileSync', 'parseWindowsLnkBuffer', 'updateWindowsLnkArguments',
  'readWindowsLnkFileSync', 'writeWindowsLnkArgumentsSync',
  'getDefaultWindowsShortcutDirs', 'collectWindowsLnkFilesSync',
  'runWindowsShortcutAdapter', 'runWindowsShortcutAdapterAsync',
  'resolveWindowsDetachedNodeRuntime', 'probeLoopbackCdpVersionAsync',
  'probeLoopbackCdpVersionSync', 'buildWindowsHostCandidatesFromTasklist',
  'getAntigravityAppStoragePath', 'suspendAntigravityRunInBackground',
  'restoreAntigravityRunInBackground', 'requestLoopbackCdpBrowserClose',
  'isWindowsAntigravityHostAliveSync', 'runWindowsDetachedRelaunchTask',
  'IS_LINUX', 'LINUX_DESKTOP_SHADOW_MARKER', 'LINUX_GOMEMLIMIT_LINE_RE',
  'hasRemoteDebuggingPortSwitch', 'appendCdpFlagToArguments', 'stripCdpFlagFromArguments',
  'isAntigravityShortcutTarget', 'isAntigravityLinuxTarget', 'isMainAntigravityProcessSignature',
  'tokenizeDesktopExec', 'extractDesktopExecTarget', 'patchDesktopExecLine',
  'stripDesktopExecLine', 'readDesktopShadowMarker', 'isManagedPrismDesktopContent',
  'patchDesktopEntryContent', 'stripDesktopEntryContent', 'getDefaultLinuxDesktopDirs',
  'ensureLinuxDesktopShortcutsCdpFlag', 'restoreLinuxDesktopShortcutsCdpFlag',
  'readLinuxGoMemLimitFromEnvD', 'ensureAntigravityShortcutsCdpFlag',
  'ensureAntigravityShortcutsCdpFlagAsync', 'restoreAntigravityShortcutsCdpFlag',
  'extractPosixCommandExecutable', 'parseAppImageFromProcEnviron', 'parsePosixPsHostCandidates',
  'detectRunningAntigravityHostSync', 'detectRunningAntigravityHost',
  'getRelaunchPromptStatePaths', 'hasRelaunchBeenPromptedForHost', 'recordRelaunchPromptState',
  'promptUserForHostRelaunch', 'executeHostRelaunchSequence',
  'normalizeMacAppBundlePath', 'MAC_DETACHED_RELAUNCH_SH', 'LINUX_DETACHED_RELAUNCH_SH',
  'spawnDetachedHostRelaunchHelper',
  'RUNTIME_PARTS', 'SYNC_ROOT_FILES', 'REMOVE_EXPRESSION',
  'readConfig', 'writeConfig', 'invalidateConfigCache', 'readCss', 'readPort',
  'listPages', 'listSwarmTargets', 'getBrowserWsUrl', 'CdpSession',
  'minifyCss', 'minifyGlsl', 'minifyJs', 'stripJsFunctionsByName', 'prepareRuntimePart',
  'computeHash', 'buildConfigRefreshExpression', 'buildInjectExpression',
  'BUNDLE_CACHE_SCHEMA_VERSION', 'BUNDLE_CACHE_FILENAME', 'BUNDLE_CACHE_MAX_ENTRIES',
  'computeBundleSourceHash', 'computeBundleConfigHash',
  'getBundleCacheStats', 'resetBundleCacheStats', 'flushPendingBundleCache',
  'buildOmniClientExpression', 'buildSidebarStudioExpression',
  'shouldEnableHostI18n', 'readWindowsPreferredUiLanguage', 'detectSystemUiLocale',
  'resolveSystemLangNode', '_setWindowsUiLocaleReaderForTest',
  'buildHostI18nExpression', 'buildRelaunchDialogCopy', 'HOST_I18N_REMOVE_EXPRESSION',
  'shouldEnableSwarmI18n', 'buildSwarmI18nExpression', 'SWARM_I18N_REMOVE_EXPRESSION',
  'ISOLATED_HOST_I18N_PAUSE_EXPRESSION', 'ISOLATED_HOST_I18N_RESUME_EXPRESSION',
  'shouldEnableThought', 'buildThoughtExpression', 'THOUGHT_REMOVE_EXPRESSION',
  'buildInlineDiffInjectExpression', 'INLINE_DIFF_REMOVE_EXPRESSION',
  'buildWallpaperExpression', 'WALLPAPER_REMOVE_EXPRESSION',
  'PERIODIC_PICKER_MODULE_FILES', 'shouldEnablePeriodicPicker',
  'buildPeriodicPickerExpression', 'PERIODIC_PICKER_REMOVE_EXPRESSION',
  'DEFERRED_ROOT_MODULES',
  'buildSettingsChannelExpression', 'SETTINGS_REMOVE_EXPRESSION',
  'shouldEnableMascot', 'buildMascotChannelExpression', 'MASCOT_REMOVE_EXPRESSION',
  'buildSuggesterExpression', 'SUGGESTER_REMOVE_EXPRESSION',
  'shouldEnableHomeStudio', 'buildHomeStudioChannelExpression', 'HOME_STUDIO_REMOVE_EXPRESSION',
  'isSafeV2SidebarClientSource',
];

function listAllSrcCjsFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith('.cjs')) {
        out.push(path.relative(rootDir, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(path.join(rootDir, 'src'));
  return out.sort();
}

test('CONFIG_SCHEMA is the single source of truth for DEFAULT_CONFIG, VALIDATORS, and aliases', () => {
  const schema = cdp.CONFIG_SCHEMA;
  assert.ok(schema && typeof schema === 'object' && !Array.isArray(schema));
  const exampleCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));

  // config.example.json keys must match DEFAULT_CONFIG & CONFIG_SCHEMA non-optional keys (46 keys) 1:1
  const requiredSchemaKeys = Object.entries(schema)
    .filter(([, def]) => !def.optional)
    .map(([k]) => k)
    .sort();
  const validatorSchemaKeys = Object.entries(schema)
    .filter(([, def]) => !def.optional && def.inValidators !== false)
    .map(([k]) => k)
    .sort();
  assert.deepEqual(
    Object.keys(cdp.DEFAULT_CONFIG).sort(),
    Object.keys(exampleCfg).sort(),
    'DEFAULT_CONFIG derived from CONFIG_SCHEMA must match config.example.json keys 1:1'
  );
  assert.deepEqual(
    requiredSchemaKeys,
    Object.keys(exampleCfg).sort(),
    'CONFIG_SCHEMA non-optional keys must match config.example.json keys 1:1'
  );
  assert.deepEqual(
    Object.keys(cdp.VALIDATORS).sort(),
    validatorSchemaKeys,
    'VALIDATORS derived from CONFIG_SCHEMA must match all inValidators !== false keys'
  );
  for (const key of requiredSchemaKeys) {
    assert.equal(exampleCfg[key], schema[key].default, `config.example.json.${key} must match CONFIG_SCHEMA.${key}.default`);
  }

  // Every required entry in CONFIG_SCHEMA appears in DEFAULT_CONFIG with matching default
  for (const [key, def] of Object.entries(schema)) {
    if (!def.optional) {
      assert.equal(cdp.DEFAULT_CONFIG[key], def.default, `DEFAULT_CONFIG.${key} must match CONFIG_SCHEMA.${key}.default`);
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(cdp.DEFAULT_CONFIG, key), false);
    }
    if (def.type === 'enum' && def.inValidators !== false) {
      assert.deepEqual(cdp.VALIDATORS[key], def.values);
    }
  }

  // validateConfigEntry checks enum, number range, boolean, and unknown keys
  assert.equal(cdp.validateConfigEntry('palette', 'warm'), true);
  assert.equal(cdp.validateConfigEntry('palette', 'invalid-palette'), false);
  assert.equal(cdp.validateConfigEntry('pollIntervalMs', 2500), true);
  assert.equal(cdp.validateConfigEntry('pollIntervalMs', 50), false);
  assert.equal(cdp.validateConfigEntry('pollIntervalMs', 99999), false);
  assert.equal(cdp.validateConfigEntry('autoPromptCdpRelaunch', true), true);
  assert.equal(cdp.validateConfigEntry('autoPromptCdpRelaunch', 'yes'), false);
  assert.equal(cdp.validateConfigEntry('unknownConfigKey', 'x'), false);

  // reconcileConfigAliases handles legacy aliases cleanly
  const reconciled = cdp.reconcileConfigAliases({
    palette: 'claude',
    lang: 'yue',
    mascot: 'dual',
    homeMode: 'classic',
    convRipple: true,
    sidebar: 'off',
  });
  assert.equal(reconciled.palette, 'warm');
  assert.equal(reconciled.language, 'zh-CN');
  assert.equal(reconciled.lang, 'zh-CN');
  assert.equal(reconciled.mascot, 'crab');
  assert.equal(reconciled.homeLayout, 'classic');
  assert.equal(reconciled.homeMode, 'classic');
  assert.equal(reconciled.convRipple, 'medium');
  assert.equal(reconciled.sidebarRestyle, false);
  assert.equal(reconciled.sidebar, 'off');

  const strFalse = cdp.reconcileConfigAliases({ homeRipple: 'false', sidebarRestyle: 'FALSE', sidebar: 'FALSE' });
  assert.equal(strFalse.homeRipple, false);
  assert.equal(strFalse.sidebarRestyle, false);
  assert.equal(strFalse.sidebar, 'off');

  const wbSpec = cdp.CHANNEL_REGISTRY.find((c) => c.id === 'workbenchEnhancer');
  assert.ok(wbSpec);
  assert.equal(wbSpec.defaultShouldEnable({ sidebarRestyle: false, sidebarNavFold: false, scrollBottomMotion: 'off', motionLevel: 'minimal' }), false);
  assert.equal(wbSpec.cfgSig({ sidebarRestyle: false, sidebarNavFold: false, scrollBottomMotion: 'off', motionLevel: 'minimal' }), 'off');
});

test('CHANNEL_REGISTRY contract covers all 16 delayed/on-demand channels with valid metadata and gating', () => {
  const expectedIds = [
    'omni',
    'sidebar',
    'hostI18n',
    'swarmI18n',
    'thought',
    'inlineDiff',
    'wallpaper',
    'periodicPicker',
    'settings',
    'mascot',
    'suggester',
    'homeStudio',
    'telemetry',
    'effortSlider',
    'workbenchEnhancer',
    'contextMenu',
  ];

  const descriptors = cdp.getChannelDescriptors();
  assert.deepEqual(descriptors.map((d) => d.id), expectedIds);

  // Verify unified Phase 4B SSOT derivations: CHANNEL_CACHE_NAMES, order monotonic, probe expression synthesis
  assert.deepEqual(
    [...cdp.CHANNEL_CACHE_NAMES],
    cdp.CHANNEL_REGISTRY.map((c) => c.cacheKey),
    'CHANNEL_CACHE_NAMES must be strictly derived from CHANNEL_REGISTRY'
  );
  const probeExpr = cdp.buildPageHealthProbeExpression();
  assert.doesNotThrow(() => new vm.Script(probeExpr), 'buildPageHealthProbeExpression() must compile cleanly');

  let prevOrder = 0;
  for (const id of expectedIds) {
    const ch = cdp.findChannel(id);
    assert.ok(ch, `findChannel('${id}') must resolve`);
    assert.equal(ch.id, id);
    assert.equal(ch.cacheKey, id);
    assert.ok(Number.isFinite(ch.channelNumber) && ch.channelNumber >= 2);
    assert.ok(Number.isInteger(ch.order) && ch.order > prevOrder, `Channel ${id} order must be strictly ascending`);
    prevOrder = ch.order;
    assert.ok(['core', 'i18n', 'addon', 'studio', 'runtime'].includes(ch.tier), `Channel ${id} has valid tier`);
    assert.ok(['main-page-persistent', 'on-demand-rpc', 'oopif-swarm'].includes(ch.injectMode), `Channel ${id} has valid injectMode`);
    assert.ok(typeof ch.mountGlobal === 'string' && ch.mountGlobal.startsWith('__ag'), `Channel ${id} has valid mountGlobal`);
    assert.ok(ch.fields && typeof ch.fields === 'object', `Channel ${id} exposes structured fields metadata`);
    assert.ok(Number.isInteger(ch.budgetBytes) && ch.budgetBytes > 0);
    if (ch.probeKey) {
      assert.ok(probeExpr.includes(`${ch.probeKey}:`), `Probe expression must include ${ch.probeKey}`);
    }
    if (ch.probeHashKey) {
      assert.ok(probeExpr.includes(`${ch.probeHashKey}:`), `Probe expression must include ${ch.probeHashKey}`);
    }
    for (const key of ch.configKeys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(cdp.CONFIG_SCHEMA, key),
        `Channel ${id} configKey '${key}' must exist in CONFIG_SCHEMA`
      );
    }
    for (const rel of ch.files) {
      assert.equal(
        fs.existsSync(path.join(ROOT, rel)),
        true,
        `Channel ${id} declared file missing on disk: ${rel}`
      );
    }
    assert.doesNotThrow(
      () => new vm.Script(ch.teardown),
      `Channel ${id} teardown expression must be syntactically valid JS`
    );
  }
  assert.equal(cdp.findChannel('non-existent'), null);

  // Gated channels must disable cleanly and build to empty string
  const gatedOffCfg = {
    ...cdp.DEFAULT_CONFIG,
    omniModule: 'off',
    sidebarStudio: 'off',
    hostLocalization: 'off',
    thoughtTranslate: 'off',
    periodicModelPicker: 'off',
    mascot: 'off',
    homeLayout: 'native',
    telemetryModule: 'off',
    effortSliderModule: 'off',
    sidebarNavFold: 'off',
    scrollBottomMotion: 'instant',
    sidebarRestyle: false,
    motionLevel: 'off',
    contextMenu: false,
  };
  assert.equal(cdp.findChannel('omni').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('sidebar').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('swarmI18n').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('swarmI18n').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('thought').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('thought').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('periodicPicker').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('periodicPicker').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('mascot').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('mascot').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('homeStudio').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('homeStudio').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('telemetry').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('telemetry').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('effortSlider').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('effortSlider').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('workbenchEnhancer').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('workbenchEnhancer').build(gatedOffCfg), '');
  assert.equal(cdp.findChannel('contextMenu').shouldEnable(gatedOffCfg), false);
  assert.equal(cdp.findChannel('contextMenu').build(gatedOffCfg), '');

  const offReport = cdp.getChannelBudgetReport(gatedOffCfg, { noDiskCache: true });
  assert.equal(offReport.ok, true);
  for (const id of ['omni', 'sidebar', 'swarmI18n', 'thought', 'periodicPicker', 'mascot', 'homeStudio', 'telemetry', 'effortSlider', 'workbenchEnhancer', 'contextMenu']) {
    const row = offReport.channels.find((c) => c.id === id);
    assert.equal(row.enabled, false);
    assert.equal(row.bytes, 0);
  }
});

test('PURGE_DATA_FILES aligns 100% with src/platform/install-manifest.cjs and cdp.js Facade preserves all 151 legacy exports', () => {
  assert.deepEqual([...cdp.PURGE_DATA_FILES], [...MANIFEST_PURGE_DATA_FILES]);

  const missing = LEGACY_CDP_EXPORTS.filter((k) => !Object.prototype.hasOwnProperty.call(cdp, k));
  const undefs = LEGACY_CDP_EXPORTS.filter((k) => cdp[k] === undefined);
  assert.deepEqual(missing, [], `Missing legacy cdp.js exports: ${missing.join(', ')}`);
  assert.deepEqual(undefs, [], `Undefined legacy cdp.js exports: ${undefs.join(', ')}`);
  assert.equal(LEGACY_CDP_EXPORTS.length, 151);

  // Re-requiring cdp.js yields an isolated stateful instance
  const cdpPath = require.resolve(path.join(ROOT, 'cdp.js'));
  delete require.cache[cdpPath];
  const freshCdp = require(cdpPath);
  assert.notEqual(freshCdp, cdp);
  assert.equal(freshCdp.PLUGIN_VERSION, cdp.PLUGIN_VERSION);
  assert.equal(freshCdp.CHANNEL_REGISTRY.length, cdp.CHANNEL_REGISTRY.length);
});

test('Packaging collectNativePluginEntries & install-manifest.json include 100% of src/**/*.cjs modules', () => {
  const srcCjsFiles = listAllSrcCjsFiles(ROOT);
  assert.ok(srcCjsFiles.length >= 30, `Expected >= 30 src/**/*.cjs modules, got ${srcCjsFiles.length}`);

  const nativeEntries = collectNativePluginEntries();
  const entryNames = new Set(nativeEntries.map((e) => e.name));
  assert.ok(entryNames.has('native-plugin/cdp.js'), 'native-plugin/cdp.js must be packaged');
  for (const rel of srcCjsFiles) {
    assert.ok(
      entryNames.has(`native-plugin/${rel}`),
      `Packaged native-plugin missing src module: native-plugin/${rel}`
    );
  }

  const { manifest } = createInstallManifestPayload({ pluginEntries: nativeEntries });
  const manifestPaths = new Set(manifest.files.map((e) => e.path));
  assert.ok(manifestPaths.has('cdp.js'));
  for (const rel of srcCjsFiles) {
    assert.ok(manifestPaths.has(rel), `install-manifest.json missing src module: ${rel}`);
  }
});

test('Bundle source hash and channel cache automatically invalidate on 1-byte edits in src/compiler/ or src/channels/', () => {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ag-prism-src-hash-')));
  const isoCdpPath = path.join(tmpDir, 'cdp.js');
  const cachePath = path.join(tmpDir, '.bundle-cache.json');

  try {
    fs.copyFileSync(path.join(ROOT, 'cdp.js'), isoCdpPath);
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmpDir, 'package.json'));
    fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(tmpDir, 'config.example.json'));
    fs.copyFileSync(path.join(ROOT, 'style.css'), path.join(tmpDir, 'style.css'));
    fs.cpSync(path.join(ROOT, 'src'), path.join(tmpDir, 'src'), { recursive: true });
    for (const part of cdp.RUNTIME_PARTS) {
      const dst = path.join(tmpDir, part);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT, part), dst);
    }
    const omniRel = path.join('vendor', 'omni-viewer', 'omni-client.js');
    fs.mkdirSync(path.dirname(path.join(tmpDir, omniRel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, omniRel), path.join(tmpDir, omniRel));

    const loadIso = () => {
      for (const k of Object.keys(require.cache)) {
        if (k.startsWith(tmpDir)) delete require.cache[k];
      }
      return require(isoCdpPath);
    };

    const iso1 = loadIso();
    const h1 = iso1.computeBundleSourceHash();
    iso1.buildOmniClientExpression(null, null, { cachePath });
    const cacheBefore = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const omniHashBefore = cacheBefore.channels.omni.sourceHash;

    // 1-byte comment edit in src/compiler/ch1-bundle.cjs invalidates Ch1 source hash
    const compilerFile = path.join(tmpDir, 'src', 'compiler', 'ch1-bundle.cjs');
    fs.appendFileSync(compilerFile, '\n// 1-byte-bust\n', 'utf8');
    const iso2 = loadIso();
    const h2 = iso2.computeBundleSourceHash();
    assert.notEqual(h2, h1, 'Editing src/compiler/ch1-bundle.cjs must invalidate computeBundleSourceHash()');

    // 1-byte comment edit in src/channels/builders-core.cjs invalidates channel disk cache sourceHash
    const channelFile = path.join(tmpDir, 'src', 'channels', 'builders-core.cjs');
    fs.appendFileSync(channelFile, '\n// 1-byte-channel-bust\n', 'utf8');
    const iso3 = loadIso();
    iso3.buildOmniClientExpression(null, null, { cachePath });
    const stats3 = iso3.getBundleCacheStats();
    assert.equal(stats3.channelDiskHits, 0, 'Channel cache must miss after src/channels edit');
    assert.equal(stats3.channelCompileRuns, 1, 'Channel must recompile after src/channels edit');
    const cacheAfter = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.notEqual(cacheAfter.channels.omni.sourceHash, omniHashBefore);
  } finally {
    for (const k of Object.keys(require.cache)) {
      if (k.startsWith(tmpDir)) delete require.cache[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 4D: settings-panel schema aligns with schema.cjs, cdp.js prunes 8 zombie exports, install-plugin decouples patch-asar, and teardown cleans all 16 audited globals safely', () => {
  const settingsPanel = require(path.join(ROOT, 'settings-panel.js'));
  const processProbe = require(path.join(ROOT, 'src', 'platform', 'process-probe.cjs'));

  // 1) settings-panel.js language & mascot enums/defaults aligned with src/config/schema.cjs
  assert.deepEqual([...settingsPanel.PRISM_SETTINGS_SCHEMA.language.allowed], [...cdp.CONFIG_SCHEMA.language.values]);
  assert.equal(settingsPanel.PRISM_SETTINGS_SCHEMA.language.default, cdp.CONFIG_SCHEMA.language.default);
  assert.equal(settingsPanel.getDefaultSettingsPatch().language, 'en'); // LIGHT (2026-11-27)
  assert.ok(settingsPanel.PRISM_SETTINGS_SCHEMA.mascot.allowed.includes('minis'), 'mascot enum must include minis');
  assert.equal(settingsPanel.PRISM_SETTINGS_SCHEMA.mascot.default, cdp.CONFIG_SCHEMA.mascot.default);

  // 2) PRISM_STORAGE_KEYS + dynamic prefix sweep
  for (const k of [
    'ag-prism:homeSessionScope.v1',
    'ag_prism_pp_muted',
    'ag.prism.effortMemory.v1',
    'ag.codexEffortSlider.settings.v1',
  ]) {
    assert.ok(settingsPanel.PRISM_STORAGE_KEYS.includes(k), `PRISM_STORAGE_KEYS missing ${k}`);
  }
  const map = new Map([
    ['ag-prism:homeSessionScope.v1', 'local'],
    ['ag_prism_pp_muted', '1'],
    ['ag.prism.effortMemory.v1', '{}'],
    ['ag.codexEffortSlider.settings.v1', '{}'],
    ['ag-prism:trajRollup.v1:ws1', '{}'],
    ['ag-prism:trajRollup.v1:ws2', '{}'],
    ['ag-pulse-enabled', '1'],
  ]);
  const mockStore = {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => map.delete(k),
  };
  settingsPanel.clearPrismLocalStorage(mockStore);
  assert.equal(map.has('ag-prism:homeSessionScope.v1'), false);
  assert.equal(map.has('ag_prism_pp_muted'), false);
  assert.equal(map.has('ag.prism.effortMemory.v1'), false);
  assert.equal(map.has('ag.codexEffortSlider.settings.v1'), false);
  assert.equal(map.has('ag-prism:trajRollup.v1:ws1'), false);
  assert.equal(map.has('ag-prism:trajRollup.v1:ws2'), false);
  assert.equal(map.has('ag-pulse-enabled'), true, 'External Pulse key must remain untouched');

  // 3) cdp.js removes 8 zero-caller zombie exports while preserving CHANNEL_REGISTRY teardowns
  for (const zombie of [
    'setChannelMemCache',
    'TELEMETRY_REMOVE_EXPRESSION',
    'EFFORT_SLIDER_REMOVE_EXPRESSION',
    'WORKBENCH_ENHANCER_REMOVE_EXPRESSION',
    'CONTEXT_MENU_REMOVE_EXPRESSION',
    'getChannelTeardownExpression',
    'getChannelsByTier',
    'getChannelsByInjectMode',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(cdp, zombie), false, `cdp.js must no longer export zombie symbol ${zombie}`);
  }
  for (const chId of ['telemetry', 'effortSlider', 'workbenchEnhancer', 'contextMenu']) {
    assert.ok(cdp.findChannel(chId)?.teardown?.length > 0, `CHANNEL_REGISTRY.${chId}.teardown must remain intact`);
  }

  // 4) tools/install-plugin.cjs decouples from tools/patch-asar.cjs via src/platform/process-probe.cjs
  assert.equal(typeof processProbe.spawnBreakawayNodeProcess, 'function');
  assert.equal(typeof processProbe.isPidAlive, 'function');
  assert.equal(processProbe.isPidAlive(process.pid), true);
  assert.equal(processProbe.isPidAlive(-1), false);
  const installPluginSrc = fs.readFileSync(path.join(ROOT, 'tools', 'install-plugin.cjs'), 'utf8');
  assert.equal(installPluginSrc.includes('patch-asar.cjs'), false, 'tools/install-plugin.cjs must not require patch-asar.cjs');
  assert.ok(installPluginSrc.includes('src/platform/process-probe.cjs'));

  // 5) REMOVE_EXPRESSION cleans all 16 audited globals + data-ag-prism-lang, preserves host data-theme, and drops 5 zombie deletes
  for (const zombieDel of ['__agCsCrabAssets', '__agCsEffortCore', '__agCsMascotCore', '__agCsPerfAssets', '__opChromaGatesSession']) {
    assert.equal(cdp.REMOVE_EXPRESSION.includes(zombieDel), false, `REMOVE_EXPRESSION must drop obsolete zombie delete ${zombieDel}`);
  }
  const rootAttrs = new Map([
    ['data-ag-prism-lang', 'zh-CN'],
    ['data-theme', 'dark'],
  ]);
  const remDoc = {
    documentElement: {
      getAttribute: (k) => rootAttrs.get(k) ?? null,
      removeAttribute: (k) => rootAttrs.delete(k),
      style: { removeProperty() {} },
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  let bridgeDisposed = false;
  const auditedGlobals = [
    '__agPrismSidebarHostOps',
    '__agPrismSidebarLastSendError',
    '__agPrismSidebarLastStartStage',
    '__agPrismSidebarLastStartFallback',
    '__agPrismSidebarLastSendFallback',
    '__agPulseExternalBridge',
    '__agPulseRuntimeBridge',
    '__agPulseRuntimeOwner',
    '__agPrismMetricsBridge',
    '__agPrismSvgUtil',
    '__agPrismRipple',
    '__agRippleForce2D',
    '__agPeriodicMockHost',
    '__agPrismOmniBootCfg',
    '__agPrismOmniDisableAutoBoot',
    '__agPrismResolveInlineDiff',
  ];
  const remWin = { document: remDoc };
  for (const k of auditedGlobals) {
    remWin[k] = k === '__agPulseRuntimeBridge' ? { dispose() { bridgeDisposed = true; } } : 'active';
  }
  remWin.window = remWin;
  remWin.globalThis = remWin;
  vm.runInNewContext(cdp.REMOVE_EXPRESSION, remWin);
  assert.equal(bridgeDisposed, true, 'REMOVE_EXPRESSION must dispose __agPulseRuntimeBridge when no external Pulse owns it');
  for (const k of auditedGlobals) {
    assert.equal(remWin[k], undefined, `REMOVE_EXPRESSION must clean ${k}`);
  }
  assert.equal(rootAttrs.has('data-ag-prism-lang'), false, 'REMOVE_EXPRESSION must remove data-ag-prism-lang');
  assert.equal(rootAttrs.get('data-theme'), 'dark', 'REMOVE_EXPRESSION must NEVER delete host documentElement[data-theme]');
});

test('Native CdpClient.cs & CdpClient.swift align 100% bidirectionally with all 54 keys in src/config/schema.cjs', { skip: 'safe build: native installers removed' }, () => {
  const schema = cdp.CONFIG_SCHEMA;
  const allSchemaKeys = Object.keys(schema).sort();
  assert.equal(allSchemaKeys.length, 54, 'CONFIG_SCHEMA expected 54 keys');

  const canonicalLangs = [...schema.language.values];
  const autoOnOff = ['auto', 'on', 'off'];
  const onOff = ['on', 'off'];
  const expandSpec = (spec) => (spec === 'L' ? canonicalLangs : spec === 'A' ? autoOnOff : spec === 'O' ? onOff : spec.split(','));

  const parseStringArray = (src, re, label) => {
    const m = src.match(re);
    assert.ok(m, `Missing ${label}`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };

  const verifyNativeSchema = (label, src, patterns) => {
    // 1) All 54 schema keys must be explicitly present in native source
    for (const k of allSchemaKeys) {
      assert.ok(src.includes(`"${k}"`), `${label} missing explicit schema key "${k}"`);
    }

    // 2) Extract declarative enum/bool/string/integer definitions and derive defaults + validators
    const enumBlock = src.match(patterns.enumBlock);
    assert.ok(enumBlock, `${label} missing declarative enum schema table`);
    const enumRows = [...enumBlock[1].matchAll(patterns.enumRow)];
    assert.ok(enumRows.length >= 40, `${label} expected >= 40 enum schema entries, got ${enumRows.length}`);

    const defaults = {};
    const validators = {};
    for (const row of enumRows) {
      const [, k, defVal, spec] = row;
      assert.equal(Object.prototype.hasOwnProperty.call(defaults, k), false, `${label} duplicate enum key ${k}`);
      defaults[k] = defVal;
      validators[k] = expandSpec(spec);
    }
    for (const k of parseStringArray(src, patterns.boolTrue, `${label} boolTrue`)) {
      defaults[k] = true;
      validators[k] = 'boolean';
    }
    for (const k of parseStringArray(src, patterns.boolFalse, `${label} boolFalse`)) {
      defaults[k] = false;
      validators[k] = 'boolean';
    }
    for (const k of parseStringArray(src, patterns.strKeys, `${label} strKeys`)) {
      defaults[k] = '';
      validators[k] = 'string';
    }
    assert.match(src, patterns.pollDefault, `${label} must set default pollIntervalMs = 2500`);
    defaults.pollIntervalMs = 2500;

    // Bidirectional 1:1 parity for all 52 non-optional keys & defaults and all 51 validators
    assert.deepEqual(Object.keys(defaults).sort(), Object.keys(cdp.DEFAULT_CONFIG).sort(), `${label} default keys must match DEFAULT_CONFIG 1:1`);
    assert.deepEqual(defaults, cdp.DEFAULT_CONFIG, `${label} default values must match DEFAULT_CONFIG 100%`);
    assert.deepEqual(Object.keys(validators).sort(), Object.keys(cdp.VALIDATORS).sort(), `${label} validator keys must match VALIDATORS 1:1`);
    assert.deepEqual(validators, cdp.VALIDATORS, `${label} validator rules must match VALIDATORS 100%`);

    // Controlled non-validator keys (pollIntervalMs 500..60000 + 2 optional strictBoolean keys)
    for (const token of patterns.controlledTokens) {
      assert.ok(src.includes(token), `${label} missing controlled schema contract token: ${token}`);
    }

    // Coercion / legacyMap / mascot / yue migration rules parity
    const strictOn = parseStringArray(src, patterns.strictOn, `${label} strictOn`).sort();
    const notOff = parseStringArray(src, patterns.notOff, `${label} notOff`).sort();
    const boolToOnOff = parseStringArray(src, patterns.boolToOnOff, `${label} boolToOnOff`).sort();
    const expectedStrictOn = Object.entries(schema).filter(([, s]) => s.stringBoolMode === 'strictOn').map(([k]) => k).sort();
    const expectedNotOff = Object.entries(schema).filter(([, s]) => s.stringBoolMode === 'notOff').map(([k]) => k).sort();
    const expectedBoolToOnOff = Object.entries(schema).filter(([, s]) => s.coerceBoolToOnOff).map(([k]) => k).sort();
    assert.deepEqual(strictOn, expectedStrictOn, `${label} strictOn boolean keys must match schema.cjs 100%`);
    assert.deepEqual(notOff, expectedNotOff, `${label} notOff boolean keys must match schema.cjs 100%`);
    assert.deepEqual(boolToOnOff, expectedBoolToOnOff, `${label} coerceBoolToOnOff keys must match schema.cjs 100%`);
  };

  const cdpCs = fs.readFileSync(path.join(ROOT, 'installer', 'common', 'CdpClient.cs'), 'utf8');
  verifyNativeSchema('CdpClient.cs', cdpCs, {
    enumBlock: /EnumSchemaSpecs\s*=\s*new\s+string\[,\]\s*\{([\s\S]*?)\n\s*\};/,
    enumRow: /\{\s*"([^"]+)",\s*"([^"]*)",\s*"([^"]+)"\s*\}/g,
    boolTrue: /BoolSchemaDefaultTrueKeys\s*=\s*new\s+string\[\]\s*\{([^}]+)\}/,
    boolFalse: /BoolSchemaDefaultFalseKeys\s*=\s*new\s+string\[\]\s*\{([^}]+)\}/,
    strKeys: /StringSchemaKeys\s*=\s*new\s+string\[\]\s*\{([^}]+)\}/,
    pollDefault: /d\["pollIntervalMs"\]\s*=\s*2500L;/,
    strictOn: /StrictOnBoolKeys\s*=\s*new\s+string\[\]\s*\{([^}]+)\}/,
    notOff: /NotOffBoolKeys\s*=\s*new\s+string\[\]\s*\{([^}]+)\}/,
    boolToOnOff: /BoolToOnOffKeys\s*=\s*new\s+string\[\]\s*\{([^}]+)\}/,
    controlledTokens: [
      'iv >= 500L && iv <= 60000L',
      'key == "autoPromptCdpRelaunch" || key == "autoRelaunchOnBareLaunch"',
      'NormalizeMascotConfigValue',
      'SanitizeCustomFont',
      '"cantonese"',
      '"eco"',
    ],
  });

  const cdpSwift = fs.readFileSync(path.join(ROOT, 'installer', 'macos', 'Common', 'CdpClient.swift'), 'utf8');
  verifyNativeSchema('CdpClient.swift', cdpSwift, {
    enumBlock: /enumSchemaSpecs:\s*\[\(String,\s*String,\s*String\)\]\s*=\s*\[([\s\S]*?)\n\s*\]/,
    enumRow: /\(\s*"([^"]+)",\s*"([^"]*)",\s*"([^"]+)"\s*\)/g,
    boolTrue: /boolSchemaDefaultTrueKeys\s*=\s*\[([^\]]+)\]/,
    boolFalse: /boolSchemaDefaultFalseKeys\s*=\s*\[([^\]]+)\]/,
    strKeys: /stringSchemaKeys\s*=\s*\[([^\]]+)\]/,
    pollDefault: /d\["pollIntervalMs"\]\s*=\s*\.int\(2500\)/,
    strictOn: /strictOnBoolKeys\s*=\s*\[([^\]]+)\]/,
    notOff: /notOffBoolKeys\s*=\s*\[([^\]]+)\]/,
    boolToOnOff: /for k in \[([^\]]+)\] \{\s*\n\s*if let v = out\[k\], case \.bool/,
    controlledTokens: [
      'iv >= 500 && iv <= 60000',
      'key == "autoPromptCdpRelaunch" || key == "autoRelaunchOnBareLaunch"',
      'normalizeMascotConfigValue',
      'sanitizeCustomFont',
      '"cantonese"',
      '"eco"',
    ],
  });

  // Strict boolean enforcement in ReadConfig / readConfig (reject string values for optional strictBoolean keys)
  assert.match(
    cdpCs,
    /if\s*\(\s*kv\.Key\s*==\s*"autoPromptCdpRelaunch"\s*\|\|\s*kv\.Key\s*==\s*"autoRelaunchOnBareLaunch"\s*\)\s*\{\s*if\s*\(\s*kv\.Value\s+is\s+bool\s*\)\s*cfg\[kv\.Key\]\s*=\s*kv\.Value;/,
    'CdpClient.cs ReadConfig must enforce strict boolean (reject string) for autoPromptCdpRelaunch/autoRelaunchOnBareLaunch'
  );
  assert.match(
    cdpSwift,
    /if\s+k\s*==\s*"autoPromptCdpRelaunch"\s*\|\|\s*k\s*==\s*"autoRelaunchOnBareLaunch"\s*\{\s*if\s+v\.boolValue\s*!=\s*nil\s*\{\s*cfg\[k\]\s*=\s*v\s*\}/,
    'CdpClient.swift readConfig must enforce strict boolean (reject string) for autoPromptCdpRelaunch/autoRelaunchOnBareLaunch'
  );

  // CdpClient.swift updateConfigBatch must reuse atomicWriteJsonObject (symlink + O_NOFOLLOW + 0o600 protection)
  const swiftBatchMatch = cdpSwift.match(/static\s+func\s+updateConfigBatch\([\s\S]*?\n    \}/);
  assert.ok(swiftBatchMatch, 'CdpClient.swift must define updateConfigBatch');
  assert.ok(
    swiftBatchMatch[0].includes('try atomicWriteJsonObject(next, toFile: cfgPath)'),
    'CdpClient.swift updateConfigBatch must delegate writes to atomicWriteJsonObject'
  );
  assert.equal(
    swiftBatchMatch[0].includes('.tmp'),
    false,
    'CdpClient.swift updateConfigBatch must not construct predictable .tmp paths'
  );
});
