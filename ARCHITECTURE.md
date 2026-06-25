# ARCHITECTURE.md

> 嘴替的顶层架构地图。改代码前先读这个。

## 一句话

托盘常驻桌面应用 → 唤醒（当前：托盘点击 / 全局快捷键；Plan 3：语音"Jarvis"）→ 截屏看懂上下文（Plan 3）→ 输入真心话 → LLM 产出多条带风格标签的神回复 → 一键复制发出。

## 分层模型（依赖只能"向前"）

```
Types → Config → Core → Modules → Main(Runtime) → Renderer(UI)
                ↑                              ↑
          Providers（跨切面）            Preload（受控 IPC 桥）
```

- **Types**：zod schema + 推导类型。数据形状在边界解析（parse-don't-validate）。`src/modules/reply/schema.ts`、`src/shared/ipc.ts`。
- **Config / Providers**：`src/core/provider.ts`——OpenAI 兼容端点（MiMo）适配，读 `.env`（`LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`）。
- **Core**：`src/core/`——harness 底座：`streamparse.ts`（ReplyExtractor）、`skill.ts`（扩展底座）、`provider.ts`、`log.ts`（结构化日志）。
- **Modules**：`src/modules/reply/`——嘴替 skill：`schema.ts`（CoachOutput）、`coach.ts`（ReplyCoach Agent + INSTRUCTIONS）。
- **Main (Runtime)**：`src/main/`——Electron 主进程：`index.ts`（生命周期）、`window.ts`（HUD 浮窗）、`tray.ts`（托盘+快捷键）、`ipc.ts`（coach:run→coach:result）、`preload.ts`（contextBridge）。
- **Renderer (UI)**：`src/renderer/`——HUD 浮窗：`hud.html`/`hud.css`/`hud.js`（纯 vanilla JS，候选卡片点即复制）。

依赖方向红线（机械强制，见 `src/test/architecture.test.ts`）：
- `renderer/` 不得 import 任何 Node 侧模块（只能用 `window.zuiti`）。
- `modules/` 不得 import `main/` 或 `renderer/`。
- `core/` 不得 import `modules/`/`main/`/`renderer/`。

## 关键不变量（mechanically enforced）

### 1. `reply` 必须是 JSON 第一个键

```
模型输出 JSON → ReplyExtractor 抓第一个键 reply → 流式蹦字 + 首句先播 TTS
```

- 实现：`src/core/streamparse.ts` 的 `ReplyExtractor`。
- 约束：`CoachOutput` zod schema 里 `reply` 排第一字段。**永远不要改这个顺序。**
- 机械强制：`src/test/architecture.test.ts` 断言 schema 第一键 + prompt 含"必须排第一"。

### 2. LLM 输出不经 SDK outputType

- MiMo 不支持严格 json_schema。
- JSON 经 `modelSettings.providerData` 的 `json_object` 产出。
- 上层 `parseCoachOutput`（zod）校验，**从宽**：只有 `reply` 是硬要求，其余给默认值/容错。

### 3. Skill 系统是扩展底座

- `src/core/skill.ts`：加能力 = 实现接口 + 注册一行，harness 不动。
- 今天替你撩 / 怂 / 跟老板说话；明天能写小红书文案、跟客服 battle、解读阴阳怪气。
- 扩展分两档：纯 skill/prompt 替换；或输出形状不同时一般化 `parseOutput` + 加 UI 视图。

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
│   ├── skill.ts       # skill 接口 + 注册
│   ├── provider.ts    # MiMo/OpenAI 适配 + env 加载
│   └── log.ts         # 结构化日志（LLM 可读 JSON lines）
├── modules/
│   └── reply/         # 嘴替 skill（Plan 2 从 english/ 改名）
│       ├── schema.ts  # CoachOutput / Candidate / parseCoachOutput
│       └── coach.ts   # ReplyCoach Agent + INSTRUCTIONS
├── cli/               # CLI 入口 + 渲染纯函数
│   ├── coach.ts
│   └── render.ts      # renderCoachOutput（纯函数，可单测）
├── shared/
│   └── ipc.ts         # CoachOutputDTO 等跨进程类型
├── main/              # Electron 主进程
│   ├── index.ts       # app 生命周期
│   ├── window.ts      # HUD 浮窗（无框侧贴）
│   ├── tray.ts        # 托盘 + 全局快捷键
│   ├── ipc.ts         # coach:run → ReplyCoach → coach:result
│   └── preload.ts     # contextBridge → window.zuiti
├── renderer/          # HUD 浮窗（vanilla JS，候选卡片点即复制）
│   ├── hud.html
│   ├── hud.css
│   └── hud.js
└── test/              # node:test
```

## 不做的事（红线）

- **不持续监视屏幕主动弹窗**——只在被唤醒时看一次屏。
- **对线不做网暴**——机智回怼，非人身攻击。
- **不用 SDK outputType**——见不变量 2。
- **不改 `reply` 第一键顺序**——见不变量 1。
- **renderer 不直接访问 Node**——只经 `window.zuiti`（preload contextBridge）。
