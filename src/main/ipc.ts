/**
 * 主进程 IPC —— 嘴替完整语音流程编排（Plan 6: skill 自动路由）。
 *
 * 流程：
 * 1. renderer send('coach:run', text) → router 判断 skillId → 跑对应 skill Agent
 *    → coach:result（SkillOutput 联合类型）→ reply 走流式蹦字 + TTS
 * 2. renderer send('voice:recorded', base64DataUrl) → 解码 → ASR → voice:transcript
 *    → 自动跑 skill 流水线（同 1）
 *
 * 截屏看屏：coach:run 时可选附 screenshotDataUrl；或主进程自动截屏（Plan 3 Task 2）。
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { run } from '@openai/agents';
import { initProvider } from '../core/provider.js';
import { log } from '../core/log.js';
import { ReplyExtractor } from '../core/streamparse.js';
import { synthesizeSpeechStream, transcribeAudio, parseDataUrl, mimeToAudioMime } from '../core/voice.js';
import { captureScreen, pngToDataUrl } from '../core/screenshot.js';
import { containsWakeWord } from '../core/wakeword.js';
import { getSkill } from '../core/skill.js';
import { classifyIntentHeuristic, routeSkillWithLlm } from '../modules/router.js';
import { registerAllSkills } from '../modules/index.js';
import { CHANNELS, type Capabilities, type SkillOutput, type WakeRuntime } from '../shared/ipc.js';

/** 从一个 SDK raw stream event 提取文本 delta（兼容 responses API 与 chat_completions API）。 */
function extractDelta(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  // responses API: { type: 'response.output_text.delta', delta: string }
  if (typeof d.delta === 'string') return d.delta;
  // chat_completions: { choices: [{ delta: { content: string } }] }
  const choices = d.choices as { delta?: { content?: string } }[] | undefined;
  const c = choices?.[0]?.delta?.content;
  return typeof c === 'string' ? c : '';
}

/**
 * 注册 coach + voice + capabilities IPC handlers。主进程启动时调用一次。
 * @param wake 唤醒词运行时（null 时功能关闭，渲染层不启动 openWakeWord）。
 */
export function registerCoachIpc(mainWindow: BrowserWindow, wake: WakeRuntime | null): void {
  // Plan 6: 注册全部 skill（reply/explain/summarize）
  registerAllSkills();

  let inited = false;
  const ensureInit = (): void => {
    if (!inited) {
      initProvider();
      inited = true;
    }
  };

  /** 渲染层启动时查询能力：asr/tts 是否可用 + wake 运行时（含模型 base64）。 */
  ipcMain.handle(CHANNELS.capabilities, async (): Promise<Capabilities> => ({
    asr: true,
    tts: true,
    wake,
  }));

  /**
   * skill 核心流水线（Plan 6）：
   * text → 截屏（可选）→ router 判断 skillId → 跑对应 skill → coach:result (SkillOutput)。
   *
   * - reply：流式蹦字 + TTS 首句先播
   * - explain/summarize：非流式一次性显示，不走 TTS
   */
  async function runSkillPipeline(text: string, withScreenshot: boolean): Promise<void> {
    mainWindow.webContents.send(CHANNELS.coachLoading);

    // 截屏看屏（红线：只在被唤醒/触发时截一次）
    // 提前截屏：LLM 路由也要看屏判断意图
    let screenshotDataUrl: string | undefined;
    if (withScreenshot) {
      try {
        const png = await captureScreen();
        screenshotDataUrl = pngToDataUrl(png);
      } catch (err) {
        log.warn('coach.screenshot.failed', { msg: err instanceof Error ? err.message : String(err) });
      }
    }

    // LLM 精确路由（3s 超时回退 heuristic）
    const skillId = await routeSkillWithLlm(text, screenshotDataUrl);
    const skill = getSkill(skillId);
    if (!skill) {
      mainWindow.webContents.send(CHANNELS.coachError, `skill "${skillId}" 未注册`);
      return;
    }
    log.info('skill.route', { skillId, textLen: text.length, withScreenshot, heuristic: classifyIntentHeuristic(text) });

    try {
      if (skillId === 'reply') {
        await runReplySkill(skill, text, screenshotDataUrl);
      } else {
        await runReadingSkill(skill, skillId, text, screenshotDataUrl);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWindow.webContents.send(CHANNELS.coachError, msg);
      log.error('skill.run.error', { skillId, msg });
    }
  }

  /** reply skill：流式蹦字 + TTS 首句先播（不变量 1：reply 第一键）。 */
  async function runReplySkill(skill: ReturnType<typeof getSkill>, text: string, screenshotDataUrl: string | undefined): Promise<void> {
    if (!skill) return;
    const stream = await run(skill.agent, skill.buildInput(text, screenshotDataUrl) as never, { stream: true });
    const extractor = new ReplyExtractor();
    let lastPushedLen = 0;
    let ttsStarted = false;
    let firstSentence = '';

    // 首句边界检测：句号/感叹号/问号/换行/分号都算一句结束
    const firstSentenceEnd = /[。！？!?;\n]/;

    for await (const ev of stream) {
      if (ev.type !== 'raw_model_stream_event') continue;
      const chunk = extractDelta(ev.data);
      if (!chunk) continue;
      const reply = extractor.push(chunk);
      if (reply.length > lastPushedLen) {
        mainWindow.webContents.send(CHANNELS.coachReplyChunk, reply);
        lastPushedLen = reply.length;
      }
      // TTS 首句先播：检测到首句边界就启动 TTS（不等全部收完）
      if (!ttsStarted && firstSentenceEnd.test(reply)) {
        const match = reply.match(firstSentenceEnd);
        if (match && match.index !== undefined) {
          firstSentence = reply.slice(0, match.index + 1);
          if (firstSentence.length >= 2) {  // 至少 2 字符才播，避免单个标点
            ttsStarted = true;
            startTtsStream(firstSentence, mainWindow);
          }
        }
      }
    }
    log.info('coach.stream.done', { replyLen: extractor.replyText.length, ttsFirstSentence: ttsStarted });

    const raw = (stream.finalOutput ?? '').toString();
    const output = skill.parseOutput(raw) as { reply: string; candidates: { text: string; style: string }[]; rationale: string };
    const dto: SkillOutput = { skillId: 'reply', ...output };
    mainWindow.webContents.send(CHANNELS.coachResult, dto);
    log.info('skill.reply.done', { replyLen: output.reply.length, candidates: output.candidates.length });

    // 若流式期间未触发 TTS（回复太短无标点），用完整 reply 兜底
    if (!ttsStarted) {
      startTtsStream(output.reply, mainWindow);
    }
  }

  /** TTS 流式合成 + 推给渲染层。失败发 ttsDone 让渲染层复位。 */
  function startTtsStream(text: string, win: BrowserWindow): void {
    void (async () => {
      try {
        for await (const chunk of await synthesizeSpeechStream(text)) {
          win.webContents.send(CHANNELS.voiceTtsChunk, Buffer.from(chunk).toString('base64'));
        }
        win.webContents.send(CHANNELS.voiceTtsDone);
      } catch (err) {
        log.warn('coach.tts.failed', { msg: err instanceof Error ? err.message : String(err) });
        win.webContents.send(CHANNELS.voiceTtsDone);
      }
    })();
  }

  /** explain/summarize skill：非流式一次性显示，不走 TTS。 */
  async function runReadingSkill(
    skill: ReturnType<typeof getSkill>,
    skillId: 'explain' | 'summarize',
    text: string,
    screenshotDataUrl: string | undefined,
  ): Promise<void> {
    if (!skill) return;
    const result = await run(skill.agent, skill.buildInput(text, screenshotDataUrl) as never);
    const raw = (result.finalOutput ?? '').toString();
    const output = skill.parseOutput(raw);
    const dto = { skillId, ...(output as object) } as SkillOutput;
    mainWindow.webContents.send(CHANNELS.coachResult, dto);
    log.info('skill.reading.done', { skillId, rawLen: raw.length });
  }

  // 注意：preload 用 ipcRenderer.send（fire-and-forget），主进程用 ipcMain.on。
  ipcMain.on(CHANNELS.coachRun, (_e, text: string, withScreenshot = false) => {
    ensureInit();
    void runSkillPipeline(text, withScreenshot);
  });

  /** voice:recorded → ASR → voice:transcript → 自动 skill 流水线（点一下说话模式）。 */
  ipcMain.on(CHANNELS.voiceRecorded, (_e, base64DataUrl: string) => {
    ensureInit();
    log.info('voice.recorded', { bytes: base64DataUrl.length });

    void (async () => {
      try {
        const { mime, bytes } = parseDataUrl(base64DataUrl);
        const audioMime = mimeToAudioMime(mime);
        const text = (await transcribeAudio(bytes, audioMime, 'zh')).trim();
        log.info('voice.transcript', { textLen: text.length });

        if (!text) {
          mainWindow.webContents.send(CHANNELS.voiceError, '没听清，再说一次？');
          return;
        }
        mainWindow.webContents.send(CHANNELS.voiceTranscript, text);
        await runSkillPipeline(text, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mainWindow.webContents.send(CHANNELS.voiceError, msg);
        log.error('voice.recorded.error', { msg });
      }
    })();
  });

  /**
   * voice:wakeCheck → ASR → containsWakeWord 判定。
   * - 命中：voice:transcript 回填 + 自动跑 skill 流水线（带截图）。
   * - 未命中：voice:wakeMiss（渲染层继续监听）。
   */
  ipcMain.on(CHANNELS.voiceWakeCheck, (_e, base64DataUrl: string) => {
    ensureInit();
    log.info('voice.wakeCheck', { bytes: base64DataUrl.length });

    void (async () => {
      try {
        const { mime, bytes } = parseDataUrl(base64DataUrl);
        const audioMime = mimeToAudioMime(mime);
        const text = (await transcribeAudio(bytes, audioMime, 'auto')).trim();
        log.info('voice.wakeCheck.asr', { textLen: text.length, hit: containsWakeWord(text) });

        if (!text) {
          mainWindow.webContents.send(CHANNELS.voiceWakeMiss, '');
          return;
        }
        if (!containsWakeWord(text)) {
          mainWindow.webContents.send(CHANNELS.voiceWakeMiss, text);
          return;
        }
        // 命中唤醒词：整段当命令，回填 + 自动跑 skill（带截图，唤醒后看屏）
        mainWindow.webContents.send(CHANNELS.voiceTranscript, text);
        await runSkillPipeline(text, true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mainWindow.webContents.send(CHANNELS.voiceError, msg);
        log.error('voice.wakeCheck.error', { msg });
      }
    })();
  });
}
