// 跨平台 CDP 启动参数词法操作、主进程目标签名判别与快捷方式修补记录（供 win-lnk / linux-desktop / host-relaunch 共用）
'use strict';

const fs = require('fs');
const path = require('path');

const CDP_OPT_IN_SWITCH = '--remote-debugging-port=0';
const RELAUNCH_STATE_FILENAME = '.relaunch-prompt-state.json';
const PATCHED_SHORTCUTS_FILENAME = '.patched-shortcuts.json';

// 纯线性扫描检测命令行是否已显式携带 --remote-debugging-port（零嵌套正则，杜绝 ReDoS）
function hasRemoteDebuggingPortSwitch(commandLine) {
  const raw = String(commandLine || '');
  if (!raw) return false;
  const low = raw.toLowerCase();
  const needle = '--remote-debugging-port';
  let from = 0;
  while (from <= low.length - needle.length) {
    const idx = low.indexOf(needle, from);
    if (idx < 0) return false;
    const prev = idx === 0 ? ' ' : low[idx - 1];
    const afterIdx = idx + needle.length;
    const next = afterIdx >= low.length ? ' ' : low[afterIdx];
    const prevOk = prev === ' ' || prev === '\t' || prev === '"' || prev === "'";
    const nextOk = next === '=' || next === ' ' || next === '\t' || next === '"' || next === "'";
    if (prevOk && nextOk) return true;
    from = idx + needle.length;
  }
  return false;
}

// 无损追加 --remote-debugging-port=0（若已含任意 --remote-debugging-port 则原样保留）
function appendCdpFlagToArguments(rawArgs) {
  const orig = String(rawArgs || '');
  if (hasRemoteDebuggingPortSwitch(orig)) {
    return { args: orig, changed: false };
  }
  const trimmed = orig.trim();
  if (!trimmed) {
    return { args: CDP_OPT_IN_SWITCH, changed: true };
  }
  return { args: `${trimmed} ${CDP_OPT_IN_SWITCH}`, changed: true };
}

// 纯线性词法扫描剥离 --remote-debugging-port=0，100% 保留引号内空白与用户其余参数
function stripCdpFlagFromArguments(rawArgs) {
  const s = String(rawArgs || '');
  if (!s) return { args: '', changed: false };
  const tokens = [];
  let i = 0;
  const len = s.length;
  let removed = false;
  while (i < len) {
    while (i < len && (s[i] === ' ' || s[i] === '\t' || s[i] === '\r' || s[i] === '\n')) i++;
    if (i >= len) break;
    const start = i;
    let inQuote = '';
    while (i < len) {
      const ch = s[i];
      if (inQuote) {
        if (ch === '\\' && i + 1 < len) {
          i += 2;
          continue;
        }
        if (ch === inQuote) inQuote = '';
        i++;
      } else {
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') break;
        if (ch === '"' || ch === "'") inQuote = ch;
        i++;
      }
    }
    const tok = s.slice(start, i);
    const unquoted =
      (tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))
        ? tok.slice(1, -1)
        : tok;
    if (unquoted.toLowerCase() === CDP_OPT_IN_SWITCH) {
      removed = true;
    } else {
      tokens.push(tok);
    }
  }
  if (!removed) return { args: s, changed: false };
  return { args: tokens.join(' '), changed: true };
}

// 严格按可执行文件名精确匹配 Antigravity.exe（自动排除 antigravity-tools.exe 与 Uninstall Antigravity.exe）
function isAntigravityShortcutTarget(targetPath) {
  const cleaned = String(targetPath || '').trim().replace(/^"+|"+$/g, '');
  if (!cleaned) return false;
  const parts = cleaned.split(/[\\/]/);
  const base = (parts[parts.length - 1] || '').trim().toLowerCase();
  return base === 'antigravity.exe';
}

// 严格识别 Linux 下的 Antigravity 主可执行目标（原生二进制、.AppImage，排除 crashpad/language_server/tools/obsidian-prism）
function isAntigravityLinuxTarget(targetPath) {
  const cleaned = String(targetPath || '').trim().replace(/^["']+|["']+$/g, '');
  if (!cleaned) return false;
  const lowPath = cleaned.replace(/\\/g, '/').toLowerCase();
  if (
    lowPath.includes('antigravity-tools') ||
    lowPath.includes('antigravity_tools') ||
    lowPath.includes('uninstall') ||
    lowPath.includes('obsidian-prism') ||
    lowPath.includes('chrome_crashpad_handler') ||
    lowPath.includes('language_server')
  ) {
    return false;
  }
  const parts = lowPath.split('/');
  const base = (parts[parts.length - 1] || '').trim();
  if (!base) return false;
  if (base === 'antigravity') return true;
  if (/^antigravity(?:[-_.][a-z0-9._+-]+)?\.appimage$/i.test(base)) return true;
  return false;
}

// 精准识别真正的 Antigravity 主进程（过滤 --type= 渲染/GPU 子进程、crashpad、language_server、sidecar_sdk 守护进程与第三方 antigravity-tools）
function isMainAntigravityProcessSignature(imageName, commandLine = '') {
  const rawImg = String(imageName || '').trim().replace(/^["']+|["']+$/g, '');
  const normImg = rawImg.replace(/\\/g, '/').toLowerCase();
  if (
    normImg.includes('antigravity-tools') ||
    normImg.includes('antigravity_tools') ||
    normImg.includes('uninstall') ||
    normImg.includes('chrome_crashpad_handler') ||
    normImg.includes('language_server')
  ) {
    return false;
  }
  const imgParts = normImg.split('/');
  const baseImg = (imgParts[imgParts.length - 1] || '').trim();
  const isValidBase =
    baseImg === 'antigravity' ||
    baseImg === 'antigravity.exe' ||
    /^antigravity(?:[-_.][a-z0-9._+-]+)?\.appimage$/i.test(baseImg);
  if (!isValidBase) {
    return false;
  }
  const normCmd = String(commandLine || '').replace(/\\/g, '/').toLowerCase();
  if (!normCmd) return true;
  if (normCmd.includes('--type=')) return false;
  if (
    normCmd.includes('chrome_crashpad_handler') ||
    normCmd.includes('language_server') ||
    normCmd.includes('sidecar_sdk') ||
    normCmd.includes('register_loader.js') ||
    normCmd.includes('sidecars/daemon/main.mjs') ||
    normCmd.includes('/daemon/main.mjs') ||
    normCmd.includes('/watch.js') ||
    normCmd.includes('--run-guard') ||
    normCmd.includes('antigravity-tools') ||
    normCmd.includes('antigravity_tools') ||
    normCmd.includes('uninstall antigravity')
  ) {
    return false;
  }
  return true;
}

function readPatchedShortcutsRecord(pluginDir) {
  if (!pluginDir) return [];
  try {
    const recFile = path.join(pluginDir, PATCHED_SHORTCUTS_FILENAME);
    if (!fs.existsSync(recFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(recFile, 'utf8'));
    const list = Array.isArray(parsed?.patchedPaths) ? parsed.patchedPaths : [];
    return list.filter((p) => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

function writePatchedShortcutsRecord(pluginDir, pathsList) {
  if (!pluginDir) return;
  try {
    fs.mkdirSync(pluginDir, { recursive: true });
    const uniq = Array.from(new Set(pathsList.filter((p) => typeof p === 'string' && p.length > 0)));
    const recFile = path.join(pluginDir, PATCHED_SHORTCUTS_FILENAME);
    const tmpFile = `${recFile}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ patchedPaths: uniq, updatedAt: Date.now() }, null, 2) + '\n',
      { encoding: 'utf8', mode: 0o600 }
    );
    fs.renameSync(tmpFile, recFile);
  } catch {}
}

module.exports = {
  CDP_OPT_IN_SWITCH,
  RELAUNCH_STATE_FILENAME,
  PATCHED_SHORTCUTS_FILENAME,
  hasRemoteDebuggingPortSwitch,
  appendCdpFlagToArguments,
  stripCdpFlagFromArguments,
  isAntigravityShortcutTarget,
  isAntigravityLinuxTarget,
  isMainAntigravityProcessSignature,
  readPatchedShortcutsRecord,
  writePatchedShortcutsRecord,
};
