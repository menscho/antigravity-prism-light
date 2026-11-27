// Obsidian Prism — SAFE BUILD add-on registry stub (sidecars/daemon/addon-registry.mjs)
//
// Modified from upstream RMvdesi/obsidian-prism (GPL-3.0) on 2026-11-27.
// Upstream could download extra code ("add-ons") from GitHub behind a hidden
// developer flag. This build cannot download or load add-ons at all.

export const ADDONS_LAB_ENV_VAR = 'OBSIDIAN_PRISM_ADDONS_LAB';

export function isLabEnabled() {
  return false;
}
export { isLabEnabled as isAddonsLabEnabled };

export class AddonRegistry {
  constructor() {}
  listAddons() {
    return { ok: true, addons: [] };
  }
  getAddonStatus(id) {
    return { ok: false, id: String(id || ''), error: 'disabled_in_safe_build' };
  }
  async install() {
    return { ok: false, error: 'disabled_in_safe_build' };
  }
  remove() {
    return { ok: false, error: 'disabled_in_safe_build' };
  }
}
