// Obsidian Prism Phase 3A 守护进程分层 FSM、熔断器、SHA-256 配置指纹、25Hz 抖动防护与兼容 Facade 专项回归单测
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as daemonFacade from '../sidecars/daemon/main.mjs';
import {
  PrismDaemon,
  isTrustedHostContext,
  ENTRY_FSM_STATES,
  CHANNEL_FSM_STATES,
  AWAITING_DOM_MAX_ATTEMPTS,
  CHANNEL_CIRCUIT_FAIL_THRESHOLD,
  ConfigFingerprintTracker,
  computeConfigFingerprint,
  extractSignificantTargetUrl,
  evaluateTargetInfoChange,
} from '../sidecars/daemon/main.mjs';
import {
  SessionRegistry,
  ChannelOrchestrator,
  TelemetrySubsystem,
  UpdateStorageSubsystem,
  RpcDispatcher,
  DaemonLoop,
} from '../src/daemon/index.mjs';
import {
  ensureEntryFsm,
  recordEntryCh1Outcome,
  onEntryDomReadySignal,
  shouldHoldAwaitingDomReinject,
  resetEntryForNewDocument,
  getChannelState,
  recordChannelSuccess,
  recordChannelFailure,
  isChannelInCooldown,
  resetAllChannelCircuits,
  CHANNEL_ERROR_MAX_CHARS,
} from '../src/daemon/session-fsm.mjs';
import { DaemonLogger, DAEMON_LOG_MAX_BYTES } from '../src/daemon/logger.mjs';
import { healSingleChannelOnEntry } from '../src/daemon/channel-sync-engine.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const cdp = require(path.join(ROOT_DIR, 'cdp.js'));

function makeTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeMockEntry({
  wsUrl = 'ws://127.0.0.1:9999/devtools/page/mock-1',
  pageId = 'mock-1',
  url = 'vscode-file://vscode-app/index.html#initial',
  title = 'Antigravity Workbench',
  evalHandler = async () => ({ ready: true, isHostDom: true, hasPrism: false }),
  sendHandler = async () => ({ identifier: 'script-1' }),
} = {}) {
  const sendCalls = [];
  const evalCalls = [];
  const session = {
    closed: false,
    close() {
      this.closed = true;
    },
    async send(method, params) {
      sendCalls.push({ method, params });
      return sendHandler(method, params);
    },
    async evaluate(expr, awaitPromise, timeoutMs) {
      evalCalls.push({ expr, awaitPromise, timeoutMs });
      return evalHandler(expr, awaitPromise, timeoutMs);
    },
  };
  const entry = {
    wsUrl,
    pageId,
    url,
    title,
    targetType: 'page',
    targetAttached: true,
    session,
    mainFrameId: 'MAIN_F',
    hasFrameTree: true,
    contextFrames: new Map([[1, { frameId: 'MAIN_F', isDefault: true, type: 'default' }]]),
    sidebarDocument: 1,
    sidebarHostVerified: false,
    sidebarHostContextId: 1,
    lastVerifyAt: 0,
    healthyStreak: 1,
    verifyDirty: false,
    lastVerifiedCodeHash: 'hash-ch1',
    appliedConfigSeq: 0,
    fsmState: ENTRY_FSM_STATES.PROBING_HOST,
    awaitingDomAttempts: 0,
    awaitingDomDocGen: 1,
    _domReadySignal: false,
    channelStates: Object.create(null),
    scriptId: 'ch1-script-1',
  };
  ensureEntryFsm(entry);
  return { entry, session, sendCalls, evalCalls };
}

function makeMinimalDaemon({
  rootDir = ROOT_DIR,
  cfg = null,
  injectExpr = '/* CH1_INJECT_546KB */',
  codeHash = 'hash-ch1',
} = {}) {
  const daemon = Object.create(PrismDaemon.prototype);
  daemon.rootDir = rootDir;
  daemon.running = true;
  daemon.silent = true;
  daemon.codeHash = codeHash;
  daemon.injectExpr = injectExpr;
  daemon.omniExpr = '';
  daemon.sidebarExpr = '';
  daemon.hostI18nExpr = '';
  daemon.thoughtExpr = '';
  daemon.inlineDiffExpr = '';
  daemon.wallpaperExpr = '';
  daemon.suggesterExpr = '';
  daemon.periodicPickerExpr = '';
  daemon.mascotExpr = '';
  daemon.homeStudioExpr = '';
  daemon.settingsExpr = '';
  daemon.telemetryExpr = '';
  daemon.effortSliderExpr = '';
  daemon.workbenchEnhancerExpr = '';
  daemon.contextMenuExpr = '';
  daemon.sessions = new Map();
  daemon.swarmSessions = new Map();
  daemon._swarmAttaching = new Set();
  daemon.ignoredTargets = new Map();
  daemon._configSeq = 0;
  daemon._broadcastRunning = false;
  daemon._broadcastPending = false;
  daemon._broadcastWaiters = [];
  daemon._configConvergenceDirty = false;
  daemon._configFingerprintTracker = new ConfigFingerprintTracker();
  daemon._reentrantTickStreak = 0;
  daemon._lastTickFinishedAt = 0;
  daemon._discoverTimer = null;
  daemon._discoverTimerTargetAt = 0;
  daemon._managedTimers = new Set();
  daemon._cdpFileSig = daemon._readCdpFileSig();
  const effectiveCfg = cfg || {
    ...cdp.DEFAULT_CONFIG,
    omniModule: 'off',
    sidebarStudio: 'off',
    hostLocalization: 'off',
    thoughtTranslate: 'off',
    inlineDiff: 'off',
    wallpaper: 'off',
    promptSuggester: 'off',
    periodicModelPicker: 'off',
    mascot: 'off',
    homeLayout: 'default',
    telemetryModule: 'off',
    effortSliderModule: 'off',
    workbenchEnhancer: 'off',
    contextMenu: false,
  };
  daemon.cdp = {
    PLUGIN_VERSION: cdp.PLUGIN_VERSION,
    SETTING_BINDING: cdp.SETTING_BINDING,
    CHANNEL_REGISTRY: cdp.CHANNEL_REGISTRY,
    readConfig: () => ({ ...effectiveCfg }),
    invalidateConfigCache: () => {},
    validateConfigEntry: cdp.validateConfigEntry,
    reconcileConfigAliases: cdp.reconcileConfigAliases,
    shouldEnableOmni: () => false,
    shouldEnableSidebarStudio: () => false,
    shouldEnableHostI18n: () => false,
    shouldEnableThought: () => false,
    shouldEnableInlineDiff: () => false,
    shouldEnableWallpaper: () => false,
    shouldEnableSuggester: () => false,
    shouldEnablePeriodicPicker: () => false,
    shouldEnableMascot: () => false,
    shouldEnableHomeStudio: () => false,
    shouldEnableTelemetry: () => false,
    shouldEnableEffortSlider: () => false,
    shouldEnableWorkbenchEnhancer: () => false,
    shouldEnableContextMenu: () => false,
    buildConfigRefreshExpression: () => `/* CFG_SYNC ${JSON.stringify(daemon.cdp.readConfig())} */`,
  };
  daemon.rebuildBundle = () => {};
  daemon._hasInlineDiffClientFile = () => false;
  daemon._hasWallpaperClientFile = () => false;
  daemon._hasSuggesterClientFile = () => false;
  daemon._hasPeriodicPickerFile = () => false;
  daemon._hasMascotFile = () => false;
  daemon._hasHomeStudioFile = () => false;
  daemon._hasOmniClientFile = () => false;
  daemon._hasSafeV2SidebarClientFile = () => false;
  daemon.log = () => {};
  return daemon;
}

test('FSM 1: Per-Window Entry FSM caps deferred AWAITING_DOM retries <= 3, halts 546KB Ch1 reinject loop, and preserves healthyStreak backoff', async () => {
  const daemon = makeMinimalDaemon();
  let ch1InjectCount = 0;
  let ch1Reply = { status: 'deferred' };

  const { entry } = makeMockEntry({
    evalHandler: async (expr) => {
      if (expr === daemon.injectExpr) {
        ch1InjectCount += 1;
        return ch1Reply;
      }
      // 健康探针：页面尚未出现 Prism，但属于宿主 DOM
      return {
        ready: true,
        isHostDom: true,
        href: 'vscode-file://vscode-app/index.html',
        title: 'Antigravity',
        prismAttr: '',
        hasPrism: false,
        hasRepoBridge: false,
        hasThoughtBridge: false,
        hasUsageBridge: false,
      };
    },
  });

  // 第 1 次注入返回 deferred -> 进入 AWAITING_DOM（attempts=1, healthyStreak>=1）
  const r1 = await daemon.verifyAndHealEntry(entry, true);
  assert.equal(ch1InjectCount, 1);
  assert.equal(r1.awaitingDom, true);
  assert.equal(entry.fsmState, ENTRY_FSM_STATES.AWAITING_DOM);
  assert.equal(entry.awaitingDomAttempts, 1);
  assert.ok(entry.healthyStreak >= 1, 'deferred must NEVER reset healthyStreak to 0');

  // 连续 5 次无 domContentLoaded/load 信号的周期探针：必须 0 次重注 Ch1，且 healthyStreak 递增
  const streakBefore = entry.healthyStreak;
  for (let i = 0; i < 5; i += 1) {
    const res = await daemon.verifyAndHealEntry(entry, true);
    assert.equal(res.awaitingDom, true);
  }
  assert.equal(ch1InjectCount, 1, 'Periodic verify ticks while AWAITING_DOM must NOT reinject 546KB Ch1');
  assert.ok(entry.healthyStreak > streakBefore, 'healthyStreak must grow during AWAITING_DOM backoff');

  // 模拟连续 5 次 domContentLoaded/load 信号：仅允许推进至上限 AWAITING_DOM_MAX_ATTEMPTS (3)，第 4/5 次彻底拦截
  let allowedSignals = 0;
  for (let i = 0; i < 5; i += 1) {
    if (onEntryDomReadySignal(entry)) {
      allowedSignals += 1;
      await daemon.verifyAndHealEntry(entry, true);
    }
  }
  assert.equal(allowedSignals, AWAITING_DOM_MAX_ATTEMPTS - 1);
  assert.equal(entry.awaitingDomAttempts, AWAITING_DOM_MAX_ATTEMPTS);
  assert.equal(ch1InjectCount, AWAITING_DOM_MAX_ATTEMPTS, 'Total deferred Ch1 attempts per document must be capped at 3');
  assert.equal(shouldHoldAwaitingDomReinject(entry), true);
  assert.equal(onEntryDomReadySignal(entry), false, 'Further DOM signals after 3 retries must be rejected');

  // 新文档导航发生 -> 复位计数与 FSM，后续返回 ok 时进入 HEALTHY_BACKOFF 且 verified=true
  entry.sidebarDocument += 1;
  resetEntryForNewDocument(entry);
  assert.equal(entry.awaitingDomAttempts, 0);
  assert.equal(entry.fsmState, ENTRY_FSM_STATES.PROBING_HOST);
  ch1Reply = { status: 'ok' };
  await daemon.verifyAndHealEntry(entry, true);
  assert.equal(entry.sidebarHostVerified, true);
  assert.equal(entry.fsmState, ENTRY_FSM_STATES.HEALTHY_BACKOFF);
  assert.equal(ch1InjectCount, AWAITING_DOM_MAX_ATTEMPTS + 1);
});

test('FSM 2: Per-Channel circuit breaker trips to cooldown after 3 consecutive failures without breaking window backoff, and resets on config change or navigation', async () => {
  const daemon = makeMinimalDaemon({
    cfg: {
      ...cdp.DEFAULT_CONFIG,
      omniModule: 'off',
      sidebarStudio: 'off',
      hostLocalization: 'off',
      thoughtTranslate: 'on',
      inlineDiff: 'off',
      wallpaper: 'off',
      promptSuggester: 'off',
      periodicModelPicker: 'off',
      mascot: 'off',
      homeLayout: 'default',
    },
  });
  daemon.cdp.shouldEnableThought = () => true;
  daemon.thoughtExpr = '/* THOUGHT_FAIL_EXPR */';

  let thoughtEvalCount = 0;
  const { entry } = makeMockEntry({
    evalHandler: async (expr) => {
      if (expr === daemon.thoughtExpr) {
        thoughtEvalCount += 1;
        return { ok: false };
      }
      return {
        ready: true,
        isHostDom: true,
        href: 'vscode-file://vscode-app/index.html',
        title: 'Antigravity',
        prismAttr: cdp.PLUGIN_VERSION,
        hasPrism: true,
        hasRepoBridge: true,
        hasThoughtBridge: true,
        hasUsageBridge: true,
        hasThought: false,
        hasThoughtSettingsUi: false,
        codeHash: daemon.codeHash,
      };
    },
  });
  entry.sidebarHostVerified = true;
  entry.fsmState = ENTRY_FSM_STATES.HEALTHY_BACKOFF;
  entry.thoughtScriptId = 'th-script-1';

  // 连续 3 次失败后自动触发熔断 cooldown
  for (let i = 1; i <= CHANNEL_CIRCUIT_FAIL_THRESHOLD; i += 1) {
    await daemon.verifyAndHealEntry(entry, true);
    const st = getChannelState(entry, 'thought');
    assert.equal(st.failCount, i);
  }
  const trippedState = getChannelState(entry, 'thought');
  assert.equal(thoughtEvalCount, 3);
  assert.equal(trippedState.status, CHANNEL_FSM_STATES.COOLDOWN);
  assert.ok(trippedState.cooldownUntil > Date.now());
  assert.equal(isChannelInCooldown(entry, 'thought'), true);

  // 熔断期间多次 verifyAndHealEntry：跳过失败通道（0 次新增 evaluate），且整窗 healthyStreak 正常递增
  await daemon.verifyAndHealEntry(entry, true);
  await daemon.verifyAndHealEntry(entry, true);
  assert.equal(thoughtEvalCount, 3, 'Circuit-broken channel must be skipped during cooldown');
  assert.ok(entry.healthyStreak >= 2, 'Single tripped channel must NOT stall whole-window healthyStreak backoff');

  // 验证配置变更或文档导航后立即复位熔断器
  resetAllChannelCircuits(entry);
  assert.equal(isChannelInCooldown(entry, 'thought'), false);
  assert.equal(getChannelState(entry, 'thought').failCount, 0);
  assert.equal(getChannelState(entry, 'thought').status, CHANNEL_FSM_STATES.OFF);

  // 再次打入熔断态，验证文档导航同样复位
  recordChannelFailure(entry, 'thought');
  recordChannelFailure(entry, 'thought');
  recordChannelFailure(entry, 'thought');
  assert.equal(isChannelInCooldown(entry, 'thought'), true);
  entry.sidebarDocument += 1;
  resetEntryForNewDocument(entry);
  assert.equal(isChannelInCooldown(entry, 'thought'), false);
});

test('FSM 3: SHA-256 config fingerprint suppresses delayed self-write echoes (100ms & 3000ms) while catching fast external edits (<50ms)', async () => {
  // 静态断言彻底清除墙钟窗口 _selfConfigWriteUntil
  const srcFiles = [
    path.join(ROOT_DIR, 'sidecars', 'daemon', 'main.mjs'),
    ...fs
      .readdirSync(path.join(ROOT_DIR, 'src', 'daemon'))
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => path.join(ROOT_DIR, 'src', 'daemon', f)),
  ];
  for (const f of srcFiles) {
    assert.equal(
      fs.readFileSync(f, 'utf8').includes('_selfConfigWriteUntil'),
      false,
      `${path.basename(f)} must not retain wall-clock _selfConfigWriteUntil`
    );
  }

  const tmpDir = makeTempDir('prism-fp-');
  try {
    const cfgPath = path.join(tmpDir, 'config.json');
    const initial = { ...cdp.DEFAULT_CONFIG, language: 'auto', telemetryModule: 'auto' };
    fs.writeFileSync(cfgPath, JSON.stringify(initial, null, 2) + '\n', 'utf8');

    const daemon = makeMinimalDaemon({ rootDir: tmpDir, cfg: initial });
    daemon.cdp.CONFIG_PATH = cfgPath;
    daemon.cdp.readConfig = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    let broadcastCalls = 0;
    daemon.broadcastConfigRefresh = async () => {
      broadcastCalls += 1;
      return { synced: 0 };
    };
    daemon._syncConfigFingerprintFromDisk(cfgPath);

    // 1) 内部 updateConfigBatch 写盘
    const ok = daemon.updateConfigBatch({ language: 'zh-CN' });
    assert.equal(ok, true);
    const seqAfterSelfWrite = daemon._configSeq;

    // 2) 模拟杀软/慢盘延迟 100ms 与 3000ms 后 fs.watch 到达（即使字段顺序重排但内容等价）
    const diskObj = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const reordered = {};
    for (const k of Object.keys(diskObj).reverse()) reordered[k] = diskObj[k];
    fs.writeFileSync(cfgPath, JSON.stringify(reordered) + '\n', 'utf8');

    assert.equal(daemon._isWatchedConfigUnchangedPeek(cfgPath), true);
    const echo100 = await daemon._handleWatchedConfigChange(cfgPath);
    assert.equal(echo100.applied, false);
    assert.equal(echo100.reason, 'fingerprint-unchanged');

    const echo3000 = await daemon._handleWatchedConfigChange(cfgPath);
    assert.equal(echo3000.applied, false);
    assert.equal(broadcastCalls, 0, 'Self-write echo must never trigger broadcastConfigRefresh');
    assert.equal(daemon._configSeq, seqAfterSelfWrite);

    // 3) 仅过 0~50ms 外部修改磁盘配置：旧 650ms 墙钟会吞掉，SHA-256 指纹必须立刻响应！
    const externalCfg = { ...diskObj, language: 'en' };
    fs.writeFileSync(cfgPath, JSON.stringify(externalCfg, null, 2) + '\n', 'utf8');
    assert.equal(daemon._isWatchedConfigUnchangedPeek(cfgPath), false);
    const extRes = await daemon._handleWatchedConfigChange(cfgPath);
    assert.equal(extRes.applied, true);
    assert.equal(broadcastCalls, 1, 'Immediate external config write must NEVER be silently dropped');
    assert.equal(daemon._configSeq, seqAfterSelfWrite + 1);

    // 4) 纯 tracker 归一化一致性校验
    const tracker = new ConfigFingerprintTracker({ b: 2, a: 1 });
    assert.equal(computeConfigFingerprint({ a: 1, b: 2 }), computeConfigFingerprint({ b: 2, a: 1 }));
    assert.equal(tracker.checkExternalChange('{"a":1,"b":2}').changed, false);
    assert.equal(tracker.checkExternalChange('{"a":1,"b":3}').changed, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('FSM 4: Target.targetInfoChanged ignores high-frequency hash/title jitter (anti-25Hz busy loop) and coalesces reentrant ticks', () => {
  const daemon = makeMinimalDaemon();
  let immediateTickCalls = 0;
  daemon.scheduleImmediateTick = () => {
    immediateTickCalls += 1;
  };

  const { entry } = makeMockEntry({
    pageId: 'win-42',
    url: 'vscode-file://vscode-app/index.html#conv-1',
    title: 'Conv 1 - Antigravity',
  });
  entry.healthyStreak = 5;
  entry.verifyDirty = false;
  daemon.sessions.set(entry.wsUrl, entry);

  // 连续 30 次纯 #hash 与 title 抖动：0 次标脏、0 次重置退避、0 次触发立即 tick
  for (let i = 0; i < 30; i += 1) {
    const res = daemon._handleBrowserTargetEvent({
      targetInfo: {
        targetId: 'win-42',
        type: 'page',
        attached: true,
        title: `Conv ${i} (streaming...) - Antigravity`,
        url: `vscode-file://vscode-app/index.html#step-${i}`,
      },
    });
    assert.equal(res.dirty, false);
  }
  assert.equal(immediateTickCalls, 0, 'Hash/title jitter must trigger 0 immediate ticks');
  assert.equal(entry.verifyDirty, false);
  assert.equal(entry.healthyStreak, 5, 'Hash/title jitter must preserve healthyStreak backoff');

  // 实质 pathname 改变 -> 立即标脏并调度 1 次 tick
  const navRes = daemon._handleBrowserTargetEvent({
    targetInfo: {
      targetId: 'win-42',
      type: 'page',
      attached: true,
      title: 'Workbench',
      url: 'vscode-file://vscode-app/workbench.html#new',
    },
  });
  assert.equal(navRes.dirty, true);
  assert.equal(entry.verifyDirty, true);
  assert.equal(entry.healthyStreak, 0);
  assert.equal(immediateTickCalls, 1);

  // attached 状态跃迁 -> 同样标脏
  entry.verifyDirty = false;
  entry.healthyStreak = 3;
  const attRes = daemon._handleBrowserTargetEvent({
    targetInfo: {
      targetId: 'win-42',
      type: 'page',
      attached: false,
      title: 'Workbench',
      url: 'vscode-file://vscode-app/workbench.html#new',
    },
  });
  assert.equal(attRes.dirty, true);
  assert.equal(immediateTickCalls, 2);

  // 验证 extractSignificantTargetUrl 与 evaluateTargetInfoChange 纯函数
  assert.equal(
    extractSignificantTargetUrl('https://Host.Local/app/index.html?v=1#frag-a'),
    extractSignificantTargetUrl('https://host.local/app/index.html?v=1#frag-b')
  );
  assert.equal(
    evaluateTargetInfoChange(
      { url: 'https://host.local/a#1', title: 'T1', targetAttached: true, targetType: 'page' },
      { url: 'https://host.local/a#2', title: 'T2', attached: true, type: 'page' }
    ).dirty,
    false
  );

  // 验证重入 tick 指数退避合并防 40ms 死循环空转
  daemon.scheduleImmediateTick = PrismDaemon.prototype.scheduleImmediateTick;
  daemon._lastTickFinishedAt = Date.now();
  const d1 = daemon._computeCoalescedTickDelay(45);
  const d2 = daemon._computeCoalescedTickDelay(45);
  const d3 = daemon._computeCoalescedTickDelay(45);
  assert.equal(d1, 45);
  assert.equal(d2, 90);
  assert.equal(d3, 180);
});

test('FSM 5: broadcastConfigRefresh converges all windows cleanly without half-torn state when superseded mid-flight', async () => {
  let liveCfg = {
    ...cdp.DEFAULT_CONFIG,
    language: 'zh-CN',
    omniModule: 'off',
    sidebarStudio: 'off',
    hostLocalization: 'off',
    thoughtTranslate: 'off',
    inlineDiff: 'off',
    wallpaper: 'off',
    promptSuggester: 'off',
    periodicModelPicker: 'off',
    mascot: 'off',
    homeLayout: 'default',
  };
  const daemon = makeMinimalDaemon({ cfg: liveCfg });
  daemon.cdp.readConfig = () => ({ ...liveCfg });
  daemon._configSeq = 1;

  const seenLangsA = [];
  const seenLangsB = [];
  let releaseEntryA = null;
  let entryAStarted = false;

  const { entry: entryA } = makeMockEntry({
    wsUrl: 'ws://127.0.0.1:9999/page/A',
    pageId: 'A',
    evalHandler: async (expr) => {
      const m = /"language":"([^"]+)"/.exec(expr);
      if (m) seenLangsA.push(m[1]);
      if (!entryAStarted) {
        entryAStarted = true;
        await new Promise((r) => {
          releaseEntryA = r;
        });
      }
      return { refreshed: true, ok: true };
    },
  });
  const { entry: entryB } = makeMockEntry({
    wsUrl: 'ws://127.0.0.1:9999/page/B',
    pageId: 'B',
    evalHandler: async (expr) => {
      const m = /"language":"([^"]+)"/.exec(expr);
      if (m) seenLangsB.push(m[1]);
      return { refreshed: true, ok: true };
    },
  });
  entryA.sidebarHostVerified = true;
  entryB.sidebarHostVerified = true;
  daemon.sessions.set(entryA.wsUrl, entryA);
  daemon.sessions.set(entryB.wsUrl, entryB);

  // 启动第 1 轮广播（language='zh-CN', seq=1），卡在 entryA 执行中途
  const p1 = daemon.broadcastConfigRefresh();
  while (!entryAStarted) {
    await new Promise((r) => setTimeout(r, 5));
  }

  // 在第 1 轮尚未完成时，配置切换为 language='en' (seq=2) 并并发请求第 2 轮广播
  liveCfg = { ...liveCfg, language: 'en' };
  daemon._configSeq = 2;
  const p2 = daemon.broadcastConfigRefresh();

  // 放行 entryA，等待两轮收敛完毕
  releaseEntryA();
  await Promise.all([p1, p2]);

  // 两个窗口必须全部收敛到最新 seq=2 且最终收到 'en'，无半撕裂残留
  assert.equal(entryA.appliedConfigSeq, 2);
  assert.equal(entryB.appliedConfigSeq, 2);
  assert.equal(seenLangsA[seenLangsA.length - 1], 'en');
  assert.equal(seenLangsB[seenLangsB.length - 1], 'en');
  assert.equal(entryA._configConvergenceDirty, false);
  assert.equal(entryB._configConvergenceDirty, false);
});

test('Security & Facade: isTrustedHostContext enforces fail-closed host boundaries & main.mjs facade preserves all 36 legacy exports + CHANNEL_REGISTRY', () => {
  const ctxMeta = { frameId: 'MAIN_F', isDefault: true, type: 'default' };
  const isoMeta = { frameId: 'MAIN_F', isDefault: false, type: 'isolated' };
  const subMeta = { frameId: 'SUB_F', isDefault: true, type: 'default' };
  const { entry } = makeMockEntry();
  entry.sidebarHostVerified = true;
  entry.sidebarHostContextId = 10;
  entry.sidebarDocument = 3;
  entry.contextFrames = new Map([
    [10, ctxMeta],
    [11, isoMeta],
    [12, subMeta],
  ]);

  assert.equal(isTrustedHostContext(entry, 10, 3, { expectedContext: ctxMeta }), true);
  assert.equal(isTrustedHostContext(entry, 10, 3, { stopped: true }), false, 'stopped daemon must fail-closed');
  assert.equal(isTrustedHostContext(entry, 10, 2), false, 'stale docGen must fail-closed');
  assert.equal(isTrustedHostContext(entry, 11, 3), false, 'isolated context must fail-closed');
  assert.equal(isTrustedHostContext(entry, 12, 3), false, 'subframe context must fail-closed');
  assert.equal(isTrustedHostContext(entry, 99, 3), false, 'unregistered context id must fail-closed');
  assert.equal(isTrustedHostContext(entry, 10, 3, { expectedContext: { ...ctxMeta } }), false, 'different context reference must fail-closed');

  entry.sidebarHostVerified = false;
  assert.equal(isTrustedHostContext(entry, 10, 3), false, 'unverified host must fail-closed');

  // 核对 sidecars/daemon/main.mjs 薄 Facade 100% 透传原全部 36 个 named exports
  const expectedLegacyExports = [
    'DAEMON_SHUTDOWN_SIGNALS',
    'INLINE_DIFF_BINDING',
    'METRICS_BINDING',
    'OMNI_BINDING',
    'OmniServer',
    'PrismDaemon',
    'REPO_BINDING',
    'SIDEBAR_BINDING',
    'SUGGESTER_BINDING',
    'THOUGHT_BINDING',
    'USAGE_BINDING',
    'WALLPAPER_BINDING',
    'copyUpdatedRuntimeFromRepo',
    'discoverActivePort',
    'extractScopeKeyFromTitle',
    'extractScopeKeyFromUri',
    'hasRealUsageRecord',
    'isEligibleTarget',
    'isMainEntry',
    'isObsidianPrismDaemonCommandLine',
    'isPluginEnabledInHostConfig',
    'isSensitiveInlineDiffPath',
    'normalizeUsageScopeKey',
    'parseTasklistCsvImageName',
    'queryWindowsProcessImageNameSync',
    'readSafeInlineDiff',
    'registerDaemonShutdownSignals',
    'resolvePortFileCandidates',
    'resolveStorageGuardStatePath',
    'resolveUsageCachePath',
    'resolveUsageScopeKey',
    'sanitizeGitRemoteUrl',
    'sanitizeLogLine',
    'sanitizeSecretText',
    'verifyDaemonPidLockToken',
    'writeFileAtomicSync',
  ];
  for (const name of expectedLegacyExports) {
    assert.ok(Object.prototype.hasOwnProperty.call(daemonFacade, name), `main.mjs facade missing legacy export: ${name}`);
    assert.notEqual(daemonFacade[name], undefined, `main.mjs facade export ${name} must not be undefined`);
  }

  // 核对 channel-coordinator 消费 cdp.CHANNEL_REGISTRY 通道清单
  const daemon = makeMinimalDaemon();
  for (const ch of cdp.CHANNEL_REGISTRY) {
    const found = daemon.getRegisteredChannel(ch.id);
    assert.ok(found, `Channel coordinator must resolve CHANNEL_REGISTRY entry: ${ch.id}`);
    assert.equal(found.channel, ch.channel);
  }
});

test('Hot-reload P0: _readCdpTreeSig detects src/**/*.cjs edits, clears src require.cache on reload, exports cdp.CONFIG_PATH, and widens needsHardReload', () => {
  // 1) cdp.CONFIG_PATH must be exported and match cdp.CONFIG_FILE
  assert.equal(typeof cdp.CONFIG_PATH, 'string');
  assert.ok(cdp.CONFIG_PATH.length > 0, 'cdp.CONFIG_PATH must be non-empty');
  assert.equal(cdp.CONFIG_PATH, cdp.CONFIG_FILE, 'cdp.CONFIG_PATH must match cdp.CONFIG_FILE');

  // 2) repo-update-coordinator needsHardReload must match any file under src/
  const repoUpdateSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'daemon', 'repo-update-coordinator.mjs'),
    'utf8'
  );
  assert.ok(
    repoUpdateSrc.includes('/^(?:sidecars\\/|src\\/|installer\\/|cdp\\.js$)/'),
    'needsHardReload regex must cover entire src/ tree'
  );

  // 3) Isolated directory test: mutating src/utils/fs-safe.cjs changes _readCdpTreeSig and forces fresh CJS require
  const tmpDir = makeTempDir('prism-hotreload-tree-');
  try {
    fs.copyFileSync(path.join(ROOT_DIR, 'cdp.js'), path.join(tmpDir, 'cdp.js'));
    fs.copyFileSync(path.join(ROOT_DIR, 'package.json'), path.join(tmpDir, 'package.json'));
    fs.copyFileSync(path.join(ROOT_DIR, 'config.example.json'), path.join(tmpDir, 'config.example.json'));
    fs.copyFileSync(path.join(ROOT_DIR, 'style.css'), path.join(tmpDir, 'style.css'));
    fs.cpSync(path.join(ROOT_DIR, 'src'), path.join(tmpDir, 'src'), { recursive: true });
    for (const part of cdp.RUNTIME_PARTS) {
      const dst = path.join(tmpDir, part);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT_DIR, part), dst);
    }

    const daemon = new PrismDaemon({
      rootDir: tmpDir,
      silent: true,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
      bundleCachePath: false,
    });
    daemon.rebuildBundle();
    const sigBefore = daemon._cdpFileSig;
    const cdpRefBefore = daemon.cdp;
    const targetModPath = path.join(tmpDir, 'src', 'config', 'schema.cjs');
    const resolvedBefore = require.resolve(targetModPath);
    const modExportsBefore = require.cache[resolvedBefore]?.exports;
    assert.ok(sigBefore && sigBefore.length > 0, '_readCdpTreeSig must produce non-empty signature');
    assert.ok(modExportsBefore, 'src/config/schema.cjs must be present in require.cache after initial load');
    assert.equal(daemon._resolveWatchedConfigPath(), path.resolve(cdpRefBefore.CONFIG_PATH));

    // Modify a nested src/**/*.cjs module (bump size + mtime) without touching top-level cdp.js
    const origSchema = fs.readFileSync(targetModPath, 'utf8');
    fs.writeFileSync(targetModPath, `${origSchema}\n// hot-reload-sentinel-v2\n`, 'utf8');
    const futureTime = new Date(Date.now() + 5000);
    fs.utimesSync(targetModPath, futureTime, futureTime);

    const sigAfter = daemon._readCdpTreeSig();
    assert.notEqual(sigAfter, sigBefore, '_readCdpTreeSig must change when src/**/*.cjs is edited');

    daemon.rebuildBundle();
    assert.notEqual(daemon.cdp, cdpRefBefore, 'rebuildBundle must reload cdp.js when src/**/*.cjs changes');
    const modExportsAfter = require.cache[resolvedBefore]?.exports;
    assert.ok(modExportsAfter, 'src/config/schema.cjs must be reloaded into require.cache');
    assert.notEqual(
      modExportsAfter,
      modExportsBefore,
      'Clearing src/**/*.cjs require.cache must produce a brand-new module reference'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 4B True Microkernel: PrismDaemon composes 4 isolated subsystems (0 prototype mixins) and drives all 16 channels from CHANNEL_REGISTRY', () => {
  const daemon = new PrismDaemon({
    rootDir: ROOT_DIR,
    silent: true,
    enableAutoUpdateTimer: false,
    enableStorageGuardTimer: false,
    bundleCachePath: false,
  });

  // 1) All 4 core subsystems + collaborators are composed as distinct class instances
  assert.ok(daemon.sessionRegistry instanceof SessionRegistry, 'daemon.sessionRegistry must be SessionRegistry');
  assert.ok(daemon.channelOrchestrator instanceof ChannelOrchestrator, 'daemon.channelOrchestrator must be ChannelOrchestrator');
  assert.ok(daemon.telemetrySubsystem instanceof TelemetrySubsystem, 'daemon.telemetrySubsystem must be TelemetrySubsystem');
  assert.ok(daemon.updateStorageSubsystem instanceof UpdateStorageSubsystem, 'daemon.updateStorageSubsystem must be UpdateStorageSubsystem');
  assert.ok(daemon.rpcDispatcher instanceof RpcDispatcher, 'daemon.rpcDispatcher must be RpcDispatcher');
  assert.ok(daemon.daemonLoop instanceof DaemonLoop, 'daemon.daemonLoop must be DaemonLoop');

  // 2) Encapsulated state ownership: each subsystem holds its own domain state without sharing a God Object prototype mixin
  assert.equal(daemon.sessions, daemon.sessionRegistry.sessions);
  assert.equal(daemon.updateService, daemon.updateStorageSubsystem.updateService);
  assert.equal(daemon.addonRegistry, daemon.updateStorageSubsystem.addonRegistry);
  assert.equal(daemon._quotaForceRefreshGuard, daemon.telemetrySubsystem._quotaForceRefreshGuard);
  assert.equal(daemon.channelOrchestrator._channelStore.size, cdp.CHANNEL_REGISTRY.length);
  for (const ch of cdp.CHANNEL_REGISTRY) {
    assert.ok(
      daemon.channelOrchestrator._channelStore.has(ch.id),
      `ChannelOrchestrator._channelStore must track registry channel "${ch.id}"`
    );
    assert.equal(daemon.channelOrchestrator.getRegisteredChannel(ch.id)?.id, ch.id);
  }

  // 3) Table-driven channel expression slot isolation via ChannelOrchestrator
  const probeSample = '(() => { const targetHash = "p4bHash77"; return { ok: true }; })()';
  daemon.channelOrchestrator.setChannelExpr('periodicPicker', probeSample);
  assert.equal(daemon.periodicPickerExpr, probeSample);
  assert.equal(daemon.channelOrchestrator.getChannelExprHash('periodicPicker'), 'p4bHash77');
  assert.equal(daemon.periodicPickerCodeHash, 'p4bHash77');

  // 4) Independent instances do not share mutable subsystem instances
  const daemon2 = new PrismDaemon({
    rootDir: ROOT_DIR,
    silent: true,
    enableAutoUpdateTimer: false,
    enableStorageGuardTimer: false,
    bundleCachePath: false,
  });
  assert.notEqual(daemon.sessionRegistry, daemon2.sessionRegistry);
  assert.notEqual(daemon.channelOrchestrator, daemon2.channelOrchestrator);
  assert.notEqual(daemon.telemetrySubsystem, daemon2.telemetrySubsystem);
  assert.notEqual(daemon.updateStorageSubsystem, daemon2.updateStorageSubsystem);
  assert.equal(daemon2.periodicPickerExpr, '');
});

test('Phase 4D: all 16 channel builders wrap execution in structured try/catch error boundaries without throwing into host', () => {
  const allEnabledCfg = {
    ...cdp.DEFAULT_CONFIG,
    omniModule: 'on',
    sidebarStudio: 'on',
    hostLocalization: 'on',
    language: 'zh-CN',
    thoughtTranslate: 'ai',
    periodicModelPicker: 'on',
    mascot: 'crab',
    homeLayout: 'studio',
    telemetryModule: 'on',
    effortSliderModule: 'on',
    workbenchEnhancer: 'on',
    contextMenu: true,
  };

  for (const ch of cdp.CHANNEL_REGISTRY) {
    const expr = ch._buildForReport(allEnabledCfg, { noDiskCache: true });
    assert.ok(typeof expr === 'string' && expr.length > 0, `Channel ${ch.id} must build non-empty expression`);
    assert.doesNotThrow(() => new vm.Script(expr), `Channel ${ch.id} expression with error boundary must parse cleanly`);
    assert.ok(
      expr.includes(`status: 'error', channel: '${ch.id}'`),
      `Channel ${ch.id} expression must declare structured error boundary with channel: '${ch.id}'`
    );

    // Inject a hostile getter on window/document that throws synchronously inside the channel shell
    const bomb = new TypeError(`simulated-${ch.id}-crash`);
    const hostileDoc = new Proxy(
      {
        readyState: 'complete',
        title: 'Antigravity',
        documentElement: {
          setAttribute() { throw bomb; },
          getAttribute() { throw bomb; },
          removeAttribute() { throw bomb; },
        },
        body: { classList: { contains: () => true } },
        querySelector() { throw bomb; },
        querySelectorAll() { throw bomb; },
        getElementById() { throw bomb; },
        addEventListener() { throw bomb; },
      },
      {}
    );
    const trapExisting = {
      get codeHash() { throw bomb; },
      get __prismCodeHash() { throw bomb; },
      get destroyed() { throw bomb; },
      get getDebugState() { throw bomb; },
      get getState() { throw bomb; },
    };
    const hostileWin = {
      location: ch.id === 'swarmI18n'
        ? { protocol: 'plugin:', hostname: 'swarm--swarm_board-1', pathname: '/', port: '', username: '', password: '' }
        : { href: 'vscode-file://vscode-app/workbench.html' },
      document: hostileDoc,
      __agPrism: { getState: () => ({ cfg: { sidebarStudio: 'on', omniModule: 'on', thoughtTranslate: 'ai', homeLayout: 'studio', mascot: 'crab', telemetryModule: 'on', effortSliderModule: 'on', workbenchEnhancer: 'on', contextMenu: true, periodicModelPicker: 'on', hostLocalization: 'on', language: 'zh-CN' } }) },
      __agPrismOmni: trapExisting,
      __agPrismSidebar: trapExisting,
      __agPrismInlineDiff: trapExisting,
      __agPrismHostI18n: trapExisting,
      __agPrismSwarmI18n: trapExisting,
      __agPrismWallpaper: trapExisting,
      __agPrismPeriodicPicker: trapExisting,
      __agPrismHomeStudioPanel: trapExisting,
      __agPrismThought: trapExisting,
      __agPrismSettingsPanel: trapExisting,
      __agDualMascotRig: trapExisting,
      __agPrismSuggester: trapExisting,
      __agPrismTelemetry: trapExisting,
      __agPrismEffortSlider: trapExisting,
      __agPrismHostEnhancer: trapExisting,
      __agPrismContextMenu: trapExisting,
    };
    hostileWin.self = hostileWin;
    hostileWin.top = hostileWin;
    hostileWin.window = hostileWin;
    hostileWin.globalThis = hostileWin;

    const res = vm.runInNewContext(expr, hostileWin);
    assert.equal(res?.ok, false, `Channel ${ch.id} crash must return ok:false`);
    assert.equal(res?.status, 'error', `Channel ${ch.id} crash must return status:'error'`);
    assert.equal(res?.channel, ch.id, `Channel ${ch.id} crash must tag channel:'${ch.id}'`);
    assert.ok(String(res?.error || '').includes(`simulated-${ch.id}-crash`), `Channel ${ch.id} must preserve error message`);
    assert.equal(typeof res?.stack, 'string');
    assert.ok(res.error.length <= 300 && res.stack.length <= 600);
  }
});

test('Phase 4D: session-fsm records sanitized lastError/lastFailAt/lastStage and channel-sync-engine logs crash stack without silent swallow', async () => {
  const { entry } = makeMockEntry();
  const fakeSecret = 'sk-' + 'SUPERSECRETTOKEN9876543210';
  const longHomeErr = `Crash at ${os.homedir()}\\secret\\file.js with ${fakeSecret} ` + 'x'.repeat(400);
  const t0 = 1_750_000_000_000;

  const st1 = recordChannelFailure(entry, 'wallpaper', { now: t0, error: longHomeErr, stage: 'heal' });
  assert.equal(st1.failCount, 1);
  assert.equal(st1.lastFailAt, t0);
  assert.equal(st1.lastStage, 'heal');
  assert.ok(st1.lastError.length <= CHANNEL_ERROR_MAX_CHARS, 'lastError must truncate to <= 240 chars');
  assert.equal(st1.lastError.includes(fakeSecret), false, 'lastError must redact secrets');
  assert.equal(st1.lastError.includes(os.homedir()), false, 'lastError must redact user home directory');
  assert.ok(st1.lastError.includes('<USER_HOME>'), 'lastError must mask user home directory as <USER_HOME>');

  // Recovery clears failCount/cooldown while retaining diagnostic snapshot
  recordChannelSuccess(entry, 'wallpaper', { codeHash: 'abc123' });
  const stRec = getChannelState(entry, 'wallpaper');
  assert.equal(stRec.failCount, 0);
  assert.equal(stRec.status, CHANNEL_FSM_STATES.MOUNTED);
  assert.equal(stRec.lastStage, 'heal');
  assert.equal(stRec.lastFailAt, t0);

  // End-to-end channel-sync-engine healSingleChannelOnEntry captures structured error & logs redacted diagnostics
  const logs = [];
  const { entry: healEntry } = makeMockEntry({
    evalHandler: async () => ({
      ok: false,
      status: 'error',
      channel: 'thought',
      error: `Boom with ${fakeSecret} in ${os.homedir()}/foo`,
      stack: `Error: Boom\n  at mount (${os.homedir()}/foo:1:1)`,
    }),
  });
  const fakeOrch = {
    getCdp: () => cdp,
    ensureChannelExpr: () => '(() => {})()',
    getChannelExprHash: () => 'h1',
    getChannelCfgSig: () => 's1',
    redact: (s) => String(s || '').replace(fakeSecret, '***REDACTED***'),
    log: (m) => logs.push(m),
  };
  const thoughtSpec = cdp.findChannel('thought');
  await healSingleChannelOnEntry(fakeOrch, healEntry, thoughtSpec, { ...cdp.DEFAULT_CONFIG, thoughtTranslate: 'ai' }, null, {
    forceEval: true,
    now: t0 + 1000,
  });
  const thState = getChannelState(healEntry, 'thought');
  assert.equal(thState.failCount, 1);
  assert.equal(thState.lastStage, 'heal');
  assert.equal(thState.lastFailAt, t0 + 1000);
  assert.equal(thState.lastError.includes(fakeSecret), false);
  assert.ok(thState.lastError.includes('Boom'));
  assert.equal(logs.length, 1, 'Structured channel crash must emit diagnostic log line');
  assert.ok(logs[0].includes('thought') && logs[0].includes('[heal]'));
  assert.equal(logs[0].includes(fakeSecret), false);
});

test('Phase 4D: DaemonLogger rolls daemon.log -> daemon.log.1 at 512 KB without erasing pre-crash logs', () => {
  const tmpDir = makeTempDir('prism-rolling-log-');
  try {
    const logFile = path.join(tmpDir, 'daemon.log');
    const backupFile = `${logFile}.1`;
    assert.equal(DAEMON_LOG_MAX_BYTES, 512 * 1024);

    // 1) Pre-seed daemon.log right at 512 KB with a critical pre-crash marker at the tail
    const preCrashMarker = 'CRITICAL-PRE-CRASH-SNAPSHOT-LINE-001';
    const filler = 'A'.repeat(DAEMON_LOG_MAX_BYTES - preCrashMarker.length - 16) + '\n' + preCrashMarker + '\n';
    fs.writeFileSync(logFile, filler, { encoding: 'utf8', mode: 0o600 });

    const logger = new DaemonLogger({ logFile, silent: false });
    const postRollMarker = 'POST-ROLLOVER-FRESH-LINE-002';
    logger.log(postRollMarker);

    assert.equal(fs.existsSync(backupFile), true, 'Exceeding 512 KB must rotate daemon.log to daemon.log.1');
    assert.equal(fs.existsSync(logFile), true, 'Fresh daemon.log must exist after rotation');
    const backupContent = fs.readFileSync(backupFile, 'utf8');
    const freshContent = fs.readFileSync(logFile, 'utf8');
    assert.ok(backupContent.includes(preCrashMarker), 'daemon.log.1 must preserve pre-crash log lines');
    assert.ok(freshContent.includes(postRollMarker), 'New daemon.log must contain the post-rotation line');
    assert.equal(freshContent.includes(preCrashMarker), false, 'New daemon.log must start fresh after rotation');
    assert.ok(fs.statSync(logFile).size < 4096, 'Fresh daemon.log size must reset near 0');

    // 2) Second rotation overwrites stale daemon.log.1 cleanly with latest batch
    const loggerSmall = new DaemonLogger({ logFile, silent: false, maxBytes: 256 });
    loggerSmall.log('SECOND-GEN-LINE-A-' + 'B'.repeat(200));
    loggerSmall.log('THIRD-GEN-LINE-C');
    const backupContent2 = fs.readFileSync(backupFile, 'utf8');
    const freshContent2 = fs.readFileSync(logFile, 'utf8');
    assert.ok(backupContent2.includes('SECOND-GEN-LINE-A'), 'Second rollover must replace old daemon.log.1 atomically');
    assert.ok(freshContent2.includes('THIRD-GEN-LINE-C'), 'Latest log line must land in fresh daemon.log');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
      assert.equal(fs.statSync(backupFile).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RpcDispatcher handleMetricsBinding sanitizes secrets in catch error payloads', async () => {
  const sentExprs = [];
  const fakeEntry = {
    mainFrameId: 'frame-1',
    hasFrameTree: true,
    contextFrames: new Map([[1, { isDefault: true, type: 'default', frameId: 'frame-1' }]]),
    session: {
      closed: false,
      async send(method, params) {
        if (method === 'Runtime.evaluate') sentExprs.push(params.expression);
        return { result: { value: undefined } };
      },
    },
  };
  const fakeSecret = 'sk-metricsSecretLeak9876543210';
  const fakeTokenUrl = 'https://user:pass123@127.0.0.1:4321/api?token=topsecret999';
  const dispatcher = new RpcDispatcher({
    getCdp: () => null,
    telemetrySubsystem: {
      _customMetricsProvider: null,
      _telemetryInFlight: 0,
      isDisabled: () => false,
      beginActivity() { this._telemetryInFlight += 1; },
      endActivity() { this._telemetryInFlight -= 1; },
      releaseIdle() {},
      async ensureMetricsCollector() {
        return async () => {
          throw new Error(`Upstream failed at ${fakeTokenUrl} with Authorization: Bearer ${fakeSecret}`);
        };
      },
    },
  });

  await dispatcher.handleBindingCall(fakeEntry, {
    name: '__agPrismMetricsCall',
    payload: JSON.stringify({ id: 77, input: {} }),
    executionContextId: 1,
  });

  assert.equal(sentExprs.length, 1);
  assert.equal(sentExprs[0].includes(fakeSecret), false, 'metrics catch payload must redact sk-/Bearer secrets');
  assert.equal(sentExprs[0].includes('pass123'), false, 'metrics catch payload must redact URL basic auth');
  assert.equal(sentExprs[0].includes('topsecret999'), false, 'metrics catch payload must redact URL query token');
  let resolvedId = null;
  let resolvedPayload = null;
  vm.runInNewContext(sentExprs[0], {
    window: {
      __agPrismMetricsResolve(id, data) {
        resolvedId = id;
        resolvedPayload = data;
      },
    },
  });
  assert.equal(resolvedId, 77);
  assert.equal(resolvedPayload?.connection, 'offline');
  assert.equal(typeof resolvedPayload?.error, 'string');
  assert.equal(resolvedPayload.error.includes(fakeSecret), false);
  assert.equal(resolvedPayload.error.includes('pass123'), false);
  assert.equal(resolvedPayload.error.includes('topsecret999'), false);
  assert.ok(resolvedPayload.error.includes('https://***@'));
  assert.ok(resolvedPayload.error.includes('<REDACTED>'));
  assert.ok(resolvedPayload.error.includes('***REDACTED***'));
});

test('Session heal: probe timeout backs off without closing live session until 3 consecutive timeouts, then resets on recovery', async () => {
  const logs = [];
  const daemon = makeMinimalDaemon();
  daemon.log = (m) => logs.push(m);
  let shouldTimeout = true;
  let injectCount = 0;
  const { entry } = makeMockEntry({
    evalHandler: async (expr) => {
      if (expr === daemon.injectExpr) {
        injectCount += 1;
        return { status: 'ok' };
      }
      if (shouldTimeout) throw new Error('CDP Runtime.evaluate timeout');
      return {
        ready: true,
        isHostDom: true,
        href: 'vscode-file://vscode-app/workbench.html',
        title: 'Antigravity',
        prismAttr: cdp.PLUGIN_VERSION,
        hasPrism: true,
        hasRepoBridge: true,
        hasThoughtBridge: true,
        hasUsageBridge: true,
        codeHash: daemon.codeHash,
      };
    },
  });
  daemon.sessionRegistry.sessions.set(entry.wsUrl, entry);

  // 1st & 2nd forced timeouts keep session alive and set backoff
  const t1 = await daemon.verifyAndHealEntry(entry, true);
  assert.equal(t1.alive, true);
  assert.equal(t1.timedOut, true);
  assert.equal(entry.session.closed, false);
  assert.equal(daemon.sessionRegistry.sessions.has(entry.wsUrl), true);
  assert.equal(entry.probeTimeoutStreak, 1);

  // Non-forced tick during backoff skips probing completely
  const skipRes = await daemon.verifyAndHealEntry(entry, false);
  assert.equal(skipRes.skipped, true);
  assert.equal(skipRes.timedOut, true);

  // 2nd timeout -> still alive
  const t2 = await daemon.verifyAndHealEntry(entry, true);
  assert.equal(t2.alive, true);
  assert.equal(entry.probeTimeoutStreak, 2);
  assert.equal(entry.session.closed, false);
  assert.equal(injectCount, 0, 'Timeout must not trigger Ch1 reinjection storm');

  // Probe recovers -> streak & backoff reset to 0
  shouldTimeout = false;
  const okRes = await daemon.verifyAndHealEntry(entry, true);
  assert.equal(okRes.alive, true);
  assert.equal(okRes.ready, true);
  assert.equal(entry.probeTimeoutStreak, 0);
  assert.equal(entry.probeTimeoutBackoffUntil, 0);

  // 3 consecutive timeouts -> closes & removes session with explicit log
  shouldTimeout = true;
  await daemon.verifyAndHealEntry(entry, true);
  await daemon.verifyAndHealEntry(entry, true);
  const t3 = await daemon.verifyAndHealEntry(entry, true);
  assert.equal(t3.alive, false);
  assert.equal(entry.session.closed, true);
  assert.equal(daemon.sessionRegistry.sessions.has(entry.wsUrl), false);
  assert.ok(logs.some((l) => l.includes('Health probe timeout (1/3)')));
  assert.ok(logs.some((l) => l.includes('repeated probe timeouts')));
});

test('RelaunchGuard: resetShortcutBackoff(no-port) preserves 5-minute shortcut throttle across 20 ticks', { skip: 'safe build: shortcut rewriting and auto-relaunch removed' }, async () => {
  const { RelaunchGuard } = await import('../src/daemon/relaunch-guard.mjs');
  let syncCalls = 0;
  const logs = [];
  const rg = new RelaunchGuard({
    rootDir: ROOT_DIR,
    noPortRelaunchThresholdMs: 8000,
    shortcutCheckIntervalMs: 300000,
    relaunchHooks: {
      syncShortcuts: async () => {
        syncCalls += 1;
        return { matched: 1, patched: [], skipped: [], alreadySet: ['a.lnk'] };
      },
      detectHost: async () => null,
    },
    isRunning: () => true,
    hasLoopTimer: () => true,
    log: (m) => logs.push(m),
  });

  for (let i = 0; i < 20; i += 1) {
    rg.resetShortcutBackoff('no-port');
    await rg.handleMissingCdpPort();
  }
  assert.equal(syncCalls, 1, '20 consecutive no-port ticks within 5 minutes must sync shortcuts at most once');
  assert.ok(logs.filter((l) => l.includes('Reset shortcut backoff')).length <= 1, 'Must not spam no-port backoff reset logs every tick');
});

test('readCliPollIntervalMs parses valid integer pollIntervalMs within [500, 60000] and rejects invalid values', async () => {
  const { readCliPollIntervalMs } = await import('../src/daemon/index.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-poll-ms-'));
  try {
    assert.equal(readCliPollIntervalMs(tmp), undefined);
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ pollIntervalMs: 3500 }), 'utf8');
    assert.equal(readCliPollIntervalMs(tmp), 3500);
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ pollIntervalMs: 100 }), 'utf8');
    assert.equal(readCliPollIntervalMs(tmp), undefined);
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ pollIntervalMs: 70000 }), 'utf8');
    assert.equal(readCliPollIntervalMs(tmp), undefined);
    fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify({ pollIntervalMs: 1200.5 }), 'utf8');
    assert.equal(readCliPollIntervalMs(tmp), undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
