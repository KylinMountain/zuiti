# ARCHITECTURE.md

> 嘴替的顶层架构地图。改代码前先读这个。

## 一句话

托盘常驻桌面应用 → 语音唤醒 → 截屏看懂上下文 → 语音说真心话 → LLM 产出多条带风格标签的神回复 → 一键复制发出。

## 分层模型（依赖只能"向前"）

```
Types → Config → Repo → Service → Runtime → UI
                                  ↑
                            Providers（跨切面：auth / connectors / telemetry / skill）
```

- **Types**：zod schema + 推导类型。数据形状在边界解析（parse-don't-validate）。
- **Config**：`config.json` + `.env` 加载，provider 适配层。
- **Repo / Service**：核心业务逻辑。`src/modules/english/`（codename 保留，Plan 2 改名 `reply/`）。
- **Runtime**：Electron 主进程、窗口、托盘、唤醒、VAD、流式。
- **UI**：渲染层 `src/renderer/*`（HUD 浮窗）。
- **Providers**：跨切面能力经单一显式接口注入。

## 关键不变量（mechanically enforced）

### 1. `reply` 必须是 JSON 第一个键

```
模型输出 JSON → ReplyExtractor 抓第一个键 reply → 流式蹦字 + 首句先播 TTS
```

- 实现：`src/core/streamparse.ts` 的 `ReplyExtractor`。
- 约束：`CoachOutput` zod schema 里 `reply` 排第一字段。**永远不要改这个顺序。**

### 2. LLM 输出不经 SDK outputType

- MiMo 不支持严格 json_schema。
- JSON 经 `modelSettings.providerData` 的 `json_object` 产出。
- 上层 `parseCoachOutput`（zod）校验，**从宽**：只有 `reply` 是硬要求，其余给默认值/容错。

### 3. Skill 系统是扩展底座

- `src/core/skill.ts`：加能力 = 实现接口 + 注册一行，harness 不动。
- 今天替你撩 / 怍 / 跟老板说话；明天能写小红书文案、跟客服 battle、解读阴阳怪气。
- 扩展分两档：纯 skill/prompt 替换；或输出形状不同时一般化 `parseOutput` + 加 UI 视图。

## 当前数据模型（Plan 1 后）

```ts
CoachOutput = {
  reply: string,                    // 最推荐一条，可直接发（JSON 第一键，硬要求）
  candidates: Candidate[],          // 2-3 条带风格标签备选 [{text, style}]
  diagnostics: Diagnostic[],        // 旧字段，保留兼容渲染层，Plan 2 移除
  rationale: string,                // 一句话场景与语气判断
  variants: StyleVariants | null,   // 旧字段，保留兼容渲染层，Plan 2 移除
}
```

IPC 侧 `CoachOutputDTO` 结构对齐（含 `candidates`），供渲染层消费。

## 目录结构（现状 + Plan 2 目标）

```
src/
├── core/              # harness：唤醒、截屏、流式、skill 注册
│   ├── streamparse.ts # ReplyExtractor（依赖 reply 第一键）
│   └── skill.ts       # skill 接口 + 注册
├── modules/
│   └── english/       # codename 保留；Plan 2 → reply/
│       ├── schema.ts  # CoachOutput / Candidate / parseCoachOutput
│       └── coach.ts   # Agent + INSTRUCTIONS（嘴替自适应 prompt）
├── cli/               # CLI 入口 + 渲染纯函数
│   ├── coach.ts
│   └── render.ts      # renderCoachOutput（纯函数，可单测）
├── shared/
│   └── ipc.ts         # CoachOutputDTO 等跨进程类型
├── main/              # Electron 主进程
│   ├── window.ts
│   └── tray.ts
├── renderer/          # HUD 浮窗（Plan 2 改 candidates 卡片化）
└── test/              # node:test
```

## 不做的事（红线）

- **不持续监视屏幕主动弹窗**——只在被唤醒时看一次屏。
- **对线不做网暴**——机智回怼，非人身攻击。
- **不用 SDK outputType**——见不变量 2。
- **不改 `reply` 第一键顺序**——见不变量 1。
