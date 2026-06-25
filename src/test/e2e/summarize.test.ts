/**
 * summarize skill 真 LLM e2e 测试（Plan 7 Task 4）。
 *
 * 调真 MiMo API 跑 summarize skill（讨论总结），断言 SummarizeOutput 形状正确。
 * 本机跑：E2E_SKIP=0 npm test（或 npm run test:e2e）
 * CI/默认：跳过（无 Key、花钱、慢）
 *
 * 注意：e2e 不带截图，靠 text 触发 summarize 语义。模型无真实讨论内容可总结，
 * 可能编一段或回退 —— e2e 只验证输出形状，不验证内容质量。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSkill, type RunSkillResult } from '../../modules/skill-runner.js';
import { initProvider } from '../../core/provider.js';
import type { SummarizeOutputDTO } from '../../shared/ipc.js';
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

function asSummarizeOutput(result: RunSkillResult): SummarizeOutputDTO {
  assert.equal(result.skillId, 'summarize', `router 应判 summarize，实际 ${result.skillId}`);
  assert.equal(result.output.skillId, 'summarize');
  if (result.output.skillId !== 'summarize') throw new Error('unreachable');
  return result.output;
}

function assertSummarizeShape(o: SummarizeOutputDTO): void {
  assert.equal(typeof o.title, 'string', 'title 必须 string');
  assert.ok(o.title.length > 0, `title 不能为空`);

  assert.ok(Array.isArray(o.keyPoints), 'keyPoints 必须是数组');
  assert.ok(o.keyPoints.length >= 1, `至少 1 条 keyPoint，实际 ${o.keyPoints.length}`);
  for (const k of o.keyPoints) {
    assert.equal(typeof k, 'string', 'keyPoint 必须 string');
    assert.ok(k.length > 0, 'keyPoint 不能为空');
  }

  // actionItems 可选；存在则必须是 string 数组
  if (o.actionItems !== undefined) {
    assert.ok(Array.isArray(o.actionItems), 'actionItems 必须是数组');
    for (const a of o.actionItems) {
      assert.equal(typeof a, 'string', 'actionItem 必须 string');
      assert.ok(a.length > 0, 'actionItem 不能为空');
    }
  }
}

function assertSummary(result: RunSkillResult): void {
  const summaryPath = resolve(process.cwd(), 'logs', 'runs', `${result.summary.runId}.json`);
  assert.ok(existsSync(summaryPath), `run summary 文件应存在：${summaryPath}`);
  assert.equal(result.summary.skillId, 'summarize');
  assert.ok(result.summary.outputShape.keyPointsCount! >= 1, 'summary.outputShape.keyPointsCount 应 >= 1');
  assert.ok(result.summary.latencyMs > 0, 'latencyMs 应 > 0');
  assert.ok(result.summary.rawOutputLen > 0, 'rawOutputLen 应 > 0');
  assert.equal(result.summary.errors, undefined, '成功路径不应有 errors');
}

test('summarize e2e: 总结讨论', { skip }, async () => {
  const result = await withRetry(() =>
    runSkill('总结一下：产品说下周上线，开发说来不及，测试说没环境。归纳要点', undefined),
  );
  const o = asSummarizeOutput(result);
  console.log('[summarize] title:', o.title);
  console.log('[summarize] keyPoints:', o.keyPoints.length, '条');
  assertSummarizeShape(o);
  assertSummary(result);
});
