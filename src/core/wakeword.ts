/**
 * 唤醒词检测 —— 简化方案：周期性采集短音频 → ASR 检测是否含"Jarvis"。
 *
 * 完整方案会用本地 VAD + 轻量唤醒词模型（如 openWakeWord），
 * 但为不引入新依赖，这里用 MiMo ASR 做检测（有延迟，但可跑通流程）。
 *
 * 真正的本地唤醒词模型留作后续优化（见 tech-debt-tracker.md）。
 */
import { transcribeAudio, type AudioMime } from './voice.js';
import { log } from './log.js';

const WAKE_WORD = 'jarvis';
const POLL_MS = 3000; // 每 3 秒检测一次（平衡延迟与 API 调用频率）

/** 麦克风音频采集器接口（由 Electron 主进程实现注入）。 */
export interface MicCapture {
  /** 采集指定时长的音频，返回 bytes。 */
  capture(durationMs: number): Promise<Uint8Array>;
  /** 音频 MIME 类型。 */
  readonly mime: AudioMime;
}

/**
 * 唤醒词检测器。
 *
 * 用法：
 *   const det = new WakeWordDetector(mic);
 *   det.onWake = () => { ... };
 *   det.start();  // 开始周期性检测
 *   det.stop();   // 停止
 */
export class WakeWordDetector {
  private timer: ReturnType<typeof setInterval> | null = null;
  onWake: (() => void) | null = null;

  constructor(private mic: MicCapture) {}

  start(): void {
    if (this.timer) return;
    log.info('wakeword.start', { pollMs: POLL_MS });
    this.timer = setInterval(() => void this.check(), POLL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('wakeword.stop');
    }
  }

  private async check(): Promise<void> {
    try {
      const audio = await this.mic.capture(1500); // 采 1.5 秒
      const text = (await transcribeAudio(audio, this.mic.mime, 'auto')).toLowerCase();
      if (text.includes(WAKE_WORD)) {
        log.info('wakeword.detected', { text });
        this.onWake?.();
      }
    } catch (err) {
      log.warn('wakeword.check.error', { msg: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** 检查文本是否含唤醒词（纯函数，可单测）。用单词边界避免 jarviss 误匹配。 */
export function containsWakeWord(text: string): boolean {
  return /\bjarvis\b/i.test(text);
}
