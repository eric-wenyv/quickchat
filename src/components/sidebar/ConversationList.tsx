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
  // 加载态：渲染与单行标题布局一致的 6 个骨架项
  if (isLoading) {
    return (
      <div className="h-full min-h-0 flex flex-col gap-1 px-3 py-2 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="flex shrink-0 items-center px-2.5 py-2 rounded-md bg-linear-surface border border-transparent animate-pulse"
          >
            <div className="h-4 w-28 bg-linear-surface-hover rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  // 空状态：不显示额外插画或引导文案，避免侧栏出现无效 UI。
  if (conversations.length === 0) {
    return (
      <div className="h-full min-h-0 px-2 py-1" aria-label="暂无对话历史" />
    );
  }

  // 正常列表态
  const pinnedConversations = conversations.filter(c => c.pinned);
  const recentConversations = conversations.filter(c => !c.pinned);

  return (
    <div
      className="h-full min-h-0 overflow-y-auto px-2 py-1 flex flex-col gap-0.5 transition-opacity duration-300 ease-in-out custom-scrollbar"
    >
      <div className="shrink-0 px-2 pb-2 pt-1">
        <span className="text-[11px] font-semibold text-linear-text-tertiary select-none">
          对话历史
        </span>
      </div>
      {pinnedConversations.length > 0 && (
        <div className="shrink-0 px-2 pt-2 pb-1.5">
          <span className="text-[11px] font-semibold text-linear-text-tertiary select-none">
            固定
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
        <div className="shrink-0 px-2 pt-2 pb-1.5">
          <span className="text-[11px] font-semibold text-linear-text-tertiary select-none">
            最近
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
