/**
 * 主进程 IPC —— 嘴替完整语音流程编排（Plan 7: 用 skill-runner 纯函数）。
 *
 * 流程：
 * 1. renderer send('coach:run', text) → runSkill（纯函数）→ coach:result（SkillOutput）
 *    → reply 走流式蹦字 + TTS 首句先播
 * 2. renderer send('voice:recorded', base64DataUrl) → 解码 → ASR → voice:transcript
 *    → 自动跑 skill 流水线（同 1）
 *
 * 截屏看屏：coach:run 时可选附 screenshotDataUrl；或主进程自动截屏（Plan 3 Task 2）。
 *
 * Plan 7: 核心逻辑抽到 modules/skill-runner.ts（不依赖 BrowserWindow），本文件只负责
 * IPC 编排（send/chunk/TTS）+ 截屏 + 错误回送。
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { log, type LogLevel } from '../core/log.js';
import { synthesizeSpeechStream, transcribeAudio, parseDataUrl, mimeToAudioMime } from '../core/voice.js';
import { captureScreen, pngToDataUrl } from '../core/screenshot.js';
import { containsWakeWord } from '../core/wakeword.js';
import { runSkill } from '../modules/skill-runner.js';
import { CHANNELS, type Capabilities, type WakeRuntime } from '../shared/ipc.js';

/**
 * 注册 coach + voice + capabilities IPC handlers。主进程启动时调用一次。
 * @param wake 唤醒词运行时（null 时功能关闭，渲染层不启动 openWakeWord）。
 */
export function registerCoachIpc(mainWindow: BrowserWindow, wake: WakeRuntime | null): void {
  /** 渲染层启动时查询能力：asr/tts 是否可用 + wake 运行时（含模型 base64）。 */
  ipcMain.handle(CHANNELS.capabilities, async (): Promise<Capabilities> => ({
    asr: true,
    tts: true,
    wake,
  }));

  /** 渲染层日志转发：写入同一个日志文件，agent 可统一分析。 */
  ipcMain.on(CHANNELS.rendererLog, (_e, level: string, msg: string, extra?: Record<string, unknown>) => {
    const lv = (['debug', 'info', 'warn', 'error'] as const).includes(level as never)
      ? (level as LogLevel)
      : 'info';
    log[lv]('renderer:' + msg, extra);
  });

  /**
   * skill 核心流水线（Plan 7: 委托给 runSkill 纯函数）：
   * text → 截屏（可选）→ runSkill → coach:result (SkillOutput)。
   *
   * - reply：流式蹦字 + TTS 首句先播
   * - explain/summarize：非流式一次性显示，不走 TTS
   */
  async function runSkillPipeline(text: string, withScreenshot: boolean): Promise<void> {
    const t0 = Date.now();
    log.info('coach.run.start', {
      inputLen: text.length,
      withScreenshot,
    });
    mainWindow.webContents.send(CHANNELS.coachLoading);

    let screenshotDataUrl: string | undefined;
    if (withScreenshot) {
      try {
        const t1 = Date.now();
        const png = await captureScreen();
        screenshotDataUrl = pngToDataUrl(png);
        log.info('coach.screenshot.ok', { bytes: png.length, tookMs: Date.now() - t1 });
      } catch (err) {
        log.warn('coach.screenshot.failed', { msg: err instanceof Error ? err.message : String(err) });
      }
    }

    try {
      const { output, summary } = await runSkill(text, screenshotDataUrl, {
        onReplyChunk: (reply) => mainWindow.webContents.send(CHANNELS.coachReplyChunk, reply),
        onTtsStart: (firstSentence) => startTtsStream(firstSentence, mainWindow),
      });
      mainWindow.webContents.send(CHANNELS.coachResult, output);
      log.info('coach.run.ok', {
        tookMs: Date.now() - t0,
        skillId: summary.skillId,
        inputLen: summary.inputLen,
        outputShape: summary.outputShape,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      mainWindow.webContents.send(CHANNELS.coachError, msg);
      log.error('coach.run.error', { msg, stack, tookMs: Date.now() - t0 });
    }
  }

  /** TTS 流式合成 + 推给渲染层。失败发 ttsDone 让渲染层复位。 */
  function startTtsStream(text: string, win: BrowserWindow): void {
    void (async () => {
      const t0 = Date.now();
      let chunkCount = 0;
      try {
        for await (const chunk of await synthesizeSpeechStream(text)) {
          chunkCount++;
          win.webContents.send(CHANNELS.voiceTtsChunk, Buffer.from(chunk).toString('base64'));
        }
        win.webContents.send(CHANNELS.voiceTtsDone);
        log.info('coach.tts.ok', { chunks: chunkCount, tookMs: Date.now() - t0 });
      } catch (err) {
        log.warn('coach.tts.failed', {
          msg: err instanceof Error ? err.message : String(err),
          chunks: chunkCount,
          tookMs: Date.now() - t0,
        });
        win.webContents.send(CHANNELS.voiceTtsDone);
      }
    })();
  }

  // 注意：preload 用 ipcRenderer.send（fire-and-forget），主进程用 ipcMain.on。
  ipcMain.on(CHANNELS.coachRun, (_e, text: string, withScreenshot = false) => {
    void runSkillPipeline(text, withScreenshot);
  });

  /** voice:recorded → ASR → voice:transcript → 自动 skill 流水线。withScreenshot=true 时截屏看屏。 */
  ipcMain.on(CHANNELS.voiceRecorded, (_e, base64DataUrl: string, withScreenshot = false) => {
    log.info('voice.recorded', { bytes: base64DataUrl.length, withScreenshot });

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
        await runSkillPipeline(text, withScreenshot);
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
