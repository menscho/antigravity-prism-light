# ADR-005: 显式组合子系统、FSM 熔断与 SHA-256 内容指纹

- **状态 / Status**: Accepted (Immutable)
- **守护铁律**: [`.github/ARCHITECTURE.md`](../../.github/ARCHITECTURE.md) 铁律 ⑤ · **门禁**: [`architecture-fitness.test.mjs`](../../test/gates/architecture-fitness.test.mjs)

## 背景 / Context
旧守护进程使用 `Object.assign(PrismDaemon.prototype, ...)` 将数千行状态混入单一上帝对象，耦合隐晦且极难隔离测试；自愈循环依赖散落布尔位与 650ms 墙钟防抖，在 DOM 延迟挂载或通道异常时易产生高频震荡、重入竞态与假健康判定。

## 决策 / Decision
1. 彻底废除 `src/` 内一切 `Object.assign(*.prototype, ...)` 原型混入，改由 [`SessionRegistry`](../../src/daemon/session-registry.mjs)、[`ChannelOrchestrator`](../../src/daemon/channel-orchestrator.mjs)、[`TelemetrySubsystem`](../../src/daemon/telemetry-subsystem.mjs) 与 [`UpdateStorageSubsystem`](../../src/daemon/update-storage-subsystem.mjs) 显式组合；
2. 会话与通道生命周期由 [`src/daemon/session-fsm.mjs`](../../src/daemon/session-fsm.mjs) 显式 FSM 驱动（`AWAITING_DOM` 上限 3 次、单通道连续失败 3 次触发 `30s–300s` 指数冷却熔断）；
3. 热重载与样式一致性采用 `SHA-256` 内容指纹（`codeHash` / `cssHash`）替代脆弱的墙钟防抖。

## 为什么绝不能改回去 / Why Never Revert
隐式原型混入与墙钟防抖在多窗口并发场景下必然复现自愈震荡与状态撕裂，显式 FSM + 内容哈希是唯一可验证的幂等收敛方案。
