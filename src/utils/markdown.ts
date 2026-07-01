/**
 * Repairs common LLM math delimiter typos and shields escaped dollar signs
 * inside inline math from remark-math's dollar delimiter parser.
 */
export function normalizeMarkdownMath(content: string): string {
  return content.split('\n').map(normalizeMarkdownMathLine).join('\n');
}

interface MathDelimiterMatch {
  index: number;
  delimiter: '$' | '$$';
}

function normalizeMarkdownMathLine(line: string): string {
  let normalized = '';
  let index = 0;

  while (index < line.length) {
    if (line[index] !== '$' || isEscapedDollar(line, index)) {
      normalized += line[index];
      index += 1;
      continue;
    }

    const opener: '$' | '$$' = line[index + 1] === '$' ? '$$' : '$';
    const bodyStart = index + opener.length;
    const closing = findMathClosingDelimiter(line, bodyStart, opener);

    if (!closing) {
      normalized += line.slice(index);
      break;
    }

    const delimiter = closing.delimiter === opener ? opener : '$';
    const body = line.slice(bodyStart, closing.index).replace(/\\\$/g, '\\char"24');
    normalized += delimiter + body + delimiter;
    index = closing.index + closing.delimiter.length;
  }

  return normalized;
}

function findMathClosingDelimiter(
  line: string,
  startIndex: number,
  opener: '$' | '$$'
): MathDelimiterMatch | null {
  if (opener === '$$') {
    const doubleClose = findNextMathDelimiter(line, startIndex, '$$');
    if (doubleClose) return doubleClose;
  }

  return findNextMathDelimiter(line, startIndex, '$');
}

function findNextMathDelimiter(
  line: string,
  startIndex: number,
  delimiter: '$' | '$$'
): MathDelimiterMatch | null {
  for (let index = startIndex; index < line.length; index += 1) {
    if (line[index] !== '$' || isEscapedDollar(line, index)) continue;

    if (line[index + 1] === '$') {
      if (delimiter === '$$') {
        return { index, delimiter: '$$' };
      }
      return { index, delimiter: '$$' };
    }

    if (delimiter === '$') {
      return { index, delimiter: '$' };
    }
  }

  return null;
}

function isEscapedDollar(line: string, dollarIndex: number): boolean {
  let slashCount = 0;

  for (let index = dollarIndex - 1; index >= 0 && line[index] === '\\'; index -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
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
