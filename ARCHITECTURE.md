# ARCHITECTURE.md

> 嘴替的顶层架构地图。改代码前先读这个。

## 一句话

托盘常驻桌面应用 → 唤醒（托盘点击 / 全局快捷键 / 语音"Jarvis"本地 openWakeWord）→ 截屏看懂上下文 → 输入真心话 → LLM 流式产出 reply + 多条带风格标签备选 → 一键复制发出。

## 分层模型（依赖只能"向前"）

```
Types → Config → Core → Modules → Main(Runtime) → Renderer(UI)
                ↑                              ↑
          Providers（跨切面）            Preload（受控 IPC 桥）
                                          ↓
                                   openWakeWord（本地 ONNX 推理，Plan 4）
```

- **Types**：zod schema + 推导类型。数据形状在边界解析（parse-don't-validate）。`src/modules/reply/schema.ts`、`src/modules/explain/schema.ts`、`src/modules/summarize/schema.ts`、`src/shared/ipc.ts`（CHANNELS + WakeRuntime + Capabilities + SkillId + SkillOutput 联合类型）。
- **Config / Providers**：`src/core/provider.ts`——OpenAI 兼容端点（MiMo）适配，读 `.env`（`LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`）。
- **Core**：`src/core/`——harness 底座：`streamparse.ts`（ReplyExtractor）、`skill.ts`（扩展底座，Plan 6 加 agent + buildInput）、`provider.ts`、`log.ts`（结构化日志）、`voice.ts`（ASR/TTS）、`screenshot.ts`、`wakeword.ts`（containsWakeWord 文本判定）。
- **Modules**：`src/modules/`——三个 skill + 路由（Plan 6）：
  - `reply/`——嘴替 skill：`schema.ts`（CoachOutput）、`coach.ts`（ReplyCoach Agent + replySkill 注册项）
  - `explain/`——看屏讲解 skill（Plan 6）：`schema.ts`（ExplainOutput）、`coach.ts`（ExplainCoach + explainSkill）
  - `summarize/`——总结讨论 skill（Plan 6）：`schema.ts`（SummarizeOutput）、`coach.ts`（SummarizeCoach + summarizeSkill）
  - `router.ts`——LLM 自动路由：`classifyIntentHeuristic`（纯函数兜底）+ `routeSkill`（LLM 精确路由框架）
  - `index.ts`——`registerAllSkills` 集中注册
- **Main (Runtime)**：`src/main/`——Electron 主进程：`index.ts`（生命周期 + 唤醒词模型下发 + 麦克风权限）、`window.ts`（HUD 浮窗）、`tray.ts`（托盘+快捷键）、`ipc.ts`（runSkillPipeline：router 路由 → 对应 skill Agent → SkillOutput）、`preload.ts`（contextBridge）。
- **Renderer (UI)**：`src/renderer/`——HUD 浮窗 + 本地唤醒词：
  - `hud.ts`（主入口，esbuild 打包到 `dist/renderer/hud.js`，按 skillId 分支渲染 reply 卡片视图 / explain/summarize 阅读视图）
  - `openwakeword.ts`（ONNX 三段推理管线，忠实复刻官方流式实现）
  - `wakeword.ts`（WebVoiceProcessor 订阅 + 唤醒回调）
  - `vad.ts`（纯 TS RMS VAD，silence↔speaking 状态机）
  - `wav.ts`（Float32 PCM → pcm16 WAV 编码）
  - `hud.html`/`hud.css`

依赖方向红线（机械强制，见 `src/test/architecture.test.ts`）：
- `renderer/` 可 import npm 包（onnxruntime-web / @picovoice/web-voice-processor）与 `../shared/ipc.ts`，但不得 import `../core/*` `../modules/*` `../main/*`（只能用 `window.zuiti`）。
- `modules/` 不得 import `main/` 或 `renderer/`。
- `core/` 不得 import `modules/`/`main/`/`renderer/`。

## 关键不变量（mechanically enforced）

### 1. `reply` 必须是 JSON 第一个键

```
模型输出 JSON → ReplyExtractor 抓第一个键 reply → 流式蹦字 + 首句先播 TTS
```

- 实现：`src/core/streamparse.ts` 的 `ReplyExtractor`。
- 流式接入：`src/main/ipc.ts` 用 `run(ReplyCoach, ..., { stream: true })`，每 chunk 经 `ReplyExtractor.push()` 抽 reply 增量，推 `coach:replyChunk` 给渲染层蹦字（Plan 4 兑现）。
- 约束：`CoachOutput` zod schema 里 `reply` 排第一字段。**永远不要改这个顺序。**
- 机械强制：`src/test/architecture.test.ts` 断言 schema 第一键 + prompt 含"必须排第一"。

### 2. LLM 输出不经 SDK outputType

- MiMo 不支持严格 json_schema。
- JSON 经 `modelSettings.providerData` 的 `json_object` 产出。
- 上层 `parseCoachOutput`（zod）校验，**从宽**：只有 `reply` 是硬要求，其余给默认值/容错。

### 3. Skill 系统是扩展底座（Plan 6 一般化）

- `src/core/skill.ts`：加能力 = 实现 `Skill` 接口（含 `agent` + `buildInput` + `parseOutput`）+ 注册一行，harness 不动。
- 今天替你撩 / 怂 / 跟老板说话；明天能写小红书文案、跟客服 battle、解读阴阳怪气。
- 扩展分两档：纯 skill/prompt 替换（输出形状相同，如 reply）；或输出形状不同时一般化 `SkillOutput` 联合类型 + 加 UI 视图（Plan 6：explain/summarize）。
- **LLM 自动路由**：`src/modules/router.ts` 判断意图（reply/explain/summarize），默认回退 reply。当前用 heuristic（零延迟），LLM 精确路由框架已就位（注入 `llmCall` 即可启用）。

### 4. Provider 配置经 env（config.json > env > 默认）

- `resolveLlmConfig()`：`LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`。
- `provider.ts` 顶部 `loadDotenv()`：保证 Agent 构造期（导入时）能读到 env。
- MiMo Token Plan：`https://token-plan-cn.xiaomimimo.com/v1` + `mimo-v2.5-pro`。

## 当前数据模型（Plan 2 后）

```ts
CoachOutput = {
  reply: string,                    // 最推荐一条，可直接发（JSON 第一键，硬要求）
  candidates: Candidate[],          // 2-3 条带风格标签备选 [{text, style}]
  rationale: string,                // 一句话场景与语气判断
}
// CoachOutputDTO（IPC）结构对齐，供渲染层消费
```

弃用的 `diagnostics` / `variants` 已在 Plan 2 Task 1 移除。

## 目录结构（现状）

```
src/
├── core/              # harness 底座
│   ├── streamparse.ts # ReplyExtractor（依赖 reply 第一键）
│   ├── skill.ts       # skill 接口 + 注册（Plan 6 加 agent + buildInput）
│   ├── provider.ts    # MiMo/OpenAI 适配 + env 加载
│   ├── log.ts         # 结构化日志（LLM 可读 JSON lines）
│   ├── voice.ts       # MiMo ASR/TTS 客户端 + parseDataUrl/mimeToAudioMime
│   ├── screenshot.ts  # 截屏（Electron desktopCapturer 动态 import）
│   └── wakeword.ts    # containsWakeWord 文本判定（耳听八方模式用）
├── modules/           # 三个 skill + 路由（Plan 6）
│   ├── reply/         # 嘴替 skill（Plan 2 从 english/ 改名）
│   │   ├── schema.ts  # CoachOutput / Candidate / parseCoachOutput
│   │   └── coach.ts   # ReplyCoach Agent + replySkill 注册项
│   ├── explain/       # 看屏讲解 skill（Plan 6）
│   │   ├── schema.ts  # ExplainOutput / parseExplainOutput
│   │   └── coach.ts   # ExplainCoach Agent + explainSkill 注册项
│   ├── summarize/     # 总结讨论 skill（Plan 6）
│   │   ├── schema.ts  # SummarizeOutput / parseSummarizeOutput
│   │   └── coach.ts   # SummarizeCoach Agent + summarizeSkill 注册项
│   ├── router.ts      # classifyIntentHeuristic + routeSkill（LLM 路由框架）
│   └── index.ts       # registerAllSkills 集中注册
├── cli/               # CLI 入口 + 渲染纯函数
│   ├── coach.ts
│   └── render.ts      # renderCoachOutput（纯函数，可单测）
├── shared/
│   └── ipc.ts         # CHANNELS + CoachOutputDTO + SkillId + SkillOutput + WakeRuntime + Capabilities
├── main/              # Electron 主进程
│   ├── index.ts       # app 生命周期 + 唤醒词模型下发 + 麦克风权限
│   ├── window.ts      # HUD 浮窗（无框侧贴，loadFile dist/renderer/hud.html）
│   ├── tray.ts        # 托盘 + 全局快捷键
│   ├── ipc.ts         # runSkillPipeline（router 路由 → 对应 skill → SkillOutput）
│   └── preload.ts     # contextBridge → window.zuiti
├── renderer/          # HUD 浮窗 + 本地唤醒词（esbuild 打包到 dist/renderer/hud.js）
│   ├── hud.ts         # 主入口（按 skillId 分支渲染 reply 卡片 / explain/summarize 阅读视图）
│   ├── openwakeword.ts# ONNX 三段推理管线（melspec → embedding → hey_jarvis）
│   ├── wakeword.ts    # WebVoiceProcessor 订阅 + 唤醒回调
│   ├── vad.ts         # 纯 TS RMS VAD（silence↔speaking 状态机）
│   ├── wav.ts         # Float32 PCM → pcm16 WAV 编码
│   ├── hud.html
│   └── hud.css
└── test/              # node:test（含 architecture.test.ts 架构 lint）
scripts/
├── fetch-wake-models.mjs  # 下载 openWakeWord 3 个 ONNX 到 models/
└── copy-assets.mjs        # 拷 html/css + onnx wasm 到 dist/renderer/
models/                # openWakeWord ONNX 模型（不入库，由 fetch-models 下载）
```

## 不做的事（红线）

- **不持续监视屏幕主动弹窗**——只在被唤醒时看一次屏。
- **唤醒判断只在本地**——openWakeWord 跑在浏览器 WASM，不上云、不联网、无需 API Key（隐私向亮点）。
- **对线不做网暴**——机智回怼，非人身攻击。
- **不用 SDK outputType**——见不变量 2。
- **不改 `reply` 第一键顺序**——见不变量 1。
- **renderer 不直接访问 Node**——只经 `window.zuiti`（preload contextBridge）。
