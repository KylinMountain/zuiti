import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplyExtractor } from '../core/streamparse.js';

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
