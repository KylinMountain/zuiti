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
import { synthesizeSpeechStream, transcribeAudio, parseDataUrl, mimeToAudioMime } from '../core/voice.js';
import { captureScreen, pngToDataUrl } from '../core/screenshot.js';
import type { CoachOutputDTO } from '../shared/ipc.js';

/** 注册 coach + voice IPC handlers。主进程启动时调用一次。 */
export function registerCoachIpc(mainWindow: BrowserWindow): void {
  let inited = false;
  const ensureInit = (): void => {
    if (!inited) {
      initProvider();
      inited = true;
    }
  };

  /** coach 核心流水线：text → 截屏（可选）→ ReplyCoach → coach:result → TTS 流式。 */
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

      const result = await run(ReplyCoach, buildUserInput(text, screenshotDataUrl));
      const raw = (result.finalOutput ?? '').toString();
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

  ipcMain.handle('coach:run', async (_e, text: string, withScreenshot = false) => {
    ensureInit();
    await runCoachPipeline(text, withScreenshot);
  });

  ipcMain.handle('voice:recorded', async (_e, base64DataUrl: string) => {
    ensureInit();
    log.info('voice.recorded', { bytes: base64DataUrl.length });

    try {
      const { mime, bytes } = parseDataUrl(base64DataUrl);
      const audioMime = mimeToAudioMime(mime);
      const text = (await transcribeAudio(bytes, audioMime, 'zh')).trim();
      log.info('voice.transcript', { textLen: text.length });

      if (!text) {
        mainWindow.webContents.send('voice:error', '没听清，再说一次？');
        return;
      }
      // 转写结果回填渲染层 textarea（用户可微调后重发，或自动跑 coach）
      mainWindow.webContents.send('voice:transcript', text);

      // 自动跑 coach：保留当前 screenshot 复选框状态由渲染层决定，这里默认 false
      // 渲染层若想在语音流程也带截屏，可在 onTranscript 里自己调 runCoach(text, true)
      await runCoachPipeline(text, false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWindow.webContents.send('voice:error', msg);
      log.error('voice.recorded.error', { msg });
    }
  });
}
