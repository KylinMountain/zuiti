// 嘴替 HUD 渲染逻辑 —— 监听 IPC、渲染卡片、点即复制、TTS 播放、点一下说话（VAD 自动停 / 按住 fallback）。
// 通过 window.zuiti（preload 暴露）与主进程通信。
/* global window, document, AudioContext, navigator, MediaRecorder, Blob, DataView, Uint8Array, ArrayBuffer, btoa, AnalyserNode */
'use strict';

import { VadDetector, computeRms } from './vad.js';

const api = window.zuiti;

const $text = document.getElementById('text');
const $go = document.getElementById('go');
const $mic = document.getElementById('mic');
const $micLabel = $mic.querySelector('.hud__mic-label');
const $voiceState = document.getElementById('voiceState');
const $status = document.getElementById('status');
const $result = document.getElementById('result');
const $reply = document.getElementById('reply');
const $candidates = document.getElementById('candidates');
const $rationale = document.getElementById('rationale');
const $screenshot = document.getElementById('screenshot');
const $vadAuto = document.getElementById('vadAuto');
const $wakeListen = document.getElementById('wakeListen');

// TTS 流式播放：用 AudioContext 拼接 pcm16 块，首句先播
let audioCtx = null;
let ttsStartTime = 0;

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 24000 });
  return audioCtx;
}

function runCoach() {
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
let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let recording = false;
let analyser = null;
let vad = null;
let vadTimer = null;
let vadPendingStart = false; // VAD 触发后真正开始录
let pressedHoldMode = false; // 按住说话模式（mousedown→mouseup）

function setRecordingState(on) {
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

async function startRecording() {
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
        onStateChange: (state, info) => {
          if (state === 'speaking' && !vadPendingStart) {
            vadPendingStart = true;
            // 真正开始 MediaRecorder（之前的 buffer 不录，避免环境噪音前导）
            mediaRecorder.start();
            $voiceState.textContent = '在说…说完自动停';
          } else if (state === 'silence' && vadPendingStart && recording) {
            // 说话结束 → 停录音
            $voiceState.textContent = '识别中…';
            stopRecording(true);
          }
        },
      });
      vadTimer = setInterval(() => {
        if (!analyser) return;
        vad.feed(computeRms(analyser));
      }, 100);
    } else {
      // 按住模式：立刻开始录
      mediaRecorder.start();
    }
  } catch (err) {
    $voiceState.hidden = false;
    $voiceState.textContent = '麦克风不可用：' + (err && err.message ? err.message : String(err));
  }
}

function stopRecording(autoMode = false) {
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
  // 按住模式：松手立刻送 ASR；VAD 模式：stopRecording 已被 onStateChange 调用，不再额外动作
  void autoMode;
}

async function handleRecordingStop() {
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
    const wavBytes = encodeWav(audioBuf);
    const base64 = bytesToBase64(wavBytes);
    api.sendRecordedAudio('data:audio/wav;base64,' + base64);
  } catch (err) {
    $voiceState.textContent = '音频处理失败：' + (err && err.message ? err.message : String(err));
  }
}

/** AudioBuffer → pcm16 WAV bytes（单声道，原采样率）。 */
function encodeWav(audioBuf) {
  const numChannels = 1;
  const sampleRate = audioBuf.sampleRate;
  const numSamples = audioBuf.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = audioBuf.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// 点击 mic 按钮：VAD 模式 = 切换开/关；按住模式 = mousedown 开 / mouseup 停
// 但二者都用 click 事件简化：click 时如果没在录，开录；如果在录，停
// 按住 fallback：用 mousedown/touchstart 时按住说话
$mic.addEventListener('click', () => {
  if (recording) {
    // 手动停（用户等不及 VAD）
    stopRecording(false);
  } else {
    startRecording();
  }
});

// 按住 fallback（VAD 关闭时启用）：mousedown 开 / mouseup 停
function shouldUseHoldMode() {
  return !$vadAuto.checked;
}

$mic.addEventListener('mousedown', (e) => {
  if (!shouldUseHoldMode() || recording) return;
  e.preventDefault();
  pressedHoldMode = true;
  startRecording();
});
$mic.addEventListener('touchstart', (e) => {
  if (!shouldUseHoldMode() || recording) return;
  e.preventDefault();
  pressedHoldMode = true;
  startRecording();
}, { passive: false });

function endHold(e) {
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
  // 第一次收到 chunk 时，先显示卡片框架（loading 状态）
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
    card.querySelector('.card__chip').textContent = c.style || '备选';
    card.querySelector('.card__text').textContent = c.text;
    bindCopy(card.querySelector('.card__copy'), c.text);
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
// waked/processing：主进程已自动跑 coach，渲染层只显示
let wakeStream = null;
let wakeAnalyser = null;
let wakeVad = null;
let wakeTimer = null;
let wakeMediaRecorder = null;
let wakeChunks = [];
let wakeListening = false;

async function startWakeListening() {
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
          // 开始录这一段
          wakeChunks = [];
          wakeMediaRecorder = new MediaRecorder(wakeStream);
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
    $voiceState.textContent = '麦克风不可用：' + (err && err.message ? err.message : String(err));
    $wakeListen.checked = false;
  }
}

function stopWakeListening() {
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

async function handleWakeStop() {
  if (wakeChunks.length === 0) return;
  // 临时切状态：识别中
  $voiceState.textContent = '🎧 识别中…';
  try {
    const blob = new Blob(wakeChunks, { type: 'audio/webm' });
    const arrayBuf = await blob.arrayBuffer();
    const tmpCtx = new AudioContext();
    const audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
    tmpCtx.close();
    const wavBytes = encodeWav(audioBuf);
    const base64 = bytesToBase64(wavBytes);
    api.sendWakeAudio('data:audio/wav;base64,' + base64);
    // 等主进程 voice:wakeMiss 或 voice:transcript
  } catch (err) {
    $voiceState.textContent = '音频处理失败：' + (err && err.message ? err.message : String(err));
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
  // 未命中 Jarvis，继续监听
  if (wakeListening) {
    $voiceState.textContent = '👂 耳听八方（喊 Jarvis）…';
  }
});

// onTranscript 已经在前面处理（回填 textarea）；
// 命中 Jarvis 时主进程会自动跑 coach，渲染层在 onResult 时恢复耳听八方状态显示

function bindCopy(btn, text) {
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
