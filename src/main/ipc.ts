/**
 * 主进程 IPC —— 把渲染层的 coach:run 接到 ReplyCoach，结果推回 coach:result。
 *
 * 流程：renderer send('coach:run', text) → run(ReplyCoach, text) → parseCoachOutput
 *      → webContents.send('coach:result', dto)
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { run } from '@openai/agents';
import { ReplyCoach, buildUserInput, parseCoachOutput } from '../modules/reply/coach.js';
import { initProvider } from '../core/provider.js';
import { log } from '../core/log.js';
import type { CoachOutputDTO } from '../shared/ipc.js';

/** 注册 coach IPC handlers。主进程启动时调用一次。 */
export function registerCoachIpc(mainWindow: BrowserWindow): void {
  // 首次调用时初始化 provider（设 OpenAI client 指向 MiMo）。
  let inited = false;
  const ensureInit = (): void => {
    if (!inited) {
      initProvider();
      inited = true;
    }
  };

  ipcMain.handle('coach:run', async (_e, text: string) => {
    ensureInit();
    mainWindow.webContents.send('coach:loading');
    log.info('coach.run.start', { textLen: text.length });

    try {
      const result = await run(ReplyCoach, buildUserInput(text));
      const raw = (result.finalOutput ?? '').toString();
      const output = parseCoachOutput(raw);
      const dto: CoachOutputDTO = {
        reply: output.reply,
        candidates: output.candidates,
        rationale: output.rationale,
      };
      mainWindow.webContents.send('coach:result', dto);
      log.info('coach.run.done', { replyLen: output.reply.length, candidates: output.candidates.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWindow.webContents.send('coach:error', msg);
      log.error('coach.run.error', { msg });
    }
  });
}
