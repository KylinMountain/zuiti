import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordHit, recordMiss, summarize, type WakeStats } from '../shared/wake-stats.js';

const EMPTY: WakeStats = { hits: 0, misses: 0, recentMissReasons: [] };

test('recordHit: hits +1', () => {
  const s = recordHit(EMPTY);
  assert.equal(s.hits, 1);
  assert.equal(s.misses, 0);
});

test('recordMiss: misses +1 + 记录原因 + lastMissAt', () => {
  const s = recordMiss(EMPTY, 'noSpeechTimeout');
  assert.equal(s.hits, 0);
  assert.equal(s.misses, 1);
  assert.equal(s.recentMissReasons.length, 1);
  assert.equal(s.recentMissReasons[0], 'noSpeechTimeout');
  assert.ok(s.lastMissAt && s.lastMissAt > 0);
});

test('recordMiss: 环形缓冲，最多 10 条原因', () => {
  let s = EMPTY;
  for (let i = 0; i < 15; i++) s = recordMiss(s, i % 2 === 0 ? 'noSpeechTimeout' : 'asrEmpty');
  assert.equal(s.misses, 15);
  assert.equal(s.recentMissReasons.length, 10);
  // 最后 10 条：i=5..14
  assert.equal(s.recentMissReasons[0], 'asrEmpty'); // i=5, 5%2=1
  assert.equal(s.recentMissReasons[9], 'noSpeechTimeout'); // i=14, 14%2=0
});

test('summarize: 空统计 missRate=0', () => {
  const r = summarize(EMPTY);
  assert.equal(r.total, 0);
  assert.equal(r.missRate, 0);
});

test('summarize: 计算误触率', () => {
  let s = recordHit(EMPTY);
  s = recordHit(s);
  s = recordHit(s);
  s = recordMiss(s, 'asrEmpty');
  const r = summarize(s);
  assert.equal(r.total, 4);
  assert.equal(r.missRate, 0.25);
});

test('summarize: 全部误触 missRate=1', () => {
  const s = recordMiss(recordMiss(EMPTY, 'noSpeechTimeout'), 'asrEmpty');
  const r = summarize(s);
  assert.equal(r.total, 2);
  assert.equal(r.missRate, 1);
});

test('recordHit/recordMiss 不可变：返回新对象', () => {
  const before = { ...EMPTY };
  recordHit(EMPTY);
  recordMiss(EMPTY, 'noSpeechTimeout');
  assert.deepEqual(EMPTY, before);
});
