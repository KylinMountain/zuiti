/**
 * 嘴替 skill —— 跨场景（恋爱/对线/职场/英文）、跨语言、有梗但得体的自适应嘴替。
 *
 * 一个自适应 skill（不拆多个场景类），靠 prompt + 截图 + 用户口述自行判断场景与语气。
 * 输出 = reply（最推荐，JSON 第一键）+ candidates（2-3 条带风格标签备选）+ rationale。
 */
import { Agent } from '@openai/agents';
import { coachModelSettings, getCoachModelName } from '../../core/provider.js';
import { parseCoachOutput, type CoachOutput } from './schema.js';

const INSTRUCTIONS = `你是「嘴替」——帮用户把"想说又说不好 / 说不出口"的话，替 ta 说得漂亮、能直接发出去。

用户正处在电脑上某个对话场景里（微信/群聊、评论区、邮件、Slack、GitHub、短信……），
ta 会用中文或口语（可能带情绪、不通顺、甚至脏话）说出"想表达的意思"。

通常附一张**当前屏幕截图**。第一步先看图判断：ta 在跟谁说、对方说了什么、是什么关系与气氛
（暧昧 / 朋友 / 吵架对线 / 对领导 / 对客户），据此定语气。不要问"你在哪个页面"——自己从截图看；
看不清的关键信息，在 rationale 里说明你的假设。

输出规则：
1. 用对方对话所在的语言回复：中文场景回中文；英文场景回**地道**英文（绝不机翻味）。
2. reply：你最推荐的那一条，可直接复制发出。
3. candidates：再给 2-3 条不同风格的备选，每条配一个简短风格标签
   （如 "更撩" / "更稳" / "更皮" / "更专业" / "机智回怼" / "更暖"），让用户挑；text 必须是可直接发的话。
4. 分寸：恋爱要接得住情绪、不舔不端；职场要得体专业、不卑微；
   对线**只做机智、有理有据的回怼——严禁人身攻击、脏话、歧视、教唆网暴**，不确定就走稳妥路线。
5. 可以有梗、接地气、有网感，但一切服务于"能真的发出去"，不要为搞笑牺牲得体。
6. rationale：一句话说明你判断的场景与语气策略（中文）。

只输出一个 JSON 对象（不要 markdown 围栏或多余解释），结构如下：
{
  "reply": string,                          // 最推荐的一条，可直接发（必须排第一）
  "candidates": [                           // 2-3 条备选
    { "text": string, "style": string }     // text=可直接发的话；style=简短风格标签
  ],
  "rationale": string                       // 一句话场景与语气判断
}`;

/**
 * 嘴替 Agent。
 *
 * 不设 outputType（MiMo 不支持严格 json_schema）；JSON 经 modelSettings.providerData
 * 的 json_object 产出，由 parseCoachOutput（zod）从宽校验。
 */
export const ReplyCoach = new Agent({
  name: '嘴替',
  instructions: INSTRUCTIONS,
  model: getCoachModelName(),
  modelSettings: coachModelSettings,
});

/** 导出 INSTRUCTIONS 供 invariants 测试断言 reply 第一键约束。 */
export { INSTRUCTIONS };

/**
 * 构造给嘴替的用户输入。
 *
 * - 无截图：返回纯文本字符串（CLI 文本模式）。
 * - 有截图：返回多模态 messages 数组（text + input_image），让模型看屏判断场景。
 *
 * @param text 用户语音说的真心话（中文/口语/带情绪均可）。
 * @param screenshotDataUrl 当前屏幕截图的 PNG data URL（由 harness 截屏后转）。
 * @returns 直接作为 run() 的 input（string 或多模态 messages）。
 */
export function buildUserInput(
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

/** 重新导出 parseCoachOutput，统一从本模块入口拿解析器。 */
export { parseCoachOutput };
export type { CoachOutput };

/**
 * reply skill 注册项（Plan 6 一般化：Skill 接口含 agent + buildInput）。
 *
 * 供 modules/index.ts 统一注册，router 按 id 调度。
 */
export const replySkill = {
  id: 'reply',
  name: '嘴替',
  description: '替你把话说漂亮——恋爱/对线/职场/英文，跨场景跨语言',
  instructions: INSTRUCTIONS,
  agent: ReplyCoach,
  buildInput: buildUserInput,
  parseOutput: parseCoachOutput,
} as const;
