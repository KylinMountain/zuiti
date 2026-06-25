/**
 * 嘴替 CLI —— 文本模式冒烟入口。
 *
 * 用法：npm run coach -- "对方说'我今天有点不开心'，帮我接住但别太舔"
 *
 * 保留 loadDotenv()（invariants 测试要求）。
 */
import { run } from '@openai/agents';
import { config as loadDotenv } from 'dotenv';
import { ReplyCoach, buildUserInput, parseCoachOutput } from '../modules/reply/coach.js';
import { initProvider } from '../core/provider.js';
import { renderCoachOutput } from './render.js';
import { log } from '../core/log.js';

export { loadDotenv };

async function main(): Promise<void> {
  loadDotenv();
  initProvider();

  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    console.error('用法：npm run coach -- "你想替我说的话的描述"');
    process.exit(1);
  }

  const startedAt = Date.now();
  log.info('coach.run.start', { text });
  const result = await run(ReplyCoach, buildUserInput(text));
  const ms = Date.now() - startedAt;

  const raw = (result.finalOutput ?? '').toString();
  const output = parseCoachOutput(raw);
  log.info('coach.run.done', { ms, tokens: result.state.usage.totalTokens, replyLen: output.reply.length });
  console.log(renderCoachOutput(output));
  console.log(`\n(${ms}ms, ${result.state.usage.totalTokens} tokens)`);
}

// 仅作为入口时运行（导入时不触发，便于单测）。
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
