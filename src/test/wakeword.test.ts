import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsWakeWord } from '../core/wakeword.js';

test('containsWakeWord: 大小写不敏感检测 jarvis', () => {
  assert.equal(containsWakeWord('Jarvis 帮我回一下'), true);
  assert.equal(containsWakeWord('JARVIS'), true);
  assert.equal(containsWakeWord('jarvis'), true);
});

test('containsWakeWord: 不含唤醒词返回 false', () => {
  assert.equal(containsWakeWord('今天天气不错'), false);
  assert.equal(containsWakeWord(''), false);
});

test('containsWakeWord: 近似词不算（jarvi/jarviss）', () => {
  assert.equal(containsWakeWord('jarvi'), false);
  assert.equal(containsWakeWord('jarviss'), false);
});
