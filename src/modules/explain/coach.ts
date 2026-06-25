/**
 * explain skill —— 看屏讲解（Plan 6）。
 *
 * 用户看到屏幕上的英文单词/难懂内容/复杂讨论 → 喊 Jarvis → 说"讲解一下" →
 * 它看屏讲解。中英双语，有梗但准确。
 *
 * 输出 = title + content + 可选 bullets。阅读视图一次性显示，不走流式蹦字。
 */
import { Agent } from '@openai/agents';
import { coachModelSettings, getCoachModelName } from '../../core/provider.js';
import { parseExplainOutput, type ExplainOutput } from './schema.js';

const INSTRUCTIONS = `你是「嘴替·看屏讲解」——帮用户看懂屏幕上的内容。

用户正在电脑上看某个东西（英文单词/技术文档/复杂讨论/难懂的图……），看不懂，
会用中文说出想了解什么（"讲解一下"/"啥意思"/"看不懂"），通常附一张当前屏幕截图。

第一步先看截图判断：屏幕上是什么内容？用户卡在哪？据此定讲解重点。

输出规则：
1. 用中文讲解（英文单词先给中文意思，再举例用法）。
2. title：一句话点明讲解对象（如"rizz：2024 年最火的俚语"）。
3. content：讲解正文，有梗、接地气、准确。别念词典，要讲人话。
4. bullets：可选，提炼 2-4 个关键要点（如用法场景 / 易错点 / 相关词）。
5. 长度适中：别长篇大论，用户要的是"秒懂"，不是论文。

只输出一个 JSON 对象（不要 markdown 围栏或多余解释），结构如下：
{
  "title": string,            // 一句话点明讲解对象
  "content": string,          // 讲解正文（中英双语，有梗但准确）
  "bullets": [string]         // 可选，2-4 个关键要点
}`;

/** explain Agent。不设 outputType，JSON 经 providerData.json_object 产出。 */
export const ExplainCoach = new Agent({
  name: '看屏讲解',
  instructions: INSTRUCTIONS,
  model: getCoachModelName(),
  modelSettings: coachModelSettings,
});

/** 导出 INSTRUCTIONS 供架构 lint 断言。 */
export { INSTRUCTIONS };

/**
 * 构造给 explain 的用户输入（多模态：text + 可选截图）。
 * 与 reply/coach.ts 的 buildUserInput 同构。
 */
export function buildExplainInput(
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

/** explain skill 注册项。 */
export const explainSkill = {
  id: 'explain',
  name: '看屏讲解',
  description: '看屏讲解——英文单词/难懂内容/复杂讨论，秒懂',
  instructions: INSTRUCTIONS,
  agent: ExplainCoach,
  buildInput: buildExplainInput,
  parseOutput: parseExplainOutput,
} as const;

export { parseExplainOutput };
export type { ExplainOutput };
