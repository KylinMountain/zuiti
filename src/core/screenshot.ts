/**
 * 截屏看屏 harness —— 被唤醒时截一次屏，转成 MiMo 多模态可读的 data URL。
 *
 * 红线（见 ARCHITECTURE.md）：只在被唤醒时截一次，不持续监视。
 */
import { log } from './log.js';

/** PNG bytes → base64 data URL（MiMo 图片理解的 image_url.url 格式）。 */
export function pngToDataUrl(pngBytes: Uint8Array): string {
  const base64 = Buffer.from(pngBytes).toString('base64');
  return `data:image/png;base64,${base64}`;
}

/**
 * 截屏：用 Electron desktopCapturer。
 * 必须在主进程调用（需 electron）。
 * @returns PNG bytes，失败抛错。
 */
export async function captureScreen(): Promise<Uint8Array> {
  // 动态 import electron，避免 core 层静态依赖 electron（保持 core 可在纯 Node 测试）
  const { desktopCapturer } = await import('electron');
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
  const primary = sources[0];
  if (!primary) throw new Error('截屏失败：找不到屏幕源');
  const png = primary.thumbnail.toPNG();
  log.info('screenshot.captured', { bytes: png.length });
  return new Uint8Array(png);
}
