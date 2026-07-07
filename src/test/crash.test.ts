import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCrashReport } from '../core/crash.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'zuiti-crash-')); }

test('写出崩溃报告，含 message/stack/source', () => {
  const dir = tmp();
  const p = writeCrashReport(dir, new Error('boom'), { source: 'uncaughtException', version: '0.1.0' });
  assert.ok(p, '应返回路径');
  const files = readdirSync(join(dir, 'crash'));
  assert.equal(files.length, 1);
  const rep = JSON.parse(readFileSync(p as string, 'utf8'));
  assert.equal(rep.source, 'uncaughtException');
  assert.equal(rep.message, 'boom');
  assert.match(rep.stack, /Error: boom/);
  assert.equal(rep.version, '0.1.0');
  assert.ok(rep.ts);
});
test('非 Error 值也能记录（不抛）', () => {
  const dir = tmp();
  const p = writeCrashReport(dir, 'weird string reason', { source: 'unhandledRejection', version: '0.1.0' });
  assert.ok(p);
  const rep = JSON.parse(readFileSync(p as string, 'utf8'));
  assert.equal(rep.message, 'weird string reason');
});
test('目录不可写时返回 null 且不抛', () => {
  // 使用包含 NUL 字符的非法路径触发 mkdir 失败
  const p = writeCrashReport('/invalid\0path', 'err', { source: 'uncaughtException', version: '0.1.0' });
  assert.equal(p, null);
});
