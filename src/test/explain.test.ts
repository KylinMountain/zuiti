/**
 * ExplainOutput parser 测试 —— 从宽校验策略（Plan 6 Task 2）。
 *
 * 测试覆盖：正常 JSON / JSON 解析失败 / zod 失败但能抢救 content / bullets 可选。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExplainOutput } from '../modules/explain/coach.js';

test('parseExplainOutput: 正常 JSON 完整解析', () => {
  const raw = JSON.stringify({
    title: 'rizz：2024 年最火的俚语',
    content: 'rizz 是 charisma 的缩写，指魅力值、撩人能力。',
    bullets: ['用法：He has rizz（他很有魅力）', '近义：game, charm'],
  });
  const out = parseExplainOutput(raw);
  assert.equal(out.title, 'rizz：2024 年最火的俚语');
  assert.equal(out.content, 'rizz 是 charisma 的缩写，指魅力值、撩人能力。');
  assert.deepEqual(out.bullets, ['用法：He has rizz（他很有魅力）', '近义：game, charm']);
});

test('parseExplainOutput: 无 bullets 时 optional', () => {
  const raw = JSON.stringify({
    title: 'GPU 是啥',
    content: '显卡，专门算图形和 AI 的芯片。',
  });
  const out = parseExplainOutput(raw);
  assert.equal(out.title, 'GPU 是啥');
  assert.equal(out.content, '显卡，专门算图形和 AI 的芯片。');
  assert.equal(out.bullets, undefined);
});

test('parseExplainOutput: JSON 解析失败 → 原文当 content', () => {
  const raw = '这不是 JSON，就是一段纯文本讲解';
  const out = parseExplainOutput(raw);
  assert.equal(out.title, '看屏讲解');
  assert.equal(out.content, '这不是 JSON，就是一段纯文本讲解');
});

test('parseExplainOutput: zod 失败但能抢救 content → 用该 content', () => {
  // content 是字符串但 title 是数字（zod 会失败）
  const raw = JSON.stringify({
    title: 123,
    content: '抢救出来的讲解正文',
  });
  const out = parseExplainOutput(raw);
  assert.equal(out.title, '看屏讲解');
  assert.equal(out.content, '抢救出来的讲解正文');
});

test('parseExplainOutput: 完全无法抢救 → 原文当 content', () => {
  // content 是数字，无法抢救
  const raw = JSON.stringify({ title: 123, content: 456 });
  const out = parseExplainOutput(raw);
  assert.equal(out.title, '看屏讲解');
  assert.equal(out.content, raw);
});
