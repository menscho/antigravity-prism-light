// Obsidian Prism — SAFE BUILD separate launcher shortcut (src/platform/prism-shortcut.cjs)
//
// Added 2026-11-27 for the safe build (GPL-3.0, derived from RMvdesi/obsidian-prism).
//
// Instead of rewriting your existing Antigravity shortcuts (upstream behaviour),
// this makes ONE extra shortcut next to each official one:
//
//   "Antigravity.lnk"          -> untouched, launches stock Antigravity
//   "Antigravity (Prism).lnk"  -> node.exe src/platform/prism-launch.cjs, which starts
//                                 Antigravity with --remote-debugging-port=0 and the
//                                 Prism daemon (see prism-launch.cjs)
//
// The shortcut is written by the small pure-Node MS-SHLLINK writer below (no
// PowerShell / COM / child processes). It shows Antigravity's icon and starts
// minimised, so the launcher's console never pops up in front of you.
// Uninstall deletes only files with our name that point at our launcher (or,
// for shortcuts made by the first safe build, straight at Antigravity.exe).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseWindowsLnkBuffer } = require('./win-lnk.cjs');
const { isAntigravityShortcutTarget } = require('./shortcut-flags.cjs');

const PRISM_SHORTCUT_NAME = 'Antigravity (Prism).lnk';
const OFFICIAL_SHORTCUT_NAME = 'Antigravity.lnk';
const LAUNCHER_FILE = 'prism-launch.cjs';
const MAX_LNK_BYTES = 1024 * 1024;
const LNK_CLSID = Buffer.from('0114020000000000c000000000000046', 'hex');
const SW_SHOWMINNOACTIVE = 7;

function getShortcutDirs(env = process.env) {
  const dirs = [];
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (env.USERPROFILE) dirs.push(path.join(env.USERPROFILE, 'Desktop'));
  return dirs;
}

function getDefaultPluginDir() {
  return path.join(os.homedir(), '.gemini', 'config', 'plugins', 'obsidian-prism');
}

function getLauncherPath(pluginDir) {
  return path.join(pluginDir, 'src', 'platform', LAUNCHER_FILE);
}

function readRegularFile(p) {
  const st = fs.lstatSync(p);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error(`not a regular file: ${p}`);
  if (st.size > MAX_LNK_BYTES) throw new Error(`shortcut too large: ${p}`);
  return fs.readFileSync(p);
}

function countedUtf16(str) {
  const len = Buffer.alloc(2);
  len.writeUInt16LE(str.length, 0);
  return Buffer.concat([len, Buffer.from(str, 'utf16le')]);
}

// LinkInfo with VolumeID + LocalBasePath, in both ANSI and Unicode (header 0x24).
function buildLinkInfo(localPath) {
  const volId = Buffer.alloc(17);
  volId.writeUInt32LE(17, 0); // VolumeIDSize
  volId.writeUInt32LE(3, 4); // DRIVE_FIXED
  volId.writeUInt32LE(0, 8); // serial unknown
  volId.writeUInt32LE(16, 12); // empty label right after
  const chunks = [
    volId,
    Buffer.from(`${localPath.replace(/[^\x20-\x7e]/g, '?')}\0`, 'latin1'),
    Buffer.from('\0', 'latin1'),
    Buffer.from(`${localPath}\0`, 'utf16le'),
    Buffer.from('\0', 'utf16le'),
  ];
  const hdrSize = 0x24;
  const offs = [];
  let off = hdrSize;
  for (const c of chunks) {
    offs.push(off);
    off += c.length;
  }
  const hdr = Buffer.alloc(hdrSize);
  hdr.writeUInt32LE(off, 0); // LinkInfoSize
  hdr.writeUInt32LE(hdrSize, 4);
  hdr.writeUInt32LE(1, 8); // VolumeIDAndLocalBasePath
  hdr.writeUInt32LE(offs[0], 12);
  hdr.writeUInt32LE(offs[1], 16);
  hdr.writeUInt32LE(0, 20);
  hdr.writeUInt32LE(offs[2], 24);
  hdr.writeUInt32LE(offs[3], 28);
  hdr.writeUInt32LE(offs[4], 32);
  return Buffer.concat([hdr, ...chunks]);
}

function idItem(data) {
  const size = Buffer.alloc(2);
  size.writeUInt16LE(data.length + 2, 0);
  return Buffer.concat([size, data]);
}

// LinkTargetIDList: My Computer -> drive -> one item per path part. Explorer
// needs this to find the target; LinkInfo alone is not enough.
function buildIdList(targetPath) {
  const parts = path.win32.normalize(targetPath).split('\\').filter(Boolean);
  const drive = parts.shift();
  if (!/^[A-Za-z]:$/.test(drive || '') || parts.length === 0) throw new Error(`not a local drive path: ${targetPath}`);
  if (/[^\x20-\x7e]/.test(targetPath)) throw new Error(`non-ASCII target path not supported: ${targetPath}`);
  const items = [idItem(Buffer.from('1f50e04fd020ea3a6910a2d808002b30309d', 'hex'))]; // CLSID_MyComputer
  const driveData = Buffer.alloc(23);
  driveData[0] = 0x2f;
  Buffer.from(`${drive.toUpperCase()}\\`, 'latin1').copy(driveData, 1);
  items.push(idItem(driveData));
  parts.forEach((name, i) => {
    const head = Buffer.alloc(12);
    head[0] = i === parts.length - 1 ? 0x32 : 0x31; // file : folder
    head.writeUInt16LE(i === parts.length - 1 ? 0x20 : 0x10, 10); // attributes
    items.push(idItem(Buffer.concat([head, Buffer.from(`${name}\0`, 'latin1')])));
  });
  const body = Buffer.concat([...items, Buffer.alloc(2)]);
  const size = Buffer.alloc(2);
  size.writeUInt16LE(body.length, 0);
  return Buffer.concat([size, body]);
}

function buildWindowsLnk({ targetPath, args = '', workingDir = '', iconLocation = '', iconIndex = 0, description = '', showCommand = 1 }) {
  const header = Buffer.alloc(76);
  header.writeUInt32LE(0x4c, 0);
  LNK_CLSID.copy(header, 4);
  let flags = 0x01 | 0x02 | 0x80; // HasLinkTargetIDList | HasLinkInfo | IsUnicode
  const strings = [];
  if (description) { flags |= 0x04; strings.push(countedUtf16(description)); }
  if (workingDir) { flags |= 0x10; strings.push(countedUtf16(workingDir)); }
  if (args) { flags |= 0x20; strings.push(countedUtf16(args)); }
  if (iconLocation) { flags |= 0x40; strings.push(countedUtf16(iconLocation)); }
  header.writeUInt32LE(flags, 20);
  header.writeUInt32LE(0x20, 24); // FILE_ATTRIBUTE_ARCHIVE
  header.writeInt32LE(iconIndex, 56);
  header.writeUInt32LE(showCommand, 60);
  return Buffer.concat([header, buildIdList(targetPath), buildLinkInfo(targetPath), ...strings, Buffer.alloc(4)]);
}

function isNodeExe(p) {
  return /^node(?:\.exe)?$/i.test(path.win32.basename(String(p || '')));
}

// Ours = launcher shortcut, or the first safe build's direct Antigravity.exe copy.
function isPrismShortcut(parsed) {
  if (isNodeExe(parsed.targetPath)) return String(parsed.arguments || '').toLowerCase().includes(LAUNCHER_FILE);
  return isAntigravityShortcutTarget(parsed.targetPath);
}

function buildLauncherArgs(launcherPath, agExe, officialArgs) {
  const extra = String(officialArgs || '').replace(/(^|\s)--remote-debugging-port(?:=\S*)?/gi, ' ').trim();
  return `"${launcherPath}" --exe "${agExe}" --${extra ? ` ${extra}` : ''}`;
}

function createPrismShortcuts({ dirs = null, env = process.env, platform = process.platform, pluginDir = getDefaultPluginDir(), nodeExe = process.execPath } = {}) {
  const result = { supported: platform === 'win32', created: [], skipped: [] };
  if (platform !== 'win32') return result;
  if (!isNodeExe(nodeExe)) {
    result.skipped.push({ reason: `not node.exe: ${nodeExe}` });
    return result;
  }
  const launcherPath = getLauncherPath(pluginDir);
  for (const dir of dirs || getShortcutDirs(env)) {
    const official = path.join(dir, OFFICIAL_SHORTCUT_NAME);
    const target = path.join(dir, PRISM_SHORTCUT_NAME);
    try {
      if (!fs.existsSync(official)) {
        result.skipped.push({ dir, reason: 'no official Antigravity shortcut here' });
        continue;
      }
      const parsed = parseWindowsLnkBuffer(readRegularFile(official), official);
      if (!isAntigravityShortcutTarget(parsed.targetPath)) {
        result.skipped.push({ dir, reason: 'official shortcut does not point at Antigravity.exe' });
        continue;
      }
      const args = buildLauncherArgs(launcherPath, parsed.targetPath, parsed.arguments);
      const buf = buildWindowsLnk({
        targetPath: nodeExe,
        args,
        workingDir: path.win32.dirname(parsed.targetPath),
        iconLocation: parsed.targetPath,
        description: 'Antigravity with Antigravity Prism Light',
        showCommand: SW_SHOWMINNOACTIVE,
      });
      const verify = parseWindowsLnkBuffer(buf, target);
      if (verify.targetPath !== nodeExe || verify.arguments !== args) throw new Error('shortcut verification mismatch');
      if (fs.existsSync(target)) {
        const st = fs.lstatSync(target);
        if (!st.isFile() || st.isSymbolicLink()) throw new Error(`refusing to overwrite non-file: ${target}`);
        if (!isPrismShortcut(parseWindowsLnkBuffer(readRegularFile(target), target))) {
          throw new Error(`refusing to overwrite a shortcut we did not make: ${target}`);
        }
      }
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, buf, { flag: 'wx' });
      fs.renameSync(tmp, target);
      result.created.push(target);
    } catch (err) {
      result.skipped.push({ dir, reason: String(err && err.message ? err.message : err) });
    }
  }
  return result;
}

function removePrismShortcuts({ dirs = null, env = process.env, platform = process.platform } = {}) {
  const result = { supported: platform === 'win32', removed: [], skipped: [] };
  if (platform !== 'win32') return result;
  for (const dir of dirs || getShortcutDirs(env)) {
    const target = path.join(dir, PRISM_SHORTCUT_NAME);
    try {
      if (!fs.existsSync(target)) continue;
      if (!isPrismShortcut(parseWindowsLnkBuffer(readRegularFile(target), target))) {
        result.skipped.push({ path: target, reason: 'not a Prism launcher shortcut; left alone' });
        continue;
      }
      fs.unlinkSync(target);
      result.removed.push(target);
    } catch (err) {
      result.skipped.push({ path: target, reason: String(err && err.message ? err.message : err) });
    }
  }
  return result;
}

function listPrismShortcuts({ dirs = null, env = process.env } = {}) {
  return (dirs || getShortcutDirs(env)).map((d) => path.join(d, PRISM_SHORTCUT_NAME)).filter((p) => fs.existsSync(p));
}

// Installer hook. `byDefault` is true only for the real default install
// (the installer passes false in automated tests).
function prismShortcutsForInstall(opts, byDefault, platform, remove = false, pluginDir = null) {
  const on = opts.prismShortcut !== undefined ? Boolean(opts.prismShortcut) : Boolean(byDefault);
  if (!on) return { supported: platform === 'win32', created: [], removed: [], skipped: [] };
  if (remove) return removePrismShortcuts({ platform });
  return createPrismShortcuts({ platform, pluginDir: pluginDir || getDefaultPluginDir() });
}

module.exports = {
  PRISM_SHORTCUT_NAME,
  getShortcutDirs,
  getLauncherPath,
  buildWindowsLnk,
  buildLauncherArgs,
  isPrismShortcut,
  createPrismShortcuts,
  removePrismShortcuts,
  listPrismShortcuts,
  prismShortcutsForInstall,
};
