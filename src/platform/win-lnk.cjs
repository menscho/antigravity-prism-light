// 纯 Node MS-SHLLINK (.lnk) 二进制编解码与 Windows 快捷方式无损读写器（零子进程、零 PowerShell、零 COM）
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { assertSafeRegularFileSync, writeFileAtomicNoSymlinkSync } = require('../utils/fs-safe.cjs');

const LNK_HEADER_SIZE = 0x4c;
const LNK_MAX_FILE_BYTES = 1024 * 1024;
const LNK_SCAN_MAX_DEPTH = 3;
const LNK_SCAN_MAX_FILES = 2000;
const LNK_CLSID = Buffer.from([
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
]);
const LNK_FLAG_HAS_IDLIST = 0x00000001;
const LNK_FLAG_HAS_LINK_INFO = 0x00000002;
const LNK_FLAG_HAS_NAME = 0x00000004;
const LNK_FLAG_HAS_RELATIVE_PATH = 0x00000008;
const LNK_FLAG_HAS_WORKING_DIR = 0x00000010;
const LNK_FLAG_HAS_ARGUMENTS = 0x00000020;
const LNK_FLAG_HAS_ICON_LOCATION = 0x00000040;
const LNK_FLAG_IS_UNICODE = 0x00000080;

function readNullTerminatedAnsi(buf, start, limit) {
  if (start < 0 || start >= limit || limit > buf.length) return '';
  let end = start;
  while (end < limit && buf[end] !== 0) end += 1;
  return buf.subarray(start, end).toString('latin1');
}

function readNullTerminatedUtf16LE(buf, start, limit) {
  if (start < 0 || start + 1 >= limit || limit > buf.length) return '';
  let end = start;
  while (end + 1 < limit && buf.readUInt16LE(end) !== 0) end += 2;
  return buf.subarray(start, end).toString('utf16le');
}

function joinWinPathParts(base, suffix) {
  const b = String(base || '');
  const s = String(suffix || '');
  if (!b) return s;
  if (!s) return b;
  if (b.endsWith('\\') || b.endsWith('/') || s.startsWith('\\') || s.startsWith('/')) {
    return b + s;
  }
  return `${b}\\${s}`;
}

function expandWindowsEnvVars(rawPath, env = process.env) {
  const s = String(rawPath || '');
  if (!s.includes('%') || !env || typeof env !== 'object') return s;
  const envMap = new Map();
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') envMap.set(k.toLowerCase(), v);
  }
  return s.replace(/%([A-Za-z0-9_()-]+)%/g, (match, name) => {
    const val = envMap.get(String(name).toLowerCase());
    return typeof val === 'string' && val.length > 0 ? val : match;
  });
}

function extractTargetFromLinkInfo(liBuf) {
  if (!Buffer.isBuffer(liBuf) || liBuf.length < 0x1c) return '';
  const liSize = liBuf.readUInt32LE(0);
  const liHeaderSize = liBuf.readUInt32LE(4);
  const liFlags = liBuf.readUInt32LE(8);
  if (liSize < 0x1c || liHeaderSize < 0x1c || liSize > liBuf.length) return '';

  const hasUniOffsets = liHeaderSize >= 0x24 && liBuf.length >= 0x24;
  const commonSuffixOff = liBuf.readUInt32LE(24);
  let commonSuffix = '';
  if (hasUniOffsets) {
    const commonSuffixUniOff = liBuf.readUInt32LE(32);
    if (commonSuffixUniOff >= liHeaderSize && commonSuffixUniOff < liSize) {
      commonSuffix = readNullTerminatedUtf16LE(liBuf, commonSuffixUniOff, liSize);
    }
  }
  if (!commonSuffix && commonSuffixOff >= liHeaderSize && commonSuffixOff < liSize) {
    commonSuffix = readNullTerminatedAnsi(liBuf, commonSuffixOff, liSize);
  }

  if (liFlags & 0x01) {
    let localBase = '';
    if (hasUniOffsets) {
      const localBaseUniOff = liBuf.readUInt32LE(28);
      if (localBaseUniOff >= liHeaderSize && localBaseUniOff < liSize) {
        localBase = readNullTerminatedUtf16LE(liBuf, localBaseUniOff, liSize);
      }
    }
    if (!localBase) {
      const localBaseOff = liBuf.readUInt32LE(16);
      if (localBaseOff >= liHeaderSize && localBaseOff < liSize) {
        localBase = readNullTerminatedAnsi(liBuf, localBaseOff, liSize);
      }
    }
    if (localBase) return joinWinPathParts(localBase, commonSuffix);
  }

  if (liFlags & 0x02) {
    const cnrlOff = liBuf.readUInt32LE(20);
    if (cnrlOff >= liHeaderSize && cnrlOff + 20 <= liSize) {
      const cnrlSize = liBuf.readUInt32LE(cnrlOff);
      const cnrlEnd = Math.min(liSize, cnrlOff + cnrlSize);
      if (cnrlSize >= 20 && cnrlEnd <= liSize) {
        const netNameOff = liBuf.readUInt32LE(cnrlOff + 8);
        let netName = '';
        if (netNameOff > 0x14 && cnrlOff + 24 <= cnrlEnd) {
          const netNameUniOff = liBuf.readUInt32LE(cnrlOff + 20);
          if (netNameUniOff > 0 && cnrlOff + netNameUniOff < cnrlEnd) {
            netName = readNullTerminatedUtf16LE(liBuf, cnrlOff + netNameUniOff, cnrlEnd);
          }
        }
        if (!netName && netNameOff >= 20 && cnrlOff + netNameOff < cnrlEnd) {
          netName = readNullTerminatedAnsi(liBuf, cnrlOff + netNameOff, cnrlEnd);
        }
        if (netName) return joinWinPathParts(netName, commonSuffix);
      }
    }
  }
  return '';
}

function extractTargetFromExtraData(extraBuf) {
  if (!Buffer.isBuffer(extraBuf) || extraBuf.length < 4) return '';
  let off = 0;
  while (off + 4 <= extraBuf.length) {
    const blockSize = extraBuf.readUInt32LE(off);
    if (blockSize < 4) break;
    if (off + blockSize > extraBuf.length) break;
    if (blockSize >= 8) {
      const sig = extraBuf.readUInt32LE(off + 4);
      // EnvironmentVariableDataBlock (MS-SHLLINK 2.5.4)
      if (sig === 0xa0000001 && blockSize >= 0x0314) {
        const uni = readNullTerminatedUtf16LE(extraBuf, off + 268, off + 268 + 520);
        if (uni) return expandWindowsEnvVars(uni);
        const ansi = readNullTerminatedAnsi(extraBuf, off + 8, off + 8 + 260);
        if (ansi) return expandWindowsEnvVars(ansi);
      }
    }
    off += blockSize;
  }
  return '';
}

function extractTargetFromIdList(idListBuf) {
  if (!Buffer.isBuffer(idListBuf) || idListBuf.length < 4) return '';
  let off = 0;
  let drive = '';
  const segments = [];
  while (off + 2 <= idListBuf.length) {
    const itemSize = idListBuf.readUInt16LE(off);
    if (itemSize === 0) break;
    if (itemSize < 3 || off + itemSize > idListBuf.length) break;
    const item = idListBuf.subarray(off, off + itemSize);
    const type = item[2];
    if (type >= 0x20 && type <= 0x2f && itemSize >= 6) {
      const drv = readNullTerminatedAnsi(item, 3, itemSize).trim();
      if (/^[A-Za-z]:\\?$/.test(drv)) {
        drive = drv.endsWith('\\') ? drv : `${drv}\\`;
      }
    } else if (type >= 0x30 && type <= 0x3f && itemSize >= 16) {
      let name = '';
      if (itemSize >= 20) {
        const extOff = item.readUInt16LE(itemSize - 2);
        if (extOff >= 14 && extOff + 10 <= itemSize - 2) {
          const extSize = item.readUInt16LE(extOff);
          const extVer = item.readUInt16LE(extOff + 2);
          const extSig = item.readUInt32LE(extOff + 4);
          if (extSig === 0xbeef0004 && extSize >= 16 && extOff + extSize <= itemSize) {
            let nameOff = 0;
            if (extVer === 3) nameOff = extOff + 20;
            else if (extVer === 7) nameOff = extOff + 38;
            else if (extVer === 8) nameOff = extOff + 42;
            else if (extVer >= 9) nameOff = extOff + 46;
            if (nameOff > 0 && nameOff + 2 <= extOff + extSize) {
              name = readNullTerminatedUtf16LE(item, nameOff, extOff + extSize);
            }
          }
        }
      }
      if (!name) {
        if ((type & 0x04) !== 0) {
          name = readNullTerminatedUtf16LE(item, 14, itemSize);
        } else {
          name = readNullTerminatedAnsi(item, 14, itemSize);
        }
      }
      if (name) segments.push(name);
    }
    off += itemSize;
  }
  if (!drive || segments.length === 0) return '';
  return `${drive}${segments.join('\\')}`;
}

function parseWindowsLnkBuffer(buf, lnkPath = '') {
  if (!Buffer.isBuffer(buf) || buf.length < LNK_HEADER_SIZE) {
    throw new Error('Invalid .lnk file: shorter than 76-byte ShellLinkHeader');
  }
  if (buf.length > LNK_MAX_FILE_BYTES) {
    throw new Error(`Invalid .lnk file: exceeds ${LNK_MAX_FILE_BYTES} bytes`);
  }
  const headerSize = buf.readUInt32LE(0);
  if (headerSize !== LNK_HEADER_SIZE) {
    throw new Error(`Invalid .lnk HeaderSize: 0x${headerSize.toString(16)}`);
  }
  if (!buf.subarray(4, 20).equals(LNK_CLSID)) {
    throw new Error('Invalid .lnk LinkCLSID');
  }
  const flags = buf.readUInt32LE(20);
  const isUnicode = Boolean(flags & LNK_FLAG_IS_UNICODE);
  let offset = LNK_HEADER_SIZE;

  let idListStart = offset;
  let idListEnd = offset;
  let idListPayload = null;
  if (flags & LNK_FLAG_HAS_IDLIST) {
    if (offset + 2 > buf.length) throw new Error('Truncated LinkTargetIDList size');
    const idListSize = buf.readUInt16LE(offset);
    if (offset + 2 + idListSize > buf.length) throw new Error('Truncated LinkTargetIDList payload');
    idListStart = offset;
    idListPayload = buf.subarray(offset + 2, offset + 2 + idListSize);
    offset += 2 + idListSize;
    idListEnd = offset;
  }

  let linkInfoStart = offset;
  let linkInfoEnd = offset;
  let linkInfoBuf = null;
  if (flags & LNK_FLAG_HAS_LINK_INFO) {
    if (offset + 4 > buf.length) throw new Error('Truncated LinkInfo size');
    const liSize = buf.readUInt32LE(offset);
    if (liSize < 0x1c || offset + liSize > buf.length) throw new Error('Invalid or truncated LinkInfo');
    linkInfoStart = offset;
    linkInfoBuf = buf.subarray(offset, offset + liSize);
    offset += liSize;
    linkInfoEnd = offset;
  }

  const stringDataStart = offset;
  const stringSpecs = [
    [LNK_FLAG_HAS_NAME, 'name'],
    [LNK_FLAG_HAS_RELATIVE_PATH, 'relativePath'],
    [LNK_FLAG_HAS_WORKING_DIR, 'workingDir'],
    [LNK_FLAG_HAS_ARGUMENTS, 'arguments'],
    [LNK_FLAG_HAS_ICON_LOCATION, 'iconLocation'],
  ];
  const strings = {
    name: null,
    relativePath: null,
    workingDir: null,
    arguments: null,
    iconLocation: null,
  };
  const stringOffsets = {};
  let argsStart = -1;
  let argsEnd = -1;

  for (const [bit, field] of stringSpecs) {
    if (field === 'arguments' && !(flags & bit)) {
      argsStart = offset;
      argsEnd = offset;
    }
    if (!(flags & bit)) continue;
    if (offset + 2 > buf.length) throw new Error(`Truncated StringData count for ${field}`);
    const countChars = buf.readUInt16LE(offset);
    const byteLen = isUnicode ? countChars * 2 : countChars;
    if (offset + 2 + byteLen > buf.length) throw new Error(`Truncated StringData payload for ${field}`);
    const fieldStart = offset;
    const rawStr = buf.subarray(offset + 2, offset + 2 + byteLen).toString(isUnicode ? 'utf16le' : 'latin1');
    offset += 2 + byteLen;
    strings[field] = rawStr;
    stringOffsets[field] = { start: fieldStart, end: offset, countChars };
    if (field === 'arguments') {
      argsStart = fieldStart;
      argsEnd = offset;
    }
  }

  const extraDataStart = offset;
  const extraDataBuf = buf.subarray(extraDataStart);

  // 4 级目标路径解析：LinkInfo -> ExtraData(EnvironmentVariableDataBlock) -> RELATIVE_PATH -> LinkTargetIDList
  let targetPath = linkInfoBuf ? extractTargetFromLinkInfo(linkInfoBuf) : '';
  if (!targetPath) {
    targetPath = extractTargetFromExtraData(extraDataBuf);
  }
  if (!targetPath && strings.relativePath) {
    if (lnkPath) {
      targetPath = path.win32.resolve(path.win32.dirname(String(lnkPath)), strings.relativePath);
    } else {
      targetPath = strings.relativePath;
    }
  }
  if (!targetPath && idListPayload) {
    targetPath = extractTargetFromIdList(idListPayload);
  }
  // 当 LinkInfo 仅含 ANSI 且含高位字节（非纯 ASCII 本地代码页）时，优先用 UTF-16LE 的 RELATIVE_PATH / IDList 还原准确 Unicode 路径
  if (targetPath && /[^\x00-\x7f]/.test(targetPath) && linkInfoBuf && linkInfoBuf.readUInt32LE(4) < 0x24) {
    const unicodeFallback =
      extractTargetFromExtraData(extraDataBuf) ||
      (isUnicode && strings.relativePath && lnkPath
        ? path.win32.resolve(path.win32.dirname(String(lnkPath)), strings.relativePath)
        : '') ||
      (idListPayload ? extractTargetFromIdList(idListPayload) : '');
    if (unicodeFallback) targetPath = unicodeFallback;
  }

  return {
    flags,
    isUnicode,
    hasArguments: Boolean(flags & LNK_FLAG_HAS_ARGUMENTS),
    targetPath: String(targetPath || ''),
    arguments: strings.arguments || '',
    name: strings.name,
    relativePath: strings.relativePath,
    workingDir: strings.workingDir,
    iconLocation: strings.iconLocation,
    offsets: {
      idListStart,
      idListEnd,
      linkInfoStart,
      linkInfoEnd,
      stringDataStart,
      argsStart,
      argsEnd,
      extraDataStart,
      stringOffsets,
    },
  };
}

function encodeLnkStringDataField(text, isUnicode) {
  const s = String(text || '');
  if (isUnicode) {
    if (s.length > 0xffff) {
      throw new Error('StringData field exceeds MS-SHLLINK 65535 UTF-16 code units limit');
    }
    const header = Buffer.allocUnsafe(2);
    header.writeUInt16LE(s.length, 0);
    return Buffer.concat([header, Buffer.from(s, 'utf16le')]);
  }
  const payload = Buffer.from(s, 'latin1');
  if (payload.length > 0xffff) {
    throw new Error('StringData field exceeds MS-SHLLINK 65535 ANSI bytes limit');
  }
  const header = Buffer.allocUnsafe(2);
  header.writeUInt16LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

// 严格遵守 MS-SHLLINK 规范更新 COMMAND_LINE_ARGUMENTS，100% 原样保留其余 Header/IDList/LinkInfo/StringData/ExtraData 字节
function updateWindowsLnkArguments(buf, nextArguments) {
  const parsed = parseWindowsLnkBuffer(buf);
  const nextStr = String(nextArguments || '');
  const wantHasArgs = nextStr.length > 0;
  const needUnicodeUpgrade = !parsed.isUnicode && wantHasArgs && /[^\x00-\x7f]/.test(nextStr);

  if (!needUnicodeUpgrade) {
    const nextFlags = wantHasArgs
      ? (parsed.flags | LNK_FLAG_HAS_ARGUMENTS) >>> 0
      : (parsed.flags & ~LNK_FLAG_HAS_ARGUMENTS) >>> 0;
    const prefix = Buffer.from(buf.subarray(0, parsed.offsets.argsStart));
    prefix.writeUInt32LE(nextFlags, 20);
    const suffix = buf.subarray(parsed.offsets.argsEnd);
    const argChunk = wantHasArgs ? encodeLnkStringDataField(nextStr, parsed.isUnicode) : Buffer.alloc(0);
    return Buffer.concat([prefix, argChunk, suffix]);
  }

  // ANSI .lnk 写入非 ASCII 参数时，升格 IsUnicode 并无损转码现有 StringData 字段，保留 Header/IDList/LinkInfo/ExtraData 原样
  const nextFlags = (parsed.flags | LNK_FLAG_IS_UNICODE | LNK_FLAG_HAS_ARGUMENTS) >>> 0;
  const beforeStrings = Buffer.from(buf.subarray(0, parsed.offsets.stringDataStart));
  beforeStrings.writeUInt32LE(nextFlags, 20);
  const parts = [beforeStrings];
  if (parsed.flags & LNK_FLAG_HAS_NAME) parts.push(encodeLnkStringDataField(parsed.name || '', true));
  if (parsed.flags & LNK_FLAG_HAS_RELATIVE_PATH) parts.push(encodeLnkStringDataField(parsed.relativePath || '', true));
  if (parsed.flags & LNK_FLAG_HAS_WORKING_DIR) parts.push(encodeLnkStringDataField(parsed.workingDir || '', true));
  parts.push(encodeLnkStringDataField(nextStr, true));
  if (parsed.flags & LNK_FLAG_HAS_ICON_LOCATION) parts.push(encodeLnkStringDataField(parsed.iconLocation || '', true));
  parts.push(buf.subarray(parsed.offsets.extraDataStart));
  return Buffer.concat(parts);
}

function readWindowsLnkFileSync(lnkPath) {
  const { resolved } = assertSafeRegularFileSync(lnkPath, LNK_MAX_FILE_BYTES);
  const buf = fs.readFileSync(resolved);
  const parsed = parseWindowsLnkBuffer(buf, resolved);
  return {
    lnkPath: resolved,
    targetPath: parsed.targetPath,
    arguments: parsed.arguments,
    parsed,
  };
}

function writeWindowsLnkArgumentsSync(lnkPath, nextArguments) {
  const { resolved } = assertSafeRegularFileSync(lnkPath, LNK_MAX_FILE_BYTES);
  const origBuf = fs.readFileSync(resolved);
  const nextBuf = updateWindowsLnkArguments(origBuf, nextArguments);
  // 写盘前自检：确保新二进制可被严格回读且参数 100% 匹配
  const verify = parseWindowsLnkBuffer(nextBuf, resolved);
  if (verify.arguments !== String(nextArguments || '')) {
    throw new Error('Updated .lnk verification mismatch');
  }
  writeFileAtomicNoSymlinkSync(resolved, nextBuf, { maxBytes: LNK_MAX_FILE_BYTES });
  return { lnkPath: resolved, bytes: nextBuf.length, arguments: verify.arguments };
}

function getDefaultWindowsShortcutDirs(env = process.env) {
  const e = env || process.env;
  const userProfile = e.USERPROFILE || os.homedir();
  const appData = e.APPDATA || path.join(userProfile, 'AppData', 'Roaming');
  const publicDir = e.PUBLIC || 'C:\\Users\\Public';
  const programData = e.ProgramData || 'C:\\ProgramData';
  const rawDirs = [
    path.join(userProfile, 'Desktop'),
    e.OneDrive ? path.join(e.OneDrive, 'Desktop') : '',
    e.OneDriveConsumer ? path.join(e.OneDriveConsumer, 'Desktop') : '',
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(publicDir, 'Desktop'),
    path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(Boolean);
  const seen = new Set();
  const uniq = [];
  for (const d of rawDirs) {
    const resolved = path.resolve(d);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(resolved);
  }
  return uniq;
}

function collectWindowsLnkFilesSync(searchDirs, extraFiles) {
  const dirs = Array.isArray(searchDirs)
    ? searchDirs.filter((d) => typeof d === 'string' && d.trim()).map((d) => path.resolve(d))
    : getDefaultWindowsShortcutDirs();
  const extras = Array.isArray(extraFiles) ? extraFiles : [];
  const seenFiles = new Set();
  const seenDirs = new Set();
  const files = [];

  const pushIfValidLnk = (candidate) => {
    if (files.length >= LNK_SCAN_MAX_FILES) return;
    if (!candidate || !String(candidate).toLowerCase().endsWith('.lnk')) return;
    try {
      const { resolved } = assertSafeRegularFileSync(candidate, LNK_MAX_FILE_BYTES);
      const key = resolved.toLowerCase();
      if (seenFiles.has(key)) return;
      seenFiles.add(key);
      files.push(resolved);
    } catch {}
  };

  for (const f of extras) pushIfValidLnk(f);

  const walkDir = (dirPath, depth) => {
    if (depth > LNK_SCAN_MAX_DEPTH || files.length >= LNK_SCAN_MAX_FILES) return;
    let resolvedDir;
    try {
      resolvedDir = path.resolve(dirPath);
      const dirKey = resolvedDir.toLowerCase();
      if (seenDirs.has(dirKey)) return;
      const st = fs.lstatSync(resolvedDir);
      if (st.isSymbolicLink() || !st.isDirectory()) return;
      seenDirs.add(dirKey);
    } catch {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= LNK_SCAN_MAX_FILES) break;
      if (!entry || entry.isSymbolicLink()) continue;
      const fullPath = path.join(resolvedDir, entry.name);
      if (entry.isDirectory()) {
        if (depth < LNK_SCAN_MAX_DEPTH) {
          walkDir(fullPath, depth + 1);
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
        pushIfValidLnk(fullPath);
      }
    }
  };

  for (const d of dirs) walkDir(d, 0);
  return files;
}

function runWindowsShortcutAdapter(searchDirs, extraFiles) {
  const lnkFiles = collectWindowsLnkFilesSync(searchDirs, extraFiles);
  const entries = [];
  for (const lnkPath of lnkFiles) {
    try {
      const info = readWindowsLnkFileSync(lnkPath);
      if (!info.targetPath) continue;
      entries.push({
        lnkPath: info.lnkPath,
        targetPath: info.targetPath,
        arguments: info.arguments,
      });
    } catch {}
  }
  return {
    entries,
    applyUpdates(updates) {
      if (!Array.isArray(updates) || updates.length === 0) {
        return { applied: [], skipped: [] };
      }
      const applied = [];
      const skipped = [];
      for (const u of updates) {
        const p = String((u && u.lnkPath) || '').trim();
        if (!p) continue;
        try {
          writeWindowsLnkArgumentsSync(p, String((u && u.arguments) || ''));
          applied.push(p);
        } catch {
          skipped.push(p);
        }
      }
      return { applied, skipped };
    },
  };
}

async function runWindowsShortcutAdapterAsync(searchDirs, extraFiles) {
  const syncAdapter = runWindowsShortcutAdapter(searchDirs, extraFiles);
  return {
    entries: syncAdapter.entries,
    async applyUpdates(updates) {
      return syncAdapter.applyUpdates(updates);
    },
  };
}

module.exports = {
  LNK_MAX_FILE_BYTES,
  parseWindowsLnkBuffer,
  updateWindowsLnkArguments,
  readWindowsLnkFileSync,
  writeWindowsLnkArgumentsSync,
  getDefaultWindowsShortcutDirs,
  collectWindowsLnkFilesSync,
  runWindowsShortcutAdapter,
  runWindowsShortcutAdapterAsync,
};
