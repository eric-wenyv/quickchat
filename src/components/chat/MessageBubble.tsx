import React, { useState, useRef, useEffect } from 'react';
import type { Message } from '@/types/types';
import MessageAvatar from './MessageAvatar';
import MessageContent from './MessageContent';
import MessageMeta from './MessageMeta';

interface MessageBubbleProps {
  message: Message;
  onDelete?: (id: string) => void;
}

/**
 * C-5: MessageBubble
 * 消息外层容器组件。
 * 职责：根据角色 (role) 处理布局对齐、背景样式，并组合头像、正文与元信息。
 * 新增：右键菜单支持删除单条消息。
 */
const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onDelete }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // ── 右键菜单状态 ──
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onDelete) return;
    e.preventDefault();
    e.stopPropagation();
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
    onDelete?.(message.id);
  };

  // 系统消息：居中显示，采用极简的胶囊样式
  if (isSystem) {
    return (
      <div className="flex justify-center w-full my-6 px-6">
        <div className="px-4 py-1.5 bg-sand-200/50 dark:bg-sand-300/50 border border-sand-400/40 rounded-full text-[11px] text-ink-200 font-medium tracking-wide backdrop-blur-sm select-none">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        ref={bubbleRef}
        onContextMenu={handleContextMenu}
        className={`
          flex w-full group py-6 px-4 md:px-8 transition-colors duration-300 ease-in-out
          ${isUser ? 'flex-row-reverse' : 'flex-row'} 
          gap-4 md:gap-6 hover:bg-sand-200/30 dark:hover:bg-sand-300/20
        `}
      >
        {/* 头像区域：固定宽度，防止在长文本下挤压 */}
        <div className="flex-shrink-0 pt-0.5">
          <MessageAvatar role={message.role} />
        </div>

        {/* 消息正文与元信息容器 */}
        <div className={`flex flex-col min-w-0 max-w-[88%] md:max-w-[82%] ${isUser ? 'items-end' : 'items-start'}`}>
          
          {/* 内容气泡：用户侧有背景，AI 侧保持透明以融入背景 */}
          <div 
            className={`
              relative w-full transition-all duration-300
              ${isUser 
                ? 'px-5 py-3.5 bg-white dark:bg-sand-300 border border-sand-400/60 rounded-2xl rounded-tr-sm shadow-[0_2px_12px_-2px_rgba(0,0,0,0.02)]' 
                : 'px-1 py-1 bg-transparent'
              }
            `}
          >
            <MessageContent 
              content={message.content} 
              status={message.status} 
            />
          </div>

          {/* 元信息行：显示时间戳、Token 数及模型标识 */}
          <div className={`mt-2 ${isUser ? 'mr-1' : 'ml-1'}`}>
            <MessageMeta 
              createdAt={message.created_at} 
              tokenCount={message.token_count} 
              inputTokens={message.input_tokens}
              outputTokens={message.output_tokens}
              modelId={message.model_id}
              role={message.role}
            />
          </div>
        </div>
      </div>

      {/* 右键上下文菜单 */}
      {showContextMenu && onDelete && (
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
            删除消息
          </button>
        </div>
      )}
    </>
  );
};

export default MessageBubble;
