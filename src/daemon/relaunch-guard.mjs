// Obsidian Prism 快捷方式 CDP 参数退避同步与无端口重启弹窗守卫（Tier 1，独立组合类，无原型 Mixin）
import fs from 'node:fs';
import path from 'node:path';
import { discoverActivePort } from './constants.mjs';
import { isAutomatedTestRuntime } from './pid-lock.mjs';

export class RelaunchGuard {
  constructor({
    rootDir = '',
    overridePort = null,
    portFile = null,
    relaunchHooks = null,
    noPortRelaunchThresholdMs = 8000,
    shortcutCheckIntervalMs = 300000,
    shortcutBackoffIntervalMs = 45 * 60 * 1000,
    getCdp = () => null,
    isRunning = () => false,
    hasLoopTimer = () => false,
    log = () => {},
  } = {}) {
    this._rootDir = rootDir;
    this._overridePort = overridePort;
    this._portFile = portFile;
    this._relaunchHooks = relaunchHooks;
    this.noPortRelaunchThresholdMs = Math.max(50, Number(noPortRelaunchThresholdMs) || 8000);
    this.shortcutCheckIntervalMs = Math.max(1000, Number(shortcutCheckIntervalMs) || 300000);
    const backoffMs = Number(shortcutBackoffIntervalMs);
    this._shortcutBackoffIntervalMs = Math.max(
      this.shortcutCheckIntervalMs,
      Number.isFinite(backoffMs) && backoffMs > 0 ? backoffMs : 45 * 60 * 1000
    );
    this._getCdp = getCdp;
    this._isRunning = isRunning;
    this._hasLoopTimer = hasLoopTimer;
    this._log = log;

    this._shortcutAllClean = false;
    this._hasActiveCdpPort = false;
    this._noPortSinceMs = 0;
    this._promptInFlight = false;
    this._lastShortcutCheckAt = 0;
    this._lastObservedHostPid = 0;
    this._lastActiveCdpPort = null;
    this._shortcutSyncInFlight = false;
    this._shortcutForcePending = false;
    this._hostDetectCache = null;
  }

  setRootDir(dir) {
    this._rootDir = dir;
  }

  // SAFE BUILD (2026-11-27): never rewrite shortcuts and never close/relaunch
  // Antigravity on its own. Without a debug port the plugin simply stays idle;
  // start Antigravity from the "Antigravity (Prism)" shortcut to enable it.
  isRelaunchGuardAllowed() {
    return false;
  }

  readDiskRawConfig() {
    try {
      const cfgPath = path.join(this._rootDir, 'config.json');
      if (!fs.existsSync(cfgPath)) return {};
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  resetShortcutBackoff(reason = '') {
    const hadBackoff = Boolean(this._shortcutAllClean);
    this._shortcutAllClean = false;
    if (reason && hadBackoff) {
      this._log(`[shortcut-guard] Reset shortcut backoff (${reason})`);
    }
  }

  maybeSyncShortcuts(force = false, opts = null) {
    if (!this.isRelaunchGuardAllowed()) return null;
    if (process.env.PRISM_DISABLE_SHORTCUT_SYNC === '1' && !this._relaunchHooks?.syncShortcuts) return null;
    if (this._shortcutSyncInFlight) {
      if (force) this._shortcutForcePending = true;
      return null;
    }
    const now = Date.now();
    const hasActivePort =
      opts && typeof opts.hasActivePort === 'boolean' ? opts.hasActivePort : Boolean(this._hasActiveCdpPort);
    const effectiveIntervalMs =
      this._shortcutAllClean && hasActivePort
        ? this._shortcutBackoffIntervalMs
        : this.shortcutCheckIntervalMs;
    if (!force && this._lastShortcutCheckAt > 0 && now - this._lastShortcutCheckAt < effectiveIntervalMs) {
      return null;
    }
    const onDone = (res) => {
      if (res && !res.error) {
        this._lastShortcutCheckAt = Date.now();
        const patchedLen = Array.isArray(res.patched) ? res.patched.length : 0;
        const skippedLen = Array.isArray(res.skipped) ? res.skipped.length : 0;
        const alreadyLen = Array.isArray(res.alreadySet) ? res.alreadySet.length : 0;
        const matched = Number(res.matched || 0);
        this._shortcutAllClean = patchedLen === 0 && skippedLen === 0 && (alreadyLen > 0 || matched === 0);
      } else {
        this._shortcutAllClean = false;
      }
      if (res && Array.isArray(res.patched) && res.patched.length > 0) {
        this._log(`[shortcut-guard] Ensured --remote-debugging-port=0 on ${res.patched.length} shortcut(s)`);
      }
      return res;
    };
    const onFinally = () => {
      this._shortcutSyncInFlight = false;
      if (this._shortcutForcePending && this._isRunning()) {
        this._shortcutForcePending = false;
        void this.maybeSyncShortcuts(true);
      }
    };
    const cdp = this._getCdp?.();
    try {
      if (typeof this._relaunchHooks?.syncShortcuts === 'function') {
        const res = this._relaunchHooks.syncShortcuts({ pluginDir: this._rootDir });
        if (res && typeof res.then === 'function') {
          this._shortcutSyncInFlight = true;
          return res.then(onDone).catch(() => null).finally(onFinally);
        }
        return onDone(res);
      }
      if (typeof cdp?.ensureAntigravityShortcutsCdpFlagAsync === 'function') {
        this._shortcutSyncInFlight = true;
        return cdp
          .ensureAntigravityShortcutsCdpFlagAsync({ pluginDir: this._rootDir })
          .then(onDone)
          .catch(() => null)
          .finally(onFinally);
      }
      if (typeof cdp?.ensureAntigravityShortcutsCdpFlag === 'function') {
        return onDone(cdp.ensureAntigravityShortcutsCdpFlag({ pluginDir: this._rootDir }));
      }
      return null;
    } catch {
      this._shortcutSyncInFlight = false;
      return null;
    }
  }

  async handleMissingCdpPort() {
    this._hasActiveCdpPort = false;
    this._shortcutAllClean = false;
    if (!this._isRunning() || !this._hasLoopTimer() || this._promptInFlight) return;
    if (!this.isRelaunchGuardAllowed()) return;

    const now = Date.now();
    if (this._noPortSinceMs <= 0) {
      this._noPortSinceMs = now;
    }
    this.maybeSyncShortcuts(false, { hasActivePort: false });

    if (now - this._noPortSinceMs < this.noPortRelaunchThresholdMs) {
      return;
    }

    const rawCfg = this.readDiskRawConfig();
    if (rawCfg.autoPromptCdpRelaunch === false) {
      return;
    }

    const cdp = this._getCdp?.();
    const detectFn =
      typeof this._relaunchHooks?.detectHost === 'function'
        ? this._relaunchHooks.detectHost
        : typeof cdp?.detectRunningAntigravityHost === 'function'
        ? () => cdp.detectRunningAntigravityHost()
        : null;
    if (!detectFn) return;

    const useDetectCache = typeof this._relaunchHooks?.detectHost !== 'function';
    const detectNow = Date.now();
    let host = null;
    if (useDetectCache && this._hostDetectCache && detectNow - this._hostDetectCache.at < 30000) {
      host = this._hostDetectCache.host;
    } else {
      host = await detectFn();
      if (useDetectCache) this._hostDetectCache = { at: Date.now(), host };
    }
    if (!this._isRunning()) return;
    if (!host || !host.pid) {
      this._noPortSinceMs = Date.now();
      return;
    }

    if (host.pid !== this._lastObservedHostPid) {
      this._lastObservedHostPid = host.pid;
      this._shortcutAllClean = false;
      this.maybeSyncShortcuts(true);
    }

    if (host.hasDebugPortSwitch) {
      return;
    }

    const hostAgeMs = host.startMs > 0 ? Math.max(0, Date.now() - host.startMs) : now - this._noPortSinceMs;
    if (hostAgeMs < this.noPortRelaunchThresholdMs) {
      return;
    }

    const extraDirs = Array.isArray(this._relaunchHooks?.stateExtraDirs) ? this._relaunchHooks.stateExtraDirs : [];
    const alreadyPrompted =
      typeof cdp?.hasRelaunchBeenPromptedForHost === 'function'
        ? cdp.hasRelaunchBeenPromptedForHost(this._rootDir, host.pid, host.startMs, extraDirs)
        : false;
    if (alreadyPrompted) {
      return;
    }

    this._promptInFlight = true;
    try {
      if (typeof cdp?.recordRelaunchPromptState === 'function') {
        cdp.recordRelaunchPromptState(this._rootDir, host.pid, host.startMs, 'prompted', extraDirs);
      }
      this._log(`[relaunch-guard] Host pid=${host.pid} running without CDP port; prompting user once`);
      const lang = rawCfg.language || rawCfg.lang || 'auto';
      const promptFn =
        typeof this._relaunchHooks?.promptUser === 'function'
          ? this._relaunchHooks.promptUser
          : typeof cdp?.promptUserForHostRelaunch === 'function'
          ? (o) => cdp.promptUserForHostRelaunch(o)
          : async () => false;
      const confirmed = await promptFn({ lang, host });
      if (!this._isRunning()) return;
      if (!confirmed) {
        if (typeof cdp?.recordRelaunchPromptState === 'function') {
          cdp.recordRelaunchPromptState(this._rootDir, host.pid, host.startMs, 'no', extraDirs);
        }
        this._log(`[relaunch-guard] User declined immediate relaunch for pid=${host.pid}; shortcuts ready for next launch`);
        return;
      }
      const portNow = discoverActivePort(this._overridePort, this._portFile);
      if (portNow) {
        this._noPortSinceMs = 0;
        return;
      }
      if (typeof cdp?.recordRelaunchPromptState === 'function') {
        cdp.recordRelaunchPromptState(this._rootDir, host.pid, host.startMs, 'yes', extraDirs);
      }
      const spawnFn =
        typeof this._relaunchHooks?.spawnRelaunch === 'function'
          ? this._relaunchHooks.spawnRelaunch
          : typeof cdp?.spawnDetachedHostRelaunchHelper === 'function'
          ? (t) => cdp.spawnDetachedHostRelaunchHelper(t)
          : () => ({ spawned: false });
      const spawnRes = await spawnFn({
        hostPid: host.pid,
        exePath: host.exePath || '',
        pluginDir: this._rootDir,
      });
      this._log(
        `[relaunch-guard] Triggered detached relaunch helper for pid=${host.pid} (spawned=${Boolean(spawnRes?.spawned)}, method=${spawnRes?.method || 'custom'})`
      );
    } finally {
      this._promptInFlight = false;
    }
  }
}
