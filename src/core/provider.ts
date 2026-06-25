/**
 * Provider 适配层 —— 把 OpenAI 兼容的 Chat Completions 端点（如 MiMo）接进 agents SDK。
 *
 * 不变点（见 ARCHITECTURE.md）：
 * - LLM 不用 SDK 的 outputType；JSON 经 modelSettings.providerData 的 json_object 产出，上层 zod 校验。
 * - MiMo 走 chat_completions API（非 responses），需 setOpenAIAPI('chat_completions')。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import OpenAI from 'openai';
import { setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** provider 配置（config.json，可选）。缺失时走 SDK 默认（OpenAI 官方）。 */
export interface ProviderConfig {
  baseURL?: string;
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
      const cfg = JSON.parse(raw) as ProviderConfig;
      return cfg;
    } catch {
      // try next path
    }
  }
  return {};
}

/** 嘴替的 model_settings：强制 JSON 输出（providerData.json_object）。 */
export const coachModelSettings = {
  providerData: { json_object: {} },
};

/** 模型名（从 config.json 读，缺省回退）。 */
export function getCoachModelName(): string {
  return loadProviderConfig().model ?? DEFAULT_MODEL;
}

/**
 * 在 loadDotenv 之后调用：用 config.json + env 构造 OpenAI client 并设为默认。
 * 无 config / 无 apiKey 时为 no-op（让 SDK 用默认 client）。
 */
export function initProvider(): void {
  const cfg = loadProviderConfig();
  const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
  if (cfg.baseURL && apiKey) {
    // MiMo 等 OpenAI 兼容端点走 chat_completions
    setOpenAIAPI('chat_completions');
    // openai 包 CJS/ESM 双解析下 #private 字段类型不一致，运行时同一实例，强转绕过 TS 报错。
    setDefaultOpenAIClient(new OpenAI({ baseURL: cfg.baseURL, apiKey }) as never);
  } else if (apiKey) {
    setDefaultOpenAIClient(new OpenAI({ apiKey }) as never);
  }
}
