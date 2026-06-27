/**
 * Skill pipeline（Plan 8 重写）：跑嘴替单 session，agent 自动选用 skill。
 *
 * text(+截图) → createMiraSession → agent 自主 read 对应 SKILL.md（渐进式披露）
 *   → 主体文本流式（onReplyChunk 蹦字 + onTtsStart 首句先播）
 *   → emit_result 补结构化 → 组装 UniversalOutput。
 * 每次跑写 logs/runs/<runId>.json（RunSummary）。
 */
import { createMiraSession } from './mira/session.js';
import { log, newRunId, writeRunSummary, type RunSummary } from '../core/log.js';
import type { UniversalOutput, ReplyStyle } from '../shared/ipc.js';

/** 回调（main/ipc.ts 注入渲染层副作用；e2e 不传）。 */
export interface RunSkillCallbacks {
  onReplyChunk?(primarySoFar: string): void;
  onTtsStart?(firstSentence: string): void;
  /** 用户选择的风格（影响 prompt context）。 */
  style?: ReplyStyle;
}

export interface RunSkillResult {
  output: UniversalOutput;
  summary: RunSummary;
}

const FIRST_SENTENCE_END = /[。！？!?;\n]/;

/**
 * 从流式文本中提取干净回复（剥离 <tool_invocation> 等 XML-like 工具调用文本）。
 * 返回 { clean, toolText }：clean 是给 TTS/UI 的，toolText 是工具调用原文（供后续解析）。
 */
let rawPrimary = ''; // 原始累积（含工具调用文本）

function stripToolInvocation(raw: string): string {
  const idx = raw.indexOf('<tool_invocation');
  return idx >= 0 ? raw.slice(0, idx).trimEnd() : raw;
}

export async function runSkill(
  text: string,
  screenshotDataUrl: string | undefined,
  callbacks?: RunSkillCallbacks,
): Promise<RunSkillResult> {
  const runId = newRunId();
  const startTs = Date.now();
  log.info('skill.start', {
    runId,
    inputLen: text.length,
    hasScreenshot: !!screenshotDataUrl,
    model: screenshotDataUrl ? 'mimo-v2.5' : 'mimo-v2.5-pro',
  });
  const { session, getEmit } = await createMiraSession(!!screenshotDataUrl);

  let primary = '';
  let skillRead: string | undefined;
  let ttsStarted = false;
  let ttsStartedLen = 0; // 首句 TTS 了的文本长度，用于后续补齐

  const unsub = session.subscribe((e) => {
    const j = safeJson(e);
    const sm = j.match(/skills\/(reply|explain|summarize)\/SKILL\.md/);
    if (sm && !skillRead) {
      skillRead = sm[1];
      log.info('skill.selected', { runId, skillId: skillRead, latencyMs: Date.now() - startTs });
    }
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
            log.debug('skill.tts-start', { runId, firstSentenceLen: firstSentence.length, latencyMs: Date.now() - startTs });
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
    log.error('skill.run.error', {
      runId,
      msg: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      latencyMs: Date.now() - startTs,
    });
    throw err;
  } finally {
    unsub();
  }

  const emit = getEmit();
  // 首句已 TTS，补齐剩余文本（只 TTS 干净文本，不含工具调用）
  if (ttsStarted && primary.length > ttsStartedLen) {
    const remaining = primary.slice(ttsStartedLen).trim();
    if (remaining) {
      log.debug('skill.tts-remaining', { runId, remainingLen: remaining.length });
      callbacks?.onTtsStart?.(remaining);
    }
  } else if (!ttsStarted && primary) {
    callbacks?.onTtsStart?.(primary);
  }

  const output: UniversalOutput = {
    skillId: skillRead,
    title: emit?.title,
    primary: { text: primary },
    items: emit?.items ?? [],
    note: emit?.note,
  };
  session.dispose?.();

  const summary: RunSummary = {
    runId,
    ts: new Date(startTs).toISOString(),
    skillId: skillRead ?? 'unknown',
    inputLen: text.length,
    outputShape: { primaryLen: primary.length, itemsCount: output.items.length },
    latencyMs: Date.now() - startTs,
    rawOutputLen: primary.length,
  };
  rawPrimary = ''; // 重置，避免下次 runSkill 残留
  writeRunSummary(summary);
  log.info('skill.done', { runId, skillId: skillRead, latencyMs: summary.latencyMs, itemsCount: output.items.length });
  return { output, summary };
}

/**
 * 从模型文本输出中解析 emit_result 参数。
 * 格式：<tool_invocation name="emit_result" arguments={...JSON...} />
 */
function parseEmitFromText(raw: string): { title?: string; items: { text: string; label?: string; copyable?: boolean }[]; note?: string } | null {
  const m = raw.match(/arguments\s*=\s*(\{[\s\S]*?\})\s*\/?>/);
  if (!m || !m[1]) return null;
  try {
    const parsed = JSON.parse(m[1]);
    return {
      title: parsed.title,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      note: parsed.note,
    };
  } catch {
    log.warn('skill.emit.parse-failed', { snippet: m[1].slice(0, 200) });
    return null;
  }
}

function safeJson(e: unknown): string {
  try {
    return JSON.stringify(e) ?? '';
  } catch {
    return '';
  }
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
