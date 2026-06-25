// 嘴替 HUD 渲染逻辑 —— 监听 IPC、渲染卡片、点即复制、TTS 播放、按住说话。
// 通过 window.zuiti（preload 暴露）与主进程通信。
/* global window, document, AudioContext, navigator, MediaRecorder, Blob, DataView, Uint8Array, ArrayBuffer, btoa */
'use strict';

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

// ============ 按住说话（push-to-talk）============
// 流程：mousedown 开麦录音 → mouseup 停止 → webm blob → decodeAudioData → 手写 WAV → base64 → IPC
let mediaRecorder = null;
let audioChunks = [];
let micStream = null;
let recording = false;

function setRecordingState(on) {
  recording = on;
  if (on) {
    $mic.classList.add('hud__mic--recording');
    $micLabel.textContent = '松开发送';
    $voiceState.hidden = false;
    $voiceState.textContent = '录音中…';
  } else {
    $mic.classList.remove('hud__mic--recording');
    $micLabel.textContent = '按住说话';
  }
}

async function startRecording() {
  if (recording) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // MediaRecorder 默认产 audio/webm;codecs=opus，MiMo ASR 要 wav，后面转
    mediaRecorder = new MediaRecorder(micStream);
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start();
    setRecordingState(true);
  } catch (err) {
    $voiceState.hidden = false;
    $voiceState.textContent = '麦克风不可用：' + (err && err.message ? err.message : String(err));
  }
}

function stopRecording() {
  if (!recording) return;
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  setRecordingState(false);
}

async function handleRecordingStop() {
  if (audioChunks.length === 0) return;
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

// 鼠标 + 触摸都要支持
$mic.addEventListener('mousedown', (e) => {
  e.preventDefault();
  startRecording();
});
$mic.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startRecording();
}, { passive: false });

function release(e) {
  e.preventDefault();
  stopRecording();
}
$mic.addEventListener('mouseup', release);
$mic.addEventListener('mouseleave', () => {
  if (recording) stopRecording();
});
$mic.addEventListener('touchend', release);
$mic.addEventListener('touchcancel', release);

// ============ IPC 监听 ============

api.onLoading(() => {
  $status.hidden = false;
  $result.hidden = true;
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
