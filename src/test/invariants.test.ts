import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS } from '../modules/reply/coach.js';
import { loadDotenv } from '../cli/coach.js';
import { CoachOutput } from '../modules/reply/schema.js';

test('invariant: prompt 要求 reply 排第一键', () => {
  assert.match(INSTRUCTIONS, /reply.*必须排第一|排第一.*reply|必须排第一/);
});

test('invariant: schema 里 reply 是第一个键', () => {
  const keys = Object.keys(CoachOutput.shape);
  assert.equal(keys[0], 'reply');
});

test('invariant: prompt 含对线红线（机智回怼非网暴）', () => {
  assert.match(INSTRUCTIONS, /严禁人身攻击|严禁.*网暴/);
});

test('invariant: loadDotenv 从 cli/coach 可导入（CLI 入口契约）', () => {
  assert.equal(typeof loadDotenv, 'function');
});
