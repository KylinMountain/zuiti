/** 合并生效配置的单一来源：userData(fileConfig) > env > 默认。core 内其余模块从这里取配置。 */
import { EMPTY_CONFIG, type ZuitiConfig } from './config-store.js';

const DEFAULTS = {
  llmModel: 'mimo-v2.5-pro',
  asrModel: 'mimo-v2.5-asr',
  asrLang: 'zh' as const,
  ttsModel: 'mimo-v2.5-tts',
  ttsVoice: '冰糖',
  wakeThreshold: 0.3,
  defaultStyle: 'casual',
  ttsEnabled: true,
};

let file: ZuitiConfig = EMPTY_CONFIG;
let env: Record<string, string | undefined> = {};
let ready = false;

export function initRuntimeConfig(fileConfig: ZuitiConfig, envVars: Record<string, string | undefined>): void {
  file = fileConfig;
  env = envVars;
  ready = true;
}

/** 测试用：清空模块级缓存，回到未初始化态。 */
export function resetRuntimeConfig(): void {
  file = EMPTY_CONFIG;
  env = {};
  ready = false;
}

function ensure(): void {
  if (!ready) initRuntimeConfig(EMPTY_CONFIG, process.env);
}

export function getCredential(): { apiKey?: string; baseURL?: string } {
  ensure();
  return {
    apiKey: file.credential.apiKey ?? env.LLM_API_KEY,
    baseURL: file.credential.baseURL ?? env.LLM_BASE_URL,
  };
}
export function getLlmModel(): string {
  ensure();
  return file.llm.model ?? env.LLM_MODEL ?? DEFAULTS.llmModel;
}
export function getAsr(): { model: string; lang: 'zh' | 'auto' | 'en' } {
  ensure();
  return { model: file.asr.model ?? DEFAULTS.asrModel, lang: file.asr.lang ?? DEFAULTS.asrLang };
}
export function getTts(): { model: string; voice: string } {
  ensure();
  return { model: file.tts.model ?? DEFAULTS.ttsModel, voice: file.tts.voice ?? DEFAULTS.ttsVoice };
}
export function getAdvanced(): { wakeThreshold: number } {
  ensure();
  return { wakeThreshold: file.advanced.wakeThreshold !== undefined ? file.advanced.wakeThreshold : DEFAULTS.wakeThreshold };
}
export function getUi(): { defaultStyle: string; ttsEnabled: boolean; sfxEnabled: boolean; sfxVolume: number } {
  ensure();
  return {
    defaultStyle: file.ui.defaultStyle ?? DEFAULTS.defaultStyle,
    ttsEnabled: file.ui.ttsEnabled !== undefined ? file.ui.ttsEnabled : DEFAULTS.ttsEnabled,
    sfxEnabled: file.ui.sfxEnabled !== undefined ? file.ui.sfxEnabled : true,
    sfxVolume: typeof file.ui.sfxVolume === 'number' ? file.ui.sfxVolume : 0.5,
  };
}
export function getEffectiveConfig(): ZuitiConfig {
  ensure();
  return {
    credential: getCredential(),
    llm: { model: getLlmModel() },
    asr: getAsr(),
    tts: getTts(),
    advanced: getAdvanced(),
    ui: getUi(),
  };
}
