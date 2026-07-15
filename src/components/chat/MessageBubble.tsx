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
 * C-5: MessageBubble (Linear-style Feed/Log)
 * 
 * 核心改造：
 * 1. 抛弃气泡背景，采用信息流布局（上下排列，左对齐）。
 * 2. 用户消息和 AI 消息统一左对齐。
 * 3. 每轮对话之间用 1px 幽灵细线隔开。
 * 4. 头像与身份标识放在消息上方。
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

  return (
    <>
      <div
        ref={bubbleRef}
        onContextMenu={handleContextMenu}
        className="flex w-full group py-6 px-4 md:px-8 hover:bg-linear-surface/30"
        style={{
          animation: 'message-enter 0.25s var(--ease-snappy) both',
          transition: 'background-color 0.15s var(--ease-snappy)',
        }}
      >
        {/* 左侧：头像 + 身份标识列 */}
        <div className="flex-shrink-0 mr-4">
          <MessageAvatar role={message.role} />
        </div>

        {/* 右侧：身份名称/时间 + 内容 */}
        <div className="flex flex-col min-w-0 flex-1">
          {/* 身份行 */}
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[12px] font-medium text-linear-text-secondary">
              {isUser ? 'You' : 'Assistant'}
            </span>
            <MessageMeta
              createdAt={message.created_at}
              tokenCount={message.token_count}
              inputTokens={message.input_tokens}
              outputTokens={message.output_tokens}
              modelId={message.model_id}
              role={message.role}
            />
          </div>

          {/* 消息正文 - 无气泡背景 */}
          <div className="relative w-full">
            <MessageContent
              content={message.content}
              status={message.status}
              activity={message.activity ?? null}
            />
          </div>
        </div>
      </div>

      {/* 右键上下文菜单 */}
      {showContextMenu && onDelete && (
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
            删除消息
          </button>
        </div>
      )}
    </>
  );
};

export default MessageBubble;
