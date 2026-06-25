import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioToDataUrl, buildAsrBody, buildTtsBody, parseDataUrl, mimeToAudioMime } from '../core/voice.js';

test('audioToDataUrl: wav bytes → data URL', () => {
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  const url = audioToDataUrl(bytes, 'audio/wav');
  assert.match(url, /^data:audio\/wav;base64,/);
  assert.ok(url.includes('UklGRg==')); // base64 of RIFF
});

test('parseDataUrl: 反向解析 audioToDataUrl 的输出', () => {
  const orig = new Uint8Array([1, 2, 3, 250, 255, 0, 127]);
  const url = audioToDataUrl(orig, 'audio/wav');
  const { mime, bytes } = parseDataUrl(url);
  assert.equal(mime, 'audio/wav');
  assert.deepEqual(Array.from(bytes), Array.from(orig));
});

test('parseDataUrl: 非 data URL 抛错', () => {
  assert.throws(() => parseDataUrl('https://example.com/a.wav'), /非法 data URL/);
  assert.throws(() => parseDataUrl('data:text/plain,hello'), /非法 data URL/);
});

test('mimeToAudioMime: wav 变体归一', () => {
  assert.equal(mimeToAudioMime('audio/wav'), 'audio/wav');
  assert.equal(mimeToAudioMime('audio/x-wav'), 'audio/wav');
  assert.equal(mimeToAudioMime('audio/wave'), 'audio/wav');
});

test('mimeToAudioMime: mp3/mpeg 归一', () => {
  assert.equal(mimeToAudioMime('audio/mpeg'), 'audio/mp3');
  assert.equal(mimeToAudioMime('audio/mp3'), 'audio/mp3');
});

test('mimeToAudioMime: 未知 mime 回退 wav', () => {
  assert.equal(mimeToAudioMime('audio/webm'), 'audio/wav');
  assert.equal(mimeToAudioMime('audio/ogg'), 'audio/wav');
  assert.equal(mimeToAudioMime('application/octet-stream'), 'audio/wav');
});

test('buildAsrBody: 结构正确（model + input_audio + asr_options）', () => {
  const body = buildAsrBody('data:audio/wav;base64,AAA', 'zh') as {
    model: string;
    messages: { role: string; content: { type: string; input_audio: { data: string } }[] }[];
    asr_options: { language: string };
  };
  assert.equal(body.model, 'mimo-v2.5-asr');
  assert.equal(body.messages[0]?.role, 'user');
  assert.equal(body.messages[0]?.content[0]?.type, 'input_audio');
  assert.equal(body.messages[0]?.content[0]?.input_audio.data, 'data:audio/wav;base64,AAA');
  assert.equal(body.asr_options.language, 'zh');
});

test('buildAsrBody: 默认语种 zh', () => {
  const body = buildAsrBody('data:x') as { asr_options: { language: string } };
  assert.equal(body.asr_options.language, 'zh');
});

test('buildTtsBody: 无风格时文本原样放 assistant content', () => {
  const body = buildTtsBody('你好') as {
    model: string;
    messages: { role: string; content: string }[];
    stream: boolean;
    audio: { format: string; voice: string };
  };
  assert.equal(body.model, 'mimo-v2.5-tts');
  assert.equal(body.messages[0]?.role, 'assistant');
  assert.equal(body.messages[0]?.content, '你好');
  assert.equal(body.stream, true);
  assert.equal(body.audio.format, 'pcm16');
  assert.equal(body.audio.voice, '冰糖');
});

test('buildTtsBody: 有风格时加 (风格) 前缀', () => {
  const body = buildTtsBody('你好', '俏皮') as {
    messages: { content: string }[];
  };
  assert.equal(body.messages[0]?.content, '(俏皮)你好');
});

test('buildTtsBody: 自定义 voice 透传', () => {
  const body = buildTtsBody('你好', undefined, 'Chloe') as {
    audio: { voice: string };
  };
  assert.equal(body.audio.voice, 'Chloe');
});
