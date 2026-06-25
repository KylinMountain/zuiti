/**
 * summarize skill —— 讨论总结（Plan 6）。
 *
 * 用户在群聊/邮件/长讨论里 → 喊 Jarvis → 说"总结一下" →
 * 它看屏总结要点，可选行动项。
 *
 * 输出 = title + keyPoints + 可选 actionItems。要点视图一次性显示，不走流式蹦字。
 */
import { Agent } from '@openai/agents';
import { coachModelSettings, getCoachModelName } from '../../core/provider.js';
import { parseSummarizeOutput, type SummarizeOutput } from './schema.js';

const INSTRUCTIONS = `你是「嘴替·总结讨论」——帮用户从冗长讨论里提炼要点。

用户正在看一段群聊/邮件/讨论串，信息太杂看不过来，会用中文说"总结一下"/"归纳要点"，
通常附一张当前屏幕截图。

第一步先看截图判断：这是什么场景的讨论？谁在说？核心分歧/共识是什么？据此提炼。

输出规则：
1. 用中文总结。
2. title：一句话点明讨论主题（如"关于下周上线时间的讨论"）。
3. keyPoints：2-5 条关键要点，每条一句话，去掉废话和水词。
4. actionItems：可选，需要跟进的事（如"张三周三前确认测试环境"）。
5. 别复述全文，要提炼。用户要的是"30 秒看完重点"。

只输出一个 JSON 对象（不要 markdown 围栏或多余解释），结构如下：
{
  "title": string,            // 讨论主题
  "keyPoints": [string],      // 2-5 条关键要点
  "actionItems": [string]     // 可选，需要跟进的事
}`;

/** summarize Agent。不设 outputType，JSON 经 providerData.json_object 产出。 */
export const SummarizeCoach = new Agent({
  name: '总结讨论',
  instructions: INSTRUCTIONS,
  model: getCoachModelName(),
  modelSettings: coachModelSettings,
});

/** 导出 INSTRUCTIONS 供架构 lint 断言。 */
export { INSTRUCTIONS };

/**
 * 构造给 summarize 的用户输入（多模态：text + 可选截图）。
 * 与 reply/coach.ts 的 buildUserInput 同构。
 */
export function buildSummarizeInput(
  text: string,
  screenshotDataUrl?: string,
): string | { role: 'user'; content: ({ type: 'input_text'; text: string } | { type: 'input_image'; image: string })[] }[] {
  if (!screenshotDataUrl) return text;
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text' as const, text },
        { type: 'input_image' as const, image: screenshotDataUrl },
      ],
    },
  ];
}

/** summarize skill 注册项。 */
export const summarizeSkill = {
  id: 'summarize',
  name: '总结讨论',
  description: '总结讨论——群聊/邮件/长讨论，30 秒看完重点',
  instructions: INSTRUCTIONS,
  agent: SummarizeCoach,
  buildInput: buildSummarizeInput,
  parseOutput: parseSummarizeOutput,
} as const;

export { parseSummarizeOutput };
export type { SummarizeOutput };
