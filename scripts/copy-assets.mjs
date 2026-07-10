// 把渲染层静态资源拷到 dist/renderer：html/css + onnxruntime-web 的 wasm（唤醒词推理用）。
import { mkdirSync, copyFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
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

// onnxruntime-web 运行时按 wasmPaths('./') 从 index.html 同目录加载 .wasm，具体加载哪个
// 变体（simd/threaded/jsep/jspi/asyncify…）由打包进 hud.js 的 ort 运行时在启动时探测决定。
// onnxruntime-web/dist 里塞了全部变体 + webgpu/webgl/node 等不会用到的入口文件（~130MB），
// 这里只拷 hud.js 实际引用到的文件名，而不是整个目录——避免把没用到的变体也塞进安装包。
const ORT = 'node_modules/onnxruntime-web/dist';
const hudJsPath = join(OUT, 'hud.js');
if (existsSync(ORT) && existsSync(hudJsPath)) {
  const hudJs = readFileSync(hudJsPath, 'utf8');
  const referenced = new Set(hudJs.match(/ort[a-zA-Z0-9_.-]*\.(wasm|mjs)/g) ?? []);
  if (referenced.size === 0) {
    throw new Error('copy-assets: hud.js 里没找到任何 ort-wasm 文件名引用，onnxruntime-web 版本可能变了产物命名，需要人工检查');
  }
  for (const f of referenced) {
    const from = join(ORT, f);
    if (!existsSync(from)) throw new Error(`copy-assets: hud.js 引用了 ${f}，但 ${from} 不存在`);
    copyFileSync(from, join(OUT, f));
  }
  console.log('copied onnxruntime-web wasm (referenced only):', [...referenced].join(', '));
}
