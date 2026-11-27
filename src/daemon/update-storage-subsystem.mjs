// Obsidian Prism 更新与存储守卫子系统（UpdateStorageSubsystem：封装更新检查、Git 热更、存储体检弹窗、退出归档、GoMemLimit、Addons 与卸载，无原型 Mixin）
import path from 'node:path';
import { UpdateService } from '../../sidecars/daemon/update-service.mjs';
import { AddonRegistry } from '../../sidecars/daemon/addon-registry.mjs';
import { PKG_VERSION, resolveStorageGuardStatePath } from './constants.mjs';
import {
  resolveGitRepoDir,
  getAutoUpdateSetting,
  inspectGitRepoState,
  executeGitPullHotReload,
  getUpdateChannelSetting,
  syncUpdateServiceChannel,
  extractExplicitUpdateChannel,
  buildCombinedUpdateStatus,
  runUpdateCheck,
  executeRepoAction,
} from './repo-update-coordinator.mjs';
import {
  getAutoArchiveOnExitSetting,
  readStorageGuardState,
  writeStorageGuardState,
  rememberVisibleMainIds,
  collectArchiveExtraSignals,
  flushCatalogIndexFromMemory,
  checkActiveHostIdleState,
  snapshotUsageBeforeArchive,
  resolveCdpQuitTarget,
  handleStorageAction,
} from './storage-guard-actions.mjs';
import {
  handleRestoreArchiveAction,
  handleStorageSnoozeAction,
  handleGoMemLimitAction,
  handleAddonsAction,
  resolveStorageGuardLanguage,
  checkStorageGuardAndNotify,
  maybeRunAutoArchiveOnExit,
  handleUninstallAction,
} from './storage-guard-coordinator.mjs';

export class UpdateStorageSubsystem {
  constructor({
    rootDir = '',
    gitRepoDir = null,
    overridePort = null,
    portFile = null,
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
    getCdp = () => null,
    isRunning = () => false,
    log = () => {},
    sessionRegistry = null,
    channelOrchestrator = null,
    telemetry = null,
    getInspectGitRepoHook = null,
    invokeRebuildBundle = null,
    invokeApplyToEntry = null,
    invokeBroadcastConfigRefresh = null,
    invokeStop = null,
    getCdpPort = () => 0,
  } = {}) {
    this.rootDir = rootDir;
    this.gitRepoDir = gitRepoDir;
    this._overridePort = overridePort;
    this._portFile = portFile;
    this._getCdp = getCdp;
    this._isRunning = isRunning;
    this._log = log;
    this.sessionRegistry = sessionRegistry;
    this.channelOrchestrator = channelOrchestrator;
    this.telemetry = telemetry;
    this._getInspectGitRepoHook = getInspectGitRepoHook;
    this._invokeRebuildBundle = invokeRebuildBundle;
    this._invokeApplyToEntry = invokeApplyToEntry;
    this._invokeBroadcastConfigRefresh = invokeBroadcastConfigRefresh;
    this._invokeStop = invokeStop;
    this._getCdpPort = getCdpPort;

    this._storageHealthCache = null;
    this._storageHealthAt = 0;
    this._storageGuardStateFile = resolveStorageGuardStatePath(storageGuardStatePath);
    // SAFE BUILD (2026-11-27): the storage-guard banner only ever offered the
    // removed conversation-archive action, so its timer stays off.
    this._enableStorageGuardTimer = false;
    void enableStorageGuardTimer;
    const sgInit = Number(storageGuardInitialDelayMs);
    this._storageGuardInitialDelayMs = Number.isFinite(sgInit) ? Math.max(0, sgInit) : 35000;
    const sgInt = Number(storageGuardIntervalMs);
    this._storageGuardIntervalMs = Number.isFinite(sgInt) ? Math.max(5000, sgInt) : 300000;
    this._storageGuardInitialTimer = null;
    this._storageGuardIntervalTimer = null;
    this._storageGuardBannerShownAt = 0;
    this._lastStorageIndexRefreshAt = 0;
    this._lastVisibleMainIds = null;
    this._sawLiveHost = false;
    this._autoArchiveExitRan = false;
    this._autoArchiveInFlight = false;
    this._archiveActionInFlight = false;
    this._archiveScheduledAt = 0;
    this._isUninstalling = false;

    // SAFE BUILD (2026-11-27): no update checks, ever.
    this._enableAutoUpdateTimer = false;
    void enableAutoUpdateTimer;
    const initDelayNum = Number(updateCheckInitialDelayMs);
    this._updateCheckInitialDelayMs = Number.isFinite(initDelayNum) ? Math.max(0, initDelayNum) : 45000;
    const intervalNum = Number(updateCheckIntervalMs);
    this._updateCheckIntervalMs = Number.isFinite(intervalNum) ? Math.max(1000, intervalNum) : 6 * 60 * 60 * 1000;
    this._updateInitialTimer = null;
    this._updateIntervalTimer = null;
    this._lastUpdateState = null;
    this._updateCheckInFlight = null;
    this._updateCheckInFlightChannel = null;

    const initialUpdateChannel = getUpdateChannelSetting(this);
    const cdp = this.getCdp();
    this.updateService =
      _testUpdateService ||
      new UpdateService({
        currentVersion: cdp?.PLUGIN_VERSION || PKG_VERSION,
        channel: initialUpdateChannel,
      });
    if (_testUpdateService && typeof _testUpdateService.setChannel === 'function') {
      try {
        _testUpdateService.setChannel(initialUpdateChannel);
      } catch {}
    }
    this.addonRegistry =
      _testAddonRegistry ||
      new AddonRegistry({
        rootDir: this.rootDir,
        ...(addonsDir ? { addonsDir } : {}),
      });
  }

  getCdp() { return this._getCdp(); }
  isRunning() { return Boolean(this._isRunning?.()); }
  log(m) { this._log?.(m); }
  getSessions() { return this.sessionRegistry?.sessions || new Map(); }
  getBrowserPort() { return this.sessionRegistry?.browserPort || 0; }
  getOverridePort() { return this._overridePort; }
  getPortFile() { return this._portFile; }
  getCdpPort() { return this._getCdpPort?.() || 0; }

  setRootDir(dir) {
    this.rootDir = dir;
  }

  invalidateStorageHealthCache() {
    this._storageHealthCache = null;
    this._storageHealthAt = 0;
  }

  markHostLive() {
    this._sawLiveHost = true;
    if (!(this._archiveScheduledAt > 0 && Date.now() - this._archiveScheduledAt < 60000)) {
      this._autoArchiveExitRan = false;
    }
  }

  updateConfigSetting(key, value) {
    return this.channelOrchestrator.updateConfigSetting(key, value);
  }

  invokeRebuildBundle(opts) {
    if (typeof this._invokeRebuildBundle === 'function') return this._invokeRebuildBundle(opts);
    return this.channelOrchestrator.rebuildBundle(opts);
  }

  invokeApplyToEntry(entry) {
    if (typeof this._invokeApplyToEntry === 'function') return this._invokeApplyToEntry(entry);
    return this.channelOrchestrator.applyToEntry(entry);
  }

  invokeBroadcastConfigRefresh() {
    if (typeof this._invokeBroadcastConfigRefresh === 'function') return this._invokeBroadcastConfigRefresh();
    return this.channelOrchestrator.broadcastConfigRefresh();
  }

  invokeStop(cleanPageDom) {
    if (typeof this._invokeStop === 'function') return this._invokeStop(cleanPageDom);
    return Promise.resolve();
  }

  resolveGitRepoDir() { return resolveGitRepoDir(this); }
  getAutoUpdateSetting() { return getAutoUpdateSetting(this); }
  async inspectGitRepoState(opts = {}) {
    if (typeof this._getInspectGitRepoHook === 'function') {
      const hook = this._getInspectGitRepoHook();
      if (typeof hook === 'function') return hook(opts);
    }
    return inspectGitRepoState(this, opts);
  }
  executeGitPullHotReload(gitState, actionName = 'pull') { return executeGitPullHotReload(this, gitState, actionName); }
  getUpdateChannelSetting(cfgOverride = null) { return getUpdateChannelSetting(this, cfgOverride); }
  syncUpdateServiceChannel(cfgOverride = null) { return syncUpdateServiceChannel(this, cfgOverride); }
  extractExplicitUpdateChannel(rawInput) { return extractExplicitUpdateChannel(rawInput); }
  buildCombinedUpdateStatus(opts = {}) { return buildCombinedUpdateStatus(this, opts); }
  runUpdateCheck(opts = {}) { return runUpdateCheck(this, opts); }
  executeRepoAction(rawInput = {}, secondArg = undefined) { return executeRepoAction(this, rawInput, secondArg); }

  getAutoArchiveOnExitSetting() { return getAutoArchiveOnExitSetting(this); }
  readStorageGuardState() { return readStorageGuardState(this); }
  writeStorageGuardState(patch = {}) { return writeStorageGuardState(this, patch); }
  rememberVisibleMainIds(ids = []) { return rememberVisibleMainIds(this, ids); }
  collectArchiveExtraSignals(convDir, visibleMainIds = [], extraSubagents = null) {
    return collectArchiveExtraSignals(this, convDir, visibleMainIds, extraSubagents);
  }
  flushCatalogIndexFromMemory(arch, convDir, archiveDir) {
    return flushCatalogIndexFromMemory(this, arch, convDir, archiveDir);
  }
  checkActiveHostIdleState(_testOverrides = null) { return checkActiveHostIdleState(this, _testOverrides); }
  snapshotUsageBeforeArchive(candidateItems = [], opts = {}) { return snapshotUsageBeforeArchive(this, candidateItems, opts); }
  resolveCdpQuitTarget(_testOverrides = null) { return resolveCdpQuitTarget(this, _testOverrides); }
  handleStorageAction(action, _testOverrides = null, rawInput = {}) {
    return handleStorageAction(this, action, _testOverrides, rawInput);
  }

  handleRestoreArchiveAction(rawInput = {}, _testOverrides = null) {
    return handleRestoreArchiveAction(this, rawInput, _testOverrides);
  }
  handleStorageSnoozeAction(rawInput = {}) { return handleStorageSnoozeAction(this, rawInput); }
  handleGoMemLimitAction(action, rawInput = {}) { return handleGoMemLimitAction(action, rawInput); }
  handleAddonsAction(action, rawInput = {}) { return handleAddonsAction(this, action, rawInput); }
  resolveStorageGuardLanguage(targetEntry, cfg = null, _testOverrides = null) {
    return resolveStorageGuardLanguage(this, targetEntry, cfg, _testOverrides);
  }
  checkStorageGuardAndNotify(_testOverrides = null) { return checkStorageGuardAndNotify(this, _testOverrides); }
  maybeRunAutoArchiveOnExit(_testOverrides = null) { return maybeRunAutoArchiveOnExit(this, _testOverrides); }
  handleUninstallAction(rawInput = {}) { return handleUninstallAction(this, rawInput); }

  triggerDetachedExitArchiveSync(arch, cleanPageDom = false, _testOverrides = null) {
    // SAFE BUILD (2026-11-27): never move Antigravity conversation files on exit.
    return false;
  }

  startTimers() {
    if (this._enableAutoUpdateTimer) {
      this._updateInitialTimer = setTimeout(() => {
        this._updateInitialTimer = null;
        if (this.isRunning() && this.getAutoUpdateSetting() === 'on') {
          void this.runUpdateCheck({ force: false, manual: false, allowAutoApply: true }).catch(() => {});
        }
      }, this._updateCheckInitialDelayMs);
      this._updateInitialTimer?.unref?.();

      this._updateIntervalTimer = setInterval(() => {
        if (this.isRunning() && this.getAutoUpdateSetting() === 'on') {
          void this.runUpdateCheck({ force: false, manual: false, allowAutoApply: true }).catch(() => {});
        }
      }, this._updateCheckIntervalMs);
      this._updateIntervalTimer?.unref?.();
    }

    if (this._enableStorageGuardTimer) {
      this._storageGuardInitialTimer = setTimeout(() => {
        this._storageGuardInitialTimer = null;
        if (this.isRunning()) {
          void this.checkStorageGuardAndNotify().catch(() => {});
        }
      }, this._storageGuardInitialDelayMs);
      this._storageGuardInitialTimer?.unref?.();

      this._storageGuardIntervalTimer = setInterval(() => {
        if (this.isRunning()) {
          void this.checkStorageGuardAndNotify().catch(() => {});
        }
      }, this._storageGuardIntervalMs);
      this._storageGuardIntervalTimer?.unref?.();
    }
  }

  stopTimers() {
    if (this._storageGuardInitialTimer) {
      clearTimeout(this._storageGuardInitialTimer);
      this._storageGuardInitialTimer = null;
    }
    if (this._storageGuardIntervalTimer) {
      clearInterval(this._storageGuardIntervalTimer);
      this._storageGuardIntervalTimer = null;
    }
    if (this._updateInitialTimer) {
      clearTimeout(this._updateInitialTimer);
      this._updateInitialTimer = null;
    }
    if (this._updateIntervalTimer) {
      clearInterval(this._updateIntervalTimer);
      this._updateIntervalTimer = null;
    }
  }
}
