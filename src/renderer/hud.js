// 嘴替 HUD 渲染逻辑 —— 监听 IPC、渲染卡片、点即复制、TTS 播放。
// 通过 window.zuiti（preload 暴露）与主进程通信。
/* global window, document, AudioContext */

const api = window.zuiti;

const $text = document.getElementById('text');
const $go = document.getElementById('go');
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

api.onLoading(() => {
  $status.hidden = false;
  $result.hidden = true;
});

api.onResult((dto) => {
  $status.hidden = true;
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
  $go.disabled = false;
  $reply.textContent = '出错了：' + msg;
  $candidates.innerHTML = '';
  $rationale.hidden = true;
  $result.hidden = false;
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
