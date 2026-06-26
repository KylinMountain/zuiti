/**
 * Plan 8 Task 4：createMiraSession 注入嘴替 prompt + 三个 skill + read/emit 工具。
 * 需真 LLM 配置（构造 provider），本机 E2E_SKIP=0 跑；CI 跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMiraSession } from '../modules/mira/session.js';

const RUN = process.env.E2E_SKIP === '0';

test('createMiraSession 注入嘴替 prompt + 三个 skill + read/emit_result', { skip: !RUN }, async () => {
  const { session, getEmit } = await createMiraSession();
  const sp = session.systemPrompt;
  assert.match(sp, /嘴替/, 'system prompt 未替换为嘴替');
  assert.doesNotMatch(sp, /general coding agent/, '仍是默认 coding prompt');
  assert.match(sp, /available_skills/, 'skills 未注入');
  assert.match(sp, /reply/, '缺 reply skill');
  assert.match(sp, /explain/, '缺 explain skill');
  assert.match(sp, /summarize/, '缺 summarize skill');
  assert.deepEqual(session.getActiveToolNames().sort(), ['emit_result', 'read']);
  assert.equal(getEmit(), null);
  session.dispose?.();
});
