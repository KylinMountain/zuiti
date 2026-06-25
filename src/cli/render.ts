/** 把嘴替结果格式化为终端可读文本（纯函数，便于单测且不触发 CLI 主流程）。 */
import type { CoachOutput } from '../modules/reply/schema.js';

export function renderCoachOutput(o: CoachOutput): string {
  const lines: string[] = ['\n=== 嘴替推荐 ===\n' + o.reply];
  if (o.candidates.length) {
    lines.push('\n=== 备选 ===');
    for (const c of o.candidates) lines.push(`- [${c.style || '备选'}] ${c.text}`);
  }
  if (o.rationale) lines.push('\n[判断] ' + o.rationale);
  return lines.join('\n');
}
