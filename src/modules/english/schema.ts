/**
 * 嘴替输出 schema —— 数据形状在边界解析（parse-don't-validate，见 core-beliefs.md）。
 *
 * 不变量（见 ARCHITECTURE.md）：
 * - `reply` 必须是 JSON 第一个键（流式蹦字 + 首句 TTS 靠它）。schema 里也排第一，做文档化约束。
 * - 校验从宽：只有 `reply` 是硬要求，其余字段给默认值/容错。
 * - `diagnostics` / `variants` 为兼容渲染层保留，嘴替场景一般为空，Plan 2 移除。
 */
import { z } from 'zod';

/** 原表达问题诊断项（旧字段，保留兼容渲染层，Plan 2 移除）。 */
export const Diagnostic = z.object({
  severity: z.enum(['error', 'warning', 'info']).default('info'),
  message: z.string(),
  fix: z.string().optional(),
});

/** 旧的固定风格变体（保留兼容渲染层，Plan 2 移除）。 */
export const StyleVariants = z.object({
  formal: z.string().optional(),
  casual: z.string().optional(),
  concise: z.string().optional(),
});

/** 一条可直接发出去的备选回复 + 简短风格标签。 */
export const Candidate = z.object({
  /** 可直接发出去的一条回复。 */
  text: z.string(),
  /** 简短风格标签：更撩 / 更稳 / 更皮 / 更专业 / 机智回怼 / 更暖 等。 */
  style: z.string().default(''),
});

/**
 * 嘴替的完整输出。
 *
 * 注意：`reply` 排第一是**有意的不变量**——模型输出 JSON 里 reply 必须第一键，
 * ReplyExtractor 靠它最先流出做实时预览与首句先播 TTS。
 */
export const CoachOutput = z.object({
  /** 最推荐的一条，可直接复制发出。唯一硬要求，且必须是 JSON 第一个键（流式靠它）。 */
  reply: z.string(),
  /** 2-3 条带风格标签的备选神回复，供用户挑。 */
  candidates: z.array(Candidate).default([]),
  /** 原表达问题诊断（嘴替场景一般为空；保留以兼容渲染层，Plan 2 移除）。 */
  diagnostics: z.array(Diagnostic).default([]),
  /** 一句话说明判断的场景与语气策略。 */
  rationale: z.string().default(''),
  /** 旧的固定风格变体（保留以兼容渲染层，Plan 2 移除）。 */
  variants: StyleVariants.nullish().default(null),
});

export type Diagnostic = z.infer<typeof Diagnostic>;
export type StyleVariants = z.infer<typeof StyleVariants>;
export type Candidate = z.infer<typeof Candidate>;
export type CoachOutput = z.infer<typeof CoachOutput>;

/**
 * 从模型原始输出（JSON 字符串）解析 CoachOutput。
 *
 * 从宽策略：只有 `reply` 是硬要求。
 * - JSON 解析失败 → 把原文当 reply 返回（兜底，保证总有 reply）。
 * - zod 校验失败但能取到字符串 reply → 用该 reply + 默认值。
 * - 其余字段缺失 → zod default 兜底。
 */
export function parseCoachOutput(raw: string): CoachOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback(raw);
  }

  const result = CoachOutput.safeParse(parsed);
  if (result.success) return result.data;

  // zod 失败：尽量抢救 reply
  if (parsed && typeof parsed === 'object' && 'reply' in parsed) {
    const reply = (parsed as { reply?: unknown }).reply;
    if (typeof reply === 'string') {
      return { reply, candidates: [], diagnostics: [], rationale: '', variants: null };
    }
  }
  return fallback(raw);
}

function fallback(reply: string): CoachOutput {
  return { reply, candidates: [], diagnostics: [], rationale: '', variants: null };
}
