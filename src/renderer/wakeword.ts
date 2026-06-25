/**
 * 本地"Jarvis"语音唤醒（openWakeWord + WebVoiceProcessor）。
 *
 * 完全本地、不联网、低占用、无需任何 API Key：WebVoiceProcessor 抓麦克风并重采样到 16kHz
 * 分帧，喂给 openWakeWord 引擎；命中唤醒词时回调。模型由主进程读盘后以 base64 下发。
 *
 * 仅在主进程下发了 wake 配置时才初始化，默认不影响热键/托盘触发。
 */
import { WebVoiceProcessor } from '@picovoice/web-voice-processor';
import { OpenWakeWord, type OwwModels } from './openwakeword.js';
import type { WakeRuntime } from '../shared/ipc.js';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 启动唤醒监听；返回停止函数。命中唤醒词时调用 onWake。 */
export async function initWakeWord(cfg: WakeRuntime, onWake: () => void): Promise<() => Promise<void>> {
  const models: OwwModels = {
    mel: b64ToBytes(cfg.melModel),
    emb: b64ToBytes(cfg.embModel),
    ww: b64ToBytes(cfg.wakeModel),
  };
  const engine = await OpenWakeWord.create(models, cfg.threshold, onWake, cfg.debug);
  await WebVoiceProcessor.subscribe(engine);

  return async () => {
    await WebVoiceProcessor.unsubscribe(engine);
  };
}
