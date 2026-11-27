// Obsidian Prism 受限只读行内 Diff 服务（Git 子进程安全隔离、LRU 缓存与信号量并发控制，Tier 1）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { canonicalRealpathSync, isPathWithinRoot } from './fs-atomic.mjs';
import {
  INLINE_DIFF_MAX_DIFF_LINES,
  INLINE_DIFF_MAX_SNAPSHOT_LINES,
  INLINE_DIFF_MAX_LINE_CHARS,
  INLINE_DIFF_MAX_READ_BYTES,
  INLINE_DIFF_EXPAND_MAX_DIFF_LINES,
  INLINE_DIFF_EXPAND_MAX_SNAPSHOT_LINES,
  INLINE_DIFF_EXPAND_MAX_READ_BYTES,
  INLINE_DIFF_GIT_MAX_BUFFER,
  INLINE_DIFF_REV_PARSE_TIMEOUT_MS,
  INLINE_DIFF_GIT_DIFF_TIMEOUT_MS,
  INLINE_DIFF_MAX_GIT_POINTER_BYTES,
  clampPositiveInt,
  hasBlockedInlineDiffUnc,
  hasDotDotPathSegment,
  isSensitiveInlineDiffPath,
  truncateInlineDiffLine,
  resolveInlineDiffCandidatePath,
  parseInlineUnifiedDiff,
} from './inline-diff-filter.mjs';

const INLINE_DIFF_CACHE_MAX = 128;
const INLINE_DIFF_MAX_CONCURRENCY = 3;
const INLINE_DIFF_MAX_QUEUE = 16;
const INLINE_DIFF_GIT_TTL_MS = 2500;
const INLINE_DIFF_GIT_META_CACHE_MAX = 128;
const INLINE_DIFF_GIT_STATUS_MAX_BUFFER = 256 * 1024;
const INLINE_DIFF_MAX_GIT_CONFIG_BYTES = 64 * 1024;
const INLINE_DIFF_UNSAFE_GIT_CONFIG_FILTER_RE = /(^|\r?\n)\s*\[filter\s+/i;
const INLINE_DIFF_UNSAFE_GIT_CONFIG_FSMONITOR_RE = /\bfsmonitor\s*=/i;

const inlineDiffLruCache = new Map();
const inlineDiffInFlight = new Map();
const gitRootTtlCache = new Map();
const gitConfigSafeCache = new Map();
const repoStatusTtlCache = new Map();
const repoStatusInFlight = new Map();
const inlineDiffStats = {
  gitExecCount: 0,
  rootCacheHits: 0,
  statusCacheHits: 0,
  statusInFlightDedups: 0,
};
let inlineDiffActiveCount = 0;
const inlineDiffWaitQueue = [];

export function getInlineDiffStats() {
  return {
    ...inlineDiffStats,
    cacheSize: inlineDiffLruCache.size,
    cacheMax: INLINE_DIFF_CACHE_MAX,
    gitRootCacheSize: gitRootTtlCache.size,
    repoStatusCacheSize: repoStatusTtlCache.size,
  };
}

export function clearInlineDiffCaches() {
  inlineDiffLruCache.clear();
  gitRootTtlCache.clear();
  gitConfigSafeCache.clear();
  repoStatusTtlCache.clear();
  inlineDiffStats.gitExecCount = 0;
  inlineDiffStats.rootCacheHits = 0;
  inlineDiffStats.statusCacheHits = 0;
  inlineDiffStats.statusInFlightDedups = 0;
}

function resolveSafeGitCwd() {
  const tmp = os.tmpdir();
  if (typeof tmp !== 'string' || !tmp || tmp.includes('\0') || hasBlockedInlineDiffUnc(tmp)) {
    return null;
  }
  try {
    const realTmp = canonicalRealpathSync(tmp);
    const st = fs.lstatSync(realTmp);
    if (st.isSymbolicLink() || !st.isDirectory() || hasBlockedInlineDiffUnc(realTmp)) return null;
    return realTmp;
  } catch {
    return null;
  }
}

function execGitInlineDiff(
  args,
  { timeoutMs = INLINE_DIFF_REV_PARSE_TIMEOUT_MS, maxBuffer = INLINE_DIFF_GIT_MAX_BUFFER } = {}
) {
  const safeCwd = resolveSafeGitCwd();
  if (!safeCwd) {
    return Promise.resolve({ ok: false, code: 'INVALID_CWD', stdout: '' });
  }
  const fullArgs = [
    '--no-optional-locks',
    '--literal-pathspecs',
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'submodule.recurse=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.pager=cat',
    '-c',
    'diff.external=',
    ...args,
  ];
  inlineDiffStats.gitExecCount += 1;
  return new Promise((resolve) => {
    execFile(
      'git',
      fullArgs,
      {
        cwd: safeCwd,
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_LITERAL_PATHSPECS: '1',
          GIT_OPTIONAL_LOCKS: '0',
          NoDefaultCurrentDirectoryInExePath: '1',
        },
      },
      (err, stdout) => {
        resolve({
          ok: !err,
          code: err?.code || null,
          stdout: typeof stdout === 'string' ? stdout : '',
        });
      }
    );
  });
}

function normalizeComparablePath(p) {
  let norm = path.normalize(String(p || ''));
  if (norm.length > 1 && (norm.endsWith(path.sep) || norm.endsWith('/'))) {
    norm = norm.slice(0, -1);
  }
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

function isSameCanonicalPath(candidatePath, realPath, allowDarwinSystemRootAlias = false) {
  const a = normalizeComparablePath(candidatePath);
  const b = normalizeComparablePath(realPath);
  if (a === b) return true;
  if (allowDarwinSystemRootAlias && process.platform === 'darwin') {
    if ((a.startsWith('/var/') && `/private${a}` === b) || (a.startsWith('/tmp/') && `/private${a}` === b)) {
      return true;
    }
  }
  return false;
}

function readSmallNoFollowFileSync(filePath, maxBytes) {
  let fd = null;
  try {
    const openFlags =
      process.platform !== 'win32' && typeof fs.constants?.O_NOFOLLOW === 'number'
        ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
        : 'r';
    fd = fs.openSync(filePath, openFlags);
    const fdStat = fs.fstatSync(fd);
    if (!fdStat.isFile() || fdStat.size > maxBytes) return null;
    const postStat = fs.lstatSync(filePath);
    if (postStat.isSymbolicLink() || !postStat.isFile()) return null;
    if (process.platform !== 'win32' && (fdStat.ino !== postStat.ino || fdStat.dev !== postStat.dev)) {
      return null;
    }
    const buf = Buffer.alloc(fdStat.size);
    let offset = 0;
    while (offset < fdStat.size) {
      const n = fs.readSync(fd, buf, offset, fdStat.size - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    return buf.subarray(0, offset).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function resolveValidatedCommonGitDir(realGitDir) {
  const commonPtrPath = path.join(realGitDir, 'commondir');
  let st;
  try {
    st = fs.lstatSync(commonPtrPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return realGitDir;
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile() || st.size <= 0 || st.size > INLINE_DIFF_MAX_GIT_POINTER_BYTES) {
    return null;
  }
  const rawCommon = readSmallNoFollowFileSync(commonPtrPath, INLINE_DIFF_MAX_GIT_POINTER_BYTES);
  if (typeof rawCommon !== 'string') return null;
  const trimmed = rawCommon.trim();
  if (!trimmed || /[\x00-\x1f\x7f]/.test(trimmed) || hasBlockedInlineDiffUnc(trimmed)) return null;
  const commonPath = path.resolve(realGitDir, trimmed);
  if (hasBlockedInlineDiffUnc(commonPath)) return null;
  try {
    const cst = fs.lstatSync(commonPath);
    if (cst.isSymbolicLink() || !cst.isDirectory()) return null;
    const realCommon = canonicalRealpathSync(commonPath);
    if (hasBlockedInlineDiffUnc(realCommon)) return null;
    const rcst = fs.lstatSync(realCommon);
    if (rcst.isSymbolicLink() || !rcst.isDirectory()) return null;
    if (!isSameCanonicalPath(commonPath, realCommon, path.isAbsolute(trimmed))) return null;
    return realCommon;
  } catch {
    return null;
  }
}

function readGitIndexMtimeSafe(realGitDir) {
  const idxPath = path.join(realGitDir, 'index');
  try {
    const idxSt = fs.lstatSync(idxPath);
    if (idxSt.isSymbolicLink() || !idxSt.isFile()) return null;
    return idxSt.mtimeMs || 0;
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    return null;
  }
}

function setBoundedTtlEntry(map, key, val, maxSize = INLINE_DIFF_GIT_META_CACHE_MAX) {
  if (map.has(key)) map.delete(key);
  while (map.size >= maxSize) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  map.set(key, val);
}

function findGitRootFast(startDir, { noCache = false } = {}) {
  const dirKey = normalizeComparablePath(startDir);
  const now = Date.now();
  if (!noCache && dirKey) {
    const cached = gitRootTtlCache.get(dirKey);
    if (cached && now - cached.at < INLINE_DIFF_GIT_TTL_MS && cached.res?.status === 'ok') {
      try {
        const gst = fs.lstatSync(path.join(cached.res.root, '.git'));
        if (!gst.isSymbolicLink() && (gst.isDirectory() || gst.isFile())) {
          const indexMtimeMs = readGitIndexMtimeSafe(cached.res.gitDir);
          if (indexMtimeMs !== null) {
            inlineDiffStats.rootCacheHits += 1;
            return { ...cached.res, indexMtimeMs };
          }
        }
      } catch {}
      gitRootTtlCache.delete(dirKey);
    }
  }
  let cur = startDir;
  for (let depth = 0; depth < 24 && cur; depth += 1) {
    const gitMarker = path.join(cur, '.git');
    let gst;
    try {
      gst = fs.lstatSync(gitMarker);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        const parent = path.dirname(cur);
        if (!parent || parent === cur) break;
        cur = parent;
        continue;
      }
      return { status: 'invalid' };
    }

    // 严格 Fail-Closed：.git 为符号链接或非常规文件/目录时一律立即拒绝
    if (gst.isSymbolicLink()) return { status: 'invalid' };

    let realCur;
    try {
      realCur = canonicalRealpathSync(cur);
    } catch {
      return { status: 'invalid' };
    }
    if (hasBlockedInlineDiffUnc(realCur)) return { status: 'invalid' };

    if (gst.isDirectory()) {
      let realGitDir;
      try {
        realGitDir = canonicalRealpathSync(gitMarker);
        const rgst = fs.lstatSync(realGitDir);
        if (rgst.isSymbolicLink() || !rgst.isDirectory()) return { status: 'invalid' };
      } catch {
        return { status: 'invalid' };
      }
      if (hasBlockedInlineDiffUnc(realGitDir)) return { status: 'invalid' };
      if (!isSameCanonicalPath(path.join(realCur, '.git'), realGitDir, false)) return { status: 'invalid' };
      const commonGitDir = resolveValidatedCommonGitDir(realGitDir);
      if (!commonGitDir) return { status: 'invalid' };
      const indexMtimeMs = readGitIndexMtimeSafe(realGitDir);
      if (indexMtimeMs === null) return { status: 'invalid' };
      const res = { status: 'ok', root: realCur, gitDir: realGitDir, commonGitDir, indexMtimeMs };
      if (!noCache && dirKey) setBoundedTtlEntry(gitRootTtlCache, dirKey, { at: now, res });
      return res;
    }

    if (gst.isFile()) {
      if (gst.size <= 0 || gst.size > INLINE_DIFF_MAX_GIT_POINTER_BYTES) return { status: 'invalid' };
      const gitPtrRaw = readSmallNoFollowFileSync(gitMarker, INLINE_DIFF_MAX_GIT_POINTER_BYTES);
      if (typeof gitPtrRaw !== 'string') return { status: 'invalid' };
      const gitPtr = gitPtrRaw.trim();
      const m = /^gitdir:\s*([^\r\n]+)$/i.exec(gitPtr);
      if (!m || !m[1]) return { status: 'invalid' };
      const rawPtr = m[1].trim();
      if (!rawPtr || /[\x00-\x1f\x7f]/.test(rawPtr) || hasBlockedInlineDiffUnc(rawPtr)) return { status: 'invalid' };
      const gitDirPath = path.resolve(realCur, rawPtr);
      if (hasBlockedInlineDiffUnc(gitDirPath)) return { status: 'invalid' };
      let realGitDir;
      try {
        const gdLstat = fs.lstatSync(gitDirPath);
        if (gdLstat.isSymbolicLink() || !gdLstat.isDirectory()) return { status: 'invalid' };
        realGitDir = canonicalRealpathSync(gitDirPath);
        if (hasBlockedInlineDiffUnc(realGitDir)) return { status: 'invalid' };
        const rgst = fs.lstatSync(realGitDir);
        if (rgst.isSymbolicLink() || !rgst.isDirectory()) return { status: 'invalid' };
      } catch {
        return { status: 'invalid' };
      }
      if (!isSameCanonicalPath(gitDirPath, realGitDir, path.isAbsolute(rawPtr))) return { status: 'invalid' };
      const commonGitDir = resolveValidatedCommonGitDir(realGitDir);
      if (!commonGitDir) return { status: 'invalid' };
      const indexMtimeMs = readGitIndexMtimeSafe(realGitDir);
      if (indexMtimeMs === null) return { status: 'invalid' };
      const res = { status: 'ok', root: realCur, gitDir: realGitDir, commonGitDir, indexMtimeMs };
      if (!noCache && dirKey) setBoundedTtlEntry(gitRootTtlCache, dirKey, { at: now, res });
      return res;
    }

    return { status: 'invalid' };
  }
  return { status: 'none' };
}

function hasUnsafeGitConfig(gitDir, commonGitDir = null, { noCache = false } = {}) {
  const dirs = [];
  if (gitDir) dirs.push(gitDir);
  if (commonGitDir && commonGitDir !== gitDir) dirs.push(commonGitDir);
  const now = Date.now();
  for (const dir of dirs) {
    const cfgPath = path.join(dir, 'config');
    let st;
    try {
      st = fs.lstatSync(cfgPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      return true;
    }
    if (st.isSymbolicLink() || !st.isFile() || st.size > INLINE_DIFF_MAX_GIT_CONFIG_BYTES) return true;
    const cfgKey = normalizeComparablePath(cfgPath);
    const sig = `${st.mtimeMs}:${st.size}`;
    if (!noCache && cfgKey) {
      const hit = gitConfigSafeCache.get(cfgKey);
      if (hit && hit.sig === sig && now - hit.at < INLINE_DIFF_GIT_TTL_MS) {
        if (hit.unsafe) return true;
        continue;
      }
    }
    const content = readSmallNoFollowFileSync(cfgPath, INLINE_DIFF_MAX_GIT_CONFIG_BYTES);
    if (typeof content !== 'string') return true;
    const unsafe =
      INLINE_DIFF_UNSAFE_GIT_CONFIG_FILTER_RE.test(content) ||
      INLINE_DIFF_UNSAFE_GIT_CONFIG_FSMONITOR_RE.test(content);
    if (!noCache && cfgKey) setBoundedTtlEntry(gitConfigSafeCache, cfgKey, { at: now, sig, unsafe });
    if (unsafe) return true;
  }
  return false;
}

function parsePorcelainZStatus(stdout) {
  const changed = new Set();
  const untracked = new Set();
  if (!stdout) return { changed, untracked };
  const parts = stdout.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const rel = rec.slice(3).replace(/\\/g, '/');
    if (xy === '??') {
      untracked.add(rel);
    } else if (xy !== '!!') {
      changed.add(rel);
      if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
        i += 1;
        if (i < parts.length && parts[i]) changed.add(parts[i].replace(/\\/g, '/'));
      }
    }
  }
  return { changed, untracked };
}

async function getRepoGitStatusSnapshot(realRepoRoot, indexMtimeMs, { timeoutMs, noCache = false, fileMtimeMs = 0 } = {}) {
  const repoKey = normalizeComparablePath(realRepoRoot);
  const now = Date.now();
  if (!noCache && repoKey) {
    const cached = repoStatusTtlCache.get(repoKey);
    if (
      cached &&
      now - cached.at < INLINE_DIFF_GIT_TTL_MS &&
      cached.indexMtimeMs === indexMtimeMs &&
      !cached.truncated &&
      !(fileMtimeMs > cached.startedAt)
    ) {
      inlineDiffStats.statusCacheHits += 1;
      return cached;
    }
    const inflight = repoStatusInFlight.get(repoKey);
    if (inflight && !(fileMtimeMs > inflight.startedAt)) {
      inlineDiffStats.statusInFlightDedups += 1;
      return inflight.promise;
    }
  }
  const startedAt = Date.now();
  const promise = execGitInlineDiff(
    ['-C', realRepoRoot, 'status', '--porcelain=v1', '-z', '-uall'],
    { timeoutMs, maxBuffer: INLINE_DIFF_GIT_STATUS_MAX_BUFFER }
  ).then((res) => {
    const truncated = res.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    const ok = Boolean(res.ok && !truncated);
    const parsed = ok ? parsePorcelainZStatus(res.stdout) : { changed: new Set(), untracked: new Set() };
    const snap = {
      at: Date.now(),
      startedAt,
      indexMtimeMs,
      ok,
      truncated,
      changed: parsed.changed,
      untracked: parsed.untracked,
    };
    if (!noCache && repoKey && ok) setBoundedTtlEntry(repoStatusTtlCache, repoKey, snap, 64);
    return snap;
  });
  if (!noCache && repoKey) {
    const entry = { startedAt, promise };
    repoStatusInFlight.set(repoKey, entry);
    promise.finally(() => {
      if (repoStatusInFlight.get(repoKey) === entry) repoStatusInFlight.delete(repoKey);
    });
  }
  return promise;
}

function getInlineDiffCached(cacheKey) {
  const hit = inlineDiffLruCache.get(cacheKey);
  if (!hit) return null;
  inlineDiffLruCache.delete(cacheKey);
  inlineDiffLruCache.set(cacheKey, hit);
  return hit;
}

function setInlineDiffCached(cacheKey, value) {
  if (!value || !value.ok) return value;
  while (inlineDiffLruCache.size >= INLINE_DIFF_CACHE_MAX) {
    const oldest = inlineDiffLruCache.keys().next().value;
    if (oldest === undefined) break;
    inlineDiffLruCache.delete(oldest);
  }
  inlineDiffLruCache.set(cacheKey, value);
  return value;
}

async function runWithInlineDiffSemaphore(taskFn) {
  if (inlineDiffActiveCount >= INLINE_DIFF_MAX_CONCURRENCY) {
    if (inlineDiffWaitQueue.length >= INLINE_DIFF_MAX_QUEUE) {
      return { ok: false, reason: 'busy', error: 'busy' };
    }
    await new Promise((resolve) => {
      inlineDiffWaitQueue.push(resolve);
    });
  } else {
    inlineDiffActiveCount += 1;
  }
  try {
    return await taskFn();
  } finally {
    const next = inlineDiffWaitQueue.shift();
    if (typeof next === 'function') {
      next();
    } else {
      inlineDiffActiveCount = Math.max(0, inlineDiffActiveCount - 1);
    }
  }
}

function projectInlineDiffEntry(rawEntry, { maxDiffLines, maxSnapshotLines, maxLineChars, hintAdd, hintDel, hintIsCreated, expand = false }) {
  if (!rawEntry || !rawEntry.ok) {
    return rawEntry || { ok: false, error: 'read_failed' };
  }
  if (rawEntry.kind === 'binary') {
    return { ok: true, mode: 'binary', fileName: rawEntry.fileName, additions: 0, deletions: 0, truncated: false, totalLines: 0, lines: [] };
  }
  if (rawEntry.kind === 'git-diff') {
    const parsed = parseInlineUnifiedDiff(rawEntry.rawDiff, {
      maxLines: maxDiffLines,
      maxLineChars,
      hints: hintAdd > 0 || hintDel > 0 ? { additions: hintAdd, deletions: hintDel } : null,
      expand: Boolean(expand),
    });
    if (parsed.ok === false || parsed.blocked) {
      return { ok: false, reason: 'blocked', error: 'blocked' };
    }
    if (parsed.isBinary) {
      return { ok: true, mode: 'binary', fileName: rawEntry.fileName, additions: 0, deletions: 0, truncated: false, totalLines: 0, lines: [] };
    }
    const projected = {
      ok: true,
      mode: 'git-diff',
      fileName: rawEntry.fileName,
      additions: parsed.additions,
      deletions: parsed.deletions,
      truncated: parsed.truncated || Boolean(rawEntry.bufferTruncated),
      focused: Boolean(parsed.focusedByHint),
      totalLines: Number.isFinite(parsed.totalLines) ? parsed.totalLines : parsed.lines.length,
      lines: parsed.lines,
    };
    if (parsed.cumulativeDiff) projected.cumulativeDiff = true;
    if (Number.isInteger(parsed.focusHunk) && parsed.focusHunk >= 0) projected.focusHunk = parsed.focusHunk;
    return projected;
  }
  const textLines = rawEntry.rawText.length > 0 ? rawEntry.rawText.split('\n') : [];
  if (!rawEntry.byteTruncated && textLines.length > 0 && textLines[textLines.length - 1] === '') {
    textLines.pop();
  }
  const lineTruncated = textLines.length > maxSnapshotLines;
  const capped = lineTruncated ? textLines.slice(0, maxSnapshotLines) : textLines;
  const isNewFile = Boolean(rawEntry.isUntracked || hintIsCreated);
  const mode = isNewFile ? 'new-file' : 'snapshot';
  const kind = isNewFile ? 'add' : 'ctx';
  const sign = isNewFile ? '+' : ' ';
  const lines = capped.map((line, idx) => ({
    kind,
    ln: String(idx + 1),
    sign,
    text: truncateInlineDiffLine(line, maxLineChars),
  }));
  return {
    ok: true,
    mode,
    fileName: rawEntry.fileName,
    additions: isNewFile ? lines.length : 0,
    deletions: 0,
    truncated: Boolean(rawEntry.byteTruncated || lineTruncated),
    totalLines: textLines.length,
    lines,
  };
}

// 受限只读行内 Diff 读取器：严防 UNC/NT 设备路径/路径穿越/符号链接逃逸/敏感凭据读取、非 Git 越界读取与 Shell 注入
export async function readSafeInlineDiff(rawUri, opts = {}) {
  const expand = opts?.expand === true;
  const defaultDiffLines = expand ? INLINE_DIFF_EXPAND_MAX_DIFF_LINES : INLINE_DIFF_MAX_DIFF_LINES;
  const defaultSnapshotLines = expand ? INLINE_DIFF_EXPAND_MAX_SNAPSHOT_LINES : INLINE_DIFF_MAX_SNAPSHOT_LINES;
  const defaultReadBytes = expand ? INLINE_DIFF_EXPAND_MAX_READ_BYTES : INLINE_DIFF_MAX_READ_BYTES;
  const maxDiffLines = clampPositiveInt(opts?.maxDiffLines, defaultDiffLines, INLINE_DIFF_EXPAND_MAX_DIFF_LINES);
  const maxSnapshotLines = clampPositiveInt(opts?.maxSnapshotLines, defaultSnapshotLines, INLINE_DIFF_EXPAND_MAX_SNAPSHOT_LINES);
  const maxLineChars = clampPositiveInt(opts?.maxLineChars, INLINE_DIFF_MAX_LINE_CHARS, INLINE_DIFF_MAX_LINE_CHARS);
  const maxReadBytes = clampPositiveInt(opts?.maxReadBytes, defaultReadBytes, INLINE_DIFF_EXPAND_MAX_READ_BYTES);
  const revParseTimeoutMs = clampPositiveInt(opts?.revParseTimeoutMs, INLINE_DIFF_REV_PARSE_TIMEOUT_MS, INLINE_DIFF_REV_PARSE_TIMEOUT_MS * 2);
  const diffTimeoutMs = clampPositiveInt(opts?.diffTimeoutMs, INLINE_DIFF_GIT_DIFF_TIMEOUT_MS, INLINE_DIFF_GIT_DIFF_TIMEOUT_MS * 2);
  const gitMaxBuffer = clampPositiveInt(opts?.gitMaxBuffer, INLINE_DIFF_GIT_MAX_BUFFER, INLINE_DIFF_GIT_MAX_BUFFER);
  const hintAdd = Number.isFinite(Number(opts?.hints?.additions)) ? Math.max(0, Math.trunc(Number(opts.hints.additions))) : 0;
  const hintDel = Number.isFinite(Number(opts?.hints?.deletions)) ? Math.max(0, Math.trunc(Number(opts.hints.deletions))) : 0;
  const hintIsCreated = Boolean(opts?.hints?.isCreated);

  const resolved = resolveInlineDiffCandidatePath(rawUri);
  if (!resolved.ok) return resolved;

  let realPath;
  try {
    realPath = canonicalRealpathSync(resolved.candidatePath);
  } catch (err) {
    const code = err?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, error: 'not_found' };
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, error: 'access_denied' };
    return { ok: false, error: 'read_failed' };
  }

  if (hasBlockedInlineDiffUnc(realPath)) return { ok: false, error: 'blocked_unc' };
  if (isSensitiveInlineDiffPath(realPath)) return { ok: false, error: 'blocked_sensitive' };
  if (process.platform === 'win32' && (!/^[A-Za-z]:[\\/]/.test(realPath) || realPath.slice(2).includes(':'))) {
    return { ok: false, error: 'invalid_uri' };
  }

  let st;
  try {
    st = fs.lstatSync(realPath);
  } catch {
    return { ok: false, error: 'read_failed' };
  }
  if (!st.isFile() || st.isSymbolicLink()) return { ok: false, error: 'not_a_file' };

  const fileName = path.basename(realPath);
  const dir = path.dirname(realPath);

  let realRepoRoot = null;
  let realGitDir = null;
  let realCommonGitDir = null;
  let gitRelPath = '';
  let gitIndexMtimeMs = 0;
  let isNonGit = false;
  const fastGit = findGitRootFast(dir, { noCache: Boolean(opts?.noCache) });
  if (fastGit.status === 'invalid') {
    return { ok: false, reason: 'outside_git_repo', error: 'outside_git_repo' };
  }
  if (fastGit.status === 'ok' && fastGit.root && fastGit.gitDir && !hasBlockedInlineDiffUnc(fastGit.root)) {
    try {
      const candidateRoot = canonicalRealpathSync(fastGit.root);
      const rootStat = fs.lstatSync(candidateRoot);
      if (
        rootStat.isDirectory() &&
        !rootStat.isSymbolicLink() &&
        !hasBlockedInlineDiffUnc(candidateRoot) &&
        isPathWithinRoot(candidateRoot, realPath)
      ) {
        const relNative = path.relative(candidateRoot, realPath);
        const relPosix = relNative.split(path.sep).join('/');
        if (relPosix && !relPosix.includes('\0') && !path.isAbsolute(relNative) && !hasDotDotPathSegment(relPosix)) {
          realRepoRoot = candidateRoot;
          realGitDir = fastGit.gitDir;
          realCommonGitDir = fastGit.commonGitDir || fastGit.gitDir;
          gitRelPath = relPosix;
          gitIndexMtimeMs = fastGit.indexMtimeMs || 0;
        }
      }
    } catch {}
    if (!realRepoRoot || !gitRelPath || !realGitDir) {
      return { ok: false, reason: 'outside_git_repo', error: 'outside_git_repo' };
    }
  } else {
    // 已通过全部路径规范化、敏感路径、UNC/ADS 与非符号链接校验的纯非 Git 文件：降级为受控只读快照
    isNonGit = true;
  }

  const skipGitSubprocess = isNonGit || hasUnsafeGitConfig(realGitDir, realCommonGitDir, { noCache: Boolean(opts?.noCache) });
  const wantCommitFallback = !isNonGit && (hintAdd > 0 || hintDel > 0) && !hintIsCreated ? 1 : 0;
  const rawCacheKey = `${realPath}|${st.mtimeMs}|${st.size}|${isNonGit ? 'nogit' : gitIndexMtimeMs}|${skipGitSubprocess ? 1 : 0}|${wantCommitFallback}|${maxReadBytes}|${gitMaxBuffer}`;
  const projectionOpts = { maxDiffLines, maxSnapshotLines, maxLineChars, hintAdd, hintDel, hintIsCreated, expand };

  if (!opts?.noCache) {
    const cachedRaw = getInlineDiffCached(rawCacheKey);
    if (cachedRaw) return projectInlineDiffEntry(cachedRaw, projectionOpts);
    const existingInFlight = inlineDiffInFlight.get(rawCacheKey);
    if (existingInFlight) {
      const sharedRaw = await existingInFlight;
      return projectInlineDiffEntry(sharedRaw, projectionOpts);
    }
  }

  const fetchRaw = () =>
    runWithInlineDiffSemaphore(async () => {
      let repoStatusSnap = null;
      if (!skipGitSubprocess) {
        repoStatusSnap = await getRepoGitStatusSnapshot(realRepoRoot, gitIndexMtimeMs, {
          timeoutMs: revParseTimeoutMs,
          noCache: Boolean(opts?.noCache),
          fileMtimeMs: st.mtimeMs,
        });
        const hasReliableSnap = Boolean(repoStatusSnap && repoStatusSnap.ok && !repoStatusSnap.truncated);
        const knownUntracked = hasReliableSnap && repoStatusSnap.untracked.has(gitRelPath);
        const knownChanged = hasReliableSnap && repoStatusSnap.changed.has(gitRelPath);
        const needDiffQuery = !hasReliableSnap || knownChanged || Boolean(wantCommitFallback && !knownUntracked);

        if (needDiffQuery) {
          let diffRes = await execGitInlineDiff(
            ['-C', realRepoRoot, 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=2', '--', gitRelPath],
            { timeoutMs: diffTimeoutMs, maxBuffer: gitMaxBuffer }
          );
          let rawDiff = diffRes.ok || diffRes.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? diffRes.stdout : '';
          let bufferTruncated = diffRes.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

          if (!diffRes.ok && !rawDiff.trim()) {
            diffRes = await execGitInlineDiff(
              ['-C', realRepoRoot, 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=2', '--', gitRelPath],
              { timeoutMs: diffTimeoutMs, maxBuffer: gitMaxBuffer }
            );
            rawDiff = diffRes.ok || diffRes.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? diffRes.stdout : '';
            bufferTruncated = diffRes.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          }

          if (!rawDiff.trim() && wantCommitFallback) {
            const logRes = await execGitInlineDiff(
              ['-C', realRepoRoot, 'log', '-n', '1', '-p', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=2', '--', gitRelPath],
              { timeoutMs: diffTimeoutMs, maxBuffer: gitMaxBuffer }
            );
            if (logRes.ok || logRes.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
              rawDiff = logRes.stdout || '';
              bufferTruncated = logRes.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
            }
          }

          if (rawDiff.trim()) {
            const probeParsed = parseInlineUnifiedDiff(rawDiff, { maxLines: 1, maxLineChars: 32 });
            if (probeParsed.ok === false || probeParsed.blocked) {
              return { ok: false, reason: 'blocked', error: 'blocked' };
            }
            if (probeParsed.isBinary) return { ok: true, kind: 'binary', fileName };
            if (probeParsed.lines.length > 0) {
              return { ok: true, kind: 'git-diff', fileName, rawDiff, bufferTruncated };
            }
          }
        }
      }

      const buf = Buffer.alloc(maxReadBytes);
      let bytesRead = 0;
      let fileSize = st.size;
      let fd = null;
      try {
        const openFlags =
          process.platform !== 'win32' && typeof fs.constants?.O_NOFOLLOW === 'number'
            ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
            : 'r';
        fd = fs.openSync(realPath, openFlags);
        const fdStat = fs.fstatSync(fd);
        if (!fdStat.isFile()) return { ok: false, error: 'not_a_file' };
        const postStat = fs.lstatSync(realPath);
        if (postStat.isSymbolicLink() || !postStat.isFile()) return { ok: false, error: 'not_a_file' };
        if (process.platform !== 'win32' && (fdStat.ino !== postStat.ino || fdStat.dev !== postStat.dev)) {
          return { ok: false, error: 'read_failed' };
        }
        fileSize = fdStat.size;
        bytesRead = fs.readSync(fd, buf, 0, maxReadBytes, 0);
      } catch (err) {
        const code = err?.code;
        if (code === 'ELOOP') return { ok: false, error: 'not_a_file' };
        if (code === 'EACCES' || code === 'EPERM') return { ok: false, error: 'access_denied' };
        return { ok: false, error: 'read_failed' };
      } finally {
        if (fd !== null) {
          try { fs.closeSync(fd); } catch {}
        }
      }

      const slice = buf.subarray(0, bytesRead);
      if (slice.includes(0)) return { ok: true, kind: 'binary', fileName };

      let isUntracked = false;
      if (!skipGitSubprocess) {
        if (repoStatusSnap && repoStatusSnap.ok && !repoStatusSnap.truncated) {
          isUntracked = repoStatusSnap.untracked.has(gitRelPath);
        } else {
          const statusRes = await execGitInlineDiff(
            ['-C', realRepoRoot, 'status', '--porcelain', '-uall', '--', gitRelPath],
            { timeoutMs: revParseTimeoutMs, maxBuffer: 64 * 1024 }
          );
          if (statusRes.ok && statusRes.stdout) {
            const firstLine = statusRes.stdout.replace(/^[\r\n]+/, '').split(/\r?\n/, 1)[0] || '';
            if (firstLine.startsWith('?? ')) isUntracked = true;
          }
        }
      }

      const rawText = slice.toString('utf8').replace(/\r\n/g, '\n');
      const byteTruncated = bytesRead < fileSize;
      return { ok: true, kind: 'file', fileName, rawText, byteTruncated, isUntracked, isNonGit };
    });

  if (opts?.noCache) {
    const rawResult = await fetchRaw();
    return projectInlineDiffEntry(rawResult, projectionOpts);
  }

  const inFlightPromise = fetchRaw().then((rawResult) => {
    if (rawResult && rawResult.ok) setInlineDiffCached(rawCacheKey, rawResult);
    return rawResult;
  });
  inlineDiffInFlight.set(rawCacheKey, inFlightPromise);
  try {
    const rawResult = await inFlightPromise;
    return projectInlineDiffEntry(rawResult, projectionOpts);
  } finally {
    if (inlineDiffInFlight.get(rawCacheKey) === inFlightPromise) {
      inlineDiffInFlight.delete(rawCacheKey);
    }
  }
}

export { isSensitiveInlineDiffPath };
