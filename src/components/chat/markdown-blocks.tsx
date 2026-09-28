// =============================================================================
// Quick-Chat — 共享 Markdown 分块渲染原语
// =============================================================================
// 从 MessageContent 抽出，供正文与思考内容（ThinkingBlock）复用：
// 流式期间按顶层块边界切分 + memo，使每次刷新只需重新解析正在增长的末块。
// =============================================================================

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import type { Components } from 'react-markdown';

export const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];
export const REHYPE_PLUGINS = [rehypeKatex];
// 无公式内容的轻量管线：remark-math 的 tokenizer 与 rehype-katex 的整树遍历
// 在 WebKit JSC 上成本显著，纯文本/代码块消息直接跳过
const REMARK_PLUGINS_NO_MATH = [remarkGfm, remarkBreaks];
const REHYPE_PLUGINS_NONE: never[] = [];
export const identityUrlTransform = (url: string) => url;

/**
 * 将 Markdown 按顶层块边界切分为可独立渲染的段，配合 memo 实现
 * "只重新解析正在增长的末块"——流式期间正文每次变化只需重跑末块的
 * remark/rehype 管线，前面的块直接命中缓存，长回复不再随篇幅变卡。
 *
 * 只在"安全空行"处切断：不处于代码围栏 / $$ 公式块内，且下一非空行
 * 不是缩进续行、列表项、引用行或表格行——这些结构与前块可能同属一个
 * Markdown 块（松散列表、跨段引用等），切开会改变渲染语义。
 */
const LIST_MARKER_RE = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

export function splitMarkdownBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fenceMarker: string | null = null;
  let inMath = false;

  const trySplit = (blankIndex: number) => {
    if (fenceMarker !== null || inMath) return;
    let next = '';
    for (let j = blankIndex + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '') {
        next = lines[j];
        break;
      }
    }
    if (!next) return; // 末尾空行：保留在块尾即可
    if (/^[ \t]/.test(next)) return; // 缩进续行（列表延续 / 嵌套内容 / 缩进代码）
    if (LIST_MARKER_RE.test(next)) return; // 列表延续（含松散列表）
    if (next.startsWith('>')) return; // 跨段引用
    if (next.startsWith('|')) return; // 表格延续
    const joined = current.join('\n');
    if (joined.trim() !== '') blocks.push(joined);
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      trySplit(i);
      current.push(line);
      continue;
    }

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMarker === null) {
      if (fenceMatch) fenceMarker = fenceMatch[1];
    } else {
      // CommonMark：闭合围栏必须是同字符、等长或更长、且不带信息字符串的裸围栏
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (
        closing &&
        closing[1][0] === fenceMarker[0] &&
        closing[1].length >= fenceMarker.length
      ) {
        fenceMarker = null;
      }
    }

    if (trimmed.startsWith('$$')) {
      if (inMath) {
        inMath = false;
      } else if (!(trimmed.length >= 4 && trimmed.endsWith('$$'))) {
        inMath = true; // 单行自闭合的 $$...$$ 不进入公式块状态
      }
    }

    current.push(line);
  }

  const tail = current.join('\n');
  if (tail.trim() !== '') blocks.push(tail);
  return blocks.length > 0 ? blocks : [''];
}

interface MarkdownBlockProps {
  content: string;
  components: Components;
}

export const MarkdownBlock = React.memo(function MarkdownBlock({ content, components }: MarkdownBlockProps) {
  // 公式管线按需启用：只有出现 $ 定界符的内容才跑 remark-math + rehype-katex
  const hasMath = content.includes('$');
  return (
    <ReactMarkdown
      remarkPlugins={hasMath ? REMARK_PLUGINS : REMARK_PLUGINS_NO_MATH}
      rehypePlugins={hasMath ? REHYPE_PLUGINS : REHYPE_PLUGINS_NONE}
      components={components}
      urlTransform={identityUrlTransform}
    >
      {content}
    </ReactMarkdown>
  );
});
