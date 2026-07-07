/** 服务连接自检：各发一个最小请求，归一成 HealthResult。供首次向导 / 设置「测试」/ 状态点用。 */
import { getCredential, getLlmModel, getAsr, getTts } from './runtime-config.js';
import { classifyError, type ErrorKind } from './errors.js';
import { log } from './log.js';

export interface HealthResult {
  service: 'llm' | 'asr' | 'tts';
  ok: boolean;
  httpStatus?: number;
  kind?: ErrorKind;
  message: string;
  latencyMs: number;
}

// 最小静音 WAV（44 字节头 + 0 采样），base64。用于 ASR 自检。
const SILENT_WAV_B64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

async function probe(service: 'llm' | 'asr' | 'tts', body: unknown): Promise<HealthResult> {
  const t0 = Date.now();
  const { apiKey, baseURL } = getCredential();
  if (!apiKey || !baseURL) {
    return { service, ok: false, message: '未配置 API Key / Base URL', latencyMs: 0 };
  }
  try {
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const latencyMs = Date.now() - t0;
    if (resp.ok) return { service, ok: true, httpStatus: resp.status, message: '连接正常', latencyMs };
    const c = classifyError({ httpStatus: resp.status });
    return { service, ok: false, httpStatus: resp.status, kind: c.kind, message: c.userMessage, latencyMs };
  } catch (err) {
    const c = classifyError({ cause: err });
    log.warn('health.probe.error', { service, msg: err instanceof Error ? err.message : String(err) });
    return { service, ok: false, kind: c.kind, message: c.userMessage, latencyMs: Date.now() - t0 };
  }
}

export function checkLlm(): Promise<HealthResult> {
  return probe('llm', { model: getLlmModel(), messages: [{ role: 'user', content: 'ok' }], max_tokens: 4 });
}
export function checkAsr(): Promise<HealthResult> {
  const asr = getAsr();
  return probe('asr', {
    model: asr.model,
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${SILENT_WAV_B64}` } }] }],
    asr_options: { language: asr.lang },
  });
}
export function checkTts(): Promise<HealthResult> {
  const tts = getTts();
  return probe('tts', { model: tts.model, messages: [{ role: 'assistant', content: '好' }], audio: { format: 'pcm16', voice: tts.voice }, stream: false });
}
export function checkAll(): Promise<HealthResult[]> {
  return Promise.all([checkLlm(), checkAsr(), checkTts()]);
}
