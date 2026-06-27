/**
 * HUD 侧栏 —— 无框、右侧满高、置顶悬浮、常驻（不失焦隐藏）。Plan 9。
 */
import { BrowserWindow, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { log } from '../core/log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HUD_WIDTH = 400;
const EDGE_GAP = 0;

export function createHudWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: HUD_WIDTH,
    height: 800, // 占位高，showHud 时按屏改满高
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

  win.loadFile(join(__dirname, '..', 'renderer', 'hud.html'));

  win.webContents.on('did-finish-load', () => log.info('window.loaded', { url: 'hud.html' }));
  win.webContents.on('did-fail-load', (_e, code, desc) => log.error('window.load.failed', { code, desc }));
  win.on('closed', () => log.info('window.closed'));
  win.on('show', () => log.debug('window.shown'));
  // 注意：不再失焦隐藏（去掉 win.on('blur', …)）——常驻 side 工具。

  return win;
}

/** 贴当前光标所在屏右侧、满高显示。 */
export function showHud(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x: ax, y: ay, width, height } = display.workArea;
  const x = ax + width - HUD_WIDTH - EDGE_GAP;
  win.setBounds({ x, y: ay, width: HUD_WIDTH, height }, false);
  win.show();
  win.focus();
  log.debug('window.shown.position', { x, y: ay, height, display: display.id });
}

/** 切换显示/隐藏。返回切换后是否可见。 */
export function toggleHud(win: BrowserWindow): boolean {
  if (win.isVisible()) {
    win.hide();
    return false;
  }
  showHud(win);
  return true;
}
