/** 崩溃报告（纯，dir 注入，无 electron 依赖）。写 <logDir>/crash/crash-<ts>.json；绝不抛。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CrashContext {
  source: 'uncaughtException' | 'unhandledRejection' | 'renderProcessGone';
  version: string;
  electron?: string;
  node?: string;
  extra?: Record<string, unknown>;
}

export function writeCrashReport(logDir: string, err: unknown, ctx: CrashContext): string | null {
  try {
    const dir = join(logDir, 'crash');
    mkdirSync(dir, { recursive: true });
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const ts = new Date().toISOString();
    const report = { ts, source: ctx.source, message, stack, version: ctx.version, electron: ctx.electron, node: ctx.node, ...(ctx.extra ?? {}) };
    const file = join(dir, `crash-${ts.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2) + '\n', 'utf8');
    return file;
  } catch {
    return null;
  }
}
