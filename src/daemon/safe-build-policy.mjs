// Obsidian Prism — SAFE BUILD repo-action policy (src/daemon/safe-build-policy.mjs)
//
// Added 2026-11-27 for the safe build (GPL-3.0, derived from RMvdesi/obsidian-prism).
// Every settings-panel "repo action" passes through executeRepoAction(); this
// module decides which ones are allowed. Anything that downloads code, runs
// another program, changes your environment, or modifies/restarts Antigravity's
// own data is refused here before any upstream code runs.
import path from 'node:path';

export const SAFE_BUILD_BLOCKED_ACTIONS = Object.freeze(
  new Set([
    'apply-update',
    'pull',
    'sync',
    'addons-list',
    'addons-status',
    'addons-install',
    'addons-remove',
    'gomemlimit-set',
    'gomemlimit-clear',
    'prepare-archive',
    'prepare-restore',
    'archive-and-restart',
    'restore-archive',
    'storage-auto-exit',
    'uninstall',
  ])
);

// Read-only / local actions that still run the upstream handler.
export const SAFE_BUILD_PASSTHROUGH_ACTIONS = Object.freeze(
  new Set(['storage-health', 'storage-detail', 'storage-snooze', 'gomemlimit-status'])
);

// Returns a response object when the safe build answers the action itself,
// or null when the (read-only) upstream handler may run.
export function safeBuildRepoActionResponse(rawInput, { version = '', rootDir = '' } = {}) {
  const action = typeof rawInput?.action === 'string' ? rawInput.action : 'status';
  if (SAFE_BUILD_BLOCKED_ACTIONS.has(action)) {
    return { ok: false, action, error: 'disabled_in_safe_build', safeBuild: true };
  }
  if (SAFE_BUILD_PASSTHROUGH_ACTIONS.has(action)) return null;
  if (action === 'update-status' || action === 'check-update') {
    return {
      ok: true,
      action,
      safeBuild: true,
      hasUpdate: false,
      currentVersion: version,
      latestVersion: version,
      autoUpdate: 'off',
      checking: false,
      message: 'Self-update is removed in this safe build.',
    };
  }
  // 'status' and anything unknown: report a standalone install, no git calls.
  return {
    ok: true,
    action: 'status',
    safeBuild: true,
    isGitRepo: false,
    repoPath: rootDir ? path.basename(rootDir) : '',
    branch: 'standalone',
    commit: version,
    shortHash: version,
    dirty: false,
    remoteUrl: '',
    hasRemote: false,
    noRemote: true,
    ahead: 0,
    behind: 0,
    hasUpdates: false,
    upToDate: true,
    updated: false,
    version,
    message: 'Installed safe build (no remote, no self-update)',
  };
}
