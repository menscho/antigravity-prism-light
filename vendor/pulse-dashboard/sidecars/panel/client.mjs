// Upstream: ATtacK030130/antigrative-dashboard v0.9.1 (MIT License — Copyright (c) 2026 AG Pulse contributors)
// Integrated & adapted for Obsidian Prism under GPL-3.0-only compatibility terms.
// Enhanced with cdpPort multi-instance lineage resolution and backward-compatible _fetchMetadataOnly().
import { readFile, stat } from 'node:fs/promises';
import { request, Agent as HttpAgent } from 'node:http';
import { setImmediate as yieldStream } from 'node:timers/promises';
import { platformPaths } from '../../compat/platform.mjs';
import { discoverProcesses, httpLogPorts, extractHubPort } from './discovery.mjs';
import { TrajectoryJson } from './trajectory-json.mjs';
import { TrajectoryReader } from './trajectory-reader.mjs';
import { QuotaForceRefreshGuard } from '../../../../src/daemon/quota-guard.mjs';

const SERVICE = '/exa.language_server_pb.LanguageServerService/';
const MAX_PROXY_BYTES = 8 * 1024 * 1024;
const PROXY_BYTES_EXACT_MARGIN = 512 * 1024;
const NON_TRANSPORT_PROXY_ERR_RE = /超过采集上限|Invalid cascadeId|Unsupported renderer RPC|会话暂时没有可用统计|会话统计分页|后台已重新连接/i;

function estimateJsonBytes(root, stopAt) {
  if (root === null || root === undefined) return 4;
  const stack = [root];
  let est = 0;
  while (stack.length > 0) {
    const cur = stack.pop();
    const t = typeof cur;
    if (cur === null || cur === undefined) est += 4;
    else if (t === 'string') est += Buffer.byteLength(cur, 'utf8') + 2;
    else if (t === 'number' || t === 'bigint') est += 10;
    else if (t === 'boolean') est += cur ? 4 : 5;
    else if (Array.isArray(cur)) {
      est += 2 + cur.length;
      for (let i = cur.length - 1; i >= 0; i -= 1) stack.push(cur[i]);
    } else if (t === 'object') {
      est += 2;
      const keys = Object.keys(cur);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        const k = keys[i], v = cur[k];
        if (v !== undefined) { est += k.length + 4; stack.push(v); }
      }
    }
    if (est > stopAt) return est;
  }
  return est;
}

export function serverFromPorts(logPorts, processes) {
  const list = Array.isArray(processes) ? processes : [processes];
  const rows = list.filter(p => p && (/--standalone\b/.test(p.CommandLine || '') || p.HubPort || /--subclient_type(?:=|\s+)["']?ide["']?/i.test(p.CommandLine || '')));
  if (!rows.length) throw new Error('未找到 Antigravity 桌面后台');

  // 1) Explicit --hub-port match (IDE 2.6+ agy --hub)
  for (const row of rows) {
    const hubPort = row.HubPort || extractHubPort(row.CommandLine);
    const ports = new Set([row.Ports].flat().map(Number));
    if (hubPort && ports.has(hubPort)) {
      const csrf = String(row.CommandLine || '').match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
      if (csrf) return { port: hubPort, csrf, pid: row.ProcessId };
    }
  }

  // 2) Single standalone instance fast path
  if (rows.length === 1) {
    const ports = new Set([rows[0].Ports].flat().map(Number));
    const port = logPorts.find(p => ports.has(p));
    if (!port) throw new Error('等待 Antigravity 本地接口启动');
    const csrf = String(rows[0].CommandLine || '').match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
    if (!csrf) throw new Error('当前版本未提供可用的本地检测凭据');
    return { port, csrf, pid: rows[0].ProcessId };
  }

  // 3) Multi-instance fallback: match the process that actively owns the most recent HTTP log port
  for (const candidatePort of logPorts) {
    const matching = rows.filter(r => new Set([r.Ports].flat().map(Number)).has(candidatePort));
    if (matching.length === 1) {
      const csrf = String(matching[0].CommandLine || '').match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1];
      if (csrf) return { port: candidatePort, csrf, pid: matching[0].ProcessId };
    }
  }

  throw new Error('检测到多个 Antigravity 实例，等待窗口归属解析');
}

export function serverFromDiscovery(log, processes) {
  return serverFromPorts(httpLogPorts(log), processes);
}

export class AntigravityClient {
  constructor({ paths = platformPaths, readLog = readFile, logStat = stat, processes = discoverProcesses, now = Date.now, onRpc = null, cdpPort = null, debugPort = null, rendererRpc = null, scopeResolver = null } = {}) {
    this.paths = paths;
    this.readLog = readLog;
    this.logStat = logStat;
    this.processes = processes;
    this.now = now;
    this.onRpc = onRpc;
    this.cdpPort = cdpPort ?? debugPort ?? null;
    this.rendererRpc = typeof rendererRpc === 'function' ? rendererRpc : null;
    this.scopeResolver = typeof scopeResolver === 'function' ? scopeResolver : null;
    this._scopedDiscovery = new Map();
    this._proxyTrajCache = new Map();
    this._proxyTrajInFlight = new Map();
    this.agent = new HttpAgent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 2, maxFreeSockets: 2, timeout: 25000 });
    this.reader = new TrajectoryReader(this);
    this._quotaForceRefreshGuard = new QuotaForceRefreshGuard({ now: this.now });
  }
  server = null;
  discoveredAt = 0;
  discovering = null;
  lastScanAt = -Infinity;
  retryAt = 0;
  discoveryFailures = 0;
  discoveryError = null;
  _lastOsDiscoveryAt = 0;
  _proxyCdpPort = null;

  setRendererRpc(fn) {
    this.rendererRpc = typeof fn === 'function' ? fn : null;
  }

  setScopeResolver(fn) {
    this.scopeResolver = typeof fn === 'function' ? fn : null;
  }

  _resolveScopeKey(explicitScope = '') {
    const raw = typeof explicitScope === 'string' ? explicitScope.trim() : '';
    if (raw) return raw;
    if (typeof this.scopeResolver === 'function') {
      try {
        const resolved = this.scopeResolver();
        if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
      } catch {}
    }
    return 'local';
  }

  _discoverySlot(scope = 'local') {
    if (!scope || scope === 'local') return this;
    let slot = this._scopedDiscovery.get(scope);
    if (!slot) {
      slot = {
        server: null,
        discoveredAt: 0,
        discovering: null,
        lastScanAt: -Infinity,
        retryAt: 0,
        discoveryFailures: 0,
        discoveryError: null,
      };
      this._scopedDiscovery.set(scope, slot);
      while (this._scopedDiscovery.size > 32) {
        this._scopedDiscovery.delete(this._scopedDiscovery.keys().next().value);
      }
    }
    return slot;
  }

  setCdpPort(port) {
    const next = typeof port === 'function' ? port : (Number.isInteger(Number(port)) && Number(port) > 0 ? Number(port) : null);
    if (next !== this.cdpPort) {
      this.cdpPort = next;
      if (this.server?.mode === 'renderer-proxy') { this.discoveredAt = 0; this._lastOsDiscoveryAt = 0; this._proxyCdpPort = null; }
    }
  }

  _resolveCdpPort() {
    const raw = typeof this.cdpPort === 'function' ? this.cdpPort() : this.cdpPort;
    const p = Number(raw);
    return Number.isInteger(p) && p > 0 && p <= 65535 ? p : null;
  }

  async discover(force = false, explicitScope = '') {
    const scope = this._resolveScopeKey(explicitScope);
    const slot = this._discoverySlot(scope);
    const cacheTtl = slot.server?.mode === 'renderer-proxy' ? 120000 : 15000;
    if (!force && slot.server && this.now() - slot.discoveredAt < cacheTtl) return slot.server;
    if (slot.discovering) return slot.discovering;
    if (!force && slot.discoveryError && this.now() < slot.retryAt) throw slot.discoveryError;
    slot.lastScanAt = this.now();
    slot.discovering = this.discoverNow(scope, slot, force)
      .then(server => {
        slot.discoveredAt = this.now();
        slot.discoveryFailures = 0;
        slot.discoveryError = null;
        slot.retryAt = 0;
        return server;
      })
      .catch(error => {
        slot.discoveryError = error;
        slot.discoveryFailures++;
        slot.retryAt = this.now() + Math.min(30000, 3000 * 2 ** Math.min(4, slot.discoveryFailures - 1));
        throw error;
      })
      .finally(() => {
        slot.discovering = null;
      });
    return slot.discovering;
  }

  async discoverNow(scope = 'local', slot = this, force = false) {
    const prevServer = slot.server;
    slot.server = null;
    const cdpPort = this._resolveCdpPort();
    // 远程/独立 scope 严禁扫描本机日志或连接本机 HTTP LS，仅通过对应渲染器通道探测
    if (scope && scope !== 'local') {
      if (typeof this.rendererRpc === 'function') {
        try {
          const probe = await this.rendererRpc('Probe', {});
          if (probe && probe.available) {
            slot.server = { port: 0, csrf: '', pid: cdpPort || 1, mode: 'renderer-proxy', scopeKey: scope };
            slot.discoveredAt = this.now();
            return slot.server;
          }
        } catch {}
      }
      throw new Error(`远程窗口 ${scope} 渲染器通道暂不可用`);
    }
    // 120s TTL 到期后优先用轻量 Probe 复用既有 renderer-proxy，满 15m 再重扫 OS 进程表
    const nowTs = this.now();
    if (!force && prevServer?.mode === 'renderer-proxy' && typeof this.rendererRpc === 'function' && (slot._proxyCdpPort ?? null) === (cdpPort ?? null) && slot._lastOsDiscoveryAt > 0 && nowTs - slot._lastOsDiscoveryAt < 900000) {
      try {
        const probe = await this.rendererRpc('Probe', {});
        if (probe && probe.available) { slot.server = prevServer; slot.discoveredAt = this.now(); return slot.server; }
      } catch {}
    }
    slot._lastOsDiscoveryAt = nowTs;
    const paths = this.paths(), logs = [], files = [...new Set(paths.logCandidates || [paths.log])];
    for (const file of files) {
      try {
        let modifiedAt = null;
        if (files.length > 1) {
          try {
            const info = await this.logStat(file);
            if (Number.isFinite(info?.mtimeMs)) modifiedAt = info.mtimeMs;
          } catch {}
        }
        logs.push({ ports: httpLogPorts(await this.readLog(file, 'utf8')), modifiedAt });
      } catch (error) {
        logs.push({ error });
      }
    }
    if (logs.every(entry => entry.error || Number.isFinite(entry.modifiedAt))) {
      logs.sort((a, b) => {
        const first = a.modifiedAt ?? -Infinity, second = b.modifiedAt ?? -Infinity;
        return first === second ? 0 : second - first;
      });
    }
    const expectedPorts = [...new Set(logs.flatMap(log => log.ports || []))];
    const parsed = await this.processes({ expectedPorts, ...(cdpPort ? { cdpPort } : {}) });
    if (!parsed || (Array.isArray(parsed) && !parsed.length)) {
      if (typeof this.rendererRpc === 'function') {
        try {
          const probe = await this.rendererRpc('Probe', {});
          if (probe && probe.available) {
            slot.server = { port: 0, csrf: '', pid: cdpPort || 1, mode: 'renderer-proxy' };
            slot._proxyCdpPort = cdpPort ?? null;
            slot.discoveredAt = this.now();
            return slot.server;
          }
        } catch {}
      }
      throw new Error('请先打开 Antigravity');
    }

    // Allow hub-port resolution even if log files are absent
    if (Array.isArray(parsed) && parsed.some(r => r?.HubPort)) {
      try {
        slot.server = serverFromPorts(expectedPorts, parsed);
        slot.discoveredAt = this.now();
        return slot.server;
      } catch {}
    }

    let foundLog = false, lastError = null;
    for (const entry of logs) {
      try {
        if (entry.error) throw entry.error;
        foundLog = true;
        slot.server = serverFromPorts(entry.ports, parsed);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') lastError = error;
      }
    }
    if (!slot.server) {
      const primaryErr = lastError || new Error(foundLog ? '等待 Antigravity 本地接口启动' : '未找到 Antigravity 语言服务日志，请检查日志路径');
      if (typeof this.rendererRpc === 'function') {
        try {
          const probe = await this.rendererRpc('Probe', {});
          if (probe && probe.available) {
            const firstPid = Array.isArray(parsed) && parsed[0]?.ProcessId ? Number(parsed[0].ProcessId) : (cdpPort || 1);
            slot.server = { port: 0, csrf: '', pid: firstPid, mode: 'renderer-proxy' };
            slot._proxyCdpPort = cdpPort ?? null;
            slot.discoveredAt = this.now();
            return slot.server;
          }
        } catch {}
      }
      throw primaryErr;
    }
    slot.discoveredAt = this.now();
    return slot.server;
  }

  _isProxySettled(data) {
    const st = data?.status;
    if (st === 1 || st === 'CASCADE_RUN_STATUS_1') return true;
    return /IDLE|DONE|COMPLETED|CANCELLED|CANCELED|STOPPED|FAILED|ERROR/i.test(String(st || ''));
  }

  _proxySummaryStamp(summary) {
    if (!summary || typeof summary !== 'object') return '';
    const lm = summary.lastModifiedTime;
    const lmStr =
      typeof lm === 'string'
        ? lm
        : typeof lm === 'bigint' || typeof lm === 'number'
          ? String(lm)
          : lm && typeof lm === 'object'
            ? `${lm.seconds ?? ''}:${lm.nanos ?? 0}`
            : '';
    const sc = summary.stepCount ?? '';
    return lmStr || sc !== '' ? `${lmStr}|${sc}` : '';
  }

  _proxyTimeMs(val) {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number' || typeof val === 'bigint') {
      const n = Number(val);
      return Number.isFinite(n) && n > 0 ? (n > 1e11 ? n : n * 1000) : 0;
    }
    if (typeof val === 'string') { const ms = Date.parse(val); return Number.isFinite(ms) && ms > 0 ? ms : 0; }
    if (typeof val === 'object' && val.seconds !== undefined) {
      const s = Number(val.seconds), ns = Number(val.nanos ?? 0);
      return Number.isFinite(s) && s > 0 ? s * 1000 + (Number.isFinite(ns) && ns > 0 ? Math.floor(ns / 1e6) : 0) : 0;
    }
    return 0;
  }

  _proxyLastStepMs(data) {
    const steps = data?.trajectory?.steps;
    let best = 0;
    if (Array.isArray(steps)) {
      for (let i = steps.length - 1, stop = Math.max(0, steps.length - 8); i >= stop; i -= 1) {
        const m = steps[i]?.metadata;
        if (!m) continue;
        const t = this._proxyTimeMs(m.completedAt) || this._proxyTimeMs(m.startedAt) || this._proxyTimeMs(m.createdAt);
        if (t > best) best = t;
      }
    }
    return best;
  }

  _proxyContextSig(data) {
    if (!data || typeof data !== 'object') return { steps: 0, cwu: '', compact: '', used: null, afterCompact: false };
    const stepsRaw = data.numTotalSteps ?? data.stepCount ?? data.trajectory?.steps?.length ?? 0;
    const steps = Number.isFinite(Number(stepsRaw)) && Number(stepsRaw) >= 0 ? Number(stepsRaw) : 0;
    const cwuObj = data.contextWindowUsage || data.trajectory?.contextWindowUsage;
    const cwu = cwuObj && typeof cwuObj === 'object'
      ? `${cwuObj.estimatedTokensUsed ?? ''}:${cwuObj.maxContextTokens ?? ''}:${cwuObj.estimatedAfterCompaction ? 1 : 0}:${cwuObj.lastStepIndex ?? ''}:${cwuObj.generatorMetadataIndex ?? ''}`
      : '';
    let used = cwuObj && typeof cwuObj === 'object' && Number.isFinite(Number(cwuObj.estimatedTokensUsed)) ? Number(cwuObj.estimatedTokensUsed) : null;
    if (used === null && Array.isArray(data.trajectory?.generatorMetadata)) {
      for (let i = data.trajectory.generatorMetadata.length - 1; i >= 0; i -= 1) {
        const est = data.trajectory.generatorMetadata[i]?.chatModel?.chatStartMetadata?.contextWindowMetadata?.estimatedTokensUsed;
        if (est !== undefined && est !== null && Number.isFinite(Number(est))) { used = Number(est); break; }
      }
    }
    const compArr = data.compactedAtStepIndices || data.compactionInfo?.compactedAtStepIndices || data.trajectory?.compactedAtStepIndices;
    const compact = Array.isArray(compArr) && compArr.length ? `${compArr.length}:${compArr[compArr.length - 1]}` : '';
    return { steps, cwu, compact, used, afterCompact: Boolean(cwuObj && cwuObj.estimatedAfterCompaction === true) };
  }

  _resolveProxyTrajectoryTtl(cached, sumStamp) {
    if (this._isProxySettled(cached.data)) return sumStamp && cached.sumStamp && sumStamp === cached.sumStamp ? 60000 : 20000;
    // 运行中对话按轨迹体量动态拉长全量 GetCascadeTrajectory TTL（12s~20s），避免长对话每 4s 触发 LS 整树反序列化
    const steps = Number(cached.ctxSig?.steps ?? cached.data?.numTotalSteps ?? 0) || 0;
    const bytes = Number(cached.bytes || 0) || 0;
    if (steps >= 200 || bytes >= 768 * 1024) return 20000;
    if (steps >= 80 || bytes >= 256 * 1024) return 12000;
    return 4000;
  }

  async _getProxyTrajectory(cascadeId, force = false, summaryOrOpts = null) {
    const isOptsObj = Boolean(
      summaryOrOpts && typeof summaryOrOpts === 'object' &&
      ('summary' in summaryOrOpts || 'isCurrent' in summaryOrOpts || 'scopeKey' in summaryOrOpts || 'freshContext' in summaryOrOpts)
    );
    const scope = this._resolveScopeKey(isOptsObj && typeof summaryOrOpts.scopeKey === 'string' ? summaryOrOpts.scopeKey : '');
    const freshContext = Boolean(isOptsObj && summaryOrOpts.freshContext);
    const key = `${scope}::${String(cascadeId || '').toLowerCase()}`;
    const now = this.now();
    const sumStamp = this._proxySummaryStamp(isOptsObj ? summaryOrOpts.summary || null : summaryOrOpts);
    const cached = !force ? this._proxyTrajCache.get(key) : null;
    if (cached) {
      const age = now - cached.at;
      const stampChanged = Boolean(sumStamp && cached.sumStamp && sumStamp !== cached.sumStamp);
      if (!stampChanged) {
        const settled = this._isProxySettled(cached.data);
        const ttl = this._resolveProxyTrajectoryTtl(cached, sumStamp);
        if (age < ttl) {
          let peekChanged = false;
          const canSettledPeek = settled && !sumStamp && (freshContext || (age >= 3500 && (!cached.peekAt || now - cached.peekAt >= 2000)));
          const canActivePeek = !settled && (freshContext || (ttl >= 12000 && age >= 3500 && (!cached.peekAt || now - cached.peekAt >= 2500)));
          if (canSettledPeek || canActivePeek) {
            cached.peekAt = now;
            try {
              const peek = await this.rendererRpc('PeekContextState', { cascadeId });
              if (peek && typeof peek === 'object') {
                const pSig = this._proxyContextSig(peek);
                const cSig = cached.ctxSig || this._proxyContextSig(cached.data);
                const peekMod = this._proxySummaryStamp({ lastModifiedTime: peek.lastModifiedTime });
                const peekModMs = this._proxyTimeMs(peek.lastModifiedTime);
                const hasPeekSteps = peek.stepCount !== undefined && peek.stepCount !== null;
                const hasAnySignal = Boolean(hasPeekSteps || pSig.cwu || pSig.compact || peekMod || peek.status !== undefined);
                if (canSettledPeek) {
                  // 1) 已结束会话：用零 LS-RPC 内存态探针秒级感知 /compact 变化；freshContext 绕过 3.5s 门禁
                  const stepsChanged = hasPeekSteps && (pSig.steps !== cSig.steps || (cached.peekSteps !== undefined && pSig.steps !== cached.peekSteps));
                  const modAdvanced = Boolean(peekMod && ((cached.peekMod && peekMod !== cached.peekMod) || (!cached.peekMod && cached.lastStepMs > 0 && peekModMs > cached.lastStepMs + 1000)));
                  const becameRunning = peek.status !== undefined && !this._isProxySettled(peek);
                  if (stepsChanged || (pSig.cwu && pSig.cwu !== cSig.cwu) || (pSig.compact && pSig.compact !== cSig.compact) || modAdvanced || becameRunning || (freshContext && !hasAnySignal && age >= 800)) {
                    peekChanged = true;
                  } else {
                    if (hasPeekSteps) cached.peekSteps = pSig.steps;
                    if (peekMod && !cached.peekMod) cached.peekMod = peekMod;
                  }
                } else {
                  // 2) 运行中会话：优先原地刷新水位；遇压缩完成/水位骤降/结束态/freshContext 变化立即击穿 12s~20s TTL
                  const becameSettled = peek.status !== undefined && this._isProxySettled(peek);
                  const compactedChanged = Boolean(pSig.compact && pSig.compact !== cSig.compact);
                  const afterCompactHit = Boolean(pSig.afterCompact && pSig.cwu && pSig.cwu !== cSig.cwu);
                  const sharpDrop = Boolean(cSig.used !== null && cSig.used >= 20000 && pSig.used !== null && pSig.used < cSig.used * 0.7 && cSig.used - pSig.used >= 10000);
                  const freshProgress = Boolean(freshContext && ((hasPeekSteps && pSig.steps !== cSig.steps) || (pSig.cwu && pSig.cwu !== cSig.cwu) || (!hasAnySignal && age >= 800)));
                  if (becameSettled || compactedChanged || afterCompactHit || sharpDrop || freshProgress) {
                    peekChanged = true;
                  } else if (cached.data && typeof cached.data === 'object') {
                    if (peek.contextWindowUsage && typeof peek.contextWindowUsage === 'object') cached.data.contextWindowUsage = peek.contextWindowUsage;
                    if (Array.isArray(peek.compactedAtStepIndices) && peek.compactedAtStepIndices.length) cached.data.compactedAtStepIndices = peek.compactedAtStepIndices;
                    if (pSig.steps > cSig.steps) cached.data.numTotalSteps = pSig.steps;
                    cached.ctxSig = this._proxyContextSig(cached.data);
                  }
                }
              } else if (freshContext && age >= 800) {
                peekChanged = true;
              }
            } catch {
              if (freshContext && age >= 800) peekChanged = true;
            }
          }
          if (!peekChanged) return cached.data;
        }
      }
    }
    const existing = this._proxyTrajInFlight.get(key);
    if (existing) return existing;

    const req = (async () => {
      const data = await this.rendererRpc('GetCascadeTrajectory', { cascadeId });
      let bytes = estimateJsonBytes(data || {}, MAX_PROXY_BYTES + PROXY_BYTES_EXACT_MARGIN);
      if (bytes >= MAX_PROXY_BYTES - PROXY_BYTES_EXACT_MARGIN && bytes <= MAX_PROXY_BYTES + PROXY_BYTES_EXACT_MARGIN) {
        bytes = Buffer.byteLength(JSON.stringify(data || {}));
      }
      if (bytes > MAX_PROXY_BYTES) {
        throw Object.assign(new Error('接口响应超过采集上限'), { nonTransport: true, code: 'PROXY_PAYLOAD_LIMIT' });
      }
      const fetchedAt = this.now();
      const ctxSig = this._proxyContextSig(data);
      const lastStepMs = this._proxyLastStepMs(data);
      this._proxyTrajCache.delete(key);
      this._proxyTrajCache.set(key, { at: fetchedAt, data, bytes, sumStamp, ctxSig, lastStepMs, peekAt: fetchedAt, peekMod: '' });
      while (this._proxyTrajCache.size > 32) this._proxyTrajCache.delete(this._proxyTrajCache.keys().next().value);
      return data;
    })().finally(() => {
      if (this._proxyTrajInFlight.get(key) === req) this._proxyTrajInFlight.delete(key);
    });
    this._proxyTrajInFlight.set(key, req);
    return req;
  }

  async _callRendererProxy(method, body = {}) {
    if (typeof this.rendererRpc !== 'function') {
      throw new Error('当前版本未提供可用的本地检测凭据');
    }
    if (method === 'GetCascadeTrajectory') {
      return this._getProxyTrajectory(body?.cascadeId, Boolean(body?.force));
    }
    if (method === 'GetCascadeTrajectorySteps') {
      const offset = Math.max(0, Math.floor(Number(body?.stepOffset || 0)));
      const full = await this._getProxyTrajectory(body?.cascadeId, Boolean(body?.force));
      const all = Array.isArray(full?.trajectory?.steps) ? full.trajectory.steps : [];
      return {
        steps: offset < all.length ? all.slice(offset) : [],
        numTotalSteps: full?.numTotalSteps ?? all.length,
      };
    }
    if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
      const offset = Math.max(0, Math.floor(Number(body?.generatorMetadataOffset || 0)));
      const full = await this._getProxyTrajectory(body?.cascadeId, false);
      const all = Array.isArray(full?.trajectory?.generatorMetadata) ? full.trajectory.generatorMetadata : [];
      const allSteps = Array.isArray(full?.trajectory?.steps) ? full.trajectory.steps : [];
      return {
        generatorMetadata: offset < all.length ? all.slice(offset) : [],
        numTotalGeneratorMetadata: full?.numTotalGeneratorMetadata ?? all.length,
        numTotalSteps: full?.numTotalSteps ?? allSteps.length,
      };
    }
    return this.rendererRpc(method, body);
  }

  async call(method, body = {}, retry = true) {
    let effectiveBody = body;
    if (method === 'RetrieveUserQuotaSummary' && this._quotaForceRefreshGuard && retry) {
      const decision = this._quotaForceRefreshGuard.prepare(body);
      if (decision.action === 'cached') return decision.result;
      effectiveBody = decision.body;
    }
    const scope = this._resolveScopeKey();
    const slot = this._discoverySlot(scope);
    const server = await this.discover(false, scope);
    if (server && server.mode === 'renderer-proxy') {
      try {
        const res = await this._callRendererProxy(method, effectiveBody);
        if (method === 'RetrieveUserQuotaSummary') this._quotaForceRefreshGuard?.recordSuccess(res);
        return res;
      } catch (error) {
        if (error?.nonTransport === true || NON_TRANSPORT_PROXY_ERR_RE.test(String(error?.message || ''))) throw error;
        if (slot.server === server) {
          slot.server = null;
          slot.discoveryError = error;
          slot.retryAt = Math.max(slot.retryAt, slot.lastScanAt + 3000);
        }
        if (retry) {
          await this.discover(true, scope);
          return this.call(method, effectiveBody, false);
        }
        throw error;
      }
    }
    try {
      const result = await new Promise((resolve, reject) => {
        const reqBody =
          method === 'GetCascadeTrajectoryGeneratorMetadata' && effectiveBody && typeof effectiveBody === 'object' && effectiveBody.includeMessages === undefined
            ? { ...effectiveBody, includeMessages: false }
            : effectiveBody;
        const data = JSON.stringify(reqBody);
        const projection = ['GetCascadeTrajectory', 'GetCascadeTrajectorySteps', 'GetCascadeTrajectoryGeneratorMetadata', 'GetAllCascadeTrajectories'].includes(method);
        const started = this.now();
        const req = request(
          {
            hostname: '127.0.0.1',
            port: server.port,
            method: 'POST',
            path: SERVICE + method,
            agent: this.agent,
            headers: {
              'Content-Type': 'application/json',
              'Connect-Protocol-Version': '1',
              'x-codeium-csrf-token': server.csrf,
              'Content-Length': Buffer.byteLength(data),
            },
          },
          res => {
            const projected = projection ? new TrajectoryJson() : null;
            let text = '', bytes = 0, failed = false;
            const fail = error => {
              if (failed) return;
              failed = true;
              reject(error);
              req.destroy(error);
            };
            res.setEncoding('utf8');
            res.on('error', error => { if (!failed) reject(error); });
            res.on('data', chunk => {
              if (failed) return;
              bytes += Buffer.byteLength(chunk);
              if (!(projected && res.statusCode === 200) && bytes > 32 * 1024 * 1024) {
                fail(new Error('接口响应超过采集上限'));
                return;
              }
              try {
                if (projected && res.statusCode === 200) projected.write(chunk);
                else text += chunk;
              } catch (error) {
                fail(error);
              }
            });
            res.on('end', () => {
              if (failed) return;
              if (res.statusCode !== 200) return reject(Object.assign(new Error(`Antigravity 接口 ${method} 返回 ${res.statusCode}`), { status: res.statusCode }));
              try {
                const value = projected ? projected.end() : JSON.parse(text);
                try { this.onRpc?.({ method, bytes, retainedBytes: projected?.retained ?? Buffer.byteLength(text), ms: this.now() - started }); } catch {}
                resolve(value);
              } catch (error) {
                reject(projected ? error : new Error('Antigravity 接口返回了无法解析的数据'));
              }
            });
          }
        );
        req.on('error', reject);
        req.setTimeout(12000, () => req.destroy(new Error('Antigravity 本地接口超时')));
        const deadline = setTimeout(() => req.destroy(new Error('Antigravity 本地接口超时')), 30000);
        deadline.unref();
        req.once('close', () => clearTimeout(deadline));
        req.end(data);
      });
      if (method === 'RetrieveUserQuotaSummary') this._quotaForceRefreshGuard?.recordSuccess(result);
      return result;
    } catch (error) {
      const endpointLost = [401, 403].includes(error.status) || ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTCONN'].includes(error.code);
      if (!endpointLost) throw error;
      if (slot.server === server) {
        slot.server = null;
        slot.discoveryError = error;
        slot.retryAt = Math.max(slot.retryAt, slot.lastScanAt + 3000);
      }
      if (retry) {
        await this.discover(false, scope);
        return this.call(method, body, false);
      }
      throw error;
    }
  }

  async streamTrajectoryPage(method, body, { onRecord, isCurrent = () => true, wallMs = 30000 } = {}) {
    if (!['GetCascadeTrajectorySteps', 'GetCascadeTrajectoryGeneratorMetadata'].includes(method) || typeof onRecord !== 'function') throw Error('Unsupported statistics stream');
    if (!Number.isSafeInteger(wallMs) || wallMs < 30000 || wallMs > 300000) throw Error('Invalid statistics stream deadline');
    let streamError = null, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    aborted.catch(() => {});
    const assertCurrent = () => {
      if (streamError) throw streamError;
      if (isCurrent() !== true) throw Error('Statistics stream cancelled');
    };
    assertCurrent();
    const server = await this.discover();
    assertCurrent();
    const input = JSON.stringify(method === 'GetCascadeTrajectoryGeneratorMetadata' ? { ...body, includeMessages: false } : body);
    let pending = null;
    const parser = new TrajectoryJson({
      onRecord: (kind, index, value) => {
        if (pending) throw Error('Statistics stream consumer overflow');
        pending = { kind, index, value };
      },
    });
    const started = this.now();
    let bytes = 0, peakRetained = 0, req, res, deadline, watch;
    const timeout = () => Error('Antigravity 本地接口超时');
    const abort = error => {
      streamError ||= error;
      rejectAbort(streamError);
      res?.destroy();
      req?.destroy(streamError);
    };
    try {
      res = await new Promise((resolve, reject) => {
        req = request(
          {
            hostname: '127.0.0.1',
            port: server.port,
            method: 'POST',
            path: SERVICE + method,
            agent: this.agent,
            headers: {
              'Content-Type': 'application/json',
              'Connect-Protocol-Version': '1',
              'x-codeium-csrf-token': server.csrf,
              'Content-Length': Buffer.byteLength(input),
            },
          },
          resolve
        );
        req.on('error', error => { streamError ||= error; rejectAbort(streamError); reject(error); });
        req.setTimeout(12000, () => abort(timeout()));
        deadline = setTimeout(() => abort(timeout()), wallMs);
        deadline.unref();
        watch = setInterval(() => { if (isCurrent() !== true) abort(Error('Statistics stream cancelled')); }, 250);
        watch.unref();
        req.end(input);
      });
      if (res.statusCode !== 200) throw Object.assign(Error('Statistics stream HTTP ' + res.statusCode), { status: res.statusCode });
      res.setEncoding('utf8');
      for await (const chunk of res) {
        assertCurrent();
        bytes += Buffer.byteLength(chunk);
        for (let offset = 0; offset < chunk.length;) {
          assertCurrent();
          const slice = chunk.slice(offset, offset + 8192);
          const consumed = parser.write(slice, { stopAfterRecord: true });
          offset += consumed;
          peakRetained = Math.max(peakRetained, parser.retained);
          if (pending) {
            const item = pending;
            pending = null;
            await Promise.race([onRecord(item.kind, item.index, item.value), aborted]);
            assertCurrent();
          }
          await yieldStream();
        }
      }
      assertCurrent();
      const result = parser.end();
      if (pending) {
        const item = pending;
        pending = null;
        await Promise.race([onRecord(item.kind, item.index, item.value), aborted]);
        assertCurrent();
      }
      try { this.onRpc?.({ method, bytes, retainedBytes: peakRetained, ms: this.now() - started, streamed: true }); } catch {}
      return result;
    } catch (error) {
      streamError ||= error;
      throw error;
    } finally {
      clearTimeout(deadline);
      clearInterval(watch);
      if (streamError || !res?.complete) {
        res?.destroy();
        req?.destroy();
      }
    }
  }

  // Backward-compatible lightweight metadata-only fetcher used by PrismDaemon.fetchUsageRollupBatch
  async _fetchMetadataOnly(id) {
    const generatorMetadata = [];
    let total = null;
    while (true) {
      const page = await this.call('GetCascadeTrajectoryGeneratorMetadata', {
        cascadeId: id,
        generatorMetadataOffset: generatorMetadata.length,
        includeMessages: false,
      });
      const items = page?.generatorMetadata || page?.generatorMetadatas || [];
      if (page?.numTotalGeneratorMetadata !== undefined && page?.numTotalGeneratorMetadata !== null) {
        total = Number(page.numTotalGeneratorMetadata);
      }
      if (!items.length) {
        if (generatorMetadata.length === 0 && total === null) throw new Error('会话暂时没有可用统计');
        if (total !== null && generatorMetadata.length < total) throw new Error('完整会话统计分页暂不可用');
        break;
      }
      generatorMetadata.push(...items);
      if (total !== null && generatorMetadata.length >= total) break;
    }
    const inferredSteps = generatorMetadata.reduce((max, g) => {
      for (const i of g.stepIndices || []) if (Number.isInteger(i) && i >= max) max = i + 1;
      return max;
    }, 0);
    return {
      numTotalSteps: inferredSteps,
      numTotalGeneratorMetadata: generatorMetadata.length,
      trajectory: {
        cascadeId: id,
        steps: [],
        generatorMetadata,
        _metadataOnly: true,
      },
    };
  }

  resetTrajectories() {
    this._proxyTrajCache?.clear?.();
    this._proxyTrajInFlight?.clear?.();
    this.reader.reset();
  }
  async trajectory(id, options = {}) {
    const scope = this._resolveScopeKey(options?.scopeKey || '');
    const server = await this.discover(false, scope);
    if (server && server.mode === 'renderer-proxy') {
      if (options?.isCurrent && options.isCurrent() !== true) {
        throw new Error('后台已重新连接，请等待刷新');
      }
      const data = await this._getProxyTrajectory(id, Boolean(options?.force), {
        summary: options?.summary || null,
        scopeKey: scope,
        freshContext: Boolean(options?.freshContext),
      });
      if (options?.isCurrent && options.isCurrent() !== true) {
        throw new Error('后台已重新连接，请等待刷新');
      }
      return data;
    }
    return this.reader.read(id, options);
  }
  dispose() {
    try { this.agent?.destroy?.(); } catch {}
    this._scopedDiscovery?.clear?.();
    this._proxyTrajCache?.clear?.();
    this._proxyTrajInFlight?.clear?.();
    this.reader?.reset?.();
  }
}
