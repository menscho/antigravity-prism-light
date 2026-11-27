// Obsidian Prism 遥测 Scope 归一化、远程环境隔离与 Renderer LS-RPC 路由纯函数（无原型 Mixin，供 TelemetrySubsystem 调用）
import {
  buildRendererRpcExpression,
  buildRendererRpcCallExpression,
  extractModelLabelMap,
  normalizeRendererUserStatus,
  normalizeRendererQuotaSummary,
  normalizeRendererSummaries,
  normalizeRendererTrajectory,
} from '../../vendor/pulse-dashboard/sidecars/panel/renderer-rpc-adapter.mjs';
import { FORBIDDEN_SCOPE_SEGMENTS, RPC_ROUTE_STORAGE } from './constants.mjs';

function sanitizeScopeSegment(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {}
  if (/^[0-9a-f]{8,}$/i.test(s) && s.length % 2 === 0 && s.length <= 512) {
    try {
      const decoded = Buffer.from(s, 'hex').toString('utf8');
      if (decoded.startsWith('{') && decoded.endsWith('}')) {
        const parsed = JSON.parse(decoded);
        const hostCand = parsed?.hostName || parsed?.host || parsed?.authority || '';
        if (typeof hostCand === 'string' && hostCand.trim()) s = hostCand.trim();
      }
    } catch {}
  }
  const clean = s
    .toLowerCase()
    .replace(/[^a-z0-9._:@-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!clean || FORBIDDEN_SCOPE_SEGMENTS.has(clean)) return '';
  return clean;
}

export function extractScopeKeyFromUri(rawUri) {
  let s = String(rawUri || '').trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {}
  const qm = s.match(/[?&#]remoteAuthority=([^&#\s]+)/i);
  const candidate = qm && qm[1] ? qm[1] : s;
  const sshMatch = candidate.match(/(?:^|vscode-remote:\/\/)ssh-remote\+([^/&#?\s]+)/i);
  if (sshMatch && sshMatch[1]) {
    const host = sanitizeScopeSegment(sshMatch[1]);
    return host ? `ssh:${host}` : '';
  }
  const remoteMatch = candidate.match(/(?:^|vscode-remote:\/\/)([a-z0-9_-]+)\+([^/&#?\s]+)/i);
  if (remoteMatch && remoteMatch[1] && remoteMatch[2]) {
    const kind = sanitizeScopeSegment(remoteMatch[1]);
    const target = sanitizeScopeSegment(remoteMatch[2]);
    if (kind === 'ssh-remote') return target ? `ssh:${target}` : '';
    const combined = sanitizeScopeSegment(`${kind}-${target}`);
    return combined ? `remote:${combined}` : '';
  }
  return '';
}

export function extractScopeKeyFromTitle(rawTitle) {
  const s = String(rawTitle || '').trim();
  if (!s) return '';
  const sshMatch = s.match(/\[SSH:\s*([^\]]+)\]/i);
  if (sshMatch && sshMatch[1]) {
    const host = sanitizeScopeSegment(sshMatch[1]);
    return host ? `ssh:${host}` : '';
  }
  const remMatch = s.match(/\[(WSL|Dev Container|Codespaces|Tunnel|Remote):\s*([^\]]+)\]/i);
  if (remMatch && remMatch[1] && remMatch[2]) {
    const combined = sanitizeScopeSegment(`${remMatch[1]}-${remMatch[2]}`);
    return combined ? `remote:${combined}` : '';
  }
  return '';
}

export function normalizeUsageScopeKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (low === 'local') return 'local';
  if (low.startsWith('ssh:')) {
    const host = sanitizeScopeSegment(s.slice(4));
    return host ? `ssh:${host}` : '';
  }
  if (low.startsWith('remote:')) {
    const id = sanitizeScopeSegment(s.slice(7));
    return id ? `remote:${id}` : '';
  }
  const fromUri = extractScopeKeyFromUri(s);
  if (fromUri) return fromUri;
  const fromTitle = extractScopeKeyFromTitle(s);
  if (fromTitle) return fromTitle;
  return '';
}

export function inferRemoteScopeFromSummariesOrItems(records) {
  if (!Array.isArray(records) || records.length === 0) return '';
  let remoteScope = '';
  let remoteCount = 0;
  let localFileCount = 0;
  for (const item of records) {
    if (!item || typeof item !== 'object') continue;
    const uris = [];
    if (Array.isArray(item.workspaces)) {
      for (const w of item.workspaces) {
        if (typeof w === 'string' && w) uris.push(w);
        else if (w && typeof w === 'object') {
          const u = w.workspaceFolderAbsoluteUri || w.gitRootAbsoluteUri || w.uri || w.path || '';
          if (u) uris.push(String(u));
        }
      }
    }
    for (const single of [item.workspaceUri, item.workspacePath, item.workspace]) {
      if (typeof single === 'string' && single) uris.push(single);
    }
    let itemRemote = '';
    let itemLocal = false;
    for (const u of uris) {
      const sc = extractScopeKeyFromUri(u);
      if (sc) {
        itemRemote = sc;
        break;
      }
      if (/^file:\/\//i.test(u) || /^[a-z]:[\\/]/i.test(u)) {
        itemLocal = true;
      }
    }
    if (itemRemote) {
      if (!remoteScope) remoteScope = itemRemote;
      remoteCount += 1;
    } else if (itemLocal) {
      localFileCount += 1;
    }
  }
  if (remoteScope && remoteCount > 0 && remoteCount >= localFileCount) {
    return remoteScope;
  }
  return '';
}

export function resolveUsageScopeKey({ explicitScopeKey = '', entry = null, items = null, summaries = null } = {}) {
  const explicit = normalizeUsageScopeKey(explicitScopeKey);
  if (explicit && explicit !== 'local') return explicit;
  if (entry && typeof entry === 'object') {
    const fromDetected = normalizeUsageScopeKey(entry.detectedScopeKey || entry.scopeKey || '');
    if (fromDetected && fromDetected !== 'local') return fromDetected;
    const fromUrl = extractScopeKeyFromUri(entry.url);
    if (fromUrl) return fromUrl;
    const fromTitle = extractScopeKeyFromTitle(entry.title);
    if (fromTitle) return fromTitle;
  }
  const fromItems = inferRemoteScopeFromSummariesOrItems(items);
  if (fromItems) return fromItems;
  const fromSums = inferRemoteScopeFromSummariesOrItems(summaries);
  if (fromSums) return fromSums;
  if (explicit === 'local') return 'local';
  return 'local';
}

export function sanitizeUsageRecord(id, record) {
  if (!record || typeof record !== 'object') return record;
  const self = String(id || record.cascadeId || '').trim().toLowerCase();
  if (!self) return record;
  const pid = String(record.parentId || '').trim().toLowerCase();
  const rid = String(record.rootId || '').trim().toLowerCase();
  const rcid = String(record.rootConversationId || '').trim().toLowerCase();
  const selfParent = Boolean(pid && pid === self);
  const selfRoot = Boolean(rid && rid === self);
  const selfRootConv = Boolean(rcid && rcid === self);
  if (!selfParent && !selfRoot && !selfRootConv) return record;
  const clean = { ...record };
  if (selfParent) clean.parentId = '';
  if (selfRoot) delete clean.rootId;
  if (selfRootConv) delete clean.rootConversationId;
  if (!String(clean.parentId || '').trim()) clean.subagent = false;
  return clean;
}

export function hasRealUsageRecord(record) {
  if (!record || typeof record !== 'object' || !record.days || typeof record.days !== 'object') return false;
  if (Number(record.calls || 0) > 0) return true;
  for (const d of Object.values(record.days)) {
    if (!d || typeof d !== 'object') continue;
    if (Number(d.total || d.tokens || 0) > 0 || Number(d.calls || 0) > 0) return true;
  }
  return false;
}

export function resolveEntryScopeKey(entry) {
  if (!entry || typeof entry !== 'object') return 'local';
  return resolveUsageScopeKey({ entry });
}

export function getRendererRpcCandidates(tel, opts = null) {
  const preferredEntry = opts?.preferredEntry || null;
  const explicitScope = normalizeUsageScopeKey(opts?.scopeKey || '');
  const preferredValid = Boolean(
    preferredEntry &&
      preferredEntry.session &&
      !preferredEntry.session.closed &&
      !/^(?:devtools|chrome-extension|chrome|about):/i.test(String(preferredEntry.url || ''))
  );
  if (opts?.strictEntry === true) {
    return preferredValid ? [preferredEntry] : [];
  }
  const targetScope = explicitScope || (preferredValid ? resolveEntryScopeKey(preferredEntry) : '');
  const out = [];
  if (preferredValid) out.push(preferredEntry);
  const others = [];
  const sessions = tel._getSessions();
  if (sessions && typeof sessions.values === 'function') {
    for (const entry of sessions.values()) {
      if (!entry || entry === preferredEntry || !entry.session || entry.session.closed) continue;
      const url = String(entry.url || '');
      if (/^(?:devtools|chrome-extension|chrome|about):/i.test(url)) continue;
      const entryScope = resolveEntryScopeKey(entry);
      if (targetScope && entryScope !== targetScope) continue;
      const isLocalHost = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(url);
      const isLocalScope = entryScope === 'local';
      others.push({
        entry,
        score: (isLocalScope ? 4 : 0) + (isLocalHost ? 2 : 0) + (entry.healthyStreak > 0 ? 1 : 0),
      });
    }
  }
  others.sort((a, b) => b.score - a.score);
  for (const x of others) out.push(x.entry);
  return out;
}

export function createScopedRendererClient(tel, entry, scopeKey, extraOpts = null) {
  const safeScope = normalizeUsageScopeKey(scopeKey) || 'local';
  const routeOpts = {
    preferredEntry: entry,
    scopeKey: safeScope,
    ...(extraOpts?.strictEntry ? { strictEntry: true } : {}),
  };
  const isSettledStatus = (st) =>
    st === 1 ||
    st === 'CASCADE_RUN_STATUS_1' ||
    /IDLE|DONE|COMPLETED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR/i.test(String(st || ''));
  const buildSummaryStamp = (summary) => {
    if (!summary || typeof summary !== 'object') return '';
    const lm = summary.lastModifiedTime;
    const lmStr =
      typeof lm === 'string' || typeof lm === 'number' || typeof lm === 'bigint'
        ? String(lm)
        : lm && typeof lm === 'object'
          ? `${lm.seconds ?? ''}:${lm.nanos ?? 0}`
          : '';
    const sc = summary.stepCount ?? summary.numTotalSteps ?? '';
    return lmStr || sc !== '' ? `${lmStr}|${sc}` : '';
  };
  return {
    server: { port: 0, csrf: '', pid: 0, mode: 'renderer-proxy', scopeKey: safeScope },
    call: (method, body = {}) => tel.invokeRendererLsRpc(method, body, routeOpts),
    trajectory: (cascadeId, trajOpts = null) => {
      const cid = String(cascadeId || '').trim().toLowerCase();
      if (!cid) return tel.invokeRendererLsRpc('GetCascadeTrajectory', { cascadeId }, routeOpts);
      const bypassCache = Boolean(trajOpts && typeof trajOpts === 'object' && (trajOpts.force || trajOpts.freshContext));
      const sumStamp = buildSummaryStamp(trajOpts?.summary || null);
      const cacheKey = `${safeScope}::${entry?.pageId || ''}::${cid}`;
      if (!(tel._scopedTrajCache instanceof Map)) tel._scopedTrajCache = new Map();
      if (!(tel._scopedTrajInFlight instanceof Map)) tel._scopedTrajInFlight = new Map();
      const now = Date.now();
      if (!bypassCache) {
        const hit = tel._scopedTrajCache.get(cacheKey);
        if (hit) {
          const stampChanged = Boolean(sumStamp && hit.sumStamp && sumStamp !== hit.sumStamp);
          const ttl = isSettledStatus(hit.data?.status) ? 20000 : 4000;
          if (!stampChanged && now - hit.at < ttl) {
            return Promise.resolve(hit.data);
          }
        }
        const inFlight = tel._scopedTrajInFlight.get(cacheKey);
        if (inFlight) return inFlight;
      }
      const req = tel
        .invokeRendererLsRpc('GetCascadeTrajectory', { cascadeId }, routeOpts)
        .then((data) => {
          tel._scopedTrajCache.delete(cacheKey);
          tel._scopedTrajCache.set(cacheKey, { at: Date.now(), data, sumStamp });
          while (tel._scopedTrajCache.size > 32) {
            tel._scopedTrajCache.delete(tel._scopedTrajCache.keys().next().value);
          }
          return data;
        })
        .finally(() => {
          if (tel._scopedTrajInFlight.get(cacheKey) === req) {
            tel._scopedTrajInFlight.delete(cacheKey);
          }
        });
      tel._scopedTrajInFlight.set(cacheKey, req);
      return req;
    },
  };
}

export async function evalRendererRpcOnEntry(entry, method, body = {}, timeoutMs = 12000, { useSend = false } = {}) {
  const docGen = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : 0;
  const runEval = async (expression) => {
    if (useSend) {
      const evalRes = await entry.session.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        timeoutMs
      );
      return evalRes?.result?.value;
    }
    return entry.session.evaluate(expression, true, timeoutMs);
  };
  if (entry._rendererRpcInstalledDocGen === docGen) {
    const fastRes = await runEval(buildRendererRpcCallExpression(method, body));
    if (!fastRes || fastRes.needInstall !== true) {
      return fastRes;
    }
    entry._rendererRpcInstalledDocGen = -1;
  }
  const fullRes = await runEval(buildRendererRpcExpression(method, body));
  const currentDocGen = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : 0;
  if (fullRes && fullRes.ok === true && currentDocGen === docGen) {
    entry._rendererRpcInstalledDocGen = docGen;
  }
  return fullRes;
}

export function resolveActiveRpcScope(tel) {
  const asyncCtx = RPC_ROUTE_STORAGE.getStore();
  if (asyncCtx && asyncCtx.owner === tel) {
    const sc =
      normalizeUsageScopeKey(asyncCtx.scopeKey || '') ||
      (asyncCtx.preferredEntry ? resolveEntryScopeKey(asyncCtx.preferredEntry) : '');
    return sc || 'local';
  }
  return 'local';
}

export async function invokeRendererLsRpc(tel, method, body = {}, opts = null) {
  let effectiveBody = body;
  if (method === 'RetrieveUserQuotaSummary' && tel._quotaForceRefreshGuard) {
    const decision = tel._quotaForceRefreshGuard.prepare(body);
    if (decision.action === 'cached') return decision.result;
    effectiveBody = decision.body;
  }
  const asyncCtx = RPC_ROUTE_STORAGE.getStore();
  const routeOpts = opts || (asyncCtx && asyncCtx.owner === tel ? asyncCtx : null);
  const candidates = tel.getRendererRpcCandidates(routeOpts);
  if (!candidates.length) {
    throw new Error('等待 Antigravity 主窗口连接');
  }
  const timeoutMs = method === 'Probe' ? 2600 : 12000;
  let lastErr = null;
  for (const entry of candidates) {
    try {
      const res = await evalRendererRpcOnEntry(entry, method, effectiveBody, timeoutMs, { useSend: false });
      if (!res || res.ok !== true) {
        lastErr = new Error(String(res?.error || 'renderer_ls_unavailable'));
        continue;
      }
      const raw = res.data;
      if (method === 'Probe') return raw;
      if (method === 'GetUserStatus') {
        const normalized = normalizeRendererUserStatus(raw);
        const labels = extractModelLabelMap(normalized);
        if (labels.size > 0) {
          if (!tel._rendererModelLabels) tel._rendererModelLabels = new Map();
          for (const [k, v] of labels.entries()) {
            if (tel._rendererModelLabels.size >= 256 && !tel._rendererModelLabels.has(k)) break;
            tel._rendererModelLabels.set(k, v);
          }
        }
        return normalized;
      }
      if (method === 'RetrieveUserQuotaSummary') {
        const normalized = normalizeRendererQuotaSummary(raw);
        tel._quotaForceRefreshGuard?.recordSuccess(normalized);
        return normalized;
      }
      if (method === 'GetAllCascadeTrajectories') {
        const scopeHint = normalizeUsageScopeKey(raw?.scopeHint || '');
        const normalized = normalizeRendererSummaries(raw);
        const inferredRemote =
          (scopeHint && scopeHint !== 'local' ? scopeHint : '') ||
          inferRemoteScopeFromSummariesOrItems(Object.values(normalized?.trajectorySummaries || {}));
        if (inferredRemote) {
          entry.detectedScopeKey = inferredRemote;
          entry._usageScopeVerified = true;
          if (routeOpts?.scopeKey === 'local' && !routeOpts?.preferredEntry) {
            lastErr = new Error('renderer_scope_mismatch');
            continue;
          }
        }
        if (scopeHint) {
          Object.defineProperty(normalized, '_scopeHint', {
            value: scopeHint,
            enumerable: false,
            configurable: true,
          });
        }
        return normalized;
      }
      if (method === 'GetCascadeTrajectory') {
        return normalizeRendererTrajectory(raw, body?.cascadeId, tel._rendererModelLabels || null);
      }
      return raw;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Antigravity 渲染器遥测通道暂不可用');
}
