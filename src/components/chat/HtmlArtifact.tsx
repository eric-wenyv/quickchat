import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildArtifactSrcDoc, fitArtifactToViewport, type ArtifactSize } from '@/utils/artifacts';
import ArtifactFullscreenShell from './ArtifactFullscreenShell';

interface HtmlArtifactProps {
  code: string;
  language: string;
}

type ArtifactView = 'preview' | 'source';

const MIN_ARTIFACT_HEIGHT = 280;
const DEFAULT_ARTIFACT_HEIGHT = 520;

function extractTitle(code: string): string {
  const match = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || 'HTML Artifact';
}

function useCopyText(text: string) {
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
    window.setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return { copied, copy };
}

const PreviewIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <path d="M8 21h8M12 18v3" />
  </svg>
);

const CodeIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </svg>
);

const CopyIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
    <rect x="8" y="8" width="12" height="12" rx="2" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path d="m5 13 4 4L19 7" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
  </svg>
);

const ExpandIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path d="M6 18 18 6M6 6l12 12" />
  </svg>
);

const ControlButton: React.FC<{
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, active = false, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${active
        ? 'bg-linear-surface-hover text-linear-text-primary'
        : 'text-linear-text-tertiary hover:bg-linear-surface-hover hover:text-linear-text-secondary'
      }`}
    title={title}
    aria-label={title}
  >
    {children}
  </button>
);

const ArtifactControls: React.FC<{
  view: ArtifactView;
  copied: boolean;
  onViewChange: (view: ArtifactView) => void;
  onCopy: () => void;
  onReload: () => void;
  onExpand?: () => void;
  onClose?: () => void;
  alwaysVisible?: boolean;
  mode?: 'floating' | 'toolbar';
}> = ({ view, copied, onViewChange, onCopy, onReload, onExpand, onClose, alwaysVisible = false, mode = 'floating' }) => (
  <div
    className={
      mode === 'toolbar'
        ? 'flex items-center gap-1'
        : `absolute right-2 top-2 z-20 flex items-center gap-1 rounded-xl bg-linear-bg/80 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.28)] ring-1 ring-white/10 backdrop-blur-xl transition-opacity duration-150 ${alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
        }`
    }
  >
    <ControlButton title="预览" active={view === 'preview'} onClick={() => onViewChange('preview')}>
      <PreviewIcon />
    </ControlButton>
    <ControlButton title="源码" active={view === 'source'} onClick={() => onViewChange('source')}>
      <CodeIcon />
    </ControlButton>
    <span className="mx-0.5 h-4 w-px bg-linear-border" aria-hidden="true" />
    <ControlButton title="重新加载" onClick={onReload}>
      <RefreshIcon />
    </ControlButton>
    <ControlButton title={copied ? '已复制' : '复制源码'} onClick={onCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </ControlButton>
    {onExpand && (
      <ControlButton title="全屏查看" onClick={onExpand}>
        <ExpandIcon />
      </ControlButton>
    )}
    {onClose && (
      <ControlButton title="关闭" onClick={onClose}>
        <CloseIcon />
      </ControlButton>
    )}
  </div>
);

// 流式期间 srcDoc 随每个 flush 增长，去抖等稳定后再让 iframe 重导航：
// 高频 srcdoc 变更会触发不可靠的连发导航，且每次都重执行演示脚本
const ARTIFACT_SRCDOC_DEBOUNCE_MS = 300;
// 兜底：个别情况下 load 事件不派发时超时撤下遮罩——内容多半已渲染，
// 不能让 loading 遮罩永久挡住交互
const ARTIFACT_LOAD_TIMEOUT_MS = 4000;

const ArtifactFrame: React.FC<{
  artifactId: string;
  srcDoc: string;
  title: string;
  reloadKey: number;
  className?: string;
  fitSize?: ArtifactSize;
  onSizeChange?: (size: ArtifactSize) => void;
}> = ({ artifactId, srcDoc, title, reloadKey, className = '', fitSize, onSizeChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [contentSize, setContentSize] = useState(fitSize ?? { width: 960, height: DEFAULT_ARTIFACT_HEIGHT });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [displayedSrcDoc, setDisplayedSrcDoc] = useState(srcDoc);
  const [generation, setGeneration] = useState(0);
  // loading 由「当前 (generation, reloadKey) 是否已确认加载」推导，而不是
  // effect 置位再等 onLoad 翻转布尔：两个异步信号的先后不确定时，
  // onLoad 先于最后一次提交到达会永久卡在加载态，演示只能手动刷新才可交互
  const [loadedFrame, setLoadedFrame] = useState<{ generation: number; reloadKey: number } | null>(null);

  // iframe 保持预览时的逻辑尺寸，从外部整体缩放，布局与内部交互坐标保持一致。
  const fitToViewport = Boolean(fitSize);
  useEffect(() => {
    if (!fitToViewport || !containerRef.current) return;
    const container = containerRef.current;
    const measure = () => {
      const { width, height } = container.getBoundingClientRect();
      setViewportSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitToViewport]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (
        event.source !== frameRef.current?.contentWindow ||
        data?.type !== 'quick-chat-artifact-size' ||
        data.artifactId !== artifactId
      ) return;
      const width = Number(data.width);
      const height = Number(data.height);
      if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return;
      const size = { width: Math.ceil(width), height: Math.ceil(height) };
      if (fitToViewport) {
        setContentSize((current) => current.width === size.width && current.height === size.height ? current : size);
      }
      onSizeChange?.(size);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [artifactId, fitToViewport, onSizeChange]);

  useEffect(() => {
    if (srcDoc === displayedSrcDoc) return;
    const timer = window.setTimeout(() => {
      setDisplayedSrcDoc(srcDoc);
      setGeneration((current) => current + 1);
    }, ARTIFACT_SRCDOC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [srcDoc, displayedSrcDoc]);

  const loading =
    !loadedFrame ||
    loadedFrame.generation !== generation ||
    loadedFrame.reloadKey !== reloadKey;

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(
      () => setLoadedFrame({ generation, reloadKey }),
      ARTIFACT_LOAD_TIMEOUT_MS
    );
    return () => window.clearTimeout(timer);
  }, [loading, generation, reloadKey]);

  const fit = fitArtifactToViewport(contentSize, viewportSize);

  return (
    <div ref={containerRef} className={`relative min-w-0 max-w-full overflow-hidden bg-transparent ${className}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-linear-bg/55 backdrop-blur-[1px]">
          <div className="h-5 w-5 rounded-full border-2 border-linear-border border-t-linear-text-secondary animate-spin" />
        </div>
      )}
      <iframe
        ref={frameRef}
        key={`${reloadKey}-${generation}`}
        title={title}
        srcDoc={displayedSrcDoc}
        className="block h-full w-full max-w-full border-0 bg-transparent"
        style={fitToViewport ? {
          position: 'absolute',
          left: fit.x,
          top: fit.y,
          width: contentSize.width,
          height: contentSize.height,
          maxWidth: 'none',
          transform: `scale(${fit.scale})`,
          transformOrigin: '0 0',
          visibility: fit.scale > 0 ? 'visible' : 'hidden',
        } : undefined}
        sandbox="allow-scripts allow-forms"
        scrolling="no"
        referrerPolicy="no-referrer"
        onLoad={() => setLoadedFrame({ generation, reloadKey })}
      />
    </div>
  );
};

const SourceView: React.FC<{ code: string; topPadding?: boolean }> = ({ code, topPadding = true }) => (
  <pre className={`h-full max-w-full overflow-auto custom-scrollbar bg-linear-bg/90 p-4 text-xs leading-relaxed text-linear-text-secondary font-mono whitespace-pre ${topPadding ? 'pt-12' : ''}`}>
    {code}
  </pre>
);

const HtmlArtifactModal: React.FC<{
  artifactId: string;
  size: ArtifactSize;
  code: string;
  srcDoc: string;
  title: string;
  view: ArtifactView;
  reloadKey: number;
  onViewChange: (view: ArtifactView) => void;
  onReload: () => void;
  onClose: () => void;
}> = ({ artifactId, size, code, srcDoc, title, view, reloadKey, onViewChange, onReload, onClose }) => {
  const { copied, copy } = useCopyText(code);

  return (
    <ArtifactFullscreenShell
      title={title}
      onClose={onClose}
      actions={
        <ArtifactControls
          view={view}
          copied={copied}
          onViewChange={onViewChange}
          onCopy={copy}
          onReload={onReload}
          onClose={onClose}
          mode="toolbar"
        />
      }
      contentClassName="overflow-hidden"
    >
        {view === 'preview' ? (
          <ArtifactFrame
            artifactId={artifactId}
            srcDoc={srcDoc}
            title={title}
            reloadKey={reloadKey}
            fitSize={size}
            className="h-full"
          />
        ) : (
          <SourceView code={code} topPadding={false} />
        )}
    </ArtifactFullscreenShell>
  );
};

const HtmlArtifact: React.FC<HtmlArtifactProps> = ({ code }) => {
  const [artifactId] = useState(() =>
    globalThis.crypto?.randomUUID?.() ?? `artifact-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const [modalArtifactId] = useState(() =>
    globalThis.crypto?.randomUUID?.() ?? `artifact-modal-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const srcDoc = useMemo(() => buildArtifactSrcDoc(code, artifactId), [code, artifactId]);
  const modalSrcDoc = useMemo(() => buildArtifactSrcDoc(code, modalArtifactId), [code, modalArtifactId]);
  const title = useMemo(() => extractTitle(code), [code]);
  const { copied, copy } = useCopyText(code);
  const [view, setView] = useState<ArtifactView>('preview');
  const [reloadKey, setReloadKey] = useState(0);
  const [artifactSize, setArtifactSize] = useState({ width: 960, height: DEFAULT_ARTIFACT_HEIGHT });
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleReload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const handleSizeChange = useCallback((size: ArtifactSize) => {
    setArtifactSize((current) =>
      Math.abs(current.width - size.width) < 2 && Math.abs(current.height - size.height) < 2 ? current : size
    );
  }, []);

  return (
    <>
      <div
        className="group relative my-3 w-full max-w-full overflow-hidden bg-transparent"
        style={{ height: Math.max(MIN_ARTIFACT_HEIGHT, artifactSize.height), minHeight: MIN_ARTIFACT_HEIGHT }}
      >
        <ArtifactControls
          view={view}
          copied={copied}
          onViewChange={setView}
          onCopy={copy}
          onReload={handleReload}
          onExpand={() => setIsFullscreen(true)}
        />
        {view === 'preview' ? (
          <ArtifactFrame
            artifactId={artifactId}
            srcDoc={srcDoc}
            title={title}
            reloadKey={reloadKey}
            onSizeChange={handleSizeChange}
            className="h-full"
          />
        ) : (
          <SourceView code={code} />
        )}
      </div>

      {isFullscreen &&
        createPortal(
          <HtmlArtifactModal
            artifactId={modalArtifactId}
            size={artifactSize}
            code={code}
            srcDoc={modalSrcDoc}
            title={title}
            view={view}
            reloadKey={reloadKey}
            onViewChange={setView}
            onReload={handleReload}
            onClose={() => setIsFullscreen(false)}
          />,
          document.body
        )}
    </>
  );
};

// memo：流式期间父级高频重渲染，code 未变化的 artifact（iframe/源码视图）应跳过
export default React.memo(HtmlArtifact);
