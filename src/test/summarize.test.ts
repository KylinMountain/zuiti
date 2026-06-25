/**
 * SummarizeOutput parser 测试 —— 从宽校验策略（Plan 6 Task 3）。
 *
 * 测试覆盖：正常 JSON / JSON 解析失败 / zod 失败但能抢救 keyPoints / actionItems 可选。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSummarizeOutput } from '../modules/summarize/coach.js';

test('parseSummarizeOutput: 正常 JSON 完整解析', () => {
  const raw = JSON.stringify({
    title: '关于下周上线时间的讨论',
    keyPoints: ['张三建议周二上线', '李四担心测试不够', '最终决定周三上线'],
    actionItems: ['张三周一前确认测试环境', '李四周二前完成回归测试'],
  });
  const out = parseSummarizeOutput(raw);
  assert.equal(out.title, '关于下周上线时间的讨论');
  assert.deepEqual(out.keyPoints, ['张三建议周二上线', '李四担心测试不够', '最终决定周三上线']);
  assert.deepEqual(out.actionItems, ['张三周一前确认测试环境', '李四周二前完成回归测试']);
});

test('parseSummarizeOutput: 无 actionItems 时 optional', () => {
  const raw = JSON.stringify({
    title: '需求评审纪要',
    keyPoints: ['需求 A 通过', '需求 B 待定'],
  });
  const out = parseSummarizeOutput(raw);
  assert.equal(out.title, '需求评审纪要');
  assert.deepEqual(out.keyPoints, ['需求 A 通过', '需求 B 待定']);
  assert.equal(out.actionItems, undefined);
});

test('parseSummarizeOutput: JSON 解析失败 → 原文当单条 keyPoints', () => {
  const raw = '这不是 JSON，就是一段纯文本';
  const out = parseSummarizeOutput(raw);
  assert.equal(out.title, '讨论总结');
  assert.deepEqual(out.keyPoints, [raw]);
});

test('parseSummarizeOutput: zod 失败但能抢救 keyPoints → 用该 keyPoints', () => {
  // keyPoints 是字符串数组但 title 是数字（zod 会失败）
  const raw = JSON.stringify({
    title: 123,
    keyPoints: ['抢救出来的要点 1', '抢救出来的要点 2'],
  });
  const out = parseSummarizeOutput(raw);
  assert.equal(out.title, '讨论总结');
  assert.deepEqual(out.keyPoints, ['抢救出来的要点 1', '抢救出来的要点 2']);
});

test('parseSummarizeOutput: keyPoints 含非字符串元素 → 过滤掉', () => {
  const raw = JSON.stringify({
    title: '测试',
    keyPoints: ['合法字符串', 123, { bad: true }, '另一个合法字符串'],
  });
  const out = parseSummarizeOutput(raw);
  assert.equal(out.title, '测试');
  assert.deepEqual(out.keyPoints, ['合法字符串', '另一个合法字符串']);
});

test('parseSummarizeOutput: 完全无法抢救 → 原文当单条 keyPoints', () => {
  // keyPoints 是数字，无法抢救
  const raw = JSON.stringify({ title: 123, keyPoints: 456 });
  const out = parseSummarizeOutput(raw);
  assert.equal(out.title, '讨论总结');
  assert.deepEqual(out.keyPoints, [raw]);
});
