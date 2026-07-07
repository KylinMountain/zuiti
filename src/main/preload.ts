/**
 * 预加载脚本 —— 在隔离的上下文里把受控的 IPC API 暴露给渲染层。
 *
 * 渲染层只能通过 window.zuiti 调用，无法直接访问 Node / Electron。
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type Capabilities, type UniversalOutput, type ReplyStyle, type ClassifiedErrorDTO, type HealthResultDTO, type ZuitiConfigDTO } from '../shared/ipc.js';

const api = {
  /** 渲染层日志转发到主进程（写入同一个日志文件）。 */
  rlog: (level: string, msg: string, extra?: Record<string, unknown>): void => {
    ipcRenderer.send(CHANNELS.rendererLog, level, msg, extra);
  },
  /** 查询能力（asr/tts/wake 是否可用 + wake 运行时含模型 base64）。渲染层启动时调用一次。 */
  capabilities: (): Promise<Capabilities> => ipcRenderer.invoke(CHANNELS.capabilities),
  /** 本地唤醒词命中时调用，请求主进程唤起面板。 */
  wake: (): void => {
    ipcRenderer.send(CHANNELS.wake);
  },
  /** 触发嘴替（发送用户口述）。withScreenshot=true 时主进程自动截屏看屏。 */
  runCoach: (text: string, withScreenshot = false, style?: ReplyStyle): void => {
    ipcRenderer.send(CHANNELS.coachRun, text, withScreenshot, style);
  },
  /** 发送录制的音频（base64 data URL）给主进程做 ASR。withScreenshot=true 时自动截屏看屏。 */
  sendRecordedAudio: (base64DataUrl: string, withScreenshot = false, style?: ReplyStyle): void => {
    ipcRenderer.send(CHANNELS.voiceRecorded, base64DataUrl, withScreenshot, style);
  },
  /** 监听被唤起（热键/托盘/唤醒词命中后），聚焦输入框。 */
  onActivate: (cb: () => void): void => {
    ipcRenderer.on(CHANNELS.onActivate, () => cb());
  },
  /** 监听结果（Plan 6: UniversalOutput 联合类型，按 skillId 分支渲染）。 */
  onResult: (cb: (dto: UniversalOutput) => void): void => {
    ipcRenderer.on(CHANNELS.coachResult, (_e, dto: UniversalOutput) => cb(dto));
  },
  /** 监听加载中。 */
  onLoading: (cb: () => void): void => {
    ipcRenderer.on(CHANNELS.coachLoading, () => cb());
  },
  /** 监听截图预览（主进程截屏后推送 data URL）。 */
  onScreenshot: (cb: (dataUrl: string) => void): void => {
    ipcRenderer.on(CHANNELS.coachScreenshot, (_e, dataUrl: string) => cb(dataUrl));
  },
  /** 监听流式 reply 增量（迄今为止已流出的 reply 全文，每次新增都推）。 */
  onReplyChunk: (cb: (replySoFar: string) => void): void => {
    ipcRenderer.on(CHANNELS.coachReplyChunk, (_e, replySoFar: string) => cb(replySoFar));
  },
  /** 监听错误。 */
  onError: (cb: (err: ClassifiedErrorDTO) => void): void => {
    ipcRenderer.on(CHANNELS.coachError, (_e, err: ClassifiedErrorDTO) => cb(err));
  },
  /** 监听 ASR 转写结果（push-to-talk 流程）。 */
  onTranscript: (cb: (text: string) => void): void => {
    ipcRenderer.on(CHANNELS.voiceTranscript, (_e, text: string) => cb(text));
  },
  /** 监听 ASR 错误。 */
  onVoiceError: (cb: (msg: string) => void): void => {
    ipcRenderer.on(CHANNELS.voiceError, (_e, msg: string) => cb(msg));
  },
  /** 收起面板（隐藏窗口 + 结束本次对话）。 */
  hidePanel: (): void => {
    ipcRenderer.send(CHANNELS.panelHide);
  },
  /** 新对话：dispose 主进程保活 session。 */
  resetConversation: (): void => {
    ipcRenderer.send(CHANNELS.conversationReset);
  },
  /** 监听面板被收起/隐藏，复位渲染层状态机。 */
  onDeactivate: (cb: () => void): void => {
    ipcRenderer.on(CHANNELS.onDeactivate, () => cb());
  },
  /** 监听 TTS 音频块（base64 pcm16），首句先播。 */
  onTtsChunk: (cb: (base64: string) => void): void => {
    ipcRenderer.on(CHANNELS.voiceTtsChunk, (_e, base64: string) => cb(base64));
  },
  /** 监听 TTS 完成。 */
  onTtsDone: (cb: () => void): void => {
    ipcRenderer.on(CHANNELS.voiceTtsDone, () => cb());
  },
  /** 获取最近 N 条历史（默认 20）。 */
  getHistory: (limit = 20): Promise<unknown[]> => {
    return ipcRenderer.invoke(CHANNELS.historyList, limit);
  },
  /** 清除全部历史。 */
  clearHistory: (): Promise<void> => {
    return ipcRenderer.invoke(CHANNELS.historyClear);
  },
  /**
   * 读取设置。key 不传返回全部设置。
   * @deprecated Use getConfig() instead. Will be removed in Task 9.
   */
  getSettings: (key?: string): Promise<Record<string, unknown>> => {
    return ipcRenderer.invoke(CHANNELS.settingsGet, key);
  },
  /**
   * 写入设置（部分更新）。
   * @deprecated Use setConfig() instead. Will be removed in Task 9.
   */
  saveSettings: (settings: Record<string, unknown>): Promise<void> => {
    return ipcRenderer.invoke(CHANNELS.settingsSet, settings);
  },
  /** 读取完整配置（key 脱敏由主进程决定）。 */
  getConfig: (): Promise<ZuitiConfigDTO> => ipcRenderer.invoke(CHANNELS.configGet),
  /** 部分更新配置（写 userData + 重载 runtime-config）。 */
  setConfig: (patch: Partial<ZuitiConfigDTO>): Promise<ZuitiConfigDTO> => ipcRenderer.invoke(CHANNELS.configSet, patch),
  /** 连接自检（service: 'llm'|'asr'|'tts'|'all'）。 */
  testConnection: (service: 'llm' | 'asr' | 'tts' | 'all'): Promise<HealthResultDTO[]> => ipcRenderer.invoke(CHANNELS.configTest, service),
  /** 监听连接状态变化推送（HealthResult[]）。 */
  onConnectionStatus: (cb: (health: HealthResultDTO[]) => void): void => { ipcRenderer.on(CHANNELS.configStatus, (_e, h: HealthResultDTO[]) => cb(h)); },
};

contextBridge.exposeInMainWorld('zuiti', api);

export type ZuitiApi = typeof api;
