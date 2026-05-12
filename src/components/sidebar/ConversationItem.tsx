import React, { useState, useRef, useEffect } from 'react';
import type { ConversationSummary } from '@/types/types';
import RelativeTime from '@/components/shared/RelativeTime';

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

/**
 * B-5: 会话项组件 (Linear-style)
 * 选中状态调暗，去掉左侧粗亮条，标题前加彩色小图标。
 */
const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
}) => {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showContextMenu]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowContextMenu(false);
    onDelete();
  };

  return (
    <>
      <div
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className={`
          group relative flex flex-col gap-1 p-2.5 cursor-pointer rounded-lg select-none overflow-hidden
          ${isActive
            ? 'bg-[#1C1E21] shadow-linear-highlight border border-[rgba(255,255,255,0.04)]'
            : 'border border-transparent hover:bg-linear-surface active:scale-[0.98]'
          }
        `}
        style={{ transition: 'background-color 0.15s var(--ease-snappy), transform 0.15s var(--ease-snappy)' }}
      >
        {isActive && (
          <span
            className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-linear-accent"
            aria-hidden="true"
          />
        )}
        {/* 第一行：标题与时间 */}
        <div className="flex items-center justify-between gap-2 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {/* 彩色小图标 - Linear 风格高饱和点缀 */}
            {conversation.agent_url ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-linear-accent">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            ) : (
              <span className="shrink-0 w-3 h-3" aria-hidden="true" />
            )}
            <h3 className={`text-sm font-medium truncate ${isActive ? 'text-linear-text-primary' : 'text-linear-text-secondary'}`}>
              {conversation.title || '新对话'}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Hover 浮现的删除按钮 */}
            <button
              onClick={handleDelete}
              className="opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 p-0.5 rounded text-linear-text-muted hover:text-red-400 hover:bg-red-500/10"
              style={{ transition: 'all 0.2s var(--ease-snappy)' }}
              title="删除对话"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
            <RelativeTime
              timestamp={conversation.last_message_at}
              className={`text-[10px] ${isActive ? 'text-linear-text-tertiary' : 'text-linear-text-muted group-hover:text-linear-text-tertiary'}`}
            />
          </div>
        </div>

        {/* 第二行：预览与消息数 */}
        <div className="flex items-center justify-between gap-3 overflow-hidden">
          <p className="text-xs text-linear-text-secondary truncate flex-1 leading-snug">
            {conversation.last_message_preview || '尚未开始对话...'}
          </p>

          {conversation.message_count > 0 && (
            <span className={`
              text-[10px] min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-md font-medium shrink-0
              ${isActive
                ? 'bg-linear-bg text-linear-text-secondary'
                : 'bg-linear-surface text-linear-text-tertiary group-hover:bg-linear-surface-hover group-hover:text-linear-text-secondary transition-colors'
              }
            `}>
              {conversation.message_count}
            </span>
          )}
        </div>
      </div>

      {/* 右键上下文菜单 */}
      {showContextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[140px] bg-linear-bg-elevated backdrop-blur-xl border border-[rgba(255,255,255,0.08)] shadow-linear-highlight rounded-lg py-1.5 animate-in fade-in zoom-in-95 duration-150"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
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
        </div>
      )}
    </>
  );
};

export default ConversationItem;
