/**
 * 唤醒词检测 —— 文本侧判定（给 ipc.ts 的 voice:wakeCheck 用）。
 *
 * 本地 openWakeWord 唤醒（Plan 4）在渲染层做声学侧检测；
 * 这里只保留文本侧纯函数：用户口述被 ASR 转成文本后，判定是否含 "jarvis"。
 */
export const WAKE_WORD = 'jarvis';

/** 检查文本是否含唤醒词（纯函数，可单测）。用单词边界避免 jarviss 误匹配。 */
export function containsWakeWord(text: string): boolean {
  return /\bjarvis\b/i.test(text);
}
