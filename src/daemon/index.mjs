// Obsidian Prism 守护进程顶层薄编排器（真组件化组合：零原型 Mixin，L3 Assembly）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { OmniServer, OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import { copyUpdatedRuntimeFromRepo } from '../platform/repo-sync.cjs';
import {
  DEFAULT_ROOT_DIR,
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
  INLINE_DIFF_BINDING,
  SIDEBAR_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
  resolveStorageGuardStatePath,
  resolveUsageCachePath,
  resolvePortFileCandidates,
  discoverActivePort,
  isEligibleTarget,
  isPluginEnabledInHostConfig,
} from './constants.mjs';
import {
  sanitizeGitRemoteUrl,
  writeFileAtomicSync,
  writeFileAtomicAsync,
  formatJsonArgForEval,
} from './fs-atomic.mjs';
import { DaemonLogger, sanitizeSecretText, sanitizeLogLine } from './logger.mjs';
import {
  PidLockManager,
  parseTasklistCsvImageName,
  queryWindowsProcessImageNameSync,
  verifyDaemonPidLockToken,
  isObsidianPrismDaemonCommandLine,
  parseArgs,
  isMainEntry,
  DAEMON_SHUTDOWN_SIGNALS,
  registerDaemonShutdownSignals,
} from './pid-lock.mjs';
import {
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  CHANNEL_FSM_STATES,
  AWAITING_DOM_MAX_ATTEMPTS,
  CHANNEL_CIRCUIT_FAIL_THRESHOLD,
  ConfigFingerprintTracker,
  computeConfigFingerprint,
  extractSignificantTargetUrl,
  isSameSpaDocumentRoute,
  evaluateTargetInfoChange,
} from './session-fsm.mjs';
import { isSensitiveInlineDiffPath } from './inline-diff-filter.mjs';
import { readSafeInlineDiff } from './inline-diff-service.mjs';
import {
  normalizeUsageScopeKey,
  extractScopeKeyFromUri,
  extractScopeKeyFromTitle,
  resolveUsageScopeKey,
  hasRealUsageRecord,
  evalRendererRpcOnEntry,
} from './telemetry-scope.mjs';
import { RelaunchGuard } from './relaunch-guard.mjs';
import { SessionRegistry } from './session-registry.mjs';
import { ChannelOrchestrator } from './channel-orchestrator.mjs';
import { TelemetrySubsystem } from './telemetry-subsystem.mjs';
import { UpdateStorageSubsystem } from './update-storage-subsystem.mjs';
import {
  RpcDispatcher,
  isTrustedMainFrameBindingCall,
  isTrustedHostContext,
  resolveTrustedBroadcastContextId,
} from './rpc-dispatcher.mjs';
import { deliverPeriodicPickerFullToEntry } from './channel-sync-engine.mjs';
import { DaemonLoop } from './daemon-loop.mjs';
import { SwarmSessionManager } from './swarm-session-manager.mjs';
import { PrismDaemonCompatBase } from './daemon-compat-props.mjs';

const require = createRequire(import.meta.url);

export class PrismDaemon extends PrismDaemonCompatBase {
  constructor(opts = {}) {
    super();
    this._initSubsystems(opts);
  }

  _initSubsystems(opts = {}) {
    if (this._subsystemsReady) return;
    const {
      rootDir = DEFAULT_ROOT_DIR,
      gitRepoDir = null,
      bundleCachePath = undefined,
      usageCachePath = undefined,
      overridePort = null,
      portFile = null,
      pollIntervalMs = 3000,
      enabledCheck = () => isPluginEnabledInHostConfig(),
      metricsProvider = null,
      thoughtService = null,
      wallpaperService = null,
      suggesterService = null,
      omniExecHooks = null,
      sidebarService = null,
      relaunchHooks = null,
      daemonPidVerifier = null,
      noPortRelaunchThresholdMs = 8000,
      shortcutCheckIntervalMs = 300000,
      shortcutBackoffIntervalMs = 45 * 60 * 1000,
      listPagesFallbackIntervalMs = 60000,
      _testUpdateService = null,
      _testAddonRegistry = null,
      addonsDir = null,
      updateCheckInitialDelayMs = 45000,
      updateCheckIntervalMs = 6 * 60 * 60 * 1000,
      enableAutoUpdateTimer = true,
      storageGuardStatePath = null,
      storageGuardInitialDelayMs = 35000,
      storageGuardIntervalMs = 300000,
      enableStorageGuardTimer = true,
      silent = false,
      quotaCooldownNow = null,
      pendingRunInBgMarkerPath = '',
    } = opts;

    this._rootDir = path.resolve(rootDir);
    this._gitRepoDir = gitRepoDir ? path.resolve(gitRepoDir) : null;
    this._overridePort = overridePort;
    this._portFile = portFile;
    this._cdp = require(path.join(this._rootDir, 'cdp.js'));

    const ownerToken = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const getCdp = () => this._cdp;
    const getOwnMethod = (name) =>
      Object.prototype.hasOwnProperty.call(this, name) && typeof this[name] === 'function' ? this[name].bind(this) : null;

    this.logger = new DaemonLogger({
      logFile: path.join(this._rootDir, 'daemon.log'),
      silent,
      getCdp,
    });

    this.pidLock = new PidLockManager({
      pidFile: path.join(this._rootDir, '.daemon.pid'),
      ownerToken,
      getCdp,
      loadedCdpVerifier: typeof this._cdp?.isExpectedDaemonProcess === 'function' ? this._cdp.isExpectedDaemonProcess : null,
      daemonPidVerifier,
    });

    this.sessionRegistry = new SessionRegistry({
      listPagesFallbackIntervalMs,
      getCdp,
      isRunning: () => this.daemonLoop.running,
      isBusy: () => this.daemonLoop.busy,
      markPendingTick: () => { this.daemonLoop._pendingTick = true; },
      triggerTick: () => this.tick(),
      scheduleImmediateTick: (d) => this.scheduleImmediateTick(d),
      log: (m) => this.log(m),
      redact: (t) => this._redactSensitiveText(t),
      isOmniEnabled: () => this._isOmniEnabled(),
      isSidebarStudioEnabled: () => this._isSidebarStudioEnabled(),
      isSwarmTargetInfo: (info) => this._isSwarmTargetInfo(info),
      hasSwarmSession: (tid) => this.channelOrchestrator.swarmManager.swarmSessions.has(tid),
      onSwarmTargetEvent: (info) => this.channelOrchestrator.swarmManager.handleSwarmTargetEvent(info),
      onSwarmCloseAllLocal: () => this.channelOrchestrator.swarmManager.cleanupAllSwarmSessionsLocal(),
      onSwarmCleanupLocal: (tid) => this.channelOrchestrator.swarmManager.cleanupSwarmSessionLocal(tid),
      onSwarmCleanupBySessionId: (sid) => this.channelOrchestrator.swarmManager.cleanupSwarmBySessionId(sid),
      onScanExistingSwarmTargets: (bs) => this.channelOrchestrator.swarmManager.scanExistingSwarmTargets(bs),
      onDetachAllSwarmSessions: (c) => this.channelOrchestrator.swarmManager.detachAllSwarmSessions(c),
      onInjectSwarmIntoSubFrame: (e, f, c) => this.channelOrchestrator.swarmManager.injectSwarmIntoSubFrame(e, f, c),
      onCleanupSwarmSubFrames: (e, c) => this.channelOrchestrator.swarmManager.cleanupSwarmSubFrames(e, c),
      onSyncIsolatedHostI18n: (e, p, o) => this.channelOrchestrator.swarmManager.syncIsolatedHostI18n(e, p, o),
      onForceMainWorldHostI18nOffRescan: (e) => this.channelOrchestrator.swarmManager.forceMainWorldHostI18nOffRescan(e),
      onBindingCall: (e, p) => this.handleBindingCall(e, p),
      onApplyEntry: (e) => this.applyToEntry(e),
      onVerifyAndHealEntry: (e, f) => this.verifyAndHealEntry(e, f),
      onTeardownEntry: (e, s, o) => this._teardownAllEntryChannelScripts(e, s, o),
    });

    this.telemetrySubsystem = new TelemetrySubsystem({
      rootDir: this._rootDir,
      overridePort,
      portFile,
      usageCachePath,
      metricsProvider,
      quotaCooldownNow,
      getCdp,
      getSessions: () => this.sessionRegistry.sessions,
      getEnsureLsClientHook: () => getOwnMethod('ensureLsClient'),
      getDiscoverLocalHook: () => getOwnMethod('_discoverLocalAppConversations'),
      getRendererCandidatesHook: () => getOwnMethod('_getRendererRpcCandidates'),
    });

    this.channelOrchestrator = new ChannelOrchestrator({
      rootDir: this._rootDir,
      gitRepoDir: this._gitRepoDir,
      bundleCachePath,
      omniExecHooks,
      sidebarService,
      thoughtService,
      wallpaperService,
      suggesterService,
      sessionRegistry: this.sessionRegistry,
      getCdp,
      setCdp: (nextCdp) => { this._cdp = nextCdp; },
      isRunning: () => this.daemonLoop.running,
      log: (m) => this.log(m),
      redact: (t) => this._redactSensitiveText(t),
      resolveTelemetryDataDir: () => this.telemetrySubsystem.resolveDataDir(),
      onTelemetryDisabled: () => this.telemetrySubsystem.releaseIdle(true),
      onAutoArchiveSettingChanged: () => this.updateStorageSubsystem.invalidateStorageHealthCache(),
      onConfigRefreshed: (cfg) => this.updateStorageSubsystem.syncUpdateServiceChannel(cfg),
      getMethodOverride: getOwnMethod,
      invokeRebuildBundle: (o) => this.rebuildBundle(o),
      invokeBroadcastConfigRefresh: () => this.broadcastConfigRefresh(),
      ensureOmniServer: () => this.ensureOmniServer(),
      ensureSidebarService: () => this.ensureSidebarService(),
    });

    this.updateStorageSubsystem = new UpdateStorageSubsystem({
      rootDir: this._rootDir,
      gitRepoDir: this._gitRepoDir,
      overridePort,
      portFile,
      _testUpdateService,
      _testAddonRegistry,
      addonsDir,
      updateCheckInitialDelayMs,
      updateCheckIntervalMs,
      enableAutoUpdateTimer,
      storageGuardStatePath,
      storageGuardInitialDelayMs,
      storageGuardIntervalMs,
      enableStorageGuardTimer,
      getCdp,
      isRunning: () => this.daemonLoop.running,
      log: (m) => this.log(m),
      sessionRegistry: this.sessionRegistry,
      channelOrchestrator: this.channelOrchestrator,
      telemetry: this.telemetrySubsystem,
      getInspectGitRepoHook: () => getOwnMethod('_inspectGitRepoState'),
      invokeRebuildBundle: (o) => this.rebuildBundle(o),
      invokeApplyToEntry: (e) => this.applyToEntry(e),
      invokeBroadcastConfigRefresh: () => this.broadcastConfigRefresh(),
      invokeStop: (c) => this.stop(c),
      getCdpPort: () => this.cdpPort || 0,
    });

    this.relaunchGuard = new RelaunchGuard({
      rootDir: this._rootDir,
      overridePort,
      portFile,
      relaunchHooks,
      noPortRelaunchThresholdMs,
      shortcutCheckIntervalMs,
      shortcutBackoffIntervalMs,
      getCdp,
      isRunning: () => this.daemonLoop.running,
      hasLoopTimer: () => Boolean(this.daemonLoop.timer),
      log: (m) => this.log(m),
    });

    this.rpcDispatcher = new RpcDispatcher({
      getCdp,
      sessionRegistry: this.sessionRegistry,
      channelOrchestrator: this.channelOrchestrator,
      telemetrySubsystem: this.telemetrySubsystem,
      updateStorageSubsystem: this.updateStorageSubsystem,
      invokeExecuteRepoAction: (p) => this.executeRepoAction(p),
      invokeBroadcastConfigRefresh: () => this.broadcastConfigRefresh(),
      invokeEnsureMainFrameId: (e, t, r) => this._ensureMainFrameId(e, t, r),
    });

    this.daemonLoop = new DaemonLoop({
      pollIntervalMs,
      enabledCheck,
      pendingRunInBgMarkerPath,
      getRootDir: () => this._rootDir,
      getOverridePort: () => this._overridePort,
      getPortFile: () => this._portFile,
      getCdp,
      logger: this.logger,
      pidLock: this.pidLock,
      relaunchGuard: this.relaunchGuard,
      sessionRegistry: this.sessionRegistry,
      channelOrchestrator: this.channelOrchestrator,
      telemetrySubsystem: this.telemetrySubsystem,
      updateStorageSubsystem: this.updateStorageSubsystem,
      invokeIsCurrentOwner: () => this.isCurrentOwner(),
      invokeStop: (c, o) => this.stop(c, o),
      invokeDetachAll: (c) => this.detachAll(c),
      invokeRebuildBundle: (o) => this.rebuildBundle(o),
      invokeTick: () => this.tick(),
      invokeScheduleImmediateTick: (d) => this.scheduleImmediateTick(d),
      invokeReleaseOwnership: () => this.releaseOwnership(),
      invokeApplyToEntry: (e) => this.applyToEntry(e),
      invokeVerifyAndHealEntry: (e, f) => this.verifyAndHealEntry(e, f),
      invokeLog: (m) => this.log(m),
    });

    this._subsystemsReady = true;
  }

  // ---- 薄委托方法（全部转交对应子系统） ----
  log(msg) { return this._s().logger.log(msg); }
  _redactSensitiveText(text) { return this._s().logger.redactSensitiveText(text); }

  stopExistingDaemon(opts) { return this._s().pidLock.stopExistingDaemon(opts); }
  claimOwnership() { return this._s().pidLock.claimOwnership(); }
  isCurrentOwner() { return this._s().pidLock.isCurrentOwner(); }
  releaseOwnership() { return this._s().pidLock.releaseOwnership(); }

  _runExclusive(entry, fn) { return this._s().sessionRegistry.runExclusive(entry, fn); }
  _runEntryExclusive(entry, fn) { return this._s().sessionRegistry.runExclusive(entry, fn); }
  _hasMainDefaultContext(entry) { return this._s().sessionRegistry.hasMainDefaultContext(entry); }
  _findCurrentMainDefaultContextId(entry) { return this._s().sessionRegistry.findCurrentMainDefaultContextId(entry); }
  _markSidebarHostVerified(entry, doc, ok) { return this._s().sessionRegistry.markSidebarHostVerified(entry, doc, ok); }
  _ensureMainFrameId(entry, timeoutMs, retries) { return this._s().sessionRegistry.ensureMainFrameId(entry, timeoutMs, retries); }
  _targetKey(target) { return this._s().sessionRegistry.targetKey(target); }
  _normalizeIgnoreUrl(u) { return this._s().sessionRegistry.normalizeIgnoreUrl(u); }
  _markTargetIgnored(t, u) { return this._s().sessionRegistry.markTargetIgnored(t, u); }
  _isTargetIgnored(t) { return this._s().sessionRegistry.isTargetIgnored(t); }
  _isEligibleDaemonTarget(t) { return this._s().sessionRegistry.isEligibleDaemonTarget(t); }
  _pickActiveSidebarHostEntry() { return this._s().sessionRegistry.pickActiveSidebarHostEntry(); }
  closeBrowserDiscovery() { return this._s().sessionRegistry.closeBrowserDiscovery(); }
  _computeCoalescedTickDelay(ms) { return this._s().sessionRegistry.computeCoalescedTickDelay(ms); }
  scheduleImmediateTick(ms) { return this._s().sessionRegistry.scheduleImmediateTick(ms); }
  _handleBrowserTargetEvent(params) { return this._s().sessionRegistry.handleBrowserTargetEvent(params); }
  ensureBrowserDiscovery(port) { return this._s().sessionRegistry.ensureBrowserDiscovery(port); }
  attachTarget(target) { return this._s().sessionRegistry.attachTarget(target); }
  detachAll(cleanPageDom = false) { return this._s().sessionRegistry.detachAll(cleanPageDom); }

  getRegisteredChannel(id) { return this._s().channelOrchestrator.getRegisteredChannel(id); }
  resolveBundleCachePath() { return this._s().channelOrchestrator.resolveBundleCachePath(); }
  _readCdpTreeSig() { return this._s().channelOrchestrator.readCdpTreeSig(); }
  _readCdpFileSig() { return this._s().channelOrchestrator.readCdpFileSig(); }
  _resolveBundleCachePath() { return this._s().channelOrchestrator.resolveBundleCachePath(); }
  _buildWallpaperExprForConfig(cfg, opts) { return this._s().channelOrchestrator.buildChannelExpr('wallpaper', cfg, opts); }
  _syncHomeStudioOnEntry(entry, cfg, opts) { return this._s().channelOrchestrator.syncChannelOnEntry('homeStudio', entry, cfg, opts); }
  _scheduleBundleCacheFlush() { return this._s().channelOrchestrator.scheduleBundleCacheFlush(); }
  _getChannelCacheOpts(defer = true) { return this._s().channelOrchestrator.getChannelCacheOpts(defer); }
  _hasSafeV2SidebarClientFile() { return this._s().channelOrchestrator.hasSafeV2SidebarClientFile(); }
  _hasWallpaperClientFile() { return this._s().channelOrchestrator.hasChannelFile('wallpaper'); }
  _hasSuggesterClientFile() { return this._s().channelOrchestrator.hasChannelFile('suggester'); }
  _hasPeriodicPickerClientFile() { return this._s().channelOrchestrator.hasChannelFile('periodicPicker'); }
  _hasMascotClientFile() { return this._s().channelOrchestrator.hasChannelFile('mascot'); }
  _hasHomeStudioClientFile() { return this._s().channelOrchestrator.hasChannelFile('homeStudio'); }
  _isOmniEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('omni', cfg); }
  _isSidebarStudioEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('sidebar', cfg); }
  _isHostI18nEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('hostI18n', cfg); }
  _isThoughtEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('thought', cfg); }
  _isInlineDiffEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('inlineDiff', cfg); }
  _isWallpaperEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('wallpaper', cfg); }
  _isSuggesterEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('suggester', cfg); }
  _isPeriodicPickerEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('periodicPicker', cfg); }
  _isMascotEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('mascot', cfg); }
  _isHomeStudioEnabled(cfg) { return this._s().channelOrchestrator.isChannelEnabled('homeStudio', cfg); }
  _getChannelCodeHash(id, expr) { return this._s().channelOrchestrator.getChannelExprHash(id, expr); }
  _getChannelCfgSig(id, cfg, expr) { return this._s().channelOrchestrator.getChannelCfgSig(id, cfg, expr); }
  _getPeriodicPickerCodeHash(expr) { return this._getChannelCodeHash('periodicPicker', expr); }
  _getPeriodicPickerCfgSig(cfg, expr) { return this._getChannelCfgSig('periodicPicker', cfg, expr); }
  _getWallpaperCodeHash(expr) { return this._getChannelCodeHash('wallpaper', expr); }
  _getWallpaperCfgSig(cfg, expr) { return this._getChannelCfgSig('wallpaper', cfg, expr); }
  _getThoughtCodeHash(expr) { return this._getChannelCodeHash('thought', expr); }
  _getThoughtCfgSig(cfg, expr) { return this._getChannelCfgSig('thought', cfg, expr); }
  _getInlineDiffCodeHash(expr) { return this._getChannelCodeHash('inlineDiff', expr); }
  _getInlineDiffCfgSig(cfg, expr) { return this._getChannelCfgSig('inlineDiff', cfg, expr); }
  _getSuggesterCodeHash(expr) { return this._getChannelCodeHash('suggester', expr); }
  _getSuggesterCfgSig(cfg, expr) { return this._getChannelCfgSig('suggester', cfg, expr); }
  _getMascotCodeHash(expr) { return this._getChannelCodeHash('mascot', expr); }
  _getMascotCfgSig(cfg, expr) { return this._getChannelCfgSig('mascot', cfg, expr); }
  _getHomeStudioCodeHash(expr) { return this._getChannelCodeHash('homeStudio', expr); }
  _getHomeStudioCfgSig(cfg, expr) { return this._getChannelCfgSig('homeStudio', cfg, expr); }
  _ensureSettingsExpr(o) { return this._s().channelOrchestrator.ensureSettingsExpr(o); }
  _ensureHomeStudioExpr(c, o) { return this._s().channelOrchestrator.ensureChannelExpr('homeStudio', c, o); }
  _deliverSettingsChannelToEntry(e, ctx) { return this._s().channelOrchestrator.deliverSettingsChannelToEntry(e, ctx); }
  _deliverHomeStudioChannelToEntry(e, ctx) { return this._s().channelOrchestrator.deliverHomeStudioChannelToEntry(e, ctx); }
  _deliverPeriodicPickerFullToEntry(e, ctx) { return deliverPeriodicPickerFullToEntry(this._s().channelOrchestrator, e, ctx); }
  _teardownAllEntryChannelScripts(e, s, o) { return this._s().channelOrchestrator.teardownAllEntryChannelScripts(e, s, o); }
  _resolveWatchedConfigPath() { return this._s().channelOrchestrator.resolveWatchedConfigPath(); }
  _syncConfigFingerprintFromDisk(p) { return this._s().channelOrchestrator.syncConfigFingerprintFromDisk(p); }
  _isWatchedConfigUnchangedPeek(p) { return this._s().channelOrchestrator.isWatchedConfigUnchangedPeek(p); }
  _handleWatchedConfigChange(p) { return this._s().channelOrchestrator.handleWatchedConfigChange(p); }
  updateConfigBatch(entries) { return this._s().channelOrchestrator.updateConfigBatch(entries); }
  updateConfigSetting(k, v) { return this._s().channelOrchestrator.updateConfigSetting(k, v); }
  rebuildBundle(opts) { return this._s().channelOrchestrator.rebuildBundle(opts); }
  applyToEntry(entry) { return this._s().channelOrchestrator.applyToEntry(entry); }
  broadcastConfigRefresh() { return this._s().channelOrchestrator.broadcastConfigRefresh(); }
  verifyAndHealEntry(entry, force = false) { return this._s().channelOrchestrator.verifyAndHealEntry(entry, force); }
  _verifyAndHealEntryUnlocked(entry, force = false) { return this._s().channelOrchestrator.verifyAndHealEntryUnlocked(entry, force); }
  ensureOmniServer() { return this._s().channelOrchestrator.services.ensureOmniServer(); }
  ensureSidebarService() { return this._s().channelOrchestrator.services.ensureSidebarService(); }
  ensureThoughtService() { return this._s().channelOrchestrator.services.ensureThoughtService(); }
  ensureWallpaperService() { return this._s().channelOrchestrator.services.ensureWallpaperService(); }
  ensureSuggesterService() { return this._s().channelOrchestrator.services.ensureSuggesterService(); }

  _isSwarmI18nEnabled(cfg) { return this._s().channelOrchestrator.swarmManager.isSwarmI18nEnabled(cfg); }
  _isSwarmTargetInfo(info) { return this._s().channelOrchestrator.swarmManager.isSwarmTargetInfo(info); }
  _ensureSwarmI18nExpr(cfg) { return this._s().channelOrchestrator.swarmManager.ensureSwarmI18nExpr(cfg); }
  _attachSwarmTarget(info, cfg) { return this._s().channelOrchestrator.swarmManager.attachSwarmTarget(info, cfg); }
  _detachSwarmSession(tid, clean) { return this._s().channelOrchestrator.swarmManager.detachSwarmSession(tid, clean); }
  _detachAllSwarmSessions(clean) { return this._s().channelOrchestrator.swarmManager.detachAllSwarmSessions(clean); }
  _handleSwarmTargetEvent(info) { return this._s().channelOrchestrator.swarmManager.handleSwarmTargetEvent(info); }
  _scanExistingSwarmTargets(bs) { return this._s().channelOrchestrator.swarmManager.scanExistingSwarmTargets(bs); }
  _syncSwarmSessionsForConfig(cfg) { return this._s().channelOrchestrator.swarmManager.syncSwarmSessionsForConfig(cfg); }
  _getMainFrameIsolatedContextIds(entry, filterIds) {
    if (typeof this._s === 'function') return this._s().channelOrchestrator.swarmManager.getMainFrameIsolatedContextIds(entry, filterIds);
    return new SwarmSessionManager({ getCdp: () => this.cdp }).getMainFrameIsolatedContextIds(entry, filterIds);
  }
  _syncIsolatedHostI18n(e, p, o) {
    if (typeof this._s === 'function') return this._s().channelOrchestrator.swarmManager.syncIsolatedHostI18n(e, p, o);
    return new SwarmSessionManager({ getCdp: () => this.cdp }).syncIsolatedHostI18n(e, p, o);
  }

  _isTelemetryDisabled(cfg) { return this._s().telemetrySubsystem.isDisabled(cfg); }
  _releaseIdleTelemetry(force) { return this._s().telemetrySubsystem.releaseIdle(force); }
  _resolveTelemetryDataDir() { return this._s().telemetrySubsystem.resolveDataDir(); }
  _syncClientCdpPort(c) { return this._s().telemetrySubsystem.syncClientCdpPort(c); }
  ensureLazyDesktopUsage() { return this._s().telemetrySubsystem.ensureLazyDesktopUsage(); }
  ensureMetricsCollector() { return this._s().telemetrySubsystem.ensureMetricsCollector(); }
  ensureLsClient() { return this._s().telemetrySubsystem.ensureLsClient(); }
  _resolveActiveUsageCachePath() { return this._s().telemetrySubsystem.resolveUsageCachePath(); }
  _loadUsageDiskCache() { return this._s().telemetrySubsystem.loadUsageDiskCache(); }
  _getUsageDiskCacheScope(s, c) { return this._s().telemetrySubsystem.getUsageDiskCacheScope(s, c); }
  _putUsageDiskCache(id, sc, lm, rec, sk, dm) { return this._s().telemetrySubsystem.putUsageDiskCache(id, sc, lm, rec, sk, dm); }
  _flushUsageDiskCache() { return this._s().telemetrySubsystem.flushUsageDiskCache(); }
  _flushUsageDiskCacheAsync() { return this._s().telemetrySubsystem.flushUsageDiskCacheAsync(); }
  _resolveEntryScopeKey(e) { return this._s().telemetrySubsystem.resolveEntryScopeKey(e); }
  _getRendererRpcCandidates(o) { return this._s().telemetrySubsystem.getRendererRpcCandidates(o); }
  _createScopedRendererClient(e, sk, o) { return this._s().telemetrySubsystem.createScopedRendererClient(e, sk, o); }
  _resolveActiveRpcScope() { return this._s().telemetrySubsystem.resolveActiveRpcScope(); }
  _evalRendererRpcOnEntry(e, m, b, t, o) { return this._s().telemetrySubsystem.evalRendererRpcOnEntry(e, m, b, t, o); }
  _invokeRendererLsRpc(m, b, o) { return this._s().telemetrySubsystem.invokeRendererLsRpc(m, b, o); }
  _fetchFullGeneratorMetadata(c, id) { return this._s().telemetrySubsystem.fetchFullGeneratorMetadata(c, id); }
  _discoverLocalAppConversations() { return this._s().telemetrySubsystem.discoverLocalAppConversations(); }
  _getDiscoveredSubagents(sk) { return this._s().telemetrySubsystem.getDiscoveredSubagents(sk); }
  _recordDiscoveredSubagents(p, t, w, s) { return this._s().telemetrySubsystem.recordDiscoveredSubagents(p, t, w, s); }
  _rememberDiscoveredSubagentList(items, sk) { return this._s().telemetrySubsystem.rememberDiscoveredSubagentList(items, sk); }
  _fetchBackendTrajectorySummaries(c, u, f, ctx) { return this._s().telemetrySubsystem.fetchBackendTrajectorySummaries(c, u, f, ctx); }
  fetchUsageRollupBatch(items, opts) { return this._s().telemetrySubsystem.fetchUsageRollupBatch(items, opts); }

  resolveGitRepoDir() { return this._s().updateStorageSubsystem.resolveGitRepoDir(); }
  _getAutoUpdateSetting() { return this._s().updateStorageSubsystem.getAutoUpdateSetting(); }
  _inspectGitRepoState(o) { return this._s().updateStorageSubsystem.inspectGitRepoState(o); }
  _executeGitPullHotReload(g, a) { return this._s().updateStorageSubsystem.executeGitPullHotReload(g, a); }
  _getUpdateChannelSetting(c) { return this._s().updateStorageSubsystem.getUpdateChannelSetting(c); }
  _syncUpdateServiceChannel(c) { return this._s().updateStorageSubsystem.syncUpdateServiceChannel(c); }
  _extractExplicitUpdateChannel(r) { return this._s().updateStorageSubsystem.extractExplicitUpdateChannel(r); }
  _buildCombinedUpdateStatus(o) { return this._s().updateStorageSubsystem.buildCombinedUpdateStatus(o); }
  runUpdateCheck(o) { return this._s().updateStorageSubsystem.runUpdateCheck(o); }
  executeRepoAction(r, s) { return this._s().updateStorageSubsystem.executeRepoAction(r, s); }
  _getAutoArchiveOnExitSetting() { return this._s().updateStorageSubsystem.getAutoArchiveOnExitSetting(); }
  _readStorageGuardState() { return this._s().updateStorageSubsystem.readStorageGuardState(); }
  _writeStorageGuardState(p) { return this._s().updateStorageSubsystem.writeStorageGuardState(p); }
  _rememberVisibleMainIds(ids) { return this._s().updateStorageSubsystem.rememberVisibleMainIds(ids); }
  _collectArchiveExtraSignals(c, v, e) { return this._s().updateStorageSubsystem.collectArchiveExtraSignals(c, v, e); }
  _flushCatalogIndexFromMemory(a, c, d) { return this._s().updateStorageSubsystem.flushCatalogIndexFromMemory(a, c, d); }
  _checkActiveHostIdleState(o) { return this._s().updateStorageSubsystem.checkActiveHostIdleState(o); }
  _snapshotUsageBeforeArchive(c, o) { return this._s().updateStorageSubsystem.snapshotUsageBeforeArchive(c, o); }
  _resolveCdpQuitTarget(o) { return this._s().updateStorageSubsystem.resolveCdpQuitTarget(o); }
  _handleStorageAction(a, o, r) { return this._s().updateStorageSubsystem.handleStorageAction(a, o, r); }
  _handleRestoreArchiveAction(r, o) { return this._s().updateStorageSubsystem.handleRestoreArchiveAction(r, o); }
  _handleStorageSnoozeAction(r) { return this._s().updateStorageSubsystem.handleStorageSnoozeAction(r); }
  _handleGoMemLimitAction(a, r) { return this._s().updateStorageSubsystem.handleGoMemLimitAction(a, r); }
  _handleAddonsAction(a, r) { return this._s().updateStorageSubsystem.handleAddonsAction(a, r); }
  _resolveStorageGuardLanguage(e, c, o) { return this._s().updateStorageSubsystem.resolveStorageGuardLanguage(e, c, o); }
  _checkStorageGuardAndNotify(o) { return this._s().updateStorageSubsystem.checkStorageGuardAndNotify(o); }
  _maybeRunAutoArchiveOnExit(o) { return this._s().updateStorageSubsystem.maybeRunAutoArchiveOnExit(o); }
  _handleUninstallAction(r) { return this._s().updateStorageSubsystem.handleUninstallAction(r); }

  _isRelaunchGuardAllowed() { return this._s().relaunchGuard.isRelaunchGuardAllowed(); }
  _readDiskRawConfig() { return this._s().relaunchGuard.readDiskRawConfig(); }
  _resetShortcutBackoff(r) { return this._s().relaunchGuard.resetShortcutBackoff(r); }
  _maybeSyncShortcuts(f, o) { return this._s().relaunchGuard.maybeSyncShortcuts(f, o); }
  _handleMissingCdpPort() { return this._s().relaunchGuard.handleMissingCdpPort(); }

  _isTrustedMainFrameBindingCall(e, ctx) { return isTrustedMainFrameBindingCall(e, ctx); }
  _resolveTrustedBroadcastContextId(other) { return resolveTrustedBroadcastContextId(other); }
  handleBindingCall(entry, params) { return this._s().rpcDispatcher.handleBindingCall(entry, params); }

  _recoverPendingRunInBackgroundOnBoot() { return this._s().daemonLoop.recoverPendingRunInBackgroundOnBoot(); }
  tick() { return this._s().daemonLoop.tick(); }
  start(opts) { return this._s().daemonLoop.start(opts); }
  stop(cleanPageDom = false, _testOverrides = null) { return this._s().daemonLoop.stop(cleanPageDom, _testOverrides); }
}

function resolveCliShardedBundleCachePath(rootDir, gitRepoDir) {
  if (typeof process.env.AG_PRISM_BUNDLE_CACHE_PATH === 'string' && process.env.AG_PRISM_BUNDLE_CACHE_PATH.trim()) {
    return undefined;
  }
  try {
    const absRoot = path.resolve(rootDir || DEFAULT_ROOT_DIR);
    const isGit = Boolean(
      (gitRepoDir && path.resolve(gitRepoDir).toLowerCase() === absRoot.toLowerCase()) ||
        fs.existsSync(path.join(absRoot, '.git'))
    );
    if (!isGit) {
      const st = fs.lstatSync(absRoot);
      if (!st.isSymbolicLink() && st.isDirectory()) {
        fs.accessSync(absRoot, fs.constants.W_OK);
        return path.join(absRoot, '.bundle-cache');
      }
    }
  } catch {}
  return undefined;
}

export function readCliPollIntervalMs(rootDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(rootDir || DEFAULT_ROOT_DIR, 'config.json'), 'utf8'));
    const v = raw && typeof raw === 'object' ? raw.pollIntervalMs : undefined;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 500 && v <= 60000) return v;
  } catch {}
  return undefined;
}

// SAFE BUILD (2026-11-27): the daemon must never outlive the process that
// started it (Antigravity's sidecar runner, or your terminal). Upstream kept
// polling forever after Antigravity closed when it was spawned detached.
export function startParentExitWatchdog(daemon, {
  parentPid = process.ppid,
  intervalMs = 10000,
  isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return Boolean(err && err.code === 'EPERM');
    }
  },
  exit = (code) => process.exit(code),
} = {}) {
  if (process.env.PRISM_NO_PARENT_WATCHDOG === '1') return null;
  if (!Number.isInteger(parentPid) || parentPid <= 1 || !isAlive(parentPid)) return null;
  let stopping = false;
  const timer = setInterval(() => {
    if (stopping || isAlive(parentPid)) return;
    stopping = true;
    clearInterval(timer);
    try { daemon.log(`[safe-build] parent process ${parentPid} exited; stopping daemon`); } catch {}
    Promise.resolve()
      .then(() => daemon.stop(false, { skipAutoArchive: true }))
      .catch(() => {})
      .finally(() => exit(0));
  }, Math.max(1000, intervalMs));
  timer.unref?.();
  return timer;
}

// SAFE BUILD (2026-11-27): when the "Antigravity (Prism)" launcher starts the
// daemon (src/platform/prism-launch.cjs) there is no parent to watch, so the
// daemon quits once Antigravity's debug port has been gone for `goneMs`, or if
// it never shows up within `startupGraceMs`.
export function startHostGoneWatchdog(daemon, {
  env = process.env,
  intervalMs = 5000,
  startupGraceMs = 180000,
  goneMs = 60000,
  now = () => Date.now(),
  isHostActive = () => Boolean(daemon._hasActiveCdpPort),
  exit = (code) => process.exit(code),
} = {}) {
  if (env.PRISM_EXIT_WHEN_HOST_GONE !== '1') return null;
  const startedAt = now();
  let lastActiveAt = null;
  let stopping = false;
  const timer = setInterval(() => {
    if (stopping) return;
    const t = now();
    if (isHostActive()) {
      lastActiveAt = t;
      return;
    }
    const seen = lastActiveAt !== null;
    const idleMs = t - (seen ? lastActiveAt : startedAt);
    if (idleMs < (seen ? goneMs : startupGraceMs)) return;
    stopping = true;
    clearInterval(timer);
    try { daemon.log(`[safe-build] Antigravity debug port gone for ${Math.round(idleMs / 1000)}s; stopping daemon`); } catch {}
    Promise.resolve()
      .then(() => daemon.stop(false, { skipAutoArchive: true }))
      .catch(() => {})
      .finally(() => exit(0));
  }, Math.max(1000, intervalMs));
  timer.unref?.();
  return timer;
}

export function runDaemonCli(argv = process.argv) {
  const cli = parseArgs(argv);
  const shardedCachePath = resolveCliShardedBundleCachePath(cli.rootDir, cli.gitRepoDir);
  const cfgPollMs = readCliPollIntervalMs(cli.rootDir);
  const daemon = new PrismDaemon({
    rootDir: cli.rootDir,
    gitRepoDir: cli.gitRepoDir,
    overridePort: cli.port,
    ...(cfgPollMs !== undefined ? { pollIntervalMs: cfgPollMs } : {}),
    ...(shardedCachePath ? { bundleCachePath: shardedCachePath } : {}),
  });

  if (cli.once) {
    daemon.running = true;
    daemon.rebuildBundle();
    daemon
      .tick()
      .then(async (res) => {
        if (cli.outFile) {
          fs.writeFileSync(cli.outFile, JSON.stringify({ ok: true, ...res }, null, 2), 'utf8');
        } else {
          console.log(JSON.stringify({ ok: true, ...res }, null, 2));
        }
        await daemon.stop(false, { skipAutoArchive: true });
        process.exit(0);
      })
      .catch(async (err) => {
        console.error('[obsidian-prism daemon] error:', err.message);
        await daemon.stop(false, { skipAutoArchive: true });
        process.exitCode = 1;
      });
  } else {
    daemon.start({ claimPid: true, watchFiles: true });
    registerDaemonShutdownSignals(daemon);
    startParentExitWatchdog(daemon);
    startHostGoneWatchdog(daemon);
    process.on('uncaughtException', (err) => {
      daemon.log(`[!] uncaughtException: ${err?.stack || err}`);
    });
    process.on('unhandledRejection', (err) => {
      daemon.log(`[!] unhandledRejection: ${err?.stack || err}`);
    });
  }
  return daemon;
}

export {
  SessionRegistry,
  ChannelOrchestrator,
  TelemetrySubsystem,
  UpdateStorageSubsystem,
  RpcDispatcher,
  DaemonLoop,
  DaemonLogger,
  PidLockManager,
  RelaunchGuard,
  sanitizeSecretText,
  sanitizeLogLine,
  copyUpdatedRuntimeFromRepo,
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
  INLINE_DIFF_BINDING,
  SIDEBAR_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
  OmniServer,
  OMNI_BINDING,
  resolveStorageGuardStatePath,
  resolveUsageCachePath,
  normalizeUsageScopeKey,
  extractScopeKeyFromUri,
  extractScopeKeyFromTitle,
  resolveUsageScopeKey,
  hasRealUsageRecord,
  sanitizeGitRemoteUrl,
  writeFileAtomicSync,
  writeFileAtomicAsync,
  formatJsonArgForEval,
  evalRendererRpcOnEntry,
  isSensitiveInlineDiffPath,
  readSafeInlineDiff,
  resolvePortFileCandidates,
  discoverActivePort,
  isEligibleTarget,
  isPluginEnabledInHostConfig,
  parseTasklistCsvImageName,
  queryWindowsProcessImageNameSync,
  verifyDaemonPidLockToken,
  isObsidianPrismDaemonCommandLine,
  isMainEntry,
  DAEMON_SHUTDOWN_SIGNALS,
  registerDaemonShutdownSignals,
  isTrustedMainFrameBindingCall,
  isTrustedHostContext,
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  CHANNEL_FSM_STATES,
  AWAITING_DOM_MAX_ATTEMPTS,
  CHANNEL_CIRCUIT_FAIL_THRESHOLD,
  ConfigFingerprintTracker,
  computeConfigFingerprint,
  extractSignificantTargetUrl,
  isSameSpaDocumentRoute,
  evaluateTargetInfoChange,
};
