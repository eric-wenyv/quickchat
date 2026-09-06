import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ConversationSummary } from '@/types/types';
import { isMobilePlatform } from '@/utils/platform';

const MENU_GAP = 6; // 菜单与会话项边缘的间距
const VIEWPORT_MARGIN = 8; // 菜单距窗口边缘的最小间距
const LONG_PRESS_DELAY = 500; // 与 MessageBubble 长按手势保持一致
const LONG_PRESS_MOVE_TOLERANCE = 12;

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onPin?: () => void;
}

/**
 * B-5: 会话项组件 (Linear-style)
 * 历史列表仅展示标题，并保留固定和删除操作。
 * 右键/长按菜单：y 轴固定在会话项下方，x 轴对齐指针位置，
 * 通过 portal 渲染到 body 以突破侧栏宽度限制，并按剩余空间自动换向。
 */
const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onPin,
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStartPos = useRef({ x: 0, y: 0 });
  const suppressClickUntil = useRef(0);

  const openMenu = (clientX: number, clientY: number) => {
    setAnchor({ x: clientX, y: clientY });
    setMenuPos(null); // 等待挂载后测量真实尺寸再定位
    setShowContextMenu(true);
  };

  const closeMenu = () => setShowContextMenu(false);

  // 菜单挂载后测量真实尺寸再定位：
  // y 固定锚定会话项下方（底部空间不足时翻转到上方），
  // x 对齐指针（右侧空间不足时向左展开），始终收敛在窗口内。
  useLayoutEffect(() => {
    if (!showContextMenu || !menuRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    const item = itemRef.current?.getBoundingClientRect();
    let top = (item ? item.bottom : anchor.y) + MENU_GAP;
    if (top + menu.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = (item ? item.top : anchor.y) - MENU_GAP - menu.height;
    }
    let left = anchor.x;
    if (left + menu.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = anchor.x - menu.width;
    }
    top = Math.max(VIEWPORT_MARGIN, top);
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - menu.width - VIEWPORT_MARGIN));
    setMenuPos({ left, top });
  }, [showContextMenu, anchor]);

  useEffect(() => {
    if (!showContextMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const close = () => closeMenu();
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    // 锚点是打开瞬间的快照，列表滚动或窗口缩放后位置失效，直接关闭
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [showContextMenu]);

  // ── 移动端长按 ──
  // Android WebView 长按会派发 contextmenu（handleContextMenu 中拦截并取消定时器）；
  // iOS WKWebView 不派发，触摸定时器兜底，两条路径最终都走 openMenu。
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // 右键：桌面右键菜单 / 移动端长按派发的 contextmenu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cancelLongPress();
    openMenu(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobilePlatform) return;
    const touch = e.touches[0];
    longPressStartPos.current = { x: touch.clientX, y: touch.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      // 抑制长按结束后系统合成的 click，避免菜单弹出的同时触发会话选中
      suppressClickUntil.current = Date.now() + 500;
      openMenu(touch.clientX, touch.clientY);
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

  const handleClick = () => {
    if (Date.now() < suppressClickUntil.current) return;
    onSelect();
  };

  useEffect(() => () => cancelLongPress(), []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeMenu();
    onDelete();
  };

  return (
    <>
      <div
        ref={itemRef}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={isMobilePlatform ? handleTouchStart : undefined}
        onTouchMove={isMobilePlatform ? handleTouchMove : undefined}
        onTouchEnd={isMobilePlatform ? cancelLongPress : undefined}
        onTouchCancel={isMobilePlatform ? cancelLongPress : undefined}
        className={`
          group relative flex shrink-0 items-center gap-2 px-2.5 py-2 cursor-pointer rounded-md select-none overflow-hidden
          ${isActive
            ? 'bg-linear-selection border border-linear-border text-linear-text-primary'
            : 'border border-transparent hover:bg-linear-surface active:scale-[0.98]'
          }
        `}
        style={{
          transition: 'background-color 0.15s var(--ease-snappy), border-color 0.15s var(--ease-snappy), box-shadow 0.15s var(--ease-snappy), transform 0.15s var(--ease-snappy)',
          animation: isActive ? 'conversation-selected 0.18s var(--ease-snappy)' : undefined,
        }}
      >
        <h3 className={`min-w-0 flex-1 truncate text-sm font-medium ${isActive ? 'text-linear-text-primary' : 'text-linear-text-secondary'}`}>
          {conversation.title || '新对话'}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Hover 浮现的固定按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); onPin?.(); }}
            className={`opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 p-0.5 rounded transition-all ${
              conversation.pinned
                ? 'text-linear-text-primary opacity-100 translate-x-0'
                : 'text-linear-text-muted hover:text-linear-text-primary hover:bg-linear-surface-hover'
            }`}
            style={{ transition: 'all 0.2s var(--ease-snappy)' }}
            title={conversation.pinned ? '取消固定' : '固定对话'}
            aria-label={conversation.pinned ? '取消固定' : '固定对话'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill={conversation.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
          </button>
          {/* Hover 浮现的删除按钮 */}
          <button
            onClick={handleDelete}
            className="opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 p-0.5 rounded text-linear-text-muted hover:text-red-400 hover:bg-red-500/10"
            style={{ transition: 'all 0.2s var(--ease-snappy)' }}
            title="删除对话"
            aria-label="删除对话"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      </div>

      {/* 右键/长按上下文菜单：portal 到 body，不受侧栏 overflow/transform 影响 */}
      {showContextMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[140px] bg-linear-bg-elevated backdrop-blur-xl border border-[rgba(255,255,255,0.08)] shadow-linear-highlight rounded-lg py-1.5 animate-in fade-in zoom-in-95 duration-150"
          style={menuPos ?? { visibility: 'hidden' }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onPin?.(); closeMenu(); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-linear-text-secondary hover:bg-linear-surface transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={conversation.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
            {conversation.pinned ? '取消固定' : '固定对话'}
          </button>
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            删除对话
          </button>
        </div>,
        document.body
      )}
    </>
  );
};

export default ConversationItem;
