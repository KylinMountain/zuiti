/**
 * buildRenderPlan 单测（字段驱动渲染核心逻辑，不依赖 DOM）。
 *
 * 覆盖：reply/explain/summarize 三种形状 + 边界容错。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderPlan } from '../shared/render-plan.js';
import type { UniversalOutput } from '../shared/ipc.js';

test('reply 形状：primary + items(copyable+label) + note', () => {
  const dto: UniversalOutput = {
    skillId: 'reply',
    primary: { text: '最推荐回复' },
    items: [
      { text: '备选1', label: '更撩', copyable: true },
      { text: '备选2', label: '更稳', copyable: true },
    ],
    note: '场景：朋友调侃',
  };
  const p = buildRenderPlan(dto);
  assert.equal(p.titleVisible, false, 'reply 无 title');
  assert.equal(p.primaryText, '最推荐回复');
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0]?.copyable, true);
  assert.equal(p.items[0]?.label, '更撩');
  assert.equal(p.noteVisible, true);
  assert.equal(p.noteText, '场景：朋友调侃');
});

test('explain 形状：title + primary + items(bullets, 无 copyable)', () => {
  const dto: UniversalOutput = {
    skillId: 'explain',
    title: 'pangram 解析',
    primary: { text: '这是讲解正文...' },
    items: [
      { text: '要点1：包含全部 26 字母' },
      { text: '要点2：用于测试字体' },
    ],
  };
  const p = buildRenderPlan(dto);
  assert.equal(p.titleVisible, true);
  assert.equal(p.titleText, 'pangram 解析');
  assert.equal(p.primaryText, '这是讲解正文...');
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0]?.copyable, false, 'explain items 默认不可复制');
  assert.equal(p.items[0]?.label, undefined, 'explain items 无 label');
  assert.equal(p.noteVisible, false, 'explain 无 note');
});

test('summarize 形状：title + items(部分 label:待办)', () => {
  const dto: UniversalOutput = {
    skillId: 'summarize',
    title: '项目状态',
    primary: { text: '' },
    items: [
      { text: '项目延期' },
      { text: '周末开会', label: '待办' },
    ],
  };
  const p = buildRenderPlan(dto);
  assert.equal(p.titleText, '项目状态');
  assert.equal(p.primaryText, '', 'summarize primary 可空');
  assert.equal(p.items.length, 2);
  assert.equal(p.items[1]?.label, '待办');
  assert.equal(p.items[1]?.copyable, false);
});

test('空 items 容错', () => {
  const dto: UniversalOutput = {
    primary: { text: '只有 primary' },
    items: [],
  };
  const p = buildRenderPlan(dto);
  assert.equal(p.items.length, 0);
  assert.equal(p.titleVisible, false);
  assert.equal(p.noteVisible, false);
});

test('缺 primary 容错', () => {
  const dto = {
    skillId: 'reply',
    items: [{ text: 'x', copyable: true }],
  } as unknown as UniversalOutput;
  const p = buildRenderPlan(dto);
  assert.equal(p.primaryText, '', '缺 primary.text 容错为空串');
});

test('字段驱动：不依赖 skillId 分支（同形状不同 skillId 渲染一致）', () => {
  const base = { primary: { text: '同一段文字' }, items: [{ text: 'item', copyable: true }] };
  const a = buildRenderPlan({ ...base, skillId: 'reply' });
  const b = buildRenderPlan({ ...base, skillId: 'explain' });
  const c = buildRenderPlan({ ...base, skillId: undefined });
  assert.deepEqual(a, b, 'reply vs explain 同形状应同渲染');
  assert.deepEqual(b, c, 'explain vs undefined skillId 同形状应同渲染');
});
