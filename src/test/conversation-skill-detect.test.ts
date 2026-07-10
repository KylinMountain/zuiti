import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSkillId, hasDegenerateRepeat } from '../modules/mira/conversation.js';

test('detectSkillId: 识别任意 skill 目录名（不限硬编码 reply/explain/summarize）', () => {
  assert.equal(detectSkillId('{"path":"skills/xiaohongshu/SKILL.md"}'), 'xiaohongshu');
  assert.equal(detectSkillId('{"path":"skills/dun/SKILL.md"}'), 'dun');
  assert.equal(detectSkillId('{"path":"skills/debate/SKILL.md"}'), 'debate');
});

test('detectSkillId: 原有三个 skill 仍能识别', () => {
  assert.equal(detectSkillId('{"path":"skills/reply/SKILL.md"}'), 'reply');
  assert.equal(detectSkillId('{"path":"skills/explain/SKILL.md"}'), 'explain');
  assert.equal(detectSkillId('{"path":"skills/summarize/SKILL.md"}'), 'summarize');
});

test('detectSkillId: 无匹配时返回 undefined', () => {
  assert.equal(detectSkillId('{"path":"src/core/log.ts"}'), undefined);
  assert.equal(detectSkillId(''), undefined);
});

test('detectSkillId: 匹配真实事件 JSON 里嵌套的路径片段', () => {
  const eventJson = JSON.stringify({
    toolCall: { name: 'read', arguments: { path: 'skills/email/SKILL.md' } },
  });
  assert.equal(detectSkillId(eventJson), 'email');
});

test('hasDegenerateRepeat: 复读同一引导语判定为退化循环', () => {
  assert.equal(hasDegenerateRepeat('给你三个回法：给你三个回法：'), true);
  assert.equal(hasDegenerateRepeat('给你三个回法：给你三个回法：给你三个回法：给你三个回法：'), true);
});

test('hasDegenerateRepeat: 正常单次引导语不算复读', () => {
  assert.equal(hasDegenerateRepeat('给你三个回法：'), false);
  assert.equal(hasDegenerateRepeat('这是一段正常的、没有重复内容的普通中文文本。'), false);
});

test('hasDegenerateRepeat: 单字符重复（省略号/分隔线/笑声）不误判', () => {
  assert.equal(hasDegenerateRepeat('哈哈哈哈哈哈哈哈哈哈哈哈'), false);
  assert.equal(hasDegenerateRepeat('--------------------------------'), false);
  assert.equal(hasDegenerateRepeat('。。。。。。。。。。。。。。。。'), false);
});

test('hasDegenerateRepeat: 空串/短串不误判', () => {
  assert.equal(hasDegenerateRepeat(''), false);
  assert.equal(hasDegenerateRepeat('你好'), false);
});
