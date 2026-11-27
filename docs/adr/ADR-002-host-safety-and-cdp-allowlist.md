# ADR-002: 宿主物理绝缘与 CDP 严格白名单

- **状态 / Status**: Accepted (Immutable)
- **守护铁律**: [`.github/ARCHITECTURE.md`](../../.github/ARCHITECTURE.md) 铁律 ⑦ · **门禁**: [`security-redteam.test.mjs`](../../test/gates/security-redteam.test.mjs)

## 背景 / Context
修改宿主 `app.asar` 会破坏软件完整性签名并引发更新覆盖与风控告警；跨进程 `OpenProcess` 强杀或 `EmptyWorkingSet` 会触发安全软件拦截并损坏宿主现场；直连宿主在线 `state.vscdb` 或 `conversations/*.db` 存在 SQLite 锁竞争与库损坏风险；滥用 `Network.*`/`Fetch.*`/`Debugger.*` CDP 域会触及隐私与风控红线。

## 决策 / Decision
1. **物理绝缘**：永久禁止修改 `app.asar`、禁止打开 `state.vscdb` 或 `conversations/*.db`、禁止对宿主进程执行强杀或 `EmptyWorkingSet`；
2. **CDP 永久白名单**：全仓仅允许 `Page.*`、`Runtime.*`、`Target.*` 与 `Browser.close`（兼容探针例外仅放行只读 `Performance`）；
3. **本地回环强约束**：所有本地 `http.createServer` 严格绑定 `127.0.0.1` 并校验 `Host` / `Origin`。

## 为什么绝不能改回去 / Why Never Revert
任何对宿主二进制、在线 SQLite 或高危 CDP 域的越界调用，都会将纯 UI 增强工具转化为高风险入侵行为，直接丧失用户信任与合规底线。
