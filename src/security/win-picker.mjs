// Windows 原生纯编译文件/目录选择器定位与安全调用辅助（零 PowerShell / 零 EncodedCommand / 零 Add-Type）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WATCHER_EXE_NAME = 'obsidian-prism-watcher.exe';

function isSafeRegularExeFile(candidatePath, lstatFn = fs.lstatSync) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) return false;
  const resolved = path.resolve(candidatePath.trim());
  try {
    const st = lstatFn(resolved);
    if (!st || st.isSymbolicLink() || !st.isFile()) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 查找已安装的纯编译 C# obsidian-prism-watcher.exe 路径。
 * 优先级：显式参数 > 环境变量 AG_PRISM_WATCHER_EXE > %LOCALAPPDATA%\obsidian-prism\obsidian-prism-watcher.exe > rootDir 下同名文件。
 * 严格拒绝符号链接，未安装时返回 null 由调用方优雅回退为手动输入提示。
 */
export function resolveWindowsWatcherExePath(opts = {}) {
  // SAFE BUILD (2026-11-27): never launch an .exe found in a user-writable
  // folder or named by an environment variable. The native watcher/picker is
  // not part of this build, so pickers fall back to typing/pasting a path.
  void opts;
  return null;
}

export function decodeBase64Utf8Path(rawStdout) {
  const b64 = String(rawStdout || '').trim();
  if (!b64) return '';
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) {
    return b64;
  }
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();
    return decoded || '';
  } catch {
    return '';
  }
}
