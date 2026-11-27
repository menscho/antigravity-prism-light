# Obsidian Prism Architecture Constitution / 架构宪法

> **最高工程规范 / Supreme Engineering Constitution**
> 本文件定义 **Obsidian Prism（黑曜棱镜）** 的长期架构边界、十条不可违工程铁律与自动化适应度门禁（Fitness Gates）。
> 任何功能开发、重构、兼容性适配或社区 Pull Request 均须遵守本宪法，并由 `test/gates/*.test.mjs`（`npm run test:gates`，共 6 套 28 项门禁）与 CI Fail-Fast 门禁自动强制执行。
> AI 编码代理实战开发合同（四态真交付、300Hz 体验红线、9 语种契约与 6 项交卷核验表）见 [`AGENTS.md`](../AGENTS.md)；核心不可回退架构决策卡见 [`docs/adr/README.md`](../docs/adr/README.md)。

---

## 十条长期架构铁律 / Ten Non-Negotiable Architecture Laws

### 铁律 ① · 零运行期外部依赖与 `L0 → L4` 单向无环 DAG
*Zero Runtime `node_modules` Dependencies & Strict `L0 → L4` Acyclic DAG*

1. **0 外部运行期 `node_modules` 依赖**：`package.json` 严禁引入运行期第三方 npm 包；Node 侧仅允许 Node.js >= 22 内置能力（`node:*`、`fetch`、`WebSocket`、`node:sqlite`、`node:test`），浏览器侧仅允许原生 Web API。
2. **严格分层单向依赖（`L0 → L4`）与 `src/` 内部四级分层 DAG**：
   - **`L0` 纯叶子 / 契约层**：无副作用纯函数、静态常量、词典、配置 Schema 与安全基础工具（如 `i18n-core.js`、`i18n-locales.js`、`vendor/pulse-dashboard/sidecars/panel/usage-keys.mjs`、`src/config/*.cjs`、`src/utils/*.cjs`）。
   - **`L1` 浏览器核心组件与编排原语层**：光学渲染、动效引擎、状态与 DOM 增强组件（如 `motion-engine.js`、`ripple-core.js`、`vial-core.js`、`settings-panel.js`、`style.css`、`src/runtime/*.js`），以及 Node 侧 `src/cdp/*.cjs`、`src/compat/*.cjs`、`src/compiler/*.cjs`、`src/channels/*.cjs`（含 `src/channels/registry.cjs`）、`src/security/*.mjs`。
   - **`L2` 浏览器按需通道客户端与平台适配层**：主运行期入口（`ui-runtime.js`）、按需延迟注入的各通道客户端（`vendor/**/*-client.js`、`vendor/**/*-settings-ui.js`、`vendor/periodic-picker/*.js`、`vendor/host-i18n/*.js`），以及跨平台安装/同步/快捷方式/重启原语 `src/platform/*.cjs`（含 `src/platform/install-manifest.cjs`、`src/platform/repo-sync.cjs`、`src/platform/process-probe.cjs`、`src/platform/run-in-bg-recovery.cjs`）。
   - **`L3` 本地守护、服务与编译胶水层**：`cdp.js`（薄 Facade）、`sidecars/daemon/*`、`src/daemon/*.mjs`、`vendor/**/*-service.mjs`、`vendor/**/*-server.mjs`、`vendor/pulse-dashboard/sidecars/*`。
   - **`L4` 入口工具、构建器、原生安装器与测试层**：`inject.js`、`remove.js`、`tools/install-plugin.cjs`、`scripts/*`、`installer/*`、`workbench/*`、`test/*`。
3. **跨层禁令与 `src/` 扩展名统一铁律**：
   - `L0`/`L1`/`L2` 浏览器前端模块**严禁**导入 `node:*` 或 `sidecars/`；
   - `L3` 守护与服务层**严禁**反向依赖 `scripts/`、`workbench/` 或 `installer/`；
   - **`src/` 内部严格单向四级 DAG**：`L0 (src/config, src/utils)` → `L1 (src/cdp, src/compat, src/compiler, src/channels, src/security)` → `L2 (src/platform)` → `L3 (src/daemon)`，**严禁任何下层反向导入上层**（如 `src/platform/* -> src/daemon/*`、`src/config/* -> src/compiler/* | src/platform/*`）；
   - **`src/` 扩展名统一规范（0 同目录混用，兼容 Node `22.0–24.x` 0 `ERR_REQUIRE_ESM`）**：`src/{utils,config,cdp,compat,compiler,channels,platform}/` 统一使用标准 CommonJS `.cjs`（供 CJS 入口同步 `require()` 与 ESM 模块静态 `import` 双向零摩擦消费）；`src/daemon/` 与 `src/security/` 统一使用 `.mjs`；`src/runtime/` 为浏览器端按需脚本/Worker `.js`；严禁同目录混用扩展名，严禁任何 `.cjs` 或根级 CJS 入口同步 `require()` `.mjs` 文件；
   - 全仓静态 `import` / `export ... from` / `require` / `new Worker(new URL(...))` 依赖图必须保持 **严格 0 循环依赖**。

---

### 铁律 ② · 体积与膨胀棘轮
*Module Size & Monolith Ratchet*

1. **新建模块硬上限**：任何新建源码或样式文件严格 `<= 800 行` 且 `<= 40 KB (40,960 B)`。
2. **存量巨石只降不涨**：历史遗留超大文件（如 `settings-panel.js`、`ui-runtime.js`、`vendor/periodic-picker/keyboard-3d-gl.js` 等）纳入 `test/gates/architecture-fitness.test.mjs` 棘轮基线表，**只允许持平或削减，严禁继续膨胀**；新增复杂逻辑必须拆分为独立小模块（历史 `tools/patch-asar.cjs` 已彻底退役清除）。
3. **根目录冻结红线**：严禁向仓库根目录新增任何运行期 `.js` / `.css`、脚本或散落文档；根目录存量 25 个运行期模块与 13 个元信息/治理文件保持白名单锁定直至 `v1.0.9+` 渐进迁入 `src/`。

---

### 铁律 ③ · 单一真相源（SSOT）
*Single Source of Truth*

1. **唯一版本源**：`package.json#version` 是全仓唯一版本真相源。Node 侧模块优先动态读取 `package.json#version`；所有静态版本锚点（`plugin.json`、`CITATION.cff`、`installer/setup/app.manifest`、`installer/watcher/app.manifest`、C#/Swift 默认常量与浏览器兜底版本等共 18 处锚点）统一由 `node scripts/bump-version.mjs <newVersion>` 一键同步，并由 `npm run version:check` 校验零漂移。
2. **唯一配置 / 通道 / 安装清单源**：配置契约（`src/config/schema.cjs`）、通道注册元数据（`src/channels/registry.cjs`）与安装资产清单、退役清扫列表及原子升级引擎（`src/platform/install-manifest.cjs` / `install-manifest.json`）禁止多处手工复制粘贴导致状态漂移。

---

### 铁律 ④ · 声明式微内核扩展原则与多通道真实体积预算
*Declarative Microkernel, On-Demand Lazy Channels & Live Payload Budgets*

1. **按需延迟通道优先**：新功能与重型交互能力优先设计为独立按需通道（`CHANNEL_REGISTRY` 注册的 16 条延迟/按需通道，含 Phase 3B 下沉的 `telemetry` / `effortSlider` / `workbenchEnhancer` / `contextMenu` 四条通道，或独立 Sidecar 服务），而非塞入主入口 Channel 1。
2. **开关关闭三零保障**：功能开关处于 `off` 时，必须保证 **0 编译开销、0 页面注入、0 运行期常驻内存**。
3. **核心入口与 16 通道独立字节预算（实测基线）**：
   - **Channel 1 全语种（`auto` + 9 语：`zh-CN`/`zh-TW`/`en`/`ja`/`ko`/`es`/`fr`/`de`/`tr`）**：硬上限 `< 390,000 B`（当前实测 `auto = 388,082 B`，9 语单包 `387,229–387,560 B`，含 `tr = 387,416 B`）；
   - **`pulse-vial-bridge.js`**：硬上限 `< 31,000 B`（当前实测 `30,998 B`）；
   - **增量 `configRefresh` 表达式**（不含语言包切换）：硬上限 `< 4,096 B`（当前实测 `3,911 B`）；
   - **16 条按需通道实测 / 预算对照**：`omni` `70,459 / 81,920 B`、`sidebar` `137,869 / 147,456 B`、`hostI18n` `553,455 B`（`tr` `288,314 B`）`/ 573,440 B`、`swarmI18n` `34,739 B`（`tr` `35,581 B`）`/ 49,152 B`、`thought` `152,359 / 163,840 B`、`inlineDiff` `54,438 / 57,344 B`、`wallpaper` `47,815 / 65,536 B`、`periodicPicker` `829,949 / 839,680 B`、`settings` `507,588 / 512,000 B`、`mascot` `124,909 / 131,072 B`、`suggester` `60,908 / 73,728 B`、`homeStudio` `57,220 / 57,344 B`、`telemetry` `116,886 / 131,072 B`、`effortSlider` `93,435 / 98,304 B`、`workbenchEnhancer` `50,878 / 57,344 B`、`contextMenu` `25,062 / 28,672 B`；
   - 任何涉及 Channel 1 的变更须保持字节中性或同步无损瘦身。

---

### 铁律 ⑤ · 显式有限状态机（FSM）与熔断收敛
*Explicit FSM & Content-Hash Idempotent Convergence*

1. **禁止裸布尔拼接死循环**：热自愈、通道生命周期、守护重连与 UI 挂载状态严禁通过散落布尔标志位相互触发导致振荡或死循环；须采用显式状态迁移（`src/daemon/session-fsm.mjs`）与重入护栏。
2. **内容指纹替代墙钟防抖**：通道热重载、样式同步与构建缓存一致性判定优先采用内容 `SHA-256` 指纹（如 `codeHash`、`cssHash`、`hostI18nCodeHash`），替代脆弱的墙钟定时器防抖。
3. **熔断与退避边界**：对外部进程探测、CDP 重连与自动更新设置显式退避、上限重试与 fail-closed 降级路径。

---

### 铁律 ⑥ · CSS、前端抗腐化与 300Hz 体验红线
*CSS Hygiene, Shadow DOM Isolation, Trusted-Types Safety & 300Hz Experience*

1. **主样式表 `style.css` 四大铁律**：
   - **0 `:has(`**：杜绝高开销结构伪类污染宿主高频 DOM 变更；
   - **100% 纯 ASCII**：防止编码差异或编码压缩污染；
   - **括号严格配平**（`{}` / `()` / `[]`）；
   - **规避 Chromium CSSOM 陷阱**：严禁在含 `var(...)` 的简写属性后再叠加同族长写覆写。
2. **CSS 变量命名空间棘轮**：严禁新增 `--_*` 或长度 `<= 4` 字符的短变量名（历史存量纳入棘轮白名单只减不增）；插件自建独立 UI 优先使用 Shadow DOM 与 `--ag-prism-*` 语义前缀隔离宿主样式。
3. **运行期 0 `innerHTML`**：运行期 JS 永久锁死 **0** `innerHTML` / `outerHTML` / `insertAdjacentHTML` 写入（免疫 Trusted Types 限制与 XSS），统一使用纯 DOM API（`createElement` / `createElementNS` / `textContent` / `replaceChildren`）。
4. **300Hz 体验与视觉质感红线**：严禁 C 类负优化（默认档低帧 `steps()` 破坏 GPU 合成动画、默认档砍核心浮层毛玻璃/滚动闪屏、默认档切窗冻死宿主运行圈、破坏代码块 `sticky` 的 `content-visibility: auto`），细则见 [`AGENTS.md`](../AGENTS.md)。

---

### 铁律 ⑦ · 防杀软、防风控与零隐私四防铁律
*AV Hygiene, Host Safety, Loopback Networking & Zero Privacy Leak*

1. **防杀软红线（全仓含 `vendor/`、`src/`、`installer/`、`scripts/`，永久锁死 0 债）**：
   - 永久禁绝隐藏 PowerShell（`-WindowStyle Hidden`、`-EncodedCommand`）、WMI 进程查询/拉起（`Win32_Process`、`Get-CimInstance`、`Get-WmiObject`）、`Add-Type` 动态 C# 编译、`WScript.Shell` COM 反射、`Get-NetTCPConnection`，以及任意非白名单内联 `node -e` 自删脚本。
2. **防宿主风控红线**：
   - **CDP Domain 永久白名单**：全仓只允许 `Page.*`、`Runtime.*`、`Target.*` 与 `Browser.close`（诊断探针 `scripts/probe-host-compat.mjs` 仅额外放行只读 `Performance.enable` / `Performance.getMetrics`）；严禁出现 `Network.*`、`Fetch.*`、`Debugger.*`、`Input.*`、`Emulation.*` 调用；
   - **宿主二进制与数据库物理绝缘**：严禁修改 `app.asar` 或宿主二进制；严禁打开宿主 `state.vscdb` 或向在线 `conversations/*.db` 传入 SQLite 打开句柄；严禁对 `Antigravity.exe` 或 `language_server` 执行跨进程 `EmptyWorkingSet`、非只读 `OpenProcess`、`taskkill`、`Stop-Process`、`SIGKILL`。
3. **本地 HTTP 与出网安全**：
   - 所有 `http.createServer` 必须严格绑定 `127.0.0.1`（或 `localhost` 回环地址），并校验 `Host` 与 `Origin` / `Sec-Fetch-Site`；
   - 所有外部出网模块统一经 `src/security/net-guard.mjs` 校验目标协议与主机防 SSRF，禁止向远端非本地明文 `http://` 外发 API Key 或凭据。
4. **零隐私与凭据安全**：
   - 日志、缓存与状态文件使用 `0o600` 最小权限落盘，敏感路径与密钥强制脱敏；绝不记录或上传用户提示词、私密路径或鉴权令牌；详见 [`.github/SECURITY.md`](./SECURITY.md) 与 `docs/CODE_SIGNING_POLICY.md` (LIGHT 2026-11-27: removed, Light ships no binaries)。

---

### 铁律 ⑧ · 原子升级与用户数据绝对隔离
*Atomic Upgrades & Strict User-Data Isolation*

1. **四阶段原子落盘**：安装器、热同步（`src/platform/repo-sync.cjs`）与 CLI 安装工具（`tools/install-plugin.cjs`）统一经由 `src/platform/install-manifest.cjs` 的 `applyManifestAtomicUpgrade` 执行同卷 `.staging-*` 落盘与 SHA-256 校验、`.rollback-*` 快照、退避重试原子替换与失败完整回滚，严禁裸 `copyFileSync` 直覆破坏用户现场。
2. **用户数据绝对保护与退役死文件自动清扫**：默认绝对保护 `config.json`、`custom.css`、`wallpapers/`、`backups/`、`repo-meta.json` 与本地对话归档红线目录；历史已退役旧文件统一登记在 `DEFAULT_OBSOLETE_PATHS`（`obsoletePaths`）中，升级时安全清扫且永不误伤现役文件与用户资产。

---

### 铁律 ⑨ · 9 语种一等公民与文案净洁
*9 First-Class Locales & Clean Terminology*

1. **统一 9 语种一等公民**：全仓 UI、词典与服务端文案统一收口至 **`zh-CN`、`zh-TW`、`en`、`ja`、`ko`、`es`、`fr`、`de`、`tr`** 9 个标准语种（含土耳其语 `tr` 一等覆盖）；非 CJK 语种（`en`、`ko`、`es`、`fr`、`de`、`tr`）严格 **0 汉字（CJK）泄漏**。
2. **0 新增 `yue` 独立分支**：严禁在词典表或 UI 选项中新增或保留 `yue` 独立列；仅在 `normalizeLanguage` / `normalizeGreetingLang` 等规范化入口保留将历史 `'yue'` / `'zh-yue'` 平滑映射为 `'zh-CN'` 的向后兼容逻辑。
3. **0 禁用词与版权归属**：所有面向用户的文案、文档、`CHANGELOG.md`、`src/` 与元数据严禁出现禁用项目外游戏术语；3D 元素周期表模块保留原设计来源与 GPL-3.0 协议归属说明。

---

### 铁律 ⑩ · 契约测试与渐进重构
*Contract Testing & Incremental Refactoring*

1. **禁止版本号碎片测试**：严禁新增 `v10x-*.test.mjs`、`w*-*.test.mjs` 或 `issueXX-*.test.mjs` 按版本号/批次/单号命名的碎片测试文件；新增回归用例统一按模块域组织或追加至对应域测试文件。
2. **所有文本文件编码统一**：受跟踪核心文本文件严格保持 **UTF-8 无 BOM + LF 换行**。
3. **双层必跑验收**：每次提交前必须依次通过秒级门禁、版本同步校验与全量并发测试：
   ```bash
   npm run test:gates
   npm run version:check
   node scripts/run-tests.mjs --all
   ```

---

## 核心目录结构总览 / Core Directory Layout

```text
obsidian-prism/
├── AGENTS.md                        # AI 代理现行实战合同（四态真交付 / 300Hz 红线 / 6 项交卷核验表）
├── .github/                         # ARCHITECTURE.md / CONTRIBUTING.md / SECURITY.md / CI Workflows
├── docs/                            # adr/ (ADR-001~006) / CODE_SIGNING_POLICY.md / CONTRIBUTORS.md / host-compat/
├── package.json / plugin.json       # 版本唯一真相源、零运行期依赖声明与插件清单
├── cdp.js / inject.js / remove.js   # 薄 Facade 与 CLI 注入/移除入口
├── style.css / ui-runtime.js / ...  # 根目录 25 个存量前端运行期模块（白名单冻结）
├── src/
│   ├── config/ & utils/             # L0 (.cjs)：schema.cjs / store.cjs / fs-safe.cjs
│   ├── cdp/ & compat/               # L1 (.cjs)：CDP 传输层与宿主 DOM 选择器收口表 host-selectors.cjs
│   ├── compiler/ & channels/        # L1 (.cjs)：LZSS/CSS/GLSL 编译器、分块缓存与唯一 CHANNEL_REGISTRY
│   ├── security/                    # L1 (.mjs)：net-guard.mjs (SSRF/回环防线) / win-picker.mjs
│   ├── runtime/                     # L1 (.js) ：浏览器按需辅助与 OffscreenCanvas ripple-worker / tr 语种包
│   ├── platform/                    # L2 (.cjs)：install-manifest.cjs (四阶段原子升级) / repo-sync.cjs / process-probe.cjs / win-lnk.cjs 等
│   └── daemon/                      # L3 (.mjs)：31 个显式组合守护子系统与 session-fsm.mjs 状态机
├── sidecars/daemon/                 # L3：原生 Sidecar 守护入口、归档器、更新器、脱敏规则与内存守卫
├── vendor/                          # 按需通道实现：host-i18n(含 tr)、omni-viewer、sidebar-studio、thought-translator、periodic-picker、wallpaper、pulse-dashboard、effort-slider、clawd-mascot、inline-diff、prompt-suggester
├── tools/install-plugin.cjs         # L4：CLI 安装/卸载工具（已接入原子升级引擎，旧 patch-asar.cjs 已彻底清除）
├── scripts/                         # L4：run-tests.mjs / bump-version.mjs / probe-host-compat.mjs / profile-live-perf.mjs / build-*.mjs / i18n/ / win/
├── installer/                       # L4：Windows C# 与 macOS Swift 原生安装器 / Watcher
├── workbench/                       # L4：本地交互式调试与预览工作台
└── test/                            # L4：test/gates/ (6 套 28 项宪法门禁) + 跨域单元与集成回归测试
```

---

## 自动化适应度门禁总览 / Automated Fitness Gates (`test/gates/` — 6 Suites / 28 Checks)

| 门禁文件 | 守护铁律 | 核心校验内容 |
| --- | --- | --- |
| [`repo-hygiene.test.mjs`](../test/gates/repo-hygiene.test.mjs) | ② ⑩ | 目录规范、根目录白名单棘轮、`AGENTS.md`/宪法/ADR 相对链接有效、测试命名棘轮 |
| [`architecture-fitness.test.mjs`](../test/gates/architecture-fitness.test.mjs) | ① ② ⑥ | 0 外部依赖、0 循环依赖（含 Worker 边）、`L0→L4` 与 `src/` 四级内部单向分层、`src/` 扩展名统一与 Node 22.0 CJS 兼容、文件行数/体积棘轮、CSS 变量/卫生棘轮、运行期 0 `innerHTML`、0 原型 Mixin、唯一通道 SSOT、`config.example.json` 100% 对齐 `schema.cjs` |
| [`bundle-budget.test.mjs`](../test/gates/bundle-budget.test.mjs) | ④ ⑩ | Ch1 (`auto` + 9 语) `< 390,000 B`（实测 `387,229–388,082 B`）、16 条延迟通道分通道预算（含 `tr` 语种包）与关闭态 0 B、`pulse-vial-bridge.js < 31,000 B`、`configRefresh < 4,096 B`、全仓 0 BOM / 0 CRLF |
| [`security-redteam.test.mjs`](../test/gates/security-redteam.test.mjs) | ⑦ | 全仓严苛 CDP Domain 白名单（仅 `Page.*`/`Runtime.*`/`Target.*`/`Browser.close`，探针仅放行只读 `Performance`）、宿主 `.db` 物理绝缘、全仓 AV 红线 0 债（含变量名无关 `-e` 防护）、本地 HTTP 强制 `127.0.0.1` 绑定、PE 元数据与 SignPath 双步钩子 |
| [`i18n-and-version-sync.test.mjs`](../test/gates/i18n-and-version-sync.test.mjs) | ③ ⑨ | 9 语种（`+tr`）完整度 + 非 CJK 0 汉字 + 0 `yue` 独立词典、0 禁用词（覆盖文档/UI 运行时/全量 `src/`）、`bump-version.mjs` 全部 18 处静态版本锚点与 `CHANGELOG.md` 卫生校验 |
| [`performance-fitness.test.mjs`](../test/gates/performance-fitness.test.mjs) | ⑥ | 首页/对话 WebGL2 原地 resize 与 0fps 休眠、`ripple-worker` 1×1 探针缓存与零泄漏释放、`vial-core` 零 `drawImage`、`crystal-prism-core` MSAA/DPR 上限、R2 V8 IC / 0 `preserveDrawingBuffer` / 暗色 CSS 与 stub 预算硬红线 |

---

## 版本升级与协作索引 / Version Bump & Governance Index

```bash
# 1. 校验当前所有静态版本锚点与 package.json#version 一致，以及 CHANGELOG 格式
npm run version:check

# 2. 发版时一键同步全部静态版本锚点（package.json / plugin.json / CITATION.cff / app.manifest / C# / Swift / 前端兜底常量等）
node scripts/bump-version.mjs <newVersion>
```

- AI 代理实战开发合同：[`AGENTS.md`](../AGENTS.md)
- 架构决策记录（ADR）：[`docs/adr/README.md`](../docs/adr/README.md)
- 宿主兼容性矩阵：[`docs/host-compat/matrix.md`](../docs/host-compat/matrix.md)
- 贡献指南与测试规范：[`.github/CONTRIBUTING.md`](./CONTRIBUTING.md)
- 安全策略与四防边界：[`.github/SECURITY.md`](./SECURITY.md)
- 代码签名与发布合规：`docs/CODE_SIGNING_POLICY.md` (LIGHT 2026-11-27: removed, Light ships no binaries)
