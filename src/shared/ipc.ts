/**
 * 跨进程类型（主进程 ↔ 渲染层）。
 *
 * 零运行时依赖（不 import zod / agents / node），同时被渲染层（DOM lib、无 node）和主进程编译。
 * CoachOutputDTO 与 src/modules/reply/schema.ts 的 CoachOutput 结构对齐。
 */

export interface CoachOutputDTO {
  reply: string;
  candidates: { text: string; style: string }[];
  rationale: string;
}

/** IPC 通道名常量（避免主进程/preload/渲染层三处拼字符串错位）。 */
export const CHANNELS = {
  /** 渲染 → 主：触发 coach 流水线（text, withScreenshot）。 */
  coachRun: 'coach:run',
  /** 主 → 渲染：coach 开始（loading）。 */
  coachLoading: 'coach:loading',
  /** 主 → 渲染：流式 reply 增量（迄今为止已流出的 reply 全文）。 */
  coachReplyChunk: 'coach:replyChunk',
  /** 主 → 渲染：coach 完成，附完整结构化结果。 */
  coachResult: 'coach:result',
  /** 主 → 渲染：coach 出错。 */
  coachError: 'coach:error',
  /** 渲染 → 主：发送录音做 ASR（base64 data URL）。 */
  voiceRecorded: 'voice:recorded',
  /** 渲染 → 主：耳听八方模式，发送音频做唤醒词判定（base64 data URL）。 */
  voiceWakeCheck: 'voice:wakeCheck',
  /** 主 → 渲染：ASR 转写结果回填。 */
  voiceTranscript: 'voice:transcript',
  /** 主 → 渲染：唤醒未命中（耳听八方继续监听）。 */
  voiceWakeMiss: 'voice:wakeMiss',
  /** 主 → 渲染：TTS 音频块（base64 pcm16）。 */
  voiceTtsChunk: 'voice:ttsChunk',
  /** 主 → 渲染：TTS 完成。 */
  voiceTtsDone: 'voice:ttsDone',
  /** 主 → 渲染：语音出错。 */
  voiceError: 'voice:error',
  /** 渲染 → 主：本地唤醒词命中，请求唤起面板。 */
  wake: 'wake:trigger',
  /** 主 → 渲染：被热键/托盘/唤醒词唤起，聚焦输入框。 */
  onActivate: 'panel:activate',
  /** 渲染 → 主：查询能力（asr/tts/wake 是否可用 + wake 运行时）。 */
  capabilities: 'app:capabilities',
} as const;

/** 唤醒词运行所需：openWakeWord 三个模型（base64）+ 阈值，由主进程下发给渲染。 */
export interface WakeRuntime {
  threshold: number;
  /** 每步在控制台打印唤醒概率（调阈值用）。 */
  debug: boolean;
  /** base64 编码的 ONNX 模型（melspectrogram / embedding / hey_jarvis）。 */
  melModel: string;
  embModel: string;
  wakeModel: string;
}

/** 供 UI 决定显示哪些控件 + 是否启动本地唤醒词监听。 */
export interface Capabilities {
  asr: boolean;
  tts: boolean;
  /** 非 null 时渲染层启动本地唤醒词监听"Jarvis"（openWakeWord，离线，无 Key）。 */
  wake: WakeRuntime | null;
}
