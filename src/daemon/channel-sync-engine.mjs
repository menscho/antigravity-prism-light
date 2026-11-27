// Obsidian Prism 全 16 通道表驱动挂载、3 级关键路径流水线、按需 Ch8 下发、配置广播收敛与拆卸引擎（消费 CHANNEL_REGISTRY）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import {
  THOUGHT_BINDING,
  SIDEBAR_BINDING,
  INLINE_DIFF_BINDING,
  WALLPAPER_BINDING,
  SUGGESTER_BINDING,
} from './constants.mjs';
import {
  ENTRY_FSM_STATES,
  ensureEntryFsm,
  transitionEntryState,
  recordEntryCh1Outcome,
  resetAllChannelCircuits,
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelOff,
  recordChannelFailure,
} from './session-fsm.mjs';
import { CHANNEL_STATIC_SPECS, buildSidebarCleanupExpression } from './channel-coordinator.mjs';

const BINDING_BY_CHANNEL = Object.freeze({
  omni: { name: () => OMNI_BINDING, addedField: 'omniBindingAdded' },
  sidebar: { name: () => SIDEBAR_BINDING, addedField: 'sidebarBindingAdded' },
  thought: { name: () => THOUGHT_BINDING, addedField: 'thoughtBindingAdded' },
  inlineDiff: { name: () => INLINE_DIFF_BINDING, addedField: 'inlineDiffBindingAdded' },
  wallpaper: { name: (cdp) => cdp?.WALLPAPER_BINDING || WALLPAPER_BINDING, addedField: 'wallpaperBindingAdded' },
  suggester: { name: (cdp) => cdp?.SUGGESTER_BINDING || SUGGESTER_BINDING, addedField: 'suggesterBindingAdded' },
});

const PERSISTENT_SPECS = Object.freeze(
  CHANNEL_STATIC_SPECS.filter((s) => s.injectMode === 'main-page-persistent').sort((a, b) => a.order - b.order)
);

const PERIODIC_STUB_CLEANUP_SNIPPET =
  "try{window.__agPrismPeriodicStub?.destroy?.()}catch{}for(const k of['__agPrismPeriodicStub','__agPrismPeriodicStubFactory','__agPeriodicPendingOpen','__agPeriodicFullLoaded','__agPeriodicStubHash']){try{delete window[k]}catch{}try{delete globalThis[k]}catch{}}";

function isTier2PipelineSpec(spec) {
  return spec.tier === 'core' || spec.tier === 'i18n' || spec.id === 'telemetry' || spec.id === 'homeStudio';
}

export function evalFireAndForgetSafe(session, expr, timeoutMs = 0, executionContextId = null) {
  if (!session || session.closed || !expr) return Promise.resolve();
  const trimmed = String(expr).trim().replace(/;+\s*$/, '');
  const expression = `${trimmed};void 0`;
  const hasCtx = typeof executionContextId === 'number' && executionContextId > 0;
  const hasOwnEval = Object.prototype.hasOwnProperty.call(session, 'evaluate') && typeof session.evaluate === 'function';
  if (typeof session.send === 'function' && (hasCtx || !hasOwnEval || Boolean(session.parent))) {
    const params = { expression, returnByValue: false, awaitPromise: false };
    if (hasCtx) params.contextId = executionContextId;
    const p = timeoutMs > 0 ? session.send('Runtime.evaluate', params, timeoutMs) : session.send('Runtime.evaluate', params);
    return p.catch(() => {});
  }
  if (typeof session.evaluate === 'function') {
    const p = timeoutMs > 0 ? session.evaluate(expr, false, timeoutMs) : session.evaluate(expr);
    return p.catch(() => {});
  }
  return Promise.resolve();
}

function buildEffectiveCleanupExpr(orch, spec, forceSidebarCleanup = false) {
  if (spec.id === 'sidebar') return buildSidebarCleanupExpression(forceSidebarCleanup);
  const base = orch.getChannelCleanupExpression(spec);
  if (spec.id === 'periodicPicker') {
    return `(() => { ${PERIODIC_STUB_CLEANUP_SNIPPET} ${base ? `try { (${base}); } catch {}` : ''} })()`;
  }
  return base;
}

function resetEntryChannelState(entry, spec, markSkipped = false) {
  const f = spec.fields;
  if (f.mountedField) entry[f.mountedField] = false;
  if (f.sigField) entry[f.sigField] = '';
  if (f.scriptSigField) entry[f.scriptSigField] = '';
  if (f.skippedField) entry[f.skippedField] = Boolean(markSkipped);
  if (spec.id === 'hostI18n') entry.hostI18nSkippedByLiveCfg = false;
  if (spec.id === 'periodicPicker') entry.periodicPickerFullDelivered = false;
  recordChannelOff(entry, spec.id);
}

export async function evalChannelExpressionSafe(session, expr, timeoutMs) {
  try {
    return timeoutMs > 0 ? await session.evaluate(expr, false, timeoutMs) : await session.evaluate(expr);
  } catch (err) {
    return {
      ok: false,
      status: 'eval-error',
      error: String(err && err.message ? err.message : err || 'evaluate-threw').slice(0, 300),
      stack: String(err && err.stack ? err.stack : '').slice(0, 600),
    };
  }
}

export function extractChannelFailureDetail(evalRes) {
  if (!evalRes || typeof evalRes !== 'object') {
    return { error: 'empty-eval-result', stack: '', hasCrashDetail: false };
  }
  const errStr = typeof evalRes.error === 'string' && evalRes.error.trim() ? evalRes.error.trim() : '';
  const statusStr = typeof evalRes.status === 'string' && evalRes.status.trim() ? evalRes.status.trim() : '';
  const stackStr = typeof evalRes.stack === 'string' && evalRes.stack.trim() ? evalRes.stack.trim() : '';
  return {
    error: errStr || statusStr || 'channel-eval-failed',
    stack: stackStr,
    hasCrashDetail: Boolean(errStr || statusStr === 'error' || statusStr === 'eval-error'),
  };
}

export function recordChannelEvalFailure(orch, entry, channelId, evalRes, { now = Date.now(), stage = '' } = {}) {
  const detail = extractChannelFailureDetail(evalRes);
  const redactedErr = typeof orch?.redact === 'function' ? orch.redact(detail.error) : detail.error;
  const st = recordChannelFailure(entry, channelId, { now, error: redactedErr, stage });
  if (detail.hasCrashDetail && typeof orch?.log === 'function') {
    const stackPreview = detail.stack
      ? ` | ${String(typeof orch.redact === 'function' ? orch.redact(detail.stack) : detail.stack).replace(/[\r\n]+/g, ' ').slice(0, 220)}`
      : '';
    orch.log(`[!] Channel "${channelId}" failed [${stage || 'unknown'}] (fails=${st?.failCount || 1}): ${st?.lastError || redactedErr}${stackPreview}`);
  }
  return st;
}

export async function ensureChannelBinding(orch, entry, channelId, timeoutMs = 2600, force = false) {
  const meta = BINDING_BY_CHANNEL[channelId];
  if (!meta || !entry || entry.session.closed) return false;
  if (meta.addedField && !force && entry[meta.addedField]) return true;
  const bindingName = meta.name(orch.getCdp());
  if (!bindingName) return false;
  const ok = await entry.session.send('Runtime.addBinding', { name: bindingName }, timeoutMs).then(() => true).catch(() => false);
  if (ok && meta.addedField) entry[meta.addedField] = true;
  return ok;
}

export async function removeChannelBinding(orch, entry, channelId, timeoutMs = 2000) {
  const meta = BINDING_BY_CHANNEL[channelId];
  if (!meta || !entry || entry.session.closed) return;
  if (channelId === 'sidebar' && !entry.sidebarBindingAdded) return;
  const bindingName = meta.name(orch.getCdp());
  if (bindingName) {
    await entry.session.send('Runtime.removeBinding', { name: bindingName }, timeoutMs).catch(() => {});
  }
  if (meta.addedField) entry[meta.addedField] = false;
}

export async function replaceEntryNewDocScript(entry, scriptProp, source, sessionOverride = null) {
  const session = sessionOverride || entry?.session;
  if (!entry || !scriptProp) return null;
  if (!entry._newDocLocks) entry._newDocLocks = new Map();
  const prev = entry._newDocLocks.get(scriptProp) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  entry._newDocLocks.set(scriptProp, gate);
  await prev;
  try {
    if (entry[scriptProp] && session && !session.closed) {
      await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry[scriptProp] }).catch(() => {});
    }
    entry[scriptProp] = null;
    if (!source || !session || session.closed) return null;
    const addRes = await session.send('Page.addScriptToEvaluateOnNewDocument', { source }).catch(() => null);
    if (addRes && addRes.identifier) {
      entry[scriptProp] = addRes.identifier;
      return addRes.identifier;
    }
    return null;
  } finally {
    if (entry._newDocLocks.get(scriptProp) === gate) entry._newDocLocks.delete(scriptProp);
    release();
  }
}

export async function syncPersistentNewDocScript(entry, enabled, source, scriptProp, sigProp, targetSig) {
  if (!scriptProp) return;
  if (!enabled || !source) {
    if (entry[scriptProp]) {
      await replaceEntryNewDocScript(entry, scriptProp, '');
    }
    if (sigProp) entry[sigProp] = '';
    return;
  }
  if (!entry.session.closed && (!entry[scriptProp] || (sigProp && entry[sigProp] !== targetSig))) {
    const id = await replaceEntryNewDocScript(entry, scriptProp, source);
    if (id && sigProp) entry[sigProp] = targetSig;
  }
}

export async function recordTrackableSkipOutcome(orch, entry, spec, evalRes, hash, now = Date.now(), stage = 'apply') {
  const f = spec.fields;
  const isSkipped = Boolean(evalRes && typeof evalRes.status === 'string' && evalRes.status.startsWith('skipped-'));
  if (evalRes && evalRes.ok) {
    entry[f.mountedField] = true;
    entry[f.skippedField] = false;
    entry[f.sigField] = hash;
    recordChannelSuccess(entry, spec.id, { codeHash: hash, scriptId: entry[f.scriptField] });
  } else if (isSkipped) {
    entry[f.mountedField] = false;
    entry[f.skippedField] = true;
    entry[f.sigField] = hash;
    recordChannelSkipped(entry, spec.id, { codeHash: hash });
    if (evalRes.status === 'skipped-non-host') await removeChannelBinding(orch, entry, spec.id);
  } else {
    entry[f.mountedField] = false;
    entry[f.skippedField] = false;
    entry[f.sigField] = '';
    recordChannelEvalFailure(orch, entry, spec.id, evalRes, { now, stage });
  }
}

async function recordPersistentEvalOutcome(orch, entry, spec, evalRes, { chHash, chSig, scriptId, stage, now = Date.now(), resetThoughtOnFail = false }) {
  const id = spec.id;
  const f = spec.fields;
  if (spec.tracksSkippedNonHost) {
    await recordTrackableSkipOutcome(orch, entry, spec, evalRes, chHash, now, stage);
  } else if (id === 'omni') {
    if (evalRes && evalRes.ok !== false) recordChannelSuccess(entry, 'omni', { scriptId });
    else recordChannelEvalFailure(orch, entry, 'omni', evalRes, { now, stage });
  } else if (id === 'sidebar') {
    if (evalRes === null || evalRes?.status === 'error' || evalRes?.status === 'eval-error' || (evalRes?.ok === false && evalRes?.error)) {
      recordChannelEvalFailure(orch, entry, 'sidebar', evalRes, { now, stage });
    } else {
      entry.sidebarMounted = true;
      recordChannelSuccess(entry, 'sidebar', { scriptId });
    }
  } else if (id === 'hostI18n') {
    if (evalRes?.skippedByLiveCfg) {
      entry.hostI18nMounted = false;
      entry.hostI18nSkippedByLiveCfg = true;
      entry.lastHostI18nSig = chSig;
      recordChannelSkipped(entry, 'hostI18n', { codeHash: chSig });
    } else if (evalRes && evalRes.ok) {
      entry.hostI18nMounted = true;
      entry.hostI18nSkippedByLiveCfg = false;
      entry.lastHostI18nSig = chSig;
      recordChannelSuccess(entry, 'hostI18n', { codeHash: chSig, scriptId });
    } else {
      recordChannelEvalFailure(orch, entry, 'hostI18n', evalRes, { now, stage });
    }
  } else if (evalRes && evalRes.ok) {
    if (spec.respectSkippedByLiveCfg && evalRes.skippedByLiveCfg) {
      entry[f.mountedField] = false;
      if (f.sigField) entry[f.sigField] = chSig;
      recordChannelSkipped(entry, id, { codeHash: chHash || chSig });
    } else {
      if (f.mountedField) entry[f.mountedField] = true;
      if (f.sigField) entry[f.sigField] = chSig;
      recordChannelSuccess(entry, id, { codeHash: chHash || chSig, scriptId });
    }
  } else {
    if (id === 'thought' && resetThoughtOnFail) {
      entry.thoughtMounted = false;
      entry.lastThoughtSig = '';
    }
    recordChannelEvalFailure(orch, entry, id, evalRes, { now, stage });
  }
}

// Ch8 按需拉取完整 8 模块包并自动接管轻桩（由 request-periodic-picker 控制信道触发）
export async function deliverPeriodicPickerFullToEntry(orch, entry, executionContextId = null) {
  if (!orch || !entry || entry.session?.closed || entry._periodicPickerFullInFlight) return false;
  const cdp = orch.getCdp();
  const cfgNow = typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null;
  const spec = orch.getRegisteredChannel('periodicPicker');
  if (!spec || !orch.isChannelEnabled(spec, cfgNow) || !orch.hasChannelFile(spec)) return false;
  if (typeof cdp?.buildPeriodicPickerExpression !== 'function') return false;

  const opts = orch.getChannelCacheOpts(true);
  const fullExpr = opts
    ? cdp.buildPeriodicPickerExpression(cfgNow, opts)
    : cdp.buildPeriodicPickerExpression(cfgNow);
  if (!fullExpr) return false;
  if (opts && orch.isRunning()) orch.scheduleBundleCacheFlush();

  entry._periodicPickerFullInFlight = true;
  try {
    const evalParams = { expression: fullExpr, returnByValue: true };
    if (typeof executionContextId === 'number' && executionContextId > 0) evalParams.contextId = executionContextId;
    let caughtErr = null;
    const res = await entry.session.send('Runtime.evaluate', evalParams, 8000).catch((err) => {
      caughtErr = err;
      return null;
    });
    const val = res?.result?.value;
    if (val?.ok) {
      entry.periodicPickerMounted = !val.skippedByLiveCfg;
      entry.periodicPickerFullDelivered = !val.skippedByLiveCfg;
      const stubExpr = orch.getChannelExpr('periodicPicker');
      const stubHash = stubExpr ? orch.getChannelExprHash(spec, stubExpr) : orch.getChannelExprHash(spec, fullExpr);
      const stubSig = stubExpr ? orch.getChannelCfgSig(spec, cfgNow, stubExpr) : orch.getChannelCfgSig(spec, cfgNow, fullExpr);
      if (stubSig) entry.lastPeriodicPickerSig = stubSig;
      if (val.skippedByLiveCfg) recordChannelSkipped(entry, 'periodicPicker', { codeHash: stubHash });
      else recordChannelSuccess(entry, 'periodicPicker', { codeHash: stubHash, scriptId: entry.periodicPickerScriptId });
      return true;
    }
    const errObj = caughtErr
      ? { ok: false, status: 'eval-error', error: String(caughtErr.message || caughtErr).slice(0, 300), stack: String(caughtErr.stack || '').slice(0, 600) }
      : res?.exceptionDetails
        ? { ok: false, status: 'eval-error', error: String(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'exception').slice(0, 300) }
        : val;
    recordChannelEvalFailure(orch, entry, 'periodicPicker', errObj, { stage: 'on-demand-rpc' });
    return false;
  } finally {
    entry._periodicPickerFullInFlight = false;
  }
}

export async function cleanupChannelOnEntry(orch, entry, spec, { forceSidebarCleanup = false, timeoutMs = 3500 } = {}) {
  if (!entry || !spec) return;
  const f = spec.fields;
  if (f.scriptField) await replaceEntryNewDocScript(entry, f.scriptField, '');
  if (spec.id === 'sidebar' || spec.id === 'wallpaper' || spec.id === 'suggester') {
    await removeChannelBinding(orch, entry, spec.id);
  }
  if (!entry.session.closed) {
    const cleanupExpr = buildEffectiveCleanupExpr(orch, spec, forceSidebarCleanup);
    if (cleanupExpr) await evalFireAndForgetSafe(entry.session, cleanupExpr, timeoutMs);
  }
  resetEntryChannelState(entry, spec, false);
}

export async function teardownAllEntryChannelScripts(
  orch,
  entry,
  session = entry?.session,
  { markSkippedNonHost = false, removeBindings = true, resetMascot = true, resetHomeStudio = true } = {}
) {
  if (!entry) return;
  await replaceEntryNewDocScript(entry, 'scriptId', '', session);

  for (const spec of PERSISTENT_SPECS) {
    if ((spec.id === 'mascot' && !resetMascot) || (spec.id === 'homeStudio' && !resetHomeStudio)) continue;
    const f = spec.fields;
    if (f.scriptField) {
      await replaceEntryNewDocScript(entry, f.scriptField, '', session);
    }
    resetEntryChannelState(entry, spec, markSkippedNonHost);
  }

  if (removeBindings) {
    for (const id of ['sidebar', 'inlineDiff', 'wallpaper', 'suggester']) {
      await removeChannelBinding(orch, entry, id);
    }
  }
}

export async function healSingleChannelOnEntry(orch, entry, spec, cfg, probe, { afterCh1Heal = false, hashMismatch = false, forceEval = false, now = Date.now() } = {}) {
  const id = spec.id;
  const f = spec.fields;

  if (id === 'omni' && !afterCh1Heal) {
    await orch.ensureOmniServer().catch(() => null);
    await ensureChannelBinding(orch, entry, 'omni', 2600, true);
  } else if (id === 'sidebar' && !afterCh1Heal) {
    await orch.ensureSidebarService().catch(() => null);
    await ensureChannelBinding(orch, entry, 'sidebar', 2600, true);
  } else if ((id === 'thought' || id === 'inlineDiff') && !afterCh1Heal) {
    await ensureChannelBinding(orch, entry, id, 2600, true);
  } else if (id === 'wallpaper' || id === 'suggester') {
    await ensureChannelBinding(orch, entry, id, 2600, true);
  }

  const activeExpr = orch.ensureChannelExpr(spec, cfg);
  if (!activeExpr || entry.session.closed) return;

  const chHash = orch.getChannelExprHash(spec, activeExpr);
  const chSig = id === 'omni' ? activeExpr : orch.getChannelCfgSig(spec, cfg, activeExpr);

  if (f.scriptField && id !== 'sidebar') {
    const needScriptReplace =
      !entry[f.scriptField] ||
      (id === 'wallpaper' && Boolean(chHash && entry[f.scriptSigField] !== chHash)) ||
      (id !== 'omni' && id !== 'thought' && !spec.tracksSkippedNonHost && Boolean(chSig && entry[f.scriptSigField] !== chSig));
    if (needScriptReplace) {
      const addedId = await replaceEntryNewDocScript(entry, f.scriptField, activeExpr);
      if (f.scriptSigField) entry[f.scriptSigField] = addedId ? chSig : '';
    }
  }

  let needsEval = forceEval || afterCh1Heal || !probe;
  if (!needsEval) {
    if (id === 'omni' || id === 'sidebar') needsEval = true;
    else if (id === 'thought') needsEval = !probe.hasThought || !probe.hasThoughtSettingsUi || !entry.thoughtMounted;
    else if (id === 'inlineDiff') needsEval = !probe.hasInlineDiff || !entry.inlineDiffMounted;
    else if (id === 'wallpaper') needsEval = !probe.hasWallpaper || !probe.hasWallpaperUi || hashMismatch || !entry.wallpaperMounted;
    else if (id === 'suggester') needsEval = probe.hasSuggester === false || probe.hasSuggesterUi === false || !entry.suggesterMounted;
    else needsEval = !probe[f.probeHasField] || Boolean(chHash && f.probeHashField && probe[f.probeHashField] !== chHash);
  }
  if (!needsEval || entry.session.closed) return;

  const evalTimeoutMs = id === 'omni' || id === 'sidebar' ? 3500 : 4500;
  const evalRes = await evalChannelExpressionSafe(entry.session, activeExpr, evalTimeoutMs);
  await recordPersistentEvalOutcome(orch, entry, spec, evalRes, {
    chHash,
    chSig,
    scriptId: entry[f.scriptField],
    stage: 'heal',
    now,
    resetThoughtOnFail: afterCh1Heal,
  });
}

async function applySinglePersistentChannel(orch, entry, spec, getCurrentCfg) {
  if (entry.session.closed) return;
  const cfgNow = getCurrentCfg();
  const id = spec.id;
  const f = spec.fields;
  const hadBefore = Boolean((f.scriptField && entry[f.scriptField]) || (f.mountedField && entry[f.mountedField]) || (id === 'omni' && entry.lastOmniExpr));

  if (id === 'hostI18n' && cfgNow?.hostLocalization === 'off' && !entry.session.closed) {
    await orch.swarmManager.syncIsolatedHostI18n(entry, true);
  }
  if (f.scriptField) await replaceEntryNewDocScript(entry, f.scriptField, '');

  const enabledNow = spec.tracksSkippedNonHost
    ? true
    : orch.isChannelEnabled(spec, cfgNow) && (id === 'omni' || id === 'sidebar' || id === 'hostI18n' || id === 'thought' || orch.hasChannelFile(spec));

  if (enabledNow) {
    if (id === 'sidebar' && !orch.services.sidebarService) await orch.ensureSidebarService().catch(() => null);
    if (BINDING_BY_CHANNEL[id]) await ensureChannelBinding(orch, entry, id);
    const activeExpr = id === 'omni' ? orch.getChannelExpr('omni') : orch.ensureChannelExpr(spec, cfgNow);
    if (activeExpr) {
      const chHash = orch.getChannelExprHash(spec, activeExpr);
      const chSig = id === 'omni' ? activeExpr : orch.getChannelCfgSig(spec, cfgNow, activeExpr);
      const addedId = f.scriptField ? await replaceEntryNewDocScript(entry, f.scriptField, activeExpr) : null;
      if (f.scriptSigField) entry[f.scriptSigField] = addedId ? chSig : '';
      const evalRes = await evalChannelExpressionSafe(entry.session, activeExpr, 0);
      await recordPersistentEvalOutcome(orch, entry, spec, evalRes, {
        chHash,
        chSig,
        scriptId: addedId,
        stage: 'apply',
        resetThoughtOnFail: true,
      });
    } else if (hadBefore) {
      await cleanupChannelOnEntry(orch, entry, spec, { forceSidebarCleanup: hadBefore, timeoutMs: 0 });
    } else {
      resetEntryChannelState(entry, spec, false);
    }
  } else if (id === 'sidebar') {
    await removeChannelBinding(orch, entry, 'sidebar');
    await evalFireAndForgetSafe(entry.session, buildSidebarCleanupExpression(hadBefore), 0);
    entry.sidebarMounted = false;
    recordChannelOff(entry, 'sidebar');
  } else if (hadBefore) {
    await cleanupChannelOnEntry(orch, entry, spec, { timeoutMs: 0 });
  } else {
    resetEntryChannelState(entry, spec, false);
  }

  if (id === 'hostI18n' && cfgNow?.hostLocalization !== 'off' && entry.isolatedHostI18nPaused && !entry.session.closed) {
    await orch.swarmManager.syncIsolatedHostI18n(entry, false);
  }
}

export async function applyAllChannelsToEntry(orch, entry) {
  return orch.sessionRegistry.runExclusive(entry, async () => {
    if (!entry || entry.session.closed) return null;
    ensureEntryFsm(entry);
    transitionEntryState(entry, ENTRY_FSM_STATES.INJECTING_CH1, 'applyToEntry');
    const cdp = orch.getCdp();
    const readCfg = () => (typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null);
    let cfgSeq = orch._configSeq;
    let cfg = readCfg();
    const getCurrentCfg = () => {
      if (orch._configSeq !== cfgSeq) {
        cfgSeq = orch._configSeq;
        cfg = readCfg();
      }
      return cfg;
    };

    const omniEnabledInit = orch.isChannelEnabled(orch.getRegisteredChannel('omni'), cfg);
    const sidebarEnabledInit = orch.isChannelEnabled(orch.getRegisteredChannel('sidebar'), cfg);
    await Promise.all([
      omniEnabledInit ? orch.ensureOmniServer().catch(() => null) : Promise.resolve(null),
      sidebarEnabledInit ? orch.ensureSidebarService().catch(() => null) : Promise.resolve(null),
    ]);

    if (!orch.injectExpr) {
      orch.rebuildBundle();
    } else {
      const curCfg = getCurrentCfg();
      const chOpts = orch.getChannelCacheOpts(true);
      let usedChCache = false;
      for (const spec of PERSISTENT_SPECS) {
        if (spec.id === 'omni' && !omniEnabledInit) { orch.setChannelExpr('omni', ''); continue; }
        if (orch.getChannelExpr(spec.id)) continue;
        if (spec.id === 'omni' && !orch.services.omniServer) continue;
        const canBuild = spec.tracksSkippedNonHost
          ? true
          : orch.isChannelEnabled(spec, curCfg) && (spec.id === 'omni' || spec.id === 'sidebar' || spec.id === 'hostI18n' || spec.id === 'thought' || orch.hasChannelFile(spec));
        if (!canBuild) continue;
        const built = orch.buildChannelExpr(spec, curCfg, chOpts);
        if (chOpts && built) usedChCache = true;
      }
      if (usedChCache && orch.isRunning()) orch.scheduleBundleCacheFlush();
    }

    // Tier 1：Ch1 样式与运行期主框架优先注入
    await replaceEntryNewDocScript(entry, 'scriptId', orch.injectExpr);
    const sidebarDocument = entry.sidebarDocument;
    const mainRes = await entry.session.evaluate(orch.injectExpr);
    orch.sessionRegistry.markSidebarHostVerified(entry, sidebarDocument, mainRes?.status === 'ok');
    const ch1Outcome = recordEntryCh1Outcome(entry, mainRes, sidebarDocument);

    if (mainRes && mainRes.status === 'skipped-non-host') {
      await teardownAllEntryChannelScripts(orch, entry, entry.session, {
        markSkippedNonHost: true,
        resetMascot: false,
        resetHomeStudio: true,
      });
      return mainRes;
    }

    if (ch1Outcome.deferred) {
      entry.lastVerifyAt = Date.now();
      entry.verifyDirty = false;
      entry.lastVerifiedCodeHash = orch.codeHash || '';
      return mainRes;
    }

    // Tier 2：核心可见交互通道（core / i18n / telemetry / homeStudio）并发注入
    const tier2Specs = PERSISTENT_SPECS.filter(isTier2PipelineSpec);
    const tier3Specs = PERSISTENT_SPECS.filter((s) => !isTier2PipelineSpec(s));
    if (!entry.session.closed && tier2Specs.length > 0) {
      await Promise.allSettled(tier2Specs.map((spec) => applySinglePersistentChannel(orch, entry, spec, getCurrentCfg)));
    }
    // Tier 3：次级与轻桩通道分批并发（每批 4 个）
    for (let i = 0; i < tier3Specs.length && !entry.session.closed; i += 4) {
      await Promise.allSettled(tier3Specs.slice(i, i + 4).map((spec) => applySinglePersistentChannel(orch, entry, spec, getCurrentCfg)));
    }

    entry.lastVerifyAt = Date.now();
    entry.healthyStreak = 1;
    entry.verifyDirty = false;
    entry.lastVerifiedCodeHash = orch.codeHash || '';
    entry.appliedConfigSeq = orch._configSeq;
    if (entry.fsmState === ENTRY_FSM_STATES.INJECTING_CH1) {
      transitionEntryState(entry, ENTRY_FSM_STATES.HEALTHY_BACKOFF, 'apply-complete');
    }
    return mainRes;
  });
}

export async function runBroadcastConfigRefresh(orch) {
  orch._broadcastPending = true;
  if (orch._broadcastRunning) {
    return new Promise((resolve) => { orch._broadcastWaiters.push(resolve); });
  }

  orch._broadcastRunning = true;
  try {
    while (orch._broadcastPending) {
      orch._broadcastPending = false;
      const snapSeq = orch._configSeq;
      const activeItems = [...orch.sessionRegistry.sessions.values()].filter((item) => item && !item.session.closed);
      const perEntryAck = new Map();
      for (const item of activeItems) {
        resetAllChannelCircuits(item);
        const entryAck = Number.isSafeInteger(item.pendingAckEpoch) && item.pendingAckEpoch > 0 ? item.pendingAckEpoch : 0;
        item.pendingAckEpoch = 0;
        perEntryAck.set(item, entryAck);
      }

      const restoreAllAcks = () => {
        for (const [item, ack] of perEntryAck.entries()) {
          if (ack > 0) item.pendingAckEpoch = Math.max(Number(item.pendingAckEpoch || 0), ack);
        }
      };

      const cdpPre = orch.getCdp();
      const preCfg = typeof cdpPre?.readConfig === 'function' ? cdpPre.readConfig() : {};
      if (orch.isChannelEnabled(orch.getRegisteredChannel('omni'), preCfg)) {
        await orch.ensureOmniServer().catch(() => null);
        if (orch._configSeq !== snapSeq) { restoreAllAcks(); orch._broadcastPending = true; continue; }
      } else if (orch.services.omniServer) {
        orch.setChannelExpr('omni', '');
        await orch.services.stopOmniServer();
        if (orch._configSeq !== snapSeq) { restoreAllAcks(); orch._broadcastPending = true; continue; }
      }
      if (preCfg?.sidebarStudio === 'on') {
        await orch.ensureSidebarService().catch(() => null);
        if (orch._configSeq !== snapSeq) { restoreAllAcks(); orch._broadcastPending = true; continue; }
      }

      orch.invokeRebuildBundle({ deferDiskCacheWrite: true });
      const cdp = orch.getCdp();
      const injectSnap = orch.injectExpr;
      const currentCfg = typeof cdp?.readConfig === 'function' ? cdp.readConfig() : {};
      orch._configFingerprintTracker?.recordApplied(currentCfg);
      if (currentCfg?.telemetryModule === 'off') orch.onTelemetryDisabled?.();
      orch.onConfigRefreshed?.(currentCfg);

      const channelSnaps = PERSISTENT_SPECS.map((spec) => {
        const id = spec.id;
        const enabled = spec.tracksSkippedNonHost
          ? true
          : orch.isChannelEnabled(spec, currentCfg) &&
            (id === 'omni' || id === 'sidebar' || id === 'hostI18n' || id === 'thought' || orch.hasChannelFile(spec));
        let snap = orch.getChannelExpr(id);
        if (enabled && !snap && id !== 'omni' && id !== 'sidebar' && id !== 'hostI18n') {
          snap = orch.buildChannelExpr(spec, currentCfg);
        }
        const hash = snap ? orch.getChannelExprHash(spec, snap) : '';
        const sig = enabled ? (id === 'omni' ? snap : orch.getChannelCfgSig(spec, currentCfg, snap)) : '';
        return { spec, enabled: spec.tracksSkippedNonHost ? Boolean(snap) : enabled, snap, hash, sig };
      });

      const canFastRefresh = typeof cdp?.buildConfigRefreshExpression === 'function';
      const baseRefreshExpr = canFastRefresh ? cdp.buildConfigRefreshExpression() : null;
      await orch.swarmManager.syncSwarmSessionsForConfig(currentCfg).catch(() => {});
      if (activeItems.length === 0) continue;

      await Promise.allSettled(
        activeItems.map((entry) =>
          orch.sessionRegistry.runExclusive(entry, async () => {
            if (!entry || entry.session.closed) return;
            const entryAck = perEntryAck.get(entry) || 0;
            const forceFullConvergence = Boolean(entry._configConvergenceDirty);
            const abortIfStale = () => {
              if (orch._configSeq !== snapSeq) {
                if (entryAck > 0) entry.pendingAckEpoch = Math.max(Number(entry.pendingAckEpoch || 0), entryAck);
                entry._configConvergenceDirty = true;
                orch._broadcastPending = true;
                return true;
              }
              return entry.session.closed;
            };
            if (abortIfStale()) return;

            const hostI18nOffNow = currentCfg?.hostLocalization === 'off';
            let isoPauseRes = null;
            if (hostI18nOffNow && !entry.session.closed) isoPauseRes = await orch.swarmManager.syncIsolatedHostI18n(entry, true);
            if (abortIfStale()) return;

            const refreshExpr =
              canFastRefresh && entryAck > 0
                ? cdp.buildConfigRefreshExpression(null, { __ackEpoch: entryAck })
                : baseRefreshExpr;
            let refreshedFast = false;
            let skippedStale = false;
            if (refreshExpr) {
              if (abortIfStale()) return;
              const fastRes = await entry.session.evaluate(refreshExpr).catch(() => null);
              if (fastRes && fastRes.refreshed) {
                refreshedFast = true;
                skippedStale = Boolean(fastRes.skippedStale);
              }
            }
            if (abortIfStale()) return;
            if (!refreshedFast && !entry.session.closed) {
              await entry.session.evaluate(injectSnap).catch(() => {});
            }

            for (const cs of channelSnaps) {
              if (abortIfStale()) return;
              const { spec, enabled, snap, hash, sig } = cs;
              const id = spec.id;
              const f = spec.fields;
              const hadBefore = Boolean(
                (f.scriptField && entry[f.scriptField]) ||
                  (f.mountedField && entry[f.mountedField]) ||
                  (id === 'omni' && entry.lastOmniExpr) ||
                  (id === 'sidebar' && entry.sidebarBindingAdded)
              );

              if (id === 'sidebar') {
                if (enabled) {
                  if (!skippedStale && !entry.session.closed) {
                    await ensureChannelBinding(orch, entry, 'sidebar');
                    if (snap && !entry.session.closed) {
                      const sbRes = await evalChannelExpressionSafe(entry.session, snap, 0);
                      await recordPersistentEvalOutcome(orch, entry, spec, sbRes, { chHash: hash, chSig: sig, scriptId: entry.sidebarScriptId, stage: 'broadcast' });
                    }
                  }
                } else {
                  await removeChannelBinding(orch, entry, 'sidebar');
                  if (hadBefore && !skippedStale && !entry.session.closed) {
                    await evalFireAndForgetSafe(entry.session, buildSidebarCleanupExpression(true), 0);
                  }
                  entry.sidebarMounted = false;
                  recordChannelOff(entry, 'sidebar');
                }
                continue;
              }

              if (id === 'hostI18n') {
                const skippedSameSig = Boolean(entry.hostI18nSkippedByLiveCfg && entry.lastHostI18nSig === sig);
                const changed = Boolean(
                  enabled && snap && !skippedSameSig &&
                    (forceFullConvergence || entry.lastHostI18nSig !== sig || !entry.hostI18nScriptId || !entry.hostI18nMounted)
                );
                if (enabled && snap) {
                  let evaluatedFresh = false;
                  if (!skippedStale && !entry.session.closed && (!refreshedFast || changed)) {
                    const evalRes = await evalChannelExpressionSafe(entry.session, snap, 0);
                    evaluatedFresh = Boolean(evalRes && evalRes.ok && !evalRes.skippedByLiveCfg && !evalRes.reused);
                    await recordPersistentEvalOutcome(orch, entry, spec, evalRes, { chHash: hash, chSig: sig, scriptId: entry.hostI18nScriptId, stage: 'broadcast' });
                  }
                  if (hostI18nOffNow && isoPauseRes && isoPauseRes.newlyPaused && !evaluatedFresh && !skippedStale && !entry.session.closed) {
                    await orch.swarmManager.forceMainWorldHostI18nOffRescan(entry);
                  }
                } else if (hadBefore && !skippedStale && !entry.session.closed) {
                  await evalFireAndForgetSafe(entry.session, buildEffectiveCleanupExpr(orch, spec), 0);
                  resetEntryChannelState(entry, spec, false);
                }
                if (!hostI18nOffNow && entry.isolatedHostI18nPaused && !skippedStale && !entry.session.closed) {
                  await orch.swarmManager.syncIsolatedHostI18n(entry, false);
                }
                continue;
              }

              const isSkipped = Boolean(spec.tracksSkippedNonHost && f.skippedField && entry[f.skippedField]);
              const changed = Boolean(
                enabled && snap && !isSkipped &&
                  (forceFullConvergence || (f.sigField && entry[f.sigField] !== sig) || (f.scriptField && !entry[f.scriptField]) || (f.mountedField && !entry[f.mountedField]))
              );
              if (enabled && snap) {
                if (!skippedStale && !entry.session.closed && !isSkipped && (!refreshedFast || changed)) {
                  if (BINDING_BY_CHANNEL[id]) await ensureChannelBinding(orch, entry, id);
                  const evalRes = await evalChannelExpressionSafe(entry.session, snap, 0);
                  await recordPersistentEvalOutcome(orch, entry, spec, evalRes, { chHash: hash, chSig: sig, scriptId: entry[f.scriptField], stage: 'broadcast' });
                }
              } else if ((hadBefore || (!spec.tracksSkippedNonHost && id !== 'omni' && id !== 'thought' && !orch.isChannelEnabled(spec, currentCfg))) && !skippedStale && !entry.session.closed) {
                if (id === 'wallpaper' || id === 'suggester') await removeChannelBinding(orch, entry, id);
                if (hadBefore) await evalFireAndForgetSafe(entry.session, buildEffectiveCleanupExpr(orch, spec), 0);
                resetEntryChannelState(entry, spec, false);
              }
            }

            if (orch._broadcastPending || orch._configSeq !== snapSeq || entry.session.closed) {
              entry._configConvergenceDirty = true;
              orch._broadcastPending = true;
              return;
            }

            await replaceEntryNewDocScript(entry, 'scriptId', injectSnap);
            for (const cs of channelSnaps) {
              const f = cs.spec.fields;
              if (!f.scriptField) continue;
              if (cs.spec.id === 'sidebar') {
                await replaceEntryNewDocScript(entry, 'sidebarScriptId', cs.enabled && cs.snap ? cs.snap : '');
              } else {
                await syncPersistentNewDocScript(entry, Boolean(cs.enabled && cs.snap), cs.snap, f.scriptField, f.scriptSigField, cs.sig);
              }
            }

            entry.appliedConfigSeq = snapSeq;
            entry._configConvergenceDirty = false;
          })
        )
      );
    }
  } finally {
    orch._broadcastRunning = false;
    const waiters = orch._broadcastWaiters.splice(0);
    for (const resolve of waiters) {
      try { resolve(); } catch {}
    }
  }
}
