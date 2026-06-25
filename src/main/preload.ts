/**
 * 预加载脚本 —— 在隔离的上下文里把受控的 IPC API 暴露给渲染层。
 *
 * 渲染层只能通过 window.zuiti 调用，无法直接访问 Node / Electron。
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type CoachOutputDTO, type Capabilities } from '../shared/ipc.js';

const api = {
  /** 查询能力（asr/tts/wake 是否可用 + wake 运行时含模型 base64）。渲染层启动时调用一次。 */
  capabilities: (): Promise<Capabilities> => ipcRenderer.invoke(CHANNELS.capabilities),
  /** 本地唤醒词命中时调用，请求主进程唤起面板。 */
  wake: (): void => {
    ipcRenderer.send(CHANNELS.wake);
  },
  /** 触发嘴替（发送用户口述）。withScreenshot=true 时主进程自动截屏看屏。 */
  runCoach: (text: string, withScreenshot = false): void => {
    ipcRenderer.send(CHANNELS.coachRun, text, withScreenshot);
  },
  /** 发送录制的音频（base64 data URL）给主进程做 ASR。 */
  sendRecordedAudio: (base64DataUrl: string): void => {
    ipcRenderer.send(CHANNELS.voiceRecorded, base64DataUrl);
  },
  /** 耳听八方模式：发送音频给主进程做唤醒词判定（含 Jarvis 才跑 coach）。 */
  sendWakeAudio: (base64DataUrl: string): void => {
    ipcRenderer.send(CHANNELS.voiceWakeCheck, base64DataUrl);
  },
  /** 监听被唤起（热键/托盘/唤醒词命中后），聚焦输入框。 */
  onActivate: (cb: () => void): void => {
    ipcRenderer.on(CHANNELS.onActivate, () => cb());
  },
  /** 监听结果。 */
  onResult: (cb: (dto: CoachOutputDTO) => void): void => {
    ipcRenderer.on(CHANNELS.coachResult, (_e, dto: CoachOutputDTO) => cb(dto));
  },
  /** 监听加载中。 */
  onLoading: (cb: () => void): void => {
    ipcRenderer.on(CHANNELS.coachLoading, () => cb());
  },
  /** 监听流式 reply 增量（迄今为止已流出的 reply 全文，每次新增都推）。 */
  onReplyChunk: (cb: (replySoFar: string) => void): void => {
    ipcRenderer.on(CHANNELS.coachReplyChunk, (_e, replySoFar: string) => cb(replySoFar));
  },
  /** 监听错误。 */
  onError: (cb: (msg: string) => void): void => {
    ipcRenderer.on(CHANNELS.coachError, (_e, msg: string) => cb(msg));
  },
  /** 监听 ASR 转写结果（push-to-talk 流程）。 */
  onTranscript: (cb: (text: string) => void): void => {
    ipcRenderer.on(CHANNELS.voiceTranscript, (_e, text: string) => cb(text));
  },
  /** 监听 ASR 错误。 */
  onVoiceError: (cb: (msg: string) => void): void => {
    ipcRenderer.on(CHANNELS.voiceError, (_e, msg: string) => cb(msg));
  },
  /** 监听唤醒未命中（耳听八方模式继续监听）。text 是 ASR 结果（可能为空）。 */
  onWakeMiss: (cb: (text: string) => void): void => {
    ipcRenderer.on(CHANNELS.voiceWakeMiss, (_e, text: string) => cb(text));
  },
  /** 监听 TTS 音频块（base64 pcm16），首句先播。 */
  onTtsChunk: (cb: (base64: string) => void): void => {
    ipcRenderer.on(CHANNELS.voiceTtsChunk, (_e, base64: string) => cb(base64));
  },
  /** 监听 TTS 完成。 */
  onTtsDone: (cb: () => void): void => {
    ipcRenderer.on(CHANNELS.voiceTtsDone, () => cb());
  },
};

contextBridge.exposeInMainWorld('zuiti', api);

export type ZuitiApi = typeof api;
