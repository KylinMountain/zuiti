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
  items: RenderedItem[];
  noteVisible: boolean;
  noteText: string;
}

/** UniversalOutput → 渲染计划（纯函数，无副作用）。 */
export function buildRenderPlan(dto: UniversalOutput): RenderPlan {
  return {
    titleVisible: !!dto.title,
    titleText: dto.title ?? '',
    primaryText: dto.primary?.text ?? '',
    items: (dto.items ?? []).map((it) => buildRenderedItem(it)),
    noteVisible: !!dto.note,
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
