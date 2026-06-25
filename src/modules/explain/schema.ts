/**
 * explain skill 输出 schema —— 看屏讲解（Plan 6）。
 *
 * 输出形状：title + content + 可选 bullets。阅读视图一次性显示，不需要流式蹦字。
 * 校验从宽：title 和 content 是硬要求，bullets 可选。
 */
import { z } from 'zod';

export const ExplainOutput = z.object({
  /** 讲解标题（如"这个词的意思是…"）。 */
  title: z.string(),
  /** 讲解正文（中英双语，有梗但准确）。 */
  content: z.string(),
  /** 可选要点列表（关键信息提炼）。 */
  bullets: z.array(z.string()).optional(),
});

export type ExplainOutput = z.infer<typeof ExplainOutput>;

/**
 * 从模型原始输出（JSON 字符串）解析 ExplainOutput。
 *
 * 从宽策略：title 和 content 是硬要求。
 * - JSON 解析失败 → 把原文当 content，title 兜底。
 * - zod 校验失败但能取到 content → 用该 content + 默认 title。
 */
export function parseExplainOutput(raw: string): ExplainOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { title: '看屏讲解', content: raw };
  }

  const result = ExplainOutput.safeParse(parsed);
  if (result.success) return result.data;

  // zod 失败：尽量抢救 content
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content : '';
    const title = typeof obj.title === 'string' ? obj.title : '看屏讲解';
    if (content) return { title, content };
  }
  return { title: '看屏讲解', content: raw };
}
