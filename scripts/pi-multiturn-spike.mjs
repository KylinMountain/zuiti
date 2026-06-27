// scripts/pi-multiturn-spike.mjs
// 验证：同一 pi session 多次 sendUserMessage 是否累积上下文（多轮记忆）。
// 用法：E2E 同款，需 .env 的 LLM_API_KEY/LLM_BASE_URL。 node scripts/pi-multiturn-spike.mjs
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AuthStorage, ModelRegistry, SessionManager, createAgentSession } from '@earendil-works/pi-coding-agent';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: join(repoRoot, '.env') });
const apiKey = process.env.LLM_API_KEY;
const baseUrl = process.env.LLM_BASE_URL;
const modelId = process.env.LLM_MODEL ?? 'mimo-v2.5-pro';
if (!apiKey || !baseUrl) { console.error('缺少 LLM_API_KEY / LLM_BASE_URL'); process.exit(1); }

const authStorage = AuthStorage.inMemory();
const modelRegistry = ModelRegistry.inMemory(authStorage);
modelRegistry.registerProvider('mimo', {
  name: 'MiMo', baseUrl, apiKey, api: 'openai-completions',
  models: [{
    id: modelId, name: 'MiMo', api: 'openai-completions', baseUrl,
    reasoning: true, input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 32000,
    compat: { thinkingFormat: 'chat-template', chatTemplateKwargs: { enable_thinking: false } },
  }],
});
const model = modelRegistry.find('mimo', modelId);

function collect(session) {
  let text = '';
  const unsub = session.subscribe((e) => {
    const ame = e?.assistantMessageEvent;
    if (ame?.type === 'text_delta' && ame.delta) text += ame.delta;
  });
  return { get: () => text, unsub };
}

const workDir = join(repoRoot, 'scripts', '.pi-multiturn-work');
const { session } = await createAgentSession({
  model, modelRegistry, authStorage,
  tools: ['read'], sessionManager: SessionManager.inMemory(workDir), cwd: workDir,
});

const c1 = collect(session);
await session.sendUserMessage([{ type: 'text', text: '记住一个数字：42。只回复"好的"。' }]);
c1.unsub();
console.log('轮1:', JSON.stringify(c1.get()).slice(0, 120));

const c2 = collect(session);
await session.sendUserMessage([{ type: 'text', text: '我刚让你记的数字是多少？只回数字。' }]);
c2.unsub();
const answer = c2.get();
console.log('轮2:', JSON.stringify(answer).slice(0, 120));

const ok = answer.includes('42');
console.log(ok ? '✅ 多轮记忆成立：同 session 累积上下文' : '❌ 第二轮没记住 → 需回退到「每轮重建+重放历史」方案');
session.dispose?.();
process.exit(ok ? 0 : 2);
