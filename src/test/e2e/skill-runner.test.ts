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

// 多模态截图 e2e：验证带 image content block 的 runSkill 不崩 + UniversalOutput/RunSummary 形状正确。
// 用 1x1 PNG（最小有效图）——目的不是测 MiMo 看懂图，而是验证 pipeline 传递 image block 正确。
// 真实截图需本机 Electron desktopCapturer（沙箱跑不了），这里只验 plumbing。
// 注：MiMo chat_completions + 1x1 无语义图可能返回空 content（模型行为，非 pipeline bug），
//     所以不断言 primary.text 非空，只验形状 + 不崩。
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('多模态：带截图的 runSkill 不崩 + 形状正确', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const { output, summary } = await runSkill('看屏幕上这段内容，帮我总结一下', PNG_1x1);
  // 只验 plumbing 形状（1x1 图无语义，模型可能返回空 content）
  assert.equal(typeof output.primary.text, 'string', 'primary.text 类型错');
  assert.ok(Array.isArray(output.items), 'items 不是数组');
  assert.equal(summary.inputLen, '看屏幕上这段内容，帮我总结一下'.length, 'summary.inputLen 错');
  assert.ok(summary.latencyMs > 0, 'latencyMs 应 > 0');
});
