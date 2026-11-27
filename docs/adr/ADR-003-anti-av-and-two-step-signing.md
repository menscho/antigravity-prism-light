# ADR-003: 防杀软红线、原生 FilePicker.cs 与 SignPath 双步签名

- **状态 / Status**: Accepted (Immutable)
- **守护铁律**: [`.github/ARCHITECTURE.md`](../../.github/ARCHITECTURE.md) 铁律 ⑦ · **门禁**: [`security-redteam.test.mjs`](../../test/gates/security-redteam.test.mjs)

## 背景 / Context
历史版本使用隐藏 PowerShell（`-WindowStyle Hidden`）、`Add-Type` 动态编译 C# 对话框、WMI 查询及内联 `node -e` 自删脚本，在 Windows Defender / 第三方杀软下高频触发启发式误报；同时 Windows 安装器 `installer.exe` 内嵌 `watcher.exe` 与 `install-manifest.json` 哈希清单，若顺序颠倒将导致子进程无签名或清单校验失配。

## 决策 / Decision
1. 全仓永久清零隐藏 PS、`-EncodedCommand`、WMI（`Win32_Process`/`Get-CimInstance`）、`Add-Type`、`WScript.Shell`、`taskkill`/`Stop-Process` 及非白名单内联 `node -e`；
2. Windows 原生文件/目录选择统一使用静态编译的 `installer/watcher/FilePicker.cs` (removed in the safe build) STA 原生 WinForms 子命令；
3. 严格执行 `docs/CODE_SIGNING_POLICY.md` (LIGHT 2026-11-27: removed with the native installers) 双步顺序：**先构建并由 SignPath 签 `watcher.exe` → 再注入已签 `watcher.exe` 计算清单哈希并签 `installer.exe`**。

## 为什么绝不能改回去 / Why Never Revert
任何一条 AV 红线回潮都会导致整包被杀软拦截，颠倒双步签名顺序则会直接破坏 SignPath Authenticode 信任链与安装清单验真。
