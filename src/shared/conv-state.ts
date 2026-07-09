/**
 * 连续对话状态机（Plan 9）—— 单一状态来源 + 显式转换。纯函数，无 DOM/Node。
 * 副作用（开关麦、起停 10s 计时、起停 openWakeWord、更新头部状态）由 hud.ts 在转换后执行。
 */

export type ConvState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type ConvEvent =
  | 'wake'            // Jarvis / 快捷键 / 托盘 / 手动麦克风
  | 'speechStart'     // VAD 检测到说话（取消 10s 计时）
  | 'speechEnd'       // VAD 静音 → 停录 → 转写
  | 'noSpeechTimeout' // listening 内 10s 没人开口
  | 'ttsStart'        // 首个 TTS 片段（开始播报）
  | 'ttsDone'         // TTS 播完
  | 'turnError'       // 本轮 LLM/TTS 出错
  | 'bargeIn'         // plan-13: 用户开口打断 TTS → 重新 listening
  | 'bargeOut'        // plan-13: Esc/点头像打断 TTS → 回 idle 不接话
  | 'reset';          // 新对话 / 收起面板

const TABLE: Record<ConvState, Partial<Record<ConvEvent, ConvState>>> = {
  idle: { wake: 'listening' },
  listening: { speechStart: 'listening', speechEnd: 'thinking', noSpeechTimeout: 'idle', reset: 'idle' },
  thinking: { ttsStart: 'speaking', ttsDone: 'listening', turnError: 'listening', reset: 'idle' },
  speaking: { ttsDone: 'listening', bargeIn: 'listening', bargeOut: 'idle', reset: 'idle' },
};

/** 给定当前状态与事件，返回下一状态；未定义的转换保持原状态。 */
export function nextConvState(state: ConvState, event: ConvEvent): ConvState {
  return TABLE[state][event] ?? state;
}
