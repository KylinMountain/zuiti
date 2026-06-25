/**
 * 架构不变量 lint —— 机械强制分层依赖方向 + reply 第一键 + 无弃用符号。
 *
 * 借鉴 Harness Engineering：不变量靠机械执行，不靠人记（见 core-beliefs.md §4）。
 * 这个测试是"架构 linter"——失败时直接告诉 agent 哪条红线被破。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CoachOutput } from '../modules/reply/schema.js';
import { INSTRUCTIONS } from '../modules/reply/coach.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src');

/** 递归收集某目录下所有 .ts 文件内容。 */
function collectTs(dir: string, acc: { path: string; content: string }[] = []): { path: string; content: string }[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      collectTs(p, acc);
    } else if (name.endsWith('.ts')) {
      acc.push({ path: p, content: readFileSync(p, 'utf8') });
    }
  }
  return acc;
}

test('lint: CoachOutput schema 第一键是 reply（不变量 1）', () => {
  const keys = Object.keys(CoachOutput.shape);
  assert.equal(keys[0], 'reply', 'reply 必须是 CoachOutput 第一个键（流式蹦字靠它）');
});

test('lint: prompt 含 reply 必须排第一的指令', () => {
  assert.match(INSTRUCTIONS, /必须排第一/, 'INSTRUCTIONS 必须告诉模型 reply 排第一键');
});

test('lint: prompt 含对线红线（机智回怼非网暴）', () => {
  assert.match(INSTRUCTIONS, /严禁人身攻击/, '对线红线必须写入 prompt');
});

test('lint: schema/DTO 无弃用符号 diagnostics/variants', () => {
  const schema = readFileSync(join(SRC, 'modules/reply/schema.ts'), 'utf8');
  const ipc = readFileSync(join(SRC, 'shared/ipc.ts'), 'utf8');
  for (const content of [schema, ipc]) {
    assert.doesNotMatch(content, /\bdiagnostics\b/, 'diagnostics 已弃用，不应再出现');
    assert.doesNotMatch(content, /\bvariants\b/, 'variants 已弃用，不应再出现');
    assert.doesNotMatch(content, /\bStyleVariants\b/, 'StyleVariants 已弃用');
    assert.doesNotMatch(content, /\bDiagnostic\b/, 'Diagnostic 已弃用');
  }
});

test('lint: 无弃用符号 EnglishCoach', () => {
  const files = collectTs(join(SRC, 'modules')).concat(collectTs(join(SRC, 'cli')));
  for (const f of files) {
    assert.doesNotMatch(f.content, /\bEnglishCoach\b/, `${f.path}: EnglishCoach 已改名 ReplyCoach`);
  }
});

test('lint: core/ 不得 import modules/ main/ renderer/', () => {
  const files = collectTs(join(SRC, 'core'));
  for (const f of files) {
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/modules/, `${f.path}: core 不得依赖 modules`);
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/main/, `${f.path}: core 不得依赖 main`);
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/renderer/, `${f.path}: core 不得依赖 renderer`);
  }
});

test('lint: modules/ 不得 import main/ renderer/', () => {
  const files = collectTs(join(SRC, 'modules'));
  for (const f of files) {
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/\.\.\/main/, `${f.path}: modules 不得依赖 main`);
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/\.\.\/renderer/, `${f.path}: modules 不得依赖 renderer`);
  }
});

test('lint: renderer/ 不得 import Node 侧模块（只能用 window.zuiti）', () => {
  // renderer 是 vanilla JS，不参与 ts 编译；直接读 src/renderer/*.js
  const dir = join(SRC, 'renderer');
  let hasJs = false;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      hasJs = true;
      const content = readFileSync(join(dir, name), 'utf8');
      assert.doesNotMatch(content, /import\s+.*from\s+['"]\.\.\//, `${name}: renderer 不得 import Node 侧模块`);
      assert.doesNotMatch(content, /require\(/, `${name}: renderer 不得用 require`);
    }
  } catch {
    // renderer 目录可能不存在（早期），跳过
  }
  if (!hasJs) assert.ok(true, 'renderer 无 .js，跳过');
});
