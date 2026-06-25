/**
 * 预加载脚本 —— 在隔离的上下文里把受控的 IPC API 暴露给渲染层。
 *
 * 渲染层只能通过 window.zuiti 调用，无法直接访问 Node / Electron。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { CoachOutputDTO } from '../shared/ipc.js';

const api = {
  /** 触发嘴替（发送用户口述）。withScreenshot=true 时主进程自动截屏看屏。 */
  runCoach: (text: string, withScreenshot = false): void => {
    ipcRenderer.send('coach:run', text, withScreenshot);
  },
  /** 发送录制的音频（base64 data URL）给主进程做 ASR。 */
  sendRecordedAudio: (base64DataUrl: string): void => {
    ipcRenderer.send('voice:recorded', base64DataUrl);
  },
  /** 监听结果。 */
  onResult: (cb: (dto: CoachOutputDTO) => void): void => {
    ipcRenderer.on('coach:result', (_e, dto: CoachOutputDTO) => cb(dto));
  },
  /** 监听加载中。 */
  onLoading: (cb: () => void): void => {
    ipcRenderer.on('coach:loading', () => cb());
  },
  /** 监听错误。 */
  onError: (cb: (msg: string) => void): void => {
    ipcRenderer.on('coach:error', (_e, msg: string) => cb(msg));
  },
  /** 监听 ASR 转写结果（push-to-talk 流程）。 */
  onTranscript: (cb: (text: string) => void): void => {
    ipcRenderer.on('voice:transcript', (_e, text: string) => cb(text));
  },
  /** 监听 ASR 错误。 */
  onVoiceError: (cb: (msg: string) => void): void => {
    ipcRenderer.on('voice:error', (_e, msg: string) => cb(msg));
  },
  /** 监听 TTS 音频块（base64 pcm16），首句先播。 */
  onTtsChunk: (cb: (base64: string) => void): void => {
    ipcRenderer.on('voice:ttsChunk', (_e, base64: string) => cb(base64));
  },
  /** 监听 TTS 完成。 */
  onTtsDone: (cb: () => void): void => {
    ipcRenderer.on('voice:ttsDone', () => cb());
  },
};

contextBridge.exposeInMainWorld('zuiti', api);

export type ZuitiApi = typeof api;
