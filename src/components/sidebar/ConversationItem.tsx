import React from 'react';
import type { ConversationSummary } from '@/types/types';
import RelativeTime from '@/components/shared/RelativeTime';

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
}

/**
 * B-5: 会话项组件
 * 职责：展示单条会话的摘要卡片（标题、预览、时间、消息数）
 */
const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  onSelect,
}) => {
  return (
    <div
      onClick={onSelect}
      className={`
        group flex flex-col gap-1.5 p-3 cursor-pointer rounded-xl transition-all duration-200 select-none
        ${isActive 
          ? 'bg-sand-400 shadow-sm' 
          : 'hover:bg-sand-300 active:scale-[0.98] active:bg-sand-400'
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
  );
};

export default ConversationItem;
