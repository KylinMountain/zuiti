import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initRuntimeConfig } from '../core/runtime-config.js';
import { EMPTY_CONFIG } from '../core/config-store.js';
import { checkLlm } from '../core/service-health.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('未配置凭证 → ok:false，提示未配置', async () => {
  initRuntimeConfig(EMPTY_CONFIG, {});
  const r = await checkLlm();
  assert.equal(r.ok, false);
  assert.match(r.message, /未配置|API Key|Base URL/);
});
test('200 → ok:true', async () => {
  initRuntimeConfig({ ...EMPTY_CONFIG, credential: { apiKey: 'k', baseURL: 'https://x/v1' } }, {});
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const r = await checkLlm();
  assert.equal(r.ok, true);
});
test('401 → ok:false，kind=authInvalid', async () => {
  initRuntimeConfig({ ...EMPTY_CONFIG, credential: { apiKey: 'bad', baseURL: 'https://x/v1' } }, {});
  globalThis.fetch = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
  const r = await checkLlm();
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'authInvalid');
  assert.equal(r.httpStatus, 401);
});
test('fetch 抛（网络）→ ok:false，kind=network', async () => {
  initRuntimeConfig({ ...EMPTY_CONFIG, credential: { apiKey: 'k', baseURL: 'https://x/v1' } }, {});
  globalThis.fetch = (async () => { throw new Error('fetch failed'); }) as typeof fetch;
  const r = await checkLlm();
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'network');
});
test('baseURL 带尾部斜杠时，实际请求 URL 无双斜杠', async () => {
  initRuntimeConfig({ ...EMPTY_CONFIG, credential: { apiKey: 'k', baseURL: 'https://x/v1/' } }, {});
  let calledUrl = '';
  globalThis.fetch = (async (url: unknown) => { calledUrl = String(url); return new Response('{}', { status: 200 }); }) as typeof fetch;
  await checkLlm();
  assert.equal(calledUrl, 'https://x/v1/chat/completions');
});
