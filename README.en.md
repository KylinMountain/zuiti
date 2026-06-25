<div align="center">

<img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=modern%20flat%20illustration%20of%20a%20desktop%20assistant%2C%20pink%20and%20deep%20purple%20gradient%2C%20speech%20bubbles%20with%20witty%20replies%2C%20microphone%20and%20screen%20icon%2C%20minimal%20playful%20style%2C%20warm%20cream%20background&image_size=landscape_16_9" alt="Zuiti hero" width="100%" />

# Zuiti · You think it, it speaks it

**A real always-on desktop assistant: say "Jarvis" → it auto-screenshots → you speak your mind → it gives you copy-ready witty replies.**

🏆 Entry for TRAE AI Creativity Competition · Main track: Life & Entertainment

[中文](./README.md) · [Showcase](./docs/showcase/zuiti.html) · [Architecture](./ARCHITECTURE.md)

</div>

---

> Your crush texts "you there?", you stare at the screen for three minutes, then reply "yeah".
> You want to clap back in a comment thread, brain goes blank, only think of the perfect burn in the shower.
> Asking your boss for a day off, you draft it eight times, send it, still feel like you're groveling.
> A foreign colleague @s you, you squeeze out English that reeks of machine translation.
>
> **It's not that you have nothing to say — it's that the perfect line is always stuck on the tip of your tongue.**

Zuiti (嘴替, literally "mouth-double") turns that "stuck on the tip" into "nail it on the spot" — no window switching, no copy-paste, no typing, no explaining context. Just wake it, speak, and get replies.

## Key Features

| | Feature | Description |
|---|---|---|
| 🛸 | **Tray-resident + side-stick overlay** | Summon on demand, hide when done, never interrupts what you're doing |
| 🎙️ | **Three wake methods** | Tray click / global hotkey / voice "Jarvis" |
| 🔒 | **Local offline wake word** | Powered by [openWakeWord](https://github.com/dscripka/openWakeWord) ONNX inference — **fully local, offline, zero API key, no continuous cloud streaming** |
| 👀 | **Screenshot context awareness** | Captures screen once on wake, feeds to multimodal LLM. **Never continuously monitors** |
| 🗣️ | **Voice input** | ASR transcribes your casual, emotional, spoken-language input |
| ⚡ | **Streaming reply + first-sentence TTS** | `reply` is the first JSON key (architectural invariant) for instant streaming |
| 🎨 | **Multi-style candidates** | One recommended + 2-3 tagged alternatives (flirty / assertive / steady / professional / English), one-click copy |
| 🤚 | **VAD auto-stop** | Pure-TS RMS energy detection, stops recording when you stop talking |
| 🧩 | **Skill extension base** | Today it helps you flirt / rebut / talk to your boss; tomorrow it can write Xiaohongshu posts, battle customer service, decode passive-aggressive messages |

## Three-Step Rescue

<img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=three-step%20flowchart%20infographic%2C%20step%201%20voice%20wake%20word%20Jarvis%2C%20step%202%20screenshot%20and%20speak%2C%20step%203%20copy%20witty%20reply%2C%20pink%20accent%20color%2C%20clean%20modern%20flat%20design%2C%20cream%20background&image_size=landscape_4_3" alt="Three-step flow" width="100%" />

| STEP 01 | STEP 02 | STEP 03 |
|---------|---------|---------|
| **Say "Jarvis"** | **Speak your mind** | **Pick one and send** |
| It wakes up — and screenshots your current screen to understand who you're chatting with and where the convo is at. | Casual, emotional, spoken language works: "Help me respond, but don't be too eager." | Three witty replies to choose from, switchable styles, one-click copy. Done. |

## Live Demo · You vs Zuiti

> 💘 **Romance** — Partner is upset, all you can muster is "oh"
>
> Them: I'm feeling a bit down today 😔
>
> 😶 What you squeeze out: oh, what's wrong
>
> **Zuiti gives you three, pick one:**
> - What's up? Talk to me. Don't carry it alone. If needed I'll curse them out with you, then buy you a good meal. `warm`
> - Who upset you? Tell me, I'll help analyze it, and curse them out too. `loyal`
> - Hug, don't be sad. Want me to tell you a dad joke? Guaranteed laugh. `cute`

> 😎 **Clapback** — Got passive-aggressived, want to flame back
>
> Them: You really posted this with that skill level?
>
> 🤬 What you want to send: wtf did you say
>
> **Zuiti gives you three, pick one:**
> - Looks like you know a lot — perfect, please list three specific improvement suggestions, I want to learn. Anyone can talk, few can do. `smart`
> - Haha thanks for the attention! I think it's pretty good though — why not post a better one so I can learn? `unbothered`
> - Everyone's taste differs — if you don't like it, just scroll past. No need to comment, how exhausting 😄 `deflect`

> 💼 **Workplace tact** — Asking for leave, afraid to look flaky
>
> 😬 Your draft: Boss want take a day off tomorrow
>
> **Zuiti gives you three, pick one:**
> - Boss, I've got personal matters to handle tomorrow, need a day off. I'll push tonight on my current tasks, reach out anytime for emergencies, won't delay progress. `reliable`
> - Hi boss, family matter tomorrow, need a day off. This week's tasks are pre-arranged, handover doc is written, rest assured. `thorough`
> - Boss, can I take tomorrow off? Something urgent. I'll bring you coffee to make up for it ☕ `easy`

> 🌍 **English bonus** — Flagship skill, cross-language flex
>
> You say (in Chinese): Tell them this review can't happen until next week, but be polite, don't burn bridges
>
> **Zuiti → native English:** Thanks for the heads-up! I won't be able to get to this review until next week — really appreciate your patience. Happy to prioritize if it's blocking anything.

## Privacy by Design

- **Wake detection is local only**: openWakeWord runs in browser WASM — no network, no cloud, no API key.
- **No continuous listening**: only triggers after wake word hit.
- **No continuous screen monitoring**: only captures on wake.
- **Rebuttal red line**: witty comebacks only, never personal attacks / profanity / cyberbullying.

## Why Not Just Another AI

| Web AI | Zuiti |
|-----------|------|
| You copy-paste + describe context | 👀 It screenshots itself, understands on summon |
| You type and craft wording | 🎙️ Just speak, casual spoken language works |
| Switch windows, type, copy back and forth | 🛸 Tray-resident, wake by voice, hide when done |

**A real desktop app, not a web PPT.**

## Tech Stack

TypeScript (ESM) · Node ≥ 22 · Electron 42 · `@openai/agents` · zod v4 · onnxruntime-web · @picovoice/web-voice-processor · esbuild

LLM via Xiaomi MiMo (OpenAI-compatible endpoint).

## Quick Start

```bash
npm ci
cp .env.example .env   # fill in MiMo API key
npm run fetch-models   # download openWakeWord ONNX models (~10MB)
npm start
```

Wake word is off by default. Set `WAKE_THRESHOLD=0.5` in `.env` or env to enable, `WAKE_DEBUG=1` for debug logs.

## Development

```bash
npm run typecheck   # dual tsconfig (main + renderer)
npm test            # build + node:test (45 tests, includes arch lint)
npm run build       # compile main + esbuild bundle renderer
```

CI: typecheck + test on push/PR to main (`.github/workflows/ci.yml`).

## Architecture

<img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=software%20architecture%20layered%20diagram%2C%20five%20layers%20from%20bottom%20to%20top%20Types%20Config%20Core%20Modules%20Main%20Renderer%2C%20arrows%20pointing%20upward%2C%20pink%20and%20purple%20color%20scheme%2C%20technical%20clean%20diagram%20style&image_size=landscape_4_3" alt="Architecture layers" width="100%" />

Layered dependencies flow forward only: `Types → Config → Core → Modules → Main → Renderer`.

```
src/
├── core/              # harness base (provider/voice/screenshot/streamparse/skill/log)
├── modules/reply/     # zuiti skill (ReplyCoach Agent + CoachOutput schema)
├── main/              # Electron main process (window/tray/IPC/wake model delivery)
├── renderer/          # HUD overlay + local openWakeWord (esbuild bundled)
├── shared/ipc.ts      # IPC contract (CHANNELS + WakeRuntime + Capabilities)
└── test/              # node:test (includes architecture.test.ts arch lint)
```

Key invariants (mechanically enforced):
1. **`reply` must be the first key in model output JSON** — required for streaming and TTS.
2. **LLM must not use SDK `outputType`** — JSON via `providerData.json_object`, validated by zod.
3. **Layer dependency red line** — renderer never touches Node directly, only via `window.zuiti` (preload contextBridge).

See [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](./AGENTS.md).

## Future · One Meme, A Whole Platform

The base is a general "screen + voice + skill" engine that keeps spawning new scenarios — a zuiti that never stops leveling up.

`✍️ Write Xiaohongshu copy` · `🥊 Battle customer service` · `🔍 Decode passive-aggressive messages` · `💸 Chase client payments` · `📧 Reply to emails you don't want to` · `🌍 Chat with foreigners`

## Docs

- [Design doc (zh)](./docs/design-docs/2026-06-24-zuiti-design.md) — Product positioning / creativity / pain points / hero scenarios
- [Architecture](./ARCHITECTURE.md) — Layers / invariants / directory structure
- [Plans](./docs/PLANS.md) — Plan 1-5 completed, Plan 6 (reading skills) pending
- [Quality score](./docs/QUALITY_SCORE.md) — Per-domain self-assessment
- [Showcase](./docs/showcase/zuiti.html) — Full visual presentation

---

<div align="center">

**Zuiti online, nail it every time.**

</div>
