import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import type { Components } from 'react-markdown';
import type { MessageStatus } from '@/types/types';

// ------------------------------------------------------------------
// 注册常用语言（按需加载，减小包体积）
// ------------------------------------------------------------------
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('rs', rust);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('html', markup);
SyntaxHighlighter.registerLanguage('xml', markup);
SyntaxHighlighter.registerLanguage('css', css);

interface MessageContentProps {
  content: string;
  status: MessageStatus;
}

// ------------------------------------------------------------------
// 工具函数：检测树状图（ASCII Tree）
// ------------------------------------------------------------------
const isTreeDiagram = (code: string): boolean => {
  const lines = code.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const treeChars = /[├└│─┬┼┤┌┐┘┴]/;
  const treeLineCount = lines.filter((l) => treeChars.test(l)).length;
  return treeLineCount >= 1 && treeLineCount / lines.length >= 0.3;
};

// ------------------------------------------------------------------
// 树状图渲染：为连接线字符添加高亮色
// ------------------------------------------------------------------
const TREE_CHAR_REGEX = /[├└│─┬┼┤┌┐┘┴]/g;

const TreeLine: React.FC<{ line: string }> = ({ line }) => {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TREE_CHAR_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${lastIndex}`}>{line.slice(lastIndex, match.index)}</span>
      );
    }
    parts.push(
      <span
        key={`t-${match.index}`}
        className="text-accent-500 dark:text-accent-500 font-bold"
      >
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    parts.push(<span key="t-end">{line.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
};

// ------------------------------------------------------------------
// 复制按钮 Hook
// ------------------------------------------------------------------
const useCopy = (text: string) => {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return { copied, copy };
};

// ------------------------------------------------------------------
// 代码块组件（含语法高亮、复制、语言标签、树状图支持）
// ------------------------------------------------------------------
const CodeBlock: React.FC<{ code: string; language: string }> = ({
  code,
  language,
}) => {
  const { copied, copy } = useCopy(code);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  const displayLang = language || 'text';
  const isTree = isTreeDiagram(code);

  return (
    <div className="group relative rounded-xl overflow-hidden border border-sand-400 my-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-sand-200 dark:bg-sand-300 border-b border-sand-400">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink-200 uppercase tracking-wider">
            {displayLang}
          </span>
          {isTree && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-600 dark:text-accent-500 font-medium">
              tree
            </span>
          )}
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-ink-200 hover:text-ink-400 hover:bg-sand-300 dark:hover:bg-sand-400 transition-colors"
          title="复制代码"
        >
          {copied ? (
            <>
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>已复制</span>
            </>
          ) : (
            <>
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <div className="overflow-x-auto">
        {isTree ? (
          <pre className="p-4 bg-sand-200 dark:bg-sand-300 text-ink-300 dark:text-ink-300 whitespace-pre leading-relaxed text-sm font-mono">
            {code.split('\n').map((line, i) => (
              <div key={i}>
                <TreeLine line={line} />
              </div>
            ))}
          </pre>
        ) : (
          <SyntaxHighlighter
            language={language || 'text'}
            style={isDark ? oneDark : oneLight}
            customStyle={{
              margin: 0,
              padding: '1rem',
              background: 'transparent',
              fontSize: '0.875rem',
              lineHeight: '1.7',
            }}
            codeTagProps={{
              style: {
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              },
            }}
            wrapLongLines={false}
          >
            {code}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// 链接预览悬浮框
// ------------------------------------------------------------------
const LinkPreviewModal: React.FC<{
  url: string;
  onClose: () => void;
}> = ({ url, onClose }) => {
  const [loading, setLoading] = useState(true);
  const domain = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }, [url]);

  // ESC 关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleOpenExternal = async () => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-[90vw] h-[88vh] max-w-6xl bg-white dark:bg-sand-200 rounded-2xl shadow-2xl border border-sand-400/60 overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-sand-400/60 bg-sand-100 dark:bg-sand-300 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <svg
              className="w-4 h-4 text-ink-200 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
              />
            </svg>
            <span className="text-sm text-ink-300 font-medium truncate">
              {domain}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleOpenExternal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-ink-200 hover:text-ink-400 hover:bg-sand-300 dark:hover:bg-sand-400 transition-colors"
              title="在浏览器中打开"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              外部打开
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-ink-200 hover:text-ink-400 hover:bg-sand-300 dark:hover:bg-sand-400 transition-colors"
              title="关闭"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 relative bg-white">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-sand-100/60 z-10">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-sand-400 border-t-ink-400 rounded-full animate-spin" />
                <span className="text-sm text-ink-200">正在加载网页...</span>
              </div>
            </div>
          )}
          <iframe
            src={url}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => setLoading(false)}
            title={domain}
          />
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// MessageContent
// ------------------------------------------------------------------
const MessageContent: React.FC<MessageContentProps> = ({ content, status }) => {
  const isThinking = content.trim() === '' && status === 'streaming';
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const markdownComponents = useMemo<Components>(
    () => ({
      pre({ children }) {
        return <>{children}</>;
      },

      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        const code = String(children).replace(/\n$/, '');

        if (match) {
          return <CodeBlock code={code} language={language} />;
        }

        return (
          <code
            className={`${className || ''} text-ink-400 bg-sand-300/50 dark:bg-sand-400/50 px-1.5 py-0.5 rounded-md font-medium text-[0.875em]`}
            {...props}
          >
            {children}
          </code>
        );
      },

      a({ href, children, ...props }) {
        const isExternal =
          href &&
          (href.startsWith('http://') || href.startsWith('https://'));

        if (!isExternal) {
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        }

        return (
          <a
            href={href}
            {...props}
            onClick={(e) => {
              e.preventDefault();
              setPreviewUrl(href);
            }}
            className="cursor-pointer"
          >
            {children}
          </a>
        );
      },

      table({ children }) {
        return (
          <div className="overflow-x-auto my-4 rounded-xl border border-sand-400">
            <table className="w-full text-sm text-left border-collapse">
              {children}
            </table>
          </div>
        );
      },

      thead({ children }) {
        return (
          <thead className="bg-sand-200 dark:bg-sand-300 text-ink-400 font-semibold">
            {children}
          </thead>
        );
      },

      tr({ children }) {
        return (
          <tr className="border-b border-sand-400 last:border-b-0 hover:bg-sand-200/50 dark:hover:bg-sand-300/50 transition-colors">
            {children}
          </tr>
        );
      },

      th({ children }) {
        return (
          <th className="px-4 py-3 text-ink-400 font-semibold">{children}</th>
        );
      },

      td({ children }) {
        return <td className="px-4 py-3 text-ink-300">{children}</td>;
      },
    }),
    []
  );

  return (
    <div className="w-full text-ink-300 selection:bg-sand-400/50 selection:text-ink-400">
      <article
        className="prose prose-sm md:prose-base max-w-none dark:prose-invert
        leading-[1.75]
        prose-p:leading-[1.85] prose-p:my-3
        prose-headings:text-ink-400 prose-headings:font-bold prose-headings:mt-6 prose-headings:mb-3
        prose-a:text-ink-400 prose-a:underline prose-a:underline-offset-4 hover:prose-a:text-ink-300
        prose-code:text-ink-400 prose-code:bg-sand-300/50 dark:prose-code:bg-sand-400/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-medium prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-transparent prose-pre:p-0
        prose-blockquote:border-l-sand-500 prose-blockquote:text-ink-200 prose-blockquote:pl-4 prose-blockquote:italic
        prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5
        prose-li:my-1.5
        prose-hr:border-sand-400 prose-hr:my-6
        prose-img:rounded-xl prose-img:shadow-panel"
      >
        {isThinking ? (
          <div className="flex items-center gap-3 py-2 select-none">
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full bg-ink-300 animate-bounce"
                style={{ animationDuration: '0.6s', animationDelay: '0ms' }}
              />
              <span
                className="w-2 h-2 rounded-full bg-ink-300 animate-bounce"
                style={{ animationDuration: '0.6s', animationDelay: '0.15s' }}
              />
              <span
                className="w-2 h-2 rounded-full bg-ink-300 animate-bounce"
                style={{ animationDuration: '0.6s', animationDelay: '0.3s' }}
              />
            </div>
            <span className="text-sm text-ink-200 font-medium">思考中...</span>
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
            urlTransform={(url) => {
              if (url.startsWith('data:')) return url;
              return url;
            }}
          >
            {content}
          </ReactMarkdown>
        )}
        {status === 'streaming' && !isThinking && (
          <span
            className="inline-block w-[2px] h-[1.1em] ml-1 bg-ink-400 animate-pulse rounded-full align-middle -translate-y-[1px]"
            aria-hidden="true"
          />
        )}
      </article>

      {previewUrl &&
        createPortal(
          <LinkPreviewModal
            url={previewUrl}
            onClose={() => setPreviewUrl(null)}
          />,
          document.body
        )}
    </div>
  );
};

export default MessageContent;
