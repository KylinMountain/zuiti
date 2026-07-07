/**
 * 跨进程类型（主进程 ↔ 渲染层）。
 *
 * 零运行时依赖（不 import zod / agents / node），同时被渲染层（DOM lib、无 node）和主进程编译。
 * Plan 8：统一为 UniversalOutput（primary + items），渲染层字段驱动。
 */

/** Plan 8 通用输出条目：候选/要点/行动项统一形状。 */
export interface UniversalItem {
  text: string;
  /** 风格标签 / 分类（如 "更撩" / "待办"）。 */
  label?: string;
  /** true 则渲染「复制」按钮（reply 候选用）。 */
  copyable?: boolean;
}

/** Plan 8 通用 skill 输出（替代 SkillOutput 联合类型）。primary 走文本流式，items 走 emit_result。 */
export interface UniversalOutput {
  /** best-effort：agent read 的 skill（拿不到留空，渲染/逻辑都不依赖）。 */
  skillId?: string;
  title?: string;
  /** 主体：推荐回复 / 讲解正文（来自文本流式累积）。 */
  primary: { text: string };
  items: UniversalItem[];
  note?: string;
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
  /** 主 → 渲染：推送截图预览（data URL）。 */
  coachScreenshot: 'coach:screenshot',
  /** 主 → 渲染：coach 出错。 */
  coachError: 'coach:error',
  /** 渲染 → 主：发送录音做 ASR（base64 data URL）。 */
  voiceRecorded: 'voice:recorded',
  /** 主 → 渲染：ASR 转写结果回填。 */
  voiceTranscript: 'voice:transcript',
  /** 主 → 渲染：TTS 音频块（base64 pcm16）。 */
  voiceTtsChunk: 'voice:ttsChunk',
  /** 主 → 渲染：TTS 完成。 */
  voiceTtsDone: 'voice:ttsDone',
  /** 渲染 → 主：本地唤醒词命中，请求唤起面板。 */
  wake: 'wake:trigger',
  /** 主 → 渲染：被热键/托盘/唤醒词唤起，聚焦输入框。 */
  onActivate: 'panel:activate',
  /** 主 → 渲染：面板被收起/隐藏，渲染层复位状态机（停麦、回 idle）。 */
  onDeactivate: 'panel:deactivate',
  /** 渲染 → 主：收起面板（隐藏窗口 + 结束本次对话）。 */
  panelHide: 'panel:hide',
  /** 渲染 → 主：新对话（dispose 保活 session，对话流清空在渲染层）。 */
  conversationReset: 'conversation:reset',
  /** 渲染 → 主：查询能力（asr/tts/wake 是否可用 + wake 运行时）。 */
  capabilities: 'app:capabilities',
  /** 渲染 → 主：渲染层日志转发（level, msg, extra）。 */
  rendererLog: 'renderer:log',
  /** 渲染 → 主：获取历史记录列表（最新 N 条）。 */
  historyList: 'history:list',
  /** 渲染 → 主：清除所有历史记录。 */
  historyClear: 'history:clear',
  /** 渲染 → 主：读取完整配置（明文；UI 用密码框遮蔽显示）。 */
  configGet: 'config:get',
  /** 渲染 → 主：部分更新配置（写 userData + 重载 runtime-config）。 */
  configSet: 'config:set',
  /** 渲染 → 主：连接自检（service: 'llm'|'asr'|'tts'|'all'）。 */
  configTest: 'config:test',
  /** 主 → 渲染：连接状态变化推送（HealthResult[]）。 */
  configStatus: 'config:status',
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

/** 用户可选的风格（影响 LLM 输出语气）。 */
export type ReplyStyle = 'empathy' | 'roast' | 'formal' | 'casual' | 'english';

/** 默认风格。 */
export const DEFAULT_STYLE: ReplyStyle = 'empathy';

/** 所有可用风格（UI 按钮按此顺序渲染）。 */
export const REPLY_STYLES: ReadonlyArray<{ id: ReplyStyle; label: string; emoji: string }> = [
  { id: 'empathy',  label: '高情商', emoji: '💕' },
  { id: 'roast',    label: '毒舌',   emoji: '🔥' },
  { id: 'formal',   label: '正式',   emoji: '👔' },
  { id: 'casual',   label: '随意',   emoji: '😎' },
  { id: 'english',  label: '英文',   emoji: '🌍' },
] as const;

/** 单条历史记录。 */
export interface HistoryEntry {
  /** 唯一 ID（时间戳）。 */
  id: number;
  /** Unix timestamp (ms). */
  ts: number;
  /** 用户输入摘要。 */
  input: string;
  /** 嘴替主回复摘要。 */
  output: string;
  /** 使用的风格。 */
  style?: string;
}

/** 供 UI 决定显示哪些控件 + 是否启动本地唤醒词监听。 */
export interface Capabilities {
  asr: boolean;
  tts: boolean;
  /** 非 null 时渲染层启动本地唤醒词监听"Jarvis"（openWakeWord，离线，无 Key）。 */
  wake: WakeRuntime | null;
  /** 是否已有有效配置（apiKey+baseURL 齐 + 最近 checkLlm 通过）。Task 8 将填充此字段。 */
  configured?: boolean;
  /** 各服务最近一次自检结果（可空）。 */
  health?: HealthResultDTO[];
}

/** 与 core/errors.ts、core/service-health.ts、core/config-store.ts 对应的跨进程 DTO（结构一致，供渲染层类型使用）。 */
export type ErrorKind = 'authInvalid' | 'rateLimited' | 'network' | 'server' | 'asrEmpty' | 'ttsFailed' | 'unknown';
export interface ClassifiedErrorDTO { kind: ErrorKind; userMessage: string; retryable: boolean; fixAction?: 'openSettings'; }
export interface HealthResultDTO { service: 'llm' | 'asr' | 'tts'; ok: boolean; httpStatus?: number; kind?: ErrorKind; message: string; latencyMs: number; }
export interface ZuitiConfigDTO {
  credential: { apiKey?: string; baseURL?: string };
  llm: { model?: string }; asr: { model?: string; lang?: 'zh' | 'auto' | 'en' };
  tts: { model?: string; voice?: string }; advanced: { wakeThreshold?: number };
  ui: { defaultStyle?: string; ttsEnabled?: boolean };
}
