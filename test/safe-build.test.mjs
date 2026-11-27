// Obsidian Prism — SAFE BUILD regression tests (added 2026-11-27).
// These pin down what the safe build removed or changed; see SAFE-BUILD.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  safeBuildRepoActionResponse,
  SAFE_BUILD_BLOCKED_ACTIONS,
  SAFE_BUILD_PASSTHROUGH_ACTIONS,
} from '../src/daemon/safe-build-policy.mjs';
import { UpdateService } from '../sidecars/daemon/update-service.mjs';
import { isLabEnabled, ADDONS_LAB_ENV_VAR } from '../sidecars/daemon/addon-registry.mjs';
import { getGoMemLimitStatus, setGoMemLimit, clearGoMemLimit } from '../sidecars/daemon/gomemlimit-service.mjs';
import { resolveWindowsWatcherExePath } from '../src/security/win-picker.mjs';
import { startParentExitWatchdog, startHostGoneWatchdog } from '../src/daemon/index.mjs';
import { RelaunchGuard } from '../src/daemon/relaunch-guard.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismLnk = require('../src/platform/prism-shortcut.cjs');
const shortcutGuard = require('../src/platform/shortcut-guard.cjs');
const { parseWindowsLnkBuffer } = require('../src/platform/win-lnk.cjs');
const installer = require('../tools/install-plugin.cjs');
const launcher = require('../src/platform/prism-launch.cjs');

const AG_EXE = 'C:\\Users\\tester\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe';
const LNK_CLSID = Buffer.from([0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46]);

function countedUtf16(str) {
  const len = Buffer.alloc(2);
  len.writeUInt16LE(str.length, 0);
  return Buffer.concat([len, Buffer.from(str, 'utf16le')]);
}

// Minimal MS-SHLLINK file: header + LinkInfo (local base path) + optional arguments.
function buildLnk(targetPath, args = '') {
  const volId = Buffer.alloc(17);
  volId.writeUInt32LE(17, 0);
  volId.writeUInt32LE(3, 4);
  volId.writeUInt32LE(0x12345678, 8);
  volId.writeUInt32LE(16, 12);
  const base = Buffer.concat([Buffer.from(targetPath, 'latin1'), Buffer.from([0])]);
  const suffix = Buffer.from([0]);
  const hdrSize = 0x1c;
  const info = Buffer.alloc(hdrSize);
  info.writeUInt32LE(hdrSize + volId.length + base.length + suffix.length, 0);
  info.writeUInt32LE(hdrSize, 4);
  info.writeUInt32LE(1, 8); // VolumeIDAndLocalBasePath
  info.writeUInt32LE(hdrSize, 12);
  info.writeUInt32LE(hdrSize + volId.length, 16);
  info.writeUInt32LE(0, 20);
  info.writeUInt32LE(hdrSize + volId.length + base.length, 24);

  const header = Buffer.alloc(76);
  header.writeUInt32LE(0x4c, 0);
  LNK_CLSID.copy(header, 4);
  let flags = 0x02 | 0x80; // HasLinkInfo | IsUnicode
  const parts = [Buffer.concat([info, volId, base, suffix])];
  if (args) {
    flags |= 0x20;
    parts.push(countedUtf16(args));
  }
  header.writeUInt32LE(flags, 20);
  return Buffer.concat([header, ...parts, Buffer.alloc(4)]);
}

function mkTemp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('safe build policy: risky repo actions are refused, read-only ones pass through, status never runs git', () => {
  for (const action of SAFE_BUILD_BLOCKED_ACTIONS) {
    const res = safeBuildRepoActionResponse({ action, confirm: true });
    assert.equal(res.ok, false, action);
    assert.equal(res.error, 'disabled_in_safe_build', action);
  }
  for (const action of ['pull', 'sync', 'apply-update', 'uninstall', 'archive-and-restart', 'addons-install', 'gomemlimit-set']) {
    assert.ok(SAFE_BUILD_BLOCKED_ACTIONS.has(action), `${action} must be blocked`);
  }
  for (const action of SAFE_BUILD_PASSTHROUGH_ACTIONS) {
    assert.equal(safeBuildRepoActionResponse({ action }), null, action);
  }
  const upd = safeBuildRepoActionResponse({ action: 'check-update' }, { version: '9.9.9' });
  assert.equal(upd.hasUpdate, false);
  assert.equal(upd.latestVersion, '9.9.9');

  for (const input of [{ action: 'status' }, {}, null, { action: 'something-new' }]) {
    const st = safeBuildRepoActionResponse(input, { version: '9.9.9', rootDir: path.join(ROOT, 'x') });
    assert.equal(st.ok, true);
    assert.equal(st.isGitRepo, false);
    assert.equal(st.hasRemote, false);
    assert.equal(st.hasUpdates, false);
  }
});

test('safe build stubs: update, add-on, GOMEMLIMIT and shortcut-guard modules hold no network, process or registry code', async () => {
  const stubFiles = [
    'sidecars/daemon/update-service.mjs',
    'sidecars/daemon/addon-registry.mjs',
    'sidecars/daemon/gomemlimit-service.mjs',
    'src/platform/shortcut-guard.cjs',
  ];
  const forbidden = /child_process|\bfetch\s*\(|node:https?\b|require\(['"]https?['"]\)|\bspawn\b|\bexecFile\b|reg(?:\.exe)?['"]?\s*,\s*\[|writeFileSync|https?:\/\//;
  for (const rel of stubFiles) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(forbidden.test(src), false, `${rel} must stay a stub (found ${String(src.match(forbidden))})`);
  }

  const svc = new UpdateService({ currentVersion: '1.0.0', channel: 'beta' });
  const checked = await svc.checkForUpdates({ manual: true });
  assert.equal(checked.hasUpdate, false);
  const applied = await svc.applyReleaseUpdate();
  assert.equal(applied.ok, false);
  assert.equal(applied.applied, false);

  const prevLab = process.env[ADDONS_LAB_ENV_VAR];
  process.env[ADDONS_LAB_ENV_VAR] = '1';
  try {
    assert.equal(isLabEnabled(), false, 'add-on lab must stay off even when its env var is set');
  } finally {
    if (prevLab === undefined) delete process.env[ADDONS_LAB_ENV_VAR];
    else process.env[ADDONS_LAB_ENV_VAR] = prevLab;
  }

  assert.equal((await getGoMemLimitStatus()).supported, false);
  assert.notEqual((await setGoMemLimit('2GiB')).ok, true);
  assert.notEqual((await clearGoMemLimit()).ok, true);

  const sync = shortcutGuard.ensureAntigravityShortcutsCdpFlag({ pluginDir: ROOT });
  assert.deepEqual(sync.patched, []);
  assert.deepEqual((await shortcutGuard.ensureAntigravityShortcutsCdpFlagAsync({ pluginDir: ROOT })).patched, []);
  assert.deepEqual(shortcutGuard.restoreAntigravityShortcutsCdpFlag({}).restored, []);

  assert.equal(RelaunchGuard.prototype.isRelaunchGuardAllowed.call({}), false, 'auto-relaunch must stay off');
});

test('safe build pickers never resolve an outside .exe, even when one is named explicitly or by env var', () => {
  const dir = mkTemp('prism-safe-picker-');
  try {
    const exe = path.join(dir, 'obsidian-prism-watcher.exe');
    fs.writeFileSync(exe, 'not really an exe');
    assert.equal(resolveWindowsWatcherExePath({ watcherExePath: exe }), null);
    assert.equal(resolveWindowsWatcherExePath({ env: { AG_PRISM_WATCHER_EXE: exe, LOCALAPPDATA: dir } }), null);
    assert.equal(resolveWindowsWatcherExePath({ rootDir: dir }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('safe build shortcut: adds a separate "Antigravity (Prism)" launcher shortcut, leaves the official one byte-identical, uninstall removes only ours', () => {
  const root = mkTemp('prism-safe-lnk-');
  const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';
  try {
    const startMenu = path.join(root, 'start');
    const desktop = path.join(root, 'desktop');
    const empty = path.join(root, 'empty');
    const pluginDir = path.join(root, 'plugin');
    for (const d of [startMenu, desktop, empty]) fs.mkdirSync(d);
    const official = buildLnk(AG_EXE, '--profile work');
    fs.writeFileSync(path.join(startMenu, 'Antigravity.lnk'), official);
    fs.writeFileSync(path.join(desktop, 'Antigravity.lnk'), official);
    // The first safe build pointed its shortcut straight at Antigravity.exe; it gets replaced.
    fs.writeFileSync(path.join(desktop, prismLnk.PRISM_SHORTCUT_NAME), buildLnk(AG_EXE, '--profile work --remote-debugging-port=0'));

    const created = prismLnk.createPrismShortcuts({ dirs: [startMenu, desktop, empty], platform: 'win32', pluginDir, nodeExe: NODE_EXE });
    assert.equal(created.created.length, 2, JSON.stringify(created.skipped));
    assert.equal(created.skipped.length, 1, 'a folder without the official shortcut is skipped');

    const launcherPath = prismLnk.getLauncherPath(pluginDir);
    for (const d of [startMenu, desktop]) {
      assert.ok(fs.readFileSync(path.join(d, 'Antigravity.lnk')).equals(official), 'official shortcut must not change');
      const buf = fs.readFileSync(path.join(d, prismLnk.PRISM_SHORTCUT_NAME));
      const ours = parseWindowsLnkBuffer(buf);
      assert.equal(ours.targetPath, NODE_EXE);
      assert.equal(ours.arguments, `"${launcherPath}" --exe "${AG_EXE}" -- --profile work`);
      assert.equal(ours.workingDir, path.win32.dirname(AG_EXE));
      assert.equal(ours.iconLocation, AG_EXE);
      assert.equal(buf.readUInt32LE(60), 7, 'starts minimised');
      assert.equal(buf.readUInt32LE(20) & 0x01, 0x01, 'carries a LinkTargetIDList so Explorer can launch it');
      assert.ok(buf.includes(Buffer.from('node.exe\0', 'latin1')), 'ID list ends at node.exe');
    }
    assert.deepEqual(prismLnk.listPrismShortcuts({ dirs: [startMenu, desktop, empty] }).length, 2);
    assert.deepEqual(prismLnk.createPrismShortcuts({ dirs: [startMenu], platform: 'win32', pluginDir, nodeExe: AG_EXE }).created, [], 'only node.exe may be the target');

    // A same-named file we did not make is never overwritten or deleted.
    const decoyDir = path.join(root, 'decoy');
    fs.mkdirSync(decoyDir);
    fs.writeFileSync(path.join(decoyDir, 'Antigravity.lnk'), official);
    const decoy = buildLnk('C:\\Windows\\notepad.exe');
    fs.writeFileSync(path.join(decoyDir, prismLnk.PRISM_SHORTCUT_NAME), decoy);
    assert.equal(prismLnk.createPrismShortcuts({ dirs: [decoyDir], platform: 'win32', pluginDir, nodeExe: NODE_EXE }).created.length, 0);
    assert.ok(fs.readFileSync(path.join(decoyDir, prismLnk.PRISM_SHORTCUT_NAME)).equals(decoy));

    const removed = prismLnk.removePrismShortcuts({ dirs: [startMenu, desktop, decoyDir], platform: 'win32' });
    assert.equal(removed.removed.length, 2);
    assert.equal(fs.existsSync(path.join(decoyDir, prismLnk.PRISM_SHORTCUT_NAME)), true);
    for (const d of [startMenu, desktop]) {
      assert.equal(fs.existsSync(path.join(d, prismLnk.PRISM_SHORTCUT_NAME)), false);
      assert.ok(fs.readFileSync(path.join(d, 'Antigravity.lnk')).equals(official));
    }

    assert.deepEqual(prismLnk.createPrismShortcuts({ dirs: [startMenu], platform: 'linux' }).created, []);
    assert.deepEqual(prismLnk.prismShortcutsForInstall({}, false, 'win32').created, [], 'off unless asked or default install');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safe build launcher: opens Antigravity with the debug flag and starts one hidden daemon that quits with Antigravity', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { pid: 777, on() {}, unref() {} };
  };
  const base = {
    argv: ['node', 'prism-launch.cjs', '--exe', AG_EXE, '--', '--profile', 'work', '--remote-debugging-port=9222'],
    pluginRoot: 'C:\\plug',
    execPath: 'C:\\node\\node.exe',
    env: { KEEP: '1' },
    spawnFn,
    existsSync: () => true,
    daemonRunning: () => false,
  };
  const res = launcher.launch(base);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, AG_EXE);
  assert.deepEqual(calls[0].args, ['--profile', 'work', '--remote-debugging-port=0'], 'any other port is replaced by a random one');
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[1].cmd, 'C:\\node\\node.exe');
  assert.deepEqual(calls[1].args, ['--max-semi-space-size=4', 'main.mjs']);
  assert.equal(calls[1].opts.cwd, path.join('C:\\plug', 'sidecars', 'daemon'));
  assert.equal(calls[1].opts.windowsHide, true);
  assert.equal(calls[1].opts.env.PRISM_EXIT_WHEN_HOST_GONE, '1');
  assert.equal(calls[1].opts.env.PRISM_NO_PARENT_WATCHDOG, '1');
  assert.equal(calls[1].opts.env.KEEP, '1');

  calls.length = 0;
  assert.equal(launcher.launch({ ...base, daemonRunning: () => true }).daemon, 'already-running');
  assert.equal(calls.length, 1, 'no second daemon when one is running');

  calls.length = 0;
  assert.equal(launcher.launch({ ...base, argv: ['node', 'x', '--exe', 'C:\\Windows\\notepad.exe'] }).ok, false);
  assert.equal(launcher.launch({ ...base, existsSync: () => false }).ok, false);
  assert.equal(calls.length, 0, 'never starts anything but an existing Antigravity.exe');

  const dir = mkTemp('prism-safe-launch-');
  try {
    assert.equal(launcher.isDaemonRunning(dir, () => ({ imageName: 'node.exe' })), false, 'no lock file');
    fs.writeFileSync(path.join(dir, '.daemon.pid'), JSON.stringify({ pid: 4242, startedAt: 1_000_000 }));
    const node = { imageName: 'node.exe', commandLine: 'node main.mjs', processStartMs: 1_000_500 };
    assert.equal(launcher.isDaemonRunning(dir, () => node), true);
    assert.equal(launcher.isDaemonRunning(dir, () => null), false, 'dead pid');
    assert.equal(launcher.isDaemonRunning(dir, () => ({ ...node, processStartMs: 9_000_000 })), false, 'reused pid');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('safe build daemon: launcher-started daemon quits a minute after the debug port goes away, never sooner', async () => {
  assert.equal(startHostGoneWatchdog({}, { env: {} }), null, 'off unless the launcher asked for it');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const env = { PRISM_EXIT_WHEN_HOST_GONE: '1' };
  const keepAlive = setTimeout(() => {}, 30000);
  try {
    let clock = 5_000_000;
    let active = true;
    const stops = [];
    const daemon = { log() {}, stop: async (...args) => { stops.push(args); } };
    let exitCode = null;
    const exited = new Promise((resolve) => {
      startHostGoneWatchdog(daemon, { env, intervalMs: 1000, now: () => clock, isHostActive: () => active, exit: (c) => { exitCode = c; resolve(); } });
    });
    await sleep(1150); // sees the port
    active = false;
    clock += 30_000;
    await sleep(1100);
    assert.equal(exitCode, null, '30 s without the port is not enough');
    clock += 31_000;
    await exited;
    assert.equal(exitCode, 0);
    assert.deepEqual(stops, [[false, { skipAutoArchive: true }]]);

    // Never saw a port at all: gives up after the start-up grace period.
    let clock2 = 7_000_000;
    const exited2 = new Promise((resolve) => {
      startHostGoneWatchdog(daemon, { env, intervalMs: 1000, now: () => clock2, isHostActive: () => false, exit: resolve });
      clock2 += 181_000;
    });
    assert.equal(await exited2, 0);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('safe build installer: no detached daemon unless --start-daemon, and no repo-meta.json link', async () => {
  assert.equal(installer.parseCliArgs(['node', 'install-plugin.cjs', '--install']).noDaemon, true);
  assert.equal(installer.parseCliArgs(['node', 'install-plugin.cjs', '--install', '--start-daemon']).noDaemon, false);

  const src = fs.readFileSync(path.join(ROOT, 'tools', 'install-plugin.cjs'), 'utf8');
  assert.ok(src.includes('const startDaemon = opts.startDaemon === true;'));
  assert.equal(src.includes('"repo-meta.json"'), false, 'installer must not write repo-meta.json');
});

test('safe build daemon: parent-exit watchdog stops the daemon without auto-archive and exits 0', async () => {
  let alive = true;
  const stopCalls = [];
  const fakeDaemon = { log() {}, stop: async (...args) => { stopCalls.push(args); } };
  assert.equal(startParentExitWatchdog(fakeDaemon, { parentPid: 1, isAlive: () => true }), null, 'pid 1 is ignored');
  assert.equal(startParentExitWatchdog(fakeDaemon, { parentPid: 4242, isAlive: () => false }), null, 'already-dead parent is ignored');

  const keepAlive = setTimeout(() => {}, 10000);
  try {
    const exitCode = await new Promise((resolve) => {
      startParentExitWatchdog(fakeDaemon, { parentPid: 4242, intervalMs: 10, isAlive: () => alive, exit: resolve });
      alive = false;
    });
    assert.equal(exitCode, 0);
    assert.equal(stopCalls.length, 1);
    assert.deepEqual(stopCalls[0], [false, { skipAutoArchive: true }]);
  } finally {
    clearTimeout(keepAlive);
  }

  const prev = process.env.PRISM_NO_PARENT_WATCHDOG;
  process.env.PRISM_NO_PARENT_WATCHDOG = '1';
  try {
    assert.equal(startParentExitWatchdog(fakeDaemon, { parentPid: 4242, isAlive: () => true }), null);
  } finally {
    if (prev === undefined) delete process.env.PRISM_NO_PARENT_WATCHDOG;
    else process.env.PRISM_NO_PARENT_WATCHDOG = prev;
  }
});
