/**
 * 跨进程类型（主进程 ↔ 渲染层）。
 *
 * CoachOutputDTO 与 src/modules/english/schema.ts 的 CoachOutput 结构对齐，
 * 供渲染层消费（Plan 2 把 candidates 渲染成可点选卡片）。
 */

export interface DiagnosticDTO {
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix?: string;
}

export interface CoachOutputDTO {
  reply: string;
  candidates: { text: string; style: string }[];
  diagnostics: DiagnosticDTO[];
  rationale: string;
  variants?: { formal?: string; casual?: string; concise?: string } | null;
}
