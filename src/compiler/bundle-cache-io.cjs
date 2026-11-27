// .bundle-cache.json / 分片 .bundle-cache/ v2 底层磁盘 I/O、stat 快速验签、SHA-256 源指纹与单读根缓存
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  IS_WIN,
  isSymlinkPathSync,
  getFileSig,
} = require('../utils/fs-safe.cjs');
const {
  STYLE_ID,
  LEGACY_STYLE_ID,
  SETTING_BINDING,
} = require('../config/schema.cjs');
const { RUNTIME_PARTS } = require('./part-preprocess.cjs');
const {
  BUNDLE_CACHE_SCHEMA_VERSION,
  BUNDLE_CACHE_FILENAME,
  BUNDLE_CACHE_MAX_FILE_BYTES,
  SHA256_HEX_RE,
  BUNDLE_CACHE_ROOT_MEM_TTL_MS,
  isShardedCachePath,
  resolveChannelShardFilename,
  computeSourceStatsBinding,
  isValidSourceStatsArray,
  freezeBundleCacheRoot,
  isValidBundleBaseTemplate,
  isValidBundleCacheEntry,
  isValidChannelCacheEntry,
} = require('./cache-validate.cjs');

// 收集所有会影响打包/通道输出的自源模块（cdp.js + 工具/配置真相源 + src/compiler + src/channels）
function listSelfFingerprintFiles(rootDir) {
  const files = [{ rel: 'cdp.js', fullPath: path.join(rootDir, 'cdp.js'), optional: false }];
  const fixedSrc = [
    'src/utils/fs-safe.cjs',
    'src/config/schema.cjs',
  ];
  for (const rel of fixedSrc) {
    files.push({ rel, fullPath: path.join(rootDir, ...rel.split('/')), optional: true });
  }
  for (const subDir of ['src/compiler', 'src/channels']) {
    const absDir = path.join(rootDir, ...subDir.split('/'));
    try {
      const names = fs.readdirSync(absDir).filter((n) => n.endsWith('.cjs') || n.endsWith('.mjs')).sort();
      for (const name of names) {
        files.push({ rel: `${subDir}/${name}`, fullPath: path.join(absDir, name), optional: true });
      }
    } catch {}
  }
  return files;
}

function collectFilesStatTuples(fileSpecs) {
  const out = [];
  for (const item of fileSpecs) {
    if (!item || !item.fullPath) return null;
    try {
      const st = fs.statSync(item.fullPath);
      out.push([item.rel, st.mtimeMs, st.size, st.ctimeMs]);
    } catch {
      if (item.optional) out.push([item.rel, -1, -1, -1]);
      else return null;
    }
  }
  return out;
}

function matchesCachedStatTuples(cachedStats, fileSpecs) {
  if (!isValidSourceStatsArray(cachedStats) || cachedStats.length !== fileSpecs.length) {
    return { ok: false, statSig: '' };
  }
  const sigParts = [];
  for (let i = 0; i < fileSpecs.length; i++) {
    const item = fileSpecs[i];
    const exp = cachedStats[i];
    if (!item || !item.fullPath || exp[0] !== item.rel) return { ok: false, statSig: '' };
    try {
      const st = fs.statSync(item.fullPath);
      if (st.mtimeMs !== exp[1] || st.size !== exp[2] || st.ctimeMs !== exp[3]) return { ok: false, statSig: '' };
      sigParts.push(`${item.rel}:${st.mtimeMs}:${st.size}`);
    } catch {
      if (!item.optional || exp[1] !== -1 || exp[2] !== -1 || exp[3] !== -1) return { ok: false, statSig: '' };
      sigParts.push(`${item.rel}:MISSING`);
    }
  }
  return { ok: true, statSig: sigParts.join(';') };
}

function createBundleCacheIo({ rootDir, pluginVersion, templates }) {
  let _cdpSelfHashCache = { sig: '', hash: '' };
  let _selfFilesDirCache = { compilerMtime: -1, channelsMtime: -1, files: null };
  let _bundleCacheRootCache = {
    resolved: '',
    sig: '',
    cachedAt: 0,
    parsed: null,
  };
  const _shardRootCache = new Map();

  function getCachedSelfFingerprintFiles() {
    const compDir = path.join(rootDir, 'src', 'compiler');
    const chanDir = path.join(rootDir, 'src', 'channels');
    let cMtime = -1;
    let chMtime = -1;
    try { cMtime = fs.statSync(compDir).mtimeMs; } catch {}
    try { chMtime = fs.statSync(chanDir).mtimeMs; } catch {}
    if (
      _selfFilesDirCache.files &&
      _selfFilesDirCache.compilerMtime === cMtime &&
      _selfFilesDirCache.channelsMtime === chMtime
    ) {
      return _selfFilesDirCache.files;
    }
    const files = listSelfFingerprintFiles(rootDir);
    _selfFilesDirCache = { compilerMtime: cMtime, channelsMtime: chMtime, files };
    return files;
  }

  function invalidateBundleCacheRootCache(targetPath = null) {
    if (!targetPath) {
      _bundleCacheRootCache = { resolved: '', sig: '', cachedAt: 0, parsed: null };
      _shardRootCache.clear();
      return;
    }
    const resolved = path.resolve(targetPath);
    if (_bundleCacheRootCache.resolved === resolved) {
      _bundleCacheRootCache = { resolved: '', sig: '', cachedAt: 0, parsed: null };
    }
    _shardRootCache.delete(resolved);
    const prefix = resolved + path.sep;
    for (const k of _shardRootCache.keys()) {
      if (k === resolved || k.startsWith(prefix)) _shardRootCache.delete(k);
    }
  }

  function getBundleSourceFiles() {
    const files = [
      ...getCachedSelfFingerprintFiles(),
      { rel: 'style.css', fullPath: path.join(rootDir, 'style.css'), optional: false },
      // i18n-locales.js 活跃语言迷你切片会打入 Channel 1 bootCfg.__uiSlice，纳入源哈希确保缓存强一致
      { rel: 'i18n-locales.js', fullPath: path.join(rootDir, 'i18n-locales.js'), optional: true },
    ];
    for (const partName of RUNTIME_PARTS) {
      files.push({ rel: partName, fullPath: path.join(rootDir, partName), optional: false });
      if (partName === 'vendor/effort-slider/slider-coexist.js') {
        files.push({
          rel: 'vendor/effort-slider/upstream-client.js',
          fullPath: path.join(rootDir, 'vendor', 'effort-slider', 'upstream-client.js'),
          optional: true,
        });
      }
    }
    return files;
  }

  function getBundleSourceStatsMeta(sourceHash) {
    const stats = collectFilesStatTuples(getBundleSourceFiles());
    if (!stats || !sourceHash || !SHA256_HEX_RE.test(sourceHash)) return null;
    return {
      sourceStats: stats,
      statsBindingSha256: computeSourceStatsBinding(pluginVersion, 'ch1', sourceHash, stats),
    };
  }

  function getChannelStatFileSpecs(fileEntries) {
    const selfFiles = getCachedSelfFingerprintFiles();
    const specs = [...selfFiles];
    for (const item of fileEntries || []) {
      const fullPath =
        item && typeof item.fullPath === 'string' && item.fullPath
          ? item.fullPath
          : item && typeof item.rel === 'string' && item.rel
            ? path.join(rootDir, ...item.rel.split('/'))
            : '';
      if (!fullPath) return null;
      specs.push({ rel: item.rel, fullPath, optional: false });
    }
    return specs;
  }

  function getChannelSourceStatsMeta(channelName, fileEntries, extraTag, sourceHash) {
    const specs = getChannelStatFileSpecs(fileEntries);
    if (!specs || !sourceHash || !SHA256_HEX_RE.test(sourceHash)) return null;
    const stats = collectFilesStatTuples(specs);
    if (!stats) return null;
    const scopeKey = `ch:${channelName}:${extraTag || ''}`;
    return {
      sourceStats: stats,
      statsBindingSha256: computeSourceStatsBinding(pluginVersion, scopeKey, sourceHash, stats),
    };
  }

  function verifyBundleFastStatSync(parsed) {
    if (!parsed || typeof parsed !== 'object') return { ok: false, statSig: '' };
    if (!SHA256_HEX_RE.test(String(parsed.sourceHash || ''))) return { ok: false, statSig: '' };
    if (!SHA256_HEX_RE.test(String(parsed.statsBindingSha256 || ''))) return { ok: false, statSig: '' };
    if (!isValidSourceStatsArray(parsed.sourceStats)) return { ok: false, statSig: '' };
    const expectedBinding = computeSourceStatsBinding(pluginVersion, 'ch1', parsed.sourceHash, parsed.sourceStats);
    if (expectedBinding !== parsed.statsBindingSha256) return { ok: false, statSig: '' };
    return matchesCachedStatTuples(parsed.sourceStats, getBundleSourceFiles());
  }

  function verifyChannelFastStatSync(channelName, entry, fileEntries, extraTag = '') {
    if (!entry || typeof entry !== 'object') return false;
    if (!SHA256_HEX_RE.test(String(entry.sourceHash || ''))) return false;
    if (!SHA256_HEX_RE.test(String(entry.statsBindingSha256 || ''))) return false;
    if (!isValidSourceStatsArray(entry.sourceStats)) return false;
    const scopeKey = `ch:${channelName}:${extraTag || ''}`;
    const expectedBinding = computeSourceStatsBinding(pluginVersion, scopeKey, entry.sourceHash, entry.sourceStats);
    if (expectedBinding !== entry.statsBindingSha256) return false;
    const specs = getChannelStatFileSpecs(fileEntries);
    if (!specs) return false;
    return matchesCachedStatTuples(entry.sourceStats, specs).ok;
  }

  // 快速 stat 指纹（单次 statSync 无多余 existsSync）
  function getBundleSourceStatSig() {
    const parts = [];
    for (const item of getBundleSourceFiles()) {
      try {
        const st = fs.statSync(item.fullPath);
        parts.push(`${item.rel}:${st.mtimeMs}:${st.size}`);
      } catch {
        parts.push(`${item.rel}:${item.optional ? 'MISSING' : '0:0'}`);
      }
    }
    return parts.join(';');
  }

  // 计算全部打包输入源文件的 SHA-256 内容指纹（100% 免疫 mtime 抖动与 git checkout）
  function computeBundleSourceHash() {
    const hash = crypto.createHash('sha256');
    hash.update(`schema:${BUNDLE_CACHE_SCHEMA_VERSION}\0`);
    hash.update(`version:${pluginVersion}\0`);
    hash.update(`consts:${STYLE_ID}:${LEGACY_STYLE_ID}:${SETTING_BINDING}\0`);
    for (const item of getBundleSourceFiles()) {
      hash.update(`file:${item.rel}\0`);
      if (item.optional && !fs.existsSync(item.fullPath)) {
        hash.update('MISSING\0');
        continue;
      }
      const buf = fs.readFileSync(item.fullPath);
      hash.update(`len:${buf.length}\0`);
      hash.update(buf);
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  // 轻量快速配置指纹（不加载/解析 180KB i18n-locales.js，配合 sourceStats 锁死 i18n-locales.js 100% 等价）
  function computeBundleFastConfigKey(config) {
    const rawLang = config && typeof config === 'object' ? (config.language || config.lang || 'auto') : 'auto';
    const resolvedLang =
      rawLang === 'auto'
        ? typeof templates.resolveSystemLangNode === 'function'
          ? templates.resolveSystemLangNode()
          : 'en'
        : typeof templates.normalizeLangIdNode === 'function'
          ? templates.normalizeLangIdNode(rawLang)
          : String(rawLang || 'en');
    const effective = {
      ...(config && typeof config === 'object' ? config : {}),
      __resolvedLang: resolvedLang,
      binding: SETTING_BINDING,
      codeHash: '',
      __fromFile: true,
    };
    return crypto
      .createHash('sha256')
      .update(`fastcfg:v${BUNDLE_CACHE_SCHEMA_VERSION}\0`)
      .update(JSON.stringify(effective))
      .digest('hex');
  }

  // 计算规范化后的有效 bootCfg 指纹（支持传入预计算 uiSlice 避免重复构建）
  function computeBundleConfigHash(config, precomputedUiSlice = undefined) {
    const uiSlice = precomputedUiSlice !== undefined ? precomputedUiSlice : templates.buildRuntimeUiSlicePayload(config);
    const effective = {
      ...(config && typeof config === 'object' ? config : {}),
      ...(uiSlice ? { __uiSlice: uiSlice } : {}),
      binding: SETTING_BINDING,
      codeHash: '',
      __fromFile: true,
    };
    const serialized = JSON.stringify(effective);
    return crypto
      .createHash('sha256')
      .update(`cfg:v${BUNDLE_CACHE_SCHEMA_VERSION}\0`)
      .update(serialized)
      .digest('hex');
  }

  // 计算编译管线自身（cdp.js + src/config/schema.cjs + src/compiler/*.cjs + src/channels/*.cjs）统一指纹
  function getCdpSelfSourceHash() {
    try {
      const files = listSelfFingerprintFiles(rootDir);
      const sigParts = [];
      for (const item of files) {
        if (!fs.existsSync(item.fullPath)) {
          sigParts.push(`${item.rel}:MISSING`);
        } else {
          sigParts.push(`${item.rel}:${getFileSig(item.fullPath)}`);
        }
      }
      const sig = sigParts.join(';');
      if (_cdpSelfHashCache.sig === sig && _cdpSelfHashCache.hash) {
        return _cdpSelfHashCache.hash;
      }
      const h = crypto.createHash('sha256');
      for (const item of files) {
        h.update(`self:${item.rel}\0`);
        if (!fs.existsSync(item.fullPath)) {
          h.update('MISSING\0');
          continue;
        }
        const buf = fs.readFileSync(item.fullPath);
        h.update(`len:${buf.length}\0`);
        h.update(buf);
        h.update('\0');
      }
      const hash = h.digest('hex');
      _cdpSelfHashCache = { sig, hash };
      return hash;
    } catch {
      return pluginVersion;
    }
  }

  function resolveFileEntryBuffer(item) {
    if (item && Buffer.isBuffer(item.content)) return item.content;
    if (item && typeof item.content === 'string') return Buffer.from(item.content, 'utf8');
    if (item && typeof item.fullPath === 'string' && item.fullPath) {
      const buf = fs.readFileSync(item.fullPath);
      item.content = buf;
      return buf;
    }
    return Buffer.alloc(0);
  }

  function computeChannelSourceHash(channelName, fileEntries, extraTag = '') {
    const hash = crypto.createHash('sha256');
    hash.update(`schema:${BUNDLE_CACHE_SCHEMA_VERSION}\0version:${pluginVersion}\0channel:${channelName}\0`);
    hash.update(`cdp:${getCdpSelfSourceHash()}\0`);
    if (extraTag) {
      hash.update(`extra:${extraTag}\0`);
    }
    for (const item of fileEntries) {
      hash.update(`file:${item.rel}\0`);
      const buf = resolveFileEntryBuffer(item);
      hash.update(`len:${buf.length}\0`);
      hash.update(buf);
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  function loadVerifiedJsonFileSync(filePath, bypassMemCache = false, useShardMap = false) {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    const fail = (reason) => {
      invalidateBundleCacheRootCache(resolved);
      return { ok: false, reason, parsed: null, fromMemCache: false };
    };
    if (isSymlinkPathSync(dir)) return fail('symlink-dir');
    let st;
    try {
      st = fs.lstatSync(resolved);
    } catch (err) {
      return fail(err && err.code === 'ENOENT' ? 'missing' : 'stat-error');
    }
    if (st.isSymbolicLink() || !st.isFile()) return fail('not-regular-file');
    if (st.size <= 0 || st.size > BUNDLE_CACHE_MAX_FILE_BYTES) return fail('size-out-of-range');
    const sig = `${st.mtimeMs}:${st.size}:${st.ctimeMs}:${st.ino || 0}`;
    const now = Date.now();
    const cachedSlot = useShardMap ? _shardRootCache.get(resolved) : _bundleCacheRootCache;
    if (
      !bypassMemCache && cachedSlot && cachedSlot.parsed &&
      cachedSlot.resolved === resolved && cachedSlot.sig === sig &&
      now >= cachedSlot.cachedAt && now - cachedSlot.cachedAt <= BUNDLE_CACHE_ROOT_MEM_TTL_MS
    ) {
      return { ok: true, parsed: cachedSlot.parsed, fromMemCache: true };
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch {
      return fail('parse-or-read-error');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('invalid-root');
    const hasOwn = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
    if (!hasOwn('schemaVersion') || parsed.schemaVersion !== BUNDLE_CACHE_SCHEMA_VERSION) return fail('schema-mismatch');
    if (!hasOwn('pluginVersion') || parsed.pluginVersion !== pluginVersion) return fail('version-mismatch');
    freezeBundleCacheRoot(parsed);
    const nextSlot = { resolved, sig, cachedAt: now, parsed };
    if (useShardMap) {
      if (_shardRootCache.size >= 32) _shardRootCache.clear();
      _shardRootCache.set(resolved, nextSlot);
    } else {
      _bundleCacheRootCache = nextSlot;
    }
    return { ok: true, parsed, fromMemCache: false };
  }

  function resolveCh1FilePath(cachePath, opts = null) {
    const resolved = path.resolve(cachePath);
    return isShardedCachePath(resolved, opts)
      ? { filePath: path.join(resolved, 'ch1.json'), sharded: true, shardDir: resolved }
      : { filePath: resolved, sharded: false, shardDir: null };
  }

  function resolveChannelFilePath(cachePath, channelName, opts = null) {
    const resolved = path.resolve(cachePath);
    if (isShardedCachePath(resolved, opts)) {
      const shardName = resolveChannelShardFilename(channelName);
      return { filePath: shardName ? path.join(resolved, shardName) : '', sharded: true, shardDir: resolved };
    }
    return { filePath: resolved, sharded: false, shardDir: null };
  }

  function readValidBundleCacheRootSync(cachePath, bypassMemCache = false, opts = null) {
    try {
      const target = resolveCh1FilePath(cachePath, opts);
      const loaded = loadVerifiedJsonFileSync(target.filePath, bypassMemCache, target.sharded);
      return loaded.ok ? loaded.parsed : null;
    } catch {
      invalidateBundleCacheRootCache(cachePath);
      return null;
    }
  }

  function tryReadBundleCacheHitSync(cachePath, expectedSourceHashOrFn, expectedConfigHashOrFn, opts = null) {
    let resolvedSourceHash = typeof expectedSourceHashOrFn === 'string' ? expectedSourceHashOrFn : '';
    let resolvedConfigHash = typeof expectedConfigHashOrFn === 'string' ? expectedConfigHashOrFn : '';
    const miss = (reason) => ({
      hit: false,
      reason,
      existingEntries: [],
      baseTemplate: null,
      sourceHash: resolvedSourceHash,
      configHash: resolvedConfigHash,
      usedFastStat: false,
    });
    try {
      const target = resolveCh1FilePath(cachePath, opts);
      const getExpectedSourceHash = typeof expectedSourceHashOrFn === 'function' ? expectedSourceHashOrFn : () => expectedSourceHashOrFn;
      const getExpectedConfigHash = typeof expectedConfigHashOrFn === 'function' ? expectedConfigHashOrFn : () => expectedConfigHashOrFn;
      const fastConfigKey = opts && typeof opts.fastConfigKey === 'string' ? opts.fastConfigKey : '';

      for (let attempt = 0; attempt < 2; attempt++) {
        const loaded = loadVerifiedJsonFileSync(target.filePath, attempt > 0, target.sharded);
        if (!loaded.ok) return miss(loaded.reason);
        const parsed = loaded.parsed;
        const hasOwn = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
        if (!hasOwn('sourceHash') || typeof parsed.sourceHash !== 'string' || !SHA256_HEX_RE.test(parsed.sourceHash)) {
          invalidateBundleCacheRootCache(target.filePath);
          if (loaded.fromMemCache && attempt === 0) continue;
          return miss('source-hash-mismatch');
        }

        let usedFastStat = false;
        let fastStatSig = '';
        let sourceMatched = false;
        if (typeof expectedSourceHashOrFn === 'function') {
          const fastRes = verifyBundleFastStatSync(parsed);
          if (fastRes.ok) {
            sourceMatched = true;
            usedFastStat = true;
            fastStatSig = fastRes.statSig;
            resolvedSourceHash = parsed.sourceHash;
          }
        }
        if (!sourceMatched) {
          if (!resolvedSourceHash) resolvedSourceHash = getExpectedSourceHash();
          sourceMatched = Boolean(resolvedSourceHash && parsed.sourceHash === resolvedSourceHash);
        }
        if (!sourceMatched) {
          invalidateBundleCacheRootCache(target.filePath);
          if (loaded.fromMemCache && attempt === 0) continue;
          return miss('source-hash-mismatch');
        }
        if (!hasOwn('entries') || !Array.isArray(parsed.entries)) {
          invalidateBundleCacheRootCache(target.filePath);
          if (loaded.fromMemCache && attempt === 0) continue;
          return miss('invalid-entries');
        }
        if (!isValidBundleBaseTemplate(parsed, { skipSha256: true })) {
          invalidateBundleCacheRootCache(target.filePath);
          if (loaded.fromMemCache && attempt === 0) continue;
          return miss('invalid-base-template');
        }
        const baseTemplate = {
          codeHash: parsed.codeHash,
          basePrefix: parsed.basePrefix,
          baseSuffix: parsed.baseSuffix,
          baseSha256: parsed.baseSha256,
        };
        let matchedEnt = fastConfigKey
          ? parsed.entries.find((ent) => ent && typeof ent === 'object' && !Array.isArray(ent) && ent.fastConfigKey === fastConfigKey)
          : null;
        if (!matchedEnt) {
          if (!resolvedConfigHash) resolvedConfigHash = getExpectedConfigHash();
          matchedEnt = parsed.entries.find(
            (ent) => ent && typeof ent === 'object' && !Array.isArray(ent) && Object.prototype.hasOwnProperty.call(ent, 'configHash') && ent.configHash === resolvedConfigHash
          );
        }
        if (matchedEnt) {
          if (isValidBundleCacheEntry(matchedEnt, baseTemplate)) {
            return {
              hit: true,
              reason: 'hit',
              expr: baseTemplate.basePrefix + matchedEnt.bootCfgJson + baseTemplate.baseSuffix,
              codeHash: matchedEnt.codeHash,
              existingEntries: [],
              baseTemplate,
              sourceHash: resolvedSourceHash || parsed.sourceHash,
              configHash: matchedEnt.configHash,
              usedFastStat,
              statSig: fastStatSig,
            };
          }
          invalidateBundleCacheRootCache(target.filePath);
          if (loaded.fromMemCache && attempt === 0) continue;
          return miss('corrupt-matching-entry');
        }
        // config-miss 复用 baseTemplate 前必须完整校验 baseSha256
        if (!isValidBundleBaseTemplate(parsed)) {
          invalidateBundleCacheRootCache(target.filePath);
          if (loaded.fromMemCache && attempt === 0) continue;
          return miss('invalid-base-template');
        }
        return {
          hit: false,
          reason: 'config-miss',
          existingEntries: parsed.entries,
          baseTemplate,
          sourceHash: resolvedSourceHash || parsed.sourceHash,
          configHash: resolvedConfigHash,
          usedFastStat,
        };
      }
      return miss('corrupt-matching-entry');
    } catch {
      invalidateBundleCacheRootCache(cachePath);
      resolvedSourceHash = '';
      resolvedConfigHash = '';
      return miss('parse-or-read-error');
    }
  }

  function tryReadChannelCacheHitSync(cachePath, channelName, expectedSourceHashOrFn, { fileEntries = null, extraTag = '', opts = null } = {}) {
    const target = resolveChannelFilePath(cachePath, channelName, opts);
    if (!target.filePath) return { hit: false, reason: 'missing', sourceHash: '', usedFastStat: false };
    const getExpectedSourceHash =
      typeof expectedSourceHashOrFn === 'function'
        ? expectedSourceHashOrFn
        : () => expectedSourceHashOrFn;
    let resolvedSourceHash = typeof expectedSourceHashOrFn === 'string' ? expectedSourceHashOrFn : '';

    for (let attempt = 0; attempt < 2; attempt++) {
      const loaded = loadVerifiedJsonFileSync(target.filePath, attempt > 0, target.sharded);
      if (!loaded.ok || !loaded.parsed) {
        return { hit: false, reason: 'missing', sourceHash: resolvedSourceHash, usedFastStat: false };
      }
      const root = loaded.parsed;
      const ent = target.sharded
        ? root.channel === channelName && root.entry && typeof root.entry === 'object'
          ? root.entry
          : null
        : root.channels && typeof root.channels === 'object' && !Array.isArray(root.channels) && Object.prototype.hasOwnProperty.call(root.channels, channelName)
          ? root.channels[channelName]
          : null;
      if (!ent || typeof ent !== 'object') {
        return { hit: false, reason: 'channel-missing', sourceHash: resolvedSourceHash, usedFastStat: false };
      }

      let usedFastStat = false;
      let sourceMatched = false;
      if (
        typeof expectedSourceHashOrFn === 'function' &&
        Array.isArray(fileEntries) &&
        verifyChannelFastStatSync(channelName, ent, fileEntries, extraTag)
      ) {
        sourceMatched = true;
        usedFastStat = true;
        resolvedSourceHash = ent.sourceHash;
      } else {
        if (!resolvedSourceHash) resolvedSourceHash = getExpectedSourceHash();
        sourceMatched = Boolean(resolvedSourceHash && ent.sourceHash === resolvedSourceHash);
      }

      if (!sourceMatched) {
        invalidateBundleCacheRootCache(target.filePath);
        if (loaded.fromMemCache && attempt === 0) continue;
        return { hit: false, reason: 'source-hash-mismatch', sourceHash: resolvedSourceHash, usedFastStat: false };
      }
      if (!isValidChannelCacheEntry(channelName, ent)) {
        invalidateBundleCacheRootCache(target.filePath);
        if (loaded.fromMemCache && attempt === 0) continue;
        return { hit: false, reason: 'corrupt-channel-entry', sourceHash: resolvedSourceHash, usedFastStat: false };
      }
      return { hit: true, entry: ent, sourceHash: resolvedSourceHash || ent.sourceHash, usedFastStat };
    }
    return { hit: false, reason: 'corrupt-channel-entry', sourceHash: resolvedSourceHash, usedFastStat: false };
  }

  function cleanupLegacyMonolithicCacheSync(shardDir) {
    try {
      const legacyFile = path.join(path.dirname(path.resolve(shardDir)), BUNDLE_CACHE_FILENAME);
      const st = fs.lstatSync(legacyFile);
      if (!st.isSymbolicLink() && st.isFile()) {
        fs.unlinkSync(legacyFile);
      }
    } catch {}
  }

  function writeJsonAtomicFileSync(targetFilePath, payloadObj) {
    let tmpPath = null;
    let fd = null;
    try {
      const resolved = path.resolve(targetFilePath);
      const dir = path.dirname(resolved);
      if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
        return false;
      }
      fs.mkdirSync(dir, { recursive: true });
      const dirStat = fs.lstatSync(dir);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        return false;
      }
      try {
        const existingStat = fs.lstatSync(resolved);
        if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
          return false;
        }
      } catch (err) {
        if (!err || err.code !== 'ENOENT') return false;
      }

      const jsonText = JSON.stringify(payloadObj);
      if (Buffer.byteLength(jsonText, 'utf8') > BUNDLE_CACHE_MAX_FILE_BYTES) {
        return false;
      }

      const base = path.basename(resolved);
      const safeBase = base.startsWith('.') ? base.slice(1) : base;
      const rand = crypto.randomBytes(6).toString('hex');
      tmpPath = path.join(dir, `.${safeBase}.${process.pid}.${rand}.tmp`);
      fd = fs.openSync(tmpPath, 'wx', 0o600);
      fs.writeFileSync(fd, jsonText, 'utf8');
      fs.closeSync(fd);
      fd = null;
      try { fs.chmodSync(tmpPath, 0o600); } catch {}

      if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return false;
      }

      let renamed = false;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.renameSync(tmpPath, resolved);
          renamed = true;
          break;
        } catch (err) {
          lastErr = err;
          if (!IS_WIN || !['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(err && err.code)) {
            throw err;
          }
        }
      }
      if (!renamed) {
        if (IS_WIN && ['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(lastErr && lastErr.code)) {
          if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return false;
          }
          fs.copyFileSync(tmpPath, resolved);
          try { fs.unlinkSync(tmpPath); } catch {}
        } else {
          throw lastErr;
        }
      }
      try { fs.chmodSync(resolved, 0o600); } catch {}
      invalidateBundleCacheRootCache(resolved);
      return true;
    } catch {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      invalidateBundleCacheRootCache(targetFilePath);
      return false;
    }
  }

  function writeBundleCacheAtomicSync(cachePath, payloadObj, opts = null) {
    const target = resolveCh1FilePath(cachePath, opts);
    if (target.sharded) {
      if (isSymlinkPathSync(path.dirname(target.shardDir)) || isSymlinkPathSync(target.shardDir)) {
        return false;
      }
      const { channels: _ignoredChannels, ...ch1Payload } = payloadObj || {};
      const ok = writeJsonAtomicFileSync(target.filePath, ch1Payload);
      if (ok) cleanupLegacyMonolithicCacheSync(target.shardDir);
      return ok;
    }
    return writeJsonAtomicFileSync(target.filePath, payloadObj);
  }

  function writeChannelShardAtomicSync(cachePath, channelName, record, opts = null) {
    const target = resolveChannelFilePath(cachePath, channelName, opts);
    if (!target.sharded || !target.filePath) return false;
    if (isSymlinkPathSync(path.dirname(target.shardDir)) || isSymlinkPathSync(target.shardDir)) {
      return false;
    }
    const ok = writeJsonAtomicFileSync(target.filePath, {
      schemaVersion: BUNDLE_CACHE_SCHEMA_VERSION,
      pluginVersion,
      channel: channelName,
      entry: record,
    });
    if (ok) cleanupLegacyMonolithicCacheSync(target.shardDir);
    return ok;
  }

  return {
    invalidateBundleCacheRootCache,
    getBundleSourceFiles,
    getBundleSourceStatsMeta,
    getChannelSourceStatsMeta,
    getBundleSourceStatSig,
    computeBundleSourceHash,
    computeBundleFastConfigKey,
    computeBundleConfigHash,
    getCdpSelfSourceHash,
    resolveFileEntryBuffer,
    computeChannelSourceHash,
    readValidBundleCacheRootSync,
    tryReadBundleCacheHitSync,
    tryReadChannelCacheHitSync,
    writeBundleCacheAtomicSync,
    writeChannelShardAtomicSync,
  };
}

module.exports = {
  listSelfFingerprintFiles,
  createBundleCacheIo,
};
