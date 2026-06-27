/**
 * VadDetector 状态机单测（renderer 纯逻辑，不依赖 DOM）。
 *
 * 状态机：silence →（连续 triggerMs RMS≥triggerThreshold）→ speaking
 *        speaking →（连续 silenceMs RMS<silenceThreshold）→ silence
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VadDetector } from '../renderer/vad.js';

test('VadDetector: 初始状态 silence', () => {
  const vad = new VadDetector({});
  assert.equal(vad.feed(0), 'silence');
});

test('VadDetector: 短暂噪声不触发 speaking（triggerMs 防抖）', () => {
  const vad = new VadDetector({ triggerMs: 500, tickMs: 100, triggerThreshold: 0.05 });
  // 只响 200ms（2 tick）< triggerMs 500ms
  assert.equal(vad.feed(0.1), 'silence');
  assert.equal(vad.feed(0.1), 'silence');
  assert.equal(vad.feed(0), 'silence'); // 归零
  assert.equal(vad.feed(0.1), 'silence'); // 重新开始，不累积
});

test('VadDetector: 连续 triggerMs 触发 speaking', () => {
  const vad = new VadDetector({ triggerMs: 300, tickMs: 100, triggerThreshold: 0.05 });
  assert.equal(vad.feed(0.1), 'silence'); // 100ms
  assert.equal(vad.feed(0.1), 'silence'); // 200ms
  assert.equal(vad.feed(0.1), 'speaking'); // 300ms 触发
});

test('VadDetector: speaking 后短暂无声不回 silence（silenceMs 防抖）', () => {
  const vad = new VadDetector({ triggerMs: 300, silenceMs: 1000, tickMs: 100,
    triggerThreshold: 0.05, silenceThreshold: 0.02 });
  // 先触发 speaking
  assert.equal(vad.feed(0.1), 'silence');
  assert.equal(vad.feed(0.1), 'silence');
  assert.equal(vad.feed(0.1), 'speaking');
  // 短暂无声 500ms < silenceMs 1000ms
  for (let i = 0; i < 5; i++) assert.equal(vad.feed(0), 'speaking');
  // 重新有声，silenceTimer 重置
  assert.equal(vad.feed(0.1), 'speaking');
});

test('VadDetector: 连续 silenceMs 回 silence', () => {
  const vad = new VadDetector({ triggerMs: 300, silenceMs: 500, tickMs: 100,
    triggerThreshold: 0.05, silenceThreshold: 0.02 });
  // 触发 speaking
  vad.feed(0.1); vad.feed(0.1); vad.feed(0.1);
  // 无声 600ms > silenceMs 500ms
  assert.equal(vad.feed(0), 'speaking'); // 100ms
  assert.equal(vad.feed(0), 'speaking'); // 200ms
  assert.equal(vad.feed(0), 'speaking'); // 300ms
  assert.equal(vad.feed(0), 'speaking'); // 400ms
  assert.equal(vad.feed(0), 'silence'); // 500ms 触发回 silence
});

test('VadDetector: onStateChange 回调触发', () => {
  const events: string[] = [];
  const vad = new VadDetector({
    triggerMs: 200, silenceMs: 400, tickMs: 100,
    triggerThreshold: 0.05, silenceThreshold: 0.02,
    onStateChange: (s) => events.push(s),
  });
  vad.feed(0.1); vad.feed(0.1); // speaking
  vad.feed(0); vad.feed(0); vad.feed(0); vad.feed(0); // silence
  assert.deepEqual(events, ['speaking', 'silence']);
});

test('VadDetector: reset 清状态', () => {
  const vad = new VadDetector({ triggerMs: 100, tickMs: 100, triggerThreshold: 0.05 });
  vad.feed(0.1); // 触发 speaking
  vad.reset();
  assert.equal(vad.feed(0), 'silence');
});
