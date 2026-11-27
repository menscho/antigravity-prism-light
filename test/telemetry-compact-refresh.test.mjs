import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { AntigravityClient } from '../vendor/pulse-dashboard/sidecars/panel/client.mjs';
import { MetricsStore } from '../vendor/pulse-dashboard/sidecars/panel/store.mjs';
import { TrajectoryReader } from '../vendor/pulse-dashboard/sidecars/panel/trajectory-reader.mjs';
import { trajectoryMetrics } from '../vendor/pulse-dashboard/sidecars/panel/metrics.mjs';
import { ensureMetricsCollector } from '../src/daemon/telemetry-cache.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const inlineMod = require(path.join(ROOT, 'vendor', 'pulse-dashboard', 'inline-fallback.js'));

const CID_1 = '11111111-2222-4333-8444-555555555555';
const CID_2 = '22222222-3333-4444-8555-666666666666';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeChatGen(stepIdx, createdIso, usedTokens, maxTokens = 512000, respId = 'r-1') {
  return {
    stepIndices: [stepIdx],
    chatModel: {
      model: 1427,
      modelDisplayName: 'Gemini 4 Carbon (High)',
      responseModel: 'gemini-4-carbon',
      timeToFirstToken: { seconds: 1, nanos: 100000000 },
      streamingDuration: { seconds: 3, nanos: 0 },
      usage: {
        model: 1427,
        inputTokens: '4000',
        outputTokens: '500',
        responseOutputTokens: '350',
        thinkingOutputTokens: '150',
        cacheReadTokens: '28000',
        cacheWriteTokens: '0',
        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
        responseId: respId,
      },
      chatStartMetadata: {
        createdAt: createdIso,
        startStepIndex: Math.max(0, stepIdx - 1),
        contextWindowMetadata: { estimatedTokensUsed: usedTokens, maxContextTokens: maxTokens },
      },
    },
  };
}

function makeTrajectory(cid, {
  status = 'CASCADE_RUN_STATUS_IDLE',
  numTotalSteps = 4,
  usedTokens = 460800,
  maxTokens = 512000,
  createdIso = '2026-11-26T10:00:00.000Z',
  completedIso = '2026-11-26T10:00:05.000Z',
  checkpoint = null,
  cwu = null,
} = {}) {
  const steps = [
    { type: 'CORTEX_STEP_TYPE_USER_INPUT', metadata: { createdAt: createdIso } },
    {
      type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
      metadata: { createdAt: createdIso, completedAt: completedIso },
      plannerResponse: { response: 'ok', toolCalls: [] },
    },
  ];
  if (checkpoint) steps.push(checkpoint);
  return {
    status,
    numTotalSteps,
    numTotalGeneratorMetadata: 1,
    ...(cwu ? { contextWindowUsage: cwu } : {}),
    trajectory: { cascadeId: cid, steps, generatorMetadata: [makeChatGen(1, createdIso, usedTokens, maxTokens)] },
  };
}

function createProxyClient(rendererRpc) {
  const client = new AntigravityClient({ rendererRpc });
  client.server = { mode: 'renderer-proxy', pid: 0, port: 0, csrf: '' };
  client.discoveredAt = client.now();
  return client;
}

// 1. 后端 Renderer-Proxy：freshContext 立即穿透 4.5s store 冷却 + 3.5s client peek 门禁，且 0 次触发配额/会话列表强刷
test('U9 Backend: freshContext bypasses 4.5s store cache & 3.5s client peek gate without forcing quota refresh', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-u9-store-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  let getUserStatusCalls = 0, listConvCalls = 0, peekCalls = 0, getTrajCalls = 0, compacted = false;
  const store = new MetricsStore({
    dataDir: tmpDir,
    rendererRpc: async (method) => {
      if (method === 'GetUserStatus') {
        getUserStatusCalls++;
        return {
          userStatus: {
            cascadeModelConfigData: {
              clientModelConfigs: [{
                label: 'Gemini 4 Carbon (High)',
                modelOrAlias: { model: 'gemini-4-carbon' },
                quotaInfo: { remainingFraction: 0.82, resetTime: '2026-11-26T15:00:00.000Z' },
              }],
            },
          },
        };
      }
      if (method === 'GetAllCascadeTrajectories') {
        listConvCalls++;
        return {
          trajectorySummaries: {
            [CID_1]: {
              cascadeId: CID_1,
              summary: 'Compact test',
              status: 'CASCADE_RUN_STATUS_IDLE',
              stepCount: compacted ? 5 : 4,
              lastModifiedTime: compacted ? '2026-11-26T10:01:00.000Z' : '2026-11-26T10:00:05.000Z',
            },
          },
        };
      }
      if (method === 'PeekContextState') {
        peekCalls++;
        return compacted
          ? {
            status: 'CASCADE_RUN_STATUS_IDLE',
            stepCount: 5,
            lastModifiedTime: '2026-11-26T10:01:00.000Z',
            contextWindowUsage: { estimatedTokensUsed: 26000, maxContextTokens: 512000, estimatedAfterCompaction: true, lastStepIndex: 4 },
          }
          : {
            status: 'CASCADE_RUN_STATUS_IDLE',
            stepCount: 4,
            lastModifiedTime: '2026-11-26T10:00:05.000Z',
            contextWindowUsage: { estimatedTokensUsed: 460800, maxContextTokens: 512000, estimatedAfterCompaction: false, lastStepIndex: 1 },
          };
      }
      if (method === 'GetCascadeTrajectory') {
        getTrajCalls++;
        if (compacted) {
          return makeTrajectory(CID_1, {
            numTotalSteps: 5,
            usedTokens: 460800,
            completedIso: '2026-11-26T10:00:05.000Z',
            checkpoint: {
              type: 'CORTEX_STEP_TYPE_CHECKPOINT',
              status: 'CORTEX_STEP_STATUS_DONE',
              metadata: { createdAt: '2026-11-26T10:01:00.000Z', completedAt: '2026-11-26T10:01:00.000Z' },
              checkpoint: { checkpointIndex: 1, intentOnly: false, summaryTokens: 26000 },
            },
            cwu: { estimatedTokensUsed: 26000, maxContextTokens: 512000, estimatedAfterCompaction: true, lastStepIndex: 4 },
          });
        }
        return makeTrajectory(CID_1, { numTotalSteps: 4, usedTokens: 460800 });
      }
      return null;
    },
  });
  store.client.server = { mode: 'renderer-proxy', pid: 0, port: 0, csrf: '' };
  store.client.discoveredAt = store.client.now();
  t.after(() => store.dispose());

  const snap1 = await store.snapshot({ conversationId: CID_1 });
  assert.equal(snap1.speed.context.usedTokens, 460800);
  const initListCalls = listConvCalls;
  assert.equal(getUserStatusCalls, 1);
  assert.equal(getTrajCalls, 1);

  // 模拟 /compact 在 50ms 后完成（远短于 4.5s store 冷却与 3.5s client peek 门禁）
  compacted = true;
  await sleep(50);

  // 普通 snapshot 仍命中 4.5s 热缓存（空闲 0 额外开销）
  const cachedSnap = await store.snapshot({ conversationId: CID_1, force: false });
  assert.equal(cachedSnap.speed.context.usedTokens, 460800);
  assert.equal(getTrajCalls, 1);

  // freshContext: true 立即击穿 store 4.5s 缓存 + client 3.5s 门禁并回落水位
  const freshSnap = await store.snapshot({ conversationId: CID_1, freshContext: true });
  assert.equal(freshSnap.speed.context.usedTokens, 26000);
  assert.equal(freshSnap.speed.context.compacted, true);
  assert.ok(freshSnap.speed.context.usedFraction < 0.06);
  assert.equal(peekCalls, 1, 'should execute 1 lightweight PeekContextState');
  assert.equal(getTrajCalls, 2, 'should re-fetch trajectory immediately on compaction');
  assert.equal(getUserStatusCalls, 1, 'freshContext must NEVER trigger quota force-refresh');
  assert.equal(listConvCalls, initListCalls, 'freshContext must NEVER force listConversations');
});

// 2. 长对话运行中（>=200 步，20s 动态 TTL）：普通 token 上升原地复用，/compact 或骤降立即击穿
test('U9 Backend: long running conversation (>=200 steps) keeps 20s TTL on normal growth but breaks immediately on compaction or sharp drop', async () => {
  let trajCalls = 0, trajUsed = 380000, trajCwu = null;
  let peekState = {
    status: 'CASCADE_RUN_STATUS_RUNNING',
    stepCount: 220,
    lastModifiedTime: '2026-11-26T10:05:00.000Z',
    contextWindowUsage: { estimatedTokensUsed: 395000, maxContextTokens: 512000, estimatedAfterCompaction: false, lastStepIndex: 219 },
  };
  const client = createProxyClient(async (method) => {
    if (method === 'PeekContextState') return peekState;
    if (method === 'GetCascadeTrajectory') {
      trajCalls++;
      return makeTrajectory(CID_1, { status: peekState.status, numTotalSteps: peekState.stepCount, usedTokens: trajUsed, cwu: trajCwu });
    }
    return null;
  });

  const t1 = await client.trajectory(CID_1);
  assert.equal(trajCalls, 1);
  assert.equal(t1.numTotalSteps, 220);

  // 普通 token 增长（380k -> 395k）原地刷新，不重拉全量轨迹
  const cacheKey = `local::${CID_1.toLowerCase()}`;
  const entry = client._proxyTrajCache.get(cacheKey);
  entry.at = Date.now() - 5000;
  entry.peekAt = Date.now() - 5000;
  const t2 = await client.trajectory(CID_1);
  assert.equal(trajCalls, 1, 'normal token growth must reuse cached trajectory in-place');
  assert.equal(t2.contextWindowUsage.estimatedTokensUsed, 395000);

  // 场景 A：estimatedAfterCompaction=true 立即击穿 20s TTL
  trajUsed = 395000;
  trajCwu = { estimatedTokensUsed: 28000, maxContextTokens: 512000, estimatedAfterCompaction: true, lastStepIndex: 220 };
  peekState = { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 221, lastModifiedTime: '2026-11-26T10:05:08.000Z', contextWindowUsage: trajCwu };
  const t3 = await client.trajectory(CID_1, { freshContext: true });
  assert.equal(trajCalls, 2, 'estimatedAfterCompaction must immediately bust 20s TTL');
  assert.equal(t3.contextWindowUsage.estimatedTokensUsed, 28000);

  // 场景 B：无 estimatedAfterCompaction 布尔值，但 token 骤降 >=30% 且 >=10k -> 同样击穿 20s TTL
  const entry2 = client._proxyTrajCache.get(cacheKey);
  entry2.ctxSig.used = 300000;
  entry2.ctxSig.afterCompact = false;
  entry2.at = Date.now() - 4000;
  entry2.peekAt = Date.now() - 4000;
  trajCwu = { estimatedTokensUsed: 32000, maxContextTokens: 512000, estimatedAfterCompaction: false, lastStepIndex: 221 };
  peekState = { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 222, lastModifiedTime: '2026-11-26T10:05:15.000Z', contextWindowUsage: trajCwu };
  const t4 = await client.trajectory(CID_1);
  assert.equal(trajCalls, 3, 'sharp token drop (>=30% & >=10k) must bust 20s TTL even without freshContext');
  assert.equal(t4.contextWindowUsage.estimatedTokensUsed, 32000);
});

// 3. settled 缓存首次 peekMod 变更 & IDLE -> RUNNING 转换不再被空 peekMod 吞掉
test('U9 Backend: settled cache detects first lastModifiedTime change and IDLE->RUNNING transition', async () => {
  let trajCalls = 0;
  let peekPayload = { status: 'CASCADE_RUN_STATUS_IDLE', stepCount: 4, lastModifiedTime: '2026-11-26T10:00:05.000Z', contextWindowUsage: null };
  const client = createProxyClient(async (method) => {
    if (method === 'PeekContextState') return peekPayload;
    if (method === 'GetCascadeTrajectory') {
      trajCalls++;
      return makeTrajectory(CID_1, { status: peekPayload.status, numTotalSteps: peekPayload.stepCount, completedIso: '2026-11-26T10:00:05.000Z' });
    }
    return null;
  });

  await client.trajectory(CID_1);
  assert.equal(trajCalls, 1);

  peekPayload = { status: 'CASCADE_RUN_STATUS_IDLE', stepCount: 4, lastModifiedTime: '2026-11-26T10:00:20.000Z', contextWindowUsage: null };
  await client.trajectory(CID_1, { freshContext: true });
  assert.equal(trajCalls, 2, 'first peekMod newer than lastStepMs must invalidate settled cache');

  peekPayload = { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 4, lastModifiedTime: '2026-11-26T10:00:20.000Z', contextWindowUsage: null };
  await client.trajectory(CID_1, { freshContext: true });
  assert.equal(trajCalls, 3, 'IDLE -> RUNNING transition must invalidate settled cache');
});

// 4. metrics.mjs cwuSharpDrop 兜底 & 新回合无缝恢复
test('U9 Metrics: cwuSharpDrop recovers context occupancy without estimatedAfterCompaction flag and restores on next chat turn', () => {
  const t0 = '2026-11-26T10:00:00.000Z', t2 = '2026-11-26T10:01:00.000Z';
  const dropped = trajectoryMetrics(makeTrajectory(CID_1, {
    usedTokens: 460800,
    createdIso: t0,
    completedIso: t0,
    cwu: { estimatedTokensUsed: 25600, maxContextTokens: 512000, estimatedAfterCompaction: false, lastStepIndex: 1 },
  }));
  assert.equal(dropped.context.usedTokens, 25600);
  assert.equal(dropped.context.compacted, true);

  const nextTurn = trajectoryMetrics({
    status: 'CASCADE_RUN_STATUS_IDLE',
    numTotalSteps: 4,
    numTotalGeneratorMetadata: 2,
    contextWindowUsage: { estimatedTokensUsed: 25600, maxContextTokens: 512000, estimatedAfterCompaction: false, lastStepIndex: 1 },
    trajectory: {
      cascadeId: CID_1,
      steps: [
        { type: 'CORTEX_STEP_TYPE_USER_INPUT', metadata: { createdAt: t0 } },
        { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { createdAt: t0, completedAt: t0 }, plannerResponse: { response: 'a', toolCalls: [] } },
        { type: 'CORTEX_STEP_TYPE_USER_INPUT', metadata: { createdAt: t2 } },
        { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { createdAt: t2, completedAt: t2 }, plannerResponse: { response: 'b', toolCalls: [] } },
      ],
      generatorMetadata: [makeChatGen(1, t0, 460800, 512000, 'r-1'), makeChatGen(3, t2, 52000, 512000, 'r-2')],
    },
  });
  assert.equal(nextTurn.context.usedTokens, 52000);
  assert.equal(nextTurn.context.compacted, undefined);
});

// 5. HTTP 直连 TrajectoryReader + backgroundOnly 30s 冷却绕过 + 进行中 CHECKPOINT 同步数回退重采
test('U9 HTTP Direct: TrajectoryReader freshContext bypasses 6s/30s summary throttle, rewinds pending CHECKPOINT, and MetricsStore bypasses 30s backgroundOnly cooldown', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-u9-http-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  let summaryCalls = 0, checkpointDone = false, nowMs = 1795600000000;
  const stepsCallOffsets = [];
  const mockClient = {
    now: () => nowMs,
    async discover() { return { pid: 100, port: 43210, csrf: 'tok' }; },
    async call(method, body) {
      if (method === 'GetAllCascadeTrajectories') {
        summaryCalls++;
        return {
          trajectorySummaries: {
            [CID_1]: {
              cascadeId: CID_1,
              stepCount: 4,
              status: checkpointDone ? 'CASCADE_RUN_STATUS_IDLE' : 'CASCADE_RUN_STATUS_RUNNING',
              lastModifiedTime: checkpointDone ? '2026-11-26T10:02:10.000Z' : '2026-11-26T10:02:00.000Z',
            },
          },
        };
      }
      if (method === 'GetCascadeTrajectorySteps') {
        const offset = Number(body?.stepOffset || 0);
        stepsCallOffsets.push(offset);
        const all = [
          { type: 'CORTEX_STEP_TYPE_USER_INPUT', metadata: { createdAt: '2026-11-26T10:00:00.000Z' } },
          { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { createdAt: '2026-11-26T10:00:02.000Z', completedAt: '2026-11-26T10:00:05.000Z' }, plannerResponse: { response: 'hi', toolCalls: [] } },
          {
            type: 'CORTEX_STEP_TYPE_CHECKPOINT',
            status: checkpointDone ? 'CORTEX_STEP_STATUS_DONE' : 'CORTEX_STEP_STATUS_RUNNING',
            metadata: { createdAt: '2026-11-26T10:02:00.000Z', ...(checkpointDone ? { completedAt: '2026-11-26T10:02:10.000Z' } : {}) },
            checkpoint: { checkpointIndex: 1, intentOnly: false, summaryTokens: 18000 },
          },
          { type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', metadata: { createdAt: '2026-11-26T10:02:05.000Z', completedAt: '2026-11-26T10:02:06.000Z' }, plannerResponse: { response: 'next', toolCalls: [] } },
        ];
        return { steps: all.slice(offset), numTotalSteps: all.length };
      }
      if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
        const offset = Number(body?.generatorMetadataOffset || 0);
        // 末条 generatorMetadata 指向 step 3：若无 pending CHECKPOINT 扫描，增量 offset=3 会跳过 step 2
        const all = [makeChatGen(3, '2026-11-26T10:02:05.000Z', 420000)];
        return { generatorMetadata: all.slice(offset), numTotalGeneratorMetadata: all.length };
      }
      return {};
    },
  };

  const reader = new TrajectoryReader(mockClient);
  const r1 = await reader.read(CID_1, { force: false });
  assert.equal(summaryCalls, 1);
  assert.equal(r1.trajectory.steps[2].status, 'CORTEX_STEP_STATUS_RUNNING');

  checkpointDone = true;
  nowMs += 500;
  const r2 = await reader.read(CID_1, { force: false, freshContext: true });
  assert.equal(summaryCalls, 2, 'freshContext must bypass 6s summary cache & 30s force throttle');
  assert.ok(stepsCallOffsets.includes(2), 'pending CHECKPOINT at index 2 must rewind stepOffset from 3 back to 2');
  assert.equal(r2.trajectory.steps[2].status, 'CORTEX_STEP_STATUS_DONE');

  // MetricsStore backgroundOnly 30s 冷却绕过验证
  const bgSummaryFreshArgs = [];
  let bgStarted = 0;
  const bgStore = new MetricsStore({ dataDir: tmpDir });
  t.after(() => bgStore.dispose());
  bgStore.client.server = { pid: 100, port: 43210, csrf: 'tok' };
  bgStore.client.reader.summary = async (_id, _prov, force, freshContext) => {
    bgSummaryFreshArgs.push({ force, freshContext });
    return { stepCount: 1801, lastModifiedTime: '2026-11-26T10:03:00.000Z', status: 'CASCADE_RUN_STATUS_IDLE' };
  };
  bgStore.background = { state: () => ({ state: 'idle' }), request: () => { bgStarted++; return true; }, dispose: () => {} };
  bgStore.sessions.set(CID_1, {
    data: { context: { usedTokens: 450000, maxTokens: 512000, usedFraction: 0.88 } },
    updatedAt: Date.now() - 5000,
    backgroundOnly: true,
    backgroundReady: true,
    backgroundCompletedAt: Date.now() - 1000,
    backgroundCheckedAt: Date.now() - 100,
    backgroundRevision: JSON.stringify([1800, '2026-11-26T10:00:00.000Z', 'CASCADE_RUN_STATUS_IDLE', null]),
    pending: null,
  });

  await bgStore.session(CID_1, false, { freshContext: true });
  assert.equal(bgSummaryFreshArgs.length, 1, 'freshContext must bypass 30s backgroundOnly cooldown');
  assert.equal(bgSummaryFreshArgs[0].freshContext, true);
  assert.equal(bgStarted, 1, 'changed revision under freshContext must immediately restart background refresh');
});

// 6. Daemon telemetry-cache.mjs：向 _lazyStore.snapshot 透传 freshContext 且不误置 force
test('U9 Daemon: ensureMetricsCollector forwards freshContext to _lazyStore.snapshot without escalating force', async () => {
  const received = [];
  const collect = await ensureMetricsCollector({
    _lazyStore: {
      async snapshot(input) {
        received.push(input);
        return { groups: [], speed: { context: { usedTokens: 20000, maxTokens: 512000, usedFraction: 0.04 } } };
      },
    },
  });
  await collect({ conversationId: CID_1, force: false, freshContext: true });
  assert.equal(received.length, 1);
  assert.equal(received[0].freshContext, true);
  assert.equal(received[0].force, false);
  assert.equal(received[0].conversationId, CID_1);
});

// 7 & 8. 前端 inline-fallback.js 完整事件驱动快刷、早停、二次压缩、busy 结束复核、竞态防回滚、mRes 联动与零泄漏
function createCompactMockEnv({ cid = CID_1 } = {}) {
  const winListeners = new Map(), docListeners = new Map(), mos = [];
  const addL = (m, t, f) => { if (!m.has(t)) m.set(t, new Set()); m.get(t).add(f); };
  const remL = (m, t, f) => { m.get(t)?.delete(f); };
  const emitL = (m, t, ev = {}) => { for (const f of [...(m.get(t) || [])]) f({ type: t, ...ev }); };

  function matchSingle(el, part) {
    let s = part.trim();
    if (!s) return false;
    const tagM = s.match(/^[a-zA-Z0-9-]+/);
    if (tagM) { if (el.tagName !== tagM[0].toUpperCase()) return false; s = s.slice(tagM[0].length); }
    for (const m of s.matchAll(/#([a-zA-Z0-9_-]+)/g)) if (el.id !== m[1]) return false;
    for (const m of s.matchAll(/\.([a-zA-Z0-9_-]+)/g)) if (!(el.className || '').split(/\s+/).includes(m[1])) return false;
    for (const m of s.matchAll(/\[([a-zA-Z0-9_-]+)(?:(\^)?=["']?([^"'\]]+)["']?)?\]/g)) {
      if (!el.hasAttribute(m[1])) return false;
      const got = el.getAttribute(m[1]) || '';
      if (m[3] !== undefined && (m[2] === '^' ? !got.startsWith(m[3]) : got !== m[3])) return false;
    }
    return true;
  }

  function matchSel(el, sel) {
    return String(sel).split(',').some((raw) => {
      const parts = raw.trim().split(/\s+/).filter(Boolean);
      if (!parts.length || !matchSingle(el, parts.at(-1))) return false;
      let cur = el.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        let ok = false;
        while (cur) { if (matchSingle(cur, parts[i])) { ok = true; cur = cur.parentElement; break; } cur = cur.parentElement; }
        if (!ok) return false;
      }
      return true;
    });
  }

  const walk = (root, fn) => { for (const c of root.children || []) { fn(c); walk(c, fn); } };
  function mkEl(tag) {
    const attrs = new Map(), styleProps = new Map();
    const style = {
      setProperty(k, v) { styleProps.set(k, String(v)); this[k] = String(v); },
      removeProperty(k) { styleProps.delete(k); delete this[k]; },
    };
    const el = {
      nodeType: 1, tagName: String(tag).toUpperCase(), children: [], parentNode: null, parentElement: null,
      shadowRoot: null, isConnected: true, textContent: '', value: undefined, hidden: false, style,
      get id() { return attrs.get('id') || ''; },
      set id(v) { if (v) attrs.set('id', String(v)); else attrs.delete('id'); },
      get className() { return attrs.get('class') || ''; },
      set className(v) { attrs.set('class', String(v || '')); },
      get firstElementChild() { return el.children[0] || null; },
      setAttribute(k, v) { attrs.set(k, String(v)); if (k === 'hidden') el.hidden = true; },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); if (k === 'hidden') el.hidden = false; },
      appendChild(c) {
        if (c.parentNode) c.remove();
        c.parentNode = el; c.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el; c.isConnected = el.isConnected;
        el.children.push(c); return c;
      },
      insertBefore(c, ref) {
        if (!ref) return el.appendChild(c);
        const i = el.children.indexOf(ref);
        if (i < 0) return el.appendChild(c);
        if (c.parentNode) c.remove();
        c.parentNode = el; c.parentElement = el.tagName === '#SHADOW-ROOT' ? null : el; c.isConnected = el.isConnected;
        el.children.splice(i, 0, c); return c;
      },
      remove() {
        if (el.parentNode) {
          const i = el.parentNode.children.indexOf(el);
          if (i >= 0) el.parentNode.children.splice(i, 1);
          el.parentNode = el.parentElement = null;
        }
        el.isConnected = false;
      },
      contains(n) { let cur = n; while (cur) { if (cur === el) return true; cur = cur.parentNode || cur.parentElement; } return false; },
      matches: (s) => matchSel(el, s),
      closest(s) { let cur = el; while (cur) { if (matchSel(cur, s)) return cur; cur = cur.parentElement; } return null; },
      querySelector(s) { let hit = null; walk(el, (c) => { if (!hit && matchSel(c, s)) hit = c; }); return hit; },
      querySelectorAll(s) { const out = []; walk(el, (c) => { if (matchSel(c, s)) out.push(c); }); return out; },
      getElementById(id) { let hit = null; walk(el, (c) => { if (!hit && c.id === id) hit = c; }); return hit; },
      attachShadow() { const sr = mkEl('#SHADOW-ROOT'); el.shadowRoot = sr; return sr; },
      addEventListener() {}, removeEventListener() {},
      getBoundingClientRect: () => ({ width: 960, height: 32 }),
    };
    return el;
  }

  const documentElement = mkEl('html'), body = mkEl('body'), conv = mkEl('div'), inputBox = mkEl('div'), editor = mkEl('div'), footer = mkEl('div'), sendBtn = mkEl('button');
  documentElement.appendChild(body);
  conv.setAttribute('data-testid', 'conversation-view'); conv.setAttribute('data-cascade-id', cid);
  inputBox.setAttribute('data-testid', 'agent-input-box');
  editor.setAttribute('contenteditable', 'true');
  footer.className = 'agy-composer-footer';
  sendBtn.setAttribute('data-testid', 'input-send-button');
  footer.appendChild(sendBtn); inputBox.appendChild(editor); inputBox.appendChild(footer); conv.appendChild(inputBox); body.appendChild(conv);

  const slashMenu = mkEl('div'), slashCompactOpt = mkEl('div');
  slashMenu.setAttribute('role', 'listbox');
  slashCompactOpt.id = 'typeahead-item-0'; slashCompactOpt.setAttribute('role', 'option');
  slashCompactOpt.textContent = '/compact Summarize conversation context';
  slashMenu.appendChild(slashCompactOpt); body.appendChild(slashMenu);

  const document = {
    hidden: false, documentElement, body, activeElement: editor, createElement: mkEl,
    querySelector: (s) => documentElement.querySelector(s),
    querySelectorAll: (s) => documentElement.querySelectorAll(s),
    getElementById: (id) => documentElement.getElementById(id),
    addEventListener: (t, f) => addL(docListeners, t, f),
    removeEventListener: (t, f) => remL(docListeners, t, f),
  };
  class MockMutationObserver {
    constructor(cb) { this.cb = cb; this.active = false; this.target = null; mos.push(this); }
    observe(target) { this.active = true; this.target = target; }
    disconnect() { this.active = false; }
    trigger(recs = [{ type: 'childList', target: footer, addedNodes: [], removedNodes: [] }]) { if (this.active) this.cb(recs); }
  }
  const window = {
    document,
    location: { href: `https://local/c/${cid}`, pathname: `/c/${cid}`, hash: '' },
    history: { pushState() {}, replaceState() {} },
    navigator: { language: 'zh-CN', languages: ['zh-CN'] },
    MutationObserver: MockMutationObserver,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    cancelAnimationFrame() {},
    addEventListener: (t, f) => addL(winListeners, t, f),
    removeEventListener: (t, f) => remL(winListeners, t, f),
  };
  return {
    window, document, body, footer, editor, sendBtn, slashCompactOpt, mkEl, mos, winListeners, docListeners,
    emitWin: (t, ev) => emitL(winListeners, t, ev),
    emitDoc: (t, ev) => emitL(docListeners, t, ev),
  };
}

function makeSnap(usedTokens, { maxTokens = 512000, compacted = false, sampledAt = new Date().toISOString() } = {}) {
  return {
    connection: 'renderer-proxy',
    groups: [{ id: 'gemini', name: 'Gemini', windows: { '5h': { remaining: 0.85 } } }],
    speed: {
      model: 'Gemini 4 Carbon (High)', rounds: 6, tps: 55.2, latestTps: 60.1, ttftSeconds: 1.1, cacheHitRate: 0.88,
      context: { model: 'Gemini 4 Carbon (High)', usedTokens, maxTokens, usedFraction: usedTokens / maxTokens, compacted, sampledAt },
    },
  };
}

test('U9 Frontend: /compact Enter, send click, slash option & Stop-button removal trigger fast freshContext refresh and auto-stop on drop (incl. second /compact)', async () => {
  const env = createCompactMockEnv({ cid: CID_1 });
  const calls = [];
  let currentSnap = makeSnap(460800, { compacted: false, sampledAt: '2026-11-26T10:00:00.000Z' });
  let freshCount = 0;

  env.window.__agPrismMetricsCall = (raw) => {
    const { id, input } = JSON.parse(raw);
    calls.push(input);
    if (input.freshContext) {
      freshCount++;
      if (freshCount === 2) currentSnap = makeSnap(25600, { compacted: true, sampledAt: '2026-11-26T10:00:02.000Z' });
      if (freshCount === 3) currentSnap = makeSnap(153600, { compacted: true, sampledAt: '2026-11-26T10:01:01.000Z' });
      if (freshCount === 4) currentSnap = makeSnap(30720, { compacted: true, sampledAt: '2026-11-26T10:01:02.000Z' });
    }
    queueMicrotask(() => env.window.__agPrismMetricsResolve(id, currentSnap));
  };

  const ctl = inlineMod.createTelemetryController({ window: env.window, document: env.document });
  ctl.sync({ telemetryModule: 'on', language: 'zh-CN' });
  await sleep(30);
  const bar = ctl.getPrimaryBar();
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '90%');

  // 1) Enter 提交 /compact：~1.2s 内回落至 5% 并自动早停
  env.editor.textContent = '/compact';
  env.emitDoc('keydown', { key: 'Enter', target: env.editor });
  await sleep(1300);
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '5%');
  assert.equal(freshCount, 2, 'burst must auto-stop immediately after compacted drop');
  await sleep(1050);
  assert.equal(freshCount, 2, 'no extra freshContext polling after auto-stop');

  // 2) 二次 /compact（基准已为 compacted=true、30%）不得因 sampledAt 变化误早停
  currentSnap = makeSnap(153600, { compacted: true, sampledAt: '2026-11-26T10:01:00.000Z' });
  await ctl.refresh({ immediate: true });
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '30%');
  ctl.notifyCompact(CID_1, [40, 50, 80, 100]);
  await sleep(160);
  assert.equal(freshCount, 4, 'second /compact must NOT prematurely stop before tokens drop');
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '6%');

  // 3) 点击发送按钮 & 斜杠菜单 /compact
  const beforeSend = freshCount;
  env.editor.textContent = '/compact';
  env.emitDoc('click', { target: env.sendBtn });
  await sleep(520);
  assert.ok(freshCount > beforeSend, 'clicking send button with /compact must trigger burst');

  const beforeSlash = freshCount;
  env.emitDoc('click', { target: env.slashCompactOpt });
  await sleep(780);
  assert.ok(freshCount > beforeSlash, 'clicking slash /compact option must trigger burst');

  // 4) Stop/Cancel 按钮消失（wasBusy -> !nowBusy）自动触发 180ms 快速复核
  currentSnap = makeSnap(435200, { compacted: false, sampledAt: '2026-11-26T10:02:00.000Z' });
  await ctl.refresh({ immediate: true });
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '85%');

  const stopBtn = env.mkEl('button');
  stopBtn.setAttribute('data-testid', 'input-cancel-button');
  env.footer.appendChild(stopBtn);
  const seatMo = env.mos.find((m) => m.active && m.target === env.body);
  seatMo.trigger([{ type: 'childList', target: env.footer, addedNodes: [stopBtn], removedNodes: [] }]);

  currentSnap = makeSnap(35840, { compacted: true, sampledAt: '2026-11-26T10:02:02.000Z' });
  stopBtn.remove();
  const beforeBusyDone = freshCount;
  seatMo.trigger([{ type: 'childList', target: env.footer, addedNodes: [], removedNodes: [stopBtn] }]);
  await sleep(260);
  assert.ok(freshCount > beforeBusyDone, 'busy->idle transition must trigger fast freshContext recheck');
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '7%');
  assert.ok(calls.filter((c) => c.freshContext).every((c) => c.force === false), 'freshContext bursts must never set force=true');

  ctl.destroy();
});

test('U9 Frontend: reqGen prevents stale slow poll rollback, mRes syncs UI immediately without cross-session bleed, blur suspends burst & destroy leaks 0 listeners', async () => {
  const env = createCompactMockEnv({ cid: CID_1 });
  const resolvers = [];
  let burstCalls = 0;
  env.window.__agPrismMetricsCall = (raw) => {
    const { id, input } = JSON.parse(raw);
    if (input.freshContext) burstCalls++;
    resolvers.push({ id, input, resolve: (snap) => env.window.__agPrismMetricsResolve(id, snap) });
  };

  const ctl = inlineMod.createTelemetryController({ window: env.window, document: env.document });
  ctl.sync({ telemetryModule: 'on', language: 'zh-CN' });
  resolvers.shift().resolve(makeSnap(450560, { sampledAt: '2026-11-26T10:00:00.000Z' }));
  await sleep(10);
  const bar = ctl.getPrimaryBar();
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '88%');

  // 1) 竞态防回滚：慢普通请求晚于 freshContext 快刷到达，reqGen 丢弃 88% 旧包
  const slowP = ctl.refresh({ immediate: true });
  const fastP = ctl.refresh({ immediate: true, freshContext: true });
  assert.equal(resolvers.length, 2, 'freshContext must bypass normal in-flight single-flight dedupe');
  const [slowReq, fastReq] = [resolvers.shift(), resolvers.shift()];
  fastReq.resolve(makeSnap(25600, { compacted: true, sampledAt: '2026-11-26T10:00:05.000Z' }));
  await fastP;
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '5%');
  slowReq.resolve(makeSnap(450560, { compacted: false, sampledAt: '2026-11-26T10:00:01.000Z' }));
  await slowP;
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '5%');

  // 2) mRes 跨桥即时同步渲染 + 防旧 sampledAt 回滚 + 防跨会话串台
  const pNew = env.window.agPulseHost.getMetrics({ conversationId: CID_1 });
  resolvers.shift().resolve(makeSnap(20480, { compacted: true, sampledAt: '2026-11-26T10:00:06.000Z' }));
  await pNew;
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '4%');

  const pOld = env.window.agPulseHost.getMetrics({ conversationId: CID_1 });
  resolvers.shift().resolve(makeSnap(400000, { compacted: false, sampledAt: '2026-11-26T10:00:02.000Z' }));
  await pOld;
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '4%');

  const pOther = env.window.agPulseHost.getMetrics({ conversationId: CID_2 });
  resolvers.shift().resolve(makeSnap(358400, { compacted: false, sampledAt: '2026-11-26T10:00:09.000Z' }));
  await pOther;
  assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '4%');

  // 3) 失焦/隐藏 0 后台开销 & destroy() 100% 清理监听器
  const beforeBlur = burstCalls;
  ctl.notifyCompact(CID_1, [60, 60]);
  env.emitWin('blur');
  await sleep(140);
  assert.equal(burstCalls, beforeBlur, 'active burst must cancel immediately on window blur');
  assert.equal(ctl.notifyCompact(CID_1, [30]), false, 'notifyCompact must no-op while blurred');

  ctl.destroy();
  assert.equal([...env.winListeners.values()].reduce((a, s) => a + s.size, 0), 0);
  assert.equal([...env.docListeners.values()].reduce((a, s) => a + s.size, 0), 0);
});

test('U9 Frontend: burstGen prevents same-session re-arm race (no early-clear or parallel timer chains) & isStaleResult never pollutes snapByCid', async () => {
  const env = createCompactMockEnv({ cid: CID_1 });
  const pending = [];
  let freshCalls = 0;
  env.window.__agPrismMetricsCall = (raw) => {
    const { id, input } = JSON.parse(raw);
    if (input.freshContext) freshCalls++;
    pending.push({ id, input, resolve: (snap) => env.window.__agPrismMetricsResolve(id, snap) });
  };

  const ctl = inlineMod.createTelemetryController({ window: env.window, document: env.document });
  try {
    ctl.sync({ telemetryModule: 'on', language: 'zh-CN' });
    pending.shift().resolve(makeSnap(450560, { compacted: false, sampledAt: '2026-11-26T10:00:00.000Z' }));
    await sleep(10);
    const bar = ctl.getPrimaryBar();
    const conv = env.document.querySelector('[data-testid="conversation-view"]');
    assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '88%');

    // 1) 同会话二次 armCompactBurst：旧代际在途请求返回“已压缩”结果绝不能误清第 2 代际定时链
    ctl.notifyCompact(CID_1, [20, 40, 40]);
    await sleep(35);
    assert.equal(freshCalls, 1, 'gen-1 first tick should be in-flight');
    const gen1Req = pending.shift();

    // 在 gen-1 请求挂起期间，同会话触发第 2 次 burst（burstGen 递增）
    ctl.notifyCompact(CID_1, [45, 50]);
    // gen-1 返回已压缩快照（若无 burstGen 校验，将命中 isCompactedDrop 并误调 clrBurst() 清掉 gen-2！）
    gen1Req.resolve(makeSnap(25600, { compacted: true, sampledAt: '2026-11-26T10:00:02.000Z' }));
    await sleep(70);
    assert.equal(freshCalls, 2, 'gen-1 compacted reply must NOT clear gen-2 burst timer');

    // 2) 同会话再次重装：旧代际在途请求返回未压缩结果绝不能启动并行第二条定时链
    const gen2Req = pending.shift();
    ctl.notifyCompact(CID_1, [80, 200]);
    // gen-2 返回未压缩快照（若无 burstGen 校验，将继续 stTm(tick, ...) 形成并行定时链！）
    gen2Req.resolve(makeSnap(450560, { compacted: false, sampledAt: '2026-11-26T10:00:01.000Z' }));
    await sleep(110);
    assert.equal(freshCalls, 3, 'gen-2 stale reply must NOT spawn a parallel timer chain');
    // 清理 gen-3 在途请求并让其早停
    pending.shift().resolve(makeSnap(25600, { compacted: true, sampledAt: '2026-11-26T10:00:05.000Z' }));
    await sleep(30);
    assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '5%');

    // 3) isStaleResult 拦截过期回包时直接返回，绝不写回 snapByCid（含 groups=[] 与 groups=[...] 两种形态）
    const slowP1 = ctl.refresh({ immediate: true });
    const fastP1 = ctl.refresh({ immediate: true, freshContext: true });
    const slowReq1 = pending.shift();
    const fastReq1 = pending.shift();
    fastReq1.resolve(makeSnap(20480, { compacted: true, sampledAt: '2026-11-26T10:00:10.000Z' }));
    await fastP1;
    assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '4%');

    // 过期慢回包携带 groups: []（绕过 mRes L253）直达 L712 isStaleResult，不得污染 snapByCid
    slowReq1.resolve({
      connection: 'renderer-proxy',
      groups: [],
      speed: {
        model: 'Gemini 4 Carbon (High)',
        context: { model: 'Gemini 4 Carbon (High)', usedTokens: 450560, maxTokens: 512000, usedFraction: 0.88, compacted: false, sampledAt: '2026-11-26T10:00:09.000Z' },
      },
    });
    await slowP1;
    assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '4%');
    assert.equal(ctl.getSnapshotForBar(CID_1)?.speed?.context?.usedTokens, 20480, 'stale reply (groups=[]) must NOT overwrite snapByCid');

    // 过期慢回包携带 groups=[...] 且较旧 sampledAt，同样不得污染 snapByCid
    const slowP2 = ctl.refresh({ immediate: true });
    const fastP2 = ctl.refresh({ immediate: true, freshContext: true });
    const slowReq2 = pending.shift();
    const fastReq2 = pending.shift();
    fastReq2.resolve(makeSnap(25600, { compacted: true, sampledAt: '2026-11-26T10:00:15.000Z' }));
    await fastP2;
    slowReq2.resolve(makeSnap(440320, { compacted: false, sampledAt: '2026-11-26T10:00:12.000Z' }));
    await slowP2;
    assert.equal(ctl.getSnapshotForBar(CID_1)?.speed?.context?.usedTokens, 25600, 'stale reply (older sampledAt) must NOT overwrite snapByCid');

    // 切到 CID_2 再切回 CID_1：0ms 瞬显必须保持 5%，绝不短暂闪回 86%/88% 旧值
    conv.setAttribute('data-cascade-id', CID_2);
    env.window.location.pathname = `/c/${CID_2}`;
    env.window.location.href = `https://local/c/${CID_2}`;
    env.emitWin('popstate');
    conv.setAttribute('data-cascade-id', CID_1);
    env.window.location.pathname = `/c/${CID_1}`;
    env.window.location.href = `https://local/c/${CID_1}`;
    env.emitWin('popstate');
    assert.equal(bar.shadowRoot.getElementById('context-percent').textContent, '5%', 'returning to CID_1 must render 5% from LRU without flashing stale value');
  } finally {
    ctl.destroy();
  }
});
