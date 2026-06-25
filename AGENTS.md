# AGENTS.md

> 嘴替（codename: Mira）—— 你负责想，它负责嘴。
> 本文件是**目录索引**，不是百科全书。按需深入下方链接，不要一次性全读。

## 这是什么

嘴替是一个真·常驻桌面助手（Electron）：托盘常驻 + 一句"Jarvis"唤醒 + 侧贴浮窗。
召唤即截屏看懂上下文 → 你语音说真心话 → 它给你几条能直接发的神回复，一键复制，可切风格。
TRAE AI 创造力大赛参赛作品，主赛道：生活娱乐。

## 工程红线（先读这个）

1. **`reply` 必须始终是模型输出 JSON 的第一个键**——流式蹦字与首句 TTS 靠它。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
2. **LLM 不用 SDK 的 `outputType`**（MiMo 不支持严格 json_schema）；JSON 经 `modelSettings.providerData` 的 `json_object` 产出，由上层 zod 校验。不要改这套机制。
3. **对线红线**：只做机智、有理有据的回怼——严禁人身攻击、脏话、歧视、教唆网暴；不确定一律走得体稳妥。
4. **基调**：有趣、有梗、接地气、有网感，但一切服务于"能真的发出去"，不为搞笑牺牲得体。
5. **加法式改造**：保留现有符号名（`CoachOutput` / `EnglishCoach` / `parseCoachOutput` / 目录 `src/modules/english/`），改名留到 Plan 2。
6. **不修改渲染层 (`src/renderer/*`) 与 harness**，确保 `npm test` / `npm run typecheck` 始终绿色。

## 知识库地图（system of record）

| 想了解 | 去这里 |
|--------|--------|
| 产品定位 / 创意 / 痛点 / Hero 场景 | [docs/design-docs/2026-06-24-zuiti-design.md](./docs/design-docs/2026-06-24-zuiti-design.md) |
| Agent-first 工程原则 | [docs/design-docs/core-beliefs.md](./docs/design-docs/core-beliefs.md) |
| 设计文档目录 | [docs/design-docs/index.md](./docs/design-docs/index.md) |
| 当前执行计划 | [docs/exec-plans/active/](./docs/exec-plans/active/) |
| 技术债追踪 | [docs/exec-plans/tech-debt-tracker.md](./docs/exec-plans/tech-debt-tracker.md) |
| 产品规格 | [docs/product-specs/index.md](./docs/product-specs/index.md) |
| 参考资料索引 | [docs/references/](./docs/references/) |
| 参赛交付物 | [docs/competition/](./docs/competition/) |
| 创意展示页 | [docs/showcase/zuiti.html](./docs/showcase/zuiti.html) |
| 计划总览 | [docs/PLANS.md](./docs/PLANS.md) |
| 产品 sense | [docs/PRODUCT_SENSE.md](./docs/PRODUCT_SENSE.md) |
| 质量评分 | [docs/QUALITY_SCORE.md](./docs/QUALITY_SCORE.md) |

## 怎么在这里工作

- **改代码前先读 [ARCHITECTURE.md](./ARCHITECTURE.md)**，理解分层与依赖方向。
- **执行计划是 first-class artifact**：复杂工作写进 `docs/exec-plans/active/`，完成后移到 `completed/`；小改动用临时轻量计划即可。
- **测试驱动**：先写失败测试 → 跑确认失败 → 改实现 → 跑确认通过 → 提交。测试经 `npm test`（先 `build:node` 编译到 `dist/`，再 `node --test "dist/test/*.test.js"`）。
- **类型检查**：`npm run typecheck` 必须绿色。
- **提交粒度**：一个 Task 一个 commit，commit message 用 `feat(scope):` / `fix(scope):` 前缀。
- **文档即代码**：决策、架构、计划都 checked into repo；Slack/口头讨论的结论要落库，否则对 agent 不存在。

## 技术栈

TypeScript (ESM) · Node ≥ 22 · Electron 42 · `@openai/agents`（非已弃用的 openai-agents-js）· zod v4 · dotenv · node:test
不引入新依赖。

## Provider 配置

LLM 走小米 MiMo（OpenAI 兼容），key 在 `.env`：`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`（=mimo-v2.5-pro）。
`ASR_API_KEY` / `TTS_API_KEY` 留给 Plan 3 语音 harness。详见 [src/core/provider.ts](./src/core/provider.ts) 与 [.env.example](./.env.example)。
