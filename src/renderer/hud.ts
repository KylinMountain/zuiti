// 嘴替 HUD 渲染逻辑 —— 监听 IPC、渲染卡片、点即复制、TTS 播放、点一下说话（VAD 自动停）。
// 通过 window.zuiti（preload 暴露）与主进程通信。
// esbuild 把本文件打包成 dist/renderer/hud.js（ESM）。
/* global window, document, AudioContext, navigator, MediaRecorder, Blob, DataView, Uint8Array, ArrayBuffer, btoa, AnalyserNode, atob */
'use strict';

import { VadDetector, computeRms } from './vad.js';
import { initWakeWord } from './wakeword.js';
import { encodeWav } from './wav.js';
import type { Capabilities, CoachOutputDTO } from '../shared/ipc.js';

declare global {
  interface Window {
    zuiti: {
      capabilities(): Promise<Capabilities>;
      wake(): void;
      runCoach(text: string, withScreenshot?: boolean): void;
      sendRecordedAudio(base64DataUrl: string): void;
      sendWakeAudio(base64DataUrl: string): void;
      onActivate(cb: () => void): void;
      onResult(cb: (dto: CoachOutputDTO) => void): void;
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

const $text = document.getElementById('text') as HTMLTextAreaElement;
const $go = document.getElementById('go') as HTMLButtonElement;
const $mic = document.getElementById('mic') as HTMLButtonElement;
const $micLabel = $mic.querySelector('.hud__mic-label') as HTMLElement;
const $voiceState = document.getElementById('voiceState') as HTMLElement;
const $status = document.getElementById('status') as HTMLElement;
const $result = document.getElementById('result') as HTMLElement;
const $reply = document.getElementById('reply') as HTMLElement;
const $candidates = document.getElementById('candidates') as HTMLElement;
const $rationale = document.getElementById('rationale') as HTMLElement;
const $screenshot = document.getElementById('screenshot') as HTMLInputElement;
const $vadAuto = document.getElementById('vadAuto') as HTMLInputElement;
const $wakeListen = document.getElementById('wakeListen') as HTMLInputElement;

// TTS 流式播放：用 AudioContext 拼接 pcm16 块，首句先播
let audioCtx: AudioContext | null = null;
let ttsStartTime = 0;

function ensureAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 24000 });
  return audioCtx;
}

function runCoach(): void {
  const text = $text.value.trim();
  if (!text) return;
  $go.disabled = true;
  $result.hidden = true;
  $status.hidden = false;
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

function setRecordingState(on: boolean): void {
  recording = on;
  if (on) {
    $mic.classList.add('hud__mic--recording');
    $micLabel.textContent = '再说一句…';
    $voiceState.hidden = false;
    $voiceState.textContent = $vadAuto.checked ? '听你说…说完自动发' : '录音中…';
  } else {
    $mic.classList.remove('hud__mic--recording');
    $micLabel.textContent = '点一下说话';
  }
}

async function startRecording(): Promise<void> {
  if (recording) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(micStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = handleRecordingStop;

    setRecordingState(true);

    if ($vadAuto.checked) {
      // VAD 自动模式：开 AnalyserNode + VadDetector，先空录等说话
      const ac = ensureAudioCtx();
      const source = ac.createMediaStreamSource(micStream);
      analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      vadPendingStart = false;
      vad = new VadDetector({
        tickMs: 100,
        onStateChange: (state) => {
          if (state === 'speaking' && !vadPendingStart) {
            vadPendingStart = true;
            // 真正开始 MediaRecorder（之前的 buffer 不录，避免环境噪音前导）
            mediaRecorder?.start();
            $voiceState.textContent = '在说…说完自动停';
          } else if (state === 'silence' && vadPendingStart && recording) {
            // 说话结束 → 停录音
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
      // 按住模式：立刻开始录
      mediaRecorder.start();
    }
  } catch (err) {
    $voiceState.hidden = false;
    $voiceState.textContent = '麦克风不可用：' + (err instanceof Error ? err.message : String(err));
  }
}

function stopRecording(autoMode = false): void {
  if (!recording) return;
  // 清 VAD timer
  if (vadTimer) {
    clearInterval(vadTimer);
    vadTimer = null;
  }
  if (vad) {
    vad = null;
  }
  if (analyser) {
    try { analyser.disconnect(); } catch {}
    analyser = null;
  }
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
  if (audioChunks.length === 0) {
    $voiceState.hidden = true;
    return;
  }
  $voiceState.hidden = false;
  $voiceState.textContent = '识别中…';
  try {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const arrayBuf = await blob.arrayBuffer();
    // webm/opus → AudioBuffer（浏览器原生解码）
    const tmpCtx = new AudioContext();
    const audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
    tmpCtx.close();
    // AudioBuffer → WAV (pcm16)
    const samples = audioBuf.getChannelData(0);
    const wavBuf = encodeWav(samples, audioBuf.sampleRate);
    const base64 = bytesToBase64(new Uint8Array(wavBuf));
    api.sendRecordedAudio('data:audio/wav;base64,' + base64);
  } catch (err) {
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

// 点击 mic 按钮：VAD 模式 = 切换开/关；按住模式 = mousedown 开 / mouseup 停
$mic.addEventListener('click', () => {
  if (recording) {
    stopRecording(false);
  } else {
    void startRecording();
  }
});

// 按住 fallback（VAD 关闭时启用）：mousedown 开 / mouseup 停
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
  $result.hidden = true;
});

// 流式 reply 蹦字：边生成边显示，不等整段 JSON 收完
api.onReplyChunk((replySoFar) => {
  if ($result.hidden) {
    $status.hidden = true;
    $result.hidden = false;
    $reply.textContent = '';
    $candidates.innerHTML = '';
    $rationale.hidden = true;
  }
  $reply.textContent = replySoFar;
});

api.onResult((dto) => {
  $status.hidden = true;
  $voiceState.hidden = true;
  $go.disabled = false;

  $reply.textContent = dto.reply;
  $candidates.innerHTML = '';
  for (const c of dto.candidates) {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML =
      '<div class="card__chip"></div>' +
      '<p class="card__text"></p>' +
      '<button class="card__copy">复制</button>';
    (card.querySelector('.card__chip') as HTMLElement).textContent = c.style || '备选';
    (card.querySelector('.card__text') as HTMLElement).textContent = c.text;
    bindCopy(card.querySelector('.card__copy') as HTMLButtonElement, c.text);
    $candidates.appendChild(card);
  }
  $rationale.textContent = dto.rationale || '';
  $rationale.hidden = !dto.rationale;
  $result.hidden = false;
});

api.onError((msg) => {
  $status.hidden = true;
  $voiceState.hidden = true;
  $go.disabled = false;
  $reply.textContent = '出错了：' + msg;
  $candidates.innerHTML = '';
  $rationale.hidden = true;
  $result.hidden = false;
});

api.onTranscript((text) => {
  // ASR 转写回填 textarea（用户能看到听到的是啥，主进程会自动跑 coach）
  $text.value = text;
});

api.onVoiceError((msg) => {
  $voiceState.hidden = false;
  $voiceState.textContent = '语音出错：' + msg;
});

// TTS 流式播放：收到 base64 pcm16 块 → 解码 → 排队播放（首句先播）
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
});

api.onTtsDone(() => {
  ttsStartTime = 0;
});

// ============ 耳听八方（持续监听 Jarvis） ============
// 状态机：off → listening → waked（命中）→ processing → listening
// listening：持续开麦 + VAD 录到一段 → sendWakeAudio → 等 voice:wakeMiss / voice:transcript
let wakeStream: MediaStream | null = null;
let wakeAnalyser: AnalyserNode | null = null;
let wakeVad: VadDetector | null = null;
let wakeTimer: ReturnType<typeof setInterval> | null = null;
let wakeMediaRecorder: MediaRecorder | null = null;
let wakeChunks: Blob[] = [];
let wakeListening = false;

async function startWakeListening(): Promise<void> {
  if (wakeListening) return;
  try {
    wakeStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ac = ensureAudioCtx();
    const source = ac.createMediaStreamSource(wakeStream);
    wakeAnalyser = ac.createAnalyser();
    wakeAnalyser.fftSize = 1024;
    source.connect(wakeAnalyser);

    wakeListening = true;
    $voiceState.hidden = false;
    $voiceState.textContent = '👂 耳听八方（喊 Jarvis）…';

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

// 被唤起（热键/托盘/唤醒词命中）→ 聚焦输入
api.onActivate(() => {
  $text.focus();
});

// ============ 启动：查能力 + 初始化本地 openWakeWord ============
void api.capabilities().then(async (caps) => {
  // openWakeWord 本地唤醒：完全离线、无 Key、不联网
  if (caps.wake) {
    try {
      await initWakeWord(caps.wake, () => {
        // 命中 "Jarvis" → 通知主进程唤起面板（截屏 + 显示 + 聚焦）
        api.wake();
        $voiceState.hidden = false;
        $voiceState.textContent = '✨ Jarvis 唤醒！';
      });
      $voiceState.hidden = false;
      $voiceState.textContent = '👂 在听 "Jarvis"…（本地离线）';
      setTimeout(() => { $voiceState.hidden = true; }, 2000);
    } catch (err) {
      console.error('Wake word init failed:', err);
      $voiceState.hidden = false;
      $voiceState.textContent = '唤醒词初始化失败：' + (err instanceof Error ? err.message : String(err));
    }
  } else {
    // 模型缺失：默认隐藏耳听八方选项，提示用户跑 fetch-models
    $wakeListen.disabled = true;
    const label = $wakeListen.closest('label');
    if (label) label.title = '未启用：运行 npm run fetch-models 下载 openWakeWord 模型';
  }
});

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
    btn.classList.add('card__copy--done');
    setTimeout(() => {
      btn.textContent = old;
      btn.classList.remove('card__copy--done');
    }, 1200);
  });
}

$text.focus();
