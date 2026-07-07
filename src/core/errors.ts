/** 统一错误分类（纯）—— 把 HTTP 状态 / code / 网络异常 归一成用户可见的分类。 */
export type ErrorKind =
  | 'authInvalid' | 'rateLimited' | 'network' | 'server'
  | 'asrEmpty' | 'ttsFailed' | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  userMessage: string;
  retryable: boolean;
  fixAction?: 'openSettings';
}

const NETWORK_HINTS = ['fetch failed', 'enotfound', 'econnrefused', 'etimedout', 'econnreset', 'network', 'aborted', 'dns'];

function looksLikeNetwork(cause: unknown): boolean {
  const msg = (cause instanceof Error ? cause.message : String(cause ?? '')).toLowerCase();
  return NETWORK_HINTS.some((h) => msg.includes(h));
}

export function classifyError(input: { httpStatus?: number; code?: string; cause?: unknown }): ClassifiedError {
  const { httpStatus, code, cause } = input;
  if (code === 'asrEmpty') return { kind: 'asrEmpty', userMessage: '没听清，再说一次？', retryable: false };
  if (code === 'ttsFailed') return { kind: 'ttsFailed', userMessage: '语音合成失败（不影响文字回复）', retryable: false };
  if (httpStatus === 401 || httpStatus === 403) {
    return { kind: 'authInvalid', userMessage: 'API Key 无效或无权限，请到设置检查凭证', retryable: false, fixAction: 'openSettings' };
  }
  if (httpStatus === 429) return { kind: 'rateLimited', userMessage: '请求太频繁，稍后再试', retryable: false };
  if (typeof httpStatus === 'number' && httpStatus >= 500) {
    return { kind: 'server', userMessage: '服务暂时不可用，正在重试…', retryable: true };
  }
  if (cause !== undefined && looksLikeNetwork(cause)) {
    return { kind: 'network', userMessage: '网络连不上，检查网络或稍后重试', retryable: true };
  }
  const detail = cause instanceof Error ? cause.message : (typeof cause === 'string' ? cause : '');
  return { kind: 'unknown', userMessage: detail ? `出错了：${detail}` : '出错了，请重试', retryable: false };
}

export function isClassifiedError(e: unknown): e is ClassifiedError {
  return !!e && typeof e === 'object'
    && typeof (e as ClassifiedError).kind === 'string'
    && typeof (e as ClassifiedError).userMessage === 'string'
    && typeof (e as ClassifiedError).retryable === 'boolean';
}
