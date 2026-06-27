import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextConvState } from '../shared/conv-state.js';

test('唤醒：idle → listening', () => {
  assert.equal(nextConvState('idle', 'wake'), 'listening');
});
test('说完：listening → thinking', () => {
  assert.equal(nextConvState('listening', 'speechEnd'), 'thinking');
});
test('10s 无人开口：listening → idle', () => {
  assert.equal(nextConvState('listening', 'noSpeechTimeout'), 'idle');
});
test('开始播报：thinking → speaking', () => {
  assert.equal(nextConvState('thinking', 'ttsStart'), 'speaking');
});
test('TTS 结束回流重开麦：speaking → listening', () => {
  assert.equal(nextConvState('speaking', 'ttsDone'), 'listening');
});
test('本轮出错：thinking → listening（不卡死）', () => {
  assert.equal(nextConvState('thinking', 'turnError'), 'listening');
});
test('新对话/收起：任意 → idle', () => {
  assert.equal(nextConvState('speaking', 'reset'), 'idle');
  assert.equal(nextConvState('thinking', 'reset'), 'idle');
  assert.equal(nextConvState('listening', 'reset'), 'idle');
});
test('说话开始不改大状态（仍 listening；计时取消是副作用）', () => {
  assert.equal(nextConvState('listening', 'speechStart'), 'listening');
});
test('未定义转换：保持原状态', () => {
  assert.equal(nextConvState('idle', 'ttsDone'), 'idle');
  assert.equal(nextConvState('speaking', 'wake'), 'speaking');
});
test('TTS 无音频块时 thinking 也能回流 listening（不卡死）', () => {
  assert.equal(nextConvState('thinking', 'ttsDone'), 'listening');
});
