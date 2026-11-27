import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  PrismDaemon,
  isSameSpaDocumentRoute,
  writeFileAtomicAsync,
  formatJsonArgForEval,
  evalRendererRpcOnEntry,
} from '../src/daemon/index.mjs';
import {
  buildRendererRpcExpression,
  buildRendererRpcCallExpression,
  RENDERER_RPC_DISPATCHER_VERSION,
} from '../vendor/pulse-dashboard/sidecars/panel/renderer-rpc-adapter.mjs';
import { AntigravityClient } from '../vendor/pulse-dashboard/sidecars/panel/client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CID_A = '11111111-1111-4111-8111-111111111111';

function mkTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('Renderer RPC adapter: versioned dispatcher cache shrinks hot CDP payload >99%, enforces allowlist/GUID/escape, uses O(1) BFS & heals on wipe/version mismatch', async () => {
  // 1) Payload size comparison & security validation
  const fullProbeExpr = buildRendererRpcExpression('Probe', {});
  const fastProbeExpr = buildRendererRpcCallExpression('Probe', {});
  const fullBytes = Buffer.byteLength(fullProbeExpr, 'utf8');
  const fastBytes = Buffer.byteLength(fastProbeExpr, 'utf8');

  assert.match(RENDERER_RPC_DISPATCHER_VERSION, /^[0-9a-f]{12}$/);
  assert.ok(fullBytes > 30000, `Expected full installer payload > 30 KB, got ${fullBytes}`);
  assert.ok(fastBytes < 350, `Expected hot cached call payload < 350 B, got ${fastBytes}`);
  assert.ok(fastBytes / fullBytes < 0.01, `Expected >99% payload reduction (${fullBytes} -> ${fastBytes})`);
  assert.equal(fullProbeExpr.includes('q.shift()'), false, 'React Fiber BFS must use O(1) cursor instead of Array.shift()');

  assert.throws(() => buildRendererRpcCallExpression('SendUserCascadeMessage', {}), /Unsupported renderer RPC/);
  assert.throws(() => buildRendererRpcCallExpression('GetCascadeTrajectory', { cascadeId: '../evil' }), /Invalid cascadeId/);
  assert.throws(() => buildRendererRpcCallExpression('PeekContextState', { cascadeId: "');alert(1)//" }), /Invalid cascadeId/);

  // 2) Deep Fiber tree (25+ nodes across child/sibling branches) verifies O(1) BFS cursor finds LS & AgentMgr
  const fakeLs = {
    getUserStatus: async () => ({ userStatus: { email: 'rpc@test.local' } }),
    getCascadeTrajectory: async () => ({ status: 1, numTotalSteps: 2, trajectory: { steps: [], generatorMetadata: [] } }),
  };
  const fakeAgentMgr = {
    peek: () => ({ getState: () => ({ status: 1, trajectorySlice: { totalStepsLength: 2 } }) }),
    getAgentStates: () => new Map(),
  };
  let leaf = { memoizedProps: { value: fakeLs }, child: null, sibling: { memoizedProps: { value: fakeAgentMgr }, child: null, sibling: null } };
  for (let i = 0; i < 25; i += 1) {
    leaf = { memoizedProps: {}, child: leaf, sibling: { memoizedProps: {}, child: null, sibling: null } };
  }
  const fakeRoot = { __reactFiber$deep: leaf };

  let busyQsCalls = 0;
  let busyQsaCalls = 0;
  let busyMode = 'idle';
  const hiddenBusyEl = { hidden: true, style: { display: 'none' } };
  const visibleBusyEl = { hidden: false, style: {} };

  const vmSandbox = {
    document: {
      getElementById: (id) => (id === 'root' ? fakeRoot : null),
      querySelector: (sel) => {
        if (String(sel || '').includes('data-ag-sub-running')) {
          busyQsCalls += 1;
          if (busyMode === 'idle') return null;
          if (busyMode === 'first-visible') return visibleBusyEl;
          if (busyMode === 'second-visible') return hiddenBusyEl;
        }
        return null;
      },
      querySelectorAll: (sel) => {
        if (String(sel || '').includes('data-ag-sub-running')) {
          busyQsaCalls += 1;
          if (busyMode === 'second-visible') return [hiddenBusyEl, visibleBusyEl];
        }
        return [];
      },
    },
    WeakRef: globalThis.WeakRef,
    Promise,
  };
  vmSandbox.window = vmSandbox;
  vmSandbox.globalThis = vmSandbox;
  vm.createContext(vmSandbox);

  // Cold fast-call before install returns needInstall
  const beforeInstall = await vm.runInContext(fastProbeExpr, vmSandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(beforeInstall)), { ok: false, needInstall: true });

  // Full install sets non-enumerable versioned dispatcher and resolves via O(1) BFS
  const installed = await vm.runInContext(fullProbeExpr, vmSandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(installed)), { ok: true, data: { available: true } });
  assert.equal(vmSandbox.__agPrismRendererRpc.__v, RENDERER_RPC_DISPATCHER_VERSION);
  assert.equal(Object.keys(vmSandbox).includes('__agPrismRendererRpc'), false, 'Dispatcher must be non-enumerable');

  // Hot call executes with tiny payload
  const hotHit = await vm.runInContext(fastProbeExpr, vmSandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(hotHit)), { ok: true, data: { available: true } });

  // CheckHostIdleState: idle performs 1 querySelector & 0 querySelectorAll; hidden first match falls back to querySelectorAll
  busyQsCalls = 0;
  busyQsaCalls = 0;
  busyMode = 'idle';
  const idleRes = await vm.runInContext(buildRendererRpcCallExpression('CheckHostIdleState', {}), vmSandbox);
  assert.equal(idleRes.ok, true);
  assert.equal(idleRes.data.idle, true);
  assert.equal(busyQsCalls, 1);
  assert.equal(busyQsaCalls, 0);

  busyQsCalls = 0;
  busyQsaCalls = 0;
  busyMode = 'second-visible';
  const busyRes = await vm.runInContext(buildRendererRpcCallExpression('CheckHostIdleState', {}), vmSandbox);
  assert.equal(busyRes.ok, true);
  assert.equal(busyRes.data.idle, false);
  assert.equal(busyRes.data.domBusy, true);
  assert.equal(busyQsCalls, 1);
  assert.equal(busyQsaCalls, 1);

  // evalRendererRpcOnEntry: cold install -> hot call -> self-heal on delete -> self-heal on stale __v -> self-heal on docGen bump
  const sentExprs = [];
  const mockEntry = {
    sidebarDocument: 0,
    _rendererRpcInstalledDocGen: -1,
    session: {
      closed: false,
      async evaluate(expr) {
        sentExprs.push(expr);
        return vm.runInContext(expr, vmSandbox);
      },
      async send(method, params) {
        if (method === 'Runtime.evaluate') {
          sentExprs.push(params.expression);
          return { result: { value: await vm.runInContext(params.expression, vmSandbox) } };
        }
        return {};
      },
    },
  };

  vm.runInContext('delete globalThis.__agPrismRendererRpc', vmSandbox);
  const r1 = await evalRendererRpcOnEntry(mockEntry, 'Probe', {}, 2000);
  const r2 = await evalRendererRpcOnEntry(mockEntry, 'Probe', {}, 2000);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.ok(sentExprs[0].length > 30000, 'First call must install full dispatcher');
  assert.ok(sentExprs[1].length < 350, 'Second call on same docGen must send tiny cached payload');

  // Context wipe without docGen bump
  vm.runInContext('delete globalThis.__agPrismRendererRpc', vmSandbox);
  const r3 = await evalRendererRpcOnEntry(mockEntry, 'Probe', {}, 2000, { useSend: true });
  assert.equal(r3.ok, true);
  assert.ok(sentExprs[2].length < 350 && sentExprs[3].length > 30000, 'Missing dispatcher must trigger needInstall fallback & self-heal');

  // Version mismatch on existing global dispatcher
  vm.runInContext('globalThis.__agPrismRendererRpc.__v = "outdated0000"', vmSandbox);
  const r4 = await evalRendererRpcOnEntry(mockEntry, 'Probe', {}, 2000);
  assert.equal(r4.ok, true);
  assert.ok(sentExprs[4].length < 350 && sentExprs[5].length > 30000, 'Version mismatch must auto-reinstall latest dispatcher');
  assert.equal(vmSandbox.__agPrismRendererRpc.__v, RENDERER_RPC_DISPATCHER_VERSION);

  // Navigation bumps sidebarDocument -> directly reinstalls without wasted needInstall probe
  mockEntry.sidebarDocument = 1;
  const r5 = await evalRendererRpcOnEntry(mockEntry, 'Probe', {}, 2000);
  const r6 = await evalRendererRpcOnEntry(mockEntry, 'Probe', {}, 2000);
  assert.equal(r5.ok, true);
  assert.equal(r6.ok, true);
  assert.ok(sentExprs[6].length > 30000 && sentExprs[7].length < 350);
});

test('Daemon RPC fast-path: >4 KiB payloads wrap with JSON.parse, <=4 KiB stay literal, inject.js parity & fire-and-forget semantics preserved', async () => {
  const smallObj = { ok: true, note: 'small' };
  const smallExpr = formatJsonArgForEval(smallObj);
  assert.equal(smallExpr.includes('JSON.parse('), false, '<=4 KiB payload must avoid JSON.parse overhead');

  const bigObj = { ok: true, html: '</script><img src=x>', sep: '\u2028\u2029', pad: 'x'.repeat(5000) };
  const bigExpr = formatJsonArgForEval(bigObj);
  assert.ok(bigExpr.startsWith('JSON.parse('), '>4 KiB payload must wrap in JSON.parse(...)');
  assert.equal(bigExpr.includes('</script>'), false, 'HTML/script delimiters must remain escaped');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(`(${bigExpr})`, {}))), bigObj);

  const daemon = new PrismDaemon({
    rootDir: ROOT,
    bundleCachePath: false,
    enableAutoUpdateTimer: false,
    enableStorageGuardTimer: false,
    silent: true,
  });
  try {
    const sentParams = [];
    const bindingEntry = {
      wsUrl: 'ws://127.0.0.1:9999/page/bind',
      pageId: 'page-bind',
      mainFrameId: 'F1',
      sidebarHostVerified: true,
      sidebarDocument: 0,
      sidebarVerifiedDocument: 0,
      sidebarHostContextId: 1,
      contextFrames: new Map([[1, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
      session: {
        closed: false,
        async send(method, params) {
          if (method === 'Runtime.evaluate') sentParams.push(params);
          return { result: { value: true } };
        },
      },
    };
    const bigMetrics = { connection: 'live', speed: { note: 'm'.repeat(6000) }, groups: [] };
    daemon._customMetricsProvider = async () => bigMetrics;
    await daemon.handleBindingCall(bindingEntry, {
      name: '__agPrismMetricsCall',
      payload: JSON.stringify({ id: 9, input: {} }),
      executionContextId: 1,
    });
    assert.equal(sentParams.length, 1);
    assert.equal(sentParams[0].returnByValue, false);
    assert.equal(sentParams[0].awaitPromise, false);
    assert.ok(sentParams[0].expression.endsWith(';void 0'));
    assert.ok(sentParams[0].expression.includes('JSON.parse('), 'Large METRICS_BINDING reply must use JSON.parse fast-path');
    let gotMetrics = null;
    vm.runInNewContext(sentParams[0].expression, {
      window: { __agPrismMetricsResolve: (_id, data) => { gotMetrics = data; } },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(gotMetrics)), bigMetrics);

    // inject.js parity check
    const injectSrc = fs.readFileSync(path.join(ROOT, 'inject.js'), 'utf8');
    assert.ok(injectSrc.includes('formatJsonArgForEval'), 'inject.js must define formatJsonArgForEval');
    assert.ok(injectSrc.includes('window.__agPrismInlineDiffResolve?.(${reqId}, ${formatJsonArgForEval(resp)})'));
  } finally {
    await daemon.stop(false, { skipAutoArchive: true });
  }
});

test('Async atomic write & usage disk cache: symlink guard, 0o600 mode, epoch preemption anti-race & mid-flight dirty drain', async () => {
  const tmpDir = mkTempDir('prism-async-atomic-');
  const origChmod = fs.promises.chmod;
  try {
    // 1) writeFileAtomicAsync rejects symlink target
    const realFile = path.join(tmpDir, 'real.json');
    const linkFile = path.join(tmpDir, 'link.json');
    fs.writeFileSync(realFile, '{}', 'utf8');
    let symlinkCreated = false;
    try {
      fs.symlinkSync(realFile, linkFile);
      symlinkCreated = true;
    } catch {
      // Windows without Developer Mode may forbid symlink creation
    }
    if (symlinkCreated) {
      await assert.rejects(() => writeFileAtomicAsync(linkFile, '{"a":1}', { mode: 0o600 }), /Refusing symbolic link/);
    }

    // 2) Usage disk cache async flush, sync epoch preemption & mid-flight dirty drain
    const usageCachePath = path.join(tmpDir, 'usage-cache.json');
    const daemon = new PrismDaemon({
      rootDir: ROOT,
      usageCachePath,
      bundleCachePath: false,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
      silent: true,
    });
    try {
      daemon._putUsageDiskCache(
        CID_A,
        5,
        1763620000,
        { cascadeId: CID_A, stepCount: 5, lastModifiedSec: 1763620000, days: { '2026-11-27': { calls: 1, total: 1000 } } },
        'local'
      );
      await daemon._flushUsageDiskCacheAsync();
      assert.equal(JSON.parse(fs.readFileSync(usageCachePath, 'utf8')).scopes.local[CID_A].stepCount, 5);

      // Pause stale async flush before rename, preempt with sync flush
      let releasePause = null;
      let reachedPause = null;
      const pausedOnce = new Promise((r) => { reachedPause = r; });
      let armPause = true;
      fs.promises.chmod = async (target, mode) => {
        if (armPause && String(target).includes('usage-cache.json') && String(target).endsWith('.tmp')) {
          armPause = false;
          reachedPause();
          await new Promise((r) => { releasePause = r; });
        }
        return origChmod.call(fs.promises, target, mode);
      };
      daemon._putUsageDiskCache(
        CID_A,
        10,
        1763620010,
        { cascadeId: CID_A, stepCount: 10, lastModifiedSec: 1763620010, days: { '2026-11-27': { calls: 2, total: 2000 } } },
        'local'
      );
      const staleAsync = daemon._flushUsageDiskCacheAsync();
      await pausedOnce;
      daemon._putUsageDiskCache(
        CID_A,
        99,
        1763620099,
        { cascadeId: CID_A, stepCount: 99, lastModifiedSec: 1763620099, days: { '2026-11-27': { calls: 9, total: 9000 } } },
        'local'
      );
      daemon._flushUsageDiskCache();
      assert.equal(JSON.parse(fs.readFileSync(usageCachePath, 'utf8')).scopes.local[CID_A].stepCount, 99);
      releasePause();
      await staleAsync;
      assert.equal(JSON.parse(fs.readFileSync(usageCachePath, 'utf8')).scopes.local[CID_A].stepCount, 99, 'Aborted stale async flush must never overwrite newer sync write');
      assert.equal(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp')).length, 0, 'Aborted async flush must clean up temp file');

      // Queued dirty write mid-flight drains cleanly even when daemon.running === false
      let releasePause2 = null;
      let reachedPause2 = null;
      const pausedTwice = new Promise((r) => { reachedPause2 = r; });
      let armPause2 = true;
      fs.promises.chmod = async (target, mode) => {
        if (armPause2 && String(target).includes('usage-cache.json') && String(target).endsWith('.tmp')) {
          armPause2 = false;
          reachedPause2();
          await new Promise((r) => { releasePause2 = r; });
        }
        return origChmod.call(fs.promises, target, mode);
      };
      daemon._putUsageDiskCache(
        CID_A,
        101,
        1763620101,
        { cascadeId: CID_A, stepCount: 101, lastModifiedSec: 1763620101, days: { '2026-11-27': { calls: 10, total: 10000 } } },
        'local'
      );
      const firstFlush = daemon._flushUsageDiskCacheAsync();
      await pausedTwice;
      daemon._putUsageDiskCache(
        CID_A,
        202,
        1763620202,
        { cascadeId: CID_A, stepCount: 202, lastModifiedSec: 1763620202, days: { '2026-11-27': { calls: 20, total: 20000 } } },
        'local'
      );
      assert.equal(daemon._flushUsageDiskCacheAsync(), firstFlush);
      releasePause2();
      await firstFlush;
      while (daemon._usageCacheFlushPromise) await daemon._usageCacheFlushPromise;
      assert.equal(daemon._usageCacheDirty, false);
      assert.equal(JSON.parse(fs.readFileSync(usageCachePath, 'utf8')).scopes.local[CID_A].stepCount, 202);
    } finally {
      fs.promises.chmod = origChmod;
      await daemon.stop(false, { skipAutoArchive: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SPA ?tab= route debounce, 0-existsSync steady-state backoff, scoped trajectory TTL cache & freshContext preservation', async () => {
  // 1) Pure isSameSpaDocumentRoute contract
  assert.equal(isSameSpaDocumentRoute('vscode-file://vscode-app/index.html?tab=a', 'vscode-file://vscode-app/index.html?tab=b'), true);
  assert.equal(isSameSpaDocumentRoute(`https://127.0.0.1:8798/c/${CID_A}?tab=file__a`, `https://127.0.0.1:8798/c/${CID_A}?tab=file__b`), true);
  assert.equal(isSameSpaDocumentRoute('vscode-file://host-a/index.html?tab=a', 'vscode-file://host-b/index.html?tab=a'), false);
  assert.equal(isSameSpaDocumentRoute('vscode-file://vscode-app/index.html?tab=a#h1', 'vscode-file://vscode-app/index.html?tab=a#h2'), false);
  assert.equal(
    isSameSpaDocumentRoute(
      'vscode-file://vscode-app/index.html?remoteAuthority=ssh-remote%2BboxA&tab=a',
      'vscode-file://vscode-app/index.html?remoteAuthority=ssh-remote%2BboxB&tab=b'
    ),
    false
  );

  // 2) handleBrowserTargetEvent suppresses ?tab= jitter for healthy entries while preserving remote/pathname/unhealthy invalidation
  const daemon = new PrismDaemon({
    rootDir: ROOT,
    bundleCachePath: false,
    enableAutoUpdateTimer: false,
    enableStorageGuardTimer: false,
    silent: true,
  });
  try {
    let tickCalls = 0;
    daemon.scheduleImmediateTick = () => { tickCalls += 1; };
    const entry = {
      wsUrl: 'ws://127.0.0.1:9999/page/spa',
      pageId: 'page-spa',
      url: `https://127.0.0.1:8798/c/${CID_A}?tab=file__a`,
      title: 'Antigravity',
      targetType: 'page',
      targetAttached: true,
      detectedScopeKey: 'local',
      _usageScopeVerified: true,
      healthyStreak: 4,
      verifyDirty: false,
      mainFrameId: 'F1',
      contextFrames: new Map([[1, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
      session: { closed: false },
    };
    daemon.sessions.set(entry.wsUrl, entry);

    const tabRes = daemon._handleBrowserTargetEvent({
      targetInfo: {
        targetId: 'page-spa',
        type: 'page',
        attached: true,
        title: 'Antigravity',
        url: `https://127.0.0.1:8798/c/${CID_A}?tab=file__b`,
      },
    });
    assert.equal(tabRes.dirty, false, 'Pure ?tab= query jitter on healthy window must NOT mark dirty');
    assert.equal(entry.healthyStreak, 4);
    assert.equal(entry.verifyDirty, false);
    assert.equal(entry.detectedScopeKey, 'local');
    assert.equal(tickCalls, 0);

    // Pathname change still triggers immediate invalidation
    const pathRes = daemon._handleBrowserTargetEvent({
      targetInfo: {
        targetId: 'page-spa',
        type: 'page',
        attached: true,
        title: 'Antigravity',
        url: 'https://127.0.0.1:8798/c/22222222-2222-4222-8222-222222222222?tab=file__b',
      },
    });
    assert.equal(pathRes.dirty, true);
    assert.equal(entry.verifyDirty, true);
    assert.equal(entry.healthyStreak, 0);
    assert.equal(tickCalls, 1);

    // 3) Steady-state backoff skip in _verifyAndHealEntryUnlocked performs 0 fs.existsSync
    daemon.rebuildBundle();
    const cfgNow = daemon.cdp?.readConfig?.() || {};
    const healthyEntry = {
      wsUrl: 'ws://127.0.0.1:9999/page/h2',
      mainFrameId: 'F1',
      contextFrames: new Map([[1, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
      verifyDirty: false,
      lastVerifiedCodeHash: daemon.codeHash,
      lastVerifyAt: Date.now(),
      healthyStreak: 4,
      session: { closed: false },
    };
    for (const ch of daemon.cdp.CHANNEL_REGISTRY) {
      const f = ch.fields || {};
      const expr = daemon.channelOrchestrator.getChannelExpr(ch.id);
      const enabled = ch.tracksSkippedNonHost ? Boolean(expr) : daemon.channelOrchestrator.isChannelEnabled(ch, cfgNow);
      if (f.scriptField) healthyEntry[f.scriptField] = enabled ? `${ch.id}-s1` : null;
      if (f.mountedField) healthyEntry[f.mountedField] = enabled;
      if (f.skippedField) healthyEntry[f.skippedField] = false;
      if (f.sigField && f.scriptSigField && expr && enabled) {
        const sig = daemon.channelOrchestrator.getChannelCfgSig(ch, cfgNow, expr);
        healthyEntry[f.sigField] = sig;
        healthyEntry[f.scriptSigField] = sig;
      }
    }
    const origExistsSync = fs.existsSync;
    let existsCalls = 0;
    fs.existsSync = (...args) => {
      existsCalls += 1;
      return origExistsSync(...args);
    };
    try {
      const skipRes = await daemon._verifyAndHealEntryUnlocked(healthyEntry, false);
      assert.equal(skipRes.skipped, true);
      assert.equal(existsCalls, 0, 'Steady-state backoff skip must perform 0 fs.existsSync calls');
    } finally {
      fs.existsSync = origExistsSync;
    }

    // 4) Scoped renderer client dedupes concurrent calls, serves settled TTL cache, and busts on freshContext:true
    let scopedRpcCalls = 0;
    daemon.telemetrySubsystem.invokeRendererLsRpc = async (method) => {
      if (method === 'GetCascadeTrajectory') {
        scopedRpcCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { status: 1, numTotalSteps: 3, trajectory: { cascadeId: CID_A, steps: [], generatorMetadata: [] } };
      }
      return {};
    };
    const scopedClient = daemon._createScopedRendererClient(entry, 'ssh:prod-box');
    const [a, b] = await Promise.all([scopedClient.trajectory(CID_A), scopedClient.trajectory(CID_A)]);
    const c = await scopedClient.trajectory(CID_A);
    assert.equal(scopedRpcCalls, 1, 'Scoped client must dedupe in-flight calls and cache settled trajectory');
    assert.equal(a.numTotalSteps, 3);
    assert.equal(b.numTotalSteps, 3);
    assert.equal(c.numTotalSteps, 3);

    const d = await scopedClient.trajectory(CID_A, { freshContext: true });
    assert.equal(scopedRpcCalls, 2, 'Scoped client must bypass cache on freshContext:true');
    assert.equal(d.numTotalSteps, 3);
  } finally {
    await daemon.stop(false, { skipAutoArchive: true });
  }
});

test('AntigravityClient: 120s Probe proxy reuse (15m OS recheck), iterative byte estimation, nonTransport guard & freshContext fast-refresh intact', async () => {
  const tmpDir = mkTempDir('prism-client-rpc-');
  try {
    let fakeNow = 10000;
    let osDiscoverCalls = 0;
    let probeCalls = 0;
    let trajCalls = 0;
    let oversizeToggle = false;
    let peekState = {
      status: 'CASCADE_RUN_STATUS_IDLE',
      stepCount: 4,
      lastModifiedTime: '2026-11-27T01:00:00.000Z',
      contextWindowUsage: { estimatedTokensUsed: 400000, maxContextTokens: 512000, estimatedAfterCompaction: false, lastStepIndex: 3 },
    };

    const client = new AntigravityClient({
      now: () => fakeNow,
      cdpPort: 8794,
      paths: () => ({ log: path.join(tmpDir, 'missing.log'), logCandidates: [path.join(tmpDir, 'missing.log')] }),
      processes: async () => {
        osDiscoverCalls += 1;
        return [];
      },
      rendererRpc: async (method) => {
        if (method === 'Probe') {
          probeCalls += 1;
          return { available: true };
        }
        if (method === 'PeekContextState') {
          return peekState;
        }
        if (method === 'GetCascadeTrajectory') {
          trajCalls += 1;
          if (oversizeToggle) {
            return { trajectory: { steps: [{ pad: 'z'.repeat(9 * 1024 * 1024) }], generatorMetadata: [] } };
          }
          return {
            status: peekState.status,
            numTotalSteps: peekState.stepCount,
            contextWindowUsage: peekState.contextWindowUsage,
            trajectory: { cascadeId: CID_A, steps: [], generatorMetadata: [] },
          };
        }
        return {};
      },
    });
    try {
      const srv1 = await client.discover();
      assert.equal(srv1.mode, 'renderer-proxy');
      assert.equal(osDiscoverCalls, 1);
      assert.equal(probeCalls, 1);

      // +130s (>120s cacheTtl, <15m OS recheck): Probe reuse only, 0 OS scans
      fakeNow += 130000;
      const srv2 = await client.discover();
      assert.equal(srv2.mode, 'renderer-proxy');
      assert.equal(osDiscoverCalls, 1, 'TTL refresh within 15m must reuse renderer-proxy via Probe only');
      assert.equal(probeCalls, 2);

      // +15m (>=900s): triggers OS recheck cleanly
      fakeNow += 900000;
      const srv3 = await client.discover();
      assert.equal(srv3.mode, 'renderer-proxy');
      assert.equal(osDiscoverCalls, 2, '15m OS recheck boundary must scan processes once');
      assert.equal(probeCalls, 3);

      // 0e7ceaf freshContext & estimatedAfterCompaction fast-refresh must remain intact
      const t1 = await client.trajectory(CID_A);
      assert.equal(trajCalls, 1);
      assert.equal(t1.contextWindowUsage.estimatedTokensUsed, 400000);
      fakeNow += 100;
      peekState = {
        status: 'CASCADE_RUN_STATUS_IDLE',
        stepCount: 5,
        lastModifiedTime: '2026-11-27T01:00:01.000Z',
        contextWindowUsage: { estimatedTokensUsed: 24000, maxContextTokens: 512000, estimatedAfterCompaction: true, lastStepIndex: 4 },
      };
      const t2 = await client.trajectory(CID_A, { freshContext: true });
      assert.equal(trajCalls, 2, 'freshContext must immediately bust settled cache on compaction');
      assert.equal(t2.contextWindowUsage.estimatedTokensUsed, 24000);

      // Oversized conversation error (nonTransport) must preserve slot.server & avoid OS rescan
      oversizeToggle = true;
      await assert.rejects(() => client.call('GetCascadeTrajectory', { cascadeId: CID_A, force: true }), /超过采集上限/);
      assert.equal(client.server?.mode, 'renderer-proxy', 'PROXY_PAYLOAD_LIMIT must not invalidate healthy renderer-proxy');
      assert.equal(osDiscoverCalls, 2, 'Non-transport payload cap error must not trigger OS rescan');
    } finally {
      client.dispose();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Redteam P2-3 & P2-4: releaseIdleTelemetry/flushUsageDiskCache flushGen TOCTOU hardening & 0o700 telemetry dir mode', async () => {
  const tmpDir = mkTempDir('prism-tel-race-');
  const origChmod = fs.promises.chmod;
  const origMkdirSync = fs.mkdirSync;
  try {
    // 1) P2-4: resolveTelemetryDataDir passes explicit { recursive: true, mode: 0o700 }
    const telCacheSrc = fs.readFileSync(path.join(ROOT, 'src', 'daemon', 'telemetry-cache.mjs'), 'utf8');
    assert.ok(
      /resolveTelemetryDataDir[\s\S]*?fs\.mkdirSync\s*\(\s*dir\s*,\s*\{\s*recursive:\s*true\s*,\s*mode:\s*0o700\s*\}\s*\)/.test(telCacheSrc),
      'resolveTelemetryDataDir must create directory with { recursive: true, mode: 0o700 }'
    );
    const mkdirCalls = [];
    fs.mkdirSync = (p, opts) => {
      mkdirCalls.push({ p: String(p), opts });
      return origMkdirSync.call(fs, p, opts);
    };
    const usageCachePath = path.join(tmpDir, 'usage-cache.json');
    const daemon = new PrismDaemon({
      rootDir: ROOT,
      usageCachePath,
      bundleCachePath: false,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
      silent: true,
    });
    try {
      const dataDir = daemon._resolveTelemetryDataDir();
      const matchedCall = mkdirCalls.find((c) => c.p === dataDir);
      assert.ok(matchedCall, 'resolveTelemetryDataDir should invoke fs.mkdirSync on first call');
      assert.deepEqual(matchedCall.opts, { recursive: true, mode: 0o700 });
      fs.mkdirSync = origMkdirSync;

      // 2) P2-3: non-force releaseIdleTelemetry defers while async flush is in flight;
      //    force releaseIdleTelemetry bumps flushGen, detaches stale promise, aborts stale async before rename, and commits latest sync snapshot
      let releasePause = null;
      let reachedPause = null;
      const paused = new Promise((r) => { reachedPause = r; });
      let armPause = true;
      fs.promises.chmod = async (target, mode) => {
        if (armPause && String(target).includes('usage-cache.json') && String(target).endsWith('.tmp')) {
          armPause = false;
          reachedPause();
          await new Promise((r) => { releasePause = r; });
        }
        return origChmod.call(fs.promises, target, mode);
      };

      let disposed = false;
      daemon._lazyStore = { dispose() { disposed = true; }, background: { active: false } };
      daemon._lastTelemetryActivityAt = Date.now() - 300000;
      daemon._putUsageDiskCache(
        CID_A,
        7,
        1763621007,
        { cascadeId: CID_A, stepCount: 7, lastModifiedSec: 1763621007, days: { '2026-11-27': { calls: 1, total: 700 } } },
        'local'
      );
      const stalePromise = daemon._flushUsageDiskCacheAsync();
      await paused;
      const genDuringAsync = daemon._usageCacheFlushGen;
      assert.ok(genDuringAsync >= 1, 'flushGen must advance when async flush starts');

      // Non-force idle release must NOT tear down cache while async flush is in flight
      assert.equal(daemon._releaseIdleTelemetry(false), false, 'Soft idle release must defer while _usageCacheFlushPromise is in flight');
      assert.equal(disposed, false);

      // Update cache to newer value and force idle release
      daemon._putUsageDiskCache(
        CID_A,
        88,
        1763621088,
        { cascadeId: CID_A, stepCount: 88, lastModifiedSec: 1763621088, days: { '2026-11-27': { calls: 8, total: 8800 } } },
        'local'
      );
      assert.equal(daemon._releaseIdleTelemetry(true), true, 'Force idle release must succeed and preempt stale async flush');
      assert.equal(disposed, true);
      assert.ok(daemon._usageCacheFlushGen > genDuringAsync, 'Force release must increment flushGen');
      assert.equal(daemon._usageCacheFlushPromise, null, 'Preempted stale async flush must be detached immediately');
      assert.equal(JSON.parse(fs.readFileSync(usageCachePath, 'utf8')).scopes.local[CID_A].stepCount, 88);

      // Resume stale async flush: must abort before rename and leave newer sync snapshot + zero temp files
      releasePause();
      await stalePromise;
      await daemon.telemetrySubsystem.waitPendingUsageFlush();
      assert.equal(JSON.parse(fs.readFileSync(usageCachePath, 'utf8')).scopes.local[CID_A].stepCount, 88);
      assert.equal(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp')).length, 0);

      // 3) Even if _usageDiskCache was cleared while an async flush is in flight, sync flushUsageDiskCache must still invalidate flushGen
      let releasePause2 = null;
      let reachedPause2 = null;
      const paused2 = new Promise((r) => { reachedPause2 = r; });
      let armPause2 = true;
      fs.promises.chmod = async (target, mode) => {
        if (armPause2 && String(target).includes('usage-cache.json') && String(target).endsWith('.tmp')) {
          armPause2 = false;
          reachedPause2();
          await new Promise((r) => { releasePause2 = r; });
        }
        return origChmod.call(fs.promises, target, mode);
      };
      daemon._putUsageDiskCache(
        CID_A,
        12,
        1763621012,
        { cascadeId: CID_A, stepCount: 12, lastModifiedSec: 1763621012, days: { '2026-11-27': { calls: 2, total: 1200 } } },
        'local'
      );
      const stalePromise2 = daemon._flushUsageDiskCacheAsync();
      await paused2;
      const genBeforeNullFlush = daemon._usageCacheFlushGen;
      daemon._usageDiskCache = null;
      daemon._flushUsageDiskCache();
      assert.ok(daemon._usageCacheFlushGen > genBeforeNullFlush, 'flushUsageDiskCache must bump flushGen even when _usageDiskCache is null');
      assert.equal(daemon._usageCacheFlushPromise, null);
      releasePause2();
      await stalePromise2;
      assert.equal(JSON.parse(fs.readFileSync(usageCachePath, 'utf8')).scopes.local[CID_A].stepCount, 88, 'Aborted async write after null-cache sync flush must not overwrite disk');
      assert.equal(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp')).length, 0);
    } finally {
      fs.mkdirSync = origMkdirSync;
      fs.promises.chmod = origChmod;
      await daemon.stop(false, { skipAutoArchive: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
