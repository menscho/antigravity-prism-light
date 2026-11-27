# ADR-006: 运行期 0 innerHTML、CSSOM 卫生与桥接观测隔离

- **状态 / Status**: Accepted (Immutable)
- **守护铁律**: [`.github/ARCHITECTURE.md`](../../.github/ARCHITECTURE.md) 铁律 ⑥ · **门禁**: [`architecture-fitness.test.mjs`](../../test/gates/architecture-fitness.test.mjs)

## 背景 / Context
Electron/Chromium 启用 Trusted Types 后任何 `innerHTML` 写入都会抛错并引入 XSS 风险；`style.css` 中 `:has(` 触发大范围重排、非 ASCII 编码污染导致编译错位、含 `var()` 简写后再叠写同族长写触发 Chromium CSSOM 解析丢失；且 `pulse-vial-bridge.js` 若监听宿主自身 `style` 属性变化，写入 `--pv-*` 变量会引发自激微任务死锁。

## 决策 / Decision
1. 运行期 JS 永久锁定 **0 `innerHTML` / `outerHTML` / `insertAdjacentHTML`**（统一使用 `createElement` / `textContent` / `replaceChildren`）；
2. `style.css` 严守 **0 `:has(`、100% ASCII、括号配平**，禁止在含 `var()` 简写后叠写同族长写，禁止新增 `--_*` 或 `<= 4` 字符短变量（自建 UI 用 Shadow DOM 与 `--ag-prism-*`）；
3. [`pulse-vial-bridge.js`](../../pulse-vial-bridge.js) 的 `MutationObserver` 对宿主节点仅监听精确白名单属性（`attributeFilter` 绝不包含 `'style'`）。

## 为什么绝不能改回去 / Why Never Revert
违反任一项都会在特定宿主主题或 Trusted Types 策略下造成 UI 静默崩溃、样式表失效或主线程 100% 微任务假死。
