import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCoachOutput } from '../cli/render.js';
import type { CoachOutput } from '../modules/english/schema.js';

test('renderCoachOutput: 含推荐、备选与判断', () => {
  const s = renderCoachOutput({
    reply: '在的，正想你呢',
    candidates: [{ text: '在，是不是想我了', style: '更皮' }],
    diagnostics: [],
    rationale: '暧昧场景',
    variants: null,
  });
  assert.match(s, /嘴替推荐/);
  assert.match(s, /在的，正想你呢/);
  assert.match(s, /\[更皮\] 在，是不是想我了/);
  assert.match(s, /暧昧场景/);
});

test('renderCoachOutput: 无备选时不打印备选段', () => {
  const s = renderCoachOutput({
    reply: '只有推荐',
    candidates: [],
    diagnostics: [],
    rationale: '',
    variants: null,
  } satisfies CoachOutput);
  assert.match(s, /只有推荐/);
  assert.doesNotMatch(s, /备选/);
});

test('renderCoachOutput: candidate 无 style 时显示「备选」', () => {
  const s = renderCoachOutput({
    reply: 'r',
    candidates: [{ text: '没标签', style: '' }],
    diagnostics: [],
    rationale: '',
    variants: null,
  } satisfies CoachOutput);
  assert.match(s, /\[备选\] 没标签/);
});
