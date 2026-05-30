/**
 * Repairs a common LLM math delimiter typo where an inline formula starts with
 * `$$` but ends with a single `$`. Without this, KaTeX receives the trailing
 * dollar as part of the expression and renders a parse error.
 */
export function normalizeMarkdownMath(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(/(^|[^\$])\$\$([^$\n]+)\$/g, '$1$$$2$'))
    .join('\n');
}

/**
 * 为流式 Markdown 做语法补全，防止未闭合标签导致整页结构闪烁/跳动。
 * 目前主要处理未闭合的代码块（```），在内存中临时补全闭合符号。
 */
export function normalizeStreamingMarkdown(content: string): string {
  const normalizedContent = normalizeMarkdownMath(content);
  const lines = normalizedContent.split('\n');
  let inCodeBlock = false;
  let lastFence = '';

  for (const line of lines) {
    const match = line.match(/^(```+)(\w*)/);
    if (match) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        lastFence = match[1];
      } else {
        lastFence = '';
      }
    }
  }

  if (inCodeBlock && lastFence) {
    return normalizedContent + '\n' + lastFence + '\n';
  }

  return normalizedContent;
}
