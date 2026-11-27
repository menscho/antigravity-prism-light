# ADR-004: Ch1 严格预算与唯一通道注册表 (CHANNEL_REGISTRY)

- **状态 / Status**: Accepted (Immutable)
- **守护铁律**: [`.github/ARCHITECTURE.md`](../../.github/ARCHITECTURE.md) 铁律 ③ ④ · **门禁**: [`bundle-budget.test.mjs`](../../test/gates/bundle-budget.test.mjs)

## 背景 / Context
早期将重型交互模块塞入首屏注入包（Ch1），导致 CDP 负载逼近 550 KB 引发首帧卡顿与常驻内存飙升；同时守护进程、`inject.js`、C# 与 Swift 各自维护平行通道表（`RUNTIME_CHANNEL_SPECS` 等），极易漏更导致热重载失效或开关关不干净。

## 决策 / Decision
1. Ch1 全语种（`auto` + 8 语）编译产物永久锁死 `< 390,000 B`（实测 `~343 KB`），`pulse-vial-bridge.js < 31,000 B`，增量 `configRefresh < 4,096 B`；
2. 全仓 16 条通道统一收口至唯一真相源 [`src/channels/registry.cjs`](../../src/channels/registry.cjs)（`CHANNEL_REGISTRY`），缓存、探针与预算报表全部由其派生；
3. C#（`RuntimeChannels.cs` (removed in the safe build)）与 Swift（`RuntimeChannels.swift` (removed in the safe build)）仅按 `config.json` 消费预编译 `runtime-channels/*.js`，禁止字符串拼接。

## 为什么绝不能改回去 / Why Never Revert
平行通道表必然引发配置漂移与幽灵注入，放任 Ch1 膨胀则会直接拖垮宿主首屏渲染与 CDP 传输延迟。
