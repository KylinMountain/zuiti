/**
 * 结构化日志 —— LLM 可读的 JSON lines。
 *
 * 双路输出：
 * 1. stderr —— 实时流式，agent 可直接 attach 管道
 * 2. 文件 —— `logs/app/<ts>.log`，事后诊断；自动轮转保留最近 20 个
 *
 * 每行一个 JSON：{ ts, level, msg, ...extra }。msg 用点分路径（如 "skill.run.error"），
 * 方便 grep / jq 过滤。借鉴 Harness Engineering 的 legibility 杠杆。
 *
 * Plan 7 扩展：RunSummary 文件 —— 每次 skill pipeline 跑完写 logs/runs/<runId>.json，
 * 含 runId/ts/skillId/inputLen/outputShape/latency/errors。
 */
import { mkdirSync, writeFileSync, appendFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_DIR = resolve(process.cwd(), 'logs', 'app');
const MAX_LOG_FILES = 20;

let logFilePath: string | null = null;
let initDone = false;

function ensureLogFile(): string | null {
  if (initDone) return logFilePath;
  initDone = true;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    logFilePath = join(LOG_DIR, `${ts}.log`);
    writeFileSync(logFilePath, '', 'utf8');
    rotateLogs();
    return logFilePath;
  } catch {
    return null;
  }
}

function rotateLogs(): void {
  try {
    const files = readdirSync(LOG_DIR)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse();
    if (files.length <= MAX_LOG_FILES) return;
    for (const f of files.slice(MAX_LOG_FILES)) {
      try { unlinkSync(join(LOG_DIR, f)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  process.stderr.write(line + '\n');

  const path = ensureLogFile();
  if (path) {
    try { appendFileSync(path, line + '\n', 'utf8'); } catch { /* ignore */ }
  }
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => write('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write('error', msg, extra),
};

/**
 * 获取当前日志文件路径（用于 agent / 外部工具 attach）。
 * 如果文件输出未启用（如测试环境）返回 null。
 */
export function getLogFilePath(): string | null {
  return ensureLogFile();
}

/**
 * Run Summary —— 一次 skill pipeline 跑完的结构化摘要（Plan 7）。
 *
 * 写入 logs/runs/<runId>.json 供 LLM/agent 诊断。只记长度和形状，不记内容（隐私保护）。
 */
export interface RunSummary {
  runId: string;
  ts: string;
  skillId: string;
  inputLen: number;
  outputShape: Record<string, number>;
  latencyMs: number;
  rawOutputLen: number;
  errors?: string[];
}

export function newRunId(): string {
  return randomUUID();
}

export function writeRunSummary(summary: RunSummary, dir?: string): string {
  const outDir = dir ?? resolve(process.cwd(), 'logs', 'runs');
  mkdirSync(outDir, { recursive: true });
  const filePath = resolve(outDir, `${summary.runId}.json`);
  writeFileSync(filePath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return filePath;
}
