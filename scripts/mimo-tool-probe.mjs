/**
 * Plan 8 Task 0: 验证 MiMo 是否支持 OpenAI tool calling 协议。
 *
 * 直接调 MiMo chat.completions with tools，看是否返回 tool_calls。
 * 不经过 agents SDK，纯 openai 客户端，最小化变量。
 *
 * 用法：node scripts/mimo-tool-probe.mjs
 * 需要 .env 里 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 配好。
 */
import { config as loadDotenv } from 'dotenv';
import OpenAI from 'openai';

loadDotenv();

const apiKey = process.env.LLM_API_KEY;
const baseURL = process.env.LLM_BASE_URL;
const model = process.env.LLM_MODEL;

if (!apiKey || !baseURL || !model) {
  console.error('缺少 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL');
  process.exit(1);
}

const client = new OpenAI({ baseURL, apiKey });

const tools = [
  {
    type: 'function',
    function: {
      name: 'choose_skill',
      description: '根据用户意图选择对应的 skill',
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            enum: ['reply', 'explain', 'summarize'],
            description: '选中的 skill id',
          },
        },
        required: ['skill'],
      },
    },
  },
];

const cases = [
  '帮我怼回去：他说我代码像屎山',
  '屏幕上这段英文什么意思',
  '总结一下这个群聊的要点',
];

for (const userText of cases) {
  console.log('\n========================================');
  console.log('用户输入:', userText);
  console.log('----------------------------------------');
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: '你是路由器。根据用户输入调 choose_skill 选 skill。只调一次。',
        },
        { role: 'user', content: userText },
      ],
      tools,
      tool_choice: 'auto',
    });
    const msg = resp.choices?.[0]?.message;
    console.log('finish_reason:', resp.choices?.[0]?.finish_reason);
    console.log('content:', msg?.content);
    console.log('tool_calls:', JSON.stringify(msg?.tool_calls, null, 2));
  } catch (err) {
    console.error('请求失败:', err?.message ?? err);
    if (err?.response) {
      console.error('HTTP', err.response.status, err.response.statusText);
      try {
        console.error(JSON.stringify(err.response.data, null, 2));
      } catch {}
    }
  }
}
