// 宿主 Antigravity 运行态探测、本机回环 CDP 校验与单次弹窗去重状态记录
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { IS_MAC, IS_WIN, IS_LINUX, APP_DATA } = require('../utils/fs-safe.cjs');
const {
  readPort,
  readPidFromLockFile,
  parseWindowsTasklistCsv,
} = require('./process-probe.cjs');
const {
  CDP_OPT_IN_SWITCH,
  RELAUNCH_STATE_FILENAME,
  hasRemoteDebuggingPortSwitch,
  isAntigravityLinuxTarget,
  isMainAntigravityProcessSignature,
} = require('./shortcut-flags.cjs');

function isElectronHostBinaryPath(rawPath) {
  const s = String(rawPath || '').trim();
  if (!s) return false;
  const base = path.basename(s);
  if (/^(?:antigravity|agy)(?:\.exe)?$/i.test(base)) return true;
  if (/Antigravity(?:\s+Helper(?:\s+\([^)]+\))?)?\.app[\\/]Contents[\\/]MacOS[\\/]/i.test(s)) return true;
  return false;
}

function resolveWindowsDetachedNodeRuntime(opts = {}) {
  const raw = String(opts.nodeExecPath || process.execPath || '').trim();
  const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
  const execFn = typeof opts.execFileSyncFn === 'function' ? opts.execFileSyncFn : execFileSync;
  if (raw && !isElectronHostBinaryPath(raw)) {
    return { execPath: path.resolve(raw), useElectronAsNode: false };
  }
  const candidates = [];
  try {
    const out = execFn('where.exe', ['node.exe'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of String(out || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) candidates.push(trimmed);
    }
  } catch {}
  for (const cand of candidates) {
    if (isElectronHostBinaryPath(cand)) continue;
    try {
      if (existsFn(cand)) {
        return { execPath: path.resolve(cand), useElectronAsNode: false };
      }
    } catch {}
  }
  if (raw) {
    return { execPath: path.resolve(raw), useElectronAsNode: true };
  }
  return { execPath: process.execPath, useElectronAsNode: isElectronHostBinaryPath(process.execPath) };
}

function normalizeLoopbackPort(rawPort) {
  const n = Number(rawPort);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 0;
}

function readPortFromCustomOrDefaultFile(portFile = null) {
  if (portFile) {
    try {
      const text = fs.readFileSync(portFile, 'utf8');
      const port = parseInt(text.split(/\r?\n/)[0].trim(), 10);
      return normalizeLoopbackPort(port) || null;
    } catch {
      return null;
    }
  }
  return normalizeLoopbackPort(readPort()) || null;
}

function isAntigravityCdpVersionInfo(info, port) {
  if (!info || typeof info !== 'object') return false;
  const browserSig = `${String(info.Browser || '')} ${String(info['User-Agent'] || '')}`;
  if (/\bEdg\//i.test(browserSig) && !/\bAntigravity\b/i.test(browserSig)) {
    return false;
  }
  const wsUrl = typeof info.webSocketDebuggerUrl === 'string' ? info.webSocketDebuggerUrl.trim() : '';
  if (!wsUrl) return false;
  try {
    const parsed = new URL(wsUrl);
    const hostOk = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
    const portNum = parsed.port ? Number(parsed.port) : 80;
    return parsed.protocol === 'ws:' && hostOk && portNum === port && parsed.pathname.startsWith('/devtools/browser/');
  } catch {
    return false;
  }
}

async function probeLoopbackCdpVersionAsync(port, opts = {}) {
  const p = normalizeLoopbackPort(port);
  if (!p) return false;
  if (typeof opts.probeCdpVersionAsync === 'function') {
    return Boolean(await opts.probeCdpVersionAsync(p));
  }
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') return false;
  const timeoutMs = Math.max(200, Math.min(5000, Number(opts.timeoutMs) || 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`http://127.0.0.1:${p}/json/version`, { signal: controller.signal });
    if (!res || !res.ok) return false;
    const info = await res.json();
    return isAntigravityCdpVersionInfo(info, p);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function probeLoopbackCdpVersionSync(port, opts = {}) {
  const p = normalizeLoopbackPort(port);
  if (!p) return false;
  if (typeof opts.probeCdpVersionSync === 'function') {
    return Boolean(opts.probeCdpVersionSync(p));
  }
  const timeoutMs = Math.max(200, Math.min(4000, Number(opts.timeoutMs) || 1000));
  const runtime = resolveWindowsDetachedNodeRuntime(opts);
  const env = { ...process.env };
  if (runtime.useElectronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;
  const probeCode = [
    "const http = require('node:http');",
    `const req = http.get({ host: '127.0.0.1', port: ${p}, path: '/json/version', timeout: ${timeoutMs} }, (res) => {`,
    "  if (res.statusCode !== 200) { process.exit(1); }",
    "  let body = '';",
    "  res.setEncoding('utf8');",
    "  res.on('data', (c) => { body += c; if (body.length > 65536) process.exit(1); });",
    "  res.on('end', () => {",
    "    try {",
    "      const info = JSON.parse(body);",
    "      const sig = String(info.Browser || '') + ' ' + String(info['User-Agent'] || '');",
    "      if (/\\bEdg\\//i.test(sig) && !/\\bAntigravity\\b/i.test(sig)) process.exit(1);",
    "      const u = new URL(String(info.webSocketDebuggerUrl || ''));",
    `      const ok = u.protocol === 'ws:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') && Number(u.port || 80) === ${p} && u.pathname.startsWith('/devtools/browser/');`,
    "      process.exit(ok ? 0 : 1);",
    "    } catch { process.exit(1); }",
    "  });",
    "});",
    "req.on('timeout', () => { try { req.destroy(); } catch {} process.exit(1); });",
    "req.on('error', () => process.exit(1));",
  ].join(' ');
  try {
    execFileSync(runtime.execPath, ['-e', probeCode], {
      env,
      windowsHide: true,
      timeout: timeoutMs + 1000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function resolveInstalledAntigravityExeWin(opts = {}) {
  const env = (opts && opts.env) || process.env;
  const existsFn = typeof opts.existsSync === 'function' ? opts.existsSync : fs.existsSync;
  if (opts && typeof opts.exePath === 'string' && opts.exePath.trim()) {
    return opts.exePath.trim();
  }
  const localApp = (env && env.LOCALAPPDATA) || path.join(os.homedir(), 'AppData', 'Local');
  const progFiles = (env && env.ProgramFiles) || 'C:\\Program Files';
  const candidates = [
    path.join(localApp, 'Programs', 'antigravity', 'Antigravity.exe'),
    path.join(localApp, 'antigravity', 'Antigravity.exe'),
    path.join(progFiles, 'Antigravity', 'Antigravity.exe'),
  ];
  if (isElectronHostBinaryPath(process.execPath) && String(process.execPath).toLowerCase().endsWith('.exe')) {
    candidates.unshift(process.execPath);
  }
  for (const c of candidates) {
    try {
      if (existsFn(c)) return c;
    } catch {}
  }
  return candidates[0];
}

function readAntigravitySessionStartHintMs(opts = {}) {
  const dataDir =
    (opts && opts.antigravityDataDir) ||
    path.join(APP_DATA, 'Antigravity');
  const candidates = [
    opts && opts.portFile ? opts.portFile : path.join(dataDir, 'DevToolsActivePort'),
    path.join(dataDir, 'lockfile'),
    path.join(dataDir, 'SingletonLock'),
  ];
  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      if (st && st.mtimeMs > 0) return Math.round(st.mtimeMs);
    } catch {}
  }
  return 0;
}

const WIN_NON_MAIN_TITLES_RE = /^(?:|n\/a|暂缺|olemainthreadwndname|default ime|msctfime ui)$/i;

function isMeaningfulWindowsHostTitle(rawTitle) {
  const t = String(rawTitle || '').trim();
  if (!t || WIN_NON_MAIN_TITLES_RE.test(t)) return false;
  // 中文 CP936 "暂缺" 在 UTF-8 解码下为短替换符串（<=4 字符且全是 U+FFFD 或非可见 ASCII）
  if (t.length <= 4 && /^[\ufffd\x80-\xff]+$/.test(t)) return false;
  return true;
}

// 解析 POSIX `ps -axo pid=,etime=,comm=,args=` 的 BSD/Linux etime（[[dd-]hh:]mm:ss）为毫秒
function parsePsElapsedMs(etimeStr) {
  const raw = String(etimeStr || '').trim();
  if (!raw) return 0;
  let days = 0;
  let rest = raw;
  const dashIdx = raw.indexOf('-');
  if (dashIdx > 0) {
    days = parseInt(raw.slice(0, dashIdx), 10) || 0;
    rest = raw.slice(dashIdx + 1);
  }
  const parts = rest.split(':').map((x) => parseInt(x, 10) || 0);
  let secs = 0;
  if (parts.length === 3) {
    secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    secs = parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    secs = parts[0];
  }
  return (days * 86400 + secs) * 1000;
}

function selectPrimaryHostCandidate(candidates, nowMs = Date.now()) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const mains = [];
  for (const c of candidates) {
    const pid = Number(c && c.pid);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (!isMainAntigravityProcessSignature(c.imageName, c.commandLine)) continue;
    const startMs = Number(c.startMs) > 0 ? Number(c.startMs) : 0;
    mains.push({
      pid,
      startMs,
      ageMs: startMs > 0 && nowMs >= startMs ? nowMs - startMs : 0,
      exePath: String(c.exePath || '').trim(),
      commandLine: String(c.commandLine || ''),
      hasDebugPortSwitch: hasRemoteDebuggingPortSwitch(c.commandLine),
    });
  }
  if (mains.length === 0) return null;
  mains.sort((a, b) => {
    if (a.startMs > 0 && b.startMs > 0 && a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.pid - b.pid;
  });
  return mains[0];
}

function extractPosixCommandExecutable(cmdLine) {
  const s = String(cmdLine || '').trim();
  if (!s) return '';
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    let out = '';
    for (let i = 1; i < s.length; i++) {
      const ch = s[i];
      if (q === '"' && ch === '\\' && i + 1 < s.length) {
        out += s[i + 1];
        i += 1;
        continue;
      }
      if (ch === q) break;
      out += ch;
    }
    return out;
  }
  const macAppIdx = s.indexOf('.app/Contents/MacOS/');
  if (macAppIdx > 0) {
    const slashAfter = s.indexOf(' ', macAppIdx + 20);
    return slashAfter > 0 ? s.slice(0, slashAfter) : s;
  }
  const linuxSpacedMatch = /^(\/[^\0]*?\/(?:antigravity(?:[-_.][^\s/]+\.appimage|\.appimage)?))(?=\s|$)/i.exec(s);
  if (linuxSpacedMatch && linuxSpacedMatch[1]) {
    return linuxSpacedMatch[1];
  }
  const spIdx = s.indexOf(' ');
  return spIdx > 0 ? s.slice(0, spIdx) : s;
}

function parseAppImageFromProcEnviron(rawEnviron) {
  if (!rawEnviron) return '';
  const text = Buffer.isBuffer(rawEnviron) ? rawEnviron.toString('utf8') : String(rawEnviron);
  const parts = text.split(/\0|\r?\n/);
  for (const entry of parts) {
    if (entry.startsWith('APPIMAGE=')) {
      const val = entry.slice('APPIMAGE='.length).trim();
      if (val) return val;
    }
  }
  return '';
}

function parsePosixPsHostCandidates(psStdout, nowMs = Date.now(), opts = null) {
  const effectivePlatform = (opts && opts.platformOverride) || process.platform;
  const isMacPlatform = effectivePlatform === 'darwin';
  const isLinuxPlatform = effectivePlatform === 'linux';
  const readProcExe =
    opts && typeof opts.readProcExe === 'function'
      ? opts.readProcExe
      : isLinuxPlatform && IS_LINUX
        ? (pid) => {
            try {
              return fs.readlinkSync(`/proc/${pid}/exe`);
            } catch {
              return '';
            }
          }
        : null;
  const readProcEnviron =
    opts && typeof opts.readProcEnviron === 'function'
      ? opts.readProcEnviron
      : isLinuxPlatform && IS_LINUX
        ? (pid) => {
            try {
              return fs.readFileSync(`/proc/${pid}/environ`);
            } catch {
              return '';
            }
          }
        : null;

  const lines = String(psStdout || '').split(/\r?\n/);
  const list = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const elapsedMs = parsePsElapsedMs(m[2]);
    const cmdLine = m[3].trim();
    const lowCmd = cmdLine.toLowerCase();
    const looksRelevant = lowCmd.includes('antigravity') || lowCmd.includes('.mount_antigr');
    let procExe = '';
    let appImagePath = '';
    if (isLinuxPlatform && (looksRelevant || (opts && opts.probeAllProc))) {
      if (readProcExe) {
        try {
          procExe = String(readProcExe(pid) || '').replace(/\s+\(deleted\)$/, '').trim();
        } catch {
          procExe = '';
        }
      }
      if (readProcEnviron) {
        try {
          appImagePath = parseAppImageFromProcEnviron(readProcEnviron(pid));
        } catch {
          appImagePath = '';
        }
      }
    }
    if (!looksRelevant && !isAntigravityLinuxTarget(procExe) && !isAntigravityLinuxTarget(appImagePath)) {
      continue;
    }
    const firstExe = extractPosixCommandExecutable(cmdLine);
    let appBundlePath = firstExe;
    const appEnd = firstExe.indexOf('.app/');
    if (appEnd > 0) {
      appBundlePath = firstExe.slice(0, appEnd + 4);
    }
    let resolvedExePath = isMacPlatform && appBundlePath.endsWith('.app') ? appBundlePath : firstExe;
    let resolvedImageName = firstExe;
    if (isLinuxPlatform) {
      if (appImagePath && isAntigravityLinuxTarget(appImagePath)) {
        resolvedExePath = appImagePath;
        if (!isAntigravityLinuxTarget(resolvedImageName)) {
          resolvedImageName = appImagePath;
        }
      } else if (procExe && isAntigravityLinuxTarget(procExe)) {
        resolvedExePath = procExe;
        if (!isAntigravityLinuxTarget(resolvedImageName)) {
          resolvedImageName = procExe;
        }
      }
    }
    list.push({
      pid,
      imageName: resolvedImageName,
      startMs: elapsedMs > 0 ? Math.max(1, nowMs - elapsedMs) : 0,
      exePath: resolvedExePath,
      commandLine: cmdLine,
    });
  }
  return list;
}

function getRelaunchPromptStatePaths(pluginDir, extraDirs = []) {
  const dirs = [];
  if (pluginDir) dirs.push(path.resolve(pluginDir));
  for (const d of extraDirs) {
    if (d) dirs.push(path.resolve(d));
  }
  if (!extraDirs || extraDirs.length === 0) {
    if (IS_WIN) {
      const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const watcherDir = path.join(localApp, 'obsidian-prism');
      if (fs.existsSync(watcherDir)) dirs.push(watcherDir);
    } else if (IS_MAC) {
      const macWatcherDir = path.join(os.homedir(), 'Library', 'Application Support', 'obsidian-prism');
      if (fs.existsSync(macWatcherDir)) dirs.push(macWatcherDir);
    } else if (IS_LINUX) {
      const xdgState = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
      const linuxStateDir = path.join(xdgState, 'obsidian-prism');
      if (fs.existsSync(linuxStateDir)) dirs.push(linuxStateDir);
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const dir of dirs) {
    const norm = IS_WIN ? dir.toLowerCase() : dir;
    if (seen.has(norm)) continue;
    seen.add(norm);
    uniq.push(path.join(dir, RELAUNCH_STATE_FILENAME));
  }
  return uniq;
}

// 与 C# / Swift Watcher 超集双向兼容的单次去重检查（容忍毫秒/秒级精度误差，同时防系统重启后 PID 复用）
function hasRelaunchBeenPromptedForHost(pluginDir, hostPid, hostStartMs = 0, extraDirs = []) {
  const pid = Number(hostPid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const startMs = Number(hostStartMs) > 0 ? Number(hostStartMs) : 0;
  const exactKey = `${pid}:${startMs}`;
  const prefix = `${pid}:`;
  const files = getRelaunchPromptStatePaths(pluginDir, extraDirs);
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed.key === exactKey || parsed.hostKey === exactKey) return true;
      const recordedPid = Number(parsed.hostPid);
      const recordedStart = Number(parsed.startTimeMs ?? parsed.hostStartMs ?? 0);
      if (recordedPid === pid) {
        if (!startMs || !recordedStart || Math.abs(recordedStart - startMs) <= 15000) {
          return true;
        }
      }
      const list = Array.isArray(parsed.promptedKeys)
        ? parsed.promptedKeys
        : Array.isArray(parsed.prompts)
        ? parsed.prompts
        : [];
      for (const item of list) {
        if (typeof item !== 'string') continue;
        if (item === exactKey) return true;
        if (item.startsWith(prefix)) {
          const itemStart = Number(item.slice(prefix.length)) || 0;
          if (!startMs || !itemStart || Math.abs(itemStart - startMs) <= 15000) {
            return true;
          }
        }
      }
    } catch {}
  }
  return false;
}

function recordRelaunchPromptState(pluginDir, hostPid, hostStartMs = 0, decision = 'prompted', extraDirs = []) {
  const pid = Number(hostPid);
  if (!Number.isInteger(pid) || pid <= 0 || !pluginDir) return null;
  const startMs = Number(hostStartMs) > 0 ? Math.trunc(Number(hostStartMs)) : 0;
  const key = `${pid}:${startMs}`;
  const files = getRelaunchPromptStatePaths(pluginDir, extraDirs);
  let prevKeys = [];
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const oldObj = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(oldObj?.promptedKeys)) {
        prevKeys.push(...oldObj.promptedKeys.filter((x) => typeof x === 'string'));
      }
    } catch {}
  }
  const promptedKeys = Array.from(new Set([...prevKeys.slice(-24), key]));
  const payload = {
    hostPid: pid,
    startTimeMs: startMs,
    hostStartMs: startMs,
    key,
    hostKey: key,
    promptedKeys,
    decision: String(decision || 'prompted'),
    reason: String(decision || 'prompted'),
    updatedAt: Date.now(),
  };
  const jsonText = JSON.stringify(payload, null, 2) + '\n';
  for (const file of files) {
    try {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, jsonText, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch {}
  }
  return payload;
}

function createHostRelaunch({ rootDir = path.resolve(__dirname, '..', '..') } = {}) {
  function collectKnownPrismDaemonPids(opts = {}) {
    const excluded = new Set([process.pid]);
    if (Array.isArray(opts.excludePids)) {
      for (const p of opts.excludePids) {
        const n = Number(p);
        if (Number.isInteger(n) && n > 0) excluded.add(n);
      }
    }
    const lockFiles = Array.isArray(opts.daemonPidFiles)
      ? opts.daemonPidFiles
      : [
          path.join(rootDir, '.daemon.pid'),
          path.join(rootDir, '.watch.pid'),
          process.env.AG_PRISM_PLUGIN_DIR ? path.join(process.env.AG_PRISM_PLUGIN_DIR, '.daemon.pid') : '',
          path.join(os.homedir(), '.gemini', 'config', 'plugins', 'obsidian-prism', '.daemon.pid'),
        ];
    for (const lf of lockFiles) {
      if (!lf) continue;
      const pid = readPidFromLockFile(lf);
      if (pid && pid > 0) excluded.add(pid);
    }
    return excluded;
  }

  function buildWindowsHostCandidatesFromTasklist(csvText, opts = {}) {
    const rows = parseWindowsTasklistCsv(csvText);
    if (rows.length === 0) return [];
    const excluded = collectKnownPrismDaemonPids(opts);
    const matching = rows.filter(
      (r) => r.imageName.toLowerCase() === 'antigravity.exe' && !excluded.has(r.pid)
    );
    if (matching.length === 0) return [];

    const withTitle = matching.filter((r) => isMeaningfulWindowsHostTitle(r.windowTitle));
    const selectedRows = withTitle.length > 0 ? withTitle : matching;
    const exePath = resolveInstalledAntigravityExeWin(opts);
    const hasActiveCdp = Boolean(opts.hasActiveCdp);
    const startMsHint = Number(opts.startMsHint) > 0 ? Number(opts.startMsHint) : readAntigravitySessionStartHintMs(opts);
    const commandLine = hasActiveCdp ? `"${exePath}" ${CDP_OPT_IN_SWITCH}` : `"${exePath}"`;

    return selectedRows.map((r) => ({
      pid: r.pid,
      imageName: r.imageName,
      startMs: startMsHint,
      exePath,
      commandLine,
    }));
  }

  function detectRunningAntigravityHostSync(opts = {}) {
    const nowMs = Number(opts.nowMs) > 0 ? Number(opts.nowMs) : Date.now();
    if (typeof opts.probeProcesses === 'function') {
      return selectPrimaryHostCandidate(opts.probeProcesses(), nowMs);
    }
    const effectivePlatform = opts.platformOverride || process.platform;
    const execSyncFn = typeof opts.execFileSyncFn === 'function' ? opts.execFileSyncFn : execFileSync;
    try {
      if (effectivePlatform === 'win32') {
        const out = execSyncFn(
          'tasklist',
          ['/FI', 'IMAGENAME eq Antigravity.exe', '/V', '/FO', 'CSV', '/NH'],
          { encoding: 'utf8', windowsHide: true, timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        const preliminary = buildWindowsHostCandidatesFromTasklist(out, { ...opts, hasActiveCdp: false });
        if (preliminary.length === 0) return null;
        const activePort = opts.cdpPort !== undefined ? normalizeLoopbackPort(opts.cdpPort) : readPortFromCustomOrDefaultFile(opts.portFile || null);
        const hasActiveCdp = activePort > 0 ? probeLoopbackCdpVersionSync(activePort, opts) : false;
        const candidates = hasActiveCdp
          ? buildWindowsHostCandidatesFromTasklist(out, { ...opts, hasActiveCdp: true })
          : preliminary;
        return selectPrimaryHostCandidate(candidates, nowMs);
      }
      const psOut = execSyncFn('ps', ['-axo', 'pid=,etime=,args='], {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return selectPrimaryHostCandidate(parsePosixPsHostCandidates(psOut, nowMs, opts), nowMs);
    } catch {
      return null;
    }
  }

  function detectRunningAntigravityHost(opts = {}) {
    const nowMs = Number(opts.nowMs) > 0 ? Number(opts.nowMs) : Date.now();
    if (typeof opts.probeProcesses === 'function') {
      return Promise.resolve(opts.probeProcesses()).then((list) => selectPrimaryHostCandidate(list, nowMs));
    }
    const effectivePlatform = opts.platformOverride || process.platform;
    const execFn = typeof opts.execFileFn === 'function' ? opts.execFileFn : execFile;
    return new Promise((resolve) => {
      if (effectivePlatform === 'win32') {
        execFn(
          'tasklist',
          ['/FI', 'IMAGENAME eq Antigravity.exe', '/V', '/FO', 'CSV', '/NH'],
          { encoding: 'utf8', windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 },
          (err, stdout) => {
            if (err) {
              resolve(null);
              return;
            }
            (async () => {
              try {
                const preliminary = buildWindowsHostCandidatesFromTasklist(stdout, { ...opts, hasActiveCdp: false });
                if (preliminary.length === 0) {
                  resolve(null);
                  return;
                }
                const activePort =
                  opts.cdpPort !== undefined
                    ? normalizeLoopbackPort(opts.cdpPort)
                    : readPortFromCustomOrDefaultFile(opts.portFile || null);
                const hasActiveCdp = activePort > 0 ? await probeLoopbackCdpVersionAsync(activePort, opts) : false;
                const candidates = hasActiveCdp
                  ? buildWindowsHostCandidatesFromTasklist(stdout, { ...opts, hasActiveCdp: true })
                  : preliminary;
                resolve(selectPrimaryHostCandidate(candidates, nowMs));
              } catch {
                resolve(null);
              }
            })();
          }
        );
        return;
      }
      execFn(
        'ps',
        ['-axo', 'pid=,etime=,args='],
        { encoding: 'utf8', timeout: 3000, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          resolve(selectPrimaryHostCandidate(parsePosixPsHostCandidates(stdout, nowMs, opts), nowMs));
        }
      );
    });
  }

  return {
    isElectronHostBinaryPath,
    resolveWindowsDetachedNodeRuntime,
    normalizeLoopbackPort,
    readPortFromCustomOrDefaultFile,
    isAntigravityCdpVersionInfo,
    probeLoopbackCdpVersionAsync,
    probeLoopbackCdpVersionSync,
    resolveInstalledAntigravityExeWin,
    collectKnownPrismDaemonPids,
    buildWindowsHostCandidatesFromTasklist,
    extractPosixCommandExecutable,
    parseAppImageFromProcEnviron,
    parsePosixPsHostCandidates,
    detectRunningAntigravityHostSync,
    detectRunningAntigravityHost,
    getRelaunchPromptStatePaths,
    hasRelaunchBeenPromptedForHost,
    recordRelaunchPromptState,
  };
}

module.exports = {
  isElectronHostBinaryPath,
  resolveWindowsDetachedNodeRuntime,
  normalizeLoopbackPort,
  readPortFromCustomOrDefaultFile,
  isAntigravityCdpVersionInfo,
  probeLoopbackCdpVersionAsync,
  probeLoopbackCdpVersionSync,
  resolveInstalledAntigravityExeWin,
  extractPosixCommandExecutable,
  parseAppImageFromProcEnviron,
  parsePosixPsHostCandidates,
  getRelaunchPromptStatePaths,
  hasRelaunchBeenPromptedForHost,
  recordRelaunchPromptState,
  createHostRelaunch,
};
