#!/usr/bin/env node
// Obsidian Prism 守护进程兼容入口壳（薄 Facade：保持 plugin.json 启动路径、CLI 行为与全部 named exports 100% 兼容）
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  if (typeof module.enableCompileCache === 'function') {
    const compileCacheDir = path.join(os.homedir(), '.gemini', 'antigravity', 'sidecar_data', 'obsidian-prism', 'compile-cache');
    module.enableCompileCache(compileCacheDir);
  }
} catch {}

import {
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
  PrismDaemon,
  isMainEntry as isMainEntryBase,
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
  evaluateTargetInfoChange,
  runDaemonCli,
} from '../../src/daemon/index.mjs';

const __filename = fileURLToPath(import.meta.url);

/**
 * 保留默认参数为本入口文件路径，兼容历史 CLI 与单测调用。
 */
export function isMainEntry(argv1, moduleFilename = __filename) {
  return isMainEntryBase(argv1, moduleFilename);
}

export {
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
  PrismDaemon,
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
  evaluateTargetInfoChange,
};

if (isMainEntry(process.argv[1], __filename)) {
  runDaemonCli(process.argv);
}
