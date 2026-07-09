// 生成三个短音效 wav（plan-13 音频反馈）—— 正弦波 + 指数衰减，无依赖。
// 用法：node scripts/gen-sfx.mjs
// 输出：src/renderer/assets/sfx/{wake,listening,tts-done}.wav
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'src', 'renderer', 'assets', 'sfx');
const SAMPLE_RATE = 24000;

/** 生成正弦波 + 指数衰减的 PCM16 单声道采样。 */
function genTone(freq, durationSec, decayRate = 4) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const buf = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-decayRate * t);
    const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
    buf[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }
  return buf;
}

/** PCM16 单声道 → WAV 文件（44 字节头 + 数据）。 */
function writeWav(path, samples) {
  const byteRate = SAMPLE_RATE * 2;
  const blockAlign = 2;
  const dataSize = samples.byteLength;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);        // PCM
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34);       // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(samples.buffer).copy(buf, 44);
  writeFileSync(path, buf);
  console.log('generated', join('src', 'renderer', 'assets', 'sfx', path.split('/').pop()), { bytes: buf.length });
}

mkdirSync(OUT_DIR, { recursive: true });
writeWav(join(OUT_DIR, 'wake.wav'), genTone(880, 0.15, 6));       // 清脆"叮"
writeWav(join(OUT_DIR, 'listening.wav'), genTone(440, 0.10, 8));  // 轻"嘟"
writeWav(join(OUT_DIR, 'tts-done.wav'), genTone(220, 0.20, 4));   // 柔和"咚"
