# Antigravity 宿主版本兼容矩阵与 10 分钟高频追更手册

> 对应架构基建：[src/compat/host-selectors.cjs](../../src/compat/host-selectors.cjs) · [scripts/probe-host-compat.mjs](../../scripts/probe-host-compat.mjs) · [test/host-compat-probe.test.mjs](../../test/host-compat-probe.test.mjs)

本手册用于支撑 **Obsidian Prism** 在 Antigravity 宿主高频迭代期间的 **10 分钟极速排障与兼容追更**，同时通过弹性选择器契约与“跨越 2 个次版本回收旧补丁”制度，防止临时热修补丁不断堆积演变为历史债。

---

## 1. 宿主版本 DOM / CSS / RPC 已知变更台账

| Antigravity 版本 | 关键变更点 | 受影响契约 ID | 受影响 Prism 模块 | 适配策略与回收基线 |
| --- | --- | --- | --- | --- |
| **v2.33.x** | 确立 Standalone 主外壳 `.agy-shell`、分屏侧栏 `[data-testid="sidebar-split"]`、对话流 `[data-testid="conversation-view"]` 与输入框 `[data-testid="agent-input-box"]` 基础契约。 | `sidebarSplit`, `modelSelectorTrigger`, `modelSelectorPanel`, `composerFooter`, `composerEditor`, `conversationView`, `chatBackdropChain`, `mainContentBody` | `style.css`, `ui-runtime.js`, `smooth-caret.js`, `conv-aura.js` | 作为长期基线契约保留在 `primary` 层。 |
| **v2.34.x** | 引入 Radix Portal 悬浮卡片 (`[data-radix-popper-content-wrapper]`)、右侧辅助/概览宿主面板 (`overview-panel-host` / `aux-pane-split`)、自动滚动视口 (`autoscroll-viewport`) 与计划步骤卡片 (`step-plan`)；收紧主背景透明链层级。 | `hoverCardPortal`, `autoscrollViewport`, `overviewPanelHost`, `stepPlan`, `chatBackdropChain` | `style.css`, `ui-runtime.js`, `host-workbench-enhancer.js`, `vendor/omni-viewer/omni-client.js`, `vendor/thought-translator/thought-client.js` | 在 `primary` 补齐新 `data-testid`，保留 `.agy-*` 语义类在 `fallback`；预计在 **v2.36.x** 回收旧 v2.33 兼容分支。 |
| **v2.35.x** | 升级推理档位（Effort）触发控件与模型锁定状态选择器；新增侧边追问 `/btw` 原生入口 (`side-question-button`)；独立 Swarm Sidecar 窗口与主题同步属性 (`data-ag-prism-mode`) 联动增强。 | `modelSelectorTrigger`, `composerFooter`, `sideQuestionButton`, `chatBackdropChain` | `vendor/effort-slider/slider-coexist.js`, `context-menu-btw.js`, `vendor/host-i18n/swarm-i18n-runtime.js`, `style.css` | 统一通过 `host-selectors.cjs` 声明，避免在多模块硬编码脆弱 Tailwind 类名；预计在 **v2.37.x** 回收旧 v2.34 临时兜底。 |

---

## 2. 集中式弹性选择器契约矩阵（13 条核心契约）

所有关键宿主 DOM 锚点统一登记在 `src/compat/host-selectors.cjs`，采用 **三层降级防御模型**：

1. **`primary`（稳定契约层）**：优先绑定 `data-testid` / `role` / 语义 `data-*` 属性；命中记为 `OK`。
2. **`fallback`（语义类降级层）**：宿主重构 `data-testid` 时临时承接（如 `.agy-*` / `aria-label`）；命中记为 `FALLBACK_ONLY`，提示需在下个迭代更新主选择器。
3. **`structural`（易碎结构兜底，`fragile: true`）**：仅作紧急定位信号（如 Tailwind 工具类或直系子元素结构）；命中同样触发 `FALLBACK_ONLY [FRAGILE]` 告警。

| 契约 ID | 级别 (`tier`) | 作用域 (`scope`) | 起始宿主版本 | 主要受影响模块 |
| --- | --- | --- | --- | --- |
| `sidebarSplit` | `critical` | `shell` | `2.33.0` | `style.css`, `ui-runtime.js`, `host-workbench-enhancer.js` |
| `chatBackdropChain` | `critical` | `shell` | `2.33.0` | `style.css`, `ui-runtime.js`, `home-ripple-host.js`, `conv-aura.js` |
| `mainContentBody` | `critical` | `shell` | `2.33.0` | `style.css`, `ui-runtime.js`, `home-studio-panel.js`, `host-workbench-enhancer.js` |
| `conversationView` | `critical` | `conversation` | `2.33.0` | `style.css`, `ui-runtime.js`, `stream-choreography.js`, `conv-aura.js`, `context-menu-btw.js` |
| `composerEditor` | `critical` | `conversation` | `2.33.0` | `style.css`, `ui-runtime.js`, `smooth-caret.js`, `vendor/prompt-suggester/suggester-client.js` |
| `modelSelectorTrigger` | `critical` | `conversation` | `2.33.0` | `ui-runtime.js`, `vendor/periodic-picker/periodic-picker.js`, `vendor/effort-slider/slider-coexist.js` |
| `overviewPanelHost` | `major` | `shell` | `2.34.0` | `style.css`, `ui-runtime.js`, `vendor/omni-viewer/omni-client.js` |
| `composerFooter` | `major` | `conversation` | `2.33.0` | `style.css`, `ui-runtime.js`, `vendor/effort-slider/slider-coexist.js` |
| `autoscrollViewport` | `major` | `conversation` | `2.34.0` | `style.css`, `ui-runtime.js`, `host-workbench-enhancer.js` |
| `modelSelectorPanel` | `optional` | `overlay` | `2.33.0` | `style.css`, `ui-runtime.js`, `vendor/periodic-picker/periodic-picker.js` |
| `hoverCardPortal` | `optional` | `overlay` | `2.34.0` | `style.css`, `ui-runtime.js` |
| `stepPlan` | `optional` | `overlay` | `2.34.0` | `style.css`, `ui-runtime.js`, `vendor/thought-translator/thought-client.js` |
| `sideQuestionButton` | `optional` | `overlay` | `2.35.0` | `context-menu-btw.js`, `ui-runtime.js` |

---

## 3. 10 分钟高频追更标准作业流程（SOP）

当 Antigravity 发布新版本并疑似破坏样式或交互时，按以下 4 步在 10 分钟内闭环定位：

1. **第 0~2 分钟 · 一键只读体检**
   - 本机已运行 Antigravity（并已开启 `--remote-debugging-port`）时：
     ```bash
     npm run compat:probe -- --live
     ```
   - 仅有离线 DOM 快照或本地仿真页时：
     ```bash
     npm run compat:probe -- --snapshot workbench/replica.html
     ```
   - 探针仅执行只读 `querySelectorAll` 与 `getBoundingClientRect`，**零点击、零 DOM 写入、零副作用**。
2. **第 2~5 分钟 · 判读状态与精准定位模块**
   - `OK`：全部关键主锚点命中；若视觉异常则直接查 CSS 变量或动画层。
   - `FALLBACK_ONLY`：关键/主要契约已退化到 `fallback` 或 `[FRAGILE]` 层，按报告中的 `affectedModules` 锁定受影响通道。
   - `BROKEN_CRITICAL`（退出码 `2`）：核心契约彻底失联，立即导出 `--json` 定位断裂 ID 并检查宿主新 DOM。
3. **第 5~8 分钟 · 集中更新与回归锁死**
   - 先更新 `src/compat/host-selectors.cjs` 中对应契约的 `primary` / `sinceHostVersion`，再更新对应受影响通道与 `style.css`。
   - 同步补记本台账第 1 节，并在 `test/host-compat-probe.test.mjs` 增补回归用例。
4. **第 8~10 分钟 · 全量门禁验绿**
   - 运行 `npm run test:gates` 与 `node --test test/host-compat-probe.test.mjs` 确认 0 回归。

---

## 4. 补丁回收规约（“跨越 2 个次版本回收旧补丁”）

为防止宿主兼容补丁无限膨胀、避免 `style.css` 与运行期模块变成历史兼容补丁堆场，全仓统一执行 **N-2 回收纪律**：

- **版本标注**：任何针对特定宿主版本新增的选择器降级分支或 CSS/JS 兜底，必须在 `src/compat/host-selectors.cjs`（`sinceHostVersion`）和本文档第 1 节台账中显式标注起始次版本（如 `v2.34`）。
- **回收触发条件**：当 Antigravity 稳定版推进至 **`v2.(X + 2).0`**（例如到达 `v2.36.0` 时回收 `v2.34` 之前的临时旧补丁，保留 `v2.35` 与 `v2.36` 两个相邻次版本兼容窗口）时，必须在对应版本的维护窗口中：
  1. 将旧版本专属且无活跃用户的 `fallback` / `structural` 补丁标记删除；
  2. 同步清理对应在 `style.css` / 通道代码中的过期分支；
  3. 更新本文档台账并重跑 `npm run compat:probe` 与 `npm run test:gates` 确认预算回落。
- **例外审批**：仅当官方 LTS/企业渠道明确滞后超过 2 个次版本时，方可在本台账注明延期理由与下一次复核版本。
