/**
 * 嘴替主进程入口 —— app 生命周期、托盘常驻、HUD 浮窗、IPC、语音唤醒。
 *
 * 唤醒来源：托盘点击 / 全局快捷键 / 本地 openWakeWord（喊"Jarvis"）。
 * 唤醒后：截屏看屏 → 唤起 HUD → 聚焦输入（语音/文字均可）。
 */
import { app, session, ipcMain, type BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHudWindow, showHud } from './window.js';
import { createTray, destroyTray } from './tray.js';
import { registerCoachIpc } from './ipc.js';
import { CHANNELS, type WakeRuntime } from '../shared/ipc.js';
import { log } from '../core/log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let hud: BrowserWindow | null = null;

/** 唤醒词配置：从 models/ 读 3 个 ONNX → base64 下发给渲染层。模型缺失则返回 null（功能关闭）。 */
function buildWakeRuntime(): WakeRuntime | null {
  const dir = join(__dirname, '..', '..', 'models');
  const threshold = Number(process.env.WAKE_THRESHOLD ?? '0.5');
  const debug = process.env.WAKE_DEBUG === '1';
  try {
    const b64 = (name: string): string => readFileSync(join(dir, name)).toString('base64');
    return {
      threshold,
      debug,
      melModel: b64('melspectrogram.onnx'),
      embModel: b64('embedding_model.onnx'),
      wakeModel: b64('hey_jarvis_v0.1.onnx'),
    };
  } catch (err) {
    log.warn('wake.models.missing', {
      msg: err instanceof Error ? err.message : String(err),
      hint: '运行 `npm run fetch-models` 下载 openWakeWord 模型；缺模型时唤醒词功能关闭，热键/托盘仍可用。',
    });
    return null;
  }
}

/** 唤醒：显示 HUD + 通知渲染层聚焦输入（panel:activate）。 */
function activate(): void {
  if (!hud) return;
  showHud(hud);
  hud.webContents.send(CHANNELS.onActivate);
}

app.whenReady().then(() => {
  // 麦克风权限：渲染层需要录音（ASR + 唤醒词）。其余权限默认拒绝。
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(permission === 'media'),
  );

  hud = createHudWindow();
  const wake = buildWakeRuntime();
  registerCoachIpc(hud, wake);
  createTray(activate);

  // 本地唤醒词命中（渲染层 openWakeWord 检出 "Jarvis"）→ 与热键同样的唤起。
  ipcMain.on(CHANNELS.wake, () => activate());
  if (wake) {
    log.info('wake.enabled', { threshold: wake.threshold });
  } else {
    log.info('wake.disabled', { reason: 'models missing or WAKE_THRESHOLD unset' });
  }

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
