/**
 * Electron 全链路冒烟（Plan 9）——用户本机跑。
 *
 * 启动 Electron + 注册主进程 IPC + 加载 HUD + 驱动两轮对话 + 收集日志，验证：
 *   renderer 加载 → capabilities → 两轮 coach 流水线（真 MiMo）→ 流式蹦字 → coach:result
 *   → 对话流气泡渲染 → 跨轮记忆（第二轮记得第一轮）。
 *
 * 沙箱跑不了（需 Electron GUI + AudioContext）。用户本机：
 *   npm run smoke:electron      （= npm run build && electron scripts/smoke-electron.mjs）
 * 需 .env 的 LLM key（真调 MiMo，花钱）。默认不截屏（SMOKE_SCREENSHOT=1 开）。
 * 写 logs/smoke/electron-<ts>.json 摘要供 LLM/agent 诊断。
 */
import { app, BrowserWindow, session } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { registerCoachIpc } from '../dist/main/ipc.js';

loadDotenv();
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 两轮：首轮埋记忆，次轮验证记住了。可用 env 覆盖。
const TURN1 = process.env.SMOKE_INPUT ?? '记住，我的幸运数字是 7。简短回应一下就行。';
const TURN2 = process.env.SMOKE_INPUT2 ?? '我的幸运数字是几？只回答数字。';
const MEMORY_RE = /7|七/;
const WITH_SCREENSHOT = process.env.SMOKE_SCREENSHOT === '1';

const events = [];
const log = (msg, extra) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), msg, ...(extra || {}) });
  process.stderr.write(line + '\n');
  events.push({ ts: new Date().toISOString(), msg, ...(extra || {}) });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, exprBool, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(exprBool)) return;
    await sleep(200);
  }
  throw new Error('timeout: ' + label);
}

// 看门狗：无论如何 150s 后退出，避免挂死。
setTimeout(() => { log('smoke.watchdog'); app.exit(2); }, 150000);

async function main() {
  const startTs = Date.now();
  log('smoke.electron.start', { turn1: TURN1, turn2: TURN2, withScreenshot: WITH_SCREENSHOT });
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_wc, p, cb) => cb(p === 'media'));

  const win = new BrowserWindow({
    width: 400, height: 880, show: true, backgroundColor: '#0a0410',
    webPreferences: {
      preload: join(ROOT, 'dist', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  // 先注册 IPC（capabilities/coach/voice/...）再加载页面，避免渲染层启动查询时无 handler。
  // wake=null：冒烟不启动本地声学唤醒（不需要 models，也不抢麦克风）。
  registerCoachIpc(win, null);
  await win.loadFile(join(ROOT, 'dist', 'renderer', 'hud.html'));
  log('window.loaded');

  // 等 preload + IPC 通
  await waitFor(win, 'typeof window.zuiti === "object" && !!window.zuiti.capabilities', 15000, 'preload');
  const caps = await win.webContents.executeJavaScript('window.zuiti.capabilities()');
  log('smoke.caps', { asr: caps.asr, tts: caps.tts, wake: !!caps.wake });

  // ── 错误呈现路径冒烟 ──────────────────────────────────────────────
  // 注入故意错误的凭证，发一轮 → 断言收到 onError(authInvalid) + DOM 出现 .bubble--error
  log('smoke.errorPath.start');
  await win.webContents.executeJavaScript(`
    window.__smokeErr = { error: null };
    window.zuiti.onError((e) => { window.__smokeErr.error = e; });
    window.zuiti.setConfig({ credential: { apiKey: 'bad', baseURL: 'https://x/v1' } });
    true;
  `);
  await win.webContents.executeJavaScript(`window.zuiti.runCoach('test', false); true;`);
  await waitFor(win, '!!window.__smokeErr.error', 20000, 'onError(authInvalid or network)');
  const errEvt = await win.webContents.executeJavaScript('window.__smokeErr.error');
  log('smoke.errorPath.onError', { kind: errEvt?.kind, msg: errEvt?.userMessage });
  // DOM: .bubble--error 应已渲染
  const hasErrorBubble = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.bubble--error').length > 0`
  );
  log('smoke.errorPath.dom', { hasErrorBubble });
  if (!hasErrorBubble) throw new Error('smoke: .bubble--error not found in DOM after error');
  log('smoke.errorPath.pass', { kind: errEvt?.kind });

  // 恢复可用凭证（若有效 key 可用则继续两轮记忆测试）
  const hasValidKey = !!process.env.LLM_API_KEY;
  await win.webContents.executeJavaScript(`
    window.zuiti.setConfig({ credential: { apiKey: ${JSON.stringify(process.env.LLM_API_KEY ?? '')}, baseURL: ${JSON.stringify(process.env.LLM_BASE_URL ?? '')} } });
    true;
  `);

  // 挂结果钩子（累积每轮 result / chunks / error）
  await win.webContents.executeJavaScript(`
    window.__smoke = { results: [], chunks: 0, error: null };
    window.zuiti.onReplyChunk(() => window.__smoke.chunks++);
    window.zuiti.onResult((dto) => window.__smoke.results.push(dto));
    window.zuiti.onError((m) => window.__smoke.error = m);
    true;
  `);

  async function runTurn(text, idx) {
    const t0 = Date.now();
    // 走 preload runCoach（确定性、可控是否截屏）；主进程用同一个保活会话 → 跨轮记忆。
    await win.webContents.executeJavaScript(`window.zuiti.runCoach(${JSON.stringify(text)}, ${WITH_SCREENSHOT}); true;`);
    await waitFor(win, `window.__smoke.results.length >= ${idx} || !!window.__smoke.error`, 60000, 'result ' + idx);
    const err = await win.webContents.executeJavaScript('window.__smoke.error');
    if (err) throw new Error('coach error: ' + err);
    const dto = await win.webContents.executeJavaScript(`window.__smoke.results[${idx - 1}]`);
    log('smoke.turn', { idx, ms: Date.now() - t0, skillId: dto.skillId, primaryLen: dto.primary?.text?.length ?? 0, items: dto.items?.length ?? 0 });
    return dto;
  }

  // ── 两轮记忆路径（仅 hasValidKey 时运行）─────────────────────────
  let t1, t2, memoryRecalled = false, dom = {};
  if (hasValidKey) {
    t1 = await runTurn(TURN1, 1);
    await sleep(600);
    t2 = await runTurn(TURN2, 2);
    memoryRecalled = MEMORY_RE.test(t2.primary?.text ?? '');
    await sleep(400);

    // 读新版对话流 DOM（字段驱动渲染 → 气泡 + 候选卡）
    dom = await win.webContents.executeJavaScript(`
      (() => {
        const as = [...document.querySelectorAll('.bubble--assistant')];
        const last = as[as.length - 1];
        return {
          assistantBubbles: as.length,
          lastPrimary: last ? (last.querySelector('.bubble__text')?.textContent || '').slice(0, 120) : '',
          lastItems: last ? last.querySelectorAll('.reply-item').length : 0,
          emptyHidden: document.getElementById('transcriptEmpty')?.hidden ?? null,
        };
      })()
    `);
  } else {
    log('smoke.memoryPath.skipped', { reason: 'no LLM_API_KEY' });
  }

  const result = {
    ts: new Date(startTs).toISOString(),
    totalMs: Date.now() - startTs,
    caps: { asr: caps.asr, tts: caps.tts, wake: !!caps.wake },
    errorPath: { kind: errEvt?.kind, hasErrorBubble },
    ...(hasValidKey ? {
      turn1: { skillId: t1.skillId, primary: t1.primary?.text?.slice(0, 160), items: t1.items?.length ?? 0 },
      turn2: { skillId: t2.skillId, primary: t2.primary?.text?.slice(0, 160), items: t2.items?.length ?? 0 },
      memoryRecalled,
      dom,
    } : { memoryPath: 'skipped (no valid key)' }),
    events,
  };
  const outDir = resolve(ROOT, 'logs', 'smoke');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `electron-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

  if (hasValidKey && !memoryRecalled) throw new Error('多轮记忆未命中：turn2="' + (t2.primary?.text ?? '') + '"（期望含 7/七）');

  log('smoke.electron.pass', { memoryRecalled, outFile });
  console.log('\n[smoke-electron] PASS ✅');
  console.log('  errorPath:', { kind: errEvt?.kind, hasErrorBubble });
  if (hasValidKey) {
    console.log('  turn1:', result.turn1?.primary);
    console.log('  turn2:', result.turn2?.primary, '| memoryRecalled:', memoryRecalled);
    console.log('  assistantBubbles:', dom.assistantBubbles, '| emptyHidden:', dom.emptyHidden);
  } else {
    console.log('  memoryPath: skipped (no LLM_API_KEY)');
  }
  console.log('  摘要:', outFile);
  app.quit();
}

main().catch((err) => {
  log('smoke.electron.fail', { error: err?.message ?? String(err), stack: err?.stack });
  const outDir = resolve(ROOT, 'logs', 'smoke');
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `electron-${Date.now()}-fail.json`), JSON.stringify({ error: err?.message ?? String(err), stack: err?.stack, events }, null, 2) + '\n', 'utf8');
  } catch { /* ignore */ }
  console.error('[smoke-electron] FAIL:', err?.message ?? err);
  app.exit(1);
});
