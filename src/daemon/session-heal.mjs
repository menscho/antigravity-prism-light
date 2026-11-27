// Obsidian Prism 窗口健康探针调度与显式 FSM 增量自愈（Per-Window AWAITING_DOM 护栏 + 表驱动 Per-Channel 熔断，无原型 Mixin）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import {
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
} from './constants.mjs';
import { normalizeUsageScopeKey } from './telemetry-scope.mjs';
import {
  ENTRY_FSM_STATES,
  ensureEntryFsm,
  transitionEntryState,
  recordEntryCh1Outcome,
  shouldHoldAwaitingDomReinject,
  isChannelInCooldown,
} from './session-fsm.mjs';
import { CHANNEL_STATIC_SPECS } from './channel-coordinator.mjs';
import {
  PAGE_HEALTH_PROBE_EXPRESSION,
  planChannelsForHeal,
  healSecondaryChannels,
} from './session-heal-channels.mjs';

const EARLY_SYNC_EXCLUDED_IDS = new Set(['omni', 'sidebar', 'hostI18n', 'swarmI18n', 'settings']);

function anyChannelNeedsEarlySync(orch, entry, cfg, now, force = false) {
  for (const spec of CHANNEL_STATIC_SPECS) {
    if (EARLY_SYNC_EXCLUDED_IDS.has(spec.id)) continue;
    if (isChannelInCooldown(entry, spec.id, now)) continue;
    const f = spec.fields;
    const exprNow = orch.getChannelExpr(spec.id);
    const available = spec.tracksSkippedNonHost
      ? Boolean(exprNow || orch.hasChannelFile(spec, { bypassCache: force }))
      : orch.isChannelEnabled(spec, cfg) && (spec.id === 'thought' ? true : Boolean(exprNow || orch.hasChannelFile(spec, { bypassCache: force })));
    if (!available) {
      if (entry[f.scriptField] || entry[f.mountedField]) return true;
      continue;
    }
    if (spec.tracksSkippedNonHost && f.skippedField && entry[f.skippedField]) continue;
    if (!entry[f.scriptField] || !entry[f.mountedField]) return true;
    if (spec.id !== 'thought' && !spec.tracksSkippedNonHost && exprNow && f.sigField && f.scriptSigField) {
      const expSig = orch.getChannelCfgSig(spec, cfg, exprNow);
      if (expSig && (entry[f.sigField] !== expSig || entry[f.scriptSigField] !== expSig)) {
        return true;
      }
    }
  }
  return false;
}

export async function verifyAndHealEntryUnlocked(orch, entry, force = false) {
  if (!entry || entry.session.closed) return { alive: false, ready: false, isHostDom: false };
  ensureEntryFsm(entry);
  const now = Date.now();
  if (!force && entry.probeTimeoutBackoffUntil > now) {
    return { alive: true, ready: false, isHostDom: true, timedOut: true, skipped: true };
  }
  const cdp = orch.getCdp();
  const reg = orch.sessionRegistry;
  const cfg = typeof cdp?.readConfig === 'function' ? cdp.readConfig() : null;
  const hasCtxMap = entry.contextFrames instanceof Map;
  const needsBindingHeal = hasCtxMap && (!entry.mainFrameId || !reg.hasMainDefaultContext(entry));
  const holdingDeferred = shouldHoldAwaitingDomReinject(entry);
  const channelsNeedSync = anyChannelNeedsEarlySync(orch, entry, cfg, now, force);
  const hashMatches = !orch.codeHash || entry.lastVerifiedCodeHash === orch.codeHash;

  if (
    !force &&
    !needsBindingHeal &&
    !channelsNeedSync &&
    !entry.verifyDirty &&
    hashMatches &&
    entry.lastVerifyAt > 0 &&
    entry.healthyStreak > 0
  ) {
    const browserLive = Boolean(reg.browserSession && !reg.browserSession.closed);
    const backoffMs = browserLive
      ? Math.min(45000, 3000 * Math.pow(2, Math.min(4, entry.healthyStreak - 1)))
      : Math.min(24000, 6000 * Math.pow(2, Math.min(2, entry.healthyStreak - 1)));
    if (now - entry.lastVerifyAt < backoffMs) {
      return { alive: true, ready: true, isHostDom: true, skipped: true };
    }
  }

  try {
    if (!entry.mainFrameId) await reg.ensureMainFrameId(entry, 3000, 0);
    if (entry.mainFrameId && hasCtxMap && !reg.hasMainDefaultContext(entry)) {
      const lastResyncAt = Number(entry._lastRuntimeResyncAt) || 0;
      if (force || now - lastResyncAt >= 5000) {
        entry._lastRuntimeResyncAt = Date.now();
        await entry.session.send('Runtime.disable', {}, 2000).catch(() => {});
        await entry.session.send('Runtime.enable', {}, 2600).catch(() => {});
        if (entry.sidebarHostVerified === true && entry.sidebarHostContextId == null) {
          entry.sidebarHostContextId = reg.findCurrentMainDefaultContextId(entry);
        }
      }
    }

    const probe = await entry.session.evaluate(PAGE_HEALTH_PROBE_EXPRESSION, false, 2600);
    if (!probe || !probe.ready) return { alive: true, ready: false, isHostDom: true };
    entry.probeTimeoutStreak = 0;
    entry.probeTimeoutBackoffUntil = 0;
    if (probe.href) entry.url = probe.href;
    if (probe.title) entry.title = probe.title;
    if (probe.scopeAttr) {
      const probedScope = normalizeUsageScopeKey(probe.scopeAttr);
      if (probedScope && probedScope !== 'local') entry.detectedScopeKey = probedScope;
    }

    if (holdingDeferred) {
      entry.lastVerifyAt = Date.now();
      entry.verifyDirty = false;
      if (probe.hasPrism && probe.prismAttr === cdp.PLUGIN_VERSION) {
        reg.markSidebarHostVerified(entry, entry.sidebarDocument, true);
        recordEntryCh1Outcome(entry, { status: 'ok' }, entry.sidebarDocument);
      }
      entry.healthyStreak = Math.min(8, Math.max(1, (entry.healthyStreak || 0) + 1));
      return { alive: true, ready: true, isHostDom: Boolean(probe.isHostDom), href: probe.href || '', awaitingDom: true };
    }

    const plan = planChannelsForHeal(orch, entry, cfg, probe, now);
    const omniPlan = plan.items.find((i) => i.spec.id === 'omni');
    const sidebarPlan = plan.items.find((i) => i.spec.id === 'sidebar');
    const omniEnabled = Boolean(omniPlan?.enabled);
    const sidebarEnabled = Boolean(sidebarPlan?.enabled);

    const needsCh1Heal =
      (entry.sidebarHostVerified === false && probe.isHostDom) ||
      !probe.hasPrism ||
      !probe.hasRepoBridge ||
      !probe.hasThoughtBridge ||
      !probe.hasUsageBridge ||
      probe.prismAttr !== cdp.PLUGIN_VERSION ||
      probe.hasLegacyCss ||
      (orch.codeHash && probe.codeHash && probe.codeHash !== orch.codeHash);

    let healed = false;
    let deferredThisPass = false;
    if (needsCh1Heal) {
      transitionEntryState(entry, ENTRY_FSM_STATES.HEALING, 'ch1-heal');
      healed = true;
      if (omniEnabled) await orch.ensureOmniServer().catch(() => null);
      if (sidebarEnabled) await orch.ensureSidebarService().catch(() => null);
      const seenBind = new Set();
      const bindTask = (name) => {
        if (!name || seenBind.has(name)) return null;
        seenBind.add(name);
        return entry.session.send('Runtime.addBinding', { name }, 2600).catch(() => {});
      };
      await Promise.all(
        [
          bindTask(cdp.SETTING_BINDING),
          bindTask(METRICS_BINDING),
          bindTask(REPO_BINDING),
          bindTask(THOUGHT_BINDING),
          bindTask(USAGE_BINDING),
          orch.ensureBinding(entry, 'inlineDiff', 2600, true),
          omniEnabled ? bindTask(OMNI_BINDING) : null,
          sidebarEnabled ? orch.ensureBinding(entry, 'sidebar', 2600, true) : null,
        ].filter(Boolean)
      );
      entry.thoughtBindingAdded = true;
      if (omniEnabled) entry.omniBindingAdded = true;

      const sidebarDocument = entry.sidebarDocument;
      const healRes = await entry.session.evaluate(orch.injectExpr, false, 4500);
      reg.markSidebarHostVerified(entry, sidebarDocument, healRes?.status === 'ok');
      const ch1Outcome = recordEntryCh1Outcome(entry, healRes, sidebarDocument);

      if (healRes && healRes.status === 'skipped-non-host') {
        await orch.teardownAllEntryChannelScripts(entry, entry.session, { markSkippedNonHost: true });
        reg.markTargetIgnored({ id: entry.pageId, webSocketDebuggerUrl: entry.wsUrl }, probe.href || entry.url);
        entry.session.close();
        reg.sessions.delete(entry.wsUrl);
        orch.log(`[↷] Detached & ignored deferred non-host target: ${orch.redact(entry.title)}`);
        return { alive: false, ready: true, isHostDom: false };
      }

      if (ch1Outcome.deferred) {
        deferredThisPass = true;
      } else {
        healed = await healSecondaryChannels(orch, entry, cfg, probe, plan, { afterCh1Heal: true, now });
        orch.log(`[↻] Hot-healed window to Obsidian Prism v${cdp.PLUGIN_VERSION}: ${orch.redact(entry.title)}`);
      }
    } else {
      healed = await healSecondaryChannels(orch, entry, cfg, probe, plan, { afterCh1Heal: false, now });
    }

    entry.lastVerifyAt = Date.now();
    entry.verifyDirty = false;
    entry.lastVerifiedCodeHash = orch.codeHash || '';
    if (deferredThisPass) {
      entry.healthyStreak = Math.min(8, Math.max(1, entry.healthyStreak || 1));
    } else {
      entry.healthyStreak = healed ? 0 : Math.min(8, (entry.healthyStreak || 0) + 1);
      if (!healed && entry.fsmState !== ENTRY_FSM_STATES.AWAITING_DOM) {
        transitionEntryState(entry, ENTRY_FSM_STATES.HEALTHY_BACKOFF, 'verify-healthy');
      }
    }
    return {
      alive: true,
      ready: true,
      isHostDom: Boolean(probe.isHostDom),
      href: probe.href || '',
      ...(deferredThisPass ? { awaitingDom: true } : {}),
    };
  } catch (err) {
    const errMsg = String(err?.message || err || '');
    const isTimeout = /\btimeout\b/i.test(errMsg);
    if (!entry.session.closed && isTimeout) {
      const nextStreak = (Number(entry.probeTimeoutStreak) || 0) + 1;
      entry.probeTimeoutStreak = nextStreak;
      if (nextStreak < 3) {
        const backoffMs = Math.min(30000, 3000 * Math.pow(2, nextStreak - 1));
        entry.probeTimeoutBackoffUntil = Date.now() + backoffMs;
        orch.log(`[!] Health probe timeout (${nextStreak}/3) on ${orch.redact(entry.title)}; backing off ${backoffMs}ms`);
        return { alive: true, ready: false, isHostDom: true, timedOut: true };
      }
    }
    orch.log(
      `[!] Session closed after ${isTimeout ? 'repeated probe timeouts' : 'probe error'}: ${orch.redact(entry.title)}`
    );
    entry.session.close();
    reg.sessions.delete(entry.wsUrl);
    return { alive: false, ready: false, isHostDom: false };
  }
}

export async function verifyAndHealEntry(orch, entry, force = false) {
  if (!entry || entry.session.closed) return { alive: false, ready: false, isHostDom: false };
  return orch.sessionRegistry.runExclusive(entry, () => verifyAndHealEntryUnlocked(orch, entry, force));
}
