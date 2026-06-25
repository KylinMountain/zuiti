/**
 * Run Summary 单测（Plan 7 Task 1）。
 *
 * 验证 writeRunSummary 写文件 + 读回结构正确 + errors 字段保留 + 默认目录 + runId 唯一。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRunSummary, newRunId, type RunSummary } from '../core/log.js';

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: newRunId(),
    ts: new Date().toISOString(),
    skillId: 'reply',
    inputLen: 42,
    outputShape: { replyLen: 100, candidatesCount: 3 },
    latencyMs: 1234,
    rawOutputLen: 500,
    ...overrides,
  };
}

test('writeRunSummary: 写文件 + 读回结构正确', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zuiti-run-'));
  try {
    const summary = makeSummary();
    const filePath = writeRunSummary(summary, dir);
    const read = JSON.parse(readFileSync(filePath, 'utf8')) as RunSummary;
    assert.equal(read.runId, summary.runId);
    assert.equal(read.skillId, 'reply');
    assert.equal(read.inputLen, 42);
    assert.equal(read.outputShape.replyLen, 100);
    assert.equal(read.outputShape.candidatesCount, 3);
    assert.equal(read.latencyMs, 1234);
    assert.equal(read.rawOutputLen, 500);
    assert.equal(read.errors, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRunSummary: errors 字段保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zuiti-run-'));
  try {
    const summary = makeSummary({
      skillId: 'explain',
      outputShape: { contentLen: 200 },
      errors: ['JSON parse failed', 'timeout'],
    });
    const filePath = writeRunSummary(summary, dir);
    const read = JSON.parse(readFileSync(filePath, 'utf8')) as RunSummary;
    assert.deepEqual(read.errors, ['JSON parse failed', 'timeout']);
    assert.equal(read.skillId, 'explain');
    assert.equal(read.outputShape.contentLen, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRunSummary: 默认目录 logs/runs/（用 chdir 隔离）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zuiti-run-'));
  const oldCwd = process.cwd();
  process.chdir(dir);
  try {
    const summary = makeSummary({ skillId: 'summarize', outputShape: { keyPointsCount: 3 } });
    const filePath = writeRunSummary(summary);
    assert.ok(filePath.includes(join('logs', 'runs')), `path 应含 logs/runs: ${filePath}`);
    const read = JSON.parse(readFileSync(filePath, 'utf8')) as RunSummary;
    assert.equal(read.skillId, 'summarize');
    assert.equal(read.outputShape.keyPointsCount, 3);
  } finally {
    process.chdir(oldCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeRunSummary: 同目录多次写不冲突（不同 runId）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zuiti-run-'));
  try {
    const s1 = makeSummary();
    const s2 = makeSummary();
    const f1 = writeRunSummary(s1, dir);
    const f2 = writeRunSummary(s2, dir);
    assert.notEqual(f1, f2);
    assert.equal(readFileSync(f1, 'utf8').includes(s1.runId), true);
    assert.equal(readFileSync(f2, 'utf8').includes(s2.runId), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('newRunId: 唯一性 + uuid v4 格式', () => {
  const a = newRunId();
  const b = newRunId();
  assert.notEqual(a, b);
  // uuid v4 格式：8-4-4-4-12 = 36 chars
  assert.equal(a.length, 36);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
