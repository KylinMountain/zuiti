import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, isClassifiedError } from '../core/errors.js';

test('401/403 → authInvalid，不重试，指向设置', () => {
  for (const s of [401, 403]) {
    const c = classifyError({ httpStatus: s });
    assert.equal(c.kind, 'authInvalid');
    assert.equal(c.retryable, false);
    assert.equal(c.fixAction, 'openSettings');
    assert.ok(c.userMessage.length > 0);
  }
});
test('429 → rateLimited，不重试', () => {
  const c = classifyError({ httpStatus: 429 });
  assert.equal(c.kind, 'rateLimited');
  assert.equal(c.retryable, false);
});
test('5xx → server，可重试', () => {
  const c = classifyError({ httpStatus: 503 });
  assert.equal(c.kind, 'server');
  assert.equal(c.retryable, true);
});
test('网络类 cause → network，可重试', () => {
  for (const msg of ['fetch failed', 'getaddrinfo ENOTFOUND x', 'connect ECONNREFUSED', 'The operation was aborted']) {
    const c = classifyError({ cause: new Error(msg) });
    assert.equal(c.kind, 'network', msg);
    assert.equal(c.retryable, true);
  }
});
test('code=asrEmpty → asrEmpty，不重试', () => {
  assert.equal(classifyError({ code: 'asrEmpty' }).kind, 'asrEmpty');
});
test('code=ttsFailed → ttsFailed，不重试', () => {
  assert.equal(classifyError({ code: 'ttsFailed' }).kind, 'ttsFailed');
});
test('其它 → unknown，不自动重试', () => {
  const c = classifyError({ cause: new Error('weird') });
  assert.equal(c.kind, 'unknown');
  assert.equal(c.retryable, false);
});
test('isClassifiedError 类型守卫', () => {
  const c = classifyError({ httpStatus: 401 });
  assert.equal(isClassifiedError(c), true);
  assert.equal(isClassifiedError(new Error('x')), false);
  assert.equal(isClassifiedError({ kind: 'network' }), false); // 缺字段
});
