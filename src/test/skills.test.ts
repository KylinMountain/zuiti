/**
 * Plan 8 Task 3：三个 SKILL.md 存在且 frontmatter 合法 + 含输出协议。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { skillsDir } from '../modules/mira/prompt.js';

const SKILLS = ['reply', 'explain', 'summarize'];

test('三个 SKILL.md 存在且 frontmatter 含 name+description + 输出协议', () => {
  for (const s of SKILLS) {
    const p = join(skillsDir(), s, 'SKILL.md');
    assert.ok(existsSync(p), `${p} 不存在`);
    const md = readFileSync(p, 'utf8');
    assert.match(md, new RegExp(`name:\\s*${s}`), `${s} 缺 name`);
    assert.match(md, /description:\s*\S/, `${s} 缺 description`);
    assert.match(md, /emit_result/, `${s} 缺输出协议`);
  }
});
