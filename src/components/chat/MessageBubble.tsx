import React, { useState, useRef, useEffect } from 'react';
import type { Message } from '@/types/types';
import { isMobilePlatform } from '@/utils/platform';
import { copyTextToClipboard } from '@/hooks/useCopy';
import {
  findSelectableBlock,
  selectElementContents,
  clearSelectionIfInside,
} from '@/utils/textSelection';
import MessageContent from './MessageContent';

const IS_MOBILE = isMobilePlatform;

/** 移动端长按判定参数 */
const LONG_PRESS_DELAY = 500;
const LONG_PRESS_MOVE_TOLERANCE = 12;

interface MessageBubbleProps {
  message: Message;
  onDelete?: (id: string) => void;
  /** 打开会话的过渡形态：跳过 markdown 管线先铺纯文本（见 MessageContent.deferRich） */
  deferRich?: boolean;
}

/**
 * C-5: MessageBubble (Chat 对话布局)
 *
 * 核心布局：
 * 1. 用户消息靠右，使用与主题一致的气泡背景。
 * 2. AI 回复靠左，保持信息流式全宽排版。
 * 3. 不显示头像，仅保留身份名称与元信息。
 *
 * 消息操作（复制/删除）：
 * 1. 桌面端 hover 消息行时在下方浮出图标按钮（overlay，不占布局高度）。
 * 2. 移动端 AI 消息操作行常驻；用户消息长按全选后浮出。
 * 3. 移动端长按（contextmenu / 触摸定时器）建立选区，AI 消息的
 *    选区悬浮复制条由全局 SelectionCopyBar 响应。
 */
const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onDelete, deferRich }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const canAct = message.status !== 'pending' && message.status !== 'streaming';

  // ── 消息操作状态 ──
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const copyResetTimer = useRef<number | null>(null);
  const dismissTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStartPos = useRef({ x: 0, y: 0 });

  useEffect(() => () => {
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
  }, []);

  // 消息切换/内容更新（流式替换等）时收起悬浮操作条
  useEffect(() => {
    setShowMobileActions(false);
    setCopied(false);
  }, [message.id, message.content]);

  // 悬浮操作条显示期间：点击行外或选区塌陷时收起，并清理选区手柄
  useEffect(() => {
    if (!showMobileActions) return;
    const dismiss = () => {
      setShowMobileActions(false);
      clearSelectionIfInside(contentRef.current);
    };
    const onDocPointerDown = (e: PointerEvent) => {
      if (rowRef.current?.contains(e.target as Node)) return;
      dismiss();
    };
    const onSelChange = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // 选区仍在（含手动调整范围）→ 保持
      // 延迟收起：移动端点按操作条会先塌陷选区，需等 click 落地
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
      dismissTimer.current = window.setTimeout(dismiss, 250);
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('selectionchange', onSelChange);
    };
  }, [showMobileActions]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    await copyTextToClipboard(message.content);
    setCopied(true);
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    setShowMobileActions(false);
    onDelete?.(message.id);
  };

  // ── 移动端长按选择 ──
  // 用户消息：全选气泡内容并浮出操作条；AI 消息：选中长按所在段落，
  // 由 SelectionCopyBar 在选区上方浮出复制按钮。
  const triggerLongPress = (target: EventTarget | null): void => {
    if (!canAct) return;
    const root = contentRef.current;
    if (!root || !(target instanceof Node) || !root.contains(target)) return;
    const ok = isUser
      ? selectElementContents(root)
      : (() => {
        const block = findSelectableBlock(target, root);
        return block ? selectElementContents(block) : false;
      })();
    if (ok && isUser) setShowMobileActions(true);
  };

  // iOS WKWebView 长按不派发 contextmenu：触摸定时器兜底
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Android WebView 长按会派发 contextmenu，在此拦截为"选择"手势；
  // 桌面端不挂载该处理器，右键回落系统默认菜单。
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!IS_MOBILE || !canAct) return;
    e.preventDefault();
    e.stopPropagation();
    cancelLongPress();
    triggerLongPress(e.target);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!IS_MOBILE || !canAct) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 已有选区：长按属于原生手柄拖拽
    const touch = e.touches[0];
    longPressStartPos.current = { x: touch.clientX, y: touch.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      triggerLongPress(touch.target);
    }, LONG_PRESS_DELAY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!longPressTimer.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - longPressStartPos.current.x;
    const dy = touch.clientY - longPressStartPos.current.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOLERANCE * LONG_PRESS_MOVE_TOLERANCE) {
      cancelLongPress();
    }
  };

  // 系统消息：居中显示，极简胶囊
  if (isSystem) {
    return (
      <div className="flex justify-center w-full my-6 px-6">
        <div className="px-4 py-1.5 bg-linear-surface border border-linear-border rounded-full text-[11px] text-linear-text-tertiary font-medium tracking-wide backdrop-blur-sm select-none">
          {message.content}
        </div>
      </div>
    );
  }

  // 操作行可见性：桌面 hover 显示；移动 AI 常驻；移动用户长按后显示
  const showActions =
    canAct && !!onDelete && (IS_MOBILE ? (isUser ? showMobileActions : true) : true);
  // 桌面与移动用户消息用 overlay（浮在下方空隙，不占布局高度）；移动 AI 在流内
  const overlayActions = !IS_MOBILE || isUser;

  return (
    <div
      ref={rowRef}
      data-message-id={message.id}
      data-role={message.role}
      onContextMenu={IS_MOBILE && canAct ? handleContextMenu : undefined}
      onTouchStart={IS_MOBILE ? handleTouchStart : undefined}
      onTouchMove={IS_MOBILE ? handleTouchMove : undefined}
      onTouchEnd={IS_MOBILE ? cancelLongPress : undefined}
      onTouchCancel={IS_MOBILE ? cancelLongPress : undefined}
      className={`flex w-full group px-4 md:px-8 ${isUser ? 'justify-end py-4' : 'py-6'}`}
      style={{
        // 不能用 fill:both：结束后残留的 transform 会让行永久成为独立
        // stacking context，后一行会盖住悬浮操作条溢出行外的部分，
        // 导致按钮下半截 hover/点击全部失效。终帧与静态样式一致，
        // 去掉 fill 后动画结束时 transform 归为 none，视觉无变化。
        animation: 'message-enter 0.25s var(--ease-snappy)',
      }}
    >
      <div
        className={`flex flex-col relative min-w-0 ${isUser ? 'items-end max-w-[85%] md:max-w-[70%]' : 'flex-1'}`}
      >
        {/* 消息正文：用户气泡靠右 / AI 全宽靠左 */}
        <div
          ref={contentRef}
          className={
            isUser
              ? 'relative rounded-2xl border border-linear-border bg-linear-surface py-0.5 px-3 shadow-linear-highlight transition-colors group-hover:bg-linear-surface-hover'
              : 'relative w-full'
          }
        >
          <MessageContent
            content={message.content}
            status={message.status}
            activity={message.activity ?? null}
            reasoning={message.reasoning_content ?? null}
            thinkingMs={message.thinking_ms ?? null}
            deferRich={deferRich}
          />
        </div>

        {/* 消息操作行：复制 / 删除 */}
        {showActions && (
          <div
            className={`flex items-center gap-0.5 ${isUser ? 'justify-end' : 'justify-start'} ${overlayActions
              ? 'absolute top-full inset-x-0 mt-1 z-10 px-1 -mx-1 pb-1'
              : 'mt-1.5'
              } ${!IS_MOBILE
                ? // 保持可命中：按钮悬浮在行盒下方的空隙里，需能从下方直接 hover 唤出；
                // 该区域仅覆盖消息间空白 padding，不会遮挡内容
                'opacity-0 hover:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100'
                : ''
              }`}
            style={{
              // menu-enter 终帧为 opacity:1，fill:both 会永久压过 opacity-0，
              // 因此仅用于"挂载即应可见"的移动端用户悬浮条；桌面 hover 淡入靠 transition
              animation: IS_MOBILE && isUser ? 'menu-enter 0.15s var(--ease-snappy) both' : undefined,
              transition: !IS_MOBILE ? 'opacity 0.15s var(--ease-snappy)' : undefined,
            }}
          >
            <button
              onClick={handleCopy}
              title={isUser ? '复制消息' : '复制全部'}
              aria-label={isUser ? '复制消息' : '复制全部'}
              className="flex items-center justify-center p-1.5 rounded-lg text-linear-text-tertiary hover:text-linear-text-primary hover:bg-linear-surface active:scale-[0.96] transition-colors cursor-pointer"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              )}
            </button>
            <button
              onClick={handleDelete}
              title="删除消息"
              aria-label="删除消息"
              className="flex items-center justify-center p-1.5 rounded-lg text-red-400/70 hover:text-red-400 hover:bg-red-500/10 active:scale-[0.96] transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// memo：流式输出期间 messages 数组高频更新，但未变化的消息对象保持原引用
// （updateThreadMessages 只替换目标消息），memo 让历史消息完全跳过重渲染，
// 避免每轮刷新都对全部历史消息重新执行 markdown 解析。
export default React.memo(MessageBubble);
