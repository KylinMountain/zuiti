/**
 * Router —— LLM 自动路由（Plan 6）。
 *
 * 用户口述 + 截图 → 判断意图：reply / explain / summarize → 按意图跑对应 skill。
 *
 * 两层判定：
 * 1. classifyIntentHeuristic：纯函数关键词判定，可单测，LLM 失败/超时兜底。
 * 2. routeSkill：完整版，调 LLM 精确判断；LLM 失败回退 heuristic。
 *
 * 默认回退 reply（嘴替核心能力，不会因误判彻底失败）。
 */
import type { SkillId } from '../shared/ipc.js';

/**
 * 启发式意图判定（纯函数，可单测）。
 *
 * 关键词优先级：summarize > explain > reply（总结需求最明确，优先）。
 * 无明显意图信号 → 默认 reply。
 */
export function classifyIntentHeuristic(text: string): SkillId {
  const t = text.toLowerCase();

  // summarize 关键词（优先级最高，需求最明确）
  if (/(总结|归纳|要点|概要|摘要|梳理一下|整理一下)/.test(t)) return 'summarize';

  // explain 关键词
  if (/(讲解|解释|啥意思|什么意思|是什么|看不懂|搞不懂|啥玩意|什么鬼|教教我|怎么用|怎么读)/.test(t)) return 'explain';

  // 默认 reply（嘴替核心能力）
  return 'reply';
}

/**
 * LLM 精确路由（完整版）。
 *
 * 调 LLM 看截图 + 听意图判断；失败/超时回退 classifyIntentHeuristic。
 *
 * @param text 用户口述
 * @param screenshotDataUrl 可选截图 data URL
 * @param llmCall LLM 调用函数（依赖注入，方便测试 mock）。返回 'reply'/'explain'/'summarize'。
 * @returns SkillId
 */
export async function routeSkill(
  text: string,
  screenshotDataUrl: string | undefined,
  llmCall: (text: string, screenshotDataUrl: string | undefined) => Promise<SkillId>,
): Promise<SkillId> {
  try {
    const result = await llmCall(text, screenshotDataUrl);
    // sanity check：返回值必须是合法 SkillId
    if (result === 'reply' || result === 'explain' || result === 'summarize') return result;
    return classifyIntentHeuristic(text);
  } catch {
    return classifyIntentHeuristic(text);
  }
}
