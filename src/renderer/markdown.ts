/**
 * 轻量 Markdown → HTML（只支持嘴替 UI 常用的子集）。
 * 先 escape HTML 再替换标记，避免 XSS。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 渲染 markdown 子集为 HTML。
 * 支持：标题(###/##/#)、粗体 **、斜体 * / _、行内代码 `、无序列表 -/*、有序列表 1.、换行。
 */
export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // 代码块 ```...```
  html = html.replace(/```([\s\S]*?)```/g, (_, code: string) => {
    return `<pre><code>${code.replace(/^\n|\n$/g, '')}</code></pre>`;
  });

  // 行内代码 `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 粗体 **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 斜体 *text* 或 _text_（但避免和粗体重复处理）
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  //  headings
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 列表：先按段处理，保持简单
  const paragraphs = html.split(/\n\n+/);
  const out: string[] = [];
  for (const para of paragraphs) {
    const lines = para.split('\n').filter((l) => l.trim() !== '');
    if (lines.length && lines.every((l) => /^[-*] /.test(l))) {
      const items = lines.map((l) => `<li>${l.slice(2)}</li>`).join('');
      out.push(`<ul>${items}</ul>`);
    } else if (lines.length && lines.every((l) => /^\d+\. /.test(l))) {
      const items = lines.map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      out.push(`<ol>${items}</ol>`);
    } else {
      // 普通段落：行内换行转 <br>
      out.push(`<p>${para.replace(/\n/g, '<br>')}</p>`);
    }
  }
  return out.join('');
}
