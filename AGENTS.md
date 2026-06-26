# AGENTS.md

> 嘴替（codename: Mira）—— 你负责想，它负责嘴。
> 本文件是**目录索引**，不是百科全书。按需深入下方链接，不要一次性全读。

## 这是什么

嘴替是一个真·常驻桌面助手（Electron）：托盘常驻 + 一句"Jarvis"唤醒 + 侧贴浮窗。
召唤即截屏看懂上下文 → 你语音说真心话 → 它给你几条能直接发的神回复，一键复制，可切风格。
TRAE AI 创造力大赛参赛作品，主赛道：生活娱乐。

## 工程红线（先读这个）

> Plan 8 后底座为 pi（`@earendil-works/pi-*`）：单 session + Agent Skills 渐进式披露 + 通用输出层。下面三条是 pi 链路的硬前提，详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

1. **MiMo 必须关 thinking**（`enable_thinking:false`，见 `src/core/mira-model.ts`）——挂工具时开 thinking 首字 21-32s；关掉 <1s 且"先文本流式 → 后 `emit_result`"顺序正确。这是 emit-tool 协议的硬前提，别开回去。
2. **session 必须用 `tools:['read','emit_result']` 白名单保留 `read`**——pi 的渐进式披露靠内建 `read` 加载 `SKILL.md`；用 `noTools` 禁掉 read 会让 pi 不注入 `<available_skills>`，skill 系统**静默失效**。
3. **结构化输出走 `emit_result` 工具**（不用 SDK json_schema，MiMo 不支持）；主体 `primary` 走文本流式累积（蹦字 + 首句 TTS）。
4. **对线红线**：只做机智、有理有据的回怼——严禁人身攻击、脏话、歧视、教唆网暴；不确定一律走得体稳妥。
5. **基调**：有趣、有梗、接地气、有网感，但一切服务于"能真的发出去"，不为搞笑牺牲得体。
6. **分层依赖只向前**：core↛modules↛main↛renderer；renderer 只经 `window.zuiti` 访问 Node。机械强制见 [src/test/architecture.test.ts](./src/test/architecture.test.ts)。
7. **`npm test` / `npm run typecheck` 始终绿色**——注意 `npm test` 只编译 `tsconfig.json`（不含 `src/renderer/`），渲染层类型错误只有 `npm run typecheck` 才抓得到，提交前两个都要跑。改代码前先读 [ARCHITECTURE.md](./ARCHITECTURE.md)。

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
| 创意展示页 | [showcase/index.html](./showcase/index.html) |
| 计划总览 | [docs/PLANS.md](./docs/PLANS.md) |
| 产品 sense | [docs/PRODUCT_SENSE.md](./docs/PRODUCT_SENSE.md) |
| 质量评分 | [docs/QUALITY_SCORE.md](./docs/QUALITY_SCORE.md) |

## 怎么在这里工作

- **改代码前先读 [ARCHITECTURE.md](./ARCHITECTURE.md)**，理解分层与依赖方向。
- **执行计划是 first-class artifact**：复杂工作写进 `docs/exec-plans/active/`，完成后移到 `completed/`；小改动用临时轻量计划即可。
- **测试驱动**：先写失败测试 → 跑确认失败 → 改实现 → 跑确认通过 → 提交。测试经 `npm test`（先 `build:node` 编译到 `dist/`，再 `node --test "dist/test/*.test.js"`）。
- **类型检查**：`npm run typecheck` 必须绿色。
- **提交粒度**：一个 Task 一个 commit。
- **commit message 用英文**，遵循 Conventional Commits：`feat(scope):` / `fix(scope):` / `docs(scope):` / `refactor(scope):` / `chore(scope):` / `test(scope):` 前缀 + 英文祈使句描述（如 `fix(renderer): rename $result to $output`）。subject 简洁、聚焦"做了什么"。代码、标识符、PR/issue 文本同样用英文；与我对话仍可用中文。
- **文档即代码**：决策、架构、计划都 checked into repo；Slack/口头讨论的结论要落库，否则对 agent 不存在。

## 技术栈

TypeScript (ESM) · Node ≥ 22 · Electron 42 · `@earendil-works/pi-coding-agent` + `pi-ai`（0.80.2，**pin 版本**；agent 底座，Plan 8 替换 `@openai/agents`）· TypeBox（经 pi-ai 的 `Type`，`emit_result` schema）· dotenv · node:test
渲染层唤醒词：`onnxruntime-web` + `@picovoice/web-voice-processor`（本地离线 openWakeWord，Plan 4 引入）。
构建：`esbuild` 打包渲染层（Plan 4 引入，解决 ONNX/wasm 资源拷贝）。
> pi 是 0.x，无 API 稳定性保证，**锁版本**；升级前跑 `scripts/pi-spike.mjs` 回归。新依赖需经 Plan 评审后引入，并在 [docs/exec-plans/tech-debt-tracker.md](./docs/exec-plans/tech-debt-tracker.md) 登记。

## Provider 配置

LLM 走小米 MiMo（OpenAI 兼容），经 pi 的 `ModelRegistry.inMemory(authStorage).registerProvider('mimo', …)` 注册（**关 thinking**，见 `src/core/mira-model.ts`）。key 在 `.env`：`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`（=mimo-v2.5-pro）。
`ASR_API_KEY` / `TTS_API_KEY` 供语音 harness（ASR/TTS，`src/core/voice.ts`）。详见 [src/core/provider.ts](./src/core/provider.ts) 与 [.env.example](./.env.example)。
