# ARCHITECTURE.md

> 嘴替的顶层架构地图。改代码前先读这个。
> 当前架构：**Plan 8 pi 迁移**后（单 pi session + Agent Skills 渐进式披露 + 通用输出层）。

## 一句话

托盘常驻桌面应用 → 唤醒（托盘点击 / 全局快捷键 / 语音"Jarvis"本地 openWakeWord）→ 截屏看懂上下文 → 输入真心话 → 单个嘴替 pi session 自主选用 skill → 主体文本流式蹦字（+ 首句先播 TTS）+ `emit_result` 补结构化备选 → 字段驱动渲染、一键复制发出。

## 分层模型（依赖只能"向前"）

```
Types → Config → Core → Modules → Main(Runtime) → Renderer(UI)
                ↑                              ↑
          Providers（跨切面）            Preload（受控 IPC 桥）
                                          ↓
                                   openWakeWord（本地 ONNX 推理，Plan 4）
```

- **Types**：跨进程类型在 `src/shared/ipc.ts`——`CHANNELS` + `UniversalOutput` + `UniversalItem` + `WakeRuntime` + `Capabilities`。零运行时依赖（渲染层 DOM lib 与主进程都编译它）。
- **Config / Providers**：`src/core/provider.ts`——读 `.env`（`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`），用 pi 的 `ModelRegistry.inMemory(authStorage).registerProvider('mimo', …)` 注册 MiMo（OpenAI 兼容端点）。`src/core/mira-model.ts`——MiMo model 元数据（**关 thinking**）。
- **Core**：`src/core/`——harness 底座：`provider.ts`（接 MiMo）、`mira-model.ts`（关 thinking）、`emit-tool.ts`（`emit_result` 工具工厂）、`log.ts`（结构化日志 + `RunSummary`）、`voice.ts`（ASR/TTS）、`screenshot.ts`、`wakeword.ts`（`containsWakeWord` 文本判定）。
- **Modules**：`src/modules/`——嘴替 session + skill 流水线：
  - `mira/prompt.ts`——`MIRA_SYSTEM_PROMPT`（嘴替人格，替换 pi 默认 coding prompt）+ `skillsDir()`。
  - `mira/session.ts`——`createMiraSession`：组装单个 pi session（关 thinking MiMo + system prompt + skills 披露 + `tools:['read','emit_result']`）。
  - `skill-runner.ts`——`runSkill`：跑 session、订阅文本流式蹦字 + 首句 TTS、收 `emit_result`、组装 `UniversalOutput`、写 `RunSummary`。
- **Main (Runtime)**：`src/main/`——Electron 主进程：`index.ts`（生命周期 + 唤醒词模型下发 + 麦克风权限）、`window.ts`（HUD 浮窗）、`tray.ts`（托盘 + 快捷键）、`ipc.ts`（`runSkillPipeline`：截屏 → `runSkill` → `coach:result` 发 `UniversalOutput`）、`preload.ts`（contextBridge）。
- **Renderer (UI)**：`src/renderer/`——HUD 浮窗 + 本地唤醒词：
  - `hud.ts`（主入口，esbuild 打包到 `dist/renderer/hud.js`，**字段驱动渲染** `UniversalOutput`）
  - `openwakeword.ts`（ONNX 三段推理管线，忠实复刻官方流式实现）
  - `wakeword.ts`（WebVoiceProcessor 订阅 + 唤醒回调）
  - `vad.ts`（纯 TS RMS VAD，silence↔speaking 状态机）
  - `wav.ts`（Float32 PCM → pcm16 WAV 编码）
  - `hud.html`/`hud.css`

依赖方向红线（机械强制，见 `src/test/architecture.test.ts`）：
- `renderer/` 可 import npm 包（onnxruntime-web / @picovoice/web-voice-processor）与 `../shared/ipc.ts`，但不得 import `../core/*` `../modules/*` `../main/*`（只能用 `window.zuiti`），也不得用 `require(`。
- `modules/` 不得 import `main/` 或 `renderer/`。
- `core/` 不得 import `modules/`/`main/`/`renderer/`。

## 请求生命周期

```
用户语音(ASR→文字) + 截图
        │
        ▼
  createMiraSession（一次请求一个 session、一个 agent loop）
   ├─ 关 thinking 的 MiMo model（core/mira-model.ts）
   ├─ MIRA_SYSTEM_PROMPT（嘴替人格，经 DefaultResourceLoader 注入）
   ├─ skills/ 下三个 SKILL.md 的 name+description 注入 system prompt（渐进式披露）
   ├─ tools:['read','emit_result']（read 用来加载 SKILL.md，emit_result 产结构化）
   └─ 截图作为 image content block 只喂这一个 session 一次
        │
        ▼
  agent 自主决定 read 哪个 SKILL.md（无 choose_skill 路由）
   ├─ 先以普通文本流式输出「主体 primary」（text_delta → 蹦字 + 首句 TTS）
   └─ 再调 emit_result(items,title?,note?) 补结构化
        │
        ▼
  UniversalOutput → renderer 字段驱动渲染（有几个 item 显示几个）
```

加一个 skill = 往 `skills/` 丢一个 `SKILL.md`（O(1)，harness 不动）。

## 关键不变量（mechanically enforced）

机械强制见 `src/test/architecture.test.ts`。改动这些前先理解为什么。

### 1. MiMo 关 thinking（硬前提）

- `src/core/mira-model.ts`：`compat.thinkingFormat:'chat-template'` + `chatTemplateKwargs.enable_thinking:false`。
- 原因：MiMo 是 reasoning 模型，挂工具时会"先 reasoning 先 tool、文本挤到第二轮"，首字 21-32s；关掉后首字 <1s 且顺序正确（先文本流式 → 后 `emit_result`）。
- 机械强制：architecture.test 断言 `enable_thinking: false`。

### 2. session 用 tools 白名单保留 `read`

- `src/modules/mira/session.ts`：`tools: ['read', 'emit_result']`。
- 原因：pi 的 Agent Skills 渐进式披露**依赖内建 `read` 工具**——`noTools:'all'/'builtin'` 会连 `read` 一起禁掉，pi 随即**不注入** `<available_skills>`，skill 系统静默失效。
- 机械强制：architecture.test 断言 `tools:['read', …]`。

### 3. emit_result 工具产结构化（不用 SDK json_schema）

- MiMo 不支持严格 `json_schema`。结构化备选/标题/备注走 `emit_result` 工具参数（TypeBox schema，校验在库层），不解析文本、不依赖 provider 的 json_schema。
- `primary`（主体回复/讲解正文）**不进工具**，走文本流式累积。
- 机械强制：architecture.test 断言 `emit-tool.ts` 含 `name:'emit_result'` + `items`。

### 4. renderer 字段驱动渲染

- `src/renderer/hud.ts` 按 `UniversalOutput` 字段渲染（title? + primary + items + note?），**不得**出现 `skillId === 'reply'` 之类的按 skill 硬分支。
- 机械强制：architecture.test 断言 hud 无 `skillId ===`。

### 5. skills/ 下每个 SKILL.md 有合法 frontmatter

- 每个 `skills/<id>/SKILL.md` 至少含 `name` + `description`（≤64 / ≤1024 字）。`description` 写清"做什么 + 何时用"，渐进式披露靠它路由。
- 机械强制：architecture.test 断言 ≥3 个 skill 目录且各有 `name`/`description`。

### 6. Provider 配置经 env（config.json > env > 默认）

- `resolveLlmConfig()`：`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`。
- `provider.ts` 顶部 `loadDotenv()`：保证导入期能读到 env。
- MiMo Token Plan：`https://token-plan-cn.xiaomimimo.com/v1` + `mimo-v2.5-pro`。

## 当前数据模型（Plan 8 后）

```ts
// src/shared/ipc.ts —— 替代旧的 CoachOutput / ExplainOutput / SummarizeOutput 三套 schema 与 SkillOutput 联合类型
interface UniversalItem {
  text: string;
  label?: string;      // 风格标签 / 分类（如 "更撩" / "待办"）
  copyable?: boolean;  // true 则渲染「复制」按钮（reply 候选用）
}
interface UniversalOutput {
  skillId?: string;            // best-effort：agent read 的 skill（拿不到留空，渲染/逻辑都不依赖）
  title?: string;             // explain/summarize 标题
  primary: { text: string };  // 主体：推荐回复 / 讲解正文（来自文本流式累积）
  items: UniversalItem[];
  note?: string;              // rationale 之类
}
```

三个 skill 到 `UniversalOutput` 的映射（见各 `skills/<id>/SKILL.md` 输出协议）：

| skill | primary | items | title / note |
|-------|---------|-------|--------------|
| **reply** | 最推荐的一条回复 | 2-3 条候选（`copyable:true`，`label`=风格） | note=场景/语气判断 |
| **explain** | 讲解正文 | bullets（`copyable:false`） | title=标题 |
| **summarize** | 可空 | keyPoints + actionItems（用 `label:'待办'` 区分） | title=主题 |

## 目录结构（现状）

```
src/
├── core/                  # harness 底座
│   ├── provider.ts        # createMiraModelRegistry（pi ModelRegistry + registerProvider MiMo）+ env/config 解析
│   ├── mira-model.ts      # buildMiraModel —— MiMo model 元数据（关 thinking）
│   ├── emit-tool.ts       # createEmitTool —— emit_result 工具工厂（TypeBox schema）
│   ├── log.ts             # 结构化日志（LLM 可读 JSON lines）+ RunSummary（logs/runs/<runId>.json）
│   ├── voice.ts           # MiMo ASR/TTS 客户端 + parseDataUrl/mimeToAudioMime
│   ├── screenshot.ts      # 截屏（Electron desktopCapturer 动态 import）
│   └── wakeword.ts        # containsWakeWord 文本判定（耳听八方模式用）
├── modules/               # 嘴替 session + skill 流水线
│   ├── mira/
│   │   ├── prompt.ts      # MIRA_SYSTEM_PROMPT（嘴替人格）+ skillsDir()
│   │   └── session.ts     # createMiraSession（单 pi session 组装）
│   └── skill-runner.ts    # runSkill（流式蹦字 + 首句 TTS + 组装 UniversalOutput + RunSummary）
├── shared/
│   └── ipc.ts             # CHANNELS + UniversalOutput + UniversalItem + WakeRuntime + Capabilities
├── main/                  # Electron 主进程
│   ├── index.ts           # app 生命周期 + 唤醒词模型下发 + 麦克风权限
│   ├── window.ts          # HUD 浮窗（无框侧贴，loadFile dist/renderer/hud.html）
│   ├── tray.ts            # 托盘 + 全局快捷键
│   ├── ipc.ts             # runSkillPipeline（截屏 → runSkill → coach:result 发 UniversalOutput）
│   └── preload.ts         # contextBridge → window.zuiti
├── renderer/              # HUD 浮窗 + 本地唤醒词（esbuild 打包到 dist/renderer/hud.js）
│   ├── hud.ts             # 主入口（字段驱动渲染 UniversalOutput）
│   ├── openwakeword.ts    # ONNX 三段推理管线（melspec → embedding → hey_jarvis）
│   ├── wakeword.ts        # WebVoiceProcessor 订阅 + 唤醒回调
│   ├── vad.ts             # 纯 TS RMS VAD（silence↔speaking 状态机）
│   ├── wav.ts             # Float32 PCM → pcm16 WAV 编码
│   ├── hud.html
│   └── hud.css
└── test/                  # node:test（含 architecture.test.ts 架构 lint + e2e/ 真 LLM）
skills/                    # Agent Skills（渐进式披露，每个一个 SKILL.md）
├── reply/SKILL.md         # 替用户把话说漂亮（恋爱/对线/职场/英文）
├── explain/SKILL.md       # 看屏讲解英文/难懂内容
└── summarize/SKILL.md     # 群聊/邮件/长讨论总结要点
scripts/
├── fetch-wake-models.mjs  # 下载 openWakeWord 3 个 ONNX 到 models/
├── copy-assets.mjs        # 拷 html/css + onnx wasm 到 dist/renderer/
└── pi-spike.mjs           # pi+MiMo 全链路 spike（保留作回归）
models/                    # openWakeWord ONNX 模型（不入库，由 fetch-models 下载）
```

## 不做的事（红线）

- **不持续监视屏幕主动弹窗**——只在被唤醒时看一次屏。
- **唤醒判断只在本地**——openWakeWord 跑在浏览器 WASM，不上云、不联网、无需 API Key（隐私向亮点）。
- **对线不做网暴**——机智回怼，非人身攻击。
- **不开 thinking**——见不变量 1（关 thinking 是 emit-tool 协议的硬前提）。
- **不禁 `read` 工具**——见不变量 2（禁了 skill 系统静默失效）。
- **renderer 不直接访问 Node**——只经 `window.zuiti`（preload contextBridge）。
- **不按 skillId 硬分支渲染**——见不变量 4（字段驱动）。

## 历史

Plan 8 之前用 `@openai/agents`（三个 `*Coach` Agent + `router.ts` 路由 + `ReplyExtractor` 抽"reply 第一键" + 三套 schema/DTO），加一个 skill 要改 4 处。设计审查发现五个设计债（流式绑字段、按 skillId 双分支、截图双喂、Agent 退化成单次 completion、扩展 O(n)）。迁移到 pi 的完整脉络见 [docs/design-docs/2026-06-26-pi-migration-design.md](./docs/design-docs/2026-06-26-pi-migration-design.md)。
