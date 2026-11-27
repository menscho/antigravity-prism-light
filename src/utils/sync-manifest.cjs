// 受管同步路径安全校验、排除规则、顶层同步目录清单与运行期子目录枚举单一真相源（L0，零内部依赖）
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SYNC_SUBDIRS = Object.freeze(['assets', 'src', 'vendor', 'sidecars']);
const EXCLUDED_SYNC_PREFIXES = Object.freeze(['assets/screenshots']);
const EXCLUDED_SYNC_NAMES = new Set(['.ds_store', '__pycache__', '.daemon.pid', '.watch.pid', '.watch.lock']);
const SYNC_SRC_ALLOWED_EXTS = Object.freeze(['.cjs', '.mjs', '.js', '.json']);
const NON_RUNTIME_SRC_NAME_RE = /\.(?:test|spec)\.(?:cjs|mjs|js)$/i;

function normalizeComparePath(p) {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideRoot(rootDir, candidatePath, allowEqual = false) {
  const rel = path.relative(rootDir, candidatePath);
  if (!rel) return allowEqual;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isSafeManagedRelPath(relPath, { allowTrailingSlash = false } = {}) {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.trim() !== relPath) return false;
  if (/[\0\r\n]/.test(relPath)) return false;
  const unified = relPath.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified) || unified.includes(':')) return false;
  const hasTrailing = unified.endsWith('/');
  if (hasTrailing && !allowTrailingSlash) return false;
  const core = hasTrailing ? unified.slice(0, -1) : unified;
  if (!core || core.endsWith('/')) return false;
  for (const seg of core.split('/')) {
    if (!seg || seg === '.' || seg === '..') return false;
  }
  const normalized = path.posix.normalize(core);
  return normalized === core && !normalized.startsWith('../') && !normalized.startsWith('/');
}

function shouldExcludeSyncRelPath(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return true;
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!norm) return true;
  for (const prefix of EXCLUDED_SYNC_PREFIXES) {
    if (norm === prefix || norm.startsWith(`${prefix}/`)) return true;
  }
  for (const seg of norm.split('/')) {
    if (!seg) continue;
    if (EXCLUDED_SYNC_NAMES.has(seg)) return true;
    if (seg.endsWith('.log') || seg.endsWith('.tmp') || /\.tmp\.[a-z0-9._-]+$/i.test(seg)) return true;
    if (seg.startsWith('.staging-') || seg.startsWith('.rollback-')) return true;
  }
  return false;
}

function hasHiddenPathSegment(relPath) {
  return String(relPath || '')
    .split('/')
    .some((seg) => seg.startsWith('.'));
}

/**
 * 校验并规范化新仓声明的 SYNC_SUBDIRS 列表：
 * - 未声明（非数组或空数组）时回退至 fallback；
 * - 已声明时严格拦截越界、反斜杠、驱动器盘符、隐藏目录、排除目录与受保护用户路径，去重后返回。
 */
function normalizeSyncSubdirs(rawSubdirs, opts = null) {
  const fallback =
    Array.isArray(opts?.fallback) && opts.fallback.length > 0 ? opts.fallback : DEFAULT_SYNC_SUBDIRS;
  const isProtected = typeof opts?.isProtectedPath === 'function' ? opts.isProtectedPath : null;

  if (!Array.isArray(rawSubdirs) || rawSubdirs.length === 0) {
    return [...fallback];
  }

  const out = [];
  const seen = new Set();
  for (const item of rawSubdirs) {
    if (typeof item !== 'string') continue;
    if (item.includes('\\') || item.trim() !== item) continue;
    const clean = item.replace(/\/+$/, '');
    if (!clean || !isSafeManagedRelPath(clean)) continue;
    if (hasHiddenPathSegment(clean)) continue;
    if (shouldExcludeSyncRelPath(clean)) continue;
    if (isProtected && isProtected(clean)) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * 递归枚举受管运行期子目录（默认 src/）下的合法普通文件，返回 POSIX 相对路径并按 ASCII 升序稳定排序。
 * 严格跳过符号链接、越界 realpath、隐藏目录/文件、测试文件与非白名单后缀垃圾文件。
 */
function collectManagedSubdirFiles(rootDir, subDir = 'src', opts = null) {
  if (!rootDir || typeof rootDir !== 'string') return [];
  const cleanSub = String(subDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!cleanSub || !isSafeManagedRelPath(cleanSub) || hasHiddenPathSegment(cleanSub) || shouldExcludeSyncRelPath(cleanSub)) {
    return [];
  }

  const allowedExts = new Set(
    (Array.isArray(opts?.allowedExts) && opts.allowedExts.length > 0 ? opts.allowedExts : SYNC_SRC_ALLOWED_EXTS).map(
      (ext) => String(ext).toLowerCase()
    )
  );
  const maxDepth = Number.isInteger(opts?.maxDepth) && opts.maxDepth > 0 ? opts.maxDepth : 16;

  const absRoot = path.resolve(rootDir);
  let realRoot;
  try {
    const rootStat = fs.lstatSync(absRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return [];
    realRoot = fs.realpathSync(absRoot);
  } catch {
    return [];
  }

  const startDir = path.resolve(absRoot, ...cleanSub.split('/'));
  if (!isPathInsideRoot(absRoot, startDir)) return [];
  try {
    const startStat = fs.lstatSync(startDir);
    if (startStat.isSymbolicLink() || !startStat.isDirectory()) return [];
    const realStart = fs.realpathSync(startDir);
    if (!isPathInsideRoot(realRoot, realStart)) return [];
  } catch {
    return [];
  }

  const results = [];
  const seen = new Set();

  const walk = (curAbs, curRel, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(curAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (!name || name.startsWith('.') || ent.isSymbolicLink()) continue;
      const nextRel = `${curRel}/${name}`;
      if (!isSafeManagedRelPath(nextRel) || shouldExcludeSyncRelPath(nextRel)) continue;
      const nextAbs = path.join(curAbs, name);
      let st;
      try {
        st = fs.lstatSync(nextAbs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      let realNext;
      try {
        realNext = fs.realpathSync(nextAbs);
      } catch {
        continue;
      }
      if (!isPathInsideRoot(realRoot, realNext)) continue;

      if (st.isDirectory()) {
        walk(nextAbs, nextRel, depth + 1);
      } else if (st.isFile()) {
        const ext = path.posix.extname(name).toLowerCase();
        if (!allowedExts.has(ext) || NON_RUNTIME_SRC_NAME_RE.test(name)) continue;
        const key = nextRel.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(nextRel);
      }
    }
  };

  walk(startDir, cleanSub, 0);
  results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return results;
}

module.exports = {
  DEFAULT_SYNC_SUBDIRS,
  EXCLUDED_SYNC_PREFIXES,
  EXCLUDED_SYNC_NAMES,
  SYNC_SRC_ALLOWED_EXTS,
  normalizeComparePath,
  isPathInsideRoot,
  isSafeManagedRelPath,
  shouldExcludeSyncRelPath,
  hasHiddenPathSegment,
  normalizeSyncSubdirs,
  collectManagedSubdirFiles,
};
