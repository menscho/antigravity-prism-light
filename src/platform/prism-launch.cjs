#!/usr/bin/env node
// Obsidian Prism — SAFE BUILD launcher (src/platform/prism-launch.cjs)
//
// Added 2026-11-27 for the safe build (GPL-3.0, derived from RMvdesi/obsidian-prism).
//
// The "Antigravity (Prism)" shortcut runs this file with node.exe:
//
//   node prism-launch.cjs --exe "C:\...\Antigravity.exe" -- <the official shortcut's own arguments>
//
// It does two things and exits:
//   1. starts Antigravity.exe with --remote-debugging-port=0
//   2. starts the Prism daemon (hidden) unless one is already running. The
//      daemon is told to quit about a minute after Antigravity's debug port goes
//      away, so nothing keeps running after you close Antigravity.
//
// Why a launcher: when Antigravity runs its language server in WSL, plugin
// sidecars start inside Linux and never reach the Windows-side daemon. This
// launcher works the same whether the language server is native or in WSL.
// It installs nothing, schedules nothing and adds nothing to Windows startup.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isAntigravityShortcutTarget } = require('./shortcut-flags.cjs');
const { inspectProcessSync, matchesExpectedDaemonSignature } = require('./process-probe.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const CDP_FLAG = '--remote-debugging-port=0';
const DAEMON_NODE_FLAGS = ['--max-semi-space-size=4'];

function parseLaunchArgs(argv) {
  const args = argv.slice(2);
  let exe = null;
  let extra = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exe' && args[i + 1]) exe = args[++i];
    else if (args[i] === '--') {
      extra = args.slice(i + 1);
      break;
    }
  }
  return { exe, extra };
}

// True when the .daemon.pid lock names a live Prism daemon (guards against PID reuse).
function isDaemonRunning(pluginRoot, inspect = inspectProcessSync) {
  try {
    const raw = fs.readFileSync(path.join(pluginRoot, '.daemon.pid'), 'utf8').trim();
    const lock = raw.startsWith('{') ? JSON.parse(raw) : { pid: Number(raw) };
    const pid = Number(lock && lock.pid);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const info = inspect(pid);
    if (!info) return false;
    return matchesExpectedDaemonSignature(info.imageName, info.commandLine, {
      matchedLockPid: true,
      lockStartedAt: Number(lock.startedAt) || 0,
      processStartMs: Number(info.processStartMs || info.startTime) || 0,
    });
  } catch {
    return false;
  }
}

function launch({
  argv = process.argv,
  pluginRoot = PLUGIN_ROOT,
  execPath = process.execPath,
  env = process.env,
  spawnFn = spawn,
  existsSync = fs.existsSync,
  daemonRunning = () => isDaemonRunning(pluginRoot),
} = {}) {
  const { exe, extra } = parseLaunchArgs(argv);
  if (!exe || !isAntigravityShortcutTarget(exe) || !existsSync(exe)) {
    return { ok: false, error: 'antigravity-exe-not-found', exe };
  }

  const agArgs = extra.filter((a) => !/^--remote-debugging-port(?:=|$)/i.test(a));
  agArgs.push(CDP_FLAG);
  const ag = spawnFn(exe, agArgs, { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
  if (ag && typeof ag.on === 'function') ag.on('error', () => {});
  if (ag && typeof ag.unref === 'function') ag.unref();

  if (daemonRunning()) return { ok: true, antigravityArgs: agArgs, daemon: 'already-running' };

  const daemonDir = path.join(pluginRoot, 'sidecars', 'daemon');
  const daemon = spawnFn(execPath, [...DAEMON_NODE_FLAGS, 'main.mjs'], {
    cwd: daemonDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...env, PRISM_NO_PARENT_WATCHDOG: '1', PRISM_EXIT_WHEN_HOST_GONE: '1' },
  });
  if (daemon && typeof daemon.on === 'function') daemon.on('error', () => {});
  if (daemon && typeof daemon.unref === 'function') daemon.unref();
  return { ok: true, antigravityArgs: agArgs, daemon: 'started', daemonPid: daemon && daemon.pid };
}

module.exports = { PLUGIN_ROOT, CDP_FLAG, parseLaunchArgs, isDaemonRunning, launch };

if (require.main === module) {
  const res = launch();
  if (!res.ok) process.exitCode = 1;
}
