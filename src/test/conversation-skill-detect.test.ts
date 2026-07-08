import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSkillId } from '../modules/mira/conversation.js';

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
