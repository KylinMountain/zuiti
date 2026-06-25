/**
 * 流式 JSON 解析 —— 从模型流式输出里**抢先**抽出 reply 字段。
 *
 * 不变量（见 ARCHITECTURE.md）：reply 必须是模型输出 JSON 的第一个键。
 * ReplyExtractor 靠这一点做实时预览与首句先播 TTS：不必等整个 JSON 收完，
 * reply 的字符一流出来就能拿去蹦字 / 播 TTS。
 */

/**
 * 增量抽取流式 JSON 中的 `reply` 字符串值。
 *
 * 用法：每收到一个 chunk 调用 `push(chunk)`，拿到目前为止已流出的 reply 全文。
 * 依赖 reply 是 JSON 第一个键（`{"reply":"...","candidates":...}`）。
 */
export class ReplyExtractor {
  private buf = '';
  private _reply = '';
  private started = false;
  private done = false;

  /** 喂入一个流式 chunk，返回目前为止已抽出的 reply 全文。 */
  push(chunk: string): string {
    this.buf += chunk;
    this.extract();
    return this._reply;
  }

  /** 目前已抽出的 reply 全文。 */
  get replyText(): string {
    return this._reply;
  }

  /** reply 是否已收完（读到闭合引号）。 */
  get replyDone(): boolean {
    return this.done;
  }

  private extract(): void {
    if (this.done) return;

    if (!this.started) {
      const m = this.buf.match(/"reply"\s*:\s*"/);
      if (!m || m.index === undefined) return;
      this.started = true;
      this.buf = this.buf.slice(m.index + m[0].length);
    }

    // buf 现以 reply 字符串内容开头；读到未转义的 " 即收完。
    let out = '';
    let i = 0;
    while (i < this.buf.length) {
      const c = this.buf[i] as string;
      if (c === '\\') {
        const next = this.buf[i + 1];
        if (next === undefined) break; // 转义字符不完整，等下一个 chunk
        out += this.unescape(next);
        i += 2;
      } else if (c === '"') {
        this._reply = out;
        this.done = true;
        return;
      } else {
        out += c;
        i += 1;
      }
    }
    this._reply = out; // 目前已流出的部分
  }

  private unescape(c: string): string {
    switch (c) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      default: return c;
    }
  }
}
