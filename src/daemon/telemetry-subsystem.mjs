// Obsidian Prism 遥测子系统（TelemetrySubsystem：封装 UsageService、4MB LRU 盘缓存、LS-RPC 60s 冷却与 Scope 隔离，无原型 Mixin）
import { QuotaForceRefreshGuard } from './quota-guard.mjs';
import { resolveUsageCachePath } from './constants.mjs';
import {
  resolveEntryScopeKey,
  getRendererRpcCandidates,
  createScopedRendererClient,
  resolveActiveRpcScope,
  evalRendererRpcOnEntry,
  invokeRendererLsRpc,
} from './telemetry-scope.mjs';
import {
  isTelemetryDisabled,
  releaseIdleTelemetry,
  resolveTelemetryDataDir,
  syncClientCdpPort,
  ensureLazyDesktopUsage,
  ensureMetricsCollector,
  ensureLsClient,
  resolveActiveUsageCachePath,
  loadUsageDiskCache,
  getUsageDiskCacheScope,
  putUsageDiskCache,
  flushUsageDiskCache,
  flushUsageDiskCacheAsync,
} from './telemetry-cache.mjs';
import {
  fetchFullGeneratorMetadata,
  discoverLocalAppConversations,
  getDiscoveredSubagents,
  recordDiscoveredSubagents,
  rememberDiscoveredSubagentList,
  fetchBackendTrajectorySummaries,
  fetchUsageRollupBatch,
} from './telemetry-service.mjs';

export class TelemetrySubsystem {
  constructor({
    rootDir = '',
    overridePort = null,
    portFile = null,
    usageCachePath = undefined,
    metricsProvider = null,
    quotaCooldownNow = null,
    getCdp = () => null,
    getSessions = () => new Map(),
    getEnsureLsClientHook = null,
    getDiscoverLocalHook = null,
    getRendererCandidatesHook = null,
  } = {}) {
    this._rootDir = rootDir;
    this._overridePort = overridePort;
    this._portFile = portFile;
    this._getCdp = getCdp;
    this._getSessions = getSessions;
    this._getEnsureLsClientHook = getEnsureLsClientHook;
    this._getDiscoverLocalHook = getDiscoverLocalHook;
    this._getRendererCandidatesHook = getRendererCandidatesHook;

    this._lazyStore = null;
    this._lazyUsage = null;
    this._lazyLsClient = null;
    this._backendSummariesCache = null;
    this._backendSummariesAt = 0;
    this._usageCachePathOpt = usageCachePath;
    this._usageCacheFile = resolveUsageCachePath(usageCachePath);
    this._usageDiskCache = null;
    this._usageCacheDirty = false;
    this._usageCacheTimer = null;
    this._usageCacheFlushPromise = null;
    this._usageCacheFlushEpoch = 0;
    this._usageCacheFlushGen = 0;
    this._usageCacheRetiredPromises = new Set();
    this._scopedTrajCache = new Map();
    this._scopedTrajInFlight = new Map();
    this._lastTelemetryActivityAt = 0;
    this._telemetryInFlight = 0;
    this._customMetricsProvider = metricsProvider;
    this._telemetryDataDir = '';
    this._discoveredSubagentsByScope = null;
    this._rendererModelLabels = null;
    this._quotaForceRefreshGuard = new QuotaForceRefreshGuard({
      ...(typeof quotaCooldownNow === 'function' ? { now: quotaCooldownNow } : {}),
    });
  }

  setRootDir(dir) {
    this._rootDir = dir;
  }

  beginActivity() {
    this._telemetryInFlight = (this._telemetryInFlight || 0) + 1;
    this._lastTelemetryActivityAt = Date.now();
  }

  endActivity() {
    this._telemetryInFlight = Math.max(0, (this._telemetryInFlight || 1) - 1);
    this._lastTelemetryActivityAt = Date.now();
  }

  getWarmReaderSummaries() {
    return this._lazyStore?.client?.reader?.summaries || null;
  }

  getStoreSessions() {
    return this._lazyStore?.sessions || null;
  }

  isDisabled(cfgOverride = null) { return isTelemetryDisabled(this, cfgOverride); }
  releaseIdle(force = false) { return releaseIdleTelemetry(this, force); }
  resolveDataDir() { return resolveTelemetryDataDir(this); }
  syncClientCdpPort(clientOrStore) { return syncClientCdpPort(this, clientOrStore); }
  ensureLazyDesktopUsage() { return ensureLazyDesktopUsage(this); }
  ensureMetricsCollector() { return ensureMetricsCollector(this); }
  async ensureLsClient() {
    if (typeof this._getEnsureLsClientHook === 'function') {
      const hook = this._getEnsureLsClientHook();
      if (typeof hook === 'function') return hook();
    }
    return ensureLsClient(this);
  }
  resolveUsageCachePath() { return resolveActiveUsageCachePath(this); }
  loadUsageDiskCache() { return loadUsageDiskCache(this); }
  getUsageDiskCacheScope(scopeKey = 'local', create = false) { return getUsageDiskCacheScope(this, scopeKey, create); }
  putUsageDiskCache(id, stepCount, lastModifiedSec, record, scopeKey = 'local', diskMeta = null) {
    return putUsageDiskCache(this, id, stepCount, lastModifiedSec, record, scopeKey, diskMeta);
  }
  flushUsageDiskCache() { return flushUsageDiskCache(this); }
  flushUsageDiskCacheAsync() { return flushUsageDiskCacheAsync(this); }
  async waitPendingUsageFlush() {
    while (this._usageCacheFlushPromise || (this._usageCacheRetiredPromises && this._usageCacheRetiredPromises.size > 0)) {
      const pending = [];
      if (this._usageCacheFlushPromise) pending.push(this._usageCacheFlushPromise.catch(() => {}));
      if (this._usageCacheRetiredPromises && this._usageCacheRetiredPromises.size > 0) {
        for (const p of this._usageCacheRetiredPromises) pending.push(p.catch(() => {}));
      }
      await Promise.all(pending);
    }
  }

  resolveEntryScopeKey(entry) { return resolveEntryScopeKey(entry); }
  getRendererRpcCandidates(opts = null) {
    if (typeof this._getRendererCandidatesHook === 'function') {
      const hook = this._getRendererCandidatesHook();
      if (typeof hook === 'function') return hook(opts);
    }
    return getRendererRpcCandidates(this, opts);
  }
  createScopedRendererClient(entry, scopeKey, extraOpts = null) { return createScopedRendererClient(this, entry, scopeKey, extraOpts); }
  resolveActiveRpcScope() { return resolveActiveRpcScope(this); }
  evalRendererRpcOnEntry(entry, method, body = {}, timeoutMs = 12000, opts = undefined) {
    return evalRendererRpcOnEntry(entry, method, body, timeoutMs, opts);
  }
  invokeRendererLsRpc(method, body = {}, opts = null) { return invokeRendererLsRpc(this, method, body, opts); }

  fetchFullGeneratorMetadata(client, id) { return fetchFullGeneratorMetadata(client, id); }
  discoverLocalAppConversations() {
    if (typeof this._getDiscoverLocalHook === 'function') {
      const hook = this._getDiscoverLocalHook();
      if (typeof hook === 'function') return hook();
    }
    return discoverLocalAppConversations();
  }
  getDiscoveredSubagents(scopeKey = 'local') { return getDiscoveredSubagents(this, scopeKey); }
  recordDiscoveredSubagents(parentId, traj, parentWorkspace = '', scopeKey = 'local') {
    return recordDiscoveredSubagents(this, parentId, traj, parentWorkspace, scopeKey);
  }
  rememberDiscoveredSubagentList(items = [], scopeKey = 'local') {
    return rememberDiscoveredSubagentList(this, items, scopeKey);
  }
  fetchBackendTrajectorySummaries(client, usageCore, force = false, ctx = null) {
    return fetchBackendTrajectorySummaries(this, client, usageCore, force, ctx);
  }
  fetchUsageRollupBatch(rawItems, opts = {}) { return fetchUsageRollupBatch(this, rawItems, opts); }

  async disposeAll() {
    this.flushUsageDiskCache();
    const standaloneLsClient = this._lazyLsClient && this._lazyLsClient !== this._lazyStore?.client ? this._lazyLsClient : null;
    for (const svc of [this._lazyUsage, this._lazyStore, standaloneLsClient]) {
      if (!svc) continue;
      try {
        if (typeof svc.dispose === 'function') await svc.dispose();
        else if (typeof svc.close === 'function') await svc.close();
        else if (typeof svc.stop === 'function') await svc.stop();
      } catch {}
    }
    this._lazyUsage = null;
    this._lazyStore = null;
    this._lazyLsClient = null;
    this._backendSummariesCache = null;
    this._backendSummariesAt = 0;
    this._scopedTrajCache?.clear?.();
    this._scopedTrajInFlight?.clear?.();
    await this.waitPendingUsageFlush();
    this._usageDiskCache = null;
  }
}
