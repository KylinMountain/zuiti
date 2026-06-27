/**
 * Electron 全链路冒烟（Plan 7/8）——用户本机跑。
 *
 * 启动 Electron + 加载 HUD + 模拟用户操作 + 收集日志，验证：
 *   renderer 加载 → capabilities 查询 → coach:run 流水线 → 流式蹦字 → coach:result → 渲染卡片。
 *
 * 沙箱跑不了（需 Electron GUI + desktopCapturer + AudioContext）。用户本机：
 *   npm run build && electron scripts/smoke-electron.mjs
 *
 * 写 logs/smoke/electron-<ts>.json 摘要供 LLM/agent 诊断。
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const INPUT = process.env.SMOKE_INPUT ?? '帮我怼回去：他说我代码像屎山';
const WITH_SCREENSHOT = process.env.SMOKE_SCREENSHOT === '1';

const steps = [];
const step = (name, fn) => {
  const t0 = Date.now();
  return Promise.resolve(fn()).then(
    (r) => { steps.push({ name, status: 'pass', latencyMs: Date.now() - t0 }); return r; },
    (e) => { steps.push({ name, status: 'fail', latencyMs: Date.now() - t0, error: e?.message ?? String(e) }); throw e; },
  );
};

const events = [];
const log = (msg, extra) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), msg, ...extra });
  process.stderr.write(line + '\n');
  events.push({ ts: new Date().toISOString(), msg, ...extra });
};

async function main() {
  const startTs = Date.now();
  log('smoke.electron.start', { input: INPUT, withScreenshot: WITH_SCREENSHOT });

  await app.whenReady();

  // 加载 preload + HUD
  const win = await step('createWindow', async () => {
    const w = new BrowserWindow({
      width: 480, height: 720, show: true,
      webPreferences: {
        preload: join(ROOT, 'dist', 'main', 'preload.js'),
        contextIsolation: true, nodeIntegration: false,
      },
    });
    await w.loadFile(join(ROOT, 'src', 'renderer', 'hud.html'));
    return w;
  });

  // 等 renderer ready（capabilities 查询成功 = preload 注入成功 + IPC 通）
  const caps = await step('queryCapabilities', () =>
    win.webContents.executeJavaScript(`window.zuiti.capabilities()`),
  );
  log('smoke.caps', { asr: caps.asr, tts: caps.tts, wake: !!caps.wake });

  // 监听 coach 事件（通过 executeJavaScript 注入钩子）
  let chunkCount = 0;
  let firstChunkAt = 0;
  let resultAt = 0;
  let resultDto = null;
  let errorMsg = null;

  await step('installHooks', () =>
    win.webContents.executeJavaScript(`
      window.__smoke = { chunks: 0, firstChunkAt: 0, resultAt: 0, result: null, error: null };
      window.zuiti.onReplyChunk((t) => {
        window.__smoke.chunks++;
        if (!window.__smoke.firstChunkAt) window.__smoke.firstChunkAt = Date.now();
      });
      window.zuiti.onResult((dto) => {
        window.__smoke.resultAt = Date.now();
        window.__smoke.result = dto;
      });
      window.zuiti.onError((msg) => {
        window.__smoke.error = msg;
      });
      true;
    `),
  );

  // 触发 coach:run
  const triggerTs = Date.now();
  await step('triggerRun', () => {
    win.webContents.send('coach:run' in window ? 'noop' : 'noop'); // coach:run 经 runCoach
    return win.webContents.executeJavaScript(`window.zuiti.runCoach(${JSON.stringify(INPUT)}, ${WITH_SCREENSHOT})`);
  });

  // 等结果（轮询 __smoke.result，超时 60s）
  await step('waitForResult', async () => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const s = await win.webContents.executeJavaScript('window.__smoke');
      if (s.error) throw new Error('coach error: ' + s.error);
      if (s.result) {
        chunkCount = s.chunks;
        firstChunkAt = s.firstChunkAt;
        resultAt = s.resultAt;
        resultDto = s.result;
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('超时 60s 未收到 coach:result');
  });

  // 读渲染后的 DOM（验证字段驱动渲染）
  const domState = await step('readDom', () =>
    win.webContents.executeJavaScript(`
      ({
        titleVisible: !document.getElementById('outTitle').hidden,
        titleText: document.getElementById('outTitle').textContent,
        primaryText: document.getElementById('outPrimary').textContent.slice(0, 200),
        itemsCount: document.getElementById('outItems').children.length,
        noteVisible: !document.getElementById('outNote').hidden,
        noteText: document.getElementById('outNote').textContent,
      })
    `),
  );

  const result = {
    ts: new Date(startTs).toISOString(),
    input: INPUT,
    withScreenshot: WITH_SCREENSHOT,
    totalMs: Date.now() - startTs,
    firstChunkMs: firstChunkAt ? firstChunkAt - triggerTs : null,
    resultMs: resultAt ? resultAt - triggerTs : null,
    chunkCount,
    skillId: resultDto?.skillId ?? 'unknown',
    primaryLen: resultDto?.primary?.text?.length ?? 0,
    primaryPreview: resultDto?.primary?.text?.slice(0, 200) ?? '',
    itemsCount: resultDto?.items?.length ?? 0,
    dom: domState,
    steps,
    events,
  };

  const outDir = resolve(ROOT, 'logs', 'smoke');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `electron-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

  log('smoke.electron.pass', { totalMs: result.totalMs, skillId: result.skillId, outFile });
  console.log('[smoke-electron] PASS');
  console.log('  skillId:', result.skillId);
  console.log('  首字延迟:', result.firstChunkMs + 'ms');
  console.log('  结果延迟:', result.resultMs + 'ms');
  console.log('  流式 chunks:', result.chunkCount);
  console.log('  DOM itemsCount:', result.dom.itemsCount);
  console.log('  primary:', result.primaryPreview.slice(0, 80) + '...');
  console.log('  摘要:', outFile);

  app.quit();
}

main().catch((err) => {
  log('smoke.electron.fail', { error: err?.message ?? String(err), stack: err?.stack });
  const outDir = resolve(ROOT, 'logs', 'smoke');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `electron-${Date.now()}-fail.json`);
  writeFileSync(outFile, JSON.stringify({
    ts: new Date().toISOString(),
    input: INPUT,
    error: err?.message ?? String(err),
    stack: err?.stack,
    steps, events,
  }, null, 2) + '\n', 'utf8');
  console.error('[smoke-electron] FAIL:', err?.message ?? err);
  console.error('  摘要:', outFile);
  app.exit(1);
});
