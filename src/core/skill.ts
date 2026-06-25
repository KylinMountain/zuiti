/**
 * Skill 系统 —— 嘴替的扩展底座。
 *
 * 加能力 = 实现 Skill 接口 + 注册一行，harness 不动（见 ARCHITECTURE.md §Skill 系统是扩展底座）。
 * 今天替你撩 / 怂 / 跟老板说话；明天能写小红书文案、跟客服 battle、解读阴阳怪气。
 *
 * 扩展分两档：
 *  - 纯 skill/prompt 替换（输出形状相同，如 reply + candidates）；
 *  - 输出形状不同时，一般化 parseOutput + 加 UI 视图。
 */

/** 一条 skill 的输入：用户口述 + 可选屏幕截图。 */
export interface SkillInput {
  /** 用户语音说的真心话（中文/口语/带情绪均可）。 */
  text: string;
  /** 当前屏幕截图（PNG bytes 等），由 harness 在唤醒时截取。 */
  screenshot?: Uint8Array;
}

/** skill 注册项。 */
export interface Skill {
  /** 唯一 id，如 'reply' / 'read-aloud'。 */
  id: string;
  /** 展示名，如「嘴替」「读向」。 */
  name: string;
  /** 一句话说明。 */
  description: string;
  /** 构造给 LLM 的系统指令。 */
  instructions: string;
  /** 把原始 LLM 输出解析为该 skill 的结构化结果。 */
  parseOutput(raw: string): unknown;
}

const registry = new Map<string, Skill>();

/** 注册一条 skill。重复 id 覆盖。 */
export function registerSkill(skill: Skill): void {
  registry.set(skill.id, skill);
}

/** 按 id 取 skill。 */
export function getSkill(id: string): Skill | undefined {
  return registry.get(id);
}

/** 列出全部已注册 skill。 */
export function listSkills(): Skill[] {
  return [...registry.values()];
}
