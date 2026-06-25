/**
 * openWakeWord 推理管线（浏览器/onnxruntime-web 移植，忠实复刻官方 utils.py 的流式实现）。
 *
 * 三段：melspectrogram(原始16bit音频→mel) → embedding(76×32 mel窗→96维) → wakeword(16×96→概率)。
 * 关键常数与缓冲逻辑严格对齐 openWakeWord：
 *   - 16kHz，每 1280 样本(80ms)为一步；melspec 取最近 (accumulated+480) 样本计算后整体 vstack；
 *   - melspec 归一化 mel/10+2；embedding 窗长76、步长8；melBuffer 初始为 76×32 全 1；
 *   - wakeword 取最近 16 个 embedding；概率 ≥ 阈值即命中。
 * 作为 WebVoiceProcessor 的 PvEngine（postMessage 收 16k Int16 帧）。
 *
 * 缓冲全部用定长 Float32Array 滑动窗（copyWithin 丢旧），避免实时热路径上的装箱数组与
 * 逐样本 push / 头部 splice 带来的 GC 抖动（低占用）。
 */
import * as ort from 'onnxruntime-web';

// Electron file:// 下：单线程、wasm 文件与 index.html 同目录（构建时拷贝）。
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = './';

export interface OwwModels {
  mel: Uint8Array;
  emb: Uint8Array;
  ww: Uint8Array;
}

const SR = 16000;
const STEP = 1280; // 80ms
const MEL_CTX = 480; // 160*3 边缘上下文
const MEL_MAX = 10 * 97; // mel 帧上限
const FEAT_MAX = 120; // embedding 上限
const WIN = 76; // mel 窗长
const BINS = 32; // mel 频带
const EMB = 96; // embedding 维度
const N_FEAT = 16; // hey_jarvis 取最近 16 个 embedding
const REFIRE_MS = 2000;
const MIN_THRESHOLD = 0.05; // 阈值下限，防止 0 阈值每帧误触发
const MAX_QUEUE = 100; // 帧队列上限（~3s @16k/512），超出丢最旧帧而非当前帧

export class OpenWakeWord {
  private melSess!: ort.InferenceSession;
  private embSess!: ort.InferenceSession;
  private wwSess!: ort.InferenceSession;
  private melIn = 'input';
  private embIn = 'input_1';
  private wwIn = 'input';

  // 定长滑动缓冲
  private raw = new Float32Array(SR * 10);
  private rawLen = 0;
  private mel = new Float32Array(MEL_MAX * BINS);
  private melLen = WIN; // 行数；初始 76 行全 1
  private feat = new Float32Array(FEAT_MAX * EMB);
  private featLen = 0;

  private accumulated = 0;
  private remainder = new Int16Array(0);
  private lastFire = 0;

  // 帧队列：永不丢当前帧；忙时入队，单 drainer 顺序消费。
  private queue: Int16Array[] = [];
  private draining = false;

  private constructor(
    private readonly threshold: number,
    private readonly onWake: () => void,
    private readonly debug: boolean,
  ) {
    this.mel.fill(1, 0, WIN * BINS); // melBuffer 初始 76×32 全 1
  }

  static async create(
    models: OwwModels,
    threshold: number,
    onWake: () => void,
    debug = false,
  ): Promise<OpenWakeWord> {
    const t = Math.min(0.99, Math.max(MIN_THRESHOLD, threshold));
    const oww = new OpenWakeWord(t, onWake, debug);
    const opt: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };
    oww.melSess = await ort.InferenceSession.create(models.mel, opt);
    oww.embSess = await ort.InferenceSession.create(models.emb, opt);
    oww.wwSess = await ort.InferenceSession.create(models.ww, opt);
    oww.melIn = oww.melSess.inputNames[0];
    oww.embIn = oww.embSess.inputNames[0];
    oww.wwIn = oww.wwSess.inputNames[0];
    return oww;
  }

  /** PvEngine 接口：WebVoiceProcessor 推帧进来。 */
  postMessage = (e: { command: string; inputFrame: Int16Array }): void => {
    if (e.command !== 'process') return;
    this.queue.push(e.inputFrame);
    if (this.queue.length > MAX_QUEUE) this.queue.shift(); // 落后太多才丢最旧帧
    void this.drain();
  };

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        await this.process(this.queue.shift()!);
      }
    } catch (err) {
      console.error('openWakeWord processing error:', err);
    } finally {
      this.draining = false;
    }
  }

  private bufferRaw(x: Int16Array): void {
    if (this.rawLen + x.length > this.raw.length) {
      const drop = this.rawLen + x.length - this.raw.length;
      this.raw.copyWithin(0, drop, this.rawLen);
      this.rawLen -= drop;
    }
    for (let i = 0; i < x.length; i++) this.raw[this.rawLen + i] = x[i];
    this.rawLen += x.length;
  }

  /** melspec：原始 int16 量级 float 音频 → [frames,32]；返回原始数据，归一化在 appendMel 做。 */
  private async melspec(samples: Float32Array): Promise<{ data: Float32Array; frames: number; bins: number }> {
    const out = await this.melSess.run({ [this.melIn]: new ort.Tensor('float32', samples, [1, samples.length]) });
    const o = out[this.melSess.outputNames[0]];
    const dims = o.dims as number[];
    return { data: o.data as Float32Array, frames: dims[dims.length - 2], bins: dims[dims.length - 1] };
  }

  private appendMel(data: Float32Array, frames: number, bins: number): void {
    if (this.melLen + frames > MEL_MAX) {
      const drop = this.melLen + frames - MEL_MAX;
      this.mel.copyWithin(0, drop * BINS, this.melLen * BINS);
      this.melLen -= drop;
    }
    for (let i = 0; i < frames; i++) {
      const dst = (this.melLen + i) * BINS;
      const src = i * bins;
      for (let b = 0; b < BINS; b++) this.mel[dst + b] = data[src + b] / 10 + 2; // 官方变换
    }
    this.melLen += frames;
  }

  private async embed(window: Float32Array): Promise<Float32Array> {
    const out = await this.embSess.run({ [this.embIn]: new ort.Tensor('float32', window, [1, WIN, BINS, 1]) });
    return out[this.embSess.outputNames[0]].data as Float32Array; // 96
  }

  private appendFeat(emb: Float32Array): void {
    if (this.featLen + 1 > FEAT_MAX) {
      this.feat.copyWithin(0, EMB, this.featLen * EMB);
      this.featLen -= 1;
    }
    this.feat.set(emb.subarray(0, EMB), this.featLen * EMB);
    this.featLen += 1;
  }

  private async wakeword(): Promise<number> {
    const win = this.feat.slice((this.featLen - N_FEAT) * EMB, this.featLen * EMB);
    const out = await this.wwSess.run({ [this.wwIn]: new ort.Tensor('float32', win, [1, N_FEAT, EMB]) });
    const d = out[this.wwSess.outputNames[0]].data as Float32Array;
    return d[d.length - 1];
  }

  private async process(frame: Int16Array): Promise<void> {
    let x: Int16Array;
    if (this.remainder.length) {
      x = new Int16Array(this.remainder.length + frame.length);
      x.set(this.remainder, 0);
      x.set(frame, this.remainder.length);
      this.remainder = new Int16Array(0);
    } else {
      x = frame;
    }

    if (this.accumulated + x.length >= STEP) {
      const rem = (this.accumulated + x.length) % STEP;
      if (rem !== 0) {
        const even = x.subarray(0, x.length - rem);
        this.bufferRaw(even);
        this.accumulated += even.length;
        this.remainder = x.slice(x.length - rem);
      } else {
        this.bufferRaw(x);
        this.accumulated += x.length;
        this.remainder = new Int16Array(0);
      }
    } else {
      this.accumulated += x.length;
      this.bufferRaw(x);
    }

    if (this.accumulated < STEP || this.accumulated % STEP !== 0) return;

    // 1) 流式 melspectrogram（最近 accumulated+480 样本）
    // 用 slice 取 0 偏移副本：部分 onnxruntime-web 版本对 subarray 视图忽略 byteOffset。
    const want = this.accumulated + MEL_CTX;
    const samples = this.raw.slice(Math.max(0, this.rawLen - want), this.rawLen);
    const m = await this.melspec(samples);
    this.appendMel(m.data, m.frames, m.bins);

    // 2) 新增 embedding（每 1280 样本一个，取最近 76 mel 帧；多块时按步长 8 回溯）
    const chunks = this.accumulated / STEP;
    for (let i = chunks - 1; i >= 0; i--) {
      const ndx = -8 * i;
      const end = ndx === 0 ? this.melLen : this.melLen + ndx;
      const start = end - WIN;
      if (start >= 0 && end <= this.melLen) {
        this.appendFeat(await this.embed(this.mel.slice(start * BINS, end * BINS)));
      }
    }
    this.accumulated = 0;

    // 3) wakeword 检出
    if (this.featLen >= N_FEAT) {
      const score = await this.wakeword();
      if (this.debug) console.log(`[wake] score=${score.toFixed(4)} thr=${this.threshold}`);
      if (score >= this.threshold && Date.now() - this.lastFire > REFIRE_MS) {
        this.lastFire = Date.now();
        this.onWake();
      }
    }
  }
}
