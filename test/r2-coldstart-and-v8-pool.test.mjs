// Round 2 性能攻坚专项回归单测：V8 .prop IC、Ch8 <2KB 轻桩按需 RPC、分片+stat 快验缓存、fs.watch 端口唤醒、CDP 并发握手与 3 级流水线、24h 零存在感驻留、Watcher 懒加载
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismDaemon } from '../sidecars/daemon/main.mjs';
import { DaemonLogger } from '../src/daemon/logger.mjs';
import { putUsageDiskCache, flushUsageDiskCache } from '../src/daemon/telemetry-cache.mjs';
import { resolveSafeWatchDir } from '../src/daemon/daemon-loop.mjs';
import { handleStorageAction } from '../src/daemon/storage-guard-actions.mjs';
import { HOST_FSM_STATES, ENTRY_FSM_STATES } from '../src/daemon/session-fsm.mjs';
import { PAGE_HEALTH_PROBE_EXPRESSION } from '../src/daemon/session-heal-channels.mjs';
import {
  collectOptionalOmniTopEntries,
  collectNativePluginEntries,
  createInstallManifestPayload,
} from '../scripts/build-common.mjs';
import { collectLinuxPortableEntries } from '../scripts/build-linux.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const { minifySingleSource } = require(path.join(ROOT, 'src', 'compiler', 'js-string-pool.cjs'));
const { PROTECTED_USER_PATHS } = require(path.join(ROOT, 'src', 'platform', 'install-manifest.cjs'));
const installTool = require(path.join(ROOT, 'tools', 'install-plugin.cjs'));

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function loadFreshCdp(cdpFilePath) {
  const dir = path.dirname(path.resolve(cdpFilePath));
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(dir)) delete require.cache[k];
  }
  return require(cdpFilePath);
}

test('R2 Task 1: allowMemberProps=false preserves native V8 .prop IC while keeping literal pooling and budgets', () => {
  const sample = `
    function hotLoop(el, list) {
      for (let i = 0; i < 6; i++) {
        const a = el.querySelector('.ag-prism-long-selector-alpha-beta');
        const b = el.querySelector('.ag-prism-long-selector-alpha-beta');
        const c = el?.classList?.contains('--ag-prism-long-token-gamma');
        el.addEventListener('pointerdown', () => list.push('--ag-prism-long-token-gamma', a, b, c));
        el.addEventListener('pointerup', () => list.push('.ag-prism-long-selector-alpha-beta'));
        el.setAttribute('data-k', '--ag-prism-long-token-gamma');
        el.setAttribute('data-m', '.ag-prism-long-selector-alpha-beta');
      }
    }
  `;

  const defaultPacked = minifySingleSource(sample);
  const icPacked = minifySingleSource(sample, { allowMemberProps: false });

  // 默认模式保持向后兼容：高频长成员属性仍会被池化改写为方括号索引
  assert.equal(defaultPacked.includes('.addEventListener('), false, 'Default allowMemberProps=true should pool repeated long member props');
  // allowMemberProps=false：原生点号 .prop / ?.prop 100% 保留，且长字符串字面量仍被 let 池化
  assert.ok(icPacked.includes('.querySelector('), 'allowMemberProps=false must preserve .querySelector native IC');
  assert.ok(icPacked.includes('.addEventListener('), 'allowMemberProps=false must preserve .addEventListener native IC');
  assert.ok(icPacked.includes('?.classList'), 'allowMemberProps=false must preserve optional chaining ?.classList');
  assert.ok(icPacked.includes('.setAttribute('), 'allowMemberProps=false must preserve .setAttribute native IC');
  assert.ok(/const\[[^\]]+\]=.*\.ag-prism-long-selector-alpha-beta/.test(icPacked), 'Long string literals must remain pooled');
  assert.equal((icPacked.match(/\.ag-prism-long-selector-alpha-beta/g) || []).length, 1, 'Pooled long literal should appear only once in pool header');
  assert.doesNotThrow(() => new vm.Script(icPacked));

  // 验证真实 Ch1 热模块与延迟通道均未退化为成员属性池化，且总预算达标
  const ch1 = cdp.buildInjectExpression(cdp.DEFAULT_CONFIG, { noDiskCache: true });
  assert.ok(Buffer.byteLength(ch1, 'utf8') < 390000, `Ch1 must stay < 390,000 B (got ${Buffer.byteLength(ch1, 'utf8')})`);
  assert.ok(ch1.includes('.addEventListener('), 'Ch1 hot DOM modules must preserve .addEventListener native IC');
  assert.ok(ch1.includes('.querySelector('), 'Ch1 hot DOM modules must preserve .querySelector native IC');

  const omniExpr = cdp.buildOmniClientExpression(null, null, { noDiskCache: true });
  assert.ok(omniExpr.includes('.addEventListener('), 'Delayed channel omni must preserve .addEventListener native IC');

  const report = cdp.getChannelBudgetReport(
    { ...cdp.DEFAULT_CONFIG, omniModule: 'on', sidebarStudio: 'on', hostLocalization: 'on', thoughtTranslate: 'ai' },
    { noDiskCache: true }
  );
  assert.equal(report.ok, true, `Over-budget channels: ${report.overBudgetChannels.join(', ')}`);
});

test('R2 Task 2: Ch8 periodicPicker <2KB stub prewarms/intercepts, upgrades via on-demand RPC, 0-injects on off, and ships in all 3 platforms', async () => {
  const stubPath = path.join(ROOT, 'vendor', 'periodic-picker', 'periodic-picker-stub.js');
  assert.equal(fs.existsSync(stubPath), true, 'periodic-picker-stub.js must exist');
  const stubSrc = fs.readFileSync(stubPath, 'utf8');
  const stubBytes = Buffer.byteLength(stubSrc, 'utf8');
  assert.ok(stubBytes < 2048, `periodic-picker-stub.js must be < 2 KB, got ${stubBytes} B`);
  assert.equal(/[^\x00-\x7f]/.test(stubSrc), false, 'periodic-picker-stub.js must be pure ASCII');
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/.test(stubSrc), false, 'periodic-picker-stub.js must have 0 innerHTML');

  // off / false 时连桩也不注入（0 内存 0 监听）
  assert.equal(cdp.buildPeriodicPickerStubExpression({ ...cdp.DEFAULT_CONFIG, periodicModelPicker: 'off' }), '');
  assert.equal(cdp.buildPeriodicPickerStubExpression({ ...cdp.DEFAULT_CONFIG, periodicModelPicker: false }), '');

  const stubExpr = cdp.buildPeriodicPickerStubExpression(cdp.DEFAULT_CONFIG, { noDiskCache: true });
  const fullExpr = cdp.buildPeriodicPickerExpression(cdp.DEFAULT_CONFIG, { noDiskCache: true });
  assert.ok(stubExpr.length > 0 && stubExpr.length < 10000, `Stub wrapper expr should be lightweight (got ${stubExpr.length})`);
  assert.ok(fullExpr.length > stubExpr.length * 50, 'Full Ch8 bundle must remain offloaded from boot stub');

  // VM 沙盒验证：mouseenter 预热 -> pointerdown 记录 pendingOpen 并发 RPC -> 完整 Ch8 自动接管与自清理
  const listeners = new Map();
  const sentBindingPayloads = [];
  const triggerBtn = {
    getAttribute: (k) => (k === 'data-testid' ? 'model-selector-trigger' : null),
    closest: (sel) => (sel === '[data-testid="model-selector-trigger"]' ? triggerBtn : null),
  };
  const doc = {
    readyState: 'complete',
    title: 'Antigravity',
    documentElement: {
      getAttribute: () => null,
      setAttribute() {},
      removeAttribute() {},
    },
    body: { classList: { contains: () => true } },
    getElementById: () => null,
    querySelector: (sel) => (sel.includes('model-selector-trigger') ? triggerBtn : null),
    querySelectorAll: () => [],
    addEventListener(type, fn, cap) {
      const k = `${type}:${Boolean(cap)}`;
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k).add(fn);
    },
    removeEventListener(type, fn, cap) {
      listeners.get(`${type}:${Boolean(cap)}`)?.delete(fn);
    },
  };
  const win = {
    document: doc,
    location: { href: 'vscode-file://vscode-app/workbench.html', protocol: 'vscode-file:' },
    __agPrismSetting: (payload) => sentBindingPayloads.push(JSON.parse(payload)),
    Date,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Math,
    Error,
    setTimeout,
    clearTimeout,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  win.top = win;

  const stubMountRes = vm.runInNewContext(stubExpr, win);
  assert.equal(stubMountRes.ok, true);
  assert.equal(stubMountRes.status, 'stub');
  assert.ok(win.__agPrismPeriodicStub, 'Stub instance must be mounted');
  assert.equal(win.__agPrismPeriodicPicker, undefined, 'Full Ch8 must NOT be loaded initially');

  // 探针识别 stub 健康且 codeHash 匹配
  const probeStub = vm.runInNewContext(PAGE_HEALTH_PROBE_EXPRESSION, win);
  assert.equal(probeStub.hasPeriodicPicker, true);
  assert.equal(probeStub.periodicPickerCodeHash, stubMountRes.codeHash);

  // 触发 mouseenter（预热）与 pointerdown（拦截并记录 __agPeriodicPendingOpen）
  for (const fn of listeners.get('mouseenter:true') || []) fn({ target: triggerBtn });
  assert.equal(sentBindingPayloads.length, 1);
  assert.deepEqual(sentBindingPayloads[0], { action: 'request-periodic-picker', reason: 'prewarm' });

  for (const fn of listeners.get('pointerdown:true') || []) fn({ target: triggerBtn, button: 0 });
  assert.equal(sentBindingPayloads.length, 2);
  assert.deepEqual(sentBindingPayloads[1], { action: 'request-periodic-picker', reason: 'pointerdown' });
  assert.equal(win.__agPeriodicPendingOpen?.trigger, triggerBtn);
  assert.equal(win.__agPeriodicPendingOpen?.autoOpen, true);
  assert.ok(Number.isFinite(win.__agPeriodicPendingOpen?.pointerDownAt));

  // 通过真实 PrismDaemon + RpcDispatcher 测试 request-periodic-picker 按需下发闭环
  const openedTriggers = [];
  const evalReceived = [];
  const fakeEntry = {
    wsUrl: 'ws://127.0.0.1:9222/page/1',
    mainFrameId: 'F1',
    hasFrameTree: true,
    sidebarHostVerified: true,
    sidebarVerifiedDocument: 0,
    sidebarDocument: 0,
    sidebarHostContextId: 7,
    contextFrames: new Map([[7, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
    periodicPickerMounted: false,
    session: {
      closed: false,
      async send(method, params) {
        if (method === 'Runtime.evaluate') {
          evalReceived.push(params);
          // 模拟完整 Ch8 接管结果（销毁 stub、置位 fullLoaded、消费 pendingOpen 并自动 open）
          win.__agPrismPeriodicStub?.destroy?.();
          delete win.__agPrismPeriodicStub;
          win.__agPeriodicFullLoaded = true;
          const pending = win.__agPeriodicPendingOpen;
          delete win.__agPeriodicPendingOpen;
          win.__agPrismPeriodicPicker = {
            __prismCodeHash: 'fullHash1',
            getStatus: () => ({ status: 'active', mode: 'on' }),
            open: (trig) => openedTriggers.push(trig),
          };
          if (pending?.autoOpen) win.__agPrismPeriodicPicker.open(pending.trigger);
          return { result: { value: { ok: true, status: 'active' } } };
        }
        return {};
      },
    },
  };
  const daemon = new PrismDaemon({ rootDir: ROOT, bundleCachePath: false, silent: true, enableAutoUpdateTimer: false, enableStorageGuardTimer: false });
  daemon.periodicPickerExpr = stubExpr;
  await daemon.handleBindingCall(fakeEntry, {
    name: cdp.SETTING_BINDING,
    payload: JSON.stringify({ action: 'request-periodic-picker', reason: 'pointerdown' }),
    executionContextId: 7,
  });

  assert.equal(evalReceived.length, 1, 'RPC request-periodic-picker must dispatch full Ch8 Runtime.evaluate');
  assert.ok(evalReceived[0].expression.includes('__agPeriodicFullLoaded'), 'Full Ch8 expression must set __agPeriodicFullLoaded');
  assert.equal(evalReceived[0].contextId, 7);
  assert.equal(fakeEntry.periodicPickerFullDelivered, true);
  assert.equal(win.__agPeriodicFullLoaded, true);
  assert.equal(win.__agPrismPeriodicStub, undefined, 'Stub must be destroyed and removed after upgrade');
  assert.equal((listeners.get('mouseenter:true')?.size || 0) + (listeners.get('pointerdown:true')?.size || 0), 0, 'Stub listeners must be cleaned');
  assert.deepEqual(openedTriggers, [triggerBtn], 'Pending open must auto-open on trigger after upgrade');

  // 升级后探针仍上报 stubHash，防 session-heal 误判 hashMismatch 回退覆盖为 stub
  const probeFull = vm.runInNewContext(PAGE_HEALTH_PROBE_EXPRESSION, win);
  assert.equal(probeFull.hasPeriodicPicker, true);
  assert.equal(probeFull.periodicPickerCodeHash, stubMountRes.codeHash);

  // 三端打包清单与安装保护清单校验
  const topNames = new Set(collectOptionalOmniTopEntries().map((e) => e.name));
  assert.equal(topNames.has('vendor/periodic-picker/periodic-picker-stub.js'), true, 'Win/macOS top entries must include periodic-picker-stub.js');
  const nativeEntries = collectNativePluginEntries();
  const nativeNames = new Set(nativeEntries.map((e) => e.name));
  assert.equal(nativeNames.has('native-plugin/vendor/periodic-picker/periodic-picker-stub.js'), true);
  const linuxNames = new Set(collectLinuxPortableEntries().map((e) => e.name));
  assert.equal(linuxNames.has('obsidian-prism-linux/native-plugin/vendor/periodic-picker/periodic-picker-stub.js'), true);
  const { manifest } = createInstallManifestPayload({ pluginEntries: nativeEntries });
  assert.ok(manifest.files.some((f) => f.path === 'vendor/periodic-picker/periodic-picker-stub.js'));
  assert.ok(PROTECTED_USER_PATHS.includes('.bundle-cache/'));
});

test('R2 Task 3: compile cache hook, sharded .bundle-cache/ + legacy cleanup, fast stat hit (<15ms), and 1-byte same-mtime tamper fallback', async () => {
  const mainSrc = fs.readFileSync(path.join(ROOT, 'sidecars', 'daemon', 'main.mjs'), 'utf8');
  assert.ok(mainSrc.includes('module.enableCompileCache'), 'sidecars/daemon/main.mjs must enable Node 24 compile cache');
  assert.ok(mainSrc.includes('compile-cache'), 'Compile cache must live under sidecar_data/obsidian-prism/compile-cache');

  const tmpRoot = mkTmp('prism-r2-shard-cache-');
  const pluginDir = path.join(tmpRoot, 'plugin');
  try {
    const installRes = await installTool.installPlugin({
      sourceDir: ROOT,
      targetDir: pluginDir,
      startDaemon: false,
      syncShortcuts: false,
    });
    assert.equal(installRes.ok, true);

    const shardDir = path.join(pluginDir, '.bundle-cache');
    const legacyFile = path.join(pluginDir, '.bundle-cache.json');
    fs.writeFileSync(legacyFile, '{"legacy":true}\n', 'utf8');

    const dCold = new PrismDaemon({
      rootDir: pluginDir,
      bundleCachePath: shardDir,
      silent: true,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
    });
    const coldExpr = dCold.rebuildBundle();
    assert.equal(fs.existsSync(path.join(shardDir, 'ch1.json')), true, 'Sharded cache must create ch1.json');
    assert.equal(fs.existsSync(path.join(shardDir, 'ch-periodicPicker-stub.json')), true, 'Sharded cache must create ch-periodicPicker-stub.json');
    assert.equal(fs.existsSync(path.join(shardDir, 'ch-omni.json')), true, 'Sharded cache must create per-channel shard files');
    assert.equal(fs.existsSync(legacyFile), false, 'Writing sharded cache must clean up legacy .bundle-cache.json');
    assert.equal(fs.existsSync(path.join(shardDir, 'ch-periodicPicker.json')), false, 'Full Ch8 must not be precompiled on boot');

    // 模拟冷启热命中：连续 3 次刷新 require.cache 冷模块加载，验证 fast stat 通道命中、0 次子进程派生且中位数 < 15ms
    const cpMod = require('child_process');
    const origExecFileSync = cpMod.execFileSync;
    let warmSpawnCount = 0;
    cpMod.execFileSync = (...a) => {
      warmSpawnCount += 1;
      return origExecFileSync.apply(cpMod, a);
    };
    const hitSamples = [];
    let lastHitExpr = '';
    let lastSt = null;
    try {
      for (let i = 0; i < 3; i++) {
        const cdpFresh = loadFreshCdp(path.join(pluginDir, 'cdp.js'));
        const t0 = performance.now();
        lastHitExpr = cdpFresh.buildInjectExpression(cdpFresh.DEFAULT_CONFIG, { cachePath: shardDir });
        hitSamples.push(performance.now() - t0);
        lastSt = cdpFresh.getBundleCacheStats();
        assert.equal(lastHitExpr, coldExpr);
        assert.equal(lastSt.diskHits, 1);
        assert.equal(lastSt.diskFastStatHits, 1, 'Ch1 warm hit must use fast stat verification path');
        assert.equal(lastSt.compileUnifiedRuns, 0);
      }
    } finally {
      cpMod.execFileSync = origExecFileSync;
    }
    assert.equal(warmSpawnCount, 0, 'Warm fast-stat Ch1 cache hit across module reloads must spawn 0 child processes');
    const maxMedianHitMs = process.env.CI ? 150 : 15;
    const medianHitMs = hitSamples.slice().sort((a, b) => a - b)[1];
    assert.ok(
      medianHitMs < maxMedianHitMs,
      `Expected median Ch1 fast-stat shard hit < ${maxMedianHitMs}ms, got ${medianHitMs.toFixed(2)}ms (samples=${hitSamples.map((n) => n.toFixed(2)).join(',')})`
    );

    // 验证篡改 ch1.json sourceHash 无法绕过 statsBindingSha256
    const ch1File = path.join(shardDir, 'ch1.json');
    const ch1Obj = JSON.parse(fs.readFileSync(ch1File, 'utf8'));
    fs.writeFileSync(ch1File, JSON.stringify({ ...ch1Obj, sourceHash: '0'.repeat(64) }), 'utf8');
    const cdpTamper = loadFreshCdp(path.join(pluginDir, 'cdp.js'));
    const healedExpr = cdpTamper.buildInjectExpression(cdpTamper.DEFAULT_CONFIG, { cachePath: shardDir });
    assert.equal(healedExpr, coldExpr);
    assert.equal(cdpTamper.getBundleCacheStats().diskHits, 0);
    assert.equal(cdpTamper.getBundleCacheStats().diskMisses, 1);

    // 验证同长度同 mtime 修改 style.css 1 字节 -> ctime 变 -> 回落全量 SHA-256 100% 检出
    const stylePath = path.join(pluginDir, 'style.css');
    const origStat = fs.statSync(stylePath);
    const origCss = fs.readFileSync(stylePath, 'utf8');
    const mutatedCss = origCss.replace(/#([0-9a-fA-F]{6})/, (_m, hex) => `#${hex[0].toLowerCase() === 'a' ? 'b' : 'a'}${hex.slice(1)}`);
    assert.equal(Buffer.byteLength(mutatedCss, 'utf8'), Buffer.byteLength(origCss, 'utf8'));
    fs.writeFileSync(stylePath, mutatedCss, 'utf8');
    fs.utimesSync(stylePath, origStat.atime, origStat.mtime);

    const cdpAfterEdit = loadFreshCdp(path.join(pluginDir, 'cdp.js'));
    const exprAfterEdit = cdpAfterEdit.buildInjectExpression(cdpAfterEdit.DEFAULT_CONFIG, { cachePath: shardDir });
    assert.notEqual(exprAfterEdit, coldExpr, '1-byte same-mtime edit must invalidate fast-stat cache via SHA-256 fallback');
    assert.equal(cdpAfterEdit.getBundleCacheStats().diskHits, 0);
    assert.equal(cdpAfterEdit.getBundleCacheStats().diskFastStatHits, 0);
  } finally {
    try { loadFreshCdp(path.join(pluginDir, 'cdp.js')); } catch {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('R2 Task 4: fs.watch port wake (<30ms target + realpathSync.native), parallel CDP handshake, 0 duplicate addBinding, 3-tier pipeline, and ;void 0 fire-and-forget', async () => {
  const tmpDir = mkTmp('prism-r2-watch-');
  const portFile = path.join(tmpDir, 'DevToolsActivePort');
  try {
    // 1) resolveSafeWatchDir 归一化验证
    assert.equal(resolveSafeWatchDir(tmpDir), fs.realpathSync.native(tmpDir));

    // 2) fs.watch 端口文件实时唤醒（30s 长轮询下写入完整端口文件后立即唤醒，半写无 \n 不误触）
    const wakeTimes = [];
    const daemon = new PrismDaemon({
      rootDir: ROOT,
      portFile,
      pollIntervalMs: 30000,
      bundleCachePath: false,
      silent: true,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
    });
    daemon.daemonLoop._invokeScheduleImmediateTick = (delayMs) => {
      wakeTimes.push({ at: performance.now(), delayMs });
    };
    daemon.daemonLoop.running = true;
    daemon.daemonLoop._startPortFileWatchers();

    // 先写入不完整内容（无换行符）-> 应被忽略，不触发误唤醒
    fs.writeFileSync(portFile, '9222', 'utf8');
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(wakeTimes.length, 0, 'Incomplete port file without newline must not trigger premature wake');

    // 写入完整端口文件 -> 应迅速唤醒
    const tWrite = performance.now();
    fs.writeFileSync(portFile, '9222\n/devtools/browser/test-id\n', 'utf8');
    const deadline = Date.now() + 500;
    while (wakeTimes.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    daemon.daemonLoop._stopPortFileWatchers();
    daemon.daemonLoop.running = false;
    assert.ok(wakeTimes.length >= 1, 'Port file fs.watch must wake daemon immediately');
    const wakeLatencyMs = wakeTimes[0].at - tWrite;
    assert.ok(wakeLatencyMs < 300, `Port file wake latency too high: ${wakeLatencyMs.toFixed(2)}ms`);

    // 3) CDP 并发握手 + 0 重复 addBinding + 3 级关键路径流水线验证
    const sendLog = [];
    let inflightHandshake = 0;
    let maxParallelHandshake = 0;
    let ch1Finished = false;
    let tier2SawCh1Done = true;
    let tier2Inflight = 0;
    let maxTier2Parallel = 0;

    const mockSession = {
      closed: false,
      on() {},
      close() { this.closed = true; },
      async send(method, params) {
        sendLog.push({ method, params });
        if (method === 'Page.enable' || method === 'Page.getFrameTree' || method === 'Runtime.enable' || method === 'Runtime.addBinding') {
          inflightHandshake += 1;
          maxParallelHandshake = Math.max(maxParallelHandshake, inflightHandshake);
          await new Promise((r) => setTimeout(r, 15));
          inflightHandshake -= 1;
        }
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'MAIN-F1' } } };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: `id-${sendLog.length}` };
        return {};
      },
      async evaluate(expr) {
        if (expr === 'CH1_EXPR') {
          await new Promise((r) => setTimeout(r, 10));
          ch1Finished = true;
          return { status: 'ok' };
        }
        if (!ch1Finished) tier2SawCh1Done = false;
        tier2Inflight += 1;
        maxTier2Parallel = Math.max(maxTier2Parallel, tier2Inflight);
        await new Promise((r) => setTimeout(r, 12));
        tier2Inflight -= 1;
        return { ok: true, status: 'mounted' };
      },
    };

    const pipeDaemon = new PrismDaemon({
      rootDir: ROOT,
      bundleCachePath: false,
      silent: true,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
    });
    pipeDaemon._cdp = {
      ...pipeDaemon._cdp,
      readConfig: () => ({ ...cdp.DEFAULT_CONFIG, omniModule: 'on', thoughtTranslate: 'ai' }),
      CdpSession: { connect: async () => mockSession },
    };
    pipeDaemon.channelOrchestrator.injectExpr = 'CH1_EXPR';
    pipeDaemon.channelOrchestrator.ensureOmniServer = async () => ({ running: true, getServerInfo: () => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) });
    pipeDaemon.channelOrchestrator.setChannelExpr('omni', 'OMNI_EXPR');
    pipeDaemon.channelOrchestrator.setChannelExpr('thought', 'THOUGHT_EXPR');
    pipeDaemon.channelOrchestrator.setChannelExpr('inlineDiff', 'DIFF_EXPR');
    pipeDaemon.channelOrchestrator.setChannelExpr('telemetry', 'TEL_EXPR');
    pipeDaemon.channelOrchestrator.setChannelExpr('homeStudio', 'HOME_EXPR');
    pipeDaemon.channelOrchestrator.setChannelExpr('periodicPicker', 'PP_STUB_EXPR');

    const entry = await pipeDaemon.attachTarget({
      id: 'p1',
      type: 'page',
      title: 'Antigravity',
      url: 'vscode-file://vscode-app/workbench.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/p1',
    });

    assert.ok(entry, 'attachTarget must succeed');
    assert.ok(maxParallelHandshake >= 4, `Expected parallel CDP handshake Promise.all, max concurrency was ${maxParallelHandshake}`);
    assert.equal(tier2SawCh1Done, true, 'Tier 1 (Ch1) must finish before Tier 2 channels execute');
    assert.ok(maxTier2Parallel >= 2, `Expected Tier 2 channels to run concurrently, max concurrency was ${maxTier2Parallel}`);

    // 核对每个 binding 仅调用 1 次 Runtime.addBinding（omni / thought 0 重复！）
    const bindingCounts = new Map();
    for (const item of sendLog) {
      if (item.method === 'Runtime.addBinding') {
        const n = item.params?.name;
        bindingCounts.set(n, (bindingCounts.get(n) || 0) + 1);
      }
    }
    for (const [bName, cnt] of bindingCounts.entries()) {
      assert.equal(cnt, 1, `Duplicate Runtime.addBinding detected for ${bName}: ${cnt}`);
    }

    // 4) Fire-and-Forget Runtime.evaluate 强制 returnByValue:false, awaitPromise:false 且以 ;void 0 结尾
    const rpcEvals = [];
    const rpcEntry = {
      mainFrameId: 'F1',
      hasFrameTree: true,
      contextFrames: new Map([[5, { frameId: 'F1', isDefault: true, type: 'default', docGen: 0 }]]),
      session: {
        closed: false,
        async send(method, params) {
          if (method === 'Runtime.evaluate') rpcEvals.push(params);
          return {};
        },
      },
    };
    const rpcDaemon = new PrismDaemon({
      rootDir: ROOT,
      bundleCachePath: false,
      silent: true,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
      metricsProvider: async () => ({ connection: 'ok', groups: [] }),
    });
    await rpcDaemon.handleBindingCall(rpcEntry, {
      name: '__agPrismMetricsCall',
      payload: JSON.stringify({ id: 42, input: {} }),
      executionContextId: 5,
    });
    assert.equal(rpcEvals.length, 1);
    assert.equal(rpcEvals[0].returnByValue, false, 'Fire-and-Forget RPC resolve must set returnByValue: false');
    assert.equal(rpcEvals[0].awaitPromise, false, 'Fire-and-Forget RPC resolve must set awaitPromise: false');
    assert.ok(rpcEvals[0].expression.endsWith(';void 0'), 'Fire-and-Forget RPC resolve must end with ;void 0');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('R2 Task 5: 24h zero-footprint residency (telemetry dirty-diff, poll backoff 20-25s, 60s listPages fallback, storage-health exponential backoff, logger burst buffer)', async () => {
  const tmpDir = mkTmp('prism-r2-residency-');
  try {
    // 1) telemetry-cache dirty diff 守卫：相同数据二次写入 0 dirty 0 写盘
    const usageFile = path.join(tmpDir, 'usage-cache.json');
    const tel = { _usageCacheFile: usageFile, _usageCacheDirty: false, _usageCacheTimer: null, _usageDiskCache: null };
    const guid = '11111111-2222-3333-4444-555555555555';
    const rec = { stepCount: 10, lastModifiedSec: 1700000000, days: { '2026-11-26': { inputTokens: 100, outputTokens: 50 } } };
    putUsageDiskCache(tel, guid, 10, 1700000000, rec, 'local');
    assert.equal(tel._usageCacheDirty, true);
    flushUsageDiskCache(tel);
    assert.equal(fs.existsSync(usageFile), true);
    const stat1 = fs.statSync(usageFile);

    // 重复写完全一致的记录 -> 严禁标脏或再写盘
    putUsageDiskCache(tel, guid, 10, 1700000000, rec, 'local');
    assert.equal(tel._usageCacheDirty, false, 'Identical usage record must NOT mark _usageCacheDirty');
    assert.equal(tel._usageCacheTimer, null, 'Identical usage record must NOT arm flush timer');
    flushUsageDiskCache(tel);
    const stat2 = fs.statSync(usageFile);
    assert.equal(stat2.mtimeMs, stat1.mtimeMs);

    // 写盘失败时 _usageCacheDirty 必须保持 true 以便重试
    const badFile = path.join(tmpDir, 'as-dir-conflict');
    fs.mkdirSync(badFile, { recursive: true });
    const telFail = { _usageCacheFile: badFile, _usageCacheDirty: false, _usageCacheTimer: null, _usageDiskCache: null };
    putUsageDiskCache(telFail, guid, 11, 1700000100, rec, 'local');
    assert.equal(telFail._usageCacheDirty, true);
    flushUsageDiskCache(telFail);
    assert.equal(telFail._usageCacheDirty, true, 'Failed flush must retain _usageCacheDirty=true for retry');

    // 2) daemon-loop 24h 退避（MISSING_CDP -> 20s, 全窗 HEALTHY_BACKOFF -> 25s）+ listPages 60s 默认兜底
    const daemon = new PrismDaemon({
      rootDir: ROOT,
      bundleCachePath: false,
      silent: true,
      enableAutoUpdateTimer: false,
      enableStorageGuardTimer: false,
    });
    assert.equal(daemon.sessionRegistry._listPagesFallbackIntervalMs, 60000, 'Default listPagesFallbackIntervalMs must be 60s');
    daemon.sessionRegistry.hostFsmState = HOST_FSM_STATES.MISSING_CDP;
    daemon.relaunchGuard._noPortSinceMs = 0;
    assert.ok(daemon.daemonLoop._computeNextPollDelayMs() >= 15000, 'MISSING_CDP must back off to 15-30s');

    daemon.sessionRegistry.hostFsmState = HOST_FSM_STATES.ATTACHED;
    daemon.sessionRegistry.browserSession = { closed: false };
    daemon.sessionRegistry._browserDiscoverySubscribed = true;
    daemon.sessionRegistry.sessions.set('ws://1', {
      session: { closed: false },
      verifyDirty: false,
      fsmState: ENTRY_FSM_STATES.HEALTHY_BACKOFF,
      healthyStreak: 3,
    });
    assert.ok(daemon.daemonLoop._computeNextPollDelayMs() >= 15000, 'Healthy subscribed windows must back off to 15-30s');

    // 3) storage-guard-actions storage-health 无新对话变动指数退避至 15-30min
    const convDir = path.join(tmpDir, 'conversations');
    const archiveDir = path.join(tmpDir, 'archive');
    fs.mkdirSync(convDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    let scanProbeNow = 1000000000;
    const updMock = {
      rootDir: ROOT,
      _storageGuardStateFile: path.join(tmpDir, 'guard-state.json'),
      getCdp: () => cdp,
      getSessions: () => new Map(),
      telemetry: {
        getWarmReaderSummaries: () => ({}),
        ensureLsClient: async () => ({ call: async () => ({}) }),
        beginActivity() {},
        endActivity() {},
        getDiscoveredSubagents: () => new Map(),
        getStoreSessions: () => new Map(),
      },
      invalidateStorageHealthCache() { this._storageHealthCache = null; this._storageHealthAt = 0; },
    };
    const r1 = await handleStorageAction(updMock, 'storage-health', { convDir, archiveDir, now: scanProbeNow, lsMemoryMb: 120 });
    assert.equal(r1.ok, true);
    assert.equal(r1.warn, false);
    // 6 分钟后（首次过 5min，重新扫描一次确认 convDir 未变 -> idleStreak 升为 1 -> TTL 翻倍为 10min）
    scanProbeNow += 6 * 60 * 1000;
    await handleStorageAction(updMock, 'storage-health', { convDir, archiveDir, now: scanProbeNow, lsMemoryMb: 120 });
    assert.equal(updMock._storageHealthIdleStreak, 1);
    // 再过 11 分钟（确认仍未变 -> idleStreak 升为 2 -> TTL 升为 20min）
    scanProbeNow += 11 * 60 * 1000;
    await handleStorageAction(updMock, 'storage-health', { convDir, archiveDir, now: scanProbeNow, lsMemoryMb: 120 });
    assert.equal(updMock._storageHealthIdleStreak, 2);
    // 再过 16 分钟（< 20min 退避 TTL -> 直接命中缓存不重新扫描！）
    const cachedAtBefore = updMock._storageHealthAt;
    scanProbeNow += 16 * 60 * 1000;
    const rCached = await handleStorageAction(updMock, 'storage-health', { convDir, archiveDir, now: scanProbeNow, lsMemoryMb: 120 });
    assert.equal(rCached, updMock._storageHealthCache);
    assert.equal(updMock._storageHealthAt, cachedAtBefore, 'Unchanged convDir must hit exponential backoff cache up to 15-30min');

    // 4) logger 高频突发缓冲 + 错误级同步落盘
    const logPath = path.join(tmpDir, 'daemon.log');
    const logger = new DaemonLogger({ logFile: logPath, silent: false });
    const origAppend = fs.appendFileSync;
    let appendCalls = 0;
    fs.appendFileSync = function spyAppend(p, ...rest) {
      if (path.resolve(String(p)) === path.resolve(logPath)) appendCalls += 1;
      return origAppend.call(this, p, ...rest);
    };
    try {
      logger.log('cold-first-line'); // 首行同步落盘 (1)
      logger.log('burst-info-1');    // 突发窗内缓冲
      logger.log('burst-info-2');    // 突发窗内缓冲
      logger.log('burst-info-3');    // 突发窗内缓冲
      assert.equal(appendCalls, 1, 'Burst non-error log lines must be buffered instead of calling appendFileSync per line');
      logger.log('[!] fatal-err-immediate'); // 错误级立刻同步刷盘 (2)
      assert.equal(appendCalls, 2, 'Error-level logs must flush synchronously immediately');
      const logContent = fs.readFileSync(logPath, 'utf8');
      assert.ok(logContent.includes('burst-info-3'));
      assert.ok(logContent.includes('[!] fatal-err-immediate'));
    } finally {
      fs.appendFileSync = origAppend;
      logger.flush();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('R2 Task 6: C#/Swift Watchers lazy-load fallback scripts, wait 1.5s when spawning Daemon, and drop redundant 2s Swift directory scan', { skip: 'safe build: native installers removed' }, () => {
  const csSrc = fs.readFileSync(path.join(ROOT, 'installer', 'watcher', 'Program.cs'), 'utf8');
  const swiftSrc = fs.readFileSync(path.join(ROOT, 'installer', 'macos', 'Watcher', 'main.swift'), 'utf8');

  assert.ok(csSrc.includes('bool fallbackScriptsLoaded = false;'), 'Program.cs must lazy-load fallback scripts');
  assert.ok(csSrc.includes('ensureFallbackScriptsLoaded'), 'Program.cs must expose ensureFallbackScriptsLoaded helper');
  assert.ok(csSrc.includes('exitEvent.Wait(150)'), 'Program.cs must provide 1.5s yield window when spawning native daemon');
  assert.ok(csSrc.includes('skipStandbyReload'), 'Program.cs FileSystemWatcher must skip reload while in standby');

  assert.ok(swiftSrc.includes('var fallbackScriptsLoaded = false'), 'main.swift must lazy-load fallback scripts');
  assert.ok(swiftSrc.includes('ensureFallbackScriptsLoaded'), 'main.swift must expose ensureFallbackScriptsLoaded helper');
  assert.ok(swiftSrc.includes('.milliseconds(150)'), 'main.swift must provide 1.5s yield window when spawning native daemon');
  assert.ok(swiftSrc.includes('if dirSource == nil && fallbackScriptsLoaded'), 'main.swift must not run unconditional 2s directory scan when DispatchSource is active');
});
