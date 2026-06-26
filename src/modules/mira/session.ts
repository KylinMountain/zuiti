/**
 * 嘴替单 session 构造（Plan 8 Task 4）。
 *
 * 一个 pi session：关 thinking 的 MiMo model + 嘴替 system prompt + skills/ 渐进式披露
 * + tools:['read','emit_result']（read 加载 SKILL.md，emit_result 产结构化）。
 */
import { join } from 'node:path';
import { createAgentSession, SessionManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { createMiraModelRegistry } from '../../core/provider.js';
import { createEmitTool, type EmitResult } from '../../core/emit-tool.js';
import { MIRA_SYSTEM_PROMPT, skillsDir } from './prompt.js';

/** 构造嘴替 session + emit 取值器。每次 runSkill 调一次（emit 闭包独立）。 */
export async function createMiraSession(): Promise<{
  session: Awaited<ReturnType<typeof createAgentSession>>['session'];
  getEmit: () => EmitResult | null;
}> {
  const { authStorage, modelRegistry, model } = createMiraModelRegistry();
  const { tool: emitTool, getResult } = createEmitTool();

  const skills = skillsDir();
  const cwd = join(skills, '..'); // 仓库根
  const agentDir = join(cwd, '.pi-agent'); // 隔离 agent 配置目录（不读用户全局 ~/.pi）

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    systemPrompt: MIRA_SYSTEM_PROMPT, // 替换 pi 默认 "general coding agent"
    additionalSkillPaths: [skills], // 发现 skills/{reply,explain,summarize}/SKILL.md
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    model,
    modelRegistry,
    authStorage,
    resourceLoader,
    tools: ['read', 'emit_result'], // 必须保留 read，否则 skill 不注入
    customTools: [emitTool],
    sessionManager: SessionManager.inMemory(cwd),
    cwd,
  });
  return { session, getEmit: getResult };
}
