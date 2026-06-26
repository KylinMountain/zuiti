/**
 * 探针：MiMo 是否支持关闭 thinking（reasoning），用哪个参数。
 * 直接裸 openai client，试多种"关 thinking"参数，看 reasoning_content 是否消失 + content 首字是否提前。
 * 用法：node scripts/mimo-thinking-probe.mjs
 */
import { config } from 'dotenv';
import OpenAI from 'openai';
config();

const client = new OpenAI({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY });
const model = process.env.LLM_MODEL ?? 'mimo-v2.5-pro';
const prompt = '帮我怼回去：他说我代码像屎山';

const cases = [
  { name: 'default（基线）', extra: {} },
  { name: 'enable_thinking:false', extra: { enable_thinking: false } },
  { name: 'reasoning_effort:minimal', extra: { reasoning_effort: 'minimal' } },
  { name: 'thinking:false', extra: { thinking: false } },
  { name: 'chat_template_kwargs.enable_thinking:false', extra: { chat_template_kwargs: { enable_thinking: false } } },
  { name: 'thinking:{type:disabled}', extra: { thinking: { type: 'disabled' } } },
];

for (const c of cases) {
  const t0 = Date.now();
  let firstR = 0, firstC = 0, rlen = 0, clen = 0;
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      ...c.extra,
    });
    for await (const chunk of stream) {
      const d = chunk.choices?.[0]?.delta;
      if (d?.reasoning_content) { if (!firstR) firstR = Date.now(); rlen += d.reasoning_content.length; }
      if (d?.content) { if (!firstC) firstC = Date.now(); clen += d.content.length; }
    }
    console.log(
      `[${c.name}]\n   reasoning: 首字 ${firstR ? firstR - t0 : '-'}ms, len=${rlen}` +
      `  |  content: 首字 ${firstC ? firstC - t0 : '-'}ms, len=${clen}  |  总 ${Date.now() - t0}ms`,
    );
  } catch (e) {
    console.log(`[${c.name}] ERROR: ${(e?.message ?? String(e)).slice(0, 160)}`);
  }
}
