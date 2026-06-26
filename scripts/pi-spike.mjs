/**
 * Phase 0 spike：pi + MiMo 端到端「真 skills 自动选用」验证（路 1：内建 read 工具）。
 * 对应 docs/design-docs/2026-06-26-pi-migration-design.md。
 *
 * 验证核心诉求：3 个 SKILL.md 注册进去 → agent 看输入自己 read 对的那个 → 按其协议生成。
 *   - 关 thinking（compat: chat_template_kwargs.enable_thinking=false）
 *   - tools: ['read','emit_result']（read=pi 内建，加载 skill 正文；emit_result=结构化输出）
 *   - primary 文本流式（蹦字）+ emit_result 补结构化
 *
 * 用法：node scripts/pi-spike.mjs
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  AuthStorage, ModelRegistry, SessionManager, createAgentSession, defineTool,
} from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: join(repoRoot, '.env') });

const apiKey = process.env.LLM_API_KEY;
const baseUrl = process.env.LLM_BASE_URL;
const modelId = process.env.LLM_MODEL ?? 'mimo-v2.5-pro';
if (!apiKey || !baseUrl) { console.error('缺少 LLM_API_KEY / LLM_BASE_URL'); process.exit(1); }

// ---- 写 3 个 SKILL.md ----
const workDir = join(repoRoot, 'scripts', '.pi-spike-work');
const skillsRoot = join(workDir, '.pi', 'skills');
const OUTPUT_PROTOCOL = `
## 输出协议（严格按顺序）
1. 先用普通文本写出主体内容（推荐回复 / 讲解正文 / 总结开头），会实时流式显示。
2. 然后调用 emit_result 工具补充结构化：items（带 label 的条目）+ 可选 title + note。`;
const skills = {
  reply: '替用户把话说漂亮——恋爱/对线/职场/英文回复。当用户想"怎么回这句""帮我接话""怼回去""请假怎么说"时使用。',
  explain: '看屏讲解——屏幕上的英文单词/技术术语/难懂内容，用户想搞懂时使用（"啥意思""讲解一下""看不懂"）。',
  summarize: '总结讨论——群聊/邮件/长讨论提炼要点，用户想看重点时使用（"总结一下""归纳要点""太长了"）。',
};
for (const [name, desc] of Object.entries(skills)) {
  const dir = join(skillsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# 嘴替 ${name}\n\n${desc}\n${OUTPUT_PROTOCOL}\n`);
}

// ---- provider（关 thinking）----
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

// ---- emit_result 工具（通用输出）----
let lastEmit = null;
const emitResultTool = defineTool({
  name: 'emit_result', label: '产出结构化结果',
  description: '写完主体内容后调用，补充结构化的条目/标题/备注。',
  parameters: Type.Object({
    title: Type.Optional(Type.String()),
    items: Type.Array(Type.Object({
      text: Type.String(), label: Type.Optional(Type.String()), copyable: Type.Optional(Type.Boolean()),
    })),
    note: Type.Optional(Type.String()),
  }),
  execute: async (_id, p) => { lastEmit = p; return { content: [{ type: 'text', text: 'ok' }], details: {} }; },
});

// ---- 跑一个 case：新建 session，看 agent read 哪个 skill + 输出 ----
async function runCase(userText) {
  lastEmit = null;
  const { session } = await createAgentSession({
    model, modelRegistry, authStorage,
    tools: ['read', 'emit_result'],
    customTools: [emitResultTool],
    sessionManager: SessionManager.inMemory(workDir),
    cwd: workDir,
  });
  const t0 = Date.now();
  let firstTextMs = 0, primary = '', skillRead = null;
  session.subscribe((e) => {
    const j = (() => { try { return JSON.stringify(e); } catch { return ''; } })();
    const m = j.match(/skills\/(reply|explain|summarize)\/SKILL\.md/);
    if (m && !skillRead) skillRead = m[1];
    const ame = e?.assistantMessageEvent;
    if (ame?.type === 'text_delta' && ame.delta) {
      if (!firstTextMs) firstTextMs = Date.now() - t0;
      primary += ame.delta;
    }
  });
  try { await session.sendUserMessage([{ type: 'text', text: userText }]); }
  catch (err) { console.error('  sendUserMessage 错:', err?.message); }
  session.dispose?.();
  return { userText, skillRead, firstTextMs, totalMs: Date.now() - t0, primary, emit: lastEmit };
}

const cases = [
  { text: '帮我怼回去：他说我代码像屎山', expect: 'reply' },
  { text: '屏幕上这个单词 rizz 到底什么意思', expect: 'explain' },
  { text: '这个群聊吵了一上午，帮我总结一下都说了啥', expect: 'summarize' },
];

console.log('=== 路 1：3 个 skill 自动选用验证 ===\n');
for (const c of cases) {
  const r = await runCase(c.text);
  const ok = r.skillRead === c.expect ? '✅' : '❌';
  console.log(`输入: ${c.text}`);
  console.log(`  期望 skill: ${c.expect}  |  实际 read: ${r.skillRead ?? '(没 read 任何 skill)'}  ${ok}`);
  console.log(`  首字: ${r.firstTextMs || '-'}ms  |  总耗时: ${r.totalMs}ms`);
  console.log(`  primary: ${JSON.stringify(r.primary).slice(0, 140)}`);
  console.log(`  emit items: ${r.emit ? r.emit.items?.length : '❌ 未调'} 条  ${r.emit?.title ? '| title=' + r.emit.title : ''}`);
  console.log('');
}
process.exit(0);
