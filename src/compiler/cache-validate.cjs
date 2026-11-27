// .bundle-cache.json v2 格式常量、完整性校验器与只读冻结辅助（纯无状态逻辑）
'use strict';

const path = require('path');
const { sha256Text, computeHash } = require('../utils/fs-safe.cjs');
const { CHANNEL_CACHE_NAMES, CHANNEL_CACHE_FORMAT_MAP } = require('../channels/registry.cjs');

const BUNDLE_CACHE_SCHEMA_VERSION = 2;
const BUNDLE_CACHE_FILENAME = '.bundle-cache.json';
const BUNDLE_CACHE_SHARD_DIRNAME = '.bundle-cache';
const BUNDLE_CACHE_MAX_ENTRIES = 4;
const BUNDLE_CACHE_MAX_FILE_BYTES = 6 * 1024 * 1024;
const BUNDLE_CACHE_MAX_EXPR_BYTES = 2 * 1024 * 1024;
const BUNDLE_CACHE_MAX_BOOTCFG_BYTES = 64 * 1024;
const CHANNEL_CACHE_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const CODE_HASH_RE = /^[0-9a-z]{1,16}$/;
const BUNDLE_CACHE_ROOT_MEM_TTL_MS = 500;

// 通道附属分片槽位（如 Ch8 轻桩），不污染 CHANNEL_CACHE_NAMES 唯一 16 通道清单
const CHANNEL_SUB_SLOTS = Object.freeze({
  periodicPickerStub: Object.freeze({
    parentChannel: 'periodicPicker',
    format: 'minRuntime',
    shardFile: 'ch-periodicPicker-stub.json',
  }),
});

function isShardedCachePath(cachePath, opts = null) {
  if (!cachePath || typeof cachePath !== 'string') return false;
  if (opts && opts.sharded === true) return true;
  if (opts && opts.sharded === false) return false;
  const base = path.basename(path.resolve(cachePath)).toLowerCase();
  return base === BUNDLE_CACHE_SHARD_DIRNAME || base === 'bundle-cache';
}

function resolveChannelCacheFormat(channelName) {
  if (Object.prototype.hasOwnProperty.call(CHANNEL_CACHE_FORMAT_MAP, channelName)) {
    return CHANNEL_CACHE_FORMAT_MAP[channelName];
  }
  if (Object.prototype.hasOwnProperty.call(CHANNEL_SUB_SLOTS, channelName)) {
    return CHANNEL_SUB_SLOTS[channelName].format;
  }
  return null;
}

function resolveChannelShardFilename(channelName) {
  if (Object.prototype.hasOwnProperty.call(CHANNEL_SUB_SLOTS, channelName)) {
    return CHANNEL_SUB_SLOTS[channelName].shardFile;
  }
  if (!CHANNEL_CACHE_NAMES.includes(channelName)) return '';
  return `ch-${channelName}.json`;
}

function resolveChannelStatsKey(channelName) {
  if (Object.prototype.hasOwnProperty.call(CHANNEL_SUB_SLOTS, channelName)) {
    return CHANNEL_SUB_SLOTS[channelName].parentChannel;
  }
  return channelName;
}

function computeSourceStatsBinding(pluginVersion, scopeKey, sourceHash, sourceStats) {
  return sha256Text(
    `${BUNDLE_CACHE_SCHEMA_VERSION}\0${String(pluginVersion || '')}\0${String(scopeKey || '')}\0${String(sourceHash || '')}\0${JSON.stringify(sourceStats || [])}`
  );
}

function isValidSourceStatsArray(stats) {
  if (!Array.isArray(stats) || stats.length === 0 || stats.length > 256) return false;
  for (const item of stats) {
    if (!Array.isArray(item) || item.length !== 4) return false;
    if (typeof item[0] !== 'string' || !item[0]) return false;
    if (!Number.isFinite(item[1]) || !Number.isFinite(item[2]) || !Number.isFinite(item[3])) return false;
  }
  return true;
}

function resolveBundleCachePathOption(opts) {
  if (opts && (opts.cachePath === false || opts.cachePath === null || opts.noDiskCache === true)) {
    return null;
  }
  if (opts && typeof opts.cachePath === 'string') {
    const trimmed = opts.cachePath.trim();
    return trimmed ? path.resolve(trimmed) : null;
  }
  const envRaw = process.env.AG_PRISM_BUNDLE_CACHE_PATH;
  if (typeof envRaw === 'string' && envRaw.trim()) {
    const trimmed = envRaw.trim();
    if (/^(?:0|off|false|none)$/i.test(trimmed)) return null;
    return path.resolve(trimmed);
  }
  return null;
}

function freezeBundleCacheRoot(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  try {
    if (Array.isArray(parsed.entries)) {
      for (const ent of parsed.entries) {
        if (ent && typeof ent === 'object') Object.freeze(ent);
      }
      Object.freeze(parsed.entries);
    }
    if (parsed.channels && typeof parsed.channels === 'object' && !Array.isArray(parsed.channels)) {
      for (const name of Object.keys(parsed.channels)) {
        const ch = parsed.channels[name];
        if (ch && typeof ch === 'object') Object.freeze(ch);
      }
      Object.freeze(parsed.channels);
    }
    Object.freeze(parsed);
  } catch {}
  return parsed;
}

function isValidBundleBaseTemplate(parsed, { skipSha256 = false } = {}) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const hasOwn = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
  if (!hasOwn('codeHash') || typeof parsed.codeHash !== 'string' || !CODE_HASH_RE.test(parsed.codeHash)) {
    return false;
  }
  if (!hasOwn('basePrefix') || typeof parsed.basePrefix !== 'string' || parsed.basePrefix.length === 0) {
    return false;
  }
  if (!hasOwn('baseSuffix') || typeof parsed.baseSuffix !== 'string' || parsed.baseSuffix.length === 0) {
    return false;
  }
  if (!hasOwn('baseSha256') || typeof parsed.baseSha256 !== 'string' || !SHA256_HEX_RE.test(parsed.baseSha256)) {
    return false;
  }
  const totalBytes = Buffer.byteLength(parsed.basePrefix, 'utf8') + Buffer.byteLength(parsed.baseSuffix, 'utf8');
  if (totalBytes <= 0 || totalBytes > BUNDLE_CACHE_MAX_EXPR_BYTES) return false;
  if (!parsed.baseSuffix.includes(JSON.stringify(parsed.codeHash))) return false;
  if (!skipSha256 && sha256Text(`${parsed.basePrefix}\0${parsed.baseSuffix}`) !== parsed.baseSha256) return false;
  return true;
}

function isValidBundleCacheEntry(entry, baseTemplate) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (!baseTemplate) return false;
  const hasOwn = (k) => Object.prototype.hasOwnProperty.call(entry, k);
  if (!hasOwn('configHash') || typeof entry.configHash !== 'string' || !SHA256_HEX_RE.test(entry.configHash)) {
    return false;
  }
  if (
    !hasOwn('codeHash') ||
    typeof entry.codeHash !== 'string' ||
    !CODE_HASH_RE.test(entry.codeHash) ||
    entry.codeHash !== baseTemplate.codeHash
  ) {
    return false;
  }
  if (!hasOwn('exprSha256') || typeof entry.exprSha256 !== 'string' || !SHA256_HEX_RE.test(entry.exprSha256)) {
    return false;
  }
  if (!hasOwn('bootCfgJson') || typeof entry.bootCfgJson !== 'string' || entry.bootCfgJson.length === 0) {
    return false;
  }
  const cfgBytes = Buffer.byteLength(entry.bootCfgJson, 'utf8');
  if (cfgBytes <= 0 || cfgBytes > BUNDLE_CACHE_MAX_BOOTCFG_BYTES) return false;
  if (!entry.bootCfgJson.includes(`"codeHash":${JSON.stringify(entry.codeHash)}`)) return false;
  const assembled = baseTemplate.basePrefix + entry.bootCfgJson + baseTemplate.baseSuffix;
  const exprBytes = Buffer.byteLength(assembled, 'utf8');
  if (exprBytes <= 0 || exprBytes > BUNDLE_CACHE_MAX_EXPR_BYTES) return false;
  if (sha256Text(assembled) !== entry.exprSha256) return false;
  return true;
}

function isValidChannelCacheEntry(channelName, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const hasOwn = (k) => Object.prototype.hasOwnProperty.call(entry, k);
  if (!hasOwn('sourceHash') || typeof entry.sourceHash !== 'string' || !SHA256_HEX_RE.test(entry.sourceHash)) {
    return false;
  }
  if (!hasOwn('codeHash') || typeof entry.codeHash !== 'string' || !CODE_HASH_RE.test(entry.codeHash)) {
    return false;
  }
  if (!hasOwn('payloadSha256') || typeof entry.payloadSha256 !== 'string' || !SHA256_HEX_RE.test(entry.payloadSha256)) {
    return false;
  }
  const format = resolveChannelCacheFormat(channelName);
  if (format === 'minCode') {
    if (!hasOwn('minCode') || typeof entry.minCode !== 'string' || entry.minCode.length === 0) return false;
    if (Buffer.byteLength(entry.minCode, 'utf8') > CHANNEL_CACHE_MAX_PAYLOAD_BYTES) return false;
    if (channelName === 'sidebar' && /setPrefValues?/i.test(entry.minCode)) return false;
    if (computeHash(entry.minCode) !== entry.codeHash) return false;
    return sha256Text(`${entry.codeHash}\0${entry.minCode}`) === entry.payloadSha256;
  }
  if (format === 'runtimeAndDict') {
    if (!hasOwn('minRuntime') || typeof entry.minRuntime !== 'string' || entry.minRuntime.length === 0) return false;
    if (!hasOwn('dictRaw') || typeof entry.dictRaw !== 'string' || entry.dictRaw.length === 0) return false;
    const totalBytes = Buffer.byteLength(entry.minRuntime, 'utf8') + Buffer.byteLength(entry.dictRaw, 'utf8');
    if (totalBytes > CHANNEL_CACHE_MAX_PAYLOAD_BYTES) return false;
    if (computeHash(`${entry.minRuntime}:${entry.dictRaw}`) !== entry.codeHash) return false;
    return sha256Text(`${entry.codeHash}\0${entry.minRuntime}\0${entry.dictRaw}`) === entry.payloadSha256;
  }
  if (format === 'clientAndUi') {
    if (!hasOwn('minClient') || typeof entry.minClient !== 'string' || entry.minClient.length === 0) return false;
    if (!hasOwn('minSettingsUi') || typeof entry.minSettingsUi !== 'string' || entry.minSettingsUi.length === 0) return false;
    const totalBytes = Buffer.byteLength(entry.minClient, 'utf8') + Buffer.byteLength(entry.minSettingsUi, 'utf8');
    if (totalBytes > CHANNEL_CACHE_MAX_PAYLOAD_BYTES) return false;
    if (computeHash(`${entry.minClient}\n${entry.minSettingsUi}`) !== entry.codeHash) return false;
    return sha256Text(`${entry.codeHash}\0${entry.minClient}\0${entry.minSettingsUi}`) === entry.payloadSha256;
  }
  if (format === 'minRuntime') {
    if (!hasOwn('minRuntime') || typeof entry.minRuntime !== 'string' || entry.minRuntime.length === 0) return false;
    if (Buffer.byteLength(entry.minRuntime, 'utf8') > CHANNEL_CACHE_MAX_PAYLOAD_BYTES) return false;
    if (computeHash(entry.minRuntime) !== entry.codeHash) return false;
    return sha256Text(`${entry.codeHash}\0${entry.minRuntime}`) === entry.payloadSha256;
  }
  return false;
}

function extractValidChannelsMap(rawChannels) {
  const out = {};
  if (!rawChannels || typeof rawChannels !== 'object' || Array.isArray(rawChannels)) {
    return out;
  }
  const validNames = [...CHANNEL_CACHE_NAMES, ...Object.keys(CHANNEL_SUB_SLOTS)];
  for (const name of validNames) {
    if (!Object.prototype.hasOwnProperty.call(rawChannels, name)) continue;
    const ent = rawChannels[name];
    if (isValidChannelCacheEntry(name, ent)) {
      out[name] = ent;
    }
  }
  return out;
}

module.exports = {
  BUNDLE_CACHE_SCHEMA_VERSION,
  BUNDLE_CACHE_FILENAME,
  BUNDLE_CACHE_SHARD_DIRNAME,
  BUNDLE_CACHE_MAX_ENTRIES,
  BUNDLE_CACHE_MAX_FILE_BYTES,
  BUNDLE_CACHE_MAX_EXPR_BYTES,
  BUNDLE_CACHE_MAX_BOOTCFG_BYTES,
  CHANNEL_CACHE_MAX_PAYLOAD_BYTES,
  CHANNEL_CACHE_NAMES,
  CHANNEL_SUB_SLOTS,
  SHA256_HEX_RE,
  CODE_HASH_RE,
  BUNDLE_CACHE_ROOT_MEM_TTL_MS,
  resolveBundleCachePathOption,
  isShardedCachePath,
  resolveChannelCacheFormat,
  resolveChannelShardFilename,
  resolveChannelStatsKey,
  computeSourceStatsBinding,
  isValidSourceStatsArray,
  freezeBundleCacheRoot,
  isValidBundleBaseTemplate,
  isValidBundleCacheEntry,
  isValidChannelCacheEntry,
  extractValidChannelsMap,
};
