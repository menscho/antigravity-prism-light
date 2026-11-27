// Obsidian Prism — SAFE BUILD GOMEMLIMIT stub (sidecars/daemon/gomemlimit-service.mjs)
//
// Modified from upstream RMvdesi/obsidian-prism (GPL-3.0) on 2026-11-27.
// Upstream could write a GOMEMLIMIT user environment variable (Windows registry
// HKCU\Environment / macOS LaunchAgent), which affects every Go program you run.
// This build never changes your environment variables.

export const ALLOWED_GOMEMLIMIT_PRESETS = Object.freeze([]);
export const RECOMMENDED_GOMEMLIMIT = '';

export function isValidGoMemLimitValue() {
  return false;
}

export async function getGoMemLimitStatus() {
  return {
    ok: true,
    supported: false,
    value: typeof process.env.GOMEMLIMIT === 'string' ? process.env.GOMEMLIMIT.trim() : '',
    managed: false,
    error: 'disabled_in_safe_build',
  };
}

export async function setGoMemLimit() {
  return { ok: false, supported: false, error: 'disabled_in_safe_build' };
}

export async function clearGoMemLimit() {
  return { ok: false, supported: false, error: 'disabled_in_safe_build' };
}
