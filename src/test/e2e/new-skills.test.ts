/**
 * Plan-12 真 LLM e2e：新增 5 个 skill 的自动选用验证。本机 E2E_SKIP=0 跑；CI 默认跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOULD_RUN_E2E, SKIP_REASON } from './setup.js';
import { runSkill } from '../../modules/skill-runner.js';

test('xiaohongshu：自动选用 + primary 蹦字 + emit 候选', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const { output } = await runSkill('帮我把今天喝的这杯咖啡写成小红书种草文案', undefined);
  assert.equal(output.skillId, 'xiaohongshu', 'agent 应 read xiaohongshu skill');
  assert.ok(output.primary.text.length > 0, 'primary 为空');
  assert.ok(output.items.length >= 1, '没候选 items');
});

test('dun：自动选用 + 候选', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const { output } = await runSkill('帮我催一下甲方，这个月的款还没打', undefined);
  assert.equal(output.skillId, 'dun', 'agent 应 read dun skill');
  assert.ok(output.primary.text.length > 0, 'primary 为空');
  assert.ok(output.items.length >= 1, '没候选 items');
});

test('email：自动选用 + 候选', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const { output } = await runSkill('帮我回一封邮件，客户问项目延期原因，我不知道怎么措辞', undefined);
  assert.equal(output.skillId, 'email', 'agent 应 read email skill');
  assert.ok(output.primary.text.length > 0, 'primary 为空');
  assert.ok(output.items.length >= 1, '没候选 items');
});

test('decode：自动选用', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const { output } = await runSkill('他说"你随意就好"，这是不是阴阳怪气？', undefined);
  assert.equal(output.skillId, 'decode', 'agent 应 read decode skill');
  assert.ok(output.primary.text.length > 0, 'primary 为空');
});

test('debate：自动选用 + 候选 + 无侮辱性用语（红线抽检）', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  const { output } = await runSkill('网上有人说我这条评论没水平，帮我怼回去', undefined);
  assert.equal(output.skillId, 'debate', 'agent 应 read debate skill');
  assert.ok(output.primary.text.length > 0, 'primary 为空');
  assert.ok(output.items.length >= 1, '没候选 items');
  const allText = output.primary.text + output.items.map((i) => i.text).join('') + (output.note ?? '');
  const slurPattern = /傻[逼屄比]|智障|废物|脑残|滚|去死/;
  assert.doesNotMatch(allText, slurPattern, 'debate 输出不得含侮辱性用语（红线抽检，非穷举）');
});
