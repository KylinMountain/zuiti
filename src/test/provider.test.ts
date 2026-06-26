import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlmConfig } from '../core/provider.js';

test('resolveLlmConfig: 读 env（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL）', () => {
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_BASE_URL = 'https://example.test/v1';
  process.env.LLM_MODEL = 'test-model';
  try {
    const cfg = resolveLlmConfig();
    assert.equal(cfg.apiKey, 'test-key');
    assert.equal(cfg.baseURL, 'https://example.test/v1');
    assert.equal(cfg.model, 'test-model');
  } finally {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  }
});

test('resolveLlmConfig: 无 env 时回退默认 model', () => {
  // 测试环境 .env 可能已加载（provider 顶部 loadDotenv），先清掉
  const savedKey = process.env.LLM_API_KEY;
  const savedUrl = process.env.LLM_BASE_URL;
  const savedModel = process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  try {
    const cfg = resolveLlmConfig();
    assert.equal(cfg.apiKey, undefined);
    assert.equal(cfg.baseURL, undefined);
    assert.equal(cfg.model, 'gpt-4o-mini');
  } finally {
    if (savedKey !== undefined) process.env.LLM_API_KEY = savedKey;
    if (savedUrl !== undefined) process.env.LLM_BASE_URL = savedUrl;
    if (savedModel !== undefined) process.env.LLM_MODEL = savedModel;
  }
});

test('resolveLlmConfig: 跟随 LLM_MODEL env', () => {
  process.env.LLM_MODEL = 'mimo-v2.5-pro';
  try {
    assert.equal(resolveLlmConfig().model, 'mimo-v2.5-pro');
  } finally {
    delete process.env.LLM_MODEL;
  }
});
