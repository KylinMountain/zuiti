/**
 * 架构不变量 lint（Plan 8）—— 机械强制分层依赖 + skills 约定 + 无已删符号 + 字段驱动渲染 + 关 thinking。
 *
 * 借鉴 Harness Engineering：不变量靠机械执行（core-beliefs §4）。失败时直接告诉 agent 哪条红线被破。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src');
const ROOT = resolve(__dirname, '../..');

function collectTs(dir: string, acc: { path: string; content: string }[] = []): { path: string; content: string }[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectTs(p, acc);
    else if (name.endsWith('.ts')) acc.push({ path: p, content: readFileSync(p, 'utf8') });
  }
  return acc;
}

/** 产品代码（排除 test/，避免 lint 断言字符串自匹配）。 */
function productTs(): { path: string; content: string }[] {
  return collectTs(SRC).filter((f) => !f.path.includes('/test/'));
}

test('lint: core/ 不得 import modules/ main/ renderer/', () => {
  for (const f of collectTs(join(SRC, 'core'))) {
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/modules/, `${f.path}: core 不得依赖 modules`);
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/main/, `${f.path}: core 不得依赖 main`);
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/renderer/, `${f.path}: core 不得依赖 renderer`);
  }
});

test('lint: modules/ 不得 import main/ renderer/', () => {
  for (const f of collectTs(join(SRC, 'modules'))) {
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/\.\.\/main/, `${f.path}: modules 不得依赖 main`);
    assert.doesNotMatch(f.content, /from\s+['"]\.\.\/\.\.\/renderer/, `${f.path}: modules 不得依赖 renderer`);
  }
});

test('lint: renderer/ 不得 import Node 侧模块（core/modules/main），只经 window.zuiti', () => {
  const dir = join(SRC, 'renderer');
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts')) continue;
    const content = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(content, /from\s+['"]\.\.\/core/, `${name}: renderer 不得 import core/`);
    assert.doesNotMatch(content, /from\s+['"]\.\.\/modules/, `${name}: renderer 不得 import modules/`);
    assert.doesNotMatch(content, /from\s+['"]\.\.\/main/, `${name}: renderer 不得 import main/`);
    assert.doesNotMatch(content, /require\(/, `${name}: renderer 不得用 require`);
  }
});

test('lint: skills/ 下每个 SKILL.md 有合法 frontmatter（name+description）', () => {
  const skillsRoot = join(ROOT, 'skills');
  const dirs = readdirSync(skillsRoot).filter((n) => statSync(join(skillsRoot, n)).isDirectory());
  assert.ok(dirs.length >= 3, '至少 reply/explain/summarize 三个 skill');
  for (const n of dirs) {
    const p = join(skillsRoot, n, 'SKILL.md');
    assert.ok(existsSync(p), `${p} 不存在`);
    const md = readFileSync(p, 'utf8');
    assert.match(md, /name:\s*\S/, `${n}: 缺 name`);
    assert.match(md, /description:\s*\S/, `${n}: 缺 description`);
  }
});

test('lint: 产品代码无已删符号（@openai/agents/ReplyExtractor/RouterCoach/旧路由）', () => {
  for (const f of productTs()) {
    assert.doesNotMatch(f.content, /@openai\/agents/, `${f.path}: @openai/agents 已移除`);
    assert.doesNotMatch(f.content, /ReplyExtractor/, `${f.path}: ReplyExtractor 已删`);
    assert.doesNotMatch(f.content, /RouterCoach/, `${f.path}: RouterCoach 已删`);
    assert.doesNotMatch(f.content, /routeSkillWithLlm|classifyIntentHeuristic/, `${f.path}: 旧路由已删`);
  }
});

test('lint: renderer 字段驱动渲染（hud 无 skillId === 硬分支）', () => {
  const hud = readFileSync(join(SRC, 'renderer/hud.ts'), 'utf8');
  assert.doesNotMatch(hud, /skillId\s*===/, 'hud 应字段驱动渲染，不按 skillId 分支');
});

test('lint: MiMo model 关 thinking（硬前提，设计 R2/R3）', () => {
  const m = readFileSync(join(SRC, 'core/mira-model.ts'), 'utf8');
  assert.match(m, /enable_thinking:\s*false/, 'MiMo 必须关 thinking');
});

test('lint: emit_result 工具 schema 完整（name + items）', () => {
  const e = readFileSync(join(SRC, 'core/emit-tool.ts'), 'utf8');
  assert.match(e, /name:\s*'emit_result'/, '工具名必须是 emit_result');
  assert.match(e, /items:/, 'schema 必须含 items');
});

test('lint: session 用 tools allowlist 保留 read（否则 skill 不注入）', () => {
  const s = readFileSync(join(SRC, 'modules/mira/session.ts'), 'utf8');
  assert.match(s, /tools:\s*\[\s*'read'/, "必须 tools:['read',...] 保留 read 工具");
});
