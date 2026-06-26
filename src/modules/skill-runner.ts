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
import type { UniversalOutput } from '../shared/ipc.js';

/** 回调（main/ipc.ts 注入渲染层副作用；e2e 不传）。 */
export interface RunSkillCallbacks {
  onReplyChunk?(primarySoFar: string): void;
  onTtsStart?(firstSentence: string): void;
}

export interface RunSkillResult {
  output: UniversalOutput;
  summary: RunSummary;
}

const FIRST_SENTENCE_END = /[。！？!?;\n]/;

export async function runSkill(
  text: string,
  screenshotDataUrl: string | undefined,
  callbacks?: RunSkillCallbacks,
): Promise<RunSkillResult> {
  const runId = newRunId();
  const startTs = Date.now();
  const { session, getEmit } = await createMiraSession();

  let primary = '';
  let skillRead: string | undefined;
  let ttsStarted = false;

  const unsub = session.subscribe((e) => {
    const j = safeJson(e);
    const sm = j.match(/skills\/(reply|explain|summarize)\/SKILL\.md/);
    if (sm && !skillRead) skillRead = sm[1];
    const ame = (e as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
    if (ame?.type === 'text_delta' && ame.delta) {
      primary += ame.delta;
      callbacks?.onReplyChunk?.(primary);
      if (!ttsStarted) {
        const m = primary.match(FIRST_SENTENCE_END);
        if (m && m.index !== undefined) {
          const firstSentence = primary.slice(0, m.index + 1);
          if (firstSentence.length >= 2) {
            ttsStarted = true;
            callbacks?.onTtsStart?.(firstSentence);
          }
        }
      }
    }
  });

  try {
    const content = screenshotDataUrl
      ? [{ type: 'text' as const, text }, dataUrlToImage(screenshotDataUrl)]
      : text;
    await session.sendUserMessage(content);
  } finally {
    unsub();
  }

  const emit = getEmit();
  if (!ttsStarted && primary) callbacks?.onTtsStart?.(primary);

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
  writeRunSummary(summary);
  log.info('skill.done', { runId, skillId: skillRead, latencyMs: summary.latencyMs, itemsCount: output.items.length });
  return { output, summary };
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
