// VAD（Voice Activity Detection）—— 纯 TS RMS 能量检测，无依赖。
//
// 状态机：
//   silence →（连续 triggerMs RMS≥triggerThreshold）→ speaking
//   speaking →（连续 silenceMs RMS<silenceThreshold）→ silence
//
// 用法：
//   const vad = new VadDetector({ onStateChange: (s) => {...}, tickMs: 100 });
//   // 每 tickMs 调一次：
//   const rms = computeRms(analyserNode);
//   vad.feed(rms);
//
// 持续监听场景：onStateChange('speaking') 时开 MediaRecorder，'silence' 时停。
// 唤醒后自动录场景：开麦后等 'speaking' 转回 'silence' 即停。

export type VadState = 'silence' | 'speaking';

export interface VadOptions {
  triggerThreshold?: number;
  silenceThreshold?: number;
  triggerMs?: number;
  silenceMs?: number;
  tickMs?: number;
  onStateChange?: (state: VadState, info?: { speechMs: number }) => void;
}

/** 默认参数（针对普通桌面麦克风、有环境噪音的场景调过）。 */
const DEFAULTS: Required<Omit<VadOptions, 'onStateChange'>> = {
  triggerThreshold: 0.05, // 开始说话的 RMS 阈值（0-1）
  silenceThreshold: 0.02, // 说话结束的 RMS 阈值（更严，避免尾音误判）
  triggerMs: 500, // 连续 500ms 有声 → 判定开始说话
  silenceMs: 1200, // 连续 1.2s 无声 → 判定说话结束
  tickMs: 100, // 调用 feed 的间隔
};

/** VAD 状态机。 */
export class VadDetector {
  private opts: Required<Omit<VadOptions, 'onStateChange'>> & Pick<VadOptions, 'onStateChange'>;
  private state: VadState = 'silence';
  private silenceTimer = 0;
  private speechTimer = 0;
  private speechStartMs = 0;
  private lastSpeechMs = 0;

  constructor(opts: VadOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** 重置状态机。 */
  reset(): void {
    this.state = 'silence';
    this.silenceTimer = 0;
    this.speechTimer = 0;
    this.speechStartMs = 0;
    this.lastSpeechMs = 0;
  }

  /** 喂入 RMS 值（0-1），返回当前状态。 */
  feed(rms: number): VadState {
    const { triggerThreshold, silenceThreshold, triggerMs, silenceMs, tickMs, onStateChange } = this.opts;

    if (this.state === 'silence') {
      if (rms >= triggerThreshold) {
        this.speechTimer += tickMs;
        if (this.speechTimer >= triggerMs) {
          this.state = 'speaking';
          this.silenceTimer = 0;
          this.speechStartMs = Date.now();
          if (typeof onStateChange === 'function') onStateChange('speaking');
        }
      } else {
        this.speechTimer = 0;
      }
    } else {
      // speaking
      if (rms < silenceThreshold) {
        this.silenceTimer += tickMs;
        if (this.silenceTimer >= silenceMs) {
          this.lastSpeechMs = Date.now() - this.speechStartMs;
          this.state = 'silence';
          this.speechTimer = 0;
          if (typeof onStateChange === 'function') onStateChange('silence', { speechMs: this.lastSpeechMs });
        }
      } else {
        this.silenceTimer = 0;
      }
    }
    return this.state;
  }
}

/** 从 AnalyserNode 取当前一帧的 RMS（0-1）。 */
export function computeRms(analyser: AnalyserNode): number {
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128; // -1..1
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / buf.length);
}
