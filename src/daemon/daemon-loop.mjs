// Obsidian Prism 守护进程主循环、fs.watch 端口/配置实时唤醒、24h 自适应退避与启停生命周期（Tier 3，独立组合类）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as conversationArchive from '../../sidecars/daemon/conversation-archive.mjs';
import {
  DEFAULT_ROOT_DIR,
  resolvePortFileCandidates,
  discoverActivePort,
  isPluginEnabledInHostConfig,
} from './constants.mjs';
import {
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  transitionEntryState,
} from './session-fsm.mjs';
import { evalFireAndForgetSafe } from './channel-sync-engine.mjs';

const require = createRequire(import.meta.url);
const runInBgRecovery = require('../platform/run-in-bg-recovery.cjs');

// Windows Node 24 下 fs.watch 收到 8.3 短路径（如 ADMINI~1）会触发 libuv 断言崩溃，调用前必须 realpathSync.native 归一化
export function resolveSafeWatchDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return '';
  try {
    return typeof fs.realpathSync?.native === 'function'
      ? fs.realpathSync.native(dirPath)
      : fs.realpathSync(dirPath);
  } catch {
    return path.resolve(dirPath);
  }
}

function isPortFileCompleteAndValid(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size <= 0 || st.size > 4096) return false;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.includes('\n')) return false;
    const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || '';
    const port = Number.parseInt(firstLine, 10);
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  } catch {
    return false;
  }
}

export class DaemonLoop {
  constructor({
    pollIntervalMs = 3000,
    enabledCheck = () => isPluginEnabledInHostConfig(),
    pendingRunInBgMarkerPath = '',
    getRootDir = () => DEFAULT_ROOT_DIR,
    getOverridePort = () => null,
    getPortFile = () => null,
    getCdp = () => null,
    logger = null,
    pidLock = null,
    relaunchGuard = null,
    sessionRegistry = null,
    channelOrchestrator = null,
    telemetrySubsystem = null,
    updateStorageSubsystem = null,
    invokeIsCurrentOwner = null,
    invokeStop = null,
    invokeDetachAll = null,
    invokeRebuildBundle = null,
    invokeTick = null,
    invokeScheduleImmediateTick = null,
    invokeReleaseOwnership = null,
    invokeApplyToEntry = null,
    invokeVerifyAndHealEntry = null,
    invokeLog = null,
  } = {}) {
    this.pollIntervalMs = Math.max(200, Number(pollIntervalMs) || 3000);
    this.enabledCheck = enabledCheck;
    this._pendingRunInBgMarkerPath = typeof pendingRunInBgMarkerPath === 'string' ? pendingRunInBgMarkerPath : '';
    this._getRootDir = getRootDir;
    this._getOverridePort = getOverridePort;
    this._getPortFile = getPortFile;
    this._getCdp = getCdp;

    this.logger = logger;
    this.pidLock = pidLock;
    this.relaunchGuard = relaunchGuard;
    this.sessionRegistry = sessionRegistry;
    this.channelOrchestrator = channelOrchestrator;
    this.telemetrySubsystem = telemetrySubsystem;
    this.updateStorageSubsystem = updateStorageSubsystem;

    this._invokeIsCurrentOwner = invokeIsCurrentOwner;
    this._invokeStop = invokeStop;
    this._invokeDetachAll = invokeDetachAll;
    this._invokeRebuildBundle = invokeRebuildBundle;
    this._invokeTick = invokeTick;
    this._invokeScheduleImmediateTick = invokeScheduleImmediateTick;
    this._invokeReleaseOwnership = invokeReleaseOwnership;
    this._invokeApplyToEntry = invokeApplyToEntry;
    this._invokeVerifyAndHealEntry = invokeVerifyAndHealEntry;
    this._invokeLog = invokeLog;

    this.running = false;
    this.busy = false;
    this.timer = null;
    this.fsw = null;
    this._portWatchers = [];
    this._portRetryTimers = new Set();
    this._reloadTimer = null;
    this._pendingTick = false;
  }

  log(msg) {
    if (typeof this._invokeLog === 'function') return this._invokeLog(msg);
    this.logger?.log(msg);
  }

  redact(text) {
    return this.logger ? this.logger.redactSensitiveText(text) : String(text || '');
  }

  _isCurrentOwner() {
    if (typeof this._invokeIsCurrentOwner === 'function') return this._invokeIsCurrentOwner();
    return this.pidLock.isCurrentOwner();
  }

  _stop(cleanPageDom, opts) {
    if (typeof this._invokeStop === 'function') return this._invokeStop(cleanPageDom, opts);
    return this.stop(cleanPageDom, opts);
  }

  _detachAll(cleanPageDom) {
    if (typeof this._invokeDetachAll === 'function') return this._invokeDetachAll(cleanPageDom);
    return this.sessionRegistry.detachAll(cleanPageDom);
  }

  _rebuildBundle(opts) {
    if (typeof this._invokeRebuildBundle === 'function') return this._invokeRebuildBundle(opts);
    return this.channelOrchestrator.rebuildBundle(opts);
  }

  _tick() {
    if (typeof this._invokeTick === 'function') return this._invokeTick();
    return this.tick();
  }

  _scheduleImmediateTick(delayMs) {
    if (typeof this._invokeScheduleImmediateTick === 'function') return this._invokeScheduleImmediateTick(delayMs);
    return this.sessionRegistry.scheduleImmediateTick(delayMs);
  }

  _releaseOwnership() {
    if (typeof this._invokeReleaseOwnership === 'function') return this._invokeReleaseOwnership();
    return this.pidLock.releaseOwnership();
  }

  _applyToEntry(entry) {
    if (typeof this._invokeApplyToEntry === 'function') return this._invokeApplyToEntry(entry);
    return this.channelOrchestrator.applyToEntry(entry);
  }

  _verifyAndHealEntry(entry, force = false) {
    if (typeof this._invokeVerifyAndHealEntry === 'function') return this._invokeVerifyAndHealEntry(entry, force);
    return this.channelOrchestrator.verifyAndHealEntry(entry, force);
  }

  recoverPendingRunInBackgroundOnBoot() {
    runInBgRecovery.recoverPendingForDaemonBoot({
      rootDir: this._getRootDir(),
      defaultRootDir: DEFAULT_ROOT_DIR,
      extraMarkerPath: this._pendingRunInBgMarkerPath,
      getDefaultAppStoragePath: conversationArchive.getDefaultAntigravityAppStoragePath,
      log: (m) => this.log(m),
    });
  }

  // 24h 长期驻留自适应轮询退避：事件通道在线时拉长至 20-25s，由 fs.watch / Target 事件即时唤醒
  _computeNextPollDelayMs() {
    if (this.pollIntervalMs < 1000) return this.pollIntervalMs;
    const reg = this.sessionRegistry;
    const rg = this.relaunchGuard;
    if (reg.hostFsmState === HOST_FSM_STATES.MISSING_CDP) {
      const noPortWaitActive =
        rg &&
        rg._noPortSinceMs > 0 &&
        Date.now() - rg._noPortSinceMs < (Number(rg.noPortRelaunchThresholdMs) || 8000);
      if (noPortWaitActive) return this.pollIntervalMs;
      return Math.max(this.pollIntervalMs, 20000);
    }
    if (
      reg.hostFsmState === HOST_FSM_STATES.ATTACHED &&
      reg.sessions.size > 0 &&
      reg.browserSession &&
      !reg.browserSession.closed &&
      reg._browserDiscoverySubscribed
    ) {
      let allHealthyBackoff = true;
      for (const entry of reg.sessions.values()) {
        if (
          !entry ||
          entry.session?.closed ||
          entry.verifyDirty ||
          entry.fsmState !== ENTRY_FSM_STATES.HEALTHY_BACKOFF ||
          (entry.healthyStreak || 0) < 2
        ) {
          allHealthyBackoff = false;
          break;
        }
      }
      if (allHealthyBackoff) return Math.max(this.pollIntervalMs, 25000);
    }
    return this.pollIntervalMs;
  }

  _scheduleNextPollTimer() {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const delayMs = this._computeNextPollDelayMs();
    this.timer = setTimeout(async () => {
      if (!this.running) return;
      try {
        await this._tick();
      } catch {}
      if (this.running) this._scheduleNextPollTimer();
    }, delayMs);
  }

  _verifyPortFileAndWake(filesForDir, attempt = 0) {
    if (!this.running) return;
    for (const filePath of filesForDir) {
      if (isPortFileCompleteAndValid(filePath)) {
        this._scheduleImmediateTick(0);
        return;
      }
    }
    if (attempt >= 3) return;
    const tid = setTimeout(() => {
      this._portRetryTimers.delete(tid);
      this._verifyPortFileAndWake(filesForDir, attempt + 1);
    }, 20);
    if (typeof tid.unref === 'function') tid.unref();
    this._portRetryTimers.add(tid);
  }

  _startPortFileWatchers() {
    this._stopPortFileWatchers();
    const explicitPortFile = this._getPortFile();
    const overridePort = this._getOverridePort();
    if (overridePort && !explicitPortFile) return;

    const candidates = explicitPortFile ? [explicitPortFile] : resolvePortFileCandidates();
    const byDir = new Map();
    for (const rawFile of candidates) {
      if (!rawFile || typeof rawFile !== 'string') continue;
      const absFile = path.resolve(rawFile);
      const rawDir = path.dirname(absFile);
      if (!fs.existsSync(rawDir)) continue;
      const realDir = resolveSafeWatchDir(rawDir);
      if (!realDir) continue;
      let entry = byDir.get(realDir);
      if (!entry) {
        entry = { files: [], names: new Set() };
        byDir.set(realDir, entry);
      }
      const normFile = path.join(realDir, path.basename(absFile));
      entry.files.push(normFile);
      entry.names.add(path.basename(absFile).toLowerCase());
    }

    for (const [realDir, info] of byDir.entries()) {
      try {
        const watcher = fs.watch(realDir, { persistent: false }, (_eventType, filename) => {
          if (!this.running) return;
          const base = filename ? path.basename(String(filename)).toLowerCase() : '';
          if (base && !info.names.has(base)) return;
          this._verifyPortFileAndWake(info.files, 0);
        });
        watcher.on?.('error', () => {
          try { watcher.close(); } catch {}
          const idx = this._portWatchers.indexOf(watcher);
          if (idx >= 0) this._portWatchers.splice(idx, 1);
        });
        if (typeof watcher.unref === 'function') watcher.unref();
        this._portWatchers.push(watcher);
      } catch {}
    }
  }

  _stopPortFileWatchers() {
    for (const tid of this._portRetryTimers) clearTimeout(tid);
    this._portRetryTimers.clear();
    for (const w of this._portWatchers) {
      try { w.close(); } catch {}
    }
    this._portWatchers = [];
  }

  async tick() {
    const reg = this.sessionRegistry;
    const ch = this.channelOrchestrator;
    const tel = this.telemetrySubsystem;
    const upd = this.updateStorageSubsystem;
    const rg = this.relaunchGuard;
    const cdp = this._getCdp();

    if (!this.running) return { attached: reg.sessions.size };
    if (this.busy) {
      this._pendingTick = true;
      return { attached: reg.sessions.size };
    }
    this.busy = true;
    this._pendingTick = false;
    try {
      if (!this._isCurrentOwner()) {
        await this._stop(false, { skipAutoArchive: true });
        return { attached: 0, superseded: true };
      }

      if (!this.enabledCheck()) {
        reg.hostFsmState = HOST_FSM_STATES.IDLE;
        rg._noPortSinceMs = 0;
        rg._hasActiveCdpPort = false;
        if (reg.sessions.size > 0 || ch.swarmManager.swarmSessions.size > 0 || reg.browserSession) {
          await this._detachAll(true);
        }
        return { attached: 0, disabled: true };
      }

      const port = discoverActivePort(this._getOverridePort(), this._getPortFile());
      if (!port) {
        reg.hostFsmState = HOST_FSM_STATES.MISSING_CDP;
        rg._hasActiveCdpPort = false;
        rg.resetShortcutBackoff('no-port');
        if (reg.sessions.size === 0 && reg._prevAttachedCount > 0) {
          reg._disconnectedAllSessions = true;
          reg._prevAttachedCount = 0;
        }
        if (
          reg.sessions.size === 0 &&
          upd._sawLiveHost &&
          upd.getAutoArchiveOnExitSetting() &&
          !upd._autoArchiveInFlight &&
          !upd._autoArchiveExitRan
        ) {
          void upd.maybeRunAutoArchiveOnExit().catch(() => {});
        }
        await rg.handleMissingCdpPort();
        return { attached: 0, port: null };
      }

      const now = Date.now();
      const canSkipListPoll =
        this.timer != null &&
        Boolean(reg.browserSession && !reg.browserSession.closed && reg._browserDiscoverySubscribed) &&
        reg.browserPort === port &&
        reg.sessions.size > 0 &&
        !reg._forceListPagesNextTick &&
        reg._lastListPagesAt > 0 &&
        now - reg._lastListPagesAt < reg._listPagesFallbackIntervalMs;

      if (canSkipListPoll) {
        rg._noPortSinceMs = 0;
        rg._hasActiveCdpPort = true;
        rg._hostDetectCache = null;
        rg.maybeSyncShortcuts(false, { hasActivePort: true });

        const liveEntries = [];
        for (const [wsUrl, entry] of reg.sessions.entries()) {
          if (entry.session.closed) {
            reg.sessions.delete(wsUrl);
            continue;
          }
          liveEntries.push(entry);
        }

        if (liveEntries.length > 0) {
          await Promise.allSettled(liveEntries.map((entry) => this._verifyAndHealEntry(entry)));
          if (reg.sessions.size > 0) {
            reg.hostFsmState = HOST_FSM_STATES.ATTACHED;
            upd.markHostLive();
          } else if (reg._prevAttachedCount > 0) {
            reg.hostFsmState = HOST_FSM_STATES.DISCOVERING;
            reg._disconnectedAllSessions = true;
          }
          reg._prevAttachedCount = reg.sessions.size;
          tel.releaseIdle(Boolean(tel.isDisabled()));
          return {
            attached: reg.sessions.size,
            port,
            pages: [...reg.sessions.values()].map((e) => this.redact(e.title || e.url)),
            skippedListPoll: true,
          };
        }
        if (reg._prevAttachedCount > 0) {
          reg._disconnectedAllSessions = true;
          reg._prevAttachedCount = 0;
        }
      }

      let rawPages = [];
      try {
        rawPages = await cdp.listPages(port);
        reg._lastListPagesAt = Date.now();
        reg._forceListPagesNextTick = false;
      } catch {
        reg.hostFsmState = HOST_FSM_STATES.MISSING_CDP;
        rg._hasActiveCdpPort = false;
        rg.resetShortcutBackoff('port-unreachable');
        reg.closeBrowserDiscovery();
        if (reg.sessions.size === 0) {
          if (reg._prevAttachedCount > 0) {
            reg._disconnectedAllSessions = true;
            reg._prevAttachedCount = 0;
          }
          if (upd._sawLiveHost && upd.getAutoArchiveOnExitSetting() && !upd._autoArchiveInFlight && !upd._autoArchiveExitRan) {
            void upd.maybeRunAutoArchiveOnExit().catch(() => {});
          }
          await rg.handleMissingCdpPort();
        }
        return { attached: reg.sessions.size, port, unreachable: true };
      }

      rg._noPortSinceMs = 0;
      rg._hasActiveCdpPort = true;
      const prevActivePort = rg._lastActiveCdpPort;
      const portChanged = prevActivePort !== null && prevActivePort !== port;
      rg._lastActiveCdpPort = port;
      const prevSessionCount = reg.sessions.size;
      const canRunShortcutSync = Boolean(this.timer || typeof rg._relaunchHooks?.syncShortcuts === 'function');
      let forcedShortcutSyncThisTick = false;
      if (portChanged) {
        rg.resetShortcutBackoff(`port-changed:${prevActivePort}->${port}`);
        if (canRunShortcutSync) {
          forcedShortcutSyncThisTick = true;
          rg.maybeSyncShortcuts(true, { hasActivePort: true });
        }
      } else if (this.timer) {
        rg.maybeSyncShortcuts(false, { hasActivePort: true });
      }

      if (this.timer) {
        void reg.ensureBrowserDiscovery(port);
      }

      const eligible = rawPages.filter((t) => reg.isEligibleDaemonTarget(t));
      const activeUrls = new Set(eligible.map((t) => t.webSocketDebuggerUrl));

      for (const [wsUrl, entry] of reg.sessions.entries()) {
        if (entry.session.closed) {
          reg.sessions.delete(wsUrl);
          continue;
        }
        if (!activeUrls.has(wsUrl)) {
          const check = await this._verifyAndHealEntry(entry, true);
          if (check && check.alive && (!check.ready || check.isHostDom)) {
            continue;
          }
          if (!entry.session.closed) {
            await ch.teardownAllEntryChannelScripts(entry, entry.session, { removeBindings: true });
            await evalFireAndForgetSafe(entry.session, cdp.REMOVE_EXPRESSION, 0);
            if (entry._isoPauseTimers) {
              for (const tid of entry._isoPauseTimers) clearTimeout(tid);
              entry._isoPauseTimers.clear();
            }
            if (entry.isolatedHostI18nPaused) {
              await ch.swarmManager.syncIsolatedHostI18n(entry, false).catch(() => {});
            }
          }
          transitionEntryState(entry, ENTRY_FSM_STATES.DETACHED, 'target-gone');
          entry.session.close();
          reg.sessions.delete(wsUrl);
        }
      }

      if (!ch.injectExpr) this._rebuildBundle();

      await Promise.allSettled(
        eligible.map((target) => {
          if (!reg.sessions.has(target.webSocketDebuggerUrl)) {
            return reg.attachTarget(target);
          }
          return this._verifyAndHealEntry(reg.sessions.get(target.webSocketDebuggerUrl));
        })
      );

      const nowAttachedCount = reg.sessions.size;
      reg.hostFsmState = nowAttachedCount > 0 ? HOST_FSM_STATES.ATTACHED : HOST_FSM_STATES.DISCOVERING;
      if (nowAttachedCount > 0) {
        upd.markHostLive();
      }
      if (nowAttachedCount === 0) {
        if (reg._prevAttachedCount > 0 || prevSessionCount > 0) {
          reg._disconnectedAllSessions = true;
        }
      } else {
        const recoveredFromAllDisconnected = reg._disconnectedAllSessions;
        const recoveredFromZero = prevSessionCount === 0 && rg._lastShortcutCheckAt > 0;
        if (recoveredFromAllDisconnected) {
          reg._disconnectedAllSessions = false;
        }
        if ((recoveredFromAllDisconnected || recoveredFromZero) && !forcedShortcutSyncThisTick) {
          rg.resetShortcutBackoff(
            recoveredFromAllDisconnected ? 'all-windows-reconnected' : 'active-windows-recovered-from-zero'
          );
          if (canRunShortcutSync) {
            rg.maybeSyncShortcuts(true, { hasActivePort: true });
          }
        }
      }
      reg._prevAttachedCount = nowAttachedCount;

      tel.releaseIdle(Boolean(tel.isDisabled()));

      return { attached: reg.sessions.size, port, pages: eligible.map((p) => this.redact(p.title || p.url)) };
    } finally {
      this.busy = false;
      reg._lastTickFinishedAt = Date.now();
      if (this._pendingTick && this.running) {
        this._pendingTick = false;
        this._scheduleImmediateTick(45);
      }
    }
  }

  start({ claimPid = true, watchFiles = true } = {}) {
    if (this.running) return;
    const reg = this.sessionRegistry;
    const ch = this.channelOrchestrator;
    const upd = this.updateStorageSubsystem;
    const rootDir = this._getRootDir();

    ch.services.markStarted();
    this.running = true;
    reg.hostFsmState = HOST_FSM_STATES.DISCOVERING;
    if (claimPid) this.pidLock.claimOwnership();
    this.recoverPendingRunInBackgroundOnBoot();
    const initialPort = discoverActivePort(this._getOverridePort(), this._getPortFile());
    this.log(`[boot] PrismDaemon started (pid=${process.pid}, activePort=${initialPort || 'none'}, root=${rootDir})`);
    this._rebuildBundle();
    const configPath = ch.resolveWatchedConfigPath();
    ch.syncConfigFingerprintFromDisk(configPath);

    if (watchFiles) {
      let pendingCodeChange = false;
      const devWatch = process.env.AG_PRISM_DEV_WATCH === '1';
      const watchTargetDir = resolveSafeWatchDir(devWatch ? rootDir : path.dirname(configPath));
      const configBaseName = path.basename(configPath);
      let lastConfigMtimeMs = 0;
      try {
        lastConfigMtimeMs = fs.statSync(configPath).mtimeMs || 0;
      } catch {}
      try {
        this.fsw = fs.watch(watchTargetDir, devWatch ? { recursive: true } : { persistent: false }, (_, filename) => {
          if (!this.running) return;
          const base = filename ? path.basename(String(filename)) : '';
          if (!devWatch) {
            if (base && base.toLowerCase() !== configBaseName.toLowerCase()) return;
            if (!base) {
              let nextMtime = 0;
              try {
                nextMtime = fs.statSync(configPath).mtimeMs || 0;
              } catch {}
              if (nextMtime === lastConfigMtimeMs && ch.isWatchedConfigUnchangedPeek(configPath)) return;
              lastConfigMtimeMs = nextMtime;
            } else {
              try {
                lastConfigMtimeMs = fs.statSync(configPath).mtimeMs || 0;
              } catch {}
            }
            if (ch.isWatchedConfigUnchangedPeek(configPath)) return;
          } else {
            if (!base || base.startsWith('.') || !/\.(css|c?js|mjs|json)$/i.test(base)) return;
            if (base === 'daemon.log' || base === 'watch.log' || base === 'repo-meta.json') return;
            if (base.toLowerCase() === configBaseName.toLowerCase()) {
              if (ch.isWatchedConfigUnchangedPeek(configPath)) return;
            } else {
              pendingCodeChange = true;
            }
          }
          if (this._reloadTimer) {
            clearTimeout(this._reloadTimer);
            this._reloadTimer = null;
          }
          const delayMs = pendingCodeChange ? 180 : 120;
          this._reloadTimer = setTimeout(async () => {
            this._reloadTimer = null;
            if (!this.running) return;
            const isCodeChange = pendingCodeChange;
            pendingCodeChange = false;
            try {
              if (!isCodeChange) {
                await ch.handleWatchedConfigChange(configPath);
                return;
              }
              this._rebuildBundle();
              const activeItems = [...reg.sessions.values()].filter((e) => e && !e.session.closed);
              await Promise.allSettled(activeItems.map((entry) => this._applyToEntry(entry)));
            } catch {}
          }, delayMs);
          if (this._reloadTimer && typeof this._reloadTimer.unref === 'function') {
            this._reloadTimer.unref();
          }
        });
        this.fsw.on?.('error', () => {
          try { this.fsw?.close(); } catch {}
          this.fsw = null;
        });
        if (this.fsw && typeof this.fsw.unref === 'function') this.fsw.unref();
      } catch {}

      this._startPortFileWatchers();
    }

    this._scheduleNextPollTimer();
    void this._tick();
    upd.startTimers();
  }

  async stop(cleanPageDom = false, _testOverrides = null) {
    const reg = this.sessionRegistry;
    const ch = this.channelOrchestrator;
    const tel = this.telemetrySubsystem;
    const upd = this.updateStorageSubsystem;

    reg.hostFsmState = HOST_FSM_STATES.STOPPING;
    tel.flushUsageDiskCache();
    upd.triggerDetachedExitArchiveSync(conversationArchive, cleanPageDom, _testOverrides);

    ch.services.markStopping();
    this.running = false;
    upd.stopTimers();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }
    this._stopPortFileWatchers();
    ch.clearFlushTimer();
    reg.clearAllTimers();
    if (this.fsw) {
      try {
        this.fsw.close();
      } catch {}
      this.fsw = null;
    }
    await this._detachAll(cleanPageDom);
    await tel.disposeAll();
    await ch.services.disposeAll();
    this._releaseOwnership();
    this.logger?.flush?.();
    reg.hostFsmState = HOST_FSM_STATES.IDLE;
  }
}
