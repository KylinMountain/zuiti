/**
 * 语音 harness —— 小米 MiMo ASR + TTS 客户端封装。
 *
 * API 形态（已查文档）：
 * - ASR：mimo-v2.5-asr，OpenAI chat/completions，音频 base64 data URL 传 input_audio.data
 * - TTS：mimo-v2.5-tts，文本放 role:assistant content，流式输出 pcm16
 *
 * 复用 provider.ts 的 resolveLlmConfig（同一 baseURL + apiKey）。
 * 不引入新依赖。
 */
import { resolveLlmConfig } from './provider.js';
import { log } from './log.js';

const ASR_MODEL = 'mimo-v2.5-asr';
const TTS_MODEL = 'mimo-v2.5-tts';

/** ASR 语种。 */
export type AsrLanguage = 'auto' | 'zh' | 'en';

/** 音频 MIME 类型。 */
export type AudioMime = 'audio/wav' | 'audio/mpeg' | 'audio/mp3';

/** 把音频 bytes 编码成 MiMo ASR 要的 data URL。 */
export function audioToDataUrl(bytes: Uint8Array, mime: AudioMime): string {
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${base64}`;
}

/** 构造 ASR 请求体（纯函数，可单测）。 */
export function buildAsrBody(audioDataUrl: string, language: AsrLanguage = 'zh'): unknown {
  return {
    model: ASR_MODEL,
    messages: [
      {
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: audioDataUrl } }],
      },
    ],
    asr_options: { language },
  };
}

/** 构造 TTS 请求体（纯函数，可单测）。文本放 role:assistant，风格用 (风格) 标签。 */
export function buildTtsBody(text: string, style?: string): unknown {
  const content = style ? `(${style})${text}` : text;
  return {
    model: TTS_MODEL,
    messages: [{ role: 'assistant', content }],
    stream: true,
  };
}

/**
 * 语音识别：音频 bytes → 文本。
 * @param bytes 音频原始字节（wav/mp3）
 * @param mime 音频格式
 * @param language 语种（缺省 zh）
 */
export async function transcribeAudio(
  bytes: Uint8Array,
  mime: AudioMime = 'audio/wav',
  language: AsrLanguage = 'zh',
): Promise<string> {
  const { apiKey, baseURL } = resolveLlmConfig();
  if (!apiKey || !baseURL) throw new Error('ASR 需要 LLM_API_KEY + LLM_BASE_URL');

  const dataUrl = audioToDataUrl(bytes, mime);
  const body = buildAsrBody(dataUrl, language);
  log.info('asr.request', { bytes: bytes.length, language });

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ASR 失败 ${resp.status}: ${errText}`);
  }
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? '';
  log.info('asr.done', { textLen: text.length });
  return text;
}

/**
 * 语音合成（流式）：文本 → pcm16 音频块 async generator。
 * 首句先播：拿到第一个 chunk 即可开始播放，不等整段。
 * @param text 要合成的文本
 * @param style 风格标签（如"温柔"/"俏皮"），可选
 */
export async function* synthesizeSpeechStream(
  text: string,
  style?: string,
): AsyncGenerator<Uint8Array> {
  const { apiKey, baseURL } = resolveLlmConfig();
  if (!apiKey || !baseURL) throw new Error('TTS 需要 LLM_API_KEY + LLM_BASE_URL');

  const body = buildTtsBody(text, style);
  log.info('tts.request', { textLen: text.length, style: style ?? '' });

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const errText = await resp.text();
    throw new Error(`TTS 失败 ${resp.status}: ${errText}`);
  }

  // SSE 流：每行 data: {...}，提取音频 base64 chunk
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const b64 = chunk.choices?.[0]?.delta?.content;
        if (b64) {
          chunkCount++;
          yield Buffer.from(b64, 'base64');
        }
      } catch {
        // 跳过非 JSON 行
      }
    }
  }
  log.info('tts.done', { chunks: chunkCount });
}

/**
 * 语音合成（一次性）：文本 → 完整 pcm16 bytes。
 * 简单场景用；需要首句先播用 synthesizeSpeechStream。
 */
export async function synthesizeSpeech(text: string, style?: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of synthesizeSpeechStream(text, style)) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
