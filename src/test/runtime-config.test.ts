import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initRuntimeConfig, getCredential, getLlmModel, getAsr, getTts, getAdvanced, getUi } from '../core/runtime-config.js';
import { EMPTY_CONFIG } from '../core/config-store.js';

test('默认值（无 file 无 env）', () => {
  initRuntimeConfig(EMPTY_CONFIG, {});
  assert.equal(getLlmModel(), 'mimo-v2.5-pro');
  assert.deepEqual(getAsr(), { model: 'mimo-v2.5-asr', lang: 'zh' });
  assert.deepEqual(getTts(), { model: 'mimo-v2.5-tts', voice: '冰糖' });
  assert.equal(getAdvanced().wakeThreshold, 0.3);
  assert.deepEqual(getCredential(), { apiKey: undefined, baseURL: undefined });
});
test('env 覆盖默认', () => {
  initRuntimeConfig(EMPTY_CONFIG, { LLM_API_KEY: 'tp-env', LLM_BASE_URL: 'https://env/v1', LLM_MODEL: 'm-env' });
  assert.deepEqual(getCredential(), { apiKey: 'tp-env', baseURL: 'https://env/v1' });
  assert.equal(getLlmModel(), 'm-env');
});
test('userData 覆盖 env', () => {
  const file = { ...EMPTY_CONFIG, credential: { apiKey: 'tp-file', baseURL: 'https://file/v1' }, llm: { model: 'm-file' }, tts: { voice: '小美' } };
  initRuntimeConfig(file, { LLM_API_KEY: 'tp-env', LLM_BASE_URL: 'https://env/v1', LLM_MODEL: 'm-env' });
  assert.deepEqual(getCredential(), { apiKey: 'tp-file', baseURL: 'https://file/v1' });
  assert.equal(getLlmModel(), 'm-file');
  assert.equal(getTts().voice, '小美');
});

test('存储的 ttsEnabled=false 不被默认值覆盖', () => {
  initRuntimeConfig({ ...EMPTY_CONFIG, ui: { ttsEnabled: false } }, {});
  assert.equal(getUi().ttsEnabled, false);
});

test('存储的 wakeThreshold=0 不被默认值覆盖', () => {
  initRuntimeConfig({ ...EMPTY_CONFIG, advanced: { wakeThreshold: 0 } }, {});
  assert.equal(getAdvanced().wakeThreshold, 0);
});
