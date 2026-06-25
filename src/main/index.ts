/**
 * 嘴替主进程入口 —— app 生命周期、托盘常驻、HUD 浮窗、IPC。
 *
 * 语音唤醒 / VAD / 截屏看屏是 Plan 3 harness；当前以托盘点击 + 全局快捷键触发。
 */
import { app, type BrowserWindow } from 'electron';
import { createHudWindow, showHud } from './window.js';
import { createTray, destroyTray } from './tray.js';
import { registerCoachIpc } from './ipc.js';

let hud: BrowserWindow | null = null;

function wake(): void {
  if (!hud) return;
  showHud(hud);
}

app.whenReady().then(() => {
  hud = createHudWindow();
  registerCoachIpc(hud);
  createTray(wake);

  // macOS：点 dock 图标也唤起
  app.on('activate', () => {
    if (hud) showHud(hud);
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻：关窗不退出（不调用 app.quit() 即保持运行）
});

app.on('before-quit', () => {
  destroyTray();
});
