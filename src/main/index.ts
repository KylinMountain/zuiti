/**
 * 嘴替主进程入口 —— app 生命周期、托盘常驻、HUD 浮窗、IPC、语音唤醒。
 *
 * 唤醒来源：托盘点击 / 全局快捷键 / 本地 openWakeWord（喊"Jarvis"）。
 * 唤醒后：截屏看屏 → 唤起 HUD → 聚焦输入（语音/文字均可）。
 */
import { app, session, ipcMain, type BrowserWindow } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHudWindow, showHud, toggleHud } from './window.js';
import { createTray, destroyTray } from './tray.js';
import { registerCoachIpc } from './ipc.js';
import { CHANNELS, type WakeRuntime } from '../shared/ipc.js';
import { log } from '../core/log.js';
import { writeCrashReport } from '../core/crash.js';
import { loadConfig, saveConfig } from '../core/config-store.js';
import { initRuntimeConfig } from '../core/runtime-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 一次性把旧 zuiti-settings.json 的字段迁入新 zuiti-config.json 结构。 */
function migrateLegacySettings(dir: string): void {
  const legacy = join(dir, 'zuiti-settings.json');
  const next = join(dir, 'zuiti-config.json');
  if (!existsSync(legacy) || existsSync(next)) return;
  try {
    const s = JSON.parse(readFileSync(legacy, 'utf8')) as { defaultStyle?: string; ttsEnabled?: boolean; wakeThreshold?: number };
    saveConfig(dir, {
      ui: { defaultStyle: s.defaultStyle, ttsEnabled: s.ttsEnabled },
      advanced: { wakeThreshold: s.wakeThreshold },
    });
    log.info('settings.migrated');
  } catch (err) {
    log.warn('settings.migrate.failed', { msg: err instanceof Error ? err.message : String(err) });
  }
}

let hud: BrowserWindow | null = null;
let endConversation: () => void = () => {};

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

/** 唤醒：显示 HUD + 通知渲染层聚焦输入（panel:activate）。唤醒词/dock 始终唤起，不隐藏。 */
function activate(): void {
  if (!hud) return;
  showHud(hud);
  hud.webContents.send(CHANNELS.onActivate);
}

/** 快捷键/托盘：toggle 显示/收起。收起即结束本次对话。 */
function toggle(): void {
  if (!hud) return;
  const visible = toggleHud(hud);
  if (visible) {
    hud.webContents.send(CHANNELS.onActivate);
  } else {
    endConversation();
    hud.webContents.send(CHANNELS.onDeactivate);
  }
}

app.whenReady().then(() => {
  log.info('app.ready', {
    version: app.getVersion(),
    node: process.versions.node,
    electron: process.versions.electron,
  });

  // 麦克风权限：渲染层需要录音（ASR + 唤醒词）。其余权限默认拒绝。
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const granted = permission === 'media';
    log.debug('app.permission.request', { permission, granted });
    cb(granted);
  });

  hud = createHudWindow();
  log.info('window.created');

  // 载入 userData 配置并初始化 runtime-config（userData > env > 默认）。
  const userDataDir = app.getPath('userData');
  migrateLegacySettings(userDataDir);
  initRuntimeConfig(loadConfig(userDataDir), process.env);

  const wake = buildWakeRuntime();
  const coachIpc = registerCoachIpc(hud, wake);
  endConversation = coachIpc.endConversation;
  createTray(toggle);
  log.info('ipc.registered');

  const logsDir = resolve(process.cwd(), 'logs');
  const versionCtx = { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node };
  function notifyCrash(message: string): void { hud?.webContents.send(CHANNELS.crashNotice, { message }); }

  process.on('uncaughtException', (err) => {
    const p = writeCrashReport(logsDir, err, { source: 'uncaughtException', ...versionCtx });
    log.error('crash.uncaught', { msg: err instanceof Error ? err.message : String(err), report: p });
    notifyCrash('出了点内部错误，已记录（可在设置→诊断导出）。');
    // 不 process.exit —— 托盘常驻，保活。
  });
  process.on('unhandledRejection', (reason) => {
    const p = writeCrashReport(logsDir, reason, { source: 'unhandledRejection', ...versionCtx });
    log.error('crash.unhandledRejection', { msg: String(reason), report: p });
  });

  let renderGoneCount = 0;
  hud.webContents.on('render-process-gone', (_e, details) => {
    const p = writeCrashReport(logsDir, new Error(`render-process-gone: ${details.reason}`), { source: 'renderProcessGone', ...versionCtx, extra: { reason: details.reason } });
    log.error('crash.renderGone', { reason: details.reason, report: p });
    if (++renderGoneCount <= 3) { log.info('crash.renderGone.reload', { attempt: renderGoneCount }); hud?.reload(); }
    else { log.warn('crash.renderGone.giveup', { count: renderGoneCount }); }
  });

  // 本地唤醒词命中（渲染层 openWakeWord 检出 "Jarvis"）→ 与热键同样的唤起。
  ipcMain.on(CHANNELS.wake, () => {
    log.info('wake.hit');
    activate();
  });

  // 渲染层「收起」按钮 → 隐藏窗口 + 结束对话 + 通知渲染层复位。
  ipcMain.on(CHANNELS.panelHide, () => {
    if (!hud) return;
    hud.hide();
    endConversation();
    hud.webContents.send(CHANNELS.onDeactivate);
  });

  if (wake) {
    log.info('wake.enabled', { threshold: wake.threshold });
  } else {
    log.info('wake.disabled', { reason: 'models missing or WAKE_THRESHOLD unset' });
  }

  log.info('app.startup.done');

  // macOS：点 dock 图标也唤起
  app.on('activate', () => {
    log.debug('app.activate.show');
    if (hud) showHud(hud);
  });
}).catch((err) => {
  log.error('app.startup.failed', { msg: err instanceof Error ? err.message : String(err) });
});

app.on('window-all-closed', () => {
  log.debug('app.window-all-closed.tray-stay');
  // 托盘常驻：关窗不退出（不调用 app.quit() 即保持运行）
});

app.on('before-quit', () => {
  log.info('app.before-quit');
  destroyTray();
});
