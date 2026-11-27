// Obsidian Prism 显式分层有限状态机（Host FSM + Per-Window Entry FSM + Per-Channel 熔断器 + 配置 SHA-256 指纹 + 目标事件过滤）
import crypto from 'node:crypto';
import { sanitizeLogLine } from '../../sidecars/daemon/redact.mjs';
import { extractScopeKeyFromUri } from './telemetry-scope.mjs';

export const HOST_FSM_STATES = Object.freeze({
  IDLE: 'IDLE',
  DISCOVERING: 'DISCOVERING',
  ATTACHED: 'ATTACHED',
  MISSING_CDP: 'MISSING_CDP',
  STOPPING: 'STOPPING',
});

export const ENTRY_FSM_STATES = Object.freeze({
  DETACHED: 'DETACHED',
  PROBING_HOST: 'PROBING_HOST',
  IGNORED: 'IGNORED',
  AWAITING_DOM: 'AWAITING_DOM',
  INJECTING_CH1: 'INJECTING_CH1',
  HEALTHY_BACKOFF: 'HEALTHY_BACKOFF',
  HEALING: 'HEALING',
});

export const CHANNEL_FSM_STATES = Object.freeze({
  OFF: 'off',
  MOUNTED: 'mounted',
  SKIPPED: 'skipped',
  COOLDOWN: 'cooldown',
});

export const AWAITING_DOM_MAX_ATTEMPTS = 3;
export const CHANNEL_CIRCUIT_FAIL_THRESHOLD = 3;
export const CHANNEL_CIRCUIT_BASE_COOLDOWN_MS = 30_000;
export const CHANNEL_CIRCUIT_MAX_COOLDOWN_MS = 300_000;
export const CHANNEL_ERROR_MAX_CHARS = 240;

function formatSanitizedChannelError(rawError) {
  if (rawError === null || rawError === undefined) return '';
  const text = typeof rawError === 'object' && typeof rawError.message === 'string'
    ? rawError.message
    : String(rawError);
  const singleLine = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!singleLine) return '';
  return sanitizeLogLine(singleLine).slice(0, CHANNEL_ERROR_MAX_CHARS);
}

function normalizeChannelStage(stage) {
  const s = String(stage || '').trim();
  return s ? s.slice(0, 32) : '';
}

export function ensureEntryFsm(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.fsmState !== 'string' || !ENTRY_FSM_STATES[entry.fsmState]) {
    entry.fsmState = entry.sidebarHostVerified === true ? ENTRY_FSM_STATES.HEALTHY_BACKOFF : ENTRY_FSM_STATES.DETACHED;
  }
  if (!Number.isInteger(entry.awaitingDomAttempts) || entry.awaitingDomAttempts < 0) {
    entry.awaitingDomAttempts = 0;
  }
  if (typeof entry.awaitingDomDocGen !== 'number') {
    entry.awaitingDomDocGen = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : 0;
  }
  if (typeof entry._domReadySignal !== 'boolean') {
    entry._domReadySignal = false;
  }
  if (!entry.channelStates || typeof entry.channelStates !== 'object') {
    entry.channelStates = Object.create(null);
  }
  if (typeof entry.appliedConfigSeq !== 'number') {
    entry.appliedConfigSeq = 0;
  }
  return entry;
}

export function transitionEntryState(entry, nextState, reason = '') {
  if (!entry || typeof entry !== 'object') return ENTRY_FSM_STATES.DETACHED;
  ensureEntryFsm(entry);
  const resolved = ENTRY_FSM_STATES[nextState] ? nextState : entry.fsmState;
  entry.fsmPrevState = entry.fsmState;
  entry.fsmState = resolved;
  entry.fsmLastReason = String(reason || '');
  entry.fsmUpdatedAt = Date.now();
  return resolved;
}

/**
 * 处理 Ch1 主包注入结果，维护显式 Per-Window Entry FSM 迁移。
 * 当返回 `{ status: 'deferred' }` 时迁入 `AWAITING_DOM`（单文档周期内重试上限 <= 3），
 * 期间绝不归零 `healthyStreak` 退避，彻底根治 `sidebarHostVerified=false` 触发的高频 546 KB 重注死循环。
 */
export function recordEntryCh1Outcome(entry, res, docGen = null) {
  if (!entry || typeof entry !== 'object') return { state: ENTRY_FSM_STATES.DETACHED, deferred: false, exhausted: false };
  ensureEntryFsm(entry);
  const currentDoc = typeof docGen === 'number' ? docGen : typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : 0;
  const status = typeof res?.status === 'string' ? res.status : '';

  if (status === 'ok') {
    entry.awaitingDomAttempts = 0;
    entry.awaitingDomDocGen = currentDoc;
    entry._domReadySignal = false;
    transitionEntryState(entry, ENTRY_FSM_STATES.HEALTHY_BACKOFF, 'ch1-ok');
    return { state: ENTRY_FSM_STATES.HEALTHY_BACKOFF, deferred: false, exhausted: false };
  }

  if (status === 'skipped-non-host') {
    entry.awaitingDomAttempts = 0;
    entry._domReadySignal = false;
    transitionEntryState(entry, ENTRY_FSM_STATES.IGNORED, 'ch1-skipped-non-host');
    return { state: ENTRY_FSM_STATES.IGNORED, deferred: false, exhausted: false };
  }

  if (status === 'deferred') {
    if (entry.awaitingDomDocGen !== currentDoc) {
      entry.awaitingDomDocGen = currentDoc;
      entry.awaitingDomAttempts = 0;
    }
    entry.awaitingDomAttempts = Math.min(AWAITING_DOM_MAX_ATTEMPTS, (entry.awaitingDomAttempts || 0) + 1);
    entry._domReadySignal = false;
    // 保持或建立正向退避，绝不因 deferred 归零 healthyStreak 导致高频空转
    if (!Number.isFinite(entry.healthyStreak) || entry.healthyStreak < 1) {
      entry.healthyStreak = 1;
    }
    transitionEntryState(entry, ENTRY_FSM_STATES.AWAITING_DOM, `ch1-deferred-${entry.awaitingDomAttempts}`);
    return {
      state: ENTRY_FSM_STATES.AWAITING_DOM,
      deferred: true,
      attempts: entry.awaitingDomAttempts,
      exhausted: entry.awaitingDomAttempts >= AWAITING_DOM_MAX_ATTEMPTS,
    };
  }

  return { state: entry.fsmState, deferred: false, exhausted: false };
}

/**
 * 窗口收到 `Page.domContentLoadedEventFired` / `Page.loadEventFired` 时调用。
 * 返回 true 表示允许在 `AWAITING_DOM` 状态下推进下一次有限重试（总上限 <= 3 次）；
 * 若已耗尽 3 次上限，则拦截重复全量重注直至下一次文档导航发生。
 */
export function onEntryDomReadySignal(entry) {
  if (!entry || typeof entry !== 'object') return false;
  ensureEntryFsm(entry);
  if (entry.fsmState === ENTRY_FSM_STATES.IGNORED) return false;
  if (entry.fsmState === ENTRY_FSM_STATES.AWAITING_DOM) {
    const currentDoc = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : 0;
    if (entry.awaitingDomDocGen === currentDoc && entry.awaitingDomAttempts >= AWAITING_DOM_MAX_ATTEMPTS) {
      entry._domReadySignal = false;
      return false;
    }
    entry._domReadySignal = true;
    return true;
  }
  return true;
}

/**
 * 判断当前是否处于 `AWAITING_DOM` 静默等待期，需拦截全量 546 KB Ch1 重注并保留 `healthyStreak` 退避。
 */
export function shouldHoldAwaitingDomReinject(entry) {
  if (!entry || typeof entry !== 'object') return false;
  ensureEntryFsm(entry);
  if (entry.fsmState !== ENTRY_FSM_STATES.AWAITING_DOM) return false;
  const currentDoc = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : 0;
  if (entry.awaitingDomDocGen !== currentDoc) {
    entry.awaitingDomDocGen = currentDoc;
    entry.awaitingDomAttempts = 0;
    return false;
  }
  if (entry.awaitingDomAttempts >= AWAITING_DOM_MAX_ATTEMPTS) {
    return true;
  }
  // 未耗尽 3 次上限时，仅允许由 domContentLoaded/load 显式信号唤醒一次重试，周期 tick 不重注 Ch1
  return !entry._domReadySignal;
}

/**
 * 主文档导航或上下文清空时重置窗口文档代际 FSM 状态及全部通道熔断器。
 */
export function resetEntryForNewDocument(entry) {
  if (!entry || typeof entry !== 'object') return;
  ensureEntryFsm(entry);
  entry.awaitingDomAttempts = 0;
  entry.awaitingDomDocGen = typeof entry.sidebarDocument === 'number' ? entry.sidebarDocument : 0;
  entry._domReadySignal = false;
  transitionEntryState(entry, ENTRY_FSM_STATES.PROBING_HOST, 'document-reset');
  resetAllChannelCircuits(entry);
}

// ── Per-Channel 独立状态与 3 次连续失败熔断器 ───────────────────────────────
export function getChannelState(entry, channelId) {
  if (!entry || typeof entry !== 'object' || !channelId) return null;
  ensureEntryFsm(entry);
  let st = entry.channelStates[channelId];
  if (!st || typeof st !== 'object') {
    st = {
      status: CHANNEL_FSM_STATES.OFF,
      codeHash: '',
      scriptId: null,
      failCount: 0,
      cooldownUntil: 0,
      lastError: '',
      lastFailAt: 0,
      lastStage: '',
    };
    entry.channelStates[channelId] = st;
  } else {
    if (typeof st.lastError !== 'string') st.lastError = '';
    if (typeof st.lastFailAt !== 'number') st.lastFailAt = 0;
    if (typeof st.lastStage !== 'string') st.lastStage = '';
  }
  return st;
}

export function recordChannelSuccess(entry, channelId, { codeHash = '', scriptId = undefined } = {}) {
  const st = getChannelState(entry, channelId);
  if (!st) return null;
  st.status = CHANNEL_FSM_STATES.MOUNTED;
  if (typeof codeHash === 'string') st.codeHash = codeHash;
  if (scriptId !== undefined) st.scriptId = scriptId;
  st.failCount = 0;
  st.cooldownUntil = 0;
  return st;
}

export function recordChannelSkipped(entry, channelId, { codeHash = '' } = {}) {
  const st = getChannelState(entry, channelId);
  if (!st) return null;
  st.status = CHANNEL_FSM_STATES.SKIPPED;
  if (typeof codeHash === 'string') st.codeHash = codeHash;
  st.failCount = 0;
  st.cooldownUntil = 0;
  return st;
}

export function recordChannelOff(entry, channelId) {
  const st = getChannelState(entry, channelId);
  if (!st) return null;
  st.status = CHANNEL_FSM_STATES.OFF;
  st.codeHash = '';
  st.scriptId = null;
  st.failCount = 0;
  st.cooldownUntil = 0;
  return st;
}

export function recordChannelFailure(
  entry,
  channelId,
  { now = Date.now(), baseCooldownMs = CHANNEL_CIRCUIT_BASE_COOLDOWN_MS, error = '', stage = '' } = {}
) {
  const st = getChannelState(entry, channelId);
  if (!st) return null;
  const ts = Number.isFinite(now) && now > 0 ? now : Date.now();
  st.failCount = (st.failCount || 0) + 1;
  st.lastFailAt = ts;
  const cleanErr = formatSanitizedChannelError(error);
  if (cleanErr) st.lastError = cleanErr;
  const cleanStage = normalizeChannelStage(stage);
  if (cleanStage) st.lastStage = cleanStage;
  if (st.failCount >= CHANNEL_CIRCUIT_FAIL_THRESHOLD) {
    const exp = Math.min(4, st.failCount - CHANNEL_CIRCUIT_FAIL_THRESHOLD);
    const delay = Math.min(CHANNEL_CIRCUIT_MAX_COOLDOWN_MS, Math.max(1000, baseCooldownMs) * Math.pow(2, exp));
    st.status = CHANNEL_FSM_STATES.COOLDOWN;
    st.cooldownUntil = ts + delay;
  }
  return st;
}

export function isChannelInCooldown(entry, channelId, now = Date.now()) {
  const st = entry?.channelStates?.[channelId];
  if (!st || st.status !== CHANNEL_FSM_STATES.COOLDOWN) return false;
  if (st.cooldownUntil > now) return true;
  // 冷却到期：允许下一次探测恢复尝试（保持 failCount 以便连续失败再次快速熔断）
  return false;
}

export function resetChannelCircuit(entry, channelId) {
  const st = entry?.channelStates?.[channelId];
  if (!st) return;
  st.failCount = 0;
  st.cooldownUntil = 0;
  if (st.status === CHANNEL_FSM_STATES.COOLDOWN) {
    st.status = CHANNEL_FSM_STATES.OFF;
  }
}

export function resetAllChannelCircuits(entry) {
  if (!entry?.channelStates || typeof entry.channelStates !== 'object') return;
  for (const chId of Object.keys(entry.channelStates)) {
    resetChannelCircuit(entry, chId);
  }
}

// ── 配置内容 SHA-256 指纹去重器（彻底替代 650ms 墙钟窗口） ──────────────────
function _canonicalizeValue(val) {
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(_canonicalizeValue);
  const out = {};
  for (const k of Object.keys(val).sort()) {
    const v = val[k];
    if (v !== undefined) out[k] = _canonicalizeValue(v);
  }
  return out;
}

export function computeConfigFingerprint(cfgOrRaw) {
  let obj = cfgOrRaw;
  if (typeof cfgOrRaw === 'string') {
    const trimmed = cfgOrRaw.replace(/^\uFEFF/, '').trim();
    if (!trimmed) return '';
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
    }
  }
  if (!obj || typeof obj !== 'object') return '';
  const canonical = JSON.stringify(_canonicalizeValue(obj));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export class ConfigFingerprintTracker {
  constructor(initialConfig = null) {
    this._lastKnownHash = initialConfig ? computeConfigFingerprint(initialConfig) : '';
    this._selfWrittenHash = '';
  }

  recordSelfWrite(cfg) {
    const h = computeConfigFingerprint(cfg);
    if (h) {
      this._selfWrittenHash = h;
      this._lastKnownHash = h;
    }
    return h;
  }

  recordApplied(cfg) {
    const h = computeConfigFingerprint(cfg);
    if (h) {
      this._lastKnownHash = h;
    }
    return h;
  }

  /**
   * 检查磁盘最新配置是否与已应用/自身刚落盘的归一化内容指纹一致。
   * 一致则幂等返回 `{ changed: false }`（零自激回声，与延迟 100ms 还是 3000ms 无关）；
   * 不一致则立即返回 `{ changed: true, hash }`（哪怕外部改写发生在内部写盘 50ms 后也绝不静默丢更新）。
   */
  checkExternalChange(diskCfgOrRaw) {
    const hash = computeConfigFingerprint(diskCfgOrRaw);
    if (!hash) {
      return { changed: false, hash: '' };
    }
    if (hash === this._lastKnownHash || hash === this._selfWrittenHash) {
      return { changed: false, hash };
    }
    this._lastKnownHash = hash;
    this._selfWrittenHash = '';
    return { changed: true, hash };
  }

  getLastHash() {
    return this._lastKnownHash;
  }
}

// ── Target.targetInfoChanged 实质变化判定器（防 25Hz 忙轮询） ─────────────────
export function extractSignificantTargetUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const hashIdx = s.indexOf('#');
  const withoutHash = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  try {
    const u = new URL(withoutHash);
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return withoutHash;
  }
}

/**
 * 判断两次 URL 变化是否仍属于同一 SPA 文档路由（如纯 `?tab=` 查询参数抖动），
 * 仅在 protocol/host/pathname/hash、remoteAuthority 及解析出的远程 scope 完全一致时返回 true。
 */
export function isSameSpaDocumentRoute(prevUrl, nextUrl) {
  if (!prevUrl || !nextUrl || typeof prevUrl !== 'string' || typeof nextUrl !== 'string') return false;
  try {
    const a = new URL(prevUrl);
    const b = new URL(nextUrl);
    if (a.protocol !== b.protocol || a.host !== b.host || a.pathname !== b.pathname || a.hash !== b.hash) return false;
    const raA = a.searchParams.get('remoteAuthority') || '';
    const raB = b.searchParams.get('remoteAuthority') || '';
    if (raA !== raB) return false;
    return extractScopeKeyFromUri(prevUrl) === extractScopeKeyFromUri(nextUrl);
  } catch {
    return false;
  }
}

/**
 * 判断 `Target.targetInfoChanged` 是否包含实质变化（origin/pathname/search 改变或目标类型/附着状态跃迁）。
 * 忽略无意义的 `#hash` 锚点变动或 `title` 高频抖动，根治 25Hz 忙轮询。
 */
export function evaluateTargetInfoChange(existing, nextInfo) {
  if (!existing || !nextInfo || typeof nextInfo !== 'object') {
    return { dirty: false, significantUrlChanged: false, stateTransition: false, titleChanged: false };
  }
  const prevTitle = String(existing.title || '');
  const nextTitle = typeof nextInfo.title === 'string' && nextInfo.title ? nextInfo.title : prevTitle;
  const titleChanged = nextTitle !== prevTitle;

  const prevUrl = String(existing.url || '');
  const nextUrl = typeof nextInfo.url === 'string' && nextInfo.url ? nextInfo.url : prevUrl;
  const prevSig = extractSignificantTargetUrl(prevUrl);
  const nextSig = extractSignificantTargetUrl(nextUrl);
  const significantUrlChanged = Boolean(nextSig && nextSig !== prevSig);

  const prevAttached = typeof existing.targetAttached === 'boolean' ? existing.targetAttached : null;
  const nextAttached = typeof nextInfo.attached === 'boolean' ? nextInfo.attached : null;
  const attachedChanged = prevAttached !== null && nextAttached !== null && prevAttached !== nextAttached;

  const prevType = typeof existing.targetType === 'string' && existing.targetType ? existing.targetType : 'page';
  const nextType = typeof nextInfo.type === 'string' && nextInfo.type ? nextInfo.type : prevType;
  const typeChanged = nextType !== prevType;

  const stateTransition = Boolean(attachedChanged || typeChanged);
  const dirty = Boolean(significantUrlChanged || stateTransition);

  return {
    dirty,
    significantUrlChanged,
    stateTransition,
    titleChanged,
    prevSig,
    nextSig,
  };
}
