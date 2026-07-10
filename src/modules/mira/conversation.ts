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

/**
 * 检测文本末尾是否陷入"同一段落连续复读"的退化循环（reply 技能观察到的真实故障：
 * 模型卡在引导语上反复吐同一句，直到超时也不调 emit_result）。
 * 只认长度 ≥5 且含 ≥2 个不同字符的重复单元，避免把 "----"/"哈哈哈哈" 这类合法重复误判。
 */
export function hasDegenerateRepeat(text: string): boolean {
  const t = text.trim();
  for (let unit = 5; unit <= 40 && unit * 2 <= t.length; unit++) {
    const a = t.slice(t.length - unit * 2, t.length - unit);
    const b = t.slice(t.length - unit);
    if (a !== b) continue;
    if (new Set(a).size <= 1) continue;
    return true;
  }
  return false;
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
    let repetitionAborted = false;

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
        // reply 技能实测会卡进复读循环、40s+ 不调 emit_result；检出即中止本轮生成，
        // 不等它自然结束（正常轮 3-8s，放着不管会挂到 40s 才报错）。
        if (!repetitionAborted && skillRead === 'reply' && hasDegenerateRepeat(primary)) {
          repetitionAborted = true;
          log.warn('conversation.reply.degenerateRepeat', { runId, primaryLen: primary.length, preview: primary.slice(0, 80) });
          void session.abort();
        }
        if (!ttsStarted && skillRead !== 'reply') {
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
      // abort() 可能让 sendUserMessage 以 reject 收尾——复读中止优先于其它分类。
      if (repetitionAborted) {
        log.warn('conversation.reply.aborted', { runId, latencyMs: Date.now() - startTs });
        this.dispose();
        throw classifyError({ code: 'modelStuck' });
      }
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

    // abort() 也可能让 sendUserMessage 正常 resolve——两条路径都要拦下，不能把复读垃圾当正常输出送出去。
    if (repetitionAborted) {
      log.warn('conversation.reply.aborted', { runId, latencyMs: Date.now() - startTs });
      this.dispose();
      throw classifyError({ code: 'modelStuck' });
    }

    if (providerError) {
      const httpStatus = extractHttpStatus(providerError);
      log.warn('conversation.provider-error', { runId, httpStatus, detail: String(providerError).slice(0, 200) });
      throw classifyError({ httpStatus, cause: providerError });
    }

    const emit = this.getEmit?.() ?? null;

    // TTS 只读"能听的内容"，防止模型失控输出大段文字时被全文朗读。
    const ttsText = this.pickTtsText(skillRead, primary, emit, ttsStarted, ttsStartedLen);
    if (ttsText) {
      log.info('conversation.tts.final', { runId, skillId: skillRead, ttsLen: ttsText.length, originalLen: primary.length });
      callbacks?.onTtsStart?.(ttsText);
    } else {
      log.info('conversation.tts.skip', { runId, skillId: skillRead, primaryLen: primary.length });
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

  /**
   * 从本轮产出中挑选要 TTS 朗读的文本。
   * - reply：优先读 3 个候选选项；没产出 items 时回退读 primary 的前 80 字。
   * - 其他技能：只读第一句/已朗读之后的剩余部分，且整体不超过 120 字，避免朗读论文。
   */
  private pickTtsText(
    skillRead: string | undefined,
    primary: string,
    emit: EmitResult | null,
    ttsStarted: boolean,
    ttsStartedLen: number,
  ): string {
    const REPLY_FALLBACK_MAX = 80;
    const OTHER_MAX = 120;

    if (skillRead === 'reply') {
      if (emit?.items?.length) {
        // 每条选项最多读 100 字，避免 3 条长文拼接超长 TTS
        const REPLY_ITEM_MAX = 100;
        const parts = emit.items.map((it, i) => {
          const text = it.text.length > REPLY_ITEM_MAX ? it.text.slice(0, REPLY_ITEM_MAX) + '…' : it.text;
          return `选项${i + 1}：${text}`;
        });
        return parts.join('；');
      }
      const t = primary.trim();
      if (!t) return '';
      if (t.length > REPLY_FALLBACK_MAX) {
        log.warn('conversation.reply.protocolViolation', { primaryLen: t.length, preview: t.slice(0, 60) });
      }
      return t.slice(0, REPLY_FALLBACK_MAX);
    }

    const base = ttsStarted && primary.length > ttsStartedLen
      ? primary.slice(ttsStartedLen).trim()
      : primary.trim();
    if (!base) return '';
    if (base.length > OTHER_MAX) {
      // 尽量停在句末，避免截在半句话中间
      const cut = base.slice(0, OTHER_MAX);
      const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
      return lastStop > 20 ? cut.slice(0, lastStop + 1) : cut + '…';
    }
    return base;
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
