// 嘴替 HUD 渲染逻辑 —— 赛博霓虹版
// 监听 IPC、渲染卡片、点即复制、TTS 播放、点一下说话（VAD 自动停）。
// 通过 window.zuiti（preload 暴露）与主进程通信。
// esbuild 把本文件打包成 dist/renderer/hud.js（ESM）。
/* global window, document, AudioContext, navigator, MediaRecorder, Blob, DataView, Uint8Array, ArrayBuffer, btoa, AnalyserNode, atob */
'use strict';

import { VadDetector, computeRms } from './vad.js';
import { initWakeWord } from './wakeword.js';
import { encodeWav } from './wav.js';
import { buildRenderPlan } from '../shared/render-plan.js';
import { REPLY_STYLES, DEFAULT_STYLE, type ReplyStyle } from '../shared/ipc.js';
import type { Capabilities, UniversalOutput, WakeRuntime } from '../shared/ipc.js';
import { nextConvState, type ConvState, type ConvEvent } from '../shared/conv-state.js';

declare global {
  interface Window {
    zuiti: {
      rlog(level: string, msg: string, extra?: Record<string, unknown>): void;
      capabilities(): Promise<Capabilities>;
      wake(): void;
      runCoach(text: string, withScreenshot?: boolean, style?: string): void;
      sendRecordedAudio(base64DataUrl: string, withScreenshot?: boolean, style?: string): void;
      resetConversation(): void;
      hidePanel(): void;
      onActivate(cb: () => void): void;
      onDeactivate(cb: () => void): void;
      onResult(cb: (dto: UniversalOutput) => void): void;
      onLoading(cb: () => void): void;
      onScreenshot(cb: (dataUrl: string) => void): void;
      onReplyChunk(cb: (replySoFar: string) => void): void;
      onError(cb: (msg: string) => void): void;
      onTranscript(cb: (text: string) => void): void;
      onVoiceError(cb: (msg: string) => void): void;
      onTtsChunk(cb: (base64: string) => void): void;
      onTtsDone(cb: () => void): void;
      getSettings(key?: string): Promise<Record<string, unknown>>;
      saveSettings(settings: Record<string, unknown>): Promise<void>;
      getHistory(limit?: number): Promise<unknown[]>;
      clearHistory(): Promise<void>;
    };
  }
}

const api = window.zuiti;

// ============ 风格状态 ============
let currentStyle: ReplyStyle = DEFAULT_STYLE;

function setCurrentStyle(style: ReplyStyle): void {
  currentStyle = style;
  document.querySelectorAll('.style-pill').forEach((el) => {
    el.classList.toggle('style-pill--active', (el as HTMLElement).dataset.style === style);
  });
}

/** 渲染风格切换器按钮（启动时调用一次）。 */
function initStylePills(): void {
  const container = document.getElementById('stylePills');
  if (!container) return;
  for (const s of REPLY_STYLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-pill' + (s.id === currentStyle ? ' style-pill--active' : '');
    btn.dataset.style = s.id;
    btn.innerHTML = `<span class="style-pill__emoji">${s.emoji}</span>${s.label}`;
    btn.addEventListener('click', () => setCurrentStyle(s.id));
    container.appendChild(btn);
  }
}
initStylePills();

// ============ 快捷场景 ============
document.querySelectorAll('.scene-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const prompt = (btn as HTMLElement).dataset.prompt ?? '';
    $text.value = prompt;
    $text.focus();
    // Select all text so user can easily modify
    $text.select();
  });
});

// ============ 渲染层日志转发 ============
function rlog(level: string, msg: string, extra?: Record<string, unknown>): void {
  try { api.rlog(level, msg, extra); } catch { /* ignore */ }
}
// 全局未捕获错误也转发
window.addEventListener('error', (e) => {
  rlog('error', 'uncaught', { msg: e.message, filename: e.filename, lineno: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  rlog('error', 'unhandledrejection', { reason: String(e.reason) });
});

// 保存 wake 运行时，TTS 完成后重新初始化唤醒词用
let caps_wake: WakeRuntime | null = null;

// ============ DOM 引用 ============
const $text = document.getElementById('text') as HTMLTextAreaElement;
const $go = document.getElementById('go') as HTMLButtonElement;
const $mic = document.getElementById('mic') as HTMLButtonElement;
const $micLabel = $mic.querySelector('.mic-btn__label') as HTMLElement;
const $voiceState = document.getElementById('voiceState') as HTMLElement;
const $status = document.getElementById('status') as HTMLElement;
const $thinkingText = document.getElementById('thinkingText') as HTMLElement;
const $output = document.getElementById('output') as HTMLElement;
const $outTitle = document.getElementById('outTitle') as HTMLElement;
const $outPrimary = document.getElementById('outPrimary') as HTMLElement;
const $outItems = document.getElementById('outItems') as HTMLElement;
const $outNote = document.getElementById('outNote') as HTMLElement;
const $screenshot = document.getElementById('screenshot') as HTMLInputElement;
const $vadAuto = document.getElementById('vadAuto') as HTMLInputElement;
const $wakeListen = document.getElementById('wakeListen') as HTMLInputElement;
const $avatar = document.getElementById('avatar') as HTMLElement;
const $moodText = document.getElementById('moodText') as HTMLElement;
const $wave = document.getElementById('wave') as HTMLElement;
const $screenshotPreview = document.getElementById('screenshotPreview') as HTMLElement;
const $screenshotImg = document.getElementById('screenshotImg') as HTMLImageElement;

const avatarFace = $avatar.querySelector('.avatar') as HTMLElement;

// ============ 头像表情状态 ============
function setAvatarState(state: 'idle' | 'thinking' | 'talking'): void {
  avatarFace.classList.remove('avatar--thinking', 'avatar--talking');
  if (state === 'thinking') avatarFace.classList.add('avatar--thinking');
  if (state === 'talking') avatarFace.classList.add('avatar--talking');
}

function setMood(text: string): void {
  $moodText.textContent = text;
}

// ============ 对话状态机（单一来源） ============
let convState: ConvState = 'idle';
let noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
const NO_SPEECH_MS = 10_000;
let firstTurnPending = true; // 本次对话首轮带截图

function clearNoSpeechTimer(): void {
  if (noSpeechTimer) { clearTimeout(noSpeechTimer); noSpeechTimer = null; }
}

/** 进入 listening 时起 10s「无人开口」计时；说话开始时取消。 */
function armNoSpeechTimer(): void {
  clearNoSpeechTimer();
  noSpeechTimer = setTimeout(() => {
    rlog('info', 'conv.noSpeechTimeout');
    applyEvent('noSpeechTimeout');
  }, NO_SPEECH_MS);
}

function setHeaderState(s: ConvState): void {
  const moods: Record<ConvState, string> = {
    idle: '待唤醒 · 喊我「Jarvis」', listening: '听你说…', thinking: '思考中…', speaking: '说给你听…',
  };
  setMood(moods[s]);
  setAvatarState(s === 'thinking' ? 'thinking' : s === 'speaking' ? 'talking' : s === 'listening' ? 'talking' : 'idle');
}

/** 应用一个事件：算下一状态 → 执行副作用。集中所有麦/计时/唤醒词开关。 */
function applyEvent(event: ConvEvent): void {
  const prev = convState;
  const next = nextConvState(prev, event);
  if (next === prev && event !== 'reset') {
    if (event === 'speechStart') clearNoSpeechTimer();
    return;
  }
  rlog('info', 'conv.transition', { from: prev, to: next, event });
  convState = next;
  switch (next) {
    case 'idle':
      clearNoSpeechTimer();
      if (recording) stopRecording(false);
      setHeaderState('idle');
      void ensureWakeWord();
      break;
    case 'listening':
      void ensureWakeWordStopped();
      void startRecording();
      armNoSpeechTimer();
      setHeaderState('listening');
      break;
    case 'thinking':
      clearNoSpeechTimer();
      setHeaderState('thinking');
      break;
    case 'speaking':
      clearNoSpeechTimer();
      setHeaderState('speaking');
      break;
  }
}

// ============ TTS 流式播放 ============
let audioCtx: AudioContext | null = null;
let ttsStartTime = 0;

function ensureAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 24000 });
  return audioCtx;
}

// ============ 发起请求 ============
const THINKING_MOODS = [
  '嘴替正在酝酿大招…',
  '脑暴中，稍等…',
  '正在组织嘴炮语言…',
  '灵感来了，马上好！',
];

function runCoach(): void {
  const text = $text.value.trim();
  if (!text) return;
  rlog('info', 'coach.run', { textLen: text.length, withScreenshot: !!$screenshot?.checked });
  $go.disabled = true;
  $output.hidden = true;
  $status.hidden = false;
  $thinkingText.textContent = THINKING_MOODS[Math.floor(Math.random() * THINKING_MOODS.length)];
  setAvatarState('thinking');
  setMood('思考中…');
  const withScreenshot = $screenshot && $screenshot.checked;
  api.runCoach(text, withScreenshot, currentStyle);
}

$go.addEventListener('click', runCoach);
$text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runCoach();
  }
});

// ============ 录音（点一下说话 + VAD 自动停） ============
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let micStream: MediaStream | null = null;
let recording = false;
let analyser: AnalyserNode | null = null;
let vad: VadDetector | null = null;
let vadTimer: ReturnType<typeof setInterval> | null = null;
let vadPendingStart = false;

function setRecordingState(on: boolean): void {
  recording = on;
  if (on) {
    $mic.classList.add('mic-btn--recording');
    $micLabel.textContent = '喷就完了…';
    $voiceState.hidden = false;
    $voiceState.textContent = '听你说…说完自动发';
  } else {
    $mic.classList.remove('mic-btn--recording');
    $micLabel.textContent = '点一下开喷';
  }
}

async function startRecording(): Promise<void> {
  if (recording) return;
  rlog('info', 'mic.start');
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    rlog('info', 'mic.stream.ok', { tracks: micStream.getAudioTracks().length });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(micStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = handleRecordingStop;

    setRecordingState(true);

    // MediaRecorder 一开始就启动，避免 VAD 检测期间丢失开头音频
    mediaRecorder.start();

    const ac = ensureAudioCtx();
    const source = ac.createMediaStreamSource(micStream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    vadPendingStart = false;
    vad = new VadDetector({
      tickMs: 100,
      onStateChange: (state) => {
        rlog('debug', 'vad.state', { state, vadPendingStart });
        if (state === 'speaking' && !vadPendingStart) {
          vadPendingStart = true;
          applyEvent('speechStart');
          $voiceState.textContent = '在说…说完自动停';
        } else if (state === 'silence' && vadPendingStart && recording) {
          $voiceState.textContent = '识别中…';
          stopRecording(true);
          applyEvent('speechEnd');
        }
      },
    });
    vadTimer = setInterval(() => {
      if (!analyser || !vad) return;
      vad.feed(computeRms(analyser));
    }, 100);
  } catch (err) {
    rlog('error', 'mic.start.failed', { msg: err instanceof Error ? err.message : String(err) });
    $voiceState.hidden = false;
    $voiceState.textContent = '麦克风不可用：' + (err instanceof Error ? err.message : String(err));
  }
}

function stopRecording(autoMode = false): void {
  if (!recording) return;
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (vad) { vad = null; }
  if (analyser) { try { analyser.disconnect(); } catch {} analyser = null; }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  setRecordingState(false);
  void autoMode;
}

async function handleRecordingStop(): Promise<void> {
  rlog('info', 'mic.stop', { chunks: audioChunks.length });
  if (audioChunks.length === 0) {
    rlog('warn', 'mic.stop.empty');
    $voiceState.hidden = true;
    return;
  }
  $voiceState.hidden = false;
  $voiceState.textContent = '识别中…';
  try {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    rlog('debug', 'mic.decode', { blobSize: blob.size });
    const arrayBuf = await blob.arrayBuffer();
    const tmpCtx = new AudioContext();
    const audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
    tmpCtx.close();
    const samples = audioBuf.getChannelData(0);
    const wavBuf = encodeWav(samples, audioBuf.sampleRate);
    const base64 = bytesToBase64(new Uint8Array(wavBuf));
    rlog('info', 'mic.sendAsr', { wavBytes: wavBuf.byteLength, sampleRate: audioBuf.sampleRate });
    const withScreenshot = firstTurnPending;
    firstTurnPending = false;
    api.sendRecordedAudio('data:audio/wav;base64,' + base64, withScreenshot, currentStyle);
  } catch (err) {
    rlog('error', 'mic.decode.failed', { msg: err instanceof Error ? err.message : String(err) });
    $voiceState.textContent = '音频处理失败：' + (err instanceof Error ? err.message : String(err));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

$mic.addEventListener('click', () => {
  if (recording) {
    stopRecording(false);
    applyEvent('speechEnd');
  } else if (convState === 'idle' || convState === 'listening') {
    if (convState === 'idle') firstTurnPending = true;
    applyEvent('wake');
  }
});

// ============ IPC 监听 ============

api.onLoading(() => {
  $status.hidden = false;
  $output.hidden = true;
  $screenshotPreview?.setAttribute('hidden', '');
  setAvatarState('thinking');
  setMood('思考中…');
});

// Screenshot preview
api.onScreenshot((dataUrl) => {
  $screenshotImg.src = dataUrl;
  $screenshotPreview.hidden = false;
});

// 流式 reply 蹦字
api.onReplyChunk((primarySoFar) => {
  if ($output.hidden) {
    $status.hidden = true;
    $output.hidden = false;
    $outTitle.hidden = true;
    $outItems.innerHTML = '';
    $outNote.hidden = true;
    setAvatarState('talking');
    setMood('正在输出…');
  }
  renderPrimaryWithCursor(primarySoFar, true);
});

function renderPrimaryWithCursor(text: string, streaming: boolean): void {
  const cursor = $outPrimary.querySelector('.cursor');
  $outPrimary.textContent = text;
  if (streaming && text.length > 0) {
    const c = document.createElement('span');
    c.className = 'cursor';
    $outPrimary.appendChild(c);
  } else if (cursor) {
    cursor.remove();
  }
}

// 字段驱动通用渲染
api.onResult((dto) => {
  $status.hidden = true;
  $voiceState.hidden = true;
  $go.disabled = false;
  $screenshotPreview?.setAttribute('hidden', '');
  setAvatarState('idle');
  setMood('搞定，挑一条发！');

  const plan = buildRenderPlan(dto);
  $outTitle.textContent = plan.titleText;
  $outTitle.hidden = !plan.titleVisible;

  renderPrimaryWithCursor(plan.primaryText, false);

  $outItems.innerHTML = '';
  for (const it of plan.items) {
    const item = document.createElement('div');
    item.className = 'reply-item';
    const tag = it.label ? `<div class="reply-item__tag">${escapeHtml(it.label)}</div>` : '';
    const copy = it.copyable ? '<button class="reply-item__copy">复制</button>' : '';
    item.innerHTML = tag + `<p class="reply-item__text"></p>` + copy;
    (item.querySelector('.reply-item__text') as HTMLElement).textContent = it.text;
    if (it.copyable) bindCopy(item.querySelector('.reply-item__copy') as HTMLButtonElement, it.text);
    $outItems.appendChild(item);
  }

  $outNote.textContent = plan.noteText;
  $outNote.hidden = !plan.noteVisible;

  $output.hidden = false;
});

api.onError((msg) => {
  $status.hidden = true;
  $voiceState.hidden = true;
  $go.disabled = false;
  setAvatarState('idle');
  setMood('啊哦，出错了');
  $outTitle.hidden = true;
  renderPrimaryWithCursor('出错了：' + msg, false);
  $outItems.innerHTML = '';
  $outNote.hidden = true;
  $output.hidden = false;
  applyEvent('turnError');
});

api.onTranscript((text) => {
  $text.value = text;
});

api.onVoiceError((msg) => {
  $voiceState.hidden = false;
  $voiceState.textContent = '语音出错：' + msg;
  setAvatarState('idle');
  applyEvent('turnError');
});

// TTS 流式播放
api.onTtsChunk((base64) => {
  if (!ttsStartTime) { ttsStartTime = audioCtx ? audioCtx.currentTime : 0; applyEvent('ttsStart'); }
  const ctx = ensureAudioCtx();
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer);
  const float = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768;
  const buf = ctx.createBuffer(1, float.length, 24000);
  buf.getChannelData(0).set(float);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(ttsStartTime);
  ttsStartTime += buf.duration;
  $wave.hidden = false;
});

api.onTtsDone(() => {
  ttsStartTime = 0;
  $wave.hidden = true;
  applyEvent('ttsDone');
});

// openWakeWord 停止函数（null = 未启动 / 已停止）
let stopWakeWordFn: (() => Promise<void>) | null = null;

async function ensureWakeWord(): Promise<void> {
  if (!caps_wake || stopWakeWordFn) return;
  try {
    stopWakeWordFn = await initWakeWord(caps_wake, onWakeWordHit);
    rlog('info', 'wakeword.armed');
  } catch (err) {
    rlog('error', 'wakeword.arm.failed', { msg: err instanceof Error ? err.message : String(err) });
  }
}
async function ensureWakeWordStopped(): Promise<void> {
  if (!stopWakeWordFn) return;
  const fn = stopWakeWordFn; stopWakeWordFn = null;
  try { await fn(); } catch {}
}
function onWakeWordHit(): void {
  rlog('info', 'wakeword.hit');
  api.wake();
  firstTurnPending = true;
  applyEvent('wake');
}

// 被唤起 → 聚焦输入 + 进入 listening
api.onActivate(() => {
  rlog('info', 'activate');
  $text.focus();
  if (convState === 'idle') { firstTurnPending = true; applyEvent('wake'); }
});

api.onDeactivate(() => {
  rlog('info', 'deactivate');
  applyEvent('reset');
});

// ============ 启动：查能力 + 初始化本地 openWakeWord ============
void api.capabilities().then(async (caps) => {
  rlog('info', 'caps', { asr: caps.asr, tts: caps.tts, wake: !!caps.wake });
  caps_wake = caps.wake;
  if (caps.wake) {
    void ensureWakeWord();
    $voiceState.hidden = false;
    $voiceState.textContent = '👂 在听 "Jarvis"…（本地离线）';
    setTimeout(() => { $voiceState.hidden = true; }, 2000);
  } else {
    rlog('warn', 'wakeword.disabled', { reason: 'no wake runtime' });
    if ($wakeListen) {
      $wakeListen.disabled = true;
      const label = $wakeListen.closest('label');
      if (label) label.title = '未启用：运行 npm run fetch-models 下载 openWakeWord 模型';
    }
  }
});

// ============ 工具函数 ============
function bindCopy(btn: HTMLButtonElement, text: string): void {
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = '已复制';
    btn.classList.add('reply-item__copy--done');
    setTimeout(() => {
      btn.textContent = old;
      btn.classList.remove('reply-item__copy--done');
    }, 1200);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

$text.focus();

// ============ 设置面板 ============
const $settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const $settingsPanel = document.getElementById('settingsPanel') as HTMLElement;
const $settingsClose = document.getElementById('settingsClose') as HTMLButtonElement;
const $settingDefaultStyle = document.getElementById('settingDefaultStyle') as HTMLSelectElement;
const $settingTts = document.getElementById('settingTts') as HTMLInputElement;
const $settingWakeThreshold = document.getElementById('settingWakeThreshold') as HTMLInputElement;
const $settingModel = document.getElementById('settingModel') as HTMLElement;

$settingsBtn?.addEventListener('click', () => {
  void loadSettings();
  $settingsPanel.hidden = false;
});

$settingsClose?.addEventListener('click', () => {
  $settingsPanel.hidden = true;
});

$settingDefaultStyle?.addEventListener('change', () => {
  void saveSetting('defaultStyle', $settingDefaultStyle.value);
});

$settingTts?.addEventListener('change', () => {
  void saveSetting('ttsEnabled', $settingTts.checked);
});

$settingWakeThreshold?.addEventListener('input', () => {
  void saveSetting('wakeThreshold', Number($settingWakeThreshold.value) / 100);
});

async function loadSettings(): Promise<void> {
  try {
    const settings = await api.getSettings();
    if (settings.defaultStyle && typeof settings.defaultStyle === 'string') {
      $settingDefaultStyle.value = settings.defaultStyle;
      setCurrentStyle(settings.defaultStyle as ReplyStyle);
    }
    if (typeof settings.ttsEnabled === 'boolean') {
      $settingTts.checked = settings.ttsEnabled;
    }
    if (typeof settings.wakeThreshold === 'number') {
      $settingWakeThreshold.value = String(Math.round((settings.wakeThreshold as number) * 100));
    }
  } catch (err) {
    rlog('warn', 'settings.load.failed', { msg: err instanceof Error ? err.message : String(err) });
  }
}

async function saveSetting(key: string, value: unknown): Promise<void> {
  try {
    await api.saveSettings({ [key]: value });
  } catch (err) {
    rlog('warn', 'settings.save.failed', { msg: err instanceof Error ? err.message : String(err) });
  }
}

// Load model name display
void api.capabilities().then(() => {
  $settingModel.textContent = 'MiMo v2.5';
}).catch(() => {});

// ============ 历史记录 ============
const $historyToggle = document.getElementById('historyToggle') as HTMLButtonElement;
const $historyList = document.getElementById('historyList') as HTMLElement;
const $historyEmpty = document.getElementById('historyEmpty') as HTMLElement;
const $historyClear = document.getElementById('historyClear') as HTMLButtonElement;
const $historyCount = document.getElementById('historyCount') as HTMLElement;

$historyToggle?.addEventListener('click', () => {
  const expanded = $historyToggle.getAttribute('aria-expanded') === 'true';
  $historyToggle.setAttribute('aria-expanded', String(!expanded));
  $historyList.hidden = expanded;
  $historyEmpty.hidden = expanded;
  $historyClear.hidden = expanded;
  if (!expanded) void refreshHistory();
});

$historyClear?.addEventListener('click', () => {
  void api.clearHistory().then(() => {
    $historyList.innerHTML = '';
    $historyList.hidden = true;
    $historyEmpty.hidden = false;
    $historyClear.hidden = true;
    $historyCount.textContent = '';
  });
});

async function refreshHistory(): Promise<void> {
  try {
    const entries = await api.getHistory(20) as Array<{
      id: number; ts: number; input: string; output: string; style?: string;
    }>;
    $historyList.innerHTML = '';
    $historyCount.textContent = entries.length > 0 ? String(entries.length) : '';
    $historyEmpty.hidden = entries.length > 0;
    $historyClear.hidden = entries.length === 0;
    $historyList.hidden = entries.length === 0;
    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const time = new Date(entry.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <span class="history-item__time">${time}</span>
        <div class="history-item__content">
          <span class="history-item__input">${escapeHtml(entry.input)}</span>
          <span class="history-item__output">${escapeHtml(entry.output)}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        $text.value = entry.input;
        $text.focus();
      });
      $historyList.appendChild(item);
    }
  } catch {
    // Ignore
  }
}
