/**
 * MiMo model 元数据（喂给 pi 的 ModelRegistry.registerProvider）。
 *
 * 关 thinking 是硬前提（Plan 8 设计 R2/R3）：MiMo 是 reasoning 模型，挂工具时会
 * "先 reasoning 先 tool、文本挤到第二轮"，首字 21-32s；关掉后首字 <1s 且顺序正确。
 * spike 实测 MiMo 认 chat_template_kwargs.enable_thinking=false（pi 的 thinkingFormat:'chat-template'）。
 */
export function buildMiraModel(baseUrl: string, modelId: string) {
  return {
    id: modelId,
    name: 'MiMo',
    api: 'openai-completions' as const,
    baseUrl,
    reasoning: true,
    input: ['text', 'image'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
    compat: {
      thinkingFormat: 'chat-template' as const,
      chatTemplateKwargs: { enable_thinking: false },
    },
  };
}
