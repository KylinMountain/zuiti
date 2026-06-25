/**
 * 跨进程类型（主进程 ↔ 渲染层）。
 *
 * CoachOutputDTO 与 src/modules/reply/schema.ts 的 CoachOutput 结构对齐，
 * 供渲染层消费（HUD 把 candidates 渲染成可点选卡片）。
 */

export interface CoachOutputDTO {
  reply: string;
  candidates: { text: string; style: string }[];
  rationale: string;
}
