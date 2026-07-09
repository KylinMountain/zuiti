/**
 * 字段驱动渲染计划（Plan 8 不变量 4：renderer 字段驱动，不按 skillId 硬分支）。
 *
 * 把 UniversalOutput → 纯数据描述（不碰 DOM），供 hud.ts 的 onResult 消费。
 * 拆到 shared/：纯函数无 DOM 依赖，主进程 tsconfig + 渲染层 tsconfig 都能编译，单测可直接 import。
 */
import type { UniversalOutput, UniversalItem } from './ipc.js';

export interface RenderedItem {
  label?: string;
  text: string;
  copyable: boolean;
}

export interface RenderPlan {
  titleVisible: boolean;
  titleText: string;
  primaryText: string;
  /** primary 是否仅作为引导标签弱化显示（如 reply 技能的极简引导语）。 */
  primaryAsLabel: boolean;
  items: RenderedItem[];
  noteVisible: boolean;
  noteText: string;
}

/** 判断 primary 是否只是引导标签：
 * - reply 类输出：items 全部可复制，primary 只应是一句引导语（短且以冒号结尾）。
 * - 若模型违反协议在 primary 里写了长篇分析，只要有可复制的候选条目，也把它降级成标签/隐藏。
 */
function isPrimaryAsLabel(primaryText: string, items: RenderedItem[]): boolean {
  if (items.length === 0) return false;
  const t = primaryText.trim();
  const allCopyable = items.every((it) => it.copyable);
  const shortLabel = t.length <= 30 && /[:：]$/.test(t);
  // reply 技能产出可复制的候选时，primary 不是主角；如果 primary 过长，直接当标签处理。
  return allCopyable && (shortLabel || t.length > 30);
}

/** UniversalOutput → 渲染计划（纯函数，无副作用）。 */
export function buildRenderPlan(dto: UniversalOutput): RenderPlan {
  const items = (dto.items ?? []).map((it) => buildRenderedItem(it));
  let primaryText = dto.primary?.text ?? '';
  const primaryAsLabel = isPrimaryAsLabel(primaryText, items);
  // reply 类输出中，若模型把分析写进 primary，截断到一句引导语长度，避免喧宾夺主。
  if (primaryAsLabel && primaryText.trim().length > 30) {
    const t = primaryText.trim();
    const firstStop = Math.max(t.indexOf('。'), t.indexOf('！'), t.indexOf('？'));
    primaryText = firstStop > 0 ? t.slice(0, firstStop + 1) : t.slice(0, 24) + '…';
  }
  return {
    titleVisible: !!dto.title,
    titleText: dto.title ?? '',
    primaryText,
    primaryAsLabel,
    items,
    // primary 只是标签时，不显示备注（如 reply 的场景备注），让候选卡片成为主角。
    noteVisible: !!dto.note && !primaryAsLabel,
    noteText: dto.note ?? '',
  };
}

function buildRenderedItem(item: UniversalItem): RenderedItem {
  return {
    label: item.label,
    text: item.text,
    copyable: !!item.copyable,
  };
}
