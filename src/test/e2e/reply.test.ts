/**
 * reply skill 真 LLM e2e 测试（Plan 7 Task 3）。
 *
 * 调真 MiMo API 跑 reply skill（恋爱/对线/职场 3 场景），断言 SkillOutput 形状正确。
 * 本机跑：E2E_SKIP=0 npm test（或 npm run test:e2e）
 * CI/默认：跳过（无 Key、花钱、慢）
 *
 * 每个场景调 runSkill（含 router + skill agent），最多 retry 2 次（MiMo 偶尔非 JSON/超时）。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSkill, type RunSkillResult } from '../../modules/skill-runner.js';
import { initProvider } from '../../core/provider.js';
import type { CoachOutputDTO } from '../../shared/ipc.js';
import { SHOULD_RUN_E2E, SKIP_REASON } from './setup.js';

const skip = !SHOULD_RUN_E2E ? SKIP_REASON : false;

before(() => {
  if (SHOULD_RUN_E2E) initProvider();
});

/** 最多 retry 2 次（MiMo 偶尔返回非 JSON 或超时，parser 从宽但 run 本身可能抛错）。 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) {
        console.log(`[retry] attempt ${i + 1} failed, retrying...`);
      }
    }
  }
  throw lastErr;
}

/** 断言 result 是 reply skill 输出，narrow 后返回 CoachOutputDTO。 */
function asReplyOutput(result: RunSkillResult): CoachOutputDTO {
  assert.equal(result.skillId, 'reply', `router 应判 reply，实际 ${result.skillId}`);
  assert.equal(result.output.skillId, 'reply');
  if (result.output.skillId !== 'reply') throw new Error('unreachable');
  return result.output;
}

/** 断言 reply 输出形状（reply/candidates/rationale）。 */
function assertReplyShape(o: CoachOutputDTO): void {
  assert.equal(typeof o.reply, 'string', 'reply 必须是 string');
  assert.ok(o.reply.length >= 5, `reply 太短（${o.reply.length}）：${o.reply}`);

  assert.ok(Array.isArray(o.candidates), 'candidates 必须是数组');
  assert.ok(o.candidates.length >= 1, `至少 1 条 candidate，实际 ${o.candidates.length}`);
  for (const c of o.candidates) {
    assert.equal(typeof c.text, 'string', 'candidate.text 必须 string');
    assert.ok(c.text.length > 0, 'candidate.text 不能为空');
    assert.equal(typeof c.style, 'string', 'candidate.style 必须 string');
  }

  assert.equal(typeof o.rationale, 'string', 'rationale 必须 string');
}

/** 断言 run summary 文件 + 形状。 */
function assertSummary(result: RunSkillResult): void {
  const summaryPath = resolve(process.cwd(), 'logs', 'runs', `${result.summary.runId}.json`);
  assert.ok(existsSync(summaryPath), `run summary 文件应存在：${summaryPath}`);
  assert.equal(result.summary.skillId, 'reply');
  assert.ok(result.summary.outputShape.replyLen! >= 5, 'summary.outputShape.replyLen 应 >= 5');
  assert.ok(result.summary.outputShape.candidatesCount! >= 1, 'summary.outputShape.candidatesCount 应 >= 1');
  assert.ok(result.summary.latencyMs > 0, 'latencyMs 应 > 0');
  assert.ok(result.summary.rawOutputLen > 0, 'rawOutputLen 应 > 0');
  assert.equal(result.summary.errors, undefined, '成功路径不应有 errors');
}

test('reply e2e: 恋爱场景', { skip }, async () => {
  const result = await withRetry(() =>
    runSkill('他昨天没回我消息，我该不该主动找他', undefined),
  );
  const o = asReplyOutput(result);
  console.log('[恋爱] reply:', o.reply.slice(0, 80));
  console.log('[恋爱] candidates:', o.candidates.map((c) => c.style).join(', '));
  assertReplyShape(o);
  assertSummary(result);
});

test('reply e2e: 对线场景', { skip }, async () => {
  const result = await withRetry(() =>
    runSkill('同事在群里阴阳怪气说我划水，怎么怼回去', undefined),
  );
  const o = asReplyOutput(result);
  console.log('[对线] reply:', o.reply.slice(0, 80));
  // 对线红线：reply 不应含脏话/人身攻击（prompt 约束，e2e 抽样验证）
  const bad = /(傻逼|操你|去死|滚你|废物|贱人)/;
  assert.ok(!bad.test(o.reply), `reply 含不当词汇：${o.reply}`);
  assertReplyShape(o);
  assertSummary(result);
});

test('reply e2e: 职场场景', { skip }, async () => {
  const result = await withRetry(() =>
    runSkill('老板让我周末加班，我想拒绝但不想撕破脸', undefined),
  );
  const o = asReplyOutput(result);
  console.log('[职场] reply:', o.reply.slice(0, 80));
  assertReplyShape(o);
  assertSummary(result);
});
