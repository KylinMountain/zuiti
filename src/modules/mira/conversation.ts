/**
 * 嘴替多轮会话（Plan 9）：一个保活的 pi session 跨轮 sendUserMessage = 多轮记忆。
 *
 * 与单轮 runSkill 的区别：session 不每轮 dispose；截图只在带图轮作为 image block 喂入；
 * emit 每轮 reset，确保拿到的是本轮候选；本轮没调 emit → items:[]（"该聊就聊"）。
 *
 * 模型锁定：session 在首轮按"首轮是否带截图"选模型（带图→多模态 mimo-v2.5，纯文本→pro）。
 * 若纯文本 session 之后某轮需要看屏，则重建 session（记忆重置，记 warn）。
 */
import { createMiraSession } from './session.js';
import { log, newRunId, writeRunSummary, type RunSummary } from '../../core/log.js';
import { classifyError } from '../../core/errors.js';
import type { UniversalOutput, ReplyStyle } from '../../shared/ipc.js';
import type { EmitResult } from '../../core/emit-tool.js';

/** 从 provider 错误对象/文本里尽力抠出 HTTP 状态码。 */
function extractHttpStatus(e: unknown): number | undefined {
  const anyE = e as { status?: number; statusCode?: number; response?: { status?: number } };
  if (typeof anyE?.status === 'number') return anyE.status;
  if (typeof anyE?.statusCode === 'number') return anyE.statusCode;
  if (typeof anyE?.response?.status === 'number') return anyE.response.status;
  const m = String(e).match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

export interface RunSkillCallbacks {
  onReplyChunk?(primarySoFar: string): void;
  onTtsStart?(firstSentence: string): void;
  style?: ReplyStyle;
}
export interface RunSkillResult {
  output: UniversalOutput;
  summary: RunSummary;
}

const FIRST_SENTENCE_END = /[。！？!?;\n]/;

function stripToolInvocation(raw: string): string {
  const idx = raw.indexOf('<tool_invocation');
  return idx >= 0 ? raw.slice(0, idx).trimEnd() : raw;
}
function safeJson(e: unknown): string {
  try { return JSON.stringify(e) ?? ''; } catch { return ''; }
}
/** 从 pi 事件 JSON 里探测 agent read 了哪个 skill（任意 skill 目录名，不限硬编码列表）。 */
export function detectSkillId(eventJson: string): string | undefined {
  const m = eventJson.match(/skills\/([a-zA-Z0-9_-]+)\/SKILL\.md/);
  return m?.[1];
}
function dataUrlToImage(dataUrl: string): { type: 'image'; data: string; mimeType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('非法 image data URL');
  return { type: 'image', data: m[2] as string, mimeType: m[1] as string };
}

const STYLE_LABELS: Record<ReplyStyle, string> = {
  empathy: '高情商（温暖、共情、善解人意）',
  roast: '毒舌（犀利、机智、有理有据地怼，严禁人身攻击）',
  formal: '正式（专业、得体、不卑不亢，适合职场/邮件）',
  casual: '随意（轻松、口语化、有梗、朋友间聊天语气）',
  english: '英文（用流利地道的英语回复，不要机翻味）',
};
function styleLabel(style: ReplyStyle): string {
  return STYLE_LABELS[style] ?? style;
}

export class MiraConversation {
  private session: Awaited<ReturnType<typeof createMiraSession>>['session'] | null = null;
  private getEmit: (() => EmitResult | null) | null = null;
  private resetEmit: (() => void) | null = null;
  private multimodal = false;
  private turnCount = 0;

  private async ensureSession(needImage: boolean): Promise<void> {
    if (this.session && (!needImage || this.multimodal)) return;
    if (this.session) {
      log.warn('conversation.recreate', { reason: 'text session needs image; memory reset' });
      this.dispose();
    }
    const s = await createMiraSession(needImage);
    this.session = s.session;
    this.getEmit = s.getEmit;
    this.resetEmit = s.resetEmit;
    this.multimodal = needImage;
  }

  async sendTurn(
    text: string,
    screenshotDataUrl: string | undefined,
    callbacks?: RunSkillCallbacks,
  ): Promise<RunSkillResult> {
    const runId = newRunId();
    const startTs = Date.now();
    const needImage = !!screenshotDataUrl;
    log.info('conversation.turn.start', {
      runId, turn: this.turnCount, inputLen: text.length, hasScreenshot: needImage,
    });
    await this.ensureSession(needImage);
    const session = this.session!;
    this.resetEmit?.();

    let rawPrimary = '';
    let primary = '';
    let skillRead: string | undefined;
    let ttsStarted = false;
    let ttsStartedLen = 0;
    let providerError: unknown = null;

    const unsub = session.subscribe((e) => {
      const j = safeJson(e);
      const detected = detectSkillId(j);
      if (detected && !skillRead) {
        skillRead = detected;
        log.info('skill.selected', { runId, skillId: skillRead, latencyMs: Date.now() - startTs });
      }
      // Capture pi provider errors: e.message.stopReason === 'error' (e.g. 401 Invalid API Key)
      const msg = (e as { message?: { stopReason?: string; errorMessage?: string } }).message;
      if (msg?.stopReason === 'error' && msg.errorMessage && !providerError) {
        providerError = msg.errorMessage;
      }
      // Fallback: top-level errorEvent or error field
      const errTop = (e as { errorEvent?: { error?: unknown; message?: string }; error?: unknown }).errorEvent
        ?? (e as { error?: unknown }).error;
      if (errTop && !providerError) providerError = errTop;
      // Fallback: assistantMessageEvent.type === 'error'
      const ameErr = (e as { assistantMessageEvent?: { type?: string; error?: unknown; message?: string } }).assistantMessageEvent;
      if (ameErr?.type === 'error' && !providerError) providerError = ameErr.error ?? ameErr.message ?? 'assistant error';
      const ame = (e as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
      if (ame?.type === 'text_delta' && ame.delta) {
        rawPrimary += ame.delta;
        primary = stripToolInvocation(rawPrimary);
        callbacks?.onReplyChunk?.(primary);
        if (!ttsStarted) {
          const m = primary.match(FIRST_SENTENCE_END);
          if (m && m.index !== undefined) {
            const firstSentence = primary.slice(0, m.index + 1);
            if (firstSentence.length >= 2) {
              ttsStarted = true;
              ttsStartedLen = firstSentence.length;
              callbacks?.onTtsStart?.(firstSentence);
            }
          }
        }
      }
    });

    try {
      const stylePrefix = callbacks?.style && callbacks.style !== 'empathy'
        ? `[风格要求：${styleLabel(callbacks.style)}]\n\n`
        : '';
      const content = screenshotDataUrl
        ? [{ type: 'text' as const, text: stylePrefix + text }, dataUrlToImage(screenshotDataUrl)]
        : stylePrefix + text;
      await session.sendUserMessage(content);
    } catch (err) {
      if (providerError) {
        const httpStatus = extractHttpStatus(providerError);
        log.warn('conversation.provider-error', { runId, httpStatus, detail: String(providerError).slice(0, 200) });
        throw classifyError({ httpStatus, cause: providerError });
      }
      log.error('conversation.turn.error', {
        runId, msg: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined, latencyMs: Date.now() - startTs,
      });
      throw err;
    } finally {
      unsub();
    }

    if (providerError) {
      const httpStatus = extractHttpStatus(providerError);
      log.warn('conversation.provider-error', { runId, httpStatus, detail: String(providerError).slice(0, 200) });
      throw classifyError({ httpStatus, cause: providerError });
    }

    const emit = this.getEmit?.() ?? null;
    if (ttsStarted && primary.length > ttsStartedLen) {
      const remaining = primary.slice(ttsStartedLen).trim();
      if (remaining) callbacks?.onTtsStart?.(remaining);
    } else if (!ttsStarted && primary.trim()) {
      callbacks?.onTtsStart?.(primary.trim());
    }

    const output: UniversalOutput = {
      skillId: skillRead,
      title: emit?.title,
      primary: { text: primary },
      items: emit?.items ?? [],
      note: emit?.note,
    };
    const summary: RunSummary = {
      runId,
      ts: new Date(startTs).toISOString(),
      skillId: skillRead ?? 'unknown',
      inputLen: text.length,
      outputShape: { primaryLen: primary.length, itemsCount: output.items.length },
      latencyMs: Date.now() - startTs,
      rawOutputLen: primary.length,
    };
    writeRunSummary(summary);
    this.turnCount++;
    log.info('conversation.turn.done', { runId, turn: this.turnCount, skillId: skillRead, latencyMs: summary.latencyMs, itemsCount: output.items.length });
    return { output, summary };
  }

  dispose(): void {
    this.session?.dispose?.();
    this.session = null;
    this.getEmit = null;
    this.resetEmit = null;
    this.multimodal = false;
    this.turnCount = 0;
  }
}
