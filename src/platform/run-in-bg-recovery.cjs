// app_storage.json runInBackground 崩溃安全恢复标记管理（CJS，供 src/platform 与 ESM sidecars 共用）
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PENDING_RESTORE_MARKER_NAME = '.pending-restore-run-in-bg.json';
const MAX_MARKER_BYTES = 64 * 1024;
const MAX_APP_STORAGE_BYTES = 8 * 1024 * 1024;

function hasSymlinkInChainSync(targetPath) {
  const resolved = path.resolve(String(targetPath || ''));
  const root = path.parse(resolved).root;
  const rel = path.relative(root, resolved);
  const parts = rel ? rel.split(path.sep).filter(Boolean) : [];
  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') break;
      return true;
    }
  }
  return false;
}

function atomicWriteExclusiveSync(filePath, text, mode = 0o600) {
  const resolved = path.resolve(String(filePath));
  if (hasSymlinkInChainSync(resolved)) {
    throw new Error(`Refusing symbolic link path: ${resolved}`);
  }
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode, flag: 'wx' });
    try {
      const st = fs.lstatSync(resolved);
      if (st.isSymbolicLink() || !st.isFile() || (typeof st.nlink === 'number' && st.nlink > 1)) {
        throw new Error(`Refusing unsafe target file: ${resolved}`);
      }
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, resolved);
        break;
      } catch (err) {
        if (process.platform !== 'win32' || attempt >= 3 || !['EBUSY', 'EPERM', 'EACCES'].includes(err?.code)) {
          throw err;
        }
        try {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
        } catch {}
      }
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

function resolvePendingRestoreMarkerPath(appStoragePath, opts = {}) {
  if (opts && typeof opts.markerPath === 'string' && opts.markerPath.trim()) {
    return path.resolve(opts.markerPath.trim());
  }
  if (opts && typeof opts.markerDir === 'string' && opts.markerDir.trim()) {
    return path.join(path.resolve(opts.markerDir.trim()), PENDING_RESTORE_MARKER_NAME);
  }
  if (!appStoragePath) return '';
  return path.join(path.dirname(path.resolve(String(appStoragePath))), PENDING_RESTORE_MARKER_NAME);
}

function writePendingRunInBgRestoreMarker(appStoragePath, originalValue, opts = {}) {
  const markerPath = resolvePendingRestoreMarkerPath(appStoragePath, opts);
  if (!markerPath) return '';
  if (originalValue !== true && originalValue !== 'true') return '';
  const record = {
    version: 1,
    appStoragePath: path.resolve(String(appStoragePath)),
    originalValue,
    suspendedAt: Date.now(),
    pid: process.pid,
  };
  atomicWriteExclusiveSync(markerPath, JSON.stringify(record, null, 2) + '\n', 0o600);
  return markerPath;
}

function clearPendingRunInBgRestoreMarker(markerPath) {
  if (!markerPath) return false;
  const resolved = path.resolve(String(markerPath));
  try {
    if (hasSymlinkInChainSync(resolved)) return false;
    const st = fs.lstatSync(resolved);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    fs.unlinkSync(resolved);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    return false;
  }
}

function recoverPendingRunInBgRestoreFromMarker(markerPath, opts = {}) {
  if (!markerPath) return { found: false, recovered: false, reason: 'no-marker-path' };
  const resolvedMarker = path.resolve(String(markerPath));
  try {
    if (hasSymlinkInChainSync(resolvedMarker)) {
      return { found: false, recovered: false, reason: 'symlink-marker' };
    }
    const st = fs.lstatSync(resolvedMarker);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_MARKER_BYTES) {
      return { found: false, recovered: false, reason: 'invalid-marker-file' };
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { found: false, recovered: false, reason: 'not-found' };
    }
    return { found: false, recovered: false, reason: 'stat-error' };
  }

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(resolvedMarker, 'utf8'));
  } catch {
    clearPendingRunInBgRestoreMarker(resolvedMarker);
    return { found: true, recovered: false, cleared: true, reason: 'corrupt-marker' };
  }

  const targetPath =
    marker && typeof marker.appStoragePath === 'string' && marker.appStoragePath.trim()
      ? path.resolve(marker.appStoragePath.trim())
      : '';
  const originalValue = marker?.originalValue;
  const validOriginal = originalValue === true || originalValue === 'true';
  const validBasename = targetPath && path.basename(targetPath).toLowerCase() === 'app_storage.json';
  if (!targetPath || !validOriginal || !validBasename) {
    clearPendingRunInBgRestoreMarker(resolvedMarker);
    return { found: true, recovered: false, cleared: true, reason: 'invalid-marker-payload' };
  }

  if (hasSymlinkInChainSync(targetPath)) {
    return { found: true, recovered: false, cleared: false, reason: 'symlink-target' };
  }

  let targetStat;
  try {
    targetStat = fs.lstatSync(targetPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      clearPendingRunInBgRestoreMarker(resolvedMarker);
      return { found: true, recovered: false, cleared: true, reason: 'target-missing' };
    }
    return { found: true, recovered: false, cleared: false, reason: 'target-stat-error' };
  }
  if (targetStat.isSymbolicLink() || !targetStat.isFile() || targetStat.size > MAX_APP_STORAGE_BYTES) {
    return { found: true, recovered: false, cleared: false, reason: 'target-invalid' };
  }

  try {
    const raw = fs.readFileSync(targetPath, 'utf8').replace(/^\uFEFF/, '');
    const latest = JSON.parse(raw);
    if (!latest || typeof latest !== 'object' || Array.isArray(latest)) {
      return { found: true, recovered: false, cleared: false, reason: 'target-non-object' };
    }
    const writeFn =
      typeof opts.writeFileSync === 'function'
        ? opts.writeFileSync
        : (p, data) => atomicWriteExclusiveSync(p, data, 0o600);
    if (latest.runInBackground !== originalValue) {
      latest.runInBackground = originalValue;
      writeFn(targetPath, JSON.stringify(latest, null, 2) + '\n');
    }
    clearPendingRunInBgRestoreMarker(resolvedMarker);
    return {
      found: true,
      recovered: true,
      cleared: true,
      appStoragePath: targetPath,
      restoredValue: originalValue,
    };
  } catch (err) {
    return {
      found: true,
      recovered: false,
      cleared: false,
      reason: 'restore-failed',
      error: String(err?.message || err),
    };
  }
}

function recoverPendingForDaemonBoot({ rootDir, defaultRootDir, extraMarkerPath, getDefaultAppStoragePath, log } = {}) {
  const markers = new Set();
  if (rootDir) markers.add(path.join(path.resolve(rootDir), PENDING_RESTORE_MARKER_NAME));
  if (extraMarkerPath) {
    markers.add(path.resolve(extraMarkerPath));
  } else if (process.platform === 'win32' && rootDir && defaultRootDir && path.resolve(rootDir) === path.resolve(defaultRootDir) && typeof getDefaultAppStoragePath === 'function') {
    const defAppStorage = getDefaultAppStoragePath();
    if (defAppStorage) markers.add(path.join(path.dirname(defAppStorage), PENDING_RESTORE_MARKER_NAME));
  }
  const results = [];
  for (const mp of markers) {
    try {
      const res = recoverPendingRunInBgRestoreFromMarker(mp);
      results.push({ markerPath: mp, ...res });
      if (res?.recovered && typeof log === 'function') {
        log(`[recovery] Restored runInBackground=${res.restoredValue} from pending marker ${mp}`);
      }
    } catch {}
  }
  return results;
}

module.exports = {
  PENDING_RESTORE_MARKER_NAME,
  resolvePendingRestoreMarkerPath,
  writePendingRunInBgRestoreMarker,
  clearPendingRunInBgRestoreMarker,
  recoverPendingRunInBgRestoreFromMarker,
  recoverPendingForDaemonBoot,
};
