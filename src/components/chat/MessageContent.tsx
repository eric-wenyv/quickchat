import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkBreaks from 'remark-breaks';
import type { Components } from 'react-markdown';
import type { MessageActivity, MessageStatus, FileAttachment } from '@/types/types';
import { parseAttachments, formatFileSize, getFileIcon } from '@/utils/file';
import { parseImageDescriptions } from '@/utils/image-description';
import { normalizeStreamingMarkdown } from '@/utils/markdown';
import { isRenderableHtmlArtifact, splitRenderableHtmlArtifacts } from '@/utils/artifacts';
import HtmlArtifact from './HtmlArtifact';

interface MessageContentProps {
  content: string;
  status: MessageStatus;
  activity?: MessageActivity | null;
}

const FileIcon: React.FC<{ type: string }> = ({ type }) => {
  const icon = getFileIcon(type);
  const iconClass = "w-4 h-4 text-linear-text-tertiary";
  switch (icon) {
    case 'image':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      );
    case 'pdf':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'doc':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'sheet':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25-4.5h17.25m-17.25-4.5h17.25M3.375 6h17.25M1.5 6.75v10.5a2.25 2.25 0 002.25 2.25h16.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25z" />
        </svg>
      );
    case 'slide':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
        </svg>
      );
    case 'archive':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      );
    case 'audio':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      );
    case 'video':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
  }
};

const AttachmentList: React.FC<{ attachments: FileAttachment[] }> = ({ attachments }) => {
  const handleDownload = (att: FileAttachment) => {
    const a = document.createElement('a');
    a.href = att.data;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {attachments.map((att) => (
        <button
          key={att.id}
          onClick={() => handleDownload(att)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-linear-border bg-linear-surface/50 hover:bg-linear-surface transition-colors cursor-pointer"
          title={`下载 ${att.name}`}
        >
          <FileIcon type={att.type} />
          <div className="flex flex-col min-w-0 text-left">
            <span className="text-xs text-linear-text-primary font-medium truncate max-w-[140px]">
              {att.name}
            </span>
            <span className="text-[10px] text-linear-text-tertiary">
              {formatFileSize(att.size)}
            </span>
          </div>
          <svg className="w-3.5 h-3.5 text-linear-text-tertiary ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 12.75l3-3m0 0l-3-3m-3 3l3 3m-3-3v7.5" />
          </svg>
        </button>
      ))}
    </div>
  );
};

const isTreeDiagram = (code: string): boolean => {
  const lines = code.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const treeChars = /[├└│─┬┼┤┌┐┘┴]/;
  const treeLineCount = lines.filter((l) => treeChars.test(l)).length;
  return treeLineCount >= 1 && treeLineCount / lines.length >= 0.3;
};

const isMermaidDiagramLanguage = (language: string): boolean =>
  ['mermaid', 'mmd'].includes(language.trim().toLowerCase());

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
        className="text-linear-accent font-bold"
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

const MermaidFullscreenModal: React.FC<{
  svg: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}> = ({ svg, copied, onCopy, onClose }) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex flex-col bg-[#181818]/95 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="flex h-12 flex-shrink-0 items-center justify-between border-b border-linear-border bg-[#202020] px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs font-medium uppercase tracking-wider text-linear-text-tertiary">
          mermaid diagram
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-linear-text-tertiary transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-linear-text-secondary"
            title="复制 Mermaid 源码"
          >
            {copied ? (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>已复制</span>
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>复制</span>
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-linear-text-tertiary transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-linear-text-secondary"
            title="关闭全屏"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div
        className="qc-mermaid-fullscreen-viewport custom-scrollbar flex-1 p-6"
        onClick={(e) => e.stopPropagation()}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>,
    document.body
  );
};

const MermaidBlock: React.FC<{ code: string }> = React.memo(({ code }) => {
  const { copied, copy } = useCopy(code);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  );
  const renderId = useMemo(
    () => `qc-mermaid-${Math.random().toString(36).slice(2)}`,
    []
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

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      setError(null);
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'base',
          themeVariables: {
            background: 'transparent',
            primaryColor: isDark ? '#2c2c2f' : '#f8f8f8',
            primaryTextColor: isDark ? '#f4f4f5' : '#1f2328',
            primaryBorderColor: isDark ? 'rgba(255, 255, 255, 0.22)' : '#d0d7de',
            lineColor: isDark ? '#b8c7d9' : '#57606a',
            secondaryColor: isDark ? '#202020' : '#ffffff',
            tertiaryColor: isDark ? '#343434' : '#f6f8fa',
            textColor: isDark ? '#dedee3' : '#24292f',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontSize: '14px',
          },
          flowchart: {
            htmlLabels: false,
            curve: 'basis',
            nodeSpacing: 38,
            rankSpacing: 48,
            padding: 12,
            useMaxWidth: true,
          },
          sequence: {
            diagramMarginX: 28,
            diagramMarginY: 18,
            actorMargin: 42,
            messageMargin: 34,
            mirrorActors: false,
          },
        });

        const result = await mermaid.render(`${renderId}-${isDark ? 'dark' : 'light'}`, code);
        if (!cancelled) {
          setSvg(result.svg);
        }
      } catch (e) {
        console.warn('Mermaid render failed:', e);
        if (!cancelled) {
          setSvg('');
          setError(e instanceof Error ? e.message : '无法渲染 Mermaid 图表');
        }
      }
    };

    renderDiagram();
    return () => { cancelled = true; };
  }, [code, isDark, renderId]);

  return (
    <div className="not-prose group relative rounded-lg overflow-hidden border border-[rgba(255,255,255,0.12)] bg-[#202020] shadow-linear-highlight my-4">
      <div className="flex items-center justify-between px-4 py-2 bg-[#343434] border-b border-[rgba(255,255,255,0.1)]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-linear-text-tertiary uppercase tracking-wider">
            mermaid
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.075)] text-linear-accent font-medium">
            diagram
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {svg && !error && (
            <button
              onClick={() => setIsFullscreen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              title="全屏查看"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 1v4m0 0h-4m4 0l-5-5" />
              </svg>
              <span>全屏</span>
            </button>
          )}
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            title="复制 Mermaid 源码"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>已复制</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>复制</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error ? (
        <div className="space-y-3 p-4">
          <div className="rounded-md border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            Mermaid 渲染失败，已显示源码。
          </div>
          <pre className="text-linear-text-secondary whitespace-pre leading-relaxed text-sm font-mono overflow-x-auto">
            {code}
          </pre>
        </div>
      ) : svg ? (
        <div
          className="qc-mermaid custom-scrollbar p-4"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex items-center gap-3 p-4 text-sm text-linear-text-tertiary">
          <div className="w-4 h-4 border-2 border-linear-border border-t-linear-text-secondary rounded-full animate-spin" />
          正在渲染图表...
        </div>
      )}
      {isFullscreen && svg && !error && (
        <MermaidFullscreenModal
          svg={svg}
          copied={copied}
          onCopy={copy}
          onClose={() => setIsFullscreen(false)}
        />
      )}
    </div>
  );
});
MermaidBlock.displayName = 'MermaidBlock';

const CodeBlock: React.FC<{ code: string; language: string }> = React.memo(
  ({ code, language }) => {
    const { copied, copy } = useCopy(code);
    const [html, setHtml] = useState('');
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

    useEffect(() => {
      let cancelled = false;
      const highlight = async () => {
        try {
          // Dynamic import so shiki's orchestrator + oniguruma WASM engine
          // and the requested grammar chunk load on demand instead of being
          // statically bundled into the main MessageContent chunk.
          const { codeToHtml } = await import('shiki');
          const result = await codeToHtml(code, {
            lang: language || 'text',
            theme: isDark ? 'github-dark-dimmed' : 'github-light',
          });
          if (!cancelled) setHtml(result);
        } catch (e) {
          console.warn('Shiki highlight failed:', e);
        }
      };
      highlight();
      return () => { cancelled = true; };
    }, [code, language, isDark]);

    const displayLang = language || 'text';
    const isTree = isTreeDiagram(code);

    return (
      <div className="not-prose group relative rounded-lg overflow-hidden border border-[rgba(255,255,255,0.12)] bg-[#202020] shadow-linear-highlight my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#343434] border-b border-[rgba(255,255,255,0.1)]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-linear-text-tertiary uppercase tracking-wider">
              {displayLang}
            </span>
            {isTree && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.075)] text-linear-accent font-medium">
                tree
              </span>
            )}
          </div>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="复制代码"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span>已复制</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>复制</span>
              </>
            )}
          </button>
        </div>

        {/* Code Body */}
        <div className="overflow-x-auto">
          {isTree ? (
            <pre className="p-4 bg-[#202020] text-linear-text-secondary whitespace-pre leading-relaxed text-sm font-mono">
              {code.split('\n').map((line, i) => (
                <div key={i}>
                  <TreeLine line={line} />
                </div>
              ))}
            </pre>
          ) : html ? (
            <div
              className="shiki-code-block"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="p-4 text-linear-text-secondary whitespace-pre leading-relaxed text-sm font-mono">
              {code}
            </pre>
          )}
        </div>
      </div>
    );
  }
);
CodeBlock.displayName = 'CodeBlock';

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
        className="relative flex flex-col w-[90vw] h-[88vh] max-w-6xl bg-linear-bg-elevated rounded-xl shadow-2xl border border-linear-border overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-linear-border bg-linear-bg flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <svg className="w-4 h-4 text-linear-text-tertiary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span className="text-sm text-linear-text-secondary font-medium truncate">
              {domain}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleOpenExternal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface transition-colors"
              title="在浏览器中打开"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              外部打开
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface transition-colors"
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 relative bg-linear-bg">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-linear-bg/60 z-10">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-linear-border border-t-linear-text-secondary rounded-full animate-spin" />
                <span className="text-sm text-linear-text-tertiary">正在加载网页...</span>
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

const ActivityPill: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-3 py-2 select-none">
    <div className="relative inline-flex max-w-full items-center gap-2 overflow-hidden rounded-full border border-linear-border bg-linear-surface px-3 py-1.5">
      <span className="relative z-10 h-3 w-3 flex-shrink-0 rounded-full border-2 border-linear-border border-t-linear-text-secondary animate-spin" />
      <span className="relative z-10 truncate text-xs font-medium tracking-wide text-linear-text-tertiary">
        {label}
      </span>
      <div
        className="absolute inset-0 z-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
          animation: 'shimmer 1.5s linear infinite',
        }}
      />
    </div>
  </div>
);

const MessageContent: React.FC<MessageContentProps> = ({ content, status, activity }) => {
  // 先剥离图片描述注释（不在 UI 中显示），再解析文件附件
  const { text: contentWithoutImgDesc } = parseImageDescriptions(content);
  const { text: textContent, attachments } = parseAttachments(contentWithoutImgDesc);
  const hasTextContent = textContent.trim() !== '';
  const activityLabel = activity?.label ?? (status === 'streaming' && !hasTextContent ? '思考中...' : null);
  const showActivityOnly = status === 'streaming' && !hasTextContent && Boolean(activityLabel);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const normalizedTextContent = useMemo(() => normalizeStreamingMarkdown(textContent), [textContent]);
  const contentSegments = useMemo(
    () => splitRenderableHtmlArtifacts(normalizedTextContent),
    [normalizedTextContent]
  );
  const markdownComponents = useMemo<Components>(
    () => ({
      pre({ children }) {
        return <>{children}</>;
      },

      code({ className, children, ...props }) {
        const match = /language-([\w-]+)/.exec(className || '');
        const language = match ? match[1] : '';
        const code = String(children).replace(/\n$/, '');

        if (match) {
          if (isRenderableHtmlArtifact(code, language)) {
            return <HtmlArtifact code={code} language={language} />;
          }
          if (isMermaidDiagramLanguage(language)) {
            return <MermaidBlock code={code} />;
          }
          return <CodeBlock code={code} language={language} />;
        }

        // Inline code: Linear-style 素雅行内代码
        return (
          <code
            className={`${className || ''} text-linear-text-primary bg-linear-surface-hover border border-linear-border px-1.5 py-0.5 rounded-[4px] font-medium text-[0.875em]`}
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
            className="cursor-pointer text-linear-text-secondary underline underline-offset-4 hover:text-linear-text-primary transition-colors"
          >
            {children}
          </a>
        );
      },

      table({ children }) {
        return (
          <div className="overflow-x-auto my-4 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#202020]">
            <table className="w-full text-sm text-left border-collapse">
              {children}
            </table>
          </div>
        );
      },

      thead({ children }) {
        return (
          <thead className="bg-[#343434] text-linear-text-primary font-semibold">
            {children}
          </thead>
        );
      },

      tr({ children }) {
        return (
          <tr className="border-b border-[rgba(255,255,255,0.09)] last:border-b-0 hover:bg-[rgba(255,255,255,0.05)] transition-colors">
            {children}
          </tr>
        );
      },

      th({ children }) {
        return (
          <th className="px-4 py-3 text-linear-text-primary font-semibold">{children}</th>
        );
      },

      td({ children }) {
        return <td className="px-4 py-3 text-linear-text-body">{children}</td>;
      },
    }),
    []
  );

  return (
    <div className="w-full text-linear-text-body selection:bg-linear-surface-hover selection:text-linear-text-primary">
      <article className="w-full">
        {showActivityOnly && activityLabel ? (
          <ActivityPill label={activityLabel} />
        ) : (
          <div className="qc-markdown prose prose-sm max-w-none dark:prose-invert leading-[1.6] prose-p:leading-[1.6] prose-p:my-2.5 prose-p:text-linear-text-body prose-headings:text-linear-text-primary prose-headings:font-semibold prose-headings:tracking-tight prose-headings:leading-tight prose-headings:mt-5 prose-headings:mb-2 prose-h1:text-[1.15em] prose-h2:text-[1.08em] prose-h3:text-[1.05em] prose-strong:text-linear-text-primary prose-strong:font-semibold prose-a:text-linear-text-secondary prose-a:underline prose-a:underline-offset-4 hover:prose-a:text-linear-text-primary prose-code:text-linear-text-primary prose-code:bg-linear-surface-hover prose-code:border prose-code:border-linear-border prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-[4px] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-pre:bg-transparent prose-pre:p-0 prose-blockquote:border-l-[rgba(255,255,255,0.16)] prose-blockquote:text-linear-text-tertiary prose-blockquote:bg-[#202020] prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:not-italic prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5 prose-li:my-1 prose-li:text-linear-text-body prose-hr:border-[rgba(255,255,255,0.12)] prose-hr:my-5 prose-img:rounded-lg prose-img:shadow-none">
            {contentSegments.map((segment, index) =>
              segment.type === 'artifact' ? (
                <HtmlArtifact
                  key={`artifact-${index}`}
                  code={segment.content}
                  language={segment.language}
                />
              ) : (
                <ReactMarkdown
                  key={`markdown-${index}`}
                  remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                  rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                  urlTransform={(url) => {
                    if (url.startsWith('data:')) return url;
                    return url;
                  }}
                >
                  {segment.content}
                </ReactMarkdown>
              )
            )}
            {attachments.length > 0 && <AttachmentList attachments={attachments} />}
          </div>
        )}
        {status === 'streaming' && !showActivityOnly && (
          <span
            className="inline-block w-[2px] h-[1.1em] ml-1 bg-linear-accent rounded-sm align-middle -translate-y-[1px]"
            style={{ animation: 'terminal-blink 1.2s ease-in-out infinite' }}
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
