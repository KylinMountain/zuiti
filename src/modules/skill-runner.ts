/**
 * Skill pipeline 纯函数（Plan 7 Task 2）。
 *
 * 把 main/ipc.ts 里的 runSkillPipeline 核心逻辑抽出来，不依赖 BrowserWindow：
 * text → 截图（可选）→ router 判断 skillId → 跑对应 skill → 返回 { skillId, output, summary }。
 *
 * - main/ipc.ts 调本函数，在 callbacks 里 send 结果给渲染层 + 启动 TTS
 * - e2e 测试直接调本函数（不传 callbacks），断言返回值
 *
 * 每次跑写 logs/runs/<runId>.json（RunSummary），供 LLM/agent 诊断。
 */
import { run } from '@openai/agents';
import { ReplyExtractor } from '../core/streamparse.js';
import { log, newRunId, writeRunSummary, type RunSummary } from '../core/log.js';
import { getSkill, type Skill } from '../core/skill.js';
import { classifyIntentHeuristic, routeSkillWithLlm } from './router.js';
import { registerAllSkills } from './index.js';
import type { CoachOutputDTO, SkillId, SkillOutput } from '../shared/ipc.js';

/** 回调（main/ipc.ts 注入渲染层副作用；e2e 测试不传）。 */
export interface RunSkillCallbacks {
  /** reply 流式 chunk（迄今为止已流出的 reply 全文）。 */
  onReplyChunk?(replySoFar: string): void;
  /** 首句检测到，启动 TTS（不等全部收完）。 */
  onTtsStart?(firstSentence: string): void;
}

export interface RunSkillResult {
  skillId: SkillId;
  output: SkillOutput;
  summary: RunSummary;
}

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

/** 从 SkillOutput 提取 outputShape（不含敏感内容，只记长度和数量）。 */
function extractOutputShape(output: SkillOutput): RunSummary['outputShape'] {
  switch (output.skillId) {
    case 'reply':
      return {
        replyLen: output.reply.length,
        candidatesCount: output.candidates.length,
      };
    case 'explain':
      return {
        contentLen: output.content.length,
        bulletsCount: output.bullets?.length ?? 0,
      };
    case 'summarize':
      return {
        keyPointsCount: output.keyPoints.length,
        actionItemsCount: output.actionItems?.length ?? 0,
      };
  }
}

function makeSummary(
  runId: string,
  startTs: number,
  skillId: SkillId,
  text: string,
  rawOutputLen: number,
  errors: string[] | undefined,
  output?: SkillOutput,
): RunSummary {
  return {
    runId,
    ts: new Date(startTs).toISOString(),
    skillId,
    inputLen: text.length,
    outputShape: output ? extractOutputShape(output) : {},
    latencyMs: Date.now() - startTs,
    rawOutputLen,
    errors: errors && errors.length > 0 ? errors : undefined,
  };
}

/**
 * 抽 skill pipeline 为纯函数（不依赖 BrowserWindow）。
 *
 * 流程：路由 → 跑 skill → 写 run summary → 返回结果。
 * - reply：流式蹦字（onReplyChunk 回调）+ 首句先播 TTS（onTtsStart 回调）
 * - explain/summarize：非流式一次性返回
 *
 * 失败时写带 errors 的 summary，然后抛错给调用方。
 */
export async function runSkill(
  text: string,
  screenshotDataUrl: string | undefined,
  callbacks?: RunSkillCallbacks,
): Promise<RunSkillResult> {
  const runId = newRunId();
  const startTs = Date.now();
  const errors: string[] = [];

  // 确保 skill 已注册（幂等）
  registerAllSkills();

  // 路由（LLM 精确路由，3s 超时回退 heuristic）
  let skillId: SkillId;
  try {
    skillId = await routeSkillWithLlm(text, screenshotDataUrl);
  } catch (err) {
    skillId = classifyIntentHeuristic(text);
    errors.push(`router failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const heuristic = classifyIntentHeuristic(text);
  log.info('skill.route', { runId, skillId, textLen: text.length, withScreenshot: !!screenshotDataUrl, heuristic });

  const skill = getSkill(skillId);
  if (!skill) {
    const msg = `skill "${skillId}" 未注册`;
    errors.push(msg);
    const summary = makeSummary(runId, startTs, skillId, text, 0, errors);
    writeRunSummary(summary);
    throw new Error(msg);
  }

  try {
    let output: SkillOutput;
    let rawOutputLen = 0;

    if (skillId === 'reply') {
      const { output: replyOutput, rawLen } = await runReplySkill(skill, text, screenshotDataUrl, callbacks, runId);
      output = { skillId: 'reply', ...replyOutput };
      rawOutputLen = rawLen;
    } else {
      const { output: readingOutput, rawLen } = await runReadingSkill(skill, skillId, text, screenshotDataUrl);
      output = { skillId, ...readingOutput } as SkillOutput;
      rawOutputLen = rawLen;
    }

    const summary = makeSummary(runId, startTs, skillId, text, rawOutputLen, errors, output);
    writeRunSummary(summary);
    log.info('skill.done', { runId, skillId, latencyMs: summary.latencyMs, rawOutputLen });
    return { skillId, output, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    const summary = makeSummary(runId, startTs, skillId, text, 0, errors);
    writeRunSummary(summary);
    log.error('skill.error', { runId, skillId, msg });
    throw err;
  }
}

/** reply skill：流式蹦字 + TTS 首句先播（不变量 1：reply 第一键）。 */
async function runReplySkill(
  skill: Skill | undefined,
  text: string,
  screenshotDataUrl: string | undefined,
  callbacks: RunSkillCallbacks | undefined,
  runId: string,
): Promise<{ output: CoachOutputDTO; rawLen: number }> {
  if (!skill) throw new Error('reply skill 未注册');
  const stream = await run(skill.agent, skill.buildInput(text, screenshotDataUrl) as never, { stream: true });
  const extractor = new ReplyExtractor();
  let lastPushedLen = 0;
  let ttsStarted = false;

  // 首句边界检测：句号/感叹号/问号/换行/分号都算一句结束
  const firstSentenceEnd = /[。！？!?;\n]/;

  for await (const ev of stream) {
    if (ev.type !== 'raw_model_stream_event') continue;
    const chunk = extractDelta(ev.data);
    if (!chunk) continue;
    const reply = extractor.push(chunk);
    if (reply.length > lastPushedLen) {
      callbacks?.onReplyChunk?.(reply);
      lastPushedLen = reply.length;
    }
    // TTS 首句先播：检测到首句边界就启动 TTS（不等全部收完）
    if (!ttsStarted && firstSentenceEnd.test(reply)) {
      const match = reply.match(firstSentenceEnd);
      if (match && match.index !== undefined) {
        const firstSentence = reply.slice(0, match.index + 1);
        if (firstSentence.length >= 2) {
          ttsStarted = true;
          callbacks?.onTtsStart?.(firstSentence);
        }
      }
    }
  }
  log.info('coach.stream.done', { runId, replyLen: extractor.replyText.length, ttsFirstSentence: ttsStarted });

  const raw = (stream.finalOutput ?? '').toString();
  const output = skill.parseOutput(raw) as CoachOutputDTO;

  // 若流式期间未触发 TTS（回复太短无标点），用完整 reply 兜底
  if (!ttsStarted) {
    callbacks?.onTtsStart?.(output.reply);
  }

  return { output, rawLen: raw.length };
}

/** explain/summarize skill：非流式一次性返回，不走 TTS。 */
async function runReadingSkill(
  skill: Skill | undefined,
  skillId: 'explain' | 'summarize',
  text: string,
  screenshotDataUrl: string | undefined,
): Promise<{ output: Record<string, unknown>; rawLen: number }> {
  if (!skill) throw new Error(`${skillId} skill 未注册`);
  const result = await run(skill.agent, skill.buildInput(text, screenshotDataUrl) as never);
  const raw = (result.finalOutput ?? '').toString();
  const output = skill.parseOutput(raw) as Record<string, unknown>;
  log.info('skill.reading.done', { skillId, rawLen: raw.length });
  return { output, rawLen: raw.length };
}
