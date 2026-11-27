// Obsidian Prism 仓库运行时热同步与插件原子同步模块（纯 CJS，兼容 Node 22.0+）
// 统一经由 install-manifest.cjs 的 applyManifestAtomicUpgrade 执行同卷 staging + SHA-256 校验 + 回滚保护与用户数据隔离。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ATOMIC_UPGRADE_RETRY_BACKOFFS_MS,
  DEFAULT_OBSOLETE_PATHS,
  DEFAULT_SYNC_SUBDIRS,
  INSTALL_MANIFEST_FILENAME,
  PROTECTED_USER_PATHS,
  USER_OWNED_ASSET_PATHS,
  applyManifestAtomicUpgrade,
  buildInstallManifest,
  classifyObsoleteCandidate,
  isProtectedUserPath,
  isSafeManagedRelPath,
  mergeProtectedUserPaths,
  normalizeSyncSubdirs,
  readInstallManifestFromDir,
  shouldExcludeSyncRelPath,
} = require('./install-manifest.cjs');

function normalizeCmpPath(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathWithinRoot(rootDir, candidatePath, allowEqual = false) {
  const rel = path.relative(rootDir, candidatePath);
  if (!rel) return allowEqual;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hasSymlinkSegment(rootDir, targetPath) {
  const rel = path.relative(rootDir, targetPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  let cur = rootDir;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') break;
      return true;
    }
  }
  return false;
}

/**
 * 递归清理指定根目录下 cdp.js 及 src/**\/*.cjs 全部 CommonJS 模块的 require.cache，
 * 确保拆分后的 src/ 子模块在热重载或仓库热更新后均能真正重新加载。
 */
function clearCdpRequireCache(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') return 0;
  const absRoot = path.resolve(rootDir);
  const cdpPath = path.join(absRoot, 'cdp.js');
  const srcDir = path.join(absRoot, 'src');
  const cdpNorm = normalizeCmpPath(cdpPath);
  const srcPrefix = normalizeCmpPath(srcDir) + path.sep;
  let cleared = 0;

  try {
    const resolvedCdp = require.resolve(cdpPath);
    if (require.cache[resolvedCdp]) {
      delete require.cache[resolvedCdp];
      cleared += 1;
    }
  } catch {}

  for (const key of Object.keys(require.cache)) {
    let keyNorm = '';
    try {
      keyNorm = normalizeCmpPath(key);
    } catch {
      continue;
    }
    if (keyNorm === cdpNorm || (keyNorm.startsWith(srcPrefix) && keyNorm.endsWith('.cjs'))) {
      delete require.cache[key];
      cleared += 1;
    }
  }
  return cleared;
}

function collectSafeFileIntoStage({
  rel,
  sourceRoot,
  targetRoot,
  realSourceRoot,
  realTargetRoot,
  protectedPaths,
  stagedMap,
  strictSymlinkThrow = false,
  assertNotSymlink = null,
}) {
  const posixRel = String(rel || '').replace(/\\/g, '/');
  if (!isSafeManagedRelPath(posixRel)) return 'skipped';
  if (shouldExcludeSyncRelPath(posixRel)) return 'skipped';
  const src = path.resolve(sourceRoot, ...posixRel.split('/'));
  const dst = path.resolve(targetRoot, ...posixRel.split('/'));
  if (!isPathWithinRoot(sourceRoot, src) || !isPathWithinRoot(targetRoot, dst)) return 'skipped';

  if (isProtectedUserPath(posixRel, protectedPaths)) {
    if (strictSymlinkThrow && typeof assertNotSymlink === 'function') {
      assertNotSymlink(dst, 'destination');
    }
    return 'protected';
  }

  if (strictSymlinkThrow && typeof assertNotSymlink === 'function') {
    const srcSt = assertNotSymlink(src, 'source');
    if (!srcSt) return 'missing';
    if (!srcSt.isFile()) throw new Error(`Refusing non-regular source file: ${src}`);
    assertNotSymlink(dst, 'destination');
  }

  if (hasSymlinkSegment(sourceRoot, src)) {
    if (strictSymlinkThrow) throw new Error(`Refusing symbolic link source: ${src}`);
    return 'skipped';
  }
  let srcStat;
  try {
    srcStat = fs.lstatSync(src);
  } catch (err) {
    if (err && err.code === 'ENOENT') return 'missing';
    if (strictSymlinkThrow) throw err;
    return 'skipped';
  }
  if (srcStat.isSymbolicLink() || !srcStat.isFile()) {
    if (strictSymlinkThrow) throw new Error(`Refusing symbolic link or non-regular source file: ${src}`);
    return 'skipped';
  }
  try {
    const realSrc = fs.realpathSync(src);
    if (!isPathWithinRoot(realSourceRoot, realSrc)) {
      if (strictSymlinkThrow) throw new Error(`Refusing source path escaping root: ${src}`);
      return 'skipped';
    }
  } catch (err) {
    if (strictSymlinkThrow) throw err;
    return 'skipped';
  }

  if (hasSymlinkSegment(targetRoot, dst)) {
    if (strictSymlinkThrow) throw new Error(`Refusing symbolic link destination: ${dst}`);
    return 'skipped';
  }
  try {
    const dstStat = fs.lstatSync(dst);
    if (dstStat.isSymbolicLink() || !dstStat.isFile()) {
      if (strictSymlinkThrow) throw new Error(`Refusing non-regular destination: ${dst}`);
      return 'skipped';
    }
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      if (strictSymlinkThrow) throw err;
      return 'skipped';
    }
  }

  // 验证已有父目录未指向目标根目录外部
  let existingParent = path.dirname(dst);
  while (existingParent && isPathWithinRoot(targetRoot, existingParent, true)) {
    if (fs.existsSync(existingParent)) {
      try {
        const realParent = fs.realpathSync(existingParent);
        if (!isPathWithinRoot(realTargetRoot, realParent, true)) {
          if (strictSymlinkThrow) throw new Error(`Refusing destination parent escaping root: ${existingParent}`);
          return 'skipped';
        }
      } catch (err) {
        if (strictSymlinkThrow) throw err;
        return 'skipped';
      }
      break;
    }
    const up = path.dirname(existingParent);
    if (!up || up === existingParent) break;
    existingParent = up;
  }

  stagedMap.set(posixRel, fs.readFileSync(src));
  return 'staged';
}

function collectSafeSubDirIntoStage({
  sub,
  sourceRoot,
  targetRoot,
  realSourceRoot,
  realTargetRoot,
  protectedPaths,
  stagedMap,
  strictSymlinkThrow = false,
  assertNotSymlink = null,
}) {
  const posixSub = String(sub || '').replace(/\\/g, '/');
  if (!isSafeManagedRelPath(posixSub) || shouldExcludeSyncRelPath(posixSub)) return;
  if (isProtectedUserPath(posixSub, protectedPaths)) return;
  const sDir = path.resolve(sourceRoot, ...posixSub.split('/'));
  const dDir = path.resolve(targetRoot, ...posixSub.split('/'));
  if (!isPathWithinRoot(sourceRoot, sDir) || !isPathWithinRoot(targetRoot, dDir)) return;

  if (strictSymlinkThrow && typeof assertNotSymlink === 'function') {
    const st = assertNotSymlink(sDir, 'source directory');
    if (!st) return;
    if (!st.isDirectory()) throw new Error(`Refusing non-directory source: ${sDir}`);
    assertNotSymlink(dDir, 'destination directory');
  }

  if (hasSymlinkSegment(sourceRoot, sDir)) {
    if (strictSymlinkThrow) throw new Error(`Refusing symbolic link source directory: ${sDir}`);
    return;
  }
  let sDirStat;
  try {
    sDirStat = fs.lstatSync(sDir);
  } catch {
    return;
  }
  if (sDirStat.isSymbolicLink() || !sDirStat.isDirectory()) {
    if (strictSymlinkThrow) throw new Error(`Refusing symbolic link or non-directory source: ${sDir}`);
    return;
  }
  try {
    const realSDir = fs.realpathSync(sDir);
    if (!isPathWithinRoot(realSourceRoot, realSDir)) return;
  } catch {
    return;
  }

  if (hasSymlinkSegment(targetRoot, dDir)) {
    if (strictSymlinkThrow) throw new Error(`Refusing symbolic link destination directory: ${dDir}`);
    return;
  }
  try {
    const dDirStat = fs.lstatSync(dDir);
    if (dDirStat.isSymbolicLink() || !dDirStat.isDirectory()) {
      if (strictSymlinkThrow) throw new Error(`Refusing non-directory destination: ${dDir}`);
      return;
    }
  } catch (err) {
    if (!err || err.code !== 'ENOENT') return;
  }

  for (const ent of fs.readdirSync(sDir, { withFileTypes: true })) {
    const childRel = `${posixSub}/${ent.name}`;
    if (shouldExcludeSyncRelPath(childRel)) continue;
    const childSrc = path.join(sDir, ent.name);
    if (ent.isSymbolicLink()) {
      if (strictSymlinkThrow) throw new Error(`Refusing symbolic link entry: ${childSrc}`);
      continue;
    }
    let childStat;
    try {
      childStat = fs.lstatSync(childSrc);
    } catch {
      continue;
    }
    if (childStat.isSymbolicLink()) {
      if (strictSymlinkThrow) throw new Error(`Refusing symbolic link entry: ${childSrc}`);
      continue;
    }
    if (childStat.isDirectory()) {
      collectSafeSubDirIntoStage({
        sub: childRel,
        sourceRoot,
        targetRoot,
        realSourceRoot,
        realTargetRoot,
        protectedPaths,
        stagedMap,
        strictSymlinkThrow,
        assertNotSymlink,
      });
    } else if (childStat.isFile()) {
      collectSafeFileIntoStage({
        rel: childRel,
        sourceRoot,
        targetRoot,
        realSourceRoot,
        realTargetRoot,
        protectedPaths,
        stagedMap,
        strictSymlinkThrow,
        assertNotSymlink,
      });
    }
  }
}

function copyUpdatedRuntimeFromRepo(repoDir, pluginDir, syncFilesList, opts = null) {
  if (!repoDir || !pluginDir) return 0;
  const repoRoot = path.resolve(repoDir);
  const pluginRoot = path.resolve(pluginDir);
  if (normalizeCmpPath(repoRoot) === normalizeCmpPath(pluginRoot)) return 0;

  let repoRootStat;
  try {
    repoRootStat = fs.lstatSync(repoRoot);
  } catch {
    return 0;
  }
  if (repoRootStat.isSymbolicLink() || !repoRootStat.isDirectory()) return 0;

  try {
    const pluginRootStat = fs.lstatSync(pluginRoot);
    if (pluginRootStat.isSymbolicLink() || !pluginRootStat.isDirectory()) return 0;
  } catch (err) {
    if (err && err.code !== 'ENOENT') return 0;
    fs.mkdirSync(pluginRoot, { recursive: true });
  }

  let realRepoRoot;
  let realPluginRoot;
  try {
    realRepoRoot = fs.realpathSync(repoRoot);
    realPluginRoot = fs.realpathSync(pluginRoot);
  } catch {
    return 0;
  }
  if (normalizeCmpPath(realRepoRoot) === normalizeCmpPath(realPluginRoot)) return 0;

  const repoManifest = readInstallManifestFromDir(repoRoot);
  const protectedPaths = mergeProtectedUserPaths(repoManifest?.protectedUserPaths);

  let resolvedFiles = null;
  let resolvedSubdirs = null;
  const repoCdpPath = path.join(repoRoot, 'cdp.js');
  try {
    const cdpStat = fs.lstatSync(repoCdpPath);
    if (!cdpStat.isSymbolicLink() && cdpStat.isFile()) {
      const realCdp = fs.realpathSync(repoCdpPath);
      if (isPathWithinRoot(realRepoRoot, realCdp)) {
        clearCdpRequireCache(repoRoot);
        const freshRepoCdp = require(repoCdpPath);
        if (Array.isArray(freshRepoCdp?.SYNC_ROOT_FILES) && freshRepoCdp.SYNC_ROOT_FILES.length > 0) {
          resolvedFiles = freshRepoCdp.SYNC_ROOT_FILES;
        }
        if (Array.isArray(freshRepoCdp?.SYNC_SUBDIRS) && freshRepoCdp.SYNC_SUBDIRS.length > 0) {
          resolvedSubdirs = freshRepoCdp.SYNC_SUBDIRS;
        }
      }
    }
  } catch {}

  const stagedMap = new Map();
  const files =
    resolvedFiles ||
    (Array.isArray(syncFilesList) && syncFilesList.length > 0
      ? syncFilesList
      : ['cdp.js', 'style.css', 'ui-runtime.js', 'tools/install-plugin.cjs', 'README.en.md', 'CHANGELOG.md', 'workbench/app.js']);
  for (const rel of files) {
    collectSafeFileIntoStage({
      rel,
      sourceRoot: repoRoot,
      targetRoot: pluginRoot,
      realSourceRoot: realRepoRoot,
      realTargetRoot: realPluginRoot,
      protectedPaths,
      stagedMap,
      strictSymlinkThrow: false,
    });
  }

  // 优先消费新仓声明的 SYNC_SUBDIRS（其次 install-manifest.json 的 syncSubdirs / 调用方兜底 / 默认清单），
  // 经严格路径与受保护路径过滤后递归同步，杜绝未来新增顶层目录漏拷与越界风险。
  let rawSubdirs = resolvedSubdirs;
  if (!rawSubdirs && Array.isArray(repoManifest?.syncSubdirs) && repoManifest.syncSubdirs.length > 0) {
    rawSubdirs = repoManifest.syncSubdirs;
  }
  if (!rawSubdirs && Array.isArray(opts?.syncSubdirs) && opts.syncSubdirs.length > 0) {
    rawSubdirs = opts.syncSubdirs;
  }
  const syncSubdirs = normalizeSyncSubdirs(rawSubdirs, {
    fallback: DEFAULT_SYNC_SUBDIRS,
    isProtectedPath: (p) => isProtectedUserPath(p, protectedPaths),
  });

  for (const sub of syncSubdirs) {
    collectSafeSubDirIntoStage({
      sub,
      sourceRoot: repoRoot,
      targetRoot: pluginRoot,
      realSourceRoot: realRepoRoot,
      realTargetRoot: realPluginRoot,
      protectedPaths,
      stagedMap,
      strictSymlinkThrow: false,
    });
  }

  const obsoleteList = [
    ...DEFAULT_OBSOLETE_PATHS,
    ...(Array.isArray(repoManifest?.obsoletePaths) ? repoManifest.obsoletePaths : []),
  ];
  if (stagedMap.size === 0 && obsoleteList.length === 0) return 0;

  const stagedEntries = [...stagedMap.entries()].map(([p, data]) => ({ path: p, scope: 'plugin', data }));
  const txManifest = buildInstallManifest({
    version: repoManifest?.version || '0.0.0',
    entries: stagedEntries,
    obsoletePaths: obsoleteList,
    extraProtectedPaths: repoManifest?.protectedUserPaths || [],
  });
  const txRes = applyManifestAtomicUpgrade({
    targetDir: pluginRoot,
    stagedFiles: stagedEntries,
    manifest: txManifest,
    scope: 'plugin',
    allowSeedProtected: false,
    _testHooks: opts && typeof opts === 'object' ? opts._testHooks || null : null,
  });
  return txRes.appliedFiles.length;
}

function clearReadOnlyRegularFile(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return;
    if (process.platform === 'win32') fs.chmodSync(filePath, 0o666);
    else if ((st.mode & 0o200) === 0) fs.chmodSync(filePath, (st.mode & 0o777) | 0o200);
  } catch {}
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms)); } catch {}
}

function unlinkWithRetry(filePath) {
  for (let i = 0; i <= ATOMIC_UPGRADE_RETRY_BACKOFFS_MS.length; i++) {
    try { fs.unlinkSync(filePath); return; }
    catch (err) {
      const c = err && err.code;
      if ((c !== 'EBUSY' && c !== 'EPERM' && c !== 'EACCES') || i >= ATOMIC_UPGRADE_RETRY_BACKOFFS_MS.length) throw err;
      sleepSync(ATOMIC_UPGRADE_RETRY_BACKOFFS_MS[i]);
    }
  }
}

function cleanupObsoletePathsInDir(targetDir, obsoletePaths = [], protectedPaths = PROTECTED_USER_PATHS) {
  const removed = [];
  const rejected = [];
  if (!targetDir || !Array.isArray(obsoletePaths) || obsoletePaths.length === 0) return { removed, rejected };
  const absTarget = path.resolve(targetDir);
  const merged = mergeProtectedUserPaths(protectedPaths);
  for (const rawObs of obsoletePaths) {
    const cls = classifyObsoleteCandidate(rawObs, merged);
    if (!cls.allowed) { rejected.push({ path: String(rawObs ?? ''), reason: cls.reason }); continue; }
    const obsAbs = path.resolve(absTarget, ...cls.normalizedPath.split('/'));
    if (!isPathWithinRoot(absTarget, obsAbs) || hasSymlinkSegment(absTarget, obsAbs)) {
      rejected.push({ path: cls.normalizedPath, reason: 'symlink' });
      continue;
    }
    try {
      const st = fs.lstatSync(obsAbs);
      if (st.isSymbolicLink() || !st.isFile()) {
        rejected.push({ path: cls.normalizedPath, reason: st.isSymbolicLink() ? 'symlink' : 'not_regular_file' });
        continue;
      }
      clearReadOnlyRegularFile(obsAbs);
      unlinkWithRetry(obsAbs);
      removed.push(cls.normalizedPath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') rejected.push({ path: cls.normalizedPath, reason: err?.code || 'unlink_failed' });
    }
  }
  return { removed, rejected };
}

function hasUserOwnedAssetsInDir(targetDir, userAssetPaths = USER_OWNED_ASSET_PATHS) {
  if (!targetDir || !fs.existsSync(targetDir)) return false;
  const absTarget = path.resolve(targetDir);
  for (const rel of userAssetPaths) {
    const clean = String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!clean || !isSafeManagedRelPath(clean)) continue;
    const candidate = path.join(absTarget, ...clean.split('/'));
    try {
      const st = fs.lstatSync(candidate);
      if (!st.isSymbolicLink() && (st.isFile() || (st.isDirectory() && fs.readdirSync(candidate).length > 0))) return true;
    } catch {}
  }
  return false;
}

function removeManagedFilesKeepingUserAssets(targetDir, userAssetPaths = USER_OWNED_ASSET_PATHS) {
  const walk = (curDir, prefix) => {
    let entries = [];
    try { entries = fs.readdirSync(curDir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (isProtectedUserPath(rel, userAssetPaths)) continue;
      const full = path.join(curDir, ent.name);
      try {
        const st = fs.lstatSync(full);
        if (st.isSymbolicLink() || st.isFile()) { clearReadOnlyRegularFile(full); fs.unlinkSync(full); }
        else if (st.isDirectory()) {
          walk(full, rel);
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        }
      } catch {}
    }
  };
  walk(path.resolve(targetDir), '');
}

function syncPluginDirWithManifest({
  sourceDir,
  targetDir,
  rootFiles = [],
  dirs = [],
  assertNotSymlink = null,
  _testHooks = null,
}) {
  const sourceRoot = path.resolve(sourceDir);
  const targetRoot = path.resolve(targetDir);
  if (typeof assertNotSymlink === 'function') {
    assertNotSymlink(sourceRoot, 'source directory');
    assertNotSymlink(targetRoot, 'target directory');
  }
  fs.mkdirSync(targetRoot, { recursive: true });
  const realSourceRoot = fs.realpathSync(sourceRoot);
  const realTargetRoot = fs.realpathSync(targetRoot);
  if (normalizeCmpPath(realSourceRoot) === normalizeCmpPath(realTargetRoot)) {
    return { copiedFiles: 0, missingOptional: [], atomicResult: null };
  }

  const srcManifest = readInstallManifestFromDir(sourceRoot);
  const protectedPaths = mergeProtectedUserPaths(srcManifest?.protectedUserPaths);
  const stagedMap = new Map();
  const missingOptional = [];

  for (const rel of Array.isArray(rootFiles) ? rootFiles : []) {
    const status = collectSafeFileIntoStage({
      rel,
      sourceRoot,
      targetRoot,
      realSourceRoot,
      realTargetRoot,
      protectedPaths,
      stagedMap,
      strictSymlinkThrow: true,
      assertNotSymlink,
    });
    if (status === 'missing') missingOptional.push(rel);
  }

  for (const dirName of Array.isArray(dirs) ? dirs : []) {
    collectSafeSubDirIntoStage({
      sub: dirName,
      sourceRoot,
      targetRoot,
      realSourceRoot,
      realTargetRoot,
      protectedPaths,
      stagedMap,
      strictSymlinkThrow: true,
      assertNotSymlink,
    });
  }

  const srcManifestFile = path.join(sourceRoot, INSTALL_MANIFEST_FILENAME);
  if (fs.existsSync(srcManifestFile)) {
    collectSafeFileIntoStage({
      rel: INSTALL_MANIFEST_FILENAME,
      sourceRoot,
      targetRoot,
      realSourceRoot,
      realTargetRoot,
      protectedPaths,
      stagedMap,
      strictSymlinkThrow: true,
      assertNotSymlink,
    });
  }

  const obsoleteList = [
    ...DEFAULT_OBSOLETE_PATHS,
    ...(Array.isArray(srcManifest?.obsoletePaths) ? srcManifest.obsoletePaths : []),
  ];
  if (stagedMap.size === 0 && obsoleteList.length === 0) {
    return { copiedFiles: 0, missingOptional, atomicResult: null };
  }

  const stagedEntries = [...stagedMap.entries()].map(([p, data]) => ({ path: p, scope: 'plugin', data }));
  const txManifest = buildInstallManifest({
    version: srcManifest?.version || '0.0.0',
    entries: stagedEntries,
    obsoletePaths: obsoleteList,
    extraProtectedPaths: srcManifest?.protectedUserPaths || [],
  });
  const atomicResult = applyManifestAtomicUpgrade({
    targetDir: targetRoot,
    stagedFiles: stagedEntries,
    manifest: txManifest,
    scope: 'plugin',
    allowSeedProtected: false,
    _testHooks,
  });
  return {
    copiedFiles: atomicResult.appliedFiles.length,
    missingOptional,
    atomicResult,
  };
}

module.exports = {
  clearCdpRequireCache,
  copyUpdatedRuntimeFromRepo,
  cleanupObsoletePathsInDir,
  hasUserOwnedAssetsInDir,
  removeManagedFilesKeepingUserAssets,
  syncPluginDirWithManifest,
};
