// 嘴替 HUD 渲染逻辑 —— 赛博霓虹版
// 监听 IPC、渲染对话流气泡、点即复制、TTS 播放、连续对话模式。
// 通过 window.zuiti（preload 暴露）与主进程通信。
// esbuild 把本文件打包成 dist/renderer/hud.js（ESM）。
/* global window, document, AudioContext, navigator, MediaRecorder, Blob, DataView, Uint8Array, ArrayBuffer, btoa, AnalyserNode, atob */
'use strict';

import { VadDetector, computeRms } from './vad.js';
import { initWakeWord } from './wakeword.js';
import { encodeWav } from './wav.js';
import { buildRenderPlan } from '../shared/render-plan.js';
import { REPLY_STYLES, DEFAULT_STYLE, type ReplyStyle } from '../shared/ipc.js';
import type { Capabilities, UniversalOutput, WakeRuntime, ClassifiedErrorDTO, HealthResultDTO, ZuitiConfigDTO, DiagStatsDTO } from '../shared/ipc.js';
import { nextConvState, type ConvState, type ConvEvent } from '../shared/conv-state.js';
import { playSfx } from './sfx.js';
import { renderMarkdown } from './markdown.js';

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
      onError(cb: (err: ClassifiedErrorDTO) => void): void;
      onTranscript(cb: (text: string) => void): void;
      onTtsChunk(cb: (base64: string) => void): void;
      onTtsDone(cb: () => void): void;
      bargeIn(): void;
      getWakeStats(): Promise<{ hits: number; misses: number; recentMissReasons: string[] }>;
      resetWakeStats(): Promise<{ hits: number; misses: number; recentMissReasons: string[] }>;
      getConfig(): Promise<ZuitiConfigDTO>;
      setConfig(patch: Partial<ZuitiConfigDTO>): Promise<ZuitiConfigDTO>;
      testConnection(service: 'llm' | 'asr' | 'tts' | 'all'): Promise<HealthResultDTO[]>;
      onConnectionStatus(cb: (health: HealthResultDTO[]) => void): void;
      getHistory(limit?: number): Promise<unknown[]>;
      clearHistory(): Promise<void>;
      getDiag(): Promise<DiagStatsDTO>;
      openLogs(): void;
      exportDiag(): Promise<string>;
      onCrashNotice(cb: (info: { message: string }) => void): void;
    };
  }
}

const api = window.zuiti;

// ============ 风格状态 ============
let currentStyle: ReplyStyle = DEFAULT_STYLE;

// ============ 音效状态（plan-13） ============
let sfxEnabled = true;
let sfxVolume = 0.5;
let justWoke = false; // wake → listening 时播 listening 音效，bargeIn 后的 listening 不播
let ttsEnabled = true; // TTS 开关（从配置加载）

/** plan-13: 播音效（如果启用）。 */
function maybePlaySfx(name: 'wake' | 'listening' | 'ttsDone'): void {
  if (!sfxEnabled) return;
  try {
    const ctx = ensureAudioCtx();
    void playSfx(ctx, name, sfxVolume).catch((e) => {
      rlog('error', 'sfx.play.failed', { name, msg: e instanceof Error ? e.message : String(e) });
    });
  } catch (e) {
    rlog('error', 'sfx.ctx.failed', { name, msg: e instanceof Error ? e.message : String(e) });
  }
}

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
const $voiceState = document.getElementById('voiceState') as HTMLElement;
const $screenshot = document.getElementById('screenshot') as HTMLInputElement;
const $avatar = document.getElementById('avatar') as HTMLElement;
const $moodText = document.getElementById('moodText') as HTMLElement;
const $wave = document.getElementById('wave') as HTMLElement;
const $topbar = document.querySelector('.topbar') as HTMLElement | null;
const $inputWrap = document.querySelector('.input-wrap') as HTMLElement | null;

const avatarFace = $avatar.querySelector('.avatar') as HTMLElement;

// ============ 对话流 transcript ============
const $transcript = document.getElementById('transcript') as HTMLElement;
const $transcriptEmpty = document.getElementById('transcriptEmpty') as HTMLElement;
let $curAssistantText: HTMLElement | null = null; // 当前流式中的嘴替气泡正文

function hideEmptyState(): void { $transcriptEmpty.hidden = true; }
function scrollToBottom(): void { $transcript.scrollTop = $transcript.scrollHeight; }

function appendUserTurn(text: string): void {
  hideEmptyState();
  const el = document.createElement('div');
  el.className = 'bubble bubble--user';
  el.textContent = text;
  $transcript.appendChild(el);
  scrollToBottom();
}

/** 本轮截图缩略：插到最新用户气泡**前面**（截图在上、文字在下），作为本轮上下文。 */
function appendScreenshotThumb(dataUrl: string): void {
  hideEmptyState();
  rlog('info', 'renderer:screenshot.thumb.append', { dataUrlPrefix: dataUrl.slice(0, 30), len: dataUrl.length });
  const el = document.createElement('div');
  el.className = 'shot-thumb';
  el.dataset.role = 'user-screenshot';
  const img = document.createElement('img');
  img.src = dataUrl; img.alt = '屏幕快照';
  img.onerror = () => {
    rlog('error', 'renderer:screenshot.thumb.loadFailed');
    el.style.borderColor = 'var(--accent-rose)';
  };
  img.onload = () => { rlog('info', 'renderer:screenshot.thumb.loaded', { naturalW: img.naturalWidth, naturalH: img.naturalHeight }); };
  el.appendChild(img);
  // 截图应在用户文字上方：插入到最新用户气泡之前
  const userBubbles = $transcript.querySelectorAll('.bubble--user');
  const lastUser = userBubbles.length > 0 ? userBubbles[userBubbles.length - 1] : null;
  if (lastUser) {
    $transcript.insertBefore(el, lastUser);
  } else {
    $transcript.appendChild(el);
  }
  scrollToBottom();
}

function startAssistantTurn(): void {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'bubble bubble--assistant';
  const body = document.createElement('div');
  body.className = 'bubble__text';
  const cur = document.createElement('span'); cur.className = 'cursor';
  body.appendChild(cur);
  wrap.appendChild(body);
  $transcript.appendChild(wrap);
  $curAssistantText = body;
  scrollToBottom();
}

function updateAssistantStream(primarySoFar: string): void {
  if (!$curAssistantText) startAssistantTurn();
  const body = $curAssistantText!;
  // 流式阶段：用 markdown 实时渲染（末尾光标），让用户立即看到粗体/列表等格式。
  body.innerHTML = renderMarkdown(primarySoFar);
  const c = document.createElement('span'); c.className = 'cursor';
  body.appendChild(c);
  scrollToBottom();
}

/** 收尾本轮：定稿正文 + 候选卡片 + note/title。 */
function finishAssistantTurn(dto: UniversalOutput): void {
  if (!$curAssistantText) startAssistantTurn();
  const wrap = $curAssistantText!.closest('.bubble--assistant') as HTMLElement;
  const plan = buildRenderPlan(dto);
  if (plan.primaryAsLabel) wrap.classList.add('bubble--reply');
  $curAssistantText!.innerHTML = renderMarkdown(plan.primaryText); // 去光标 + Markdown 渲染
  if (plan.titleVisible) {
    const t = document.createElement('div'); t.className = 'bubble__title'; t.textContent = plan.titleText;
    wrap.insertBefore(t, wrap.firstChild);
  }
  if (plan.items.length) {
    const list = document.createElement('div'); list.className = 'reply-list';
    for (const it of plan.items) {
      const item = document.createElement('div'); item.className = 'reply-item';
      if (it.label) { const tag = document.createElement('div'); tag.className = 'reply-item__tag'; tag.textContent = it.label; item.appendChild(tag); }
      const tx = document.createElement('div'); tx.className = 'reply-item__text'; tx.innerHTML = renderMarkdown(it.text); item.appendChild(tx);
      if (it.copyable) { const b = document.createElement('button'); b.className = 'reply-item__copy'; b.textContent = '复制'; bindCopy(b, it.text); item.appendChild(b); }
      list.appendChild(item);
    }
    wrap.appendChild(list);
  }
  if (plan.noteVisible) {
    const n = document.createElement('div'); n.className = 'bubble__note'; n.innerHTML = renderMarkdown(plan.noteText);
    wrap.appendChild(n);
  }
  $curAssistantText = null;
  scrollToBottom();
}

function clearTranscript(): void {
  $transcript.querySelectorAll('.bubble, .shot-thumb').forEach((n) => n.remove());
  $transcriptEmpty.hidden = false;
  $curAssistantText = null;
}

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
let coachRunning = false; // 防并发：runCoach 期间禁止再次触发
let ttsAborted = false; // barge-out/barge-in 后拒绝迟到的 TTS chunk

// ============ 上一轮输入缓存（供重试用） ============
let lastTurn: { text: string; withScreenshot: boolean } | null = null;

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
  // wave 绑定到 speaking 状态：idle/listening/thinking 都不显示
  $wave.hidden = s !== 'speaking';
  if ($topbar) {
    $topbar.classList.remove('topbar--listening', 'topbar--thinking', 'topbar--speaking');
    if (s !== 'idle') $topbar.classList.add(`topbar--${s}`);
  }
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
      if (recording) {
        discardRecording = true; // noSpeechTimeout / reset 等：丢弃录音，不送 ASR，避免孤儿流程
        stopRecording(false);
      }
      setHeaderState('idle');
      $voiceState.hidden = true;
      void ensureWakeWord();
      break;
    case 'listening':
      void ensureWakeWordStopped();
      if (recording) stopRecording(false); // plan-13: 停掉可能的 barge-mode 录音再重开
      void startRecording();
      armNoSpeechTimer();
      setHeaderState('listening');
      if (justWoke) { maybePlaySfx('listening'); justWoke = false; } // plan-13: 开始录音音效（仅 wake 后）
      break;
    case 'thinking':
      clearNoSpeechTimer();
      setHeaderState('thinking');
      break;
    case 'speaking':
      clearNoSpeechTimer();
      setHeaderState('speaking');
      void startRecording({ bargeMode: true }); // plan-13: 偷偷开麦做 barge-in 检测
      break;
  }
}

// ============ TTS 流式播放 ============
let audioCtx: AudioContext | null = null;
let ttsStartTime = 0;
/** plan-13: 活跃 TTS 音频源集合，用于 barge-in 时 stopAllTts() 立即停播。 */
const activeTtsSources: Set<AudioBufferSourceNode> = new Set();

function ensureAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 24000 });
  return audioCtx;
}

/** plan-13: 停掉所有正在播的 TTS 音频源 + 重置排期时间 + 拒绝迟到的 chunk。 */
function stopAllTts(): void {
  ttsAborted = true;
  for (const s of activeTtsSources) {
    try { s.stop(); } catch { /* already ended */ }
  }
  activeTtsSources.clear();
  ttsStartTime = 0;
  if (ttsDoneTimer) { clearTimeout(ttsDoneTimer); ttsDoneTimer = null; }
}

// ============ 发起请求 ============
function runCoach(): void {
  const text = $text.value.trim();
  if (!text || coachRunning) return;
  rlog('info', 'coach.run', { textLen: text.length, withScreenshot: !!$screenshot?.checked });
  coachRunning = true;
  $go.disabled = true;
  appendUserTurn(text);
  $text.value = '';
  updateTextareaHeight();
  const withScreenshot = ($screenshot && $screenshot.checked) || firstTurnPending;
  if (withScreenshot) firstTurnPending = false;
  lastTurn = { text, withScreenshot };
  api.runCoach(text, withScreenshot, currentStyle);
}

$go.addEventListener('click', runCoach);
$text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (e.shiftKey) {
      // Shift+Enter 换行：textarea 默认行为
      return;
    }
    e.preventDefault();
    runCoach();
  }
});
function updateTextareaHeight(): void {
  // auto-grow textarea: 1-5 行
  $text.style.height = 'auto';
  const maxH = 120;
  const nextH = Math.min($text.scrollHeight, maxH);
  $text.style.height = `${nextH}px`;
}

$text.addEventListener('input', () => {
  updateTextareaHeight();
  // 处理期间不重新启用按钮，防止并发
  if (!coachRunning) $go.disabled = $text.value.trim().length === 0;
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
let vadStatBucket = 0; // plan-13 诊断：VAD RMS 日志去重桶
let discardRecording = false;

/** plan-13: barge-in 检测用更高阈值 + 更长触发时间，抗喇叭回声。 */
const BARGE_VAD_OPTS = {
  triggerThreshold: 0.12,
  silenceThreshold: 0.04,
  triggerMs: 800,
  silenceMs: 1200,
  tickMs: 100,
};

function setRecordingState(on: boolean): void {
  recording = on;
  if (on) {
    $mic.classList.add('mic-btn--recording');
    $inputWrap?.classList.add('input-wrap--recording');
    $voiceState.hidden = false;
    $voiceState.textContent = '听你说…说完自动发';
  } else {
    $mic.classList.remove('mic-btn--recording');
    $inputWrap?.classList.remove('input-wrap--recording');
    // voiceState hidden is managed by applyEvent('idle') or stays until ASR resolves
  }
}

async function startRecording(opts?: { bargeMode?: boolean }): Promise<void> {
  if (recording) return;
  const bargeMode = opts?.bargeMode ?? false;
  rlog('info', 'mic.start', { bargeMode });
  if (bargeMode) discardRecording = true; // barge-mode 录音纯做 VAD，不送 ASR
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

    if (bargeMode) {
      recording = true; // barge-mode 不改 UI（用户不应感知到偷偷开麦）
    } else {
      setRecordingState(true);
    }

    // MediaRecorder 一开始就启动，避免 VAD 检测期间丢失开头音频
    mediaRecorder.start();

    const ac = ensureAudioCtx();
    const source = ac.createMediaStreamSource(micStream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    vadPendingStart = false;
    vad = new VadDetector({
      ...(bargeMode ? BARGE_VAD_OPTS : { tickMs: 100 }),
      onStateChange: (state) => {
        rlog('debug', 'vad.state', { state, vadPendingStart, bargeMode });
        if (bargeMode) {
          // plan-13: barge-in 检测——speaking → 打断 TTS 抢麦
          if (state === 'speaking') {
            rlog('info', 'bargeIn.detected');
            stopAllTts();
            api.bargeIn();
            stopRecording(false); // 停 barge-mode 录音（discard，不送 ASR）
            applyEvent('bargeIn'); // speaking → listening → 重新开正常麦
          }
        } else {
          if (state === 'speaking' && !vadPendingStart) {
            vadPendingStart = true;
            applyEvent('speechStart');
            $voiceState.textContent = '在说…说完自动停';
          } else if (state === 'silence' && vadPendingStart && recording) {
            $voiceState.textContent = '识别中…';
            stopRecording(true);
            applyEvent('speechEnd');
          }
        }
      },
    });
    vadTimer = setInterval(() => {
      if (!analyser || !vad) return;
      const rms = computeRms(analyser);
      // plan-13 诊断：每 ~2s 记一次 RMS，定位 VAD 是否收到声音
      if (Math.floor(Date.now() / 2000) !== vadStatBucket) {
        vadStatBucket = Math.floor(Date.now() / 2000);
        rlog('info', 'vad.rms', { rms: Number(rms.toFixed(4)), thr: 0.05, state: convState, bargeMode });
      }
      vad.feed(rms);
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
  if (discardRecording) {
    discardRecording = false;
    audioChunks = [];
    rlog('info', 'mic.discard');
    return;
  }
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
    const withScreenshot = ($screenshot && $screenshot.checked) || firstTurnPending;
    if (withScreenshot) firstTurnPending = false;
    lastTurn = { text: '', withScreenshot }; // text will be filled by onTranscript
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

// plan-13: 点头像打断 TTS（barge-out），回 idle 不接话。
$avatar.addEventListener('click', () => {
  if (convState === 'speaking') {
    stopAllTts();
    api.bargeIn();
    applyEvent('bargeOut');
  }
});

// ============ 新对话 / 收起 按钮 ============
const $newConvBtn = document.getElementById('newConvBtn') as HTMLButtonElement;
const $collapseBtn = document.getElementById('collapseBtn') as HTMLButtonElement;

$newConvBtn?.addEventListener('click', () => {
  stopAllTts();
  api.resetConversation();
  clearTranscript();
  firstTurnPending = true;
  coachRunning = false;
  $go.disabled = $text.value.trim().length === 0;
});

$collapseBtn?.addEventListener('click', () => { api.hidePanel(); });

// ============ IPC 监听 ============

api.onTranscript((text) => {
  appendUserTurn(text);
  // Update lastTurn text for voice turns (withScreenshot was set at sendRecordedAudio time)
  if (lastTurn && lastTurn.text === '') lastTurn = { text, withScreenshot: lastTurn.withScreenshot };
});

api.onScreenshot((dataUrl) => { appendScreenshotThumb(dataUrl); });

api.onLoading(() => {
  ttsAborted = false; // 新轮次开始，重置 TTS 拒绝标志
  if (convState === 'listening') {
    discardRecording = true;
    stopRecording(false);     // 关麦但因 discardRecording 不会送 ASR
    applyEvent('speechEnd');  // listening → thinking
  } else if (convState === 'speaking') {
    // TTS 播放中用户新发了一轮：停掉当前 TTS，转 thinking
    stopAllTts();
    applyEvent('bargeIn'); // speaking → listening
    applyEvent('speechEnd'); // listening → thinking
  }
  startAssistantTurn();
});

api.onReplyChunk((primarySoFar) => { updateAssistantStream(primarySoFar); });

let autoRetriedFor: string | null = null; // 防止无限自动重试（按 userMessage 去重）

api.onResult((dto) => {
  finishAssistantTurn(dto);
  coachRunning = false;
  $go.disabled = $text.value.trim().length === 0;
  $voiceState.hidden = true;
  autoRetriedFor = null; // 成功一轮，重置自动重试去重
});

api.onError((err) => {
  coachRunning = false;
  // 清理 onLoading 建的 assistant 占位气泡——不管是空的还是已经蹦了几个字（如 modelStuck
  // 复读中止：中止前已经把"给你三个回法：给你三个回法："蹦进气泡了），失败轮的内容不可信，
  // 都不能留在对话流里；重试成功会另起一条新气泡。
  if ($curAssistantText) {
    $curAssistantText.closest('.bubble--assistant')?.remove();
    $curAssistantText = null;
  }
  // 瞬时错（network/server）自动重试一次
  if (err.retryable && lastTurn && lastTurn.text && autoRetriedFor !== err.userMessage) {
    autoRetriedFor = err.userMessage;
    rlog('info', 'coach.autoRetry', { kind: err.kind });
    coachRunning = true;
    setTimeout(() => { if (lastTurn) api.runCoach(lastTurn.text, lastTurn.withScreenshot, currentStyle); }, 800);
    return;
  }
  autoRetriedFor = null;
  $go.disabled = $text.value.trim().length === 0;
  $voiceState.hidden = true;
  renderErrorBubble(err);
  applyEvent('turnError');
});

function renderErrorBubble(err: ClassifiedErrorDTO): void {
  hideEmptyState();
  const wrap = document.createElement('div');
  wrap.className = 'bubble bubble--error';
  const p = document.createElement('p'); p.className = 'bubble__text'; p.textContent = err.userMessage; wrap.appendChild(p);
  const actions = document.createElement('div'); actions.className = 'bubble__actions';
  if (err.fixAction === 'openSettings') {
    const b = document.createElement('button'); b.className = 'bubble__fix'; b.textContent = '去设置';
    b.addEventListener('click', () => { $settingsPanel.hidden = false; void loadSettingsUI(); });
    actions.appendChild(b);
  }
  if (lastTurn) {
    const r = document.createElement('button'); r.className = 'bubble__retry'; r.textContent = '重试';
    r.addEventListener('click', () => { autoRetriedFor = null; api.runCoach(lastTurn!.text, lastTurn!.withScreenshot, currentStyle); });
    actions.appendChild(r);
  }
  wrap.appendChild(actions);
  $transcript.appendChild(wrap);
  scrollToBottom();
}

// TTS 流式播放
api.onTtsChunk((base64) => {
  if (ttsAborted || !ttsEnabled) return; // TTS 关闭或 barge-out 后拒绝 chunk
  try {
    const ctx = ensureAudioCtx();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    // 奇数字节数会破坏 Int16Array 对齐：截掉最后一个半样本
    const aligned = bytes.length % 2 !== 0 ? bytes.subarray(0, bytes.length - 1) : bytes;
    const pcm = new Int16Array(aligned.buffer);
    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768;
    const buf = ctx.createBuffer(1, float.length, 24000);
    buf.getChannelData(0).set(float);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    // plan-13: 跟踪活跃源，barge-in 时 stopAllTts() 能立即停。
    activeTtsSources.add(src);
    src.onended = () => { activeTtsSources.delete(src); };
    // 严格背靠背排期：从 max(已排到, 现在) 开始，绝不排进过去 → 几段 TTS（首句+剩余/多轮）不会重叠（一起读）。
    const startAt = Math.max(ttsStartTime, ctx.currentTime);
    src.start(startAt);
    ttsStartTime = startAt + buf.duration;
    if (convState === 'thinking') applyEvent('ttsStart'); // 首个音频块 → speaking
  } catch (err) {
    rlog('error', 'tts.chunk.decode.failed', { msg: err instanceof Error ? err.message : String(err) });
  }
});

let ttsDoneTimer: ReturnType<typeof setTimeout> | null = null;
api.onTtsDone(() => {
  // 本轮 TTS 已全部合成入队；等已排期的音频真正播完再回流（重开麦），否则会在还在说话时开麦（自己听自己）。
  const ctx = audioCtx;
  const waitMs = ctx ? Math.max(0, (ttsStartTime - ctx.currentTime) * 1000) : 0;
  if (ttsDoneTimer) clearTimeout(ttsDoneTimer);
  ttsDoneTimer = setTimeout(() => {
    ttsDoneTimer = null;
    ttsStartTime = 0;
    if (ttsAborted) return; // barge-out 后不播结束音效，不触发状态转换
    applyEvent('ttsDone');
    maybePlaySfx('ttsDone'); // plan-13: TTS 自然播完音效（barge-in 路径不触发 onTtsDone）
  }, waitMs);
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
  try {
    maybePlaySfx('wake'); // plan-13: 唤醒命中音效
  } catch (e) {
    rlog('error', 'wakeword.sfx.failed', { msg: e instanceof Error ? e.message : String(e) });
  }
  justWoke = true;
  rlog('info', 'wakeword.hit.apiWake');
  api.wake();
  rlog('info', 'wakeword.hit.applyEvent');
  firstTurnPending = true;
  applyEvent('wake');
  rlog('info', 'wakeword.hit.done');
}

// 被唤起 → 聚焦输入 + 进入 listening
api.onActivate(() => {
  rlog('info', 'activate');
  $text.focus();
  if (convState === 'idle') { firstTurnPending = true; applyEvent('wake'); }
});

api.onDeactivate(() => {
  rlog('info', 'deactivate');
  stopAllTts();
  if (ttsDoneTimer) { clearTimeout(ttsDoneTimer); ttsDoneTimer = null; }
  applyEvent('reset');
});

// ============ 启动：查能力 + 初始化本地 openWakeWord ============
void api.capabilities().then(async (caps) => {
  rlog('info', 'caps', { asr: caps.asr, tts: caps.tts, wake: !!caps.wake, configured: caps.configured });
  caps_wake = caps.wake;
  if (caps.wake) {
    void ensureWakeWord();
    $voiceState.hidden = false;
    $voiceState.textContent = '👂 在听 "Jarvis"…（本地离线）';
    setTimeout(() => { $voiceState.hidden = true; }, 2000);
  } else {
    rlog('warn', 'wakeword.disabled', { reason: 'no wake runtime' });
  }
  if (!caps.configured) showOnboarding();
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

$text.focus();

// ============ 设置面板 ============
const $ = (id: string): HTMLElement | null => document.getElementById(id);

// ============ 首次向导 ============
const $onboarding = $('onboarding')!;

function showOnboarding(): void {
  $onboarding.removeAttribute('hidden');
  void prefillOnboarding();
}

function hideOnboarding(): void {
  $onboarding.setAttribute('hidden', '');
}

async function prefillOnboarding(): Promise<void> {
  const c = await api.getConfig();
  ($('obApiKey') as HTMLInputElement).value = c.credential.apiKey ?? '';
  ($('obBaseUrl') as HTMLInputElement).value = c.credential.baseURL ?? 'https://token-plan-cn.xiaomimimo.com/v1';
}

$('obTest')?.addEventListener('click', async () => {
  await api.setConfig({ credential: {
    apiKey: ($('obApiKey') as HTMLInputElement).value.trim() || undefined,
    baseURL: ($('obBaseUrl') as HTMLInputElement).value.trim() || undefined,
  }});
  const el = $('obResult')!;
  el.textContent = '测试中…';
  try {
    const results = await api.testConnection('llm');
    const r = results[0];
    if (!r) { el.textContent = '❌ 无响应'; return; }
    el.textContent = r.ok ? '✅ 连接正常' : '❌ ' + r.message;
    ($('obDone') as HTMLButtonElement).disabled = !r.ok;
  } catch {
    el.textContent = '❌ 请求失败';
  }
});

$('obDone')?.addEventListener('click', hideOnboarding);
$('obSkip')?.addEventListener('click', hideOnboarding);

const $settingsBtn = $('settingsBtn') as HTMLButtonElement;
const $settingsPanel = $('settingsPanel') as HTMLElement;
const $settingsClose = $('settingsClose') as HTMLButtonElement;

const $settingDefaultStyle = $('settingDefaultStyle') as HTMLSelectElement;
const $settingTts = $('settingTts') as HTMLInputElement;
const $settingWakeThreshold = $('settingWakeThreshold') as HTMLInputElement;
const $settingSfx = $('settingSfx') as HTMLInputElement;
const $settingSfxVolume = $('settingSfxVolume') as HTMLInputElement;

$settingsBtn?.addEventListener('click', () => {
  void loadSettingsUI();
  void loadDiag();
  $settingsPanel.hidden = false;
});

$settingsClose?.addEventListener('click', () => {
  $settingsPanel.hidden = true;
});

async function loadSettingsUI(): Promise<void> {
  try {
    const c = await api.getConfig();
    ($('cfgApiKey') as HTMLInputElement).value = c.credential.apiKey ?? '';
    ($('cfgBaseUrl') as HTMLInputElement).value = c.credential.baseURL ?? '';
    ($('cfgLlmModel') as HTMLInputElement).value = c.llm.model ?? '';
    ($('cfgAsrModel') as HTMLInputElement).value = c.asr.model ?? '';
    ($('cfgTtsModel') as HTMLInputElement).value = c.tts.model ?? '';
    ($('cfgTtsVoice') as HTMLInputElement).value = c.tts.voice ?? '';
    const rawStyle = c.ui.defaultStyle ?? DEFAULT_STYLE;
    const validStyle = REPLY_STYLES.some((s) => s.id === rawStyle) ? (rawStyle as ReplyStyle) : DEFAULT_STYLE;
    $settingDefaultStyle.value = validStyle;
    setCurrentStyle(validStyle);
    $settingTts.checked = c.ui.ttsEnabled ?? true;
    ttsEnabled = $settingTts.checked;
    // plan-13: 音效配置
    sfxEnabled = c.ui.sfxEnabled ?? true;
    sfxVolume = typeof c.ui.sfxVolume === 'number' ? c.ui.sfxVolume : 0.5;
    $settingSfx.checked = sfxEnabled;
    $settingSfxVolume.value = String(Math.round(sfxVolume * 100));
    if (typeof c.advanced.wakeThreshold === 'number') {
      $settingWakeThreshold.value = String(Math.round(c.advanced.wakeThreshold * 100));
    }
    void loadWakeStats(); // plan-13: 加载唤醒统计
  } catch (err) {
    rlog('warn', 'settings.load.failed', { msg: err instanceof Error ? err.message : String(err) });
  }
}

// 凭证
$('cfgApiKey')?.addEventListener('change', (e) => {
  void api.setConfig({ credential: { apiKey: (e.target as HTMLInputElement).value.trim() || undefined } });
});
$('cfgBaseUrl')?.addEventListener('change', (e) => {
  void api.setConfig({ credential: { baseURL: (e.target as HTMLInputElement).value.trim() || undefined } });
});

// 模型
$('cfgLlmModel')?.addEventListener('change', (e) => {
  void api.setConfig({ llm: { model: (e.target as HTMLInputElement).value.trim() || undefined } });
});
$('cfgAsrModel')?.addEventListener('change', (e) => {
  void api.setConfig({ asr: { model: (e.target as HTMLInputElement).value.trim() || undefined } });
});
$('cfgTtsModel')?.addEventListener('change', (e) => {
  void api.setConfig({ tts: { model: (e.target as HTMLInputElement).value.trim() || undefined } });
});
$('cfgTtsVoice')?.addEventListener('change', (e) => {
  void api.setConfig({ tts: { voice: (e.target as HTMLInputElement).value.trim() || undefined } });
});

// 偏好
$settingDefaultStyle?.addEventListener('change', () => {
  setCurrentStyle($settingDefaultStyle.value as ReplyStyle);
  void api.setConfig({ ui: { defaultStyle: $settingDefaultStyle.value } });
});
$settingTts?.addEventListener('change', () => {
  ttsEnabled = $settingTts.checked;
  void api.setConfig({ ui: { ttsEnabled } });
});
// plan-13: 音效开关 / 音量
$settingSfx?.addEventListener('change', () => {
  sfxEnabled = $settingSfx.checked;
  void api.setConfig({ ui: { sfxEnabled } });
});
$settingSfxVolume?.addEventListener('input', () => {
  sfxVolume = Number($settingSfxVolume.value) / 100;
  void api.setConfig({ ui: { sfxVolume } });
});
$settingWakeThreshold?.addEventListener('input', () => {
  void api.setConfig({ advanced: { wakeThreshold: Number($settingWakeThreshold.value) / 100 } });
});

// plan-13: 唤醒词误触发统计
async function loadWakeStats(): Promise<void> {
  try {
    const s = await api.getWakeStats() as { hits: number; misses: number; recentMissReasons: string[] };
    const total = s.hits + s.misses;
    const rate = total === 0 ? 0 : Math.round((s.misses / total) * 100);
    const el = $('wakeStatsText');
    if (!el) return;
    el.textContent = `命中 ${s.hits} / 误触 ${s.misses}（${rate}%）`;
    el.classList.toggle('settings-item__hint--warn', rate >= 30 && total >= 5);
  } catch { /* ignore */ }
}
$('wakeStatsReset')?.addEventListener('click', async () => {
  await api.resetWakeStats();
  void loadWakeStats();
});

async function loadDiag(): Promise<void> {
  try {
    const s = await api.getDiag();
    const skills = Object.entries(s.skillCounts).map(([k, v]) => `${k}:${v}`).join(' ') || '—';
    ($('diagStats') as HTMLElement).textContent =
      `最近 ${s.total} 轮 · 延迟 p50 ${s.latencyP50}ms / 均 ${s.latencyAvg}ms · 错误 ${s.errorCount} · ${skills}`;
  } catch { ($('diagStats') as HTMLElement).textContent = '诊断读取失败'; }
}

$('openLogs')?.addEventListener('click', () => api.openLogs());
$('exportDiag')?.addEventListener('click', async () => {
  const el = $('exportResult') as HTMLElement; el.textContent = '导出中…';
  try { const p = await api.exportDiag(); el.textContent = '已导出：' + p.split('/').pop(); }
  catch { el.textContent = '导出失败'; }
});

api.onCrashNotice((info) => {
  const bar = $('crashNotice') as HTMLElement;
  ($('crashNoticeText') as HTMLElement).textContent = info.message;
  bar.hidden = false;
});
$('crashNoticeClose')?.addEventListener('click', () => { ($('crashNotice') as HTMLElement).hidden = true; });

// 测试连接
$('testLlm')?.addEventListener('click', async () => {
  const el = $('testLlmResult')!;
  el.textContent = '测试中…';
  try {
    const results = await api.testConnection('llm');
    const r = results[0];
    if (!r) { el.textContent = '❌ 无响应'; return; }
    el.textContent = r.ok ? '✅ 连接正常' : '❌ ' + r.message;
  } catch (err) {
    el.textContent = '❌ ' + (err instanceof Error ? err.message : String(err));
  }
});

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ 应用内快捷键 ============
const $shortcutPanel = document.getElementById('shortcutPanel') as HTMLElement | null;

function isTypingInInput(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function openShortcutPanel(): void {
  $shortcutPanel?.removeAttribute('hidden');
}
function closeShortcutPanel(): void {
  $shortcutPanel?.setAttribute('hidden', '');
}
function toggleShortcutPanel(): void {
  if (!$shortcutPanel) return;
  if ($shortcutPanel.hasAttribute('hidden')) openShortcutPanel();
  else closeShortcutPanel();
}

/** 复制最近一条嘴替主打回复（对话流里最后一个 assistant 气泡的正文）。无内容时静默忽略。 */
function copyLastPrimary(): void {
  const bubbles = document.querySelectorAll('.bubble--assistant .bubble__text');
  const last = bubbles[bubbles.length - 1] as HTMLElement | undefined;
  const text = last?.textContent?.trim();
  if (!text) return;
  void navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

/** 等价于点击「新对话」：结束当前保活会话 + 清空对话流。 */
function startNewConversationViaShortcut(): void {
  stopAllTts();
  api.resetConversation();
  clearTranscript();
  firstTurnPending = true;
  coachRunning = false;
  $go.disabled = $text.value.trim().length === 0;
}

/** 循环切到 REPLY_STYLES 里的下一个风格，并持久化到配置。 */
function cycleToNextStyle(): void {
  const idx = REPLY_STYLES.findIndex((s) => s.id === currentStyle);
  const next = REPLY_STYLES[(idx + 1) % REPLY_STYLES.length]!.id;
  setCurrentStyle(next);
  void api.setConfig({ ui: { defaultStyle: next } });
}

document.addEventListener('keydown', (e) => {
  // "?" 打开/关闭快捷键面板：仅在非输入焦点时触发（避免打字时问号被吞）。
  if (e.key === '?' && !isTypingInInput()) {
    e.preventDefault();
    toggleShortcutPanel();
    return;
  }
  if (e.key === 'Escape' && $shortcutPanel && !$shortcutPanel.hasAttribute('hidden')) {
    closeShortcutPanel();
    return;
  }
  // 其余快捷键在输入框聚焦时不触发。
  if (isTypingInInput()) return;

  // plan-13: Esc 打断 TTS（barge-out），回 idle 不接话。
  if (e.key === 'Escape' && convState === 'speaking') {
    e.preventDefault();
    stopAllTts();
    api.bargeIn();
    applyEvent('bargeOut');
    return;
  }

  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    copyLastPrimary();
  } else if (!e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    startNewConversationViaShortcut();
  } else if (!e.shiftKey && e.key === '.') {
    e.preventDefault();
    cycleToNextStyle();
  }
});

$('shortcutPanelClose')?.addEventListener('click', closeShortcutPanel);
