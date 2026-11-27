// Obsidian Prism 窗口会话注册表子系统（SessionRegistry：窗口会话 Map、主帧/上下文追踪、Per-Window Entry FSM、事件订阅与目标发现）
import { OMNI_BINDING } from '../../vendor/omni-viewer/omni-server.mjs';
import {
  METRICS_BINDING,
  REPO_BINDING,
  THOUGHT_BINDING,
  USAGE_BINDING,
  INLINE_DIFF_BINDING,
  SIDEBAR_BINDING,
  isEligibleTarget,
} from './constants.mjs';
import {
  HOST_FSM_STATES,
  ENTRY_FSM_STATES,
  ensureEntryFsm,
  transitionEntryState,
  onEntryDomReadySignal,
  resetEntryForNewDocument,
} from './session-fsm.mjs';
import {
  closeBrowserDiscovery,
  computeCoalescedTickDelay,
  scheduleImmediateTick,
  handleBrowserTargetEvent,
  ensureBrowserDiscovery,
} from './browser-discovery.mjs';

function initRegistryChannelEntryFields(entry, registry) {
  if (Array.isArray(registry)) {
    for (const ch of registry) {
      const f = ch?.fields;
      if (!f) continue;
      if (f.scriptField && !(f.scriptField in entry)) entry[f.scriptField] = null;
      if (f.mountedField && !(f.mountedField in entry)) entry[f.mountedField] = false;
      if (f.sigField && !(f.sigField in entry)) entry[f.sigField] = '';
      if (f.scriptSigField && !(f.scriptSigField in entry)) entry[f.scriptSigField] = '';
      if (f.skippedField && !(f.skippedField in entry)) entry[f.skippedField] = false;
      if (f.bindingAddedField && !(f.bindingAddedField in entry)) entry[f.bindingAddedField] = false;
    }
  }
  return entry;
}

export class SessionRegistry {
  constructor(deps = {}) {
    this._deps = deps;
    this.sessions = new Map();
    this.ignoredTargets = new Map();
    this.browserSession = null;
    this.browserPort = null;
    this._browserDiscoverySubscribed = false;
    this._lastListPagesAt = 0;
    this._forceListPagesNextTick = false;
    const fallbackListMs = Number(deps.listPagesFallbackIntervalMs);
    this._listPagesFallbackIntervalMs = Number.isFinite(fallbackListMs) ? Math.max(100, fallbackListMs) : 60000;
    this._discoverTimer = null;
    this._discoverTimerTargetAt = 0;
    this._managedTimers = new Set();
    this.hostFsmState = HOST_FSM_STATES.IDLE;
    this._reentrantTickStreak = 0;
    this._lastTickFinishedAt = 0;
    this._prevAttachedCount = 0;
    this._disconnectedAllSessions = false;
  }

  runExclusive(entry, fn) {
    if (!entry) return Promise.resolve();
    const prev = entry._opChain || Promise.resolve();
    const next = prev.then(() => fn(), () => fn());
    entry._opChain = next.catch(() => {});
    return next;
  }

  hasMainDefaultContext(entry) {
    if (!entry?.mainFrameId || !(entry.contextFrames instanceof Map)) return false;
    for (const meta of entry.contextFrames.values()) {
      if (meta && meta.isDefault === true && (!meta.type || meta.type === 'default') && meta.frameId === entry.mainFrameId) {
        return true;
      }
    }
    return false;
  }

  findCurrentMainDefaultContextId(entry) {
    if (!entry?.contextFrames || !entry.mainFrameId) return null;
    let found = null;
    for (const [id, meta] of entry.contextFrames.entries()) {
      if (
        meta &&
        meta.isDefault === true &&
        meta.type === 'default' &&
        meta.frameId === entry.mainFrameId &&
        (typeof meta.docGen !== 'number' || meta.docGen === entry.sidebarDocument)
      ) {
        found = id;
      }
    }
    return found;
  }

  markSidebarHostVerified(entry, expectedDoc, ok) {
    if (!entry || expectedDoc !== entry.sidebarDocument) return;
    if (ok) {
      entry.sidebarHostVerified = true;
      entry.sidebarVerifiedDocument = expectedDoc;
      entry.sidebarHostContextId = this.findCurrentMainDefaultContextId(entry);
    } else {
      entry.sidebarHostVerified = false;
      entry.sidebarVerifiedDocument = -1;
      entry.sidebarHostContextId = null;
    }
  }

  async ensureMainFrameId(entry, timeoutMs = 4000, retries = 0) {
    if (!entry || entry.session?.closed) return null;
    if (typeof entry.mainFrameId === 'string' && entry.mainFrameId) return entry.mainFrameId;
    if (entry._mainFrameInFlight) return entry._mainFrameInFlight;
    const maxAttempts = Math.max(1, (Number(retries) | 0) + 1);
    const task = (async () => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (entry.session?.closed) return null;
        if (typeof entry.mainFrameId === 'string' && entry.mainFrameId) return entry.mainFrameId;
        const ft = await entry.session.send('Page.getFrameTree', {}, timeoutMs).catch(() => null);
        const topFrameId = ft?.frameTree?.frame?.id;
        if (typeof topFrameId === 'string' && topFrameId) {
          entry.mainFrameId = topFrameId;
          entry.hasFrameTree = true;
          if (entry.sidebarHostVerified === true && entry.sidebarHostContextId == null) {
            entry.sidebarHostContextId = this.findCurrentMainDefaultContextId(entry);
          }
          return topFrameId;
        }
      }
      return typeof entry.mainFrameId === 'string' && entry.mainFrameId ? entry.mainFrameId : null;
    })();
    entry._mainFrameInFlight = task;
    try {
      return await task;
    } finally {
      if (entry._mainFrameInFlight === task) entry._mainFrameInFlight = null;
    }
  }

  targetKey(target) {
    if (!target || typeof target !== 'object') return '';
    return String(target.id || target.targetId || target.webSocketDebuggerUrl || '').trim();
  }

  normalizeIgnoreUrl(rawUrl) {
    const s = String(rawUrl || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}`;
    } catch {
      return s.split(/[?#]/)[0].toLowerCase();
    }
  }

  markTargetIgnored(target, urlOverride = '') {
    const key = this.targetKey(target);
    if (!key) return;
    const normUrl = this.normalizeIgnoreUrl(urlOverride || target?.url || '');
    if (this.ignoredTargets.has(key)) {
      this.ignoredTargets.delete(key);
    } else if (this.ignoredTargets.size >= 256) {
      const oldest = this.ignoredTargets.keys().next().value;
      if (oldest !== undefined) this.ignoredTargets.delete(oldest);
    }
    this.ignoredTargets.set(key, normUrl);
  }

  isTargetIgnored(target) {
    const key = this.targetKey(target);
    if (!key || !this.ignoredTargets.has(key)) return false;
    const prevNorm = this.ignoredTargets.get(key);
    const curNorm = this.normalizeIgnoreUrl(target?.url || '');
    if (curNorm && prevNorm && curNorm !== prevNorm) {
      this.ignoredTargets.delete(key);
      return false;
    }
    return true;
  }

  isEligibleDaemonTarget(target) {
    const cdp = this._deps.getCdp();
    const checkFn = typeof cdp?.isEligibleTarget === 'function' ? cdp.isEligibleTarget : isEligibleTarget;
    if (!checkFn(target)) return false;
    return !this.isTargetIgnored(target);
  }

  pickActiveSidebarHostEntry() {
    for (const entry of this.sessions.values()) {
      if (entry && !entry.session?.closed && entry.sidebarHostVerified === true) return entry;
    }
    return null;
  }

  closeBrowserDiscovery() {
    closeBrowserDiscovery(this);
  }

  computeCoalescedTickDelay(baseDelayMs = 45) {
    return computeCoalescedTickDelay(this, baseDelayMs);
  }

  scheduleImmediateTick(delayMs = 45) {
    scheduleImmediateTick(this, delayMs);
  }

  handleBrowserTargetEvent(params) {
    return handleBrowserTargetEvent(this, params);
  }

  ensureBrowserDiscovery(port) {
    return ensureBrowserDiscovery(this, port);
  }

  clearAllTimers() {
    if (this._discoverTimer) {
      clearTimeout(this._discoverTimer);
      this._discoverTimer = null;
    }
    this._discoverTimerTargetAt = 0;
    for (const t of this._managedTimers) {
      clearTimeout(t);
    }
    this._managedTimers.clear();
    for (const entry of this.sessions.values()) {
      if (entry && entry._healTimer) {
        clearTimeout(entry._healTimer);
        entry._healTimer = null;
      }
    }
  }

  async attachTarget(target) {
    const wsUrl = target.webSocketDebuggerUrl;
    if (this.isTargetIgnored(target)) return null;
    if (this.sessions.has(wsUrl)) return this.sessions.get(wsUrl);

    const cdp = this._deps.getCdp();
    const session = await cdp.CdpSession.connect(wsUrl, 3500);
    const entry = ensureEntryFsm(
      initRegistryChannelEntryFields(
        {
          wsUrl,
          pageId: target.id,
          url: String(target.url || ''),
          title: target.title || target.url || 'Antigravity',
          targetType: target.type || 'page',
          targetAttached: typeof target.attached === 'boolean' ? target.attached : true,
          detectedScopeKey: '',
          _usageScopeVerified: false,
          session,
          scriptId: null,
          hostI18nSkippedByLiveCfg: false,
          isolatedHostI18nPaused: false,
          isolatedHostI18nNoExtCtxs: new Set(),
          _isoPauseTimers: new Set(),
          sidebarHostVerified: false,
          sidebarVerifiedDocument: -1,
          sidebarHostContextId: null,
          sidebarDocument: 0,
          _rendererRpcInstalledDocGen: -1,
          lastOmniExpr: '',
          lastVerifyAt: 0,
          healthyStreak: 0,
          verifyDirty: true,
          lastVerifiedCodeHash: '',
          mainFrameId: null,
          hasFrameTree: false,
          contextFrames: new Map(),
          swarmSubFrames: new Map(),
          pendingAckEpoch: 0,
          _healTimer: null,
          _opChain: Promise.resolve(),
        },
        cdp?.CHANNEL_REGISTRY
      )
    );
    this.sessions.set(wsUrl, entry);

    session.onClose = () => {
      if (entry._healTimer) {
        clearTimeout(entry._healTimer);
        this._managedTimers.delete(entry._healTimer);
        entry._healTimer = null;
      }
      transitionEntryState(entry, ENTRY_FSM_STATES.DETACHED, 'session-closed');
      if (this.sessions.get(wsUrl) === entry) {
        this.sessions.delete(wsUrl);
        if (this.sessions.size === 0 && this._prevAttachedCount > 0) {
          this._disconnectedAllSessions = true;
        }
      }
    };

    try {
      const revokeSidebarHost = () => {
        entry.sidebarHostVerified = false;
        entry.sidebarVerifiedDocument = -1;
        entry.sidebarHostContextId = null;
        entry.sidebarDocument += 1;
        entry._rendererRpcInstalledDocGen = -1;
        entry.inlineDiffSkipped = false;
        entry.wallpaperSkipped = false;
        resetEntryForNewDocument(entry);
      };

      session.on('Runtime.executionContextCreated', (params) => {
        const ctx = params?.context;
        if (!ctx || typeof ctx.id !== 'number') return;
        const aux = ctx.auxData && typeof ctx.auxData === 'object' ? ctx.auxData : {};
        const frameId = typeof aux.frameId === 'string' ? aux.frameId : '';
        const isDefault = aux.isDefault === true;
        const type = typeof aux.type === 'string' && aux.type ? aux.type : isDefault ? 'default' : '';
        const isMainDefault = Boolean(entry.mainFrameId && frameId === entry.mainFrameId && isDefault && type === 'default');
        if (isMainDefault) {
          if (entry.sidebarHostVerified || (typeof entry.sidebarHostContextId === 'number' && entry.sidebarHostContextId !== ctx.id)) {
            revokeSidebarHost();
            entry.verifyDirty = true;
            entry.healthyStreak = 0;
          }
        }
        entry.contextFrames.set(ctx.id, { frameId, isDefault, type, docGen: entry.sidebarDocument });
        const isMainIsolated = Boolean(entry.mainFrameId && frameId === entry.mainFrameId && !isDefault && type === 'isolated');
        if (isMainIsolated) {
          const liveCdp = this._deps.getCdp();
          const cfgOnCtx = typeof liveCdp?.readConfig === 'function' ? liveCdp.readConfig() : null;
          if (cfgOnCtx?.hostLocalization === 'off' && this._deps.isRunning() && !entry.session.closed) {
            const targetCtxId = ctx.id;
            const pauseIsoCtx = () => {
              if (!this._deps.isRunning() || entry.session.closed || !entry.contextFrames.has(targetCtxId)) return;
              const liveCfgNow = typeof this._deps.getCdp()?.readConfig === 'function' ? this._deps.getCdp().readConfig() : null;
              if (liveCfgNow?.hostLocalization !== 'off') return;
              void this._deps
                .onSyncIsolatedHostI18n(entry, true, { contextIds: [targetCtxId] })
                .then((r) => {
                  if (r && r.newlyPaused && !entry.session.closed) return this._deps.onForceMainWorldHostI18nOffRescan(entry);
                })
                .catch(() => {});
            };
            pauseIsoCtx();
            const retryTid = setTimeout(() => {
              entry._isoPauseTimers?.delete(retryTid);
              pauseIsoCtx();
            }, 350);
            if (typeof retryTid.unref === 'function') retryTid.unref();
            entry._isoPauseTimers?.add(retryTid);
          }
        }
        if (!isMainDefault && isDefault && type === 'default' && frameId && frameId !== entry.mainFrameId) {
          const ctxOriginOrUrl = String(ctx.origin || aux.url || '').trim();
          const existingSub = entry.swarmSubFrames?.get(frameId);
          const liveCdp = this._deps.getCdp();
          const isSwarmSub =
            Boolean(existingSub) ||
            (ctxOriginOrUrl && typeof liveCdp?.isSwarmSidecarUrl === 'function' && liveCdp.isSwarmSidecarUrl(ctxOriginOrUrl));
          if (isSwarmSub && !this._deps.hasSwarmSession?.(frameId)) {
            if (!existingSub) {
              entry.swarmSubFrames.set(frameId, { url: this._deps.redact(ctxOriginOrUrl), contextId: ctx.id, mounted: false, codeHash: '' });
            } else {
              existingSub.contextId = ctx.id;
            }
            if (this._deps.isRunning() && !entry.session.closed) {
              void this._deps.onInjectSwarmIntoSubFrame(entry, frameId, ctx.id).catch(() => {});
            }
          }
        }
      });

      session.on('Runtime.executionContextDestroyed', (params) => {
        if (typeof params?.executionContextId === 'number') {
          const destroyedId = params.executionContextId;
          const destroyedMeta = entry.contextFrames.get(destroyedId);
          entry.contextFrames.delete(destroyedId);
          entry.isolatedHostI18nNoExtCtxs?.delete(destroyedId);
          if (entry.swarmSubFrames instanceof Map) {
            for (const sub of entry.swarmSubFrames.values()) {
              if (sub && sub.contextId === destroyedId) {
                sub.contextId = null;
                sub.mounted = false;
              }
            }
          }
          const wasMainDefault = Boolean(
            destroyedMeta &&
              destroyedMeta.isDefault === true &&
              destroyedMeta.type === 'default' &&
              entry.mainFrameId &&
              destroyedMeta.frameId === entry.mainFrameId
          );
          if (destroyedId === entry.sidebarHostContextId || wasMainDefault) {
            revokeSidebarHost();
            entry.verifyDirty = true;
            entry.healthyStreak = 0;
          }
        }
      });

      session.on('Runtime.executionContextsCleared', () => {
        entry.contextFrames.clear();
        entry.swarmSubFrames?.clear();
        entry.isolatedHostI18nNoExtCtxs?.clear();
        entry.isolatedHostI18nPaused = false;
        revokeSidebarHost();
        entry.pendingAckEpoch = 0;
      });

      session.on('Page.frameNavigated', (params) => {
        const frame = params?.frame;
        if (frame && !frame.parentId && typeof frame.id === 'string' && frame.id) {
          entry.mainFrameId = frame.id;
          entry.hasFrameTree = true;
          revokeSidebarHost();
          entry.pendingAckEpoch = 0;
          entry.verifyDirty = true;
          entry.healthyStreak = 0;
          if (typeof frame.url === 'string' && frame.url) entry.url = frame.url;
        } else if (frame && frame.parentId && typeof frame.id === 'string' && frame.id) {
          const fid = frame.id;
          if (this._deps.isSwarmTargetInfo?.({ type: 'iframe', url: frame.url }) && !this._deps.hasSwarmSession?.(fid)) {
            let subCtxId = null;
            for (const [cid, meta] of entry.contextFrames.entries()) {
              if (meta && meta.frameId === fid && meta.isDefault === true && meta.type === 'default') {
                subCtxId = cid;
                break;
              }
            }
            entry.swarmSubFrames.set(fid, { url: this._deps.redact(frame.url || ''), contextId: subCtxId, mounted: false, codeHash: '' });
            if (typeof subCtxId === 'number' && this._deps.isRunning() && !entry.session.closed) {
              void this._deps.onInjectSwarmIntoSubFrame(entry, fid, subCtxId).catch(() => {});
            }
          } else if (entry.swarmSubFrames.has(fid)) {
            entry.swarmSubFrames.delete(fid);
          }
        }
      });

      session.on('Runtime.bindingCalled', (params) => {
        void this._deps.onBindingCall(entry, params || {});
      });

      const liveCdp = this._deps.getCdp();
      const omniEnabled = Boolean(this._deps.isOmniEnabled?.());
      const sidebarEnabled = Boolean(this._deps.isSidebarStudioEnabled?.());
      const seenBindings = new Set();
      const addUniqueBinding = (bindingName, swallowErr = false) => {
        if (!bindingName || seenBindings.has(bindingName)) return null;
        seenBindings.add(bindingName);
        const p = session.send('Runtime.addBinding', { name: bindingName });
        return swallowErr ? p.catch(() => {}) : p;
      };

      // 并发打包 CDP 域握手与去重后的 Runtime.addBinding（11 RTT -> 1 并发批次）
      const handshakeTasks = [
        session.send('Page.enable'),
        this.ensureMainFrameId(entry, 4500, 1),
        session.send('Runtime.enable'),
        addUniqueBinding(liveCdp.SETTING_BINDING),
        addUniqueBinding(liveCdp.LEGACY_SETTING_BINDING, true),
        addUniqueBinding(METRICS_BINDING),
        addUniqueBinding(REPO_BINDING),
        addUniqueBinding(THOUGHT_BINDING),
        addUniqueBinding(USAGE_BINDING),
        addUniqueBinding(INLINE_DIFF_BINDING),
        omniEnabled ? addUniqueBinding(OMNI_BINDING) : null,
        sidebarEnabled ? addUniqueBinding(SIDEBAR_BINDING) : null,
      ].filter(Boolean);
      await Promise.all(handshakeTasks);
      entry.thoughtBindingAdded = true;
      entry.inlineDiffBindingAdded = true;
      if (omniEnabled) entry.omniBindingAdded = true;
      if (sidebarEnabled) entry.sidebarBindingAdded = true;

      const healOnNav = () => {
        if (!this._deps.isRunning() || entry.session.closed) return;
        const allowWake = onEntryDomReadySignal(entry);
        if (!allowWake) return;
        entry.verifyDirty = true;
        if (entry.fsmState !== ENTRY_FSM_STATES.AWAITING_DOM) {
          entry.healthyStreak = 0;
        }
        if (entry._healTimer) {
          clearTimeout(entry._healTimer);
          this._managedTimers.delete(entry._healTimer);
          entry._healTimer = null;
        }
        const t = setTimeout(() => {
          entry._healTimer = null;
          this._managedTimers.delete(t);
          if (!this._deps.isRunning() || entry.session.closed) return;
          void this._deps.onVerifyAndHealEntry(entry, true);
        }, 50);
        if (typeof t.unref === 'function') t.unref();
        entry._healTimer = t;
        this._managedTimers.add(t);
      };
      session.on('Page.domContentLoadedEventFired', healOnNav);
      session.on('Page.loadEventFired', healOnNav);

      const res = await this._deps.onApplyEntry(entry);
      if (res && res.status === 'skipped-non-host') {
        this.markTargetIgnored(target, entry.url || target.url);
        session.close();
        this.sessions.delete(wsUrl);
        this._deps.log(`[↷] Ignored non-host target: ${this._deps.redact(entry.title)}`);
        return null;
      }
      this._deps.log(
        `[✓] Attached & injected Obsidian Prism v${this._deps.getCdp().PLUGIN_VERSION}: ${this._deps.redact(entry.title)} (${res?.status || 'ok'})`
      );
      return entry;
    } catch (err) {
      try {
        await this._deps.onTeardownEntry(entry, session, { removeBindings: false, resetHomeStudio: false });
      } catch {}
      session.close();
      this.sessions.delete(wsUrl);
      throw err;
    }
  }

  async detachAll(cleanPageDom = false) {
    await this._deps.onDetachAllSwarmSessions?.(cleanPageDom)?.catch?.(() => {});
    this.closeBrowserDiscovery();
    const entries = [...this.sessions.values()];
    const removeExpr = this._deps.getCdp()?.REMOVE_EXPRESSION;
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          await this._deps.onTeardownEntry(entry, entry.session, { removeBindings: true });
          await this._deps.onCleanupSwarmSubFrames?.(entry, cleanPageDom)?.catch?.(() => {});
          entry.swarmSubFrames?.clear?.();
          if (cleanPageDom && !entry.session.closed && removeExpr) {
            await entry.session.evaluate(removeExpr).catch(() => {});
          }
          if (entry._isoPauseTimers) {
            for (const tid of entry._isoPauseTimers) clearTimeout(tid);
            entry._isoPauseTimers.clear();
          }
          if (entry.isolatedHostI18nPaused && !entry.session.closed) {
            await this._deps.onSyncIsolatedHostI18n(entry, false).catch(() => {});
          }
        } catch {}
        transitionEntryState(entry, ENTRY_FSM_STATES.DETACHED, 'detachAll');
        entry.session.close();
      })
    );
    this.sessions.clear();
  }
}
