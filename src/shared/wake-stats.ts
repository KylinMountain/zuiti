/**
 * 唤醒词误触发统计（plan-13）—— 纯函数，无 DOM/Node 依赖。
 *
 * 记录唤醒命中/误触发次数 + 最近误触原因（环形缓冲，最多 10 条）。
 * 误触发定义：wake → noSpeechTimeout（10s 没开口）或 wake → ASR empty。
 */

/** 误触发原因。 */
export type WakeMissReason = 'noSpeechTimeout' | 'asrEmpty';

/** 唤醒词统计数据。 */
export interface WakeStats {
  hits: number;
  misses: number;
  /** 最近一次误触的 Unix ms 时间戳。 */
  lastMissAt?: number;
  /** 最近 10 条误触原因（环形缓冲，最新在尾部）。 */
  recentMissReasons: WakeMissReason[];
}

const MAX_REASONS = 10;

export const EMPTY_WAKE_STATS: WakeStats = { hits: 0, misses: 0, recentMissReasons: [] };

/** 记录一次命中。返回新对象（不可变）。 */
export function recordHit(stats: WakeStats): WakeStats {
  return { ...stats, hits: stats.hits + 1 };
}

/** 记录一次误触发。返回新对象（不可变），recentMissReasons 环形裁剪到 10 条。 */
export function recordMiss(stats: WakeStats, reason: WakeMissReason): WakeStats {
  const reasons = [...stats.recentMissReasons, reason];
  if (reasons.length > MAX_REASONS) reasons.splice(0, reasons.length - MAX_REASONS);
  return {
    ...stats,
    misses: stats.misses + 1,
    lastMissAt: Date.now(),
    recentMissReasons: reasons,
  };
}

/** 汇总：总数 + 误触率（0-1，total=0 时为 0）。 */
export function summarize(stats: WakeStats): { total: number; missRate: number } {
  const total = stats.hits + stats.misses;
  return { total, missRate: total === 0 ? 0 : stats.misses / total };
}
