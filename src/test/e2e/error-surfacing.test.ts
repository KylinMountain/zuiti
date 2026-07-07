/**
 * e2e: 错误可见链路 —— 故意用无效 key → checkLlm 必返回 authInvalid（确定性）。
 *
 * 用真实 MiMo baseURL (LLM_BASE_URL) + 故意错误的 key → 真端点必回 401 → authInvalid。
 * 不依赖 .env 里的 key 是否有效，故断言确定：一定 ok:false + authInvalid。
 *
 * 前提：e2e 已启用（SHOULD_RUN_E2E=true 即 E2E_SKIP=0 + LLM_BASE_URL 已配）。
 * happy-path 对话 e2e 仍需有效 key（见 conversation/skill-runner e2e）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOULD_RUN_E2E, SKIP_REASON } from './setup.js';
import { checkLlm } from '../../core/service-health.js';
import { initRuntimeConfig } from '../../core/runtime-config.js';
import { EMPTY_CONFIG } from '../../core/config-store.js';

test('故意用无效 key → checkLlm 必返回 authInvalid（错误可见链路，确定性）', { skip: SHOULD_RUN_E2E ? false : SKIP_REASON }, async () => {
  // 用真实 MiMo baseURL（来自 .env）+ 一个故意错误的 key → 真端点必回 401 → authInvalid。
  // 不依赖 .env 里的 key 是否有效，故断言确定：一定 ok:false + authInvalid。
  initRuntimeConfig(
    { ...EMPTY_CONFIG, credential: { apiKey: 'sk-deliberately-invalid-key', baseURL: process.env.LLM_BASE_URL } },
    {},
  );
  const r = await checkLlm();
  assert.equal(r.ok, false, 'invalid key must not be ok');
  assert.equal(r.kind, 'authInvalid');
  assert.equal(r.httpStatus, 401);
  assert.match(r.message, /API Key/);
});
