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
import { app, ipcMain, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { log, type LogLevel } from '../core/log.js';
import { synthesizeSpeechStream, transcribeAudio, parseDataUrl, mimeToAudioMime } from '../core/voice.js';
import { captureScreen, pngToDataUrl } from '../core/screenshot.js';
import { MiraConversation } from '../modules/mira/conversation.js';
import { join } from 'node:path';
import { CHANNELS, type Capabilities, type WakeRuntime, type ReplyStyle } from '../shared/ipc.js';

/**
 * 注册 coach + voice + capabilities IPC handlers。主进程启动时调用一次。
 * @param wake 唤醒词运行时（null 时功能关闭，渲染层不启动 openWakeWord）。
 */
export function registerCoachIpc(mainWindow: BrowserWindow, wake: WakeRuntime | null): { endConversation: () => void } {
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

  /** 本次对话的保活会话（多轮记忆）。conversationReset / panelHide 时 dispose。 */
  let conversation: MiraConversation | null = null;
  function getConversation(): MiraConversation {
    if (!conversation) conversation = new MiraConversation();
    return conversation;
  }
  function endConversation(): void {
    conversation?.dispose();
    conversation = null;
    log.info('conversation.ended');
  }

  // ---- History helpers (used by runSkillPipeline below) ----
  const historyPath = join(app.getPath('userData'), 'zuiti-history.json');

  function readHistoryFile(): unknown[] {
    try {
      const data = readFileSync(historyPath, 'utf8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  /**
   * skill 核心流水线（Plan 7: 委托给 runSkill 纯函数）：
   * text → 截屏（可选）→ runSkill → coach:result (SkillOutput)。
   *
   * - reply：流式蹦字 + TTS 首句先播
   * - explain/summarize：非流式一次性显示，不走 TTS
   */
  async function runSkillPipeline(text: string, withScreenshot: boolean, style?: ReplyStyle): Promise<void> {
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

    // Send screenshot preview to renderer
    if (screenshotDataUrl) {
      mainWindow.webContents.send(CHANNELS.coachScreenshot, screenshotDataUrl);
    }

    try {
      const { output, summary } = await getConversation().sendTurn(text, screenshotDataUrl, {
        onReplyChunk: (reply) => mainWindow.webContents.send(CHANNELS.coachReplyChunk, reply),
        onTtsStart: (firstSentence) => startTtsStream(firstSentence, mainWindow),
        style,
      });
      mainWindow.webContents.send(CHANNELS.coachResult, output);

      // Append to history
      try {
        const entry = { id: Date.now(), ts: Date.now(), input: text.slice(0, 100), output: output.primary?.text.slice(0, 200) ?? '', style };
        const history = readHistoryFile();
        history.push(entry);
        // Keep only last 100 entries
        if (history.length > 100) history.splice(0, history.length - 100);
        writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
      } catch (err) {
        log.warn('history.append.failed', { msg: err instanceof Error ? err.message : String(err) });
      }

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

  /** TTS 串行队列：首句先播，剩余文本排队等播完再播，避免并发混音。 */
  let ttsQueue: Promise<void> = Promise.resolve();

  /** TTS 流式合成 + 推给渲染层。失败发 ttsDone 让渲染层复位。串行排队。 */
  function startTtsStream(text: string, win: BrowserWindow): void {
    ttsQueue = ttsQueue.then(async () => {
      const t0 = Date.now();
      let chunkCount = 0;
      try {
        for await (const chunk of await synthesizeSpeechStream(text)) {
          chunkCount++;
          win.webContents.send(CHANNELS.voiceTtsChunk, Buffer.from(chunk).toString('base64'));
        }
        win.webContents.send(CHANNELS.voiceTtsDone);
        log.info('coach.tts.ok', { chunks: chunkCount, tookMs: Date.now() - t0, textLen: text.length });
      } catch (err) {
        log.warn('coach.tts.failed', {
          msg: err instanceof Error ? err.message : String(err),
          chunks: chunkCount,
          tookMs: Date.now() - t0,
        });
        win.webContents.send(CHANNELS.voiceTtsDone);
      }
    });
  }

  // 注意：preload 用 ipcRenderer.send（fire-and-forget），主进程用 ipcMain.on。
  ipcMain.on(CHANNELS.coachRun, (_e, text: string, withScreenshot = false, style?: ReplyStyle) => {
    void runSkillPipeline(text, withScreenshot, style);
  });

  /** voice:recorded → ASR → voice:transcript → 自动 skill 流水线。withScreenshot=true 时截屏看屏。 */
  ipcMain.on(CHANNELS.voiceRecorded, (_e, base64DataUrl: string, withScreenshot = false, style?: ReplyStyle) => {
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
        await runSkillPipeline(text, withScreenshot, style);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        mainWindow.webContents.send(CHANNELS.voiceError, msg);
        log.error('voice.recorded.error', { msg });
      }
    })();
  });

  ipcMain.on(CHANNELS.conversationReset, () => {
    endConversation();
  });

  // ---- History IPC ----
  ipcMain.handle(CHANNELS.historyList, (_e, limit = 20): unknown[] => {
    const all = readHistoryFile();
    return all.slice(-limit).reverse();
  });

  ipcMain.handle(CHANNELS.historyClear, (): void => {
    try {
      unlinkSync(historyPath);
      log.info('history.cleared');
    } catch { /* file may not exist */ }
  });

  // ---- Settings IPC ----
  const settingsPath = join(app.getPath('userData'), 'zuiti-settings.json');

  function readSettingsFile(): Record<string, unknown> {
    try { return JSON.parse(readFileSync(settingsPath, 'utf8')); }
    catch { return {}; }
  }

  ipcMain.handle(CHANNELS.settingsGet, (_e, key?: string): Record<string, unknown> => {
    const all = readSettingsFile();
    if (key) return { [key]: all[key] };
    return all;
  });

  ipcMain.handle(CHANNELS.settingsSet, (_e, patch: Record<string, unknown>): void => {
    const all = readSettingsFile();
    Object.assign(all, patch);
    try {
      writeFileSync(settingsPath, JSON.stringify(all, null, 2), 'utf8');
      log.info('settings.saved', { keys: Object.keys(patch) });
    } catch (err) {
      log.error('settings.save.failed', { msg: err instanceof Error ? err.message : String(err) });
    }
  });

  return { endConversation };
}
