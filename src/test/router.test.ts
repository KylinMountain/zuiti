/**
 * Router 测试 —— LLM 自动路由的纯函数兜底（classifyIntentHeuristic）。
 *
 * 完整 routeSkill() 要调 LLM，难单测；这里测可纯函数化的启发式判定，
 * 作为 LLM 失败/超时时的兜底，也是 router 的核心决策逻辑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntentHeuristic } from '../modules/router.js';
import type { SkillId } from '../shared/ipc.js';

test('router: classifyIntentHeuristic 默认回退 reply', () => {
  // 无明显意图信号 → 默认 reply（嘴替核心能力，兜底）
  assert.equal(classifyIntentHeuristic('帮我接住，但别太舔'), 'reply');
  assert.equal(classifyIntentHeuristic('怼回去'), 'reply');
  assert.equal(classifyIntentHeuristic('帮我跟老板请假'), 'reply');
});

test('router: 讲解类关键词 → explain', () => {
  assert.equal(classifyIntentHeuristic('讲解一下这个单词'), 'explain');
  assert.equal(classifyIntentHeuristic('解释一下他在说啥'), 'explain');
  assert.equal(classifyIntentHeuristic('啥意思'), 'explain');
  assert.equal(classifyIntentHeuristic('这是什么'), 'explain');
  assert.equal(classifyIntentHeuristic('看不懂'), 'explain');
});

test('router: 总结类关键词 → summarize', () => {
  assert.equal(classifyIntentHeuristic('总结一下刚才的讨论'), 'summarize');
  assert.equal(classifyIntentHeuristic('归纳要点'), 'summarize');
  assert.equal(classifyIntentHeuristic('他们都在说啥，给个要点'), 'summarize');
  assert.equal(classifyIntentHeuristic('总结讨论'), 'summarize');
});

test('router: 优先级——讲解/总结同时出现时，总结优先（总结需求更明确）', () => {
  // "总结讲解" 这种边界，总结优先
  assert.equal(classifyIntentHeuristic('总结讲解一下'), 'summarize');
});

test('router: SkillId 类型完整（reply/explain/summarize）', () => {
  const ids: SkillId[] = ['reply', 'explain', 'summarize'];
  assert.equal(ids.length, 3);
  assert.ok(ids.includes('reply'));
  assert.ok(ids.includes('explain'));
  assert.ok(ids.includes('summarize'));
});
