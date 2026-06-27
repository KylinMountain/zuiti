/**
 * Plan 9 真 LLM e2e：MiraConversation 跨轮记忆。本机 E2E_SKIP=0 跑；CI 默认跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOULD_RUN_E2E, SKIP_REASON } from './setup.js';
import { MiraConversation } from '../../modules/mira/conversation.js';

test('两轮记忆：第二轮记得第一轮给的名字', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const conv = new MiraConversation();
  try {
    await conv.sendTurn('记住，我叫小明，只回复"好的"。', undefined);
    const { output } = await conv.sendTurn('我刚说我叫什么？', undefined);
    assert.match(output.primary.text, /小明/, '第二轮应记得名字');
  } finally {
    conv.dispose();
  }
});
