/**
 * skill 注册中心（Plan 6）。
 *
 * 集中注册 reply / explain / summarize 三个 skill，router 按 id 调度。
 * 加新 skill = 实现 Skill 接口 + 这里注册一行，harness 不动。
 */
import { registerSkill } from '../core/skill.js';
import { replySkill } from './reply/coach.js';
import { explainSkill } from './explain/coach.js';
import { summarizeSkill } from './summarize/coach.js';

let registered = false;

/** 注册全部 skill（幂等，重复调用安全）。主进程启动时调用一次。 */
export function registerAllSkills(): void {
  if (registered) return;
  registerSkill(replySkill);
  registerSkill(explainSkill);
  registerSkill(summarizeSkill);
  registered = true;
}

/** 重新导出 skill 注册项，供外部直接使用。 */
export { replySkill, explainSkill, summarizeSkill };
