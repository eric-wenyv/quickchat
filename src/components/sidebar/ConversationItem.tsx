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
 * B-5: 会话项组件
 * 职责：展示单条会话的摘要卡片（标题、预览、时间、消息数）
 * 右键菜单：删除对话
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
    // 计算菜单位置（相对于视口）
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  // 点击外部关闭
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
          group flex flex-col gap-1 p-2.5 cursor-pointer rounded-lg transition-all duration-200 select-none
          ${isActive 
            ? 'bg-sand-400/70 shadow-sm' 
            : 'hover:bg-sand-300/60 active:scale-[0.98] active:bg-sand-400/70'
          }
        `}
      >
        {/* 第一行：标题与时间 */}
        <div className="flex items-center justify-between gap-2 overflow-hidden">
          <h3 className={`text-sm font-semibold truncate flex-1 ${isActive ? 'text-ink-400' : 'text-ink-300'}`}>
            {conversation.title || '新对话'}
          </h3>
          <RelativeTime 
            timestamp={conversation.last_message_at} 
            className={`shrink-0 text-[10px] ${isActive ? 'text-ink-200' : 'text-ink-100 group-hover:text-ink-200'}`}
          />
        </div>
        
        {/* 第二行：预览与消息数 */}
        <div className="flex items-center justify-between gap-3 overflow-hidden">
          <p className="text-xs text-ink-100 truncate flex-1 leading-relaxed">
            {conversation.last_message_preview || '尚未开始对话...'}
          </p>
          
          {conversation.message_count > 0 && (
            <span className={`
              text-[10px] min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-md font-medium shrink-0
              ${isActive 
                ? 'bg-sand-200 text-ink-300' 
                : 'bg-sand-300 text-ink-100 group-hover:bg-sand-400 group-hover:text-ink-200 transition-colors'
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
          className="fixed z-[9999] min-w-[140px] bg-white/95 dark:bg-sand-200/95 backdrop-blur-xl border border-sand-400/60 rounded-xl shadow-panel py-1.5 animate-in fade-in zoom-in-95 duration-150"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
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
