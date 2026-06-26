/**
 * emit_result 工具工厂（Plan 8 方案 a）。
 *
 * skill 生成时：先以纯文本流式输出主体（primary，蹦字 + 首句 TTS），再调 emit_result
 * 补结构化的条目/标题/备注。结构化数据走工具参数（TypeBox 校验），不解析文本。
 *
 * 每次 runSkill 调一次 createEmitTool()：返回独立闭包工具 + 取值器，避免并发污染
 * （多个 session 各自的 emit 互不串）。
 */
import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { UniversalItem } from '../shared/ipc.js';

export interface EmitResult {
  title?: string;
  items: UniversalItem[];
  note?: string;
}

/** 返回一个独立的 emit_result 工具 + 取值器（闭包持有结果）。 */
export function createEmitTool() {
  let result: EmitResult | null = null;
  const tool = defineTool({
    name: 'emit_result',
    label: '产出结构化结果',
    description: '写完主体内容后调用，补充结构化的条目（候选/要点/行动项）+ 可选标题/备注。',
    parameters: Type.Object({
      title: Type.Optional(Type.String()),
      items: Type.Array(
        Type.Object({
          text: Type.String(),
          label: Type.Optional(Type.String()),
          copyable: Type.Optional(Type.Boolean()),
        }),
      ),
      note: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params) => {
      result = params as EmitResult;
      return { content: [{ type: 'text' as const, text: 'ok' }], details: {} };
    },
  });
  return { tool, getResult: () => result };
}
