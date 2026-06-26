/**
 * 结构化日志 —— LLM 可读的 JSON lines（写 stderr，不污染 stdout/CLI 输出）。
 *
 * 每行一个 JSON：{ ts, level, msg, ...extra }。agent 可直接 grep/解析定位问题。
 * 借鉴 Harness Engineering：把日志做成 agent 直接可读的 legibility 杠杆。
 *
 * Plan 7 扩展：RunSummary 文件 —— 每次 skill pipeline 跑完写 logs/runs/<runId>.json，
 * 含 runId/ts/skillId/inputLen/outputShape/latency/errors。LLM 可直接读这个文件诊断问题。
 * 不记 input/output 内容，只记长度和形状（隐私保护）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  process.stderr.write(line + '\n');
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};

/**
 * Run Summary —— 一次 skill pipeline 跑完的结构化摘要（Plan 7）。
 *
 * 写入 logs/runs/<runId>.json 供 LLM/agent 诊断。只记长度和形状，不记内容（隐私保护）。
 */
export interface RunSummary {
  /** 唯一 run id（uuid v4）。 */
  runId: string;
  /** ISO timestamp。 */
  ts: string;
  /** 跑的哪个 skill（agent read 的；拿不到为 'unknown'）。 */
  skillId: string;
  /** 用户输入长度。 */
  inputLen: number;
  /** 输出形状摘要（不含敏感内容，只记长度和数量；如 primaryLen/itemsCount）。 */
  outputShape: Record<string, number>;
  /** 端到端耗时（毫秒）。 */
  latencyMs: number;
  /** 模型原始输出长度。 */
  rawOutputLen: number;
  /** 错误（省略或空数组 = 成功）。 */
  errors?: string[];
}

/** 生成新 runId（uuid v4）。 */
export function newRunId(): string {
  return randomUUID();
}

/**
 * 写 run summary 到 <dir>/<runId>.json（默认 <cwd>/logs/runs/）。
 * @param summary 摘要内容
 * @param dir 可选目录（测试用，默认 logs/runs/）
 * @returns 写入的文件绝对路径
 */
export function writeRunSummary(summary: RunSummary, dir?: string): string {
  const outDir = dir ?? resolve(process.cwd(), 'logs', 'runs');
  mkdirSync(outDir, { recursive: true });
  const filePath = resolve(outDir, `${summary.runId}.json`);
  writeFileSync(filePath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return filePath;
}
