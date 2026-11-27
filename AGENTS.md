# AGENTS.md — Obsidian Prism 实战开发合同与防腐化红线

> **定位 / Role**
> 本文件是所有 AI 代理（Antigravity 主脑 / Swarm Workers / Claude Code / Codex / Cursor）在 **Obsidian Prism（黑曜棱镜）** 仓库执行开发、修复、优化与审查时必须遵守的**现行实战合同**。
>
> - 最高架构宪法与工程铁律：[`.github/ARCHITECTURE.md`](./.github/ARCHITECTURE.md)
> - 不可回退架构决策卡（ADR）：[`docs/adr/README.md`](./docs/adr/README.md)

---

## 一、四态真交付铁律（严禁虚报「已完成」）

**任何改动必须严格区分以下 4 个阶段，未走完全部必要阶段严禁向维护者汇报「已完成」**：

1. **已进仓**：代码已合入唯一集成仓，跑通 `npm run test:gates`（28/28）与全量单元测试（`0 fail`）；
2. **已热同步实机**：通过 [`src/platform/install-manifest.cjs`](./src/platform/install-manifest.cjs) 或全量扫描实现实机目录 **0-DIFF 同步**（严禁手写易漏白名单、严禁留死文件、100% 校验受保护用户配置与壁纸 SHA-256 未变），清空 `.bundle-cache` 并仅重启 `.daemon.pid`；
3. **原生二进制已重编**：凡改动 `installer/` 下 C# / Swift 源码（Watcher / Installer），必须重新编译并替换实机可执行文件后才算生效，否则一律标注「**实机仍失效（旧二进制）**」；
4. **实机真验通过**：在真实 Antigravity 窗口通过 CDP DOM/CSSOM 读取与肉眼/2x 截图核验效果（`profile-live-perf.mjs` 为 `HEALTHY` 且 `probe-host-compat.mjs --live` `brokenCritical=0`）。

> **阶段备份与边界**：每轮大合入后必查 `RMvdesi/obsidian-prism-dev` 备份落差并主动呈报（只从集成仓推 `HEAD:refs/heads/main`，不碰本地 `obsidian-prism-dev` 未提交草稿）；一切公开云端写操作（push / tag / Release / 评论 / 关单）必须获维护者明示批准。

---

## 二、300Hz 体验与视觉质感红线（禁绝 C 类负优化）

**性能优化只做真减负（A 类：编译期扁平化、按需通道、OffscreenCanvas Worker、WebGL Shader 去开销、DOM 读写分离、热路径剪枝），严禁通过砍画质和破坏交互来凑跑分**：

1. **禁止低帧 `steps()` 破坏 GPU 合成动画**：加载环、思考火花、推理滑块扫光、侧栏呼吸球、骨架屏等 `transform`/`opacity` 合成动画在默认档（`balanced`/`quality`）一律保持丝滑 `linear`/`ease-in-out`，绝不允许砍成 6–15fps 跳格；
2. **禁止默认档砍核心浮层毛玻璃及滚动闪屏**：Overview / Drawer / Toast / SideQuestion / Fastpick / SlashMenu / PeekSurface 默认档保留质感毛玻璃（仅 `performance` 省电档或 `motion="off"` 关闭），禁止借 `data-ag-perf-busy` / `stream-active` 在滚动或流式时反复开关 `backdrop-filter` 造成剧烈闪屏；
3. **禁止默认档切窗 `win-blur` 冻死宿主运行指示器**：双屏或切窗看后台 Agent 执行时，宿主加载环、流光与运行态指示器必须保持鲜活（仅 `performance` 省电档与门禁要求休眠的自研 Canvas 在失焦时休眠）；
4. **禁止粗暴使用破坏布局的 `content-visibility: auto`**：不得对对话消息或代码块直接套用隐含 `contain: paint` 且估算高度失真的 `content-visibility: auto`，避免破坏代码块 `position: sticky` 吸顶或引发长对话滚动跳动。

---

## 三、变更黄金路径（Golden Paths）

### ① 新增功能、按需通道与配置契约
- **唯一通道注册**：仅在 [`src/channels/registry.cjs`](./src/channels/registry.cjs) 注册新通道（配齐 `configKeys`、`files`、`budgetBytes`、`shouldEnable()`、`build()` 及 [`src/channels/channel-teardowns.cjs`](./src/channels/channel-teardowns.cjs) 清理函数）；开关 `off` 时必须 **0 编译、0 注入、0 常驻内存**；严禁把非首屏重模块硬塞进 Channel 1（[`ui-runtime.js`](./ui-runtime.js)）。
- **配置单源同步**：在 [`src/config/schema.cjs`](./src/config/schema.cjs) 声明键、默认值与校验器，同步更新 [`config.example.json`](./config.example.json)，并检查原生端 `installer/common/CdpClient.cs` (removed in the safe build) 与 `installer/macos/Common/CdpClient.swift` (removed in the safe build) 配置同步状态，防止漂移扩大。
- **9 语种一等公民**：完整覆盖 `zh-CN` / `zh-TW` / `en` / `ja` / `ko` / `es` / `fr` / `de` / `tr`（非 CJK 语种 **0 汉字**，严禁新增 `yue` 独立词典或语言选项，严禁出现禁用项目外游戏术语）。

### ② 宿主兼容性修复
- 改动前先跑 `node scripts/probe-host-compat.mjs --live`（或 `--snapshot`）定位真实 DOM 锚点，**禁止凭猜想写选择器**；
- 跨模块宿主 UI 选择器优先收口至 [`src/compat/host-selectors.cjs`](./src/compat/host-selectors.cjs) 并在调用点标注 `@host-compat`，防止多处散落硬编码造成改一漏三。

### ③ 原子落盘与热同步
- 安装、升级与热同步遵循 [`src/platform/install-manifest.cjs`](./src/platform/install-manifest.cjs) 原子事务规范，严禁裸写直覆或误删用户受保护资产（`config.json`、`obsidian-prism-*.json`、`custom.css`、`vendor/wallpaper/*` 媒体、`backups/`）。

### ④ 模块纪律与四防安全红线
- **扩展名纪律**：`src/{utils,config,cdp,compat,compiler,channels,platform}/` 统一 `.cjs`；`src/daemon/` 与 `src/security/` 统一 `.mjs`；严禁 `.cjs` 同步 `require('*.mjs')`（守住 Node 22.0–22.11 兼容）；0 循环依赖、0 原型混入、采用显式组合与 [`session-fsm.mjs`](./src/daemon/session-fsm.mjs) 显式状态机。
- **四防安全红线**：0 运行期 npm 依赖、0 `innerHTML`、0 `:has(`、100% ASCII CSS、0 隐藏 PowerShell/WMI/`Add-Type`/`WScript.Shell`/大段 `node -e`、CDP 严格白名单（`Page.*`/`Runtime.*`/`Target.*`/`Browser.close`）、严禁触碰 `app.asar` 与宿主 `.db`、本地 HTTP 严格绑定 `127.0.0.1`。

### ⑤ 版本真相源
- 唯一版本真相源为 [`package.json`](./package.json) 的 `version` 字段；升版统一用 `node scripts/bump-version.mjs <ver>` 并跑 `npm run version:check`。

---

## 四、门禁不可篡改锁（Immutable Gates Lock）

> **HARD LOCK**：严禁在任何开发、修补或重构中擅自放宽 `test/gates/*` 字节/行数阈值、删除安全/架构断言、降低棘轮上限或往 `LEGACY_*` / `ALLOWED_*` 白名单塞新条目。确遇不可绕过的平台例外时，**必须先停手呈报原因与替代方案，待人类维护者明示批准并在 [`docs/adr/`](./docs/adr/README.md) 补 ADR 决策卡后方可调整**。

---

## 五、写/审分离 6 项交卷核验表

编写与审查代理交卷前必须逐项核对（任一失败即退回）：

- [ ] **1. 分层与边界**：0 外部依赖、`src/` 单向无环、`.cjs`/`.mjs` 不混用、新建模块 `<= 800` 行 / `<= 40 KB`；
- [ ] **2. 通道与预算**：`Ch1` 全 9 语（+`auto`）`< 390,000 B`、`configRefresh < 4,096 B`、各通道不破预算、开关 `off` 为 `0 B`；
- [ ] **3. 体验红线**：无默认档低帧 `steps()`、无默认砍核心毛玻璃/滚轮闪屏、无切窗冻死宿主运行圈、无破 `sticky` 的 `content-visibility: auto`；
- [ ] **4. 契约与 9 语种**：`schema.cjs` 与 `config.example.json` 100% 对齐、9 语种齐全且非 CJK 0 汉字、0 `yue` 独立词典；
- [ ] **5. 安全与原子落盘**：0 `innerHTML`、0 `:has(`、0 新增 AV 红线、保护全部用户配置与壁纸资产；
- [ ] **6. 测试与卫生**：**按模块域命名测试（严禁新增 `v10x-*` / `w5-*` / `w6-*` / `issueXX-*`）**、UTF-8 无 BOM + LF、Markdown 相对链接全部有效。

---

## 六、中大版本发版前必做「五防大审 + 带图总验收」（小改不做）

1. **独立并发只读五防大审**（严禁主脑下场读大源码，全权交由独立只读 Swarm 子代理分片审查）：
   - **防屎山 / 防腐化 / 保项目健康**：查 DAG、膨胀棘轮、死代码、配置多端漂移、半拉子过渡壳；
   - **防风控 / 杀软 / 宿主合规**：查 CDP 白名单、0 `app.asar`/宿主 `.db` 触碰、0 AV 敏感脚本链、PE 元数据；
   - **防隐私泄露 / 安全漏洞**：查 0 `innerHTML`、127.0.0.1 回环 + Host/Origin 防护、SSRF、日志 `0o600` 与用户名路径脱敏；
   - **防性能劣化 / 保真优化**：查实机 `profile-live-perf.mjs`、零 C 类负优化回归、0 泄漏与后台休眠。
2. **清单真完独立清算**：同步派 1 名独立只读清算子代理对照待办总账逐条复核“清单真的 100% 完成了吗？”（核代码、核实机 0-DIFF、核原生二进制时间戳、核实机 DOM/画面实证），绝不靠主脑自查打勾。
3. **发现即修 + 复审闭环**：凡检出 P0/P1 或任一清单缺口，立即派独立施工子代理修复并复审过关。
4. **带实机验收截图的总验收 MD**：在实机热同步并替换最新原生二进制后，抓取实机验收截图（存入 Artifact 目录并嵌入），生成完整总验收 `.md` 报告随发版审批包一并呈报。

---

## 七、必跑验证命令与索引

```bash
npm run test:gates
npm run version:check
node scripts/run-tests.mjs --all
```

- 最高架构宪法：[`.github/ARCHITECTURE.md`](./.github/ARCHITECTURE.md)
- 架构决策记录（ADR）：[`docs/adr/README.md`](./docs/adr/README.md)
- 代码签名与发布合规：`docs/CODE_SIGNING_POLICY.md`（LIGHT 2026-11-27: removed, Light ships no binaries）
- 贡献指南与测试规范：[`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md)
