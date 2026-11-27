// Obsidian Prism 遥测服务懒加载、闲置释放与 4MB LRU 磁盘缓存引擎（无原型 Mixin，供 TelemetrySubsystem 组合调用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GUID_RE,
  USAGE_CACHE_MAX_BYTES,
  USAGE_CACHE_MAX_PER_SCOPE,
  USAGE_CACHE_MAX_SCOPES,
  USAGE_CACHE_MAX_TOTAL_RECORDS,
  resolveUsageCachePath,
  discoverActivePort,
} from './constants.mjs';
import {
  assertNotSymlinkSync,
  assertNotSymlinkAsync,
  writeFileAtomicSync,
  writeFileAtomicAsync,
} from './fs-atomic.mjs';
import { normalizeUsageScopeKey, sanitizeUsageRecord, hasRealUsageRecord } from './telemetry-scope.mjs';

export function isTelemetryDisabled(tel, cfgOverride = null) {
  try {
    const cfg = cfgOverride || tel._getCdp?.()?.readConfig?.();
    return cfg?.telemetryModule === 'off';
  } catch {
    return false;
  }
}

export function releaseIdleTelemetry(tel, force = false) {
  if (!tel._lazyStore && !tel._lazyUsage && !tel._lazyLsClient && !tel._backendSummariesCache) {
    return false;
  }
  if ((tel._telemetryInFlight || 0) > 0) {
    return false;
  }
  if (!force) {
    const idleMs = Date.now() - (tel._lastTelemetryActivityAt || 0);
    if (idleMs < 120000) return false;
    if (
      tel._usageCacheFlushPromise ||
      tel._lazyUsage?.syncing ||
      tel._lazyUsage?.ledger?.diskWrites > 0 ||
      tel._lazyUsage?.ledger?.diskSummaryPending ||
      tel._lazyStore?.background?.active
    ) {
      return false;
    }
  }
  const storeClient = tel._lazyStore?.client || null;
  const lsClient = tel._lazyLsClient && tel._lazyLsClient !== storeClient ? tel._lazyLsClient : null;
  const targets = [tel._lazyUsage, tel._lazyStore, lsClient];
  tel._lazyUsage = null;
  tel._lazyStore = null;
  tel._lazyLsClient = null;
  tel._backendSummariesCache = null;
  tel._backendSummariesAt = 0;
  tel._scopedTrajCache?.clear?.();
  tel._scopedTrajInFlight?.clear?.();
  flushUsageDiskCache(tel);
  // 无论内存缓存是否已为空，均再次确保飞行中异步刷盘代数失效并解除引用，杜绝释后晚到覆盖
  if (tel._usageCacheFlushPromise || tel._usageCacheTimer) {
    if (tel._usageCacheTimer) {
      clearTimeout(tel._usageCacheTimer);
      tel._usageCacheTimer = null;
    }
    invalidateInFlightUsageFlush(tel);
  }
  tel._usageDiskCache = null;
  for (const svc of targets) {
    if (!svc) continue;
    try {
      if (typeof svc.dispose === 'function') svc.dispose();
      else if (typeof svc.close === 'function') svc.close();
    } catch {}
  }
  return true;
}

export function resolveTelemetryDataDir(tel) {
  if (tel._telemetryDataDir) return tel._telemetryDataDir;
  const dir = path.join(os.homedir(), '.gemini', 'antigravity', 'sidecar_data', 'obsidian-prism', 'telemetry');
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {}
  tel._telemetryDataDir = dir;
  return dir;
}

export function syncClientCdpPort(tel, clientOrStore) {
  if (!clientOrStore) return null;
  const activePort = discoverActivePort(tel._overridePort, tel._portFile);
  if (activePort) {
    if (typeof clientOrStore.setCdpPort === 'function') {
      clientOrStore.setCdpPort(activePort);
    } else {
      clientOrStore.cdpPort = activePort;
      if (clientOrStore.client) clientOrStore.client.cdpPort = activePort;
    }
  }
  return activePort;
}

export async function ensureLazyDesktopUsage(tel) {
  if (tel._lazyUsage || !tel._lazyStore) return tel._lazyUsage;
  const telemetryDataDir = resolveTelemetryDataDir(tel);
  const usageModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/usage.mjs', import.meta.url);
  const { DesktopUsage } = await import(usageModUrl.href);
  tel._lazyUsage = new DesktopUsage(tel._lazyStore, { dataDir: telemetryDataDir });
  tel._lazyStore.onTrajectory = (scope, id, raw, options) =>
    typeof tel._lazyUsage.ingestLive === 'function'
      ? tel._lazyUsage.ingestLive(scope, id, raw, options)
      : tel._lazyUsage.ingest(scope, id, raw);
  tel._lazyStore.onBackgroundResult = (scope, id, jobDb, options) =>
    typeof tel._lazyUsage.ingestDisk === 'function'
      ? tel._lazyUsage.ingestDisk(scope, id, jobDb, options)
      : undefined;
  return tel._lazyUsage;
}

export async function ensureMetricsCollector(tel) {
  if (tel._customMetricsProvider) return tel._customMetricsProvider;
  if (tel._lazyStore) {
    return async (input) => {
      syncClientCdpPort(tel, tel._lazyStore);
      const safeId = input?.conversationId && GUID_RE.test(input.conversationId) ? input.conversationId : null;
      const base = await tel._lazyStore.snapshot({
        conversationId: safeId,
        force: Boolean(input?.force),
        freshContext: Boolean(input?.freshContext),
        quotaRefresh: Boolean(input?.quotaRefresh),
        selectLatest: input?.selectLatest === false ? false : true,
        includeConversations: input?.includeConversations !== false,
      });
      let usageSnap = null;
      if (input?.includeUsage === true) {
        if (!tel._lazyUsage) {
          await ensureLazyDesktopUsage(tel).catch(() => null);
        }
        if (tel._lazyUsage) {
          if (input?.force) void tel._lazyUsage.sync(true);
          usageSnap = await tel._lazyUsage
            .snapshot({ groups: Array.isArray(base?.groups) ? base.groups : null })
            .catch(() => null);
        }
      }
      return { ...base, usage: usageSnap };
    };
  }
  const telemetryDataDir = resolveTelemetryDataDir(tel);
  const activePort = discoverActivePort(tel._overridePort, tel._portFile);
  const storeModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/store.mjs', import.meta.url);
  const { MetricsStore } = await import(storeModUrl.href);
  tel._lazyStore = new MetricsStore({
    dataDir: telemetryDataDir,
    rendererRpc: (m, b) => tel.invokeRendererLsRpc(m, b, { scopeKey: 'local' }),
    ...(activePort ? { cdpPort: activePort } : {}),
  });
  return ensureMetricsCollector(tel);
}

export async function ensureLsClient(tel) {
  if (tel._lazyLsClient) {
    syncClientCdpPort(tel, tel._lazyLsClient);
    return tel._lazyLsClient;
  }
  if (tel._lazyStore && tel._lazyStore.client) {
    tel._lazyLsClient = tel._lazyStore.client;
    tel._lazyLsClient.setScopeResolver?.(() => tel.resolveActiveRpcScope());
    syncClientCdpPort(tel, tel._lazyLsClient);
    return tel._lazyLsClient;
  }
  const activePort = discoverActivePort(tel._overridePort, tel._portFile);
  const clientModUrl = new URL('../../vendor/pulse-dashboard/sidecars/panel/client.mjs', import.meta.url);
  const { AntigravityClient } = await import(clientModUrl.href);
  tel._lazyLsClient = new AntigravityClient({
    rendererRpc: (m, b) => tel.invokeRendererLsRpc(m, b),
    scopeResolver: () => tel.resolveActiveRpcScope(),
    ...(activePort ? { cdpPort: activePort } : {}),
  });
  return tel._lazyLsClient;
}

export function resolveActiveUsageCachePath(tel) {
  if (typeof tel._usageCacheFile === 'string' && tel._usageCacheFile.trim()) {
    return path.resolve(tel._usageCacheFile.trim());
  }
  return resolveUsageCachePath(tel._usageCachePathOpt);
}

export function loadUsageDiskCache(tel) {
  if (tel._usageDiskCache instanceof Map) return tel._usageDiskCache;
  const scopesMap = new Map();
  const cacheFile = resolveActiveUsageCachePath(tel);
  let healedAny = false;
  const parseScopeEntries = (obj) => {
    const m = new Map();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return m;
    for (const [k, v] of Object.entries(obj)) {
      if (m.size >= USAGE_CACHE_MAX_PER_SCOPE) break;
      const sc = Number(v?.stepCount || 0);
      const lm = Number(v?.lastModifiedSec || 0);
      const dbMtimeSec = Number(v?.dbMtimeSec || 0);
      const dbSize = Number(v?.dbSize || 0);
      if (
        GUID_RE.test(k) &&
        v &&
        v.record?.days &&
        lm > 0 &&
        (sc > 0 || (dbMtimeSec > 0 && dbSize > 0) || hasRealUsageRecord(v.record))
      ) {
        const clean = sanitizeUsageRecord(k, v.record);
        if (clean !== v.record) healedAny = true;
        m.set(k.toLowerCase(), {
          stepCount: Math.max(0, sc),
          lastModifiedSec: lm,
          ...(dbMtimeSec > 0 ? { dbMtimeSec } : {}),
          ...(dbSize > 0 ? { dbSize } : {}),
          record: clean,
        });
      }
    }
    return m;
  };
  try {
    const dir = path.dirname(cacheFile);
    if (fs.existsSync(cacheFile)) {
      const dirStat = fs.lstatSync(dir);
      const lst = fs.lstatSync(cacheFile);
      if (
        !dirStat.isSymbolicLink() &&
        dirStat.isDirectory() &&
        !lst.isSymbolicLink() &&
        lst.isFile() &&
        lst.size > 0 &&
        lst.size <= USAGE_CACHE_MAX_BYTES
      ) {
        const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          if (raw.version === 2 && raw.scopes && typeof raw.scopes === 'object' && !Array.isArray(raw.scopes)) {
            for (const [rawScope, bucketObj] of Object.entries(raw.scopes)) {
              if (scopesMap.size >= USAGE_CACHE_MAX_SCOPES) break;
              const sc = normalizeUsageScopeKey(rawScope);
              if (!sc) continue;
              const parsedBucket = parseScopeEntries(bucketObj);
              if (parsedBucket.size > 0) scopesMap.set(sc, parsedBucket);
            }
          } else {
            const localBucket = parseScopeEntries(raw);
            if (localBucket.size > 0) scopesMap.set('local', localBucket);
          }
        }
      }
    }
  } catch {}
  tel._usageDiskCache = scopesMap;
  if (healedAny) {
    tel._usageCacheDirty = true;
    if (!tel._usageCacheTimer) {
      tel._usageCacheTimer = setTimeout(() => {
        tel._usageCacheTimer = null;
        void flushUsageDiskCacheAsync(tel);
      }, 1500);
      tel._usageCacheTimer.unref?.();
    }
  }
  return scopesMap;
}

export function getUsageDiskCacheScope(tel, scopeKey = 'local', create = false) {
  const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
  const scopesMap = loadUsageDiskCache(tel);
  let bucket = scopesMap.get(safeScope);
  if (!bucket && create) {
    bucket = new Map();
    scopesMap.set(safeScope, bucket);
    while (scopesMap.size > USAGE_CACHE_MAX_SCOPES) {
      const oldestKey = scopesMap.keys().next().value;
      if (oldestKey === safeScope) break;
      scopesMap.delete(oldestKey);
    }
  }
  return bucket || new Map();
}

function computeUsageRecordDigest(rec) {
  if (!rec || typeof rec !== 'object') return '';
  let dayCount = 0;
  let totalTok = 0;
  let totalCalls = 0;
  const days = rec.days;
  if (days && typeof days === 'object' && !Array.isArray(days)) {
    for (const k in days) {
      if (!Object.prototype.hasOwnProperty.call(days, k)) continue;
      const d = days[k];
      dayCount += 1;
      if (d && typeof d === 'object') {
        totalTok += Number(d.total || d.tokens || 0) || 0;
        totalCalls += Number(d.calls || 0) || 0;
      }
    }
  }
  return `${rec.cascadeId || ''}|${rec.stepCount || 0}|${rec.lastModifiedSec || 0}|${rec.dbMtimeSec || 0}|${rec.dbSize || 0}|${rec.calls || 0}|${rec.subagent ? 1 : 0}|${rec.parentId || ''}|${rec.title || ''}|${rec.workspace || ''}|${dayCount}:${totalTok}:${totalCalls}`;
}

function isPlainValueEqual(a, b, depth = 0) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (depth > 12) return false;
  const isArrA = Array.isArray(a);
  if (isArrA !== Array.isArray(b)) return false;
  if (isArrA) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!isPlainValueEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  let countA = 0;
  for (const k in a) {
    if (!Object.prototype.hasOwnProperty.call(a, k) || a[k] === undefined) continue;
    countA += 1;
    if (!Object.prototype.hasOwnProperty.call(b, k) || b[k] === undefined) return false;
    if (!isPlainValueEqual(a[k], b[k], depth + 1)) return false;
  }
  let countB = 0;
  for (const k in b) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || b[k] === undefined) continue;
    countB += 1;
  }
  return countA === countB;
}

function isUsageCacheEntryEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    (a.stepCount || 0) !== (b.stepCount || 0) ||
    (a.lastModifiedSec || 0) !== (b.lastModifiedSec || 0) ||
    (a.dbMtimeSec || 0) !== (b.dbMtimeSec || 0) ||
    (a.dbSize || 0) !== (b.dbSize || 0)
  ) {
    return false;
  }
  if (a.record === b.record) return true;
  if (!a.record || !b.record || typeof a.record !== 'object' || typeof b.record !== 'object') return false;
  if (computeUsageRecordDigest(a.record) !== computeUsageRecordDigest(b.record)) return false;
  return isPlainValueEqual(a.record, b.record, 0);
}

export function putUsageDiskCache(tel, id, stepCount, lastModifiedSec, record, scopeKey = 'local', diskMeta = null) {
  if (!id || !GUID_RE.test(id) || !record?.days) return;
  const cleanRec = sanitizeUsageRecord(id, record);
  const sc = Math.max(0, Number(stepCount || cleanRec.stepCount || 0));
  const lm = Math.max(0, Number(lastModifiedSec || cleanRec.lastModifiedSec || 0));
  const dbMtimeSec = Math.max(0, Number(diskMeta?.dbMtimeSec || cleanRec.dbMtimeSec || 0));
  const dbSize = Math.max(0, Number(diskMeta?.dbSize || cleanRec.dbSize || 0));
  if (lm <= 0 || (sc <= 0 && !(dbMtimeSec > 0 && dbSize > 0) && !hasRealUsageRecord(cleanRec))) return;
  const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
  const bucket = getUsageDiskCacheScope(tel, safeScope, true);
  const key = id.toLowerCase();
  const existing = bucket.get(key);
  if (existing && hasRealUsageRecord(existing.record) && !hasRealUsageRecord(cleanRec)) {
    const cleanExisting = sanitizeUsageRecord(id, existing.record);
    const nextReal = {
      ...existing,
      ...(dbMtimeSec > 0 ? { dbMtimeSec } : {}),
      ...(dbSize > 0 ? { dbSize } : {}),
      record: cleanExisting,
    };
    if (!isUsageCacheEntryEqual(existing, nextReal)) {
      bucket.set(key, nextReal);
      tel._usageCacheDirty = true;
    }
    return;
  }
  const nextRecord =
    dbMtimeSec > 0 || dbSize > 0
      ? { ...cleanRec, ...(dbMtimeSec > 0 ? { dbMtimeSec } : {}), ...(dbSize > 0 ? { dbSize } : {}) }
      : cleanRec;
  const nextEntry = {
    stepCount: sc,
    lastModifiedSec: lm,
    ...(dbMtimeSec > 0 ? { dbMtimeSec } : existing?.dbMtimeSec > 0 ? { dbMtimeSec: existing.dbMtimeSec } : {}),
    ...(dbSize > 0 ? { dbSize } : existing?.dbSize > 0 ? { dbSize: existing.dbSize } : {}),
    record: nextRecord,
  };
  // 字段等值 dirty diff 守卫：无变化严禁设 _usageCacheDirty 与触发 fsync 写盘
  if (existing && isUsageCacheEntryEqual(existing, nextEntry)) {
    return;
  }
  bucket.set(key, nextEntry);
  tel._usageCacheDirty = true;
  if (!tel._usageCacheTimer) {
    tel._usageCacheTimer = setTimeout(() => {
      tel._usageCacheTimer = null;
      void flushUsageDiskCacheAsync(tel);
    }, 1500);
    tel._usageCacheTimer.unref?.();
  }
}

export function buildUsageDiskCacheSerialized(tel) {
  const normalizedScopes = [];
  let totalCount = 0;
  for (const [rawScope, bucket] of tel._usageDiskCache.entries()) {
    const sc = normalizeUsageScopeKey(rawScope);
    if (!sc || !(bucket instanceof Map) || bucket.size === 0) continue;
    let entries = Array.from(bucket.entries());
    entries.sort((a, b) => (b[1].lastModifiedSec || 0) - (a[1].lastModifiedSec || 0));
    if (entries.length > USAGE_CACHE_MAX_PER_SCOPE) {
      entries = entries.slice(0, USAGE_CACHE_MAX_PER_SCOPE);
      tel._usageDiskCache.set(sc, new Map(entries));
    }
    const newestSec = entries[0]?.[1]?.lastModifiedSec || 0;
    normalizedScopes.push({ scope: sc, entries, newestSec });
    totalCount += entries.length;
  }
  normalizedScopes.sort((a, b) => b.newestSec - a.newestSec);
  if (normalizedScopes.length > USAGE_CACHE_MAX_SCOPES) {
    normalizedScopes.length = USAGE_CACHE_MAX_SCOPES;
  }

  if (totalCount > USAGE_CACHE_MAX_TOTAL_RECORDS) {
    const allItems = [];
    for (const s of normalizedScopes) {
      for (const [k, v] of s.entries) allItems.push({ scope: s.scope, key: k, val: v });
    }
    allItems.sort((a, b) => (b.val.lastModifiedSec || 0) - (a.val.lastModifiedSec || 0));
    const kept = allItems.slice(0, USAGE_CACHE_MAX_TOTAL_RECORDS);
    const byScope = new Map();
    for (const it of kept) {
      let arr = byScope.get(it.scope);
      if (!arr) {
        arr = [];
        byScope.set(it.scope, arr);
      }
      arr.push([it.key, it.val]);
    }
    normalizedScopes.length = 0;
    for (const [sc, entries] of byScope.entries()) {
      normalizedScopes.push({ scope: sc, entries, newestSec: entries[0]?.[1]?.lastModifiedSec || 0 });
    }
  }

  normalizedScopes.sort((a, b) => (b.newestSec || 0) - (a.newestSec || 0));
  const buildPayload = () => {
    const scopesObj = Object.create(null);
    for (const s of normalizedScopes) {
      if (!s.entries.length) continue;
      const bucketObj = Object.create(null);
      for (const [k, v] of s.entries) bucketObj[k] = v;
      scopesObj[s.scope] = bucketObj;
    }
    return JSON.stringify({ version: 2, scopes: scopesObj });
  };
  let serialized = buildPayload();
  while (Buffer.byteLength(serialized, 'utf8') > USAGE_CACHE_MAX_BYTES) {
    let trimmed = false;
    for (const s of normalizedScopes) {
      if (s.entries.length > 1) {
        s.entries = s.entries.slice(0, Math.max(1, Math.floor(s.entries.length * 0.8)));
        trimmed = true;
      }
    }
    if (!trimmed) {
      for (let i = normalizedScopes.length - 1; i >= 0; i--) {
        if (normalizedScopes[i].entries.length > 0) {
          normalizedScopes[i].entries.pop();
          trimmed = true;
          break;
        }
      }
    }
    if (!trimmed) break;
    serialized = buildPayload();
  }
  return Buffer.byteLength(serialized, 'utf8') <= USAGE_CACHE_MAX_BYTES ? serialized : null;
}

function bumpUsageFlushGen(tel) {
  const next = Math.max(tel._usageCacheFlushGen || 0, tel._usageCacheFlushEpoch || 0) + 1;
  tel._usageCacheFlushGen = next;
  tel._usageCacheFlushEpoch = next;
  return next;
}

function invalidateInFlightUsageFlush(tel) {
  const gen = bumpUsageFlushGen(tel);
  if (tel._usageCacheFlushPromise) {
    if (!(tel._usageCacheRetiredPromises instanceof Set)) {
      tel._usageCacheRetiredPromises = new Set();
    }
    const stale = tel._usageCacheFlushPromise;
    tel._usageCacheRetiredPromises.add(stale);
    stale
      .finally(() => {
        tel._usageCacheRetiredPromises?.delete?.(stale);
      })
      .catch(() => {});
    tel._usageCacheFlushPromise = null;
  }
  return gen;
}

export function flushUsageDiskCache(tel) {
  if (tel._usageCacheTimer) {
    clearTimeout(tel._usageCacheTimer);
    tel._usageCacheTimer = null;
  }
  const hadInFlight = Boolean(tel._usageCacheFlushPromise);
  if (!tel._usageCacheDirty && !hadInFlight) return;
  // 先行递增 flushGen/epoch 并解绑飞行中异步刷盘，确保旧异步写在 rename/copyFile 前中止
  invalidateInFlightUsageFlush(tel);
  if (!(tel._usageDiskCache instanceof Map)) {
    tel._usageCacheDirty = false;
    return;
  }
  tel._usageCacheDirty = false;
  try {
    const cacheFile = resolveActiveUsageCachePath(tel);
    const dir = path.dirname(cacheFile);
    assertNotSymlinkSync(cacheFile, 'usage cache file');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    assertNotSymlinkSync(dir, 'usage cache directory');
    const serialized = buildUsageDiskCacheSerialized(tel);
    if (serialized !== null) {
      if (tel._lastFlushedUsageJson === serialized && fs.existsSync(cacheFile)) {
        return;
      }
      writeFileAtomicSync(cacheFile, serialized, { mode: 0o600 });
      tel._lastFlushedUsageJson = serialized;
    }
  } catch {
    tel._usageCacheDirty = true;
  }
}

export function flushUsageDiskCacheAsync(tel) {
  if (tel._usageCacheTimer) {
    clearTimeout(tel._usageCacheTimer);
    tel._usageCacheTimer = null;
  }
  if (tel._usageCacheFlushPromise) {
    return tel._usageCacheFlushPromise;
  }
  if (!tel._usageCacheDirty || !(tel._usageDiskCache instanceof Map)) return Promise.resolve();
  tel._usageCacheDirty = false;
  const flushGen = bumpUsageFlushGen(tel);
  const isStale = () => flushGen !== tel._usageCacheFlushGen || flushGen !== tel._usageCacheFlushEpoch;
  const cacheFile = resolveActiveUsageCachePath(tel);
  const dir = path.dirname(cacheFile);
  let serialized = null;
  try {
    serialized = buildUsageDiskCacheSerialized(tel);
  } catch {
    return Promise.resolve();
  }
  if (serialized === null) return Promise.resolve();
  const task = (async () => {
    try {
      await assertNotSymlinkAsync(cacheFile, 'usage cache file');
      if (isStale()) return;
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      await assertNotSymlinkAsync(dir, 'usage cache directory');
      if (isStale()) return;
      if (tel._lastFlushedUsageJson === serialized) {
        try {
          await fs.promises.access(cacheFile);
          return;
        } catch {}
      }
      if (isStale()) return;
      const wrote = await writeFileAtomicAsync(cacheFile, serialized, {
        mode: 0o600,
        shouldAbort: isStale,
      });
      if (wrote) {
        if (!isStale()) {
          tel._lastFlushedUsageJson = serialized;
        } else if (
          typeof tel._lastFlushedUsageJson === 'string' &&
          tel._lastFlushedUsageJson &&
          tel._lastFlushedUsageJson !== serialized
        ) {
          // 极端 libuv 线程池竞态兜底：若旧 rename 已派发并在同步写之后完成，立即写回最新已确认快照
          const latestGen = tel._usageCacheFlushGen;
          const latestJson = tel._lastFlushedUsageJson;
          await writeFileAtomicAsync(cacheFile, latestJson, {
            mode: 0o600,
            shouldAbort: () => latestGen !== tel._usageCacheFlushGen || latestGen !== tel._usageCacheFlushEpoch,
          });
        }
      }
    } catch {
    } finally {
      if (tel._usageCacheFlushPromise === task) {
        tel._usageCacheFlushPromise = null;
      }
      if (!tel._usageCacheFlushPromise && tel._usageCacheDirty && tel._usageDiskCache instanceof Map) {
        void flushUsageDiskCacheAsync(tel);
      }
    }
  })();
  tel._usageCacheFlushPromise = task;
  return task;
}
