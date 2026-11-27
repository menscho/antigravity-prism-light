# 架构决策记录索引 / Architecture Decision Records (ADR)

本目录沉淀 **Obsidian Prism** 的核心不可回退工程决策（*Why this must never be reverted*），每张卡片浓缩历史踩坑背景、决策铁律、拒绝修改红线与自动化门禁守护位置。
日常变更须同步遵守根目录契约 [`AGENTS.md`](../../AGENTS.md) 与最高宪法 [`.github/ARCHITECTURE.md`](../../.github/ARCHITECTURE.md)。

| 编号 | 决策主题 | 守护铁律与核心门禁 |
| --- | --- | --- |
| [ADR-001](./ADR-001-zero-runtime-deps.md) | 零运行期外部依赖与 Node >= 22.0 CJS/ESM 分层纪律 | 铁律 ① · [`architecture-fitness.test.mjs`](../../test/gates/architecture-fitness.test.mjs) |
| [ADR-002](./ADR-002-host-safety-and-cdp-allowlist.md) | 宿主物理绝缘与 CDP 严格白名单 | 铁律 ⑦ · [`security-redteam.test.mjs`](../../test/gates/security-redteam.test.mjs) |
| [ADR-003](./ADR-003-anti-av-and-two-step-signing.md) | 防杀软红线、原生 `FilePicker.cs` 与 SignPath 双步签名 | 铁律 ⑦ · [`security-redteam.test.mjs`](../../test/gates/security-redteam.test.mjs) |
| [ADR-004](./ADR-004-ch1-budget-and-single-channel-registry.md) | Ch1 `< 390 KB` 预算与唯一 `CHANNEL_REGISTRY` | 铁律 ③ ④ · [`bundle-budget.test.mjs`](../../test/gates/bundle-budget.test.mjs) |
| [ADR-005](./ADR-005-explicit-fsm-and-composition.md) | 显式组合子系统、FSM 熔断与 SHA-256 内容指纹 | 铁律 ⑤ · [`architecture-fitness.test.mjs`](../../test/gates/architecture-fitness.test.mjs) |
| [ADR-006](./ADR-006-zero-innerhtml-and-cssom-hygiene.md) | 运行期 0 `innerHTML`、CSSOM 卫生与桥接观测隔离 | 铁律 ⑥ · [`architecture-fitness.test.mjs`](../../test/gates/architecture-fitness.test.mjs) |

## 新增 ADR 流程

1. 仅当确需新增/变更长期架构约束，或经人类维护者显式批准调整 `test/gates/*` 门禁时，按 `ADR-NNN-<slug>.md` 新增卡片（保持 15–25 行极简风格）。
2. 新建后同步更新本索引表及 [`test/gates/repo-hygiene.test.mjs`](../../test/gates/repo-hygiene.test.mjs) 的链接与存在性校验。
