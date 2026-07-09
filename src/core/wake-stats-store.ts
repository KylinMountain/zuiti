/** 唤醒词统计读写（plan-13）—— 纯 Node fs，dir 注入，无 electron 依赖。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_WAKE_STATS, type WakeStats } from '../shared/wake-stats.js';

const FILENAME = 'wake-stats.json';

export function loadWakeStats(dir: string): WakeStats {
  try {
    const raw = JSON.parse(readFileSync(join(dir, FILENAME), 'utf8')) as Partial<WakeStats>;
    return {
      hits: typeof raw.hits === 'number' ? raw.hits : 0,
      misses: typeof raw.misses === 'number' ? raw.misses : 0,
      lastMissAt: typeof raw.lastMissAt === 'number' ? raw.lastMissAt : undefined,
      recentMissReasons: Array.isArray(raw.recentMissReasons) ? raw.recentMissReasons : [],
    };
  } catch {
    return { ...EMPTY_WAKE_STATS };
  }
}

export function saveWakeStats(dir: string, stats: WakeStats): void {
  writeFileSync(join(dir, FILENAME), JSON.stringify(stats, null, 2), 'utf8');
}
