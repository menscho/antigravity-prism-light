// Obsidian Prism 原子落盘、符号链接守卫与受限 Git/JSON 工具（Tier 0）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export function execGit(args, cwd, timeoutMs = 12000, extraConfigs = []) {
  const cfgFlags = [
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'submodule.recurse=false',
    '-c',
    'core.fsmonitor=false',
  ];
  for (const flag of extraConfigs) cfgFlags.push(flag);
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...cfgFlags, ...args],
      { cwd, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || 'git command failed').trim();
          reject(new Error(msg));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

export function serializeJsonForEval(val) {
  const raw = JSON.stringify(val === undefined ? null : val);
  return String(raw).replace(/[<>/\u2028\u2029]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

// 大载荷（>4 KiB）改走 V8 C++ JSON.parse 快速路径，避免渲染器主线程编译巨型 JS 对象字面量
export function formatJsonArgForEval(val) {
  const safeJson = serializeJsonForEval(val);
  return safeJson.length > 4096 ? `JSON.parse(${serializeJsonForEval(safeJson)})` : safeJson;
}

export function sanitizeGitRemoteUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      u.username = '';
      u.password = '';
      u.search = '';
      u.hash = '';
      return u.toString();
    }
  } catch {}
  return s.replace(/\/\/[^/\s:@]+:[^/\s@]+@/, '//');
}

export function assertNotSymlinkSync(targetPath, label = 'path') {
  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link ${label}: ${targetPath}`);
    }
    return st;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export function writeFileAtomicSync(targetPath, content, { mode = 0o600 } = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const dir = path.dirname(resolvedTarget);
  const dirStat = assertNotSymlinkSync(dir, 'target directory');
  if (dirStat && !dirStat.isDirectory()) {
    throw new Error(`Target parent is not a directory: ${dir}`);
  }
  assertNotSymlinkSync(resolvedTarget, 'target file');

  const base = path.basename(resolvedTarget);
  const tmpName = `.${base}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'wx', mode);
    fs.writeFileSync(fd, content, 'utf8');
    try { fs.fsyncSync(fd); } catch {}
    fs.closeSync(fd);
    fd = null;
    try { fs.chmodSync(tmpPath, mode); } catch {}
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }

  try {
    assertNotSymlinkSync(dir, 'target directory');
    assertNotSymlinkSync(resolvedTarget, 'target file');
    let renamed = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.renameSync(tmpPath, resolvedTarget);
        renamed = true;
        break;
      } catch (err) {
        lastErr = err;
        if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(err?.code)) {
          throw err;
        }
      }
    }
    if (!renamed) {
      // Windows 兼容回退：句柄短暂占用导致 renameSync 失败时先复核非符号链接再覆盖目标并清理临时文件
      if (process.platform === 'win32' && ['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(lastErr?.code)) {
        assertNotSymlinkSync(dir, 'target directory');
        assertNotSymlinkSync(resolvedTarget, 'target file');
        fs.copyFileSync(tmpPath, resolvedTarget);
        try { fs.unlinkSync(tmpPath); } catch {}
      } else {
        throw lastErr;
      }
    }
    assertNotSymlinkSync(resolvedTarget, 'target file');
    try { fs.chmodSync(resolvedTarget, mode); } catch {}
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

export async function assertNotSymlinkAsync(targetPath, label = 'path') {
  try {
    const st = await fs.promises.lstat(targetPath);
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link ${label}: ${targetPath}`);
    }
    return st;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeFileAtomicAsync(targetPath, content, { mode = 0o600, shouldAbort = null } = {}) {
  const aborted = () => typeof shouldAbort === 'function' && Boolean(shouldAbort());
  if (aborted()) return false;
  const resolvedTarget = path.resolve(targetPath);
  const dir = path.dirname(resolvedTarget);
  const dirStat = await assertNotSymlinkAsync(dir, 'target directory');
  if (dirStat && !dirStat.isDirectory()) {
    throw new Error(`Target parent is not a directory: ${dir}`);
  }
  await assertNotSymlinkAsync(resolvedTarget, 'target file');
  if (aborted()) return false;

  const base = path.basename(resolvedTarget);
  const tmpName = `.${base}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  let fh = null;
  try {
    fh = await fs.promises.open(tmpPath, 'wx', mode);
    if (aborted()) {
      await fh.close();
      fh = null;
      try { await fs.promises.unlink(tmpPath); } catch {}
      return false;
    }
    await fh.writeFile(content, 'utf8');
    if (aborted()) {
      await fh.close();
      fh = null;
      try { await fs.promises.unlink(tmpPath); } catch {}
      return false;
    }
    try { await fh.sync(); } catch {}
    await fh.close();
    fh = null;
    try { await fs.promises.chmod(tmpPath, mode); } catch {}
  } catch (err) {
    if (fh !== null) {
      try { await fh.close(); } catch {}
    }
    try { await fs.promises.unlink(tmpPath); } catch {}
    throw err;
  }

  try {
    await assertNotSymlinkAsync(dir, 'target directory');
    await assertNotSymlinkAsync(resolvedTarget, 'target file');
    if (aborted()) {
      try { await fs.promises.unlink(tmpPath); } catch {}
      return false;
    }
    let renamed = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (aborted()) {
        try { await fs.promises.unlink(tmpPath); } catch {}
        return false;
      }
      try {
        await fs.promises.rename(tmpPath, resolvedTarget);
        renamed = true;
        break;
      } catch (err) {
        lastErr = err;
        if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(err?.code)) {
          throw err;
        }
      }
    }
    if (!renamed) {
      if (process.platform === 'win32' && ['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(lastErr?.code)) {
        await assertNotSymlinkAsync(dir, 'target directory');
        await assertNotSymlinkAsync(resolvedTarget, 'target file');
        if (aborted()) {
          try { await fs.promises.unlink(tmpPath); } catch {}
          return false;
        }
        await fs.promises.copyFile(tmpPath, resolvedTarget);
        try { await fs.promises.unlink(tmpPath); } catch {}
      } else {
        throw lastErr;
      }
    }
    await assertNotSymlinkAsync(resolvedTarget, 'target file');
    try { await fs.promises.chmod(resolvedTarget, mode); } catch {}
    return true;
  } catch (err) {
    try { await fs.promises.unlink(tmpPath); } catch {}
    throw err;
  }
}

export function isSafeRelativeSyncPath(rel) {
  if (typeof rel !== 'string') return false;
  const trimmed = rel.trim();
  if (!trimmed || trimmed.includes('\0') || path.isAbsolute(trimmed)) return false;
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return false;
  return !parts.some((p) => p === '.' || p === '..');
}

export function isPathWithinRoot(rootPath, candidatePath, allowEqual = false) {
  const rel = path.relative(rootPath, candidatePath);
  if (rel === '') return allowEqual;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function hasSymlinkSegment(rootDir, targetPath) {
  const rel = path.relative(rootDir, targetPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  const parts = rel.split(path.sep).filter(Boolean);
  let cur = rootDir;
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

export function canonicalRealpathSync(targetPath) {
  if (typeof fs.realpathSync.native === 'function') {
    try {
      return fs.realpathSync.native(targetPath);
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EACCES' || err.code === 'EPERM')) {
        throw err;
      }
    }
  }
  return fs.realpathSync(targetPath);
}
