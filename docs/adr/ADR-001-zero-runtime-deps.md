# ADR-001: 零运行期外部依赖与 Node >= 22.0 CJS/ESM 分层纪律

- **状态 / Status**: Accepted (Immutable)
- **守护铁律**: [`.github/ARCHITECTURE.md`](../../.github/ARCHITECTURE.md) 铁律 ① · **门禁**: [`architecture-fitness.test.mjs`](../../test/gates/architecture-fitness.test.mjs)

## 背景 / Context
插件以独立脚本与原生安装器载荷形态在用户本机运行，若引入第三方 `node_modules` 将立即引爆离线安装失败、供应链投毒与 C#/Swift 打包体积失控；同时 Node `22.0–22.11` 尚未默认开启 `require(esm)`，`.cjs` 同步 `require('*.mjs')` 会直接抛出 `ERR_REQUIRE_ESM`。

## 决策 / Decision
1. `package.json#dependencies` 永久锁定 **0 运行期外部包**，Node 侧仅允许 `node:*` / `fetch` / `WebSocket` / `node:sqlite` / `node:test`，浏览器侧仅用原生 Web API；
2. 维持 `L0 → L4` 与 `src/` 四级单向无环 DAG（`L0 config/utils → L1 cdp/compat/compiler/channels/security → L2 platform → L3 daemon`）；
3. `src/{utils,config,cdp,compat,compiler,channels,platform}/` 统一 `.cjs`，`src/{daemon,security}/` 统一 `.mjs`，严禁同目录混用扩展名及 `.cjs` 同步 `require('*.mjs')`。

## 为什么绝不能改回去 / Why Never Revert
一旦退回外部 npm 依赖或跨层反向导入，绿色免构建分发、零安装冷启动与 Node `22.0–24.x` 全版本兼容将同时瓦解。
