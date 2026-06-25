/**
 * 结构化日志 —— LLM 可读的 JSON lines（写 stderr，不污染 stdout/CLI 输出）。
 *
 * 每行一个 JSON：{ ts, level, msg, ...extra }。agent 可直接 grep/解析定位问题。
 * 借鉴 Harness Engineering：把日志做成 agent 直接可读的 legibility 杠杆。
 */

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
