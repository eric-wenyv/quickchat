import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Components } from 'react-markdown';
import type { MessageActivity, MessageStatus, FileAttachment } from '@/types/types';
import { parseAttachments, formatFileSize, getFileIcon } from '@/utils/file';
import { parseImageDescriptions } from '@/utils/image-description';
import { stripSkillContext, getSkillContextId, parseSkillInvocation } from '@/utils/skill-context';
import { normalizeStreamingMarkdown } from '@/utils/markdown';
import { isRenderableHtmlArtifact, splitRenderableHtmlArtifacts } from '@/utils/artifacts';
import useCopy from '@/hooks/useCopy';
import ArtifactFullscreenShell from './ArtifactFullscreenShell';
import HtmlArtifact from './HtmlArtifact';
import ThinkingBlock, { ThinkingIndicator } from './ThinkingBlock';
import { splitMarkdownBlocks, MarkdownBlock } from './markdown-blocks';
import { requestHighlight, type HighlightRequest } from '@/utils/code-highlight';
import { getMermaidSvgCache, setMermaidSvgCache } from '@/services/db';
import { invoke } from '@/services/bridge';

interface MessageContentProps {
  content: string;
  status: MessageStatus;
  activity?: MessageActivity | null;
  /** 思考模型返回的推理内容（存在时展示 ThinkingBlock） */
  reasoning?: string | null;
  /** 思考阶段耗时（毫秒） */
  thinkingMs?: number | null;
  /**
   * 打开会话时的过渡形态：跳过 remark/rehype 管线，纯文本 + 图片直接铺出，
   * 由 MessageList 在首帧绘制后逐条升级为完整 markdown 渲染
   */
  deferRich?: boolean;
}

const DEFERRED_IMAGE_REGEX = /!\[[^\]]*\]\((data:image\/[^;)]+;base64,[A-Za-z0-9+/=]+)\)/g;

/** 延迟渲染占位：不跑 markdown 管线，正文按纯文本铺出，内嵌 base64 图片照常显示 */
const DeferredPlainContent: React.FC<{ text: string }> = React.memo(({ text }) => {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  DEFERRED_IMAGE_REGEX.lastIndex = 0;
  let i = 0;
  while ((match = DEFERRED_IMAGE_REGEX.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(<span key={`t${i}`}>{text.slice(last, match.index)}</span>);
    }
    parts.push(
      <img key={`i${i}`} src={match[1]} alt="" loading="lazy" decoding="async" className="rounded-lg" />
    );
    last = match.index + match[0].length;
    i++;
  }
  if (last < text.length) {
    parts.push(<span key={`t${i}`}>{text.slice(last)}</span>);
  }
  return <div className="whitespace-pre-wrap break-words leading-[1.6]">{parts}</div>;
});
DeferredPlainContent.displayName = 'DeferredPlainContent';

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

// ---------------------------------------------------------------------------
// 流式 Markdown 分块渲染（splitMarkdownBlocks / MarkdownBlock 见 markdown-blocks.tsx）
// ---------------------------------------------------------------------------

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

const MERMAID_MIN_SCALE = 0.25;
const MERMAID_MAX_SCALE = 4;
const MERMAID_ZOOM_FACTOR = 1.12;
const DEFAULT_MERMAID_SVG_SIZE = { width: 960, height: 640 };

const clampMermaidScale = (scale: number): number =>
  Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, scale));

// 全屏位图单边上限：WebKit 分块合成层超过纹理上限会退化成逐帧重绘，
// 复杂矢量图拖动时每个新露出的分块都要重新光栅化，是全屏卡顿的主因。
const MERMAID_RASTER_MAX_EDGE = 4096;

// 拖动限位：内容大于视口时至少保留这么多像素在屏内，防止图被拖丢找不回来
const MERMAID_MIN_OVERLAP_PX = 32;

const parseMermaidSvgSize = (svg: string): { width: number; height: number } => {
  const viewBox = /viewBox=["']([^"']+)["']/i.exec(svg)?.[1];
  const viewBoxParts = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));

  if (
    viewBoxParts?.length === 4 &&
    Number.isFinite(viewBoxParts[2]) &&
    Number.isFinite(viewBoxParts[3]) &&
    viewBoxParts[2] > 0 &&
    viewBoxParts[3] > 0
  ) {
    return { width: viewBoxParts[2], height: viewBoxParts[3] };
  }

  const width = Number.parseFloat(/width=["'](\d+(?:\.\d+)?)(?:px)?["']/i.exec(svg)?.[1] ?? '');
  const height = Number.parseFloat(/height=["'](\d+(?:\.\d+)?)(?:px)?["']/i.exec(svg)?.[1] ?? '');

  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }

  return DEFAULT_MERMAID_SVG_SIZE;
};

// 把 mermaid 输出的 SVG 光栅化成位图金字塔（原始层 + 1/4、1/16 降采样层）：
// 全屏视口画布按当前缩放选层 blit，保证任何缩放下每帧读取的源像素量都有界。
// 失败时调用方回退矢量渲染。
const buildMermaidRaster = (
  svg: string,
  size: { width: number; height: number }
): Promise<HTMLCanvasElement[]> =>
  new Promise((resolve, reject) => {
    // SVG 作为独立图片加载时根节点必须有确定的像素尺寸，否则 drawImage 可能拿到空图
    const sized = svg.replace(/<svg([^>]*)>/i, (_match, attrs: string) => {
      const cleaned = attrs
        .replace(/\s(width|height)=["'][^"']*["']/gi, '')
        .replace(/\sstyle=["'][^"']*["']/i, '');
      return `<svg${cleaned} width="${size.width}" height="${size.height}">`;
    });

    const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      try {
        const rasterScale = Math.min(
          MERMAID_MAX_SCALE,
          MERMAID_RASTER_MAX_EDGE / Math.max(size.width, size.height)
        );
        const base = document.createElement('canvas');
        base.width = Math.max(1, Math.round(size.width * rasterScale));
        base.height = Math.max(1, Math.round(size.height * rasterScale));
        const ctx = base.getContext('2d');
        if (!ctx) throw new Error('canvas 2d context unavailable');
        ctx.drawImage(img, 0, 0, base.width, base.height);

        const levels = [base];
        let current = base;
        while (current.width > 512 && current.height > 512 && levels.length < 3) {
          const down = document.createElement('canvas');
          down.width = Math.max(1, Math.round(current.width / 4));
          down.height = Math.max(1, Math.round(current.height / 4));
          const downCtx = down.getContext('2d');
          if (!downCtx) break;
          downCtx.imageSmoothingEnabled = true;
          downCtx.imageSmoothingQuality = 'high';
          downCtx.drawImage(current, 0, 0, down.width, down.height);
          levels.push(down);
          current = down;
        }

        cleanup();
        resolve(levels);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('mermaid svg image decode failed'));
    };
    img.src = url;
  });

const MermaidFullscreenModal: React.FC<{
  svg: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}> = ({ svg, copied, onCopy, onClose }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  // 平移/缩放只存 ref，rAF 统一应用：pointermove 不触发 React 渲染
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef({ width: 0, height: 0 });
  const rafRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [rasterLevels, setRasterLevels] = useState<HTMLCanvasElement[] | null>(null);
  const svgSize = useMemo(() => parseMermaidSvgSize(svg), [svg]);

  // draw / resetView 在 rAF 里跑，读最新值用 latest-ref
  const svgSizeRef = useRef(svgSize);
  svgSizeRef.current = svgSize;
  const rasterRef = useRef<HTMLCanvasElement[] | null>(rasterLevels);
  rasterRef.current = rasterLevels;

  // 矢量兜底路径：CSS transform 直写（光栅化失败时才走）
  const applyVectorTransform = useCallback(() => {
    rafRef.current = 0;
    const { scale, x, y } = transformRef.current;
    if (layerRef.current) {
      layerRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (contentRef.current) {
      contentRef.current.style.transform = `scale(${scale})`;
    }
  }, []);

  // 视口画布：每帧只把可见区域从金字塔位图 blit 到与视口同尺寸的 canvas。
  // 画布自身永远全可见，合成器没有"懒光栅化新区域"一说，
  // 第一次拖动和之后的每帧成本完全一致。
  const draw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const levels = rasterRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !levels?.length) return;

    const { width: vw, height: vh } = viewRef.current;
    const { width: W, height: H } = svgSizeRef.current;
    let { scale, x, y } = transformRef.current;

    // 小于视口居中；大于视口时至少保留一角在屏内，防止图被拖丢
    const cw = W * scale;
    const ch = H * scale;
    x = cw <= vw ? (vw - cw) / 2 : Math.min(Math.max(x, vw - cw - MERMAID_MIN_OVERLAP_PX), MERMAID_MIN_OVERLAP_PX);
    y = ch <= vh ? (vh - ch) / 2 : Math.min(Math.max(y, vh - ch - MERMAID_MIN_OVERLAP_PX), MERMAID_MIN_OVERLAP_PX);
    transformRef.current.x = x;
    transformRef.current.y = y;

    ctx.clearRect(0, 0, vw, vh);

    // 选层：从最小层开始，找到源采样率仍 >= 屏幕像素密度的最小层
    const dpr = vw > 0 ? canvas.width / vw : 1;
    let level = levels[0];
    for (let i = levels.length - 1; i >= 0; i--) {
      level = levels[i];
      if (levels[i].width / W / scale >= dpr) break;
    }

    // 位图整体映射到屏幕后的可见裁剪，保证 drawImage 源矩形始终在界内
    const k = level.width / W;
    const srcPerScreen = k / scale;
    const clipX = Math.max(x, 0);
    const clipY = Math.max(y, 0);
    const clipR = Math.min(x + cw, vw);
    const clipB = Math.min(y + ch, vh);
    if (clipR <= clipX || clipB <= clipY) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      level,
      (clipX - x) * srcPerScreen,
      (clipY - y) * srcPerScreen,
      (clipR - clipX) * srcPerScreen,
      (clipB - clipY) * srcPerScreen,
      clipX,
      clipY,
      clipR - clipX,
      clipB - clipY
    );
  }, []);

  const scheduleApply = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        if (rasterRef.current) draw();
        else applyVectorTransform();
      });
    }
  }, [draw, applyVectorTransform]);

  // 同步 flush 未应用的变换，保证随后的锚点计算与 ref 一致
  const flushApply = useCallback(() => {
    if (!rafRef.current) return;
    cancelAnimationFrame(rafRef.current);
    if (rasterRef.current) draw();
    else applyVectorTransform();
  }, [draw, applyVectorTransform]);

  const syncCanvasSize = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    viewRef.current = { width: rect.width, height: rect.height };
    const canvas = canvasRef.current;
    if (canvas && rect.width > 0 && rect.height > 0) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }, []);

  const resetView = useCallback(() => {
    if (rasterRef.current) {
      // 视口画布模式居中要自己算（矢量模式由 flex stage 居中）
      const { width: vw, height: vh } = viewRef.current;
      const { width: W, height: H } = svgSizeRef.current;
      transformRef.current = { scale: 1, x: (vw - W) / 2, y: (vh - H) / 2 };
    } else {
      transformRef.current = { scale: 1, x: 0, y: 0 };
    }
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // 视口尺寸跟踪（声明在最前：后续 effect 依赖 viewRef 已就绪）
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onResize = () => {
      syncCanvasSize();
      scheduleApply();
    };
    syncCanvasSize();
    const observer = new ResizeObserver(onResize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [syncCanvasSize, scheduleApply]);

  useEffect(() => {
    let cancelled = false;
    setRasterLevels(null);
    buildMermaidRaster(svg, svgSize).then(
      (levels) => {
        if (!cancelled) setRasterLevels(levels);
      },
      () => {
        // 光栅化失败则一直用矢量兜底（rasterLevels 保持 null）
      }
    );
    return () => {
      cancelled = true;
    };
  }, [svg, svgSize]);

  // 位图就绪/换图：canvas 挂载后重新量尺寸并复位视图
  useEffect(() => {
    if (!rasterLevels) return;
    syncCanvasSize();
    resetView();
    scheduleApply();
  }, [rasterLevels, syncCanvasSize, resetView, scheduleApply]);

  // 换图复位（svg 变化 = 主题切换重渲染）
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    resetView();
    scheduleApply();
  }, [svg, resetView, scheduleApply]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  // ctrl+滚轮缩放：React 的 onWheel 是 passive 监听，preventDefault 无效，
  // 必须用原生非 passive 监听才能拦下浏览器缩放
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;

      event.preventDefault();
      event.stopPropagation();

      flushApply();
      const { scale, x, y } = transformRef.current;
      const nextScale = clampMermaidScale(
        scale * (event.deltaY < 0 ? MERMAID_ZOOM_FACTOR : 1 / MERMAID_ZOOM_FACTOR)
      );
      if (nextScale === scale) return;

      if (rasterRef.current) {
        const rect = viewport.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        transformRef.current = {
          scale: nextScale,
          x: px - ((px - x) / scale) * nextScale,
          y: py - ((py - y) / scale) * nextScale,
        };
      } else {
        const content = contentRef.current;
        if (!content) {
          transformRef.current = { ...transformRef.current, scale: nextScale };
          scheduleApply();
          return;
        }
        const rect = content.getBoundingClientRect();
        const localX = (event.clientX - rect.left) / scale;
        const localY = (event.clientY - rect.top) / scale;
        transformRef.current = {
          scale: nextScale,
          x: x - localX * (nextScale - scale),
          y: y - localY * (nextScale - scale),
        };
      }
      scheduleApply();
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [flushApply, scheduleApply]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      flushApply();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: transformRef.current.x,
        originY: transformRef.current.y,
      };
      setIsDragging(true);
    },
    [flushApply]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.preventDefault();
      transformRef.current.x = drag.originX + event.clientX - drag.startX;
      transformRef.current.y = drag.originY + event.clientY - drag.startY;
      scheduleApply();
    },
    [scheduleApply]
  );

  const stopDragging = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  return createPortal(
    <ArtifactFullscreenShell
      title="mermaid diagram"
      onClose={onClose}
      actions={
        <>
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
        </>
      }
      contentClassName="overflow-hidden"
    >
      <div
        ref={viewportRef}
        className={`qc-mermaid-pan-viewport h-full ${isDragging ? 'is-dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        {rasterLevels ? (
          <canvas ref={canvasRef} className="qc-mermaid-pan-canvas" />
        ) : (
          <div className="qc-mermaid-pan-stage">
            <div ref={layerRef} className="qc-mermaid-pan-layer">
              <div
                ref={contentRef}
                className="qc-mermaid-pan-content"
                style={{ width: svgSize.width, height: svgSize.height }}
              >
                <div
                  className="qc-mermaid-pan-vector"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </ArtifactFullscreenShell>,
    document.body
  );
};

// Mermaid 渲染是全量布局计算，成本远高于语法高亮；流式期间图源码
// 一直在增长，等稳定后再渲染，完成后必定出图。
const MERMAID_RENDER_DEBOUNCE_MS = 400;

// 进程内缓存：命中时同步出图，连 IPC 都省掉。持久缓存见 db.ts mermaid_svgs 表
const MERMAID_MEM_CACHE_LIMIT = 50;
const mermaidSvgMemCache = new Map<string, string>();

function readMermaidMemCache(key: string): string | undefined {
  const hit = mermaidSvgMemCache.get(key);
  if (hit !== undefined) {
    mermaidSvgMemCache.delete(key);
    mermaidSvgMemCache.set(key, hit);
  }
  return hit;
}

function writeMermaidMemCache(key: string, svg: string): void {
  mermaidSvgMemCache.set(key, svg);
  if (mermaidSvgMemCache.size > MERMAID_MEM_CACHE_LIMIT) {
    const oldest = mermaidSvgMemCache.keys().next().value;
    if (oldest !== undefined) mermaidSvgMemCache.delete(oldest);
  }
}

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
    let timer: number | null = null;
    // 渲染输出只取决于 (主题, 源码)：先查两级缓存，未命中才真正渲染
    const cacheKey = `${isDark ? 'd' : 'l'}|${code}`;

    const memHit = readMermaidMemCache(cacheKey);
    if (memHit !== undefined) {
      setError(null);
      setSvg(memHit);
      return;
    }

    const renderAndCache = async () => {
      setError(null);
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
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
          writeMermaidMemCache(cacheKey, result.svg);
          // 持久化缓存（后台写入，失败不影响展示）
          setMermaidSvgCache(cacheKey, result.svg).catch(() => {});
        }
      } catch (e) {
        console.warn('Mermaid render failed:', e);
        if (!cancelled) {
          setSvg('');
          setError(e instanceof Error ? e.message : '无法渲染 Mermaid 图表');
        }
      }
    };

    void (async () => {
      // 持久缓存查询很快（几毫秒），不等防抖直接查；只有真正需要渲染时
      // 才走防抖——流式期间图源码一直在增长，等稳定后再渲染
      try {
        const dbHit = await getMermaidSvgCache(cacheKey);
        if (cancelled) return;
        if (dbHit !== null) {
          writeMermaidMemCache(cacheKey, dbHit);
          setError(null);
          setSvg(dbHit);
          return;
        }
      } catch {
        // 缓存读取失败不影响正常渲染
      }
      timer = window.setTimeout(() => void renderAndCache(), MERMAID_RENDER_DEBOUNCE_MS);
    })();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [code, isDark, renderId]);

  return (
    <div className="not-prose group relative my-4 max-w-full overflow-hidden rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#202020] shadow-linear-highlight">
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
          <pre className="max-w-full overflow-x-auto text-linear-text-secondary whitespace-pre leading-relaxed text-sm font-mono">
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

// 流式期间代码块内容高频增长，每次变化都跑一遍 shiki 高亮纯属浪费；
// 去抖等源码稳定后再高亮（最后一次变更总会触发，完成后必定着色）。
// 去抖之后的执行由 @/utils/code-highlight 的串行队列接管，避免批量高亮打满主线程。
const SHIKI_HIGHLIGHT_DEBOUNCE_MS = 200;

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
      let request: HighlightRequest | null = null;
      const timer = window.setTimeout(() => {
        // 高亮经模块级串行队列执行（块间让出主线程），结果按 (主题, 语言, 源码) 缓存
        request = requestHighlight(code, language || 'text', isDark);
        request.promise.then(
          (result) => {
            if (!cancelled) setHtml(result);
          },
          (e) => {
            console.warn('Shiki highlight failed:', e);
          }
        );
      }, SHIKI_HIGHLIGHT_DEBOUNCE_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        request?.cancel();
      };
    }, [code, language, isDark]);

    const displayLang = language || 'text';
    const isTree = isTreeDiagram(code);

    return (
      <div className="not-prose group relative my-4 max-w-full overflow-hidden rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#202020] shadow-linear-highlight">
        {/* Header */}
        <div data-no-block-select className="flex items-center justify-between px-4 py-2 bg-[#343434] border-b border-[rgba(255,255,255,0.1)]">
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
        <div className="max-w-full overflow-x-auto">
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
      await invoke('opener:open', { url });
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

const MessageContent: React.FC<MessageContentProps> = ({ content, status, activity, reasoning, thinkingMs, deferRich }) => {
  // 先剥离 Skill 上下文注释（/ 命令注入，UI 不显示），再剥离图片描述注释，最后解析文件附件
  const contentWithoutSkillCtx = useMemo(() => stripSkillContext(content), [content]);
  const parsedImageDescriptions = useMemo(
    () => parseImageDescriptions(contentWithoutSkillCtx),
    [contentWithoutSkillCtx]
  );
  const contentWithoutImgDesc = parsedImageDescriptions.text;
  const parsedAttachments = useMemo(
    () => parseAttachments(contentWithoutImgDesc),
    [contentWithoutImgDesc]
  );
  const textContent = parsedAttachments.text;
  const attachments = parsedAttachments.attachments;
  const hasTextContent = textContent.trim() !== '';
  // 斜杠命令成功注入 skill（消息含 skill-context 注释块）时，正文开头的
  // /skill-id 以着色字体渲染（仅改字体颜色，不加 UI），正文保持原样
  const skillInvocation = useMemo(() => {
    const contextId = getSkillContextId(content);
    if (!contextId) return null;
    const invocation = parseSkillInvocation(textContent);
    return invocation && invocation.id === contextId ? invocation : null;
  }, [content, textContent]);
  const hasReasoning = Boolean(reasoning?.trim());
  const isStreamingNoText = status === 'streaming' && !hasTextContent;
  // 思考分片尚未到达的等待期与流式思考期共用 ThinkingIndicator 统一动画；
  // ActivityPill 仅保留给工具调用等活动提示
  const activityLabel = activity?.label ?? (isStreamingNoText && !hasReasoning ? '思考中...' : null);
  const showActivityOnly = isStreamingNoText && !hasReasoning && Boolean(activityLabel);
  const showToolPill = status === 'streaming' && activity?.kind === 'tool';
  // 思考是否进行中由 activity 显式标记（每轮工具调用后都会重新置为 thinking），
  // 不限定"尚无正文"——混合响应里上一轮已流出前言正文，新一轮思考仍要 live 展示
  const isThinkingLive = status === 'streaming' && activity?.kind === 'thinking';
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const normalizedTextContent = useMemo(() => normalizeStreamingMarkdown(textContent), [textContent]);
  const contentSegments = useMemo(
    () => splitRenderableHtmlArtifacts(normalizedTextContent),
    [normalizedTextContent]
  );
  // 流式期间按顶层块切分：每次刷新只需重新解析正在增长的末块，
  // 已完成的块命中 MarkdownBlock 的 memo 直接跳过 remark/rehype 管线。
  // 完成态整段渲染（引用式链接等跨块语法以完成态为准）。
  const markdownSegmentBlocks = useMemo(
    () => contentSegments.map(segment =>
      segment.type === 'markdown' && status === 'streaming'
        ? { type: 'markdown' as const, blocks: splitMarkdownBlocks(segment.content) }
        : { type: 'markdown' as const, blocks: [segment.content] }
    ),
    [contentSegments, status]
  );
  const markdownComponents = useMemo<Components>(
    () => ({
      p({ children }) {
        // 首个纯文本子节点开头的 /skill-id 仅做着色处理，其余内容原样渲染
        if (skillInvocation) {
          const command = `/${skillInvocation.id}`;
          children = React.Children.map(children, (child, index) => {
            if (index === 0 && typeof child === 'string' && child.startsWith(command)) {
              return (
                <React.Fragment>
                  <span className="qc-skill-command">{command}</span>
                  {child.slice(command.length)}
                </React.Fragment>
              );
            }
            return child;
          });
        }
        return <p>{children}</p>;
      },

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

      // 消息里的图片多为内嵌 base64，同步解码会卡住首帧；
      // 懒加载 + 异步解码把解码移出关键渲染路径
      img({ src, alt, ...props }) {
        return <img src={src} alt={alt ?? ''} loading="lazy" decoding="async" {...props} />;
      },

      table({ children }) {
        return (
          <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#202020]">
            <table className="w-full min-w-max text-sm text-left border-collapse">
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
          <th className="whitespace-nowrap px-4 py-3 text-linear-text-primary font-semibold">{children}</th>
        );
      },

      td({ children }) {
        return <td className="whitespace-nowrap px-4 py-3 text-linear-text-body">{children}</td>;
      },
    }),
    [skillInvocation]
  );

  // 打开会话的过渡渲染：完成态消息先以纯文本铺出（不跑 remark/rehype 管线），
  // markdown 升级由 MessageList 在首帧绘制后逐条触发
  if (deferRich && status !== 'streaming' && status !== 'pending') {
    return (
      <div className="w-full min-w-0 max-w-full text-linear-text-body selection:bg-linear-surface-hover selection:text-linear-text-primary">
        <article className="w-full min-w-0 max-w-full">
          {hasReasoning && reasoning && (
            <ThinkingBlock reasoning={reasoning} isLive={false} durationMs={thinkingMs ?? null} />
          )}
          {hasTextContent && <DeferredPlainContent text={textContent} />}
          {attachments.length > 0 && <AttachmentList attachments={attachments} />}
        </article>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full text-linear-text-body selection:bg-linear-surface-hover selection:text-linear-text-primary">
      <article className="w-full min-w-0 max-w-full">
        {showActivityOnly && activityLabel ? (
          activity?.kind === 'tool' ? (
            <ActivityPill label={activityLabel} />
          ) : (
            <ThinkingIndicator />
          )
        ) : (
          <>
            {showToolPill && activityLabel && <ActivityPill label={activityLabel} />}
            {hasReasoning && reasoning && (
              <ThinkingBlock
                reasoning={reasoning}
                isLive={isThinkingLive}
                durationMs={thinkingMs ?? null}
              />
            )}
            <div className="qc-markdown prose prose-sm min-w-0 max-w-full dark:prose-invert leading-[1.6] prose-p:leading-[1.6] prose-p:my-2.5 prose-p:text-linear-text-body prose-headings:text-linear-text-primary prose-headings:font-semibold prose-headings:tracking-tight prose-headings:leading-tight prose-headings:mt-5 prose-headings:mb-2 prose-h1:text-[1.15em] prose-h2:text-[1.08em] prose-h3:text-[1.05em] prose-strong:text-linear-text-primary prose-strong:font-semibold prose-a:text-linear-text-secondary prose-a:underline prose-a:underline-offset-4 hover:prose-a:text-linear-text-primary prose-code:text-linear-text-primary prose-code:bg-linear-surface-hover prose-code:border prose-code:border-linear-border prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-[4px] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-pre:bg-transparent prose-pre:p-0 prose-blockquote:border-l-[rgba(255,255,255,0.16)] prose-blockquote:text-linear-text-tertiary prose-blockquote:bg-[#202020] prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:not-italic prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5 prose-li:my-1 prose-li:text-linear-text-body prose-hr:border-[rgba(255,255,255,0.12)] prose-hr:my-5 prose-img:rounded-lg prose-img:shadow-none">
              {contentSegments.map((segment, index) =>
                segment.type === 'artifact' ? (
                  <HtmlArtifact
                    key={`artifact-${index}`}
                    code={segment.content}
                    language={segment.language}
                  />
                ) : (
                  markdownSegmentBlocks[index].blocks.map((block, blockIndex) => (
                    <MarkdownBlock
                      key={`markdown-${index}-${blockIndex}`}
                      content={block}
                      components={markdownComponents}
                    />
                  ))
                )
              )}
              {attachments.length > 0 && <AttachmentList attachments={attachments} />}
            </div>
          </>
        )}
        {status === 'streaming' && hasTextContent && !activity && (
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
