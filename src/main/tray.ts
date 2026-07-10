/**
 * 托盘常驻 —— 嘴替的入口。
 *
 * 唤醒方式（三种并存）：
 * - 本地 openWakeWord 声学唤醒（Plan 4，渲染层 ONNX 推理）
 * - 全局快捷键 Cmd+Shift+J / Ctrl+Shift+J
 * - 托盘点击
 */
import { Tray, Menu, globalShortcut, nativeImage, type BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { log } from '../core/log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WAKE_ACCELERATOR = process.platform === 'darwin' ? 'Command+Shift+J' : 'Ctrl+Shift+J';

/**
 * 22x22 托盘图标：复用 build/icon.png（嘴替头像）缩小。
 *
 * 之前用 nativeImage.createFromBitmap 手写 RGBA buffer 画粉圆点——`createFromBitmap` 的
 * 原始字节序是"platform-dependent"（Electron 官方文档原话），在 macOS 上实测是 BGRA 不是
 * RGBA，R/B 通道被交换，粉色 (255,45,107) 变成紫色 (107,45,255) 显示。改用真实 PNG 文件
 * （nativeImage.createFromPath）从根上避免这整类字节序问题，顺带图标跟 app 图标视觉一致。
 */
function makeTrayIcon(): Electron.NativeImage {
  const iconPath = join(__dirname, '..', '..', 'build', 'icon.png');
  const img = nativeImage.createFromPath(iconPath);
  return img.resize({ width: 22, height: 22 });
}

let tray: Tray | null = null;

/**
 * 创建托盘 + 注册全局快捷键。
 * @param onWake 唤醒回调（显示并聚焦 HUD）。
 */
export function createTray(onWake: () => void): Tray {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('嘴替 —— 你负责想，它负责嘴');

  const menu = Menu.buildFromTemplate([
    { label: '嘴替', enabled: false },
    { type: 'separator' },
    { label: '显示/收起 (Cmd+Shift+J)', click: onWake },
    { type: 'separator' },
    { label: '退出', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', onWake);

  const registered = globalShortcut.register(WAKE_ACCELERATOR, onWake);
  if (!registered) {
    log.warn('tray.shortcut.register.failed', { accelerator: WAKE_ACCELERATOR });
  }

  return tray;
}

/** 注销全局快捷键（app 退出前调用）。 */
export function destroyTray(): void {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
}

export { WAKE_ACCELERATOR };
