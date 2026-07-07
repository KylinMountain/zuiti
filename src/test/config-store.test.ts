import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, EMPTY_CONFIG } from '../core/config-store.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'zuiti-cfg-')); }

test('缺文件 → EMPTY_CONFIG（各 section 存在）', () => {
  const c = loadConfig(tmp());
  assert.deepEqual(c, EMPTY_CONFIG);
  assert.equal(c.credential.apiKey, undefined);
  assert.ok(c.llm && c.asr && c.tts && c.advanced && c.ui);
});
test('损坏 JSON → EMPTY_CONFIG（不抛）', () => {
  const d = tmp(); writeFileSync(join(d, 'zuiti-config.json'), '{ not json');
  assert.deepEqual(loadConfig(d), EMPTY_CONFIG);
});
test('saveConfig 按 section 浅合并 + 落盘 + 返回合并后', () => {
  const d = tmp();
  saveConfig(d, { credential: { apiKey: 'tp-1', baseURL: 'https://x/v1' } });
  const merged = saveConfig(d, { credential: { apiKey: 'tp-2' }, tts: { voice: '小美' } });
  assert.equal(merged.credential.apiKey, 'tp-2');
  assert.equal(merged.credential.baseURL, 'https://x/v1'); // 同 section 内其它字段保留
  assert.equal(merged.tts.voice, '小美');
  const onDisk = JSON.parse(readFileSync(join(d, 'zuiti-config.json'), 'utf8'));
  assert.equal(onDisk.credential.apiKey, 'tp-2');
});
test('EMPTY_CONFIG 不被 save 修改（无共享引用）', () => {
  const d = tmp();
  saveConfig(d, { credential: { apiKey: 'z' } });
  assert.equal(EMPTY_CONFIG.credential.apiKey, undefined);
});
