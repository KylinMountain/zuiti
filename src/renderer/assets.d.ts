// esbuild loader:.wav=dataurl 把 wav 导入为 base64 data URL 字符串。
declare module '*.wav' {
  const src: string;
  export default src;
}
