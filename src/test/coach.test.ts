import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoachOutput, CoachOutput } from '../modules/reply/schema.js';
import { buildUserInput } from '../modules/reply/coach.js';

test('parseCoachOutput: 解析完整输出（reply + candidates + rationale）', () => {
  const out = parseCoachOutput(JSON.stringify({
    reply: '在的，正想你呢',
    candidates: [
      { text: '在，怎么突然找我，是不是想我了', style: '更皮' },
      { text: '在！说吧，今天想被我哄还是逗笑', style: '更稳' },
    ],
    rationale: '暧昧场景，轻松不舔',
  }));
  assert.equal(out.reply, '在的，正想你呢');
  assert.equal(out.candidates.length, 2);
  assert.equal(out.candidates[0]?.style, '更皮');
  assert.equal(out.candidates[1]?.text, '在！说吧，今天想被我哄还是逗笑');
  assert.equal(out.rationale, '暧昧场景，轻松不舔');
});

test('parseCoachOutput: 缺 candidates 时给默认空数组', () => {
  const out = parseCoachOutput(JSON.stringify({ reply: '只有一条' }));
  assert.equal(out.reply, '只有一条');
  assert.deepEqual(out.candidates, []);
  assert.equal(out.rationale, '');
});

test('parseCoachOutput: reply 是硬要求，缺失时兜底用原文', () => {
  const raw = JSON.stringify({ candidates: [{ text: 'x', style: 'y' }] });
  const out = parseCoachOutput(raw);
  assert.ok(out.reply.length > 0);
  assert.deepEqual(out.candidates, []);
});

test('parseCoachOutput: 非 JSON 输入兜底为 reply', () => {
  const out = parseCoachOutput('这不是 JSON');
  assert.equal(out.reply, '这不是 JSON');
  assert.deepEqual(out.candidates, []);
});

test('parseCoachOutput: candidate 缺 style 时给默认空串', () => {
  const out = parseCoachOutput(JSON.stringify({
    reply: 'hi',
    candidates: [{ text: '没标签的备选' }],
  }));
  assert.equal(out.candidates[0]?.style, '');
});

test('CoachOutput schema: reply 是第一个键（不变量文档化）', () => {
  // zod 不强制键序，但 schema 定义里 reply 排第一，作为不变量的文档化约束。
  const keys = Object.keys(CoachOutput.shape);
  assert.equal(keys[0], 'reply');
});

test('buildUserInput: 无截图原样返回文本', () => {
  assert.equal(buildUserInput('帮我接住情绪'), '帮我接住情绪');
  assert.equal(buildUserInput('  空格保留  '), '  空格保留  ');
});

test('buildUserInput: 有截图返回多模态 messages（text + input_image）', () => {
  const result = buildUserInput('帮我接住情绪', 'data:image/png;base64,AAA');
  assert.ok(Array.isArray(result));
  const msg = (result as { role: string; content: { type: string; text?: string; image?: string }[] }[])[0]!;
  assert.equal(msg.role, 'user');
  assert.equal(msg.content[0]?.type, 'input_text');
  assert.equal(msg.content[1]?.type, 'input_image');
  assert.equal(msg.content[1]?.image, 'data:image/png;base64,AAA');
});
