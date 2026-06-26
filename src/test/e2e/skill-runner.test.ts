/**
 * Plan 8 真 LLM e2e：runSkill 跑 mira session，agent 自动选用 skill。
 * 本机 E2E_SKIP=0 跑（真调 MiMo）；CI 默认跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOULD_RUN_E2E, SKIP_REASON } from './setup.js';
import { runSkill } from '../../modules/skill-runner.js';

test('reply：自动选 reply + primary 蹦字 + emit 候选', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  let chunks = 0;
  const { output } = await runSkill('帮我怼回去：他说我代码像屎山', undefined, {
    onReplyChunk: () => {
      chunks++;
    },
  });
  assert.equal(output.skillId, 'reply', 'agent 应 read reply skill');
  assert.ok(output.primary.text.length > 0, 'primary 为空');
  assert.ok(chunks > 1, '没流式蹦字');
  assert.ok(output.items.length >= 1, '没候选 items');
});

test('explain：自动选 explain', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const { output } = await runSkill('屏幕上这个单词 rizz 到底什么意思', undefined);
  assert.equal(output.skillId, 'explain', 'agent 应 read explain skill');
  assert.ok(output.primary.text.length > 0, 'primary 为空');
});
