// Obsidian Prism 统一安装清单（schemaVersion: 2, layoutVersion: 2）与 4 阶段原子事务升级引擎（纯 CJS，兼容 Node 22.0+）
// 零外部依赖（仅 Node.js >= 22 内置模块），全仓受保护用户路径与清理白名单单一真相源。
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_SYNC_SUBDIRS,
  SYNC_SRC_ALLOWED_EXTS,
  isSafeManagedRelPath,
  shouldExcludeSyncRelPath,
  normalizeSyncSubdirs,
  collectManagedSubdirFiles,
} = require('../utils/sync-manifest.cjs');

const INSTALL_MANIFEST_FILENAME = 'install-manifest.json';
const INSTALL_MANIFEST_SCHEMA_VERSION = 2;
const INSTALL_MANIFEST_LAYOUT_VERSION = 2;
const VALID_SCOPES = Object.freeze(['install', 'plugin', 'both']);

const PROTECTED_USER_PATHS = Object.freeze([
  'config.json', 'custom.css', '.bundle-cache.json', '.bundle-cache/', '.daemon.pid', '.watch.pid',
  '.relaunch-prompt-state.json', '.pending-restore-run-in-bg.json', 'repo-meta.json',
  'wallpapers/', 'backups/',
]);
const USER_OWNED_ASSET_PATHS = Object.freeze(['custom.css', 'wallpapers/', 'backups/']);
const PURGE_DATA_FILES = Object.freeze([
  'obsidian-prism-config.backup.json',
  'obsidian-prism-thought.json',
  'obsidian-prism-thought-cache.json',
  'obsidian-prism-usage-rollup-cache.json',
  'obsidian-prism-storage-guard-state.json',
  'obsidian-prism-sidebar.json',
  'obsidian-prism-sidebar.json.lock',
  'obsidian-prism-wallpaper.json',
  'obsidian-prism-suggester.json',
]);
const DEFAULT_OBSOLETE_PATHS = Object.freeze([
  // 历史已退役模块（10 项：原 Swarm 独立包与旧版壁纸 Studio/HUD/程序化脚本，仓内已清零）
  'vendor/swarm-prism/index.js',
  'vendor/swarm-prism/swarm-assets.js',
  'vendor/swarm-prism/swarm-i18n.js',
  'vendor/swarm-prism/swarm-prism.css',
  'vendor/swarm-prism/swarm-runtime.js',
  'vendor/wallpaper/studio-ui/index.html',
  'vendor/wallpaper/studio-ui/studio.css',
  'vendor/wallpaper/studio-ui/studio.js',
  'vendor/wallpaper/wallpaper-hud.js',
  'vendor/wallpaper/wallpaper-procedural.js',
  // 已彻底退役的旧版 app.asar 补丁与旧多通道注入文件
  'tools/patch-asar.cjs',
  'src/channels/inject-runtime-channels.cjs',
  // 历史已迁移至 docs/CONTRIBUTORS.md 的根目录旧副本（安全清理老插件目录残留）
  'CONTRIBUTORS.md',
]);
const ATOMIC_UPGRADE_RETRY_BACKOFFS_MS = Object.freeze([100, 250, 500]);

function computeBufferSha256(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? ''), 'utf8');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function computeFileSha256(filePath) {
  return computeBufferSha256(fs.readFileSync(filePath));
}

function normalizeProtectedRule(rule) {
  if (typeof rule !== 'string' || !rule.trim()) return null;
  const unified = rule.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const isDir = unified.endsWith('/');
  const core = unified.replace(/\/+$/, '');
  if (!core || !isSafeManagedRelPath(core)) return null;
  return { canonical: isDir ? `${core}/` : core, lower: core.toLowerCase() };
}

function isProtectedUserPath(relPath, protectedPaths = PROTECTED_USER_PATHS) {
  if (typeof relPath !== 'string' || !relPath.trim()) return false;
  const clean = relPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!clean) return false;
  const lowerRel = clean.toLowerCase();
  const rules = Array.isArray(protectedPaths) ? protectedPaths : PROTECTED_USER_PATHS;
  for (const raw of rules) {
    const parsed = normalizeProtectedRule(raw);
    if (parsed && (lowerRel === parsed.lower || lowerRel.startsWith(`${parsed.lower}/`))) return true;
  }
  return false;
}

function mergeProtectedUserPaths(extraProtectedPaths = []) {
  const seen = new Set();
  const out = [];
  for (const raw of [...PROTECTED_USER_PATHS, ...(Array.isArray(extraProtectedPaths) ? extraProtectedPaths : [])]) {
    const parsed = normalizeProtectedRule(raw);
    if (!parsed || seen.has(parsed.lower)) continue;
    seen.add(parsed.lower);
    out.push(parsed.canonical);
  }
  return out;
}

function classifyObsoleteCandidate(relPath, protectedPaths = PROTECTED_USER_PATHS) {
  if (!isSafeManagedRelPath(relPath)) return { allowed: false, reason: 'unsafe_path' };
  if (isProtectedUserPath(relPath, mergeProtectedUserPaths(protectedPaths))) {
    return { allowed: false, reason: 'protected_user_path' };
  }
  return { allowed: true, reason: 'ok', normalizedPath: relPath.replace(/\\/g, '/') };
}

function buildInstallManifest({
  version = '0.0.0',
  entries = [],
  obsoletePaths = [],
  extraProtectedPaths = [],
} = {}) {
  const protectedUserPaths = mergeProtectedUserPaths(extraProtectedPaths);
  const fileMap = new Map();
  for (const item of Array.isArray(entries) ? entries : []) {
    if (!item || typeof item !== 'object') continue;
    const rawPath = String(item.path ?? item.name ?? '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(rawPath)) throw new Error(`Unsafe managed entry path in manifest: "${rawPath}"`);
    const scope = VALID_SCOPES.includes(item.scope) ? item.scope : 'plugin';
    let sha256 = typeof item.sha256 === 'string' ? item.sha256.trim().toLowerCase() : '';
    let size = Number.isInteger(item.size) && item.size >= 0 ? item.size : -1;
    if (item.data !== undefined && item.data !== null) {
      const buf = Buffer.isBuffer(item.data) ? item.data : Buffer.from(String(item.data), 'utf8');
      sha256 = computeBufferSha256(buf);
      size = buf.length;
    }
    if (!/^[0-9a-f]{64}$/.test(sha256) || size < 0) {
      throw new Error(`Manifest entry "${rawPath}" requires valid data or sha256/size`);
    }
    const prev = fileMap.get(rawPath);
    fileMap.set(rawPath, {
      path: rawPath,
      scope: prev ? (prev.scope === scope ? scope : 'both') : scope,
      sha256,
      size,
      required: item.required !== false && (prev ? prev.required !== false : true),
    });
  }

  const safeObsolete = [];
  const seenObs = new Set();
  for (const obs of [...DEFAULT_OBSOLETE_PATHS, ...(Array.isArray(obsoletePaths) ? obsoletePaths : [])]) {
    const check = classifyObsoleteCandidate(obs, protectedUserPaths);
    if (!check.allowed) continue;
    const key = check.normalizedPath.toLowerCase();
    if (!seenObs.has(key)) { seenObs.add(key); safeObsolete.push(check.normalizedPath); }
  }

  return {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    layoutVersion: INSTALL_MANIFEST_LAYOUT_VERSION,
    version: String(version || '0.0.0'),
    protectedUserPaths,
    purgeDataFiles: [...PURGE_DATA_FILES],
    obsoletePaths: safeObsolete.sort((a, b) => a.localeCompare(b)),
    files: [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function readInstallManifestFromDir(dirPath) {
  if (!dirPath) return null;
  const manifestPath = path.join(dirPath, INSTALL_MANIFEST_FILENAME);
  try {
    const st = fs.lstatSync(manifestPath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function defaultSleepSync(ms) {
  const duration = Math.max(1, Number(ms) || 1);
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration); }
  catch { const end = Date.now() + duration; while (Date.now() < end) {} }
}

function retryFsOp(fn, { backoffs = ATOMIC_UPGRADE_RETRY_BACKOFFS_MS, sleepFn = defaultSleepSync } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try { return fn(attempt); }
    catch (err) {
      const code = err && err.code;
      if ((code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') || attempt >= backoffs.length) throw err;
      lastErr = err;
      sleepFn(backoffs[attempt]);
    }
  }
  throw lastErr;
}

function assertNoSymlinkRelative(rootDir, relPath) {
  let cur = path.resolve(rootDir);
  for (const seg of relPath.replace(/\\/g, '/').split('/').filter(Boolean)) {
    cur = path.join(cur, seg);
    try { if (fs.lstatSync(cur).isSymbolicLink()) throw new Error(`Refusing symbolic link segment: ${cur}`); }
    catch (err) { if (err && err.code === 'ENOENT') break; throw err; }
  }
}

function clearReadOnlyRegularFile(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return;
    if (process.platform === 'win32') fs.chmodSync(filePath, 0o666);
    else if ((st.mode & 0o200) === 0) fs.chmodSync(filePath, (st.mode & 0o777) | 0o200);
  } catch {}
}

function resolveUnderRootStrict(rootDir, relPath) {
  if (!isSafeManagedRelPath(relPath)) throw new Error(`Unsafe managed relative path: "${relPath}"`);
  const absRoot = path.resolve(rootDir);
  const absTarget = path.resolve(absRoot, ...relPath.replace(/\\/g, '/').split('/'));
  const cmpRoot = process.platform === 'win32' ? absRoot.toLowerCase() : absRoot;
  const cmpTarget = process.platform === 'win32' ? absTarget.toLowerCase() : absTarget;
  const prefix = cmpRoot.endsWith(path.sep) ? cmpRoot : cmpRoot + path.sep;
  if (!cmpTarget.startsWith(prefix)) throw new Error(`Path escapes target root: "${relPath}"`);
  return absTarget;
}

function normalizeStagedFilesInput(stagedFiles) {
  const map = new Map();
  const add = (rawPath, spec) => {
    const rel = String(rawPath ?? '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(rel)) throw new Error(`Unsafe staged file path: "${rel}"`);
    if (Buffer.isBuffer(spec)) return void map.set(rel, spec);
    if (typeof spec === 'string') return void map.set(rel, Buffer.from(spec, 'utf8'));
    if (spec && typeof spec === 'object') {
      if (spec.data !== undefined && spec.data !== null) {
        return void map.set(rel, Buffer.isBuffer(spec.data) ? spec.data : Buffer.from(String(spec.data), 'utf8'));
      }
      if (typeof spec.srcPath === 'string' && spec.srcPath) {
        const st = fs.lstatSync(spec.srcPath);
        if (st.isSymbolicLink() || !st.isFile()) throw new Error(`Refusing non-regular staged source: ${spec.srcPath}`);
        return void map.set(rel, fs.readFileSync(spec.srcPath));
      }
    }
    throw new Error(`Unsupported staged entry for "${rel}"`);
  };
  if (stagedFiles instanceof Map) for (const [k, v] of stagedFiles.entries()) add(k, v);
  else if (Array.isArray(stagedFiles)) for (const item of stagedFiles) if (item && typeof item === 'object') add(item.path ?? item.name, item);
  else if (stagedFiles && typeof stagedFiles === 'object') for (const [k, v] of Object.entries(stagedFiles)) add(k, v);
  return map;
}

function pruneEmptyParentDirs(filePath, stopRoot) {
  const absStop = path.resolve(stopRoot);
  const cmpStop = process.platform === 'win32' ? absStop.toLowerCase() : absStop;
  const prefix = cmpStop.endsWith(path.sep) ? cmpStop : cmpStop + path.sep;
  let cur = path.dirname(path.resolve(filePath));
  for (let depth = 0; depth < 32; depth++) {
    const cmpCur = process.platform === 'win32' ? cur.toLowerCase() : cur;
    if (cmpCur === cmpStop || !cmpCur.startsWith(prefix)) break;
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink() || !st.isDirectory() || fs.readdirSync(cur).length > 0) break;
      fs.rmdirSync(cur);
      cur = path.dirname(cur);
    } catch { break; }
  }
}

/**
 * 4 阶段纯 Node 原子事务升级引擎：
 * 1) 同卷 .staging-<token> 落盘并全量校验 SHA-256；
 * 2) 被覆盖受管文件与待清扫废弃文件快照到 .rollback-<token>（严禁触碰 protectedUserPaths）；
 * 3) 原子替换到位（Windows 锁文件按 100/250/500ms 退避重试）并按 obsoletePaths 精准清扫；
 * 4) 完整性复核，任意步骤失败自动逆序从 .rollback-<token> 完整回滚；若任一文件回滚恢复失败，严禁删除 .rollback-<token> 并明示现场路径。
 */
function applyManifestAtomicUpgrade({
  targetDir,
  stagedFiles,
  manifest,
  backupDir = null,
  scope = null,
  allowSeedProtected = false,
  _testHooks = null,
} = {}) {
  if (!targetDir || typeof targetDir !== 'string') throw new Error('targetDir is required');
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files)) {
    throw new Error('Valid manifest with files array is required');
  }
  const hooks = _testHooks && typeof _testHooks === 'object' ? _testHooks : {};
  const retryOpts = {
    backoffs: ATOMIC_UPGRADE_RETRY_BACKOFFS_MS,
    sleepFn: typeof hooks.sleepSync === 'function' ? hooks.sleepSync : defaultSleepSync,
  };
  const renameFn = typeof hooks.renameSync === 'function' ? hooks.renameSync : fs.renameSync;
  const unlinkFn = typeof hooks.unlinkSync === 'function' ? hooks.unlinkSync : fs.unlinkSync;
  const rollbackRenameFn = typeof hooks.rollbackRenameSync === 'function' ? hooks.rollbackRenameSync : fs.renameSync;
  const rollbackCopyFn = typeof hooks.rollbackCopyFileSync === 'function' ? hooks.rollbackCopyFileSync : fs.copyFileSync;
  const rollbackUnlinkFn = typeof hooks.rollbackUnlinkSync === 'function' ? hooks.rollbackUnlinkSync : fs.unlinkSync;

  const absTarget = path.resolve(targetDir);
  try {
    const st = fs.lstatSync(absTarget);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`Refusing symlink or non-directory targetDir: ${absTarget}`);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
    fs.mkdirSync(absTarget, { recursive: true });
  }

  const protectedPaths = mergeProtectedUserPaths(manifest.protectedUserPaths);
  const stagedMap = normalizeStagedFilesInput(stagedFiles);
  const preservedProtected = [];
  const deployPlan = [];

  for (const rawEntry of manifest.files) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const rel = String(rawEntry.path || '').replace(/\\/g, '/');
    if (!isSafeManagedRelPath(rel)) throw new Error(`Unsafe managed file path in manifest: "${rel}"`);
    if (scope && rawEntry.scope && rawEntry.scope !== 'both' && rawEntry.scope !== scope) continue;
    const entry = {
      path: rel,
      sha256: String(rawEntry.sha256 || '').trim().toLowerCase(),
      size: Number(rawEntry.size),
      required: rawEntry.required !== false,
    };
    const destAbs = resolveUnderRootStrict(absTarget, rel);
    if (isProtectedUserPath(rel, protectedPaths) && (fs.existsSync(destAbs) || !allowSeedProtected)) {
      preservedProtected.push(rel);
      continue;
    }
    const buf = stagedMap.get(rel);
    if (!buf) {
      if (entry.required) throw new Error(`Missing required staged file for manifest entry: "${rel}"`);
      continue;
    }
    deployPlan.push({ entry, destAbs, buf });
  }

  const plannedSet = new Set(deployPlan.map((d) => d.entry.path));
  for (const rel of stagedMap.keys()) {
    if (!plannedSet.has(rel) && isProtectedUserPath(rel, protectedPaths) && !preservedProtected.includes(rel)) {
      preservedProtected.push(rel);
    }
  }

  const obsoletePlan = [];
  const rejectedObsolete = [];
  for (const rawObs of Array.isArray(manifest.obsoletePaths) ? manifest.obsoletePaths : []) {
    const cls = classifyObsoleteCandidate(rawObs, protectedPaths);
    if (!cls.allowed) { rejectedObsolete.push({ path: String(rawObs ?? ''), reason: cls.reason }); continue; }
    if (!plannedSet.has(cls.normalizedPath)) {
      obsoletePlan.push({ relPath: cls.normalizedPath, absPath: resolveUnderRootStrict(absTarget, cls.normalizedPath) });
    }
  }

  const token = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const stagingDir = path.join(absTarget, `.staging-${token}`);
  const rollbackDir = backupDir ? path.join(path.resolve(backupDir), `.rollback-${token}`) : path.join(absTarget, `.rollback-${token}`);
  const committedOps = [];
  const removedObsolete = [];

  const cleanupTemps = ({ keepRollback = false } = {}) => {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
    if (!keepRollback) {
      try { fs.rmSync(rollbackDir, { recursive: true, force: true }); } catch {}
    }
  };

  const rollbackCommitted = () => {
    const failedFiles = [];
    for (let i = committedOps.length - 1; i >= 0; i--) {
      const op = committedOps[i];
      try {
        if (op.existed) {
          if (!op.backupAbs || !fs.existsSync(op.backupAbs)) {
            throw new Error(`Missing rollback snapshot for "${op.relPath || op.destAbs}"`);
          }
          fs.mkdirSync(path.dirname(op.destAbs), { recursive: true });
          clearReadOnlyRegularFile(op.destAbs);
          retryFsOp(() => {
            try {
              rollbackRenameFn(op.backupAbs, op.destAbs);
            } catch (renErr) {
              if (hooks.rollbackRenameSync && !hooks.rollbackCopyFileSync && renErr && renErr._noCopyFallback) {
                throw renErr;
              }
              rollbackCopyFn(op.backupAbs, op.destAbs);
            }
          }, retryOpts);
        } else {
          clearReadOnlyRegularFile(op.destAbs);
          if (fs.existsSync(op.destAbs)) retryFsOp(() => rollbackUnlinkFn(op.destAbs), retryOpts);
          pruneEmptyParentDirs(op.destAbs, absTarget);
        }
      } catch (rbErr) {
        failedFiles.push({
          path: op.relPath || op.destAbs,
          destAbs: op.destAbs,
          backupAbs: op.backupAbs || null,
          error: String(rbErr && rbErr.message ? rbErr.message : rbErr),
        });
      }
    }
    return { ok: failedFiles.length === 0, failedFiles };
  };

  try {
    // Stage 1: 同卷 .staging-<token> 落盘并全量校验 SHA-256
    fs.mkdirSync(stagingDir, { recursive: true });
    for (const item of deployPlan) {
      item.stageAbs = resolveUnderRootStrict(stagingDir, item.entry.path);
      fs.mkdirSync(path.dirname(item.stageAbs), { recursive: true });
      fs.writeFileSync(item.stageAbs, item.buf);
    }
    if (typeof hooks.afterStage === 'function') hooks.afterStage({ stagingDir, deployPlan });
    for (const item of deployPlan) {
      const actualBuf = fs.readFileSync(item.stageAbs);
      const actualSha = computeBufferSha256(actualBuf);
      if (actualBuf.length !== item.entry.size || actualSha !== item.entry.sha256) {
        const err = new Error(`SHA256_MISMATCH for "${item.entry.path}": expected ${item.entry.sha256}, got ${actualSha}`);
        err.code = 'SHA256_MISMATCH';
        throw err;
      }
    }

    // Stage 2: 将被覆盖受管文件与待清扫废弃文件快照到 .rollback-<token>
    fs.mkdirSync(rollbackDir, { recursive: true });
    for (const item of deployPlan) {
      assertNoSymlinkRelative(absTarget, item.entry.path);
      let existing = null;
      try { existing = fs.lstatSync(item.destAbs); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
      if (existing) {
        if (existing.isSymbolicLink() || !existing.isFile()) throw new Error(`Refusing non-regular target: ${item.destAbs}`);
        item.backupAbs = resolveUnderRootStrict(rollbackDir, item.entry.path);
        fs.mkdirSync(path.dirname(item.backupAbs), { recursive: true });
        fs.copyFileSync(item.destAbs, item.backupAbs);
        item.existed = true;
      } else { item.existed = false; item.backupAbs = null; }
    }
    for (const obs of obsoletePlan) {
      try {
        assertNoSymlinkRelative(absTarget, obs.relPath);
        const st = fs.lstatSync(obs.absPath);
        if (st.isSymbolicLink() || !st.isFile()) {
          rejectedObsolete.push({ path: obs.relPath, reason: st.isSymbolicLink() ? 'symlink' : 'not_regular_file' });
          obs.skip = true;
          continue;
        }
        obs.backupAbs = resolveUnderRootStrict(rollbackDir, obs.relPath);
        fs.mkdirSync(path.dirname(obs.backupAbs), { recursive: true });
        fs.copyFileSync(obs.absPath, obs.backupAbs);
      } catch (e) {
        if (!e || e.code !== 'ENOENT') rejectedObsolete.push({ path: obs.relPath, reason: 'symlink' });
        obs.skip = true;
      }
    }

    // Stage 3: 原子替换到位（退避重试）+ obsoletePaths 精准清扫
    for (let idx = 0; idx < deployPlan.length; idx++) {
      const item = deployPlan[idx];
      if (typeof hooks.beforeCommitFile === 'function') hooks.beforeCommitFile(item.entry.path, idx, item);
      assertNoSymlinkRelative(absTarget, item.entry.path);
      fs.mkdirSync(path.dirname(item.destAbs), { recursive: true });
      clearReadOnlyRegularFile(item.destAbs);
      retryFsOp(() => renameFn(item.stageAbs, item.destAbs), retryOpts);
      committedOps.push({ relPath: item.entry.path, destAbs: item.destAbs, existed: item.existed, backupAbs: item.backupAbs });
    }
    for (const obs of obsoletePlan) {
      if (obs.skip) continue;
      if (isProtectedUserPath(obs.relPath, protectedPaths)) {
        rejectedObsolete.push({ path: obs.relPath, reason: 'protected_user_path' });
        continue;
      }
      assertNoSymlinkRelative(absTarget, obs.relPath);
      const cur = fs.lstatSync(obs.absPath);
      if (cur.isSymbolicLink() || !cur.isFile()) {
        rejectedObsolete.push({ path: obs.relPath, reason: 'symlink' });
        continue;
      }
      clearReadOnlyRegularFile(obs.absPath);
      retryFsOp(() => unlinkFn(obs.absPath), retryOpts);
      committedOps.push({ relPath: obs.relPath, destAbs: obs.absPath, existed: true, backupAbs: obs.backupAbs });
      removedObsolete.push(obs.relPath);
      pruneEmptyParentDirs(obs.absPath, absTarget);
    }

    // Stage 4: 完整性复核
    if (typeof hooks.beforeVerify === 'function') hooks.beforeVerify({ targetDir: absTarget, deployPlan });
    for (const item of deployPlan) {
      const diskSha = computeFileSha256(item.destAbs);
      if (diskSha !== item.entry.sha256) {
        const err = new Error(`POST_COMMIT_VERIFY_FAILED for "${item.entry.path}": expected ${item.entry.sha256}, got ${diskSha}`);
        err.code = 'POST_COMMIT_VERIFY_FAILED';
        throw err;
      }
    }

    cleanupTemps({ keepRollback: false });
    return {
      ok: true,
      appliedFiles: deployPlan.map((d) => d.entry.path),
      preservedProtected,
      removedObsolete,
      rejectedObsolete,
      verifiedCount: deployPlan.length,
    };
  } catch (err) {
    const rollbackResult = rollbackCommitted();
    const rollbackOk = rollbackResult.ok;
    // 任一文件回滚恢复失败时严禁删除 .rollback-<token> 备份目录，保留现场供人工或后续恢复
    cleanupTemps({ keepRollback: !rollbackOk });
    if (err && typeof err === 'object') {
      err.rolledBack = rollbackOk;
      err.rollbackResult = rollbackResult;
      if (!rollbackOk) {
        err.rollbackBackupDir = rollbackDir;
        const failedNames = rollbackResult.failedFiles.map((f) => f.path).join(', ');
        err.message = `${err.message} [ROLLBACK INCOMPLETE: failed to restore ${failedNames}; backup preserved at ${rollbackDir}]`;
      }
    }
    throw err;
  }
}

module.exports = {
  INSTALL_MANIFEST_FILENAME,
  INSTALL_MANIFEST_SCHEMA_VERSION,
  INSTALL_MANIFEST_LAYOUT_VERSION,
  VALID_SCOPES,
  PROTECTED_USER_PATHS,
  USER_OWNED_ASSET_PATHS,
  PURGE_DATA_FILES,
  DEFAULT_OBSOLETE_PATHS,
  DEFAULT_SYNC_SUBDIRS,
  SYNC_SUBDIRS: DEFAULT_SYNC_SUBDIRS,
  SYNC_SRC_ALLOWED_EXTS,
  ATOMIC_UPGRADE_RETRY_BACKOFFS_MS,
  computeBufferSha256,
  computeFileSha256,
  isSafeManagedRelPath,
  shouldExcludeSyncRelPath,
  normalizeSyncSubdirs,
  collectManagedSubdirFiles,
  isProtectedUserPath,
  mergeProtectedUserPaths,
  classifyObsoleteCandidate,
  buildInstallManifest,
  readInstallManifestFromDir,
  applyManifestAtomicUpgrade,
};
