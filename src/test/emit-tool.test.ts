/**
 * Plan 8 Task 2：emit_result 工具工厂单测（闭包取值 + 无并发污染）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmitTool } from '../core/emit-tool.js';

test('emit tool 执行后能取到结构化结果', async () => {
  const { tool, getResult } = createEmitTool();
  assert.equal(tool.name, 'emit_result');
  assert.equal(getResult(), null);
  await tool.execute('id1', { items: [{ text: 'hi', label: '稳', copyable: true }], note: 'n' }, undefined, undefined, {} as never);
  const r = getResult();
  assert.ok(r);
  assert.equal(r.items[0]?.text, 'hi');
  assert.equal(r.items[0]?.label, '稳');
  assert.equal(r.note, 'n');
});

test('两个 createEmitTool 互不污染', async () => {
  const a = createEmitTool();
  const b = createEmitTool();
  await a.tool.execute('1', { items: [{ text: 'A' }] }, undefined, undefined, {} as never);
  const ra = a.getResult();
  assert.ok(ra);
  assert.equal(ra.items[0]?.text, 'A');
  assert.equal(b.getResult(), null);
});

test('reset 清空已产出的结果（多轮隔离）', async () => {
  const { tool, getResult, reset } = createEmitTool();
  assert.equal(getResult(), null, '初始应为 null');
  await tool.execute('call-1', { items: [{ text: 'a' }] }, undefined, undefined, {} as never);
  assert.equal(getResult()?.items.length, 1, 'execute 后应有结果');
  reset();
  assert.equal(getResult(), null, 'reset 后应回到 null');
});
