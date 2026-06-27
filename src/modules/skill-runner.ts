/**
 * 单轮 skill 入口（Plan 9）：MiraConversation 的薄封装——建会话、跑一轮、dispose。
 * 多轮场景请直接用 MiraConversation（main/ipc.ts 持有一个保活实例）。
 */
import { MiraConversation, type RunSkillCallbacks, type RunSkillResult } from './mira/conversation.js';

export type { RunSkillCallbacks, RunSkillResult } from './mira/conversation.js';

export async function runSkill(
  text: string,
  screenshotDataUrl: string | undefined,
  callbacks?: RunSkillCallbacks,
): Promise<RunSkillResult> {
  const conv = new MiraConversation();
  try {
    return await conv.sendTurn(text, screenshotDataUrl, callbacks);
  } finally {
    conv.dispose();
  }
}
