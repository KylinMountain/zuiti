/**
 * HUD 浮窗 —— 无框、侧贴、常驻顶层的小面板。
 * 召唤即现、用完即隐（失焦自动隐藏）。
 */
import { BrowserWindow, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HUD_WIDTH = 380;
const HUD_HEIGHT = 540;

/** 创建 HUD 浮窗（不显示，由 tray/快捷键唤起）。 */
export function createHudWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // esbuild 把 hud.ts 打包到 dist/renderer/hud.js，copy-assets 把 hud.html/css + onnx wasm 拷过去
  win.loadFile(join(__dirname, '..', 'renderer', 'hud.html'));

  // 失焦自动隐藏（用完即隐）
  win.on('blur', () => {
    win.hide();
  });

  return win;
}

/** 把浮窗贴到当前活动屏幕右侧居中并显示。 */
export function showHud(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { width, height } = display.workAreaSize;
  const x = display.workArea.x + width - HUD_WIDTH - 12;
  const y = display.workArea.y + Math.round((height - HUD_HEIGHT) / 2);
  win.setPosition(x, y, false);
  win.show();
  win.focus();
}
