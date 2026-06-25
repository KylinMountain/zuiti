/**
 * 预加载脚本 —— 在隔离的上下文里把受控的 IPC API 暴露给渲染层。
 *
 * 渲染层只能通过 window.zuiti 调用，无法直接访问 Node / Electron。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { CoachOutputDTO } from '../shared/ipc.js';

const api = {
  /** 触发嘴替（发送用户口述）。 */
  runCoach: (text: string): void => {
    ipcRenderer.send('coach:run', text);
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
};

contextBridge.exposeInMainWorld('zuiti', api);

export type ZuitiApi = typeof api;
