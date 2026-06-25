/**
 * summarize skill 输出 schema —— 讨论总结（Plan 6）。
 *
 * 输出形状：title + keyPoints + 可选 actionItems。要点视图一次性显示。
 * 校验从宽：title 和 keyPoints 是硬要求，actionItems 可选。
 */
import { z } from 'zod';

export const SummarizeOutput = z.object({
  /** 总结标题（如"关于上线时间的讨论"）。 */
  title: z.string(),
  /** 关键要点列表（2-5 条）。 */
  keyPoints: z.array(z.string()),
  /** 可选行动项（需要跟进的事）。 */
  actionItems: z.array(z.string()).optional(),
});

export type SummarizeOutput = z.infer<typeof SummarizeOutput>;

/**
 * 从模型原始输出（JSON 字符串）解析 SummarizeOutput。
 *
 * 从宽策略：title 和 keyPoints 是硬要求。
 * - JSON 解析失败 → 把原文当单条 keyPoints，title 兜底。
 * - zod 校验失败但能取到 keyPoints → 用该 keyPoints + 默认 title。
 */
export function parseSummarizeOutput(raw: string): SummarizeOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { title: '讨论总结', keyPoints: [raw] };
  }

  const result = SummarizeOutput.safeParse(parsed);
  if (result.success) return result.data;

  // zod 失败：尽量抢救 keyPoints
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title : '讨论总结';
    if (Array.isArray(obj.keyPoints)) {
      const keyPoints = obj.keyPoints.filter((x): x is string => typeof x === 'string');
      if (keyPoints.length > 0) return { title, keyPoints };
    }
  }
  return { title: '讨论总结', keyPoints: [raw] };
}
