import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplyExtractor, stripMarkdownFence } from '../core/streamparse.js';

test('ReplyExtractor: 整段一次喂入，抽出 reply', () => {
  const ex = new ReplyExtractor();
  ex.push('{"reply":"在的，正想你呢","candidates":[]}');
  assert.equal(ex.replyText, '在的，正想你呢');
  assert.equal(ex.replyDone, true);
});

test('ReplyExtractor: 分块流式，reply 增量流出', () => {
  const ex = new ReplyExtractor();
  assert.equal(ex.push('{"rep'), '');
  assert.equal(ex.push('ly":"在'), '在');
  assert.equal(ex.push('的，正想你'), '在的，正想你');
  assert.equal(ex.push('呢","candidates":[]}'), '在的，正想你呢');
  assert.equal(ex.replyDone, true);
});

test('ReplyExtractor: reply 在 candidates 之前流出（不变量）', () => {
  // reply 是第一键，candidates 还没到时 reply 已能完整抽出
  const ex = new ReplyExtractor();
  ex.push('{"reply":"完整回复","candidates":[');
  assert.equal(ex.replyText, '完整回复');
  assert.equal(ex.replyDone, true);
});

test('ReplyExtractor: 处理转义字符', () => {
  const ex = new ReplyExtractor();
  ex.push('{"reply":"带\\n换行\\\"引号\\\\反斜杠","candidates":[]}');
  assert.equal(ex.replyText, '带\n换行"引号\\反斜杠');
});

test('ReplyExtractor: 还没到 reply 键时返回空', () => {
  const ex = new ReplyExtractor();
  assert.equal(ex.push('{"oth'), '');
  assert.equal(ex.replyText, '');
  assert.equal(ex.replyDone, false);
});

test('stripMarkdownFence: ```json 围栏 → 内部 JSON', () => {
  const raw = '```json\n{"reply":"hi","candidates":[]}\n```';
  assert.equal(stripMarkdownFence(raw), '{"reply":"hi","candidates":[]}');
});

test('stripMarkdownFence: ``` 围栏（无 json 标签）→ 内部 JSON', () => {
  const raw = '```\n{"reply":"hi"}\n```';
  assert.equal(stripMarkdownFence(raw), '{"reply":"hi"}');
});

test('stripMarkdownFence: 无围栏 → 原样返回', () => {
  const raw = '{"reply":"hi","candidates":[]}';
  assert.equal(stripMarkdownFence(raw), raw);
});

test('stripMarkdownFence: 围栏前后有空格/换行 → 仍能 strip', () => {
  const raw = '  \n```json\n{"reply":"hi"}\n```\n  ';
  assert.equal(stripMarkdownFence(raw), '{"reply":"hi"}');
});

test('stripMarkdownFence: reply 内容含代码块（非整段围栏）→ 不误伤', () => {
  // reply 内容里有 ``` 但整段不是围栏包裹，不应 strip
  const raw = '{"reply":"看这段代码 ```js console.log(1)``` 很简单"}';
  assert.equal(stripMarkdownFence(raw), raw);
});
