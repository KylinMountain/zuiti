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
import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { log, type LogLevel } from '../core/log.js';
import { synthesizeSpeechStream, transcribeAudio, parseDataUrl, mimeToAudioMime } from '../core/voice.js';
import { captureScreen, pngToDataUrl } from '../core/screenshot.js';
import { MiraConversation } from '../modules/mira/conversation.js';
import { join, resolve } from 'node:path';
import { CHANNELS, type Capabilities, type WakeRuntime, type ReplyStyle, type DiagStatsDTO } from '../shared/ipc.js';
import { loadConfig, saveConfig } from '../core/config-store.js';
import { initRuntimeConfig, getEffectiveConfig, getAsr } from '../core/runtime-config.js';
import { checkAll, checkLlm, checkAsr, checkTts, type HealthResult } from '../core/service-health.js';
import { classifyError, isClassifiedError } from '../core/errors.js';
import { readRecentRuns, aggregateRuns, buildDiagnostics } from '../core/diagnostics.js';
import { loadWakeStats, saveWakeStats } from '../core/wake-stats-store.js';
import { recordHit, recordMiss, summarize, EMPTY_WAKE_STATS, type WakeStats, type WakeMissReason } from '../shared/wake-stats.js';

/**
 * 注册 coach + voice + capabilities IPC handlers。主进程启动时调用一次。
 * @param wake 唤醒词运行时（null 时功能关闭，渲染层不启动 openWakeWord）。
 */
export function registerCoachIpc(mainWindow: BrowserWindow, wake: WakeRuntime | null): { endConversation: () => void; onWakeHit: () => void } {
  const userDataDir = app.getPath('userData');
  let lastHealth: HealthResult[] = [];

  // ---- plan-13: 唤醒词误触发统计 ----
  let pendingWakeAt: number | null = null;
  let pendingWakeTimer: ReturnType<typeof setTimeout> | null = null;
  const NO_SPEECH_MS = 10_000;
  let wakeStats: WakeStats = loadWakeStats(userDataDir);

  function recordWakeHit(): void {
    wakeStats = recordHit(wakeStats);
    saveWakeStats(userDataDir, wakeStats);
    log.info('wake.stats.hit', { hits: wakeStats.hits, misses: wakeStats.misses });
  }
  function recordWakeMiss(reason: WakeMissReason): void {
    wakeStats = recordMiss(wakeStats, reason);
    saveWakeStats(userDataDir, wakeStats);
    log.info('wake.stats.miss', { reason, hits: wakeStats.hits, misses: wakeStats.misses });
  }
  function isConfigured(): boolean {
    const c = getEffectiveConfig().credential;
    const llmOk = lastHealth.find((h) => h.service === 'llm')?.ok;
    return !!c.apiKey && !!c.baseURL && llmOk === true;
  }

  /** 渲染层启动时查询能力：asr/tts 是否可用 + wake 运行时（含模型 base64）。 */
  ipcMain.handle(CHANNELS.capabilities, async (): Promise<Capabilities> => {
    const cred = getEffectiveConfig().credential;
    if (cred.apiKey && cred.baseURL && !lastHealth.some((h) => h.service === 'llm')) {
      lastHealth = [...lastHealth.filter((h) => h.service !== 'llm'), await checkLlm()];
    }
    return { asr: true, tts: true, wake, configured: isConfigured(), health: lastHealth };
  });

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
    ttsAbortFlag = false; // plan-13: 每轮重置 barge-in 中止标志

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
      // 空轮兜底：sendTurn 未抛但 primary 空且没 skill → 检查 LLM 健康
      if (!output.primary.text.trim() && !output.skillId) {
        const h = await checkLlm();
        lastHealth = [...lastHealth.filter((x) => x.service !== 'llm'), h];
        mainWindow.webContents.send(CHANNELS.configStatus, lastHealth);
        if (!h.ok) {
          mainWindow.webContents.send(CHANNELS.coachError, {
            kind: h.kind ?? 'unknown',
            userMessage: h.message,
            retryable: h.kind === 'network' || h.kind === 'server',
            fixAction: h.kind === 'authInvalid' ? 'openSettings' : undefined,
          });
          return;
        }
      }
      mainWindow.webContents.send(CHANNELS.coachResult, output);
      // 等本轮所有 TTS 合成（首句 + 剩余）排队完，再统一发一次 ttsDone：一轮只发一次，
      // 避免中途 ttsDone 提前重开麦 + 播放时序错乱（几段一起读）。无 TTS（纯候选/空 primary）
      // 时队列已 resolved，立即发 done，让状态机从 thinking 回流 listening。
      await ttsQueue;
      // plan-13: barge-in 已打断时，渲染层已自行处理状态转换，不重复发 ttsDone。
      if (!ttsAbortFlag) mainWindow.webContents.send(CHANNELS.voiceTtsDone);

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
      const classified = isClassifiedError(err) ? err : classifyError({ cause: err });
      mainWindow.webContents.send(CHANNELS.coachError, classified);
      // 若是凭证问题，刷新健康态 + 推送状态点
      if (classified.kind === 'authInvalid') {
        lastHealth = [...lastHealth.filter((h) => h.service !== 'llm'), await checkLlm()];
        mainWindow.webContents.send(CHANNELS.configStatus, lastHealth);
      }
      log.error('coach.run.error', { kind: classified.kind, msg: classified.userMessage, tookMs: Date.now() - t0 });
    }
  }

  /** TTS 串行队列：首句先播，剩余文本排队等播完再播，避免并发混音。 */
  let ttsQueue: Promise<void> = Promise.resolve();
  /** plan-13: barge-in 中止标志——true 时 startTtsStream 跳过推 chunk，runSkillPipeline 不发 ttsDone。 */
  let ttsAbortFlag = false;

  /** TTS 流式合成 + 推给渲染层音频块。串行排队；ttsDone 由 runSkillPipeline 在队列排空后统一发一次。 */
  function startTtsStream(text: string, win: BrowserWindow): void {
    ttsQueue = ttsQueue.then(async () => {
      if (ttsAbortFlag) return; // 已打断，跳过
      const t0 = Date.now();
      let chunkCount = 0;
      try {
        for await (const chunk of await synthesizeSpeechStream(text)) {
          if (ttsAbortFlag) break; // 中途打断，停止推 chunk
          chunkCount++;
          win.webContents.send(CHANNELS.voiceTtsChunk, Buffer.from(chunk).toString('base64'));
        }
        log.info('coach.tts.ok', { chunks: chunkCount, tookMs: Date.now() - t0, textLen: text.length });
      } catch (err) {
        log.warn('coach.tts.failed', {
          msg: err instanceof Error ? err.message : String(err),
          chunks: chunkCount,
          tookMs: Date.now() - t0,
        });
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
        const asrLang = getAsr().lang;
        const text = (await transcribeAudio(bytes, audioMime, asrLang)).trim();
        log.info('voice.transcript', { textLen: text.length });

        if (!text) {
          // plan-13: 唤醒后 ASR 空 → 误触发
          if (pendingWakeAt !== null) { recordWakeMiss('asrEmpty'); pendingWakeAt = null; }
          mainWindow.webContents.send(CHANNELS.coachError, classifyError({ code: 'asrEmpty' }));
          return;
        }
        // plan-13: 唤醒后 ASR 有结果 → 命中
        if (pendingWakeAt !== null) { recordWakeHit(); pendingWakeAt = null; }
        mainWindow.webContents.send(CHANNELS.voiceTranscript, text);
        await runSkillPipeline(text, withScreenshot, style);
      } catch (err) {
        const m = String(err instanceof Error ? err.message : err).match(/\b(4\d\d|5\d\d)\b/);
        const httpStatus = m ? Number(m[1]) : undefined;
        const classified = isClassifiedError(err) ? err : classifyError({ httpStatus, cause: err });
        mainWindow.webContents.send(CHANNELS.coachError, classified);
        if (classified.kind === 'authInvalid') {
          lastHealth = [...lastHealth.filter((h) => h.service !== 'llm'), await checkLlm()];
          mainWindow.webContents.send(CHANNELS.configStatus, lastHealth);
        }
        log.error('voice.recorded.error', { kind: classified.kind });
      }
    })();
  });

  ipcMain.on(CHANNELS.conversationReset, () => {
    endConversation();
  });

  // plan-13: barge-in 打断——渲染层通知主进程停止 TTS 合成。
  ipcMain.on(CHANNELS.voiceBargeIn, () => {
    ttsAbortFlag = true;
    log.info('coach.bargeIn');
  });

  // ---- plan-13: 唤醒词统计 IPC ----
  ipcMain.handle(CHANNELS.wakeStatsGet, (): WakeStats => wakeStats);
  ipcMain.handle(CHANNELS.wakeStatsReset, (): WakeStats => {
    wakeStats = { ...EMPTY_WAKE_STATS };
    saveWakeStats(userDataDir, wakeStats);
    log.info('wake.stats.reset');
    return wakeStats;
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

  // ---- Config IPC ----
  ipcMain.handle(CHANNELS.configGet, () => getEffectiveConfig());

  ipcMain.handle(CHANNELS.configSet, (_e, patch: Parameters<typeof saveConfig>[1]) => {
    const merged = saveConfig(userDataDir, patch);
    initRuntimeConfig(merged, process.env);
    if (patch.credential) {
      // 凭证已变但保活 session 的 pi model registry 在创建时就绑死了旧凭证——
      // 不结束旧会话的话，「去设置改好 key」不会让当前对话真正用上新 key，
      // 必须等用户另外点「新对话」。这里主动结束，下一轮自然用新凭证建新 session。
      endConversation();
      log.info('config.credentialChanged.endConversation');
    }
    log.info('config.saved', { sections: Object.keys(patch) });
    return getEffectiveConfig();
  });

  ipcMain.handle(CHANNELS.configTest, async (_e, service: 'llm' | 'asr' | 'tts' | 'all'): Promise<HealthResult[]> => {
    const fns = { llm: checkLlm, asr: checkAsr, tts: checkTts };
    const results = service === 'all' ? await checkAll() : [await fns[service]()];
    for (const r of results) lastHealth = [...lastHealth.filter((h) => h.service !== r.service), r];
    mainWindow.webContents.send(CHANNELS.configStatus, lastHealth);
    return results;
  });

  // ---- Diagnostics IPC ----
  const logsDir = app.getPath('logs');
  const versions = { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node };

  ipcMain.handle(CHANNELS.diagGet, (): DiagStatsDTO => aggregateRuns(readRecentRuns(logsDir, 20)));
  ipcMain.on(CHANNELS.diagOpenLogs, () => { void shell.openPath(logsDir); });
  ipcMain.handle(CHANNELS.diagExport, (): string => {
    const diag = buildDiagnostics(logsDir, getEffectiveConfig(), versions, 20);
    const file = join(logsDir, `diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(diag, null, 2) + '\n', 'utf8');
    shell.showItemInFolder(file);
    log.info('diag.exported', { file });
    return file;
  });

  /** plan-13: 唤醒词命中时调用——起 10s 待判定计时，超时未说话记 miss(noSpeechTimeout)。 */
  function onWakeHit(): void {
    // 清理前一个待判定计时，避免竞态：旧 timeout 误为新唤醒记 miss
    if (pendingWakeTimer) { clearTimeout(pendingWakeTimer); pendingWakeTimer = null; }
    pendingWakeAt = Date.now();
    pendingWakeTimer = setTimeout(() => {
      pendingWakeTimer = null;
      if (pendingWakeAt !== null) {
        recordWakeMiss('noSpeechTimeout');
        pendingWakeAt = null;
      }
    }, NO_SPEECH_MS);
  }

  return { endConversation, onWakeHit };
}
