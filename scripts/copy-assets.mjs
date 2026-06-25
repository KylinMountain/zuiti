// 把渲染层静态资源拷到 dist/renderer：html/css + onnxruntime-web 的 wasm（唤醒词推理用）。
import { mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const SRC = 'src/renderer';
const OUT = 'dist/renderer';
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(SRC)) {
  if (['.html', '.css'].includes(extname(f))) {
    copyFileSync(join(SRC, f), join(OUT, f));
    console.log('copied', f);
  }
}

// onnxruntime-web 运行时按 wasmPaths('./') 从 index.html 同目录加载 .wasm。
const ORT = 'node_modules/onnxruntime-web/dist';
if (existsSync(ORT)) {
  for (const f of readdirSync(ORT)) {
    if (f.endsWith('.wasm') || f.endsWith('.mjs')) {
      copyFileSync(join(ORT, f), join(OUT, f));
    }
  }
  console.log('copied onnxruntime-web wasm');
}
