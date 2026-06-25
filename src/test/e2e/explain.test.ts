/**
 * explain skill 真 LLM e2e 测试（Plan 7 Task 4）。
 *
 * 调真 MiMo API 跑 explain skill（看屏讲解），断言 ExplainOutput 形状正确。
 * 本机跑：E2E_SKIP=0 npm test（或 npm run test:e2e）
 * CI/默认：跳过（无 Key、花钱、慢）
 *
 * 注意：e2e 不带截图（screenshotDataUrl=undefined），靠 text 触发 explain 语义。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSkill, type RunSkillResult } from '../../modules/skill-runner.js';
import { initProvider } from '../../core/provider.js';
import type { ExplainOutputDTO } from '../../shared/ipc.js';
import { SHOULD_RUN_E2E, SKIP_REASON } from './setup.js';

const skip = !SHOULD_RUN_E2E ? SKIP_REASON : false;

before(() => {
  if (SHOULD_RUN_E2E) initProvider();
});

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) console.log(`[retry] attempt ${i + 1} failed, retrying...`);
    }
  }
  throw lastErr;
}

function asExplainOutput(result: RunSkillResult): ExplainOutputDTO {
  assert.equal(result.skillId, 'explain', `router 应判 explain，实际 ${result.skillId}`);
  assert.equal(result.output.skillId, 'explain');
  if (result.output.skillId !== 'explain') throw new Error('unreachable');
  return result.output;
}

function assertExplainShape(o: ExplainOutputDTO): void {
  assert.equal(typeof o.title, 'string', 'title 必须 string');
  assert.ok(o.title.length > 0, `title 不能为空`);

  assert.equal(typeof o.content, 'string', 'content 必须 string');
  assert.ok(o.content.length >= 10, `content 太短（${o.content.length}）：${o.content}`);

  // bullets 可选；存在则必须是 string 数组
  if (o.bullets !== undefined) {
    assert.ok(Array.isArray(o.bullets), 'bullets 必须是数组');
    for (const b of o.bullets) {
      assert.equal(typeof b, 'string', 'bullet 必须 string');
      assert.ok(b.length > 0, 'bullet 不能为空');
    }
  }
}

function assertSummary(result: RunSkillResult): void {
  const summaryPath = resolve(process.cwd(), 'logs', 'runs', `${result.summary.runId}.json`);
  assert.ok(existsSync(summaryPath), `run summary 文件应存在：${summaryPath}`);
  assert.equal(result.summary.skillId, 'explain');
  assert.ok(result.summary.outputShape.contentLen! >= 10, 'summary.outputShape.contentLen 应 >= 10');
  assert.ok(result.summary.latencyMs > 0, 'latencyMs 应 > 0');
  assert.ok(result.summary.rawOutputLen > 0, 'rawOutputLen 应 > 0');
  assert.equal(result.summary.errors, undefined, '成功路径不应有 errors');
}

test('explain e2e: 英文单词讲解', { skip }, async () => {
  const result = await withRetry(() => runSkill('rizz 啥意思', undefined));
  const o = asExplainOutput(result);
  console.log('[explain 单词] title:', o.title);
  console.log('[explain 单词] content:', o.content.slice(0, 80));
  assertExplainShape(o);
  assertSummary(result);
});

test('explain e2e: 看不懂内容讲解', { skip }, async () => {
  const result = await withRetry(() => runSkill('这块技术文档看不懂，讲解一下', undefined));
  const o = asExplainOutput(result);
  console.log('[explain 文档] title:', o.title);
  console.log('[explain 文档] content:', o.content.slice(0, 80));
  assertExplainShape(o);
  assertSummary(result);
});
