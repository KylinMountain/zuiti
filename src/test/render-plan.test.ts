/**
 * buildRenderPlan 单测（字段驱动渲染核心逻辑，不依赖 DOM）。
 *
 * 覆盖：reply/explain/summarize 三种形状 + 边界容错。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRenderPlan } from '../shared/render-plan.js';
import type { UniversalOutput } from '../shared/ipc.js';

test('reply 形状：短 primary 作为引导标签，note 被抑制', () => {
  const dto: UniversalOutput = {
    skillId: 'reply',
    primary: { text: '给你三个回法：' },
    items: [
      { text: '备选1', label: '更撩', copyable: true },
      { text: '备选2', label: '更稳', copyable: true },
    ],
    note: '场景：朋友调侃',
  };
  const p = buildRenderPlan(dto);
  assert.equal(p.titleVisible, false, 'reply 无 title');
  assert.equal(p.primaryText, '给你三个回法：');
  assert.equal(p.primaryAsLabel, true, '短 primary 应被识别为引导标签');
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0]?.copyable, true);
  assert.equal(p.items[0]?.label, '更撩');
  assert.equal(p.noteVisible, false, '标签布局下不显示 note');
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

test('reply 违规长分析：有可复制 items 时，primary 降级为标签并截断', () => {
  const dto: UniversalOutput = {
    skillId: 'reply',
    primary: { text: '截图里对方发的是「嗯」，就一个字。这种单字回复要么是敷衍、要么是不知道接啥、要么就是情绪冷淡。给你三个回法：' },
    items: [
      { text: '感觉你那边信号不太好，打字是不是只能打出一个字来？', label: '给台阶', copyable: true },
      { text: '收到！那我继续说，你负责点头就行～', label: '高情商', copyable: true },
    ],
  };
  const p = buildRenderPlan(dto);
  assert.equal(p.primaryAsLabel, true, '可复制 items 存在时，长 primary 应降级');
  assert.ok(p.primaryText.length <= 30, '长分析应被截断到一句引导语');
  assert.equal(p.items.length, 2);
});
