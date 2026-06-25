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
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WAKE_ACCELERATOR = process.platform === 'darwin' ? 'Command+Shift+J' : 'Ctrl+Shift+J';

/** 16x16 嘴替粉圆点托盘图标（程序构造 RGBA bitmap，免资源文件）。 */
function makeTrayIcon(): Electron.NativeImage {
  const W = 16, H = 16;
  const [r, g, b, a] = [255, 45, 107, 255]; // #FF2D6B
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = r;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = a;
  }
  return nativeImage.createFromBitmap(buf, { width: W, height: H });
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
    { label: '唤起 (Cmd+Shift+J)', click: onWake },
    { type: 'separator' },
    { label: '退出', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', onWake);

  globalShortcut.register(WAKE_ACCELERATOR, onWake);

  return tray;
}

/** 注销全局快捷键（app 退出前调用）。 */
export function destroyTray(): void {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
}

export { WAKE_ACCELERATOR };
