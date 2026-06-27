/**
 * encodeWav 单测（renderer 纯函数，不依赖 DOM）。
 *
 * 验证 WAV 头格式 + PCM 编码正确性。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../renderer/wav.js';

test('encodeWav: 44 字节头 + 数据长度', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const buf = encodeWav(samples, 16000);
  assert.equal(buf.byteLength, 44 + samples.length * 2);
});

test('encodeWav: RIFF/WAVE/fmt /data 标识', () => {
  const buf = encodeWav(new Float32Array([0]), 16000);
  const v = new DataView(buf);
  const str = (off: number, len: number): string =>
    Array.from(new Uint8Array(buf.slice(off, off + len)), (c) => String.fromCharCode(c)).join('');
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(str(12, 4), 'fmt ');
  assert.equal(str(36, 4), 'data');
});

test('encodeWav: PCM 16-bit 单声道格式字段', () => {
  const buf = encodeWav(new Float32Array([0]), 24000);
  const v = new DataView(buf);
  assert.equal(v.getUint16(20, true), 1, '音频格式 = PCM');
  assert.equal(v.getUint16(22, true), 1, '单声道');
  assert.equal(v.getUint32(24, true), 24000, '采样率');
  assert.equal(v.getUint16(34, true), 16, '位深');
});

test('encodeWav: float [-1,1] → int16 钳位', () => {
  const buf = encodeWav(new Float32Array([1, -1, 0, 0.5, -0.5]), 16000);
  const v = new DataView(buf);
  assert.equal(v.getInt16(44, true), 0x7fff, '1.0 → max');
  assert.equal(v.getInt16(46, true), -0x8000, '-1.0 → min');
  assert.equal(v.getInt16(48, true), 0, '0 → 0');
  assert.equal(v.getInt16(50, true), Math.floor(0.5 * 0x7fff), '0.5 → 半');
  assert.equal(v.getInt16(52, true), Math.floor(-0.5 * 0x8000), '-0.5 → 负半');
});

test('encodeWav: 超范围值钳到 [-1,1]', () => {
  const buf = encodeWav(new Float32Array([2, -2]), 16000);
  const v = new DataView(buf);
  assert.equal(v.getInt16(44, true), 0x7fff, '2.0 钳到 max');
  assert.equal(v.getInt16(46, true), -0x8000, '-2.0 钳到 min');
});
