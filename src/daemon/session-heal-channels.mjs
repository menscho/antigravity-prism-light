// Obsidian Prism 窗口健康探针（由 CHANNEL_REGISTRY 自动派生）与全表驱动次级通道自愈引擎（无原型 Mixin）
import { createRequire } from 'node:module';
import {
  isChannelInCooldown,
  recordChannelSuccess,
  recordChannelSkipped,
  recordChannelOff,
} from './session-fsm.mjs';
import { evalChannelExpressionSafe, recordChannelEvalFailure } from './channel-sync-engine.mjs';
import { CHANNEL_STATIC_SPECS, extractTargetCodeHash } from './channel-coordinator.mjs';

const require = createRequire(import.meta.url);
const { buildPageHealthProbeExpression } = require('../channels/registry.cjs');

// 整页健康探针完全从唯一真相源 CHANNEL_REGISTRY 自动拼装生成（零手工平行字段）
export const PAGE_HEALTH_PROBE_EXPRESSION = buildPageHealthProbeExpression();

function isProbeChannelHealthy(spec, probe) {
  if (!probe || !spec?.probeKey) return true;
  if (spec.id === 'suggester') {
    return probe.hasSuggester !== false && probe.hasSuggesterUi !== false;
  }
  if (!probe[spec.probeKey]) return false;
  for (const extraKey of spec.probeExtraKeys || []) {
    if (extraKey === 'needsSettingsChannel' || extraKey === 'needsHomeStudioChannel') continue;
    if (!probe[extraKey]) return false;
  }
  return true;
}

function hasProbeChannelResidue(spec, probe) {
  if (!probe || !spec?.probeKey) return false;
  if (probe[spec.probeKey]) return true;
  for (const extraKey of spec.probeExtraKeys || []) {
    if (extraKey === 'hasOmniBridge' || extraKey === 'hasOmniServerMeta' || extraKey === 'hasSidebarBridge') continue;
    if (extraKey === 'needsSettingsChannel' || extraKey === 'needsHomeStudioChannel') continue;
    if (probe[extraKey]) return true;
  }
  return false;
}

export function planChannelsForHeal(orch, entry, cfg, probe, now) {
  const items = [];
  let hostI18nMeta = null;

  for (const spec of CHANNEL_STATIC_SPECS) {
    if (spec.injectMode === 'oopif-swarm') continue;
    const f = spec.fields;
    const id = spec.id;

    // On-demand RPC 通道（Ch9 settings）
    if (spec.injectMode === 'on-demand-rpc') {
      const shouldCheck = Boolean(probe.needsSettingsChannel || probe.hasSettingsPanel || probe.settingsCodeHash);
      const expectedHash = shouldCheck ? orch.getChannelExprHash(spec, orch.ensureSettingsExpr()) : '';
      const hashMismatch = Boolean(expectedHash && (probe.hasSettingsPanel || probe.settingsCodeHash) && probe.settingsCodeHash !== expectedHash);
      items.push({
        spec,
        enabled: true,
        hasOnDisk: true,
        needsHeal: Boolean(probe.needsSettingsChannel || hashMismatch),
        needsCleanup: false,
        hashMismatch,
      });
      continue;
    }

    // Ch2 Omni（结合实时页面 omniMode）
    if (id === 'omni') {
      const enabled = orch.isChannelEnabled(spec, cfg) && probe.omniMode !== 'off';
      const hasClientOnDisk = enabled && orch.hasChannelFile(spec);
      const needsHeal =
        enabled &&
        !isChannelInCooldown(entry, 'omni', now) &&
        (!probe.hasOmniBridge || !probe.hasOmniServerMeta || (hasClientOnDisk && !probe.hasOmni));
      const needsCleanup = !enabled && Boolean(probe.hasOmni || entry.omniScriptId || entry.lastOmniExpr);
      items.push({ spec, enabled, hasOnDisk: hasClientOnDisk, needsHeal, needsCleanup, hashMismatch: false });
      continue;
    }

    // Ch3 Sidebar Studio（结合 v2 安全校验）
    if (id === 'sidebar') {
      const enabled = orch.isChannelEnabled(spec, cfg);
      const hasSafeOnDisk = enabled && orch.hasChannelFile(spec);
      const needsHeal =
        enabled &&
        !isChannelInCooldown(entry, 'sidebar', now) &&
        (!probe.hasSidebarBridge || (hasSafeOnDisk && !probe.hasSidebar));
      const needsCleanup =
        !enabled && Boolean(probe.hasSidebar || entry.sidebarScriptId || entry.sidebarMounted || entry.sidebarBindingAdded);
      items.push({ spec, enabled, hasOnDisk: hasSafeOnDisk, needsHeal, needsCleanup, hashMismatch: false });
      continue;
    }

    // Ch4 Host I18n（含隔离世界扩展静音协同）
    if (id === 'hostI18n') {
      const enabled = orch.isChannelEnabled(spec, cfg);
      const expectedMode = cfg?.hostLocalization === 'on' ? 'on' : cfg?.hostLocalization === 'off' ? 'off' : 'auto';
      const sig = enabled ? orch.getChannelCfgSig(spec, cfg) : '';
      const skippedSameSig = Boolean(entry.hostI18nSkippedByLiveCfg && entry.lastHostI18nSig === sig);
      const uncheckedIsoCtxs =
        expectedMode === 'off' && !entry.isolatedHostI18nPaused
          ? orch.swarmManager.getMainFrameIsolatedContextIds(entry).filter((cid) => !entry.isolatedHostI18nNoExtCtxs?.has(cid))
          : [];
      const needsIsoSync = uncheckedIsoCtxs.length > 0 || (expectedMode !== 'off' && Boolean(entry.isolatedHostI18nPaused));
      const curExpr = orch.getChannelExpr('hostI18n');
      const expectedHash = enabled && curExpr ? extractTargetCodeHash(curExpr) : '';
      const hashMismatch = Boolean(expectedHash && probe.hostI18nCodeHash && probe.hostI18nCodeHash !== expectedHash);
      const needsHeal =
        !isChannelInCooldown(entry, 'hostI18n', now) &&
        ((enabled &&
          !skippedSameSig &&
          (!probe.hasHostI18n || !entry.hostI18nScriptId || hashMismatch || (probe.hostI18nMode && probe.hostI18nMode !== expectedMode))) ||
          (expectedMode === 'off' && uncheckedIsoCtxs.length > 0));
      const needsCleanup =
        (!enabled && Boolean(probe.hasHostI18n || entry.hostI18nScriptId || entry.hostI18nMounted)) ||
        (expectedMode !== 'off' && Boolean(entry.isolatedHostI18nPaused) && !enabled);
      hostI18nMeta = { expectedMode, skippedSameSig, hashMismatch, needsIsoSync };
      items.push({ spec, enabled, hasOnDisk: enabled, needsHeal, needsCleanup, hashMismatch, hostI18nMeta });
      continue;
    }

    // 通用表驱动通道：Ch5 thought / Ch6 inlineDiff / Ch7 wallpaper / Ch8 periodicPicker /
    // Ch10 mascot / Ch11 suggester / Ch12 homeStudio / Ch13~Ch16 runtime
    const cfgEnabled = orch.isChannelEnabled(spec, cfg);
    const hasFile = orch.hasChannelFile(spec);
    const exprNow = orch.getChannelExpr(id);
    const available = spec.tracksSkippedNonHost
      ? Boolean(exprNow || hasFile)
      : cfgEnabled && (id === 'thought' ? true : hasFile);
    const skipped = Boolean(spec.tracksSkippedNonHost && f.skippedField && entry[f.skippedField]);

    if (available && !skipped && !exprNow && spec.probeHashKey) {
      orch.buildChannelExpr(spec, cfg);
    }
    const latestExpr = orch.getChannelExpr(id);
    const expectedHash = available && latestExpr ? orch.getChannelExprHash(spec, latestExpr) : '';
    const expectedSig = available && latestExpr ? orch.getChannelCfgSig(spec, cfg, latestExpr) : '';

    let hashMismatch = false;
    if (spec.probeHashKey && expectedHash) {
      hashMismatch =
        id === 'wallpaper'
          ? Boolean(probe[spec.probeHashKey] && probe[spec.probeHashKey] !== expectedHash)
          : probe[spec.probeHashKey] !== expectedHash;
    }

    const scriptStale = Boolean(
      !entry[f.scriptField] ||
        (expectedSig && !spec.tracksSkippedNonHost && id !== 'thought' && f.scriptSigField && entry[f.scriptSigField] !== expectedSig)
    );
    const missingMount = !isProbeChannelHealthy(spec, probe) || (spec.tracksSkippedNonHost || id === 'thought' ? !entry[f.mountedField] : false);
    const extraNeed = id === 'homeStudio' && Boolean(probe.needsHomeStudioChannel);
    const needsHeal =
      available &&
      !skipped &&
      !isChannelInCooldown(entry, id, now) &&
      (missingMount || hashMismatch || scriptStale || extraNeed);
    const needsCleanup =
      !available &&
      Boolean(hasProbeChannelResidue(spec, probe) || entry[f.scriptField] || entry[f.mountedField]);

    items.push({
      spec,
      enabled: available,
      hasOnDisk: available,
      needsHeal,
      needsCleanup,
      hashMismatch,
      forceEval: extraNeed,
    });
  }

  return { items, hostI18nMeta };
}

export async function healSecondaryChannels(orch, entry, cfg, probe, plan, { afterCh1Heal, now }) {
  let healed = afterCh1Heal;

  for (const item of plan.items || []) {
    const { spec } = item;
    const id = spec.id;
    const f = spec.fields;

    // 1) On-demand RPC 通道（Ch9 settings）
    if (spec.injectMode === 'on-demand-rpc') {
      if (item.needsHeal && !isChannelInCooldown(entry, id, now)) {
        if (!afterCh1Heal) healed = true;
        await orch.deliverSettingsChannelToEntry(entry);
      }
      continue;
    }

    // 2) Ch4 Host I18n（含隔离世界扩展协同钩子）
    if (id === 'hostI18n') {
      const hm = item.hostI18nMeta || {};
      const runHeal = afterCh1Heal ? item.enabled && !hm.skippedSameSig : item.needsHeal || hm.needsIsoSync;
      if (runHeal) {
        if (!isChannelInCooldown(entry, 'hostI18n', now)) {
          healed = true;
          let isoHealRes = null;
          if (hm.expectedMode === 'off') {
            isoHealRes = await orch.swarmManager.syncIsolatedHostI18n(entry, true, { skipNoExt: true });
          }
          let evaluatedFresh = false;
          if (
            item.enabled &&
            !hm.skippedSameSig &&
            (!probe.hasHostI18n || !entry.hostI18nScriptId || hm.hashMismatch || (probe.hostI18nMode && probe.hostI18nMode !== hm.expectedMode))
          ) {
            const activeExpr = orch.ensureChannelExpr(spec, cfg);
            if (activeExpr) {
              const hiSig = orch.getChannelCfgSig(spec, cfg, activeExpr);
              if (!entry.hostI18nScriptId || hm.hashMismatch) {
                const hiId = await orch.replaceEntryNewDocScript(entry, 'hostI18nScriptId', activeExpr);
                if (hiId) entry.lastHostI18nScriptSig = hiSig;
              }
              if (!probe.hasHostI18n || hm.hashMismatch || (probe.hostI18nMode && probe.hostI18nMode !== hm.expectedMode)) {
                const evalRes = await evalChannelExpressionSafe(entry.session, activeExpr, 4500);
                if (evalRes?.skippedByLiveCfg) {
                  entry.hostI18nMounted = false;
                  entry.hostI18nSkippedByLiveCfg = true;
                  entry.lastHostI18nSig = hiSig;
                  recordChannelSkipped(entry, 'hostI18n', { codeHash: hiSig });
                } else if (evalRes && evalRes.ok) {
                  entry.hostI18nMounted = true;
                  entry.hostI18nSkippedByLiveCfg = false;
                  entry.lastHostI18nSig = hiSig;
                  evaluatedFresh = !evalRes.reused;
                  recordChannelSuccess(entry, 'hostI18n', { codeHash: hiSig, scriptId: entry.hostI18nScriptId });
                } else {
                  recordChannelEvalFailure(orch, entry, 'hostI18n', evalRes, { now, stage: 'heal' });
                }
              }
            }
          }
          if (hm.expectedMode === 'off' && isoHealRes && isoHealRes.newlyPaused && !evaluatedFresh) {
            await orch.swarmManager.forceMainWorldHostI18nOffRescan(entry);
          } else if (hm.expectedMode !== 'off' && entry.isolatedHostI18nPaused) {
            await orch.swarmManager.syncIsolatedHostI18n(entry, false);
          }
        }
      } else if (item.needsCleanup) {
        healed = true;
        await orch.cleanupChannelOnEntry(entry, spec, { timeoutMs: 3500 });
        if (entry.isolatedHostI18nPaused) await orch.swarmManager.syncIsolatedHostI18n(entry, false);
      } else if (afterCh1Heal && hm.expectedMode !== 'off' && entry.isolatedHostI18nPaused) {
        await orch.swarmManager.syncIsolatedHostI18n(entry, false);
      }
      continue;
    }

    // 3) 全部其余 13 条标准持久通道（Ch2/3/5/6/7/8/10/11/12/13/14/15/16）统一表驱动自愈与卸载！
    const shouldMount = afterCh1Heal
      ? item.enabled && item.hasOnDisk && (spec.tier === 'runtime' || id === 'omni' || id === 'sidebar' || id === 'thought' || spec.tracksSkippedNonHost || item.needsHeal)
      : item.enabled && item.needsHeal;

    if (shouldMount) {
      if (isChannelInCooldown(entry, id, now)) continue;
      if (!afterCh1Heal) healed = true;
      await orch.healSingleChannelOnEntry(entry, spec, cfg, probe, {
        afterCh1Heal,
        hashMismatch: item.hashMismatch,
        forceEval: Boolean(item.forceEval || (afterCh1Heal && spec.tier === 'runtime')),
        now,
      });
    } else if (!item.enabled && item.needsCleanup) {
      healed = true;
      await orch.cleanupChannelOnEntry(entry, spec, { forceSidebarCleanup: id === 'sidebar', timeoutMs: 3500 });
    }
  }

  if (!afterCh1Heal && probe.needsDashboardSync) {
    healed = true;
    await entry.session
      .evaluate(
        '(() => { const cfg = window.__agPrism?.getState?.()?.cfg || {}; window.__agPrismTelemetry?.sync?.(cfg); window.__agPrism?.sync?.(); return true; })()',
        false,
        2200
      )
      .catch(() => {});
  }

  return healed;
}
