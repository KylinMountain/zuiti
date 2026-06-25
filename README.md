# 嘴替 · 你负责想，它负责嘴

> 真·常驻桌面助手：喊一声「Jarvis」→ 自动看屏 → 你语音说真心话 → 它给你几条能直接发的神回复，一键复制。
> TRAE AI 创造力大赛参赛作品 · 主赛道：生活娱乐

暧昧对象发来"在吗"，你盯着屏幕憋三分钟，最后回了个"在"。
评论区想怼回去，当场大脑空白，洗完澡才想出王炸级回击。
跟领导请个假，草稿改八遍，发出去还是觉得自己在跪。
老外同事 @ 你，英文挤半天，一股扑面而来的机翻味。

**你不是没话说，是那句最好的话永远卡在嘴边。**

嘴替把这个"卡在嘴边"变成"当场显灵"——不切窗口、不复制粘贴、不打字、不解释背景，喊一声 + 说句话就出结果。

---

## 核心特性

- **托盘常驻 + 侧贴浮窗**：召唤即用，用完即隐，不打断你正在做的事。
- **三种唤醒方式**：托盘点击 / 全局快捷键 / 语音「Jarvis」。
- **本地离线唤醒词**：基于 [openWakeWord](https://github.com/dscripka/openWakeWord) 的 ONNX 推理，**完全本地、离线、零 API Key、不持续传云端**——隐私向技术亮点。
- **自动看屏懂上下文**：召唤时截屏一次，喂给多模态 LLM，它知道你在跟谁聊、聊到哪、什么气氛。**不做持续监视主动弹窗。**
- **语音说真心话**：ASR 转写你的口语化输入（带情绪、中文、甚至脏话都行）。
- **流式蹦字 + 首句先播 TTS**：`reply` 是 JSON 第一键（架构不变量），保证流式输出与首句 TTS 秒出。
- **多风格备选**：推荐一条 + 2-3 条带风格标签的备选（更撩 / 更刚 / 更稳 / 更专业 / 英文），一键复制。
- **VAD 自动停止录音**：纯 TS RMS 能量检测，说完自动停，不用手按。
- **Skill 扩展底座**：今天替你撩 / 怂 / 跟老板说话；明天能写小红书文案、跟客服 battle、解读阴阳怪气。

## 隐私设计

- **唤醒判断只在本地**：openWakeWord 跑在浏览器 WASM，不联网、不上云、无需 API Key。
- **不持续监听**：只在唤醒词命中后才触发录音与识别。
- **不持续监视屏幕**：只在被唤醒时看一次屏。
- **对线红线**：只做机智、有理有据的回怼——严禁人身攻击、脏话、歧视、教唆网暴。

## 技术栈

TypeScript (ESM) · Node ≥ 22 · Electron 42 · `@openai/agents` · zod v4 · onnxruntime-web · @picovoice/web-voice-processor · esbuild

LLM 走小米 MiMo（OpenAI 兼容端点）。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 快速开始

```bash
# 1. 装依赖
npm ci

# 2. 配 .env（LLM/ASR/TTS key）
cp .env.example .env
# 填入 MiMo Token Plan 的 key（tp-xxxxx）

# 3. 下载 openWakeWord 模型（约 10MB，首次运行）
npm run fetch-models

# 4. 启动
npm start
```

唤醒词默认关闭。在 `.env` 或启动 env 里设 `WAKE_THRESHOLD=0.5` 开启，`WAKE_DEBUG=1` 打调试日志。

## 开发

```bash
npm run typecheck   # 双 tsconfig 类型检查（主进程 + 渲染层）
npm test            # 编译 + node:test（45 测试，含架构 lint）
npm run build       # 编译主进程 + esbuild 打包渲染层
npm run dev         # build + electron（带日志）
```

CI：push / PR 到 main 时自动跑 typecheck + test（`.github/workflows/ci.yml`）。

## 架构

分层依赖只向前：`Types → Config → Core → Modules → Main → Renderer`。

```
src/
├── core/              # harness 底座（provider/voice/screenshot/streamparse/skill/log）
├── modules/reply/     # 嘴替 skill（ReplyCoach Agent + CoachOutput schema）
├── main/              # Electron 主进程（窗口/托盘/IPC/唤醒词模型下发）
├── renderer/          # HUD 浮窗 + 本地 openWakeWord 唤醒（esbuild 打包）
├── shared/ipc.ts      # IPC 契约（CHANNELS + WakeRuntime + Capabilities）
└── test/              # node:test（含 architecture.test.ts 架构 lint）
```

关键不变量（机械强制）：
1. **`reply` 必须是模型输出 JSON 的第一个键**——流式蹦字与首句 TTS 靠它。
2. **LLM 不用 SDK `outputType`**——JSON 经 `providerData.json_object` 产出，上层 zod 校验。
3. **分层依赖红线**——renderer 不直接访问 Node，只经 `window.zuiti`（preload contextBridge）。

详见 [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](./AGENTS.md)。

## 文档

- [设计文档](./docs/design-docs/2026-06-24-zuiti-design.md) — 产品定位 / 创意 / 痛点 / Hero 场景
- [架构文档](./ARCHITECTURE.md) — 分层 / 不变量 / 目录结构
- [执行计划](./docs/PLANS.md) — Plan 1-5 已完成，Plan 6（读向技能）待启动
- [质量评分](./docs/QUALITY_SCORE.md) — 各域质量自评

---

# English

> A real always-on desktop assistant: say "Jarvis" → it auto-screenshots → you speak your mind → it gives you copy-ready witty replies.
> Entry for TRAE AI Creativity Competition · Main track: Life & Entertainment

**Zuiti** (嘴替, literally "mouth-double") turns "I know what I want to say but it's stuck on the tip of my tongue" into "nail it on the spot" — no window switching, no copy-paste, no typing, no explaining context. Just wake it, speak, and get replies.

## Key Features

- **Tray-resident + side-stick overlay**: summon on demand, hide when done.
- **Three wake methods**: tray click / global hotkey / voice "Jarvis".
- **Local offline wake word**: powered by [openWakeWord](https://github.com/dscripka/openWakeWord) ONNX inference — **fully local, offline, zero API key, no continuous cloud streaming**.
- **Screenshot context awareness**: captures screen once on wake, feeds to multimodal LLM. **Never continuously monitors.**
- **Voice input**: ASR transcribes your casual, emotional, spoken-language input.
- **Streaming reply + first-sentence TTS**: `reply` is the first JSON key (architectural invariant) for instant streaming.
- **Multi-style candidates**: one recommended + 2-3 tagged alternatives (flirty / assertive / steady / professional / English), one-click copy.
- **VAD auto-stop**: pure-TS RMS energy detection, stops recording when you stop talking.
- **Skill extension base**: today it helps you flirt / rebut / talk to your boss; tomorrow it can write Xiaohongshu posts, battle customer service, decode passive-aggressive messages.

## Privacy

- Wake word detection runs **entirely locally** in browser WASM — no cloud, no API key, no network.
- **No continuous listening** — only triggers after wake word hit.
- **No continuous screen monitoring** — only captures on wake.
- **Rebuttal red line**: witty comebacks only, never personal attacks / profanity / cyberbullying.

## Tech Stack

TypeScript (ESM) · Node ≥ 22 · Electron 42 · `@openai/agents` · zod v4 · onnxruntime-web · esbuild

LLM via Xiaomi MiMo (OpenAI-compatible endpoint). See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quick Start

```bash
npm ci
cp .env.example .env   # fill in MiMo API key
npm run fetch-models   # download openWakeWord ONNX models (~10MB)
npm start
```

## Development

```bash
npm run typecheck   # dual tsconfig (main + renderer)
npm test            # build + node:test (45 tests, includes arch lint)
npm run build       # compile main + esbuild bundle renderer
```

## License

Private project for TRAE AI Creativity Competition.
