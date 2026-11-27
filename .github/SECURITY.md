# Security Policy

Antigravity Prism Light is a fork of [Obsidian Prism](https://github.com/RMvdesi/obsidian-prism) with every feature removed that could download code, change your system, or touch Antigravity's own data. What was removed, and why, is listed in [`SAFE-BUILD.md`](../SAFE-BUILD.md).

## What the plugin does and does not do

- **No self-update, no downloads.** The plugin never fetches or runs code from the internet. There is no updater, no add-on store, no `git pull`, and no `.exe` installer or watcher.
- **No changes to Antigravity itself.** It never patches `app.asar` or Antigravity's executables, never opens Antigravity's SQLite databases (`state.vscdb`, `conversations/*.db`), and never moves, archives or deletes your conversations.
- **No system changes.** No environment variables, no registry, no Task Scheduler, nothing in the Windows Startup folder. The installer adds one separate **"Antigravity (Prism)"** shortcut and leaves your normal Antigravity shortcuts alone. Uninstall removes it.
- **Read-only DevTools access.** The UI is injected through the Chrome DevTools Protocol. Only the `Page.*`, `Runtime.*`, `Target.*` and `Browser.close` domains are allowed. `Network.*`, `Fetch.*`, `Debugger.*`, `Input.*`, `Storage.*` and similar are blocked and checked by `test/gates/security-redteam.test.mjs`.
- **Local servers stay local.** Every local HTTP server binds to `127.0.0.1` only, checks the `Host` header, and rejects cross-site requests using `Origin` / `Sec-Fetch-Site` (protects against CSRF and DNS rebinding).
- **Opt-in network features are guarded.** The thought/title translator and prompt suggester are off by default. When you turn them on, destination URLs and their resolved addresses go through `src/security/net-guard.mjs`, which blocks private, loopback and link-local ranges (SSRF), and API keys are never sent over plain `http://` to a remote host.
- **Secrets and logs.** An optional translator API key is stored only in `~/.gemini/config/obsidian-prism-thought.json` with `0o600` permissions and is masked in the UI. Logs and state files use `0o600` on macOS/Linux, and error logs replace your home folder with `<USER_HOME>`. Nothing is uploaded.
- **No `innerHTML` at runtime.** UI is built with `createElement` / `textContent` only.

## The one trade-off

Antigravity has to run with `--remote-debugging-port=0` for the plugin to work. While it does, other programs on your PC running as your user can connect to that local port. The port is only opened when you start Antigravity from the **"Antigravity (Prism)"** shortcut. Your normal shortcut starts stock Antigravity with no port.

## Reporting a vulnerability

Please report security issues privately through **GitHub Security Advisories** on [menscho/antigravity-prism-light](https://github.com/menscho/antigravity-prism-light) (**Security** tab → **Report a vulnerability**) instead of opening a public issue. Include:

- the Antigravity Prism Light version, OS, Node.js and Antigravity version;
- steps to reproduce or a proof of concept;
- what an attacker could do with it.

If the issue is also present in the original project, please report it to [RMvdesi/obsidian-prism](https://github.com/RMvdesi/obsidian-prism) as well.
