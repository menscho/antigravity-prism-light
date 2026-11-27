// 叶子安全文件系统、哈希与平台基础常量工具（L0，零内部模块依赖）
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

const APP_DATA = IS_MAC
  ? path.join(os.homedir(), 'Library', 'Application Support')
  : IS_WIN
  ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

const PORT_FILE = path.join(APP_DATA, 'Antigravity', 'DevToolsActivePort');
const DEFAULT_MAX_SAFE_FILE_BYTES = 1024 * 1024;

function readPkgVersionSafe(rootDir, fallback = '1.0.8-light.1') {
  try {
    const pkgPath = path.join(rootDir || path.resolve(__dirname, '..', '..'), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
  } catch {}
  return fallback;
}

function isSymlinkPathSync(targetPath) {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink();
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    return true;
  }
}

function normalizeFsComparePath(p) {
  const resolved = path.resolve(String(p || ''));
  return IS_WIN ? resolved.toLowerCase() : resolved;
}

function assertSafeRegularFileSync(filePath, maxBytes = DEFAULT_MAX_SAFE_FILE_BYTES, opts = null) {
  const resolved = path.resolve(String(filePath || ''));
  if (!resolved) throw new Error('Empty file path');
  const parentDir = path.dirname(resolved);
  const parentStat = fs.lstatSync(parentDir);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`Refusing symbolic link or non-directory parent: ${parentDir}`);
  }
  const st = fs.lstatSync(resolved);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new Error(`Refusing symbolic link or non-regular file: ${resolved}`);
  }
  if (!opts || opts.checkRealpath !== false) {
    try {
      const real = fs.realpathSync(resolved);
      const realParent = fs.realpathSync(parentDir);
      const expected = path.join(realParent, path.basename(resolved));
      if (normalizeFsComparePath(real) !== normalizeFsComparePath(expected)) {
        throw new Error(`Refusing reparse point or redirected file: ${resolved}`);
      }
    } catch (err) {
      if (err && /Refusing /.test(String(err.message || ''))) throw err;
    }
  }
  if (Number.isFinite(maxBytes) && maxBytes > 0 && st.size > maxBytes) {
    throw new Error(`Refusing oversized file (${st.size} > ${maxBytes} bytes): ${resolved}`);
  }
  return { resolved, stat: st };
}

function writeFileAtomicNoSymlinkSync(filePath, data, opts = null) {
  const resolved = path.resolve(String(filePath || ''));
  const dir = path.dirname(resolved);
  const ensureDir = Boolean(opts && opts.mkdir);
  const maxBytes = opts && opts.maxBytes !== undefined ? opts.maxBytes : DEFAULT_MAX_SAFE_FILE_BYTES;
  const mode = (opts && opts.mode) || 0o600;
  const doFsync = !opts || opts.fsync !== false;
  const checkExistingRegular = !opts || opts.checkExistingRegular !== false;

  if (ensureDir) {
    if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
      throw new Error(`Refusing symbolic link path: ${resolved}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
      throw new Error(`Refusing symbolic link path: ${resolved}`);
    }
  } else {
    const dirStat = fs.lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error(`Refusing symbolic link directory: ${dir}`);
    }
  }

  if (checkExistingRegular && fs.existsSync(resolved)) {
    assertSafeRegularFileSync(resolved, maxBytes);
  }

  const tmpPath = path.join(
    dir,
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'wx', mode);
    if (Buffer.isBuffer(data)) {
      fs.writeFileSync(fd, data);
    } else {
      fs.writeFileSync(fd, String(data), 'utf8');
    }
    if (doFsync) {
      try {
        fs.fsyncSync(fd);
      } catch {}
    }
    fs.closeSync(fd);
    fd = null;
    try {
      fs.chmodSync(tmpPath, mode);
    } catch {}

    let renamed = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
        throw new Error(`Refusing symbolic link path: ${resolved}`);
      }
      if (checkExistingRegular && fs.existsSync(resolved)) {
        assertSafeRegularFileSync(resolved, maxBytes);
      }
      try {
        fs.renameSync(tmpPath, resolved);
        renamed = true;
        break;
      } catch (err) {
        lastErr = err;
        if (!IS_WIN || !['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(err && err.code)) {
          throw err;
        }
      }
    }
    if (!renamed) {
      if (IS_WIN && ['EBUSY', 'EPERM', 'EACCES', 'EEXIST'].includes(lastErr && lastErr.code)) {
        if (isSymlinkPathSync(dir) || isSymlinkPathSync(resolved)) {
          throw new Error(`Refusing symbolic link path: ${resolved}`);
        }
        if (checkExistingRegular && fs.existsSync(resolved)) {
          assertSafeRegularFileSync(resolved, maxBytes);
        }
        fs.copyFileSync(tmpPath, resolved);
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      } else {
        throw lastErr;
      }
    }
    try {
      fs.chmodSync(resolved, mode);
    } catch {}
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

function getFileSig(filePath) {
  const st = fs.statSync(filePath);
  return `${st.mtimeMs}:${st.size}`;
}

function sha256Text(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function computeHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// 转义 < > / 与 Unicode 行分隔符，避免跨通道 eval 注入时触发语法截断或脚本逃逸
function serializeJsonForEval(val) {
  const raw = JSON.stringify(val === undefined ? null : val);
  return String(raw).replace(/[<>/\u2028\u2029]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

module.exports = {
  IS_MAC,
  IS_WIN,
  IS_LINUX,
  APP_DATA,
  PORT_FILE,
  readPkgVersionSafe,
  isSymlinkPathSync,
  normalizeFsComparePath,
  assertSafeRegularFileSync,
  writeFileAtomicNoSymlinkSync,
  writeFileAtomicallyNoSymlinkSync: writeFileAtomicNoSymlinkSync,
  getFileSig,
  sha256Text,
  computeHash,
  serializeJsonForEval,
};
