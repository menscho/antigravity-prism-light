// 跨平台脱离宿主重启微助手：app_storage.json 3 次重试保护、回环 CDP Browser.close 与 --run-relaunch-task 执行器
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const {
  APP_DATA,
  isSymlinkPathSync,
  assertSafeRegularFileSync,
  writeFileAtomicNoSymlinkSync,
} = require('../utils/fs-safe.cjs');
const { isEligibleTarget, isSwarmSidecarUrl } = require('../cdp/transport.cjs');
const { parseWindowsTasklistCsv } = require('./process-probe.cjs');
const { CDP_OPT_IN_SWITCH, isAntigravityShortcutTarget } = require('./shortcut-flags.cjs');
const {
  resolveWindowsDetachedNodeRuntime,
  normalizeLoopbackPort,
  readPortFromCustomOrDefaultFile,
  isAntigravityCdpVersionInfo,
  resolveInstalledAntigravityExeWin,
} = require('./host-relaunch.cjs');

let _runInBgRec = null;
try {
  _runInBgRec = require('./run-in-bg-recovery.cjs');
} catch {}

// 纯 Node Windows 脱离重启引擎（零 PowerShell/WMI）
const APP_STORAGE_MAX_BYTES = 8 * 1024 * 1024;
const APP_STORAGE_RESTORE_RETRIES = 3;
const APP_STORAGE_RESTORE_RETRY_DELAY_MS = 50;
const RELAUNCH_TASK_MAX_BYTES = 1024 * 1024;

function getAntigravityAppStoragePath(opts = {}) {
  if (opts && typeof opts.appStoragePath === 'string' && opts.appStoragePath.trim()) {
    return path.resolve(opts.appStoragePath.trim());
  }
  const baseAppData =
    (opts && opts.appDataDir) ||
    (opts && opts.env && opts.env.APPDATA) ||
    APP_DATA;
  return path.join(baseAppData, 'Antigravity', 'app_storage.json');
}

function suspendAntigravityRunInBackground(appStoragePath, opts = {}) {
  const targetPath = getAntigravityAppStoragePath({ appStoragePath });
  if (!fs.existsSync(targetPath)) {
    return { modified: false, originalValue: undefined, path: targetPath, skippedReason: 'not-found' };
  }
  let resolved;
  let markerPath = '';
  try {
    ({ resolved } = assertSafeRegularFileSync(targetPath, APP_STORAGE_MAX_BYTES));
  } catch (err) {
    return { modified: false, originalValue: undefined, path: targetPath, skippedReason: String(err && err.message ? err.message : err) };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { modified: false, originalValue: undefined, path: resolved, skippedReason: 'invalid-json-object' };
    }
    const cur = parsed.runInBackground;
    if (cur !== 'true' && cur !== true) return { modified: false, originalValue: cur, path: resolved };
    if (_runInBgRec) markerPath = _runInBgRec.writePendingRunInBgRestoreMarker(resolved, cur, opts);
    parsed.runInBackground = typeof cur === 'boolean' ? false : 'false';
    const wf =
      typeof opts.writeFileSync === 'function'
        ? opts.writeFileSync
        : (p, d) => writeFileAtomicNoSymlinkSync(p, d, { maxBytes: APP_STORAGE_MAX_BYTES });
    wf(resolved, JSON.stringify(parsed, null, 2) + '\n');
    return { modified: true, originalValue: cur, path: resolved, markerPath };
  } catch (err) {
    if (markerPath && _runInBgRec) _runInBgRec.clearPendingRunInBgRestoreMarker(markerPath);
    return { modified: false, originalValue: undefined, path: resolved, skippedReason: String(err && err.message ? err.message : err) };
  }
}

async function restoreAntigravityRunInBackground(appStoragePath, suspendState, opts = {}) {
  if (!suspendState || !suspendState.modified) return { restored: false, skipped: true, attempts: 0 };
  const targetPath = suspendState.path || getAntigravityAppStoragePath({ appStoragePath });
  const retries = Number.isInteger(opts.retries) && opts.retries > 0 ? opts.retries : APP_STORAGE_RESTORE_RETRIES;
  const retryDelayMs =
    Number.isFinite(Number(opts.retryDelayMs)) && Number(opts.retryDelayMs) >= 0
      ? Number(opts.retryDelayMs)
      : APP_STORAGE_RESTORE_RETRY_DELAY_MS;
  const sleepFn = typeof opts.sleep === 'function' ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const rf = typeof opts.readFileSync === 'function' ? opts.readFileSync : (p) => fs.readFileSync(p, 'utf8');
  const wf =
    typeof opts.writeFileSync === 'function'
      ? opts.writeFileSync
      : (p, d) => writeFileAtomicNoSymlinkSync(p, d, { maxBytes: APP_STORAGE_MAX_BYTES });
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { resolved } = assertSafeRegularFileSync(targetPath, APP_STORAGE_MAX_BYTES);
      const latestObj = JSON.parse(String(rf(resolved) || '').replace(/^\uFEFF/, ''));
      if (!latestObj || typeof latestObj !== 'object' || Array.isArray(latestObj)) {
        throw new Error('Invalid app_storage.json root object');
      }
      latestObj.runInBackground = suspendState.originalValue;
      wf(resolved, JSON.stringify(latestObj, null, 2) + '\n');
      if (_runInBgRec) {
        _runInBgRec.clearPendingRunInBgRestoreMarker(
          suspendState.markerPath || _runInBgRec.resolvePendingRestoreMarkerPath(resolved, opts)
        );
      }
      return { restored: true, attempts: attempt, path: resolved, restoredValue: suspendState.originalValue };
    } catch (err) {
      lastErr = err;
      if (attempt < retries && retryDelayMs > 0) await sleepFn(retryDelayMs);
    }
  }
  return {
    restored: false,
    attempts: retries,
    path: targetPath,
    error: String(lastErr && lastErr.message ? lastErr.message : lastErr),
  };
}

function isAntigravityCdpCloseTarget(target) {
  if (!target || !target.webSocketDebuggerUrl) return false;
  const url = String(target.url || '').trim();
  const title = String(target.title || '').trim();
  if (!url) return false;
  if (isSwarmSidecarUrl(url)) return true;
  if (target.type !== 'page') return false;
  if (/\bvisual studio code\b/i.test(title) && !/\bantigravity\b/i.test(title)) {
    return false;
  }
  return isEligibleTarget(target);
}

// 通过本机回环 CDP 发送 Browser.close（严格双重校验 /json/version 与 /json/list 属于 Antigravity；严禁调用 timer.unref 避免 Node 22 早退）
async function requestLoopbackCdpBrowserClose(cdpPort, opts = {}) {
  const port = normalizeLoopbackPort(cdpPort);
  if (!port) return false;
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : globalThis.fetch;
  const WsCtor = typeof opts.WebSocketCtor === 'function' ? opts.WebSocketCtor : globalThis.WebSocket;
  if (typeof fetchImpl !== 'function' || typeof WsCtor !== 'function') return false;
  const timeoutMs = Math.max(200, Math.min(8000, Number(opts.timeoutMs) || 2500));

  const fetchJsonLoopback = async (endpointPath) => {
    const controller = new AbortController();
    const fetchTimer = setTimeout(() => controller.abort(), Math.min(1500, timeoutMs));
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}${endpointPath}`, { signal: controller.signal });
      if (!res || !res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(fetchTimer);
    }
  };

  const versionInfo = await fetchJsonLoopback('/json/version');
  if (!isAntigravityCdpVersionInfo(versionInfo, port)) {
    return false;
  }
  const targets = await fetchJsonLoopback('/json/list');
  if (!Array.isArray(targets) || !targets.some(isAntigravityCdpCloseTarget)) {
    return false;
  }

  const wsUrl = String(versionInfo.webSocketDebuggerUrl).trim();
  return new Promise((resolve) => {
    let settled = false;
    let sent = false;
    let ws = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (ws && typeof ws.close === 'function') ws.close();
      } catch {}
      resolve(Boolean(ok));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WsCtor(wsUrl);
    } catch {
      finish(false);
      return;
    }
    const onOpen = () => {
      try {
        ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        sent = true;
      } catch {
        finish(false);
      }
    };
    const onMessage = (evt) => {
      try {
        const raw = typeof evt === 'string' ? evt : evt && evt.data;
        const msg = JSON.parse(String(raw || ''));
        if (msg && msg.id === 1) {
          finish(!msg.error);
        }
      } catch {}
    };
    const onClose = () => finish(sent);
    const onError = () => finish(false);
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose, { once: true });
      ws.addEventListener('error', onError, { once: true });
    } else if (typeof ws.on === 'function') {
      ws.once('open', onOpen);
      ws.on('message', onMessage);
      ws.once('close', onClose);
      ws.once('error', onError);
    } else {
      finish(false);
    }
  });
}

function normalizeMacAppBundlePath(rawPath) {
  const s = String(rawPath || '').trim();
  if (!s) return '/Applications/Antigravity.app';
  const m = /^(.+?\.app)(?:\/.*)?$/i.exec(s);
  if (m && m[1]) return m[1];
  return '/Applications/Antigravity.app';
}

const MAC_DETACHED_RELAUNCH_SH = [
  'target_pid="$1"',
  'app_path="$2"',
  'if [ -z "$app_path" ]; then app_path="/Applications/Antigravity.app"; fi',
  'unset ELECTRON_RUN_AS_NODE',
  'osascript -e \'on run argv\' -e \'tell application (item 1 of argv) to quit\' -e \'end run\' "$app_path" >/dev/null 2>&1 || osascript -e \'tell application "Antigravity" to quit\' >/dev/null 2>&1 || kill -TERM "$target_pid" >/dev/null 2>&1 || true',
  'lock_file="$HOME/Library/Application Support/Antigravity/SingletonLock"',
  'bundle_prefix="$app_path/Contents/MacOS/"',
  'i=0',
  'exited=0',
  'while [ "$i" -lt 120 ]; do',
  '  main_alive=0',
  '  helper_alive=0',
  '  lock_alive=0',
  '  if kill -0 "$target_pid" >/dev/null 2>&1; then main_alive=1; fi',
  '  if ps -ax -o command= 2>/dev/null | grep -F -- "$bundle_prefix" | grep -v grep >/dev/null 2>&1; then helper_alive=1; fi',
  '  if [ -e "$lock_file" ] || [ -L "$lock_file" ]; then lock_alive=1; fi',
  '  if [ "$main_alive" -eq 0 ] && [ "$helper_alive" -eq 0 ] && [ "$lock_alive" -eq 0 ]; then exited=1; break; fi',
  '  if [ "$i" -eq 40 ] && [ "$main_alive" -eq 1 ]; then kill -TERM "$target_pid" >/dev/null 2>&1 || true; fi',
  '  sleep 0.25',
  '  i=$((i + 1))',
  'done',
  'if [ "$exited" -ne 1 ] && kill -0 "$target_pid" >/dev/null 2>&1; then exit 0; fi',
  'sleep 0.5',
  'open -na "$app_path" --args --remote-debugging-port=0 >/dev/null 2>&1 &',
].join('\n');

// 纯 POSIX sh 脱离重启脚本（所有动态参数经位置参数 "$1" "$2" 传入，零拼接、零强制终止、零宿主归档修改）
const LINUX_DETACHED_RELAUNCH_SH = [
  'target_pid="$1"',
  'exe_path="$2"',
  'unset ELECTRON_RUN_AS_NODE',
  'resolve_exe() {',
  '  if [ -n "$exe_path" ] && [ -x "$exe_path" ]; then',
  '    printf \'%s\\n\' "$exe_path"',
  '    return 0',
  '  fi',
  '  for cand in "/usr/share/antigravity/antigravity" "/opt/Antigravity/antigravity" "/usr/bin/antigravity" "$HOME/.local/bin/antigravity"; do',
  '    if [ -x "$cand" ]; then',
  '      printf \'%s\\n\' "$cand"',
  '      return 0',
  '    fi',
  '  done',
  '  if command -v antigravity >/dev/null 2>&1; then',
  '    command -v antigravity',
  '    return 0',
  '  fi',
  '  return 1',
  '}',
  'kill -TERM "$target_pid" >/dev/null 2>&1 || true',
  'xdg_cfg="${XDG_CONFIG_HOME:-$HOME/.config}"',
  'lock_file="$xdg_cfg/Antigravity/SingletonLock"',
  'i=0',
  'exited=0',
  'while [ "$i" -lt 120 ]; do',
  '  main_alive=0',
  '  lock_alive=0',
  '  if kill -0 "$target_pid" >/dev/null 2>&1; then main_alive=1; fi',
  '  if [ -L "$lock_file" ]; then',
  '    link_dest="$(readlink "$lock_file" 2>/dev/null || true)"',
  '    lock_pid="${link_dest##*-}"',
  '    case "$lock_pid" in',
  '      \'\'|*[!0-9]*) lock_alive=1 ;;',
  '      *) if kill -0 "$lock_pid" >/dev/null 2>&1; then lock_alive=1; fi ;;',
  '    esac',
  '  elif [ -e "$lock_file" ]; then',
  '    lock_alive=1',
  '  fi',
  '  if [ "$main_alive" -eq 0 ] && [ "$lock_alive" -eq 0 ]; then exited=1; break; fi',
  '  if [ "$i" -eq 40 ] && [ "$main_alive" -eq 1 ]; then kill -TERM "$target_pid" >/dev/null 2>&1 || true; fi',
  '  sleep 0.25',
  '  i=$((i + 1))',
  'done',
  'if [ "$exited" -ne 1 ] && kill -0 "$target_pid" >/dev/null 2>&1; then exit 0; fi',
  'sleep 0.5',
  'env_conf="$xdg_cfg/environment.d/90-obsidian-prism-gomemlimit.conf"',
  'if [ -f "$env_conf" ] && [ ! -L "$env_conf" ]; then',
  '  gomem_line="$(grep -E \'^GOMEMLIMIT=([0-9]+(B|KiB|MiB|GiB|TiB))$\' "$env_conf" 2>/dev/null | head -n 1 || true)"',
  '  if [ -n "$gomem_line" ]; then',
  '    export GOMEMLIMIT="${gomem_line#GOMEMLIMIT=}"',
  '  fi',
  'fi',
  'launch_exe="$(resolve_exe || true)"',
  'if [ -z "$launch_exe" ]; then exit 0; fi',
  'nohup "$launch_exe" --remote-debugging-port=0 >/dev/null 2>&1 </dev/null &',
].join('\n');

function createRelaunchHelper({ rootDir = path.resolve(__dirname, '..', '..'), collectKnownPrismDaemonPids } = {}) {
  const defaultHelperPath = path.join(rootDir, 'cdp.js');

  function isWindowsAntigravityHostAliveSync(hostPid, opts = {}) {
    const pid = Number(hostPid);
    const excluded = collectKnownPrismDaemonPids ? collectKnownPrismDaemonPids(opts) : new Set([process.pid]);
    if (Number.isInteger(pid) && pid > 0 && !excluded.has(pid)) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        if (err && err.code === 'EPERM') return true;
      }
    }
    const targetExe = String((opts && opts.exePath) || '').trim();
    if (targetExe && !isAntigravityShortcutTarget(targetExe)) {
      return false;
    }
    const execSyncFn = typeof opts.execFileSyncFn === 'function' ? opts.execFileSyncFn : execFileSync;
    try {
      const out = execSyncFn(
        'tasklist',
        ['/FI', 'IMAGENAME eq Antigravity.exe', '/FO', 'CSV', '/NH'],
        { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const rows = parseWindowsTasklistCsv(out);
      return rows.some((r) => r.imageName.toLowerCase() === 'antigravity.exe' && !excluded.has(r.pid));
    } catch {
      return false;
    }
  }

  async function runWindowsDetachedRelaunchTask(task = {}, hooks = {}) {
    const hostPid = Number(task && task.hostPid) || 0;
    const exePath = String((task && task.exePath) || '').trim() || resolveInstalledAntigravityExeWin();
    const launchArgs =
      Array.isArray(task && task.args) && task.args.length > 0
        ? task.args.map((a) => String(a))
        : [CDP_OPT_IN_SWITCH];
    const maxWaitMs = Math.max(200, Math.min(180000, Number(task && task.maxWaitMs) || 25000));
    const pollMs = Math.max(20, Math.min(2000, Number(task && task.pollMs) || 250));
    const settleMs = Math.max(0, Math.min(10000, Number((task && task.settleMs) ?? 350)));
    const appStoragePath = getAntigravityAppStoragePath({
      appStoragePath: task && task.appStoragePath,
    });
    const cdpPort =
      normalizeLoopbackPort(task && task.cdpPort) ||
      normalizeLoopbackPort(readPortFromCustomOrDefaultFile((task && task.portFile) || null));

    const sleepFn = typeof hooks.sleep === 'function' ? hooks.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
    const suspendFn =
      typeof hooks.suspendRunInBackground === 'function'
        ? hooks.suspendRunInBackground
        : (p) => suspendAntigravityRunInBackground(p);
    const restoreFn =
      typeof hooks.restoreRunInBackground === 'function'
        ? hooks.restoreRunInBackground
        : (p, st) => restoreAntigravityRunInBackground(p, st, hooks.restoreOpts || {});
    const requestCdpCloseFn =
      typeof hooks.requestCdpClose === 'function'
        ? hooks.requestCdpClose
        : (p) => requestLoopbackCdpBrowserClose(p, hooks.cdpCloseOpts || {});
    const isHostStillRunningFn =
      typeof hooks.isHostStillRunning === 'function'
        ? hooks.isHostStillRunning
        : () => isWindowsAntigravityHostAliveSync(hostPid, { excludePids: task && task.excludePids, exePath });
    const spawnFn = typeof hooks.spawnFn === 'function' ? hooks.spawnFn : spawn;
    const existsFn = typeof hooks.existsSync === 'function' ? hooks.existsSync : fs.existsSync;

    if (!hooks.launchHost && !hooks.spawnFn && (!exePath || !existsFn(exePath))) {
      return { relaunched: false, reason: 'missing-exe', exePath };
    }

    let suspendState = null;
    let restoreRes = null;
    let cdpClosed = false;
    let exited = false;

    try {
      suspendState = suspendFn(appStoragePath);
      if (cdpPort > 0) {
        try {
          cdpClosed = Boolean(await requestCdpCloseFn(cdpPort));
        } catch {
          cdpClosed = false;
        }
      }
      const deadline = Date.now() + maxWaitMs;
      while (Date.now() <= deadline) {
        const alive = await isHostStillRunningFn(hostPid, exePath);
        if (!alive) {
          exited = true;
          break;
        }
        await sleepFn(pollMs);
      }
    } finally {
      if (suspendState && suspendState.modified) {
        restoreRes = await restoreFn(appStoragePath, suspendState);
      }
    }

    if (!exited) {
      return {
        relaunched: false,
        reason: 'host-did-not-exit',
        exePath,
        cdpClosed,
        suspendState,
        restoreRes,
      };
    }

    if (settleMs > 0) {
      await sleepFn(settleMs);
    }

    if (typeof hooks.launchHost === 'function') {
      const ok = await hooks.launchHost(exePath, launchArgs);
      return {
        relaunched: Boolean(ok !== false),
        exePath,
        args: launchArgs,
        cdpClosed,
        suspendState,
        restoreRes,
      };
    }

    const cleanEnv = { ...(hooks.env || process.env) };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    try {
      const child = spawnFn(exePath, launchArgs, {
        cwd: path.dirname(exePath),
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
        env: cleanEnv,
      });
      if (child && typeof child.on === 'function') child.on('error', () => {});
      if (child && typeof child.unref === 'function') child.unref();
      return {
        relaunched: Boolean(child),
        pid: (child && child.pid) || null,
        exePath,
        args: launchArgs,
        cdpClosed,
        suspendState,
        restoreRes,
      };
    } catch (err) {
      return {
        relaunched: false,
        reason: 'launch-failed',
        error: String(err && err.message ? err.message : err),
        exePath,
        args: launchArgs,
        cdpClosed,
        suspendState,
        restoreRes,
      };
    }
  }

  // 派生物理脱离宿主进程树与 Job Object 的独立微进程执行「温和退出 -> 等单实例锁释放 -> 带参重开」
  function spawnDetachedHostRelaunchHelper(task, opts = {}) {
    const hostPid = Number(task && task.hostPid);
    if (!Number.isInteger(hostPid) || hostPid <= 0) {
      return { spawned: false, reason: 'invalid-pid' };
    }
    if (typeof opts.spawnHook === 'function') {
      return opts.spawnHook({
        hostPid,
        exePath: task.exePath || '',
        args: [CDP_OPT_IN_SWITCH],
      });
    }
    const effectivePlatform = opts.platformOverride || process.platform;
    const spawnFn = typeof opts.spawnFn === 'function' ? opts.spawnFn : spawn;
    if (effectivePlatform === 'win32') {
      const privateStateDir = opts.stateDir
        ? path.resolve(opts.stateDir)
        : path.join(os.homedir(), '.gemini', 'config', 'plugins', 'obsidian-prism');
      if (isSymlinkPathSync(privateStateDir)) {
        return { spawned: false, reason: 'symlink-state-dir' };
      }
      fs.mkdirSync(privateStateDir, { recursive: true });
      const privateTaskFile = path.join(
        privateStateDir,
        `.relaunch-task-${crypto.randomBytes(6).toString('hex')}.json`
      );
      const resolvedExe =
        String((task && task.exePath) || '').trim() ||
        resolveInstalledAntigravityExeWin(opts);
      const taskPayload = {
        schema: 1,
        hostPid,
        exePath: resolvedExe,
        args: Array.isArray(task.args) && task.args.length > 0 ? task.args : [CDP_OPT_IN_SWITCH],
        cdpPort: normalizeLoopbackPort(task.cdpPort) || normalizeLoopbackPort(readPortFromCustomOrDefaultFile(task.portFile || null)),
        appStoragePath: task.appStoragePath ? path.resolve(String(task.appStoragePath)) : getAntigravityAppStoragePath(opts),
        maxWaitMs: Number(task.maxWaitMs) || 25000,
        pollMs: Number(task.pollMs) || 250,
        settleMs: task.settleMs !== undefined ? Number(task.settleMs) : 350,
      };
      writeFileAtomicNoSymlinkSync(privateTaskFile, JSON.stringify(taskPayload, null, 2) + '\n', {
        maxBytes: RELAUNCH_TASK_MAX_BYTES,
        mode: 0o600,
      });

      const runtime = resolveWindowsDetachedNodeRuntime(opts);
      const helperPath = path.resolve(opts.helperPath || defaultHelperPath);
      const cleanEnv = { ...(opts.env || process.env) };
      if (runtime.useElectronAsNode) {
        cleanEnv.ELECTRON_RUN_AS_NODE = '1';
      } else {
        delete cleanEnv.ELECTRON_RUN_AS_NODE;
      }

      try {
        const child = spawnFn(runtime.execPath, [helperPath, '--run-relaunch-task', privateTaskFile], {
          cwd: path.dirname(helperPath),
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: cleanEnv,
        });
        if (child && typeof child.on === 'function') child.on('error', () => {});
        if (child && typeof child.unref === 'function') child.unref();
        return {
          spawned: Boolean(child),
          pid: (child && child.pid) || null,
          method: 'node-detached-helper',
          taskFile: privateTaskFile,
          useElectronAsNode: runtime.useElectronAsNode,
        };
      } catch (err) {
        try { fs.unlinkSync(privateTaskFile); } catch {}
        return {
          spawned: false,
          reason: 'spawn-failed',
          error: String(err && err.message ? err.message : err),
        };
      }
    }

    if (effectivePlatform === 'darwin') {
      const appPath = normalizeMacAppBundlePath(task.exePath);
      const cleanEnv = { ...process.env };
      delete cleanEnv.ELECTRON_RUN_AS_NODE;
      const child = spawnFn('/usr/bin/nohup', ['/bin/sh', '-c', MAC_DETACHED_RELAUNCH_SH, 'sh', String(hostPid), appPath], {
        detached: true,
        stdio: 'ignore',
        env: cleanEnv,
      });
      if (child && typeof child.unref === 'function') child.unref();
      return { spawned: true, pid: (child && child.pid) || null, method: 'nohup-sh', appPath };
    }

    if (effectivePlatform === 'linux') {
      const exePath = String(task.exePath || '').trim();
      const cleanEnv = { ...(opts.env || process.env) };
      delete cleanEnv.ELECTRON_RUN_AS_NODE;
      const child = spawnFn('/bin/sh', ['-c', LINUX_DETACHED_RELAUNCH_SH, '--', String(hostPid), exePath], {
        detached: true,
        stdio: 'ignore',
        env: cleanEnv,
      });
      if (child && typeof child.unref === 'function') child.unref();
      return { spawned: true, pid: (child && child.pid) || null, method: 'linux-sh', exePath };
    }

    return { spawned: false, reason: 'unsupported-platform' };
  }

  return {
    APP_STORAGE_MAX_BYTES,
    RELAUNCH_TASK_MAX_BYTES,
    getAntigravityAppStoragePath,
    suspendAntigravityRunInBackground,
    restoreAntigravityRunInBackground,
    requestLoopbackCdpBrowserClose,
    isWindowsAntigravityHostAliveSync,
    runWindowsDetachedRelaunchTask,
    normalizeMacAppBundlePath,
    MAC_DETACHED_RELAUNCH_SH,
    LINUX_DETACHED_RELAUNCH_SH,
    spawnDetachedHostRelaunchHelper,
  };
}

module.exports = {
  APP_STORAGE_MAX_BYTES,
  RELAUNCH_TASK_MAX_BYTES,
  getAntigravityAppStoragePath,
  suspendAntigravityRunInBackground,
  restoreAntigravityRunInBackground,
  requestLoopbackCdpBrowserClose,
  normalizeMacAppBundlePath,
  MAC_DETACHED_RELAUNCH_SH,
  LINUX_DETACHED_RELAUNCH_SH,
  createRelaunchHelper,
};
