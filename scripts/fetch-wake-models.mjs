#!/usr/bin/env node
// 下载 openWakeWord 三个 ONNX 模型到 models/ 目录（本地离线唤醒用）。
// 模型来自官方 GitHub releases：https://github.com/dscripka/openWakeWord/releases
//
// 用法：node scripts/fetch-wake-models.mjs
// 重复运行幂等：已存在且大小匹配的文件跳过。
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MODELS_DIR = join(ROOT, 'models');

// 模型清单（URL + 期望大小 bytes，校验完整性）
// 这些是 openWakeWord 官方 releases 里的标准模型
const MODELS = [
  {
    name: 'melspectrogram.onnx',
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.6.0/melspectrogram.onnx',
    size: 8_073_315,
  },
  {
    name: 'embedding_model.onnx',
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.6.0/embedding_model.onnx',
    size: 1_329_392,
  },
  {
    name: 'hey_jarvis_v0.1.onnx',
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.6.0/hey_jarvis_v0.1.onnx',
    size: 573_704,
  },
];

async function download(url, dest, expectedSize) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${url}`);
  const tmp = `${dest}.tmp`;
  await pipeline(res.body, createWriteStream(tmp));
  const { renameSync, unlinkSync } = await import('node:fs');
  try {
    const stats = statSync(tmp);
    if (expectedSize && stats.size !== expectedSize) {
      throw new Error(`size mismatch: expected ${expectedSize}, got ${stats.size}`);
    }
    renameSync(tmp, dest);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
  return statSync(dest).size;
}

async function main() {
  await mkdir(MODELS_DIR, { recursive: true });
  for (const m of MODELS) {
    const dest = join(MODELS_DIR, m.name);
    if (existsSync(dest)) {
      const s = statSync(dest).size;
      if (s === m.size) {
        console.log(`✓ ${m.name} (已存在 ${s} bytes，跳过)`);
        continue;
      }
      console.log(`⚠ ${m.name} 大小不符（${s} vs ${m.size}），重新下载`);
    }
    console.log(`↓ ${m.name} from ${m.url}`);
    const size = await download(m.url, dest, m.size);
    console.log(`✓ ${m.name} (${size} bytes)`);
  }
  console.log('\n所有唤醒词模型已就位：', MODELS_DIR);
}

main().catch((err) => {
  console.error('下载失败:', err.message);
  process.exit(1);
});
