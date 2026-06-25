/**
 * 主进程 IPC —— 嘴替完整语音流程编排。
 *
 * 流程：
 * 1. renderer send('coach:run', text) → run(ReplyCoach, buildUserInput(text, screenshot?))
 *    → parseCoachOutput → coach:result（含 candidates）→ TTS 流式
 * 2. renderer send('voice:recorded', base64DataUrl) → 解码 → ASR → voice:transcript
 *    → 自动 coach:run 流程（同 1）→ TTS 流式
 *
 * 截屏看屏：coach:run 时可选附 screenshotDataUrl；或主进程自动截屏（Plan 3 Task 2）。
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { run } from '@openai/agents';
import { ReplyCoach, buildUserInput, parseCoachOutput } from '../modules/reply/coach.js';
import { initProvider } from '../core/provider.js';
import { log } from '../core/log.js';
import { ReplyExtractor } from '../core/streamparse.js';
import { synthesizeSpeechStream, transcribeAudio, parseDataUrl, mimeToAudioMime } from '../core/voice.js';
import { captureScreen, pngToDataUrl } from '../core/screenshot.js';
import { containsWakeWord } from '../core/wakeword.js';
import { CHANNELS, type Capabilities, type CoachOutputDTO, type WakeRuntime } from '../shared/ipc.js';

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

  /** coach 核心流水线：text → 截屏（可选）→ ReplyCoach 流式 → coach:result → TTS 流式。 */
  async function runCoachPipeline(text: string, withScreenshot: boolean): Promise<void> {
    mainWindow.webContents.send('coach:loading');
    log.info('coach.run.start', { textLen: text.length, withScreenshot });

    try {
      // 截屏看屏（红线：只在被唤醒/触发时截一次）
      let screenshotDataUrl: string | undefined;
      if (withScreenshot) {
        try {
          const png = await captureScreen();
          screenshotDataUrl = pngToDataUrl(png);
        } catch (err) {
          log.warn('coach.screenshot.failed', { msg: err instanceof Error ? err.message : String(err) });
        }
      }

      // 流式 run：边生成边推 reply 增量给渲染层蹦字（兑现不变量 1）
      const stream = await run(ReplyCoach, buildUserInput(text, screenshotDataUrl), { stream: true });
      const extractor = new ReplyExtractor();
      let lastPushedLen = 0;
      for await (const ev of stream) {
        if (ev.type !== 'raw_model_stream_event') continue;
        const chunk = extractDelta(ev.data);
        if (!chunk) continue;
        const reply = extractor.push(chunk);
        // 只推增量，省 IPC 流量
        if (reply.length > lastPushedLen) {
          mainWindow.webContents.send('coach:replyChunk', reply);
          lastPushedLen = reply.length;
        }
      }
      log.info('coach.stream.done', { replyLen: extractor.replyText.length });

      const raw = (stream.finalOutput ?? '').toString();
      const output = parseCoachOutput(raw);
      const dto: CoachOutputDTO = {
        reply: output.reply,
        candidates: output.candidates,
        rationale: output.rationale,
      };
      mainWindow.webContents.send('coach:result', dto);
      log.info('coach.run.done', { replyLen: output.reply.length, candidates: output.candidates.length });

      // TTS 首句先播：流式合成 reply，边合成边推给渲染层
      void (async () => {
        try {
          for await (const chunk of await synthesizeSpeechStream(output.reply)) {
            mainWindow.webContents.send('voice:ttsChunk', Buffer.from(chunk).toString('base64'));
          }
          mainWindow.webContents.send('voice:ttsDone');
        } catch (err) {
          log.warn('coach.tts.failed', { msg: err instanceof Error ? err.message : String(err) });
          mainWindow.webContents.send('voice:ttsDone');
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWindow.webContents.send('coach:error', msg);
      log.error('coach.run.error', { msg });
    }
  }

  // 注意：preload 用 ipcRenderer.send（fire-and-forget），主进程用 ipcMain.on。
  // 之前误用 ipcMain.handle（只匹配 invoke），已修正。
  ipcMain.on('coach:run', (_e, text: string, withScreenshot = false) => {
    ensureInit();
    void runCoachPipeline(text, withScreenshot);
  });

  /** voice:recorded → ASR → voice:transcript → 自动 coach 流水线（点一下说话模式）。 */
  ipcMain.on('voice:recorded', (_e, base64DataUrl: string) => {
    ensureInit();
    log.info('voice.recorded', { bytes: base64DataUrl.length });

    void (async () => {
      try {
        const { mime, bytes } = parseDataUrl(base64DataUrl);
        const audioMime = mimeToAudioMime(mime);
        const text = (await transcribeAudio(bytes, audioMime, 'zh')).trim();
        log.info('voice.transcript', { textLen: text.length });

        if (!text) {
          mainWindow.webContents.send('voice:error', '没听清，再说一次？');
          return;
        }
        mainWindow.webContents.send('voice:transcript', text);
        await runCoachPipeline(text, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mainWindow.webContents.send('voice:error', msg);
        log.error('voice.recorded.error', { msg });
      }
    })();
  });

  /**
   * voice:wakeCheck → ASR → containsWakeWord 判定。
   * - 命中：voice:transcript 回填 + 自动跑 coach 流水线（带截图）。
   * - 未命中：voice:wakeMiss（渲染层继续监听）。
   *
   * 耳听八方模式专用：持续监听麦克，每段话先 ASR 再判定是否含"Jarvis"。
   * 命中即唤醒，整段当命令送 coach（"Jarvis 帮我怼回去" 一句话搞定）。
   */
  ipcMain.on('voice:wakeCheck', (_e, base64DataUrl: string) => {
    ensureInit();
    log.info('voice.wakeCheck', { bytes: base64DataUrl.length });

    void (async () => {
      try {
        const { mime, bytes } = parseDataUrl(base64DataUrl);
        const audioMime = mimeToAudioMime(mime);
        const text = (await transcribeAudio(bytes, audioMime, 'auto')).trim();
        log.info('voice.wakeCheck.asr', { textLen: text.length, hit: containsWakeWord(text) });

        if (!text) {
          mainWindow.webContents.send('voice:wakeMiss', '');
          return;
        }
        if (!containsWakeWord(text)) {
          mainWindow.webContents.send('voice:wakeMiss', text);
          return;
        }
        // 命中唤醒词：整段当命令，回填 + 自动跑 coach（带截图，唤醒后看屏）
        mainWindow.webContents.send('voice:transcript', text);
        await runCoachPipeline(text, true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mainWindow.webContents.send('voice:error', msg);
        log.error('voice.wakeCheck.error', { msg });
      }
    })();
  });
}
