<div align="center">

<img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=modern%20flat%20illustration%20of%20a%20desktop%20assistant%2C%20pink%20and%20deep%20purple%20gradient%2C%20speech%20bubbles%20with%20witty%20replies%2C%20microphone%20and%20screen%20icon%2C%20minimal%20playful%20style%2C%20warm%20cream%20background&image_size=landscape_16_9" alt="嘴替 hero" width="100%" />

# 嘴替 · 你负责想，它负责嘴

**真·常驻桌面助手：喊一声「Jarvis」→ 自动看屏 → 你语音说真心话 → 它给你几条能直接发的神回复，一键复制。**

🏆 TRAE AI 创造力大赛参赛作品 · 主赛道：生活娱乐

[English](./README.en.md) · [展示页](./docs/showcase/zuiti.html) · [架构文档](./ARCHITECTURE.md)

</div>

---

> 暧昧对象发来"在吗"，你盯着屏幕憋三分钟，最后回了个"在"。
> 评论区想怼回去，当场大脑空白，洗完澡才想出王炸级回击。
> 跟领导请个假，草稿改八遍，发出去还是觉得自己在跪。
> 老外同事 @ 你，英文挤半天，一股扑面而来的机翻味。
>
> **你不是没话说，是那句最好的话永远卡在嘴边。**

嘴替把这个"卡在嘴边"变成"当场显灵"——不切窗口、不复制粘贴、不打字、不解释背景，喊一声 + 说句话就出结果。

## 核心特性

| | 特性 | 说明 |
|---|---|---|
| 🛸 | **托盘常驻 + 侧贴浮窗** | 召唤即用，用完即隐，不打断你正在做的事 |
| 🎙️ | **三种唤醒方式** | 托盘点击 / 全局快捷键 / 语音「Jarvis」 |
| 🔒 | **本地离线唤醒词** | 基于 [openWakeWord](https://github.com/dscripka/openWakeWord) 的 ONNX 推理，**完全本地、离线、零 API Key、不持续传云端**——隐私向技术亮点 |
| 👀 | **自动看屏懂上下文** | 召唤时截屏一次，喂给多模态 LLM，它知道你在跟谁聊、聊到哪、什么气氛。**不做持续监视主动弹窗** |
| 🗣️ | **语音说真心话** | ASR 转写你的口语化输入（带情绪、中文、甚至脏话都行） |
| ⚡ | **流式蹦字 + 首句先播 TTS** | `reply` 是 JSON 第一键（架构不变量），保证流式输出与首句 TTS 秒出 |
| 🎨 | **多风格备选** | 推荐一条 + 2-3 条带风格标签的备选（更撩 / 更刚 / 更稳 / 更专业 / 英文），一键复制 |
| 🤚 | **VAD 自动停止录音** | 纯 TS RMS 能量检测，说完自动停，不用手按 |
| 🧩 | **Skill 扩展底座** | 今天替你撩 / 怂 / 跟老板说话；明天能写小红书文案、跟客服 battle、解读阴阳怪气 |

## 三步救场

<img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=three-step%20flowchart%20infographic%2C%20step%201%20voice%20wake%20word%20Jarvis%2C%20step%202%20screenshot%20and%20speak%2C%20step%203%20copy%20witty%20reply%2C%20pink%20accent%20color%2C%20clean%20modern%20flat%20design%2C%20cream%20background&image_size=landscape_4_3" alt="三步救场流程" width="100%" />

| STEP 01 | STEP 02 | STEP 03 |
|---------|---------|---------|
| **喊一声「Jarvis」** | **说句人话** | **挑一条发出去** |
| 它就醒了——顺手把你当前屏幕看了个明白，知道你在跟谁聊、聊到哪。 | 中文、口语、带情绪都行："帮我接住，但别太舔。" | 三条神回复任选，可切风格，一键复制。搞定。 |

## 现场演示 · 你 vs 嘴替

> 💘 **谈恋爱** — 对象不开心，话到嘴边只会"哦哦"
>
> 对方：我今天有点不开心 😔
>
> 😶 你憋出来的：哦哦，怎么了
>
> **嘴替给你三条，挑一条发：**
> - 怎么啦，跟我说说？先别自己扛着。实在不行我陪你骂他，再请你吃顿好的。 `暖心`
> - 谁惹你了？告诉我，我帮你分析分析，顺便骂他。 `仗义`
> - 抱抱，别不开心了。要不要我给你讲个冷笑话，保证你笑。 `可爱`

> 😎 **对线** — 被阴阳怪气，当场只想骂回去
>
> 对方：就你这水平也好意思发出来？
>
> 🤬 你想发的：你他*说啥呢
>
> **嘴替给你三条，挑一条发：**
> - 看来你很懂，那正好——麻烦列三条具体的改进意见，我学习一下。空口点评谁都会，能动手的不多。 `机智`
> - 哈哈谢谢关注！不过我觉得挺好的，要不你发个更好的让我学习学习？ `从容`
> - 每个人审美不一样嘛，你觉得不好看可以划走，没必要留评论，多累啊 😄 `四两拨千斤`

> 💼 **职场分寸** — 想请假，又怕显得不靠谱
>
> 😬 你的草稿：王哥我明天想请个假
>
> **嘴替给你三条，挑一条发：**
> - 王哥，我明天有点私事要处理，想请一天假。手头的需求我今晚先推进一波，有急事随时找我，不耽误进度。 `靠谱`
> - 领导好，明天家里有点事想请假一天。本周任务我已经提前安排好了，交接文档也写好了，您放心。 `周全`
> - 王哥，明天能请个假吗？有急事。回来给您带杯咖啡补上 ☕ `轻松`

> 🌍 **英文彩蛋** — 旗舰技能，跨语言降维打击
>
> 你说（中文）：跟我说这改动下周才能 review，但要客气点别得罪人
>
> **嘴替 → 地道英文：** Thanks for the heads-up! I won't be able to get to this review until next week — really appreciate your patience. Happy to prioritize if it's blocking anything.

## 隐私设计

- **唤醒判断只在本地**：openWakeWord 跑在浏览器 WASM，不联网、不上云、无需 API Key。
- **不持续监听**：只在唤醒词命中后才触发录音与识别。
- **不持续监视屏幕**：只在被唤醒时看一次屏。
- **对线红线**：只做机智、有理有据的回怼——严禁人身攻击、脏话、歧视、教唆网暴。

## 凭什么不是又一个 AI

| 网页版 AI | 嘴替 |
|-----------|------|
| 要你复制粘贴 + 描述背景 | 👀 它自己看屏幕，召唤即截屏看懂 |
| 还得自己敲字想措辞 | 🎙️ 你只管开口，说句大白话就行 |
| 切窗口、打字、来回复制 | 🛸 常驻桌面、一句话唤醒、用完即隐 |

**真·桌面应用，不是一张网页 PPT。**

## 技术栈

TypeScript (ESM) · Node ≥ 22 · Electron 42 · `@openai/agents` · zod v4 · onnxruntime-web · @picovoice/web-voice-processor · esbuild

LLM 走小米 MiMo（OpenAI 兼容端点）。

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

<img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=software%20architecture%20layered%20diagram%2C%20five%20layers%20from%20bottom%20to%20top%20Types%20Config%20Core%20Modules%20Main%20Renderer%2C%20arrows%20pointing%20upward%2C%20pink%20and%20purple%20color%20scheme%2C%20technical%20clean%20diagram%20style&image_size=landscape_4_3" alt="架构分层" width="100%" />

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

## 未来 · 一个梗，一座平台

底座是一个"看屏 + 语音 + 技能"的通用引擎，能不断长出新场景——一个停不下来的赛博嘴替。

`✍️ 替你写小红书文案` · `🥊 替你跟客服 battle` · `🔍 替你解读阴阳怪气` · `💸 替你催甲方打款` · `📧 替你回不想回的邮件` · `🌍 替你跟老外唠`

## 文档

- [设计文档](./docs/design-docs/2026-06-24-zuiti-design.md) — 产品定位 / 创意 / 痛点 / Hero 场景
- [架构文档](./ARCHITECTURE.md) — 分层 / 不变量 / 目录结构
- [执行计划](./docs/PLANS.md) — Plan 1-5 已完成，Plan 6（读向技能）待启动
- [质量评分](./docs/QUALITY_SCORE.md) — 各域质量自评
- [展示页](./docs/showcase/zuiti.html) — 完整视觉展示

---

<div align="center">

**嘴替上线，回回封神。**

</div>
