import React from 'react';
import type { ConversationSummary, UUID } from '@/types/types';
import ConversationItem from './ConversationItem';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: UUID | null;
  onSelect: (id: UUID) => void;
  onDelete: (id: UUID) => void;
  onPin?: (id: UUID) => void;
  isLoading: boolean;
}

/**
 * B-4: 会话列表组件
 * 职责：渲染会话摘要列表，处理空状态与加载态
 */
const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onPin,
  isLoading,
}) => {
  // 加载态：渲染 6 个骨架屏卡片
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col gap-1 px-3 py-2 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div 
            key={i} 
            className="flex flex-col gap-2.5 p-3 rounded-lg bg-linear-surface border border-transparent animate-pulse"
          >
            <div className="flex justify-between items-center">
              <div className="h-4 w-24 bg-linear-surface-hover rounded-md" />
              <div className="h-3 w-8 bg-linear-surface-hover/60 rounded-md" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-full bg-linear-surface-hover/40 rounded-md" />
              <div className="h-3 w-4/5 bg-linear-surface-hover/30 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 空状态：优雅的占位提示
  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="relative mb-6">
          <div className="w-16 h-16 bg-linear-surface rounded-2xl rotate-12 animate-pulse flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-linear-border rounded-lg -rotate-12" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-linear-bg-elevated rounded-full border-4 border-linear-bg" />
        </div>
        <h3 className="text-sm font-medium text-linear-text-secondary mb-1">开启新的灵感</h3>
        <p className="text-xs text-linear-text-muted leading-relaxed max-w-[160px] mx-auto">
          点击上方按钮开始您的第一个 AI 对话
        </p>
      </div>
    );
  }

  // 正常列表态
  const pinnedConversations = conversations.filter(c => c.pinned);
  const recentConversations = conversations.filter(c => !c.pinned);

  return (
    <div 
      className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5 transition-opacity duration-300 ease-in-out custom-scrollbar"
    >
      {pinnedConversations.length > 0 && (
        <div className="px-2 pt-2 pb-1.5">
          <span className="text-[11px] font-semibold text-linear-text-tertiary uppercase tracking-wider select-none">
            Pinned
          </span>
        </div>
      )}
      {pinnedConversations.map((conv) => (
        <ConversationItem
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeId}
          onSelect={() => onSelect(conv.id)}
          onDelete={() => onDelete(conv.id)}
          onPin={() => onPin?.(conv.id)}
        />
      ))}
      {recentConversations.length > 0 && (
        <div className="px-2 pt-2 pb-1.5">
          <span className="text-[11px] font-semibold text-linear-text-tertiary uppercase tracking-wider select-none">
            Recents
          </span>
        </div>
      )}
      {recentConversations.map((conv) => (
        <ConversationItem
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeId}
          onSelect={() => onSelect(conv.id)}
          onDelete={() => onDelete(conv.id)}
          onPin={() => onPin?.(conv.id)}
        />
      ))}
    </div>
  );
};

export default ConversationList;
