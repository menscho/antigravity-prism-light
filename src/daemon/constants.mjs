// Obsidian Prism 守护进程基础常量、路径解析与端口/配置探测（Tier 0）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');
export const defaultCdp = require(path.join(DEFAULT_ROOT_DIR, 'cdp.js'));

export const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
  } catch {}
  return '1.0.8-light.1';
})();

export const METRICS_BINDING = '__agPrismMetricsCall';
export const REPO_BINDING = '__agPrismRepoCall';
export const THOUGHT_BINDING = '__agPrismThoughtCall';
export const USAGE_BINDING = '__agPrismUsageCall';
export const INLINE_DIFF_BINDING = '__agPrismInlineDiffCall';
export const SIDEBAR_BINDING = '__agPrismSidebarCall';
export const WALLPAPER_BINDING = '__agPrismWallpaperCall';
export const SUGGESTER_BINDING = '__agPrismSuggestCall';

export const WALLPAPER_MAX_PAYLOAD_BYTES = 131072;
export const WALLPAPER_ALLOWED_ACTIONS = new Set([
  'get-config',
  'save-config',
  'pick-media',
  'clear-media',
  'get-media-blob',
  'status',
]);

export const SUGGESTER_MAX_PAYLOAD_BYTES = 131072;
export const SUGGESTER_ALLOWED_ACTIONS = new Set([
  'get-config',
  'save-config',
  'fetch-models',
  'test-connection',
  'suggest',
  'cancel',
  'clear-cache',
]);

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RPC_ROUTE_STORAGE = new AsyncLocalStorage();
export const USAGE_CACHE_MAX_BYTES = 4 * 1024 * 1024;
export const USAGE_CACHE_MAX_PER_SCOPE = 1200;
export const USAGE_CACHE_MAX_SCOPES = 32;
export const USAGE_CACHE_MAX_TOTAL_RECORDS = 2400;
export const LOCAL_COLD_WAKEUP_CAP = 12;
export const FORBIDDEN_SCOPE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function resolveStorageGuardStatePath(customPath = null) {
  if (typeof customPath === 'string' && customPath.trim()) {
    return path.resolve(customPath.trim());
  }
  const envPath =
    typeof process.env.PRISM_STORAGE_GUARD_STATE_PATH === 'string'
      ? process.env.PRISM_STORAGE_GUARD_STATE_PATH.trim()
      : '';
  if (envPath) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.gemini', 'config', 'obsidian-prism-storage-guard-state.json');
}

export function resolveUsageCachePath(customPath = null) {
  if (typeof customPath === 'string' && customPath.trim()) {
    return path.resolve(customPath.trim());
  }
  const envPath =
    typeof process.env.PRISM_USAGE_CACHE_PATH === 'string'
      ? process.env.PRISM_USAGE_CACHE_PATH.trim()
      : '';
  if (envPath) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.gemini', 'config', 'obsidian-prism-usage-rollup-cache.json');
}

export function resolvePortFileCandidates() {
  const candidates = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Antigravity', 'DevToolsActivePort'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    candidates.push(path.join(xdg, 'Antigravity', 'DevToolsActivePort'));
  }
  return candidates;
}

const _portFileCache = new Map();
const _hostCfgEnabledCache = new Map();

function _setBoundedFileCache(map, key, val, limit = 16) {
  if (map.has(key)) map.delete(key);
  else if (map.size >= limit) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, val);
}

export function discoverActivePort(overridePort = null, customPortFile = null) {
  if (overridePort && Number.isInteger(Number(overridePort)) && Number(overridePort) > 0) {
    return Number(overridePort);
  }
  if (process.env.AG_CDP_PORT) {
    const p = parseInt(process.env.AG_CDP_PORT, 10);
    if (Number.isInteger(p) && p > 0 && p <= 65535) return p;
  }
  const files = customPortFile ? [customPortFile] : resolvePortFileCandidates();
  for (const file of files) {
    const key = path.resolve(file);
    try {
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        _portFileCache.delete(key);
        continue;
      }
      if (!st.isFile()) {
        _portFileCache.delete(key);
        continue;
      }
      const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}`;
      const cached = _portFileCache.get(key);
      if (cached && cached.sig === sig) {
        if (cached.port) return cached.port;
        continue;
      }
      if (st.size > 2048) {
        _setBoundedFileCache(_portFileCache, key, { sig, port: null });
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      if (text.length > 2048) {
        _setBoundedFileCache(_portFileCache, key, { sig, port: null });
        continue;
      }
      const port = parseInt(text.split(/\r?\n/)[0].trim(), 10);
      const validPort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
      _setBoundedFileCache(_portFileCache, key, { sig, port: validPort });
      if (validPort) return validPort;
    } catch {
      _portFileCache.delete(key);
    }
  }
  return null;
}

export function isEligibleTarget(target) {
  return defaultCdp.isEligibleTarget(target);
}

export function isPluginEnabledInHostConfig(customConfigPath = null) {
  const cfgPath = customConfigPath || path.join(os.homedir(), '.gemini', 'config', 'config.json');
  const key = path.resolve(cfgPath);
  try {
    let st;
    try {
      st = fs.statSync(cfgPath);
    } catch {
      _hostCfgEnabledCache.delete(key);
      return true;
    }
    if (!st.isFile()) {
      _hostCfgEnabledCache.delete(key);
      return true;
    }
    const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}`;
    const cached = _hostCfgEnabledCache.get(key);
    if (cached && cached.sig === sig) {
      return cached.enabled;
    }
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
    let enabled = true;
    if (raw?.plugins?.['obsidian-prism']?.enabled === false) enabled = false;
    else if (raw?.plugins?.['antigravity-prism']?.enabled === false && !raw?.plugins?.['obsidian-prism']) enabled = false;
    _setBoundedFileCache(_hostCfgEnabledCache, key, { sig, enabled });
    return enabled;
  } catch {
    _hostCfgEnabledCache.delete(key);
    return true;
  }
}
