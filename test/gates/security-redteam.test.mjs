import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function listRepoFiles() {
  try {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set([...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)])]
      .map((s) => s.trim())
      .filter((s) => s && fs.existsSync(path.join(ROOT, s)))
      .sort();
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'dist') continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(abs);
        else if (ent.isFile()) out.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
      }
    };
    walk(ROOT);
    return out.sort();
  }
}

function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const ALL_FILES = listRepoFiles();

test('Law 7a: CDP domain strict allowlist (only Page.* / Runtime.* / Target.* / Browser.close; probe read-only Performance)', () => {
  // 1) Strict context-aware allowlist: ANY Domain.method literal in .send/.sendAsync/.on/method: fails unless explicitly allowlisted
  //    (catches known AND unknown/future CDP domains alike, including Audits.*, DOMStorage.*, IndexedDB.*, ServiceWorker.*, IO.*, Log.*, etc.)
  const cdpProtocolCallRe =
    /(?:\.(?:send(?:Async)?|on)\s*\(\s*|['"]?method['"]?\s*[:=]\s*|\[\s*['"]method['"]\s*\]\s*=\s*)['"]([A-Z][A-Za-z0-9]+\.[a-z][A-Za-z0-9]+)['"]/gi;
  // 2) Comprehensive raw-string backstop across all known non-allowlisted CDP domains (blocks indirect variable passing like const m = 'Audits.enable'; s.send(m))
  const KNOWN_CDP_DOMAINS = new Set([
    'Accessibility', 'Animation', 'Audits', 'Autofill', 'BackgroundService', 'Browser',
    'CSS', 'CacheStorage', 'Cast', 'Console', 'DOM', 'DOMDebugger', 'DOMSnapshot', 'DOMStorage',
    'Database', 'Debugger', 'DeviceAccess', 'DeviceOrientation', 'Emulation', 'EventBreakpoints',
    'Extensions', 'FedCm', 'Fetch', 'FileSystem', 'HeadlessExperimental', 'HeapProfiler', 'IO',
    'IndexedDB', 'Input', 'Inspector', 'LayerTree', 'Log', 'Media', 'Memory', 'Network', 'Overlay',
    'PWA', 'Page', 'Performance', 'PerformanceTimeline', 'Preload', 'Profiler', 'Runtime', 'Schema',
    'Security', 'ServiceWorker', 'Storage', 'SystemInfo', 'Target', 'Tethering', 'Tracing',
    'WebAudio', 'WebAuthn',
  ]);
  const rawCdpLiteralRe = /['"]([A-Z][A-Za-z0-9]+\.[a-z][A-Za-z0-9]+)['"]/g;
  const PROBE_READONLY_METHODS = new Set(['Performance.enable', 'Performance.getMetrics']);

  const isAllowedCdpMethod = (rel, method) => {
    const domain = method.split('.')[0];
    if (domain === 'Page' || domain === 'Runtime' || domain === 'Target' || method === 'Browser.close') {
      return true;
    }
    if (rel === 'scripts/probe-host-compat.mjs' && PROBE_READONLY_METHODS.has(method)) {
      return true;
    }
    return false;
  };

  const violations = [];
  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || !/\.(?:mjs|cjs|js|cs|swift)$/.test(rel)) continue;
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    const seenInFile = new Set();

    for (const m of clean.matchAll(cdpProtocolCallRe)) {
      const method = m[1];
      if (!isAllowedCdpMethod(rel, method) && !seenInFile.has(method)) {
        seenInFile.add(method);
        violations.push(`${rel}: non-allowlisted CDP call "${method}"`);
      }
    }
    for (const m of clean.matchAll(rawCdpLiteralRe)) {
      const method = m[1];
      const domain = method.split('.')[0];
      if (!KNOWN_CDP_DOMAINS.has(domain)) continue;
      if (!isAllowedCdpMethod(rel, method) && !seenInFile.has(method)) {
        seenInFile.add(method);
        violations.push(`${rel}: forbidden CDP method literal "${method}"`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `CDP strict allowlist violation (only Page.*/Runtime.*/Target.*/Browser.close permitted):\n${violations.join('\n')}`
  );
});

test('Law 7b: Host SQLite database physical isolation (never open state.vscdb or host conversations/*.db)', () => {
  const violations = [];
  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || !/\.(?:mjs|cjs|js|cs|swift)$/.test(rel)) continue;
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

    if (/state\.vscdb/i.test(clean)) {
      violations.push(`${rel}: references forbidden host database state.vscdb`);
    }

    // Verify any DatabaseSync(...) call never targets host conversations/*.db or *.vscdb
    for (const m of clean.matchAll(/new\s+DatabaseSync\s*\(([^)]+)\)/g)) {
      const arg = m[1];
      if (/vscdb|conversations/i.test(arg)) {
        violations.push(`${rel}: DatabaseSync targets forbidden host DB path (${arg.trim()})`);
      }
    }
  }

  assert.deepEqual(violations, [], `Host database isolation violations:\n${violations.join('\n')}`);
});

test('Law 7c: Repo-wide AV redline gate (including vendor/, src/, installer/ and scripts/win/) locked to strict 0 debt', () => {
  // Permanently locked to 0 across the entire repository (Phase 1A zero-AV clearance).
  const RULES = [
    {
      id: 'encodedCmd',
      re: /['"]-(?:EncodedCommand|enc)['"]|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*-(?:EncodedCommand|enc)\b|-EncodedCommand\b/gi,
    },
    { id: 'hiddenPs', re: /-WindowStyle(?:\s+|['"]\s*,\s*['"])Hidden\b/gi },
    { id: 'addType', re: /\bAdd-Type\b/gi },
    { id: 'wmi', re: /\b(?:Win32_Process|Get-CimInstance|Get-WmiObject)\b/gi },
    { id: 'getNetTcp', re: /\bGet-NetTCPConnection\b/gi },
    { id: 'wscript', re: /\bWScript\.Shell\b/gi },
    { id: 'emptyWorkingSet', re: /\bEmptyWorkingSet\b/gi },
    { id: 'taskkill', re: /\b(?:taskkill|Stop-Process)\b/gi },
  ];

  // Hardened variable-name-agnostic inline `node -e` / `--eval` guard:
  // Blocks passing destructive/self-delete or ad-hoc inline JS code to spawn/execFile regardless of variable naming.
  const ALLOWED_READONLY_DASH_E_PROBES = new Set([
    'src/platform/host-relaunch.cjs',
    'tools/patch-asar.cjs',
  ]);
  const DESTRUCTIVE_INLINE_CODE_RE =
    /\b(?:rmSync|unlinkSync|rmdirSync|writeFileSync|renameSync|chmodSync|child_process)\b|\bfs\.(?:rm|unlink|rmdir)\b/;
  const NODE_DASH_E_CALL_RE =
    /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*(?!['"](?:\/usr\/bin\/)?osascript['"])[^,\n]{1,120},\s*[^;\n]{0,200}['"](?:-e|--eval)['"]/g;
  const NODE_DASH_E_ARRAY_RE =
    /=\s*\[\s*['"](?:-e|--eval)['"]\s*,([^\]]{0,600})\]/g;

  const violations = [];

  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || rel.endsWith('.md') || rel.startsWith('.github/')) continue;
    if (!/\.(?:mjs|cjs|js|bat|sh|ps1|cs|swift|cmd)$/i.test(rel)) continue;
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const text = rel.endsWith('.bat') || rel.endsWith('.cmd') ? raw : stripJsComments(raw);

    for (const rule of RULES) {
      const count = [...text.matchAll(rule.re)].length;
      if (count > 0) {
        violations.push(`${rel}: AV redline "${rule.id}" count=${count} (must be 0)`);
      }
    }

    if (/\.(?:mjs|cjs|js)$/.test(rel)) {
      const hasNodeDashE = NODE_DASH_E_CALL_RE.test(text);
      NODE_DASH_E_CALL_RE.lastIndex = 0;
      let hasSuspiciousArrayDashE = false;
      for (const m of text.matchAll(NODE_DASH_E_ARRAY_RE)) {
        const rhs = m[1] || '';
        const isAppleScript = /osascript|on run argv|tell application|MAC_DIALOG_APPLESCRIPT|MAC_PICK_/i.test(rhs);
        if (!isAppleScript && /\b(?:spawn|spawnSync|execFile|execFileSync)\b/.test(text)) {
          hasSuspiciousArrayDashE = true;
          break;
        }
      }
      if (hasNodeDashE || hasSuspiciousArrayDashE) {
        if (!ALLOWED_READONLY_DASH_E_PROBES.has(rel)) {
          violations.push(`${rel}: AV redline "inlineNodeDashE" disallowed spawn/execFile -e/--eval invocation`);
        } else {
          // Even allowlisted loopback probes must never embed destructive fs/process primitives in their inline script
          for (const m of text.matchAll(/\bprobe(?:Code|Script)\s*=\s*\[([\s\S]*?)\]\.join/g)) {
            if (DESTRUCTIVE_INLINE_CODE_RE.test(m[1])) {
              violations.push(`${rel}: AV redline "inlineNodeDashE" probe contains destructive primitive`);
            }
          }
        }
      }
    }

    // OpenProcess: only permitted in installer/common/CdpClient.cs with PROCESS_QUERY_LIMITED_INFORMATION
    const openProcMatches = [...text.matchAll(/\bOpenProcess\s*\([^)]*\)/g)];
    let nonReadOnlyOpenProc = 0;
    for (const m of openProcMatches) {
      const expr = m[0];
      const isCdpReadOnly =
        rel === 'installer/common/CdpClient.cs' &&
        (expr.includes('PROCESS_QUERY_LIMITED_INFORMATION') || expr.includes('uint dwDesiredAccess'));
      if (!isCdpReadOnly) nonReadOnlyOpenProc += 1;
    }
    if (nonReadOnlyOpenProc > 0) {
      violations.push(`${rel}: non-allowlisted OpenProcess count=${nonReadOnlyOpenProc} (must be 0)`);
    }
  }

  assert.deepEqual(violations, [], `Repo-wide AV redline violations:\n${violations.join('\n')}`);
});

test('Law 7d: Every local http.createServer must explicitly bind to 127.0.0.1 / localhost loopback', () => {
  const violations = [];
  let serverFilesFound = 0;

  for (const rel of ALL_FILES) {
    if (rel.startsWith('test/') || !/\.(?:mjs|cjs|js)$/.test(rel)) continue;
    const clean = stripJsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    if (!/\bcreateServer\s*\(/.test(clean)) continue;
    serverFilesFound += 1;

    // Must not bind 0.0.0.0 or ::
    if (/\.listen\s*\([^)]*['"](?:0\.0\.0\.0|::)['"]/.test(clean)) {
      violations.push(`${rel}: HTTP server binds wildcard address (0.0.0.0 / ::)`);
    }

    // Every .listen(...) call must pass at least 2 args (port + host) and file must default host to 127.0.0.1 / localhost
    const listenCalls = [...clean.matchAll(/\.listen\s*\(([^)]+)\)/g)];
    assert.ok(listenCalls.length > 0, `${rel} calls createServer() without .listen()`);
    const hasLoopbackDefault = /['"](?:127\.0\.0\.1|localhost)['"]/.test(clean);
    if (!hasLoopbackDefault) {
      violations.push(`${rel}: HTTP server lacks explicit 127.0.0.1 / localhost loopback binding`);
    }
    for (const m of listenCalls) {
      const args = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (args.length < 2) {
        violations.push(`${rel}: .listen(${m[1].trim()}) omits explicit loopback host argument`);
      }
    }
  }

  assert.ok(serverFilesFound >= 3, `Expected at least 3 local HTTP server modules checked, found ${serverFilesFound}`);
  assert.deepEqual(violations, [], `Local HTTP loopback binding violations:\n${violations.join('\n')}`);
});

test('Law 7e: Windows PE metadata, watcher app.manifest, SignPath two-step hooks, and trust/security docs exist', () => {
  // LIGHT (2026-11-27): build-installer.mjs PE-metadata check removed with the script.

  // LIGHT (2026-11-27): docs/CODE_SIGNING_POLICY.md removed; Light ships no binaries to sign.
  assert.equal(fs.existsSync(path.join(ROOT, 'docs', 'CODE_SIGNING_POLICY.md')), false);

  const securityMdPath = path.join(ROOT, '.github', 'SECURITY.md');
  assert.equal(fs.existsSync(securityMdPath), true, '.github/SECURITY.md must exist');
  const securityMd = fs.readFileSync(securityMdPath, 'utf8');
  for (const needle of ['app.asar', '127.0.0.1', 'Sec-Fetch-Site', 'SSRF', '0o600', '<USER_HOME>']) {
    assert.ok(securityMd.includes(needle), `.github/SECURITY.md must document security boundary: ${needle}`);
  }
});
