// Upstream: ATtacK030130/antigrative-dashboard v0.9.1 (MIT License — Copyright (c) 2026 AG Pulse contributors)
// Integrated & adapted for Obsidian Prism under GPL-3.0-only compatibility terms.
// Windows zero-PowerShell / zero-WMI / zero-Add-Type discovery using native tasklist + netstat + loopback probe.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { performance } from 'node:perf_hooks';

const exec = promisify(execFile);
const languageServer = command => /(?:^|[\/\\])language_server(?:_(?:windows|linux|macos|darwin)(?:_(?:x64|arm|arm64))?)?(?:\.exe)?(?:\s|$)/i.test(command);
const agyHubCommand = command => /(?:^|[\/\\"'])agy(?:\.exe)?(?:["']?(?:\s|$))/i.test(command) && /(?:^|\s)["']?--hub(?:["']?)(?=\s|$)/i.test(command) && !/(?:^|\s)["']?--enable_lsp(?:=|\s|$)/i.test(command);
const agyExeName = name => /^agy(?:\.exe)?$/i.test(String(name || '').trim());

export function extractHubPort(command) {
  const m = String(command || '').match(/(?:^|\s)--hub-port(?:=|\s+)["']?(\d{1,5})["']?(?=\s|$)/i);
  if (!m) return null;
  const p = Number(m[1]);
  return Number.isInteger(p) && p > 0 && p <= 65535 ? p : null;
}

export function httpLogPorts(log) {
  const ports = new Set();
  for (const match of String(log || '').matchAll(/listening on random port at (\d+) for HTTP(?:\s|$)/g)) {
    const port = Number(match[1]);
    if (port < 1 || port > 65535) continue;
    ports.delete(port);
    ports.add(port);
  }
  return [...ports].reverse();
}

export function parsePs(text, uid) {
  return text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || Number(match[2]) !== uid || !languageServer(match[3]) || !/--standalone\b/.test(match[3])) return [];
    return [{ ProcessId: Number(match[1]), CommandLine: match[3] }];
  });
}

export function parseLsof(text) {
  let pid = null;
  const ports = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (/^p\d+$/.test(line)) {
      pid = Number(line.slice(1));
      if (!ports.has(pid)) ports.set(pid, []);
    }
    const port = line[0] === 'n' && line.match(/:(\d+)(?:\s|$)/)?.[1];
    if (pid && port) ports.get(pid).push(Number(port));
  }
  return ports;
}

export function parseProcNet(text) {
  return text.split(/\r?\n/).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields[3] !== '0A' || !/^\d+$/.test(fields[9] || '')) return [];
    const hex = fields[1]?.split(':')[1];
    const port = /^[0-9A-F]{4}$/i.test(hex || '') ? parseInt(hex, 16) : 0;
    return port > 0 ? [{ inode: fields[9], port }] : [];
  });
}

const validPid = value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const validPort = value => Number.isInteger(value) && value > 0 && value <= 65535;
const address = value => typeof value === 'string' ? value.toLowerCase().replace(/^\[|\]$/g, '') : '';
const localAddress = value => ['127.0.0.1', '0.0.0.0', '::1', '::', '0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:0', 'localhost'].includes(address(value));
const unspecifiedAddress = value => ['0.0.0.0', '::', '0:0:0:0:0:0:0:0', '*'].includes(address(value));
const endpoint = value => {
  const match = String(value).match(/^(\[[^\]]+\]|[^:\s]+):(\d+|\*)$/);
  return match ? { address: match[1], port: match[2] } : null;
};
const integer = value => typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;

function parseCsvFields(line) {
  const fields = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (line[i] === '"') {
      i += 1;
      let val = '';
      while (i < n) {
        if (line[i] === '"') {
          if (i + 1 < n && line[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          val += line[i++];
        }
      }
      fields.push(val);
      while (i < n && line[i] !== ',') i += 1;
      if (i < n && line[i] === ',') i += 1;
    } else {
      const start = i;
      while (i < n && line[i] !== ',') i += 1;
      fields.push(line.slice(start, i).trim());
      if (i < n && line[i] === ',') i += 1;
    }
  }
  return fields;
}

export function parseTasklistCsv(text) {
  const rows = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line || !line.startsWith('"')) continue;
    const fields = parseCsvFields(line);
    if (fields.length < 2) continue;
    const name = String(fields[0] || '').trim();
    const pid = integer(String(fields[1] || '').trim());
    if (!name || !validPid(pid)) continue;
    rows.push({
      ProcessId: pid,
      ParentProcessId: 0,
      Name: name,
      CommandLine: name,
    });
  }
  return rows;
}

function netstatSnapshot(text) {
  const ports = new Map(), rejectedPids = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+(?:LISTENING|LISTEN|ABHÖREN|ÉCOUTE|ESCUCHANDO|侦听|监听|待機|대기)\s+(\d+)\s*$/i);
    if (!match) continue;
    const local = endpoint(match[1]), remote = endpoint(match[2]), pid = Number(match[3]);
    if (!validPid(pid)) continue;
    const port = Number(local?.port);
    if (!local || !remote || !localAddress(local.address) || !validPort(port)
      || !unspecifiedAddress(remote.address) || !(remote.port === '0' || remote.address === '*' && remote.port === '*')) {
      rejectedPids.add(pid);
      continue;
    }
    if (!ports.has(pid)) ports.set(pid, new Set());
    ports.get(pid).add(port);
  }
  return { ports: new Map([...ports].map(([pid, values]) => [pid, [...values]])), rejectedPids };
}

export function parseNetstat(text) { return netstatSnapshot(text).ports; }

export function probeLoopbackPort(port, { timeoutMs = 400, signal, connect = createConnection } = {}) {
  if (!validPort(port) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    let socket, timer, settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      socket?.destroy();
      resolve(ok);
    };
    const aborted = () => finish(false);
    timer = setTimeout(() => finish(false), Math.min(400, timeoutMs));
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      socket = connect({ host: '127.0.0.1', port, family: 4 });
      socket.once('error', () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('close', () => finish(false));
      socket.unref?.();
      if (settled) socket.destroy();
    } catch {
      finish(false);
    }
  });
}

async function boundedProbe(probe, port, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => probe(port, { timeoutMs, signal: controller.signal })).then(value => value === true, () => false),
      new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function discoverWindowsPorts(pids, { run = exec, expectedPorts = new Map(), probe = probeLoopbackPort, preloadedNetstatStdout = null } = {}) {
  const wanted = new Set(pids.filter(validPid));
  if (!wanted.size) return new Map();
  const preferred = new Map();
  for (const pid of wanted) {
    for (const port of expectedPorts.get(pid) || []) {
      if (validPort(port)) { preferred.set(pid, port); break; }
    }
  }
  const stdout =
    typeof preloadedNetstatStdout === 'string' && preloadedNetstatStdout.length > 0
      ? preloadedNetstatStdout
      : (await run('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 4000, maxBuffer: 4194304 }).catch(() => ({ stdout: '' }))).stdout;
  const snapshot = netstatSnapshot(stdout);
  const ports = new Map([...snapshot.ports].filter(([pid]) => wanted.has(pid)));
  const missing = [...wanted].filter(pid => {
    const found = ports.get(pid) || [], expected = preferred.get(pid);
    if (expected !== undefined) return !found.includes(expected);
    return !found.length || snapshot.rejectedPids.has(pid);
  });
  if (!missing.length) return ports;

  // 零 PowerShell / 零 WMI 回环探测恢复（处理 TUN 环境下 netstat 未呈现预期监听端口的 State-0 场景）
  const deadline = performance.now() + 1500;
  let probed = 0;
  for (const pid of missing) {
    if (probed >= 4) break;
    const expected = preferred.get(pid);
    if (!validPort(expected) || ports.get(pid)?.includes(expected)) continue;
    const timeoutMs = Math.min(400, Math.floor(deadline - performance.now()));
    if (timeoutMs <= 0) break;
    probed += 1;
    if (await boundedProbe(probe, expected, timeoutMs)) {
      if (!ports.has(pid)) ports.set(pid, []);
      if (!ports.get(pid).includes(expected)) ports.get(pid).push(expected);
    }
  }
  return ports;
}

export async function linuxPorts(pid, { proc = '/proc' } = {}) {
  const { readlink } = await import('node:fs/promises');
  const inodes = new Set();
  for (const fd of await readdir(join(proc, String(pid), 'fd'))) {
    try {
      const link = await readlink(join(proc, String(pid), 'fd', fd));
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (m) inodes.add(m[1]);
    } catch {}
  }
  const rows = [];
  for (const name of ['tcp', 'tcp6']) {
    try { rows.push(...parseProcNet(await readFile(join(proc, String(pid), 'net', name), 'utf8'))); } catch {}
  }
  return [...new Set(rows.filter(row => inodes.has(row.inode)).map(row => row.port))];
}

const MAX_LINEAGE_HOPS = 6;
function isDescendantOfAny(pid, ownerPids, byPid, maxHops = MAX_LINEAGE_HOPS) {
  if (!validPid(pid) || !ownerPids.size) return false;
  if (ownerPids.has(pid)) return true;
  const seen = new Set([pid]);
  let current = pid;
  for (let hop = 0; hop < maxHops; hop++) {
    const parent = integer(byPid.get(current)?.ParentProcessId);
    if (!validPid(parent) || seen.has(parent)) return false;
    if (ownerPids.has(parent)) return true;
    seen.add(parent);
    current = parent;
  }
  return false;
}

export function selectServerByCdpLineage(candidates, allRows, portOwners, cdpPort) {
  if (!validPort(cdpPort) || !Array.isArray(candidates) || !candidates.length) return candidates;
  const rawOwners = portOwners.get(cdpPort);
  const ownerList = rawOwners instanceof Set || Array.isArray(rawOwners) ? [...rawOwners] : rawOwners !== undefined ? [rawOwners] : [];
  const ownerPids = new Set(ownerList.map(integer).filter(validPid));
  if (!ownerPids.size) return candidates;
  const byPid = new Map();
  for (const row of allRows || []) {
    const pid = integer(row?.ProcessId);
    if (validPid(pid) && !byPid.has(pid)) byPid.set(pid, row);
  }
  // Include ancestors of cdpPort owners by 1 hop in case an Electron socket broker child owns the debug socket
  const expandedRoots = new Set(ownerPids);
  for (const opid of ownerPids) {
    const p = integer(byPid.get(opid)?.ParentProcessId);
    if (validPid(p) && /(?:antigravity|electron)/i.test(String(byPid.get(p)?.Name || byPid.get(p)?.CommandLine || ''))) {
      expandedRoots.add(p);
    }
  }
  const matched = candidates.filter(row => isDescendantOfAny(integer(row?.ProcessId), expandedRoots, byPid));
  return matched.length ? matched : candidates;
}

export async function discoverProcesses({ platform = process.platform, run = exec, uid = process.getuid?.(), proc = '/proc', expectedPorts = [], cdpPort = null, probe = probeLoopbackPort } = {}) {
  const targetCdpPort = typeof cdpPort === 'function' ? Number(cdpPort()) : Number(cdpPort);
  const hasCdpHint = validPort(targetCdpPort);

  if (platform === 'win32') {
    // 纯原生 Windows 探测：零 PowerShell、零 WMI、零动态编译、零跨进程句柄读取
    const [{ stdout: taskOut }, { stdout: netOut }] = await Promise.all([
      run('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 4194304 }).catch(() => ({ stdout: '' })),
      run('netstat.exe', ['-ano', '-p', 'tcp'], { windowsHide: true, timeout: 4000, maxBuffer: 4194304 }).catch(() => ({ stdout: '' })),
    ]);

    const allRows = parseTasklistCsv(taskOut);
    let candidates = allRows.filter(
      (row) => languageServer(row.Name || row.CommandLine || '') || (hasCdpHint && agyExeName(row.Name))
    );
    if (!candidates.length) return [];

    if (hasCdpHint && candidates.length > 1 && allRows.some((r) => validPid(r.ParentProcessId))) {
      const snap = netstatSnapshot(netOut);
      const portOwners = new Map();
      for (const [pid, pList] of snap.ports) {
        for (const p of pList) {
          if (!portOwners.has(p)) portOwners.set(p, new Set());
          portOwners.get(p).add(pid);
        }
      }
      candidates = selectServerByCdpLineage(candidates, allRows, portOwners, targetCdpPort);
    }

    const expMap = new Map(
      candidates.map((row) => {
        const hubP = extractHubPort(row.CommandLine);
        return [row.ProcessId, hubP ? [hubP, ...expectedPorts] : expectedPorts];
      })
    );
    const ports = await discoverWindowsPorts(
      candidates.map((row) => row.ProcessId),
      { run, expectedPorts: expMap, probe, preloadedNetstatStdout: netOut || null }
    );
    return candidates.map((row) => ({ ...row, Ports: ports.get(row.ProcessId) || [], HubPort: extractHubPort(row.CommandLine) }));
  }

  if (platform === 'darwin') {
    const { stdout } = await run('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,uid=,args='], { timeout: 8000, maxBuffer: 4194304 });
    const allRows = stdout.split(/\r?\n/).flatMap(line => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (!m || Number(m[3]) !== uid) return [];
      return [{ ProcessId: Number(m[1]), ParentProcessId: Number(m[2]), CommandLine: m[4] }];
    });
    let candidates = allRows.filter(r =>
      (languageServer(r.CommandLine) && /--standalone\b/.test(r.CommandLine)) ||
      (hasCdpHint && agyHubCommand(r.CommandLine))
    );
    if (!candidates.length) return [];
    const queryPids = hasCdpHint && candidates.length > 1 ? allRows.map(r => r.ProcessId).slice(0, 512) : candidates.map(r => r.ProcessId);
    const { stdout: sockets } = await run('/usr/sbin/lsof', ['-nP', '-a', '-p', queryPids.join(','), '-iTCP', '-sTCP:LISTEN', '-Fpn'], { timeout: 8000, maxBuffer: 2097152 }).catch(error => {
      if (error.code === 1) return { stdout: error.stdout || '' };
      throw error;
    });
    const ports = parseLsof(sockets);
    if (hasCdpHint && candidates.length > 1) {
      const owners = new Map();
      for (const [pid, vals] of ports) for (const p of vals) { if (!owners.has(p)) owners.set(p, new Set()); owners.get(p).add(pid); }
      candidates = selectServerByCdpLineage(candidates, allRows, owners, targetCdpPort);
    }
    return candidates.map(row => ({ ...row, Ports: ports.get(row.ProcessId) || [], HubPort: extractHubPort(row.CommandLine) }));
  }

  if (platform === 'linux') {
    const allRows = [];
    for (const pid of (await readdir(proc)).filter(p => /^\d+$/.test(p))) {
      try {
        const status = await readFile(join(proc, pid, 'status'), 'utf8');
        if (Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) !== uid) continue;
        const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] || 0);
        const command = (await readFile(join(proc, pid, 'cmdline'), 'utf8')).split('\0').filter(Boolean).join(' ');
        allRows.push({ ProcessId: Number(pid), ParentProcessId: ppid, CommandLine: command });
      } catch {}
    }
    let candidates = allRows.filter(r =>
      (languageServer(r.CommandLine) && /--standalone\b/.test(r.CommandLine)) ||
      (hasCdpHint && agyHubCommand(r.CommandLine))
    );
    if (!candidates.length) return [];
    if (hasCdpHint && candidates.length > 1) {
      const owners = new Map();
      for (const r of allRows) {
        const pList = await linuxPorts(r.ProcessId, { proc }).catch(() => []);
        for (const p of pList) { if (!owners.has(p)) owners.set(p, new Set()); owners.get(p).add(r.ProcessId); }
      }
      candidates = selectServerByCdpLineage(candidates, allRows, owners, targetCdpPort);
    }
    return Promise.all(candidates.map(async row => ({
      ...row,
      Ports: await linuxPorts(row.ProcessId, { proc }).catch(() => []),
      HubPort: extractHubPort(row.CommandLine),
    })));
  }

  return [];
}
