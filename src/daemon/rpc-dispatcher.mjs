// Obsidian Prism Binding RPC 表驱动分发器与统一主帧上下文鉴权（Tier 2，独立组合类，无原型 Mixin）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import { sanitizeSecretText } from '../../sidecars/daemon/redact.mjs';
import {
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
  INLINE_DIFF_BINDING,
  SIDEBAR_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
  WALLPAPER_MAX_PAYLOAD_BYTES,
  WALLPAPER_ALLOWED_ACTIONS,
  SUGGESTER_MAX_PAYLOAD_BYTES,
  SUGGESTER_ALLOWED_ACTIONS,
} from './constants.mjs';
import { serializeJsonForEval, formatJsonArgForEval } from './fs-atomic.mjs';
import { isAutomatedTestRuntime } from './pid-lock.mjs';
import { INLINE_DIFF_MAX_PAYLOAD_BYTES, INLINE_DIFF_MAX_URI_LENGTH } from './inline-diff-filter.mjs';
import { readSafeInlineDiff } from './inline-diff-service.mjs';
import { deliverPeriodicPickerFullToEntry } from './channel-sync-engine.mjs';

// 统一 Fire-and-Forget 回调派发：强制 returnByValue:false / awaitPromise:false 且表达式末尾 ;void 0，防 V8 Inspector objectId 泄漏
function sendFireAndForgetEval(session, expr, executionContextId = null, timeoutMs = 0, { rethrow = false } = {}) {
  if (!session || session.closed || !expr) return Promise.resolve();
  const trimmed = String(expr).trim().replace(/;+\s*$/, '');
  const params = {
    expression: `${trimmed};void 0`,
    returnByValue: false,
    awaitPromise: false,
  };
  if (typeof executionContextId === 'number' && executionContextId > 0) {
    params.contextId = executionContextId;
  }
  const p = timeoutMs > 0 ? session.send('Runtime.evaluate', params, timeoutMs) : session.send('Runtime.evaluate', params);
  return rethrow ? p : p.catch(() => {});
}

/**
 * 公共主帧执行上下文基础校验（fail-closed）。
 */
export function isTrustedMainFrameBindingCall(entry, executionContextId) {
  if (!entry) return false;
  const hasCtxId = typeof executionContextId === 'number';
  const contexts = entry.contextFrames instanceof Map ? entry.contextFrames : null;
  const meta = hasCtxId && contexts ? contexts.get(executionContextId) : null;

  if (meta) {
    if (meta.isDefault !== true) return false;
    if (meta.type && meta.type !== 'default') return false;
    if (!entry.mainFrameId || !meta.frameId || meta.frameId !== entry.mainFrameId) return false;
    return true;
  }

  if (entry.hasFrameTree || entry.mainFrameId) return false;
  if (contexts && contexts.size > 0) return false;
  if (hasCtxId) return false;
  if (!isAutomatedTestRuntime()) return false;
  return true;
}

/**
 * 统一受信任宿主上下文守卫：校验窗口存活、sidebarHostVerified、主帧默认上下文引用、docGen 文档代际及 sidebarHostContextId。
 */
export function isTrustedHostContext(
  entry,
  ctxId,
  expectedDocGen = null,
  {
    stopped = false,
    expectedContext = undefined,
    requireTrackedFrames = false,
    strictContextType = false,
  } = {}
) {
  if (stopped || !entry || entry.session?.closed) return false;
  if (entry.sidebarHostVerified !== true) return false;

  const contexts = entry.contextFrames instanceof Map ? entry.contextFrames : null;
  const hasTrackedFrames = Boolean(entry.hasFrameTree || entry.mainFrameId || (contexts && contexts.size > 0));

  if (!requireTrackedFrames && !hasTrackedFrames) {
    if (!isTrustedMainFrameBindingCall(entry, ctxId)) return false;
    return isAutomatedTestRuntime();
  }

  if (typeof ctxId !== 'number' || !contexts) return false;
  const currentMeta = contexts.get(ctxId);
  if (!currentMeta) return false;
  if (expectedContext !== undefined && currentMeta !== expectedContext) return false;
  if (currentMeta.isDefault !== true) return false;
  if (strictContextType ? currentMeta.type !== 'default' : currentMeta.type && currentMeta.type !== 'default') {
    return false;
  }
  if (!entry.mainFrameId || currentMeta.frameId !== entry.mainFrameId) return false;

  if (typeof entry.sidebarDocument === 'number') {
    if (typeof entry.sidebarVerifiedDocument === 'number' && entry.sidebarVerifiedDocument !== entry.sidebarDocument) {
      return false;
    }
    if (expectedDocGen !== null && entry.sidebarDocument !== expectedDocGen) {
      return false;
    }
    if (typeof currentMeta.docGen === 'number' && currentMeta.docGen !== entry.sidebarDocument) {
      return false;
    }
  }

  if (typeof entry.sidebarHostContextId === 'number' && entry.sidebarHostContextId !== ctxId) {
    return false;
  }

  return true;
}

export function resolveTrustedBroadcastContextId(other) {
  if (!other || other.session?.closed || other.sidebarHostVerified !== true) {
    return { ok: false, contextId: undefined };
  }
  const contexts = other.contextFrames instanceof Map ? other.contextFrames : null;
  const hasTrackedFrames = Boolean(other.hasFrameTree || other.mainFrameId || (contexts && contexts.size > 0));
  if (!hasTrackedFrames) {
    return isAutomatedTestRuntime()
      ? { ok: true, contextId: typeof other.sidebarHostContextId === 'number' ? other.sidebarHostContextId : undefined }
      : { ok: false, contextId: undefined };
  }
  if (!isTrustedHostContext(other, other.sidebarHostContextId, null, { requireTrackedFrames: true })) {
    return { ok: false, contextId: undefined };
  }
  return { ok: true, contextId: other.sidebarHostContextId };
}

async function handleSettingBinding(rpc, entry, payload, executionContextId) {
  if (typeof payload !== 'string' || payload.length > 8192) return;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.action === 'request-settings-panel') {
      await rpc.channelOrchestrator.deliverSettingsChannelToEntry(entry, executionContextId);
      return;
    }
    if (parsed.action === 'request-home-studio-panel') {
      await rpc.channelOrchestrator.deliverHomeStudioChannelToEntry(entry, executionContextId);
      return;
    }
    if (parsed.action === 'request-periodic-picker') {
      await deliverPeriodicPickerFullToEntry(rpc.channelOrchestrator, entry, executionContextId);
      return;
    }
    const updated =
      parsed.action === 'patch-batch' && parsed.entries && typeof parsed.entries === 'object'
        ? rpc.channelOrchestrator.updateConfigBatch(parsed.entries)
        : rpc.channelOrchestrator.updateConfigSetting(parsed.key, parsed.value);
    if (updated) {
      if (entry && Number.isSafeInteger(parsed.clientEpoch) && parsed.clientEpoch > 0) {
        entry.pendingAckEpoch = parsed.clientEpoch;
      }
      await rpc.invokeBroadcastConfigRefresh();
    }
  } catch {}
}

async function handleRepoBinding(rpc, entry, payload, executionContextId) {
  if (typeof payload !== 'string' || payload.length > 4096) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
  const action =
    parsed?.action || parsed?.type || parsed?.input?.action || parsed?.payload?.action || 'status';

  const inputPayload =
    parsed?.input && typeof parsed.input === 'object' && !Array.isArray(parsed.input)
      ? { ...parsed.input }
      : parsed?.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
        ? { ...parsed.payload }
        : {};
  delete inputPayload._testOverrides;
  delete inputPayload.forceBusy;
  delete inputPayload.convDir;
  delete inputPayload.archiveDir;

  const passthroughKeys = [
    'confirm', 'purgeData', 'force', 'manual', 'channel', 'updateChannel', 'version',
    'value', 'batchName', 'batch', 'lang', 'mode', 'oldMain', 'hours', 'listOnly',
    'autoArchiveOnExit', 'addonId', 'manifestUrl', 'expectedManifestSha256',
  ];
  for (const k of passthroughKeys) {
    if (inputPayload[k] === undefined && parsed?.[k] !== undefined) inputPayload[k] = parsed[k];
  }
  if (inputPayload.version === undefined && typeof parsed?.input === 'string') inputPayload.version = parsed.input;

  const result = await rpc.invokeExecuteRepoAction({ ...inputPayload, action });
  if (reqId !== null) {
    const safeId = Number(reqId) | 0;
    const payloadExpr = formatJsonArgForEval(result);
    const expr = `(() => {
      const r = ${payloadExpr};
      if (window.__agPrismRepoBridge && typeof window.__agPrismRepoBridge.resolve === 'function') {
        window.__agPrismRepoBridge.resolve(${safeId}, r);
      } else if (typeof window.__agPrismRepoResolve === 'function') {
        window.__agPrismRepoResolve(${safeId}, r);
      }
    })()`;
    await sendFireAndForgetEval(entry.session, expr, executionContextId);
  }
}

async function handleMetricsBinding(rpc, entry, payload, executionContextId) {
  if (typeof payload !== 'string' || payload.length > 4096) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
  if (!reqId) return;

  const tel = rpc.telemetrySubsystem;
  let result;
  if (!tel._customMetricsProvider && tel.isDisabled()) {
    tel.releaseIdle(true);
    result = { connection: 'disabled', speed: null, groups: [] };
  } else {
    tel.beginActivity();
    try {
      const collector = await tel.ensureMetricsCollector();
      result = await collector(parsed.input || {});
    } catch (err) {
      result = { connection: 'offline', error: sanitizeSecretText(err?.message || 'Metrics unavailable'), speed: null, groups: [] };
    } finally {
      tel.endActivity();
      if (!tel._customMetricsProvider && tel.isDisabled() && tel._telemetryInFlight === 0) {
        tel.releaseIdle(true);
      }
    }
  }
  const includeConversations = parsed?.input?.includeConversations !== false;
  if (!includeConversations && result && typeof result === 'object' && Array.isArray(result.conversations) && result.conversations.length > 0) {
    result = { ...result, conversations: [] };
  }
  const safeId = Number(reqId) | 0;
  const expr = `window.__agPrismMetricsResolve && window.__agPrismMetricsResolve(${safeId}, ${formatJsonArgForEval(result)})`;
  await sendFireAndForgetEval(entry.session, expr, executionContextId);
}

async function handleThoughtBinding(rpc, entry, payload, executionContextId) {
  if (typeof payload !== 'string' || payload.length > 131072) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
  if (reqId === null) return;
  const input = parsed?.input && typeof parsed.input === 'object' ? parsed.input : {};
  const action = parsed?.action || input.action || 'get-config';

  let result;
  try {
    const svc = await rpc.channelOrchestrator.ensureThoughtService();
    if (action === 'get-config') {
      result = svc.getSanitizedConfig();
    } else if (action === 'save-config') {
      result = svc.saveConfig(input);
    } else if (action === 'get-cache') {
      if (typeof svc._ensureCacheLoadedAsync === 'function') await svc._ensureCacheLoadedAsync();
      result = svc.getWarmCacheSnapshot(
        Number(input.limit) > 0 ? Number(input.limit) : 40,
        Number(input.maxChars) > 0 ? Number(input.maxChars) : 80000
      );
    } else if (action === 'cache-stats') {
      if (typeof svc._ensureCacheLoadedAsync === 'function') await svc._ensureCacheLoadedAsync();
      result = svc.getCacheStats();
    } else if (action === 'clear-cache') {
      result = svc.clearCache();
    } else if (action === 'cancel-translate') {
      result = svc.cancelPending(
        input.requestId !== undefined || input.key !== undefined ? input : parsed?.requestId ?? parsed?.key ?? input
      );
    } else if (action === 'fetch-models') {
      result = await svc.fetchModels(input);
    } else if (action === 'test-connection') {
      result = await svc.testConnection(input);
    } else if (action === 'diagnose') {
      result = typeof svc.diagnose === 'function' ? await svc.diagnose(input) : { ok: false, error: 'diagnose_not_supported' };
    } else if (action === 'translate-stream') {
      const THOUGHT_STREAM_FRAME_MS = 72;
      let lastSent = '';
      let pendingPartial = null;
      let sendingPartial = false;
      let lastFrameAt = 0;
      let frameTimer = null;
      let streamDone = false;
      const clearFrameTimer = () => {
        if (frameTimer !== null) {
          clearTimeout(frameTimer);
          frameTimer = null;
        }
      };
      const scheduleFlushPartial = () => {
        if (streamDone || sendingPartial || pendingPartial === null || !entry || entry.session.closed) return;
        const elapsed = lastFrameAt > 0 ? Date.now() - lastFrameAt : THOUGHT_STREAM_FRAME_MS;
        if (elapsed >= THOUGHT_STREAM_FRAME_MS) {
          clearFrameTimer();
          void flushPartial();
          return;
        }
        if (frameTimer === null) {
          frameTimer = setTimeout(() => {
            frameTimer = null;
            if (!streamDone && pendingPartial !== null) void flushPartial();
          }, THOUGHT_STREAM_FRAME_MS - elapsed);
          frameTimer.unref?.();
        }
      };
      const flushPartial = async () => {
        if (sendingPartial) return;
        sendingPartial = true;
        try {
          while (pendingPartial !== null) {
            if (streamDone || !entry || entry.session.closed) { pendingPartial = null; break; }
            const target = pendingPartial;
            pendingPartial = null;
            if (target === lastSent) continue;
            const frame = lastSent.length > 0 && target.startsWith(lastSent) ? { a: target.slice(lastSent.length), o: lastSent.length } : target;
            const safeId = Number(reqId) | 0;
            const chunkExpr = `window.__agPrismThoughtOnChunk && window.__agPrismThoughtOnChunk(${safeId}, ${serializeJsonForEval(frame)})`;
            try {
              await sendFireAndForgetEval(entry.session, chunkExpr, executionContextId, 0, { rethrow: true });
              lastSent = target;
              lastFrameAt = Date.now();
            } catch {
              lastSent = '';
            }
            if (pendingPartial !== null && !streamDone && Date.now() - lastFrameAt < THOUGHT_STREAM_FRAME_MS) {
              break;
            }
          }
        } finally {
          sendingPartial = false;
          if (!streamDone && pendingPartial !== null) scheduleFlushPartial();
        }
      };
      try {
        result = await svc.translateThought({
          text: input.text || '',
          mode: input.mode || 'ai',
          priority: Number(input.priority || 0),
          requestId: input.requestId ? String(input.requestId) : '',
          force: Boolean(input.force),
          bypassCache: Boolean(input.bypassCache),
          targetLang: input.targetLang || input.lang || '',
          onPartial: (partialText) => {
            if (streamDone || !entry || entry.session.closed) return;
            pendingPartial = String(partialText || '');
            scheduleFlushPartial();
          },
        });
      } finally {
        streamDone = true;
        pendingPartial = null;
        clearFrameTimer();
      }
    } else {
      result = { ok: false, error: `Unknown thought action: ${action}` };
    }
  } catch (err) {
    result = { ok: false, error: sanitizeSecretText(err?.message || err) };
  }

  if (!entry.session.closed) {
    const safeId = Number(reqId) | 0;
    const payloadExpr = formatJsonArgForEval(result);
    const resolveExpr = `window.__agPrismThoughtResolve && window.__agPrismThoughtResolve(${safeId}, ${payloadExpr})`;
    await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
  }
  if (action === 'save-config' && result && result.ok) {
    const selfNotifyExpr = '(() => { try { window.__agPrismSuggesterSettingsUi?.reloadProfiles?.(); } catch {} try { window.__agPrismSuggester?.sync?.(); } catch {} })()';
    const peerNotifyExpr = "(() => { try { window.__agPrismSuggesterSettingsUi?.reloadProfiles?.(); } catch {} try { window.__agPrismSuggester?.sync?.(); } catch {} try { const sec = document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec'); sec?.__prismThoughtUiHandle?.reloadConfig?.(); } catch {} })()";
    const notifyTasks = [];
    if (!entry.session.closed) {
      notifyTasks.push(sendFireAndForgetEval(entry.session, selfNotifyExpr, executionContextId, 2000));
    }
    for (const other of rpc.sessionRegistry.sessions.values()) {
      if (!other || other === entry) continue;
      const target = resolveTrustedBroadcastContextId(other);
      if (!target.ok) continue;
      notifyTasks.push(sendFireAndForgetEval(other.session, peerNotifyExpr, target.contextId, 2000));
    }
    if (notifyTasks.length > 0) await Promise.allSettled(notifyTasks);
  }
}

async function handleUsageBinding(rpc, entry, payload, executionContextId) {
  if (typeof payload !== 'string' || payload.length > 65536) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
  if (reqId === null) return;
  const tel = rpc.telemetrySubsystem;
  tel.beginActivity();
  let result;
  try {
    const reqScopeKey = typeof parsed.scopeKey === 'string' && parsed.scopeKey.trim() ? parsed.scopeKey.trim() : '';
    result = await tel.fetchUsageRollupBatch(parsed.items, {
      action: parsed.action || 'fetch-batch',
      includeSummaries: Boolean(parsed.includeSummaries),
      entry,
      ...(reqScopeKey ? { scopeKey: reqScopeKey } : {}),
    });
  } catch (err) {
    result = { ok: false, error: sanitizeSecretText(err?.message || err), records: [] };
  } finally {
    tel.endActivity();
  }
  if (!entry.session.closed) {
    const safeId = Number(reqId) | 0;
    const resolveExpr = `window.__agPrismUsageResolve && window.__agPrismUsageResolve(${safeId}, ${formatJsonArgForEval(result)})`;
    await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
  }
}

async function handleInlineDiffBinding(_rpc, entry, payload, executionContextId) {
  const initialCtx = typeof executionContextId === 'number' ? entry.contextFrames?.get(executionContextId) : undefined;
  const expectedDocGen = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : null;
  const checkCtx = () =>
    isTrustedHostContext(entry, executionContextId, expectedDocGen, {
      expectedContext: initialCtx,
      requireTrackedFrames: true,
    });
  if (!checkCtx()) return;
  if (typeof payload !== 'string' || payload.length > INLINE_DIFF_MAX_PAYLOAD_BYTES) return;
  if (Buffer.byteLength(payload, 'utf8') > INLINE_DIFF_MAX_PAYLOAD_BYTES) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  if (!Number.isSafeInteger(parsed.id) || parsed.id < 0) return;
  if (parsed.action !== 'readInlineDiff') return;
  if (typeof parsed.uri !== 'string' || parsed.uri.length > INLINE_DIFF_MAX_URI_LENGTH) return;

  const reqId = serializeJsonForEval(Math.trunc(Number(parsed.id)));
  const hints =
    parsed.hints && typeof parsed.hints === 'object' && !Array.isArray(parsed.hints)
      ? {
          additions: Number.isSafeInteger(parsed.hints.additions) && parsed.hints.additions >= 0 ? parsed.hints.additions : 0,
          deletions: Number.isSafeInteger(parsed.hints.deletions) && parsed.hints.deletions >= 0 ? parsed.hints.deletions : 0,
          ...(parsed.hints.isCreated === true ? { isCreated: true } : {}),
        }
      : undefined;
  const rpcOpts = {};
  if (hints) rpcOpts.hints = hints;
  if (parsed.expand === true) rpcOpts.expand = true;
  let resp;
  try {
    resp = await readSafeInlineDiff(parsed.uri, rpcOpts);
  } catch {
    resp = { ok: false, error: 'internal_error' };
  }
  if (checkCtx()) {
    const resolveExpr = `window.__agPrismInlineDiffResolve?.(${reqId}, ${formatJsonArgForEval(resp)})`;
    await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
  }
  return resp;
}

async function handleOmniBinding(rpc, entry, payload, executionContextId) {
  if (typeof payload !== 'string' || payload.length > 65536) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  const reqId = parsed && Number.isSafeInteger(parsed.id) ? parsed.id : null;
  if (reqId === null) return;
  const action = typeof parsed.action === 'string' ? parsed.action : '';
  const mergedParams = {
    ...parsed,
    ...(parsed.params && typeof parsed.params === 'object' ? parsed.params : {}),
    ...(parsed.input && typeof parsed.input === 'object' ? parsed.input : {}),
    ...(parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {}),
  };
  let result;
  if (!rpc.channelOrchestrator.isChannelEnabled('omni')) {
    result = { ok: false, error: 'omni_disabled' };
  } else {
    try {
      const srv = await rpc.channelOrchestrator.ensureOmniServer();
      result = await srv.handleRpcAction(action, mergedParams);
    } catch (err) {
      result = { ok: false, error: sanitizeSecretText(err?.message || err) };
    }
  }
  if (!entry.session.closed) {
    const safeId = Number(reqId) | 0;
    const jsonRes = formatJsonArgForEval(result);
    const resolveExpr = `(() => { const r = ${jsonRes}; const b = window.__agPrismOmniBridge; if (b && typeof b.resolve === 'function') b.resolve(${safeId}, r); if (typeof window.__agPrismOmniResolve === 'function' && (!b || window.__agPrismOmniResolve !== b.resolve)) window.__agPrismOmniResolve(${safeId}, r); })()`;
    await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
  }
}

async function handleSidebarBinding(rpc, entry, payload, executionContextId) {
  const initialCtx = typeof executionContextId === 'number' ? entry.contextFrames?.get(executionContextId) : undefined;
  const services = rpc.channelOrchestrator.services;
  const checkHost = () =>
    isTrustedHostContext(entry, executionContextId, null, {
      stopped: Boolean(services._sidebarStopped),
      expectedContext: initialCtx,
      requireTrackedFrames: true,
      strictContextType: true,
    });
  if (!checkHost()) return;
  const cdp = rpc.getCdp();
  if (cdp?.readConfig?.()?.sidebarStudio !== 'on') {
    return { ok: false, error: 'Chat Beta is disabled' };
  }
  if (typeof payload !== 'string') return;
  const SIDEBAR_MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;
  if (payload.length > SIDEBAR_MAX_PAYLOAD_BYTES) return;
  const payloadBytes = Buffer.byteLength(payload, 'utf8');
  if (payloadBytes > SIDEBAR_MAX_PAYLOAD_BYTES) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || !Number.isSafeInteger(parsed.id) || parsed.id < 1) return;
  if (parsed.action !== 'import-spark-file' && payloadBytes > 128 * 1024) return;
  const { id, input: _transportCopy, ...request } = parsed;
  const safeId = serializeJsonForEval(Math.trunc(Number(id)));
  const unavailable = {
    ok: false,
    error: { code: 'CAPABILITY_UNAVAILABLE', message: 'Sidebar Studio service unavailable', retryable: true },
  };
  let result = unavailable;
  try {
    if (rpc.getCdp()?.readConfig?.()?.sidebarStudio === 'on') {
      const svc = await rpc.channelOrchestrator.ensureSidebarService();
      if (!checkHost()) return;
      if (typeof svc?.handleRpc === 'function') result = await svc.handleRpc(request);
    } else {
      result = { ok: false, error: 'Chat Beta is disabled' };
    }
  } catch {}
  if (checkHost()) {
    const jsonRes = formatJsonArgForEval(result);
    const resolveExpr = `(() => { const r = ${jsonRes}; const b = window.__agPrismSidebarBridge; if (b && typeof b.resolve === 'function') b.resolve(${safeId}, r); if (typeof window.__agPrismSidebarResolve === 'function' && (!b || window.__agPrismSidebarResolve !== b.resolve)) window.__agPrismSidebarResolve(${safeId}, r); })()`;
    await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
  }
  return result;
}

async function handleWallpaperBinding(rpc, entry, payload, executionContextId) {
  const initialCtx = typeof executionContextId === 'number' ? entry.contextFrames?.get(executionContextId) : undefined;
  const expectedDocGen = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : null;
  const services = rpc.channelOrchestrator.services;
  const checkCtx = () =>
    isTrustedHostContext(entry, executionContextId, expectedDocGen, {
      stopped: Boolean(services._wallpaperStopped),
      expectedContext: initialCtx,
    });
  if (!checkCtx()) return;
  if (typeof payload !== 'string' || payload.length > WALLPAPER_MAX_PAYLOAD_BYTES) return;
  if (Buffer.byteLength(payload, 'utf8') > WALLPAPER_MAX_PAYLOAD_BYTES) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const reqId = Number.isSafeInteger(parsed.id) && parsed.id >= 0 ? parsed.id : null;
  if (reqId === null) return;
  const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
  if (!WALLPAPER_ALLOWED_ACTIONS.has(action)) {
    const errRes = { ok: false, error: `Unknown wallpaper action: ${action || 'empty'}` };
    if (checkCtx()) {
      const safeId = Number(reqId) | 0;
      const resolveExpr = `(() => { const r = ${serializeJsonForEval(errRes)}; if (typeof window.__agPrismWallpaperResolve === 'function') window.__agPrismWallpaperResolve(${safeId}, r); else if (window.__agPrismWallpaperBridge && typeof window.__agPrismWallpaperBridge.resolve === 'function') window.__agPrismWallpaperBridge.resolve(${safeId}, r); })()`;
      await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
    }
    return errRes;
  }
  const actionPayload =
    parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
      ? parsed.payload
      : parsed.input && typeof parsed.input === 'object' && !Array.isArray(parsed.input)
      ? parsed.input
      : {};

  let result;
  let svc = null;
  try {
    svc = await rpc.channelOrchestrator.ensureWallpaperService();
    result = !svc || typeof svc.handleAction !== 'function'
      ? { ok: false, error: 'wallpaper_service_unavailable' }
      : await svc.handleAction(action, actionPayload);
  } catch (err) {
    result = { ok: false, error: sanitizeSecretText(err?.message || err) };
  }

  if (checkCtx()) {
    const safeId = Number(reqId) | 0;
    const payloadExpr = formatJsonArgForEval(result);
    const resolveExpr = `(() => { const r = ${payloadExpr}; if (typeof window.__agPrismWallpaperResolve === 'function') window.__agPrismWallpaperResolve(${safeId}, r); else if (window.__agPrismWallpaperBridge && typeof window.__agPrismWallpaperBridge.resolve === 'function') window.__agPrismWallpaperBridge.resolve(${safeId}, r); })()`;
    await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
  }

  if (result && result.ok && (action === 'save-config' || action === 'pick-media' || action === 'clear-media')) {
    let latestCfg = result.config || null;
    if (!latestCfg && svc && typeof svc.getConfigSync === 'function') {
      try { latestCfg = svc.getConfigSync(); } catch {}
    }
    if (latestCfg && typeof latestCfg === 'object') {
      const syncExpr = `window.__agPrismWallpaper?.applyConfig?.(${serializeJsonForEval(latestCfg)})`;
      for (const other of rpc.sessionRegistry.sessions.values()) {
        if (!other || other === entry || other.wallpaperSkipped) continue;
        if (!isTrustedHostContext(other, other.sidebarHostContextId, null, { requireTrackedFrames: true })) continue;
        void sendFireAndForgetEval(other.session, syncExpr, other.sidebarHostContextId, 2000);
      }
    }
  }
  return result;
}

async function handleSuggesterBinding(rpc, entry, payload, executionContextId) {
  const initialCtx = typeof executionContextId === 'number' ? entry.contextFrames?.get(executionContextId) : undefined;
  const expectedDocGen = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : null;
  const services = rpc.channelOrchestrator.services;
  const checkCtx = () =>
    isTrustedHostContext(entry, executionContextId, expectedDocGen, {
      stopped: Boolean(services._suggesterStopped),
      expectedContext: initialCtx,
    });
  if (!checkCtx()) return;
  if (typeof payload !== 'string' || payload.length > SUGGESTER_MAX_PAYLOAD_BYTES) return;
  if (Buffer.byteLength(payload, 'utf8') > SUGGESTER_MAX_PAYLOAD_BYTES) return;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { return; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  const reqId = Number.isSafeInteger(parsed.id) && parsed.id >= 0 ? parsed.id : null;
  if (reqId === null) return;
  const action = typeof parsed.action === 'string' ? parsed.action.trim() : '';
  if (!SUGGESTER_ALLOWED_ACTIONS.has(action)) {
    const errRes = { ok: false, error: `Unknown suggester action: ${action || 'empty'}` };
    if (checkCtx()) {
      const safeId = Number(reqId) | 0;
      const resolveExpr = `(() => { const r = ${serializeJsonForEval(errRes)}; if (typeof window.__agPrismSuggesterResolve === 'function') window.__agPrismSuggesterResolve(${safeId}, r); else if (window.__agPrismSuggesterBridge && typeof window.__agPrismSuggesterBridge.resolve === 'function') window.__agPrismSuggesterBridge.resolve(${safeId}, r); })()`;
      await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
    }
    return errRes;
  }
  const actionPayload =
    parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
      ? parsed.payload
      : parsed.input && typeof parsed.input === 'object' && !Array.isArray(parsed.input)
      ? parsed.input
      : {};

  let result;
  let svc = null;
  try {
    svc = await rpc.channelOrchestrator.ensureSuggesterService();
    result = !svc || typeof svc.handleAction !== 'function'
      ? { ok: false, error: 'suggester_service_unavailable' }
      : await svc.handleAction(action, actionPayload);
  } catch (err) {
    result = { ok: false, error: sanitizeSecretText(err?.message || err) };
  }

  if (checkCtx()) {
    const safeId = Number(reqId) | 0;
    const payloadExpr = formatJsonArgForEval(result);
    const resolveExpr = `(() => { const r = ${payloadExpr}; if (typeof window.__agPrismSuggesterResolve === 'function') window.__agPrismSuggesterResolve(${safeId}, r); else if (window.__agPrismSuggesterBridge && typeof window.__agPrismSuggesterBridge.resolve === 'function') window.__agPrismSuggesterBridge.resolve(${safeId}, r); })()`;
    await sendFireAndForgetEval(entry.session, resolveExpr, executionContextId);
  }

  const shouldBroadcastSync =
    (action === 'save-config' && Boolean(result && result.ok)) ||
    (action === 'test-connection' && Boolean(Array.isArray(actionPayload?.profiles) || (result && result.ok)));
  if (shouldBroadcastSync) {
    let syncConfig = result?.config && typeof result.config === 'object' ? result.config : null;
    let syncBackend = result?.backend !== undefined ? result.backend : null;
    if (!syncConfig && svc) {
      try {
        if (typeof svc.getPublicState === 'function') {
          const pub = await svc.getPublicState();
          if (pub && typeof pub === 'object') {
            syncConfig = pub.config && typeof pub.config === 'object' ? pub.config : null;
            syncBackend = pub.backend !== undefined ? pub.backend : null;
          }
        } else if (typeof svc.getConfigSync === 'function') {
          syncConfig = svc.getConfigSync();
        }
      } catch {}
    }
    const applyStmt = syncConfig
      ? `try { window.__agPrismSuggester?.applyConfig?.(${serializeJsonForEval(syncConfig)}, ${serializeJsonForEval(syncBackend)}); } catch {}`
      : '';
    const thoughtReloadStmt =
      "try { const sec = document.getElementById?.('ag-cs-settings-sec') || document.getElementById?.('ag-prism-settings-sec'); sec?.__prismThoughtUiHandle?.reloadConfig?.(); } catch {}";
    const selfSyncExpr = `(() => { ${thoughtReloadStmt} ${applyStmt} })()`;
    const peerSyncExpr = `(() => { ${applyStmt} try { window.__agPrismSuggesterSettingsUi?.reloadProfiles?.(); } catch {} ${thoughtReloadStmt} })()`;
    const broadcastTasks = [];
    if (checkCtx()) {
      broadcastTasks.push(sendFireAndForgetEval(entry.session, selfSyncExpr, executionContextId, 2000));
    }
    for (const other of rpc.sessionRegistry.sessions.values()) {
      if (!other || other === entry || other.suggesterSkipped) continue;
      const target = resolveTrustedBroadcastContextId(other);
      if (!target.ok) continue;
      broadcastTasks.push(sendFireAndForgetEval(other.session, peerSyncExpr, target.contextId, 2000));
    }
    if (broadcastTasks.length > 0) await Promise.allSettled(broadcastTasks);
  }
  return result;
}

const STATIC_BINDING_TABLE = Object.freeze({
  [REPO_BINDING]: handleRepoBinding,
  [METRICS_BINDING]: handleMetricsBinding,
  [THOUGHT_BINDING]: handleThoughtBinding,
  [USAGE_BINDING]: handleUsageBinding,
  [INLINE_DIFF_BINDING]: handleInlineDiffBinding,
  [OMNI_BINDING]: handleOmniBinding,
  [SIDEBAR_BINDING]: handleSidebarBinding,
  [WALLPAPER_BINDING]: handleWallpaperBinding,
  [SUGGESTER_BINDING]: handleSuggesterBinding,
});

export class RpcDispatcher {
  constructor({
    getCdp = () => null,
    sessionRegistry = null,
    channelOrchestrator = null,
    telemetrySubsystem = null,
    updateStorageSubsystem = null,
    invokeExecuteRepoAction = null,
    invokeBroadcastConfigRefresh = null,
    invokeEnsureMainFrameId = null,
  } = {}) {
    this._getCdp = getCdp;
    this.sessionRegistry = sessionRegistry;
    this.channelOrchestrator = channelOrchestrator;
    this.telemetrySubsystem = telemetrySubsystem;
    this.updateStorageSubsystem = updateStorageSubsystem;
    this._invokeExecuteRepoAction = invokeExecuteRepoAction;
    this._invokeBroadcastConfigRefresh = invokeBroadcastConfigRefresh;
    this._invokeEnsureMainFrameId = invokeEnsureMainFrameId;
  }

  getCdp() { return this._getCdp(); }

  invokeExecuteRepoAction(payload) {
    if (typeof this._invokeExecuteRepoAction === 'function') return this._invokeExecuteRepoAction(payload);
    return this.updateStorageSubsystem.executeRepoAction(payload);
  }

  invokeBroadcastConfigRefresh() {
    if (typeof this._invokeBroadcastConfigRefresh === 'function') return this._invokeBroadcastConfigRefresh();
    return this.channelOrchestrator.broadcastConfigRefresh();
  }

  invokeEnsureMainFrameId(entry, timeoutMs, retries) {
    if (typeof this._invokeEnsureMainFrameId === 'function') return this._invokeEnsureMainFrameId(entry, timeoutMs, retries);
    return this.sessionRegistry.ensureMainFrameId(entry, timeoutMs, retries);
  }

  async handleBindingCall(entry, { name, payload, executionContextId }) {
    if (!isTrustedMainFrameBindingCall(entry, executionContextId)) {
      if (!entry || entry.mainFrameId || entry.session?.closed) return;
      const hasCtxId = typeof executionContextId === 'number';
      const meta = hasCtxId && entry.contextFrames instanceof Map ? entry.contextFrames.get(executionContextId) : null;
      if (meta && (meta.isDefault !== true || (meta.type && meta.type !== 'default'))) return;
      await this.invokeEnsureMainFrameId(entry, 3000, 0);
      if (!isTrustedMainFrameBindingCall(entry, executionContextId)) return;
    }

    const cdp = this.getCdp();
    if (name === cdp?.SETTING_BINDING || name === cdp?.LEGACY_SETTING_BINDING) {
      return handleSettingBinding(this, entry, payload, executionContextId);
    }
    const activeWallpaperBinding = cdp?.WALLPAPER_BINDING || WALLPAPER_BINDING;
    if (name === activeWallpaperBinding) {
      return handleWallpaperBinding(this, entry, payload, executionContextId);
    }
    const activeSuggesterBinding = cdp?.SUGGESTER_BINDING || SUGGESTER_BINDING;
    if (name === activeSuggesterBinding) {
      return handleSuggesterBinding(this, entry, payload, executionContextId);
    }
    const handler = STATIC_BINDING_TABLE[name];
    if (typeof handler === 'function') {
      return handler(this, entry, payload, executionContextId);
    }
  }
}
