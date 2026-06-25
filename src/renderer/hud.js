// 嘴替 HUD 渲染逻辑 —— 监听 IPC、渲染卡片、点即复制。
// 通过 window.zuiti（preload 暴露）与主进程通信。
/* global window, document */

const api = window.zuiti;

const $text = document.getElementById('text');
const $go = document.getElementById('go');
const $status = document.getElementById('status');
const $result = document.getElementById('result');
const $reply = document.getElementById('reply');
const $candidates = document.getElementById('candidates');
const $rationale = document.getElementById('rationale');

function runCoach() {
  const text = $text.value.trim();
  if (!text) return;
  $go.disabled = true;
  $result.hidden = true;
  $status.hidden = false;
  api.runCoach(text);
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

function bindCopy(btn, text) {
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard 在非聚焦时可能失败，回退 textarea
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

// 唤起时自动聚焦输入框
$text.focus();
