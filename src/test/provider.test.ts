import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlmConfig } from '../core/provider.js';
import { initRuntimeConfig, resetRuntimeConfig } from '../core/runtime-config.js';
import { EMPTY_CONFIG } from '../core/config-store.js';

afterEach(() => {
  resetRuntimeConfig();
});

test('resolveLlmConfig: 读 env（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL）', () => {
  initRuntimeConfig(EMPTY_CONFIG, { LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://example.test/v1', LLM_MODEL: 'test-model' });
  const cfg = resolveLlmConfig();
  assert.equal(cfg.apiKey, 'test-key');
  assert.equal(cfg.baseURL, 'https://example.test/v1');
  assert.equal(cfg.model, 'test-model');
});

test('resolveLlmConfig: 无 env 时回退默认 model', () => {
  initRuntimeConfig(EMPTY_CONFIG, {});
  const cfg = resolveLlmConfig();
  assert.equal(cfg.apiKey, undefined);
  assert.equal(cfg.baseURL, undefined);
  assert.equal(cfg.model, 'mimo-v2.5-pro');
});

test('resolveLlmConfig: 跟随 LLM_MODEL env', () => {
  initRuntimeConfig(EMPTY_CONFIG, { LLM_MODEL: 'mimo-v2.5-pro' });
  assert.equal(resolveLlmConfig().model, 'mimo-v2.5-pro');
});
