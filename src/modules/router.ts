/**
 * Router —— LLM 自动路由（Plan 6）。
 *
 * 用户口述 + 截图 → 判断意图：reply / explain / summarize → 按意图跑对应 skill。
 *
 * 两层判定：
 * 1. classifyIntentHeuristic：纯函数关键词判定，可单测，LLM 失败/超时兜底。
 * 2. routeSkillWithLlm：完整版，调 LLM 精确判断；LLM 失败回退 heuristic。
 *
 * 默认回退 reply（嘴替核心能力，不会因误判彻底失败）。
 */
import { Agent, run } from '@openai/agents';
import { getCoachModelName } from '../core/provider.js';
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

/** Router 用的小 Agent，只判断意图不生成回复。
 * 不带 modelSettings（不强制 json_object）—— router 要输出纯文本单词，不是 JSON。
 */
const ROUTER_INSTRUCTIONS = `你是嘴替的路由器。看截图 + 用户口述，判断用户想要哪种帮助：
- reply：替我把话说漂亮（恋爱/对线/职场/英文回复）
- explain：看屏讲解（屏幕上有英文单词/难懂内容/复杂讨论，用户想搞懂）
- summarize：总结讨论（群聊/邮件/长讨论，用户想看要点）

只输出一个单词：reply / explain / summarize。不确定时输出 reply（默认）。不要输出 JSON、标点或解释。`;

/** Router 专用 Agent：无 modelSettings，输出纯文本单词。 */
const RouterCoach = new Agent({
  name: '路由器',
  instructions: ROUTER_INSTRUCTIONS,
  model: getCoachModelName(),
});

/**
 * LLM 精确路由：调小 Agent 判断意图。
 *
 * 策略：用 RouterCoach（独立 Agent，无 json_object）跑一次 run()，
 * 取 finalOutput 里的词作为 skillId。失败/超时回退 heuristic。
 *
 * 超时保护：3 秒内没返回就回退（router 不该卡用户，宁可误判不能等）。
 */
export async function routeSkillWithLlm(text: string, screenshotDataUrl: string | undefined): Promise<SkillId> {
  const fallback = classifyIntentHeuristic(text);
  try {
    const input = screenshotDataUrl
      ? [
          {
            role: 'user' as const,
            content: [
              { type: 'input_text' as const, text: `用户说：${text}\n\n判断意图（reply/explain/summarize）：` },
              { type: 'input_image' as const, image: screenshotDataUrl },
            ],
          },
        ]
      : `用户说：${text}\n\n判断意图（reply/explain/summarize）：`;

    const result = await Promise.race([
      run(RouterCoach, input as never),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('router timeout')), 3000)),
    ]);
    const raw = (result.finalOutput ?? '').toString().trim().toLowerCase();
    if (raw === 'reply' || raw === 'explain' || raw === 'summarize') return raw;
    return fallback;
  } catch {
    return fallback;
  }
}
