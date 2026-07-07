import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecentRuns, aggregateRuns, redactConfig, buildDiagnostics } from '../core/diagnostics.js';
import { EMPTY_CONFIG } from '../core/config-store.js';

function tmpWithRuns(runs: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'zuiti-diag-'));
  mkdirSync(join(dir, 'runs'), { recursive: true });
  runs.forEach((r, i) => writeFileSync(join(dir, 'runs', `r${i}.json`), JSON.stringify(r)));
  return dir;
}
const mkRun = (over: object) => ({ runId: 'x', ts: '2026-07-07T00:00:00.000Z', skillId: 'reply', inputLen: 3, outputShape: {}, latencyMs: 100, rawOutputLen: 5, ...over });

test('readRecentRuns 按 ts 降序取前 n，跳过损坏 json', () => {
  const dir = tmpWithRuns([
    mkRun({ ts: '2026-07-01T00:00:00.000Z', latencyMs: 10 }),
    mkRun({ ts: '2026-07-03T00:00:00.000Z', latencyMs: 30 }),
    mkRun({ ts: '2026-07-02T00:00:00.000Z', latencyMs: 20 }),
  ]);
  writeFileSync(join(dir, 'runs', 'bad.json'), '{ not json');
  const runs = readRecentRuns(dir, 2);
  assert.equal(runs.length, 2);
  assert.equal(runs[0]!.ts, '2026-07-03T00:00:00.000Z'); // 最新在前
  assert.equal(runs[1]!.ts, '2026-07-02T00:00:00.000Z');
});
test('aggregateRuns 算 p50/avg/errorCount/skillCounts', () => {
  const stat = aggregateRuns([
    mkRun({ latencyMs: 100, skillId: 'reply' }),
    mkRun({ latencyMs: 200, skillId: 'reply', errors: ['x'] }),
    mkRun({ latencyMs: 300, skillId: 'explain' }),
  ]);
  assert.equal(stat.total, 3);
  assert.equal(stat.latencyAvg, 200);
  assert.equal(stat.latencyP50, 200); // 中位数
  assert.equal(stat.errorCount, 1);
  assert.deepEqual(stat.skillCounts, { reply: 2, explain: 1 });
});
test('aggregateRuns 空输入不崩', () => {
  assert.deepEqual(aggregateRuns([]), { total: 0, latencyP50: 0, latencyAvg: 0, errorCount: 0, skillCounts: {} });
});
test('redactConfig 脱敏 apiKey、保留 baseURL、不改入参（隐私关键）', () => {
  const cfg = { ...EMPTY_CONFIG, credential: { apiKey: 'tp-secret', baseURL: 'https://x/v1' } };
  const red = redactConfig(cfg);
  assert.equal(red.credential.apiKey, '***');
  assert.equal(red.credential.baseURL, 'https://x/v1');
  assert.equal((cfg.credential as any).apiKey, 'tp-secret', '入参不能被改');
});
test('buildDiagnostics 组装且 config 已脱敏', () => {
  const dir = tmpWithRuns([mkRun({})]);
  const cfg = { ...EMPTY_CONFIG, credential: { apiKey: 'tp-secret', baseURL: 'https://x/v1' } };
  const d = buildDiagnostics(dir, cfg, { version: '0.1.0' }, 20);
  assert.equal((d.config.credential as any).apiKey, '***');
  assert.equal(d.stats.total, 1);
  assert.equal(d.recentRuns.length, 1);
  assert.ok(d.generatedAt);
});
