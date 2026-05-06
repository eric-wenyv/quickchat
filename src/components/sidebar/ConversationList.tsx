import React from 'react';
import type { ConversationSummary, UUID } from '@/types/types';
import ConversationItem from './ConversationItem';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId: UUID | null;
  onSelect: (id: UUID) => void;
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
  isLoading,
}) => {
  // 加载态：渲染 6 个骨架屏卡片
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col gap-1 px-3 py-2 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div 
            key={i} 
            className="flex flex-col gap-2.5 p-3 rounded-xl bg-sand-200/50 border border-transparent animate-pulse"
          >
            <div className="flex justify-between items-center">
              <div className="h-4 w-24 bg-sand-400/60 rounded-md" />
              <div className="h-3 w-8 bg-sand-400/40 rounded-md" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-full bg-sand-400/30 rounded-md" />
              <div className="h-3 w-4/5 bg-sand-400/20 rounded-md" />
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
          <div className="w-16 h-16 bg-sand-300 rounded-3xl rotate-12 animate-pulse shadow-sm flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-ink-100/20 rounded-lg -rotate-12" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-sand-400 rounded-full border-4 border-sand-200" />
        </div>
        <h3 className="text-sm font-semibold text-ink-300 mb-1">开启新的灵感</h3>
        <p className="text-xs text-ink-100 leading-relaxed max-w-[160px] mx-auto">
          点击上方按钮开始您的第一个 AI 对话
        </p>
      </div>
    );
  }

  // 正常列表态
  return (
    <div 
      className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1 transition-opacity duration-300 ease-in-out"
      style={{ scrollbarWidth: 'thin', scrollbarColor: '#D4D0C8 transparent' }}
    >
      {conversations.map((conv) => (
        <ConversationItem
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeId}
          onSelect={() => onSelect(conv.id)}
        />
      ))}
    </div>
  );
};

export default ConversationList;
