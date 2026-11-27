// Obsidian Prism 存储守卫协调引擎（还原、弹窗、退出自动归档、GoMemLimit、Addons 与卸载，Tier 1，无原型 Mixin）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { isLabEnabled as isAddonsLabEnabled } from '../../sidecars/daemon/addon-registry.mjs';
import { getGoMemLimitStatus, setGoMemLimit, clearGoMemLimit } from '../../sidecars/daemon/gomemlimit-service.mjs';
import { buildStorageGuardBannerExpression, buildStorageGuardDismissExpression } from '../../sidecars/daemon/storage-guard-ui.mjs';
import * as conversationArchive from '../../sidecars/daemon/conversation-archive.mjs';
import { sanitizeSecretText } from '../../sidecars/daemon/redact.mjs';
import { resolveUninstallRunnerPath } from './uninstall-runner.mjs';
import { DEFAULT_ROOT_DIR, discoverActivePort } from './constants.mjs';
import { resolveUsageScopeKey } from './telemetry-scope.mjs';
import {
  getAutoArchiveOnExitSetting,
  readStorageGuardState,
  writeStorageGuardState,
  flushCatalogIndexFromMemory,
  checkActiveHostIdleState,
  resolveCdpQuitTarget,
  scheduleOfflineArchiveTask,
  handleStorageAction,
} from './storage-guard-actions.mjs';

const require = createRequire(import.meta.url);

export async function handleRestoreArchiveAction(upd, rawInput = {}, _testOverrides = null) {
  try {
    const arch = conversationArchive;
    const convDir = _testOverrides?.convDir || arch.getDefaultConversationsDir();
    const archiveDir = _testOverrides?.archiveDir || arch.getDefaultArchiveDir();
    const batches = arch.listArchiveBatches(archiveDir);
    const lastArchiveResult = arch.readLastArchiveResult(archiveDir);
    if (rawInput?.listOnly === true) {
      return { ok: true, action: 'restore-archive', batches, lastArchiveResult };
    }
    if (rawInput?.confirm !== true) {
      return { ok: false, action: 'restore-archive', error: 'confirmation_required', batches };
    }
    if (upd._archiveActionInFlight || (!_testOverrides && upd._archiveScheduledAt > 0 && Date.now() - upd._archiveScheduledAt < 15000)) {
      return { ok: false, action: 'restore-archive', code: 'ARCHIVE_IN_PROGRESS', error: '已有归档或还原任务正在执行，请勿重复触发。', batches };
    }
    upd._archiveActionInFlight = true;
    try {
      if (_testOverrides?.forceBusy !== true) {
        const idleState = await checkActiveHostIdleState(upd, _testOverrides);
        if (!idleState?.idle) {
          return {
            ok: false,
            action: 'restore-archive',
            code: 'HOST_BUSY',
            error: '检测到 AI 正在生成或 Swarm 任务运行中，请等待空闲后再执行无损还原并重启。',
            idleState,
            batches,
          };
        }
      }
      if (batches.length === 0) {
        return { ok: false, action: 'restore-archive', code: 'NO_BATCH', error: '未找到任何历史归档批次。', batches: [] };
      }
      const rawBatch =
        typeof rawInput?.batchName === 'string' && rawInput.batchName.trim()
          ? rawInput.batchName.trim()
          : typeof rawInput?.batch === 'string' && rawInput.batch.trim()
            ? rawInput.batch.trim()
            : 'latest';
      let batchName = 'latest';
      try {
        batchName = arch.validateBatchSelector(rawBatch);
      } catch (err) {
        return {
          ok: false,
          action: 'restore-archive',
          code: 'INVALID_BATCH',
          error: sanitizeSecretText(err?.message || 'invalid_batch'),
          batches,
        };
      }
      const matchedBatch =
        batchName === 'latest'
          ? batches[0] || null
          : batches.find((b) => b.batchName === batchName) || null;
      if (!matchedBatch) {
        return { ok: false, action: 'restore-archive', code: 'BATCH_NOT_FOUND', error: 'batch_not_found', batches };
      }
      const resolvedBatchName = matchedBatch.batchName;
      const cdp = upd.getCdp();
      let host = null;
      if (typeof _testOverrides?.detectHost === 'function') {
        host = await _testOverrides.detectHost();
      } else if (typeof cdp?.detectRunningAntigravityHost === 'function') {
        try { host = await cdp.detectRunningAntigravityHost(); } catch {}
      }
      const cdpTarget = resolveCdpQuitTarget(upd, _testOverrides);
      const spawnRes = scheduleOfflineArchiveTask(
        upd,
        arch,
        {
          action: 'restore-and-restart',
          convDir,
          archiveDir,
          hostPid: host?.pid || 0,
          ownDaemonPid: process.pid,
          cdpPort: cdpTarget.cdpPort,
          cdpBrowserWsPath: cdpTarget.cdpBrowserWsPath,
          exePath: host?.exePath || '',
          gracefulQuit: true,
          relaunch: true,
          batchName: resolvedBatchName,
          settleMs: 4000,
        },
        _testOverrides
      );
      if (spawnRes?.spawned) {
        upd._autoArchiveExitRan = true;
        if (!_testOverrides) upd._archiveScheduledAt = Date.now();
      }
      upd.invalidateStorageHealthCache();
      return {
        ok: Boolean(spawnRes?.spawned),
        ...(spawnRes?.spawned ? {} : { code: spawnRes?.code || 'SPAWN_FAILED', error: spawnRes?.error || 'Failed to launch detached restore task' }),
        action: 'restore-archive',
        scheduled: Boolean(spawnRes?.spawned),
        batchName: resolvedBatchName,
        batchesCount: batches.length,
        method: spawnRes?.method || 'custom',
      };
    } finally {
      upd._archiveActionInFlight = false;
    }
  } catch (err) {
    return { ok: false, action: 'restore-archive', error: sanitizeSecretText(err?.message || err) };
  }
}

export async function handleStorageSnoozeAction(upd, rawInput = {}) {
  const hours = Math.max(1, Math.min(168, Number(rawInput?.hours) || 24));
  const snoozeUntilMs = Date.now() + hours * 3600000;
  writeStorageGuardState(upd, { snoozeUntilMs });
  upd.invalidateStorageHealthCache();
  const dismissExpr = buildStorageGuardDismissExpression();
  for (const entry of upd.getSessions().values()) {
    if (entry && !entry.session?.closed) {
      await entry.session.evaluate(dismissExpr).catch(() => {});
    }
  }
  return { ok: true, action: 'storage-snooze', hours, snoozeUntilMs };
}

export async function handleGoMemLimitAction(action, rawInput = {}) {
  const testOpts = rawInput?._testOverrides && typeof rawInput._testOverrides === 'object' ? rawInput._testOverrides : {};
  if (action === 'gomemlimit-set') {
    const res = await setGoMemLimit(rawInput?.value, testOpts);
    return { ...res, action };
  }
  if (action === 'gomemlimit-clear') {
    const res = await clearGoMemLimit(testOpts);
    return { ...res, action };
  }
  const res = await getGoMemLimitStatus(testOpts);
  return { ...res, action: 'gomemlimit-status' };
}

export async function handleAddonsAction(upd, action, rawInput = {}) {
  const envOverride = rawInput?._testOverrides?.env || process.env;
  if (!isAddonsLabEnabled(envOverride)) {
    return { ok: false, action, error: 'addons_lab_disabled' };
  }
  const registry = rawInput?._testOverrides?.addonRegistry || upd.addonRegistry;
  if (!registry) {
    return { ok: false, action, error: 'addon_registry_unavailable' };
  }
  if (action === 'addons-list') {
    const res = registry.listAddons();
    return { ...res, action, labEnabled: true };
  }
  if (action === 'addons-status') {
    const targetId = rawInput?.id || rawInput?.addonId || '';
    if (typeof targetId === 'string' && targetId.trim()) {
      const res = registry.getAddonStatus(targetId.trim());
      return { ...res, action, labEnabled: true };
    }
    const res = registry.listAddons();
    return { ...res, action, labEnabled: true };
  }
  if (action === 'addons-install') {
    const res = await registry.install({
      manifestUrl: rawInput?.manifestUrl,
      expectedManifestSha256: rawInput?.expectedManifestSha256 ?? null,
      id: rawInput?.id || rawInput?.addonId || null,
    });
    return { ...res, action, labEnabled: true };
  }
  if (action === 'addons-remove') {
    const res = registry.remove(rawInput?.id || rawInput?.addonId);
    return { ...res, action, labEnabled: true };
  }
  return { ok: false, action, error: 'unknown_addons_action' };
}

export async function resolveStorageGuardLanguage(upd, targetEntry, cfg = null, _testOverrides = null) {
  let i18nCore = null;
  try {
    i18nCore = require(path.join(upd.rootDir, 'i18n-core.js'));
  } catch {}
  const normalizeLang = (raw, fallback = 'en') => {
    if (typeof i18nCore?.normalizeLanguage === 'function') {
      return i18nCore.normalizeLanguage(raw, fallback);
    }
    const s = String(raw || '').trim().toLowerCase().replace(/_/g, '-').split(/[.@]/)[0];
    if (!s) return fallback;
    if (s === 'en' || s.startsWith('en-')) return 'en';
    if (s === 'ja' || s.startsWith('ja-')) return 'ja';
    if (s === 'ko' || s.startsWith('ko-')) return 'ko';
    if (s === 'es' || s.startsWith('es-')) return 'es';
    if (s === 'fr' || s.startsWith('fr-')) return 'fr';
    if (s === 'de' || s.startsWith('de-')) return 'de';
    if (s === 'tr' || s.startsWith('tr-') || s === 'turkish' || s === 'türkçe' || s === 'turkce') return 'tr';
    if (s === 'yue' || s.startsWith('yue-') || s === 'zh-yue') return 'zh-CN';
    if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(s)) return 'zh-TW';
    if (s === 'zh' || s.startsWith('zh-')) return 'zh-CN';
    return fallback;
  };

  const rawCfgLang = String((cfg && (cfg.language || cfg.lang)) || '').trim();
  if (rawCfgLang && rawCfgLang.toLowerCase() !== 'auto') {
    return normalizeLang(rawCfgLang, 'en');
  }

  let pageLang = '';
  if (typeof _testOverrides?.pageLang === 'string') {
    const ovLang = _testOverrides.pageLang.trim();
    if (ovLang && ovLang.toLowerCase() !== 'auto') pageLang = ovLang;
  } else if (targetEntry?.session && !targetEntry.session.closed && typeof targetEntry.session.send === 'function') {
    try {
      const langProbeExpr =
        "(() => { try { const pick = (v) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'auto' ? v.trim() : ''); const r = typeof document !== 'undefined' ? document.documentElement : null; const nav = typeof navigator !== 'undefined' ? navigator : null; return pick(r && r.getAttribute && r.getAttribute('data-ag-cs-lang')) || pick(nav && nav.language) || pick(nav && Array.isArray(nav.languages) && nav.languages[0]) || pick(r && r.lang) || ''; } catch { return ''; } })()";
      const probeRes = await targetEntry.session.send(
        'Runtime.evaluate',
        { expression: langProbeExpr, returnByValue: true },
        1500
      );
      const val = probeRes?.result?.value;
      if (typeof val === 'string' && val.trim() && val.trim().toLowerCase() !== 'auto') {
        pageLang = val.trim();
      }
    } catch {}
  }
  if (pageLang) {
    const normPage = normalizeLang(pageLang, '');
    if (normPage) return normPage;
  }

  let sysLocale = typeof _testOverrides?.systemLocale === 'string' ? _testOverrides.systemLocale.trim() : '';
  if (!sysLocale) {
    const cdp = upd.getCdp();
    if (typeof cdp?.detectSystemUiLocale === 'function') {
      try {
        sysLocale = String(cdp.detectSystemUiLocale() || '').trim();
      } catch {
        sysLocale = '';
      }
    }
    if (!sysLocale) {
      try {
        const candidates = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG];
        for (let i = 0; i < candidates.length; i += 1) {
          const val = String(candidates[i] || '').trim();
          if (val && !/^(?:c|posix)(?:[.@]|$)/i.test(val)) {
            sysLocale = val;
            break;
          }
        }
        if (!sysLocale) {
          sysLocale = Intl.DateTimeFormat().resolvedOptions().locale || '';
        }
      } catch {
        sysLocale = '';
      }
    }
  }
  return normalizeLang(sysLocale, 'en');
}

export async function checkStorageGuardAndNotify(upd, _testOverrides = null) {
  if (!upd.isRunning() && !_testOverrides) return { shown: false, reason: 'not-running' };
  const now = Number.isFinite(_testOverrides?.now) ? _testOverrides.now : Date.now();
  const state = readStorageGuardState(upd);
  if (state.snoozeUntilMs > now) {
    return { shown: false, reason: 'snoozed', snoozeUntilMs: state.snoozeUntilMs };
  }
  if (!_testOverrides && upd._storageGuardBannerShownAt > 0 && now - upd._storageGuardBannerShownAt < 1800000) {
    return { shown: false, reason: 'cooldown' };
  }
  const localEntries = [];
  for (const entry of upd.getSessions().values()) {
    if (!entry || entry.session?.closed) continue;
    if (resolveUsageScopeKey({ entry }) === 'local') localEntries.push(entry);
  }
  if (localEntries.length === 0) {
    return { shown: false, reason: 'no-local-window' };
  }

  const health = await handleStorageAction(upd, 'storage-health', _testOverrides, { force: Boolean(_testOverrides) });
  if (!health?.ok || !health.warn) {
    return { shown: false, reason: 'healthy', health };
  }

  const idleState = await checkActiveHostIdleState(upd, _testOverrides);
  if (!idleState?.idle) {
    return { shown: false, reason: 'host-busy', idleState, health };
  }

  const targetEntry = localEntries[0];
  let ui = {};
  let resolvedLang = 'en';
  try {
    const cfg =
      _testOverrides?.config && typeof _testOverrides.config === 'object'
        ? _testOverrides.config
        : upd.getCdp()?.readConfig?.() || {};
    resolvedLang = await resolveStorageGuardLanguage(upd, targetEntry, cfg, _testOverrides);
    const locales = require(path.join(upd.rootDir, 'i18n-locales.js'));
    ui = locales.getUiStrings(resolvedLang) || {};
  } catch {}

  const fmtMb = (v) => (Number(v) >= 1024 ? `${(Number(v) / 1024).toFixed(2)} GB` : `${Math.round(Number(v) || 0)} MB`);
  const tpl = ui.storageGuardSummaryTpl || 'DB {0} · Subagents {1} ({2}) · LS Memory {3}';
  const summaryText = tpl
    .replace(/\{0\}/g, fmtMb(health.totalMb))
    .replace(/\{1\}/g, String(health.archivableSubagentCount || 0))
    .replace(/\{2\}/g, fmtMb(health.archivableSubagentMb || health.subagentMb || 0))
    .replace(/\{3\}/g, health.lsMemoryMb ? fmtMb(health.lsMemoryMb) : '—');

  const closeLabels = {
    'zh-CN': '关闭',
    'zh-TW': '關閉',
    en: 'Close',
    ja: '閉じる',
    ko: '닫기',
    es: 'Cerrar',
    fr: 'Fermer',
    de: 'Schließen',
    tr: 'Kapat',
  };
  const expr = buildStorageGuardBannerExpression({
    autoArchiveOnExit: Boolean(health.autoArchiveOnExit),
    copy: {
      title: ui.storageGuardTitle || 'Memory & Conversation DB Guard',
      close: closeLabels[resolvedLang] || 'Close',
      summary: summaryText,
      archiveRestartBtn: ui.storageArchiveRestartBtn || 'Archive & Restart',
      enableAutoExitBtn: ui.storageGuardEnableAutoExitBtn || 'Enable Auto-Archive on Exit',
      autoExitEnabledMsg: ui.storageAutoExitEnabledMsg || 'Auto-archive on exit enabled',
      snooze24hBtn: ui.storageGuardSnooze24hBtn || 'Snooze 24h',
      confirmDesc:
        ui.storageArchiveRestartConfirmDesc ||
        'Will save token ledger, close Antigravity gracefully, move finished subagents (>2h) without deleting any files, keep all main chats, and restart.',
      cancelBtn: ui.uninstallCancelBtn || 'Cancel',
      confirmBtn: ui.storageArchiveRestartConfirmBtn || 'Confirm Archive & Restart',
      runningMsg: ui.storageArchiveRestartRunning || 'Saving token ledger & starting safe archiver...',
      scheduledMsg: ui.storageArchiveRestartScheduled || 'Safe offline archive & restart scheduled.',
      busyBlockedMsg: ui.storageGuardBusyMsg || 'AI or Swarm is running; retry when idle.',
    },
  });

  const evalRes = await targetEntry.session
    .send('Runtime.evaluate', { expression: expr, returnByValue: true }, 4000)
    .catch(() => null);
  const mounted = Boolean(evalRes?.result?.value?.mounted);
  if (mounted) {
    upd._storageGuardBannerShownAt = now;
    if (!state.firstPromptShownAt) {
      writeStorageGuardState(upd, { firstPromptShownAt: now });
    }
  }
  return { shown: mounted, lang: resolvedLang, health, idleState };
}

export async function maybeRunAutoArchiveOnExit(upd, _testOverrides = null) {
  // SAFE BUILD (2026-11-27): never move Antigravity conversation files.
  void _testOverrides;
  return { ran: false, reason: 'disabled-in-safe-build' };
}

export async function handleUninstallAction(upd, rawInput = {}) {
  if (rawInput?.confirm !== true) {
    return { ok: false, action: 'uninstall', error: 'confirmation_required' };
  }
  upd._isUninstalling = true;
  const purgeData = rawInput?.purgeData === true;
  const ov = rawInput?._testOverrides && typeof rawInput._testOverrides === 'object' ? rawInput._testOverrides : null;
  const platform = ov?.platform || process.platform;
  const lstatFn = typeof ov?.lstatSync === 'function' ? ov.lstatSync : fs.lstatSync;
  const spawnFn = typeof ov?.spawn === 'function' ? ov.spawn : spawn;

  let installerPath = null;
  if (ov && Object.prototype.hasOwnProperty.call(ov, 'installerPath')) {
    installerPath = ov.installerPath || null;
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    installerPath = path.join(localAppData, 'obsidian-prism', 'obsidian-prism-installer.exe');
  } else if (platform === 'darwin') {
    installerPath = path.join(os.homedir(), 'Library', 'Application Support', 'obsidian-prism', 'obsidian-prism-installer');
  }

  let engine = null;
  let spawnCmd = null;
  let spawnArgs = [];
  let spawnEnv = null;

  if (installerPath) {
    try {
      const lst = lstatFn(installerPath);
      if (lst && typeof lst.isSymbolicLink === 'function' && lst.isSymbolicLink()) {
        return { ok: false, action: 'uninstall', error: 'refused_symlink_installer' };
      }
      if (lst && typeof lst.isFile === 'function' && lst.isFile()) {
        engine = 'installer';
        spawnCmd = installerPath;
        spawnArgs = ['--uninstall', '--silent', ...(purgeData ? ['--purge-data'] : [])];
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        return { ok: false, action: 'uninstall', error: sanitizeSecretText(err?.message || err) };
      }
    }
  }

  if (!spawnCmd) {
    engine = 'source-script';
    let scriptPath = null;
    if (ov && Object.prototype.hasOwnProperty.call(ov, 'installScriptPath')) {
      scriptPath = ov.installScriptPath || null;
    } else {
      const repoDir = upd.resolveGitRepoDir();
      const candidates = [
        repoDir ? path.join(repoDir, 'tools', 'install-plugin.cjs') : null,
        path.join(upd.rootDir, 'tools', 'install-plugin.cjs'),
      ].filter(Boolean);
      for (const cand of candidates) {
        try {
          const st = lstatFn(cand);
          if (st && !st.isSymbolicLink() && st.isFile()) {
            scriptPath = cand;
            break;
          }
        } catch {}
      }
    }

    const cdpPort = upd.getCdpPort();
    spawnCmd = process.execPath;
    spawnArgs = [resolveUninstallRunnerPath(upd.rootDir, DEFAULT_ROOT_DIR, lstatFn)];
    spawnEnv = {
      ...process.env,
      AG_PRISM_UNINSTALL_TARGET: upd.rootDir,
      AG_PRISM_PURGE_DATA: purgeData ? '1' : '0',
      ...(scriptPath ? { AG_PRISM_UNINSTALL_SCRIPT: scriptPath } : {}),
      ...(cdpPort ? { AG_PRISM_CDP_PORT: String(cdpPort) } : {}),
    };
  }

  const spawnOpts = {
    detached: true,
    cwd: os.tmpdir(),
    stdio: 'ignore',
    windowsHide: true,
    ...(spawnEnv ? { env: spawnEnv } : {}),
  };
  const child = spawnFn(spawnCmd, spawnArgs, spawnOpts);
  child?.unref?.();

  if (!ov?.skipStop) {
    const stopDelayMs = Number.isFinite(ov?.stopDelayMs) ? ov.stopDelayMs : 150;
    const stopFn = typeof ov?.stop === 'function' ? ov.stop : () => upd.invokeStop(!installerPath || engine !== 'installer');
    const exitFn = typeof ov?.exit === 'function' ? ov.exit : (code) => process.exit(code);
    const timer = setTimeout(() => {
      Promise.resolve(stopFn()).catch(() => {}).finally(() => exitFn(0));
    }, stopDelayMs);
    timer.unref?.();
  }

  return { ok: true, action: 'uninstall', scheduled: true, purgeData, engine };
}
