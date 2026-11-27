import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import * as arch from '../sidecars/daemon/conversation-archive.mjs';
import {
  PrismDaemon,
  OMNI_BINDING,
  SIDEBAR_BINDING,
  THOUGHT_BINDING,
  WALLPAPER_BINDING,
  copyUpdatedRuntimeFromRepo,
  writeFileAtomicSync,
} from '../sidecars/daemon/main.mjs';
import { sanitizeLogLine } from '../sidecars/daemon/redact.mjs';
import { QuotaForceRefreshGuard, MIN_QUOTA_FORCE_REFRESH_COOLDOWN_MS } from '../src/daemon/quota-guard.mjs';
import { AntigravityClient } from '../vendor/pulse-dashboard/sidecars/panel/client.mjs';
import { collectNativePluginEntries } from '../scripts/build-common.mjs';

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const cdpMod = require(path.join(ROOT_DIR, 'cdp.js'));
const installPluginTool = require(path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'));

function makeTempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('security-daemon 1: isLanguageServerRunning detects platform-suffixed Windows/POSIX host processes, excludes self, and fails closed on query errors', () => {
  // Windows 全量 CSV：命中 language_server_windows_x64.exe / arm64 / Antigravity.exe / agy.exe
  const cleanWinCsv = [
    '"System Idle Process","0","Services","0","8 K"',
    '"node.exe","4321","Console","1","45,120 K"',
    '"explorer.exe","1200","Console","1","62,000 K"',
  ].join('\r\n');
  assert.equal(
    arch.isLanguageServerRunning({ platform: 'win32', exec: () => cleanWinCsv }),
    false,
    '无关进程列表应返回 false'
  );

  for (const img of [
    'language_server.exe',
    'language_server_windows_x64.exe',
    'LANGUAGE_SERVER_WINDOWS_ARM64.EXE',
    'Antigravity.exe',
    'agy.exe',
  ]) {
    const csvWithTarget = `${cleanWinCsv}\r\n"${img}","9876","Console","1","512,000 K"\r\n`;
    assert.equal(
      arch.isLanguageServerRunning({ platform: 'win32', exec: () => csvWithTarget }),
      true,
      `Windows 必须检出目标进程 ${img}`
    );
  }

  // Windows 异常输出、空输出、命令失败 -> 严格 fail-closed (true)
  assert.equal(arch.isLanguageServerRunning({ platform: 'win32', exec: () => '' }), true);
  assert.equal(arch.isLanguageServerRunning({ platform: 'win32', exec: () => 'ERROR: Access denied.' }), true);
  assert.equal(
    arch.isLanguageServerRunning({
      platform: 'win32',
      exec: () => {
        const e = new Error('tasklist failed');
        e.status = 1;
        throw e;
      },
    }),
    true,
    'Windows 进程查询非零退出必须 fail-closed'
  );

  // POSIX ps 输出：检出 language_server 与 Antigravity 主进程，同时排除归档脚本自身命令行
  const cleanPosixPs = [
    '    1 /sbin/launchd',
    '  500 /usr/local/bin/node /tmp/demo/sidecars/daemon/conversation-archive.mjs --archive',
    '  499 /usr/bin/env bash /tmp/antigravity/conversations_archive/archive-subagents.sh',
    '  610 /usr/bin/vim /tmp/notes/readme.md',
  ].join('\n');
  assert.equal(
    arch.isLanguageServerRunning({ platform: 'darwin', selfPid: 500, selfPpid: 499, exec: () => cleanPosixPs }),
    false,
    'POSIX 应排除当前归档脚本与父包装脚本，避免自误判'
  );

  for (const procLine of [
    '  901 /Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9222',
    '  902 /Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)',
    '  903 /opt/antigravity/bin/language_server_linux_x64 --standalone',
    '  904 /Users/demo/bin/language_server_macos_arm64 --port=42000',
    '  905 /usr/share/antigravity/antigravity --no-sandbox',
    '  906 /usr/local/bin/agy --hub',
  ]) {
    const psWithTarget = `${cleanPosixPs}\n${procLine}\n`;
    assert.equal(
      arch.isLanguageServerRunning({ platform: 'linux', selfPid: 500, selfPpid: 499, exec: () => psWithTarget }),
      true,
      `POSIX 必须检出目标进程: ${procLine}`
    );
  }

  // POSIX 空输出 / 非法输出 / 进程查询报错 -> fail-closed (true)
  assert.equal(arch.isLanguageServerRunning({ platform: 'linux', exec: () => '' }), true);
  assert.equal(arch.isLanguageServerRunning({ platform: 'linux', exec: () => 'ps: permission denied' }), true);
  assert.equal(
    arch.isLanguageServerRunning({
      platform: 'linux',
      exec: () => {
        const e = new Error('ps failed');
        e.status = 1;
        throw e;
      },
    }),
    true
  );
});

test('security-daemon 2: parseCliArgs rejects invalid numeric flags (fail-closed) and scanConversationStorage falls back to safe defaults instead of zeroing thresholds', () => {
  // 1) parseCliArgs 非法参数全部抛错拒绝
  const invalidArgLists = [
    ['--subagent-hours='],
    ['--subagent-hours=   '],
    ['--subagent-hours=abc'],
    ['--subagent-hours=-1'],
    ['--subagent-hours=Infinity'],
    ['--subagent-hours=NaN'],
    ['--subagent-hours'],
    ['--main-days='],
    ['--main-days=abc'],
    ['--main-days=-0.5'],
    ['--main-days=1=2'],
    ['--main-days'],
    ['--keep-main='],
    ['--keep-main=abc'],
    ['--keep-main=-5'],
    ['--keep-main=1.5'],
    ['--keep-main=Infinity'],
    ['--keep-main'],
  ];
  for (const argv of invalidArgLists) {
    assert.throws(
      () => arch.parseCliArgs(argv),
      /Invalid CLI option/,
      `非法 CLI 参数必须直接抛错: ${JSON.stringify(argv)}`
    );
  }

  // 合法参数（含显式 0 与小数小时/天数）正常解析
  const okOpts = arch.parseCliArgs(['--archive', '--subagent-hours=0.5', '--main-days=0', '--keep-main=0']);
  assert.equal(okOpts.subagentHours, 0.5);
  assert.equal(okOpts.mainDays, 0);
  assert.equal(okOpts.keepRecentMain, 0);

  // CLI 真实入口对非法参数以非零退出码退出
  const scriptPath = path.join(ROOT_DIR, 'sidecars', 'daemon', 'conversation-archive.mjs');
  assert.throws(
    () => {
      execFileSync(process.execPath, [scriptPath, '--scan', '--keep-main=abc'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
    (err) => err && err.status !== 0,
    'CLI 遇到非法阈值参数必须以非零状态码退出'
  );

  // 2) scanConversationStorage 对非有限/负值/空字符串参数回退安全默认值（6 / 14 / 20），严禁静默清零
  const tmpRoot = makeTempDir('ag-prism-sec-thresh-');
  try {
    const convDir = path.join(tmpRoot, 'conversations');
    const archiveDir = path.join(tmpRoot, 'conversations_archive');
    fs.mkdirSync(convDir, { recursive: true });

    const now = Date.now();
    const recentSubId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const recentMainId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const oldMainId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const twoHoursAgo = new Date(now - 2 * 3600000);
    const fiveDaysAgo = new Date(now - 5 * 86400000);
    const thirtyDaysAgo = new Date(now - 30 * 86400000);

    for (const [id, dt] of [
      [recentSubId, twoHoursAgo],
      [recentMainId, fiveDaysAgo],
      [oldMainId, thirtyDaysAgo],
    ]) {
      const fp = path.join(convDir, `${id}.db`);
      fs.writeFileSync(fp, 'db-bytes', 'utf8');
      fs.utimesSync(fp, dt, dt);
    }

    const summaries = {
      [recentSubId]: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: twoHoursAgo.toISOString(),
        trajectoryMetadata: { parentConversationId: recentMainId },
      },
      [recentMainId]: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: fiveDaysAgo.toISOString(),
        trajectoryMetadata: {},
      },
      [oldMainId]: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: thirtyDaysAgo.toISOString(),
        trajectoryMetadata: {},
      },
    };

    for (const badVal of [NaN, Infinity, -10, '', '   ', null, false, 'not-a-num']) {
      const scan = arch.scanConversationStorage({
        convDir,
        archiveDir,
        summaries,
        subagentMaxAgeHours: badVal,
        mainMaxAgeDays: badVal,
        keepRecentMain: badVal,
        now,
      });
      assert.equal(
        scan.archivableSubagentCount,
        0,
        `非法 subagentMaxAgeHours=${String(badVal)} 必须回退默认 6h（2h 旧子代理不得被列为可归档）`
      );
      assert.equal(
        scan.archivableOldMainCount,
        0,
        `非法 mainMaxAgeDays/keepRecentMain=${String(badVal)} 必须回退默认 14d/20（不得清空主对话保护）`
      );
    }

    // 显式传入合法 0 仍按预期生效
    const explicitZero = arch.scanConversationStorage({
      convDir,
      archiveDir,
      summaries,
      subagentMaxAgeHours: 0,
      mainMaxAgeDays: 0,
      keepRecentMain: 0,
      now,
    });
    assert.equal(explicitZero.archivableSubagentCount, 1);
    assert.equal(explicitZero.archivableOldMainCount, 2);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('security-daemon 3: conversation-archive POSIX helper scripts tighten permissions to 0o700', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'sidecars', 'daemon', 'conversation-archive.mjs'), 'utf8');
  assert.equal(src.includes('0o755'), false, 'POSIX 辅助脚本不得保留 0o755 权限');
  assert.ok(src.includes('atomicWriteTextExclusiveSync(archiveShPath, archiveSh, 0o700)'));
  assert.ok(src.includes('atomicWriteTextExclusiveSync(restoreShPath, restoreSh, 0o700)'));

  if (process.platform !== 'win32') {
    const tmpRoot = makeTempDir('ag-prism-sec-mode-');
    try {
      const helpers = arch.writeHelperScripts({
        scriptPath: path.join(ROOT_DIR, 'sidecars', 'daemon', 'conversation-archive.mjs'),
        archiveDir: path.join(tmpRoot, 'archive'),
      });
      assert.equal(fs.statSync(helpers.archiveScriptPath).mode & 0o777, 0o700);
      assert.equal(fs.statSync(helpers.restoreScriptPath).mode & 0o777, 0o700);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
});

test('security-daemon 4: verifyAndHealEntry serializes via _runEntryExclusive to prevent concurrent CDP race', async () => {
  const daemon = Object.create(PrismDaemon.prototype);
  daemon.codeHash = 'hash-v1';
  daemon.injectExpr = '/* inject */';
  daemon.omniExpr = '';
  daemon.sidebarExpr = '';
  daemon.browserSession = null;
  daemon.sessions = new Map();
  daemon.cdp = {
    PLUGIN_VERSION: '1.0.6',
    SETTING_BINDING: '__agPrismSet',
    readConfig: () => ({ sidebarStudio: 'off' }),
  };
  daemon.log = () => {};
  daemon.ensureOmniServer = async () => null;
  daemon.ensureSidebarService = async () => null;
  daemon._hasOmniClientFile = () => false;
  daemon._hasSafeV2SidebarClientFile = () => false;

  let activeCdpOps = 0;
  let maxConcurrentCdpOps = 0;
  const trace = [];
  const entry = {
    wsUrl: 'ws://127.0.0.1:19999/devtools/page/serial-1',
    pageId: 'serial-1',
    title: 'Synthetic Window',
    url: 'vscode-file://vscode-app/workbench.html',
    scriptId: 'sc-1',
    omniScriptId: null,
    sidebarScriptId: null,
    sidebarBindingAdded: false,
    sidebarMounted: false,
    sidebarHostVerified: true,
    sidebarDocument: 0,
    lastVerifyAt: 0,
    healthyStreak: 0,
    verifyDirty: true,
    lastVerifiedCodeHash: '',
    _opChain: Promise.resolve(),
    session: {
      closed: false,
      close() {
        this.closed = true;
      },
      async send() {
        return {};
      },
      async evaluate() {
        activeCdpOps += 1;
        maxConcurrentCdpOps = Math.max(maxConcurrentCdpOps, activeCdpOps);
        trace.push('eval:enter');
        await new Promise((r) => setTimeout(r, 25));
        trace.push('eval:exit');
        activeCdpOps -= 1;
        return {
          ready: true,
          isHostDom: true,
          href: 'vscode-file://vscode-app/workbench.html',
          prismAttr: '1.0.6',
          hasPrism: true,
          hasRepoBridge: true,
          hasThoughtBridge: true,
          hasUsageBridge: true,
          hasOmniBridge: true,
          hasOmniServerMeta: true,
          hasOmni: false,
          omniMode: 'off',
          hasSidebarBridge: false,
          hasSidebar: false,
          sidebarMode: 'off',
          codeHash: 'hash-v1',
          hasLegacyCss: false,
          needsDashboardSync: false,
        };
      },
    },
  };

  // 同时发起互斥队列操作与 verifyAndHealEntry，验证绝不并发交叉执行
  const exclusiveOp = daemon._runEntryExclusive(entry, async () => {
    activeCdpOps += 1;
    maxConcurrentCdpOps = Math.max(maxConcurrentCdpOps, activeCdpOps);
    trace.push('exclusive:enter');
    await new Promise((r) => setTimeout(r, 30));
    trace.push('exclusive:exit');
    activeCdpOps -= 1;
  });
  const healOp1 = daemon.verifyAndHealEntry(entry, true);
  const healOp2 = daemon.verifyAndHealEntry(entry, true);

  await Promise.all([exclusiveOp, healOp1, healOp2]);
  assert.equal(maxConcurrentCdpOps, 1, 'verifyAndHealEntry 必须与 _runEntryExclusive 严格串行化，最大并发必须为 1');
  assert.deepEqual(trace, [
    'exclusive:enter',
    'exclusive:exit',
    'eval:enter',
    'eval:exit',
    'eval:enter',
    'eval:exit',
  ]);
});

test('security-daemon 5: _handleStorageAction refreshes on NaN updatedAt and protects ensureLsClient via _telemetryInFlight', async () => {
  const tmpRoot = makeTempDir('ag-prism-sec-storage-');
  try {
    const convDir = path.join(tmpRoot, 'conversations');
    const archiveDir = path.join(tmpRoot, 'conversations_archive');
    fs.mkdirSync(convDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });

    const subId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    fs.writeFileSync(path.join(convDir, `${subId}.db`), 'synthetic-sub-db', 'utf8');

    // 写入包含非法 updatedAt 的 catalog index（Date.parse 结果为 NaN）
    const indexPath = path.join(archiveDir, '.last-catalog-index.json');
    fs.writeFileSync(
      indexPath,
      JSON.stringify({
        schema: 1,
        updatedAt: 'not-a-valid-timestamp',
        count: 0,
        entries: {},
      }),
      'utf8'
    );

    const daemon = Object.create(PrismDaemon.prototype);
    daemon.rootDir = tmpRoot;
    daemon._storageHealthCache = null;
    daemon._storageHealthAt = 0;
    daemon._telemetryInFlight = 0;
    daemon._lastTelemetryActivityAt = 0;
    daemon._lazyStore = null;
    daemon._lazyUsage = null;
    daemon._backendSummariesCache = null;

    let lsCalls = 0;
    let disposedCount = 0;
    let inFlightObserved = 0;
    let releaseDuringFlightSoft = null;
    let releaseDuringFlightForce = null;

    const fakeClient = {
      dispose() {
        disposedCount += 1;
      },
      async call(method) {
        assert.equal(method, 'GetAllCascadeTrajectories');
        lsCalls += 1;
        inFlightObserved = daemon._telemetryInFlight;
        // 模拟并发 tick() 在 RPC 飞行中尝试释放空闲客户端
        releaseDuringFlightSoft = daemon._releaseIdleTelemetry(false);
        releaseDuringFlightForce = daemon._releaseIdleTelemetry(true);
        return {
          trajectorySummaries: {
            [subId]: {
              status: 'CASCADE_RUN_STATUS_IDLE',
              stepCount: 12,
              lastModifiedTime: new Date(Date.now() - 10 * 3600000).toISOString(),
              trajectoryMetadata: { parentConversationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
            },
          },
        };
      },
    };
    daemon._lazyLsClient = fakeClient;
    daemon.ensureLsClient = async () => fakeClient;

    const res = await daemon._handleStorageAction('storage-health', { convDir, archiveDir });
    assert.equal(res.ok, true);
    assert.equal(lsCalls, 1, '非法 updatedAt (NaN) 必须视为过期并触发索引刷新');
    assert.equal(inFlightObserved, 1, 'ensureLsClient RPC 期间 _telemetryInFlight 必须递增为 1');
    assert.equal(releaseDuringFlightSoft, false, 'RPC 飞行期间 _releaseIdleTelemetry(false) 必须被拦截');
    assert.equal(releaseDuringFlightForce, false, 'RPC 飞行期间 _releaseIdleTelemetry(true) 也必须被拦截');
    assert.equal(disposedCount, 0, 'RPC 飞行期间绝不可 dispose 正在使用的客户端');
    assert.equal(daemon._telemetryInFlight, 0, 'RPC 结束后 _telemetryInFlight 必须归 0');
    assert.ok(daemon._lastTelemetryActivityAt > 0, 'RPC 结束后必须刷新 _lastTelemetryActivityAt');

    // 验证落盘索引的 updatedAt 已刷新为有效时间戳
    const refreshed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.ok(Number.isFinite(Date.parse(refreshed.updatedAt)), '刷新后索引 updatedAt 必须为有效时间戳');
    assert.equal(refreshed.count, 1);

    // 验证 RPC 抛错时 finally 仍能安全释放 _telemetryInFlight
    daemon._storageHealthCache = null;
    daemon.ensureLsClient = async () => {
      throw new Error('simulated ls disconnect');
    };
    fs.writeFileSync(
      indexPath,
      JSON.stringify({ schema: 1, updatedAt: 'invalid-again', count: 0, entries: {} }),
      'utf8'
    );
    const errFallbackRes = await daemon._handleStorageAction('storage-health', { convDir, archiveDir });
    assert.equal(errFallbackRes.ok, true);
    assert.equal(daemon._telemetryInFlight, 0, 'RPC 异常时 finally 必须归零 _telemetryInFlight');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('security-daemon 6: writeFileAtomicSync rejects symlink parent directory and symlink target file (including before copyFileSync fallback)', () => {
  const tmpRoot = makeTempDir('ag-prism-sec-atomic-');
  try {
    const realDir = path.join(tmpRoot, 'real-dir');
    const outsideDir = path.join(tmpRoot, 'outside-dir');
    fs.mkdirSync(realDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    // 正常写入不存在目标文件（ENOENT 忽略）
    const normalFile = path.join(realDir, 'config.json');
    writeFileAtomicSync(normalFile, '{"ok":true}\n', { mode: 0o600 });
    assert.equal(fs.readFileSync(normalFile, 'utf8'), '{"ok":true}\n');
    assert.equal(
      fs.readdirSync(realDir).some((f) => f.endsWith('.tmp')),
      false,
      '原子写完成后不得残留 .tmp 文件'
    );

    // 父目录为符号链接/junction 时必须拒绝写入
    const linkedParent = path.join(tmpRoot, 'linked-parent');
    let dirLinkCreated = false;
    try {
      fs.symlinkSync(outsideDir, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
      dirLinkCreated = true;
    } catch {}
    if (dirLinkCreated) {
      const victimInOutside = path.join(outsideDir, 'config.json');
      fs.writeFileSync(victimInOutside, 'ORIGINAL_SECRET', 'utf8');
      assert.throws(
        () => writeFileAtomicSync(path.join(linkedParent, 'config.json'), 'OVERWRITTEN'),
        /symbolic link/i,
        '符号链接/junction 父目录必须被 writeFileAtomicSync 拒绝'
      );
      assert.equal(fs.readFileSync(victimInOutside, 'utf8'), 'ORIGINAL_SECRET');
    }

    // 目标文件为符号链接时必须拒绝覆盖
    const victimFile = path.join(outsideDir, 'victim.json');
    fs.writeFileSync(victimFile, 'KEEP_INTACT', 'utf8');
    const linkedTarget = path.join(realDir, 'linked-config.json');
    let fileLinkCreated = false;
    try {
      fs.symlinkSync(victimFile, linkedTarget, 'file');
      fileLinkCreated = true;
    } catch {}
    if (fileLinkCreated) {
      assert.throws(
        () => writeFileAtomicSync(linkedTarget, 'OVERWRITTEN'),
        /symbolic link/i,
        '符号链接目标文件必须被 writeFileAtomicSync 拒绝'
      );
      assert.equal(fs.readFileSync(victimFile, 'utf8'), 'KEEP_INTACT');
    }

    // 静态核验 Windows copyFileSync 回退分支前存在父目录与目标文件 lstatSync 符号链接守卫
    const fsAtomicSrc = fs.readFileSync(path.join(ROOT_DIR, 'src', 'daemon', 'fs-atomic.mjs'), 'utf8');
    const copyIdx = fsAtomicSrc.indexOf('fs.copyFileSync(tmpPath, resolvedTarget)');
    assert.ok(copyIdx > 0, '应保留 Windows copyFileSync 回退逻辑');
    const beforeCopyWindow = fsAtomicSrc.slice(Math.max(0, copyIdx - 220), copyIdx);
    assert.ok(
      beforeCopyWindow.includes("assertNotSymlinkSync(dir, 'target directory')") &&
        beforeCopyWindow.includes("assertNotSymlinkSync(resolvedTarget, 'target file')"),
      'copyFileSync 回退前必须再次校验父目录与目标文件非符号链接'
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('security-daemon 7: SIDEBAR_BINDING has zero exposure in disabled state and hot-binds before client injection on off->on toggle', async () => {
  const workDir = makeTempDir('ag-prism-sec-sbbind-');
  const targetPluginDir = path.join(workDir, 'obsidian-prism');
  await installPluginTool.installPlugin({
    targetDir: targetPluginDir,
    noCdp: true,
    skipHostConfig: true,
    startDaemon: false,
  });

  let daemon = null;
  try {
    daemon = new PrismDaemon({
      rootDir: targetPluginDir,
      overridePort: 19998,
      pollIntervalMs: 5000,
      silent: true,
    });
    assert.equal(daemon.cdp.DEFAULT_CONFIG.sidebarStudio, 'off', 'DEFAULT_CONFIG.sidebarStudio 必须保持 off');

    const evListeners = new Map();
    const timeline = [];
    const bindingCalls = [];
    const fakeSession = {
      closed: false,
      on(ev, fn) {
        if (!evListeners.has(ev)) evListeners.set(ev, []);
        evListeners.get(ev).push(fn);
      },
      emit(ev, params) {
        for (const fn of evListeners.get(ev) || []) fn(params);
      },
      async send(method, params) {
        if (method === 'Runtime.addBinding' || method === 'Runtime.removeBinding') {
          bindingCalls.push({ method, name: params?.name });
          timeline.push(`${method}:${params?.name}`);
        }
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'MAIN_FRAME' } } };
        if (method === 'Runtime.enable') {
          this.emit('Runtime.executionContextCreated', {
            context: { id: 1, auxData: { frameId: 'MAIN_FRAME', isDefault: true, type: 'default' } },
          });
          return {};
        }
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: `sc-${timeline.length}` };
        return {};
      },
      async evaluate(expr) {
        const s = String(expr || '');
        if (s.includes('SIDEBAR_STUDIO_CLIENT_V2')) {
          timeline.push('evaluate:sidebar-client');
        } else if (s.includes(`delete window.${SIDEBAR_BINDING}`)) {
          timeline.push('evaluate:sidebar-cleanup');
        } else if (s.includes('hasSidebarBridge')) {
          // verifyAndHealEntry 探针返回全健康但无侧栏
          return {
            ready: true,
            isHostDom: true,
            href: 'vscode-file://vscode-app/workbench.html',
            prismAttr: daemon.cdp.PLUGIN_VERSION,
            hasPrism: true,
            hasRepoBridge: true,
            hasThoughtBridge: true,
            hasUsageBridge: true,
            hasOmniBridge: true,
            hasOmniServerMeta: true,
            hasOmni: false,
            omniMode: 'off',
            hasSidebarBridge: false,
            hasSidebar: false,
            sidebarMode: 'off',
            codeHash: daemon.codeHash,
            hasLegacyCss: false,
            needsDashboardSync: false,
          };
        }
        return { status: 'ok', refreshed: true };
      },
      close() {
        this.closed = true;
      },
    };

    const origConnect = daemon.cdp.CdpSession.connect;
    daemon.cdp.CdpSession.connect = async () => fakeSession;
    daemon.ensureOmniServer = async () => null;
    daemon.ensureSidebarService = async () => ({
      handleRpc: async () => ({ ok: true }),
      getBootDiagnostic: () => null,
      dispose: async () => {},
    });

    // 1) 关闭态 attachTarget 与 verifyAndHealEntry 绝不注册 SIDEBAR_BINDING
    const entry = await daemon.attachTarget({
      id: 'T_SB_ZERO',
      title: 'Antigravity',
      url: 'vscode-file://vscode-app/workbench.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:19998/devtools/page/T_SB_ZERO',
    });
    daemon.cdp.CdpSession.connect = origConnect;

    assert.equal(entry.sidebarBindingAdded, false, '关闭态 attachTarget 不得标记 sidebarBindingAdded');
    assert.equal(
      bindingCalls.some((c) => c.method === 'Runtime.addBinding' && c.name === SIDEBAR_BINDING),
      false,
      '关闭态 attachTarget 严禁预注册 SIDEBAR_BINDING'
    );

    await daemon.verifyAndHealEntry(entry, true);
    assert.equal(
      bindingCalls.some((c) => c.method === 'Runtime.addBinding' && c.name === SIDEBAR_BINDING),
      false,
      '关闭态 verifyAndHealEntry 严禁注册 SIDEBAR_BINDING'
    );

    // 关闭态直接调用 handleBindingCall 仍保留 JSON.parse 前硬拦截纵深防御
    const disabledDirectRes = await daemon.handleBindingCall(entry, {
      name: SIDEBAR_BINDING,
      executionContextId: 1,
      payload: '{invalid-json-must-not-parse',
    });
    assert.deepEqual(disabledDirectRes, { ok: false, error: 'Chat Beta is disabled' });

    // 2) 热切 off -> on：broadcastConfigRefresh 必须先于 sidebar-client 注入补绑 SIDEBAR_BINDING
    timeline.length = 0;
    daemon.updateConfigSetting('sidebarStudio', 'on');
    await daemon.broadcastConfigRefresh();

    const addIdx = timeline.indexOf(`Runtime.addBinding:${SIDEBAR_BINDING}`);
    const evalIdx = timeline.indexOf('evaluate:sidebar-client');
    assert.ok(addIdx >= 0, 'off->on 热开时必须调用 Runtime.addBinding 注册 SIDEBAR_BINDING');
    assert.ok(evalIdx > addIdx, 'SIDEBAR_BINDING 必须在注入 sidebar-client 之前完成注册');
    assert.equal(entry.sidebarBindingAdded, true);
    assert.equal(entry.sidebarMounted, true);

    // 3) 切回 on -> off：移除 SIDEBAR_BINDING 并下发清理脚本
    timeline.length = 0;
    daemon.updateConfigSetting('sidebarStudio', 'off');
    await daemon.broadcastConfigRefresh();
    assert.ok(
      timeline.includes(`Runtime.removeBinding:${SIDEBAR_BINDING}`),
      'on->off 切换时应调用 Runtime.removeBinding 移除 SIDEBAR_BINDING'
    );
    assert.ok(
      timeline.includes('evaluate:sidebar-cleanup'),
      'on->off 切换时应清理页面侧栏与全局句柄'
    );
    assert.equal(entry.sidebarBindingAdded, false);
    assert.equal(entry.sidebarMounted, false);
  } finally {
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('security-daemon 8: install-plugin atomicWriteFileSync uses crypto.randomBytes + O_EXCL ("wx") and copyDirRecursiveSync skips pid/log/tmp files', () => {
  const installerSrc = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'), 'utf8');
  assert.ok(installerSrc.includes('crypto.randomBytes(8).toString("hex")'), 'atomicWriteFileSync 必须使用 crypto.randomBytes 生成临时文件名');
  assert.ok(installerSrc.includes('fs.openSync(tmpPath, "wx", mode)'), 'atomicWriteFileSync 必须使用 wx 排他创建临时文件');
  assert.equal(installerSrc.includes('Math.random()'), false, 'atomicWriteFileSync 不得再使用弱随机 Math.random()');

  const tmpRoot = makeTempDir('ag-prism-sec-install-');
  try {
    // 1) atomicWriteFileSync 正常写盘与符号链接拒绝
    const outFile = path.join(tmpRoot, 'out', 'meta.json');
    installPluginTool.atomicWriteFileSync(outFile, '{"v":1}\n', { encoding: 'utf8', mode: 0o600 });
    assert.equal(fs.readFileSync(outFile, 'utf8'), '{"v":1}\n');
    assert.equal(
      fs.readdirSync(path.dirname(outFile)).some((f) => f.includes('.tmp.')),
      false,
      'atomicWriteFileSync 写盘后不得残留临时文件'
    );

    const outsideDir = path.join(tmpRoot, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    const linkDir = path.join(tmpRoot, 'linked-out');
    let linked = false;
    try {
      fs.symlinkSync(outsideDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
      linked = true;
    } catch {}
    if (linked) {
      assert.throws(
        () => installPluginTool.atomicWriteFileSync(path.join(linkDir, 'x.json'), '{}'),
        /symbolic link/i
      );
    }

    // 2) copyDirRecursiveSync 跳过 .daemon.pid / *.log / *.tmp / *.tmp.* / __pycache__ / .DS_Store
    const srcDir = path.join(tmpRoot, 'src-sidecars');
    const dstDir = path.join(tmpRoot, 'dst-sidecars');
    fs.mkdirSync(path.join(srcDir, 'daemon'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, '__pycache__'), { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'daemon', 'main.mjs'), '// valid runtime\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'sidecar.json'), '{"ok":true}\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', '.daemon.pid'), '{"pid":123}\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'daemon.log'), 'log line\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'TRACE.LOG'), 'upper log\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'scratch.tmp'), 'temp\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, 'daemon', 'config.json.tmp.99.aabbcc'), 'atomic temp\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, '.DS_Store'), 'mac meta\n', 'utf8');
    fs.writeFileSync(path.join(srcDir, '__pycache__', 'x.pyc'), 'pyc\n', 'utf8');

    const copiedCount = installPluginTool.copyDirRecursiveSync(srcDir, dstDir);
    assert.equal(copiedCount, 2, '仅应复制 2 个合法运行时文件');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'main.mjs')), true);
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'sidecar.json')), true);
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', '.daemon.pid')), false, '必须跳过 .daemon.pid');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'daemon.log')), false, '必须跳过 *.log');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'TRACE.LOG')), false, '必须大小写不敏感跳过 *.LOG');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'scratch.tmp')), false, '必须跳过 *.tmp');
    assert.equal(fs.existsSync(path.join(dstDir, 'daemon', 'config.json.tmp.99.aabbcc')), false, '必须跳过 *.tmp.*');
    assert.equal(fs.existsSync(path.join(dstDir, '.DS_Store')), false);
    assert.equal(fs.existsSync(path.join(dstDir, '__pycache__')), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('security-daemon 9: omniModule="off" lazy-start skips ensureOmniServer & omniExpr, start() avoids recursive root fs.watch by default, and verifyAndHealEntry backs off up to 45s with __agPrism host short-circuit', async () => {
  const workDir = makeTempDir('ag-prism-sec-omni-lazy-');
  const targetPluginDir = path.join(workDir, 'obsidian-prism');
  let daemon = null;
  const origWatch = fs.watch;
  const prevDevWatch = process.env.AG_PRISM_DEV_WATCH;
  try {
    delete process.env.AG_PRISM_DEV_WATCH;
    await installPluginTool.installPlugin({
      targetDir: targetPluginDir,
      noCdp: true,
      skipHostConfig: true,
      startDaemon: false,
    });
    fs.writeFileSync(
      path.join(targetPluginDir, 'config.json'),
      JSON.stringify({ omniModule: 'off', sidebarStudio: 'off', hostLocalization: 'off' }, null, 2),
      'utf8'
    );

    const watchCalls = [];
    fs.watch = (dir, opts, listener) => {
      const actualOpts = typeof opts === 'function' ? {} : (opts || {});
      watchCalls.push({ dir: path.resolve(String(dir)), recursive: Boolean(actualOpts.recursive) });
      return { close() {}, unref() {}, on() {} };
    };

    daemon = new PrismDaemon({
      rootDir: targetPluginDir,
      overridePort: 19997,
      pollIntervalMs: 5000,
      enabledCheck: () => true,
      enableAutoUpdateTimer: false,
      silent: true,
    });

    let omniStartCount = 0;
    const origEnsureOmni = daemon.ensureOmniServer.bind(daemon);
    daemon.ensureOmniServer = async () => {
      omniStartCount += 1;
      return origEnsureOmni();
    };

    // 1) Default start({ watchFiles: true }) must NOT open { recursive: true } on rootDir
    daemon.start({ claimPid: false, watchFiles: true });
    assert.equal(watchCalls.length, 1);
    assert.equal(watchCalls[0].recursive, false, 'Default production watchFiles must NOT watch rootDir recursively');
    assert.equal(daemon.omniExpr, '', 'rebuildBundle must skip omniExpr when omniModule==="off"');

    // Verify AG_PRISM_DEV_WATCH=1 enables recursive source watching for dev mode
    await daemon.stop(false);
    process.env.AG_PRISM_DEV_WATCH = '1';
    daemon.start({ claimPid: false, watchFiles: true });
    assert.equal(watchCalls.at(-1).recursive, true, 'AG_PRISM_DEV_WATCH=1 must opt into recursive dev watching');
    delete process.env.AG_PRISM_DEV_WATCH;
    await daemon.stop(false);
    fs.watch = origWatch;

    // 2) With omniModule==="off", attachTarget + verifyAndHealEntry + broadcastConfigRefresh never start OmniServer
    const evaluatedOmni = [];
    const addedOmniBindings = [];
    let probeScriptSeen = '';
    const listeners = new Map();
    const fakeSession = {
      closed: false,
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      async send(method, params = {}) {
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'MAIN_F' } } };
        if (method === 'Runtime.enable') {
          for (const fn of listeners.get('Runtime.executionContextCreated') || []) {
            fn({ context: { id: 1, auxData: { frameId: 'MAIN_F', isDefault: true, type: 'default' } } });
          }
          return {};
        }
        if (method === 'Runtime.addBinding' && params.name === OMNI_BINDING) {
          addedOmniBindings.push(params.name);
        }
        if (method === 'Runtime.evaluate') return {};
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'doc-sc-1' };
        return {};
      },
      async evaluate(expr) {
        const s = String(expr || '');
        if (s.includes('ag-omni-url')) {
          evaluatedOmni.push('omni-client');
        }
        if (s.includes('needsDashboardSync')) {
          probeScriptSeen = s;
          return {
            ready: true,
            isHostDom: true,
            href: 'vscode-file://vscode-app/workbench.html',
            prismAttr: daemon.cdp.PLUGIN_VERSION,
            hasPrism: true,
            hasRepoBridge: true,
            hasThoughtBridge: true,
            hasUsageBridge: true,
            hasOmniBridge: false,
            hasOmniServerMeta: false,
            hasOmni: false,
            omniMode: 'off',
            hasSidebarBridge: false,
            hasSidebar: false,
            sidebarMode: 'off',
            hasHostI18n: false,
            hasInlineDiff: true,
            codeHash: daemon.codeHash,
            hasLegacyCss: false,
            needsDashboardSync: false,
          };
        }
        return { ok: true, status: 'ok', refreshed: true };
      },
      close() { this.closed = true; },
    };

    const origConnect = daemon.cdp.CdpSession.connect;
    daemon.cdp.CdpSession.connect = async () => fakeSession;
    const entry = await daemon.attachTarget({
      id: 'T_OMNI_OFF',
      title: 'Antigravity',
      url: 'vscode-file://vscode-app/workbench.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:19997/devtools/page/T_OMNI_OFF',
    });
    daemon.cdp.CdpSession.connect = origConnect;

    assert.equal(omniStartCount, 0, 'attachTarget must NOT start OmniServer when omniModule==="off"');
    assert.equal(daemon.omniServer, null);
    assert.equal(addedOmniBindings.length, 0, 'attachTarget must skip OMNI_BINDING when omniModule==="off"');
    assert.equal(evaluatedOmni.length, 0, 'attachTarget must NOT inject omniExpr when omniModule==="off"');

    await daemon.verifyAndHealEntry(entry, true);
    assert.equal(omniStartCount, 0, 'verifyAndHealEntry must NOT start OmniServer when omniModule==="off"');
    assert.equal(evaluatedOmni.length, 0, 'verifyAndHealEntry must NOT inject omniExpr when omniModule==="off"');
    assert.ok(
      probeScriptSeen.indexOf('const api = window.__agPrism') < probeScriptSeen.indexOf('document.querySelector('),
      'Health probe isHostDom must short-circuit on window.__agPrism before running document.querySelector'
    );

    // 3) Verify 45s exponential backoff ceiling when browserSession is live & healthyStreak >= 5
    daemon.browserSession = { closed: false };
    entry.healthyStreak = 5;
    entry.verifyDirty = false;
    entry.lastVerifiedCodeHash = daemon.codeHash;
    entry.lastVerifyAt = Date.now() - 30000;
    const skippedProbe = await daemon.verifyAndHealEntry(entry, false);
    assert.equal(skippedProbe.skipped, true, 'Healthy entry at 30s must skip probe under 45s backoff ceiling');

    await daemon.broadcastConfigRefresh();
    assert.equal(omniStartCount, 0, 'broadcastConfigRefresh with omniModule==="off" must keep OmniServer lazy/unstarted');

    // 4) Toggling omniModule off -> on lazily starts OmniServer & injects omniExpr; on -> off stops server cleanly
    daemon.updateConfigSetting('omniModule', 'on');
    await daemon.broadcastConfigRefresh();
    assert.equal(omniStartCount, 1, 'Toggling omniModule->"on" must lazily start OmniServer');
    assert.equal(Boolean(daemon.omniServer?.running), true);
    assert.ok(addedOmniBindings.length >= 1, 'Toggling omniModule->"on" must bind OMNI_BINDING');
    assert.ok(evaluatedOmni.length >= 1, 'Toggling omniModule->"on" must evaluate omniExpr');

    daemon.updateConfigSetting('omniModule', 'off');
    await daemon.broadcastConfigRefresh();
    assert.equal(daemon.omniServer, null, 'Toggling omniModule->"off" must stop & release OmniServer');

    // 5) fetchUsageRollupBatch with gmOffset===0 in renderer-proxy mode passes force: false to reuse trajectory cache
    let capturedForce = null;
    daemon._lazyLsClient = {
      server: { mode: 'renderer-proxy' },
      call: async () => ({ results: [] }),
      trajectory: async (_id, opts) => {
        capturedForce = opts?.force;
        return { numTotalSteps: 1, numTotalGeneratorMetadata: 0, trajectory: { cascadeId: _id, steps: [], generatorMetadata: [] } };
      },
    };
    await daemon.fetchUsageRollupBatch([{ id: '66666666-7777-8888-9999-aaaaaaaaaaaa', gmOffset: 0 }]);
    assert.equal(capturedForce, false, 'fetchUsageRollupBatch must not force-bypass proxy trajectory cache when gmOffset === 0');
  } finally {
    fs.watch = origWatch;
    if (prevDevWatch === undefined) delete process.env.AG_PRISM_DEV_WATCH;
    else process.env.AG_PRISM_DEV_WATCH = prevDevWatch;
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('security-daemon 10: self-heals missing mainFrameId after initial Page.getFrameTree timeout while keeping sub-iframes 100% fail-closed', async () => {
  const workDir = makeTempDir('ag-prism-sec-ft-heal-');
  const targetPluginDir = path.join(workDir, 'obsidian-prism');
  await installPluginTool.installPlugin({
    targetDir: targetPluginDir,
    noCdp: true,
    skipHostConfig: true,
    startDaemon: false,
  });

  let daemon = null;
  try {
    const cfgPath = path.join(targetPluginDir, 'config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          omniModule: 'off',
          sidebarStudio: 'off',
          hostLocalization: 'off',
          updateChannel: 'stable',
          telemetryModule: 'auto',
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    daemon = new PrismDaemon({
      rootDir: targetPluginDir,
      overridePort: 19996,
      pollIntervalMs: 5000,
      enableAutoUpdateTimer: false,
      silent: true,
    });

    let getFrameTreeCalls = 0;
    let shouldFailFrameTree = true;
    const runtimeMethods = [];
    const evalResponses = [];
    const listeners = new Map();

    const fakeSession = {
      closed: false,
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      emit(ev, params) {
        for (const fn of listeners.get(ev) || []) fn(params);
      },
      async send(method, params = {}) {
        if (method === 'Page.getFrameTree') {
          getFrameTreeCalls += 1;
          if (shouldFailFrameTree) {
            throw new Error('CDP timeout: Page.getFrameTree');
          }
          await new Promise((r) => setTimeout(r, 15));
          return { frameTree: { frame: { id: 'MAIN_F' } } };
        }
        if (method === 'Runtime.disable' || method === 'Runtime.enable') {
          runtimeMethods.push(method);
        }
        if (method === 'Runtime.enable') {
          this.emit('Runtime.executionContextCreated', {
            context: { id: 1, auxData: { frameId: 'MAIN_F', isDefault: true, type: 'default' } },
          });
          this.emit('Runtime.executionContextCreated', {
            context: { id: 2, auxData: { frameId: 'SUB_IFRAME_F', isDefault: true, type: 'default' } },
          });
          this.emit('Runtime.executionContextCreated', {
            context: { id: 3, auxData: { frameId: 'MAIN_F', isDefault: false, type: 'isolated' } },
          });
          return {};
        }
        if (method === 'Runtime.evaluate') {
          evalResponses.push({ contextId: params.contextId, expression: String(params.expression || '') });
          return {};
        }
        if (method === 'Page.addScriptToEvaluateOnNewDocument') {
          return { identifier: 'doc-sc-ft' };
        }
        return {};
      },
      async evaluate(expr) {
        const s = String(expr || '');
        if (s.includes('needsDashboardSync')) {
          return {
            ready: true,
            isHostDom: true,
            href: 'vscode-file://vscode-app/workbench.html',
            prismAttr: daemon.cdp.PLUGIN_VERSION,
            hasPrism: true,
            hasRepoBridge: true,
            hasThoughtBridge: true,
            hasUsageBridge: true,
            hasOmniBridge: false,
            hasOmniServerMeta: false,
            hasOmni: false,
            omniMode: 'off',
            hasSidebarBridge: false,
            hasSidebar: false,
            sidebarMode: 'off',
            hasHostI18n: false,
            hasInlineDiff: true,
            codeHash: daemon.codeHash,
            hasLegacyCss: false,
            needsDashboardSync: false,
          };
        }
        return { ok: true, status: 'ok', refreshed: true };
      },
      close() {
        this.closed = true;
      },
    };

    const origConnect = daemon.cdp.CdpSession.connect;
    daemon.cdp.CdpSession.connect = async () => fakeSession;
    const entry = await daemon.attachTarget({
      id: 'T_FT_TIMEOUT',
      title: 'Antigravity',
      url: 'vscode-file://vscode-app/workbench.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:19996/devtools/page/T_FT_TIMEOUT',
    });
    daemon.cdp.CdpSession.connect = origConnect;

    // 1) attachTarget retries once on initial Page.getFrameTree timeout (2 attempts total), leaving mainFrameId null
    assert.equal(getFrameTreeCalls, 2, 'attachTarget must retry Page.getFrameTree once on initial timeout');
    assert.equal(entry.mainFrameId, null, 'entry.mainFrameId remains null when initial Page.getFrameTree times out');

    // 2) Non-default isolated world context is rejected immediately without even triggering Page.getFrameTree RPC
    await daemon.handleBindingCall(entry, {
      name: daemon.cdp.SETTING_BINDING,
      payload: JSON.stringify({ key: 'updateChannel', value: 'beta' }),
      executionContextId: 3,
    });
    assert.equal(getFrameTreeCalls, 2, 'Isolated world binding call must not trigger Page.getFrameTree RPC');
    assert.equal(daemon.cdp.readConfig().updateChannel, 'stable');

    // 3) FrameTree recovers: concurrent sub-iframe + main-frame binding calls coalesce into 1 Page.getFrameTree RPC;
    //    sub-iframe stays 100% fail-closed while main-frame THOUGHT_BINDING & SETTING_BINDING succeed immediately!
    shouldFailFrameTree = false;
    await Promise.all([
      daemon.handleBindingCall(entry, {
        name: daemon.cdp.SETTING_BINDING,
        payload: JSON.stringify({ key: 'updateChannel', value: 'beta' }),
        executionContextId: 2,
      }),
      daemon.handleBindingCall(entry, {
        name: THOUGHT_BINDING,
        payload: JSON.stringify({ id: 999, action: 'cache-stats' }),
        executionContextId: 2,
      }),
      daemon.handleBindingCall(entry, {
        name: THOUGHT_BINDING,
        payload: JSON.stringify({ id: 101, action: 'cache-stats' }),
        executionContextId: 1,
      }),
      daemon.handleBindingCall(entry, {
        name: daemon.cdp.SETTING_BINDING,
        payload: JSON.stringify({ key: 'telemetryModule', value: 'off' }),
        executionContextId: 1,
      }),
    ]);

    assert.equal(getFrameTreeCalls, 3, 'Concurrent binding self-heal must coalesce into a single Page.getFrameTree call');
    assert.equal(entry.mainFrameId, 'MAIN_F');
    assert.equal(entry.hasFrameTree, true);
    assert.equal(entry.sidebarHostContextId, 1, '_ensureMainFrameId must backfill sidebarHostContextId when host was already verified');

    // Sub-iframe calls must be 100% dropped (fail-closed)
    assert.equal(daemon.cdp.readConfig().updateChannel, 'stable', 'Sub-iframe SETTING_BINDING must remain 100% blocked');
    assert.equal(
      evalResponses.some((r) => r.contextId === 2 || r.expression.includes('999')),
      false,
      'Sub-iframe THOUGHT_BINDING must never receive a response'
    );

    // Main-frame calls must succeed after self-healing mainFrameId
    assert.equal(daemon.cdp.readConfig().telemetryModule, 'off', 'Main-frame SETTING_BINDING must succeed after mainFrameId self-heal');
    assert.equal(
      evalResponses.some((r) => r.contextId === 1 && r.expression.includes('__agPrismThoughtResolve(101,')),
      true,
      'Main-frame THOUGHT_BINDING must resolve cleanly after mainFrameId self-heal'
    );

    // 4) _verifyAndHealEntryUnlocked resyncs Runtime contexts via Runtime.disable -> Runtime.enable if main default context is missing
    entry.contextFrames.delete(1);
    daemon.browserSession = { closed: false };
    entry.healthyStreak = 5;
    entry.verifyDirty = false;
    entry.lastVerifiedCodeHash = daemon.codeHash;
    entry.lastVerifyAt = Date.now() - 1000;
    runtimeMethods.length = 0;

    const healRes = await daemon.verifyAndHealEntry(entry, false);
    assert.equal(Boolean(healRes.skipped), false, 'verifyAndHealEntry must bypass backoff skip when main default context is missing');
    assert.deepEqual(
      runtimeMethods.slice(0, 2),
      ['Runtime.disable', 'Runtime.enable'],
      'verifyAndHealEntry must run Runtime.disable -> Runtime.enable to resync missing main default context'
    );
    assert.equal(daemon._hasMainDefaultContext(entry), true, 'Main default context must be restored after Runtime resync');

    await daemon.handleBindingCall(entry, {
      name: THOUGHT_BINDING,
      payload: JSON.stringify({ id: 102, action: 'cache-stats' }),
      executionContextId: 1,
    });
    await daemon.handleBindingCall(entry, {
      name: daemon.cdp.SETTING_BINDING,
      payload: JSON.stringify({ key: 'updateChannel', value: 'beta' }),
      executionContextId: 2,
    });
    assert.equal(
      evalResponses.some((r) => r.contextId === 1 && r.expression.includes('__agPrismThoughtResolve(102,')),
      true,
      'Main-frame THOUGHT_BINDING must work after Runtime context resync'
    );
    assert.equal(daemon.cdp.readConfig().updateChannel, 'stable', 'Sub-iframe must remain 100% blocked after Runtime context resync');
  } finally {
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('security-daemon 11 (#229 P1-2, P1-4, P2-4): WALLPAPER_BINDING 禁内联 Token、多窗严判 contextId 广播、detachAll/tick 移除绑定及无帧树非测试态 fail-closed', async () => {
  const workDir = makeTempDir('ag-sec-wp-p1-');
  const portFile = path.join(workDir, 'DevToolsActivePort');
  fs.writeFileSync(portFile, '49991\n/devtools/browser/test\n', 'utf8');

  const secretToken = 'SECRET_BEARER_TOKEN_DO_NOT_INLINE_987654';
  const secretPath = 'C:\\Users\\Private\\wallpaper-secret.mp4';
  let currentWpCfg = {
    enabled: true,
    mediaPath: secretPath,
    mediaType: 'video',
    mediaUrl: `http://127.0.0.1:45555/media?token=${secretToken}`,
    opacity: 0.35,
    blurPx: 0,
    dimOverlay: 0.3,
    fit: 'cover',
    pauseOnBlur: true,
  };
  let actionCalls = 0;

  const mockWallpaperSvc = {
    getConfigSync() {
      return { ...currentWpCfg };
    },
    isEnabledSync() {
      return Boolean(currentWpCfg.enabled);
    },
    async handleAction(action, payload) {
      actionCalls += 1;
      if (action === 'save-config') {
        currentWpCfg = {
          ...currentWpCfg,
          ...payload,
          mediaUrl: 'http://127.0.0.1:45555/media?token=ROTATED_TOKEN_NEW_111',
        };
      }
      return { ok: true, action, config: this.getConfigSync() };
    },
    dispose() {},
  };

  function makeHostSession({ mainFrameId, mainCtxId, isHostDom = true }) {
    const listeners = new Map();
    const calls = [];
    const evals = [];
    let domAliveIsHost = isHostDom;
    return {
      closed: false,
      onClose: null,
      setHostDom(v) {
        domAliveIsHost = Boolean(v);
      },
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      emit(ev, params) {
        for (const fn of listeners.get(ev) || []) fn(params);
      },
      async send(method, params = {}) {
        calls.push({ method, params });
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: mainFrameId, url: 'vscode-file://vscode-app/workbench.html' } } };
        }
        if (method === 'Runtime.enable') {
          this.emit('Runtime.executionContextCreated', {
            context: {
              id: mainCtxId,
              auxData: { frameId: mainFrameId, isDefault: true, type: 'default' },
            },
          });
          return {};
        }
        if (method === 'Page.addScriptToEvaluateOnNewDocument') {
          return { identifier: `sc-${calls.length}` };
        }
        if (method === 'Runtime.evaluate') {
          evals.push({ expression: String(params.expression || ''), contextId: params.contextId, viaSend: true });
          return { result: { type: 'undefined' } };
        }
        return {};
      },
      async evaluate(expr) {
        const s = String(expr || '');
        evals.push({ expression: s, contextId: undefined, viaSend: false });
        if (s.includes('needsDashboardSync') || (s.includes('isHostDom') && s.includes('hasWallpaper'))) {
          return {
            ready: true,
            isHostDom: domAliveIsHost,
            href: 'vscode-file://vscode-app/workbench.html',
            prismAttr: cdpMod.PLUGIN_VERSION,
            hasPrism: domAliveIsHost,
            hasRepoBridge: domAliveIsHost,
            hasThoughtBridge: domAliveIsHost,
            hasUsageBridge: domAliveIsHost,
            hasOmniBridge: false,
            hasOmniServerMeta: false,
            hasOmni: false,
            omniMode: 'off',
            hasSidebarBridge: false,
            hasSidebar: false,
            sidebarMode: 'off',
            hasHostI18n: false,
            hasInlineDiff: domAliveIsHost,
            hasWallpaper: domAliveIsHost,
            hasWallpaperUi: domAliveIsHost,
            codeHash: '',
            hasLegacyCss: false,
            needsDashboardSync: false,
          };
        }
        return domAliveIsHost ? { ok: true, status: 'ok' } : { ok: false, status: 'skipped-non-host' };
      },
      close() {
        if (this.closed) return;
        this.closed = true;
        if (typeof this.onClose === 'function') this.onClose();
      },
      getCalls: () => calls,
      getEvals: () => evals,
    };
  }

  let daemon = null;
  try {
    daemon = new PrismDaemon({
      rootDir: ROOT_DIR,
      bundleCachePath: false,
      portFile,
      enabledCheck: () => true,
      enableAutoUpdateTimer: false,
      silent: true,
      wallpaperService: mockWallpaperSvc,
    });
    daemon.running = true;

    // 1) P1-2: _buildWallpaperExprForConfig 严禁将 initialWallpaperConfig / Bearer Token / mediaPath 内联到 NewDocument 表达式
    const capturedOpts = [];
    const origBuildWp = daemon.cdp.buildWallpaperExpression;
    daemon.cdp = {
      ...daemon.cdp,
      buildWallpaperExpression(cfg, opts) {
        capturedOpts.push(opts);
        return origBuildWp(cfg, opts);
      },
    };
    const expr1 = daemon._buildWallpaperExprForConfig();
    assert.ok(expr1 && expr1.length > 0, 'buildWallpaperExpression must still return valid script');
    assert.equal(expr1.includes(secretToken), false, 'NewDocument wallpaperExpr must NOT inline mediaUrl Bearer Token');
    assert.equal(expr1.includes(secretPath), false, 'NewDocument wallpaperExpr must NOT inline mediaPath');
    assert.equal(
      capturedOpts.some((o) => o && typeof o === 'object' && 'initialWallpaperConfig' in o),
      false,
      '_buildWallpaperExprForConfig must NOT pass initialWallpaperConfig to buildWallpaperExpression'
    );
    // 即使外部 cacheOpts 意外夹带 initialWallpaperConfig 也必须被剥离
    const expr2 = daemon._buildWallpaperExprForConfig(null, {
      initialWallpaperConfig: { mediaUrl: 'http://127.0.0.1:45555/media?token=LEAKED_FROM_OPTS' },
    });
    assert.equal(expr2.includes('LEAKED_FROM_OPTS'), false, 'Explicit initialWallpaperConfig in cacheOpts must be stripped');

    // 2) P1-4: 多窗口广播必须正判 sidebarHostVerified === true 且显式绑定 contextId: other.sidebarHostContextId
    const sHost1 = makeHostSession({ mainFrameId: 'F_HOST_1', mainCtxId: 11 });
    const sHost2 = makeHostSession({ mainFrameId: 'F_HOST_2', mainCtxId: 22 });
    const sUndef = makeHostSession({ mainFrameId: 'F_UNDEF', mainCtxId: 33 });
    const sFalse = makeHostSession({ mainFrameId: 'F_FALSE', mainCtxId: 44 });
    const sNoCtx = makeHostSession({ mainFrameId: 'F_NOCTX', mainCtxId: 55 });
    const sStaleDoc = makeHostSession({ mainFrameId: 'F_STALE', mainCtxId: 66 });

    const connectMap = {
      'ws://127.0.0.1:49991/h1': sHost1,
      'ws://127.0.0.1:49991/h2': sHost2,
    };
    daemon.cdp = {
      ...daemon.cdp,
      listPages: async () => [
        { id: 'H1', type: 'page', title: 'Antigravity 1', url: 'vscode-file://vscode-app/workbench.html', webSocketDebuggerUrl: 'ws://127.0.0.1:49991/h1' },
      ],
      CdpSession: {
        connect: async (wsUrl) => connectMap[wsUrl],
      },
    };

    const entry1 = await daemon.attachTarget({ id: 'H1', type: 'page', title: 'Antigravity 1', url: 'vscode-file://vscode-app/workbench.html', webSocketDebuggerUrl: 'ws://127.0.0.1:49991/h1' });
    const entry2 = await daemon.attachTarget({ id: 'H2', type: 'page', title: 'Antigravity 2', url: 'vscode-file://vscode-app/workbench.html', webSocketDebuggerUrl: 'ws://127.0.0.1:49991/h2' });
    assert.equal(entry1.sidebarHostVerified, true);
    assert.equal(entry2.sidebarHostVerified, true);
    assert.equal(entry2.sidebarHostContextId, 22);

    // 注入 4 个未通过验证/导航中/代际失配会话，验证广播全部严格跳过
    daemon.sessions.set('ws://127.0.0.1:49991/undef', {
      wsUrl: 'ws://127.0.0.1:49991/undef',
      session: sUndef,
      sidebarHostVerified: undefined,
      sidebarHostContextId: 33,
      mainFrameId: 'F_UNDEF',
      contextFrames: new Map([[33, { frameId: 'F_UNDEF', isDefault: true, type: 'default', docGen: 0 }]]),
      sidebarDocument: 0,
      sidebarVerifiedDocument: 0,
      wallpaperSkipped: false,
    });
    daemon.sessions.set('ws://127.0.0.1:49991/false', {
      wsUrl: 'ws://127.0.0.1:49991/false',
      session: sFalse,
      sidebarHostVerified: false,
      sidebarHostContextId: 44,
      mainFrameId: 'F_FALSE',
      contextFrames: new Map([[44, { frameId: 'F_FALSE', isDefault: true, type: 'default', docGen: 0 }]]),
      sidebarDocument: 0,
      sidebarVerifiedDocument: 0,
      wallpaperSkipped: false,
    });
    daemon.sessions.set('ws://127.0.0.1:49991/noctx', {
      wsUrl: 'ws://127.0.0.1:49991/noctx',
      session: sNoCtx,
      sidebarHostVerified: true,
      sidebarHostContextId: null,
      mainFrameId: 'F_NOCTX',
      contextFrames: new Map(),
      sidebarDocument: 0,
      sidebarVerifiedDocument: 0,
      wallpaperSkipped: false,
    });
    daemon.sessions.set('ws://127.0.0.1:49991/staledoc', {
      wsUrl: 'ws://127.0.0.1:49991/staledoc',
      session: sStaleDoc,
      sidebarHostVerified: true,
      sidebarHostContextId: 66,
      mainFrameId: 'F_STALE',
      contextFrames: new Map([[66, { frameId: 'F_STALE', isDefault: true, type: 'default', docGen: 1 }]]),
      sidebarDocument: 2,
      sidebarVerifiedDocument: 1,
      wallpaperSkipped: false,
    });

    await daemon.handleBindingCall(entry1, {
      name: WALLPAPER_BINDING,
      payload: JSON.stringify({ id: 201, action: 'save-config', payload: { opacity: 0.55 } }),
      executionContextId: 11,
    });
    assert.equal(actionCalls, 1);

    const h2Broadcast = sHost2.getEvals().find((e) => e.expression.includes('window.__agPrismWallpaper?.applyConfig?.('));
    assert.ok(h2Broadcast, 'Verified host2 must receive wallpaper config broadcast');
    assert.equal(h2Broadcast.viaSend, true, 'Broadcast must use Runtime.evaluate with explicit contextId');
    assert.equal(h2Broadcast.contextId, 22, 'Broadcast must strictly bind contextId = other.sidebarHostContextId');

    for (const [label, sess] of [
      ['sidebarHostVerified=undefined', sUndef],
      ['sidebarHostVerified=false', sFalse],
      ['sidebarHostContextId=null', sNoCtx],
      ['stale sidebarVerifiedDocument', sStaleDoc],
    ]) {
      assert.equal(
        sess.getEvals().some((e) => e.expression.includes('applyConfig') || e.expression.includes('ROTATED_TOKEN')),
        false,
        `Unverified/navigating session (${label}) must NEVER receive wallpaper Token broadcast`
      );
    }

    // 清理测试占位会话，保留 entry1 / entry2 测试生命周期剥离
    daemon.sessions.delete('ws://127.0.0.1:49991/undef');
    daemon.sessions.delete('ws://127.0.0.1:49991/false');
    daemon.sessions.delete('ws://127.0.0.1:49991/noctx');
    daemon.sessions.delete('ws://127.0.0.1:49991/staledoc');

    // 3) P1-4: tick() 剥离清理路径必须调用 _removeWallpaperBinding(entry2)
    sHost2.setHostDom(false);
    await daemon.tick();
    assert.equal(
      sHost2.getCalls().some((c) => c.method === 'Runtime.removeBinding' && c.params?.name === WALLPAPER_BINDING),
      true,
      'tick() detach path must invoke Runtime.removeBinding for WALLPAPER_BINDING'
    );
    assert.equal(entry2.wallpaperBindingAdded, false);

    // 4) P1-4: detachAll() 必须调用 _removeWallpaperBinding(entry1)
    await daemon.detachAll(false);
    assert.equal(
      sHost1.getCalls().some((c) => c.method === 'Runtime.removeBinding' && c.params?.name === WALLPAPER_BINDING),
      true,
      'detachAll() must invoke Runtime.removeBinding for WALLPAPER_BINDING'
    );
    assert.equal(entry1.wallpaperBindingAdded, false);

    // 5) P2-4: hasTrackedFrames === false 分支必须在 sidebarHostVerified !== true 时拒绝，且在非测试运行时 100% fail-closed
    const noFrameUnverifiedEntry = {
      session: makeHostSession({ mainFrameId: 'NONE', mainCtxId: 1 }),
      hasFrameTree: false,
      mainFrameId: null,
      contextFrames: new Map(),
      sidebarHostVerified: false,
    };
    const prevActionCalls = actionCalls;
    await daemon.handleBindingCall(noFrameUnverifiedEntry, {
      name: WALLPAPER_BINDING,
      payload: JSON.stringify({ id: 301, action: 'get-config' }),
    });
    assert.equal(actionCalls, prevActionCalls, 'WALLPAPER_BINDING must reject unverified entry even when hasTrackedFrames === false');

    // 在干净的非测试子进程中验证 hasTrackedFrames === false 即使 sidebarHostVerified=true 也因 !isAutomatedTestRuntime() 强制 fail-closed
    const cleanEnv = { ...process.env };
    delete cleanEnv.NODE_ENV;
    delete cleanEnv.NODE_TEST_CONTEXT;
    const daemonModuleUrl = new URL('../sidecars/daemon/main.mjs', import.meta.url).href;
    const probeOut = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          `import { PrismDaemon, WALLPAPER_BINDING } from ${JSON.stringify(daemonModuleUrl)};`,
          'let called = 0;',
          `const d = new PrismDaemon({ rootDir: ${JSON.stringify(ROOT_DIR)}, bundleCachePath: false, enableAutoUpdateTimer: false, silent: true, wallpaperService: { async handleAction() { called += 1; return { ok: true }; }, dispose() {} } });`,
          'const entry = { session: { closed: false, async send() { return {}; } }, hasFrameTree: false, mainFrameId: null, contextFrames: new Map(), sidebarHostVerified: true };',
          'await d.handleBindingCall(entry, { name: WALLPAPER_BINDING, payload: JSON.stringify({ id: 1, action: "get-config" }) });',
          'console.log(JSON.stringify({ called }));',
          'await d.stop(false);',
        ].join('\n'),
      ],
      { encoding: 'utf8', env: cleanEnv }
    ).trim();
    assert.deepEqual(
      JSON.parse(probeOut),
      { called: 0 },
      'WALLPAPER_BINDING hasTrackedFrames===false branch must fail-closed when !isAutomatedTestRuntime()'
    );
  } finally {
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('Privacy hardline: autoUpdate="off" performs 0 background git fetch / GitHub API calls across timers, update-status & updateChannel switch while preserving manual check-update', { skip: 'safe build: self-update removed' }, async () => {
  const workDir = makeTempDir('prism-autoupdate-privacy-');
  const pluginDir = path.join(workDir, 'plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  let cfg = { autoUpdate: 'off', updateChannel: 'stable', omniModule: 'off' };
  fs.writeFileSync(
    path.join(pluginDir, 'cdp.js'),
    "module.exports={PLUGIN_VERSION:'1.0.8',DEFAULT_CONFIG:{autoUpdate:'off',updateChannel:'stable',omniModule:'off'},readConfig:()=>({...global.__prismPrivacyCfg}),validateConfigEntry:()=>true,buildInjectExpression:()=>'(()=>{})()',buildConfigRefreshExpression:()=>'(()=>({refreshed:true}))()'};\n",
    'utf8'
  );
  global.__prismPrivacyCfg = cfg;

  let gitFetchCalls = 0;
  let releaseApiCalls = 0;
  let activeChannel = 'stable';
  const mockUpdateSvc = {
    channel: 'stable',
    currentVersion: '1.0.8',
    applying: false,
    setChannel(ch) {
      const next = ch === 'beta' ? 'beta' : 'stable';
      const changed = next !== activeChannel;
      activeChannel = next;
      this.channel = next;
      return changed;
    },
    getStatus() {
      return {
        ok: true,
        channel: activeChannel,
        currentVersion: '1.0.8',
        latestVersion: '1.0.8',
        hasUpdate: false,
        checkedAt: null,
        lastError: null,
      };
    },
    async checkForUpdates({ channel }) {
      releaseApiCalls += 1;
      return {
        ok: true,
        channel: channel || activeChannel,
        currentVersion: '1.0.8',
        latestVersion: '1.0.9',
        hasUpdate: true,
        checkedAt: Date.now(),
        lastError: null,
      };
    },
  };

  let daemon = null;
  try {
    daemon = new PrismDaemon({
      rootDir: pluginDir,
      bundleCachePath: false,
      silent: true,
      enableAutoUpdateTimer: true,
      enableStorageGuardTimer: false,
      watchFiles: false,
      pollIntervalMs: 60000,
      updateCheckInitialDelayMs: 15,
      updateCheckIntervalMs: 25,
      _testUpdateService: mockUpdateSvc,
    });
    daemon.tick = async () => {};
    daemon._inspectGitRepoState = async ({ fetchRemote = false } = {}) => {
      if (fetchRemote) gitFetchCalls += 1;
      return {
        isGitRepo: false,
        hasRemote: false,
        noRemote: true,
        behind: 0,
        branch: 'standalone',
        commit: '1.0.8',
        blockedUnc: false,
      };
    };

    // 1) Starting daemon with default autoUpdate='off' must fire 0 timer network checks
    daemon.start();
    await new Promise((r) => setTimeout(r, 85));
    assert.equal(gitFetchCalls, 0, 'Startup 45s & 6h timers must NOT run git fetch when autoUpdate=off');
    assert.equal(releaseApiCalls, 0, 'Startup 45s & 6h timers must NOT call GitHub API when autoUpdate=off');

    // 2) Passive update-status probe on settings mount must fire 0 network checks when autoUpdate=off
    const stOff = await daemon.executeRepoAction({ action: 'update-status' });
    assert.equal(stOff.ok, true);
    assert.equal(stOff.autoUpdate, 'off');
    assert.equal(stOff.checking, false);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(gitFetchCalls, 0, 'Passive update-status must NOT trigger git fetch when autoUpdate=off');
    assert.equal(releaseApiCalls, 0, 'Passive update-status must NOT trigger GitHub API when autoUpdate=off');

    // 3) Switching updateChannel during broadcastConfigRefresh must fire 0 background checks when autoUpdate=off
    global.__prismPrivacyCfg = { ...global.__prismPrivacyCfg, updateChannel: 'beta' };
    await daemon.broadcastConfigRefresh();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(gitFetchCalls, 0, 'updateChannel broadcast switch must NOT trigger git fetch when autoUpdate=off');
    assert.equal(releaseApiCalls, 0, 'updateChannel broadcast switch must NOT trigger GitHub API when autoUpdate=off');

    // 4) Manual user-triggered check-update MUST still work normally even when autoUpdate=off
    const manualRes = await daemon.executeRepoAction({ action: 'check-update', manual: true, force: true });
    assert.equal(manualRes.ok, true);
    assert.equal(manualRes.action, 'check-update');
    assert.equal(manualRes.hasUpdate, true);
    assert.equal(manualRes.latestVersion, '1.0.9');
    assert.equal(gitFetchCalls, 1, 'Manual check-update must run git fetch once');
    assert.equal(releaseApiCalls, 1, 'Manual check-update must call updateService.checkForUpdates once');

    // 5) Enabling autoUpdate='on' allows scheduled periodic timer (min 1000ms) to resume background checks
    global.__prismPrivacyCfg = { ...global.__prismPrivacyCfg, autoUpdate: 'on' };
    await new Promise((r) => setTimeout(r, 1120));
    assert.ok(gitFetchCalls >= 2, 'Scheduled timer must resume once autoUpdate=on');
    assert.ok(releaseApiCalls >= 2, 'Scheduled timer must query updates once autoUpdate=on');
  } finally {
    delete global.__prismPrivacyCfg;
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('security-daemon 24: RetrieveUserQuotaSummary({ forceRefresh: true }) enforces non-bypassable >=60s cooldown in PrismDaemon and AntigravityClient', async () => {
  // 1) Guard 自身不可绕过 60s 下限
  assert.equal(MIN_QUOTA_FORCE_REFRESH_COOLDOWN_MS, 60_000);
  let now = 10_000;
  const guard = new QuotaForceRefreshGuard({ cooldownMs: 500, now: () => now });
  assert.equal(guard.cooldownMs, 60_000, 'Cooldown must clamp up to >= 60s');
  const first = guard.prepare({ forceRefresh: true });
  assert.equal(first.action, 'forward');
  assert.equal(first.body.forceRefresh, true);
  assert.equal(first.downgraded, false);

  // 无缓存且仍在冷却期 -> 降级为非强制刷新（剥离 forceRefresh）
  now += 15_000;
  const noCacheDowngraded = guard.prepare({ forceRefresh: true, tag: 'x' });
  assert.equal(noCacheDowngraded.action, 'forward');
  assert.equal('forceRefresh' in noCacheDowngraded.body, false);
  assert.equal(noCacheDowngraded.downgraded, true);

  // 写入缓存后冷却期内再次 forceRefresh -> 直接短路复用缓存
  guard.recordSuccess({ credits: 42 });
  now += 15_000;
  const cachedHit = guard.prepare({ forceRefresh: true });
  assert.equal(cachedHit.action, 'cached');
  assert.deepEqual(cachedHit.result, { credits: 42 });

  // 超过 60s 后再次放行 forceRefresh: true
  now += 31_000;
  const afterCooldown = guard.prepare({ forceRefresh: true });
  assert.equal(afterCooldown.action, 'forward');
  assert.equal(afterCooldown.body.forceRefresh, true);

  // 2) PrismDaemon._invokeRendererLsRpc 端到端强制节流
  let daemonClock = 100_000;
  const workDir = makeTempDir('prism-quota-guard-');
  const daemon = new PrismDaemon({
    rootDir: ROOT_DIR,
    logFile: path.join(workDir, 'daemon.log'),
    quotaCooldownNow: () => daemonClock,
  });
  const sentBodies = [];
  daemon._getRendererRpcCandidates = () => [
    {
      session: {
        evaluate: async (expr) => {
          const m = /const body = (.*?);/.exec(String(expr || '')) || /body:\s*JSON\.stringify\((.*?)\)/.exec(String(expr || ''));
          let parsed = {};
          if (m) {
            try { parsed = JSON.parse(m[1]); } catch {}
          } else {
            parsed = { forceRefresh: /"forceRefresh"\s*:\s*true/.test(String(expr || '')) };
          }
          sentBodies.push(parsed);
          return { ok: true, data: { userStatus: { cascadeModelConfigData: { clientModelConfigs: [{ label: `q-${sentBodies.length}` }] } }, seq: sentBodies.length } };
        },
      },
    },
  ];
  try {
    const r1 = await daemon._invokeRendererLsRpc('RetrieveUserQuotaSummary', { forceRefresh: true });
    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0].forceRefresh, true);
    assert.ok(r1);

    // 30s 后高频重刷 -> 复用缓存，0 新 RPC
    daemonClock += 30_000;
    const r2 = await daemon._invokeRendererLsRpc('RetrieveUserQuotaSummary', { forceRefresh: true });
    assert.equal(sentBodies.length, 1, 'Repeated forceRefresh within 60s must reuse cached result without hitting host RPC');
    assert.deepEqual(r2, r1);

    // 61s 后恢复放行
    daemonClock += 31_000;
    const r3 = await daemon._invokeRendererLsRpc('RetrieveUserQuotaSummary', { forceRefresh: true });
    assert.equal(sentBodies.length, 2);
    assert.equal(sentBodies[1].forceRefresh, true);
    assert.ok(r3);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  // 3) AntigravityClient.call 代理层同样强制 >= 60s 节流
  let clientClock = 200_000;
  const clientCalls = [];
  const client = new AntigravityClient({
    now: () => clientClock,
    rendererRpc: async (method, body) => {
      clientCalls.push({ method, body });
      return { plan: 'pro', seq: clientCalls.length };
    },
  });
  client.server = { port: 0, csrf: '', pid: 0, mode: 'renderer-proxy' };
  client.discoveredAt = clientClock;

  const c1 = await client.call('RetrieveUserQuotaSummary', { forceRefresh: true });
  assert.equal(clientCalls.length, 1);
  assert.equal(clientCalls[0].body.forceRefresh, true);
  assert.equal(c1.seq, 1);

  clientClock += 20_000;
  const c2 = await client.call('RetrieveUserQuotaSummary', { forceRefresh: true });
  assert.equal(clientCalls.length, 1, 'AntigravityClient must throttle repeated forceRefresh within 60s');
  assert.equal(c2.seq, 1);

  clientClock += 45_000;
  const c3 = await client.call('RetrieveUserQuotaSummary', { forceRefresh: true });
  assert.equal(clientCalls.length, 2);
  assert.equal(clientCalls[1].body.forceRefresh, true);
  assert.equal(c3.seq, 2);
});

test('security-daemon 25: app_storage.json pending runInBackground marker recovers on PrismDaemon.start() and rejects symlink markers', async () => {
  const workDir = makeTempDir('prism-runinbg-rec-');
  let daemon = null;
  try {
    const appDir = path.join(workDir, 'Antigravity');
    fs.mkdirSync(appDir, { recursive: true });
    const appStoragePath = path.join(appDir, 'app_storage.json');
    fs.writeFileSync(appStoragePath, JSON.stringify({ runInBackground: true, theme: 'obsidian' }, null, 2), 'utf8');

    // 1) suspend 写入崩溃恢复标记并把 runInBackground 设为 false
    const snap = cdpMod.suspendAntigravityRunInBackground(appStoragePath);
    assert.equal(snap.modified, true);
    const markerPath = path.join(appDir, '.pending-restore-run-in-bg.json');
    assert.equal(fs.existsSync(markerPath), true, 'suspend must write .pending-restore-run-in-bg.json');
    assert.equal(JSON.parse(fs.readFileSync(appStoragePath, 'utf8')).runInBackground, false);

    // 模拟崩溃前宿主又写入了新字段
    const mutated = JSON.parse(fs.readFileSync(appStoragePath, 'utf8'));
    mutated.newHostSetting = 'preserved';
    fs.writeFileSync(appStoragePath, JSON.stringify(mutated, null, 2), 'utf8');

    // 2) Daemon 启动阶段检测到遗留恢复标记 -> 自动补偿还原 runInBackground 且保留新字段并删除标记
    daemon = new PrismDaemon({
      rootDir: ROOT_DIR,
      logFile: path.join(workDir, 'daemon.log'),
      pendingRunInBgMarkerPath: markerPath,
      port: 0,
      pollIntervalMs: 60_000,
    });
    daemon._runUpdateCheckOnBoot = () => {};
    daemon.tick = async () => {};
    daemon.start();

    const recovered = JSON.parse(fs.readFileSync(appStoragePath, 'utf8'));
    assert.equal(recovered.runInBackground, true, 'Daemon boot must restore runInBackground=true from pending marker');
    assert.equal(recovered.newHostSetting, 'preserved', 'Daemon recovery must preserve newly written host settings');
    assert.equal(fs.existsSync(markerPath), false, 'Pending restore marker must be removed after recovery');

    // 3) 正常 suspend -> restore 后自动清理标记
    const snap2 = cdpMod.suspendAntigravityRunInBackground(appStoragePath);
    assert.equal(snap2.modified, true);
    assert.equal(fs.existsSync(markerPath), true);
    const restored = await cdpMod.restoreAntigravityRunInBackground(appStoragePath, snap2);
    assert.equal(restored.restored, true);
    assert.equal(fs.existsSync(markerPath), false, 'Normal restore must clear pending marker');
    assert.equal(JSON.parse(fs.readFileSync(appStoragePath, 'utf8')).runInBackground, true);

    // 4) 拒绝通过 symlink/junction 路径读取恢复标记
    const recMod = require(path.join(ROOT_DIR, 'src', 'platform', 'run-in-bg-recovery.cjs'));
    const realMarkerDir = path.join(workDir, 'real-marker-dir');
    fs.mkdirSync(realMarkerDir, { recursive: true });
    fs.writeFileSync(
      path.join(realMarkerDir, '.pending-restore-run-in-bg.json'),
      JSON.stringify({ version: 1, appStoragePath, originalValue: true }),
      'utf8'
    );
    const linkMarkerDir = path.join(workDir, 'link-marker-dir');
    fs.symlinkSync(realMarkerDir, linkMarkerDir, process.platform === 'win32' ? 'junction' : 'dir');
    const symRes = recMod.recoverPendingRunInBgRestoreFromMarker(
      path.join(linkMarkerDir, '.pending-restore-run-in-bg.json')
    );
    assert.equal(symRes.recovered, false);
    assert.equal(symRes.reason, 'symlink-marker');
  } finally {
    if (daemon) await daemon.stop(false).catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('security-daemon 26: daemon.log and watch.log enforce 0o600 permissions and redact user home directory to <USER_HOME>', () => {
  const workDir = makeTempDir('prism-log-redact-');
  try {
    const fakeHome = process.platform === 'win32' ? 'C:\\Users\\AliceDemo' : '/Users/alicedemo';
    const sample = `failed reading ${fakeHome}${path.sep}.antigravity${path.sep}config.json with Bearer secret_token_12345`;
    const redacted = sanitizeLogLine(sample, fakeHome);
    assert.equal(redacted.includes('AliceDemo') || redacted.includes('alicedemo'), false);
    assert.equal(redacted.includes('secret_token_12345'), false);
    assert.match(redacted, /<USER_HOME>/);
    assert.match(redacted, /\*\*\*REDACTED\*\*\*/);

    const logFile = path.join(workDir, 'daemon.log');
    const daemon = new PrismDaemon({ rootDir: ROOT_DIR, logFile, silent: false });
    daemon.silent = false;
    daemon.logFile = logFile;
    const realHome = os.homedir();
    daemon.log(`Opened ${path.join(realHome, 'secret-project', 'file.txt')} token=sk-abc123456789`);
    const written = fs.readFileSync(logFile, 'utf8');
    assert.equal(written.includes(realHome), false, 'daemon.log must never leak os.homedir()');
    assert.match(written, /<USER_HOME>/);
    assert.equal(written.includes('sk-abc123456789'), false);

    // 静态验证 daemon.log (src/daemon/logger.mjs) 与 watch.log (inject.js) 落盘均显式设置 mode: 0o600
    const loggerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src', 'daemon', 'logger.mjs'), 'utf8');
    const injectSrc = fs.readFileSync(path.join(ROOT_DIR, 'inject.js'), 'utf8');
    assert.match(loggerSrc, /appendFileSync\(this\.logFile,[\s\S]{0,120}mode:\s*0o600/);
    assert.match(injectSrc, /appendFileSync\(LOG_FILE,[\s\S]{0,120}mode:\s*0o600/);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('security-daemon 27: build-common, install-plugin.cjs and copyUpdatedRuntimeFromRepo all package/sync src/ runtime modules', () => {
  // 1) build-common.mjs collectNativePluginEntries 包含 src/daemon/* 全部核心模块
  const entries = collectNativePluginEntries();
  const relSet = new Set(
    entries.map((e) => String(e?.name || '').replace(/\\/g, '/').replace(/^native-plugin\//, ''))
  );
  const allSrcDaemonModules = fs
    .readdirSync(path.join(ROOT_DIR, 'src', 'daemon'))
    .filter((f) => f.endsWith('.mjs') || f.endsWith('.cjs'))
    .map((f) => `src/daemon/${f}`);
  for (const requiredRel of [
    ...allSrcDaemonModules,
    'src/security/net-guard.mjs',
    'src/security/win-picker.mjs',
  ]) {
    assert.equal(relSet.has(requiredRel), true, `collectNativePluginEntries must include ${requiredRel}`);
  }

  // 2) tools/install-plugin.cjs 的 DIRS_TO_SYNC 包含 "src"
  const installSrc = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'install-plugin.cjs'), 'utf8');
  assert.match(installSrc, /DIRS_TO_SYNC\s*=\s*\[[^\]]*["']src["']/);

  // 3) copyUpdatedRuntimeFromRepo 同步 src/ 目录到目标插件目录
  const dstDir = makeTempDir('prism-sync-src-');
  try {
    copyUpdatedRuntimeFromRepo(ROOT_DIR, dstDir, []);
    assert.equal(fs.existsSync(path.join(dstDir, 'src', 'daemon', 'uninstall-runner.mjs')), true);
    assert.equal(fs.existsSync(path.join(dstDir, 'src', 'daemon', 'quota-guard.mjs')), true);
    assert.equal(fs.existsSync(path.join(dstDir, 'src', 'security', 'net-guard.mjs')), true);
  } finally {
    fs.rmSync(dstDir, { recursive: true, force: true });
  }
});
