/** 应用内配置读写（纯，dir 注入，无 electron 依赖）。明文 JSON 存 <dir>/zuiti-config.json。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ZuitiConfig {
  credential: { apiKey?: string; baseURL?: string };
  llm: { model?: string };
  asr: { model?: string; lang?: 'zh' | 'auto' | 'en' };
  tts: { model?: string; voice?: string };
  advanced: { wakeThreshold?: number };
  ui: { defaultStyle?: string; ttsEnabled?: boolean; sfxEnabled?: boolean; sfxVolume?: number };
}

const FILENAME = 'zuiti-config.json';
const SECTIONS = ['credential', 'llm', 'asr', 'tts', 'advanced', 'ui'] as const;

export const EMPTY_CONFIG: ZuitiConfig = {
  credential: {}, llm: {}, asr: {}, tts: {}, advanced: {}, ui: {},
};

function fresh(): ZuitiConfig {
  return { credential: {}, llm: {}, asr: {}, tts: {}, advanced: {}, ui: {} };
}

export function loadConfig(dir: string): ZuitiConfig {
  try {
    const raw = JSON.parse(readFileSync(join(dir, FILENAME), 'utf8')) as Partial<ZuitiConfig>;
    const out = fresh();
    for (const s of SECTIONS) Object.assign(out[s], (raw as Record<string, object>)[s] ?? {});
    return out;
  } catch {
    return fresh();
  }
}

export function saveConfig(dir: string, patch: Partial<ZuitiConfig>): ZuitiConfig {
  const cur = loadConfig(dir);
  for (const s of SECTIONS) {
    const p = (patch as Record<string, object | undefined>)[s];
    if (p) Object.assign(cur[s], p);
  }
  writeFileSync(join(dir, FILENAME), JSON.stringify(cur, null, 2), 'utf8');
  return cur;
}
