// 系统 UI 语言探测、跨平台温和重开提示弹窗与重启顺序状态机（无反向依赖）
'use strict';

const { execFile, execFileSync } = require('child_process');
const { IS_WIN } = require('../utils/fs-safe.cjs');
const { CDP_OPT_IN_SWITCH } = require('./shortcut-flags.cjs');

// Windows 桌面弹窗交由原生 C# 图形安装器/Watcher 处理，Node 侧不再派生 PowerShell MessageBox
const MAC_DIALOG_APPLESCRIPT = [
  'on run argv',
  '  set msgText to item 1 of argv',
  '  set titleText to item 2 of argv',
  '  set btnLater to item 3 of argv',
  '  set btnRelaunch to item 4 of argv',
  '  set dlg to display dialog msgText with title titleText buttons {btnLater, btnRelaunch} default button btnRelaunch with icon note',
  '  return button returned of dlg',
  'end run',
].join('\n');

function parseRegMultiSzFirstLocale(output) {
  const lines = String(output || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /\bREG_(?:MULTI_)?SZ\s+(.+)$/i.exec(lines[i]);
    if (!m) continue;
    const parts = m[1].split(/\\0|\s+/).map((s) => s.trim()).filter(Boolean);
    for (let j = 0; j < parts.length; j++) {
      if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(parts[j])) {
        return parts[j];
      }
    }
  }
  return '';
}

const WIN_UI_LOCALE_CACHE_SYM = Symbol.for('obsidianPrism.winUiLocaleCache');

function createLocaleDialog() {
  let _cachedWinUiLocale = undefined;
  let _winUiLocaleReaderOverride = null;

  function _setWindowsUiLocaleReaderForTest(fn) {
    _winUiLocaleReaderOverride = typeof fn === 'function' ? fn : null;
    _cachedWinUiLocale = undefined;
    delete globalThis[WIN_UI_LOCALE_CACHE_SYM];
  }

  function readWindowsPreferredUiLanguage() {
    if (_winUiLocaleReaderOverride) {
      try {
        return String(_winUiLocaleReaderOverride() || '').trim();
      } catch {
        return '';
      }
    }
    const envLang = String(process.env.AG_PRISM_UI_LANG || '').trim();
    if (envLang) return envLang;
    if (!IS_WIN) return '';
    if (_cachedWinUiLocale !== undefined) return _cachedWinUiLocale;
    if (globalThis[WIN_UI_LOCALE_CACHE_SYM] !== undefined) {
      _cachedWinUiLocale = globalThis[WIN_UI_LOCALE_CACHE_SYM];
      return _cachedWinUiLocale;
    }
    const keys = [
      ['HKCU\\Control Panel\\Desktop', 'PreferredUILanguages'],
      ['HKCU\\Control Panel\\Desktop\\MuiCached', 'MachinePreferredUILanguages'],
    ];
    let found = '';
    for (let i = 0; i < keys.length; i++) {
      try {
        const out = execFileSync('reg.exe', ['query', keys[i][0], '/v', keys[i][1]], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 300,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const parsed = parseRegMultiSzFirstLocale(out);
        if (parsed) {
          found = parsed;
          break;
        }
      } catch {}
    }
    _cachedWinUiLocale = found;
    globalThis[WIN_UI_LOCALE_CACHE_SYM] = found;
    return found;
  }

  function detectSystemUiLocale(opts = null) {
    try {
      const candidates = [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG];
      for (let i = 0; i < candidates.length; i++) {
        const val = String(candidates[i] || '').trim();
        if (val && !/^(?:c|posix)(?:[.@]|$)/i.test(val)) {
          return val;
        }
      }
      if (!opts?.bypassWinUiLocale) {
        if (typeof opts?.winUiLocaleReader === 'function') {
          const custom = String(opts.winUiLocaleReader() || '').trim();
          if (custom) return custom;
        } else {
          const winUi = readWindowsPreferredUiLanguage();
          if (winUi) return winUi;
        }
      }
      return Intl.DateTimeFormat().resolvedOptions().locale || '';
    } catch {
      return '';
    }
  }

  function buildRelaunchDialogCopy(lang = 'auto') {
    const rawLang = !lang || String(lang).trim().toLowerCase() === 'auto' ? detectSystemUiLocale() : lang;
    const low = String(rawLang || 'en').toLowerCase();
    const isZh = low.startsWith('zh') || low === 'yue';
    if (isZh) {
      return {
        title: 'Obsidian Prism',
        body:
          '检测到 Antigravity 已启动或完成更新，但未开启本地调试桥接参数（--remote-debugging-port=0），导致 Obsidian Prism 界面无法挂载。\n\n' +
          '是否立即重新打开 Antigravity 以恢复 Obsidian Prism 界面？\n' +
          '（若当前正在进行对话或有未保存内容，请选择“否 / 稍后”，下次通过快捷方式启动将自动生效。）',
        laterBtn: '稍后',
        relaunchBtn: '立即重开',
      };
    }
    return {
      title: 'Obsidian Prism',
      body:
        'Antigravity started or updated without --remote-debugging-port=0, so Obsidian Prism cannot attach.\n\n' +
        'Relaunch Antigravity now to restore Obsidian Prism?\n' +
        '(Choose "No / Later" if a task is running; shortcuts have been updated for next launch.)',
      laterBtn: 'Later',
      relaunchBtn: 'Relaunch Now',
    };
  }

  function promptUserForHostRelaunch(opts = {}) {
    const copy = buildRelaunchDialogCopy(opts.lang || 'auto');
    if (typeof opts.dialogHook === 'function') {
      return Promise.resolve(opts.dialogHook(copy)).then((ans) => Boolean(ans));
    }
    const effectivePlatform = opts.platformOverride || process.platform;
    const execFn = typeof opts.execFileFn === 'function' ? opts.execFileFn : execFile;
    const env = opts.env || process.env;
    return new Promise((resolve) => {
      if (effectivePlatform === 'win32') {
        // Windows 图形弹窗统一交由原生 C# 安装器/Watcher 处理，Node 侧仅输出清晰 CLI 提示并返回 false（零 PowerShell 弹窗）
        const notice = {
          title: copy.title,
          body: copy.body,
          actionRequired: true,
          handledBy: 'cli-notice',
        };
        if (typeof opts.onCliNotice === 'function') {
          try {
            opts.onCliNotice(notice);
          } catch {}
        } else if (!opts.silent) {
          const stream = opts.outputStream || process.stderr;
          if (stream && typeof stream.write === 'function') {
            try {
              stream.write(`\n[${copy.title}] ${copy.body}\n`);
            } catch {}
          }
        }
        resolve(false);
        return;
      }
      if (effectivePlatform === 'darwin') {
        execFn(
          'osascript',
          ['-e', MAC_DIALOG_APPLESCRIPT, copy.body, copy.title, copy.laterBtn, copy.relaunchBtn],
          { encoding: 'utf8', timeout: 120000, env },
          (err, stdout) => {
            if (err) {
              resolve(false);
              return;
            }
            resolve(String(stdout || '').trim() === copy.relaunchBtn);
          }
        );
        return;
      }
      if (effectivePlatform === 'linux') {
        const hasGuiSession = Boolean(
          (env && typeof env.DISPLAY === 'string' && env.DISPLAY.trim()) ||
            (env && typeof env.WAYLAND_DISPLAY === 'string' && env.WAYLAND_DISPLAY.trim())
        );
        if (!hasGuiSession) {
          resolve(false);
          return;
        }
        execFn(
          'zenity',
          [
            '--question',
            '--no-markup',
            '--title',
            copy.title,
            '--text',
            copy.body,
            '--ok-label',
            copy.relaunchBtn,
            '--cancel-label',
            copy.laterBtn,
          ],
          { encoding: 'utf8', timeout: 120000, env },
          (zenityErr) => {
            if (!zenityErr) {
              resolve(true);
              return;
            }
            if (zenityErr.code !== 'ENOENT') {
              resolve(false);
              return;
            }
            execFn(
              'kdialog',
              [
                '--title',
                copy.title,
                '--yesno',
                copy.body,
                '--yes-label',
                copy.relaunchBtn,
                '--no-label',
                copy.laterBtn,
              ],
              { encoding: 'utf8', timeout: 120000, env },
              (kdialogErr) => {
                resolve(!kdialogErr);
              }
            );
          }
        );
        return;
      }
      resolve(false);
    });
  }

  // 纯异步顺序控制模型：温和请求退出 -> 轮询确认单实例锁完全释放 -> 带 --remote-debugging-port=0 拉起（供单测与脱离微进程复用）
  async function executeHostRelaunchSequence(task, hooks = {}) {
    const pid = Number(task && task.hostPid);
    const exePath = String((task && task.exePath) || '').trim();
    const maxWaitMs = Math.max(500, Number(task?.maxWaitMs) || 25000);
    const pollMs = Math.max(20, Number(task?.pollMs) || 250);
    const settleMs = Math.max(0, Number(task?.settleMs ?? 350));
    const sleepFn = typeof hooks.sleep === 'function' ? hooks.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
    const requestGracefulQuit =
      typeof hooks.requestGracefulQuit === 'function' ? hooks.requestGracefulQuit : async () => true;
    const isHostStillRunning =
      typeof hooks.isHostStillRunning === 'function'
        ? hooks.isHostStillRunning
        : async () => {
            try {
              process.kill(pid, 0);
              return true;
            } catch (e) {
              return Boolean(e && e.code === 'EPERM');
            }
          };
    const launchWithCdpFlag =
      typeof hooks.launchWithCdpFlag === 'function' ? hooks.launchWithCdpFlag : async () => true;

    await requestGracefulQuit(pid, exePath);
    const deadline = Date.now() + maxWaitMs;
    let exited = false;
    while (Date.now() <= deadline) {
      const alive = await isHostStillRunning(pid, exePath);
      if (!alive) {
        exited = true;
        break;
      }
      await sleepFn(pollMs);
    }
    if (!exited) {
      return { relaunched: false, reason: 'host-did-not-exit' };
    }
    if (settleMs > 0) {
      await sleepFn(settleMs);
    }
    await launchWithCdpFlag(exePath, [CDP_OPT_IN_SWITCH]);
    return { relaunched: true, exePath, args: [CDP_OPT_IN_SWITCH] };
  }

  return {
    _setWindowsUiLocaleReaderForTest,
    readWindowsPreferredUiLanguage,
    detectSystemUiLocale,
    buildRelaunchDialogCopy,
    promptUserForHostRelaunch,
    executeHostRelaunchSequence,
  };
}

module.exports = {
  createLocaleDialog,
};
