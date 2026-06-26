/**
 * Plan 8 Task 1：MiMo model 元数据单测（关 thinking + 多模态）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMiraModel } from '../core/mira-model.js';

test('buildMiraModel 关 thinking + 多模态', () => {
  const m = buildMiraModel('https://x/v1', 'mimo-v2.5-pro');
  assert.equal(m.id, 'mimo-v2.5-pro');
  assert.equal(m.api, 'openai-completions');
  assert.equal(m.baseUrl, 'https://x/v1');
  assert.deepEqual(m.compat.chatTemplateKwargs, { enable_thinking: false });
  assert.equal(m.compat.thinkingFormat, 'chat-template');
  assert.ok(m.input.includes('image'));
});
