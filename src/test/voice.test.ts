import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioToDataUrl, buildAsrBody, buildTtsBody } from '../core/voice.js';

test('audioToDataUrl: wav bytes → data URL', () => {
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  const url = audioToDataUrl(bytes, 'audio/wav');
  assert.match(url, /^data:audio\/wav;base64,/);
  assert.ok(url.includes('UklGRg==')); // base64 of RIFF
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
  };
  assert.equal(body.model, 'mimo-v2.5-tts');
  assert.equal(body.messages[0]?.role, 'assistant');
  assert.equal(body.messages[0]?.content, '你好');
  assert.equal(body.stream, true);
});

test('buildTtsBody: 有风格时加 (风格) 前缀', () => {
  const body = buildTtsBody('你好', '俏皮') as {
    messages: { content: string }[];
  };
  assert.equal(body.messages[0]?.content, '(俏皮)你好');
});
