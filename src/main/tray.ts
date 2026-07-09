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
import { log } from '../core/log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WAKE_ACCELERATOR = process.platform === 'darwin' ? 'Command+Shift+J' : 'Ctrl+Shift+J';

/** 16x16 嘴替粉圆点托盘图标（程序构造 RGBA bitmap，免资源文件）。 */
function makeTrayIcon(): Electron.NativeImage {
  const W = 16, H = 16;
  const [r, g, b] = [255, 45, 107]; // #FF2D6B
  const bgR = 11, bgG = 18, bgB = 25; // 与菜单栏深色背景融合
  const cx = W / 2, cy = H / 2, radius = 6.5;
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * W + x) * 4;
      if (dist <= radius) {
        // 圆内：嘴替粉，边缘做 1px 抗锯齿
        const alpha = dist > radius - 1 ? Math.round((radius - dist) * 255) : 255;
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = alpha;
      } else {
        // 圆外：透明（让菜单栏底色透过来）
        buf[idx] = bgR;
        buf[idx + 1] = bgG;
        buf[idx + 2] = bgB;
        buf[idx + 3] = 0;
      }
    }
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
