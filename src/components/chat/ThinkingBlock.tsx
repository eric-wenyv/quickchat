import React, { useMemo, useState } from 'react';
import type { Components } from 'react-markdown';
import { splitMarkdownBlocks, MarkdownBlock } from './markdown-blocks';
import { normalizeStreamingMarkdown } from '@/utils/markdown';

// =============================================================================
// ThinkingBlock — 思考内容展示区块
// =============================================================================
// 布局仿照主流思考型产品的两态样式，视觉语言遵循应用本身的 graphite 主题：
//
// 1. 思考中（isLive）：spinner + “正在思考”，内容默认展开、实时流式渲染；
// 2. 已完成：可点击头部「已思考(用时 X 秒)」+ chevron 折叠展开，
//    自动收起（用户手动操作优先于自动行为），内容以弱化 tertiary 排版展示。
// =============================================================================

interface ThinkingBlockProps {
  /** 累计的思考内容（Markdown 文本） */
  reasoning: string;
  /** 是否处于思考进行中（流式且正文尚未开始） */
  isLive: boolean;
  /** 思考耗时（毫秒）；思考结束但仍未持久化时可为 null */
  durationMs?: number | null;
}

function formatThinkingDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 1) return '不足 1 秒';
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

const LightbulbIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.65 4.65 0 0 1 8.91 14" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </svg>
);

const ChevronIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const ThinkingMarkdown: React.FC<{ reasoning: string; isLive: boolean }> = React.memo(({ reasoning, isLive }) => {
  const normalized = useMemo(() => normalizeStreamingMarkdown(reasoning), [reasoning]);
  // 与正文一致的流式优化：按顶层块切分，刷新时只重新解析增长的末块
  const blocks = useMemo(
    () => (isLive ? splitMarkdownBlocks(normalized) : [normalized]),
    [normalized, isLive]
  );
  const components = useMemo<Components>(
    () => ({
      code({ className, children, ...props }) {
        return (
          <code
            className={`${className || ''} text-linear-text-secondary bg-linear-surface-hover border border-linear-border px-1.5 py-0.5 rounded-[4px] font-medium text-[0.875em]`}
            {...props}
          >
            {children}
          </code>
        );
      },
      a({ href, children, ...props }) {
        const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'));
        return (
          <a
            href={href}
            {...props}
            onClick={(e) => {
              if (!isExternal) return;
              e.preventDefault();
              import('@tauri-apps/plugin-opener')
                .then(({ openUrl }) => openUrl(href))
                .catch(() => window.open(href, '_blank'));
            }}
            className="cursor-pointer underline underline-offset-4 transition-colors"
          >
            {children}
          </a>
        );
      },
    }),
    []
  );

  return (
    <div className="qc-markdown prose prose-sm min-w-0 max-w-full dark:prose-invert leading-[1.65] prose-p:my-1.5 prose-p:text-linear-text-tertiary prose-strong:text-linear-text-secondary prose-strong:font-medium prose-headings:text-linear-text-secondary prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5 prose-h1:text-[1.05em] prose-h2:text-[1.02em] prose-h3:text-[1em] prose-a:text-linear-text-secondary hover:prose-a:text-linear-text-primary prose-code:text-linear-text-secondary prose-code:bg-linear-surface-hover prose-code:border prose-code:border-linear-border prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-[4px] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-pre:bg-linear-surface prose-pre:rounded-md prose-pre:border prose-pre:border-linear-border prose-pre:text-linear-text-tertiary prose-pre:p-3 prose-blockquote:border-l-linear-border prose-blockquote:text-linear-text-muted prose-ul:my-1.5 prose-ol:my-1.5 prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5 prose-li:text-linear-text-tertiary prose-li:marker:text-linear-accent prose-hr:border-linear-border">
      {blocks.map((block, index) => (
        <MarkdownBlock key={`thinking-${index}`} content={block} components={components} />
      ))}
    </div>
  );
});
ThinkingMarkdown.displayName = 'ThinkingMarkdown';

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ reasoning, isLive, durationMs }) => {
  // null = 未手动操作：思考中自动展开，结束后自动收起；手动点击后以用户意愿为准
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? isLive;

  const headerLabel = isLive
    ? '正在思考'
    : durationMs != null
      ? `已思考(用时 ${formatThinkingDuration(durationMs)})`
      : '已思考';

  const toggle = () => setManualExpanded(!expanded);

  return (
    <div className="w-full min-w-0 max-w-full">
      {isLive ? (
        <div className="flex items-center gap-2 py-1 select-none">
          <span className="h-3 w-3 flex-shrink-0 rounded-full border-2 border-linear-border border-t-linear-accent animate-spin" aria-hidden="true" />
          <span className="text-[12px] font-medium tracking-wide text-linear-text-secondary">{headerLabel}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-1 text-[12px] font-medium text-linear-text-tertiary hover:text-linear-text-secondary transition-colors select-none cursor-pointer"
        >
          <ChevronIcon
            className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
          />
          <LightbulbIcon className="w-3.5 h-3.5 flex-shrink-0 text-linear-accent" />
          <span>{headerLabel}</span>
        </button>
      )}

      <div
        className={`grid transition-[grid-template-rows] duration-200 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        style={{ transitionTimingFunction: 'var(--ease-snappy)' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 mb-2 border-l border-linear-border pl-3.5 text-[13px] text-linear-text-tertiary">
            <ThinkingMarkdown reasoning={reasoning} isLive={isLive} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThinkingBlock;
