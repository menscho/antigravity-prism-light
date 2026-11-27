// Obsidian Prism 遥测账本汇总引擎（UsageService：轨迹摘要、子代理发现与批量增量 Rollup，无原型 Mixin，供 TelemetrySubsystem 调用）
import path from 'node:path';
import { createRequire } from 'node:module';
import { discoverLocalConversations } from '../../vendor/pulse-dashboard/sidecars/panel/local-conversations.mjs';
import { sanitizeSecretText } from '../../sidecars/daemon/redact.mjs';
import {
  GUID_RE,
  RPC_ROUTE_STORAGE,
  USAGE_CACHE_MAX_SCOPES,
  LOCAL_COLD_WAKEUP_CAP,
} from './constants.mjs';
import {
  normalizeUsageScopeKey,
  resolveUsageScopeKey,
  sanitizeUsageRecord,
  hasRealUsageRecord,
  createScopedRendererClient,
} from './telemetry-scope.mjs';
import { getUsageDiskCacheScope, putUsageDiskCache } from './telemetry-cache.mjs';

const require = createRequire(import.meta.url);

export async function fetchFullGeneratorMetadata(client, id) {
  if (typeof client._fetchMetadataOnly === 'function') {
    return await client._fetchMetadataOnly(id);
  }
  const allItems = [];
  let curOffset = 0;
  let totalGm = null;
  let totalSteps = 0;
  while (true) {
    const page = await client.call('GetCascadeTrajectoryGeneratorMetadata', {
      cascadeId: id,
      generatorMetadataOffset: curOffset,
      includeMessages: false,
    });
    const chunk = page?.generatorMetadata || page?.generatorMetadatas || [];
    if (page?.numTotalGeneratorMetadata !== undefined && page?.numTotalGeneratorMetadata !== null) {
      totalGm = Number(page.numTotalGeneratorMetadata);
    }
    if (page?.numTotalSteps !== undefined && page?.numTotalSteps !== null) {
      totalSteps = Math.max(totalSteps, Number(page.numTotalSteps) || 0);
    }
    if (!chunk.length) break;
    allItems.push(...chunk);
    curOffset += chunk.length;
    if (totalGm !== null && curOffset >= totalGm) break;
  }
  return {
    numTotalSteps: totalSteps,
    numTotalGeneratorMetadata: totalGm !== null ? totalGm : allItems.length,
    trajectory: {
      cascadeId: id,
      steps: [],
      generatorMetadata: allItems,
    },
  };
}

export function discoverLocalAppConversations() {
  return discoverLocalConversations({ host: 'app' });
}

export function getDiscoveredSubagents(tel, scopeKey = 'local') {
  const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
  if (!tel._discoveredSubagentsByScope) return null;
  return tel._discoveredSubagentsByScope.get(safeScope) || null;
}

export function recordDiscoveredSubagents(tel, parentId, traj, parentWorkspace = '', scopeKey = 'local') {
  const steps = traj?.trajectory?.steps;
  if (!Array.isArray(steps) || !GUID_RE.test(String(parentId || ''))) return;
  const pid = String(parentId).toLowerCase();
  const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
  if (!tel._discoveredSubagentsByScope) tel._discoveredSubagentsByScope = new Map();
  let scopeMap = tel._discoveredSubagentsByScope.get(safeScope);
  if (!scopeMap) {
    scopeMap = new Map();
    tel._discoveredSubagentsByScope.set(safeScope, scopeMap);
    while (tel._discoveredSubagentsByScope.size > USAGE_CACHE_MAX_SCOPES) {
      tel._discoveredSubagentsByScope.delete(tel._discoveredSubagentsByScope.keys().next().value);
    }
  }
  const register = (rawChildId) => {
    const cid = String(rawChildId || '').toLowerCase();
    if (!GUID_RE.test(cid) || cid === pid) return;
    scopeMap.delete(cid);
    scopeMap.set(cid, { parentId: pid, workspace: String(parentWorkspace || '') });
    while (scopeMap.size > 512) {
      scopeMap.delete(scopeMap.keys().next().value);
    }
  };
  for (const s of steps) {
    const inv = s?.invokeSubagent;
    if (!inv || typeof inv !== 'object') continue;
    register(inv.conversationId);
    if (Array.isArray(inv.results)) {
      for (const r of inv.results) register(r?.conversationId);
    }
  }
}

export function rememberDiscoveredSubagentList(tel, items = [], scopeKey = 'local') {
  if (!Array.isArray(items) || items.length === 0) return;
  const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
  if (!tel._discoveredSubagentsByScope) tel._discoveredSubagentsByScope = new Map();
  let scopeMap = tel._discoveredSubagentsByScope.get(safeScope);
  if (!scopeMap) {
    scopeMap = new Map();
    tel._discoveredSubagentsByScope.set(safeScope, scopeMap);
    while (tel._discoveredSubagentsByScope.size > USAGE_CACHE_MAX_SCOPES) {
      tel._discoveredSubagentsByScope.delete(tel._discoveredSubagentsByScope.keys().next().value);
    }
  }
  for (const raw of items) {
    const cid = String(typeof raw === 'string' ? raw : raw?.id || raw?.cascadeId || '').trim().toLowerCase();
    if (!GUID_RE.test(cid)) continue;
    const pid = String(typeof raw === 'object' && raw ? raw.parentId || raw.parentConversationId || '' : '').trim().toLowerCase();
    const prev = scopeMap.get(cid);
    scopeMap.delete(cid);
    scopeMap.set(cid, {
      ...(prev || {}),
      ...(GUID_RE.test(pid) && pid !== cid ? { parentId: pid } : {}),
    });
    while (scopeMap.size > 512) {
      scopeMap.delete(scopeMap.keys().next().value);
    }
  }
}

export async function fetchBackendTrajectorySummaries(tel, client, usageCore, force = false, ctx = null) {
  const now = Date.now();
  const entry = ctx?.entry || null;
  let scopeKey = resolveUsageScopeKey({ explicitScopeKey: ctx?.scopeKey, entry });
  const makeBucketKey = (sc) => (entry?.pageId ? `${sc}::${entry.pageId}` : sc);
  const initialBucketKey = makeBucketKey(scopeKey);
  if (!force && tel._backendSummariesCache instanceof Map) {
    const hit = tel._backendSummariesCache.get(initialBucketKey);
    if (hit && now - hit.at < 15000) {
      return hit.pack;
    }
  }
  try {
    const raw = await client.call('GetAllCascadeTrajectories', {});
    const mapOrList = raw?.trajectorySummaries || {};
    const entries = Array.isArray(mapOrList)
      ? mapOrList.map((sum) => [sum?.cascadeId || sum?.id || '', sum])
      : Object.entries(mapOrList);
    const list = [];
    const byId = new Map();
    const toSec = (v) => {
      if (!v) return 0;
      if (typeof usageCore?.tsSec === 'function') {
        const n = Number(usageCore.tsSec(v) || 0);
        if (n > 0) return Math.floor(n);
      }
      if (typeof v === 'object' && v.seconds !== undefined) return Math.max(0, Math.floor(Number(v.seconds) || 0));
      if (typeof v === 'string') {
        const ms = Date.parse(v);
        if (Number.isFinite(ms) && ms > 0) return Math.floor(ms / 1000);
      }
      return 0;
    };
    const extractWs = (sum) => {
      const wsArr = sum?.workspaces || sum?.trajectoryMetadata?.workspaces;
      const out = [];
      if (Array.isArray(wsArr)) {
        for (const w of wsArr) {
          const uri = String(w?.workspaceFolderAbsoluteUri || w?.gitRootAbsoluteUri || w?.uri || w?.path || '').trim();
          if (uri) out.push(uri);
        }
      }
      const single = String(sum?.workspaceUri || sum?.workspacePath || sum?.trajectoryMetadata?.workspaceUri || '').trim();
      if (single && !out.includes(single)) out.push(single);
      let workspace = '';
      if (out.length > 0) {
        try {
          const decoded = decodeURIComponent(out[0].replace(/^file:\/\//i, '')).replace(/[\\/]+$/, '');
          workspace = decoded.split(/[\\/]/).filter(Boolean).pop() || '';
        } catch {
          workspace = out[0].replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || '';
        }
      }
      return { workspace, workspaces: out };
    };

    for (const [rawId, sum] of entries) {
      const id = String(rawId || sum?.cascadeId || sum?.id || '').trim();
      if (!GUID_RE.test(id) || !sum || typeof sum !== 'object') continue;
      const meta = sum.trajectoryMetadata && typeof sum.trajectoryMetadata === 'object' ? sum.trajectoryMetadata : {};
      const rawParentId = String(
        sum.parentConversationId ||
          meta.parentConversationId ||
          sum.parentId ||
          sum.parentCascadeId ||
          sum.parentTrajectoryId ||
          meta.parentCascadeId ||
          meta.parentTrajectoryId ||
          ''
      ).trim();
      const lowId = id.toLowerCase();
      const parentId = rawParentId && rawParentId.toLowerCase() !== lowId ? rawParentId : '';
      const rawRootId = String(
        sum.rootConversationId || meta.rootConversationId || sum.rootId || sum.rootCascadeId || meta.rootCascadeId || ''
      ).trim();
      const rootId = rawRootId && rawRootId.toLowerCase() !== lowId ? rawRootId : '';
      const selfPoisonSum = Boolean(
        (rawParentId && rawParentId.toLowerCase() === lowId) ||
          (!parentId && rawRootId && rawRootId.toLowerCase() === lowId)
      );
      const subagent = Boolean(
        (typeof usageCore?.isSubagentSummary === 'function' && usageCore.isSubagentSummary(sum, id)) ||
          parentId ||
          rootId ||
          Number(meta.nestingDepth || sum.nestingDepth || 0) > 0 ||
          (!selfPoisonSum && sum.subagent === true) ||
          sum.isSubagent === true ||
          meta.isSubagent === true ||
          sum.subagentName ||
          meta.subagentName ||
          sum.swarmId ||
          meta.swarmId
      );
      const stepCount = Math.max(0, Number(sum.stepCount ?? sum.numTotalSteps ?? 0) || 0);
      const lastModifiedSec = toSec(sum.lastModifiedTime || sum.modifiedAt || sum.updatedAt);
      const createdSec = toSec(sum.createdTime || sum.createdAt) || lastModifiedSec;
      const { workspace, workspaces } = extractWs(sum);
      const item = {
        id,
        stepCount,
        lastModifiedSec,
        createdSec,
        subagent,
        ...(parentId ? { parentId } : {}),
        ...(rootId ? { rootId } : {}),
        ...(workspace ? { workspace } : {}),
        ...(workspaces.length ? { workspaces } : {}),
        title: String(sum.summary || sum.title || '').slice(0, 140),
        status: String(sum.status || ''),
      };
      list.push(item);
      byId.set(id.toLowerCase(), item);
    }

    if (scopeKey === 'local') {
      const inferredScope = resolveUsageScopeKey({
        explicitScopeKey: raw?._scopeHint || entry?.detectedScopeKey || '',
        entry,
        summaries: list,
      });
      if (inferredScope && inferredScope !== 'local') {
        scopeKey = inferredScope;
        if (entry && typeof entry === 'object') {
          entry.detectedScopeKey = scopeKey;
          entry._usageScopeVerified = true;
        }
      } else if (entry && typeof entry === 'object') {
        const hasExplicitLocalHint = normalizeUsageScopeKey(raw?._scopeHint || '') === 'local';
        const hasLocalFileWs = list.some(
          (it) =>
            Array.isArray(it.workspaces) &&
            it.workspaces.some((u) => /^file:\/\//i.test(String(u || '')) || /^[a-z]:[\\/]/i.test(String(u || '')))
        );
        if (hasExplicitLocalHint || hasLocalFileWs) {
          entry._usageScopeVerified = true;
        }
      }
    } else if (entry && typeof entry === 'object') {
      entry._usageScopeVerified = true;
    }

    if (client?.server?.mode === 'renderer-proxy') {
      const subMap = getDiscoveredSubagents(tel, scopeKey);
      const allowLocalDiskScan = scopeKey === 'local' && (!entry || entry._usageScopeVerified === true);
      if (allowLocalDiskScan) {
        try {
          const diskCache = getUsageDiskCacheScope(tel, scopeKey, false);
          const localRes = await tel.discoverLocalAppConversations();
          const coldCandidates = [];
          for (const localEntry of localRes?.conversations || []) {
            const lid = String(localEntry?.id || '').toLowerCase();
            if (!GUID_RE.test(lid)) continue;
            const hasDbMtime = Number.isFinite(localEntry?.dbMtimeMs) && localEntry.dbMtimeMs > 0;
            const rawMtimeMs = hasDbMtime
              ? localEntry.dbMtimeMs
              : Number.isFinite(localEntry?.mtimeMs)
              ? localEntry.mtimeMs
              : 0;
            const mtimeSec = rawMtimeMs > 0 ? Math.floor(rawMtimeMs / 1000) : 0;
            const dbSize = Number.isFinite(localEntry?.dbSize) && localEntry.dbSize > 0 ? Math.floor(localEntry.dbSize) : 0;
            const knownSub = subMap?.get(lid) || null;
            const diskHit = diskCache.get(lid) || null;

            const diskUnchanged = Boolean(
              diskHit &&
                diskHit.record?.days &&
                ((diskHit.dbMtimeSec > 0 &&
                  diskHit.dbSize > 0 &&
                  mtimeSec > 0 &&
                  dbSize > 0 &&
                  diskHit.dbMtimeSec === mtimeSec &&
                  diskHit.dbSize === dbSize) ||
                  (dbSize === 0 && diskHit.lastModifiedSec > 0 && mtimeSec > 0 && diskHit.lastModifiedSec === mtimeSec) ||
                  (!diskHit.dbSize && diskHit.lastModifiedSec > 0 && mtimeSec > 0 && mtimeSec <= diskHit.lastModifiedSec))
            );

            const existingItem = byId.get(lid);
            if (existingItem) {
              if (mtimeSec > 0 && !existingItem.dbMtimeSec) existingItem.dbMtimeSec = mtimeSec;
              if (dbSize > 0 && !existingItem.dbSize) existingItem.dbSize = dbSize;
              const sameRpcMod = Boolean(
                diskHit &&
                  diskHit.record?.days &&
                  existingItem.lastModifiedSec > 0 &&
                  diskHit.lastModifiedSec === existingItem.lastModifiedSec &&
                  (diskHit.stepCount > 0 || hasRealUsageRecord(diskHit.record))
              );
              if (existingItem.stepCount === 0 && (diskUnchanged || sameRpcMod)) {
                existingItem.stepCount = Math.max(0, Number(diskHit.stepCount || diskHit.record?.stepCount || 0));
                existingItem.diskUnchanged = true;
              }
              continue;
            }

            if (diskUnchanged) {
              const cleanDiskRec = sanitizeUsageRecord(lid, diskHit.record);
              const rawCachedPid = String(knownSub?.parentId || cleanDiskRec?.parentId || '').trim();
              const safeCachedPid = rawCachedPid && rawCachedPid.toLowerCase() !== lid ? rawCachedPid : '';
              const cachedItem = {
                id: lid,
                stepCount: Math.max(0, Number(diskHit.stepCount || cleanDiskRec?.stepCount || 0)),
                lastModifiedSec: Number(diskHit.lastModifiedSec || mtimeSec),
                createdSec: Number(diskHit.lastModifiedSec || mtimeSec),
                ...(mtimeSec > 0 ? { dbMtimeSec: mtimeSec } : {}),
                ...(dbSize > 0 ? { dbSize } : {}),
                diskUnchanged: true,
                subagent: Boolean(knownSub || cleanDiskRec?.subagent),
                ...(safeCachedPid ? { parentId: safeCachedPid } : {}),
                ...(knownSub?.workspace || cleanDiskRec?.workspace ? { workspace: knownSub?.workspace || cleanDiskRec?.workspace } : {}),
                title: '',
                status: '',
              };
              list.push(cachedItem);
              byId.set(lid, cachedItem);
            } else {
              coldCandidates.push({ lid, mtimeSec, dbSize, knownSub });
            }
          }
          coldCandidates.sort((a, b) => (b.mtimeSec || 0) - (a.mtimeSec || 0));
          for (let i = 0; i < coldCandidates.length; i += 1) {
            const { lid, mtimeSec, dbSize, knownSub } = coldCandidates[i];
            const isDormant = i >= LOCAL_COLD_WAKEUP_CAP;
            const localItem = {
              id: lid,
              stepCount: 0,
              lastModifiedSec: mtimeSec,
              createdSec: mtimeSec,
              ...(mtimeSec > 0 ? { dbMtimeSec: mtimeSec } : {}),
              ...(dbSize > 0 ? { dbSize } : {}),
              ...(isDormant ? { dormant: true } : {}),
              subagent: Boolean(knownSub),
              ...(knownSub?.parentId ? { parentId: knownSub.parentId } : {}),
              ...(knownSub?.workspace ? { workspace: knownSub.workspace } : {}),
              title: '',
              status: '',
            };
            list.push(localItem);
            byId.set(lid, localItem);
          }
        } catch {}
      }
      if (subMap && subMap.size > 0) {
        for (const item of list) {
          const info = subMap.get(item.id.toLowerCase());
          if (!info) continue;
          if (!item.subagent) item.subagent = true;
          if (!item.parentId && info.parentId) item.parentId = info.parentId;
          if (!item.workspace && info.workspace) item.workspace = info.workspace;
        }
      }
      list.sort((a, b) => (b.lastModifiedSec || 0) - (a.lastModifiedSec || 0));
    }

    const pack = { list, byId, scopeKey };
    if (!(tel._backendSummariesCache instanceof Map)) {
      tel._backendSummariesCache = new Map();
    }
    const finalBucketKey = makeBucketKey(scopeKey);
    tel._backendSummariesCache.delete(finalBucketKey);
    tel._backendSummariesCache.set(finalBucketKey, { pack, at: now });
    while (tel._backendSummariesCache.size > 32) {
      tel._backendSummariesCache.delete(tel._backendSummariesCache.keys().next().value);
    }
    tel._backendSummariesAt = now;
    return pack;
  } catch {
    return { list: [], byId: new Map(), scopeKey };
  }
}

export async function fetchUsageRollupBatch(tel, rawItems, opts = {}) {
  const usageCore = require(path.join(tel._rootDir, 'usage-core.js'));
  const entry = opts?.entry || null;
  const action = opts?.action || 'fetch-batch';
  const wantSummaries = action === 'list-summaries' || Boolean(opts?.includeSummaries);
  let scopeKey = resolveUsageScopeKey({
    explicitScopeKey: opts?.scopeKey || '',
    entry,
    items: Array.isArray(rawItems) ? rawItems : null,
  });
  const routeState = { owner: tel, preferredEntry: entry, scopeKey };

  return RPC_ROUTE_STORAGE.run(routeState, async () => {
    const hasEntrySession = Boolean(entry && entry.session && !entry.session.closed);
    const entryScopeVerified = Boolean(entry && entry._usageScopeVerified === true);
    let client =
      hasEntrySession && (scopeKey !== 'local' || !entryScopeVerified)
        ? createScopedRendererClient(tel, entry, scopeKey, { strictEntry: !entryScopeVerified })
        : await tel.ensureLsClient();

    const backendPack = await fetchBackendTrajectorySummaries(tel, client, usageCore, action === 'list-summaries', {
      entry,
      scopeKey,
    });
    const resolvedScope = normalizeUsageScopeKey(backendPack?.scopeKey || '') || scopeKey;
    if (resolvedScope !== scopeKey) {
      scopeKey = resolvedScope;
      routeState.scopeKey = scopeKey;
      if (scopeKey !== 'local' && hasEntrySession && client?.server?.scopeKey !== scopeKey) {
        client = createScopedRendererClient(tel, entry, scopeKey);
      }
    }
    const allowDiskCache = !(hasEntrySession && scopeKey === 'local' && entry?._usageScopeVerified !== true);
    const diskCache = allowDiskCache ? getUsageDiskCacheScope(tel, scopeKey, false) : new Map();

    if (action === 'list-summaries') {
      const cachedRecords = [];
      const presentIds = new Set();
      for (const s of backendPack.list) {
        const sid = String(s?.id || '').trim();
        if (!sid) continue;
        const lowerId = sid.toLowerCase();
        presentIds.add(lowerId);
        const hit = diskCache.get(lowerId);
        if (hit?.record?.days) {
          cachedRecords.push({ id: sid, mode: 'full', record: sanitizeUsageRecord(sid, hit.record) });
        }
      }
      for (const [key, hit] of diskCache.entries()) {
        if (presentIds.has(key)) continue;
        if (hit?.record?.days && hasRealUsageRecord(hit.record)) {
          const cleanArchived = sanitizeUsageRecord(hit.record.cascadeId || key, hit.record);
          cachedRecords.push({ id: cleanArchived.cascadeId || key, mode: 'full', archived: true, record: cleanArchived });
        }
      }
      return { ok: true, scopeKey, records: cachedRecords, summaries: backendPack.list };
    }

    const list = Array.isArray(rawItems) ? rawItems.slice(0, 16) : [];
    if (list.length === 0) {
      return wantSummaries
        ? { ok: true, scopeKey, records: [], summaries: backendPack.list }
        : { ok: true, scopeKey, records: [] };
    }

    const records = [];
    for (const item of list) {
      const id = String(item?.id || '');
      if (!GUID_RE.test(id)) continue;
      const backendSum = backendPack.byId.get(id.toLowerCase()) || null;
      const stepCount = Math.max(0, Number(item.stepCount || backendSum?.stepCount || 0));
      const lastModifiedSec = Math.max(0, Number(item.lastModifiedSec || backendSum?.lastModifiedSec || 0));
      const createdSec = Math.max(0, Number(item.createdSec || backendSum?.createdSec || lastModifiedSec || 0));
      const itemDbMtimeSec = Math.max(0, Number(item.dbMtimeSec || backendSum?.dbMtimeSec || 0));
      const itemDbSize = Math.max(0, Number(item.dbSize || backendSum?.dbSize || 0));
      const diskMeta = itemDbMtimeSec > 0 || itemDbSize > 0 ? { dbMtimeSec: itemDbMtimeSec, dbSize: itemDbSize } : null;
      const lowId = id.toLowerCase();
      const rawItemPid = String(item.parentId || '').trim();
      const rawItemRid = String(item.rootId || '').trim();
      const itemSelfPoison = Boolean(
        (rawItemPid && rawItemPid.toLowerCase() === lowId) || (!rawItemPid && rawItemRid && rawItemRid.toLowerCase() === lowId)
      );
      const rawPid = String((itemSelfPoison ? '' : rawItemPid) || backendSum?.parentId || '').trim();
      const parentId = rawPid && rawPid.toLowerCase() !== lowId ? rawPid : '';
      const rawRid = String((itemSelfPoison ? '' : rawItemRid) || backendSum?.rootId || '').trim();
      const rootId = rawRid && rawRid.toLowerCase() !== lowId ? rawRid : '';
      const subagent = Boolean((itemSelfPoison ? false : item.subagent) || backendSum?.subagent || parentId || rootId);
      const workspace = String(item.workspace || backendSum?.workspace || '');
      const workspaces =
        Array.isArray(item.workspaces) && item.workspaces.length ? item.workspaces : backendSum?.workspaces || [];
      const gmOffset = Math.max(0, Math.floor(Number(item.gmOffset || 0)));
      const diskHit = diskCache.get(lowId) || null;
      if (!opts?.force && diskHit && diskHit.record?.days) {
        const hitByStepAndMtime =
          stepCount > 0 && lastModifiedSec > 0 && diskHit.stepCount === stepCount && diskHit.lastModifiedSec === lastModifiedSec;
        const hitByDbFingerprint =
          itemDbMtimeSec > 0 && itemDbSize > 0 && diskHit.dbMtimeSec === itemDbMtimeSec && diskHit.dbSize === itemDbSize;
        const hitByLegacyZeroStep =
          stepCount === 0 &&
          lastModifiedSec > 0 &&
          diskHit.lastModifiedSec === lastModifiedSec &&
          (diskHit.stepCount > 0 || hasRealUsageRecord(diskHit.record));
        if (hitByStepAndMtime || hitByDbFingerprint || hitByLegacyZeroStep) {
          const cleanHitRec = sanitizeUsageRecord(id, diskHit.record);
          records.push({
            id,
            mode: 'full',
            subagent: Boolean(cleanHitRec.subagent || subagent),
            ...(parentId ? { parentId } : {}),
            ...(workspace ? { workspace } : {}),
            record: cleanHitRec,
          });
          continue;
        }
      }
      const wsMeta = workspaces.map((uri) => ({ workspaceFolderAbsoluteUri: uri }));
      const summaryStub = {
        stepCount,
        lastModifiedTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : undefined,
        createdTime: createdSec > 0 ? { seconds: createdSec } : undefined,
        ...(parentId ? { parentConversationId: parentId, parentId } : {}),
        ...(rootId ? { rootConversationId: rootId, rootId } : {}),
        ...(wsMeta.length ? { workspaces: wsMeta } : {}),
        trajectoryMetadata: {
          ...(subagent ? { nestingDepth: 1 } : {}),
          ...(parentId ? { parentConversationId: parentId } : {}),
          ...(rootId ? { rootConversationId: rootId } : {}),
          ...(wsMeta.length ? { workspaces: wsMeta } : {}),
        },
      };
      try {
        if (client?.server?.mode === 'renderer-proxy' && typeof client.trajectory === 'function') {
          const fullTraj = await client.trajectory(id, { force: Boolean(opts?.force), summary: summaryStub });
          recordDiscoveredSubagents(tel, id, fullTraj, workspace, scopeKey);
          const allSteps = Array.isArray(fullTraj?.trajectory?.steps) ? fullTraj.trajectory.steps : [];
          const allGms = Array.isArray(fullTraj?.trajectory?.generatorMetadata) ? fullTraj.trajectory.generatorMetadata : [];
          const realStepCount = Math.max(stepCount, Number(fullTraj?.numTotalSteps || 0), allSteps.length);
          const totalGm = Math.max(Number(fullTraj?.numTotalGeneratorMetadata || 0), allGms.length);
          const firstStepTs = allSteps.find((s) => s?.metadata?.createdAt)?.metadata?.createdAt;
          let lastStepTs = null;
          for (let si = allSteps.length - 1; si >= 0; si -= 1) {
            const stepMeta = allSteps[si]?.metadata;
            if (stepMeta && (stepMeta.completedAt || stepMeta.createdAt)) {
              lastStepTs = allSteps[si];
              break;
            }
          }
          const realLastModSec =
            lastModifiedSec ||
            (lastStepTs ? Math.floor((Date.parse(lastStepTs.metadata.completedAt || lastStepTs.metadata.createdAt) || 0) / 1000) : 0);
          const realCreatedSec =
            (firstStepTs ? Math.floor((Date.parse(firstStepTs) || 0) / 1000) : 0) || createdSec || realLastModSec;
          const enrichedStub = {
            ...summaryStub,
            stepCount: realStepCount,
            ...(realLastModSec > 0 ? { lastModifiedTime: { seconds: realLastModSec } } : {}),
            ...(realCreatedSec > 0 ? { createdTime: { seconds: realCreatedSec } } : {}),
          };
          if (gmOffset > 0 && totalGm >= gmOffset) {
            const deltaItems = allGms.slice(gmOffset);
            const deltaRec = usageCore.analyzeTrajectoryForUsage(
              {
                numTotalSteps: realStepCount,
                numTotalGeneratorMetadata: totalGm,
                trajectory: { cascadeId: id, steps: allSteps, generatorMetadata: deltaItems },
              },
              enrichedStub,
              id
            );
            if (workspace && deltaRec && typeof deltaRec === 'object' && !deltaRec.workspace) deltaRec.workspace = workspace;
            if (parentId && deltaRec && typeof deltaRec === 'object' && !deltaRec.parentId) deltaRec.parentId = parentId;
            if (allowDiskCache && diskHit?.record?.days && typeof usageCore.mergeUsageRecordDelta === 'function') {
              const effSteps = Math.max(stepCount, realStepCount);
              const effModSec = Math.max(lastModifiedSec, realLastModSec);
              const merged = usageCore.mergeUsageRecordDelta(sanitizeUsageRecord(id, diskHit.record), deltaRec, {
                cascadeId: id,
                stepCount: effSteps,
                lastModifiedSec: effModSec,
                gmCount: totalGm,
                subagent,
                workspace,
                parentId,
              });
              putUsageDiskCache(tel, id, effSteps, effModSec, merged, scopeKey, diskMeta);
            }
            records.push({
              id,
              mode: 'delta',
              gmCount: totalGm,
              stepCount: realStepCount,
              lastModifiedSec: realLastModSec,
              subagent,
              ...(parentId ? { parentId } : {}),
              ...(workspace ? { workspace } : {}),
              delta: deltaRec,
            });
          } else {
            const fullRec = usageCore.analyzeTrajectoryForUsage(fullTraj, enrichedStub, id);
            if (workspace && fullRec && typeof fullRec === 'object' && !fullRec.workspace) fullRec.workspace = workspace;
            if (parentId && fullRec && typeof fullRec === 'object' && !fullRec.parentId) fullRec.parentId = parentId;
            if (diskMeta?.dbMtimeSec > 0 && fullRec && typeof fullRec === 'object') fullRec.dbMtimeSec = diskMeta.dbMtimeSec;
            if (diskMeta?.dbSize > 0 && fullRec && typeof fullRec === 'object') fullRec.dbSize = diskMeta.dbSize;
            if (allowDiskCache) {
              putUsageDiskCache(tel, id, Math.max(stepCount, realStepCount), Math.max(lastModifiedSec, realLastModSec), fullRec, scopeKey, diskMeta);
            }
            records.push({
              id,
              mode: 'full',
              subagent,
              ...(parentId ? { parentId } : {}),
              ...(workspace ? { workspace } : {}),
              record: fullRec,
            });
          }
        } else if (gmOffset > 0) {
          const deltaItems = [];
          let curOffset = gmOffset;
          let totalGm = null;
          while (true) {
            const page = await client.call('GetCascadeTrajectoryGeneratorMetadata', {
              cascadeId: id,
              generatorMetadataOffset: curOffset,
              includeMessages: false,
            });
            const chunk = page?.generatorMetadata || page?.generatorMetadatas || [];
            if (page?.numTotalGeneratorMetadata !== undefined && page?.numTotalGeneratorMetadata !== null) {
              totalGm = Number(page.numTotalGeneratorMetadata);
            }
            if (!chunk.length) break;
            deltaItems.push(...chunk);
            curOffset += chunk.length;
            if (totalGm !== null && curOffset >= totalGm) break;
          }
          if (totalGm !== null && totalGm < gmOffset) {
            const fullMeta = await fetchFullGeneratorMetadata(client, id);
            const realStepCount = Math.max(stepCount, Number(fullMeta?.numTotalSteps || 0));
            const fullRec = usageCore.analyzeTrajectoryForUsage(fullMeta, { ...summaryStub, stepCount: realStepCount }, id);
            if (workspace && fullRec && typeof fullRec === 'object' && !fullRec.workspace) fullRec.workspace = workspace;
            if (parentId && fullRec && typeof fullRec === 'object' && !fullRec.parentId) fullRec.parentId = parentId;
            if (diskMeta?.dbMtimeSec > 0 && fullRec && typeof fullRec === 'object') fullRec.dbMtimeSec = diskMeta.dbMtimeSec;
            if (diskMeta?.dbSize > 0 && fullRec && typeof fullRec === 'object') fullRec.dbSize = diskMeta.dbSize;
            if (allowDiskCache) putUsageDiskCache(tel, id, realStepCount, lastModifiedSec, fullRec, scopeKey, diskMeta);
            records.push({
              id,
              mode: 'full',
              subagent,
              ...(parentId ? { parentId } : {}),
              ...(workspace ? { workspace } : {}),
              record: fullRec,
            });
          } else {
            const nextGmCount = totalGm !== null ? Math.max(gmOffset + deltaItems.length, totalGm) : gmOffset + deltaItems.length;
            const deltaSummary = {
              stepCount,
              lastModifiedTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : { seconds: Math.floor(Date.now() / 1000) },
              createdTime: lastModifiedSec > 0 ? { seconds: lastModifiedSec } : undefined,
              ...(parentId ? { parentConversationId: parentId, parentId } : {}),
              ...(rootId ? { rootConversationId: rootId, rootId } : {}),
              ...(wsMeta.length ? { workspaces: wsMeta } : {}),
              trajectoryMetadata: {
                ...(subagent ? { nestingDepth: 1 } : {}),
                ...(parentId ? { parentConversationId: parentId } : {}),
                ...(rootId ? { rootConversationId: rootId } : {}),
                ...(wsMeta.length ? { workspaces: wsMeta } : {}),
              },
            };
            const deltaRec = usageCore.analyzeTrajectoryForUsage(
              { numTotalSteps: stepCount, numTotalGeneratorMetadata: nextGmCount, trajectory: { cascadeId: id, steps: [], generatorMetadata: deltaItems } },
              deltaSummary,
              id
            );
            if (workspace && deltaRec && typeof deltaRec === 'object' && !deltaRec.workspace) deltaRec.workspace = workspace;
            if (parentId && deltaRec && typeof deltaRec === 'object' && !deltaRec.parentId) deltaRec.parentId = parentId;
            if (allowDiskCache && diskHit?.record?.days && typeof usageCore.mergeUsageRecordDelta === 'function') {
              const merged = usageCore.mergeUsageRecordDelta(sanitizeUsageRecord(id, diskHit.record), deltaRec, {
                cascadeId: id,
                stepCount,
                lastModifiedSec,
                gmCount: nextGmCount,
                subagent,
                workspace,
                parentId,
              });
              putUsageDiskCache(tel, id, stepCount, lastModifiedSec, merged, scopeKey, diskMeta);
            }
            records.push({
              id,
              mode: 'delta',
              gmCount: nextGmCount,
              stepCount,
              lastModifiedSec,
              subagent,
              ...(parentId ? { parentId } : {}),
              ...(workspace ? { workspace } : {}),
              delta: deltaRec,
            });
          }
        } else {
          const fullMeta = await fetchFullGeneratorMetadata(client, id);
          const realStepCount = Math.max(stepCount, Number(fullMeta?.numTotalSteps || 0));
          const fullRec = usageCore.analyzeTrajectoryForUsage(fullMeta, { ...summaryStub, stepCount: realStepCount }, id);
          if (workspace && fullRec && typeof fullRec === 'object' && !fullRec.workspace) fullRec.workspace = workspace;
          if (parentId && fullRec && typeof fullRec === 'object' && !fullRec.parentId) fullRec.parentId = parentId;
          if (diskMeta?.dbMtimeSec > 0 && fullRec && typeof fullRec === 'object') fullRec.dbMtimeSec = diskMeta.dbMtimeSec;
          if (diskMeta?.dbSize > 0 && fullRec && typeof fullRec === 'object') fullRec.dbSize = diskMeta.dbSize;
          if (allowDiskCache) putUsageDiskCache(tel, id, realStepCount, lastModifiedSec, fullRec, scopeKey, diskMeta);
          records.push({
            id,
            mode: 'full',
            subagent,
            ...(parentId ? { parentId } : {}),
            ...(workspace ? { workspace } : {}),
            record: fullRec,
          });
        }
      } catch (err) {
        records.push({ id, mode: 'error', error: sanitizeSecretText(err?.message || 'fetch failed') });
      }
    }
    return wantSummaries ? { ok: true, scopeKey, records, summaries: backendPack.list } : { ok: true, scopeKey, records };
  });
}
