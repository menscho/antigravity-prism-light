// Obsidian Prism CDP 核心兼容门面（Facade）：聚合 src/ 下无环分层模块，100% 保持历史导出与 CLI 契约
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const PID_FILE = path.join(ROOT_DIR, '.daemon.pid');

const fsSafe = require('./src/utils/fs-safe.cjs');
const schema = require('./src/config/schema.cjs');
const { createConfigStore } = require('./src/config/store.cjs');
const transport = require('./src/cdp/transport.cjs');
const shortcutFlags = require('./src/platform/shortcut-flags.cjs');
const { createProcessProbe } = require('./src/platform/process-probe.cjs');
const winLnk = require('./src/platform/win-lnk.cjs');
const linuxDesktop = require('./src/platform/linux-desktop.cjs');
const shortcutGuard = require('./src/platform/shortcut-guard.cjs');
const { createLocaleDialog } = require('./src/platform/locale-dialog.cjs');
const { createHostRelaunch } = require('./src/platform/host-relaunch.cjs');
const { createRelaunchHelper } = require('./src/platform/relaunch-helper.cjs');
const { minifyCss } = require('./src/compiler/css-pack.cjs');
const { minifyGlsl } = require('./src/compiler/glsl-minifier.cjs');
const { minifyJs } = require('./src/compiler/js-string-pool.cjs');
const partPreprocess = require('./src/compiler/part-preprocess.cjs');
const { createCh1Templates } = require('./src/compiler/ch1-templates.cjs');
const { createCh1Compiler } = require('./src/compiler/ch1-bundle.cjs');
const {
  createInitialBundleCacheStats,
  createBundleCache,
} = require('./src/compiler/bundle-cache.cjs');
const teardown = require('./src/channels/teardown.cjs');
const { createCoreChannelBuilders } = require('./src/channels/builders-core.cjs');
const { createI18nChannelBuilders } = require('./src/channels/builders-i18n.cjs');
const { createStudioChannelBuilders } = require('./src/channels/builders-studio.cjs');
const { createAddonChannelBuilders } = require('./src/channels/builders-addons.cjs');
const { createRuntimeChannelBuilders } = require('./src/channels/builders-runtime.cjs');
const { createChannelRegistry } = require('./src/channels/registry.cjs');

const PLUGIN_VERSION = fsSafe.readPkgVersionSafe(ROOT_DIR);

// 每次 require('./cdp.js') 独立实例化有状态域，保持测试与守护进程热重载的状态隔离
const configStore = createConfigStore({ rootDir: ROOT_DIR });
const processProbe = createProcessProbe({ rootDir: ROOT_DIR, portFile: fsSafe.PORT_FILE });
const localeDialog = createLocaleDialog();
const hostRelaunch = createHostRelaunch({ rootDir: ROOT_DIR });
const relaunchHelper = createRelaunchHelper({
  rootDir: ROOT_DIR,
  collectKnownPrismDaemonPids: hostRelaunch.collectKnownPrismDaemonPids,
});

const bundleStats = createInitialBundleCacheStats();
let bundleCache = null;

const ch1Templates = createCh1Templates({
  rootDir: ROOT_DIR,
  pluginVersion: PLUGIN_VERSION,
  readConfig: configStore.readConfig,
  resolveCurrentBundleCodeHash: () => bundleCache.resolveCurrentBundleCodeHash(),
  detectSystemUiLocale: localeDialog.detectSystemUiLocale,
});

const ch1Compiler = createCh1Compiler({
  rootDir: ROOT_DIR,
  stats: bundleStats,
  getInjectWrapperTemplate: () => ch1Templates.getInjectWrapperTemplate(),
});

bundleCache = createBundleCache({
  rootDir: ROOT_DIR,
  pluginVersion: PLUGIN_VERSION,
  stats: bundleStats,
  readConfig: configStore.readConfig,
  compiler: ch1Compiler,
  templates: ch1Templates,
});

const coreBuilders = createCoreChannelBuilders({
  rootDir: ROOT_DIR,
  pluginVersion: PLUGIN_VERSION,
  readConfig: configStore.readConfig,
  bundleCache,
});
const i18nBuilders = createI18nChannelBuilders({
  rootDir: ROOT_DIR,
  readConfig: configStore.readConfig,
  detectSystemUiLocale: localeDialog.detectSystemUiLocale,
  bundleCache,
});
const studioBuilders = createStudioChannelBuilders({
  rootDir: ROOT_DIR,
  readConfig: configStore.readConfig,
  bundleCache,
});
const addonBuilders = createAddonChannelBuilders({ rootDir: ROOT_DIR, readConfig: configStore.readConfig, bundleCache });
const runtimeBuilders = createRuntimeChannelBuilders({ rootDir: ROOT_DIR, readConfig: configStore.readConfig, bundleCache });
const channelRegistry = createChannelRegistry({
  builders: { ...coreBuilders, ...i18nBuilders, ...studioBuilders, ...addonBuilders, ...runtimeBuilders },
  readConfig: configStore.readConfig,
});

const { setChannelMemCache: _dropSetChannelMemCache, ...publicBundleCache } = bundleCache;
const {
  TELEMETRY_REMOVE_EXPRESSION: _dropTelemetryRemove,
  EFFORT_SLIDER_REMOVE_EXPRESSION: _dropEffortRemove,
  WORKBENCH_ENHANCER_REMOVE_EXPRESSION: _dropWorkbenchRemove,
  CONTEXT_MENU_REMOVE_EXPRESSION: _dropContextMenuRemove,
  getChannelTeardownExpression: _dropGetChannelTeardown,
  ...publicTeardown
} = teardown;
const {
  getChannelsByTier: _dropGetChannelsByTier,
  getChannelsByInjectMode: _dropGetChannelsByInjectMode,
  ...publicChannelRegistry
} = channelRegistry;

module.exports = {
  STYLE_ID: schema.STYLE_ID,
  LEGACY_STYLE_ID: schema.LEGACY_STYLE_ID,
  PLUGIN_VERSION,
  SETTING_BINDING: schema.SETTING_BINDING,
  LEGACY_SETTING_BINDING: schema.LEGACY_SETTING_BINDING,
  OMNI_BINDING: schema.OMNI_BINDING,
  SIDEBAR_BINDING: schema.SIDEBAR_BINDING,
  INLINE_DIFF_BINDING: schema.INLINE_DIFF_BINDING,
  WALLPAPER_BINDING: schema.WALLPAPER_BINDING,
  SUGGESTER_BINDING: schema.SUGGESTER_BINDING,
  PORT_FILE: fsSafe.PORT_FILE,
  PID_FILE,
  CONFIG_FILE: configStore.CONFIG_FILE,
  CONFIG_PATH: configStore.CONFIG_PATH,
  CONFIG_SCHEMA: schema.CONFIG_SCHEMA,
  DEFAULT_CONFIG: schema.DEFAULT_CONFIG,
  VALIDATORS: schema.VALIDATORS,
  validateConfigEntry: schema.validateConfigEntry,
  reconcileConfigAliases: schema.reconcileConfigAliases,
  isEligibleTarget: transport.isEligibleTarget,
  isSwarmSidecarUrl: transport.isSwarmSidecarUrl,
  redactSensitiveUrl: transport.redactSensitiveUrl,
  readPidFromLockFile: processProbe.readPidFromLockFile,
  parseWindowsTasklistCsv: processProbe.parseWindowsTasklistCsv,
  inspectProcessSync: processProbe.inspectProcessSync,
  matchesExpectedDaemonSignature: processProbe.matchesExpectedDaemonSignature,
  isExpectedDaemonProcess: processProbe.isExpectedDaemonProcess,
  CDP_OPT_IN_SWITCH: shortcutFlags.CDP_OPT_IN_SWITCH,
  LNK_MAX_FILE_BYTES: winLnk.LNK_MAX_FILE_BYTES,
  APP_STORAGE_MAX_BYTES: relaunchHelper.APP_STORAGE_MAX_BYTES,
  assertSafeRegularFileSync: fsSafe.assertSafeRegularFileSync,
  parseWindowsLnkBuffer: winLnk.parseWindowsLnkBuffer,
  updateWindowsLnkArguments: winLnk.updateWindowsLnkArguments,
  readWindowsLnkFileSync: winLnk.readWindowsLnkFileSync,
  writeWindowsLnkArgumentsSync: winLnk.writeWindowsLnkArgumentsSync,
  getDefaultWindowsShortcutDirs: winLnk.getDefaultWindowsShortcutDirs,
  collectWindowsLnkFilesSync: winLnk.collectWindowsLnkFilesSync,
  runWindowsShortcutAdapter: winLnk.runWindowsShortcutAdapter,
  runWindowsShortcutAdapterAsync: winLnk.runWindowsShortcutAdapterAsync,
  resolveWindowsDetachedNodeRuntime: hostRelaunch.resolveWindowsDetachedNodeRuntime,
  probeLoopbackCdpVersionAsync: hostRelaunch.probeLoopbackCdpVersionAsync,
  probeLoopbackCdpVersionSync: hostRelaunch.probeLoopbackCdpVersionSync,
  buildWindowsHostCandidatesFromTasklist: hostRelaunch.buildWindowsHostCandidatesFromTasklist,
  getAntigravityAppStoragePath: relaunchHelper.getAntigravityAppStoragePath,
  suspendAntigravityRunInBackground: relaunchHelper.suspendAntigravityRunInBackground,
  restoreAntigravityRunInBackground: relaunchHelper.restoreAntigravityRunInBackground,
  requestLoopbackCdpBrowserClose: relaunchHelper.requestLoopbackCdpBrowserClose,
  isWindowsAntigravityHostAliveSync: relaunchHelper.isWindowsAntigravityHostAliveSync,
  runWindowsDetachedRelaunchTask: relaunchHelper.runWindowsDetachedRelaunchTask,
  IS_LINUX: fsSafe.IS_LINUX,
  LINUX_DESKTOP_SHADOW_MARKER: linuxDesktop.LINUX_DESKTOP_SHADOW_MARKER,
  LINUX_GOMEMLIMIT_LINE_RE: linuxDesktop.LINUX_GOMEMLIMIT_LINE_RE,
  hasRemoteDebuggingPortSwitch: shortcutFlags.hasRemoteDebuggingPortSwitch,
  appendCdpFlagToArguments: shortcutFlags.appendCdpFlagToArguments,
  stripCdpFlagFromArguments: shortcutFlags.stripCdpFlagFromArguments,
  isAntigravityShortcutTarget: shortcutFlags.isAntigravityShortcutTarget,
  isAntigravityLinuxTarget: shortcutFlags.isAntigravityLinuxTarget,
  isMainAntigravityProcessSignature: shortcutFlags.isMainAntigravityProcessSignature,
  tokenizeDesktopExec: linuxDesktop.tokenizeDesktopExec,
  extractDesktopExecTarget: linuxDesktop.extractDesktopExecTarget,
  patchDesktopExecLine: linuxDesktop.patchDesktopExecLine,
  stripDesktopExecLine: linuxDesktop.stripDesktopExecLine,
  readDesktopShadowMarker: linuxDesktop.readDesktopShadowMarker,
  isManagedPrismDesktopContent: linuxDesktop.isManagedPrismDesktopContent,
  patchDesktopEntryContent: linuxDesktop.patchDesktopEntryContent,
  stripDesktopEntryContent: linuxDesktop.stripDesktopEntryContent,
  getDefaultLinuxDesktopDirs: linuxDesktop.getDefaultLinuxDesktopDirs,
  ensureLinuxDesktopShortcutsCdpFlag: linuxDesktop.ensureLinuxDesktopShortcutsCdpFlag,
  restoreLinuxDesktopShortcutsCdpFlag: linuxDesktop.restoreLinuxDesktopShortcutsCdpFlag,
  readLinuxGoMemLimitFromEnvD: linuxDesktop.readLinuxGoMemLimitFromEnvD,
  ensureAntigravityShortcutsCdpFlag: shortcutGuard.ensureAntigravityShortcutsCdpFlag,
  ensureAntigravityShortcutsCdpFlagAsync: shortcutGuard.ensureAntigravityShortcutsCdpFlagAsync,
  restoreAntigravityShortcutsCdpFlag: shortcutGuard.restoreAntigravityShortcutsCdpFlag,
  extractPosixCommandExecutable: hostRelaunch.extractPosixCommandExecutable,
  parseAppImageFromProcEnviron: hostRelaunch.parseAppImageFromProcEnviron,
  parsePosixPsHostCandidates: hostRelaunch.parsePosixPsHostCandidates,
  detectRunningAntigravityHostSync: hostRelaunch.detectRunningAntigravityHostSync,
  detectRunningAntigravityHost: hostRelaunch.detectRunningAntigravityHost,
  getRelaunchPromptStatePaths: hostRelaunch.getRelaunchPromptStatePaths,
  hasRelaunchBeenPromptedForHost: hostRelaunch.hasRelaunchBeenPromptedForHost,
  recordRelaunchPromptState: hostRelaunch.recordRelaunchPromptState,
  promptUserForHostRelaunch: localeDialog.promptUserForHostRelaunch,
  executeHostRelaunchSequence: localeDialog.executeHostRelaunchSequence,
  normalizeMacAppBundlePath: relaunchHelper.normalizeMacAppBundlePath,
  MAC_DETACHED_RELAUNCH_SH: relaunchHelper.MAC_DETACHED_RELAUNCH_SH,
  LINUX_DETACHED_RELAUNCH_SH: relaunchHelper.LINUX_DETACHED_RELAUNCH_SH,
  spawnDetachedHostRelaunchHelper: relaunchHelper.spawnDetachedHostRelaunchHelper,
  RUNTIME_PARTS: partPreprocess.RUNTIME_PARTS,
  SYNC_SUBDIRS: partPreprocess.SYNC_SUBDIRS,
  SYNC_ROOT_FILES: partPreprocess.buildSyncRootFiles(ROOT_DIR),
  REMOVE_EXPRESSION: teardown.REMOVE_EXPRESSION,
  PURGE_DATA_FILES: teardown.PURGE_DATA_FILES,
  readConfig: configStore.readConfig,
  writeConfig: configStore.writeConfig,
  invalidateConfigCache: configStore.invalidateConfigCache,
  readCss: ch1Compiler.readCss,
  readPort: processProbe.readPort,
  listPages: transport.listPages,
  listSwarmTargets: transport.listSwarmTargets,
  getBrowserWsUrl: transport.getBrowserWsUrl,
  CdpSession: transport.CdpSession,
  minifyCss,
  minifyGlsl,
  minifyJs,
  stripJsFunctionsByName: partPreprocess.stripJsFunctionsByName,
  prepareRuntimePart: ch1Compiler.prepareRuntimePart,
  computeHash: fsSafe.computeHash,
  buildConfigRefreshExpression: ch1Templates.buildConfigRefreshExpression,
  buildInjectExpression: bundleCache.buildInjectExpression,
  ...publicBundleCache,
  ...coreBuilders,
  ...i18nBuilders,
  ...studioBuilders,
  ...addonBuilders,
  readWindowsPreferredUiLanguage: localeDialog.readWindowsPreferredUiLanguage,
  detectSystemUiLocale: localeDialog.detectSystemUiLocale,
  resolveSystemLangNode: ch1Templates.resolveSystemLangNode,
  _setWindowsUiLocaleReaderForTest: localeDialog._setWindowsUiLocaleReaderForTest,
  buildRelaunchDialogCopy: localeDialog.buildRelaunchDialogCopy,
  DEFERRED_ROOT_MODULES: partPreprocess.DEFERRED_ROOT_MODULES,
  ...publicTeardown,
  ...runtimeBuilders,
  ...publicChannelRegistry,
};

if (require.main === module) {
  const flagIdx = process.argv.indexOf('--run-relaunch-task');
  if (flagIdx >= 0 && process.argv[flagIdx + 1]) {
    const taskFilePath = path.resolve(String(process.argv[flagIdx + 1]));
    (async () => {
      try {
        const { resolved } = fsSafe.assertSafeRegularFileSync(taskFilePath, relaunchHelper.RELAUNCH_TASK_MAX_BYTES);
        const raw = fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '');
        try { fs.unlinkSync(resolved); } catch {}
        const task = JSON.parse(raw);
        if (!task || typeof task !== 'object' || Array.isArray(task)) return;
        await relaunchHelper.runWindowsDetachedRelaunchTask(task);
      } catch {}
    })();
  }
}
