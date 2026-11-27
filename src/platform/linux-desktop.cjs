// Linux XDG .desktop Shadow Copy 无损补丁、卸载还原与 environment.d 读取（零 sudo、零符号链接写穿透）
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isSymlinkPathSync, writeFileAtomicNoSymlinkSync } = require('../utils/fs-safe.cjs');
const {
  CDP_OPT_IN_SWITCH,
  PATCHED_SHORTCUTS_FILENAME,
  hasRemoteDebuggingPortSwitch,
  isAntigravityLinuxTarget,
  readPatchedShortcutsRecord,
  writePatchedShortcutsRecord,
} = require('./shortcut-flags.cjs');

const LINUX_DESKTOP_SHADOW_MARKER = '# obsidian-prism-shadow-of=';
const LINUX_DESKTOP_FIELD_CODE_RE = /^%[fFuUdDnNickvm]$/;
const LINUX_DEFAULT_SYSTEM_DESKTOP_DIRS = Object.freeze([
  '/usr/share/applications',
  '/usr/local/share/applications',
  '/var/lib/snapd/desktop/applications',
]);
const LINUX_GOMEMLIMIT_LINE_RE = /^GOMEMLIMIT=([0-9]+(?:B|KiB|MiB|GiB|TiB))$/;

function getDefaultLinuxDesktopDirs(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.homeDir ? path.resolve(opts.homeDir) : os.homedir();
  const hasCustomHome = Boolean(opts.homeDir && path.resolve(opts.homeDir) !== path.resolve(os.homedir()));
  const xdgDataHome =
    !hasCustomHome && env && typeof env.XDG_DATA_HOME === 'string' && env.XDG_DATA_HOME.trim()
      ? path.resolve(env.XDG_DATA_HOME.trim())
      : path.join(home, '.local', 'share');
  const userAppsDir = opts.userApplicationsDir
    ? path.resolve(opts.userApplicationsDir)
    : path.join(xdgDataHome, 'applications');
  const desktopDir = path.join(home, 'Desktop');
  return {
    userAppsDir,
    searchDirs: [
      userAppsDir,
      desktopDir,
      ...LINUX_DEFAULT_SYSTEM_DESKTOP_DIRS,
    ],
  };
}

// 线性词法分词器解析 freedesktop Desktop Entry Exec= 值（支持双引号、单引号与反斜杠转义）
function tokenizeDesktopExec(execValue) {
  const s = String(execValue || '');
  const tokens = [];
  let i = 0;
  const len = s.length;
  while (i < len) {
    while (i < len && (s[i] === ' ' || s[i] === '\t')) i++;
    if (i >= len) break;
    const start = i;
    let value = '';
    let inQuote = '';
    while (i < len) {
      const ch = s[i];
      if (inQuote === '"') {
        if (ch === '\\' && i + 1 < len) {
          value += s[i + 1];
          i += 2;
          continue;
        }
        if (ch === '"') {
          inQuote = '';
          i++;
          continue;
        }
        value += ch;
        i++;
      } else if (inQuote === "'") {
        if (ch === "'") {
          inQuote = '';
          i++;
          continue;
        }
        value += ch;
        i++;
      } else {
        if (ch === ' ' || ch === '\t') break;
        if (ch === '\\' && i + 1 < len) {
          value += s[i + 1];
          i += 2;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inQuote = ch;
          i++;
          continue;
        }
        value += ch;
        i++;
      }
    }
    tokens.push({ raw: s.slice(start, i), value, start, end: i });
  }
  return tokens;
}

// 从 Exec= token 序列提取真正的目标可执行路径（自动跳过前置 env 与 KEY=VAL 环境变量赋值）
function extractDesktopExecTarget(execValue) {
  const tokens = tokenizeDesktopExec(execValue);
  if (tokens.length === 0) return { target: '', targetIndex: -1, tokens };
  let idx = 0;
  const firstBase = tokens[0].value.replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (firstBase === 'env') {
    idx = 1;
    while (idx < tokens.length) {
      const val = tokens[idx].value;
      if (val === '--') {
        idx += 1;
        break;
      }
      if (val.startsWith('-')) {
        idx += val === '-u' || val === '--unset' || val === '-C' || val === '--chdir' ? 2 : 1;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(val)) {
        idx += 1;
        continue;
      }
      break;
    }
  }
  if (idx >= tokens.length) return { target: '', targetIndex: -1, tokens };
  return { target: tokens[idx].value, targetIndex: idx, tokens };
}

// 无损修补单条 Desktop Entry Exec= 值：保留已有 --remote-debugging-port，并在 %U/%F 等占位符前精确插入
function patchDesktopExecLine(execValue) {
  const orig = String(execValue || '');
  const { target, targetIndex, tokens } = extractDesktopExecTarget(orig);
  if (targetIndex < 0 || !isAntigravityLinuxTarget(target)) {
    return { value: orig, changed: false, matched: false, alreadySet: false };
  }
  if (hasRemoteDebuggingPortSwitch(orig)) {
    return { value: orig, changed: false, matched: true, alreadySet: true };
  }
  let fieldCodeIdx = -1;
  for (let i = targetIndex + 1; i < tokens.length; i++) {
    if (LINUX_DESKTOP_FIELD_CODE_RE.test(tokens[i].value)) {
      fieldCodeIdx = i;
      break;
    }
  }
  const rawTokens = tokens.map((t) => t.raw);
  if (fieldCodeIdx >= 0) {
    rawTokens.splice(fieldCodeIdx, 0, CDP_OPT_IN_SWITCH);
  } else {
    rawTokens.push(CDP_OPT_IN_SWITCH);
  }
  return { value: rawTokens.join(' '), changed: true, matched: true, alreadySet: false };
}

// 精准剥离单条 Desktop Entry Exec= 值中的 --remote-debugging-port=0（保留自定义端口、引号与占位符顺序）
function stripDesktopExecLine(execValue) {
  const orig = String(execValue || '');
  const { target, targetIndex, tokens } = extractDesktopExecTarget(orig);
  if (targetIndex < 0 || !isAntigravityLinuxTarget(target)) {
    return { value: orig, changed: false, matched: false };
  }
  let removed = false;
  const kept = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i > targetIndex && tokens[i].value.toLowerCase() === CDP_OPT_IN_SWITCH) {
      removed = true;
      continue;
    }
    kept.push(tokens[i].raw);
  }
  if (!removed) {
    return { value: orig, changed: false, matched: true };
  }
  return { value: kept.join(' '), changed: true, matched: true };
}

function readDesktopShadowMarker(content) {
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(LINUX_DESKTOP_SHADOW_MARKER)) {
      const orig = trimmed.slice(LINUX_DESKTOP_SHADOW_MARKER.length).trim();
      return orig || null;
    }
  }
  return null;
}

function isManagedPrismDesktopContent(content) {
  return /^\s*X-ObsidianPrism-Managed\s*=\s*true\s*$/im.test(String(content || ''));
}

// 解析并修补整份 .desktop 内容（支持 [Desktop Entry] 与多个 [Desktop Action ...] 段）
function patchDesktopEntryContent(rawContent, opts = {}) {
  const lines = String(rawContent || '').replace(/\r\n/g, '\n').split('\n');
  let inSupportedSection = false;
  let matched = false;
  let changed = false;
  let alreadySet = false;
  let patchedExecCount = 0;
  const outLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inSupportedSection = trimmed === '[Desktop Entry]' || trimmed.startsWith('[Desktop Action ');
      return line;
    }
    if (!inSupportedSection) return line;
    const execMatch = /^(\s*Exec\s*=\s*)(.*)$/.exec(line);
    if (!execMatch) return line;
    const res = patchDesktopExecLine(execMatch[2]);
    if (res.matched) {
      matched = true;
      if (res.changed) {
        changed = true;
        patchedExecCount += 1;
        return execMatch[1] + res.value;
      }
      if (res.alreadySet) {
        alreadySet = true;
      }
    }
    return line;
  });
  if (matched && changed && opts.shadowOf && !readDesktopShadowMarker(rawContent)) {
    const safeOrig = String(opts.shadowOf).replace(/[\r\n]+/g, ' ').trim();
    if (safeOrig) {
      outLines.unshift(`${LINUX_DESKTOP_SHADOW_MARKER}${safeOrig}`);
    }
  }
  return {
    content: outLines.join('\n'),
    matched,
    changed,
    alreadySet: matched && !changed && alreadySet,
    patchedExecCount,
  };
}

// 卸载还原整份 .desktop 内容中的 --remote-debugging-port=0
function stripDesktopEntryContent(rawContent) {
  const lines = String(rawContent || '').replace(/\r\n/g, '\n').split('\n');
  let inSupportedSection = false;
  let matched = false;
  let changed = false;
  const outLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inSupportedSection = trimmed === '[Desktop Entry]' || trimmed.startsWith('[Desktop Action ');
      return line;
    }
    if (!inSupportedSection) return line;
    const execMatch = /^(\s*Exec\s*=\s*)(.*)$/.exec(line);
    if (!execMatch) return line;
    const res = stripDesktopExecLine(execMatch[2]);
    if (res.matched) {
      matched = true;
      if (res.changed) {
        changed = true;
        return execMatch[1] + res.value;
      }
    }
    return line;
  });
  return { content: outLines.join('\n'), matched, changed };
}

function isPathInsideDir(filePath, dirPath) {
  if (!filePath || !dirPath) return false;
  const rel = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function isLinuxReadOnlyOrSystemDesktopPath(filePath, systemDirs) {
  const resolved = path.resolve(filePath);
  const dirs = Array.isArray(systemDirs) && systemDirs.length > 0 ? systemDirs : LINUX_DEFAULT_SYSTEM_DESKTOP_DIRS;
  for (const sysDir of dirs) {
    if (!sysDir) continue;
    const normSys = path.resolve(sysDir);
    if (resolved === normSys || isPathInsideDir(resolved, normSys)) {
      return true;
    }
  }
  try {
    fs.accessSync(resolved, fs.constants.W_OK);
    fs.accessSync(path.dirname(resolved), fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

function writeDesktopFileAtomicSync(filePath, content, fileMode = 0o644) {
  writeFileAtomicNoSymlinkSync(filePath, content, {
    mkdir: true,
    mode: fileMode,
    fsync: false,
    checkExistingRegular: false,
  });
}

function ensureLinuxDesktopShortcutsCdpFlag(opts = {}) {
  const defaults = getDefaultLinuxDesktopDirs(opts);
  const userAppsDir = defaults.userAppsDir;
  const searchDirs = Array.isArray(opts.searchDirs) && opts.searchDirs.length > 0
    ? opts.searchDirs.map((d) => path.resolve(d))
    : defaults.searchDirs.map((d) => path.resolve(d));
  const systemDirs = Array.isArray(opts.systemDirs)
    ? [...LINUX_DEFAULT_SYSTEM_DESKTOP_DIRS, ...opts.systemDirs.map((d) => path.resolve(d))]
    : [...LINUX_DEFAULT_SYSTEM_DESKTOP_DIRS];

  let scanned = 0;
  let matched = 0;
  const patched = [];
  const alreadySet = [];
  const skipped = [];
  const shadowCreated = [];
  const seenFiles = new Set();
  const userBasenames = new Set();

  // 预先记录用户 applications 目录中已有的 .desktop basename，用于识别已存在的 XDG 覆盖
  try {
    if (fs.existsSync(userAppsDir) && !isSymlinkPathSync(userAppsDir)) {
      for (const name of fs.readdirSync(userAppsDir)) {
        if (name.endsWith('.desktop')) {
          userBasenames.add(name);
        }
      }
    }
  } catch {}

  for (const dir of searchDirs) {
    if (!dir) continue;
    try {
      const dirLst = fs.lstatSync(dir);
      if (dirLst.isSymbolicLink() || !dirLst.isDirectory()) {
        if (dirLst.isSymbolicLink()) skipped.push(dir);
        continue;
      }
    } catch {
      continue;
    }

    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.desktop')).sort();
    } catch {
      continue;
    }

    for (const name of names) {
      const filePath = path.join(dir, name);
      if (seenFiles.has(filePath)) continue;
      seenFiles.add(filePath);

      let st;
      try {
        st = fs.lstatSync(filePath);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) {
        skipped.push(filePath);
        continue;
      }
      if (!st.isFile()) continue;

      const isSystemOrRo = isLinuxReadOnlyOrSystemDesktopPath(filePath, systemDirs);
      // 若系统目录的 .desktop 在用户 applications 目录已有同名条目，则遵循 XDG 优先级跳过
      if (isSystemOrRo && userBasenames.has(name) && !isPathInsideDir(filePath, userAppsDir)) {
        continue;
      }

      scanned += 1;
      let rawContent = '';
      try {
        rawContent = fs.readFileSync(filePath, 'utf8');
      } catch {
        skipped.push(filePath);
        continue;
      }

      const patchRes = patchDesktopEntryContent(rawContent, isSystemOrRo ? { shadowOf: filePath } : {});
      if (!patchRes.matched) continue;
      matched += 1;

      if (!patchRes.changed) {
        alreadySet.push(filePath);
        continue;
      }

      if (isSystemOrRo) {
        const shadowPath = path.join(userAppsDir, name);
        if (isSymlinkPathSync(userAppsDir) || isSymlinkPathSync(shadowPath)) {
          skipped.push(shadowPath);
          continue;
        }
        try {
          writeDesktopFileAtomicSync(shadowPath, patchRes.content, 0o644);
          userBasenames.add(name);
          patched.push(shadowPath);
          shadowCreated.push({ shadowPath, originalPath: filePath });
        } catch {
          skipped.push(filePath);
        }
      } else {
        try {
          const mode = (st.mode & 0o777) || 0o644;
          writeDesktopFileAtomicSync(filePath, patchRes.content, mode);
          patched.push(filePath);
        } catch {
          skipped.push(filePath);
        }
      }
    }
  }

  if (opts.pluginDir && patched.length > 0) {
    const prev = readPatchedShortcutsRecord(opts.pluginDir);
    writePatchedShortcutsRecord(opts.pluginDir, [...prev, ...patched]);
  }

  return {
    supported: true,
    scanned,
    matched,
    patched,
    alreadySet,
    skipped,
    shadowCreated,
  };
}

function restoreLinuxDesktopShortcutsCdpFlag(opts = {}) {
  const defaults = getDefaultLinuxDesktopDirs(opts);
  const userAppsDir = defaults.userAppsDir;
  const searchDirs = Array.isArray(opts.searchDirs) && opts.searchDirs.length > 0
    ? opts.searchDirs.map((d) => path.resolve(d))
    : [userAppsDir, path.join(opts.homeDir ? path.resolve(opts.homeDir) : os.homedir(), 'Desktop')];
  const systemDirs = Array.isArray(opts.systemDirs)
    ? [...LINUX_DEFAULT_SYSTEM_DESKTOP_DIRS, ...opts.systemDirs.map((d) => path.resolve(d))]
    : [...LINUX_DEFAULT_SYSTEM_DESKTOP_DIRS];

  const recorded = opts.pluginDir ? readPatchedShortcutsRecord(opts.pluginDir) : [];
  const candidates = new Set();
  for (const p of recorded) {
    if (typeof p === 'string' && p.endsWith('.desktop')) {
      candidates.add(path.resolve(p));
    }
  }
  for (const dir of searchDirs) {
    if (!dir) continue;
    try {
      const dirLst = fs.lstatSync(dir);
      if (dirLst.isSymbolicLink() || !dirLst.isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.desktop')) {
          candidates.add(path.join(dir, name));
        }
      }
    } catch {}
  }

  const restored = [];
  const skipped = [];
  const shadowRemoved = [];

  for (const filePath of candidates) {
    let st;
    try {
      st = fs.lstatSync(filePath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      skipped.push(filePath);
      continue;
    }
    if (!st.isFile()) continue;
    if (isLinuxReadOnlyOrSystemDesktopPath(filePath, systemDirs)) {
      continue;
    }
    let rawContent = '';
    try {
      rawContent = fs.readFileSync(filePath, 'utf8');
    } catch {
      skipped.push(filePath);
      continue;
    }
    if (isManagedPrismDesktopContent(rawContent)) {
      continue;
    }
    const shadowOf = readDesktopShadowMarker(rawContent);
    if (shadowOf) {
      try {
        if (isSymlinkPathSync(path.dirname(filePath)) || isSymlinkPathSync(filePath)) {
          skipped.push(filePath);
          continue;
        }
        fs.unlinkSync(filePath);
        restored.push(filePath);
        shadowRemoved.push({ shadowPath: filePath, originalPath: shadowOf });
      } catch {
        skipped.push(filePath);
      }
      continue;
    }
    const stripped = stripDesktopEntryContent(rawContent);
    if (!stripped.changed) continue;
    try {
      const mode = (st.mode & 0o777) || 0o644;
      writeDesktopFileAtomicSync(filePath, stripped.content, mode);
      restored.push(filePath);
    } catch {
      skipped.push(filePath);
    }
  }

  if (opts.pluginDir) {
    try {
      const recFile = path.join(opts.pluginDir, PATCHED_SHORTCUTS_FILENAME);
      if (fs.existsSync(recFile) && !isSymlinkPathSync(recFile)) fs.unlinkSync(recFile);
    } catch {}
  }

  return {
    supported: true,
    restored,
    skipped,
    shadowRemoved,
  };
}

// 严格按白名单正则读取 ~/.config/environment.d/90-obsidian-prism-gomemlimit.conf（零 source / eval，拦截 symlink）
function readLinuxGoMemLimitFromEnvD(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.homeDir ? path.resolve(opts.homeDir) : os.homedir();
  const hasCustomHome = Boolean(opts.homeDir && path.resolve(opts.homeDir) !== path.resolve(os.homedir()));
  const xdgConfig =
    !hasCustomHome && env && typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()
      ? path.resolve(env.XDG_CONFIG_HOME.trim())
      : path.join(home, '.config');
  const confPath = opts.envFile
    ? path.resolve(opts.envFile)
    : path.join(xdgConfig, 'environment.d', '90-obsidian-prism-gomemlimit.conf');
  try {
    const dir = path.dirname(confPath);
    if (isSymlinkPathSync(dir) || isSymlinkPathSync(confPath)) return '';
    const st = fs.lstatSync(confPath);
    if (!st.isFile()) return '';
    const lines = fs.readFileSync(confPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const m = LINUX_GOMEMLIMIT_LINE_RE.exec(line);
      if (m && m[1]) return m[1];
    }
    return '';
  } catch {
    return '';
  }
}

module.exports = {
  LINUX_DESKTOP_SHADOW_MARKER,
  LINUX_GOMEMLIMIT_LINE_RE,
  getDefaultLinuxDesktopDirs,
  tokenizeDesktopExec,
  extractDesktopExecTarget,
  patchDesktopExecLine,
  stripDesktopExecLine,
  readDesktopShadowMarker,
  isManagedPrismDesktopContent,
  patchDesktopEntryContent,
  stripDesktopEntryContent,
  ensureLinuxDesktopShortcutsCdpFlag,
  restoreLinuxDesktopShortcutsCdpFlag,
  readLinuxGoMemLimitFromEnvD,
};
