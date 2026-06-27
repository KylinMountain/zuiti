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
import type { Capabilities, UniversalOutput, WakeRuntime } from '../shared/ipc.js';

declare global {
  interface Window {
    zuiti: {
      rlog(level: string, msg: string, extra?: Record<string, unknown>): void;
      capabilities(): Promise<Capabilities>;
      wake(): void;
      runCoach(text: string, withScreenshot?: boolean): void;
      sendRecordedAudio(base64DataUrl: string, withScreenshot?: boolean): void;
      sendWakeAudio(base64DataUrl: string): void;
      onActivate(cb: () => void): void;
      onResult(cb: (dto: UniversalOutput) => void): void;
      onLoading(cb: () => void): void;
      onReplyChunk(cb: (replySoFar: string) => void): void;
      onError(cb: (msg: string) => void): void;
      onTranscript(cb: (text: string) => void): void;
      onVoiceError(cb: (msg: string) => void): void;
      onWakeMiss(cb: (text: string) => void): void;
      onTtsChunk(cb: (base64: string) => void): void;
      onTtsDone(cb: () => void): void;
    };
  }
}

const api = window.zuiti;

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
  api.runCoach(text, withScreenshot);
}

$go.addEventListener('click', runCoach);
$text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runCoach();
  }
});

// ============ 录音（点一下说话 + VAD 自动停 + 按住 fallback） ============
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let micStream: MediaStream | null = null;
let recording = false;
let analyser: AnalyserNode | null = null;
let vad: VadDetector | null = null;
let vadTimer: ReturnType<typeof setInterval> | null = null;
let vadPendingStart = false;
let pressedHoldMode = false;
let wakeTriggeredRecording = false;  // 唤醒触发的录音，完成后走 wakeCheck（带截图）

function setRecordingState(on: boolean): void {
  recording = on;
  if (on) {
    $mic.classList.add('mic-btn--recording');
    $micLabel.textContent = '喷就完了…';
    $voiceState.hidden = false;
    $voiceState.textContent = $vadAuto.checked ? '听你说…说完自动发' : '录音中…';
    setAvatarState('talking');
    setMood('听你说…');
  } else {
    $mic.classList.remove('mic-btn--recording');
    $micLabel.textContent = '点一下开喷';
    if (!$wakeListen.checked) setAvatarState('idle');
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

    if ($vadAuto.checked) {
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
            mediaRecorder?.start();
            rlog('info', 'vad.recording.start');
            $voiceState.textContent = '在说…说完自动停';
          } else if (state === 'silence' && vadPendingStart && recording) {
            rlog('info', 'vad.recording.stop');
            $voiceState.textContent = '识别中…';
            stopRecording(true);
          }
        },
      });
      vadTimer = setInterval(() => {
        if (!analyser || !vad) return;
        vad.feed(computeRms(analyser));
      }, 100);
    } else {
      mediaRecorder.start();
      rlog('info', 'mic.recording.manual');
    }
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
    rlog('info', 'mic.sendAsr', { wavBytes: wavBuf.byteLength, sampleRate: audioBuf.sampleRate, wakeTriggered: wakeTriggeredRecording });
    if (wakeTriggeredRecording) {
      // 唤醒触发的录音：直接 ASR + 带截图看屏（不走 wakeCheck，用户已唤醒无需再检测）
      wakeTriggeredRecording = false;
      api.sendRecordedAudio('data:audio/wav;base64,' + base64, true);
    } else {
      api.sendRecordedAudio('data:audio/wav;base64,' + base64);
    }
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
  } else {
    void startRecording();
  }
});

function shouldUseHoldMode(): boolean {
  return !$vadAuto.checked;
}

$mic.addEventListener('mousedown', (e) => {
  if (!shouldUseHoldMode() || recording) return;
  e.preventDefault();
  pressedHoldMode = true;
  void startRecording();
});
$mic.addEventListener('touchstart', (e) => {
  if (!shouldUseHoldMode() || recording) return;
  e.preventDefault();
  pressedHoldMode = true;
  void startRecording();
}, { passive: false });

function endHold(e: Event): void {
  if (!pressedHoldMode) return;
  e.preventDefault();
  pressedHoldMode = false;
  stopRecording(false);
}
$mic.addEventListener('mouseup', endHold);
$mic.addEventListener('mouseleave', () => {
  if (pressedHoldMode) {
    pressedHoldMode = false;
    stopRecording(false);
  }
});
$mic.addEventListener('touchend', endHold);
$mic.addEventListener('touchcancel', endHold);

// ============ IPC 监听 ============

api.onLoading(() => {
  $status.hidden = false;
  $output.hidden = true;
  setAvatarState('thinking');
  setMood('思考中…');
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
});

api.onTranscript((text) => {
  $text.value = text;
});

api.onVoiceError((msg) => {
  $voiceState.hidden = false;
  $voiceState.textContent = '语音出错：' + msg;
  setAvatarState('idle');
});

// TTS 流式播放
api.onTtsChunk((base64) => {
  if (!ttsStartTime) ttsStartTime = audioCtx ? audioCtx.currentTime : 0;
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

  // TTS 播放时显示波形 + 头像说话态
  $wave.hidden = false;
  setAvatarState('talking');
});

api.onTtsDone(() => {
  ttsStartTime = 0;
  $wave.hidden = true;
  setAvatarState('idle');
  // TTS 完成后重新启动唤醒词监听（之前唤醒时停掉了）
  if (!stopWakeWordFn && caps_wake) {
    rlog('info', 'ttsDone.restartWakeWord');
    void restartWakeWord();
  }
});

// ============ 耳听八方（持续监听 Jarvis） ============
let wakeStream: MediaStream | null = null;
let wakeAnalyser: AnalyserNode | null = null;
let wakeVad: VadDetector | null = null;
let wakeTimer: ReturnType<typeof setInterval> | null = null;
let wakeMediaRecorder: MediaRecorder | null = null;
let wakeChunks: Blob[] = [];
let wakeListening = false;

async function startWakeListening(): Promise<void> {
  if (wakeListening) return;
  rlog('info', 'wakeListen.start');
  try {
    wakeStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    rlog('info', 'wakeListen.stream.ok');
    const ac = ensureAudioCtx();
    const source = ac.createMediaStreamSource(wakeStream);
    wakeAnalyser = ac.createAnalyser();
    wakeAnalyser.fftSize = 1024;
    source.connect(wakeAnalyser);

    wakeListening = true;
    $voiceState.hidden = false;
    $voiceState.textContent = '👂 耳听八方（喊 Jarvis）…';
    setMood('随时待命，喊我就行');

    wakeVad = new VadDetector({
      tickMs: 100,
      triggerMs: 600,
      silenceMs: 1000,
      onStateChange: (state) => {
        if (state === 'speaking' && !wakeMediaRecorder) {
          wakeChunks = [];
          wakeMediaRecorder = new MediaRecorder(wakeStream!);
          wakeMediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) wakeChunks.push(e.data);
          };
          wakeMediaRecorder.onstop = handleWakeStop;
          wakeMediaRecorder.start();
        } else if (state === 'silence' && wakeMediaRecorder && wakeMediaRecorder.state === 'recording') {
          wakeMediaRecorder.stop();
          wakeMediaRecorder = null;
        }
      },
    });
    wakeTimer = setInterval(() => {
      if (!wakeAnalyser || !wakeVad) return;
      wakeVad.feed(computeRms(wakeAnalyser));
    }, 100);
  } catch (err) {
    $voiceState.hidden = false;
    $voiceState.textContent = '麦克风不可用：' + (err instanceof Error ? err.message : String(err));
    $wakeListen.checked = false;
  }
}

function stopWakeListening(): void {
  if (!wakeListening) return;
  if (wakeTimer) { clearInterval(wakeTimer); wakeTimer = null; }
  if (wakeMediaRecorder && wakeMediaRecorder.state === 'recording') {
    try { wakeMediaRecorder.stop(); } catch {}
  }
  wakeMediaRecorder = null;
  if (wakeAnalyser) { try { wakeAnalyser.disconnect(); } catch {} wakeAnalyser = null; }
  if (wakeStream) { wakeStream.getTracks().forEach((t) => t.stop()); wakeStream = null; }
  wakeVad = null;
  wakeListening = false;
  $voiceState.hidden = true;
  setMood('已就位，等你开麦');
}

async function handleWakeStop(): Promise<void> {
  if (wakeChunks.length === 0) return;
  $voiceState.textContent = '🎧 识别中…';
  try {
    const blob = new Blob(wakeChunks, { type: 'audio/webm' });
    const arrayBuf = await blob.arrayBuffer();
    const tmpCtx = new AudioContext();
    const audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
    tmpCtx.close();
    const samples = audioBuf.getChannelData(0);
    const wavBuf = encodeWav(samples, audioBuf.sampleRate);
    const base64 = bytesToBase64(new Uint8Array(wavBuf));
    api.sendWakeAudio('data:audio/wav;base64,' + base64);
  } catch (err) {
    $voiceState.textContent = '音频处理失败：' + (err instanceof Error ? err.message : String(err));
  }
}

$wakeListen.addEventListener('change', () => {
  if ($wakeListen.checked) {
    void startWakeListening();
  } else {
    stopWakeListening();
  }
});

api.onWakeMiss((_text) => {
  if (wakeListening) {
    $voiceState.textContent = '👂 耳听八方（喊 Jarvis）…';
  }
});

// 被唤起 → 聚焦输入 + 自动开始录音（唤醒后直接说话）
api.onActivate(() => {
  rlog('info', 'activate');
  $text.focus();
  // 唤醒后自动开麦，用户直接说话即可
  if (!recording) {
    wakeTriggeredRecording = true;
    void startRecording();
  }
});

// 唤醒词命中时，如果耳听八方开着，先停掉它，避免和录音抢麦克风
let stopWakeWordFn: (() => Promise<void>) | null = null;

/** 重新启动唤醒词监听（TTS 完成后调用，恢复常驻监听）。 */
async function restartWakeWord(): Promise<void> {
  if (!caps_wake || stopWakeWordFn) return;
  try {
    stopWakeWordFn = await initWakeWord(caps_wake, () => {
      rlog('info', 'wakeword.hit');
      origOnWakeHit();
      if (stopWakeWordFn) {
        rlog('info', 'wakeHit.stopOpenWakeWord');
        stopWakeWordFn().catch(() => {});
        stopWakeWordFn = null;
      }
      api.wake();
      $voiceState.hidden = false;
      $voiceState.textContent = '✨ Jarvis 唤醒！';
      setMood('在！说~');
    });
    rlog('info', 'wakeword.restart.ok');
  } catch (err) {
    rlog('error', 'wakeword.restart.failed', { msg: err instanceof Error ? err.message : String(err) });
  }
}

const origOnWakeHit = () => {
  if (wakeListening) {
    rlog('info', 'wakeHit.stopWakeListen');
    stopWakeListening();
  }
};

// ============ 启动：查能力 + 初始化本地 openWakeWord ============
void api.capabilities().then(async (caps) => {
  rlog('info', 'caps', { asr: caps.asr, tts: caps.tts, wake: !!caps.wake });
  caps_wake = caps.wake;
  if (caps.wake) {
    try {
      stopWakeWordFn = await initWakeWord(caps.wake, () => {
        rlog('info', 'wakeword.hit');
        origOnWakeHit();
        if (stopWakeWordFn) {
          rlog('info', 'wakeHit.stopOpenWakeWord');
          stopWakeWordFn().catch(() => {});
          stopWakeWordFn = null;
        }
        api.wake();
        $voiceState.hidden = false;
        $voiceState.textContent = '✨ Jarvis 唤醒！';
        setMood('在！说~');
      });
      rlog('info', 'wakeword.init.ok');
      $voiceState.hidden = false;
      $voiceState.textContent = '👂 在听 "Jarvis"…（本地离线）';
      setTimeout(() => { $voiceState.hidden = true; }, 2000);
    } catch (err) {
      rlog('error', 'wakeword.init.failed', { msg: err instanceof Error ? err.message : String(err) });
      $voiceState.hidden = false;
      $voiceState.textContent = '唤醒词初始化失败：' + (err instanceof Error ? err.message : String(err));
    }
  } else {
    rlog('warn', 'wakeword.disabled', { reason: 'no wake runtime' });
    $wakeListen.disabled = true;
    const label = $wakeListen.closest('label');
    if (label) label.title = '未启用：运行 npm run fetch-models 下载 openWakeWord 模型';
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
