// Obsidian Prism 通道编排子系统（ChannelOrchestrator：唯一消费 CHANNEL_REGISTRY，封装 16 通道编译态、盘缓存、配置广播、自愈与后端服务）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { clearCdpRequireCache } from '../platform/repo-sync.cjs';
import { writeFileAtomicSync } from './fs-atomic.mjs';
import { isAutomatedTestRuntime } from './pid-lock.mjs';
import {
  ConfigFingerprintTracker,
  computeConfigFingerprint,
  resetAllChannelCircuits,
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelFailure,
} from './session-fsm.mjs';
import {
  CHANNEL_STATIC_SPECS,
  lookupRegistryChannel,
  readCdpTreeSig,
  hasChannelAssetFile,
  resolveChannelTeardown,
  computeChannelHash,
  isSpecEnabledForConfig,
  computeSpecCfgSig,
  buildSidebarCleanupExpression,
} from './channel-coordinator.mjs';
import { ChannelServiceManager } from './channel-services.mjs';
import { SwarmSessionManager } from './swarm-session-manager.mjs';
import {
  ensureChannelBinding,
  removeChannelBinding,
  replaceEntryNewDocScript,
  cleanupChannelOnEntry,
  teardownAllEntryChannelScripts,
  healSingleChannelOnEntry,
  applyAllChannelsToEntry,
  runBroadcastConfigRefresh,
  recordChannelEvalFailure,
} from './channel-sync-engine.mjs';
import { verifyAndHealEntry, verifyAndHealEntryUnlocked } from './session-heal.mjs';

const require = createRequire(import.meta.url);

export class ChannelOrchestrator {
  constructor(deps = {}) {
    this._deps = deps;
    this._rootDir = deps.rootDir || '';
    this._gitRepoDir = deps.gitRepoDir || null;
    this._bundleCachePathOpt = deps.bundleCachePath;

    this.injectExpr = '';
    this.codeHash = '';
    this._channelStore = new Map();
    for (const spec of CHANNEL_STATIC_SPECS) {
      this._channelStore.set(spec.id, { expr: '', hash: '', hashSrc: '' });
    }
    this._cdpFileSig = readCdpTreeSig(this._rootDir);
    this._bundleCacheFlushTimer = null;
    this._safeSidebarFileCache = null;
    this._clientFileExistsCache = new Map();

    this._configFingerprintTracker = new ConfigFingerprintTracker();
    this._configSeq = 0;
    this._broadcastRunning = false;
    this._broadcastPending = false;
    this._broadcastWaiters = [];
    this._configConvergenceDirty = false;

    this._fileCheckOverrides = new Map();
    this._enabledCheckOverrides = new Map();
    this._readCdpFileSigOverride = null;

    this.services = new ChannelServiceManager({
      rootDir: this._rootDir,
      getCdp: () => this.getCdp(),
      log: (m) => this.log(m),
      pickActiveSidebarHostEntry: () => this.sessionRegistry.pickActiveSidebarHostEntry(),
      omniExecHooks: deps.omniExecHooks || null,
      sidebarService: deps.sidebarService || null,
      thoughtService: deps.thoughtService || null,
      wallpaperService: deps.wallpaperService || null,
      suggesterService: deps.suggesterService || null,
      onOmniServerStarted: (srv) => {
        const cdp = this.getCdp();
        if (typeof cdp?.buildOmniClientExpression === 'function') {
          const opts = this.getChannelCacheOpts(true);
          const expr = opts
            ? cdp.buildOmniClientExpression(srv.getServerInfo(), null, opts)
            : cdp.buildOmniClientExpression(srv.getServerInfo());
          this.setChannelExpr('omni', expr);
          if (opts && this.isRunning()) this.scheduleBundleCacheFlush();
        }
      },
      onSidebarServiceStarted: () => {
        const cdp = this.getCdp();
        if (typeof cdp?.buildSidebarStudioExpression === 'function') {
          this.setChannelExpr('sidebar', this.buildSidebarExprForCurrentClient());
        }
      },
    });

    this.swarmManager = new SwarmSessionManager({
      getCdp: () => this.getCdp(),
      isRunning: () => this.isRunning(),
      log: (m) => this.log(m),
      redact: (t) => this.redact(t),
      getBrowserSession: () => this.sessionRegistry.browserSession,
      getSessions: () => this.sessionRegistry.sessions,
      getManagedTimers: () => this.sessionRegistry._managedTimers,
      getChannelCacheOpts: (defer) => this.getChannelCacheOpts(defer),
      scheduleBundleCacheFlush: () => this.scheduleBundleCacheFlush(),
    });
  }

  get sessionRegistry() { return this._deps.sessionRegistry; }
  getCdp() { return this._deps.getCdp(); }
  isRunning() { return Boolean(this._deps.isRunning?.()); }
  log(m) { this._deps.log?.(m); }
  redact(t) { return this._deps.redact ? this._deps.redact(t) : String(t || ''); }
  onTelemetryDisabled() { this._deps.onTelemetryDisabled?.(); }
  onConfigRefreshed(cfg) { this._deps.onConfigRefreshed?.(cfg); }
  invokeRebuildBundle(opts) {
    if (typeof this._deps.invokeRebuildBundle === 'function') return this._deps.invokeRebuildBundle(opts);
    return this.rebuildBundle(opts);
  }

  setRootDir(dir) {
    this._rootDir = dir;
    this.services.setRootDir(dir);
    this._safeSidebarFileCache = null;
    this._clientFileExistsCache?.clear?.();
  }

  getRegisteredChannel(id) {
    return lookupRegistryChannel(this.getCdp(), id);
  }

  _getSlot(id) {
    let slot = this._channelStore.get(id);
    if (!slot) {
      slot = { expr: '', hash: '', hashSrc: '' };
      this._channelStore.set(id, slot);
    }
    return slot;
  }

  getChannelExpr(id) {
    if (id === 'swarmI18n') return this.swarmManager.swarmI18nExpr;
    return this._getSlot(id).expr;
  }

  setChannelExpr(id, expr) {
    const next = typeof expr === 'string' ? expr : expr === null || expr === undefined ? '' : expr;
    if (id === 'swarmI18n') {
      this.swarmManager.swarmI18nExpr = next;
      return next;
    }
    const spec = this.getRegisteredChannel(id);
    const slot = this._getSlot(id);
    slot.expr = next;
    slot.hashSrc = typeof next === 'string' ? next : '';
    slot.hash = typeof next === 'string' && next ? computeChannelHash(spec, next) : '';
    return next;
  }

  getChannelHash(id) {
    if (id === 'swarmI18n') return this.swarmManager.swarmI18nCodeHash;
    return this._getSlot(id).hash;
  }

  setChannelHash(id, hash) {
    if (id === 'swarmI18n') {
      this.swarmManager.swarmI18nCodeHash = String(hash || '');
      return;
    }
    this._getSlot(id).hash = String(hash || '');
  }

  getChannelHashSource(id) {
    return this._getSlot(id).hashSrc;
  }

  setChannelHashSource(id, src) {
    this._getSlot(id).hashSrc = String(src || '');
  }

  getChannelExprHash(specOrId, exprOverride = undefined) {
    const spec = typeof specOrId === 'string' ? this.getRegisteredChannel(specOrId) : specOrId;
    if (!spec) return '';
    const slot = this._getSlot(spec.id);
    const str = typeof exprOverride === 'string' ? exprOverride : typeof slot.expr === 'string' ? slot.expr : '';
    if (!str) return '';
    if (str === slot.hashSrc && slot.hash) return slot.hash;
    const hash = computeChannelHash(spec, str);
    if (str === slot.expr) {
      slot.hashSrc = str;
      slot.hash = hash;
    }
    return hash;
  }

  getChannelCfgSig(specOrId, cfgOverride = null, exprOverride = undefined) {
    const spec = typeof specOrId === 'string' ? this.getRegisteredChannel(specOrId) : specOrId;
    if (!spec) return '';
    const cdp = this.getCdp();
    const cfg = cfgOverride || (typeof cdp?.readConfig === 'function' ? cdp.readConfig() : {}) || {};
    if (spec.id === 'thought' && !this.isChannelEnabled(spec, cfg)) return '';
    const hash = spec.hashMode !== 'none' ? this.getChannelExprHash(spec, exprOverride) : '';
    return computeSpecCfgSig(spec, cfg, hash);
  }

  getChannelCleanupExpression(specOrId) {
    const id = typeof specOrId === 'string' ? specOrId : specOrId?.id || '';
    if (id === 'sidebar') return buildSidebarCleanupExpression(true);
    return resolveChannelTeardown(this.getCdp(), specOrId);
  }

  readCdpTreeSig() {
    return readCdpTreeSig(this._rootDir);
  }

  readCdpFileSig() {
    if (typeof this._readCdpFileSigOverride === 'function') return this._readCdpFileSigOverride();
    const ov = this._deps.getMethodOverride?.('_readCdpFileSig');
    if (ov) return ov();
    return this.readCdpTreeSig();
  }

  isGitSourceDir(dirPath) {
    if (!dirPath) return false;
    try {
      const resolved = path.resolve(dirPath);
      if (this._gitRepoDir && resolved.toLowerCase() === this._gitRepoDir.toLowerCase()) return true;
      if (fs.existsSync(path.join(resolved, '.git'))) return true;
    } catch {}
    return false;
  }

  isWritableCacheDir(dirPath) {
    if (!dirPath) return false;
    try {
      const st = fs.lstatSync(dirPath);
      if (st.isSymbolicLink() || !st.isDirectory()) return false;
      fs.accessSync(dirPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  resolveBundleCachePath() {
    if (this._bundleCachePathOpt === false || this._bundleCachePathOpt === null) return null;
    if (typeof this._bundleCachePathOpt === 'string') {
      const trimmed = this._bundleCachePathOpt.trim();
      return trimmed ? path.resolve(trimmed) : null;
    }
    const envRaw = process.env.AG_PRISM_BUNDLE_CACHE_PATH;
    if (typeof envRaw === 'string' && envRaw.trim()) {
      const trimmed = envRaw.trim();
      if (/^(?:0|off|false|none)$/i.test(trimmed)) return null;
      return path.resolve(trimmed);
    }
    const cdp = this.getCdp();
    const cacheFileName =
      typeof cdp?.BUNDLE_CACHE_FILENAME === 'string' && cdp.BUNDLE_CACHE_FILENAME
        ? cdp.BUNDLE_CACHE_FILENAME
        : '.bundle-cache.json';

    if (!this.isGitSourceDir(this._rootDir) && this.isWritableCacheDir(this._rootDir)) {
      return path.join(this._rootDir, cacheFileName);
    }
    if (isAutomatedTestRuntime()) return null;
    try {
      const stateDir = this._deps.resolveTelemetryDataDir?.();
      if (stateDir && this.isWritableCacheDir(stateDir)) {
        return path.join(stateDir, cacheFileName);
      }
    } catch {}
    return null;
  }

  scheduleBundleCacheFlush() {
    if (this._bundleCacheFlushTimer) {
      clearTimeout(this._bundleCacheFlushTimer);
      this._bundleCacheFlushTimer = null;
    }
    this._bundleCacheFlushTimer = setTimeout(() => {
      this._bundleCacheFlushTimer = null;
      if (!this.isRunning()) return;
      try {
        this.getCdp()?.flushPendingBundleCache?.();
      } catch {}
    }, 350);
    if (this._bundleCacheFlushTimer && typeof this._bundleCacheFlushTimer.unref === 'function') {
      this._bundleCacheFlushTimer.unref();
    }
  }

  clearFlushTimer() {
    if (this._bundleCacheFlushTimer) {
      clearTimeout(this._bundleCacheFlushTimer);
      this._bundleCacheFlushTimer = null;
    }
  }

  getChannelCacheOpts(deferCacheWrite = true) {
    const cachePath = this.resolveBundleCachePath();
    if (!cachePath) return null;
    return deferCacheWrite ? { cachePath, deferCacheWrite: true } : { cachePath };
  }

  hasSafeV2SidebarClientFile() {
    if (this._fileCheckOverrides.has('sidebar')) return Boolean(this._fileCheckOverrides.get('sidebar')());
    try {
      const p = path.join(this._rootDir, 'vendor', 'sidebar-studio', 'sidebar-client.js');
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        this._safeSidebarFileCache = { path: p, sig: '', ok: false };
        return false;
      }
      if (!st.isFile()) {
        this._safeSidebarFileCache = { path: p, sig: '', ok: false };
        return false;
      }
      const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}`;
      if (this._safeSidebarFileCache && this._safeSidebarFileCache.path === p && this._safeSidebarFileCache.sig === sig) {
        return this._safeSidebarFileCache.ok;
      }
      const src = fs.readFileSync(p, 'utf8');
      const cdp = this.getCdp();
      const ok =
        typeof cdp?.isSafeV2SidebarClientSource === 'function'
          ? Boolean(cdp.isSafeV2SidebarClientSource(src))
          : src.includes('SIDEBAR_STUDIO_CLIENT_V2') && !/setPrefValues?/i.test(src);
      this._safeSidebarFileCache = { path: p, sig, ok };
      return ok;
    } catch {
      this._safeSidebarFileCache = null;
      return false;
    }
  }

  hasChannelFile(specOrId, { bypassCache = false } = {}) {
    const id = typeof specOrId === 'string' ? specOrId : specOrId?.id || '';
    if (this._fileCheckOverrides.has(id)) return Boolean(this._fileCheckOverrides.get(id)());
    const cap = id ? id[0].toUpperCase() + id.slice(1) : '';
    const ov =
      (id === 'sidebar' && this._deps.getMethodOverride?.('_hasSafeV2SidebarClientFile')) ||
      this._deps.getMethodOverride?.(`_has${cap}ClientFile`) ||
      this._deps.getMethodOverride?.(`_has${cap}File`);
    if (ov) return Boolean(ov());
    if (id === 'sidebar') return this.hasSafeV2SidebarClientFile();
    if (!bypassCache && this._clientFileExistsCache instanceof Map && this._clientFileExistsCache.has(id)) {
      return this._clientFileExistsCache.get(id);
    }
    const exists = hasChannelAssetFile(this._rootDir, this.getCdp(), id);
    if (this._clientFileExistsCache instanceof Map) {
      this._clientFileExistsCache.set(id, exists);
    }
    return exists;
  }

  isChannelEnabled(specOrId, cfgOverride = null) {
    const spec = typeof specOrId === 'string' ? this.getRegisteredChannel(specOrId) : specOrId;
    if (!spec) return false;
    if (this._enabledCheckOverrides.has(spec.id)) return Boolean(this._enabledCheckOverrides.get(spec.id)(cfgOverride));
    const cap = spec.id ? spec.id[0].toUpperCase() + spec.id.slice(1) : '';
    const ov =
      (spec.id === 'sidebar' && this._deps.getMethodOverride?.('_isSidebarStudioEnabled')) ||
      this._deps.getMethodOverride?.(`_is${cap}Enabled`);
    if (ov) return Boolean(ov(cfgOverride));
    const cdp = this.getCdp();
    const cfg = cfgOverride || (typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null);
    return isSpecEnabledForConfig(cdp, spec, cfg);
  }

  buildSidebarExprForCurrentClient(cacheOpts = undefined) {
    const cdp = this.getCdp();
    if (typeof cdp?.buildSidebarStudioExpression !== 'function') return '';
    const meta = this.services.getSidebarServerMeta();
    if (!this.hasSafeV2SidebarClientFile()) {
      return cdp.buildSidebarStudioExpression(meta, '');
    }
    const opts = cacheOpts !== undefined ? cacheOpts : this.getChannelCacheOpts(true);
    const expr = opts ? cdp.buildSidebarStudioExpression(meta, null, opts) : cdp.buildSidebarStudioExpression(meta);
    if (cacheOpts === undefined && opts && this.isRunning()) this.scheduleBundleCacheFlush();
    return expr;
  }

  buildChannelExpr(specOrId, cfgOverride = null, cacheOpts = undefined, { allowSidebarWithoutReadConfig = false } = {}) {
    const spec = typeof specOrId === 'string' ? this.getRegisteredChannel(specOrId) : specOrId;
    if (!spec) return '';
    const id = spec.id;
    const cdp = this.getCdp();
    const hasReadConfig = typeof cdp?.readConfig === 'function';
    const cfg = cfgOverride || (hasReadConfig ? cdp.readConfig() : null);
    const buildFnName = spec.fields?.cdpBuildFn;
    const reg = this.getRegisteredChannel(id);
    const cdpBuildFn = buildFnName && typeof cdp?.[buildFnName] === 'function' ? cdp[buildFnName] : null;
    const buildFn = cdpBuildFn || (typeof reg?.build === 'function' ? reg.build : null);

    if (id === 'omni') {
      if (typeof cdp?.buildOmniClientExpression !== 'function' || !this.isChannelEnabled(spec, cfg)) {
        return this.setChannelExpr('omni', '');
      }
      const meta = this.services.omniServer && this.services.omniServer.running ? this.services.omniServer.getServerInfo() : null;
      const opts = cacheOpts !== undefined ? cacheOpts : this.getChannelCacheOpts(true);
      const expr = opts ? buildFn(meta, null, opts) : buildFn(meta);
      if (cacheOpts === undefined && opts && this.isRunning()) this.scheduleBundleCacheFlush();
      return this.setChannelExpr('omni', expr);
    }

    if (id === 'sidebar') {
      const shouldBuild =
        typeof cdp?.buildSidebarStudioExpression === 'function' &&
        ((allowSidebarWithoutReadConfig && !hasReadConfig) || this.isChannelEnabled(spec, cfg));
      return this.setChannelExpr('sidebar', shouldBuild ? this.buildSidebarExprForCurrentClient(cacheOpts) : '');
    }

    if (id === 'hostI18n') {
      if (typeof cdp?.buildHostI18nExpression !== 'function' || !this.isChannelEnabled(spec, cfg)) {
        return this.setChannelExpr('hostI18n', '');
      }
      const opts = cacheOpts !== undefined ? cacheOpts : this.getChannelCacheOpts(true);
      const expr = opts ? buildFn(cfg, null, opts) : buildFn(cfg);
      if (cacheOpts === undefined && opts && this.isRunning()) this.scheduleBundleCacheFlush();
      return this.setChannelExpr('hostI18n', expr);
    }

    if (typeof cdpBuildFn !== 'function') {
      return this.setChannelExpr(id, '');
    }
    const needFileGuard = !spec.tracksSkippedNonHost && id !== 'thought';
    if ((!spec.tracksSkippedNonHost && !this.isChannelEnabled(spec, cfg)) || (needFileGuard && !this.hasChannelFile(spec))) {
      return this.setChannelExpr(id, '');
    }

    let opts = cacheOpts !== undefined ? cacheOpts : this.getChannelCacheOpts(true);
    if (id === 'wallpaper' && opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'initialWallpaperConfig')) {
      const { initialWallpaperConfig: _stripped, ...rest } = opts;
      opts = Object.keys(rest).length > 0 ? rest : undefined;
    }
    const expr = opts ? cdpBuildFn(cfg, opts) : cdpBuildFn(cfg);
    if (cacheOpts === undefined && opts && this.isRunning()) this.scheduleBundleCacheFlush();
    return this.setChannelExpr(id, expr);
  }

  ensureChannelExpr(specOrId, cfgOverride = null, cacheOpts = undefined) {
    const spec = typeof specOrId === 'string' ? this.getRegisteredChannel(specOrId) : specOrId;
    if (!spec) return '';
    const existing = this.getChannelExpr(spec.id);
    if (existing) return existing;
    return this.buildChannelExpr(spec, cfgOverride, cacheOpts);
  }

  ensureSettingsExpr(cacheOpts = undefined) {
    const existing = this.getChannelExpr('settings');
    if (existing) return existing;
    const cdp = this.getCdp();
    if (typeof cdp?.buildSettingsChannelExpression !== 'function') return '';
    const opts = cacheOpts !== undefined ? cacheOpts : this.getChannelCacheOpts(true);
    const expr = opts ? cdp.buildSettingsChannelExpression(null, opts) : cdp.buildSettingsChannelExpression();
    if (cacheOpts === undefined && opts && this.isRunning()) this.scheduleBundleCacheFlush();
    return this.setChannelExpr('settings', typeof expr === 'string' ? expr : '');
  }

  rebuildBundle({ forceReloadCdp = false, deferDiskCacheWrite = false } = {}) {
    this._clientFileExistsCache?.clear?.();
    const cdpPath = path.join(this._rootDir, 'cdp.js');
    const nextSig = this.readCdpFileSig();
    if (forceReloadCdp || !this.getCdp() || (nextSig && nextSig !== this._cdpFileSig)) {
      this.clearFlushTimer();
      try {
        clearCdpRequireCache(this._rootDir);
      } catch {}
      const freshCdp = require(cdpPath);
      this._deps.setCdp?.(freshCdp);
      this._cdpFileSig = nextSig;
    }

    const cdp = this.getCdp();
    const hasReadConfig = typeof cdp?.readConfig === 'function';
    const cfg = hasReadConfig ? cdp.readConfig() : null;
    if (cfg && this._configFingerprintTracker) {
      this._configFingerprintTracker.recordApplied(cfg);
    }

    const bundleCachePath = this.resolveBundleCachePath();
    const canBatchFlush = Boolean(bundleCachePath && typeof cdp?.flushPendingBundleCache === 'function');
    const useDeferWrite = Boolean(deferDiskCacheWrite || canBatchFlush);
    const cacheOpts = bundleCachePath
      ? useDeferWrite
        ? { cachePath: bundleCachePath, deferCacheWrite: true }
        : { cachePath: bundleCachePath }
      : null;

    this.injectExpr = cacheOpts ? cdp.buildInjectExpression(cfg || undefined, cacheOpts) : cdp.buildInjectExpression(cfg || undefined);
    const m = typeof this.injectExpr === 'string' ? this.injectExpr.match(/"codeHash":"([^"]+)"/) : null;
    this.codeHash = m ? m[1] : '';

    // 表驱动统一预编译全部 precompileOnBoot 通道（14 条），按需通道（swarmI18n / settings）清空延后编译
    for (const spec of CHANNEL_STATIC_SPECS) {
      if (!spec.precompileOnBoot) {
        if (spec.id === 'swarmI18n') this.swarmManager.resetCompiledCache();
        else this.setChannelExpr(spec.id, '');
        continue;
      }
      this.buildChannelExpr(spec, cfg, cacheOpts, { allowSidebarWithoutReadConfig: true });
    }

    if (bundleCachePath) {
      if (deferDiskCacheWrite) {
        this.scheduleBundleCacheFlush();
      } else if (canBatchFlush) {
        try {
          cdp.flushPendingBundleCache();
        } catch {}
      }
    }
    return this.injectExpr;
  }

  resolveWatchedConfigPath() {
    const cdp = this.getCdp();
    return typeof cdp?.CONFIG_PATH === 'string' && cdp.CONFIG_PATH
      ? path.resolve(cdp.CONFIG_PATH)
      : path.join(this._rootDir, 'config.json');
  }

  syncConfigFingerprintFromDisk(configPath = null) {
    const targetPath = configPath || this.resolveWatchedConfigPath();
    try {
      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, 'utf8');
        if (raw && raw.trim()) return this._configFingerprintTracker.recordApplied(raw) || '';
      }
    } catch {}
    try {
      const cfg = this.getCdp()?.readConfig?.();
      if (cfg && typeof cfg === 'object') return this._configFingerprintTracker.recordApplied(cfg) || '';
    } catch {}
    return '';
  }

  isWatchedConfigUnchangedPeek(configPath = null) {
    const targetPath = configPath || this.resolveWatchedConfigPath();
    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      if (!raw || !raw.trim()) return false;
      const hash = computeConfigFingerprint(raw);
      const last = this._configFingerprintTracker.getLastHash() || '';
      return Boolean(hash && last && hash === last);
    } catch {
      return false;
    }
  }

  async handleWatchedConfigChange(configPath = null) {
    const targetPath = configPath || this.resolveWatchedConfigPath();
    let raw = '';
    try {
      raw = fs.readFileSync(targetPath, 'utf8');
    } catch {
      return { applied: false, reason: 'read-failed' };
    }
    const res = this._configFingerprintTracker.checkExternalChange(raw);
    if (!res.changed) return { applied: false, reason: 'fingerprint-unchanged', hash: res.hash };
    this.getCdp()?.invalidateConfigCache?.();
    this._configSeq += 1;
    for (const entry of this.sessionRegistry.sessions.values()) {
      resetAllChannelCircuits(entry);
    }
    await (typeof this._deps.invokeBroadcastConfigRefresh === 'function'
      ? this._deps.invokeBroadcastConfigRefresh()
      : this.broadcastConfigRefresh());
    return { applied: true, hash: res.hash, configSeq: this._configSeq };
  }

  updateConfigBatch(entriesObj) {
    if (!entriesObj || typeof entriesObj !== 'object' || Array.isArray(entriesObj)) return false;
    const cdp = this.getCdp();
    const validPatch = {};
    let count = 0;
    for (const [k, v] of Object.entries(entriesObj)) {
      if (cdp.validateConfigEntry(k, v)) {
        validPatch[k] = v;
        count += 1;
      }
    }
    if (count === 0) return false;
    const cfgPath = path.join(this._rootDir, 'config.json');
    const current = cdp.readConfig();
    const expandedPatch = typeof cdp.reconcileConfigAliases === 'function' ? cdp.reconcileConfigAliases(validPatch) : validPatch;
    const next = { ...current, ...expandedPatch };
    this._configFingerprintTracker.recordSelfWrite(next);
    writeFileAtomicSync(cfgPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    cdp?.invalidateConfigCache?.();
    if (Object.prototype.hasOwnProperty.call(expandedPatch, 'autoArchiveOnExit')) {
      this._deps.onAutoArchiveSettingChanged?.();
    }
    this._configSeq += 1;
    for (const entry of this.sessionRegistry.sessions.values()) {
      resetAllChannelCircuits(entry);
    }
    return true;
  }

  updateConfigSetting(key, value) {
    return this.updateConfigBatch({ [key]: value });
  }

  async deliverSettingsChannelToEntry(entry, executionContextId = null) {
    if (!entry || entry.session.closed || entry._settingsChannelInFlight) return false;
    const expr = this.ensureSettingsExpr();
    if (!expr) return false;
    entry._settingsChannelInFlight = true;
    try {
      const evalParams = { expression: expr, returnByValue: true };
      if (typeof executionContextId === 'number' && executionContextId > 0) evalParams.contextId = executionContextId;
      let caughtErr = null;
      const res = await entry.session.send('Runtime.evaluate', evalParams, 5000).catch((err) => {
        caughtErr = err;
        return null;
      });
      const val = res?.result?.value;
      if (val?.ok) {
        entry.settingsChannelDelivered = true;
        recordChannelSuccess(entry, 'settings', { codeHash: this.getChannelExprHash('settings', expr) });
        return true;
      }
      const errObj = caughtErr
        ? { ok: false, status: 'eval-error', error: String(caughtErr.message || caughtErr).slice(0, 300), stack: String(caughtErr.stack || '').slice(0, 600) }
        : res?.exceptionDetails
          ? { ok: false, status: 'eval-error', error: String(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'exception').slice(0, 300) }
          : val;
      recordChannelEvalFailure(this, entry, 'settings', errObj, { stage: 'apply' });
      return false;
    } finally {
      entry._settingsChannelInFlight = false;
    }
  }

  async deliverHomeStudioChannelToEntry(entry, executionContextId = null) {
    if (!entry || entry.session.closed || entry._homeStudioChannelInFlight) return false;
    const cdp = this.getCdp();
    const cfgNow = typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null;
    const spec = this.getRegisteredChannel('homeStudio');
    if (!this.hasChannelFile(spec) || !this.isChannelEnabled(spec, cfgNow)) return false;
    const expr = this.ensureChannelExpr(spec, cfgNow);
    if (!expr) return false;
    const hsHash = this.getChannelExprHash(spec, expr);
    const hsSig = this.getChannelCfgSig(spec, cfgNow, expr);
    entry._homeStudioChannelInFlight = true;
    try {
      if (!entry.homeStudioScriptId || entry.lastHomeStudioScriptSig !== hsSig) {
        const id = await replaceEntryNewDocScript(entry, 'homeStudioScriptId', expr);
        if (id) entry.lastHomeStudioScriptSig = hsSig;
      }
      const evalParams = { expression: expr, returnByValue: true };
      if (typeof executionContextId === 'number' && executionContextId > 0) evalParams.contextId = executionContextId;
      let caughtErr = null;
      const res = await entry.session.send('Runtime.evaluate', evalParams, 5000).catch((err) => {
        caughtErr = err;
        return null;
      });
      const val = res?.result?.value;
      if (val?.ok) {
        entry.homeStudioMounted = !val.skippedByLiveCfg;
        entry.lastHomeStudioSig = hsSig;
        if (val.skippedByLiveCfg) recordChannelSkipped(entry, 'homeStudio', { codeHash: hsHash });
        else recordChannelSuccess(entry, 'homeStudio', { codeHash: hsHash, scriptId: entry.homeStudioScriptId });
        return true;
      }
      const errObj = caughtErr
        ? { ok: false, status: 'eval-error', error: String(caughtErr.message || caughtErr).slice(0, 300), stack: String(caughtErr.stack || '').slice(0, 600) }
        : res?.exceptionDetails
          ? { ok: false, status: 'eval-error', error: String(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'exception').slice(0, 300) }
          : val;
      recordChannelEvalFailure(this, entry, 'homeStudio', errObj, { stage: 'apply' });
      return false;
    } finally {
      entry._homeStudioChannelInFlight = false;
    }
  }

  ensureBinding(entry, channelId, timeoutMs = 2600, force = false) { return ensureChannelBinding(this, entry, channelId, timeoutMs, force); }
  removeBinding(entry, channelId, timeoutMs = 2000) { return removeChannelBinding(this, entry, channelId, timeoutMs); }
  replaceEntryNewDocScript(entry, prop, source) { return replaceEntryNewDocScript(entry, prop, source); }
  cleanupChannelOnEntry(entry, spec, opts) { return cleanupChannelOnEntry(this, entry, spec, opts); }
  healSingleChannelOnEntry(entry, spec, cfg, probe, opts) { return healSingleChannelOnEntry(this, entry, spec, cfg, probe, opts); }
  async syncChannelOnEntry(id, entry, cfgOverride = null, { runCleanup = true } = {}) {
    const spec = this.getRegisteredChannel(id);
    if (!spec || !entry || entry.session?.closed) return;
    const cdp = this.getCdp();
    const cfg = cfgOverride || (typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null);
    if (!this.isChannelEnabled(spec, cfg) || !this.hasChannelFile(spec)) {
      if (runCleanup) await cleanupChannelOnEntry(this, entry, spec);
      return;
    }
    await healSingleChannelOnEntry(this, entry, spec, cfg, null, { forceEval: true });
  }
  teardownAllEntryChannelScripts(entry, session, opts) { return teardownAllEntryChannelScripts(this, entry, session, opts); }
  applyToEntry(entry) { return applyAllChannelsToEntry(this, entry); }
  broadcastConfigRefresh() { return runBroadcastConfigRefresh(this); }
  verifyAndHealEntry(entry, force = false) { return verifyAndHealEntry(this, entry, force); }
  verifyAndHealEntryUnlocked(entry, force = false) { return verifyAndHealEntryUnlocked(this, entry, force); }

  ensureOmniServer() { return typeof this._deps.ensureOmniServer === 'function' ? this._deps.ensureOmniServer() : this.services.ensureOmniServer(); }
  ensureSidebarService() { return typeof this._deps.ensureSidebarService === 'function' ? this._deps.ensureSidebarService() : this.services.ensureSidebarService(); }
  ensureThoughtService() { return this.services.ensureThoughtService(); }
  ensureWallpaperService() { return this.services.ensureWallpaperService(); }
  ensureSuggesterService() { return this.services.ensureSuggesterService(); }
}
