/**
 * 音效播放（plan-13）—— 内嵌 wav 资源 + Web Audio API 播放。
 * esbuild 把 wav 导入内联为 base64 data URL，fetch + decodeAudioData 缓存 AudioBuffer。
 */
import wakeWav from './assets/sfx/wake.wav';
import listeningWav from './assets/sfx/listening.wav';
import ttsDoneWav from './assets/sfx/tts-done.wav';

export type SfxName = 'wake' | 'listening' | 'ttsDone';

const URLS: Record<SfxName, string> = {
  wake: wakeWav,
  listening: listeningWav,
  ttsDone: ttsDoneWav,
};

const cache = new Map<SfxName, AudioBuffer>();

/** 播放一次音效。volume 0-1。首次播放会 fetch+decode，后续走缓存。 */
export async function playSfx(ctx: AudioContext, name: SfxName, volume = 0.5): Promise<void> {
  let buf = cache.get(name);
  if (!buf) {
    const data = await fetch(URLS[name]).then((r) => r.arrayBuffer());
    buf = await ctx.decodeAudioData(data);
    cache.set(name, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start();
}
