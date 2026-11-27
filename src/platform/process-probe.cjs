// 跨平台端口读取、锁文件 PID 解析与原生进程探针（零 PowerShell / 零 WMI）
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { PORT_FILE } = require('../utils/fs-safe.cjs');

const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');

function isPidAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

/**
 * 使用 Node 原生 detached + windowsHide 派生独立后台无窗子进程（0 黑框、零 PowerShell、零 WMI）。
 */
function spawnBreakawayNodeProcess(nodeArgs, opts = {}) {
  const exe = process.execPath;
  const cwd = opts.cwd || DEFAULT_ROOT_DIR;

  try {
    const spawnOpts = {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    };
    if (opts.env && typeof opts.env === 'object') {
      spawnOpts.env = opts.env;
    }
    const child = spawn(exe, nodeArgs, spawnOpts);
    if (child && typeof child.on === 'function') {
      child.on('error', () => {});
    }
    if (child && Number.isInteger(child.pid) && child.pid > 0) {
      child.unref();
      return { spawned: true, pid: child.pid, method: 'node-detached-windowshide' };
    }
  } catch {
    // Ignore
  }

  return { spawned: false, pid: null, method: null };
}

function readPort(portFile = PORT_FILE) {
  if (process.env.AG_CDP_PORT) return parseInt(process.env.AG_CDP_PORT, 10);
  try {
    const text = fs.readFileSync(portFile, 'utf8');
    const port = parseInt(text.split(/\r?\n/)[0].trim(), 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

// 统一解析纯整数或 JSON {"pid":12345} 锁文件，杜绝 parseInt("{...") -> NaN
function readPidFromLockFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      const n = Number(parsed && parsed.pid);
      return Number.isInteger(n) && n > 0 ? n : null;
    }
  } catch {}
  return null;
}

// 校验进程映像名、内核启动时间与命令行签名：既精准识别宿主以 Antigravity 二进制拉起的原生 Sidecar，又严防误杀宿主主进程/其他插件
function matchesExpectedDaemonSignature(imageName, commandLine = '', opts = null) {
  const img = String(imageName || '').trim().toLowerCase();
  const cmd = String(commandLine || '').replace(/\\/g, '/').toLowerCase();
  if (!img) return false;
  if (cmd && /--type=/.test(cmd)) {
    return false;
  }
  const matchedLockPid = Boolean(opts && opts.matchedLockPid);
  const lockStartedAt = Number((opts && opts.lockStartedAt) || 0);
  const processStartMs = Number((opts && opts.processStartMs) || 0);
  if (lockStartedAt > 0 && processStartMs > 0) {
    // 若进程在锁文件写入后 >5s 才创建（PID 复用）或早于锁文件 >120s（老主进程），一律拒绝
    if (processStartMs > lockStartedAt + 5000 || lockStartedAt - processStartMs > 120000) {
      return false;
    }
  }
  if (/\b(?:node|nodejs|obsidian-prism|watcher|agy-claude-style)(?:\.exe)?\b/.test(img)) {
    return true;
  }
  if (/(?:antigravity|electron|agy)(?:\.exe|\b)/.test(img)) {
    if (!cmd) return false;
    const hasPrismOwner = /(?:obsidian-prism|antigravity-prism|agy-claude-style)/.test(cmd);
    const hasDaemonEntry = /(?:sidecars\/daemon\/main\.mjs|\/daemon\/main\.mjs|\/watch\.js)\b/.test(cmd);
    if (hasPrismOwner && hasDaemonEntry) return true;
    // 宿主以插件子目录为 cwd 拉起 Sidecar 时命令行为 `Antigravity --import=.../sidecar_sdk/register_loader.js main.mjs`
    if (matchedLockPid && /sidecar_sdk\/register_loader\.js\b/.test(cmd) && /(?:^|\s|\/)main\.mjs(?:\s|"|'|$)/.test(cmd)) {
      return true;
    }
    return false;
  }
  return false;
}

// 解析 Windows `tasklist /FO CSV /NH`（含可选 `/V`）标准 RFC-4180 CSV 输出
function parseWindowsTasklistCsv(csvText) {
  const rows = [];
  const lines = String(csvText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || !line.startsWith('"')) continue;
    const cols = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        i += 1;
        let val = '';
        while (i < line.length) {
          if (line[i] === '"') {
            if (i + 1 < line.length && line[i + 1] === '"') {
              val += '"';
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          val += line[i];
          i += 1;
        }
        cols.push(val);
        while (i < line.length && line[i] !== ',') i += 1;
        if (i < line.length && line[i] === ',') i += 1;
      } else {
        const comma = line.indexOf(',', i);
        if (comma < 0) {
          cols.push(line.slice(i).trim());
          break;
        }
        cols.push(line.slice(i, comma).trim());
        i = comma + 1;
      }
    }
    if (cols.length < 2) continue;
    const pid = parseInt(String(cols[1] || '').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    rows.push({
      imageName: String(cols[0] || '').trim(),
      pid,
      sessionName: cols[2] || '',
      memUsage: cols[4] || '',
      status: cols[5] || '',
      windowTitle: cols.length >= 9 ? String(cols[8] || '').trim() : '',
    });
  }
  return rows;
}

// 单次原生系统探针获取进程映像名、启动时间与命令行（Windows 使用原生 tasklist CSV，零 PowerShell / 零 WMI）
function inspectProcessSync(pid, opts = null) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    process.kill(n, 0);
  } catch (err) {
    if (!err || err.code !== 'EPERM') return null;
  }
  const hasCustomExec = Boolean(opts && typeof opts.execFileSyncFn === 'function');
  const execFn = hasCustomExec ? opts.execFileSyncFn : execFileSync;
  const platform = (opts && opts.platform) || process.platform;
  try {
    if (platform === 'win32') {
      if (n === process.pid && !hasCustomExec) {
        const startMs = Math.max(1, Math.round(Date.now() - process.uptime() * 1000));
        return {
          pid: n,
          imageName: path.basename(process.execPath) || 'node.exe',
          startTime: startMs,
          processStartMs: startMs,
          commandLine: Array.isArray(process.argv) ? process.argv.join(' ') : '',
        };
      }
      const out = execFn(
        'tasklist',
        ['/FI', `PID eq ${n}`, '/FO', 'CSV', '/NH'],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );
      const rows = parseWindowsTasklistCsv(out);
      const matched = rows.find((r) => r.pid === n);
      if (!matched || !matched.imageName) return null;
      return {
        pid: n,
        imageName: matched.imageName,
        startTime: 0,
        processStartMs: 0,
        commandLine: '',
      };
    }
    if (platform === 'linux') {
      let imageName = '';
      let commandLine = '';
      let processStartMs = 0;
      try {
        imageName = fs.readFileSync(`/proc/${n}/comm`, 'utf8').trim();
      } catch {}
      try {
        const rawCmd = fs.readFileSync(`/proc/${n}/cmdline`);
        if (rawCmd && rawCmd.length > 0) {
          commandLine = rawCmd.toString('utf8').replace(/\0+/g, ' ').trim();
        }
      } catch {}
      try {
        const statText = fs.readFileSync(`/proc/${n}/stat`, 'utf8');
        const rparen = statText.lastIndexOf(')');
        if (rparen > 0) {
          const fields = statText.slice(rparen + 2).trim().split(/\s+/);
          const startTicks = Number(fields[19]);
          if (Number.isFinite(startTicks) && startTicks > 0) {
            const procStat = fs.readFileSync('/proc/stat', 'utf8');
            const btimeMatch = /^btime\s+(\d+)$/m.exec(procStat);
            if (btimeMatch) {
              const bootSec = Number(btimeMatch[1]);
              if (Number.isFinite(bootSec) && bootSec > 0) {
                processStartMs = Math.round(bootSec * 1000 + (startTicks / 100) * 1000);
              }
            }
          }
        }
      } catch {}
      if (!processStartMs && n === process.pid && !hasCustomExec) {
        processStartMs = Math.max(1, Math.round(Date.now() - process.uptime() * 1000));
      }
      if (!imageName && !commandLine) return null;
      return {
        pid: n,
        imageName: imageName || commandLine.split(/\s+/)[0] || '',
        startTime: processStartMs,
        processStartMs,
        commandLine,
      };
    }
    // macOS / 其他 POSIX：使用 ps 单次读取 args、comm 与 lstart（UTC）
    const posixEnv = { ...process.env, LC_ALL: 'C', TZ: 'UTC' };
    const commOut = execFn('ps', ['-p', String(n), '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: posixEnv,
    });
    const imageName = String(commOut || '').trim();
    if (!imageName) return null;
    let commandLine = '';
    try {
      const argsOut = execFn('ps', ['-p', String(n), '-o', 'args='], {
        encoding: 'utf8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: posixEnv,
      });
      commandLine = String(argsOut || '').trim();
    } catch {}
    let processStartMs = 0;
    try {
      const lstartOut = execFn('ps', ['-p', String(n), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: posixEnv,
      });
      const rawStart = String(lstartOut || '').trim().replace(/\s+/g, ' ');
      if (rawStart) {
        const hasTz = /(?:[+-]\d{2}:?\d{2}|UTC|GMT|Z)$/i.test(rawStart);
        const parsedMs = Date.parse(hasTz ? rawStart : `${rawStart} UTC`);
        if (Number.isFinite(parsedMs) && parsedMs > 0) {
          processStartMs = Math.round(parsedMs);
        }
      }
    } catch {}
    if (processStartMs <= 0 && n === process.pid && !hasCustomExec) {
      processStartMs = Math.max(1, Math.round(Date.now() - process.uptime() * 1000));
    }
    return {
      pid: n,
      imageName,
      startTime: processStartMs,
      processStartMs,
      commandLine,
    };
  } catch {
    return null;
  }
}

function createProcessProbe({ rootDir = path.resolve(__dirname, '..', '..'), portFile = PORT_FILE } = {}) {
  function findDaemonLockMetaForPid(pid, customLockFile = null) {
    const candidates = [];
    if (customLockFile) candidates.push(customLockFile);
    candidates.push(path.join(rootDir, '.daemon.pid'));
    const envPluginDir = process.env.AG_PRISM_PLUGIN_DIR;
    if (envPluginDir) candidates.push(path.join(envPluginDir, '.daemon.pid'));
    candidates.push(path.join(os.homedir(), '.gemini', 'config', 'plugins', 'obsidian-prism', '.daemon.pid'));
    const seen = new Set();
    for (const filePath of candidates) {
      if (!filePath || seen.has(filePath)) continue;
      seen.add(filePath);
      try {
        if (!fs.existsSync(filePath)) continue;
        const raw = fs.readFileSync(filePath, 'utf8').trim();
        if (!raw) continue;
        if (/^\d+$/.test(raw) && parseInt(raw, 10) === pid) {
          return { matchedPid: true, startedAt: 0 };
        }
        if (raw.startsWith('{')) {
          const parsed = JSON.parse(raw);
          if (Number(parsed?.pid) === pid) {
            return { matchedPid: true, startedAt: Number(parsed?.startedAt || 0) };
          }
        }
      } catch {}
    }
    return { matchedPid: false, startedAt: 0 };
  }

  // 终止旧守护前核验进程映像名与启动时间/命令行，防止系统重启后 PID 复用误杀无关进程或宿主主窗口
  function isExpectedDaemonProcess(pid, probeOverride = null) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0 || n === process.pid) return false;
    const isObjOverride = Boolean(probeOverride && typeof probeOverride === 'object');
    const customLock =
      typeof probeOverride === 'string'
        ? probeOverride
        : isObjOverride && typeof probeOverride.lockFile === 'string'
        ? probeOverride.lockFile
        : null;
    const lockMeta = findDaemonLockMetaForPid(n, customLock);
    if (typeof probeOverride === 'function') {
      const info = probeOverride(n);
      if (!info) return false;
      return matchesExpectedDaemonSignature(info.imageName, info.commandLine, {
        matchedLockPid: Boolean(info.matchedLockPid ?? lockMeta.matchedPid),
        lockStartedAt: Number(info.lockStartedAt ?? lockMeta.startedAt ?? 0),
        processStartMs: Number(info.processStartMs ?? info.startTime ?? 0),
      });
    }
    if (isObjOverride && Object.prototype.hasOwnProperty.call(probeOverride, 'procInfo')) {
      const info = probeOverride.procInfo;
      if (!info) return false;
      return matchesExpectedDaemonSignature(info.imageName, info.commandLine, {
        matchedLockPid: Boolean(info.matchedLockPid ?? lockMeta.matchedPid),
        lockStartedAt: Number(info.lockStartedAt ?? lockMeta.startedAt ?? 0),
        processStartMs: Number(info.processStartMs ?? info.startTime ?? 0),
      });
    }
    try {
      process.kill(n, 0);
    } catch (err) {
      return Boolean(err && err.code === 'EPERM');
    }
    const info = inspectProcessSync(n);
    if (!info) return false;
    return matchesExpectedDaemonSignature(info.imageName, info.commandLine, {
      matchedLockPid: lockMeta.matchedPid,
      lockStartedAt: lockMeta.startedAt,
      processStartMs: Number(info.processStartMs ?? info.startTime ?? 0),
    });
  }

  return {
    readPort: () => readPort(portFile),
    readPidFromLockFile,
    findDaemonLockMetaForPid,
    matchesExpectedDaemonSignature,
    parseWindowsTasklistCsv,
    inspectProcessSync,
    isExpectedDaemonProcess,
  };
}

module.exports = {
  isPidAlive,
  spawnBreakawayNodeProcess,
  readPort,
  readPidFromLockFile,
  matchesExpectedDaemonSignature,
  parseWindowsTasklistCsv,
  inspectProcessSync,
  createProcessProbe,
};
