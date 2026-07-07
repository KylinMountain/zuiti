/**
 * Provider 适配层（Plan 8 pi）—— 把 OpenAI 兼容的 Chat Completions 端点（如小米 MiMo）
 * 接进 pi 的 ModelRegistry。
 *
 * 不变点（见 ARCHITECTURE.md）：
 * - 经 pi `ModelRegistry.inMemory(authStorage).registerProvider('mimo', …)` 注册 MiMo（api:'openai-completions'）。
 * - MiMo 关 thinking（见 mira-model.ts）：挂工具时开 thinking 首字 21-32s，关掉 <1s 且"先文本流式 → 后 emit_result"顺序正确。
 * - 结构化输出走 emit_result 工具（不用 SDK json_schema，MiMo 不支持）；主体 primary 走文本流式。
 *
 * 配置来源（优先级：userData > env > 默认，见 runtime-config）：
 * - LLM_API_KEY   （.env）小米 LLM key，createMiraModelRegistry 必填（缺则抛错）
 * - LLM_BASE_URL  （.env）OpenAI 兼容端点（如 MiMo），createMiraModelRegistry 必填（缺则抛错）
 * - LLM_MODEL     （.env）模型名；缺省见 runtime-config DEFAULTS
 * - ASR_API_KEY / TTS_API_KEY （.env）语音 harness 用，本层不消费，见 src/core/voice.ts
 */
import { config as loadDotenv } from 'dotenv';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { buildMiraModel } from './mira-model.js';
import { getCredential, getLlmModel } from './runtime-config.js';

// 模块导入即加载 .env：保证 env 在 runtime-config lazy-init 前可读。
// dotenv.config() 幂等，重复调用无副作用。
loadDotenv();

/** 解析后的有效 LLM 配置（userData > env > 默认）。 */
export interface ResolvedLlmConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
}

/** 有效 LLM 配置（userData > env > 默认，见 runtime-config）。 */
export function resolveLlmConfig(): ResolvedLlmConfig {
  const { apiKey, baseURL } = getCredential();
  return { apiKey, baseURL, model: getLlmModel() };
}

/**
 * Plan 8：构造关 thinking 的 MiMo session 底座（pi）：authStorage + modelRegistry + 解析出的 model。
 * 复用 resolveLlmConfig（userData > env > 默认）。createMiraSession 用它。
 * @param hasScreenshot 带截图时切换到多模态模型（mimo-v2.5，pro 不支持图片）
 */
export function createMiraModelRegistry(hasScreenshot = false) {
  const cfg = resolveLlmConfig();
  const { apiKey, baseURL } = cfg;
  // 带截图时强制用多模态模型（mimo-v2.5-pro 不支持图片输入）
  const modelId = hasScreenshot ? 'mimo-v2.5' : cfg.model;
  if (!apiKey || !baseURL) throw new Error('缺少 LLM_API_KEY / LLM_BASE_URL');
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider('mimo', {
    name: 'MiMo',
    baseUrl: baseURL,
    apiKey,
    api: 'openai-completions',
    models: [buildMiraModel(baseURL, modelId)],
  });
  const resolved = modelRegistry.find('mimo', modelId);
  if (!resolved) throw new Error(`MiMo model ${modelId} 注册失败`);
  return { authStorage, modelRegistry, model: resolved };
}
