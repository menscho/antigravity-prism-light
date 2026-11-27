// Obsidian Prism — SAFE BUILD shortcut guard stub (src/platform/shortcut-guard.cjs)
//
// Modified from upstream RMvdesi/obsidian-prism (GPL-3.0) on 2026-11-27.
// Upstream scanned your Desktop / Start Menu / Taskbar every 5 minutes and
// rewrote every Antigravity shortcut to add --remote-debugging-port=0.
// This build never touches your existing shortcuts. The installer instead adds
// ONE separate "Antigravity (Prism)" shortcut, and the uninstaller removes it.
'use strict';

const NOOP_RESULT = Object.freeze({
  supported: false,
  safeBuild: true,
  scanned: 0,
  matched: 0,
  patched: [],
  alreadySet: [],
  skipped: [],
});

function ensureAntigravityShortcutsCdpFlag() {
  return { ...NOOP_RESULT, patched: [], alreadySet: [], skipped: [] };
}

async function ensureAntigravityShortcutsCdpFlagAsync() {
  return ensureAntigravityShortcutsCdpFlag();
}

function restoreAntigravityShortcutsCdpFlag() {
  return { supported: false, safeBuild: true, restored: [], skipped: [] };
}

module.exports = {
  ensureAntigravityShortcutsCdpFlagAsync,
  ensureAntigravityShortcutsCdpFlag,
  restoreAntigravityShortcutsCdpFlag,
};
