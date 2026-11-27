// Obsidian Prism — SAFE BUILD update service stub (sidecars/daemon/update-service.mjs)
//
// Modified from upstream RMvdesi/obsidian-prism (GPL-3.0) on 2026-11-27.
// The upstream module checked GitHub every 6 hours and could download and run a
// new installer .exe. This build has NO self-update: no network requests, no
// downloads, no child processes. Updates are done by hand from the local fork.

export const GITHUB_REPO = '';
export const LATEST_RELEASE_API = '';
export const RELEASES_LIST_API = '';
export const RELEASES_PAGE_URL = '';
export const CHECK_TTL_MS = 0;
export const MANUAL_COOLDOWN_MS = 0;
export const MAX_ASSET_BYTES = 0;
export const MAX_REDIRECTS = 0;
export const TRUSTED_RELEASE_HOSTS = Object.freeze([]);

export function normalizeUpdateChannel(raw) {
  return raw === 'beta' ? 'beta' : 'stable';
}

export const SAFE_BUILD_UPDATE_MESSAGE = 'Self-update is removed in this safe build. Update the local fork by hand.';

export class UpdateService {
  constructor({ currentVersion = '0.0.0', channel = 'stable' } = {}) {
    this.currentVersion = String(currentVersion || '0.0.0');
    this.channel = normalizeUpdateChannel(channel);
    this.applying = false;
  }

  setChannel(channel) {
    this.channel = normalizeUpdateChannel(channel);
    return this.channel;
  }

  getStatus() {
    return {
      ok: true,
      channel: this.channel,
      isPrerelease: false,
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
      latestTag: null,
      hasUpdate: false,
      mode: 'disabled',
      hotReloadCapable: false,
      manualRequired: false,
      releaseUrl: '',
      downloadUrl: null,
      checkedAt: null,
      applying: false,
      lastError: null,
      safeBuild: true,
      message: SAFE_BUILD_UPDATE_MESSAGE,
    };
  }

  async checkForUpdates() {
    return this.getStatus();
  }

  async applyReleaseUpdate() {
    return { ok: false, applied: false, error: 'disabled_in_safe_build', message: SAFE_BUILD_UPDATE_MESSAGE };
  }
}
