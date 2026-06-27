/**
 * 主进程核心链路冒烟（Plan 7/8）。
 *
 * 不启动 Electron GUI，直接调 runSkill 纯函数，验证：
 *   session 创建 → agent 自动选用 skill → 文本流式蹦字 → emit_result → UniversalOutput → RunSummary。
 *
 * 沙箱可跑（需 .env LLM_API_KEY）。写 logs/smoke/main-<ts>.json 摘要供 LLM/agent 诊断。
 *
 * 用法：
 *   node scripts/smoke-main.mjs                  # 默认跑 reply 场景
 *   node scripts/smoke-main.mjs "总结：张三延期"  # 自定义输入
 *   node scripts/smoke-main.mjs --with-image     # 带截图（沙箱无截屏，用 1x1 PNG 占位）
 */
import { config as loadDotenv } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadDotenv();

const userInput = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1])
  ?? '帮我怼回去：他说我代码像屎山';
const withImage = process.argv.includes('--with-image');

// 1x1 PNG 占位（沙箱无截屏，只验 image block 传递）
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

console.log('[smoke-main] 开始');
console.log('[smoke-main] 输入:', userInput);
console.log('[smoke-main] 带图:', withImage);
console.log('[smoke-main] LLM_MODEL:', process.env.LLM_MODEL ?? '(未配置)');

if (!process.env.LLM_API_KEY) {
  console.error('[smoke-main] FAIL: 缺 LLM_API_KEY（.env 未配置）');
  process.exit(1);
}

const { runSkill } = await import('../dist/modules/skill-runner.js');

const steps = [];
const step = (name, fn) => {
  const t0 = Date.now();
  return Promise.resolve(fn()).then(
    (r) => { steps.push({ name, status: 'pass', latencyMs: Date.now() - t0 }); return r; },
    (e) => { steps.push({ name, status: 'fail', latencyMs: Date.now() - t0, error: e?.message ?? String(e) }); throw e; },
  );
};

let chunkCount = 0;
let firstChunkAt = 0;
let ttsAt = 0;

try {
  const startTs = Date.now();
  const { output, summary } = await step('runSkill', () =>
    runSkill(userInput, withImage ? PNG_1x1 : undefined, {
      onReplyChunk: () => {
        chunkCount++;
        if (!firstChunkAt) firstChunkAt = Date.now();
      },
      onTtsStart: () => { if (!ttsAt) ttsAt = Date.now(); },
    }),
  );

  const result = {
    ts: new Date(startTs).toISOString(),
    input: userInput,
    withImage,
    totalMs: Date.now() - startTs,
    firstChunkMs: firstChunkAt ? firstChunkAt - startTs : null,
    ttsStartMs: ttsAt ? ttsAt - startTs : null,
    chunkCount,
    skillId: output.skillId ?? 'unknown',
    primaryLen: output.primary.text.length,
    primaryPreview: output.primary.text.slice(0, 200),
    itemsCount: output.items.length,
    items: output.items.map((i) => ({ label: i.label, copyable: i.copyable, textPreview: i.text.slice(0, 80) })),
    title: output.title ?? null,
    note: output.note ?? null,
    summary,
    steps,
  };

  const outDir = resolve(process.cwd(), 'logs', 'smoke');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `main-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

  console.log('[smoke-main] PASS');
  console.log('  skillId:', result.skillId);
  console.log('  首字延迟:', result.firstChunkMs + 'ms');
  console.log('  TTS 启动:', result.ttsStartMs + 'ms');
  console.log('  总耗时:', result.totalMs + 'ms');
  console.log('  primary:', result.primaryPreview.slice(0, 80) + '...');
  console.log('  items:', result.itemsCount);
  console.log('  摘要:', outFile);
} catch (err) {
  const outDir = resolve(process.cwd(), 'logs', 'smoke');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `main-${Date.now()}-fail.json`);
  writeFileSync(outFile, JSON.stringify({
    ts: new Date().toISOString(),
    input: userInput,
    withImage,
    error: err?.message ?? String(err),
    stack: err?.stack,
    steps,
  }, null, 2) + '\n', 'utf8');
  console.error('[smoke-main] FAIL:', err?.message ?? err);
  console.error('  摘要:', outFile);
  process.exit(1);
}
