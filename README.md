# Antigravity Prism Light

**A lightweight, cleaned-up version of [Obsidian Prism](https://github.com/RMvdesi/obsidian-prism) for the Antigravity editor.** Same look, same themes and effects, but with every part removed that could download code, change your system, or touch Antigravity's own data.

<p align="center">
  <img src="https://raw.githubusercontent.com/RMvdesi/obsidian-prism/b780f3b8002e0fe28c14e45bfb452525eccf0a5e/assets/screenshots/hero-dark.webp" width="100%" alt="Antigravity with the Prism dark theme" />
</p>

<p align="center"><sub>Screenshots are from the original Obsidian Prism project. Light looks the same.</sub></p>

## Contents

- [What you get](#what-you-get)
- [What was removed](#what-was-removed)
- [Install](#install)
- [Update](#update)
- [Uninstall](#uninstall)
- [How it works](#how-it-works)
- [Memory use](#memory-use)
- [Credits and license](#credits-and-license)

## What you get

Everything visual from Obsidian Prism `v1.0.8-beta.5`:

- **Four colour themes:** two dark (Obsidian, Warm) and two light (Crystal, Alabaster), with optional follow-system switching.
- **Context vial:** a small gauge next to the input box showing how much of the 512K context is used. Click it for a breakdown and quota forecast.
- **Reasoning effort slider** in the model menu.
- **Thought and title translator** (off by default): live translation of the model's thinking, in immersive or side-by-side mode.
- **Pixel companions** above the input box that you can drag and stack.
- **Workbench extras:** built-in browser and file viewer, right-click menu, long code block folding, conversation outline.
- **Chat mode (Beta, off by default)** and **custom wallpaper (Beta, off by default)**.
- **Light on resources:** animations drop to 0 fps when idle, and the settings panel applies changes instantly.

All settings live in Antigravity under **Settings → Appearance**. The UI language defaults to English (the original followed your system language) and can be changed there.

<p align="center">
  <img src="https://raw.githubusercontent.com/RMvdesi/obsidian-prism/b780f3b8002e0fe28c14e45bfb452525eccf0a5e/assets/screenshots/palettes.webp" width="100%" alt="The four colour themes" />
</p>

## What was removed

| Original Obsidian Prism | Antigravity Prism Light |
| :--- | :--- |
| Checked GitHub every 6 hours and could download and run a new installer `.exe` | Removed. No updater, no network code. |
| Settings button that ran `git pull` on the source folder and hot-swapped code | Removed. |
| Hidden add-on store that could download extra code from GitHub | Removed. |
| Rewrote **all** your Antigravity shortcuts every 5 minutes | Removed. Your shortcuts are never touched. One separate "Antigravity (Prism)" shortcut is added instead. |
| Closed and restarted Antigravity on its own | Removed. |
| Set a `GOMEMLIMIT` user environment variable that affects every Go program | Removed. |
| Moved (archived) Antigravity conversation files, optionally on every exit | Removed. |
| Windows installer `.exe` and a background watcher `.exe` in your Startup folder | Removed. Nothing is added to Windows startup. |
| Background service kept running after Antigravity closed | Changed. It quits about a minute after Antigravity closes. |
| Default Node.js memory settings | Changed. About 50 MB less on first start. |
| Screenshots and build tools in the repository | Removed. The download is about 17 MB smaller. |

The full list, with the files that were changed, is in [`SAFE-BUILD.md`](./SAFE-BUILD.md). The security model is in [`.github/SECURITY.md`](./.github/SECURITY.md).

## Install

You need:

- **Windows 10 or 11**
- **[Antigravity](https://antigravity.google)**, installed normally
- **[Node.js](https://nodejs.org) 22 or newer** (the LTS installer is fine)

Steps:

1. Download this repository: **Code → Download ZIP** and unzip it, or:

   ```powershell
   git clone https://github.com/menscho/antigravity-prism-light
   ```

2. Double-click **`install.cmd`** in the folder.
3. Close Antigravity completely (all windows).
4. Open Antigravity with the new **Antigravity (Prism)** shortcut on your Desktop or in the Start Menu.

The installer copies the plugin to `%USERPROFILE%\.gemini\config\plugins\obsidian-prism`, registers it in `%USERPROFILE%\.gemini\config\config.json`, and creates the shortcut. After that you can delete the downloaded folder.

Prefer a terminal? These do the same as the `.cmd` files:

```powershell
npm run install:plugin
```

```powershell
npm run status:plugin
```

> **Note:** the plugin folder is still called `obsidian-prism`, so if you had the original installed, Light replaces it in place and keeps your settings. Install one or the other, not both.

## Update

There is no automatic update, on purpose. To update, download the new version and run `install.cmd` again. Your settings are kept.

## Uninstall

Double-click **`uninstall.cmd`**, or run:

```powershell
npm run uninstall:plugin
```

This removes the plugin folder, its entry in Antigravity's config, and the "Antigravity (Prism)" shortcut. Your Prism settings are saved to `%USERPROFILE%.geminiconfigobsidian-prism-config.backup.json` in case you reinstall. If the original Obsidian Prism had added `--remote-debugging-port` to your normal shortcuts, uninstall removes it.

## How it works

Prism draws its UI inside Antigravity through the Chrome DevTools Protocol. For that, Antigravity has to start with `--remote-debugging-port=0`.

The **Antigravity (Prism)** shortcut runs a small launcher (`src/platform/prism-launch.cjs`) that:

1. starts Antigravity with that flag (plus any arguments from your normal shortcut);
2. starts the Prism background service with no window, if it isn't already running;
3. exits.

The background service quits about a minute after Antigravity closes. Nothing is added to Windows startup, the registry or Task Scheduler.

Things to know:

- **Use the Prism shortcut from a closed Antigravity.** If Antigravity is already open, Windows just opens another window in the running copy, which has no debug port, so Prism won't appear.
- **Your normal shortcut still starts plain Antigravity**, with no debug port and no Prism.
- **The trade-off:** while Antigravity runs with the debug port, other programs on your PC running as you could connect to it. This is the same for the original Obsidian Prism and any CDP-based plugin.
- **WSL:** the launcher works whether Antigravity's language server runs on Windows or inside WSL. The original relied on Antigravity starting the service as a plugin "sidecar", which never happens when the language server runs in WSL.
- **macOS / Linux:** not tested by this fork. `npm run install:plugin` keeps the original's separate launcher there (an app on macOS, a menu entry on Linux) that starts Antigravity with the debug port. The Windows launcher and auto-quit are Windows-only.

## Memory use

Measured on Windows 11, background service idle:

| | Original | Light |
| :--- | ---: | ---: |
| First start (builds its caches) | 191 MB | 138 MB |
| Later starts | 75 MB | 71 MB |

Connected to Antigravity with Prism showing, the service uses about 87 MB.

## Development

```powershell
npm test
```

1,000+ tests, no dependencies to install. Tests for removed features are deleted or skipped with a reason.

## Credits and license

Antigravity Prism Light is a modified fork (2026-11-27) of **[Obsidian Prism](https://github.com/RMvdesi/obsidian-prism)** by [@RMvdesi](https://github.com/RMvdesi), licensed under [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html). All the design and almost all the code are theirs. This fork only removes and disables features. If you like it, please star the original.

This project is licensed under **GPL-3.0-only**, the same as the original. [`LICENSE`](./LICENSE), [`NOTICE`](./NOTICE) and [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) are kept unchanged. If you share a modified version, it must stay GPL-3.0 with its full source and keep these credits.

Obsidian Prism builds on these projects (MIT-licensed components keep their original notices in `THIRD_PARTY_NOTICES.md`):

1. [0DNANCY/agy-claude-style](https://github.com/0DNANCY/agy-claude-style): MIT, Copyright (c) 2026 0DNANCY. Theme framework, spring animation base, WebGL2 effects, pixel companion base.
2. [ATtacK030130/antigrative-dashboard](https://github.com/ATtacK030130/antigrative-dashboard) (v0.9.1): MIT, Copyright (c) 2026 AG Pulse contributors. Telemetry and quota forecasting (`vendor/pulse-dashboard/`).
3. [LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider](https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider): MIT, Copyright (c) 2026 LLYSH-HANNARI. Reasoning effort slider (`vendor/effort-slider/`).
4. [yiheng8023/antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese) (v3.3.63): MIT, Copyright (c) 2026 Antigravity Chinese Localization Contributors. Localization approach (`vendor/host-i18n/`).
5. [Nwflower/dsh-claude-style](https://github.com/Nwflower/dsh-claude-style): layout and warm light theme reference.
6. [Microqian2th/dsh-codex-effort-slider](https://github.com/Microqian2th/dsh-codex-effort-slider): slider detents and motion curve reference.
7. [mobius/dsh-performance-slider](https://github.com/mobius/dsh-performance-slider): performance slider interaction reference.
8. [claudenoshujin/claude-web](https://github.com/claudenoshujin/claude-web) (by lulu): desktop pet stacking interaction reference.
9. [wp3171216237/dsh-TUI](https://github.com/wp3171216237/dsh-TUI): MIT, Copyright (c) 2026 chimney (@wp3171216237). Deepy whale companion design reference.

Community contributors to the original project are listed in [`docs/CONTRIBUTORS.md`](./docs/CONTRIBUTORS.md).

Antigravity Prism Light is an independent open-source project and is not affiliated with or endorsed by Google LLC.
