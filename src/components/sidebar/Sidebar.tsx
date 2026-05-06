import React from 'react';
import type { ConversationSummary, UUID } from '@/types/types';
import TauriDragRegion from '@/components/shared/TauriDragRegion';
import NewChatButton from './NewChatButton';
import SearchBar from './SearchBar';
import ConversationList from './ConversationList';

interface SidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: UUID | null;
  onSelectConversation: (id: UUID) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: UUID) => void;
  onSearchChange: (query: string) => void;
  isLoading: boolean;
  /** 当前搜索关键词 */
  searchQuery: string;
}

/**
 * B-1: Sidebar
 * 
 * 核心职责：
 * 侧边栏容器组件，作为 AppLayout 的左侧面板。
 * 组合了拖拽区域、新建按钮、搜索功能和对话历史列表。
 * 
 * 设计规范：
 * - 背景色：sand-200 (次级背景)
 * - 边框：右侧 border-r border-sand-400
 * - 交互：select-none 禁止文本选中，优化原生应用感
 */
const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onSearchChange,
  isLoading,
  searchQuery,
}) => {
  return (
    <aside className="flex flex-col h-full w-80 bg-sand-200 border-r border-sand-400 overflow-hidden select-none">
      {/* 1. Tauri 窗口拖拽区域 (非悬浮模式，占据侧边栏顶部高度) */}
      <TauriDragRegion floating={false} className="flex-shrink-0 h-10" />

      {/* 2. 操作与搜索区域 */}
      <div className="flex flex-col flex-shrink-0 px-4 mt-2">
        {/* B-2: 新建对话按钮 */}
        <NewChatButton onClick={onCreateConversation} />
        
        {/* B-3: 搜索框 (内部自带 padding 和 bg) */}
        <div className="-mx-1 -mt-2">
          <SearchBar onSearch={onSearchChange} />
        </div>

        {/* 搜索结果统计 */}
        {searchQuery.trim() && (
          <div className="flex items-center justify-between px-1 py-1.5 mb-1">
            <span className="text-[11px] text-ink-200 font-medium">
              {conversations.length > 0
                ? `找到 ${conversations.length} 个结果`
                : '无匹配结果'}
            </span>
            <button
              onClick={() => onSearchChange('')}
              className="text-[11px] text-ink-100 hover:text-ink-400 font-semibold transition-colors cursor-pointer"
            >
              清除
            </button>
          </div>
        )}
      </div>

      {/* 3. 会话列表区域 (B-4) */}
      <div className="flex-1 overflow-hidden mt-2">
        <ConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
          isLoading={isLoading}
        />
      </div>
    </aside>
  );
};

export default Sidebar;
