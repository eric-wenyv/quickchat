import React, { useState, useRef, useEffect } from 'react';
import type { ConversationSummary } from '@/types/types';

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
 */
const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
  onPin,
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

      {/* 右键上下文菜单 */}
      {showContextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[140px] bg-linear-bg-elevated backdrop-blur-xl border border-[rgba(255,255,255,0.08)] shadow-linear-highlight rounded-lg py-1.5 animate-in fade-in zoom-in-95 duration-150"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onPin?.(); setShowContextMenu(false); }}
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
        </div>
      )}
    </>
  );
};

export default ConversationItem;
