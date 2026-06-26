/**
 * Plan 8 Task 2: 验证路线 A 的两个关键风险。
 *
 * 风险 1：tool call 后第二轮能 stream 吗？
 *   - 第一轮 LLM 发 tool_calls（无 content）
 *   - SDK 执行 tool（返回 SKILL.md 内容）
 *   - 第二轮 LLM 按 SKILL.md 指令生成 —— 这轮能 stream 吗？
 *
 * 风险 2：json_object + tool calling 能共存吗？
 *   - reply skill 要 json_object 强制 JSON 输出
 *   - 但 tool calling 那一轮 LLM 要发 tool_calls（不是 JSON）
 *   - 如果全程 json_object，LLM 还能发 tool_calls 吗？
 *
 * 验证方式：用 @openai/agents SDK 跑一个最小 Agent + choose_skill tool，
 * 看 stream 事件序列 + 最终输出。
 */
import { config as loadDotenv } from 'dotenv';
import { Agent, run, tool, setOpenAIAPI, setDefaultOpenAIClient } from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

loadDotenv();

const apiKey = process.env.LLM_API_KEY;
const baseURL = process.env.LLM_BASE_URL;
const model = process.env.LLM_MODEL;

if (!apiKey || !baseURL || !model) {
  console.error('缺少 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL');
  process.exit(1);
}

setOpenAIAPI('chat_completions');
setDefaultOpenAIClient(new OpenAI({ baseURL, apiKey }));

const SKILL_MD = {
  reply: `# 嘴替 reply skill

你是嘴替。用户说了真心话，你给几条能直接发的神回复。

## 输出格式（JSON，第一键必须是 reply）
只输出一个 JSON 对象（不要 markdown 围栏）：
{
  "reply": "最推荐的一条，可直接发",
  "candidates": [{ "text": "备选", "style": "风格标签" }],
  "rationale": "一句话场景判断"
}

## 风格
机智、有理有据、有网感。严禁人身攻击/脏话/网暴。`,
  explain: `# 看屏讲解 explain skill

你是看屏讲解员。屏幕上有英文/难懂内容，用户想搞懂。

## 输出格式（JSON，第一键必须是 title）
{
  "title": "一句话标题",
  "content": "讲解内容",
  "bullets": ["要点1", "要点2"]
}`,
  summarize: `# 总结讨论 summarize skill

你是总结员。群聊/邮件/长讨论，用户想看要点。

## 输出格式（JSON，第一键必须是 title）
{
  "title": "一句话标题",
  "keyPoints": ["要点1", "要点2"],
  "actionItems": ["待办1"]
}`,
};

const chooseSkillTool = tool({
  name: 'choose_skill',
  description: '根据用户意图选择对应的 skill。选完后按返回的 SKILL.md 指令生成回复。',
  parameters: z.object({
    skill: z.enum(['reply', 'explain', 'summarize']).describe('选中的 skill id'),
  }),
  execute: async ({ skill }) => {
    console.log(`  [tool] choose_skill 被调用: ${skill}`);
    return { skill, instructions: SKILL_MD[skill] };
  },
});

// 关键测试：json_object + tool calling 共存
const MiraAgent = new Agent({
  name: '嘴替',
  instructions: `你是嘴替路由器。根据用户输入调 choose_skill 选 skill，然后按返回的 SKILL.md 指令生成回复。`,
  model,
  modelSettings: { providerData: { json_object: {} } },  // 测试 json_object + tool calling 共存
  tools: [chooseSkillTool],
});

const cases = [
  '帮我怼回去：他说我代码像屎山',
  '屏幕上这段英文什么意思：The quick brown fox jumps over the lazy dog',
  '总结：张三说项目延期，李四说要加班，王五说周末开会',
];

for (const userText of cases) {
  console.log('\n========================================');
  console.log('用户输入:', userText);
  console.log('----------------------------------------');
  try {
    const stream = await run(MiraAgent, userText, { stream: true });
    let contentChunkCount = 0;
    let reasoningChunkCount = 0;
    let toolCallChunkCount = 0;
    let firstContentTs = 0;
    const startTs = Date.now();
    const eventTypes = new Set();
    let rawEventCount = 0;
    for await (const ev of stream) {
      eventTypes.add(ev.type);
      if (ev.type === 'raw_model_stream_event') {
        rawEventCount++;
        const d = ev.data;
        // SDK 包了一层：{ type, event: { choices } } 或 { type, providerData: { choices } }
        const inner = d.event ?? d.providerData ?? d;
        const choices = inner.choices;
        const delta = choices?.[0]?.delta;
        if (delta?.content) {
          if (contentChunkCount === 0) {
            firstContentTs = Date.now();
            console.log(`  [stream] 首个 content chunk @ +${firstContentTs - startTs}ms`);
          }
          contentChunkCount++;
          if (contentChunkCount <= 10 || contentChunkCount % 30 === 0) {
            process.stdout.write(delta.content);
          }
        }
        if (delta?.reasoning_content) {
          reasoningChunkCount++;
        }
        if (delta?.tool_calls) {
          toolCallChunkCount++;
          if (toolCallChunkCount <= 2) {
            console.log(`  [stream] tool_calls chunk:`, JSON.stringify(delta.tool_calls).slice(0, 100));
          }
        }
      }
    }
    console.log(`\n  [events] 类型: ${[...eventTypes].join(', ')}, raw 总数: ${rawEventCount}`);
    console.log(`  [chunks] content: ${contentChunkCount}, reasoning: ${reasoningChunkCount}, tool_calls: ${toolCallChunkCount}`);
    console.log(`\n  [done] 总耗时: ${Date.now() - startTs}ms`);
    const final = (stream.finalOutput ?? '').toString();
    console.log('  [finalOutput] len=', final.length, 'preview=', final.slice(0, 200));
  } catch (err) {
    console.error('  [error]', err instanceof Error ? err.message : String(err));
  }
}
