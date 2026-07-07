/** 本地诊断（纯，dir 注入）。读/聚合 RunSummary + 脱敏配置 + 组装诊断包。无 electron 依赖、不上云。 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunSummary } from './log.js';
import type { ZuitiConfig } from './config-store.js';

export interface RunStat {
  total: number;
  latencyP50: number;
  latencyAvg: number;
  errorCount: number;
  skillCounts: Record<string, number>;
}

export function readRecentRuns(logDir: string, n: number): RunSummary[] {
  const dir = join(logDir, 'runs');
  let names: string[];
  try { names = readdirSync(dir).filter((f) => f.endsWith('.json')); }
  catch { return []; }
  const runs: RunSummary[] = [];
  for (const name of names) {
    try {
      const r = JSON.parse(readFileSync(join(dir, name), 'utf8')) as RunSummary;
      if (r && typeof r.ts === 'string') runs.push(r);
    } catch { /* 跳过损坏文件 */ }
  }
  runs.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)); // ts 降序
  return runs.slice(0, n);
}

export function aggregateRuns(runs: RunSummary[]): RunStat {
  if (runs.length === 0) return { total: 0, latencyP50: 0, latencyAvg: 0, errorCount: 0, skillCounts: {} };
  const lat = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = lat[Math.floor((lat.length - 1) / 2)] ?? 0;
  const avg = Math.round(lat.reduce((s, x) => s + x, 0) / lat.length);
  const errorCount = runs.filter((r) => (r.errors?.length ?? 0) > 0).length;
  const skillCounts: Record<string, number> = {};
  for (const r of runs) skillCounts[r.skillId] = (skillCounts[r.skillId] ?? 0) + 1;
  return { total: runs.length, latencyP50: p50, latencyAvg: avg, errorCount, skillCounts };
}

export function redactConfig(cfg: ZuitiConfig): ZuitiConfig {
  const clone = JSON.parse(JSON.stringify(cfg)) as ZuitiConfig;
  if (clone.credential.apiKey) clone.credential.apiKey = '***';
  return clone;
}

export interface Diagnostics {
  generatedAt: string;
  versions: Record<string, string>;
  config: ZuitiConfig;
  stats: RunStat;
  recentRuns: RunSummary[];
}

export function buildDiagnostics(logDir: string, cfg: ZuitiConfig, versions: Record<string, string>, n: number): Diagnostics {
  const recentRuns = readRecentRuns(logDir, n);
  return {
    generatedAt: new Date().toISOString(),
    versions,
    config: redactConfig(cfg),
    stats: aggregateRuns(recentRuns),
    recentRuns,
  };
}
