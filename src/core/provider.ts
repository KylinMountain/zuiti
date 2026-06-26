/**
 * Provider 适配层 —— 把 OpenAI 兼容的 Chat Completions 端点（如小米 MiMo）接进 agents SDK。
 *
 * 不变点（见 ARCHITECTURE.md）：
 * - LLM 不用 SDK 的 outputType；JSON 经 modelSettings.providerData 的 json_object 产出，上层 zod 校验。
 * - MiMo 走 chat_completions API（非 responses），需 setOpenAIAPI('chat_completions')。
 *
 * 配置来源（优先级：config.json > env > 默认）：
 * - LLM_API_KEY   （.env）小米 LLM key，必填才能真打模型
 * - LLM_BASE_URL  （.env）OpenAI 兼容端点，如 MiMo；缺省走 OpenAI 官方
 * - LLM_MODEL     （.env）模型名；缺省 gpt-4o-mini
 * - ASR_API_KEY / TTS_API_KEY （.env）语音 harness 用，本层不消费，见 src/core/voice.ts（Plan 3）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { buildMiraModel } from './mira-model.js';

// 模块导入即加载 .env：保证 getCoachModelName() 在 Agent 构造时（导入期）能读到 env。
// dotenv.config() 幂等，重复调用无副作用。
loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));

/** provider 配置（config.json，可选，覆盖 env）。 */
export interface ProviderConfig {
  baseURL?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model?: string;
}

const DEFAULT_MODEL = 'gpt-4o-mini';

/** 同步读取 config.json；缺失或损坏时返回空配置（不抛错，保证模块导入无副作用）。 */
export function loadProviderConfig(): ProviderConfig {
  const paths = [
    resolve(__dirname, '../../config.json'),
    resolve(process.cwd(), 'config.json'),
  ];
  for (const p of paths) {
    try {
      const raw = readFileSync(p, 'utf8');
      return JSON.parse(raw) as ProviderConfig;
    } catch {
      // try next path
    }
  }
  return {};
}

/** 解析后的有效 LLM 配置（config.json > env > 默认）。 */
export interface ResolvedLlmConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
}

/** 拿到有效 LLM 配置：config.json 优先，否则读 env（LLM_API_KEY / LLM_BASE_URL / LLM_MODEL）。 */
export function resolveLlmConfig(): ResolvedLlmConfig {
  const cfg = loadProviderConfig();
  const apiKey = cfg.apiKey ?? (cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined) ?? process.env.LLM_API_KEY;
  const baseURL = cfg.baseURL ?? process.env.LLM_BASE_URL;
  const model = cfg.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
  return { apiKey, baseURL, model };
}

/**
 * Plan 8：构造关 thinking 的 MiMo session 底座（pi）：authStorage + modelRegistry + 解析出的 model。
 * 复用 resolveLlmConfig（config.json > env）。createMiraSession 用它。
 */
export function createMiraModelRegistry() {
  const { apiKey, baseURL, model } = resolveLlmConfig();
  if (!apiKey || !baseURL) throw new Error('缺少 LLM_API_KEY / LLM_BASE_URL');
  const authStorage = AuthStorage.inMemory();
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider('mimo', {
    name: 'MiMo',
    baseUrl: baseURL,
    apiKey,
    api: 'openai-completions',
    models: [buildMiraModel(baseURL, model)],
  });
  const resolved = modelRegistry.find('mimo', model);
  if (!resolved) throw new Error(`MiMo model ${model} 注册失败`);
  return { authStorage, modelRegistry, model: resolved };
}
