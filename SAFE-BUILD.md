# Antigravity Prism Light: what changed

Antigravity Prism Light is a modified fork (2026-11-27) of [RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism) (GPL-3.0), based on upstream commit [`b780f3b`](https://github.com/RMvdesi/obsidian-prism/commit/b780f3b8002e0fe28c14e45bfb452525eccf0a5e) (`v1.0.8-beta.5`).

The look and every visual feature are unchanged: themes, context vial, effort slider, pixel companions, wallpaper, chat mode, file viewer, and translator. Everything that could change your system, download code, or touch Antigravity's own data has been removed or disabled.

## What changed

| Upstream behaviour | Light |
| :--- | :--- |
| Checked GitHub every 6 hours and could download and run a new installer `.exe` | **Removed.** `sidecars/daemon/update-service.mjs` is a stub with no network or process code. |
| Settings panel could `git pull` the source folder and hot-swap code | **Removed.** The installer no longer writes `repo-meta.json`, and the daemon rejects `pull` / `sync` / `apply-update`. |
| Hidden "add-ons" lab could download extra code from GitHub | **Removed.** `sidecars/daemon/addon-registry.mjs` is a stub. |
| Rewrote **all** your Antigravity shortcuts every 5 minutes to add `--remote-debugging-port=0` | **Removed.** Your shortcuts are never touched. The installer adds one separate **"Antigravity (Prism)"** shortcut (Start Menu and Desktop) and uninstall deletes it. |
| Closed and relaunched Antigravity on its own when the debug port was missing | **Removed.** Without the port the plugin just stays idle. |
| Wrote a `GOMEMLIMIT` user environment variable (affects every Go program) | **Removed.** `sidecars/daemon/gomemlimit-service.mjs` is a stub. |
| Archived (moved) Antigravity conversation files, optionally on every exit, then restarted Antigravity | **Removed.** All archive / restore / auto-archive actions are blocked. |
| Uninstall button in settings ran an `.exe` from `%LOCALAPPDATA%\obsidian-prism\` | **Removed.** Uninstall only via `npm run uninstall:plugin`. |
| File pickers ran `obsidian-prism-watcher.exe` from `%LOCALAPPDATA%` or an env var | **Removed.** Never runs an outside `.exe`. Wallpaper and folder pickers ask you to paste a path. |
| Windows installer `.exe` + background watcher `.exe` in your Startup folder | **Removed** (`installer/`, build scripts, release workflow). Nothing is added to Windows startup. |
| Installer started a detached daemon that kept running after Antigravity closed | **Changed.** The installer starts nothing. The "Antigravity (Prism)" shortcut opens Antigravity and starts the daemon hidden, and the daemon quits about a minute after Antigravity closes. |
| Daemon used Node's default heap settings | **Changed.** Smaller young generation: about 50 MB less on first start (see Memory). |
| UI language followed the system language (`auto`) | **Changed.** Defaults to English. `auto` and the other languages are still in the settings. |
| Screenshots, `scripts/build-installer.mjs`, code-signing policy, separate `README.en.md` | **Removed** to keep the download small (about 17 MB less). `README.md` is in English. |
| Dead code left behind after the stubs (`win-picker.mjs`, `update-storage-subsystem.mjs`, `storage-guard-coordinator.mjs`) | **Removed.** |

The files that hold these changes:

- `sidecars/daemon/update-service.mjs`, `addon-registry.mjs`, `gomemlimit-service.mjs`: stubs
- `src/platform/shortcut-guard.cjs`: stub
- `src/platform/prism-shortcut.cjs`: new, makes or removes the separate shortcut
- `src/platform/prism-launch.cjs`: new, what that shortcut runs (see below)
- `src/daemon/safe-build-policy.mjs`: new, which settings actions are allowed (called first from `repo-update-coordinator.mjs`)
- `src/daemon/relaunch-guard.mjs`, `update-storage-subsystem.mjs`, `storage-guard-coordinator.mjs`: timers and auto-actions off
- `src/daemon/index.mjs`: `startParentExitWatchdog` and `startHostGoneWatchdog`
- `src/security/win-picker.mjs`: never resolves an outside `.exe`
- `tools/install-plugin.cjs`: no detached daemon, no repo link, separate shortcut
- `sidecars/daemon/sidecar.json`: memory flag (see below)
- `src/config/schema.cjs`, `settings-panel.js`, `config.example.json`: English default
- `plugin.json`, `package.json`, `i18n-locales.js`, `settings-panel.js`, `ui-runtime.js`: name "Antigravity Prism Light" (the About page still credits Obsidian Prism and RMvdesi)
- `install.cmd`, `uninstall.cmd`: one-click install and uninstall
- `test/safe-build.test.mjs`: new tests for all of the above

The plugin's internal id and install folder stay `obsidian-prism`, so Antigravity's registry and existing settings keep working.

Changed lines in the source and tests are marked with a `SAFE BUILD` or `LIGHT (2026-11-27)` comment.

## How it starts

The "Antigravity (Prism)" shortcut runs `node.exe src\platform\prism-launch.cjs` from the installed plugin, minimised. The launcher:

1. starts `Antigravity.exe` with `--remote-debugging-port=0` (plus any arguments your normal shortcut has);
2. starts the Prism daemon with no window, unless one is already running;
3. exits.

The daemon quits about a minute after Antigravity's debug port goes away, or after 3 minutes if it never appears. Nothing is added to Windows startup, the registry or Task Scheduler.

Upstream relied on Antigravity starting the daemon as a plugin "sidecar". That does not work when Antigravity runs its language server in WSL: the sidecar would start inside Linux, where it can't reach the Windows-side debug port. The launcher works either way. If your Antigravity does run sidecars natively on Windows, it may start a second copy as a sidecar. The newer copy takes over from the older one, so only one runs at a time.

If Antigravity is already open (started normally) when you use the Prism shortcut, Windows only opens a new window in the running copy, which has no debug port. Close Antigravity completely first.

## Memory

The daemon sidecar now starts Node with `--max-semi-space-size=4` (a smaller V8 young generation). Nothing else changes. Measured on Windows 11, Node 26, daemon idle with no Antigravity debug port, average of the last 10 seconds of a 30-second run:

| | Default | Light |
| :--- | ---: | ---: |
| First start (builds its caches) | 191 MB | 138 MB |
| Later starts | 75 MB | 71 MB |

Connected to Antigravity (one main window, Prism injected), the daemon used about 87 MB.

The background workers already had their own heap caps upstream (32 to 48 MB).

## Tests

`npm test` passes: 1,055 tests, 1,007 pass, 48 skipped, 0 fail. Tests that only checked removed features (the `.exe` installers, self-update, shortcut rewriting, archiving, the watcher picker) are either deleted (four files that only tested removed modules) or marked `skip: 'safe build: …'`. Tests that mixed removed and kept features keep every check on the kept part. Tests that checked the old name or the `auto` language default were updated, and `auto` language resolution is still tested.

## What still talks to the network

Only things you turn on yourself:

- **Thought / title translator:** off by default. In *Machine* mode it sends the text to `translate.googleapis.com` or `www.bing.com`. In *AI* mode it sends it to the endpoint you enter.
- **Prompt suggester:** uses the AI endpoint you configure.
- **Side-pane browser:** opens links you click.

The daemon's local servers listen on `127.0.0.1` only.

## The one trade-off that remains

Like the original, the plugin reaches into Antigravity through Chrome DevTools Protocol, so Antigravity has to start with `--remote-debugging-port=0`. That opens a random local port that other programs on your PC (running as you) can connect to while Antigravity is open. Light only opens it when you launch from the **"Antigravity (Prism)"** shortcut. The normal shortcut starts stock Antigravity with no port.

## Install / uninstall (Windows, Node 22+)

Double-click `install.cmd` / `uninstall.cmd`, or:

```powershell
npm run install:plugin
```

Then close Antigravity completely and reopen it with the **Antigravity (Prism)** shortcut (Start Menu or Desktop).

```powershell
npm run status:plugin
```

```powershell
npm run uninstall:plugin
```

The installer copies the runtime to `%USERPROFILE%\.gemini\config\plugins\obsidian-prism`, registers it under `plugins` in `%USERPROFILE%\.gemini\config\config.json`, and creates the shortcut. The installed copy does not depend on this source folder.

## License

GPL-3.0-only, same as upstream. `LICENSE` and `NOTICE` are kept unchanged. Anyone sharing this build or a modified version must keep it GPL-3.0 with full source, credit RMvdesi/obsidian-prism, and keep these modification notes.
