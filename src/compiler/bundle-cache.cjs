// .bundle-cache.json / 分片 .bundle-cache/ v2 高层编排：热模板复用、stat 快速验签、多通道磁盘缓存、延迟批量刷盘与 buildInjectExpression
'use strict';

const path = require('path');
const { sha256Text, computeHash } = require('../utils/fs-safe.cjs');
const { SETTING_BINDING, reconcileConfigAliases } = require('../config/schema.cjs');
const {
  BUNDLE_CACHE_SCHEMA_VERSION,
  BUNDLE_CACHE_FILENAME,
  BUNDLE_CACHE_SHARD_DIRNAME,
  BUNDLE_CACHE_MAX_ENTRIES,
  CHANNEL_CACHE_NAMES,
  CHANNEL_SUB_SLOTS,
  SHA256_HEX_RE,
  resolveBundleCachePathOption,
  isShardedCachePath,
  resolveChannelStatsKey,
  isValidBundleBaseTemplate,
  isValidBundleCacheEntry,
  extractValidChannelsMap,
} = require('./cache-validate.cjs');
const { createBundleCacheIo } = require('./bundle-cache-io.cjs');

function createInitialBundleCacheStats() {
  const channelHitsByName = {};
  for (const name of CHANNEL_CACHE_NAMES) {
    channelHitsByName[name] = 0;
  }
  return {
    diskHits: 0,
    diskBaseHits: 0,
    diskFastStatHits: 0,
    diskMisses: 0,
    diskWrites: 0,
    diskWriteFailures: 0,
    diskReadFallbacks: 0,
    compileUnifiedRuns: 0,
    mangledUnitRuns: 0,
    cssMinifyRuns: 0,
    deferredExprHashRuns: 0,
    channelDiskHits: 0,
    channelFastStatHits: 0,
    channelDiskMisses: 0,
    channelCompileRuns: 0,
    channelHitsByName,
    lastOutcome: 'none',
    lastCachePath: null,
  };
}

function createBundleCache({
  rootDir = path.resolve(__dirname, '..', '..'),
  pluginVersion,
  stats = createInitialBundleCacheStats(),
  readConfig,
  compiler,
  templates,
}) {
  const io = createBundleCacheIo({ rootDir, pluginVersion, templates });

  let _diskCacheLastSource = { sourceHash: '', codeHash: '' };
  let _warmBaseCache = {
    statSig: '',
    sourceHash: '',
    codeHash: '',
    basePrefix: '',
    baseSuffix: '',
    baseSha256: '',
  };
  let _pendingDiskCachePersist = null;
  const _pendingChannelCacheWrites = new Map();
  let _lastCompiledSourceHash = '';
  const _channelMemCaches = new Map();

  function getChannelMemCache(name) {
    return _channelMemCaches.get(name) || null;
  }

  function setChannelMemCache(name, value) {
    _channelMemCaches.set(name, value);
  }

  function getBundleCacheStats() {
    return {
      ...stats,
      channelHitsByName: { ...stats.channelHitsByName },
    };
  }

  function resetBundleCacheStats() {
    const fresh = createInitialBundleCacheStats();
    Object.assign(stats, fresh);
    for (const mem of _channelMemCaches.values()) {
      try { mem.cachedPaths?.clear?.(); } catch {}
    }
    io.invalidateBundleCacheRootCache();
  }

  function queuePendingChannelCacheWrite(cachePath, channelName, record, opts = null) {
    if (!cachePath || !channelName || !record) return;
    const resolved = path.resolve(cachePath);
    let bucket = _pendingChannelCacheWrites.get(resolved);
    if (!bucket) {
      bucket = { records: {}, opts };
      _pendingChannelCacheWrites.set(resolved, bucket);
    }
    bucket.records[channelName] = record;
    if (opts && opts.sharded !== undefined) bucket.opts = opts;
  }

  function persistChannelsOnlySync(cachePath, channelUpdates, opts = null) {
    if (!cachePath || !channelUpdates || typeof channelUpdates !== 'object') return false;
    const resolved = path.resolve(cachePath);
    const validUpdates = extractValidChannelsMap(channelUpdates);
    const keys = Object.keys(validUpdates);
    if (keys.length === 0) return false;

    if (isShardedCachePath(resolved, opts)) {
      let anyOk = false;
      for (const name of keys) {
        if (io.writeChannelShardAtomicSync(resolved, name, validUpdates[name], opts)) {
          stats.diskWrites += 1;
          anyOk = true;
        } else {
          stats.diskWriteFailures += 1;
        }
      }
      return anyOk;
    }

    const existing = io.readValidBundleCacheRootSync(resolved, false, opts);
    const mergedChannels = {
      ...extractValidChannelsMap(existing?.channels),
      ...validUpdates,
    };
    if (Object.keys(mergedChannels).length === 0) return false;
    const payload =
      existing &&
      typeof existing.sourceHash === 'string' &&
      SHA256_HEX_RE.test(existing.sourceHash) &&
      Array.isArray(existing.entries) &&
      isValidBundleBaseTemplate(existing)
        ? {
            schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
            pluginVersion,
            sourceHash: existing.sourceHash,
            ...(existing.sourceStats ? { sourceStats: existing.sourceStats } : {}),
            ...(existing.statsBindingSha256 ? { statsBindingSha256: existing.statsBindingSha256 } : {}),
            codeHash: existing.codeHash,
            basePrefix: existing.basePrefix,
            baseSuffix: existing.baseSuffix,
            baseSha256: existing.baseSha256,
            entries: existing.entries,
            channels: mergedChannels,
          }
        : {
            schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
            pluginVersion,
            channels: mergedChannels,
          };
    if (io.writeBundleCacheAtomicSync(resolved, payload, opts)) {
      stats.diskWrites += 1;
      return true;
    }
    stats.diskWriteFailures += 1;
    return false;
  }

  function resolveChannelAssetsWithDiskCache({
    channelName,
    memCache = null,
    setMemCache = null,
    sig,
    fileEntries,
    extraTag = '',
    opts = null,
    compileFn,
    toCacheEntry,
    fromCacheEntry,
  }) {
    const curMem = memCache || getChannelMemCache(channelName);
    const updateMem = (nextVal) => {
      setChannelMemCache(channelName, nextVal);
      if (typeof setMemCache === 'function') setMemCache(nextVal);
    };
    const cachePath = resolveBundleCachePathOption(opts);
    const deferCacheWrite = Boolean(opts && opts.deferCacheWrite === true);
    if (!cachePath) {
      if (curMem && curMem.sig === sig && curMem.codeHash) {
        return curMem;
      }
      stats.channelCompileRuns += 1;
      const compiled = compileFn();
      const nextMem = { ...compiled, sig, sourceHash: '', cachedPaths: new Set() };
      updateMem(nextMem);
      return nextMem;
    }

    const resolvedCachePath = path.resolve(cachePath);
    stats.lastCachePath = resolvedCachePath;
    let computedSourceHash = '';
    const ensureSourceHash = () => {
      if (!computedSourceHash) {
        computedSourceHash = io.computeChannelSourceHash(channelName, fileEntries, extraTag);
      }
      return computedSourceHash;
    };

    const diskHit = io.tryReadChannelCacheHitSync(resolvedCachePath, channelName, ensureSourceHash, {
      fileEntries,
      extraTag,
      opts,
    });
    if (diskHit.hit) {
      const hitSourceHash = diskHit.sourceHash || computedSourceHash;
      if (
        curMem &&
        curMem.sourceHash === hitSourceHash &&
        curMem.cachedPaths &&
        curMem.cachedPaths.has(resolvedCachePath)
      ) {
        return curMem;
      }
      stats.channelDiskHits += 1;
      if (diskHit.usedFastStat) stats.channelFastStatHits += 1;
      const statsKey = resolveChannelStatsKey(channelName);
      stats.channelHitsByName[statsKey] = (stats.channelHitsByName[statsKey] || 0) + 1;
      const restored = fromCacheEntry(diskHit.entry);
      const cachedPaths =
        curMem && curMem.sourceHash === hitSourceHash && curMem.cachedPaths
          ? curMem.cachedPaths
          : new Set();
      cachedPaths.add(resolvedCachePath);
      const nextMem = { ...restored, sig, sourceHash: hitSourceHash, cachedPaths };
      updateMem(nextMem);
      return nextMem;
    }

    const sourceHash = ensureSourceHash();
    if (
      curMem &&
      curMem.sourceHash === sourceHash &&
      curMem.cachedPaths &&
      curMem.cachedPaths.has(resolvedCachePath)
    ) {
      return curMem;
    }

    stats.channelDiskMisses += 1;
    let assets;
    if (curMem && curMem.sourceHash === sourceHash && curMem.codeHash) {
      assets = curMem;
    } else {
      stats.channelCompileRuns += 1;
      assets = compileFn();
    }
    const baseRecord = toCacheEntry(assets, sourceHash);
    const statMeta = io.getChannelSourceStatsMeta(channelName, fileEntries, extraTag, sourceHash);
    const record = statMeta ? { ...baseRecord, ...statMeta } : baseRecord;
    const cachedPaths =
      curMem && curMem.sourceHash === sourceHash && curMem.cachedPaths
        ? curMem.cachedPaths
        : new Set();
    if (deferCacheWrite) {
      queuePendingChannelCacheWrite(resolvedCachePath, channelName, record, opts);
    } else if (persistChannelsOnlySync(resolvedCachePath, { [channelName]: record }, opts)) {
      cachedPaths.add(resolvedCachePath);
    }
    const nextMem = { ...assets, sig, sourceHash, cachedPaths };
    updateMem(nextMem);
    return nextMem;
  }

  function persistBundleCacheRecordSync(
    cachePath,
    sourceHash,
    baseForDisk,
    newEntry,
    existingRawEntries = null,
    extraChannels = null,
    opts = null
  ) {
    if (!cachePath || !sourceHash || !baseForDisk || !newEntry) return false;
    const resolved = path.resolve(cachePath);
    const sharded = isShardedCachePath(resolved, opts);
    let rawEntries = Array.isArray(existingRawEntries) ? existingRawEntries : null;
    let existingChannels = {};
    const existingRoot = io.readValidBundleCacheRootSync(resolved, false, opts);
    if (existingRoot) {
      if (!sharded) existingChannels = extractValidChannelsMap(existingRoot.channels);
      if (rawEntries === null && existingRoot.sourceHash === sourceHash && Array.isArray(existingRoot.entries)) {
        rawEntries = existingRoot.entries;
      }
    }
    if (rawEntries === null) {
      rawEntries = [];
    }
    const retained = [];
    const seen = new Set([newEntry.configHash]);
    for (const rawEnt of rawEntries) {
      if (retained.length >= BUNDLE_CACHE_MAX_ENTRIES - 1) break;
      if (
        rawEnt &&
        typeof rawEnt === 'object' &&
        !Array.isArray(rawEnt) &&
        Object.prototype.hasOwnProperty.call(rawEnt, 'configHash') &&
        typeof rawEnt.configHash === 'string' &&
        !seen.has(rawEnt.configHash) &&
        isValidBundleCacheEntry(rawEnt, baseForDisk)
      ) {
        seen.add(rawEnt.configHash);
        retained.push({
          configHash: rawEnt.configHash,
          ...(typeof rawEnt.fastConfigKey === 'string' && SHA256_HEX_RE.test(rawEnt.fastConfigKey)
            ? { fastConfigKey: rawEnt.fastConfigKey }
            : {}),
          codeHash: rawEnt.codeHash,
          bootCfgJson: rawEnt.bootCfgJson,
          exprSha256: rawEnt.exprSha256,
          updatedAt: Number.isFinite(Number(rawEnt.updatedAt)) ? Number(rawEnt.updatedAt) : 0,
        });
      }
    }
    const pendingBucket = _pendingChannelCacheWrites.get(resolved) || null;
    if (pendingBucket) {
      _pendingChannelCacheWrites.delete(resolved);
    }
    const pendingForPath = pendingBucket ? pendingBucket.records : null;
    const statMeta = io.getBundleSourceStatsMeta(sourceHash);

    if (sharded) {
      const ch1Payload = {
        schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
        pluginVersion,
        sourceHash,
        ...(statMeta ? statMeta : {}),
        codeHash: baseForDisk.codeHash,
        basePrefix: baseForDisk.basePrefix,
        baseSuffix: baseForDisk.baseSuffix,
        baseSha256: baseForDisk.baseSha256,
        entries: [newEntry, ...retained],
      };
      let ch1Ok = false;
      if (io.writeBundleCacheAtomicSync(resolved, ch1Payload, opts)) {
        stats.diskWrites += 1;
        ch1Ok = true;
      } else {
        stats.diskWriteFailures += 1;
      }
      const shardChannels = {
        ...extractValidChannelsMap(pendingForPath),
        ...extractValidChannelsMap(extraChannels),
      };
      if (Object.keys(shardChannels).length > 0) {
        persistChannelsOnlySync(resolved, shardChannels, opts);
      }
      return ch1Ok;
    }

    const mergedChannels = {
      ...existingChannels,
      ...extractValidChannelsMap(pendingForPath),
      ...extractValidChannelsMap(extraChannels),
    };
    const payload = {
      schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
      pluginVersion,
      sourceHash,
      ...(statMeta ? statMeta : {}),
      codeHash: baseForDisk.codeHash,
      basePrefix: baseForDisk.basePrefix,
      baseSuffix: baseForDisk.baseSuffix,
      baseSha256: baseForDisk.baseSha256,
      entries: [newEntry, ...retained],
      ...(Object.keys(mergedChannels).length > 0 ? { channels: mergedChannels } : {}),
    };
    if (io.writeBundleCacheAtomicSync(resolved, payload, opts)) {
      stats.diskWrites += 1;
      return true;
    }
    stats.diskWriteFailures += 1;
    return false;
  }

  function markChannelCachedOnPath(cachePath, chMap) {
    if (!cachePath || !chMap || typeof chMap !== 'object') return;
    const resolved = path.resolve(cachePath);
    const allNames = [...CHANNEL_CACHE_NAMES, ...Object.keys(CHANNEL_SUB_SLOTS)];
    for (const name of allNames) {
      const rec = chMap[name];
      const mem = _channelMemCaches.get(name);
      if (rec && mem && mem.sourceHash && mem.sourceHash === rec.sourceHash && mem.cachedPaths) {
        mem.cachedPaths.add(resolved);
      }
    }
  }

  function flushPendingBundleCache() {
    const pending = _pendingDiskCachePersist;
    _pendingDiskCachePersist = null;
    const pendingChannelsSnapshot = new Map(_pendingChannelCacheWrites);
    _pendingChannelCacheWrites.clear();

    let anyWritten = false;
    if (pending) {
      const resolved = path.resolve(pending.cachePath);
      const matchedBucket = pendingChannelsSnapshot.get(resolved) || null;
      if (matchedBucket) {
        pendingChannelsSnapshot.delete(resolved);
      }
      const matchedChannels = matchedBucket ? matchedBucket.records : null;
      if (!pending.newEntry.exprSha256) {
        const exprText =
          typeof pending.deferredExpr === 'string'
            ? pending.deferredExpr
            : pending.baseForDisk.basePrefix + pending.newEntry.bootCfgJson + pending.baseForDisk.baseSuffix;
        pending.newEntry.exprSha256 = sha256Text(exprText);
        stats.deferredExprHashRuns += 1;
      }
      if (
        persistBundleCacheRecordSync(
          resolved,
          pending.sourceHash,
          pending.baseForDisk,
          pending.newEntry,
          null,
          matchedChannels,
          pending.opts || matchedBucket?.opts || null
        )
      ) {
        markChannelCachedOnPath(resolved, matchedChannels);
        anyWritten = true;
      }
    }

    for (const [chPath, bucket] of pendingChannelsSnapshot.entries()) {
      const chMap = bucket?.records || null;
      if (chMap && persistChannelsOnlySync(chPath, chMap, bucket?.opts || null)) {
        markChannelCachedOnPath(chPath, chMap);
        anyWritten = true;
      }
    }
    return anyWritten;
  }

  function resolveCurrentBundleCodeHash() {
    if (compiler.hasCompiledUnifiedBundle()) {
      return computeHash(compiler.readRuntimeBundle());
    }
    if (_warmBaseCache.codeHash && _warmBaseCache.statSig) {
      try {
        if (io.getBundleSourceStatSig() === _warmBaseCache.statSig) {
          return _warmBaseCache.codeHash;
        }
      } catch {}
    }
    if (_diskCacheLastSource.sourceHash && _diskCacheLastSource.codeHash) {
      try {
        if (io.computeBundleSourceHash() === _diskCacheLastSource.sourceHash) {
          return _diskCacheLastSource.codeHash;
        }
      } catch {}
    }
    return computeHash(compiler.readRuntimeBundle());
  }

  function buildInjectExpression(customConfig, opts = null) {
    const config = customConfig ? reconcileConfigAliases(customConfig) : readConfig();
    let _lazyUiSlice = undefined;
    const getUiSlice = () => {
      if (_lazyUiSlice === undefined) _lazyUiSlice = templates.buildRuntimeUiSlicePayload(config);
      return _lazyUiSlice;
    };
    const buildBootCfgJson = (codeHash) => {
      const uiSlice = getUiSlice();
      return JSON.stringify({
        ...config,
        ...(uiSlice ? { __uiSlice: uiSlice } : {}),
        binding: SETTING_BINDING,
        codeHash,
        __fromFile: true,
      });
    };
    const cachePath = resolveBundleCachePathOption(opts);
    const deferCacheWrite = Boolean(opts && opts.deferCacheWrite === true);

    if (cachePath && deferCacheWrite && _warmBaseCache.basePrefix && _warmBaseCache.statSig) {
      try {
        if (io.getBundleSourceStatSig() === _warmBaseCache.statSig) {
          const codeHash = _warmBaseCache.codeHash;
          const bootCfgJson = buildBootCfgJson(codeHash);
          const expr = _warmBaseCache.basePrefix + bootCfgJson + _warmBaseCache.baseSuffix;
          const configHash = io.computeBundleConfigHash(config, getUiSlice());
          stats.diskBaseHits += 1;
          stats.lastOutcome = 'warm-base-hit';
          stats.lastCachePath = cachePath;
          _pendingDiskCachePersist = {
            cachePath,
            opts,
            sourceHash: _warmBaseCache.sourceHash,
            baseForDisk: {
              codeHash,
              basePrefix: _warmBaseCache.basePrefix,
              baseSuffix: _warmBaseCache.baseSuffix,
              baseSha256: _warmBaseCache.baseSha256,
            },
            newEntry: {
              configHash,
              codeHash,
              bootCfgJson,
              exprSha256: null,
              updatedAt: Date.now(),
            },
            deferredExpr: expr,
          };
          return expr;
        }
      } catch {}
    }

    let sourceHash = '';
    let configHash = '';
    let fastConfigKey = '';
    let existingRawEntries = [];
    let cachedBaseTemplate = null;
    let forceInvalidateMem = false;

    if (cachePath) {
      stats.lastCachePath = cachePath;
      try {
        fastConfigKey = io.computeBundleFastConfigKey(config);
        const ensureConfigHash = () => {
          if (!configHash) configHash = io.computeBundleConfigHash(config, getUiSlice());
          return configHash;
        };
        const ensureSourceHash = () => {
          if (!sourceHash) sourceHash = io.computeBundleSourceHash();
          return sourceHash;
        };
        const lookup = io.tryReadBundleCacheHitSync(
          cachePath,
          ensureSourceHash,
          ensureConfigHash,
          opts && typeof opts === 'object' ? { ...opts, fastConfigKey } : { fastConfigKey }
        );
        if (lookup.sourceHash) sourceHash = lookup.sourceHash;
        if (lookup.configHash) configHash = lookup.configHash;
        if (lookup.hit) {
          stats.diskHits += 1;
          if (lookup.usedFastStat) stats.diskFastStatHits += 1;
          stats.lastOutcome = 'disk-hit';
          _diskCacheLastSource = { sourceHash, codeHash: lookup.codeHash };
          if (lookup.baseTemplate) {
            try {
              _warmBaseCache = {
                statSig: lookup.statSig || io.getBundleSourceStatSig(),
                sourceHash,
                ...lookup.baseTemplate,
              };
            } catch {}
          }
          return lookup.expr;
        }
        if (!sourceHash) sourceHash = ensureSourceHash();
        if (!configHash) configHash = ensureConfigHash();
        stats.diskMisses += 1;
        if (lookup.reason === 'source-hash-mismatch') {
          forceInvalidateMem = true;
        } else if (lookup.reason !== 'missing' && lookup.reason !== 'config-miss') {
          stats.diskReadFallbacks += 1;
        }
        if (Array.isArray(lookup.existingEntries)) {
          existingRawEntries = lookup.existingEntries;
        }
        if (lookup.reason === 'config-miss' && lookup.baseTemplate) {
          cachedBaseTemplate = lookup.baseTemplate;
        }
      } catch {
        stats.diskMisses += 1;
        stats.diskReadFallbacks += 1;
        sourceHash = '';
        configHash = '';
        existingRawEntries = [];
        cachedBaseTemplate = null;
      }
    }

    let codeHash = '';
    let bootCfgJson = '';
    let expr = '';
    let baseForDisk = null;

    if (cachedBaseTemplate) {
      codeHash = cachedBaseTemplate.codeHash;
      bootCfgJson = buildBootCfgJson(codeHash);
      expr = cachedBaseTemplate.basePrefix + bootCfgJson + cachedBaseTemplate.baseSuffix;
      baseForDisk = cachedBaseTemplate;
      stats.diskBaseHits += 1;
      stats.lastOutcome = 'disk-base-hit';
    } else {
      if (forceInvalidateMem || (sourceHash && _lastCompiledSourceHash && sourceHash !== _lastCompiledSourceHash)) {
        compiler.clearMemCaches();
      }

      const compiledBase = compiler.compileBaseInjectTemplate();
      codeHash = compiledBase.codeHash;
      bootCfgJson = buildBootCfgJson(codeHash);
      if (compiledBase.basePrefix !== null && compiledBase.baseSuffix !== null) {
        expr = compiledBase.basePrefix + bootCfgJson + compiledBase.baseSuffix;
        baseForDisk = {
          codeHash,
          basePrefix: compiledBase.basePrefix,
          baseSuffix: compiledBase.baseSuffix,
          baseSha256: compiledBase.baseSha256,
        };
      } else {
        expr = templates.getInjectWrapperTemplate()
          .replace('__AG_INJ_CSS__', () => compiledBase.packedCss)
          .replace('__AG_INJ_CSSHASH__', () => compiledBase.cssHashJson)
          .replace('__AG_INJ_BOOTCFG__', () => bootCfgJson)
          .replace('__AG_INJ_CODEHASH__', () => compiledBase.codeHashJson)
          .replace('__AG_INJ_BUNDLE__();', () => compiledBase.bundle);
      }
      if (sourceHash) {
        _lastCompiledSourceHash = sourceHash;
      }
      stats.lastOutcome = 'compiled';
    }

    if (sourceHash && codeHash) {
      _diskCacheLastSource = { sourceHash, codeHash };
      if (baseForDisk) {
        try {
          _warmBaseCache = {
            statSig: io.getBundleSourceStatSig(),
            sourceHash,
            ...baseForDisk,
          };
        } catch {}
      }
    }

    if (cachePath && sourceHash && configHash && baseForDisk) {
      if (deferCacheWrite) {
        _pendingDiskCachePersist = {
          cachePath,
          opts,
          sourceHash,
          baseForDisk,
          newEntry: {
            configHash,
            ...(fastConfigKey ? { fastConfigKey } : {}),
            codeHash,
            bootCfgJson,
            exprSha256: null,
            updatedAt: Date.now(),
          },
          deferredExpr: expr,
        };
      } else {
        const newEntry = {
          configHash,
          ...(fastConfigKey ? { fastConfigKey } : {}),
          codeHash,
          bootCfgJson,
          exprSha256: sha256Text(expr),
          updatedAt: Date.now(),
        };
        _pendingDiskCachePersist = null;
        persistBundleCacheRecordSync(cachePath, sourceHash, baseForDisk, newEntry, existingRawEntries, null, opts);
      }
    }

    return expr;
  }

  return {
    BUNDLE_CACHE_SCHEMA_VERSION,
    BUNDLE_CACHE_FILENAME,
    BUNDLE_CACHE_SHARD_DIRNAME,
    BUNDLE_CACHE_MAX_ENTRIES,
    getChannelMemCache,
    setChannelMemCache,
    computeBundleSourceHash: io.computeBundleSourceHash,
    computeBundleConfigHash: io.computeBundleConfigHash,
    getBundleCacheStats,
    resetBundleCacheStats,
    resolveChannelAssetsWithDiskCache,
    flushPendingBundleCache,
    resolveCurrentBundleCodeHash,
    buildInjectExpression,
  };
}

module.exports = {
  BUNDLE_CACHE_SCHEMA_VERSION,
  BUNDLE_CACHE_FILENAME,
  BUNDLE_CACHE_SHARD_DIRNAME,
  BUNDLE_CACHE_MAX_ENTRIES,
  createInitialBundleCacheStats,
  createBundleCache,
};
